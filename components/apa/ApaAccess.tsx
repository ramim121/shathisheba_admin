"use client";

import { useEffect, useState } from "react";
import { Ban, Loader2, Search, ShieldCheck, X } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Select } from "@/components/Select";
import { Status } from "@/components/Status";
import {
  Bar, Empty, Failed, Loading, MetricBand, Tabs, clock, n, num, post, s, useApi, type Row
} from "@/components/apa/shared";
import "@/components/apa/apa-console.css";

/**
 * Who Shathi Apa reaches, and the funnel she exists to move.
 *
 * The strategic point of this feature is on this page. Apa is free and it is
 * gated behind identity verification, not because verification costs us
 * anything, but because a verified farmer can take a loan, sell at the B2B rate
 * and be insured — and none of those were ever a strong enough reason on their
 * own to photograph an NID. A question she wants answered today is.
 *
 * So the number that matters is not "how many farmers used Apa". It is how many
 * of them reached the wall and then verified.
 */

type Access = {
  free_questions: number;
  funnel: Array<{ id: string; label: string; count: number; pct: number }>;
  metrics: { tried: number; verified: number; granted: number; blocked: number; conversion_pct: number };
  rows: Row[];
};

type Filter = "all" | "wall" | "verified" | "granted" | "blocked";

export function ApaAccess() {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Row | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const feed = useApi<Access>(
    `/api/v1/admin/apa/access?tier=${filter}&q=${encodeURIComponent(query)}`
  );

  return (
    <AdminShell>
      <section className="page-head">
        <div>
          <p className="eyeline">Shathi Apa</p>
          <h1 className="page-title">Access and tiers</h1>
          <p className="page-sub">
            Apa is free. It is gated behind identity verification because verification is what lets a
            farmer borrow, sell at the B2B rate and be insured — and a question she wants answered
            today is a better reason to photograph an NID than any of them.
          </p>
        </div>
      </section>

      {feed.loading ? <Loading /> : null}
      {feed.error ? <Failed message={feed.error} onRetry={feed.reload} /> : null}

      {feed.data ? (
        <>
          <MetricBand
            metrics={[
              { label: "Farmers who asked", value: num(feed.data.metrics.tried), note: "at least one question" },
              { label: "Verified after asking", value: num(feed.data.metrics.verified), note: `${feed.data.metrics.conversion_pct}% of them`, tone: "tone-leaf" },
              { label: "Staff grants", value: num(feed.data.metrics.granted), note: "override in place", tone: "tone-sky" },
              { label: "Blocked", value: num(feed.data.metrics.blocked), tone: feed.data.metrics.blocked ? "tone-red" : "" },
              { label: "Free questions", value: num(feed.data.free_questions), note: "before the wall", tone: "tone-gold" }
            ]}
          />

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>The funnel</h2>
                <p>Of the farmers who have asked Apa anything, how far each step carried them.</p>
              </div>
            </div>
            <div className="apa-funnel">
              {feed.data.funnel.map((step) => (
                <div className="apa-funnel-step" key={step.id}>
                  <div>
                    <strong>{step.label}</strong>
                    <Bar pct={step.pct} tone={step.id === "verified" ? "tone-leaf" : ""} />
                  </div>
                  <div>
                    <b>{num(step.count)}</b>
                    <em>{step.pct}%</em>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="apa-toolbar">
              <Tabs<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "Everyone" },
                  { value: "wall", label: "At the wall" },
                  { value: "verified", label: "Verified" },
                  { value: "granted", label: "Granted" },
                  { value: "blocked", label: "Blocked" }
                ]}
              />
              <div className="search-box">
                <Search size={16} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or id…" aria-label="Find a farmer" />
                {q ? <button type="button" onClick={() => setQ("")} aria-label="Clear"><X size={14} /></button> : null}
              </div>
            </div>

            {!feed.data.rows.length ? (
              <Empty title="Nobody here" detail="Farmers appear once they have asked Apa something." />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Farmer</th>
                      <th>District</th>
                      <th>Access</th>
                      <th>Trial</th>
                      <th>This month</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {feed.data.rows.map((row) => {
                      const verified = n(row.is_kyc_verified) === 1;
                      const blocked = n(row.is_blocked) === 1;
                      const granted = s(row.granted_tier);
                      const used = n(row.trial_used);
                      return (
                        <tr key={s(row.user_id)}>
                          <td>
                            {s(row.full_name) || "—"}
                            <br />
                            <small className="muted">{s(row.phone)}</small>
                          </td>
                          <td>{s(row.district) || <span className="muted">no area</span>}</td>
                          <td>
                            <Status
                              label={
                                blocked ? "blocked"
                                  : granted ? granted.replace(/_/g, " ")
                                    : verified ? "verified"
                                      : used >= feed.data!.free_questions ? "at the wall"
                                        : "trial"
                              }
                            />
                            {s(row.granted_by_name) ? (
                              <>
                                <br />
                                <small className="muted">by {s(row.granted_by_name)}</small>
                              </>
                            ) : null}
                          </td>
                          <td>
                            {verified || granted ? (
                              <span className="muted">unlimited</span>
                            ) : (
                              `${used} / ${feed.data!.free_questions}`
                            )}
                          </td>
                          <td>
                            {num(row.ask_count)} asked
                            {n(row.live_seconds) ? <><br /><small className="muted">{clock(row.live_seconds)} live</small></> : null}
                          </td>
                          <td>
                            <button type="button" className="btn sm ghost" onClick={() => setOpen(row)}>
                              Change
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {open ? <GrantDialog row={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); feed.reload(); }} /> : null}
    </AdminShell>
  );
}

/* ---------------------------------------------------------------------------
   The staff override
   --------------------------------------------------------------------------- */

function GrantDialog({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const [tier, setTier] = useState(s(row.granted_tier) || "none");
  const [minutes, setMinutes] = useState(s(row.live_minutes_override));
  const [reason, setReason] = useState(s(row.reason));
  const [blocked, setBlocked] = useState(n(row.is_blocked) === 1);
  const [blockedReason, setBlockedReason] = useState(s(row.blocked_reason));
  const [resetTrial, setResetTrial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      await post("/api/v1/admin/apa/grant", {
        user_id: s(row.user_id),
        tier: tier === "none" ? null : tier,
        live_minutes: minutes.trim() === "" ? null : Number(minutes),
        reason,
        blocked,
        blocked_reason: blockedReason,
        reset_trial: resetTrial
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="apa-modal-backdrop" role="dialog" aria-modal="true" aria-label="Change Shathi Apa access">
      <div className="apa-modal">
        <div className="apa-modal-head">
          <div>
            <h2>{s(row.full_name) || "Farmer"}</h2>
            <p className="muted">{s(row.phone)} · {s(row.district) || "no district"}</p>
          </div>
          <button type="button" className="btn sm ghost" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="apa-grant">
          <div className="field">
            <label className="field-label"><span className="field-label-text">Access</span></label>
            <Select
              value={tier}
              onChange={setTier}
              options={[
                { value: "none", label: "Normal — decided by her verification" },
                { value: "verified_free", label: "Grant full access without verifying" },
                { value: "premium", label: "Premium" },
                { value: "staff", label: "Staff" }
              ]}
            />
            <small className="field-hint">
              Leave on “normal” for almost everyone. A grant is for a farmer whose documents are stuck
              in review, or a field officer testing the app.
            </small>
          </div>

          <div className="field">
            <label className="field-label"><span className="field-label-text">Live minutes a month</span></label>
            <input
              className="input"
              type="number"
              min={0}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="Leave empty for the platform default"
            />
          </div>

          <div className="field">
            <label className="field-label"><span className="field-label-text">Why</span></label>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the audit log" />
          </div>

          <button
            type="button"
            className={`apa-toggle${resetTrial ? " on" : ""}`}
            aria-pressed={resetTrial}
            onClick={() => setResetTrial((v) => !v)}
          >
            <span className="apa-switch"><i /></span>
            Give her the {n(row.trial_used)} trial questions back
          </button>

          <button
            type="button"
            className={`apa-toggle${blocked ? " on" : ""}`}
            aria-pressed={blocked}
            onClick={() => setBlocked((v) => !v)}
          >
            <span className="apa-switch"><i /></span>
            <Ban size={14} /> Block this farmer from Shathi Apa
          </button>

          {blocked ? (
            <div className="field">
              <label className="field-label"><span className="field-label-text">What she will be told</span><b aria-hidden="true">*</b></label>
              <input
                className="input"
                value={blockedReason}
                onChange={(e) => setBlockedReason(e.target.value)}
                placeholder="Shown to her in Bangla, on the chat screen"
              />
            </div>
          ) : null}

          {error ? <p className="act-note is-bad">{error}</p> : null}
        </div>

        <div className="apa-modal-foot">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? <Loader2 size={16} className="apa-spin" /> : <ShieldCheck size={16} />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
