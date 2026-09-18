"use client";

import { useState } from "react";
import { Check, Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import {
  Bar, Empty, Failed, Loading, MetricBand, Tabs, ago, n, num, post, s, useApi, type Row
} from "@/components/apa/shared";
import "@/components/apa/apa-console.css";

/**
 * What farmers thought of the answers.
 *
 * Two taps under an answer, which is all a farmer standing in a field will
 * give. That makes the sample small and self-selecting, so the page states its
 * own response rate rather than printing a confident satisfaction percentage
 * from nine votes — a number nobody can size is worse than no number.
 *
 * A thumbs-down is a work queue, not a statistic. Each one shows the question
 * as it was heard, the answer as it was given, and whether it was grounded, so
 * the person reading it can tell a bad answer from a bad transcription.
 */

type Feedback = {
  metrics: { total: number; up: number; down: number; open_down: number; satisfaction_pct: number; response_pct: number };
  reasons: Row[];
  rows: Row[];
};

type View = "down" | "up" | "all";

const REASON_LABEL: Record<string, string> = {
  wrong: "The answer was wrong",
  confusing: "Hard to understand",
  not_my_area: "Not about my area",
  too_long: "Too long",
  unsafe: "Felt unsafe",
  other: "Something else",
  unstated: "No reason given"
};

export function ApaFeedback() {
  const [view, setView] = useState<View>("down");
  const [state, setState] = useState<"open" | "all">("open");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState<Record<string, boolean>>({});
  const feed = useApi<Feedback>(`/api/v1/admin/apa/feedback?vote=${view}&state=${state}`);

  async function review(id: string) {
    setBusy(id);
    try {
      await post("/api/v1/admin/apa/feedback/review", { id });
      setDone((d) => ({ ...d, [id]: true }));
    } catch {
      /* the row stays open and can be tried again */
    } finally {
      setBusy("");
    }
  }

  const topReason = Math.max(1, ...(feed.data?.reasons ?? []).map((r) => n(r.n)));

  return (
    <AdminShell>
      <section className="page-head">
        <div>
          <p className="eyeline">Shathi Apa</p>
          <h1 className="page-title">Answer feedback</h1>
          <p className="page-sub">
            Two taps under an answer. A small, self-selecting sample — so the response rate is
            printed beside the score rather than left for someone to assume.
          </p>
        </div>
      </section>

      {feed.loading ? <Loading /> : null}
      {feed.error ? <Failed message={feed.error} onRetry={feed.reload} /> : null}

      {feed.data ? (
        <>
          <MetricBand
            metrics={[
              { label: "Votes", value: num(feed.data.metrics.total), note: `on ${feed.data.metrics.response_pct}% of answers` },
              { label: "Helpful", value: num(feed.data.metrics.up), tone: "tone-leaf" },
              { label: "Not helpful", value: num(feed.data.metrics.down), tone: "tone-red" },
              {
                label: "Satisfaction",
                value: feed.data.metrics.total >= 20 ? `${feed.data.metrics.satisfaction_pct}%` : "—",
                note: feed.data.metrics.total >= 20 ? "of votes cast" : `only ${feed.data.metrics.total} votes so far`,
                tone: "tone-gold"
              },
              { label: "Waiting on a look", value: num(feed.data.metrics.open_down), note: "unhelpful, unreviewed", tone: feed.data.metrics.open_down ? "tone-red" : "" }
            ]}
          />

          {feed.data.reasons.length ? (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Why farmers said an answer was not helpful</h2>
                </div>
              </div>
              <div className="apa-reasons">
                {feed.data.reasons.map((r) => (
                  <div className="apa-reason" key={s(r.reason)}>
                    <span>{REASON_LABEL[s(r.reason)] ?? s(r.reason)}</span>
                    <Bar pct={(n(r.n) / topReason) * 100} tone="tone-red" />
                    <b>{num(r.n)}</b>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="panel">
            <div className="apa-toolbar">
              <Tabs<View>
                value={view}
                onChange={setView}
                options={[
                  { value: "down", label: "Not helpful" },
                  { value: "up", label: "Helpful" },
                  { value: "all", label: "Everything" }
                ]}
              />
              <div className="apa-toolbar-right">
                <button
                  type="button"
                  className={`apa-toggle${state === "open" ? " on" : ""}`}
                  aria-pressed={state === "open"}
                  onClick={() => setState((v) => (v === "open" ? "all" : "open"))}
                >
                  <span className="apa-switch"><i /></span>
                  Hide what has been looked at
                </button>
              </div>
            </div>

            {!feed.data.rows.length ? (
              <Empty
                title={view === "down" ? "Nothing marked unhelpful" : "No votes yet"}
                detail={view === "down" ? "Either the answers are landing, or nobody is voting — check the response rate above." : undefined}
              />
            ) : (
              <div className="apa-review">
                {feed.data.rows.map((row) => {
                  const id = s(row.id);
                  const reviewed = done[id] || Boolean(row.reviewed_at);
                  const sources = (row.sources ?? []) as Array<{ label_bn?: string }>;
                  return (
                    <article
                      key={id}
                      className={`apa-feedback-item${s(row.vote) === "down" ? " is-down" : ""}${reviewed ? " is-reviewed" : ""}`}
                    >
                      <div className="apa-review-meta">
                        {s(row.vote) === "down" ? <ThumbsDown size={14} /> : <ThumbsUp size={14} />}
                        <span>{REASON_LABEL[s(row.reason)] ?? "No reason given"}</span>
                        <span>{s(row.full_name)}</span>
                        <span>{ago(row.created_at)}</span>
                        <span>{s(row.input_mode)}</span>
                        {n(row.hedged) === 1 ? <span>hedged</span> : null}
                        {!sources.length ? <span>not grounded</span> : null}
                      </div>

                      <p className="apa-feedback-q">
                        {s(row.asked_transcript) || s(row.asked) || "(a photo)"}
                      </p>
                      <p className="apa-feedback-a">{s(row.answer)}</p>
                      {s(row.advice) ? <p className="apa-turn-advice">{s(row.advice)}</p> : null}
                      {s(row.note) ? <p className="apa-review-meta">She wrote: “{s(row.note)}”</p> : null}

                      <div className="apa-review-actions">
                        <Link className="btn sm ghost" href={`/apa?conversation=${s(row.conversation_id)}`}>
                          Read the whole conversation
                        </Link>
                        {sources.map((src, i) => (
                          <span className="apa-source" key={i}>{src.label_bn}</span>
                        ))}
                        {reviewed ? (
                          <span className="apa-review-meta"><Check size={14} /> Looked at</span>
                        ) : (
                          <button type="button" className="btn sm" disabled={busy === id} onClick={() => void review(id)}>
                            {busy === id ? <Loader2 size={14} className="apa-spin" /> : <Check size={14} />} Mark as looked at
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}
    </AdminShell>
  );
}
