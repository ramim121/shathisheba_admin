import { executeQuery, queryRows } from "@/lib/db";
import { RateLimitError } from "@/lib/errors";
import { currentPeriod } from "@/lib/apa/entitlement";
import type { ApaConfig } from "@/lib/apa/config";
import { dayHeadroom } from "@/lib/apa/models";
import { estimateLiveCost } from "@/lib/apa/pure";

/**
 * Rate limits and monthly accounting.
 *
 * Two different jobs that people conflate. The *rate limit* is an abuse
 * ceiling — six questions a minute is far above anything a farmer types and
 * far below anything a script costs us. The *quota* is a product decision — a
 * live minute is expensive and the farmer is told her balance before she spends
 * it, never during (SRS V4: a number counting down mid-call manufactures the
 * anxiety the design exists to prevent).
 *
 * Both are measured from rows we already write, so there is nothing to keep in
 * sync and nothing that resets when the process restarts.
 */

type Row = Record<string, unknown>;

export async function assertAskRate(userId: string | number, cfg: ApaConfig): Promise<void> {
  const [counts] = await queryRows<Row>(
    `SELECT
       SUM(created_at > NOW() - INTERVAL 1 MINUTE) AS last_minute,
       SUM(created_at > NOW() - INTERVAL 1 DAY) AS last_day
     FROM apa_messages
     WHERE user_id = ? AND role = 'user' AND created_at > NOW() - INTERVAL 1 DAY`,
    [userId]
  );
  const minute = Number(counts?.last_minute ?? 0);
  const day = Number(counts?.last_day ?? 0);
  if (minute >= cfg.askPerMinute) {
    throw new RateLimitError("একটু ধীরে — আগের প্রশ্নের উত্তর আসছে।", 20);
  }

  const cap = await fairShareCap(cfg);
  if (day >= cap.perUser) {
    throw new RateLimitError(
      cap.rationed
        ? // Deliberately not "you have asked too much". The limit is the
          // platform's for the day, not hers, and telling her otherwise for
          // asking eight questions would be a lie that makes her ask fewer.
          "আজ অনেক কৃষক প্রশ্ন করেছেন, তাই আজকের মতো শেষ। কাল সকালে আবার খোলা থাকবে।"
        : "আজকের প্রশ্নের সীমা শেষ। কাল আবার জিজ্ঞাসা করুন।",
      3600
    );
  }
}

/**
 * Fair share of what is left of the day.
 *
 * The free tier's cap is on the whole project, not on the farmer — so without
 * this, one enthusiastic user (or one retry loop) can spend the day's entire
 * allowance before most people have woken up, and everyone else is told the
 * assistant is busy. The per-farmer daily limit therefore tightens as the
 * project's own headroom runs down.
 *
 * It is not a queue. A queue would hold a question about a dying animal until
 * midnight Pacific, which is worse than an honest "come back tomorrow" — she
 * can ring the officer instead, and the refusal names that option.
 *
 * The bands are deliberately coarse. The point is to stop one account
 * consuming the tail of the day, not to divide the allowance precisely: doing
 * that properly needs to know how many farmers will ask in the hours left,
 * which nothing here can know.
 */
export async function fairShareCap(
  cfg: ApaConfig
): Promise<{ perUser: number; rationed: boolean; pct: number; left: number }> {
  if (!cfg.fairSharePct || cfg.fairSharePct >= 100) {
    return { perUser: cfg.askPerDay, rationed: false, pct: 0, left: 0 };
  }
  try {
    const head = await dayHeadroom(cfg.models.text);
    if (!head.cap) return { perUser: cfg.askPerDay, rationed: false, pct: 0, left: 0 };

    // Two bands. Past the trigger, heavy users stop and light users carry on;
    // past the second, everybody gets a few and nobody gets the rest.
    const tight = Math.max(cfg.fairSharePct, 90);
    if (head.pct >= tight) {
      return { perUser: Math.min(cfg.askPerDay, 3), rationed: true, pct: head.pct, left: head.left };
    }
    if (head.pct >= cfg.fairSharePct) {
      return { perUser: Math.min(cfg.askPerDay, 8), rationed: true, pct: head.pct, left: head.left };
    }
    return { perUser: cfg.askPerDay, rationed: false, pct: head.pct, left: head.left };
  } catch (error) {
    // A guard that cannot read the counters must not become the outage it
    // exists to prevent.
    console.error("apa fair share check failed", error);
    return { perUser: cfg.askPerDay, rationed: false, pct: 0, left: 0 };
  }
}

/* ---------------------------------------------------------------------------
   Monthly rollup
   --------------------------------------------------------------------------- */

export type UsageDelta = Partial<{
  ask_count: number;
  voice_count: number;
  photo_count: number;
  refused_count: number;
  tool_calls: number;
  live_sessions: number;
  live_seconds: number;
  transcribe_seconds: number;
  tts_chars: number;
  est_cost_usd: number;
  cached_tokens: number;
  cache_hits: number;
  speech_device: number;
  speech_server: number;
}>;

const COLUMNS: Array<keyof UsageDelta> = [
  "ask_count", "voice_count", "photo_count", "refused_count", "tool_calls",
  "live_sessions", "live_seconds", "transcribe_seconds", "tts_chars", "est_cost_usd",
  "cached_tokens", "cache_hits", "speech_device", "speech_server"
];

/** One upsert per turn, adding whatever that turn spent. */
export async function addUsage(userId: string | number, delta: UsageDelta): Promise<void> {
  const used = COLUMNS.filter((c) => Number(delta[c] ?? 0) !== 0);
  if (!used.length) return;
  const cols = used.join(", ");
  const marks = used.map(() => "?").join(", ");
  const bump = used.map((c) => `${c} = ${c} + VALUES(${c})`).join(", ");
  try {
    await executeQuery(
      `INSERT INTO apa_usage (user_id, period, ${cols}) VALUES (?, ?, ${marks})
       ON DUPLICATE KEY UPDATE ${bump}`,
      [userId, currentPeriod(), ...used.map((c) => Number(delta[c] ?? 0))]
    );
  } catch (error) {
    // Accounting must never take an answer down with it.
    console.error("apa usage write failed", error);
  }
}

/* ---------------------------------------------------------------------------
   Live minutes
   --------------------------------------------------------------------------- */

/** Seconds of live conversation this farmer has spent in the current month. */
export async function liveSecondsUsed(userId: string | number): Promise<number> {
  const [row] = await queryRows<Row>(
    "SELECT live_seconds FROM apa_usage WHERE user_id = ? AND period = ? LIMIT 1",
    [userId, currentPeriod()]
  );
  return Number(row?.live_seconds ?? 0);
}

/**
 * A session left open — the app was killed, the phone died, the socket dropped
 * without a close. Charged at the session cap rather than forgiven, because
 * Google charged us for it either way, and rather than left open forever,
 * because an open row would block the next mint.
 */
export async function reconcileAbandonedSessions(userId: string | number, capSeconds: number): Promise<void> {
  try {
    const stale = await queryRows<Row>(
      `SELECT id,
              IF(connected_at IS NULL, 0, LEAST(?, TIMESTAMPDIFF(SECOND, connected_at, NOW()))) AS seconds
         FROM apa_live_sessions
        WHERE user_id = ? AND closed_at IS NULL AND minted_at < NOW() - INTERVAL ? SECOND`,
      [capSeconds, userId, capSeconds]
    );
    if (!stale.length) return;
    await executeQuery(
      `UPDATE apa_live_sessions
          SET closed_at = NOW(),
              charged_seconds = IF(connected_at IS NULL, 0,
                LEAST(?, TIMESTAMPDIFF(SECOND, connected_at, NOW()))),
              end_reason = IF(connected_at IS NULL, 'never_connected', 'abandoned')
        WHERE user_id = ? AND closed_at IS NULL AND minted_at < NOW() - INTERVAL ? SECOND`,
      [capSeconds, userId, capSeconds]
    );
    // The minutes still have to land on the quota, or an app that is killed
    // mid-call becomes a way to talk for free.
    const seconds = stale.reduce((sum, row) => sum + Number(row.seconds ?? 0), 0);
    if (seconds > 0) {
      await addUsage(userId, { live_seconds: seconds, est_cost_usd: estimateLiveCost(seconds) });
    }
  } catch (error) {
    console.error("apa live reconcile failed", error);
  }
}

// Re-exported so the console and the app-side helpers keep one import path.
export { MODEL_PRICES, costOf, estimateAskCost, estimateLiveCost, priceOf, speechCostPerMinute } from "@/lib/apa/pure";
