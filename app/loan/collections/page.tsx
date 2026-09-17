"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";

// Collections (SRS §16F.3 / §20.2).
//
// Aging buckets, portfolio at risk, and the accounts behind them. Every figure is
// queried — ADM-LON-34 forbids seeded numbers on a credit surface, and a
// plausible fake here is worse than an empty state because nobody can tell.
//
// Recording a repayment lives on this page rather than a separate screen: the
// person chasing an arrear is the person who takes the payment, and making them
// navigate away loses the row they were looking at.

type Bucket = { bucket: string; accounts: number; outstanding: number; overdue: number };

type OverdueRow = {
  id: string;
  code: string;
  farmer: string;
  phone: string | null;
  district: string | null;
  outstanding: string | number;
  overdue: string | number;
  dpd: number;
  next_due_date: string | null;
};

type Collections = {
  portfolio: {
    active_loans: number; disbursed: number; collected: number;
    outstanding: number; overdue: number; accounts_in_arrears: number; par_pct: number;
  };
  buckets: Bucket[];
  overdue: OverdueRow[];
};

const BUCKET_LABEL: Record<string, string> = {
  current: "Current",
  "1_30": "1–30 days",
  "31_60": "31–60 days",
  "61_90": "61–90 days",
  over_90: "Over 90 days",
};

function taka(v: string | number | null | undefined) {
  return `৳${Number(v ?? 0).toLocaleString("en-BD", { maximumFractionDigits: 0 })}`;
}

export default function CollectionsPage() {
  const [data, setData] = useState<Collections | null>(null);
  const [district, setDistrict] = useState("");
  const [paying, setPaying] = useState<OverdueRow | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const q = district ? `?district=${encodeURIComponent(district)}` : "";
    const res = await fetch(`/api/v1/admin/loan/collections${q}`).then((r) => r.json());
    if (res.ok) setData(res.data);
    else setMessage(res.message ?? "Could not load collections.");
  }, [district]);

  useEffect(() => { load(); }, [load]);

  async function post(path: string, body: unknown, ok: string) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setMessage(json.ok ? ok : json.message ?? "That did not work.");
      if (json.ok) { setPaying(null); setAmount(""); setReference(""); await load(); }
    } catch {
      setMessage("The request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  function submitPayment() {
    if (!paying) return;
    const value = Number(amount);
    if (!(value > 0)) { setMessage("Enter an amount greater than zero."); return; }
    post(
      "admin/loan/repayment",
      { loan_account_id: Number(paying.id), amount: value, method, reference: reference || null },
      `Recorded ${taka(value)} against ${paying.code}.`
    );
  }

  const p = data?.portfolio;

  return (
    <AdminShell>
      <div className="head">
        <div>
          <p className="eyebrow">Loan &amp; Credit</p>
          <h1>Collections</h1>
          <p className="muted">Aging, portfolio at risk, and the accounts behind both.</p>
        </div>
        <div className="head-actions">
          <input
            aria-label="Filter by district"
            placeholder="Filter by district"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
          />
          <button className="btn" onClick={() => post("admin/loan/arrears/refresh", {}, "Arrears recalculated.")} disabled={busy}>
            Recalculate arrears
          </button>
        </div>
      </div>

      {message ? <section className="panel"><p className="msg">{message}</p></section> : null}

      {p ? (
        <section className="stats">
          {([
            ["Active loans", String(p.active_loans)],
            ["Disbursed", taka(p.disbursed)],
            ["Collected", taka(p.collected)],
            ["Outstanding", taka(p.outstanding)],
            ["Overdue", taka(p.overdue)],
            // The one number a portfolio is actually judged on.
            ["Portfolio at risk", `${p.par_pct}%`],
          ] as [string, string][]).map(([label, value]) => (
            <div className="stat" key={label}>
              <span className="stat-label">{label}</span>
              <strong className="stat-value">{value}</strong>
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel">
        <h2 className="h2">Aging</h2>
        <table className="table">
          <thead><tr><th>Bucket</th><th>Accounts</th><th>Outstanding</th><th>Overdue</th></tr></thead>
          <tbody>
            {(data?.buckets ?? []).map((b) => (
              <tr key={b.bucket} className={b.bucket !== "current" && b.accounts > 0 ? "late" : ""}>
                <td>{BUCKET_LABEL[b.bucket] ?? b.bucket}</td>
                <td>{b.accounts}</td>
                <td>{taka(b.outstanding)}</td>
                <td>{taka(b.overdue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2 className="h2">In arrears</h2>
        {(data?.overdue ?? []).length === 0 ? (
          <p className="muted">Nothing is overdue.</p>
        ) : (
          <div className="scroll">
            <table className="table">
              <thead>
                <tr><th>Application</th><th>Farmer</th><th>District</th><th>Overdue</th><th>Outstanding</th><th>Days</th><th></th></tr>
              </thead>
              <tbody>
                {(data?.overdue ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>{r.code}</td>
                    <td>{r.farmer}<br /><span className="muted">{r.phone ?? "—"}</span></td>
                    <td>{r.district ?? "—"}</td>
                    <td className="late">{taka(r.overdue)}</td>
                    <td>{taka(r.outstanding)}</td>
                    <td className="late">{r.dpd}d</td>
                    <td>
                      <button className="btn small" onClick={() => { setPaying(r); setAmount(String(Number(r.overdue))); }}>
                        Record payment
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {paying ? (
        <section className="panel">
          <h2 className="h2">Record a payment — {paying.code}</h2>
          <p className="muted">
            {paying.farmer} · overdue {taka(paying.overdue)} of {taka(paying.outstanding)} outstanding.
            The amount is allocated oldest instalment first, and cannot exceed the balance.
          </p>
          <div className="pay">
            <label>
              Amount (৳)
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label>
              Method
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {["cash", "bkash", "nagad", "bank", "cooperative"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label>
              Reference
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transaction id" />
            </label>
          </div>
          <div className="pay-actions">
            <button className="btn primary" onClick={submitPayment} disabled={busy}>Record payment</button>
            <button className="btn" onClick={() => setPaying(null)} disabled={busy}>Cancel</button>
          </div>
        </section>
      ) : null}

      <style jsx>{`
        .head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
        .eyebrow { margin:0 0 4px; font-size:11.5px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:var(--brand-500); }
        h1 { margin:0; font-size:22px; color:var(--ink-900); }
        .h2 { margin:0 0 10px; font-size:15px; color:var(--ink-900); }
        .muted { color:var(--ink-500); font-size:var(--fs-sm); margin:4px 0 0; }
        .msg { color:var(--brand-600); font-size:13.5px; margin:0; }
        .head-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .head-actions input { padding:8px 10px; border:1px solid var(--line); border-radius:8px; font-size:13.5px; }
        .stats { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:12px; margin-bottom:16px; }
        .stat { background:var(--surface); border:1px solid var(--line); border-radius:var(--r-lg); padding:14px; box-shadow:var(--e1); }
        .stat-label { display:block; font-size:var(--fs-xs); color:var(--ink-500); }
        .stat-value { display:block; font-size:19px; color:var(--ink-900); margin-top:4px; }
        .scroll { overflow-x:auto; }
        .table { width:100%; border-collapse:collapse; font-size:var(--fs-sm); }
        .table th { text-align:left; padding:10px 16px; background:var(--surface-sunken); border-bottom:1px solid var(--line); font-size:var(--fs-2xs); font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--ink-500); white-space:nowrap; }
        .table td { padding:10px 16px; border-bottom:1px solid var(--line); vertical-align:top; font-size:var(--fs-sm); color:var(--ink-800); }
        .late { color:var(--bad-fg); font-weight:600; }
        .btn { padding:9px 16px; border-radius:8px; border:1px solid var(--line); background:var(--surface); color:var(--brand-600); font-size:13.5px; font-weight:600; cursor:pointer; }
        .btn.primary { background:var(--brand-600); color:#fff; border-color:var(--brand-600); }
        .btn.small { padding:6px 10px; font-size:var(--fs-sm); white-space:nowrap; }
        .btn:disabled { opacity:.5; cursor:not-allowed; }
        .pay { display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-top:12px; box-shadow:var(--e1); }
        .pay label { display:flex; flex-direction:column; gap:5px; font-size:var(--fs-sm); color:var(--ink-500); }
        .pay input, .pay select { padding:8px 10px; border:1px solid var(--line); border-radius:8px; font-size:13.5px; }
        .pay-actions { display:flex; gap:10px; margin-top:14px; }
      `}</style>
    </AdminShell>
  );
}
