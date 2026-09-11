"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPinned, RefreshCw } from "lucide-react";
import { Select } from "@/components/Select";

/**
 * Per-feature geo filter levels (app_settings geo_scope.<feature>).
 *
 * Each row is one feature and the level its visibility is locked at. The API
 * reads these live, so a change applies on the next request — no deploy.
 */

type Feature = {
  key: string;
  label: string;
  description: string;
  allowed: string[];
  value: string;
};

type SettingRow = { id: string; setting_key: string; value_text: string | null };

const LEVEL_LABEL: Record<string, string> = {
  upazila: "Same upazila",
  district: "Same district",
  division: "Same division",
  none: "Everyone — no filter",
  gps: "Phone's GPS position"
};

const LEVEL_NOTE: Record<string, string> = {
  upazila: "Narrowest. Farmers without an upazila on their profile see only area-wide items.",
  district: "Anyone in the same district.",
  division: "Anyone in the same division.",
  none: "The feature is not filtered by location at all.",
  gps: "Where the phone is now, falling back to the profile's district."
};

function rowsOf(json: unknown): SettingRow[] {
  const data = (json as { data?: unknown })?.data;
  if (Array.isArray(data)) return data as SettingRow[];
  const rows = (data as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as SettingRow[]) : [];
}

export function GeoScopeSettings() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [scopes, settings] = await Promise.all([
      fetch("/api/v1/admin/geo/scopes", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/v1/settings/app?surface=admin&limit=500", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
    ]);
    setFeatures(Array.isArray(scopes?.data) ? scopes.data : []);
    setRows(rowsOf(settings));
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(feature: Feature, value: string) {
    setBusy(feature.key);
    setMessage("");
    const key = `geo_scope.${feature.key}`;
    const row = rows.find((r) => r.setting_key === key);
    try {
      const res = row
        ? await fetch(`/api/v1/settings/app?id=${encodeURIComponent(row.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value_text: value })
          })
        : await fetch("/api/v1/settings/app", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ setting_key: key, value_text: value, description: feature.description })
          });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "That did not save.");
      setMessage(`${feature.label}: now ${LEVEL_LABEL[value] ?? value}. Applies from the next request.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel geo-scope">
      <div className="panel-header">
        <div>
          <h2><MapPinned size={20} /> Geo filters</h2>
          <p>
            Choose the level each feature is locked at. A row is shown to a farmer when its area contains the
            farmer at that level — a Savar listing at &ldquo;Same upazila&rdquo; reaches only Savar. Matching is by
            id, so spelling can no longer drop anyone out.
          </p>
        </div>
        <button className="btn ghost" type="button" onClick={() => void load()}><RefreshCw size={16} /> Refresh</button>
      </div>
      {message ? <div className="notice">{message}</div> : null}
      <div className="geo-scope-list">
        {features.map((feature) => (
          <div className="geo-scope-row" key={feature.key}>
            <div className="geo-scope-copy">
              <strong>{feature.label}</strong>
              <span>{feature.description}</span>
            </div>
            <div className="geo-scope-control">
              <Select
                aria-label={`${feature.label} level`}
                value={feature.value}
                disabled={busy === feature.key}
                options={feature.allowed.map((level) => ({ value: level, label: LEVEL_LABEL[level] ?? level }))}
                onChange={(v) => void save(feature, v)}
              />
              <small>{LEVEL_NOTE[feature.value] ?? ""}</small>
            </div>
          </div>
        ))}
        {features.length === 0 ? <p className="muted">Loading…</p> : null}
      </div>
    </section>
  );
}
