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
      <div className="head">
        <div>
          <p className="eyebrow">Loan &amp; Credit</p>
          <h1>Lender submissions</h1>
          <p className="muted">
            An application can only be shared where the farmer&rsquo;s consent to share with a lender is granted
            and current — checked at the moment of submission, not at application.
          </p>
        </div>
      </div>

      {message ? <section className="panel"><p className="msg">{message}</p></section> : null}

      {data?.summary?.length ? (
        <section className="stats">
          {data.summary.map((s) => (
            <div className="stat" key={s.status}>
              <span className="stat-label">{s.status.replace(/_/g, " ")}</span>
              <strong className="stat-value">{s.n}</strong>
              <span className="stat-sub">{taka(s.amount)}</span>
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel">
        <h2 className="h2">Pipeline</h2>
        {!data?.rows?.length ? (
          <p className="muted">Nothing submitted yet.</p>
        ) : (
          <div className="scroll">
            <table className="table">
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
                    <td><span className={`pill ${r.status}`}>{r.status.replace(/_/g, " ")}</span></td>
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
        <section className="panel">
          <h2 className="h2">Record a decision — {deciding.application_code}</h2>
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

      <style jsx>{`
        .head { margin-bottom:16px; }
        .eyebrow { margin:0 0 4px; font-size:11.5px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:#9B5173; }
        h1 { margin:0; font-size:22px; color:#2B0B1E; }
        .h2 { margin:0 0 10px; font-size:15px; color:#2B0B1E; }
        .muted { color:#7A6570; font-size:13px; margin:4px 0 0; }
        .msg { color:#871449; font-size:13.5px; margin:0; }
        .stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:16px; }
        .stat { background:#fff; border:1px solid #F4E8EE; border-radius:12px; padding:14px; }
        .stat-label { display:block; font-size:12px; color:#7A6570; text-transform:capitalize; }
        .stat-value { display:block; font-size:19px; color:#2B0B1E; margin-top:4px; }
        .stat-sub { display:block; font-size:12px; color:#7A6570; margin-top:2px; }
        .scroll { overflow-x:auto; }
        .table { width:100%; border-collapse:collapse; font-size:13px; }
        .table th { text-align:left; color:#7A6570; font-weight:600; padding:8px; border-bottom:1px solid #F4E8EE; white-space:nowrap; }
        .table td { padding:8px; border-bottom:1px solid #FAF4F7; color:#2B0B1E; vertical-align:top; }
        .pill { padding:3px 9px; border-radius:999px; font-size:11.5px; background:#F4E8EE; color:#871449; white-space:nowrap; }
        .pill.approved { background:#E6F5ED; color:#1E7A46; }
        .pill.declined { background:#FDECEA; color:#8A2F28; }
        .row-actions { display:flex; gap:6px; align-items:center; }
        .final { font-style:italic; }
        .btn { padding:9px 16px; border-radius:8px; border:1px solid #EBDDE4; background:#fff; color:#871449; font-size:13.5px; font-weight:600; cursor:pointer; text-decoration:none; }
        .btn.primary { background:#871449; color:#fff; border-color:#871449; }
        .btn.small { padding:5px 10px; font-size:12px; white-space:nowrap; }
        .btn:disabled { opacity:.5; cursor:not-allowed; }
        .form { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-top:12px; }
        .form label { display:flex; flex-direction:column; gap:5px; font-size:12.5px; color:#7A6570; }
        .form label.wide { grid-column: 1 / -1; }
        .form input, .form select { padding:8px 10px; border:1px solid #EBDDE4; border-radius:8px; font-size:13.5px; }
        .form-actions { display:flex; gap:10px; margin-top:14px; }
      `}</style>
    </AdminShell>
  );
}
