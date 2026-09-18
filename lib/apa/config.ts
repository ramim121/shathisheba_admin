import { getBoolSetting, getSetting } from "@/lib/settings";
import { queryRows } from "@/lib/db";

/**
 * Every number Shathi Apa costs money for, read from `app_settings`.
 *
 * None of these are constants in code on purpose. The first month in
 * production is the only way to find out what a live minute actually costs,
 * how many free questions convert a farmer into a verified one, and what
 * downlink is genuinely too slow for a call. All of it has to be changeable
 * from the console at 9pm without a deploy.
 */

export type ApaConfig = {
  enabled: boolean;
  freeQuestions: number;
  liveMinutesMonthly: number;
  liveSessionMinutes: number;
  liveMicEnabled: boolean;
  bandwidthFloorKbps: number;
  dataMbPerMinute: number;
  voiceName: string;
  autoplayVoice: boolean;
  speechRate: string;
  ttsMaxChars: number;
  askPerMinute: number;
  askPerDay: number;
  budgetUsd: number;
  models: {
    text: string;
    classify: string;
    transcribe: string;
    tts: string;
    live: string;
    vision: string;
  };
};

async function num(key: string, fallback: number): Promise<number> {
  const raw = Number(await getSetting(key, String(fallback)));
  return Number.isFinite(raw) ? raw : fallback;
}

export async function apaConfig(): Promise<ApaConfig> {
  const [
    enabled, freeQuestions, liveMinutesMonthly, liveSessionMinutes, liveMicEnabled,
    bandwidthFloorKbps, dataMbPerMinute, voiceName, autoplayVoice, speechRate,
    ttsMaxChars, askPerMinute, askPerDay, budgetUsd,
    text, classify, transcribe, tts, live, vision
  ] = await Promise.all([
    getBoolSetting("apa_enabled", true),
    num("apa_free_questions", 5),
    num("apa_live_minutes_monthly", 20),
    num("apa_live_session_minutes", 15),
    getBoolSetting("apa_live_mic_enabled", false),
    num("apa_bandwidth_floor_kbps", 120),
    num("apa_data_mb_per_minute", 2),
    getSetting("apa_voice_name", "Aoede"),
    getBoolSetting("apa_autoplay_voice", true),
    getSetting("apa_speech_rate", "normal"),
    num("apa_tts_max_chars", 1200),
    num("apa_ask_per_minute", 6),
    num("apa_ask_per_day", 120),
    num("apa_budget_usd", 200),
    getSetting("apa_model_text", "gemini-3.6-flash"),
    getSetting("apa_model_classify", "gemini-3.6-flash"),
    getSetting("apa_model_transcribe", "gemini-3.5-transcribe"),
    getSetting("apa_model_tts", "gemini-3.1-flash-tts-preview"),
    getSetting("apa_model_live", "gemini-3.8-live"),
    getSetting("apa_model_vision", "gemini-3.6-flash")
  ]);

  return {
    enabled,
    freeQuestions: Math.max(0, Math.round(freeQuestions)),
    liveMinutesMonthly: Math.max(0, Math.round(liveMinutesMonthly)),
    liveSessionMinutes: Math.max(1, Math.round(liveSessionMinutes)),
    liveMicEnabled,
    bandwidthFloorKbps: Math.max(0, Math.round(bandwidthFloorKbps)),
    dataMbPerMinute: Math.max(0, dataMbPerMinute),
    voiceName,
    autoplayVoice,
    speechRate,
    ttsMaxChars: Math.max(200, Math.round(ttsMaxChars)),
    askPerMinute: Math.max(1, Math.round(askPerMinute)),
    askPerDay: Math.max(1, Math.round(askPerDay)),
    budgetUsd: Math.max(0, budgetUsd),
    models: { text, classify, transcribe, tts, live, vision }
  };
}

/* ---------------------------------------------------------------------------
   The long instructions
   --------------------------------------------------------------------------- */

const PROMPT_TTL_MS = 30_000;
let promptCache: { at: number; values: Map<string, string> } | null = null;

/**
 * Persona, scope, refusal and live instructions live in `apa_prompts` rather
 * than app_settings because app_settings.value_text is VARCHAR(255) and the
 * scope instruction runs to several hundred words. Cached briefly for the same
 * reason settings are: a single answer reads three of them.
 */
export async function apaPrompt(key: "persona" | "scope" | "refusal_bn" | "live"): Promise<string> {
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
  return promptCache.values.get(key) ?? FALLBACK[key];
}

export function invalidateApaPrompts() {
  promptCache = null;
}

// If the table is missing or empty the assistant must still be *restricted*,
// not unrestricted. These are deliberately terse copies of the seeded text.
const FALLBACK: Record<string, string> = {
  persona:
    "You are Shathi Apa, the assistant inside the Shathi Sheba app for smallholder farmers in Bangladesh. Answer in everyday Bangla unless asked in English. Action first, reason second. Never invent a price, date or guarantee.",
  scope:
    "Answer only questions about agriculture — crops, livestock, poultry, fish farming, weather for farm work, farm markets and money — and about the Shathi Sheba app. Refuse everything else warmly in one sentence and offer three farming questions instead. Lean toward answering anything that could reasonably be about a farm.",
  refusal_bn:
    "দুঃখিত, আমি শুধু কৃষি, গবাদি পশু, মাছ চাষ ও শাথী সেবার বিষয়ে সাহায্য করতে পারি। আপনার ফসল, পশু বা খামার নিয়ে কিছু জিজ্ঞাসা করুন — আমি সাহায্য করব!",
  live:
    "This is a spoken conversation. Two or three sentences, then stop. No markdown. Numbers spoken as words. Stop immediately when she speaks."
};
