import { getBoolSetting, getSetting } from "@/lib/settings";
import { queryRows } from "@/lib/db";
import { modelChain } from "@/lib/apa/models";

/**
 * Every number Shathi Apa costs money for, read from `app_settings`.
 *
 * None of these are constants in code on purpose. The first month in
 * production is the only way to find out what a live minute actually costs,
 * how many free questions convert a farmer into a verified one, and what
 * downlink is genuinely too slow for a call. All of it has to be changeable
 * from the console at 9pm without a deploy.
 *
 * Model settings are **chains**, not single names: the free tier caps requests
 * per model per day, so `apa_model_text` holds a comma-separated list and
 * lib/apa/models.ts falls through it when one is spent. `models.text[0]` is
 * what we want; the rest are what answers when it is gone.
 */

export type ApaTtsMode = "device" | "server" | "device_then_server";

export type ApaConfig = {
  enabled: boolean;
  freeQuestions: number;
  liveMinutesMonthly: number;
  liveSessionMinutes: number;
  liveMicEnabled: boolean;
  liveClientReady: boolean;
  bandwidthFloorKbps: number;
  dataMbPerMinute: number;
  voiceName: string;
  autoplayVoice: boolean;
  speechRate: string;
  ttsMaxChars: number;
  ttsMode: ApaTtsMode;
  speechCacheEnabled: boolean;
  answerCacheHours: number;
  promptExamples: boolean;
  retentionDays: number;
  imageMaxPx: number;
  /**
   * Percentage of the day's own allowance at which the per-farmer daily limit
   * starts tightening. 100 turns fair share off.
   */
  fairSharePct: number;
  askPerMinute: number;
  askPerDay: number;
  budgetUsd: number;
  /** Gemini is billed. See lib/apa/models.ts for what it switches. */
  billingEnabled: boolean;
  /** Each entry is a fallback chain, most-wanted first. */
  models: {
    text: string[];
    classify: string[];
    transcribe: string[];
    tts: string[];
    live: string[];
    vision: string[];
  };
};

async function num(key: string, fallback: number): Promise<number> {
  const raw = Number(await getSetting(key, String(fallback)));
  return Number.isFinite(raw) ? raw : fallback;
}

export async function apaConfig(): Promise<ApaConfig> {
  const [
    enabled, freeQuestions, liveMinutesMonthly, liveSessionMinutes, liveMicEnabled, liveClientReady,
    bandwidthFloorKbps, dataMbPerMinute, voiceName, autoplayVoice, speechRate,
    ttsMaxChars, ttsModeRaw, speechCacheEnabled, answerCacheHours, promptExamples,
    retentionDays, imageMaxPx, fairSharePct, askPerMinute, askPerDay, budgetUsd, billingEnabled,
    text, classify, transcribe, tts, live, vision
  ] = await Promise.all([
    getBoolSetting("apa_enabled", true),
    num("apa_free_questions", 5),
    num("apa_live_minutes_monthly", 20),
    num("apa_live_session_minutes", 15),
    getBoolSetting("apa_live_mic_enabled", false),
    getBoolSetting("apa_live_client_ready", false),
    num("apa_bandwidth_floor_kbps", 120),
    num("apa_data_mb_per_minute", 2),
    getSetting("apa_voice_name", "Aoede"),
    getBoolSetting("apa_autoplay_voice", true),
    getSetting("apa_speech_rate", "normal"),
    num("apa_tts_max_chars", 1200),
    getSetting("apa_tts_mode", "device"),
    getBoolSetting("apa_speech_cache_enabled", true),
    num("apa_answer_cache_hours", 6),
    getBoolSetting("apa_prompt_examples", true),
    num("apa_retention_days", 180),
    num("apa_image_max_px", 1024),
    num("apa_fair_share_pct", 75),
    num("apa_ask_per_minute", 6),
    num("apa_ask_per_day", 120),
    num("apa_budget_usd", 200),
    getBoolSetting("apa_billing_enabled", false),
    getSetting("apa_model_text", "gemini-3.1-flash-lite,gemini-2.5-flash"),
    getSetting("apa_model_classify", "gemini-2.5-flash,gemini-3.1-flash-lite"),
    getSetting("apa_model_transcribe", "gemini-3.5-transcribe"),
    getSetting("apa_model_tts", "gemini-2.5-flash-preview-tts,gemini-3.1-flash-tts-preview"),
    getSetting("apa_model_live", "gemini-3.8-live"),
    getSetting("apa_model_vision", "gemini-3.1-flash-lite,gemini-2.5-flash")
  ]);

  const ttsMode: ApaTtsMode =
    ttsModeRaw === "server" || ttsModeRaw === "device_then_server" ? ttsModeRaw : "device";

  return {
    enabled,
    freeQuestions: Math.max(0, Math.round(freeQuestions)),
    liveMinutesMonthly: Math.max(0, Math.round(liveMinutesMonthly)),
    liveSessionMinutes: Math.max(1, Math.round(liveSessionMinutes)),
    liveMicEnabled,
    // Both halves have to be true. The platform being willing to pay for live
    // is not the same as a shipped app being able to capture PCM16, and
    // conflating them produced a screen that claimed to be listening with no
    // socket behind it.
    liveClientReady,
    bandwidthFloorKbps: Math.max(0, Math.round(bandwidthFloorKbps)),
    dataMbPerMinute: Math.max(0, dataMbPerMinute),
    voiceName,
    autoplayVoice,
    speechRate,
    ttsMaxChars: Math.max(200, Math.round(ttsMaxChars)),
    ttsMode,
    speechCacheEnabled,
    answerCacheHours: Math.max(0, answerCacheHours),
    promptExamples,
    retentionDays: Math.max(7, Math.round(retentionDays)),
    imageMaxPx: Math.max(320, Math.round(imageMaxPx)),
    fairSharePct: Math.min(100, Math.max(0, Math.round(fairSharePct))),
    askPerMinute: Math.max(1, Math.round(askPerMinute)),
    askPerDay: Math.max(1, Math.round(askPerDay)),
    budgetUsd: Math.max(0, budgetUsd),
    billingEnabled,
    models: {
      text: modelChain(text, "gemini-3.1-flash-lite"),
      classify: modelChain(classify, "gemini-2.5-flash"),
      transcribe: modelChain(transcribe, "gemini-3.5-transcribe"),
      tts: modelChain(tts, "gemini-2.5-flash-preview-tts"),
      live: modelChain(live, "gemini-3.8-live"),
      vision: modelChain(vision, "gemini-3.1-flash-lite")
    }
  };
}

/* ---------------------------------------------------------------------------
   The long instructions
   --------------------------------------------------------------------------- */

const PROMPT_TTL_MS = 30_000;
let promptCache: { at: number; values: Map<string, string> } | null = null;

export type ApaPromptKey = "persona" | "scope" | "examples" | "live" | "refusal_bn" | "classify" | "intro_bn";

/**
 * Persona, scope, examples, refusal and live instructions live in
 * `apa_prompts` rather than app_settings because app_settings.value_text is
 * VARCHAR(255) and these run to thousands of characters. The canonical copies
 * are the files in database/prompts/, applied by
 * scripts/apply-apa-prompts.cjs, so the scope instruction — which is the
 * safety control — is reviewable in a diff.
 */
export async function apaPrompt(key: ApaPromptKey): Promise<string> {
  if (!promptCache || Date.now() - promptCache.at > PROMPT_TTL_MS) {
    try {
      const rows = await queryRows<{ prompt_key: string; body: string }>(
        "SELECT prompt_key, body FROM apa_prompts"
      );
      promptCache = { at: Date.now(), values: new Map(rows.map((r) => [r.prompt_key, r.body])) };
    } catch {
      promptCache = { at: Date.now(), values: new Map() };
    }
  }
  return promptCache.values.get(key) ?? FALLBACK[key] ?? "";
}

export function invalidateApaPrompts() {
  promptCache = null;
}

/**
 * The answering model's whole system instruction, assembled.
 *
 * Deliberately free of anything about the individual farmer. Her district,
 * farm and today's date go in the *user* turn instead, which keeps this
 * byte-identical across every farmer — the condition Google's implicit prompt
 * cache needs to recognise a common prefix. Measured: with the examples block
 * this is ~4,900 tokens, clearing both the 2,048-token threshold for 2.5 Flash
 * and the 4,096 one for the 3.x Flash line.
 *
 * Honest caveat, also measured: `gemini-3.1-flash-lite` reported
 * `cachedContentTokenCount: 0` on three identical prefixes in a row, so the
 * discount does not apply on flash-lite however long the prefix is. The
 * examples still pay for themselves there in answer quality — 6/6 on the
 * capability battery against a persona that previously invented a three-day
 * forecast — but they are a quality purchase, not a saving. `apa_prompt_examples`
 * exists so that trade can be reversed from the console.
 */
export async function askInstruction(cfg: ApaConfig): Promise<string> {
  const [persona, scope, examples] = await Promise.all([
    apaPrompt("persona"),
    apaPrompt("scope"),
    cfg.promptExamples ? apaPrompt("examples") : Promise.resolve("")
  ]);
  return [persona, scope, examples].map((s) => s.trim()).filter(Boolean).join("\n\n");
}

export async function liveInstruction(cfg: ApaConfig): Promise<string> {
  const [persona, scope, live] = await Promise.all([
    apaPrompt("persona"),
    apaPrompt("scope"),
    apaPrompt("live")
  ]);
  void cfg;
  return [persona, scope, live].map((s) => s.trim()).filter(Boolean).join("\n\n");
}

// If the table is missing or empty the assistant must still be *restricted*,
// not unrestricted. These are deliberately terse copies of the seeded text.
const FALLBACK: Record<string, string> = {
  persona:
    "You are Shathi Apa, the assistant inside the Shathi Sheba app for smallholder farmers in Bangladesh. Answer in everyday Bangla unless asked in English. Action first, reason second. Never state a weather condition, price, dose or date unless a tool result in this conversation contains it — say plainly that you could not fetch it instead. Never diagnose with certainty. Never assume the farmer's gender. Ask one clarifying question rather than guessing.",
  scope:
    "Answer only questions about agriculture — crops, livestock, poultry, fish farming, weather for farm work, farm markets and money — and about the Shathi Sheba app. Refuse everything else warmly in one sentence and offer three farming questions instead. Lean toward answering anything that could reasonably be about a farm. Judge the question, not the words in it.",
  examples: "",
  refusal_bn:
    "দুঃখিত, আমি শুধু কৃষি, গবাদি পশু, মাছ চাষ ও শাথী সেবার বিষয়ে সাহায্য করতে পারি। আপনার ফসল, পশু বা খামার নিয়ে কিছু জিজ্ঞাসা করুন — আমি সাহায্য করব!",
  live:
    "This is a spoken conversation. Two or three sentences, then stop. No markdown. Numbers spoken as words. Stop immediately when she speaks.",
  classify:
    "Decide whether the farmer's message is about agriculture, the farm economy, or the Shathi Sheba app. Lean toward in_scope. Judge the question, not the words in it. Return strict JSON: {\"verdict\":\"in_scope|out_of_scope|ambiguous\",\"topic\":\"\",\"confidence\":0.0}"
};
