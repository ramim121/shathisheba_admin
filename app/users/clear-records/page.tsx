"use client";

import { useState } from "react";
import { AdminShell } from "@/components/AdminShell";

// Clear Records — reset a test account without deleting it.
//
// The flow is deliberately two-step: look up what exists, then confirm by
// typing the phone number back. This is an irreversible wipe of real user data,
// so a single mis-click must not be able to trigger it.

type Row = { table: string; rows: number };
type Result = {
  user: { id: string; full_name: string | null; phone: string | null };
  deleted: Row[];
  total: number;
  reset: string[];
};

const TABLE_LABEL: Record<string, string> = {
  loan_repayment_schedule: "Repayment schedule",
  loan_repayments: "Repayments",
  loan_accounts: "Loan accounts",
  loan_application_events: "Loan timeline events",
  loan_consents: "Loan consents",
  loan_quotes: "Loan quotes",
  loan_applications: "Loan applications",
  readiness_answers: "Readiness answers",
  readiness_assessments: "Readiness checks",
  order_items: "Order line items",
  orders: "Buy orders",
  payment_confirmations: "Payment confirmations",
  sale_listings: "Sale listings",
  project_ledgers: "Project ledgers",
  partner_applications: "Project enrolments",
  community_comments: "Community comments",
  community_posts: "Community posts",
  user_learning_progress: "Training progress",
  app_user_kyc_documents: "KYC documents",
  app_user_banking: "Banking details",
  app_user_farm: "Farm information",
  user_interests: "Saved preferences",
  app_sessions: "Active sessions",
  app_otps: "One-time codes",
};

export default function ClearRecordsPage() {
  const [identifier, setIdentifier] = useState("01966662633");
  const [preview, setPreview] = useState<Result | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [resetOnboarding, setResetOnboarding] = useState(true);
  const [resetRoles, setResetRoles] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookUp() {
    setBusy(true); setError(null); setDone(null); setPreview(null); setConfirmText("");
    try {
      const res = await fetch(`/api/v1/admin/users/clear-records/preview?identifier=${encodeURIComponent(identifier)}`,
        { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.message || `HTTP ${res.status}`);
      setPreview(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed.");
    } finally { setBusy(false); }
  }

  async function clearNow() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/admin/users/clear-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          confirm: confirmText,
          reset_onboarding: resetOnboarding,
          reset_roles: resetRoles,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.message || `HTTP ${res.status}`);
      setDone(json.result);
      setPreview(null);
      setConfirmText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed.");
    } finally { setBusy(false); }
  }

  const armed = !!preview && confirmText.trim() === identifier.trim();

  return (
    <AdminShell>
      <div className="head">
        <p className="eyebrow">Users</p>
        <h1>Clear records</h1>
        <p className="sub">
          Wipes everything an account has <em>done</em> — loans, readiness checks, orders, listings,
          enrolments, posts, training progress, KYC documents, banking and preferences — while keeping
          the account itself and its basic profile. Use it to run the same phone number through a flow
          repeatedly without re-registering.
        </p>
      </div>

      <section className="card">
        <label className="lbl" htmlFor="identifier">Phone number or user id</label>
        <div className="row">
          <input
            id="identifier"
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setPreview(null); setDone(null); }}
            placeholder="01966662633"
          />
          <button className="btn" onClick={lookUp} disabled={busy || !identifier.trim()}>
            {busy && !preview ? "Looking up…" : "Look up"}
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      {preview && (
        <section className="card">
          <h2>{preview.user.full_name || "—"} <span className="muted">· {preview.user.phone}</span></h2>

          {preview.total === 0 ? (
            <p className="ok">This account already has no associated records. Nothing to clear.</p>
          ) : (
            <>
              <p className="muted">
                {preview.total} row{preview.total === 1 ? "" : "s"} across {preview.deleted.length} table
                {preview.deleted.length === 1 ? "" : "s"} will be permanently deleted.
              </p>
              <ul className="rows">
                {preview.deleted.map((r) => (
                  <li key={r.table}>
                    <span>{TABLE_LABEL[r.table] ?? r.table}</span>
                    <strong>{r.rows}</strong>
                  </li>
                ))}
              </ul>

              <div className="opts">
                <label>
                  <input type="checkbox" checked={resetOnboarding} onChange={(e) => setResetOnboarding(e.target.checked)} />
                  <span>
                    <strong>Reset onboarding</strong>
                    <em>Clears the personal-info and KYC-verified flags and saved preferences, so the next
                       login walks the full first-run journey. Name, phone and district are kept.</em>
                  </span>
                </label>
                <label>
                  <input type="checkbox" checked={resetRoles} onChange={(e) => setResetRoles(e.target.checked)} />
                  <span>
                    <strong>Also clear roles</strong>
                    <em>Removes granted roles. The buyer role is re-granted automatically on next login.</em>
                  </span>
                </label>
              </div>

              <div className="danger">
                <p><strong>This cannot be undone.</strong> Type <code>{identifier}</code> to confirm.</p>
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={identifier}
                  aria-label="Type the phone number to confirm"
                />
                <button className="btn destructive" onClick={clearNow} disabled={!armed || busy}>
                  {busy ? "Clearing…" : `Clear ${preview.total} record${preview.total === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {done && (
        <section className="card done">
          <h2>Cleared</h2>
          <p className="muted">
            {done.user.full_name} · {done.user.phone} — {done.total} row{done.total === 1 ? "" : "s"} removed.
            The account and its basic profile are intact.
          </p>
          {done.deleted.length > 0 && (
            <ul className="rows">
              {done.deleted.map((r) => (
                <li key={r.table}><span>{TABLE_LABEL[r.table] ?? r.table}</span><strong>{r.rows}</strong></li>
              ))}
            </ul>
          )}
          {done.reset.length > 0 && <p className="muted">Also reset: {done.reset.join(", ")}.</p>}
          <p className="muted">The phone is now signed out — log in again in the app to start fresh.</p>
        </section>
      )}

      <style jsx>{`
        .head { margin-bottom: 18px; }
        .eyebrow { text-transform:uppercase; letter-spacing:.08em; font-size:11px; font-weight:700; color:#9B5173; margin:0 0 4px; }
        h1 { margin:0 0 6px; font-size:28px; }
        .sub { margin:0; color:#6b6b6b; max-width:760px; line-height:1.55; }
        .card { background:#fff; border:1px solid #E8D7DF; border-radius:14px; padding:20px; margin-bottom:16px; }
        .card h2 { margin:0 0 10px; font-size:18px; }
        .lbl { display:block; font-size:13px; color:#6b6b6b; margin-bottom:6px; }
        .row { display:flex; gap:10px; }
        input { flex:1; padding:10px 12px; border:1px solid #E8D7DF; border-radius:9px; font-size:15px; }
        .btn { padding:10px 18px; border-radius:9px; border:1px solid #871449; background:#871449; color:#fff;
               font-weight:700; font-size:14px; cursor:pointer; }
        .btn:disabled { opacity:.5; cursor:not-allowed; }
        .btn.destructive { background:#B4443C; border-color:#B4443C; margin-top:10px; width:100%; }
        .rows { list-style:none; padding:0; margin:12px 0; border-top:1px solid #F4E8EE; }
        .rows li { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #F4E8EE; font-size:14px; }
        .opts { margin:16px 0; display:grid; gap:12px; }
        .opts label { display:flex; gap:10px; align-items:flex-start; cursor:pointer; }
        .opts span { display:block; font-size:14px; }
        .opts em { display:block; font-style:normal; color:#6b6b6b; font-size:12.5px; margin-top:2px; line-height:1.5; }
        .danger { background:#FEF2F2; border:1px solid #F3C7C4; border-radius:12px; padding:14px; margin-top:14px; }
        .danger p { margin:0 0 10px; color:#8A2F28; font-size:14px; }
        code { background:#fff; padding:1px 6px; border-radius:5px; border:1px solid #F3C7C4; }
        .muted { color:#6b6b6b; font-size:13.5px; line-height:1.55; }
        .ok { color:#1E9E5A; font-weight:600; }
        .error { color:#B4443C; background:#FEF2F2; border:1px solid #F3C7C4; border-radius:10px; padding:12px 14px; }
        .done { border-color:#BFE3CE; background:#F5FBF7; }
      `}</style>
    </AdminShell>
  );
}
