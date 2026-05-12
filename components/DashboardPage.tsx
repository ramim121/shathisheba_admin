"use client";

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
import {
  buyOrders,
  communityPosts,
  marketUpdates,
  metrics,
  partnerApplications,
  reportData,
  saleListings
} from "@/lib/data";

export function DashboardPage() {
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
          <button className="btn ghost" type="button"><Search size={18} /> Search records</button>
          <button className="btn ghost" type="button"><Download size={18} /> Export MIS</button>
          <button className="btn primary" type="button"><Plus size={18} /> Create item</button>
        </div>
      </section>

      <section className="grid metrics">
        {metrics.map((metric) => (
          <article className="metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.trend}</small>
          </article>
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
          <div className="insight">
            <h2>Work queue</h2>
            <p>{partnerApplications.length + saleListings.length + communityPosts.length} priority items need admin review across KYC, sale verification, and community moderation.</p>
          </div>
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
          <strong>{saleListings.length} listings</strong>
        </article>
        <article className="feature-card">
          <h3>Order fulfillment</h3>
          <p>Track payment status, delivery assignment, stock confirmation, and customer support notes.</p>
          <strong>{buyOrders.length} active orders</strong>
        </article>
        <article className="feature-card">
          <h3>KYC approvals</h3>
          <p>Verify NID, land, banking, farm assessment, due diligence, and project enrollment.</p>
          <strong>{partnerApplications.length} applications</strong>
        </article>
      </section>
    </AdminShell>
  );
}
