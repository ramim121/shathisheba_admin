"use client";

import { useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { DATASETS, TABLE_DATASET, TABLE_LABEL } from "@/lib/clear-records-datasets";

// Clear Records — reset a test account without deleting it.
//
// The flow is deliberately two-step: look up what exists, then confirm by
// typing the phone number back. This is an irreversible wipe of real user data,
// so a single mis-click must not be able to trigger it.
//
// The dataset list, the table labels and the wipe plan all come from
// lib/clear-records-datasets so this page cannot drift from what the API does.

type Row = { table: string; rows: number };
type Result = {
  user: { id: string; full_name: string | null; phone: string | null };
  deleted: Row[];
  total: number;
  reset: string[];
};

export default function ClearRecordsPage() {
  const [identifier, setIdentifier] = useState("");
  const [preview, setPreview] = useState<Result | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [datasets, setDatasets] = useState<string[]>(
    DATASETS.filter((d) => d.defaultOn).map((d) => d.key)
  );
  const [resetOnboarding, setResetOnboarding] = useState(true);
  const [resetRoles, setResetRoles] = useState(false);
  const [done, setDone] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookUp() {
    setBusy(true); setError(null); setDone(null); setPreview(null); setConfirmText("");
    try {
      const res = await fetch(
        `/api/v1/admin/users/clear-records/preview?identifier=${encodeURIComponent(identifier)}`,
        { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.message || `HTTP ${res.status}`);
      setPreview(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed.");
    } finally { setBusy(false); }
  }

  async function clearNow() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/admin/users/clear-records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          confirm: confirmText,
          datasets,
          reset_onboarding: resetOnboarding,
          reset_roles: resetRoles,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.message || `HTTP ${res.status}`);
      setDone(json.result);
      setPreview(null);
      setConfirmText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed.");
    } finally { setBusy(false); }
  }

  // Only the rows belonging to a still-selected dataset are actually going to
  // be deleted, so the confirmation must count those rather than everything the
  // preview found.
  const selectedTables = new Set(
    preview?.deleted
      .filter((r) => datasets.some((k) => TABLE_DATASET[r.table] === k))
      .map((r) => r.table) ?? []
  );
  const selectedTotal = (preview?.deleted ?? [])
    .filter((r) => selectedTables.has(r.table))
    .reduce((sum, r) => sum + r.rows, 0);
  const keptTotal = (preview?.total ?? 0) - selectedTotal;

  const armed =
    !!preview &&
    confirmText.trim() === identifier.trim() &&
    (datasets.length > 0 || resetOnboarding || resetRoles);

  function toggle(key: string, on: boolean) {
    setDatasets((cur) => (on ? [...cur, key] : cur.filter((k) => k !== key)));
  }

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Users</p>
          <h1 className="page-title">Clear records</h1>
          <p className="subtitle">
            Wipes what an account has <em>done</em> — loans, readiness checks, orders, listings,
            enrolments, posts, training progress, notifications, KYC documents, banking and
            preferences — while keeping the account and its basic profile. Use it to run the same
            phone number through a flow again without re-registering.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Find the account</h2>
            <p>Search by phone number or user id.</p>
          </div>
        </div>
        <div className="cr-lookup">
          <input
            id="identifier"
            className="cr-input"
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setPreview(null); setDone(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && identifier.trim()) void lookUp(); }}
            placeholder="01966662633"
            aria-label="Phone number or user id"
          />
          <button className="btn primary" onClick={lookUp} disabled={busy || !identifier.trim()}>
            {busy && !preview ? "Looking up…" : "Look up"}
          </button>
        </div>
      </section>

      {error ? <div className="cr-error">{error}</div> : null}

      {preview ? (
        <>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>{preview.user.full_name || "—"}</h2>
                <p>{preview.user.phone} · user #{preview.user.id}</p>
              </div>
              <span className={`status-pill ${selectedTotal ? "red" : "grey"}`}>
                {selectedTotal} row{selectedTotal === 1 ? "" : "s"} selected
              </span>
            </div>

            {preview.total === 0 ? (
              <p className="cr-ok">This account has no associated records. Nothing to clear.</p>
            ) : (
              <div className="cr-body">
                <div>
                  <p className="cr-head">What to clear</p>
                  <div className="cr-opts">
                    {DATASETS.map((d) => (
                      <label className="cr-opt" key={d.key}>
                        <input
                          type="checkbox"
                          checked={datasets.includes(d.key)}
                          onChange={(e) => toggle(d.key, e.target.checked)}
                        />
                        <span className="cr-opt-text">
                          <strong>{d.label}</strong>
                          <em>{d.hint}</em>
                        </span>
                      </label>
                    ))}
                  </div>

                  <p className="cr-head">Also reset</p>
                  <div className="cr-opts">
                    <label className="cr-opt">
                      <input type="checkbox" checked={resetOnboarding} onChange={(e) => setResetOnboarding(e.target.checked)} />
                      <span className="cr-opt-text">
                        <strong>Reset onboarding</strong>
                        <em>Clears the personal-info and KYC-verified flags and saved preferences, so the
                          next login walks the full first-run journey. Name, phone and district are kept.</em>
                      </span>
                    </label>
                    <label className="cr-opt">
                      <input type="checkbox" checked={resetRoles} onChange={(e) => setResetRoles(e.target.checked)} />
                      <span className="cr-opt-text">
                        <strong>Also clear roles</strong>
                        <em>Removes granted roles. The buyer role is re-granted automatically on next login.</em>
                      </span>
                    </label>
                  </div>
                </div>

                <aside className="cr-side">
                  <p className="cr-head">Rows found</p>
                  <ul className="cr-rows">
                    {preview.deleted.map((r) => {
                      const inScope = selectedTables.has(r.table);
                      return (
                        <li key={r.table} className={inScope ? "" : "out"}>
                          <span>{TABLE_LABEL[r.table] ?? r.table}</span>
                          <strong>{inScope ? r.rows : "kept"}</strong>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="cr-note">
                    {selectedTotal} row{selectedTotal === 1 ? "" : "s"} will be deleted
                    {keptTotal > 0 ? `, ${keptTotal} kept` : ""}.
                  </p>
                </aside>
              </div>
            )}
          </section>

          {preview.total > 0 || resetOnboarding || resetRoles ? (
            <section className="cr-danger">
              <p><strong>This cannot be undone.</strong> Type <code>{identifier}</code> to confirm.</p>
              <div className="cr-lookup">
                <input
                  className="cr-input"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={identifier}
                  aria-label="Type the phone number to confirm"
                />
                <button className="btn cr-destructive" onClick={clearNow} disabled={!armed || busy}>
                  {busy ? "Clearing…" : `Clear ${selectedTotal} record${selectedTotal === 1 ? "" : "s"}`}
                </button>
              </div>
              {datasets.length === 0 && !resetOnboarding && !resetRoles ? (
                <p className="cr-note">Nothing is selected, so there is nothing to clear.</p>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {done ? (
        <section className="panel cr-done">
          <div className="panel-header">
            <div>
              <h2>Cleared</h2>
              <p>
                {done.user.full_name} · {done.user.phone} — {done.total} row{done.total === 1 ? "" : "s"} removed.
                The account and its basic profile are intact.
              </p>
            </div>
            <span className="status-pill green">Done</span>
          </div>
          {done.deleted.length > 0 ? (
            <ul className="cr-rows cr-rows-flat">
              {done.deleted.map((r) => (
                <li key={r.table}><span>{TABLE_LABEL[r.table] ?? r.table}</span><strong>{r.rows}</strong></li>
              ))}
            </ul>
          ) : null}
          <p className="cr-note">
            {done.reset.length > 0 ? `Also reset: ${done.reset.join(", ")}. ` : ""}
            The phone is signed out — log in again in the app to start fresh.
          </p>
        </section>
      ) : null}
    </AdminShell>
  );
}
