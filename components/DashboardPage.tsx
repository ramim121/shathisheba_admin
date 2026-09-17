"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Search, ShoppingCart, Tag, UserPlus, Briefcase, Megaphone } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";

type Row = Record<string, unknown>;
type Counts = { listings: number; enrollments: number; kyc: number; users: number; orders: number; total: number };
type Overview = {
  trend: { month: string; orders: number; listings: number; enrollments: number; farmers: number }[];
  activity: Row[];
  updates: Row[];
};

const SERIES = [
  { key: "farmers", label: "New farmers", color: "#a855f7" },
  { key: "orders", label: "Orders", color: "#E8A020" },
  { key: "listings", label: "Sale listings", color: "#7B1536" },
  { key: "enrollments", label: "Project enrollments", color: "#28a66a" }
] as const;

const ACTIVITY: Record<string, { icon: typeof Tag; label: string; href: (id: string) => string }> = {
  order: { icon: ShoppingCart, label: "Order", href: (id) => `/manage/view?resource=buy%2Forders&id=${id}` },
  listing: { icon: Tag, label: "Listing", href: (id) => `/sale/${id}` },
  enrollment: { icon: Briefcase, label: "Enrollment", href: () => "/kyc" },
  farmer: { icon: UserPlus, label: "New farmer", href: (id) => `/manage/view?resource=users&id=${id}` }
};

function n(v: unknown) {
  return Number(v ?? 0);
}

function ago(value: unknown): string {
  const t = new Date(String(value)).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function DashboardPage() {
  const [stats, setStats] = useState<Row | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loan, setLoan] = useState<Row | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    fetch("/api/v1/app/admin/stats").then((r) => r.json()).then((j) => { if (j.ok) setStats(j.data); }).catch(() => {});
    fetch("/api/v1/app/admin/approvals").then((r) => r.json()).then((j) => { if (j.ok) setCounts(j.data.counts); }).catch(() => {});
    // Loan pipeline for the finance stat card and its action card (ADM-LON-04).
    fetch("/api/v1/admin/loan/dashboard").then((r) => r.json()).then((j) => { if (j.ok) setLoan(j.data); }).catch(() => {});
    fetch("/api/v1/admin/dashboard/overview").then((r) => r.json()).then((j) => { if (j.ok) setOverview(j.data); }).catch(() => {});
  }, []);

  const pipeline = (loan?.pipeline ?? null) as Record<string, number> | null;
  const loanOpen = pipeline
    ? pipeline.submitted + pipeline.collecting + pipeline.assessing + pipeline.with_lender
    : null;

  // Live top metrics — every card links to its management page.
  const metricCards = [
    { label: "Registered farmers", tone: "", value: stats ? n(stats.farmers).toLocaleString() : "…", trend: stats ? `+${n(stats.farmers_30d)} in 30 days` : "loading", href: "/users" },
    { label: "Active sale listings", tone: "tone-gold", value: stats ? n(stats.listings_active).toLocaleString() : "…", trend: stats ? `${n(stats.listings_total)} total submitted` : "loading", href: "/sale" },
    { label: "Pending approvals", tone: "tone-plum", value: counts ? String(counts.total) : "…", trend: "KYC, listings, projects, orders", href: "/approvals" },
    { label: "Buy orders", tone: "tone-sky", value: stats ? n(stats.orders_total).toLocaleString() : "…", trend: stats ? `${n(stats.orders_delivered)} delivered` : "loading", href: "/orders" },
    { label: "Loan pipeline", tone: "tone-leaf", value: loanOpen === null ? "…" : String(loanOpen), trend: pipeline ? `${pipeline.with_lender} with a lender · ${pipeline.disbursed} disbursed` : "loading", href: "/loan/applications" }
  ];

  // The MIS export: headline figures plus the six-month trend, as one CSV.
  function exportMis() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["Metric,Value,Note", ...metricCards.map((m) => [m.label, m.value, m.trend].map(esc).join(","))];
    if (overview) {
      lines.push("", ["Month", ...SERIES.map((s) => s.label)].map(esc).join(","));
      for (const t of overview.trend) lines.push([t.month, t.farmers, t.orders, t.listings, t.enrollments].map(esc).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shathi-sheba-mis-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">MIS Dashboard</p>
          <h1 className="page-title">Good to see you — here is today at Shathi Sheba</h1>
          <p className="subtitle">Farmers, listings, orders, project enrollments and loans, live from the database.</p>
        </div>
        <div className="toolbar">
          <Link className="btn ghost" href="/manage/view"><Search size={18} /> Search records</Link>
          <button className="btn ghost" type="button" onClick={exportMis}><Download size={18} /> Export MIS</button>
          <Link className="btn primary" href="/notifications/send"><Megaphone size={18} /> Send notification</Link>
        </div>
      </section>

      <section className="grid metrics">
        {metricCards.map((metric) => (
          <Link className={`metric metric-link ${metric.tone}`} key={metric.label} href={metric.href}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.trend}</small>
          </Link>
        ))}
      </section>

      <section className="dashboard-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Six-month activity</h2>
              <p>New records per month across the app.</p>
            </div>
            <Status label="Live" />
          </div>
          <div className="chart-legend">
            {SERIES.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
          </div>
          <div className="chart-box">
            {overview ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={overview.trend} margin={{ left: -18, right: 8, top: 16, bottom: 0 }}>
                  <defs>
                    {SERIES.map((s) => (
                      <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={s.color} stopOpacity={0.22} />
                        <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke="#f0e1e9" vertical={false} />
                  <XAxis dataKey="month" stroke="#8a5a73" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis stroke="#8a5a73" tickLine={false} axisLine={false} allowDecimals={false} fontSize={12} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #ead8e3", fontSize: 12 }} />
                  {SERIES.map((s) => (
                    <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.5} fill={`url(#g-${s.key})`} dot={false} activeDot={{ r: 4 }} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : <div className="empty-note">Loading…</div>}
          </div>
        </div>

        <aside>
          <Link className="insight insight-link" href="/approvals">
            <h2>Work queue · {counts ? counts.total : "…"}</h2>
            <p>Items waiting for a decision across listings, project enrollment, KYC, new users and orders. Open the approvals board →</p>
          </Link>
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Recent activity</h2>
                <p>The latest things farmers did in the app.</p>
              </div>
            </div>
            {overview?.activity.length ? (
              <ul className="activity-list">
                {overview.activity.map((a) => {
                  const kind = ACTIVITY[String(a.kind)] ?? ACTIVITY.order;
                  const Icon = kind.icon;
                  return (
                    <li key={`${a.kind}-${a.id}`}>
                      <Link href={kind.href(String(a.id))}>
                        <span className="activity-icon"><Icon size={16} /></span>
                        <span style={{ minWidth: 0 }}>
                          <div className="activity-title">{kind.label} · {String(a.who ?? "")}</div>
                          <div className="activity-meta">{[a.ref, a.detail].filter((x) => String(x ?? "").trim()).join(" · ")}</div>
                        </span>
                        <span style={{ display: "grid", justifyItems: "end", gap: 4 }}>
                          <Status label={String(a.status ?? "")} />
                          <span className="activity-when">{ago(a.at)}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : <div className="empty-note">{overview ? "Nothing yet." : "Loading…"}</div>}
          </div>
        </aside>
      </section>

      <section className="dashboard-layout">
        <section className="feature-grid is-flush">
          <article className="feature-card">
            <h3>Sale verification</h3>
            <p>Listings waiting for a field visit, weight check and approval.</p>
            <Link className="count-btn" href="/approvals">{counts ? counts.listings : "…"} pending listings →</Link>
          </article>
          <article className="feature-card">
            <h3>Order fulfilment</h3>
            <p>Orders to stock-check, assign to a distributor and deliver.</p>
            <Link className="count-btn" href="/approvals">{counts ? counts.orders : "…"} awaiting stock check →</Link>
          </article>
          <article className="feature-card">
            <h3>Loan applications</h3>
            <p>Screening, evidence, assessment and lender submission.</p>
            <Link className="count-btn" href="/loan/applications">{loanOpen === null ? "…" : loanOpen} awaiting action →</Link>
          </article>
          <article className="feature-card">
            <h3>KYC & enrollment</h3>
            <p>NID, banking and farm checks before a farmer joins a project.</p>
            <Link className="count-btn" href="/approvals">{counts ? counts.enrollments + counts.kyc + counts.users : "…"} to review →</Link>
          </article>
        </section>
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Market updates</h2>
              <p>What farmers see in the app's market section.</p>
            </div>
            <Link className="btn ghost sm" href="/market-updates">Manage</Link>
          </div>
          {overview?.updates.length ? (
            <ul className="activity-list">
              {overview.updates.map((u) => (
                <li key={String(u.id)}>
                  <Link href={`/manage/form?resource=market-updates&id=${u.id}`}>
                    <span className="activity-icon"><Megaphone size={16} /></span>
                    <span style={{ minWidth: 0 }}>
                      <div className="activity-title">{String(u.title ?? "")}</div>
                      <div className="activity-meta">{String(u.area ?? "")}</div>
                    </span>
                    <Status label={String(u.status ?? "")} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <div className="empty-note">{overview ? "No market updates yet." : "Loading…"}</div>}
        </div>
      </section>
    </AdminShell>
  );
}
