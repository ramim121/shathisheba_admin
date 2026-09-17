"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { Select } from "@/components/Select";

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

// Stage -> one of the shared status-pill tones. Blue is "moving", amber is
// "waiting on someone", green is "cleared", red is "stopped".
const STATUS_TONE: Record<string, string> = {
  submitted: "blue",
  kyc_in_progress: "gold",
  field_verification: "gold",
  behavioral_pending: "gold",
  under_assessment: "blue",
  assessed: "green",
  submitted_to_lender: "blue",
  approved: "green",
  disbursed: "green",
  repaying: "green",
  overdue: "red",
  lender_declined: "red",
  hard_stopped: "red",
  ineligible: "red",
};

const taka = (n: unknown) => `৳${Number(n || 0).toLocaleString("en-IN")}`;

export default function LoanApplicationsPage() {
  const router = useRouter();
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
      <section className="topbar">
        <div>
          <p className="eyeline">Loan &amp; Credit</p>
          <h1>Loan applications</h1>
          <p className="subtitle">
            Every finance application with its stage, the farmer, the amount requested and how long it
            has been open. Applications open more than five days are flagged.
          </p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      {data && (
        <section className="grid metrics">
          <Kpi label="Awaiting screening" value={data.kpi.awaiting_screening} />
          <Kpi label="Collecting evidence" value={data.kpi.in_collection} />
          <Kpi label="Under assessment" value={data.kpi.in_assessment} />
          <Kpi label="Past 5-day SLA" value={data.kpi.past_sla} tone={data.kpi.past_sla > 0 ? "warn" : undefined} />
        </section>
      )}

      <div className="list-filters">
        <div className="list-filters-select">
          <Select
            aria-label="Stage"
            value={status}
            options={[{ value: "", label: "All stages" }, ...Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))]}
            onChange={(v) => { setPage(1); setStatus(v); }}
          />
        </div>
        {data && <span className="table-count">{data.total} application{data.total === 1 ? "" : "s"}</span>}
      </div>

      {error && <p className="error">{error}</p>}
      {loading && !data && <p className="muted">Loading queue…</p>}

      {data && data.rows.length === 0 && !loading && (
        <section className="panel is-padded">
          <div className="table-empty">
            <strong>No applications yet.</strong>
            <span>
              Applications appear here as soon as a farmer submits one from the app. Nothing is
              shown until then — this table never renders sample rows.
            </span>
          </div>
        </section>
      )}

      {data && data.rows.length > 0 && (
        <section className="panel">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Application</th><th>Farmer</th><th>Product</th><th>Requested</th>
                  <th>Terms</th><th>Stage</th><th>District</th><th>Open</th><th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="row-link"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a, button, input, select")) return;
                      router.push(`/loan/applications/${r.id}`);
                    }}
                  >
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
                      <span className={`status-pill ${STATUS_TONE[r.status] ?? "grey"}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td>{r.district ?? "—"}</td>
                    <td className={r.days_open > 5 ? "late" : ""}>{r.days_open}d</td>
                    <td>
                      {/* The workspace, not the generic row viewer — this is the
                          screen an officer actually works the application in. */}
                      <Link className="cell-open" href={`/loan/applications/${r.id}`}>
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <span className="table-count">{data.total} application{data.total === 1 ? "" : "s"}</span>
            <div className="pager">
              <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span className="page-indicator">Page {data.page}/{pages}</span>
              <button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        </section>
      )}

    </AdminShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className={`metric${tone === "warn" && value > 0 ? " tone-red" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
