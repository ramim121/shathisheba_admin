/**
 * The parts of Shathi Apa that are pure functions, kept where they can be
 * tested without a database, a network or a model.
 *
 * Everything else in lib/apa reaches for `@/lib/db` or the Gemini client, which
 * makes it awkward to check the one kind of logic most worth checking: the
 * scope shortcut that decides whether the gate runs at all, the WAV header the
 * phone cannot play if it is wrong, the money arithmetic, and the assertion
 * that refuses to mint an unrestricted live token — which the SRS names as a
 * release blocker, and a release blocker nobody can run is a comment.
 *
 * `scripts/test-apa.mjs` imports this file directly. No path aliases here for
 * that reason.
 */

/* ---------------------------------------------------------------------------
   The scope shortcut
   --------------------------------------------------------------------------- */

// Anything obviously agricultural skips the classifier call entirely, which
// takes four seconds and a token cost off the common path.
export const OBVIOUS = [
  "ধান", "গরু", "গাভী", "ছাগল", "মুরগি", "মাছ", "ফসল", "সার", "বীজ", "সেচ", "পোকা",
  "রোগ", "খামার", "জমি", "চাষ", "বৃষ্টি", "আবহাওয়া", "বাজারদর", "দাম", "দুধ", "খাবার",
  "টিকা", "কীটনাশক", "আলু", "পেঁয়াজ", "ভুট্টা", "সরিষা", "পাট", "শাথী",
  "crop", "cow", "goat", "cattle", "poultry", "fish", "farm", "fertiliser", "fertilizer",
  "seed", "irrigation", "pest", "disease", "harvest", "weather", "price", "milk", "vaccine"
];

// Bangla suffixes that attach straight onto a noun with no space, so "গরুর",
// "ধানের" and "ফসলগুলো" still match their stem.
const SUFFIXES = [
  "", "র", "ের", "তে", "কে", "দের", "টা", "টি", "টির", "টার", "গুলো", "গুলি", "গুলোর",
  "গুলির", "খানা", "য়", "য়ের", "ে", "ও", "ই", "রও", "েও"
];

/**
 * Whether the question obviously concerns farming, without asking a model.
 *
 * This has to match whole words, not substrings. `includes()` looked
 * reasonable and was quietly wrong: Bangla compounds embed these short stems,
 * so "প্রধানমন্ত্রী" contains "ধান" and a question about the prime minister was
 * shortcut straight past the scope gate as a question about rice. Bangla has no
 * word boundary the regex engine understands, so the text is split into tokens
 * and each token has to *be* a keyword plus at most one attached suffix.
 */
export function looksAgricultural(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .split(/[\s,.;:!?()[\]"'।॥\-/]+/)
    .filter(Boolean);

  for (const token of tokens) {
    for (const word of OBVIOUS) {
      if (token === word) return true;
      if (!token.startsWith(word)) continue;
      // Latin keywords are whole words already; a longer token containing one
      // ("pricing", "farmer") is close enough to still count.
      if (/^[a-z]+$/.test(word)) return true;
      if (SUFFIXES.includes(token.slice(word.length))) return true;
    }
  }
  return false;
}

/* ---------------------------------------------------------------------------
   Audio
   --------------------------------------------------------------------------- */

/** Markdown read aloud sounds like punctuation. Strip it to what a voice says. */
export function speakable(markdown: string): string {
  return (markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[-*•]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\s*\n\s*\n\s*/g, ". ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * A 44-byte canonical WAV header around raw PCM16.
 *
 * Gemini returns `audio/l16; rate=24000` — bare little-endian samples with no
 * container, which the phone will not play. Written by hand rather than pulled
 * in as a dependency because it is eleven fields and a package would be a
 * larger surface than the thing it wraps.
 */
export function pcm16ToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function sampleRateFrom(mimeType: string | undefined, fallback = 24000): number {
  const rate = /rate=(\d+)/.exec(mimeType ?? "")?.[1];
  return Number(rate ?? fallback) || fallback;
}

/** Rough duration of an inline audio clip, for quota and for the bubble's timer. */
export function audioSeconds(bytes: number, mimeType: string): number {
  const m = mimeType.toLowerCase();
  const rate = /rate=(\d+)/.exec(m)?.[1];
  // 16-bit PCM at a known rate is exact; a compressed container is a guess and
  // is only used for accounting, never shown to the farmer as her clip length.
  if (m.includes("l16") || m.includes("pcm")) return bytes / (2 * Number(rate ?? 16000));
  if (m.includes("wav")) return Math.max(0, (bytes - 44) / (2 * Number(rate ?? 16000)));
  // m4a/aac/opus from the phone, roughly 16 kB per second at the app's settings.
  return bytes / 16000;
}

/* ---------------------------------------------------------------------------
   Money and minutes
   --------------------------------------------------------------------------- */

/**
 * List prices in US dollars, used only for the console's estimate.
 *
 * These are not billed against anything — the real invoice comes from Google.
 * They exist so the Usage and Cost page can answer "are we about to be
 * surprised" while the month is still running, which a monthly invoice cannot.
 * Wrong by a factor of two is still useful; wrong by a factor of fifty is what
 * having no number at all gets you.
 */
export const PRICE = {
  /** per 1M input tokens / per 1M output tokens, flash tier */
  text_in: 0.30,
  text_out: 2.50,
  /** per minute of audio transcribed */
  transcribe_minute: 0.006,
  /** per 1M characters of speech synthesised */
  tts_million_chars: 16.0,
  /** per minute of live audio in + out */
  live_minute: 0.09
} as const;

export function estimateAskCost(input: {
  promptChars: number;
  answerChars: number;
  transcribeSeconds?: number;
  ttsChars?: number;
}): number {
  // Four characters to a token is the usual rough conversion and holds well
  // enough for Bangla once the tokeniser is accounted for.
  return (
    (input.promptChars / 4 / 1e6) * PRICE.text_in +
    (input.answerChars / 4 / 1e6) * PRICE.text_out +
    ((input.transcribeSeconds ?? 0) / 60) * PRICE.transcribe_minute +
    ((input.ttsChars ?? 0) / 1e6) * PRICE.tts_million_chars
  );
}

export function estimateLiveCost(seconds: number): number {
  return (seconds / 60) * PRICE.live_minute;
}

/**
 * How long a live call may be charged for.
 *
 * The phone reports its own duration, which is fine as long as nothing trusts
 * it. Three independent bounds: what it claims, the wall clock since the socket
 * opened, and the session cap. A call that never connected is free.
 */
export function chargeableSeconds(input: {
  claimed: number;
  wallSeconds: number;
  capSeconds: number;
  connected: boolean;
}): number {
  if (!input.connected) return 0;
  const claimed = Math.max(0, Math.round(Number(input.claimed) || 0));
  // Five seconds of slack for the round trip that reports the close.
  return Math.min(claimed, Math.max(0, input.wallSeconds) + 5, input.capSeconds);
}

/* ---------------------------------------------------------------------------
   The live token's restrictions — the release blocker
   --------------------------------------------------------------------------- */

/**
 * Refuse to mint a token that would not be restricted.
 *
 * A token minted without `bidi_generate_content_setup` is an unrestricted
 * Gemini key with a short life, handed to a phone — which is the exact thing
 * this whole rebuild exists to remove. The SRS names it as a release blocker,
 * so it is enforced in code and covered by a test rather than left to review.
 */
export function assertConstrained(body: Record<string, unknown>): void {
  const setup = (body.bidiGenerateContentSetup ?? body.bidi_generate_content_setup) as
    | Record<string, unknown>
    | undefined;
  if (!setup) {
    throw new Error("Refusing to mint a live token with no bidiGenerateContentSetup: it would be an unrestricted key.");
  }
  const instruction = setup.systemInstruction as { parts?: Array<{ text?: string }> } | undefined;
  const text = instruction?.parts?.map((p) => p.text ?? "").join(" ") ?? "";
  if (text.trim().length < 200) {
    throw new Error("Refusing to mint a live token whose system instruction is missing or too short to restrict it.");
  }
  if (!setup.model) {
    throw new Error("Refusing to mint a live token with no model pinned.");
  }
  const tools = JSON.stringify(setup.tools ?? []);
  if (/codeExecution|code_execution|googleSearch|google_search|urlContext|url_context/i.test(tools)) {
    throw new Error("Refusing to mint a live token whose tool list includes an unrestricted capability.");
  }
}
