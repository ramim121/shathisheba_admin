"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, MapPin, Pencil, Plus, Search } from "lucide-react";

/**
 * The whole geography on one page: division -> district -> upazila, each column
 * filtered by the selection to its left, every name editable in place, in both
 * languages. Replaces three flat list pages where a district's upazilas could
 * only be found by scrolling 499 rows.
 */

type Place = { id: string; name_en: string; name_bn?: string | null };
type Level = "divisions" | "districts" | "upazilas";
type Hit = { upazila_id: string; district_id: string; division_id: string; upazila: string; district: string; division: string; upazila_bn?: string | null };

async function list(url: string): Promise<Place[]> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch {
    return [];
  }
}

function Column({
  title, level, rows, selected, onSelect, onSaved, parentId, parentKey, emptyText
}: {
  title: string;
  level: Level;
  rows: Place[];
  selected?: string;
  onSelect?: (id: string) => void;
  onSaved: (message: string) => void;
  parentId?: string;
  parentKey?: "division_id" | "district_id";
  emptyText: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [en, setEn] = useState("");
  const [bn, setBn] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(method: "PATCH" | "POST", id: string | null, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const url = id ? `/api/v1/geo/${level}?id=${encodeURIComponent(id)}` : `/api/v1/geo/${level}`;
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "That did not save.");
      onSaved(method === "POST" ? `Added ${body.name_en}.` : `Saved ${body.name_en}.`);
      setEditing(null);
      setAdding(false);
    } catch (error) {
      onSaved(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  const canAdd = level === "divisions" || Boolean(parentId);

  return (
    <div className="geo-col">
      <div className="geo-col-head">
        <strong>{title}</strong>
        <span>{rows.length}</span>
      </div>
      <ul>
        {rows.map((row) =>
          editing === row.id ? (
            <li key={row.id} className="geo-edit">
              <input className="input" value={en} onChange={(e) => setEn(e.target.value)} placeholder="English name" />
              <input className="input" value={bn} onChange={(e) => setBn(e.target.value)} placeholder="বাংলা নাম" />
              <div>
                <button type="button" className="btn small primary" disabled={busy || !en.trim()} onClick={() => void send("PATCH", row.id, { name_en: en.trim(), name_bn: bn.trim() })}>Save</button>
                <button type="button" className="btn small" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </li>
          ) : (
            <li key={row.id} className={selected === row.id ? "active" : ""}>
              <button type="button" className="geo-row" onClick={() => onSelect?.(row.id)}>
                <span>{row.name_en}</span>
                <small>{row.name_bn}</small>
                {onSelect ? <ChevronRight size={14} /> : null}
              </button>
              <button
                type="button"
                className="geo-pencil"
                aria-label={`Edit ${row.name_en}`}
                onClick={() => { setEditing(row.id); setEn(row.name_en); setBn(row.name_bn ?? ""); }}
              >
                <Pencil size={13} />
              </button>
            </li>
          )
        )}
        {rows.length === 0 ? <li className="geo-empty">{emptyText}</li> : null}
      </ul>
      {canAdd ? (
        adding ? (
          <div className="geo-edit geo-add">
            <input className="input" value={en} onChange={(e) => setEn(e.target.value)} placeholder="English name" />
            <input className="input" value={bn} onChange={(e) => setBn(e.target.value)} placeholder="বাংলা নাম" />
            <div>
              <button
                type="button"
                className="btn small primary"
                disabled={busy || !en.trim()}
                onClick={() => void send("POST", null, { name_en: en.trim(), name_bn: bn.trim(), ...(parentKey && parentId ? { [parentKey]: parentId } : {}) })}
              >
                Add
              </button>
              <button type="button" className="btn small" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn small add geo-add-btn" onClick={() => { setAdding(true); setEn(""); setBn(""); }}>
            <Plus size={14} /> Add {title.toLowerCase().replace(/s$/, "")}
          </button>
        )
      ) : null}
    </div>
  );
}

export function GeoManager() {
  const [divisions, setDivisions] = useState<Place[]>([]);
  const [districts, setDistricts] = useState<Place[]>([]);
  const [upazilas, setUpazilas] = useState<Place[]>([]);
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [focus, setFocus] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);

  const refresh = useCallback((note: string) => { setMessage(note); setTick((t) => t + 1); }, []);

  useEffect(() => { list("/api/v1/geo/divisions").then(setDivisions); }, [tick]);
  useEffect(() => {
    if (!division) { setDistricts([]); return; }
    list(`/api/v1/geo/districts?division_id=${division}`).then(setDistricts);
  }, [division, tick]);
  useEffect(() => {
    if (!district) { setUpazilas([]); return; }
    list(`/api/v1/geo/upazilas?district_id=${district}`).then(setUpazilas);
  }, [district, tick]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/v1/geo/search?q=${encodeURIComponent(q)}&limit=10`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => setHits(Array.isArray(j.data) ? j.data : []))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <section className="panel geo-manager">
      <div className="panel-header">
        <div>
          <h2><MapPin size={20} /> Geography</h2>
          <p>
            8 divisions, 64 districts and their upazilas, with English and Bangla names. Every location in the
            platform is stored as an id pointing here, so a rename here changes it everywhere at once.
          </p>
        </div>
        <div className="geo-search wide">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an upazila…" aria-label="Find an upazila" />
        </div>
      </div>
      {hits.length ? (
        <ul className="geo-hits inline">
          {hits.map((h) => (
            <li key={h.upazila_id}>
              <button type="button" onClick={() => { setDivision(h.division_id); setDistrict(h.district_id); setFocus(h.upazila_id); setQuery(""); setHits([]); }}>
                <strong>{h.upazila}{h.upazila_bn ? ` / ${h.upazila_bn}` : ""}</strong>
                <span>{h.district} · {h.division}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <div className="notice">{message}</div> : null}
      <div className="geo-columns">
        <Column
          title="Divisions" level="divisions" rows={divisions} selected={division}
          onSelect={(id) => { setDivision(id); setDistrict(""); setFocus(""); }}
          onSaved={refresh} emptyText="Loading…"
        />
        <Column
          title="Districts" level="districts" rows={districts} selected={district}
          onSelect={(id) => { setDistrict(id); setFocus(""); }}
          onSaved={refresh} parentId={division} parentKey="division_id"
          emptyText={division ? "No districts." : "Choose a division."}
        />
        <Column
          title="Upazilas" level="upazilas" rows={upazilas} selected={focus}
          onSelect={(id) => setFocus(id)}
          onSaved={refresh} parentId={district} parentKey="district_id"
          emptyText={district ? "No upazilas." : "Choose a district."}
        />
      </div>
    </section>
  );
}
