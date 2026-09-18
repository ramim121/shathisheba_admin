import { createHash } from "node:crypto";
import { executeQuery, queryRows } from "@/lib/db";
import { cacheableForHours, normaliseQuestion } from "@/lib/apa/pure";

/**
 * The answer cache, and the speech cache behind it.
 *
 * Fifty farmers in one upazila asking "আজ কি বৃষ্টি হবে?" on the same morning is
 * one model call and forty-nine cache hits, because the grounding data is
 * identical for every one of them that day. Weather and market questions are
 * the two highest-volume categories and both are almost perfectly cacheable for
 * exactly that reason.
 *
 * The honesty constraints matter more than the saving:
 *
 *   - **Never across districts.** The district id is part of the key, because
 *     the whole value of the answer is that it is about her area.
 *   - **Never across days.** The date is part of the key.
 *   - **Never anything personal.** An answer that read her listings, her orders,
 *     her loan or her profile is about one farmer; `reason.ts` marks those
 *     `cacheable: false` and they never arrive here.
 *   - **Never a failed lookup**, and never a clarifying question — the next
 *     farmer's vague question is not this one.
 *   - **Shorter windows where the figure moves.** A market price is good for
 *     four hours, a weather answer for three, everything else for the
 *     configured default.
 */

type Row = Record<string, unknown>;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export type CachedAnswer = {
  text: string;
  advice: unknown;
  caution: string | null;
  suggestions: string[];
  sources: unknown[];
  needs_officer: boolean;
  tools_used: string[];
  hedged: boolean;
};

function answerKey(input: {
  question: string;
  districtId: string | number | null;
  lang: string;
  examples: boolean;
}): { key: string; norm: string } {
  const norm = normaliseQuestion(input.question);
  // The prompt shape is part of the key: turning the examples block off changes
  // the answers, so cached text from the other shape must not be served.
  const key = sha(`v2|${norm}|${input.districtId ?? "none"}|${input.lang}|${input.examples ? "ex" : "core"}`);
  return { key, norm };
}

/** A cached answer for this question, area and day, if one is still fresh. */
export async function readAnswerCache(input: {
  question: string;
  districtId: string | number | null;
  lang: string;
  examples: boolean;
  hours: number;
  /**
   * False for a look that is not a farmer being served — the overnight
   * pre-warm checking whether it still has work to do. Without this, a
   * pre-warm run would inflate the very hit counter it exists to improve, and
   * the console's cache figures would be measuring itself.
   */
  countHit?: boolean;
}): Promise<CachedAnswer | null> {
  if (input.hours <= 0) return null;
  const norm = normaliseQuestion(input.question);
  if (norm.length < 6) return null;

  const { key } = answerKey(input);
  try {
    const [row] = await queryRows<Row>(
      // The age is computed in SQL on purpose. mysql2 hands a DATETIME back as a
      // JS Date built in the *process* timezone, while the connection reports
      // wall-clock UTC — so on a Dhaka laptop `Date.now() - created_at` is six
      // hours out and every row looks stale. TIMESTAMPDIFF has no such seam.
      `SELECT answer_json, tools_json,
              TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
         FROM apa_answer_cache
        WHERE cache_key = ?
          AND for_day = CURDATE()
          AND created_at > NOW() - INTERVAL ? HOUR
        LIMIT 1`,
      [key, Math.ceil(input.hours)]
    );
    if (!row) return null;

    // A row written against a longer window than this question deserves must
    // not be served past that question's own shelf life.
    const tools = parseArray(row.tools_json).map(String);
    const allowed = cacheableForHours(tools, input.hours);
    const ageHours = Math.max(0, Number(row.age_seconds ?? 0)) / 3_600;
    if (ageHours > allowed) return null;

    if (input.countHit !== false) {
      await executeQuery(
        "UPDATE apa_answer_cache SET hits = hits + 1, last_hit_at = NOW() WHERE cache_key = ?",
        [key]
      );
    }
    return typeof row.answer_json === "string"
      ? (JSON.parse(row.answer_json) as CachedAnswer)
      : (row.answer_json as CachedAnswer);
  } catch (error) {
    // A cache that cannot be read is a cache miss, never an error the farmer sees.
    console.error("apa answer cache read failed", error);
    return null;
  }
}

export async function writeAnswerCache(input: {
  question: string;
  districtId: string | number | null;
  lang: string;
  examples: boolean;
  answer: CachedAnswer;
  model: string;
  tools: string[];
}): Promise<void> {
  const { key, norm } = answerKey(input);
  if (norm.length < 6) return;
  try {
    await executeQuery(
      `INSERT INTO apa_answer_cache
         (cache_key, question_norm, district_id, for_day, lang, answer_json, model, tools_json)
       VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE answer_json = VALUES(answer_json), model = VALUES(model),
                               tools_json = VALUES(tools_json), created_at = NOW()`,
      [
        key,
        norm,
        input.districtId ?? null,
        input.lang,
        JSON.stringify(input.answer),
        input.model.slice(0, 80),
        JSON.stringify(input.tools)
      ]
    );
  } catch (error) {
    console.error("apa answer cache write failed", error);
  }
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------------
   Speech
   --------------------------------------------------------------------------- */

/**
 * Synthesised audio, keyed by content.
 *
 * Speech is deterministic: the same text, voice and rate give the same audio.
 * This only earns its keep when read-aloud has fallen back to the server —
 * which, with `apa_tts_mode` on `device`, should be the minority of phones. It
 * exists because that minority is exactly the farmers on the oldest handsets,
 * and making them wait four seconds and pay for 300 KB twice for the same
 * sentence would be the wrong way round.
 */
export function speechKey(input: { text: string; voice: string; rate: string; model: string }): string {
  return sha(`v1|${input.text.trim()}|${input.voice}|${input.rate}|${input.model}`);
}

export type CachedSpeech = {
  audio_url: string;
  mime_type: string;
  sample_rate: number;
  bytes: number;
  seconds: number | null;
};

export async function readSpeechCache(key: string): Promise<CachedSpeech | null> {
  try {
    const [row] = await queryRows<Row>(
      "SELECT audio_url, mime_type, sample_rate, bytes, seconds FROM apa_speech_cache WHERE cache_key = ? LIMIT 1",
      [key]
    );
    if (!row) return null;
    await executeQuery(
      "UPDATE apa_speech_cache SET hits = hits + 1, last_hit_at = NOW() WHERE cache_key = ?",
      [key]
    );
    return {
      audio_url: String(row.audio_url),
      mime_type: String(row.mime_type),
      sample_rate: Number(row.sample_rate),
      bytes: Number(row.bytes),
      seconds: row.seconds === null ? null : Number(row.seconds)
    };
  } catch {
    return null;
  }
}

export async function writeSpeechCache(input: {
  key: string;
  textLen: number;
  voice: string;
  rate: string;
  model: string;
  audioUrl: string;
  mimeType: string;
  sampleRate: number;
  bytes: number;
  seconds: number | null;
}): Promise<void> {
  try {
    await executeQuery(
      `INSERT INTO apa_speech_cache
         (cache_key, text_len, voice, speech_rate, model, audio_url, mime_type, sample_rate, bytes, seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE audio_url = VALUES(audio_url), bytes = VALUES(bytes)`,
      [
        input.key, input.textLen, input.voice.slice(0, 60), input.rate.slice(0, 20),
        input.model.slice(0, 80), input.audioUrl.slice(0, 500), input.mimeType.slice(0, 60),
        input.sampleRate, input.bytes, input.seconds
      ]
    );
  } catch (error) {
    console.error("apa speech cache write failed", error);
  }
}

/* ---------------------------------------------------------------------------
   What the console shows
   --------------------------------------------------------------------------- */

export async function cacheStats(): Promise<Row> {
  const [answers] = await queryRows<Row>(
    `SELECT COUNT(*) AS rows_kept, COALESCE(SUM(hits), 0) AS hits,
            COALESCE(MAX(hits), 0) AS best,
            SUM(for_day = CURDATE()) AS today
       FROM apa_answer_cache`
  );
  const [speech] = await queryRows<Row>(
    `SELECT COUNT(*) AS rows_kept, COALESCE(SUM(hits), 0) AS hits,
            COALESCE(SUM(bytes), 0) AS bytes
       FROM apa_speech_cache`
  );
  const top = await queryRows<Row>(
    `SELECT question_norm, hits, model, for_day
       FROM apa_answer_cache
      WHERE hits > 0
      ORDER BY hits DESC LIMIT 10`
  );
  return { answers: answers ?? {}, speech: speech ?? {}, top };
}

/** Yesterday's rows are dead weight — the key includes the day. */
export async function pruneAnswerCache(): Promise<number> {
  try {
    const res = await executeQuery("DELETE FROM apa_answer_cache WHERE for_day < CURDATE()");
    return Number((res as { affectedRows?: number }).affectedRows ?? 0);
  } catch {
    return 0;
  }
}
