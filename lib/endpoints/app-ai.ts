import { executeQuery, queryRows } from "@/lib/db";
import { RateLimitError } from "@/lib/errors";
import { resolveImage } from "@/lib/ai-assist";
import { genai, isApaConfigured, parseJson, friendlyModelError, isOurError } from "@/lib/apa/client";
import { apaConfig, apaPrompt, type ApaConfig } from "@/lib/apa/config";
import { runWithChain, thinkingFor, usageOf } from "@/lib/apa/models";
import { speak } from "@/lib/apa/tts";
import { addUsage } from "@/lib/apa/quota";
import { costOf, speakable } from "@/lib/apa/pure";

/**
 * The three AI features the phone had that are not Shathi Apa, plus read-aloud.
 *
 * Deleting `EXPO_PUBLIC_GEMINI_API_KEY` from the app was never only about the
 * assistant. The same compiled-in key powered the listing description writer,
 * the cattle photo reader and the training-article summariser, and read every
 * answer aloud. Remove the key and those break; leave the key and the whole
 * exercise was pointless. So they moved here too.
 *
 * Read-aloud has since moved again — to the phone. `/app/ai/speak` no longer
 * takes arbitrary text:
 *
 *   Before, it accepted any string and synthesised it. At $20 per 1M output
 *   tokens and eight calls a minute allowed, one token holder could spend about
 *   $0.19 a minute — $270 a day — turning our Gemini account into a free
 *   text-to-speech service. The rate limit bounded it; the ceiling was far too
 *   high for something whose only job is "read this answer out".
 *
 *   Now it takes an id — a message of hers, or a training content row — looks
 *   the text up server-side, and caches the audio by content hash. There is
 *   nothing left to abuse and the same change turned on the speech cache.
 *
 * These are not gated by the Apa entitlement: they are existing features of
 * screens a farmer already has, and putting a KYC wall in front of "describe my
 * cow for the listing" would be a product change nobody asked for.
 */

type Row = Record<string, unknown>;

/** Anything here is a real Gemini call, so it gets a ceiling per farmer. */
const PER_MINUTE = 8;
const PER_DAY = 200;

async function guard(userId: string, task: string): Promise<number | null> {
  if (!isApaConfigured()) throw new Error("AI help is not configured on this server.");
  if (!userId) throw new Error("user_id is required.");
  const [counts] = await queryRows<Row>(
    `SELECT
       SUM(created_at > NOW() - INTERVAL 1 MINUTE) AS last_minute,
       SUM(created_at > NOW() - INTERVAL 1 DAY) AS last_day
     FROM apa_app_ai_calls
     WHERE user_id = ? AND created_at > NOW() - INTERVAL 1 DAY`,
    [userId]
  );
  if (Number(counts?.last_minute ?? 0) >= PER_MINUTE) {
    throw new RateLimitError("একটু ধীরে — আগেরটা এখনো চলছে।", 15);
  }
  if (Number(counts?.last_day ?? 0) >= PER_DAY) {
    throw new RateLimitError("আজকের সীমা শেষ। কাল আবার চেষ্টা করুন।", 3600);
  }
  // Logged before the call rather than after, so a request that hangs still
  // counts against the ceiling it was meant to be held by. `ok` is left NULL
  // until the outcome is known — the old version wrote 1 up front and never
  // corrected it, which left the console's failure column structurally blank.
  try {
    const res = await executeQuery(
      "INSERT INTO apa_app_ai_calls (user_id, task) VALUES (?, ?)",
      [userId, task.slice(0, 40)]
    );
    return Number((res as { insertId?: number }).insertId ?? 0) || null;
  } catch {
    return null;
  }
}

async function settle(id: number | null, patch: {
  ok: boolean;
  model?: string;
  error?: string | null;
  charsIn?: number;
  charsOut?: number;
  cost?: number;
  latencyMs?: number;
  fromCache?: boolean;
}) {
  if (!id) return;
  try {
    await executeQuery(
      `UPDATE apa_app_ai_calls
          SET ok = ?, model = ?, error = ?, chars_in = ?, chars_out = ?,
              est_cost_usd = ?, latency_ms = ?, from_cache = ?
        WHERE id = ?`,
      [
        patch.ok ? 1 : 0,
        patch.model?.slice(0, 80) ?? null,
        patch.error?.slice(0, 255) ?? null,
        patch.charsIn ?? 0,
        patch.charsOut ?? 0,
        patch.cost ?? 0,
        patch.latencyMs ?? null,
        patch.fromCache ? 1 : 0,
        id
      ]
    );
  } catch {
    /* accounting must never take a feature down with it */
  }
}

async function generate(input: {
  chain: string[];
  job: "answer" | "vision";
  parts: unknown[];
  json: boolean;
  temperature?: number;
}): Promise<{ text: string; model: string; cost: number }> {
  const attempt = await runWithChain({
    job: input.job,
    chain: input.chain,
    call: async (model) => {
      const res = await genai().models.generateContent({
        model,
        contents: [{ role: "user", parts: input.parts as never }],
        config: {
          temperature: input.temperature ?? 0.4,
          ...thinkingFor(model),
          ...(input.json ? { responseMimeType: "application/json" } : {})
        } as never
      });
      return { value: res, usage: usageOf(res) };
    }
  });
  const usage = usageOf(attempt.result);
  return {
    text: attempt.result.text ?? "",
    model: attempt.model,
    cost: costOf({
      model: attempt.model,
      tokensIn: usage.tokensIn ?? 0,
      tokensOut: usage.tokensOut ?? 0,
      cachedTokens: usage.cachedTokens ?? 0
    })
  };
}

const langLine = (lang: string) =>
  lang === "en" ? "Reply in plain English." : "Reply in natural Bangla a farmer would use.";

/* ---------------------------------------------------------------------------
   1. Read the answer aloud
   --------------------------------------------------------------------------- */

export type SpeakResult =
  | { mode: "device"; text: string; language: string; rate: string }
  | { mode: "server"; url: string; mime_type: string; sample_rate: number; seconds: number | null; peaks: number[] | null; from_cache: boolean }
  | { mode: "none"; reason: string };

/**
 * Speak a piece of text the server can look up for itself.
 *
 * Takes an id, never free text. `source` says which table to read:
 *   - `apa_message`   — one of her own assistant answers
 *   - `learning`      — a training article or its summary
 *   - `market_update` — a market bulletin
 */
export async function appSpeak(payload: Row): Promise<SpeakResult> {
  const userId = String(payload.user_id ?? "");
  const id = await guard(userId, "speak");
  const started = Date.now();
  try {
    const cfg = await apaConfig();
    const text = await lookupText(userId, String(payload.source ?? "apa_message"), String(payload.id ?? ""));
    if (!text) {
      await settle(id, { ok: false, error: "nothing to read" });
      return { mode: "none", reason: "not_found" };
    }

    // The phone's own engine is the default: free, instant, offline, and no
    // 300 KB of WAV down a 2G connection. Only a handset with no Bangla voice
    // installed asks for the server, and it says so with `needs_server`.
    const wantsServer = cfg.ttsMode === "server" || (payload.needs_server === true && cfg.ttsMode !== "device");
    if (!wantsServer) {
      await settle(id, { ok: true, model: "device", charsIn: text.length, latencyMs: Date.now() - started });
      await addUsage(userId, { speech_device: 1 });
      return {
        mode: "device",
        text: speakable(text),
        language: payload.lang === "en" ? "en-US" : "bn-BD",
        rate: cfg.speechRate
      };
    }

    const spoken = await speak({
      text,
      models: cfg.models.tts,
      voice: cfg.voiceName,
      rate: cfg.speechRate,
      maxChars: cfg.ttsMaxChars,
      origin: String(payload.origin ?? process.env.SELF_ORIGIN ?? "http://127.0.0.1:3000"),
      cacheEnabled: cfg.speechCacheEnabled
    });

    if (!spoken) {
      // Deliberately not an error: the text is already on her screen, and the
      // phone can still read it out itself.
      await settle(id, { ok: true, model: "device", charsIn: text.length, latencyMs: Date.now() - started });
      return { mode: "device", text: speakable(text), language: "bn-BD", rate: cfg.speechRate };
    }

    const cost = spoken.fromCache
      ? 0
      : costOf({
          model: spoken.model,
          tokensIn: Math.ceil(spoken.chars / 4),
          tokensOut: Math.ceil((spoken.seconds ?? 0) * 25)
        });
    await settle(id, {
      ok: true,
      model: spoken.model,
      charsIn: spoken.chars,
      cost,
      latencyMs: Date.now() - started,
      fromCache: spoken.fromCache
    });
    await addUsage(userId, {
      speech_server: 1,
      tts_chars: spoken.fromCache ? 0 : spoken.chars,
      est_cost_usd: cost
    });
    return {
      mode: "server",
      url: spoken.url,
      mime_type: spoken.mimeType,
      sample_rate: spoken.sampleRate,
      seconds: spoken.seconds,
      // The clip's real envelope, so the playbar can swap its placeholder
      // shape for the true one on the same frame the audio arrives.
      peaks: spoken.peaks,
      from_cache: spoken.fromCache
    };
  } catch (error) {
    await settle(id, { ok: false, error: error instanceof Error ? error.message : "failed" });
    throw translate(error);
  }
}

/**
 * Where the text comes from, by id.
 *
 * Ownership is in the WHERE clause for anything personal: an assistant answer
 * is only readable by the farmer it was written for.
 */
async function lookupText(userId: string, source: string, id: string): Promise<string> {
  // The opening greeting. Identical for every farmer, so it is synthesised once
  // and served from the speech cache thereafter — one Gemini call for the whole
  // platform, forever, rather than the phone's own voice reading it.
  //
  // It is also the one piece of spoken text that was wrong before: with no
  // server source it fell through to the device engine, whose default voice on
  // most handsets is male. A farmer told she is talking to Shathi Apa and
  // greeted by a man is not hearing a different voice, she is hearing a
  // different person.
  if (source === "intro") {
    return String((await apaPrompt("intro_bn")) ?? "");
  }
  if (!id) return "";
  if (source === "apa_message") {
    const [row] = await queryRows<Row>(
      `SELECT body, advice FROM apa_messages
        WHERE id = ? AND user_id = ? AND role = 'assistant' LIMIT 1`,
      [id, userId]
    );
    if (!row) return "";
    return [row.body, row.advice].filter(Boolean).map(String).join(". ");
  }
  if (source === "learning") {
    const [row] = await queryRows<Row>(
      "SELECT title_bn, title_en, body_bn, body_en FROM learning_contents WHERE id = ? LIMIT 1",
      [id]
    );
    if (!row) return "";
    return [row.title_bn ?? row.title_en, row.body_bn ?? row.body_en].filter(Boolean).map(String).join(". ");
  }
  if (source === "market_update") {
    const [row] = await queryRows<Row>(
      "SELECT title_bn, title_en, body_bn, body_en, detail_bn, detail_en FROM market_updates WHERE id = ? LIMIT 1",
      [id]
    );
    if (!row) return "";
    return [row.title_bn ?? row.title_en, row.body_bn ?? row.body_en, row.detail_bn ?? row.detail_en]
      .filter(Boolean).map(String).join(". ");
  }
  return "";
}

/* ---------------------------------------------------------------------------
   2. Summarise a training article
   --------------------------------------------------------------------------- */

export async function appSummarize(payload: Row) {
  const userId = String(payload.user_id ?? "");
  const id = await guard(userId, "summarize");
  const started = Date.now();
  try {
    const cfg = await apaConfig();
    const source = String(payload.text ?? "").trim();
    if (!source) throw new Error("There is nothing to summarise.");
    const lang = payload.lang === "en" ? "en" : "bn";

    const out = await generate({
      chain: cfg.models.text,
      job: "answer",
      json: false,
      temperature: 0.3,
      parts: [
        {
          text: [
            "Summarise this Shathi Sheba farm training content for a smallholder farmer in Bangladesh.",
            "One short introductory line, then at most five bullet points of the practical takeaways.",
            "Use only what the content says. Never add a figure, a dose or a date that is not in it.",
            "Never give a pesticide or medicine dose even if the content does — point at the upazila officer instead.",
            langLine(lang),
            "",
            `CONTENT:\n${source.slice(0, 12000)}`
          ].join("\n")
        }
      ]
    });

    await settle(id, {
      ok: true, model: out.model, charsIn: source.length, charsOut: out.text.length,
      cost: out.cost, latencyMs: Date.now() - started
    });
    await addUsage(userId, { est_cost_usd: out.cost });
    return { text: out.text.trim() };
  } catch (error) {
    await settle(id, { ok: false, error: error instanceof Error ? error.message : "failed" });
    throw translate(error);
  }
}

/* ---------------------------------------------------------------------------
   3. Write a listing description from the photo
   --------------------------------------------------------------------------- */

/**
 * `NOT_RELEVANT` is kept exactly as the phone already expects it. The screen
 * branches on that token to tell the farmer her photo is not of an animal, and
 * changing the contract here would silently break that branch.
 */
export async function appListingDescription(payload: Row) {
  const userId = String(payload.user_id ?? "");
  const id = await guard(userId, "listing_description");
  const started = Date.now();
  try {
    const cfg = await apaConfig();
    const image = await resolveImage(String(payload.image ?? payload.image_url ?? ""));
    const kind = payload.kind === "inputs" ? "inputs" : "livestock";
    const lang = payload.lang === "en" ? "en" : "bn";
    const context = String(payload.context ?? "").trim();

    const rules =
      kind === "livestock"
        ? "The photo MUST clearly show a farm animal: cow, bull, buffalo, goat, sheep or poultry. If it does not, reply with EXACTLY the single token NOT_RELEVANT and nothing else. If it does, write a marketplace sale description in two to four plain sentences — no markdown, no headings — covering the animal type, its visible condition and its approximate size."
        : "The photo MUST clearly show an agricultural input for sale: seed, animal feed or fertiliser. If it does not, reply with EXACTLY the single token NOT_RELEVANT and nothing else. If it does, write a marketplace sale description in two to four plain sentences — no markdown, no headings — covering the input type, its visible quality and its approximate quantity or packaging.";

    const out = await generate({
      chain: cfg.models.vision,
      job: "vision",
      json: false,
      parts: [
        { inlineData: { mimeType: image.mimeType, data: image.data } },
        {
          text: [
            "You are Shathi Apa, writing a short marketplace description for a Bangladeshi farmer app.",
            rules,
            context ? `Where it fits, use these seller-given details: ${context.slice(0, 400)}.` : "",
            "Be factual. Never invent a price, a weight you cannot see, or a guarantee.",
            langLine(lang)
          ].filter(Boolean).join("\n")
        }
      ]
    });

    await settle(id, {
      ok: true, model: out.model, charsIn: 4000, charsOut: out.text.length,
      cost: out.cost, latencyMs: Date.now() - started
    });
    await addUsage(userId, { photo_count: 1, est_cost_usd: out.cost });
    return { text: out.text.trim() };
  } catch (error) {
    await settle(id, { ok: false, error: error instanceof Error ? error.message : "failed" });
    throw translate(error);
  }
}

/* ---------------------------------------------------------------------------
   4. Read a cattle photo into the listing form
   --------------------------------------------------------------------------- */

export type CattleRead = {
  isCow: boolean;
  ageMonths: number | null;
  weightKg: number | null;
  animalType: string | null;
  breed: string | null;
  count: number | null;
  healthSummary: string;
  accuracyPercent: number;
};

export async function appAnalyzePhoto(payload: Row) {
  const userId = String(payload.user_id ?? "");
  const id = await guard(userId, "analyze_photo");
  const started = Date.now();
  try {
    const cfg = await apaConfig();
    const image = await resolveImage(String(payload.image ?? payload.image_url ?? ""));
    const lang = payload.lang === "en" ? "en" : "bn";

    const out = await generate({
      chain: cfg.models.vision,
      job: "vision",
      json: true,
      temperature: 0.2,
      parts: [
        { inlineData: { mimeType: image.mimeType, data: image.data } },
        {
          text: [
            "Read this photograph for a cattle sale listing in Bangladesh. Judge only this image; ignore anything you have seen before.",
            "Return strict JSON with exactly these keys:",
            '{"isCow":true,"ageMonths":null,"weightKg":null,"animalType":null,"breed":null,"count":null,"healthSummary":"","accuracyPercent":0}',
            "Rules:",
            "- A wrong weight becomes a wrong price. Use null for anything you cannot see clearly rather than guessing.",
            "- If the image is not clearly cattle, set isCow false, leave the cattle fields null, set a low accuracyPercent, and say so in healthSummary.",
            "- accuracyPercent is your own confidence, 0 to 100.",
            `- healthSummary ${lang === "en" ? "in plain English" : "in natural Bangla"}, one or two sentences.`
          ].join("\n")
        }
      ]
    });

    const parsed = parseJson<Partial<CattleRead>>(out.text, {});
    await settle(id, {
      ok: true, model: out.model, charsIn: 4000, charsOut: out.text.length,
      cost: out.cost, latencyMs: Date.now() - started
    });
    await addUsage(userId, { photo_count: 1, est_cost_usd: out.cost });
    return {
      isCow: parsed.isCow === true,
      ageMonths: numberOrNull(parsed.ageMonths),
      weightKg: numberOrNull(parsed.weightKg),
      animalType: parsed.animalType ? String(parsed.animalType) : null,
      breed: parsed.breed ? String(parsed.breed) : null,
      count: numberOrNull(parsed.count),
      healthSummary: String(parsed.healthSummary ?? ""),
      accuracyPercent: Number(parsed.accuracyPercent ?? 0) || 0
    } satisfies CattleRead;
  } catch (error) {
    await settle(id, { ok: false, error: error instanceof Error ? error.message : "failed" });
    throw translate(error);
  }
}

/** What the app needs to know about speech before it plays anything. */
export async function appSpeechConfig(): Promise<Row> {
  const cfg: ApaConfig = await apaConfig();
  return {
    mode: cfg.ttsMode,
    // The greeting, so the chat renders exactly the string that will be spoken.
    // Held server-side because it has to match byte for byte: the speech cache
    // is keyed on the text, and a greeting that differed by a full stop would
    // synthesise a second clip for every farmer.
    intro: String((await apaPrompt("intro_bn")) ?? ""),
    // The phone checks its own installed voices against this and reports back
    // through `needs_server` when it has none.
    preferred_language: "bn-BD",
    fallback_languages: ["bn-IN", "bn"],
    rate: cfg.speechRate,
    max_chars: cfg.ttsMaxChars,
    server_available: cfg.ttsMode !== "device",
    // The photo budget rides along on the same call. It belongs to the server
    // because the server is what pays for the tokens a large photo costs, and
    // the right number is something real photographs will teach us — not
    // something to guess once and freeze into an APK.
    image_max_px: cfg.imageMaxPx
  };
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Our own refusals and validation pass through; a model failure gets a sentence. */
function translate(error: unknown): unknown {
  if (isOurError(error)) return error;
  const message = error instanceof Error ? error.message : "";
  if (message && !/^\{|Gemini |GoogleGenerativeAI/.test(message) && message.length < 160) return error;
  return friendlyModelError(error);
}
