"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";

// Lender submissions (SRS §20.1).
//
// The pack is viewed and exported from here, and the decision is recorded here,
// because they are one task: nobody opens a pack without then telling the system
// what the lender said about it.
//
// Approved and declined are terminal. A change of mind is a new submission,
// which leaves both decisions on the record — a decline that can be flipped back
// by a stray click is a decline nobody can rely on.

type PipelineRow = {
  id: string;
  application_id: string;
  lender_id: string;
  status: string;
  submitted_amount: string | number | null;
  approved_amount: string | number | null;
  decline_reason_code: string | null;
  submitted_at: string | null;
  application_code: string;
  farmer: string;
  district: string | null;
  lender: string;
  grade: string | null;
  data_confidence: string | null;
};

type Pipeline = { rows: PipelineRow[]; summary: { status: string; n: number; amount: string | number }[] };

// The shared status-pill tones, so a lender decision reads like every other
// status in the console.
const STATUS_TONE: Record<string, string> = {
  approved: "green",
  declined: "red",
  submitted: "blue",
  under_review: "gold",
  withdrawn: "grey"
};

const DECLINE_CODES = [
  "insufficient_repayment_capacity",
  "excessive_existing_debt",
  "incomplete_documentation",
  "unverified_enterprise",
  "outside_lending_policy",
  "collateral_insufficient",
  "adverse_credit_history",
  "other",
];

const NEXT_STATUS: Record<string, string[]> = {
  prepared: ["submitted", "withdrawn"],
  submitted: ["under_review", "info_requested", "approved", "declined", "withdrawn"],
  under_review: ["info_requested", "approved", "declined", "withdrawn"],
  info_requested: ["under_review", "approved", "declined", "withdrawn"],
  approved: [],
  declined: [],
  withdrawn: [],
};

function taka(v: string | number | null | undefined) {
  return `৳${Number(v ?? 0).toLocaleString("en-BD", { maximumFractionDigits: 0 })}`;
}

export default function LenderSubmissionsPage() {
  const [data, setData] = useState<Pipeline | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<PipelineRow | null>(null);
  const [status, setStatus] = useState("under_review");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [declineCode, setDeclineCode] = useState(DECLINE_CODES[0]);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/admin/loan/lenders/pipeline").then((r) => r.json());
    if (res.ok) setData(res.data);
    else setMessage(res.message ?? "Could not load the pipeline.");
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide() {
    if (!deciding) return;
    setBusy(true);
    setMessage("");
    try {
      const body: Record<string, unknown> = { submission_id: Number(deciding.id), status, note: note || null };
      if (status === "approved") body.approved_amount = Number(approvedAmount);
      if (status === "declined") { body.decline_reason_code = declineCode; body.decline_reason_text = note || null; }
      if (status === "info_requested") body.info_requested_text = note || null;

      const res = await fetch("/api/v1/admin/loan/lenders/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setMessage(json.ok ? `Recorded: ${deciding.application_code} → ${status}.` : json.message ?? "That did not save.");
      if (json.ok) { setDeciding(null); setNote(""); setApprovedAmount(""); await load(); }
    } catch {
      setMessage("The request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Loan &amp; Credit</p>
          <h1 className="page-title">Lender submissions</h1>
          <p className="subtitle">
            An application can only be shared where the farmer&rsquo;s consent to share with a lender is granted
            and current — checked at the moment of submission, not at application.
          </p>
        </div>
      </section>

      {message ? <div className="notice is-ok">{message}</div> : null}

      {data?.summary?.length ? (
        <section className="grid metrics">
          {data.summary.map((s) => (
            <div className="metric" key={s.status}>
              <span>{s.status.replace(/_/g, " ")}</span>
              <strong>{s.n}</strong>
              <small>{taka(s.amount)}</small>
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header"><h2>Pipeline</h2></div>
        {!data?.rows?.length ? (
          <p className="empty-note">Nothing submitted yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table is-flush">
              <thead>
                <tr>
                  <th>Application</th><th>Farmer</th><th>Lender</th><th>Grade</th>
                  <th>Submitted</th><th>Status</th><th>Outcome</th><th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.application_code}</td>
                    <td>{r.farmer}<br /><span className="muted">{r.district ?? "—"}</span></td>
                    <td>{r.lender}</td>
                    <td>{r.grade ?? "—"} / {r.data_confidence ?? "—"}</td>
                    <td>{taka(r.submitted_amount)}</td>
                    <td><span className={`status-pill ${STATUS_TONE[r.status] ?? "grey"}`}>{r.status.replace(/_/g, " ")}</span></td>
                    <td>
                      {r.status === "approved" ? taka(r.approved_amount)
                        : r.status === "declined" ? <span className="muted">{r.decline_reason_code ?? "—"}</span>
                        : "—"}
                    </td>
                    <td className="row-actions">
                      {/* Both links carry lender_id so the access log records who
                          the pack was pulled for, not just that it was pulled. */}
                      <a
                        className="btn small"
                        href={`/api/v1/admin/loan/lenders/pack?application_id=${r.application_id}&lender_id=${r.lender_id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Pack
                      </a>
                      <a
                        className="btn small"
                        href={`/api/v1/admin/loan/lenders/pack?format=csv&application_id=${r.application_id}&lender_id=${r.lender_id}`}
                      >
                        CSV
                      </a>
                      {NEXT_STATUS[r.status]?.length ? (
                        <button className="btn small" onClick={() => { setDeciding(r); setStatus(NEXT_STATUS[r.status][0]); }}>
                          Record decision
                        </button>
                      ) : <span className="muted final">final</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deciding ? (
        <section className="panel is-padded">
          <h2 className="section-title">Record a decision — {deciding.application_code}</h2>
          <p className="muted">
            {deciding.lender} · {deciding.farmer} · submitted {taka(deciding.submitted_amount)}.
            A decline needs a structured reason code, because free text cannot be learned from.
          </p>
          <div className="form">
            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {(NEXT_STATUS[deciding.status] ?? []).map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </label>
            {status === "approved" ? (
              <label>
                Approved amount (৳)
                <input type="number" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} />
              </label>
            ) : null}
            {status === "declined" ? (
              <label>
                Reason code
                <select value={declineCode} onChange={(e) => setDeclineCode(e.target.value)}>
                  {DECLINE_CODES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                </select>
              </label>
            ) : null}
            <label className="wide">
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the lender said" />
            </label>
          </div>
          <div className="form-actions">
            <button className="btn primary" onClick={decide} disabled={busy}>Record</button>
            <button className="btn" onClick={() => setDeciding(null)} disabled={busy}>Cancel</button>
          </div>
        </section>
      ) : null}

    </AdminShell>
  );
}
