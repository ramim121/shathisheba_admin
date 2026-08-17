"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";

// Credit dashboard — the finance portfolio at a glance.
//
// Every figure here is queried from the database (ADM-LON-34). Where there is
// no data yet the panel says so; it never renders a plausible-looking placeholder,
// because on a credit surface nobody can tell a fake number from a real one.

type Dashboard = {
  pipeline: Record<string, number>;
  risk: {
    grades: { grade: string; count: number }[];
    confidence: { level: string; count: number }[];
    readiness_statuses: { status: string; count: number }[];
  };
  finance: Record<string, number>;
  performance: Record<string, number | null>;
  collections: Record<string, number>;
  readiness: {
    checks_taken: number;
    distinct_users: number;
    converted_to_application: number;
    conversion_rate: number;
    warm_leads: number;
    top_gaps: { label: string; count: number }[];
  };
};

const taka = (n: number) => `৳${Number(n || 0).toLocaleString("en-IN")}`;

const GRADE_TONE: Record<string, string> = {
  A: "#1E9E5A", B: "#2563EB", C: "#D97706", D: "#B4443C",
};

const STATUS_LABEL: Record<string, string> = {
  bank_ready_indicative: "Bank ready (indicative)",
  conditionally_ready: "Conditionally ready",
  project_ready: "Project ready",
  development_required: "Development needed",
  currently_ineligible: "Not possible yet",
};

export default function CreditDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/loan/dashboard", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || json.ok === false) throw new Error(json.message || `HTTP ${res.status}`);
        setData(json.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load the dashboard.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <p className="eyebrow">Loan &amp; Credit</p>
          <h1>Credit dashboard</h1>
          <p className="page-sub">
            The finance pipeline end to end — applications, risk mix, money position, repayment
            performance and the readiness funnel that feeds it.
          </p>
        </div>
      </div>

      {loading && <p style={{ color: "#6b6b6b" }}>Loading portfolio…</p>}
      {error && (
        <p style={{ color: "#B4443C", background: "#FEF2F2", border: "1px solid #F3C7C4", borderRadius: 10, padding: "12px 14px" }}>{error}</p>
      )}

      {data && (
        <>
          <section className="stat-row">
            <StatCard label="Applications" value={data.pipeline.total} sub="all time" />
            <StatCard label="Awaiting screening" value={data.pipeline.submitted} sub="just submitted" />
            <StatCard label="Collecting evidence" value={data.pipeline.collecting} sub="KYC &amp; field visit" />
            <StatCard label="With a lender" value={data.pipeline.with_lender} sub="submitted or in review" />
          </section>

          <div className="panel-grid">
            <Panel title="Pipeline" sub="Where every application currently sits.">
              <Bars
                rows={[
                  ["Submitted", data.pipeline.submitted],
                  ["Collecting evidence", data.pipeline.collecting],
                  ["Under assessment", data.pipeline.assessing],
                  ["With lender", data.pipeline.with_lender],
                  ["Approved", data.pipeline.approved],
                  ["Disbursed", data.pipeline.disbursed],
                  ["In development", data.pipeline.in_development],
                  ["Declined / ineligible", data.pipeline.declined],
                ]}
                empty="No applications yet."
              />
            </Panel>

            <Panel title="Risk mix" sub="Indicative grades from readiness checks, and how much of each is corroborated.">
              {data.risk.grades.length === 0 ? (
                <p className="muted">No readiness checks taken yet.</p>
              ) : (
                <>
                  <div className="grade-row">
                    {data.risk.grades.map((g) => (
                      <div key={g.grade} className="grade-chip" style={{ borderColor: GRADE_TONE[g.grade] }}>
                        <span className="grade-letter" style={{ color: GRADE_TONE[g.grade] }}>{g.grade}</span>
                        <span className="grade-count">{g.count}</span>
                      </div>
                    ))}
                  </div>
                  <Bars
                    rows={data.risk.confidence.map((c) => [`${c.level} confidence`, c.count])}
                    empty="No confidence data."
                  />
                </>
              )}
            </Panel>

            <Panel title="Money" sub="Requested against what has actually moved.">
              <dl className="kv">
                <KV k="Requested" v={taka(data.finance.requested)} />
                <KV k="Recommended" v={taka(data.finance.recommended)} />
                <KV k="Approved" v={taka(data.finance.approved)} />
                <KV k="Disbursed" v={taka(data.finance.disbursed)} />
                <KV k="Outstanding" v={taka(data.finance.outstanding)} />
                <KV k="Overdue" v={taka(data.finance.overdue)} tone={data.finance.overdue > 0 ? "warn" : undefined} />
                <KV k="Active accounts" v={String(data.finance.active_accounts)} />
              </dl>
            </Panel>

            <Panel title="Collections" sub="What is due now, from the generated repayment schedules.">
              <dl className="kv">
                <KV k="Due today" v={taka(data.collections.due_today)} />
                <KV k="Due this week" v={taka(data.collections.due_this_week)} />
                <KV k="Overdue" v={taka(data.collections.overdue_amount)}
                    tone={data.collections.overdue_amount > 0 ? "warn" : undefined} />
              </dl>
              <dl className="kv">
                <KV k="On-time repayment"
                    v={data.performance.on_time_rate == null ? "—" : `${data.performance.on_time_rate}%`} />
                <KV k="PAR 30" v={String(data.performance.par30 ?? 0)} />
                <KV k="PAR 90" v={String(data.performance.par90 ?? 0)} />
                <KV k="Avg days late" v={String(data.performance.avg_days_late ?? 0)} />
              </dl>
              {data.finance.active_accounts === 0 && (
                <p className="muted">No disbursed loans yet — these fill once the first facility is live.</p>
              )}
            </Panel>

            <Panel title="Readiness funnel" sub="The self-check is the on-ramp: it should convert.">
              <dl className="kv">
                <KV k="Checks taken" v={String(data.readiness.checks_taken)} />
                <KV k="Distinct farmers" v={String(data.readiness.distinct_users)} />
                <KV k="Converted to an application" v={String(data.readiness.converted_to_application)} />
                <KV k="Conversion rate" v={`${data.readiness.conversion_rate}%`} />
                <KV k="Warm leads — ready but not applied" v={String(data.readiness.warm_leads)} tone="good" />
              </dl>
              <p className="muted small">
                Warm leads are farmers whose check says they are ready but who have not applied. This is
                the field team&apos;s call list.
              </p>
            </Panel>

            <Panel title="Most common gaps" sub="What the field team should be fixing at scale.">
              <Bars
                rows={data.readiness.top_gaps.map((g) => [g.label, g.count])}
                empty="No gaps recorded yet."
              />
            </Panel>
          </div>
        </>
      )}

      <style jsx>{`
        .page-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:18px; }
        .eyebrow { text-transform:uppercase; letter-spacing:.08em; font-size:11px; font-weight:700; color:#9B5173; margin:0 0 4px; }
        h1 { margin:0 0 6px; font-size:28px; }
        .page-sub { margin:0; color:#6b6b6b; max-width:720px; }
        .stat-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin-bottom:18px; }
        .panel-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:16px; }
        .grade-row { display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap; }
        .grade-chip { display:flex; flex-direction:column; align-items:center; border:2px solid; border-radius:12px; padding:8px 16px; min-width:64px; }
        .grade-letter { font-size:22px; font-weight:800; line-height:1; }
        .grade-count { font-size:13px; color:#6b6b6b; margin-top:2px; }
        .kv { display:grid; grid-template-columns:1fr auto; gap:6px 12px; margin:0 0 12px; }
        .muted { color:#6b6b6b; margin:8px 0 0; }
        .small { font-size:12.5px; }
      `}</style>
    </AdminShell>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="card stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value ?? 0}</p>
      <p className="stat-sub">{sub}</p>
      <style jsx>{`
        .stat { background:#fff; border:1px solid #E8D7DF; border-radius:14px; padding:16px 18px; }
        .stat-label { margin:0 0 6px; font-size:13px; color:#6b6b6b; }
        .stat-value { margin:0; font-size:30px; font-weight:800; color:#2B0B1E; line-height:1.1; }
        .stat-sub { margin:4px 0 0; font-size:12px; color:#9B5173; }
      `}</style>
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        <p>{sub}</p>
      </header>
      {children}
      <style jsx>{`
        .panel { background:#fff; border:1px solid #E8D7DF; border-radius:14px; padding:18px 20px; }
        h2 { margin:0 0 4px; font-size:16px; }
        header p { margin:0 0 14px; font-size:12.5px; color:#6b6b6b; }
      `}</style>
    </section>
  );
}

function KV({ k, v, tone }: { k: string; v: string; tone?: "warn" | "good" }) {
  const color = tone === "warn" ? "#B4443C" : tone === "good" ? "#1E9E5A" : "#2B0B1E";
  return (
    <>
      <dt style={{ color: "#6b6b6b", fontSize: 13 }}>{k}</dt>
      <dd style={{ margin: 0, fontWeight: 700, color, textAlign: "right", fontSize: 14 }}>{v}</dd>
    </>
  );
}

function Bars({ rows, empty }: { rows: [string, number][]; empty: string }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  if (!rows.length || rows.every(([, n]) => !n)) return <p style={{ color: "#6b6b6b" }}>{empty}</p>;
  return (
    <div>
      {rows.map(([label, n]) => (
        <div key={label} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
            <span style={{ color: "#2B0B1E" }}>{label}</span>
            <strong>{n}</strong>
          </div>
          <div style={{ background: "#F4E8EE", borderRadius: 6, height: 8 }}>
            <div style={{ width: `${(n / max) * 100}%`, background: "#871449", height: 8, borderRadius: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
