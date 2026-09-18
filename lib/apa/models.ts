import { executeQuery, queryRows } from "@/lib/db";
import { costOf } from "@/lib/apa/pure";
import { friendlyModelError } from "@/lib/apa/client";

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
export const FREE_RPD: Record<string, { rpd: number; observed: boolean }> = {
  // --- observed: this project has seen a 429 quoting the figure -------------
  //
  // Read this table before choosing a primary model. The quality ranking and
  // the allowance ranking are close to inverted, which is the single most
  // important fact about serving farmers on this tier.
  //
  // gemini-3.5-flash-lite is the best model measured (11/11 on the capability
  // battery, 6/6 on restraint, ~1.4s) and allows **fifteen requests a day**.
  // gemini-3.1-flash-lite is measurably worse (9/11, 5/6, ~3.2s) and is the
  // only model here that can carry real volume. Neither is "the right choice";
  // the chain is, in that order — the first fifteen questions of the day get
  // the better answer and everything after falls through to the one that can
  // actually serve it.
  "gemini-3.5-flash-lite": { rpd: 15, observed: true },
  "gemini-2.5-flash": { rpd: 20, observed: true },
  "gemini-3.6-flash": { rpd: 20, observed: true },

  // --- assumed: no 429 seen yet --------------------------------------------
  //
  // gemini-3.1-flash-lite served more than forty requests in a day without
  // complaint, so its ceiling is at least that and the figure below is a
  // placeholder rather than a measurement. It is the model the service
  // actually runs on, so its real allowance is the most valuable unknown left
  // on this list.
  "gemini-3.1-flash-lite": { rpd: 1000, observed: false },
  "gemini-3.5-flash": { rpd: 20, observed: false },
  "gemini-3.8-flash": { rpd: 20, observed: false },
  "gemini-3.7-flash": { rpd: 20, observed: false },
  "gemini-3.5-transcribe": { rpd: 100, observed: false },
  "gemini-2.5-flash-preview-tts": { rpd: 100, observed: false },
  "gemini-3.1-flash-tts-preview": { rpd: 100, observed: false },
  "gemma-4-31b-it": { rpd: 14400, observed: false },

  // --- retired --------------------------------------------------------------
  // 404 for new projects since 2026; Google names 3.5-flash-lite instead.
  "gemini-2.5-flash-lite": { rpd: 0, observed: true }
};

export function freeRpd(model: string): { rpd: number; observed: boolean } | null {
  return FREE_RPD[model] ?? null;
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
export async function dayHeadroom(chain: string[]): Promise<{ cap: number; used: number; left: number; pct: number }> {
  const rows = await queryRows<Row>(
    `SELECT model, calls FROM apa_model_calls WHERE for_day = ? AND model IN (${chain.map(() => "?").join(", ") || "''"})`,
    [today(), ...chain]
  );
  const used = rows.reduce((sum, row) => sum + Number(row.calls ?? 0), 0);
  const cap = chain.reduce((sum, model) => sum + (FREE_RPD[model]?.rpd ?? 0), 0);
  return {
    cap,
    used,
    left: Math.max(0, cap - used),
    pct: cap ? Math.min(100, Math.round((used / cap) * 100)) : 0
  };
}

export function classifyFailure(error: unknown): FailureKind {
  const raw = error instanceof Error ? error.message : String(error);
  if (/PerDay|RequestsPerDay|per_day|free_tier_requests/i.test(raw)) return "daily_quota";
  if (/\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota|rate.?limit/i.test(raw)) {
    // A 429 with no quotaId at all is safer treated as the daily kind: moving
    // to the next model costs one request, retrying a spent cap costs the rest.
    return /PerMinute|per_minute|retry in \d+(\.\d+)?s/i.test(raw) ? "minute_quota" : "daily_quota";
  }
  if (/\b(500|502|503|504)\b|UNAVAILABLE|overloaded|high demand|INTERNAL|timeout|abort|ECONNRESET|fetch failed/i.test(raw)) {
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

/** Cleared by the console when a key is changed or billing is enabled. */
export function forgetSpentModels() {
  spent.clear();
}

export function spentModels(): string[] {
  return Array.from(spent.keys()).filter(isSpent);
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

  for (const model of input.chain) {
    if (isSpent(model)) {
      skipped.push(`${model} (known spent)`);
      continue;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { value, usage } = await input.call(model);
        await record({ model, job: input.job, outcome: "ok", usage });
        return { result: value, model, skipped, latencyMs: Date.now() - started };
      } catch (error) {
        lastError = error;
        const kind = classifyFailure(error);
        const message = error instanceof Error ? error.message : String(error);

        if (kind === "daily_quota") {
          markSpent(model);
          await record({ model, job: input.job, outcome: "daily_quota", error: message });
          skipped.push(`${model} (daily quota)`);
          break; // next model, not another attempt at this one
        }
        if (kind === "minute_quota" && attempt === 0) {
          await record({ model, job: input.job, outcome: "other", error: message });
          await new Promise((r) => setTimeout(r, MINUTE_WAIT_MS));
          continue; // same model, once
        }
        if (kind === "transient" && attempt === 0) {
          await record({ model, job: input.job, outcome: "other", error: message });
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        await record({ model, job: input.job, outcome: "other", error: message });
        skipped.push(`${model} (${kind})`);
        break;
      }
    }
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
