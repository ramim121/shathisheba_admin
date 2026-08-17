"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";

// Loan applications — the operational queue.
//
// Server-side paginated (API-06 / GAP-02 must not recur here). The KPI band
// across the top answers "what needs me today", which is the question a field
// officer actually opens this page with.

type QueueRow = {
  id: string;
  application_code: string;
  status: string;
  requested_amount: string | number;
  tenure_months: number;
  repayment_mode: string;
  district: string | null;
  created_at: string;
  farmer: string;
  phone: string | null;
  product: string;
  days_open: number;
};

type Queue = {
  rows: QueueRow[];
  kpi: { awaiting_screening: number; in_collection: number; in_assessment: number; past_sla: number };
  page: number;
  page_size: number;
  total: number;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  ineligible: "Ineligible",
  kyc_in_progress: "Document collection",
  field_verification: "Field verification",
  behavioral_pending: "Behavioural assessment",
  under_assessment: "Risk assessment",
  assessed: "Assessed",
  development_required: "Development plan",
  project_matched: "Matched to a project",
  pending_submission: "Ready for lender",
  hard_stopped: "Hard stopped",
  submitted_to_lender: "Sent to lender",
  lender_review: "Lender review",
  info_requested: "Information requested",
  lender_declined: "Declined",
  approved: "Approved",
  disbursed: "Disbursed",
  repaying: "Repaying",
  overdue: "Overdue",
  closed: "Closed",
  withdrawn: "Withdrawn",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<string, string> = {
  submitted: "#2563EB",
  kyc_in_progress: "#D97706",
  field_verification: "#D97706",
  behavioral_pending: "#7C3AED",
  under_assessment: "#7C3AED",
  assessed: "#1E9E5A",
  submitted_to_lender: "#2563EB",
  approved: "#1E9E5A",
  disbursed: "#1E9E5A",
  repaying: "#1E9E5A",
  overdue: "#B4443C",
  lender_declined: "#B4443C",
  hard_stopped: "#B4443C",
  ineligible: "#B4443C",
};

const taka = (n: unknown) => `৳${Number(n || 0).toLocaleString("en-IN")}`;

export default function LoanApplicationsPage() {
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), page_size: "25" });
      if (status) qs.set("status", status);
      const res = await fetch(`/api/v1/admin/loan/queue?${qs}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.message || `HTTP ${res.status}`);
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the queue.");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => { load(); }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <AdminShell>
      <div className="head">
        <div>
          <p className="eyebrow">Loan &amp; Credit</p>
          <h1>Loan applications</h1>
          <p className="sub">
            Every finance application with its stage, the farmer, the amount requested and how long it
            has been open. Applications open more than five days are flagged.
          </p>
        </div>
        <button className="btn ghost" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {data && (
        <section className="kpis">
          <Kpi label="Awaiting screening" value={data.kpi.awaiting_screening} />
          <Kpi label="Collecting evidence" value={data.kpi.in_collection} />
          <Kpi label="Under assessment" value={data.kpi.in_assessment} />
          <Kpi label="Past 5-day SLA" value={data.kpi.past_sla} tone={data.kpi.past_sla > 0 ? "warn" : undefined} />
        </section>
      )}

      <div className="filters">
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="">All stages</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {data && <span className="count">{data.total} application{data.total === 1 ? "" : "s"}</span>}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && !data && <p className="muted">Loading queue…</p>}

      {data && data.rows.length === 0 && !loading && (
        <div className="empty">
          <p><strong>No applications yet.</strong></p>
          <p className="muted">
            Applications appear here as soon as a farmer submits one from the app. Nothing is shown
            until then — this table never renders sample rows.
          </p>
        </div>
      )}

      {data && data.rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Application</th><th>Farmer</th><th>Product</th><th>Requested</th>
                  <th>Terms</th><th>Stage</th><th>District</th><th>Open</th><th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.application_code}</td>
                    <td>
                      <div className="who">{r.farmer}</div>
                      {r.phone && <div className="phone">{r.phone}</div>}
                    </td>
                    <td>{r.product}</td>
                    <td className="num">{taka(r.requested_amount)}</td>
                    <td className="terms">
                      {r.tenure_months} mo · {r.repayment_mode.replace("_", " ")}
                    </td>
                    <td>
                      <span className="chip" style={{ color: STATUS_TONE[r.status] ?? "#6b6b6b",
                        borderColor: (STATUS_TONE[r.status] ?? "#ccc") + "55" }}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td>{r.district ?? "—"}</td>
                    <td className={r.days_open > 5 ? "late" : ""}>{r.days_open}d</td>
                    <td>
                      {/* The workspace, not the generic row viewer — this is the
                          screen an officer actually works the application in. */}
                      <Link className="open" href={`/loan/applications/${r.id}`}>
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pager">
            <button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span>Page {data.page} of {pages}</span>
            <button className="btn ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </>
      )}

      <style jsx>{`
        .head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:18px; }
        .eyebrow { text-transform:uppercase; letter-spacing:.08em; font-size:11px; font-weight:700; color:#9B5173; margin:0 0 4px; }
        h1 { margin:0 0 6px; font-size:28px; }
        .sub { margin:0; color:#6b6b6b; max-width:680px; }
        .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; margin-bottom:18px; }
        .filters { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
        select { padding:8px 12px; border:1px solid #E8D7DF; border-radius:9px; background:#fff; font-size:14px; }
        .count { color:#6b6b6b; font-size:13px; }
        .table-wrap { overflow-x:auto; background:#fff; border:1px solid #E8D7DF; border-radius:14px; }
        table { width:100%; border-collapse:collapse; font-size:14px; }
        th { text-align:left; padding:12px 14px; border-bottom:1px solid #E8D7DF; font-size:12px;
             text-transform:uppercase; letter-spacing:.04em; color:#9B5173; white-space:nowrap; }
        td { padding:12px 14px; border-bottom:1px solid #F4E8EE; vertical-align:top; }
        tr:last-child td { border-bottom:none; }
        .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
        .who { font-weight:600; }
        .phone { color:#6b6b6b; font-size:12.5px; }
        .num { font-weight:700; white-space:nowrap; }
        .terms { color:#6b6b6b; white-space:nowrap; }
        .chip { display:inline-block; border:1px solid; border-radius:999px; padding:3px 10px;
                font-size:12px; font-weight:600; white-space:nowrap; }
        .late { color:#B4443C; font-weight:700; }
        .open { color:#871449; font-weight:600; text-decoration:none; white-space:nowrap; }
        .pager { display:flex; align-items:center; gap:14px; justify-content:center; margin-top:16px; color:#6b6b6b; font-size:13px; }
        .empty { background:#fff; border:1px solid #E8D7DF; border-radius:14px; padding:28px; text-align:center; }
        .muted { color:#6b6b6b; }
        .error { color:#B4443C; background:#FEF2F2; border:1px solid #F3C7C4; border-radius:10px; padding:12px 14px; }
      `}</style>
    </AdminShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="kpi">
      <p className="l">{label}</p>
      <p className="v" style={{ color: tone === "warn" && value > 0 ? "#B4443C" : "#2B0B1E" }}>{value}</p>
      <style jsx>{`
        .kpi { background:#fff; border:1px solid #E8D7DF; border-radius:14px; padding:14px 16px; }
        .l { margin:0 0 4px; font-size:12.5px; color:#6b6b6b; }
        .v { margin:0; font-size:26px; font-weight:800; line-height:1.1; }
      `}</style>
    </div>
  );
}
