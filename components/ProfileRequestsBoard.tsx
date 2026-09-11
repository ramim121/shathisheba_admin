"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, UserCog, X } from "lucide-react";

/**
 * Farmers' profile changes awaiting approval.
 *
 * After a farmer's first save, every edit lands here instead of on the live
 * profile. The location is the reason: it decides which listings, projects and
 * officers the farmer can reach, so changing it is a decision, not a setting.
 * Approval applies the change; rejection needs a note, which the farmer sees.
 */

type Snapshot = Record<string, unknown>;
type Request = {
  id: string;
  user_id: string;
  user_name: string | null;
  user_phone: string | null;
  status: string;
  requested: Snapshot;
  current: Snapshot;
  reviewer_note: string | null;
  reviewer_name: string | null;
  created_at: string;
  reviewed_at: string | null;
};

const FIELDS: Array<{ key: string; label: string }> = [
  { key: "full_name", label: "Name" },
  { key: "gender", label: "Gender" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "area", label: "Area" },
  { key: "village", label: "Village / address" },
  { key: "profile_image_url", label: "Photo" }
];

function area(s: Snapshot) {
  return [s.upazila, s.district, s.division].filter(Boolean).join(", ") || "—";
}

function value(s: Snapshot, key: string): string {
  if (key === "area") return area(s);
  const v = s[key];
  if (v === null || v === undefined || v === "") return "—";
  return String(v).slice(0, key === "date_of_birth" ? 10 : undefined);
}

function when(v: unknown) {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ProfileRequestsBoard() {
  const [status, setStatus] = useState("pending");
  const [items, setItems] = useState<Request[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/admin/profile-requests?status=${status}`, { cache: "no-store" }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    setItems(Array.isArray(json?.data) ? json.data : []);
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    setMessage("");
    try {
      const res = await fetch("/api/v1/admin/profile-requests/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, decision, note: notes[id] ?? "" })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "That did not save.");
      setMessage(decision === "approve" ? "Approved — the farmer's profile and area are updated." : "Rejected — the farmer will see your note.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel pcr">
      <div className="panel-header">
        <div>
          <h2><UserCog size={20} /> Profile changes</h2>
          <p>
            A farmer&apos;s edits after their first save wait here. Until approved, their live profile — and the area
            that decides what they can see and sell — is unchanged, and they cannot send another request.
          </p>
        </div>
        <div className="pcr-filter">
          {["pending", "approved", "rejected"].map((s) => (
            <button key={s} type="button" className={`chip-btn${status === s ? " active" : ""}`} onClick={() => setStatus(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      {message ? <div className="notice">{message}</div> : null}
      {items.length === 0 ? <p className="muted">Nothing {status}.</p> : null}
      <div className="pcr-list">
        {items.map((r) => {
          const changed = new Set((r.requested.changed as string[] | undefined) ?? []);
          const areaChanged = ["division_id", "district_id", "upazila_id"].some((k) => changed.has(k));
          return (
            <article className="pcr-card" key={r.id}>
              <header>
                <div>
                  <strong>{r.user_name ?? "Farmer"}</strong>
                  <span>{r.user_phone ?? ""} · requested {when(r.created_at)}</span>
                </div>
                {areaChanged ? <span className="pcr-flag">Area change</span> : null}
              </header>
              <table className="table">
                <thead><tr><th /><th>Now</th><th>Requested</th></tr></thead>
                <tbody>
                  {FIELDS.map((f) => {
                    const differs = f.key === "area" ? areaChanged : changed.has(f.key);
                    return (
                      <tr key={f.key} className={differs ? "pcr-diff" : ""}>
                        <td>{f.label}</td>
                        <td>{value(r.current, f.key)}</td>
                        <td>{value(r.requested, f.key)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {r.status === "pending" ? (
                <div className="pcr-actions">
                  <input
                    className="input"
                    type="text"
                    placeholder="Note to the farmer (required to reject)"
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  />
                  <button className="btn primary" type="button" disabled={busy === r.id} onClick={() => void decide(r.id, "approve")}>
                    <Check size={16} /> Approve
                  </button>
                  <button className="btn ghost" type="button" disabled={busy === r.id} onClick={() => void decide(r.id, "reject")}>
                    <X size={16} /> Reject
                  </button>
                </div>
              ) : (
                <p className="muted">
                  {r.status} {r.reviewed_at ? `· ${when(r.reviewed_at)}` : ""} {r.reviewer_name ? `by ${r.reviewer_name}` : ""}
                  {r.reviewer_note ? ` — “${r.reviewer_note}”` : ""}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
