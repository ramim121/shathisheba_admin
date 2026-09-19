/**
 * The one place the Gemini key is resolved, for every caller on the server.
 *
 * There are three unrelated consumers of this key — Shathi Apa (`lib/apa/*`),
 * the admin AI helpers (`lib/ai-assist.ts`) and post moderation
 * (`lib/gemini.ts`) — and each used to read `process.env.GEMINI_API_KEY`
 * itself. That was fine until the key had to change, at which point "wire the
 * new key" meant finding all three and hoping there was not a fourth.
 *
 * ## Why two variable names
 *
 * Rotating a key is not atomic: the new one has to be proven working before the
 * old one is destroyed, and in between both must be usable. So `_NEW` wins when
 * present and the bare name is the fallback, which makes the handover a matter
 * of adding one line to `.env` and later deleting another — no code change, no
 * deploy, no window where the server has no key at all.
 *
 * Once the old key is gone, `GEMINI_API_KEY_NEW` can be renamed to
 * `GEMINI_API_KEY` in the env file and nothing here needs to change.
 *
 * ## Billing note
 *
 * Billing attaches to the Google Cloud *project*, not to the key. Measured
 * 2026-09-19: the old key and the new key both cleared 20 requests/minute on
 * `gemini-3.5-flash-lite`, which the free tier refuses at ~16. So every key on
 * this project now spends real money, including any key that has leaked. That
 * is the reason the old key's deletion is urgent rather than tidy.
 */

/** Preference order. First non-empty wins. */
const NAMES = ["GEMINI_API_KEY_NEW", "GEMINI_API_KEY"] as const;

/** Which variable supplied the key, for diagnostics that must not print it. */
export function geminiKeySource(): string | null {
  for (const name of NAMES) {
    if ((process.env[name] ?? "").trim()) return name;
  }
  return null;
}

export function isGeminiKeyConfigured(): boolean {
  return geminiKeySource() !== null;
}

export function geminiKey(): string {
  for (const name of NAMES) {
    const value = (process.env[name] ?? "").trim();
    if (value) return value;
  }
  throw new Error(
    `No Gemini API key on the server. Set ${NAMES[0]} (preferred) or ${NAMES[1]} in .env.`
  );
}
