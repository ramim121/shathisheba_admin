import { queryRows } from "@/lib/db";
import { currentPeriod } from "@/lib/apa/entitlement";
import type { ApaConfig } from "@/lib/apa/config";
import { budgetBands, type BudgetBand } from "@/lib/apa/pure";

/**
 * The spend ceiling, enforced.
 *
 * ## Why this file had to exist the day billing was switched on
 *
 * Until 2026-09-19 this project ran on the free tier, where the brake was the
 * quota: when the day's 1,500 requests were gone, Google refused, and the worst
 * case was an assistant that stopped answering. Enabling billing removed that
 * brake. There is now no upstream limit at all — a retry loop, a stuck cron or
 * a leaked key does not get refused, it gets *invoiced*.
 *
 * A Google Cloud budget does not close the gap. It is an **alert**: it emails a
 * threshold crossing and keeps serving. Capping spend requires a stop of our
 * own, on this side of the API call, which is what this is.
 *
 * ## Degradation, not an outage
 *
 * The obvious design — refuse everything at 100% — turns a billing ceiling into
 * a product outage, and does it silently on the one day of the month when
 * farmers are most likely to be told the app is broken. So the bands switch off
 * spending in the order of *what costs most per unit of usefulness*:
 *
 *   normal    everything on
 *   tight     the overnight pre-warm stops (it is speculative spend — it pays
 *             for answers nobody has asked for yet, so it is the first thing
 *             that should go and the last thing anyone will miss)
 *   critical  live conversation stops (~$0.023/minute, two orders of magnitude
 *             above a typed question) and read-aloud falls back to the phone's
 *             own voice, which is free
 *   spent     no new model calls — but answer-cache hits are still served,
 *             because they cost nothing, and the phone still speaks them
 *
 * So at the ceiling the assistant still answers today's common questions in
 * her own voice. That is a materially different product from "Shathi Apa is
 * unavailable", for the same money.
 *
 * ## Fail open, deliberately
 *
 * If the spend query fails, questions are allowed through. That looks wrong for
 * a money guard, so the reasoning matters: exposure while blind is bounded by
 * the limits that do not depend on this file — `apa_ask_per_minute` per farmer,
 * the fair-share day cap, and the live monthly minute quota. At 50 farmers and
 * a measured ~$0.0002 per typed answer, a full blind day is a few cents. A
 * guard that takes the assistant down whenever MySQL hiccups would cost more
 * than it saves.
 *
 * The number itself lives in `app_settings.apa_budget_usd` so it can be raised
 * from the admin console without a deploy — $10 for the build and test window,
 * $20–30 once 50 farmers are on it.
 */

export type BudgetState = {
  budgetUsd: number;
  spentUsd: number;
  leftUsd: number;
  pct: number;
  band: BudgetBand;
  /** Live conversation may be minted. */
  allowLive: boolean;
  /** Server-side TTS may be called; false means use the phone's voice. */
  allowServerTts: boolean;
  /** The overnight pre-warm may run. */
  allowPrewarm: boolean;
  /** Fresh model calls are allowed at all; false still permits cache hits. */
  allowFresh: boolean;
  /** Set when the figure could not be read — everything is allowed. */
  blind: boolean;
};

/**
 * Month-to-date spend, from the rows already written per turn.
 *
 * Cached for a minute because it is read on the path of every question and the
 * answer cannot move far in that time: a whole minute of the pilot's traffic at
 * the per-minute rate limit is well under a cent.
 */
let cache: { at: number; period: string; usd: number } | null = null;
const TTL_MS = 60_000;

export async function monthSpend(): Promise<number> {
  const period = currentPeriod();
  if (cache && cache.period === period && Date.now() - cache.at < TTL_MS) return cache.usd;

  const [row] = await queryRows<Record<string, unknown>>(
    "SELECT COALESCE(SUM(est_cost_usd), 0) AS usd FROM apa_usage WHERE period = ?",
    [period]
  );
  const usd = Number(row?.usd ?? 0);
  cache = { at: Date.now(), period, usd };
  return usd;
}

/**
 * Drop the cached figure.
 *
 * Called after the budget is changed in the console, so the new ceiling takes
 * effect on the next question rather than up to a minute later — an operator
 * raising the limit to unblock the pilot should not have to wonder whether it
 * worked.
 */
export function forgetSpend(): void {
  cache = null;
}

export async function budgetState(cfg: ApaConfig): Promise<BudgetState> {
  const budgetUsd = cfg.budgetUsd;

  // A budget of zero means "not configured", not "spend nothing". Reading it
  // the other way would take the assistant down on a fresh database.
  if (!budgetUsd) {
    return {
      budgetUsd: 0, spentUsd: 0, leftUsd: 0, pct: 0, band: "normal",
      allowLive: true, allowServerTts: true, allowPrewarm: true, allowFresh: true, blind: false,
    };
  }

  let spentUsd: number;
  try {
    spentUsd = await monthSpend();
  } catch (error) {
    console.error("apa budget read failed — allowing spend", error);
    return {
      budgetUsd, spentUsd: 0, leftUsd: budgetUsd, pct: 0, band: "normal",
      allowLive: true, allowServerTts: true, allowPrewarm: true, allowFresh: true, blind: true,
    };
  }

  // The arithmetic lives in pure.ts so that it can be tested without a
  // database. This file is the part that knows where the numbers come from.
  return {
    budgetUsd,
    spentUsd,
    leftUsd: Math.max(0, budgetUsd - spentUsd),
    ...budgetBands(spentUsd, budgetUsd),
    blind: false,
  };
}

export type { BudgetBand };

/**
 * What to tell a farmer when the month's budget is gone.
 *
 * Bengali, and about her rather than about us: she does not need to know that a
 * platform ceiling was reached, only that today's answer is not coming and that
 * the officer is. Naming the officer is the point — it is the fallback that
 * actually resolves her problem.
 */
export const BUDGET_SPENT_MESSAGE =
  "এই মাসের প্রশ্নের সীমা শেষ হয়েছে। জরুরি প্রয়োজনে আপনার মাঠকর্মীকে ফোন করুন — সামনের মাসে আবার খুলে যাবে।";
