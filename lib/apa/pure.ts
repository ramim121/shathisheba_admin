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

/** How many bars the player draws. The playbar spec fixes it at 36. */
export const WAVEFORM_BARS = 36;

/**
 * The real amplitude envelope of a clip, as the playbar draws it.
 *
 * The playbar spec is explicit that bar heights are the clip's actual envelope
 * and are identical in every state — cold, loading, playing, finished. That
 * rules out computing them on the phone: the phone does not have the audio
 * until she presses play, so a real envelope could only appear *after* the
 * thing it is meant to invite, and the shape would change at the moment of
 * loading. The server has the PCM the instant it synthesises it, so it
 * measures here and ships 36 numbers with the URL.
 *
 * RMS per bucket rather than peak: a single click or plosive makes a peak
 * bar that has nothing to do with how loud the speech is, and a waveform of
 * isolated spikes reads as noise.
 *
 * Stretched between the quietest and loudest bucket rather than scaled to the
 * loudest alone. Measured on the 49 clips already cached: a spoken answer
 * averaged over one-second buckets sits in a narrow band of loudness, so
 * scaling to the maximum put nearly every bar between 60% and 90% of full
 * height — a dense comb in which the pauses between sentences, the one
 * feature a listener can actually navigate by, were invisible. The stretch
 * keeps every bar in the same order relative to every other, so it is still
 * the clip's own envelope; it just uses the whole height to show it.
 *
 * Returns values in 0..1 at two decimal places — about 180 bytes of JSON.
 */
export function waveformPeaks(pcm: Buffer, bars = WAVEFORM_BARS): number[] {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0 || bars <= 0) return Array(Math.max(0, bars)).fill(0);

  const rms: number[] = [];
  for (let b = 0; b < bars; b += 1) {
    const from = Math.floor((b * samples) / bars);
    const to = Math.max(from + 1, Math.floor(((b + 1) * samples) / bars));
    let sum = 0;
    let n = 0;
    for (let i = from; i < to && i < samples; i += 1) {
      const v = pcm.readInt16LE(i * 2) / 32768;
      sum += v * v;
      n += 1;
    }
    rms.push(n ? Math.sqrt(sum / n) : 0);
  }

  const loudest = Math.max(...rms);
  const quietest = Math.min(...rms);
  if (loudest <= 0) return rms.map(() => 0);
  // A clip of one steady tone has no shape to stretch; draw it flat and full
  // rather than dividing by zero.
  if (loudest - quietest < 1e-6) return rms.map(() => 1);
  return rms.map((v) => Math.round(((v - quietest) / (loudest - quietest)) * 100) / 100);
}

/** Parse what the cache stored, refusing anything that is not 36 sane numbers. */
export function parsePeaks(raw: unknown, bars = WAVEFORM_BARS): number[] | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length !== bars) return null;
  const out = value.map((v) => Number(v));
  if (out.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) return null;
  return out;
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
 * List prices in US dollars per 1M tokens, per model.
 *
 * This used to be one flat table, which was confidently wrong the moment a
 * model was changed in the console — the models on offer differ by 15x on
 * input and 50x on speech output, so a single set of numbers could not describe
 * any two of them. Figures are Google's published list prices; where a model is
 * banded by prompt length or modality, the lower band is used, because that is
 * the band a farmer's question falls in.
 *
 * `audio_out_tokens_per_second` is measured, not published: 32.1 for the 3.1
 * TTS preview and 24.9 for the 2.5 preview, read off `usageMetadata` against a
 * known audio length. It is what makes a spoken answer costable at all.
 */
export type ModelPrice = {
  in: number;
  out: number;
  /** Billed output tokens per second of synthesised speech, where measured. */
  audioOutTokensPerSecond?: number;
  /** Per-minute audio price, for the paths Google bills that way. */
  audioInPerMinute?: number;
};

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Text and vision
  "gemini-3.8-flash": { in: 0.75, out: 3.75 },
  "gemini-3.7-flash": { in: 0.75, out: 3.75 },
  "gemini-3.6-flash": { in: 0.75, out: 3.75 },
  "gemini-3.5-flash": { in: 1.50, out: 9.00 },
  "gemini-3.5-flash-lite": { in: 0.30, out: 2.50 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.50 },
  "gemini-3.1-pro-preview": { in: 2.00, out: 12.00 },
  "gemini-2.5-pro": { in: 1.25, out: 10.00 },
  "gemini-2.5-flash": { in: 0.30, out: 2.50 },
  "gemini-2.5-flash-lite": { in: 0.10, out: 0.40 },
  // Gemma is free to call, so it costs nothing and is priced as such.
  "gemma-4-31b-it": { in: 0, out: 0 },
  "gemma-4-26b-a4b-it": { in: 0, out: 0 },
  // Transcription
  "gemini-3.5-transcribe": { in: 2.00, out: 12.00, audioInPerMinute: 0.003 },
  "gemini-3.5-transcribe-live": { in: 3.50, out: 21.00, audioInPerMinute: 0.005 },
  // Speech
  "gemini-3.1-flash-tts-preview": { in: 1.00, out: 20.00, audioOutTokensPerSecond: 32.1 },
  "gemini-2.5-flash-preview-tts": { in: 0.50, out: 10.00, audioOutTokensPerSecond: 24.9 },
  "gemini-2.5-pro-preview-tts": { in: 1.00, out: 20.00 },
  // Live
  "gemini-3.8-live": { in: 3.00, out: 12.00, audioInPerMinute: 0.005 },
  "gemini-3.1-flash-live-preview": { in: 3.00, out: 12.00, audioInPerMinute: 0.005 },
};

/** A model nobody priced yet is costed at the flash rate rather than at zero. */
const FALLBACK_PRICE: ModelPrice = { in: 0.30, out: 2.50 };

export function priceOf(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? FALLBACK_PRICE;
}

/** What read-aloud costs per minute of speech, for the model actually in use. */
export function speechCostPerMinute(model: string): number {
  const price = priceOf(model);
  const perSecond = price.audioOutTokensPerSecond ?? 28;
  return (perSecond * 60 / 1e6) * price.out;
}

/**
 * Cost of one turn, from the token counts the API reported.
 *
 * Cached input tokens are discounted 90% where the model supports implicit
 * caching. Measured caveat: `gemini-3.1-flash-lite` reported
 * `cachedContentTokenCount: 0` on three identical 4,895-token prefixes, so the
 * discount is real only where the API says tokens were cached — which is why
 * this takes the count rather than assuming it.
 */
export function costOf(input: {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
}): number {
  const price = priceOf(input.model);
  const cached = Math.max(0, Math.min(input.cachedTokens ?? 0, input.tokensIn));
  const fresh = Math.max(0, input.tokensIn - cached);
  return (
    (fresh / 1e6) * price.in +
    (cached / 1e6) * price.in * 0.1 +
    (input.tokensOut / 1e6) * price.out
  );
}

/** Older shape, kept for the estimate the console shows before token counts exist. */
export function estimateAskCost(input: {
  promptChars: number;
  answerChars: number;
  transcribeSeconds?: number;
  ttsChars?: number;
  model?: string;
  ttsModel?: string;
}): number {
  const text = priceOf(input.model ?? "gemini-3.1-flash-lite");
  const tts = priceOf(input.ttsModel ?? "gemini-2.5-flash-preview-tts");
  const transcribe = priceOf("gemini-3.5-transcribe");
  // Four characters to a token is the usual rough conversion and holds well
  // enough for Bangla once the tokeniser is accounted for.
  const spokenSeconds = (input.ttsChars ?? 0) / 12;
  return (
    (input.promptChars / 4 / 1e6) * text.in +
    (input.answerChars / 4 / 1e6) * text.out +
    ((input.transcribeSeconds ?? 0) / 60) * (transcribe.audioInPerMinute ?? 0.003) +
    (spokenSeconds * (tts.audioOutTokensPerSecond ?? 28) / 1e6) * tts.out
  );
}

/**
 * What a minute of live conversation costs.
 *
 * MEASURED 2026-09-19 against the billed key, from usageMetadata on a real
 * turn (Resources/apa-probes/live.cjs). A 3.7-second question and a 12.0-second
 * answer — 15.7 seconds of conversation — billed:
 *
 *     prompt     721 tokens   (429 text, 292 audio)
 *     thoughts   105 tokens
 *     response   307 tokens   (audio)
 *
 * At gemini-3.8-live's $3.00/M in and $12.00/M out that is $0.00711, which is
 * $0.0272 a minute. The previous figure here was an estimate of $0.023 built
 * from a per-minute audio rate plus a guessed output rate, and it was 18% low —
 * the guess missed the thinking tokens entirely.
 *
 * Kept as a rate per minute rather than per token because that is the unit the
 * quota is denominated in: she is granted minutes, and the receipt is charged
 * in seconds. Billing per token would mean a quota she cannot be told in
 * advance.
 *
 * For scale: a typed answer is about $0.0017, so a minute of live costs roughly
 * what sixteen typed questions cost. That ratio is why lib/apa/budget.ts closes
 * live before it touches anything else.
 */
export const LIVE_USD_PER_MINUTE = 0.0272;

export function estimateLiveCost(seconds: number, model = "gemini-3.8-live"): number {
  // The model argument is kept because the chain may one day hold more than one
  // live model, but the measured rate is what is used when it is the one we run.
  if (model === "gemini-3.8-live") return (seconds / 60) * LIVE_USD_PER_MINUTE;
  const price = priceOf(model);
  // Both directions: she speaks and is spoken to for roughly the same duration.
  return (seconds / 60) * ((price.audioInPerMinute ?? 0.005) + 0.018);
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


/* ---------------------------------------------------------------------------
   The answer cache's key
   --------------------------------------------------------------------------- */

/**
 * Normalise a question so two farmers asking the same thing in slightly
 * different words hit the same cache row.
 *
 * Deliberately conservative. Over-normalising would serve one farmer another
 * farmer's answer, so this only strips what cannot change the meaning:
 * whitespace, Bangla and Latin punctuation, Bangla numerals folded to Latin so
 * "৭৯০" and "790" agree, and case.
 */
export function normaliseQuestion(text: string): string {
  const bnDigits = "০১২৩৪৫৬৭৮৯";
  return (text ?? "")
    .replace(/[০-৯]/g, (d) => String(bnDigits.indexOf(d)))
    .toLowerCase()
    .replace(/[\s।॥.,;:!?()\[\]"'\-\/]+/g, " ")
    .trim()
    .slice(0, 480);
}

/**
 * Tools whose result is about one farmer. An answer that used any of them must
 * never be cached, however identical the question looks.
 */
/**
 * Tools whose answer is about one farmer and nobody else.
 *
 * This is the single source of truth for that, and it is load-bearing for
 * privacy rather than for cost: an answer that read her listings, her orders,
 * her profile or her loan must never reach the answer cache, because the next
 * farmer in her district asking a similarly-worded question would be served
 * it. There used to be a second copy of this list in tools.ts, which is a
 * privacy bug waiting for somebody to add a tool to one and not the other.
 */
export const PERSONAL_TOOLS = new Set([
  "get_my_profile",
  "get_my_listings",
  "get_my_orders",
  "get_finance_status",
]);

export function isCacheable(tools: string[]): boolean {
  return !tools.some((t) => PERSONAL_TOOLS.has(t));
}

/** Questions where the answer depends on a figure that moves during the day. */
export function cacheableForHours(tools: string[], defaultHours: number): number {
  if (tools.includes("get_market_price")) return Math.min(defaultHours, 4);
  if (tools.includes("get_weather")) return Math.min(defaultHours, 3);
  return defaultHours;
}

/* ---------------------------------------------------------------------------
   Reading a rate-limit response
   --------------------------------------------------------------------------- */

/**
 * How long Google says to wait, in seconds, if it said anything.
 *
 * This is the only reliable discriminator between a per-minute rate limit and
 * a spent daily cap, and getting it wrong is expensive in both directions.
 */
export function retrySeconds(raw: string): number | null {
  // "Please retry in 18.604534858s." — the message form.
  const inline = raw.match(/retry in (\d+(?:\.\d+)?)s/i);
  if (inline) return Number(inline[1]);
  // "retryDelay":"18s" — the RetryInfo detail, when the caller stringified it.
  const detail = raw.match(/retryDelay["'\s:]+(\d+(?:\.\d+)?)s/i);
  if (detail) return Number(detail[1]);
  return null;
}

/* ---------------------------------------------------------------------------
   Spend bands
   --------------------------------------------------------------------------- */

export type BudgetBand = "normal" | "tight" | "critical" | "spent";

export type BudgetBands = {
  band: BudgetBand;
  pct: number;
  allowLive: boolean;
  allowServerTts: boolean;
  allowPrewarm: boolean;
  allowFresh: boolean;
};

/** Thresholds, as a percentage of the month's budget. */
export const BUDGET_TIGHT_PCT = 70;
export const BUDGET_CRITICAL_PCT = 85;

/**
 * Which features the month's spend still allows.
 *
 * Here rather than in `budget.ts` because that file reads the database and this
 * is arithmetic — and arithmetic about money is exactly what wants a test. The
 * ordering is the design: each band switches off the most expensive remaining
 * thing per unit of usefulness, so the assistant degrades instead of stopping.
 *
 *   normal    everything
 *   tight     no pre-warm — speculative spend, so nobody notices it go
 *   critical  no live audio (~$0.023/min against $0.0002 for a typed answer),
 *             and read-aloud falls back to the phone's free voice
 *   spent     no fresh model calls; cache hits still served, still spoken
 *
 * A budget of zero means "not configured" and allows everything. Reading it as
 * "spend nothing" would take the assistant down on a fresh database, which is
 * a worse failure than the one it would be protecting against.
 */
export function budgetBands(spentUsd: number, budgetUsd: number): BudgetBands {
  if (!(budgetUsd > 0)) {
    return {
      band: "normal", pct: 0,
      allowLive: true, allowServerTts: true, allowPrewarm: true, allowFresh: true
    };
  }
  const spent = Math.max(0, spentUsd);
  const pct = Math.round((spent / budgetUsd) * 100);
  const band: BudgetBand =
    pct >= 100 ? "spent"
      : pct >= BUDGET_CRITICAL_PCT ? "critical"
      : pct >= BUDGET_TIGHT_PCT ? "tight"
      : "normal";
  return {
    band,
    pct,
    allowLive: band === "normal" || band === "tight",
    allowServerTts: band === "normal" || band === "tight",
    allowPrewarm: band === "normal",
    allowFresh: band !== "spent"
  };
}
