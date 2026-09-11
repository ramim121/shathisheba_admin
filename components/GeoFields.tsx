"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { Select, type SelectOption } from "@/components/Select";

/**
 * Division -> district -> upazila, by id, for any admin form.
 *
 * Replaces the free-text division / district / upazila boxes that let "Dhaka
 * District", "Mymensingh Sadar" as a district, and "Chattogram Sadar" (an
 * upazila that does not exist) into the data. Submits three hidden inputs —
 * division_id, district_id, upazila_id — and the server writes the names from
 * them. Searching an upazila fills all three at once.
 *
 * A blank level widens the area rather than meaning "not filled in": no upazila
 * under a district is the whole district, no district under a division is the
 * whole division, nothing at all is nationwide. The "Any …" wording and the
 * summary line say so, because "— none —" read as a mistake.
 */

type Option = { id: string; name_en: string; name_bn?: string | null };
type Hit = {
  upazila_id: string;
  district_id: string;
  division_id: string;
  upazila: string;
  upazila_bn?: string | null;
  district: string;
  division: string;
};

export type GeoInitial = {
  division_id?: string | null;
  district_id?: string | null;
  upazila_id?: string | null;
};

export type GeoValue = { division_id: string; district_id: string; upazila_id: string };

async function getList<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();
    return Array.isArray(json.data) ? (json.data as T[]) : [];
  } catch {
    return [];
  }
}

function toOptions(list: Option[]): SelectOption[] {
  return list.map((o) => ({ value: o.id, label: o.name_bn ? `${o.name_en} / ${o.name_bn}` : o.name_en }));
}

export function GeoFields({
  initial,
  required = false,
  hint,
  disabled = false,
  invalid = false,
  onChange
}: {
  initial?: GeoInitial;
  required?: boolean;
  hint?: string;
  /** Read-only: shows the area, submits nothing. */
  disabled?: boolean;
  invalid?: boolean;
  /** Fires with the current ids whenever any level changes (and once on load). */
  onChange?: (value: GeoValue) => void;
}) {
  const [division, setDivision] = useState(initial?.division_id ?? "");
  const [district, setDistrict] = useState(initial?.district_id ?? "");
  const [upazila, setUpazila] = useState(initial?.upazila_id ?? "");
  const [divisions, setDivisions] = useState<Option[]>([]);
  const [districts, setDistricts] = useState<Option[]>([]);
  const [upazilas, setUpazilas] = useState<Option[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const report = useRef(onChange);
  useEffect(() => { report.current = onChange; });

  // The edit form loads its record after first render; follow it when it lands.
  useEffect(() => {
    setDivision(initial?.division_id ?? "");
    setDistrict(initial?.district_id ?? "");
    setUpazila(initial?.upazila_id ?? "");
  }, [initial?.division_id, initial?.district_id, initial?.upazila_id]);

  useEffect(() => {
    report.current?.({ division_id: division, district_id: district, upazila_id: upazila });
  }, [division, district, upazila]);

  useEffect(() => {
    getList<Option>("/api/v1/geo/divisions").then(setDivisions);
  }, []);
  useEffect(() => {
    if (!division) { setDistricts([]); return; }
    getList<Option>(`/api/v1/geo/districts?division_id=${encodeURIComponent(division)}`).then(setDistricts);
  }, [division]);
  useEffect(() => {
    if (!district) { setUpazilas([]); return; }
    getList<Option>(`/api/v1/geo/upazilas?district_id=${encodeURIComponent(district)}`).then(setUpazilas);
  }, [district]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    const timer = setTimeout(() => {
      getList<Hit>(`/api/v1/geo/search?q=${encodeURIComponent(q)}&limit=8`).then(setHits);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const divisionName = divisions.find((o) => o.id === division)?.name_en;
  const districtName = districts.find((o) => o.id === district)?.name_en;
  const upazilaName = upazilas.find((o) => o.id === upazila)?.name_en;

  const divisionOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: "Any division (nationwide)" }, ...toOptions(divisions)],
    [divisions]
  );
  const districtOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: division ? `Any district in ${divisionName ?? "this division"}` : "Any district" }, ...toOptions(districts)],
    [districts, division, divisionName]
  );
  const upazilaOptions = useMemo<SelectOption[]>(
    () => [{ value: "", label: district ? `Any upazila in ${districtName ?? "this district"}` : "Any upazila" }, ...toOptions(upazilas)],
    [upazilas, district, districtName]
  );

  // Names arrive a moment after the ids on an edit form; "…" beats a wrong area.
  const summary = upazila
    ? `${upazilaName ?? "…"} upazila, ${districtName ?? "…"}`
    : district
      ? `all of ${districtName ?? "…"} district`
      : division
        ? `all of ${divisionName ?? "…"} division`
        : "nationwide";

  return (
    <div className="geo-fields">
      {disabled ? null : (
        <>
          <input type="hidden" name="division_id" value={division} />
          <input type="hidden" name="district_id" value={district} />
          <input type="hidden" name="upazila_id" value={upazila} />
          <div className="geo-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search an upazila — English or Bangla (e.g. Savar / সাভার)"
              aria-label="Search upazila"
            />
          </div>
          {hits.length ? (
            <ul className="geo-hits">
              {hits.map((h) => (
                <li key={h.upazila_id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDivision(h.division_id);
                      setDistrict(h.district_id);
                      setUpazila(h.upazila_id);
                      setQuery("");
                      setHits([]);
                    }}
                  >
                    <strong>{h.upazila}{h.upazila_bn ? ` / ${h.upazila_bn}` : ""}</strong>
                    <span>{h.district} · {h.division}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      <div className="geo-selects">
        <Select
          aria-label={required ? "Division (required)" : "Division"}
          options={divisionOptions}
          value={division}
          disabled={disabled}
          invalid={invalid}
          onChange={(next) => { setDivision(next); setDistrict(""); setUpazila(""); }}
        />
        <Select
          aria-label="District"
          options={districtOptions}
          value={district}
          disabled={disabled || !division}
          onChange={(next) => { setDistrict(next); setUpazila(""); }}
        />
        <Select
          aria-label="Upazila"
          options={upazilaOptions}
          value={upazila}
          disabled={disabled || !district}
          onChange={setUpazila}
        />
      </div>
      <small className="geo-summary">
        <MapPin size={12} aria-hidden="true" /> Applies to: <strong>{summary}</strong>
      </small>
      {hint ? <small className="field-hint">{hint}</small> : null}
    </div>
  );
}
