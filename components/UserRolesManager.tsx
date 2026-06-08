"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Search } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";

type UserRow = {
  id: string;
  full_name: string;
  phone: string;
  location?: string;
  roles: string[];
};

const ROLE_OPTIONS: { key: string; label: string }[] = [
  { key: "shathisheba_buyer", label: "Buyer" },
  { key: "shathisheba_seller", label: "Seller (Partner)" },
  { key: "field_officer", label: "Field Officer" }
];

function roleLabel(role: string) {
  return ROLE_OPTIONS.find((r) => r.key === role)?.label ?? role;
}

export function UserRolesManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/v1/app/users-with-roles", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "Could not load users.");
      const rows: UserRow[] = json.data ?? [];
      setUsers(rows);
      setDraft(Object.fromEntries(rows.map((u) => [u.id, [...u.roles]])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggle(userId: string, role: string) {
    setDraft((current) => {
      const set = new Set(current[userId] ?? []);
      if (set.has(role)) set.delete(role);
      else set.add(role);
      return { ...current, [userId]: Array.from(set) };
    });
  }

  async function save(userId: string) {
    const roles = draft[userId] ?? [];
    if (roles.length === 0) {
      setMessage("Select at least one role before saving.");
      return;
    }
    setSavingId(userId);
    setMessage("");
    try {
      const res = await fetch("/api/v1/app/user-roles/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, roles })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "Save failed.");
      setMessage(`Roles updated for ${json.result.full_name}: ${json.result.roles.map(roleLabel).join(", ")}`);
      setUsers((current) => current.map((u) => (u.id === userId ? { ...u, roles: json.result.roles } : u)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSavingId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.full_name} ${u.phone} ${u.location ?? ""}`.toLowerCase().includes(q));
  }, [users, query]);

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Manage App Data</p>
          <h1 className="page-title">App User Roles</h1>
          <p className="subtitle">Assign one or more roles per registered app user. Default is Buyer. Add Seller (Partner) to unlock listing for sale, or Field Officer for full access.</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={() => void load()} type="button"><RefreshCw size={18} /> Refresh</button>
        </div>
      </section>

      <section className="list-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Registered Users</h2>
              <p>Tick the roles for each user and press Save. Multiple roles are allowed.</p>
            </div>
            <Status label={loading ? "Loading" : `${filtered.length} users`} />
          </div>

          <div style={{ padding: "0 16px 12px" }}>
            <div className="field" style={{ maxWidth: 360 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Search size={16} /> Search</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, phone or area" />
            </div>
          </div>

          {message ? <div className="notice">{message}</div> : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Current Roles</th>
                  <th>Assign Roles</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const selected = draft[u.id] ?? [];
                  const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...u.roles].sort());
                  return (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.full_name}</strong>
                        <div style={{ color: "#6b7280", fontSize: 12 }}>{u.phone}{u.location ? ` · ${u.location}` : ""}</div>
                      </td>
                      <td>
                        {u.roles.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {u.roles.map((r) => <Status key={r} label={roleLabel(r)} />)}
                          </div>
                        ) : <span style={{ color: "#9ca3af" }}>None</span>}
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {ROLE_OPTIONS.map((role) => (
                            <label key={role.key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                              <input type="checkbox" checked={selected.includes(role.key)} onChange={() => toggle(u.id, role.key)} />
                              {role.label}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td>
                        <button className={`btn ${dirty ? "primary" : "ghost"}`} disabled={!dirty || savingId === u.id} onClick={() => void save(u.id)} type="button">
                          {savingId === u.id ? <RefreshCw size={16} /> : <Save size={16} />} Save
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
