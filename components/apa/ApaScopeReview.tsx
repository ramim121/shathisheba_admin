"use client";

import { useState } from "react";
import { Check, ShieldAlert, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import {
  Empty, Failed, Loading, MetricBand, Tabs, ago, n, num, post, s, useApi, type Row
} from "@/components/apa/shared";
import "@/components/apa/apa-console.css";

/**
 * Scope Review — the tuning queue.
 *
 * The gate that decides whether a question is about farming is the only thing
 * keeping Shathi Apa from being a general chatbot on our invoice, and it is
 * also the thing most likely to turn away a farmer who phrased her question
 * badly. Those two failures are not symmetric: a wrongly answered cricket
 * question costs a fraction of a cent, a wrongly refused question about her
 * cow costs a user. So the classifier leans toward allowing, and this page is
 * how that lean gets corrected with evidence instead of instinct.
 *
 * Every verdict is logged, allow and refuse alike — a queue holding only
 * refusals could never show what slipped through.
 */

type Review = {
  metrics: {
    refusal_rate: number; ambiguous: number; corrected: number;
    wrongly_refused: number; wrongly_allowed: number; avg_latency_ms: number; total: number;
  };
  rows: Row[];
};

type View = "review" | "out_of_scope" | "ambiguous" | "in_scope" | "corrected";

export function ApaScopeReview() {
  const [view, setView] = useState<View>("review");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const feed = useApi<Review>(`/api/v1/admin/apa/scope-review?verdict=${view}`);

  async function correct(id: string, to: "in_scope" | "out_of_scope") {
    setBusy(id);
    try {
      await post("/api/v1/admin/apa/scope-correct", { id, corrected_to: to });
      setDone((d) => ({ ...d, [id]: to }));
    } catch {
      /* the row stays in the queue and can be tried again */
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <section className="page-head">
        <div>
          <p className="eyeline">Shathi Apa</p>
          <h1 className="page-title">Scope review</h1>
          <p className="page-sub">
            What the scope gate decided, and where it was wrong. Correcting a verdict here does not
            change what the farmer was told — it is the record the instruction gets tuned against.
          </p>
        </div>
      </section>

      {feed.data ? (
        <MetricBand
          metrics={[
            { label: "Refusal rate", value: `${feed.data.metrics.refusal_rate}%`, note: `of ${num(feed.data.metrics.total)} questions`, tone: feed.data.metrics.refusal_rate > 15 ? "tone-red" : "" },
            { label: "Needing a look", value: num(feed.data.metrics.ambiguous), note: "judged ambiguous", tone: "tone-gold" },
            { label: "Wrongly refused", value: num(feed.data.metrics.wrongly_refused), note: "corrected by staff", tone: "tone-red" },
            { label: "Wrongly allowed", value: num(feed.data.metrics.wrongly_allowed), note: "corrected by staff", tone: "tone-plum" },
            { label: "Gate latency", value: `${feed.data.metrics.avg_latency_ms}ms`, note: "average, 30 days", tone: "tone-sky" }
          ]}
        />
      ) : null}

      <section className="panel">
        <div className="apa-toolbar">
          <Tabs<View>
            value={view}
            onChange={setView}
            options={[
              { value: "review", label: "Needs a decision" },
              { value: "out_of_scope", label: "Refused" },
              { value: "ambiguous", label: "Ambiguous" },
              { value: "in_scope", label: "Allowed" },
              { value: "corrected", label: "Already corrected" }
            ]}
          />
        </div>

        {feed.loading ? <Loading /> : null}
        {feed.error ? <Failed message={feed.error} onRetry={feed.reload} /> : null}
        {feed.data && !feed.data.rows.length && !feed.loading ? (
          <Empty
            title={view === "review" ? "Nothing waiting" : "Nothing here"}
            detail={view === "review" ? "Every refusal and ambiguous verdict has been looked at." : undefined}
          />
        ) : null}

        {feed.data?.rows.length ? (
          <div className="apa-review">
            {feed.data.rows.map((row) => {
              const id = s(row.id);
              const verdict = s(row.verdict);
              const settled = done[id] ?? s(row.corrected_to);
              return (
                <article
                  key={id}
                  className={`apa-review-item${settled ? " is-done" : verdict === "out_of_scope" ? " is-refused" : verdict === "ambiguous" ? " is-ambiguous" : ""}`}
                >
                  <p className="apa-review-q">{s(row.input_text)}</p>

                  <div className="apa-review-meta">
                    <span>
                      {verdict === "out_of_scope" ? "Refused" : verdict === "ambiguous" ? "Ambiguous → allowed" : "Allowed"}
                      {s(row.topic) ? ` · ${s(row.topic)}` : ""}
                    </span>
                    {n(row.confidence) > 0 ? <span>confidence {(n(row.confidence) * 100).toFixed(0)}%</span> : null}
                    <span>{s(row.model)}</span>
                    <span>{ago(row.created_at)}</span>
                    {s(row.full_name) ? <span>{s(row.full_name)}</span> : null}
                  </div>

                  {s(row.answer) ? (
                    <p className="apa-review-answer">{s(row.answer).slice(0, 320)}</p>
                  ) : null}

                  {settled ? (
                    <div className="apa-review-meta">
                      <Check size={14} />
                      Marked {settled === "in_scope" ? "should have been answered" : "correctly refused"}
                      {s(row.corrected_by_name) ? ` by ${s(row.corrected_by_name)}` : ""}
                      {s(row.corrected_note) ? ` — ${s(row.corrected_note)}` : ""}
                    </div>
                  ) : (
                    <div className="apa-review-actions">
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy === id}
                        onClick={() => void correct(id, "in_scope")}
                      >
                        <ShieldCheck size={14} /> Should have been answered
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        disabled={busy === id}
                        onClick={() => void correct(id, "out_of_scope")}
                      >
                        <ShieldAlert size={14} /> Correctly refused
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </AdminShell>
  );
}
