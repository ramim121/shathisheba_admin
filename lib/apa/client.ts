import { GoogleGenAI } from "@google/genai";
import { retrySeconds } from "@/lib/apa/pure";
import { geminiKey, isGeminiKeyConfigured } from "@/lib/gemini-key";

/**
 * The Gemini key, resolved by `lib/gemini-key.ts` — see there for why two
 * variable names exist during a rotation.
 *
 * It used to be read in the phone — `EXPO_PUBLIC_GEMINI_API_KEY`, compiled into
 * every installed APK, extractable with `unzip` and `strings`. A key taken out
 * of an APK carries no scope restriction, no quota and no owner, so the first
 * person to find it got an unmetered Gemini account on our invoice. Server-side
 * is not a refinement of that design; it is the only version of it that can be
 * shipped.
 */

export function apaKey(): string {
  return geminiKey();
}

export function isApaConfigured(): boolean {
  return isGeminiKeyConfigured();
}

let cached: GoogleGenAI | null = null;

export function genai(): GoogleGenAI {
  if (!cached) cached = new GoogleGenAI({ apiKey: apaKey() });
  return cached;
}

const BASE = "https://generativelanguage.googleapis.com";

/**
 * A direct REST call, for the two things the SDK does not surface.
 *
 * `v1alpha/auth_tokens` (ephemeral live tokens) and the transcription config
 * are both newer than the typed surface of @google/genai 2.2. Rather than wait
 * for the types or reach into the SDK's internals, these two go over the wire
 * as documented — and the shapes below were each verified against the live API
 * before being written down, not inferred from documentation.
 */
export async function apaRest<T>(
  path: string,
  body: unknown,
  init?: { timeoutMs?: number }
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${BASE}/${path.replace(/^\//, "")}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apaKey() },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    if (!res.ok) {
      // Google's error body is JSON with a useful message inside; surfacing the
      // raw text makes a 400 debuggable instead of "request failed".
      throw new Error(`Gemini ${path} ${res.status}: ${text.slice(0, 400)}`);
    }
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Models occasionally wrap JSON in prose or a fence despite the mime type. */
export function parseJson<T>(raw: string, fallback: T): T {
  let text = (raw ?? "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open !== -1 && close !== -1) text = text.slice(open, close + 1);
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/* ---------------------------------------------------------------------------
   Turning a model failure into something a farmer can read
   --------------------------------------------------------------------------- */

/**
 * Google's failures arrive as a JSON blob: `{"error":{"code":429,"message":"You
 * exceeded your current quota, please check your plan and billing details…"}}`.
 * That reached the phone verbatim during the first end-to-end run — English,
 * with a billing URL in it, shown to a farmer who asked whether it would rain.
 *
 * The raw text still goes to the server log, where the person who can act on it
 * will see it. What comes back to the app is one sentence in Bangla, and a code
 * the app can branch on if it wants to offer a retry.
 */
export function friendlyModelError(
  error: unknown
): Error & { code?: string; retryAfterSeconds?: number } {
  const raw = error instanceof Error ? error.message : String(error);
  console.error("apa model call failed:", raw.slice(0, 600));

  const coded = (code: string, message: string, retryAfterSeconds?: number) =>
    Object.assign(new Error(message), { code, retryAfterSeconds });

  // Google says how long to wait. Passing it through is what lets the app count
  // down and re-enable its own retry button at the right moment, rather than
  // telling her "a minute" and hoping.
  const advised = retrySeconds(raw);
  const busyWait = advised === null ? 30 : Math.min(120, Math.max(5, Math.ceil(advised)));

  if (/\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota|rate.?limit/i.test(raw)) {
    return coded("apa_busy", "এখন অনেকে একসাথে প্রশ্ন করছেন। এক মিনিট পরে আবার চেষ্টা করুন।", busyWait);
  }
  if (/\b(503|500)\b|UNAVAILABLE|overloaded|high demand|INTERNAL/i.test(raw)) {
    return coded("apa_busy", "এখন একটু ব্যস্ত আছি। একটু পরে আবার চেষ্টা করুন।", 15);
  }
  if (/\b(401|403)\b|API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(raw)) {
    return coded("apa_unconfigured", "শাথী আপা এখন বন্ধ আছে। একটু পরে আবার দেখুন।");
  }
  if (/abort|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(raw)) {
    return coded("apa_timeout", "উত্তর আসতে দেরি হচ্ছে। আরেকবার চেষ্টা করুন।", 5);
  }
  return coded("apa_failed", "এখন উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।");
}

/**
 * One retry on the two failures that are genuinely transient.
 *
 * The key is on a free tier with a low per-minute allowance, so a single farmer
 * asking two questions in quick succession can meet a 429 that would have
 * succeeded a second later. Retrying a quota error forever would be rude to
 * Google and useless to her; retrying it once is the difference between an
 * answer and an apology. Nothing else is retried — a bad request retried is a
 * bad request twice.
 */
export async function retrying<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const raw = error instanceof Error ? error.message : String(error);
      const transient = /(429|503|500)|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|high demand|INTERNAL/i.test(raw);
      if (!transient || i === attempts - 1) throw error;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw last;
}

/** True for our own deliberate refusals, which must pass through untranslated. */
export function isOurError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "ApaLockedError" || name === "RateLimitError";
}
