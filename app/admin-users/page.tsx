"use client";

import { useEffect, useState, useCallback } from "react";
import { AdminShell } from "@/components/AdminShell";
import { ShieldCheck, UserPlus, Loader2 } from "lucide-react";

type AdminRow = {
  id: number; name: string; email: string; phone: string | null;
  role: string; is_active: number; last_login_at: string | null; created_at: string;
};

const ROLES = ["super_admin", "hq_admin", "marketplace_manager", "content_editor", "field_officer", "auditor"];

export default function AdminUsersPage() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "hq_admin", phone: "" });
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const json = await res.json();
      if (json.ok) setRows(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMsg({ kind: "err", text: json.message || "Failed to add admin." });
        return;
      }
      setMsg({ kind: "ok", text: `Admin "${json.admin.name}" added.` });
      setForm({ name: "", email: "", password: "", role: "hq_admin", phone: "" });
      load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h1 className="page-title"><ShieldCheck size={22} style={{ verticalAlign: "-4px", marginRight: 8 }} />Admin Users</h1>
          <p className="page-sub">Manage who can sign in to the admin console. New admins can also be created via the API: <code>POST /api/admin/users</code>.</p>
        </div>
      </div>

      <div className="au-grid">
        <form className="au-card" onSubmit={submit}>
          <h2 className="au-card-title"><UserPlus size={17} style={{ verticalAlign: "-3px", marginRight: 6 }} />Add admin</h2>
          <label className="login-label">Full name</label>
          <input className="login-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <label className="login-label">Email</label>
          <input className="login-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <label className="login-label">Phone (optional)</label>
          <input className="login-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <label className="login-label">Role</label>
          <select className="login-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
          </select>
          <label className="login-label">Temporary password</label>
          <input className="login-input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={4} required />
          {msg ? <div className={msg.kind === "ok" ? "au-ok" : "login-error"}>{msg.text}</div> : null}
          <button className="login-btn" type="submit" disabled={saving}>{saving ? <Loader2 size={18} className="spin" /> : "Add admin"}</button>
        </form>

        <div className="au-card">
          <h2 className="au-card-title">Existing admins ({rows.length})</h2>
          {loading ? <p className="page-sub">Loading…</p> : (
            <table className="au-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.email}</td>
                    <td><span className="au-role">{r.role.replace(/_/g, " ")}</span></td>
                    <td>{r.is_active ? <span className="au-badge au-on">active</span> : <span className="au-badge au-off">disabled</span>}</td>
                    <td>{r.last_login_at ? new Date(r.last_login_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
