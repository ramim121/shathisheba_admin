"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPinCheck } from "lucide-react";
import { Select } from "@/components/Select";

/**
 * Where Shathi Sheba is live. A zone is wherever an active field officer's
 * area covers — add an officer under Community > Field officers and their area
 * turns on for loans, orders, listings and projects. Weather, training and the
 * loan readiness check are open everywhere regardless.
 */

type Zone = {
  officer_id: string;
  officer: string;
  phone: string | null;
  division: string | null;
  district: string | null;
  upazila: string | null;
  covers: "upazila" | "district" | "division";
  upazilas_covered: number;
};

type SettingRow = { id: string; setting_key: string; value_text: string | null };

const CHECKIN: Record<string, string> = {
  flag: "Required — mismatches flagged for review",
  enforce: "Required — must be inside the profile district",
  off: "Not asked"
};

export function OperationalZones() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [row, setRow] = useState<SettingRow | null>(null);
  const [levelRow, setLevelRow] = useState<SettingRow | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [z, s] = await Promise.all([
      fetch("/api/v1/admin/geo/zones", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/v1/settings/app?surface=admin&limit=500", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
    ]);
    setZones(Array.isArray(z?.data) ? z.data : []);
    const rows: SettingRow[] = Array.isArray(s?.data) ? s.data : [];
    setRow(rows.find((r) => r.setting_key === "loan_gps_checkin") ?? null);
    setLevelRow(rows.find((r) => r.setting_key === "operational_profile_level") ?? null);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(target: SettingRow | null, value: string, label: string) {
    if (!target) return;
    const res = await fetch(`/api/v1/settings/app?id=${encodeURIComponent(target.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value_text: value })
    });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok && json.ok ? `${label}: ${value}.` : json.message ?? "That did not save.");
    await load();
  }

  async function setCheckin(value: string) {
    if (!row) return;
    const res = await fetch(`/api/v1/settings/app?id=${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value_text: value })
    });
    const json = await res.json().catch(() => ({}));
    setMessage(res.ok && json.ok ? `Loan GPS check-in: ${CHECKIN[value]}.` : json.message ?? "That did not save.");
    await load();
  }

  const upazilas = zones.reduce((sum, z) => sum + Number(z.upazilas_covered || 0), 0);

  return (
    <section className="panel geo-scope" style={{ marginTop: 14 }}>
      <div className="panel-header">
        <div>
          <h2><MapPinCheck size={20} /> Operational zones</h2>
          <p>
            Loans, orders, listings and projects are available only where an active field officer covers the
            farmer, at each feature&apos;s level above. Farmers outside see &ldquo;not active in your zone yet&rdquo;
            and keep weather, training and the loan readiness check.
          </p>
        </div>
      </div>
      {message ? <div className="notice">{message}</div> : null}
      <div className="geo-scope-row">
        <div className="geo-scope-copy">
          <strong>Loan GPS check-in</strong>
          <span>Where the phone is when a farmer submits a loan application, compared with their profile district.</span>
        </div>
        <div className="geo-scope-control">
          <Select
            aria-label="Loan GPS check-in"
            value={row?.value_text ?? "flag"}
            disabled={!row}
            options={Object.entries(CHECKIN).map(([value, label]) => ({ value, label }))}
            onChange={(v) => void setCheckin(v)}
          />
        </div>
      </div>
      <div className="geo-scope-row">
        <div className="geo-scope-copy">
          <strong>Location a profile needs</strong>
          <span>Before any loan, order, listing or project, whatever each feature is filtered by. Farmers short of it are asked to add it or to ask a field officer.</span>
        </div>
        <div className="geo-scope-control">
          <Select
            aria-label="Location a profile needs"
            value={levelRow?.value_text ?? "upazila"}
            disabled={!levelRow}
            options={[{ value: "upazila", label: "Upazila" }, { value: "district", label: "District" }]}
            onChange={(v) => void save(levelRow, v, "Profile location needed")}
          />
        </div>
      </div>
      <table className="table" style={{ marginTop: 10 }}>
        <thead><tr><th>Area</th><th>Covers</th><th>Upazilas</th><th>Field officer</th></tr></thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.officer_id}>
              <td>{[z.upazila, z.district, z.division].filter(Boolean).join(", ")}</td>
              <td style={{ textTransform: "capitalize" }}>{z.covers}</td>
              <td>{z.upazilas_covered}</td>
              <td>{z.officer}{z.phone ? ` · ${z.phone}` : ""}</td>
            </tr>
          ))}
          {zones.length === 0 ? (
            <tr><td colSpan={4}>No zones yet — no active field officer has an area. Every gated service is off.</td></tr>
          ) : null}
        </tbody>
      </table>
      {zones.length ? <p className="muted" style={{ marginTop: 8 }}>{upazilas} upazila(s) live.</p> : null}
    </section>
  );
}
