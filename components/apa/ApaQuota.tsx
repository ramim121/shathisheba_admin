"use client";

import { useState } from "react";
import { AlertTriangle, Download, RotateCcw } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import {
  Bar, Empty, Failed, Loading, MetricBand, n, num, post, s, useApi, type Row
} from "@/components/apa/shared";
import "@/components/apa/apa-console.css";

/**
 * How many requests went where today, and how much of the day's allowance is
 * left.
 *
 * This page exists because of a property of the free tier that nothing else in
 * the console could show: Google caps requests **per model, per project, per
 * day**. Measured on this project's own key, `gemini-3.6-flash` reports
 * `quotaValue: 20` — twenty questions a day, for everybody, and then the
 * assistant starts telling farmers it is busy.
 *
 * That makes "how many calls have we made" a meaningless question unless it is
 * asked per model, which is what the Usage page could not do. It also makes the
 * fallback chain the thing that actually keeps the service up: when the first
 * model in a chain is spent, the next one has its own separate allowance. So
 * the chains are on this page too, with the model currently carrying the work
 * marked, because a chain silently running on its last entry is the warning
 * that matters.
 *
 * On the honesty of the numbers: the per-day figures are **observed, not
 * published**. Google's rate-limit documentation now defers to AI Studio, so
 * each row says whether its ceiling is one this project has actually seen in a
 * 429 or one we have assumed from the model's tier. An assumed figure is a
 * planning number and is labelled as such rather than shown as fact.
 */

type Model = Row & {
  model: string;
  jobs: string[];
  configured_for: string[];
  in_use: boolean;
  is_primary: boolean;
  calls: number;
  ok_calls: number;
  quota_errors: number;
  other_errors: number;
  tokens_in: number;
  tokens_out: number;
  cached_tokens: number;
  est_cost_usd: number;
  last_error: string | null;
  free_rpd: number | null;
  free_rpm: number | null;
  limit_source: "observed" | "published" | "assumed";
  free_rpd_observed: boolean;
  remaining: number | null;
  used_pct: number | null;
  exhausted: boolean;
};

type Quota = {
  day: string;
  resets_at: { utc: string; dhaka: string; hours_away: number };
  tts_mode: string;
  chains: Record<string, string[]>;
  /** job → model → calls, so a chain row shows that job's own count. */
  job_calls: Record<string, Record<string, number>>;
  models: Model[];
  totals: { calls: number; ok: number; quota: number; other: number; cost: number; cached: number };
  answers: {
    total: number;
    from_cache: number;
    from_model: number;
    cache_pct: number;
    clarifications: number;
  };
  trend: Row[];
  cache: {
    answers: Row;
    speech: Row;
    top: Row[];
  };
  exhausted: string[];
  cooling: Array<{ model: string; seconds: number }>;
};

const money = (v: unknown) => `$${n(v).toFixed(4)}`;

/**
 * A short day label for the trend, e.g. "17 Sep".
 *
 * `for_day` is a DATE and mysql2 hands it back as a JS Date, so
 * `String(row.for_day).slice(5)` put "09-17T18:00:00.000Z" under every bar. It
 * looked like a bug because it was one.
 */
function dayLabel(value: unknown): string {
  const at = value instanceof Date ? value : new Date(s(value));
  if (Number.isNaN(at.getTime())) return s(value).slice(0, 10);
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * The useful part of an upstream error.
 *
 * Gemini returns its whole JSON body, and the errors column was showing three
 * lines of it — an opening brace, a code, a documentation URL. The first
 * sentence of `message` is what a staff member acts on. The untruncated text
 * stays on hover, because occasionally the tail is the interesting part.
 */
function cleanError(raw: unknown): string {
  const text = s(raw);
  const inner = text.match(/"message"\s*:\s*"([^"]{6,240})/);
  const body = (inner ? inner[1] : text).replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
  const first = body.split(". ")[0];
  return (first.length > 20 ? first : body).slice(0, 160);
}

const JOB_LABEL: Record<string, string> = {
  text: "Answering",
  answer: "Answering",
  classify: "Scope gate",
  transcribe: "Transcription",
  tts: "Read aloud",
  live: "Live conversation",
  vision: "Photo reading"
};
const jobName = (job: string) => JOB_LABEL[job] ?? job.replace(/_/g, " ");

export function ApaQuota() {
  const feed = useApi<Quota>("/api/v1/admin/apa/quota");
  const [clearing, setClearing] = useState(false);
  const [note, setNote] = useState("");

  async function clearHints() {
    setClearing(true);
    setNote("");
    try {
      const out = await post("/api/v1/admin/apa/quota/reset", {});
      setNote(
        `Cleared. ${num(out.pruned_cache_rows)} stale cached answer${n(out.pruned_cache_rows) === 1 ? "" : "s"} pruned.`
      );
      feed.reload();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setClearing(false);
    }
  }

  function exportCsv() {
    if (!feed.data) return;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Model", "Used for", "Calls", "Succeeded", "Quota errors", "Other errors", "Per day", "Per minute", "Limit source", "Remaining", "Tokens in", "Tokens out", "Cached tokens", "Estimated cost USD"]
        .map(esc)
        .join(","),
      ...feed.data.models.map((m) =>
        [
          m.model,
          (m.configured_for.length ? m.configured_for : m.jobs).map(jobName).join(" / "),
          m.calls, m.ok_calls, m.quota_errors, m.other_errors,
          m.free_rpd ?? "unknown",
          m.free_rpm ?? "unknown",
          m.limit_source,
          m.remaining ?? "unknown",
          m.tokens_in, m.tokens_out, m.cached_tokens,
          n(m.est_cost_usd).toFixed(6)
        ].map(esc).join(",")
      )
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shathi-apa-requests-${feed.data.day}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const d = feed.data;
  const answers = d?.cache.answers ?? {};
  // Counted in answers given, not requests made: one answer can be several
  // calls when a chain falls through, and none at all when the cache serves it.
  const hitPct = d?.answers.cache_pct ?? 0;

  // "At risk" is the number worth putting in a metric: a model past four fifths
  // of a cap it cannot see coming is the one that will fail during the day.
  const atRisk = (d?.models ?? []).filter(
    (m) => m.exhausted || (m.used_pct !== null && m.used_pct >= 80)
  );
  // Rate limited is a few seconds, not a day, so it is shown separately and
  // deliberately does not count toward "at risk".
  const cooling = new Map((d?.cooling ?? []).map((c) => [c.model, c.seconds]));
  const peak = Math.max(1, ...(d?.trend ?? []).map((t) => n(t.calls)));

  return (
    <AdminShell>
      <section className="page-head">
        <div>
          <p className="eyeline">Shathi Apa</p>
          <h1 className="page-title">Requests and quota</h1>
          <p className="page-sub">
            The free tier caps requests per model, per project, per day — so this is counted per
            model rather than in total. When the first model in a chain is spent the next one has
            its own separate allowance, which is what keeps the assistant answering.
          </p>
          {/* The reset time lives here rather than in the metric band: it is a
              time, not a count, and six metrics never fitted a five-column row
              so the sixth always sat alone. */}
          <p className="apa-quota-reset">
            Counters reset in <strong>{d?.resets_at.hours_away ?? "—"}h</strong>
            {d ? ` — ${d.resets_at.dhaka} Dhaka time` : ""}. Per-minute limits clear within the minute.
          </p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" type="button" onClick={exportCsv} disabled={!d}>
            <Download size={16} /> Export CSV
          </button>
          <button className="btn ghost" type="button" onClick={() => void clearHints()} disabled={clearing}>
            <RotateCcw size={16} /> {clearing ? "Clearing…" : "Clear spent-model hints"}
          </button>
        </div>
      </section>

      {feed.loading ? <Loading /> : null}
      {feed.error ? <Failed message={feed.error} onRetry={feed.reload} /> : null}
      {note ? <p className="apa-state">{note}</p> : null}

      {d ? (
        <>
          <MetricBand
            metrics={[
              { label: "Requests today", value: num(d.totals.calls), note: `${num(d.totals.ok)} succeeded` },
              {
                label: "Models at risk",
                value: num(atRisk.length),
                note: atRisk.length ? atRisk.map((m) => m.model).join(", ") : "all well inside their cap",
                tone: atRisk.length ? "tone-red" : "tone-leaf"
              },
              {
                label: "Answers from cache",
                value: `${hitPct}%`,
                note: `${num(d.answers.from_cache)} of ${num(d.answers.total)} answers today`,
                tone: "tone-leaf"
              },
              {
                label: "Asked her to clarify",
                value: num(d.answers.clarifications),
                note: "rather than guessing at a vague question",
                tone: "tone-plum"
              },
              { label: "Estimated spend today", value: money(d.totals.cost), note: "list prices, not an invoice", tone: "tone-gold" }
            ]}
          />

          {d.totals.quota > 0 ? (
            <section className="panel">
              <p className="apa-state is-bad">
                <AlertTriangle size={15} />
                {num(d.totals.quota)} request{d.totals.quota === 1 ? "" : "s"} were refused for quota today. Each
                one fell through to the next model in its chain — check the table below for which
                model is carrying the work now.
              </p>
            </section>
          ) : null}

          {/* Per model, because that is the unit the cap is applied in. */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Today, by model</h2>
                <p>
                  Every model named in a chain appears here, including ones nothing has reached yet —
                  a fallback that has never been needed should be visible rather than absent.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Used for</th>
                    <th>Calls</th>
                    <th>Daily allowance</th>
                    <th>Remaining</th>
                    <th>Tokens in / out</th>
                    <th>Cost</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {d.models.map((m) => {
                    const jobs = m.configured_for.length ? m.configured_for : m.jobs;
                    const pct = m.used_pct ?? 0;
                    return (
                      <tr key={m.model} className={m.exhausted ? "is-bad-row" : undefined}>
                        <td>
                          <div className="apa-quota-model">
                            <strong>{m.model}</strong>
                            <span className="apa-quota-tags">
                              {m.is_primary ? <em className="apa-quota-tag is-primary">first choice</em> : null}
                              {m.in_use && !m.is_primary ? <em className="apa-quota-tag">fallback</em> : null}
                              {!m.in_use ? <em className="apa-quota-tag is-off">not configured</em> : null}
                              {m.exhausted ? <em className="apa-quota-tag is-spent">daily cap reached</em> : null}
                              {cooling.has(m.model) ? (
                                <em className="apa-quota-tag is-cooling">
                                  rate limited · {cooling.get(m.model)}s
                                </em>
                              ) : null}
                            </span>
                          </div>
                        </td>
                        <td>{jobs.map(jobName).join(", ") || <span className="muted">—</span>}</td>
                        <td>{num(m.calls)}</td>
                        <td>
                          {m.free_rpd === null && m.free_rpm === null ? (
                            <span className="muted">not known</span>
                          ) : (
                            <div className="apa-quota-allow">
                              {m.free_rpd !== null ? <span>{num(m.free_rpd)} a day</span> : null}
                              {m.free_rpm !== null ? (
                                <span className="muted">{num(m.free_rpm)} a minute</span>
                              ) : null}
                              <em className={`apa-quota-src is-${m.limit_source}`}>{m.limit_source}</em>
                            </div>
                          )}
                        </td>
                        <td>
                          {m.remaining === null ? (
                            <span className="muted">—</span>
                          ) : (
                            <div className="apa-quota-left">
                              <b>{num(m.remaining)}</b>
                              <Bar pct={pct} tone={pct >= 80 ? "tone-red" : pct >= 50 ? "tone-gold" : "tone-leaf"} />
                            </div>
                          )}
                        </td>
                        <td>
                          {num(m.tokens_in)} / {num(m.tokens_out)}
                          {m.cached_tokens ? (
                            <small className="apa-quota-cached">{num(m.cached_tokens)} cached</small>
                          ) : null}
                        </td>
                        <td>{m.est_cost_usd ? money(m.est_cost_usd) : <span className="muted">—</span>}</td>
                        <td className={m.quota_errors || m.other_errors ? "is-bad" : undefined}>
                          {m.quota_errors ? `${num(m.quota_errors)} quota` : ""}
                          {m.quota_errors && m.other_errors ? " · " : ""}
                          {m.other_errors ? `${num(m.other_errors)} other` : ""}
                          {!m.quota_errors && !m.other_errors ? "—" : null}
                          {m.last_error ? (
                            <small className="apa-quota-err" title={s(m.last_error)}>
                              {cleanError(m.last_error)}
                            </small>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="apa-split">
            {/* The chains, so a job running on its last fallback is obvious. */}
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Fallback order</h2>
                  <p>
                    Tried left to right. A model that has hit its <strong>daily</strong> cap is
                    skipped for an hour; one that has hit its <strong>per-minute</strong> limit is
                    skipped only for the few seconds it takes to clear, because the next model in
                    the chain has its own allowance and can answer now. So the order shown is the
                    order it will actually be attempted in.
                  </p>
                </div>
              </div>
              <div className="apa-chains">
                {Object.entries(d.chains).map(([job, chain]) => (
                  <div className="apa-chain" key={job}>
                    <span className="apa-chain-job">{jobName(job)}</span>
                    <div className="apa-chain-links">
                      {chain.length ? (
                        chain.map((model, i) => {
                          const row = d.models.find((m) => m.model === model);
                          const spent = Boolean(row?.exhausted);
                          const cool = cooling.has(model);
                          const forThisJob = d.job_calls[job]?.[model] ?? 0;
                          return (
                            <span
                              key={model}
                              className={
                                `apa-chain-link${spent ? " is-spent" : ""}` +
                                `${cool && !spent ? " is-cooling" : ""}${i === 0 ? " is-first" : ""}`
                              }
                              title={
                                spent
                                  ? "Skipped — daily cap reached"
                                  : cool
                                    ? `Rate limited for another ${cooling.get(model)}s — the next model answers meanwhile`
                                    : undefined
                              }
                            >
                              {model}
                              {forThisJob ? <em>{num(forThisJob)}</em> : null}
                            </span>
                          );
                        })
                      ) : (
                        <span className="muted">nothing configured</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ margin: "10px 0 0" }}>
                Read aloud is currently set to <strong>{d.tts_mode}</strong>.
                {d.tts_mode === "device"
                  ? " Phones with a Bangla voice read answers themselves, so the text-to-speech models are only reached by handsets without one."
                  : " Every answer is synthesised on the server, which is the most expensive setting available."}
              </p>
            </section>

            {/* The cache is the cheapest request there is: the one not made. */}
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Answers served from cache</h2>
                  <p>
                    Fifty farmers in one upazila asking the same thing on the same morning is one
                    model call. Never across districts, never across days, never anything personal.
                    The big figure counts <strong>today</strong>; the table counts every reuse since
                    each row was written, which is why they differ.
                  </p>
                </div>
              </div>
              <div className="apa-budget">
                <div className="apa-budget-top">
                  <strong>{num(d.answers.from_cache)}</strong>
                  <span>
                    of {num(d.answers.total)} answers today needed no model call ·{" "}
                    {num(answers.rows_kept)} answers held, {num(answers.today)} written today
                  </span>
                </div>
                <Bar pct={hitPct} tone="tone-leaf" />
              </div>
              {d.cache.top.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Question</th><th>Reused, all time</th><th>Answered by</th></tr>
                    </thead>
                    <tbody>
                      {d.cache.top.map((row, i) => (
                        <tr key={`${s(row.question_norm)}-${i}`}>
                          <td className="apa-row-q">{s(row.question_norm)}</td>
                          <td>{num(row.hits)}×</td>
                          <td className="muted">{s(row.model)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="Nothing reused yet"
                  detail="An answer is only cached once a second farmer could benefit from it."
                />
              )}
              <p className="muted" style={{ margin: "10px 0 0" }}>
                Spoken audio held: {num(d.cache.speech.rows_kept)} clips,{" "}
                {num(d.cache.speech.hits)} replays,{" "}
                {(n(d.cache.speech.bytes) / 1_048_576).toFixed(1)} MB.
              </p>
            </section>
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Fourteen days</h2>
                <p>Requests a day, across every model. The shape of this is what a cap is judged against.</p>
              </div>
            </div>
            {d.trend.length ? (
              <div className="apa-trend">
                {d.trend.map((t) => (
                  <div className="apa-trend-col" key={s(t.for_day)}>
                    <b>{num(t.calls)}</b>
                    <i style={{ height: `${Math.max(2, (n(t.calls) / peak) * 100)}%` }} />
                    <span>{dayLabel(t.for_day)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No requests recorded yet" />
            )}
          </section>

          <p className="muted apa-quota-foot">
            Daily counters reset at midnight Pacific, which is {d.resets_at.dhaka} in Dhaka —{" "}
            {d.resets_at.hours_away} hours from now. Per-minute limits clear on their own within
            the minute. “Spent-model hints” are this server&apos;s in-memory note that a model has
            hit a cap; clearing them makes it retry immediately, which is what you want after
            changing the API key. An allowance marked <em>published</em> is Google&apos;s own
            figure and has not been verified here — they change it without announcement, so re-run{" "}
            <code>Resources/apa-probes/limits.cjs</code> now and again.
          </p>
        </>
      ) : null}
    </AdminShell>
  );
}
