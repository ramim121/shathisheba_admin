"use client";

import { Download } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import {
  Bar, Empty, Failed, Loading, MetricBand, clock, n, num, s, useApi, type Row
} from "@/components/apa/shared";
import "@/components/apa/apa-console.css";

/**
 * What Shathi Apa costs, while the month is still running.
 *
 * A monthly invoice from Google answers this question four weeks too late. The
 * figures here are estimates from list prices against the tokens, seconds and
 * characters we actually spent — wrong by a factor of two is still useful,
 * wrong by a factor of fifty is what having no number at all gets you.
 *
 * The tool table is the other half: a lookup that fails silently turns a
 * grounded answer into a plausible-sounding guess, and the only place that
 * becomes visible is a failure count.
 */

type Usage = {
  period: string;
  budget_usd: number;
  metrics: {
    asks: number; voice: number; photo: number; farmers: number;
    live_sessions: number; live_minutes: number; transcribe_minutes: number;
    tts_chars: number; tool_calls: number; cost_usd: number; budget_pct: number;
    cost_per_farmer: number;
  };
  trend: Row[];
  top_users: Row[];
  tools: Row[];
  sessions: Row[];
  prices: Record<string, ModelPrice>;
  speech_cost_per_minute: number;
};

type ModelPrice = {
  /** US dollars per million input tokens. */
  in: number;
  /** US dollars per million output tokens. */
  out: number;
  audioInPerMinute?: number;
  /** Measured, not published — see the note on the table. */
  audioOutTokensPerSecond?: number;
};

const money = (v: unknown) => `$${n(v).toFixed(2)}`;

/** What a model is in the list for, from its name. */
function useOf(model: string): string {
  if (model.includes("-tts")) return "reading aloud";
  if (model.includes("transcribe")) return "transcription";
  if (model.includes("live")) return "live conversation";
  if (model.startsWith("gemma")) return "free-tier fallback";
  if (model.includes("pro")) return "not used — priced for comparison";
  return "answering and photos";
}

export function ApaUsage() {
  const feed = useApi<Usage>("/api/v1/admin/apa/usage?months=6");

  function exportCsv() {
    if (!feed.data) return;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["Month", "Questions", "Live minutes", "Farmers", "Estimated cost USD"].map(esc).join(","),
      ...feed.data.trend.map((t) =>
        [s(t.period), n(t.asks), Math.round(n(t.live_seconds) / 60), n(t.farmers), n(t.cost).toFixed(4)].map(esc).join(",")
      ),
      "",
      ["Farmer", "Phone", "District", "Questions", "Voice", "Live seconds", "Estimated cost USD"].map(esc).join(","),
      ...feed.data.top_users.map((u) =>
        [s(u.full_name), s(u.phone), s(u.district), n(u.ask_count), n(u.voice_count), n(u.live_seconds), n(u.est_cost_usd).toFixed(4)]
          .map(esc)
          .join(",")
      )
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shathi-apa-usage-${feed.data.period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const m = feed.data?.metrics;
  const peak = Math.max(1, ...(feed.data?.trend ?? []).map((t) => n(t.cost)));

  return (
    <AdminShell>
      <section className="page-head">
        <div>
          <p className="eyeline">Shathi Apa</p>
          <h1 className="page-title">Usage and cost</h1>
          <p className="page-sub">
            Estimated from list prices against what was actually spent this month. The real invoice
            comes from Google; this exists to answer “are we about to be surprised” while there is
            still time to act on it.
          </p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" type="button" onClick={exportCsv} disabled={!feed.data}>
            <Download size={16} /> Export CSV
          </button>
        </div>
      </section>

      {feed.loading ? <Loading /> : null}
      {feed.error ? <Failed message={feed.error} onRetry={feed.reload} /> : null}

      {feed.data && m ? (
        <>
          <MetricBand
            metrics={[
              { label: "Questions this month", value: num(m.asks), note: `${num(m.farmers)} farmers` },
              { label: "Voice messages", value: num(m.voice), note: `${num(m.transcribe_minutes)} min transcribed`, tone: "tone-sky" },
              { label: "Live conversation", value: `${num(m.live_minutes)} min`, note: `${num(m.live_sessions)} calls`, tone: "tone-plum" },
              { label: "Estimated spend", value: money(m.cost_usd), note: `${m.budget_pct}% of $${feed.data.budget_usd}`, tone: m.budget_pct > 85 ? "tone-red" : "tone-leaf" },
              { label: "Per farmer", value: `$${m.cost_per_farmer.toFixed(3)}`, note: "this month", tone: "tone-gold" }
            ]}
          />

          <section className="panel">
            <div className="apa-budget">
              <div className="apa-budget-top">
                <strong>{money(m.cost_usd)}</strong>
                <span>of ${feed.data.budget_usd} budgeted for {feed.data.period}</span>
              </div>
              <Bar pct={m.budget_pct} tone={m.budget_pct > 85 ? "tone-red" : m.budget_pct > 60 ? "tone-gold" : "tone-leaf"} />
              <p className="muted" style={{ margin: 0 }}>
                {num(m.tool_calls)} lookups against our own data · {num(m.tts_chars)} characters read aloud ·{" "}
                {num(m.photo)} photos read
              </p>
            </div>
          </section>

          <div className="apa-split">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Six months</h2>
                  <p>Estimated spend per month.</p>
                </div>
              </div>
              {feed.data.trend.length ? (
                <div className="apa-trend">
                  {feed.data.trend.map((t) => (
                    <div className="apa-trend-col" key={s(t.period)}>
                      <b>{money(t.cost)}</b>
                      <i style={{ height: `${Math.max(2, (n(t.cost) / peak) * 100)}%` }} />
                      <span>{s(t.period).slice(5)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="Nothing spent yet" />
              )}
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>How calls ended</h2>
                  <p>Last 30 days.</p>
                </div>
              </div>
              {feed.data.sessions.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Ended</th><th>Calls</th><th>Average</th></tr>
                    </thead>
                    <tbody>
                      {feed.data.sessions.map((row) => (
                        <tr key={s(row.end_reason) || "open"}>
                          <td>{s(row.end_reason) || <span className="muted">still open</span>}</td>
                          <td>{num(row.n)}</td>
                          <td>{clock(row.avg_seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title="No live calls yet" detail="The microphone is held back until an app build can capture PCM16." />
              )}
            </section>
          </div>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Grounding lookups</h2>
                <p>
                  A tool that fails does not break the answer — it turns a grounded one into general
                  advice, marked as general. This is where that becomes visible.
                </p>
              </div>
            </div>
            {feed.data.tools.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Tool</th><th>Calls</th><th>Failures</th><th>Average</th></tr>
                  </thead>
                  <tbody>
                    {feed.data.tools.map((row) => (
                      <tr key={s(row.tool)}>
                        <td>{s(row.tool).replace(/_/g, " ")}</td>
                        <td>{num(row.calls)}</td>
                        <td className={n(row.failures) ? "is-bad" : undefined}>
                          {n(row.failures) ? `${num(row.failures)} (${Math.round((n(row.failures) / n(row.calls)) * 100)}%)` : "—"}
                        </td>
                        <td>{num(row.avg_ms)}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No lookups yet" />
            )}
          </section>

          {/* The rates every figure on this page was computed from. Without
              them the estimates are unfalsifiable, which for a number nobody
              can check against an invoice is the wrong property to have. */}
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>What each model charges</h2>
                <p>
                  List prices per million tokens, in US dollars. Every estimate on this page is
                  these rates multiplied by what was actually spent — so if one of them is out of
                  date, this is the table to correct. None of it applies while the project is on the
                  free tier, where the limit is requests a day rather than money.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Audio in</th>
                    <th>Spoken output</th>
                    <th>Used for</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(feed.data.prices)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([model, price]) => {
                      const free = price.in === 0 && price.out === 0;
                      return (
                        <tr key={model}>
                          <td><strong>{model}</strong></td>
                          <td>{free ? <span className="muted">free</span> : `$${price.in.toFixed(2)}`}</td>
                          <td>{free ? <span className="muted">free</span> : `$${price.out.toFixed(2)}`}</td>
                          <td>
                            {price.audioInPerMinute
                              ? `$${price.audioInPerMinute.toFixed(3)}/min`
                              : <span className="muted">—</span>}
                          </td>
                          <td>
                            {price.audioOutTokensPerSecond ? (
                              <>
                                {price.audioOutTokensPerSecond} tok/s
                                <small className="apa-quota-cached">
                                  ≈ ${((price.audioOutTokensPerSecond * 60 * price.out) / 1_000_000).toFixed(3)}/min ·
                                  measured
                                </small>
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="muted">{useOf(model)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ margin: "10px 0 0", padding: "0 var(--s5) var(--s4)" }}>
              Spoken output is billed in audio tokens, and how many of those a second of speech
              costs is not published — the two figures above were measured by synthesising a known
              clip and reading the token count back. Read aloud on the phone&apos;s own engine costs
              nothing at all, which is why it is the default.
            </p>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Heaviest users this month</h2>
                <p>Not a problem by itself — but the first place a runaway loop would show up.</p>
              </div>
            </div>
            {feed.data.top_users.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Farmer</th><th>District</th><th>Questions</th><th>Voice</th><th>Live</th><th>Estimated</th></tr>
                  </thead>
                  <tbody>
                    {feed.data.top_users.map((row) => (
                      <tr key={s(row.user_id)}>
                        <td>
                          {s(row.full_name) || "—"}
                          <br />
                          <small className="muted">{s(row.phone)}</small>
                        </td>
                        <td>{s(row.district) || <span className="muted">—</span>}</td>
                        <td>{num(row.ask_count)}</td>
                        <td>{num(row.voice_count)}</td>
                        <td>{clock(row.live_seconds)}</td>
                        <td>{money(row.est_cost_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Nobody has asked anything yet" />
            )}
          </section>
        </>
      ) : null}
    </AdminShell>
  );
}
