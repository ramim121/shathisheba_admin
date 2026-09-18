import { executeQuery, queryRows } from "@/lib/db";
import { RateLimitError } from "@/lib/errors";
import { resolveImage } from "@/lib/ai-assist";
import { genai, isApaConfigured, parseJson, retrying, friendlyModelError, isOurError } from "@/lib/apa/client";
import { apaConfig } from "@/lib/apa/config";
import { speak } from "@/lib/apa/tts";
import { addUsage, estimateAskCost } from "@/lib/apa/quota";

/**
 * The three AI features the phone had that are not Shathi Apa.
 *
 * Deleting `EXPO_PUBLIC_GEMINI_API_KEY` from the app was never only about the
 * assistant. The same compiled-in key powered the listing description writer,
 * the cattle photo reader and the training-article summariser, and read every
 * answer aloud. Remove the key and those break; leave the key and the whole
 * exercise was pointless. So they move here too.
 *
 * These are not gated by the Apa entitlement — they are existing features of
 * screens a farmer already has, and putting a KYC wall in front of "describe
 * my cow for the listing" would be a product change nobody asked for. They are
 * rate limited, logged and costed like everything else.
 */

type Row = Record<string, unknown>;

/** Anything here is a real Gemini call, so it gets a ceiling per farmer. */
const PER_MINUTE = 8;
const PER_DAY = 200;

async function guard(userId: string, task: string): Promise<void> {
  if (!isApaConfigured()) throw new Error("AI help is not configured on this server.");
  if (!userId) throw new Error("user_id is required.");
  const [counts] = await queryRows<Row>(
    `SELECT
       SUM(created_at > NOW() - INTERVAL 1 MINUTE) AS last_minute,
       SUM(created_at > NOW() - INTERVAL 1 DAY) AS last_day
     FROM apa_tool_calls
     WHERE user_id = ? AND tool LIKE 'app_ai:%' AND created_at > NOW() - INTERVAL 1 DAY`,
    [userId]
  );
  if (Number(counts?.last_minute ?? 0) >= PER_MINUTE) {
    throw new RateLimitError("একটু ধীরে — আগেরটা এখনো চলছে।", 15);
  }
  if (Number(counts?.last_day ?? 0) >= PER_DAY) {
    throw new RateLimitError("আজকের সীমা শেষ। কাল আবার চেষ্টা করুন।", 3600);
  }
  // Logged before the call rather than after, so a request that hangs still
  // counts against the ceiling it was meant to be held by.
  await executeQuery(
    "INSERT INTO apa_tool_calls (user_id, tool, ok) VALUES (?, ?, 1)",
    [userId, `app_ai:${task}`.slice(0, 60)]
  );
}

async function generate(model: string, parts: unknown[], json: boolean, temperature = 0.4): Promise<string> {
  const res = await retrying(() =>
    genai().models.generateContent({
      model,
      contents: [{ role: "user", parts: parts as never }],
      config: json ? { temperature, responseMimeType: "application/json" } : { temperature }
    })
  );
  return res.text ?? "";
}

const langLine = (lang: string) =>
  lang === "en" ? "Reply in plain English." : "Reply in natural Bangla a farmer would use.";

/* ---------------------------------------------------------------------------
   1. Read the answer aloud
   --------------------------------------------------------------------------- */

/**
 * Used by every screen with a speaker button, not only the assistant — the
 * training article, the market update, the loan decision. Returns a WAV the
 * phone writes to a file and plays.
 */
export async function appSpeak(payload: Row) {
  const userId = String(payload.user_id ?? "");
  try {
    await guard(userId, "speak");
    const cfg = await apaConfig();
    const text = String(payload.text ?? "").trim();
    if (!text) throw new Error("There is nothing to read out.");

    const spoken = await speak({
      text,
      model: cfg.models.tts,
      voice: cfg.voiceName,
      maxChars: cfg.ttsMaxChars
    });
    if (!spoken) {
      // Deliberately not an error: the text is already on her screen. The app
      // hides the speaker button rather than showing a failure.
      return { audio: null, reason: text.length > cfg.ttsMaxChars ? "too_long" : "unavailable" };
    }
    await addUsage(userId, {
      tts_chars: spoken.chars,
      est_cost_usd: estimateAskCost({ promptChars: 0, answerChars: 0, ttsChars: spoken.chars })
    });
    return {
      audio: spoken.audio,
      mime_type: spoken.mimeType,
      sample_rate: spoken.sampleRate,
      chars: spoken.chars
    };
  } catch (error) {
    throw translate(error);
  }
}

/* ---------------------------------------------------------------------------
   2. Summarise a training article
   --------------------------------------------------------------------------- */

export async function appSummarize(payload: Row) {
  const userId = String(payload.user_id ?? "");
  try {
    await guard(userId, "summarize");
    const cfg = await apaConfig();
    const source = String(payload.text ?? "").trim();
    if (!source) throw new Error("There is nothing to summarise.");
    const lang = payload.lang === "en" ? "en" : "bn";

    const text = await generate(
      cfg.models.text,
      [
        {
          text: [
            "Summarise this Shathi Sheba farm training content for a smallholder farmer in Bangladesh.",
            "One short introductory line, then at most five bullet points of the practical takeaways.",
            "Use only what the content says. Never add a figure, a dose or a date that is not in it.",
            langLine(lang),
            "",
            `CONTENT:\n${source.slice(0, 12000)}`
          ].join("\n")
        }
      ],
      false,
      0.3
    );

    await addUsage(userId, {
      est_cost_usd: estimateAskCost({ promptChars: source.length, answerChars: text.length })
    });
    return { text: text.trim() };
  } catch (error) {
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
  try {
    await guard(userId, "listing_description");
    const cfg = await apaConfig();
    const image = await resolveImage(String(payload.image ?? payload.image_url ?? ""));
    const kind = payload.kind === "inputs" ? "inputs" : "livestock";
    const lang = payload.lang === "en" ? "en" : "bn";
    const context = String(payload.context ?? "").trim();

    const rules =
      kind === "livestock"
        ? "The photo MUST clearly show a farm animal: cow, bull, buffalo, goat, sheep or poultry. If it does not, reply with EXACTLY the single token NOT_RELEVANT and nothing else. If it does, write a marketplace sale description in two to four plain sentences — no markdown, no headings — covering the animal type, its visible condition and its approximate size."
        : "The photo MUST clearly show an agricultural input for sale: seed, animal feed or fertiliser. If it does not, reply with EXACTLY the single token NOT_RELEVANT and nothing else. If it does, write a marketplace sale description in two to four plain sentences — no markdown, no headings — covering the input type, its visible quality and its approximate quantity or packaging.";

    const text = await generate(
      cfg.models.vision,
      [
        { inlineData: { mimeType: image.mimeType, data: image.data } },
        {
          text: [
            "You are Shathi Apa, writing a short marketplace description for a Bangladeshi farmer app.",
            rules,
            context ? `Where it fits, use these seller-given details: ${context.slice(0, 400)}.` : "",
            "Be factual. Never invent a price, a weight you cannot see, or a guarantee.",
            langLine(lang)
          ]
            .filter(Boolean)
            .join("\n")
        }
      ],
      false,
      0.4
    );

    await addUsage(userId, {
      photo_count: 1,
      est_cost_usd: estimateAskCost({ promptChars: 4000, answerChars: text.length })
    });
    return { text: text.trim() };
  } catch (error) {
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
  try {
    await guard(userId, "analyze_photo");
    const cfg = await apaConfig();
    const image = await resolveImage(String(payload.image ?? payload.image_url ?? ""));
    const lang = payload.lang === "en" ? "en" : "bn";

    const raw = await generate(
      cfg.models.vision,
      [
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
      ],
      true,
      0.2
    );

    const parsed = parseJson<Partial<CattleRead>>(raw, {});
    await addUsage(userId, {
      photo_count: 1,
      est_cost_usd: estimateAskCost({ promptChars: 4000, answerChars: raw.length })
    });
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
    throw translate(error);
  }
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
