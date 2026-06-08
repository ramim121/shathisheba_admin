"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, UserPlus, XCircle } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";

type NotifUser = { id: string; full_name: string; phone: string; location?: string; created_at: string };
type NotifKyc = { id: string; user_id: string; full_name: string; phone: string; doc_type: string; document_url: string; created_at: string };
type NotifData = {
  counts: { new_users_24h: number; new_users_7d: number; pending_kyc: number; total: number };
  new_users: NotifUser[];
  pending_kyc: NotifKyc[];
};

function fmt(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function docLabel(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function NotificationsPanel() {
  const [data, setData] = useState<NotifData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/app/admin/notifications", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "Could not load notifications.");
      setData(json.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function moderate(id: string, status: "verified" | "rejected") {
    setMessage("");
    try {
      const res = await fetch(`/api/v1/app/user-kyc?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "Update failed.");
      setMessage(`Document ${status}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed.");
    }
  }

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Activity</p>
          <h1 className="page-title">Notifications</h1>
          <p className="subtitle">Newly registered app users and KYC documents awaiting approval.</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={() => void load()} type="button"><RefreshCw size={18} /> Refresh</button>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        <div className="panel" style={{ padding: 16 }}>
          <p className="subtitle" style={{ margin: 0 }}>New users (24h)</p>
          <h2 style={{ margin: "6px 0 0", fontSize: 28 }}>{data?.counts.new_users_24h ?? "—"}</h2>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <p className="subtitle" style={{ margin: 0 }}>New users (7d)</p>
          <h2 style={{ margin: "6px 0 0", fontSize: 28 }}>{data?.counts.new_users_7d ?? "—"}</h2>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <p className="subtitle" style={{ margin: 0 }}>KYC pending</p>
          <h2 style={{ margin: "6px 0 0", fontSize: 28 }}>{data?.counts.pending_kyc ?? "—"}</h2>
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="panel">
          <div className="panel-header">
            <div><h2><UserPlus size={18} style={{ verticalAlign: "-3px" }} /> New Users</h2><p>Most recent registrations from the app.</p></div>
            <Status label={loading ? "Loading" : `${data?.new_users.length ?? 0}`} />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Phone</th><th>Area</th><th>Joined</th></tr></thead>
              <tbody>
                {(data?.new_users ?? []).map((u) => (
                  <tr key={u.id}>
                    <td><strong>{u.full_name}</strong></td>
                    <td>{u.phone}</td>
                    <td>{u.location || "—"}</td>
                    <td>{fmt(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div><h2>KYC To Approve</h2><p>Documents uploaded by users, pending review.</p></div>
            <Status label={loading ? "Loading" : `${data?.pending_kyc.length ?? 0}`} />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Type</th><th>Doc</th><th>Action</th></tr></thead>
              <tbody>
                {(data?.pending_kyc ?? []).map((k) => (
                  <tr key={k.id}>
                    <td><strong>{k.full_name}</strong><div style={{ color: "#6b7280", fontSize: 12 }}>{k.phone}</div></td>
                    <td>{docLabel(k.doc_type)}</td>
                    <td><a href={k.document_url} target="_blank" rel="noreferrer">View</a></td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => void moderate(k.id, "verified")} title="Verify" type="button"><CheckCircle2 size={16} /></button>
                        <button onClick={() => void moderate(k.id, "rejected")} title="Reject" type="button"><XCircle size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data && data.pending_kyc.length === 0 ? (
                  <tr><td colSpan={4} style={{ color: "#9ca3af" }}>No documents pending approval.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
