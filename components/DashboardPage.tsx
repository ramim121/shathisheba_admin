"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Plus, Search } from "lucide-react";
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
import { marketUpdates, reportData } from "@/lib/data";

type Row = Record<string, unknown>;
type Counts = { listings: number; enrollments: number; kyc: number; users: number; orders: number; total: number };

function n(v: unknown) {
  return Number(v ?? 0);
}

export function DashboardPage() {
  const [stats, setStats] = useState<Row | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    fetch("/api/v1/app/admin/stats").then((r) => r.json()).then((j) => { if (j.ok) setStats(j.data); }).catch(() => {});
    fetch("/api/v1/app/admin/approvals").then((r) => r.json()).then((j) => { if (j.ok) setCounts(j.data.counts); }).catch(() => {});
  }, []);

  // Live top metrics — every card links to its management page.
  const metricCards = [
    { label: "Registered farmers", value: stats ? n(stats.farmers).toLocaleString() : "…", trend: stats ? `+${n(stats.farmers_30d)} in 30 days` : "loading", href: "/users" },
    { label: "Active sale listings", value: stats ? n(stats.listings_active).toLocaleString() : "…", trend: stats ? `${n(stats.listings_total)} total submitted` : "loading", href: "/sale" },
    { label: "Pending approvals", value: counts ? String(counts.total) : "…", trend: "KYC, listings, projects, orders", href: "/approvals" },
    { label: "Buy orders", value: stats ? n(stats.orders_total).toLocaleString() : "…", trend: stats ? `${n(stats.orders_delivered)} delivered` : "loading", href: "/orders" }
  ];

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">MIS Dashboard</p>
          <h1 className="page-title">Shathi Sheba admin command center</h1>
          <p className="subtitle">
            Monitor the app data pipeline: listings, orders, KYC approvals, learning content, weather alerts, and community moderation.
          </p>
        </div>
        <div className="toolbar">
          <Link className="btn ghost" href="/manage/view"><Search size={18} /> Search records</Link>
          <button className="btn ghost" type="button"><Download size={18} /> Export MIS</button>
          <Link className="btn primary" href="/manage/form"><Plus size={18} /> Create item</Link>
        </div>
      </section>

      <section className="grid metrics">
        {metricCards.map((metric) => (
          <Link className="metric metric-link" key={metric.label} href={metric.href}>
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
              <h2>Operational Trend</h2>
              <p>Orders, sale listings, and partner applications.</p>
            </div>
            <Status label="Live MIS" />
          </div>
          <div style={{ height: 330, padding: 18 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={reportData} margin={{ left: 0, right: 12, top: 20, bottom: 0 }}>
                <defs>
                  <linearGradient id="shathiArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#95134f" stopOpacity={0.34} />
                    <stop offset="95%" stopColor="#95134f" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f0e1e9" vertical={false} />
                <XAxis dataKey="month" stroke="#8a5a73" tickLine={false} axisLine={false} />
                <YAxis stroke="#8a5a73" tickLine={false} axisLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="orders" stroke="#f0a21a" strokeWidth={3} fill="transparent" />
                <Area type="monotone" dataKey="listings" stroke="#95134f" strokeWidth={3} fill="url(#shathiArea)" />
                <Area type="monotone" dataKey="partners" stroke="#28a66a" strokeWidth={3} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <aside>
          <Link className="insight insight-link" href="/approvals">
            <h2>Work queue</h2>
            <p>{counts ? counts.total : "…"} priority item(s) need admin review across listings, project enrollment, KYC, new users and orders. Open the approvals to-do board →</p>
          </Link>
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Recent App Updates</h2>
                <p>Homepage cards controlled by admin.</p>
              </div>
            </div>
            <div className="module-stack">
              {marketUpdates.map((item) => (
                <div className="work-card" key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.area}</p>
                  <div style={{ marginTop: 12 }}><Status label={item.status} /></div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="feature-grid" style={{ marginTop: 18 }}>
        <article className="feature-card">
          <h3>Sale verification</h3>
          <p>Review AI-filled livestock/crop listings, weights, breed, price breakdown, and field verification.</p>
          <Link className="count-btn" href="/approvals">{counts ? counts.listings : "…"} pending listings →</Link>
        </article>
        <article className="feature-card">
          <h3>Order fulfillment</h3>
          <p>Track payment status, delivery assignment, stock confirmation, and customer support notes.</p>
          <Link className="count-btn" href="/approvals">{counts ? counts.orders : "…"} orders awaiting stock check →</Link>
        </article>
        <article className="feature-card">
          <h3>KYC approvals</h3>
          <p>Verify NID, land, banking, farm assessment, due diligence, and project enrollment.</p>
          <Link className="count-btn" href="/approvals">{counts ? counts.enrollments + counts.kyc + counts.users : "…"} applications to review →</Link>
        </article>
      </section>
    </AdminShell>
  );
}
