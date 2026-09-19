import { executeQuery, queryRows } from "@/lib/db";
import { costOf } from "@/lib/apa/pure";
import { friendlyModelError } from "@/lib/apa/client";
import { retrySeconds } from "@/lib/apa/pure";

// Re-exported: it lives in pure.ts so that client.ts can use it too without
// the two files importing each other.
export { retrySeconds };

/**
 * Which model actually answers, and what it cost.
 *
 * The free tier caps requests **per model, per project, per day** — measured:
 * `gemini-3.6-flash` reports `quotaValue: 20`. A single configured model
 * therefore gives the whole platform twenty questions a day and then stops,
 * which is not a service. But the cap being per *model* means a chain of models
 * multiplies the usable headroom without a second project and without going
 * anywhere near Google's terms on circumventing quota.
 *
 * So every model setting is a comma-separated chain. The first entry is the one
 * we want; the rest are what answers when it is spent. Three kinds of failure
 * are told apart, because they need opposite responses:
 *
 *   - **daily quota exhausted** — never retry this model today. Move to the
 *     next in the chain immediately, and remember the refusal so the next
 *     request skips it without spending a round trip to find out.
 *   - **per-minute quota** — the same model will work shortly. One short wait,
 *     then try it again.
 *   - **transient 5xx** — one retry, then move on.
 *
 * Retrying a *daily* quota error was the bug this replaces: `retrying()` made
 * two attempts at everything, so a 20-request cap delivered ten answers.
 */

type Row = Record<string, unknown>;

export type ModelJob = "classify" | "answer" | "vision" | "tts" | "transcribe" | "live";

export type ModelUsage = { tokensIn?: number; tokensOut?: number; cachedTokens?: number };

export type ModelAttempt<T> = {
  result: T;
  model: string;
  /** Models that refused before this one answered. */
  skipped: string[];
  latencyMs: number;
};

/** Split a setting like "a,b,c" into a chain, dropping blanks and duplicates. */
export function modelChain(setting: string, fallback: string): string[] {
  const chain = String(setting || fallback)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return Array.from(new Set(chain.length ? chain : [fallback]));
}

/** The first model in a chain, for the places that only need a label. */
export function primaryModel(setting: string, fallback: string): string {
  return modelChain(setting, fallback)[0];
}

/* ---------------------------------------------------------------------------
   Telling the failures apart
   --------------------------------------------------------------------------- */

export type FailureKind = "daily_quota" | "minute_quota" | "transient" | "fatal";

/**
 * Google's 429 body distinguishes the two quota kinds in `quotaId`:
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier` versus the per-minute
 * variants. Without reading that, a daily cap and a momentary burst look
 * identical and get handled identically — which is how a day's quota gets
 * spent on retries.
 */
/**
 * What each model is allowed in a day on the free tier.
 *
 * **Observed, not published.** Google's rate-limit page defers to AI Studio,
 * so `observed: true` means this project has actually seen a 429 quoting that
 * figure and `observed: false` means we assumed it from the model's tier. An
 * assumed number is fine for planning and must never be presented as fact —
 * the console labels every row accordingly.
 *
 * This lives here rather than in the console because two things need it now:
 * the page that displays it, and the fair-share guard that rations the last of
 * the day's allowance.
 */
export type Allowance = {
  /** Requests per minute. */
  rpm: number | null;
  /** Requests per day. */
  rpd: number | null;
  /** How each figure was arrived at, shown in the console. */
  source: "observed" | "published" | "assumed";
};

/**
 * What each model's free tier allows — per minute **and** per day.
 *
 * ## Read this before trusting a 429
 *
 * Google's quota payload cannot be taken at face value, and reading it wrongly
 * cost this project a day of bad conclusions. The same metric name carries both
 * limits:
 *
 *     quotaMetric: generativelanguage.googleapis.com/generate_content_free_tier_requests
 *
 * and the id that distinguishes them is not always the one you expect:
 *
 *     GenerateRequestsPerMinutePerProjectPerModel-FreeTier   limit 15, retry 26s
 *     GenerateRequestsPerDayPerProjectPerModel-FreeTier      limit 20, retry 18s
 *
 * Both arrive as HTTP 429 with a retry delay in seconds. Reading the first as a
 * daily cap produced "gemini-3.5-flash-lite allows 15 requests a day", which is
 * wrong by two orders of magnitude — it allows 15 a *minute* and 1,500 a day.
 * Measured directly: 16 calls fired flat out gets a 429 quoting 15, and the
 * same model then serves 25 more when they are paced 5 seconds apart.
 *
 * `classifyFailure` therefore discriminates on the **retry delay**, not on the
 * quota name. See the note there.
 *
 * ## Which figures are real
 *
 *   * `observed`  — this project has seen a 429 quoting it, with the matching
 *                   quotaId, and the behaviour is consistent with it.
 *   * `published` — from Google's own free-tier table. Not verified here, and
 *                   they change it without announcement.
 *   * `assumed`   — neither. A planning number; the console says so.
 *
 * Measuring the daily figure costs a whole day's allowance for that model,
 * which is why most of them are `published` rather than `observed`. The probe
 * that does it is `Resources/apa-probes/limits.cjs --rpd`.
 */
export const FREE_LIMITS: Record<string, Allowance> = {
  // 15 RPM observed (quotaId says PerMinute); 1,500 RPD is Google's figure and
  // is consistent with 25 calls served in 2.3 minutes without a daily 429.
  "gemini-3.5-flash-lite": { rpm: 15, rpd: 1500, source: "observed" },
  // 15 RPM observed the same way; 1,000 RPD published. Served 40+ in a day.
  "gemini-3.1-flash-lite": { rpm: 15, rpd: 1000, source: "observed" },

  // These two 429 with a quotaId that genuinely says PerDay, at limit 20, after
  // about that many calls in a day. Small daily caps on heavier models.
  "gemini-2.5-flash": { rpm: null, rpd: 20, source: "observed" },
  "gemini-3.6-flash": { rpm: null, rpd: 20, source: "observed" },

  // Same family as 3.6; not separately observed. Both have answered 503 "high
  // demand" more often than they have answered anything else.
  "gemini-3.5-flash": { rpm: 10, rpd: 20, source: "assumed" },
  "gemini-3.7-flash": { rpm: 10, rpd: 20, source: "assumed" },
  "gemini-3.8-flash": { rpm: 10, rpd: 20, source: "assumed" },

  // The specialised models. Neither dimension has been observed: both still had
  // headroom after a day of use, and probing the daily figure would spend it.
  // The text-to-speech allowance is the most valuable unmeasured number here,
  // because spoken output is the largest line in the bill.
  "gemini-3.5-transcribe": { rpm: null, rpd: null, source: "assumed" },
  "gemini-2.5-flash-preview-tts": { rpm: null, rpd: null, source: "assumed" },
  "gemini-3.1-flash-tts-preview": { rpm: null, rpd: null, source: "assumed" },

  "gemma-4-31b-it": { rpm: 30, rpd: 14400, source: "assumed" },

  // 404 for new projects since 2026; Google names 3.5-flash-lite instead.
  "gemini-2.5-flash-lite": { rpm: 0, rpd: 0, source: "observed" }
};

export function freeLimits(model: string): Allowance | null {
  return FREE_LIMITS[model] ?? null;
}

/**
 * How many answering requests the project can still make today.
 *
 * Summed across the chain, because that is the point of the chain: each model
 * has its own separate allowance. A model whose daily figure is unknown
 * contributes nothing to the total rather than a guess, so this reads low
 * rather than optimistically — which is the right direction for a number used
 * to decide whether to start rationing.
 */
export async function dayHeadroom(chain: string[]): Promise<{
  cap: number;
  used: number;
  left: number;
  pct: number;
  unknown: string[];
}> {
  const rows = await queryRows<Row>(
    `SELECT model, calls FROM apa_model_calls WHERE for_day = ? AND model IN (${chain.map(() => "?").join(", ") || "''"})`,
    [today(), ...chain]
  );
  const used = rows.reduce((sum, row) => sum + Number(row.calls ?? 0), 0);
  let cap = 0;
  const unknown: string[] = [];
  for (const model of chain) {
    const rpd = FREE_LIMITS[model]?.rpd;
    if (typeof rpd === "number") cap += rpd;
    else unknown.push(model);
  }
  return {
    cap,
    used,
    left: Math.max(0, cap - used),
    pct: cap ? Math.min(100, Math.round((used / cap) * 100)) : 0,
    unknown
  };
}



/**
 * Models that reject `thinkingConfig` outright.
 *
 * Measured, and it matters more than it looks. We send `thinkingBudget: 0`
 * everywhere, because thinking on a scope-gate call burned the whole output
 * budget and returned `MAX_TOKENS` with no text — which the parser then read as
 * "ambiguous", which allows. So the field is load-bearing.
 *
 * But three models on this key refuse it:
 *
 *     gemini-3.5-flash-lite   400 "Request contains an invalid argument."
 *     gemma-4-31b-it          400 "Thinking budget is not supported for this model."
 *     gemma-4-26b-a4b-it      400 "Thinking budget is not supported for this model."
 *
 * A 400 is classified `fatal`, and `fatal` **stops the chain**. So configuring
 * any of those as a fallback would not merely fail to help — it would turn a
 * recoverable quota error into a dead end, which is the opposite of what the
 * chain is for. Hence the field is omitted per model rather than sent blindly.
 *
 * `gemini-3.5-flash-lite` is the one that matters: it is Google's named
 * replacement for `gemini-2.5-flash-lite`, which now 404s for new projects.
 */
const NO_THINKING_BUDGET = new Set([
  // "Request contains an invalid argument."
  "gemini-3.5-flash-lite",
  // "Thinking budget is not supported for this model."
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it",
  // "Thinking is not enabled for this model" — the speech and transcription
  // models. Nothing sends them a thinkingConfig today, because tts.ts and
  // transcribe.ts build their own requests; they are listed so that the day
  // one of them moves onto the shared chain runner it does not 400 on arrival.
  "gemini-3.5-transcribe",
  "gemini-3.5-transcribe-live",
  "gemini-2.5-flash-preview-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-pro-preview-tts"
]);

/**
 * The thinking config to send to this particular model — `{}` where the model
 * would reject the field. Spread into a request config.
 */
export function thinkingFor(model: string): { thinkingConfig?: { thinkingBudget: number } } {
  return NO_THINKING_BUDGET.has(model) ? {} : { thinkingConfig: { thinkingBudget: 0 } };
}

/**
 * How many answering requests the whole project can still make today.
 *
 * Summed across the chain, because that is the point of the chain: when the
 * first model is spent the next one has its own separate allowance. A model
 * whose ceiling nobody has observed still counts — leaving it out would
 * understate the headroom and ration the service earlier than necessary.
 */




/**
 * What kind of failure this was, and therefore what to do about it.
 *
 * **Read the retry delay, not the quota name.** This function used to test the
 * message for `PerDay` and `free_tier_requests` and return `daily_quota` on a
 * match — which was wrong on both counts, because Google names the per-minute
 * limit
 *
 *     quotaId:     GenerateRequestsPerDayPerProjectPerModel-FreeTier
 *     quotaMetric: generativelanguage.googleapis.com/generate_content_free_tier_requests
 *     quotaValue:  15
 *     retryDelay:  18s
 *
 * The id says "PerDay", the metric says "free_tier_requests", and the thing
 * clears in eighteen seconds. Measured: `gemini-3.5-flash-lite` 429s with
 * `limit: 15` after fifteen calls in a minute, and then serves 25 more without
 * complaint when the calls are spaced five seconds apart. Its real daily
 * allowance is 1,500.
 *
 * The consequence of the old behaviour was not cosmetic: a per-minute limit
 * classified as `daily_quota` made the runner mark the model spent for a whole
 * hour, so a burst of traffic pushed every answer for the next hour onto a
 * slower, worse fallback — and the console reported the primary as exhausted.
 *
 * So: a 429 with a short retry delay is a minute limit, and a 429 with a long
 * one or none is a daily cap. Nothing else is trusted to tell them apart.
 */
export function classifyFailure(error: unknown): FailureKind {
  const raw = error instanceof Error ? error.message : String(error);
  const rateLimited = /429|RESOURCE_EXHAUSTED|exceeded your current quota|rate.?limit/i.test(raw);

  if (rateLimited) {
    const wait = retrySeconds(raw);
    // Anything Google expects to clear inside two minutes is a per-minute
    // limit, whatever the quota is named.
    if (wait !== null) return wait <= 120 ? "minute_quota" : "daily_quota";
    // An explicit per-minute marker, for the shapes that carry one.
    if (/PerMinute|per_minute|RequestsPerMinute/i.test(raw)) return "minute_quota";
    // A 429 that says nothing about when to come back. Treated as the daily
    // kind because moving to the next model costs one request, while retrying
    // a genuinely spent cap costs every request left in the burst.
    return "daily_quota";
  }

  if (/(500|502|503|504)|UNAVAILABLE|overloaded|high demand|INTERNAL|timeout|abort|ECONNRESET|fetch failed/i.test(raw)) {
    return "transient";
  }
  return "fatal";
}


/* ---------------------------------------------------------------------------
   Remembering a spent model, so we stop asking
   --------------------------------------------------------------------------- */

// Per-process, deliberately: it is a hint, not a source of truth, and the
// authoritative record is apa_model_calls. Worst case a fresh process spends
// one request rediscovering what the previous one knew.
const spent = new Map<string, number>();

function isSpent(model: string): boolean {
  const until = spent.get(model);
  if (!until) return false;
  if (Date.now() > until) {
    spent.delete(model);
    return false;
  }
  return true;
}

function markSpent(model: string) {
  // Google's daily quotas reset at midnight Pacific. Rather than compute that
  // and risk being wrong about a timezone, the model is skipped for an hour and
  // then given another chance — one wasted request an hour is affordable.
  spent.set(model, Date.now() + 60 * 60 * 1000);
}

/**
 * Models that have just hit their **per-minute** limit.
 *
 * Kept apart from `spent` because the two need opposite responses and
 * conflating them was a real bug: a per-minute limit was being classified as a
 * daily cap, which benched the primary model for an hour over something that
 * clears in eighteen seconds.
 *
 * A minute limit is a reason to use the next model *now*, not to wait — a
 * farmer would rather have a good-enough answer in three seconds than a
 * slightly better one in twenty. But it is still worth remembering for those
 * few seconds, so that the requests arriving behind this one skip the model
 * instead of each discovering the limit for themselves.
 */
const cooling = new Map<string, number>();

function isCooling(model: string): boolean {
  const until = cooling.get(model);
  if (!until) return false;
  if (Date.now() > until) {
    cooling.delete(model);
    return false;
  }
  return true;
}

/** Seconds until this model is worth trying again, or null if it is ready. */
function coolingFor(model: string): number | null {
  const until = cooling.get(model);
  if (!until) return null;
  const left = until - Date.now();
  return left > 0 ? left : null;
}

function markCooling(model: string, advisedSeconds: number | null) {
  // Google's own figure where it gave one, bounded so a malformed delay cannot
  // park a model for minutes.
  const ms = advisedSeconds === null
    ? MINUTE_WAIT_MS
    : Math.min(90_000, Math.max(1_000, Math.ceil(advisedSeconds * 1000) + 500));
  cooling.set(model, Date.now() + ms);
}

/** Cleared by the console when a key is changed or billing is enabled. */
export function forgetSpentModels() {
  spent.clear();
  cooling.clear();
}

export function spentModels(): string[] {
  return Array.from(spent.keys()).filter(isSpent);
}

/** Models rate-limited for the next few seconds, for the console. */
export function coolingModels(): Array<{ model: string; seconds: number }> {
  return Array.from(cooling.keys())
    .filter(isCooling)
    .map((model) => ({ model, seconds: Math.ceil((coolingFor(model) ?? 0) / 1000) }));
}

/* ---------------------------------------------------------------------------
   Accounting
   --------------------------------------------------------------------------- */

const today = () => new Date().toISOString().slice(0, 10);

async function record(input: {
  model: string;
  job: ModelJob;
  outcome: "ok" | "daily_quota" | "other";
  usage?: ModelUsage;
  error?: string;
}) {
  const usage = input.usage ?? {};
  const cost =
    input.outcome === "ok"
      ? costOf({
          model: input.model,
          tokensIn: usage.tokensIn ?? 0,
          tokensOut: usage.tokensOut ?? 0,
          cachedTokens: usage.cachedTokens ?? 0,
        })
      : 0;
  try {
    await executeQuery(
      `INSERT INTO apa_model_calls
         (model, job, for_day, calls, ok_calls, quota_errors, other_errors,
          tokens_in, tokens_out, cached_tokens, est_cost_usd, last_error, last_quota_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         calls = calls + 1,
         ok_calls = ok_calls + VALUES(ok_calls),
         quota_errors = quota_errors + VALUES(quota_errors),
         other_errors = other_errors + VALUES(other_errors),
         tokens_in = tokens_in + VALUES(tokens_in),
         tokens_out = tokens_out + VALUES(tokens_out),
         cached_tokens = cached_tokens + VALUES(cached_tokens),
         est_cost_usd = est_cost_usd + VALUES(est_cost_usd),
         last_error = COALESCE(VALUES(last_error), last_error),
         last_quota_at = COALESCE(VALUES(last_quota_at), last_quota_at)`,
      [
        input.model.slice(0, 80),
        input.job,
        today(),
        input.outcome === "ok" ? 1 : 0,
        input.outcome === "daily_quota" ? 1 : 0,
        input.outcome === "other" ? 1 : 0,
        usage.tokensIn ?? 0,
        usage.tokensOut ?? 0,
        usage.cachedTokens ?? 0,
        cost,
        input.error?.slice(0, 255) ?? null,
        input.outcome === "daily_quota" ? new Date() : null,
      ]
    );
  } catch (error) {
    // Accounting must never take an answer down with it.
    console.error("apa model accounting failed", error);
  }
}

/** What the console's quota panel reads. */
export async function modelCallsToday(): Promise<Row[]> {
  return queryRows<Row>(
    `SELECT model, job, calls, ok_calls, quota_errors, other_errors,
            tokens_in, tokens_out, cached_tokens, est_cost_usd, last_error, last_quota_at, updated_at
       FROM apa_model_calls
      WHERE for_day = ?
      ORDER BY calls DESC`,
    [today()]
  );
}

export async function modelCallsTrend(days = 14): Promise<Row[]> {
  return queryRows<Row>(
    `SELECT for_day, SUM(calls) AS calls, SUM(ok_calls) AS ok_calls,
            SUM(quota_errors) AS quota_errors, SUM(est_cost_usd) AS cost
       FROM apa_model_calls
      WHERE for_day > CURDATE() - INTERVAL ? DAY
      GROUP BY for_day ORDER BY for_day`,
    [days]
  );
}

/* ---------------------------------------------------------------------------
   The runner
   --------------------------------------------------------------------------- */

const MINUTE_WAIT_MS = 4000;

/**
 * Run `call` against the first model in the chain that will answer.
 *
 * `call` receives a model name and returns its result plus, where the API gave
 * them, the token counts — which are what make the cost figure real rather than
 * estimated.
 */
export async function runWithChain<T>(input: {
  job: ModelJob;
  chain: string[];
  call: (model: string) => Promise<{ value: T; usage?: ModelUsage }>;
}): Promise<ModelAttempt<T>> {
  const skipped: string[] = [];
  const started = Date.now();
  let lastError: unknown = new Error("no model in the chain was reachable");
  // Models this attempt found rate-limited, so the last resort below knows
  // waiting is worth trying rather than hopeless.
  const limited: string[] = [];

  const tryModel = async (model: string): Promise<{ done: true; value: T } | { done: false }> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { value, usage } = await input.call(model);
        await record({ model, job: input.job, outcome: "ok", usage });
        return { done: true, value };
      } catch (error) {
        lastError = error;
        const kind = classifyFailure(error);
        const message = error instanceof Error ? error.message : String(error);

        if (kind === "daily_quota") {
          markSpent(model);
          await record({ model, job: input.job, outcome: "daily_quota", error: message });
          skipped.push(`${model} (daily quota)`);
          return { done: false };
        }
        if (kind === "minute_quota") {
          // Do not wait here. The next model in the chain has its own
          // per-minute allowance and will answer now; a farmer would rather
          // have a good-enough answer in three seconds than a marginally
          // better one in twenty.
          markCooling(model, retrySeconds(message));
          limited.push(model);
          await record({ model, job: input.job, outcome: "other", error: message });
          skipped.push(`${model} (rate limited)`);
          return { done: false };
        }
        if (kind === "transient" && attempt === 0) {
          await record({ model, job: input.job, outcome: "other", error: message });
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        await record({ model, job: input.job, outcome: "other", error: message });
        skipped.push(`${model} (${kind})`);
        return { done: false };
      }
    }
    return { done: false };
  };

  for (const model of input.chain) {
    if (isSpent(model)) {
      skipped.push(`${model} (known spent)`);
      continue;
    }
    if (isCooling(model)) {
      skipped.push(`${model} (rate limited, ${Math.ceil((coolingFor(model) ?? 0) / 1000)}s)`);
      limited.push(model);
      continue;
    }
    const out = await tryModel(model);
    if (out.done) return { result: out.value, model, skipped, latencyMs: Date.now() - started };
  }

  // Every model was either spent, rate limited, or failed. If any of them was
  // only rate limited then waiting is the difference between an answer and an
  // error — which matters most for a single-model chain like transcription,
  // where there is nothing to fall through to.
  const waitable = input.chain.filter((m) => limited.includes(m) && !isSpent(m));
  if (waitable.length) {
    const model = waitable[0];
    const wait = Math.min(90_000, coolingFor(model) ?? MINUTE_WAIT_MS);
    await new Promise((r) => setTimeout(r, wait));
    cooling.delete(model);
    const out = await tryModel(model);
    if (out.done) return { result: out.value, model, skipped, latencyMs: Date.now() - started };
  }

  throw friendlyModelError(lastError);
}

/** Token counts out of a generateContent response, whatever shape it arrived in. */
export function usageOf(response: unknown): ModelUsage {
  const u = (response as { usageMetadata?: Row } | null)?.usageMetadata ?? {};
  return {
    tokensIn: Number(u.promptTokenCount ?? 0),
    tokensOut: Number(u.candidatesTokenCount ?? 0),
    cachedTokens: Number(u.cachedContentTokenCount ?? 0),
  };
}
