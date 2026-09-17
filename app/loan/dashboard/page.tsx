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
  A: "#1E9E5A", B: "#2563EB", C: "#D97706", D: "var(--bad-fg)",
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
      <section className="topbar">
        <div>
          <p className="eyeline">Loan &amp; Credit</p>
          <h1 className="page-title">Credit dashboard</h1>
          <p className="subtitle">
            The finance pipeline end to end — applications, risk mix, money position, repayment
            performance and the readiness funnel that feeds it.
          </p>
        </div>
      </section>

      {loading && <p className="empty-note">Loading portfolio…</p>}
      {error && (
        <p className="error">{error}</p>
      )}

      {data && (
        <>
          <section className="grid metrics">
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

    </AdminShell>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
      <small>{sub}</small>
    </div>
  );
}

function Panel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function KV({ k, v, tone }: { k: string; v: string; tone?: "warn" | "good" }) {
  return (
    <>
      <dt>{k}</dt>
      <dd className={tone === "warn" ? "is-bad" : tone === "good" ? "is-ok" : undefined}>{v}</dd>
    </>
  );
}

function Bars({ rows, empty }: { rows: [string, number][]; empty: string }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  if (!rows.length || rows.every(([, n]) => !n)) return <p className="empty-note">{empty}</p>;
  return (
    <div className="bars">
      {rows.map(([label, n]) => (
        <div className="bar" key={label}>
          <div className="meter-head">
            <span>{label}</span>
            <strong>{n}</strong>
          </div>
          <div className="meter-track">
            <div className="meter-fill" style={{ width: `${(n / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
