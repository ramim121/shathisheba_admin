import { queryRows } from "@/lib/db";
import { resolveImage } from "@/lib/ai-assist";
import { getAppOfficers } from "@/lib/app-endpoints";
import { apaConfig, apaPrompt } from "@/lib/apa/config";
import { friendlyModelError, isApaConfigured, isOurError } from "@/lib/apa/client";
import { classifyScope, refusalSuggestions } from "@/lib/apa/classify";
import {
  assertApaAccess,
  resolveEntitlement,
  spendTrialQuestion,
  type ApaEntitlement
} from "@/lib/apa/entitlement";
import {
  attachScopeMessage,
  attachToolMessage,
  logMessage,
  nameConversation,
  openConversation
} from "@/lib/apa/log";
import { addUsage, assertAskRate, estimateAskCost } from "@/lib/apa/quota";
import { answer, type ApaAnswer } from "@/lib/apa/reason";
import { speak } from "@/lib/apa/tts";
import { transcribeAudio } from "@/lib/apa/transcribe";

/**
 * One question, end to end.
 *
 * The order below is the whole security and cost story of this feature, and it
 * is deliberate:
 *
 *   entitlement → rate limit → transcribe → scope → answer → speak → log
 *
 * Entitlement first, because a locked farmer must cost nothing at all — not a
 * transcription, not a classification. Scope before the answering model,
 * because a refusal that happens *inside* the answering model has already paid
 * for the answer. And the trial counter is spent last, only once an answer
 * actually exists, so a failure or a refusal never costs her one of her five.
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
  /** Ask for the answer read aloud even when it was typed. */
  speakAnswer?: boolean;
  ip?: string | null;
};

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
  audio: { data: string; mimeType: string; sample_rate: number } | null;
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
  const entitlement = await assertApaAccess(input.userId, FEATURE[input.mode], cfg);
  await assertAskRate(input.userId, cfg);

  const [profile] = await queryRows<Row>(
    `SELECT u.district_id, d.name_bn AS district_bn, d.name_en AS district_en,
            z.name_bn AS upazila_bn, z.name_en AS upazila_en
       FROM app_users u
       LEFT JOIN geo_districts d ON d.id = u.district_id
       LEFT JOIN geo_upazilas z ON z.id = u.upazila_id
      WHERE u.id = ? LIMIT 1`,
    [input.userId]
  );
  const districtName = (profile?.district_bn ?? profile?.district_en ?? null) as string | null;
  const upazilaName = (profile?.upazila_bn ?? profile?.upazila_en ?? null) as string | null;

  const conversationId =
    input.conversationId ??
    (await openConversation({
      userId: input.userId,
      path: "ask",
      districtId: (profile?.district_id as string | null) ?? null
    }));

  /* --- what she said ---------------------------------------------------- */

  let question = String(input.text ?? "").trim();
  let transcript: AskResult["transcript"] = null;
  let transcribeSeconds = 0;

  if (input.mode === "voice") {
    if (!input.audio?.data) throw new Error("No audio was received.");
    const heard = await transcribeAudio({
      data: input.audio.data,
      mimeType: input.audio.mimeType,
      model: cfg.models.transcribe
    });
    transcribeSeconds = heard.seconds;
    transcript = { text: heard.text, seconds: heard.seconds, ok: heard.ok };
    question = heard.text;

    // The clip is never lost because the transcription was (SRS G1). The app
    // keeps her recording and offers it back; this only tells it to.
    if (!heard.ok) {
      const messageId = await logMessage({
        conversationId,
        userId: input.userId,
        role: "user",
        inputMode: "voice",
        body: null,
        audioSeconds: heard.seconds,
        ip: input.ip
      });
      await logMessage({
        conversationId,
        userId: input.userId,
        role: "assistant",
        inputMode: "voice",
        body: "বুঝতে পারিনি। আরেকবার বলুন, ফোনটা একটু কাছে ধরে।",
        refused: false,
        hedged: true,
        model: cfg.models.transcribe,
        latencyMs: Date.now() - started
      });
      await addUsage(input.userId, { transcribe_seconds: Math.round(heard.seconds) });
      return {
        conversation_id: conversationId,
        message_id: messageId,
        transcript,
        refused: false,
        answer: {
          text: "বুঝতে পারিনি। আরেকবার বলুন, ফোনটা একটু কাছে ধরে।",
          advice: null,
          caution: null,
          suggestions: [],
          sources: []
        },
        officer: null,
        audio: null,
        entitlement,
        latency_ms: Date.now() - started
      };
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

  /* --- is it ours to answer --------------------------------------------- */

  const scope = await classifyScope({
    text: question,
    userId: input.userId,
    model: cfg.models.classify,
    hasImage: Boolean(image)
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
      audio: null,
      entitlement: await resolveEntitlement(input.userId, cfg),
      latency_ms: Date.now() - started
    };
  }

  /* --- the answer -------------------------------------------------------- */

  const history = await recentTurns(conversationId, userMessageId);
  const result = await answer({
    question,
    model: image ? cfg.models.vision : cfg.models.text,
    ctx: { userId: input.userId, districtName, upazilaName },
    history,
    image
  });

  const officer = result.needs_officer ? await firstOfficer(input.userId) : null;

  /* --- read it aloud ----------------------------------------------------- */

  // Voice in, voice out, without being asked. Typed questions get a speaker
  // button instead — reading an answer aloud to someone sitting in a room with
  // other people is not a kindness (SRS V1).
  const shouldSpeak =
    entitlement.features.read_aloud &&
    (input.speakAnswer === true || (cfg.autoplayVoice && input.mode !== "text"));

  let audio: AskResult["audio"] = null;
  let ttsChars = 0;
  if (shouldSpeak && result.text) {
    try {
      const spoken = await speak({
        text: [result.text, result.advice?.body, result.caution].filter(Boolean).join(". "),
        model: cfg.models.tts,
        voice: cfg.voiceName,
        maxChars: cfg.ttsMaxChars
      });
      if (spoken) {
        audio = { data: spoken.audio, mimeType: spoken.mimeType, sample_rate: spoken.sampleRate };
        ttsChars = spoken.chars;
      }
    } catch (error) {
      // The text answer is still on screen and still correct. Losing the audio
      // is a degraded answer, not a failed one.
      console.error("apa tts failed", error);
    }
  }

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
    ip: input.ip
  });
  await attachToolMessage(input.userId, messageId);

  await addUsage(input.userId, {
    ask_count: 1,
    voice_count: input.mode === "voice" ? 1 : 0,
    photo_count: input.mode === "photo" ? 1 : 0,
    tool_calls: result.tools_used.length,
    transcribe_seconds: Math.round(transcribeSeconds),
    tts_chars: ttsChars,
    est_cost_usd: estimateAskCost({
      promptChars: question.length + (image ? 4000 : 0),
      answerChars: result.text.length,
      transcribeSeconds,
      ttsChars
    })
  });

  if (entitlement.tier === "trial") await spendTrialQuestion(input.userId);

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
    audio,
    // Resolved again rather than reused: the trial counter has moved, and the
    // app renders its "৪টি প্রশ্ন বাকি" pill straight from this.
    entitlement: await resolveEntitlement(input.userId, cfg),
    latency_ms: Date.now() - started
  };
}

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

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
