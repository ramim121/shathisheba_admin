import { GoogleGenAI } from "@google/genai";

// Lightweight Gemini wrapper used for community-post moderation.
// The API key lives in .env.local as GEMINI_API_KEY (server-only).

// Matches the model the mobile app uses with this API key. gemini-2.0-flash is
// not available on this key's free tier (returns quota limit 0).
const MODEL = "gemma-4-31b-it";

export type AiFlag = "safe" | "review" | "remove";

export type AiModeration = {
  flag: AiFlag;
  reason: string;
  categories: string[];
};

export function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function coerceFlag(value: unknown): AiFlag {
  const v = String(value ?? "").toLowerCase();
  if (v === "remove" || v === "review" || v === "safe") return v;
  return "review";
}

function parseModeration(raw: string): AiModeration {
  let text = (raw ?? "").trim();
  // Strip ```json fences if the model adds them despite JSON mime type.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const brace = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (brace !== -1 && end !== -1) text = text.slice(brace, end + 1);
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    return {
      flag: coerceFlag(json.flag),
      reason: String(json.reason ?? "").slice(0, 480) || "No reason provided.",
      categories: Array.isArray(json.categories) ? json.categories.map((c) => String(c)).slice(0, 8) : []
    };
  } catch {
    return { flag: "review", reason: "Could not parse AI response; flagged for manual review.", categories: [] };
  }
}

export async function moderatePostText(body: string): Promise<AiModeration> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured on the server.");

  const content = (body ?? "").trim();
  if (!content) return { flag: "safe", reason: "Empty post — nothing to moderate.", categories: [] };

  const ai = new GoogleGenAI({ apiKey: key });
  const prompt = `You are a content moderator for "Shathi Sheba", a Bangladeshi agriculture community app used by farmers. Posts may be in Bangla or English.
Classify the POST and respond with STRICT JSON only, no prose:
{"flag":"safe|review|remove","reason":"<=20 words","categories":["spam","harassment","hate","violence","sexual","scam","misinformation","off_topic"]}
Guidance:
- "remove": clearly abusive, hateful, sexual, violent, fraud/scam, or obvious spam.
- "review": borderline, aggressive, possible misinformation, or clearly off-topic for a farming community.
- "safe": normal farming/community discussion.
POST:
"""${content.slice(0, 1500)}"""`;

  // Note: no responseMimeType — Gemma models reject JSON mime config. The
  // prompt asks for strict JSON and parseModeration extracts it defensively.
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { temperature: 0 }
  });

  return parseModeration(res.text ?? "");
}
