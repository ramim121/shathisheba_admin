import { queryRows } from "@/lib/db";
import { resolveImage } from "@/lib/ai-assist";
import { getAppOfficers } from "@/lib/app-endpoints";
import { apaConfig, apaPrompt, type ApaConfig } from "@/lib/apa/config";
import { friendlyModelError, isApaConfigured, isOurError } from "@/lib/apa/client";
import { classifyScope, refusalSuggestions } from "@/lib/apa/classify";
import { readAnswerCache, writeAnswerCache } from "@/lib/apa/cache";
import {
  assertApaAccess,
  resolveEntitlement,
  spendTrialQuestion,
  type ApaEntitlement
} from "@/lib/apa/entitlement";
import {
  attachScopeMessage,
  attachToolCalls,
  logMessage,
  nameConversation,
  openConversation
} from "@/lib/apa/log";
import { addUsage, assertAskRate } from "@/lib/apa/quota";
import { budgetState, BUDGET_SPENT_MESSAGE, type BudgetState } from "@/lib/apa/budget";
import { costOf } from "@/lib/apa/pure";
import { answer, type ApaAnswer } from "@/lib/apa/reason";
import { speak } from "@/lib/apa/tts";
import { transcribeAudio } from "@/lib/apa/transcribe";
import { bengaliDate } from "@/lib/apa/calendar";

/**
 * One question, end to end.
 *
 * The order below is the whole security and cost story of this feature, and it
 * is deliberate:
 *
 *   entitlement → rate limit → transcribe → cache → scope → answer → speak → log
 *
 * Entitlement first, because a locked farmer must cost nothing at all — not a
 * transcription, not a classification. The **cache** sits before the scope gate
 * and the answering model, so a question fifty farmers in one upazila ask on
 * the same morning costs one model call rather than fifty. Scope before the
 * answering model, because a refusal that happens *inside* the answering model
 * has already paid for the answer. And the trial counter is spent last, only
 * once an answer actually exists, so a failure or a refusal never costs her one
 * of her five.
 */

type Row = Record<string, unknown>;

export type AskInput = {
  userId: string;
  mode: "text" | "voice" | "photo";
  text?: string | null;
  /** base64 audio from the phone, with its mime type. */
  audio?: { data: string; mimeType: string } | null;
  /** A URL already uploaded through /api/upload, never an arbitrary address. */
  imageUrl?: string | null;
  conversationId?: number | null;
  /** Ask for server speech even when the platform default is device speech. */
  speakAnswer?: boolean;
  /** The phone has no Bangla voice of its own, so it needs the server's. */
  needsServerSpeech?: boolean;
  lang?: "bn" | "en";
  ip?: string | null;
  /** Where the phone should fetch audio from, for the fallback speech path. */
  origin?: string;
};

export type ApaSpeech =
  | { mode: "device"; text: string; language: string; rate: string }
  | { mode: "server"; url: string; mime_type: string; sample_rate: number; seconds: number | null };

export type AskResult = {
  conversation_id: number | null;
  message_id: number | null;
  transcript: { text: string; seconds: number; ok: boolean } | null;
  refused: boolean;
  answer: {
    text: string;
    advice: ApaAnswer["advice"];
    caution: string | null;
    suggestions: string[];
    sources: ApaAnswer["sources"];
  };
  officer: Row | null;
  /**
   * How the answer should be spoken. `device` means the phone's own engine says
   * it — free, instant, offline — and the payload is just the text.
   */
  speech: ApaSpeech | null;
  asked_clarification: boolean;
  from_cache: boolean;
  entitlement: ApaEntitlement;
  /** Milliseconds, for the console's latency column. */
  latency_ms: number;
};

const FEATURE = { text: "ask_text", voice: "ask_voice", photo: "ask_photo" } as const;

/**
 * The public entry point. Every model failure in the pipeline below crosses
 * this boundary, so it is the one place that has to turn Google's English JSON
 * into a sentence a farmer can read — anything thrown from here already is one.
 */
export async function askApa(input: AskInput): Promise<AskResult> {
  try {
    return await runAsk(input);
  } catch (error) {
    if (isOurError(error)) throw error;
    // Our own validation messages are already written for her; only a failure
    // that came back from the model needs translating.
    const message = error instanceof Error ? error.message : "";
    if (message && !/^\{|Gemini |GoogleGenerativeAI|\[GoogleGenerativeAI/.test(message) && message.length < 160) {
      throw error;
    }
    throw friendlyModelError(error);
  }
}

async function runAsk(input: AskInput): Promise<AskResult> {
  const started = Date.now();
  if (!isApaConfigured()) throw new Error("Shathi Apa is not configured on this server.");

  const cfg = await apaConfig();
  // Throws ApaLockedError, which the route turns into a 403 carrying the whole
  // unlock screen. Nothing below this line runs for a locked farmer.
  //
  // Resolved once and reused: this used to run twice per question, eight
  // queries each time, for a value that cannot change mid-request.
  const entitlement = await assertApaAccess(input.userId, FEATURE[input.mode], cfg);
  await assertAskRate(input.userId, cfg);

  // What is left of the month's money, which decides how much of the pipeline
  // may run. Read once per question: three of the steps below consult it and it
  // cannot move between them.
  const budget = await budgetState(cfg);

  const lang = input.lang === "en" ? "en" : "bn";
  const profile = await loadProfile(input.userId);
  const districtName = (profile?.district_bn ?? profile?.district_en ?? null) as string | null;
  const upazilaName = (profile?.upazila_bn ?? profile?.upazila_en ?? null) as string | null;
  const districtId = (profile?.district_id as string | null) ?? null;

  const conversationId =
    input.conversationId ??
    (await openConversation({ userId: input.userId, path: "ask", districtId }));

  /* --- what she said ---------------------------------------------------- */

  let question = String(input.text ?? "").trim();
  let transcript: AskResult["transcript"] = null;
  let transcribeSeconds = 0;

  // A spoken question has to be transcribed before anything can be looked up,
  // and transcription is itself a billed call — so unlike a typed question it
  // cannot be served from the cache for free, and the check has to come first.
  if (input.mode === "voice" && !budget.allowFresh) {
    return budgetRefusal({ input, cfg, conversationId, entitlement, started, transcript: null, logUserTurn: true });
  }

  if (input.mode === "voice") {
    if (!input.audio?.data) throw new Error("No audio was received.");
    const heard = await transcribeAudio({
      data: input.audio.data,
      mimeType: input.audio.mimeType,
      models: cfg.models.transcribe,
      userId: input.userId
    });
    transcribeSeconds = heard.seconds;
    transcript = { text: heard.text, seconds: heard.seconds, ok: heard.ok };
    question = heard.text;

    // The clip is never lost because the transcription was (SRS G1). The app
    // keeps her recording and offers it back; this only tells it to.
    if (!heard.ok) {
      return unheard({ input, cfg, conversationId, transcript, entitlement, started });
    }
  }

  let image: { data: string; mimeType: string } | null = null;
  if (input.mode === "photo") {
    if (!input.imageUrl) throw new Error("No photo was received.");
    // resolveImage only accepts this platform's own storage, so a URL in the
    // request cannot turn the server into a fetcher for arbitrary addresses.
    image = await resolveImage(input.imageUrl);
  }

  if (!question && !image) throw new Error("প্রশ্নটা লিখুন বা বলুন।");

  /* --- has someone already asked this today ----------------------------- */

  // Only for typed and spoken questions. A photo is hers alone.
  const cached = image
    ? null
    : await readAnswerCache({
        question,
        districtId,
        lang,
        examples: cfg.promptExamples,
        hours: cfg.answerCacheHours
      });

  const userMessageId = await logMessage({
    conversationId,
    userId: input.userId,
    role: "user",
    inputMode: input.mode,
    body: question || null,
    transcript: transcript?.text ?? null,
    imageUrl: input.imageUrl ?? null,
    audioSeconds: transcript?.seconds ?? null,
    ip: input.ip
  });
  await nameConversation(conversationId, question);

  // Everything from here costs money: the scope gate, the answer, the vision
  // call. A cache hit does not, which is why this sits *after* the lookup — at
  // the ceiling the assistant still answers whatever the district asked today.
  if (!cached && !budget.allowFresh) {
    return budgetRefusal({ input, cfg, conversationId, entitlement, started, transcript, transcribeSeconds });
  }

  if (cached) {
    const officer = cached.needs_officer ? await firstOfficer(input.userId) : null;
    const speech = await speechFor({ cfg, input, text: spokenText(cached), entitlement, budget });
    const messageId = await logMessage({
      conversationId,
      userId: input.userId,
      role: "assistant",
      inputMode: input.mode,
      body: cached.text,
      advice: adviceBody(cached.advice),
      tools: cached.tools_used,
      sources: cached.sources,
      suggestions: cached.suggestions,
      hedged: cached.hedged,
      model: "cache",
      fromCache: true,
      latencyMs: Date.now() - started,
      ip: input.ip
    });
    await addUsage(input.userId, {
      ask_count: 1,
      voice_count: input.mode === "voice" ? 1 : 0,
      cache_hits: 1,
      transcribe_seconds: Math.round(transcribeSeconds),
      speech_device: speech?.mode === "device" ? 1 : 0,
      speech_server: speech?.mode === "server" ? 1 : 0
    });
    if (entitlement.tier === "trial") await spendTrialQuestion(input.userId);
    return {
      conversation_id: conversationId,
      message_id: messageId,
      transcript,
      refused: false,
      answer: {
        text: cached.text,
        advice: cached.advice as ApaAnswer["advice"],
        caution: cached.caution,
        suggestions: cached.suggestions,
        sources: cached.sources as ApaAnswer["sources"]
      },
      officer,
      speech,
      asked_clarification: false,
      from_cache: true,
      entitlement: await resolveEntitlement(input.userId, cfg),
      latency_ms: Date.now() - started
    };
  }

  /* --- is it ours to answer --------------------------------------------- */

  const scope = await classifyScope({
    text: question,
    userId: input.userId,
    models: cfg.models.classify,
    hasImage: Boolean(image)
  });
  await attachScopeMessage(scope.scopeLogId, userMessageId);

  if (!scope.allow) {
    const refusal = await apaPrompt("refusal_bn");
    const crops = await farmerCrops(input.userId);
    const suggestions = refusalSuggestions(crops);
    const messageId = await logMessage({
      conversationId,
      userId: input.userId,
      role: "assistant",
      inputMode: input.mode,
      body: refusal,
      suggestions,
      refused: true,
      refusalReason: `out_of_scope:${scope.topic}`,
      model: scope.model,
      latencyMs: Date.now() - started
    });
    await addUsage(input.userId, {
      ask_count: 1,
      refused_count: 1,
      transcribe_seconds: Math.round(transcribeSeconds)
    });
    // A refusal never spends a trial question. She asked for nothing and got
    // nothing; charging her for it would be the app punishing her for the
    // classifier's job.
    return {
      conversation_id: conversationId,
      message_id: messageId,
      transcript,
      refused: true,
      answer: { text: refusal, advice: null, caution: null, suggestions, sources: [] },
      officer: null,
      speech: await speechFor({ cfg, input, text: refusal, entitlement, budget }),
      asked_clarification: false,
      from_cache: false,
      entitlement: await resolveEntitlement(input.userId, cfg),
      latency_ms: Date.now() - started
    };
  }

  /* --- the answer -------------------------------------------------------- */

  const result = await answer({
    question,
    cfg,
    models: image ? cfg.models.vision : cfg.models.text,
    ctx: { userId: input.userId, districtName, upazilaName },
    contextBlock: await contextBlock({ userId: input.userId, profile, districtName, upazilaName, entitlement }),
    history: await recentTurns(conversationId, userMessageId),
    image
  });

  const officer = result.needs_officer ? await firstOfficer(input.userId) : null;

  /* --- read it aloud ----------------------------------------------------- */

  const speech = await speechFor({
    cfg,
    input,
    text: spokenText(result),
    entitlement,
    budget
  });

  /* --- write it all down -------------------------------------------------- */

  const messageId = await logMessage({
    conversationId,
    userId: input.userId,
    role: "assistant",
    inputMode: input.mode,
    body: result.text,
    advice: result.advice?.body ?? null,
    tools: result.tools_used,
    sources: result.sources,
    suggestions: result.suggestions,
    hedged: result.hedged,
    model: result.model,
    latencyMs: result.latencyMs,
    tokensIn: result.usage.tokensIn ?? 0,
    tokensOut: result.usage.tokensOut ?? 0,
    cachedTokens: result.usage.cachedTokens ?? 0,
    askedClarification: result.asked_clarification,
    ip: input.ip
  });
  await attachToolCalls(result.tool_call_ids, messageId);

  if (result.cacheable && !image && cfg.answerCacheHours > 0) {
    await writeAnswerCache({
      question,
      districtId,
      lang,
      examples: cfg.promptExamples,
      model: result.model,
      tools: result.tools_used,
      answer: {
        text: result.text,
        advice: result.advice,
        caution: result.caution,
        suggestions: result.suggestions,
        sources: result.sources,
        needs_officer: result.needs_officer,
        tools_used: result.tools_used,
        hedged: result.hedged
      }
    });
  }

  await addUsage(input.userId, {
    ask_count: 1,
    voice_count: input.mode === "voice" ? 1 : 0,
    photo_count: input.mode === "photo" ? 1 : 0,
    tool_calls: result.tools_used.length,
    transcribe_seconds: Math.round(transcribeSeconds),
    cached_tokens: result.usage.cachedTokens ?? 0,
    speech_device: speech?.mode === "device" ? 1 : 0,
    speech_server: speech?.mode === "server" ? 1 : 0,
    // The real token counts, not an estimate from character lengths.
    est_cost_usd: costOf({
      model: result.model,
      tokensIn: result.usage.tokensIn ?? 0,
      tokensOut: result.usage.tokensOut ?? 0,
      cachedTokens: result.usage.cachedTokens ?? 0
    })
  });

  // A clarifying question is not an answer, so it does not spend one of her
  // five — she has not had anything yet.
  if (entitlement.tier === "trial" && !result.asked_clarification) {
    await spendTrialQuestion(input.userId);
  }

  return {
    conversation_id: conversationId,
    message_id: messageId,
    transcript,
    refused: false,
    answer: {
      text: result.text,
      advice: result.advice,
      caution: result.caution,
      suggestions: result.suggestions,
      sources: result.sources
    },
    officer,
    speech,
    asked_clarification: result.asked_clarification,
    from_cache: false,
    // Resolved again rather than reused: the trial counter has moved, and the
    // app renders its "৪টি প্রশ্ন বাকি" pill straight from this.
    entitlement: await resolveEntitlement(input.userId, cfg),
    latency_ms: Date.now() - started
  };
}

/* ---------------------------------------------------------------------------
   Speech: the phone first, the server only if it has to
   --------------------------------------------------------------------------- */

/**
 * What a voice should read out for an answer.
 *
 * One definition, used by the fresh path and the cache path both, because they
 * disagreed and it cost twice over: the cached path joined only the answer and
 * the caution while the fresh path also included the advice body, so an answer
 * served from cache (a) was read out *differently* from the same answer served
 * fresh, and (b) hashed to a different speech key — which meant every answer
 * cache hit still spent a text-to-speech request to synthesise audio we already
 * had. The two caches were cancelling each other out.
 */
function spokenText(answer: {
  text: string;
  advice?: { body?: string | null } | unknown;
  caution?: string | null;
}): string {
  const advice = answer.advice as { body?: string | null } | null | undefined;
  return [answer.text, advice?.body, answer.caution].filter(Boolean).join(". ");
}

/**
 * The answer when the month's budget is gone.
 *
 * Shaped as a refusal rather than thrown as an error, deliberately. An error
 * becomes the app's failure card — "something went wrong", a retry button and a
 * countdown — which is wrong twice over: nothing went wrong, and retrying will
 * not help until the first of the month. A refusal is a normal turn with an
 * honest sentence and the field officer's number attached, which is the thing
 * that actually resolves her problem today.
 *
 * The turn is logged like any other so the console shows what was refused and
 * why, and it never spends a trial question — she asked and got nothing.
 */
async function budgetRefusal(args: {
  input: AskInput;
  cfg: ApaConfig;
  conversationId: number | null;
  entitlement: ApaEntitlement;
  started: number;
  transcript: AskResult["transcript"];
  transcribeSeconds?: number;
  logUserTurn?: boolean;
}): Promise<AskResult> {
  const { input, cfg, conversationId, entitlement, started, transcript } = args;

  if (args.logUserTurn) {
    await logMessage({
      conversationId,
      userId: input.userId,
      role: "user",
      inputMode: input.mode,
      body: null,
      ip: input.ip
    });
  }

  const officer = await firstOfficer(input.userId);
  const crops = await farmerCrops(input.userId);
  const suggestions = refusalSuggestions(crops);

  const messageId = await logMessage({
    conversationId,
    userId: input.userId,
    role: "assistant",
    inputMode: input.mode,
    body: BUDGET_SPENT_MESSAGE,
    suggestions,
    refused: true,
    refusalReason: "budget_exhausted",
    model: "none",
    latencyMs: Date.now() - started
  });

  await addUsage(input.userId, {
    ask_count: 1,
    refused_count: 1,
    transcribe_seconds: Math.round(args.transcribeSeconds ?? 0)
  });

  return {
    conversation_id: conversationId,
    message_id: messageId,
    transcript,
    refused: true,
    answer: { text: BUDGET_SPENT_MESSAGE, advice: null, caution: null, suggestions, sources: [] },
    officer,
    // Spoken by the phone. Paying Google to say "we have run out of money"
    // would be a small joke at our own expense.
    speech: entitlement.features.read_aloud
      ? {
          mode: "device",
          text: BUDGET_SPENT_MESSAGE,
          language: input.lang === "en" ? "en-US" : "bn-BD",
          rate: cfg.speechRate
        }
      : null,
    asked_clarification: false,
    from_cache: false,
    entitlement,
    latency_ms: Date.now() - started
  };
}

async function speechFor(args: {
  cfg: ApaConfig;
  input: AskInput;
  text: string;
  entitlement: ApaEntitlement;
  budget: BudgetState;
}): Promise<ApaSpeech | null> {
  const { cfg, input, text, entitlement, budget } = args;
  if (!text.trim() || !entitlement.features.read_aloud) return null;

  // Voice in, voice out, without being asked. A typed question gets a speaker
  // button instead — reading aloud to someone sitting with other people is not
  // a kindness (SRS V1).
  const wanted = input.speakAnswer === true || (cfg.autoplayVoice && input.mode !== "text");
  if (!wanted) return null;

  // Past the critical band the phone's own voice does the reading. It is the
  // cheapest degradation available — she still hears the answer, in Bangla,
  // just not in Apa's voice — and it is the difference between spending
  // $0.015 a minute on speech and spending nothing.
  const deviceOnly = cfg.ttsMode === "device" || !budget.allowServerTts;
  const serverOnly = cfg.ttsMode === "server" && budget.allowServerTts;
  const useServer =
    budget.allowServerTts &&
    (serverOnly || (cfg.ttsMode === "device_then_server" && input.needsServerSpeech === true));

  if (!useServer || deviceOnly) {
    // The phone speaks it. Free, instant, offline, and no 300 KB download.
    return {
      mode: "device",
      text,
      language: input.lang === "en" ? "en-US" : "bn-BD",
      rate: cfg.speechRate
    };
  }

  try {
    const spoken = await speak({
      text,
      models: cfg.models.tts,
      voice: cfg.voiceName,
      rate: cfg.speechRate,
      maxChars: cfg.ttsMaxChars,
      origin: input.origin ?? process.env.SELF_ORIGIN ?? "http://127.0.0.1:3000",
      cacheEnabled: cfg.speechCacheEnabled
    });
    if (!spoken) return { mode: "device", text, language: "bn-BD", rate: cfg.speechRate };
    return {
      mode: "server",
      url: spoken.url,
      mime_type: spoken.mimeType,
      sample_rate: spoken.sampleRate,
      seconds: spoken.seconds
    };
  } catch (error) {
    // The text answer is still on screen and still correct. Losing the audio is
    // a degraded answer, not a failed one — and the phone can still try.
    console.error("apa server speech failed", error);
    return { mode: "device", text, language: "bn-BD", rate: cfg.speechRate };
  }
}

/* ---------------------------------------------------------------------------
   The farmer context block
   --------------------------------------------------------------------------- */

/**
 * Everything about this farmer and today, for the *user* turn.
 *
 * It belongs here rather than in the system instruction for two reasons. The
 * instruction stays byte-identical across every farmer, which is what Google's
 * implicit prompt cache needs to recognise a shared prefix. And the date being
 * stated rather than inferred fixed a real error: the model had announced it
 * was আষাঢ় when it was আশ্বিন, three months out, in an assistant whose entire
 * job is telling farmers when to plant and when to harvest.
 */
export async function contextBlock(args: {
  userId: string;
  profile: Row | null;
  districtName: string | null;
  upazilaName: string | null;
  entitlement: ApaEntitlement;
}): Promise<string> {
  const { profile, districtName, upazilaName } = args;
  const [farm] = await queryRows<Row>(
    `SELECT total_land_decimals, primary_focus, crop_types, livestock_count, pond_count
       FROM app_user_farm WHERE user_id = ? LIMIT 1`,
    [args.userId]
  );
  const date = bengaliDate(new Date());

  const bits = [
    "[FARMER CONTEXT]",
    `Today: ${date.gregorian} (Bengali: ${date.bengali}, ${date.month} — ${date.seasonNote}).`,
    `District: ${districtName ?? "unknown"}. Upazila: ${upazilaName ?? "unknown"}.`,
    profile?.village ? `Village: ${String(profile.village)}.` : "",
    farmLine(farm),
    `Identity verified: ${args.entitlement.tier === "locked" || args.entitlement.tier === "trial" ? "no" : "yes"}.`,
    // Named so she is addressed correctly without the model having to call a
    // tool for it — one fewer round trip on the majority of questions.
    profile?.display_name || profile?.full_name
      ? `Her name: ${String(profile.display_name || profile.full_name)} (do not use a gendered title).`
      : ""
  ];
  return bits.filter(Boolean).join("\n");
}

function farmLine(farm: Row | undefined): string {
  if (!farm) return "Farm: not recorded yet.";
  const parts: string[] = [];
  const land = Number(farm.total_land_decimals ?? 0);
  if (land > 0) parts.push(`${(land / 33).toFixed(1)} বিঘা (${land} শতক)`);
  if (farm.crop_types) parts.push(`grows ${String(farm.crop_types)}`);
  if (Number(farm.livestock_count ?? 0) > 0) parts.push(`${Number(farm.livestock_count)} livestock`);
  if (Number(farm.pond_count ?? 0) > 0) parts.push(`${Number(farm.pond_count)} pond(s)`);
  if (farm.primary_focus) parts.push(`mainly ${String(farm.primary_focus)}`);
  return parts.length ? `Farm: ${parts.join("; ")}.` : "Farm: not recorded yet.";
}

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

export async function loadProfile(userId: string): Promise<Row | null> {
  const [row] = await queryRows<Row>(
    `SELECT u.district_id, u.village, u.display_name, u.full_name,
            d.name_bn AS district_bn, d.name_en AS district_en,
            z.name_bn AS upazila_bn, z.name_en AS upazila_en
       FROM app_users u
       LEFT JOIN geo_districts d ON d.id = u.district_id
       LEFT JOIN geo_upazilas z ON z.id = u.upazila_id
      WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  return row ?? null;
}

function adviceBody(advice: unknown): string | null {
  const a = advice as { body?: string } | null;
  return a?.body ?? null;
}

/** The transcription came back empty: keep her clip, offer it back. */
async function unheard(args: {
  input: AskInput;
  cfg: ApaConfig;
  conversationId: number | null;
  transcript: AskResult["transcript"];
  entitlement: ApaEntitlement;
  started: number;
}): Promise<AskResult> {
  const { input, cfg, conversationId, transcript, entitlement, started } = args;
  const text = "বুঝতে পারিনি। আরেকবার বলুন, ফোনটা একটু কাছে ধরে।";
  const messageId = await logMessage({
    conversationId,
    userId: input.userId,
    role: "user",
    inputMode: "voice",
    body: null,
    audioSeconds: transcript?.seconds ?? null,
    ip: input.ip
  });
  await logMessage({
    conversationId,
    userId: input.userId,
    role: "assistant",
    inputMode: "voice",
    body: text,
    hedged: true,
    model: cfg.models.transcribe[0],
    latencyMs: Date.now() - started
  });
  await addUsage(input.userId, { transcribe_seconds: Math.round(transcript?.seconds ?? 0) });
  return {
    conversation_id: conversationId,
    message_id: messageId,
    transcript,
    refused: false,
    answer: { text, advice: null, caution: null, suggestions: [], sources: [] },
    // A farmer whose voice could not be transcribed is, more often than not,
    // the farmer who cannot type either — so "say it again" on its own is a
    // dead end for exactly the person this assistant exists for. A phone
    // number is the one escape hatch that does not require reading or writing.
    officer: await firstOfficer(input.userId),
    speech: { mode: "device", text, language: "bn-BD", rate: cfg.speechRate },
    asked_clarification: false,
    from_cache: false,
    entitlement,
    latency_ms: Date.now() - started
  };
}

async function recentTurns(conversationId: number | null, excludeId: number | null) {
  if (!conversationId) return [];
  const rows = await queryRows<Row>(
    `SELECT role, body, transcript FROM apa_messages
      WHERE conversation_id = ? AND id <> COALESCE(?, 0) AND body IS NOT NULL
      ORDER BY id DESC LIMIT 6`,
    [conversationId, excludeId]
  );
  return rows
    .reverse()
    .map((r) => ({
      role: String(r.role) === "user" ? ("user" as const) : ("assistant" as const),
      text: String(r.transcript ?? r.body ?? "").slice(0, 900)
    }))
    .filter((t) => t.text);
}

async function firstOfficer(userId: string): Promise<Row | null> {
  try {
    const officers = (await getAppOfficers(userId)) as Row[];
    const o = officers[0];
    if (!o) return null;
    return { name: o.name, phone: o.phone, role: o.officer_role, area: o.upazila ?? o.district ?? null };
  } catch {
    return null;
  }
}

/** What she grows, for the refusal's three suggestions. */
async function farmerCrops(userId: string): Promise<{ crops: string[]; livestock: boolean }> {
  try {
    const [farm] = await queryRows<Row>(
      "SELECT crop_types, livestock_count FROM app_user_farm WHERE user_id = ? LIMIT 1",
      [userId]
    );
    const raw = String(farm?.crop_types ?? "");
    const crops = raw
      .split(/[,|/]/)
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 2);
    return { crops, livestock: Number(farm?.livestock_count ?? 0) > 0 };
  } catch {
    return { crops: [], livestock: false };
  }
}

export { resolveEntitlement, assertApaAccess } from "@/lib/apa/entitlement";
export { apaConfig } from "@/lib/apa/config";
