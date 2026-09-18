"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Camera, Check, HandCoins, Loader2, Package, PhoneCall, Search,
  ShoppingCart, Sparkles, Store, UserRound, X
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Select, fromLookup, type SelectOption } from "@/components/Select";
import { AiAssistLaunch, AiAssistPanel } from "@/components/AiAssist";
import "@/components/act-for-farmer.css";

type Row = Record<string, unknown>;
/** The shape /api/admin/lookups answers with: id, label, and a group that
    carries the hierarchy (a breed's group is its species, an item's is its
    category). */
type Option = { id: string; label: string; group?: string };

type Farmer = {
  id: string;
  full_name: string;
  phone: string;
  status: string;
  is_kyc_verified: number;
  area: string;
  listings: number;
  orders: number;
  open_loans: number;
};

type Block = { id: string; label: string; detail: string };

type FarmerFile = {
  profile: Row;
  roles: string[];
  banking: Row | null;
  farm: Row | null;
  documents: Row[];
  listings: Row[];
  orders: Row[];
  loans: Row[];
  active_loan: Row | null;
  readiness: Row | null;
  community_posts: number;
  officers: Row[];
  blockers: { listing: Block[]; order: Block[]; loan: Block[] };
};

type Tab = "listing" | "order" | "loan";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const taka = (v: unknown) => `৳${Number(v ?? 0).toLocaleString("en-IN")}`;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const json = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; data?: T; result?: T };
  if (!response.ok || json.ok === false) throw new Error(json.message ?? "The request failed.");
  return (json.data ?? json.result ?? (json as unknown)) as T;
}

/**
 * Doing what the app does, from a desk.
 *
 * A farmer phones the office, or a field officer calls it in, and someone has
 * to put a cow up for sale, order feed or start a loan application on their
 * behalf. Every one of those already exists as an app endpoint with its own
 * rules — operational zone, complete profile, one open application — so this
 * screen calls exactly those endpoints rather than writing rows directly. The
 * farmer's file is loaded first so the reasons a thing would be refused are on
 * screen before the form is filled, not after it is submitted.
 */
export function ActForFarmer() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Farmer[]>([]);
  const [searching, setSearching] = useState(false);
  const [file, setFile] = useState<FarmerFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [tab, setTab] = useState<Tab>("listing");
  const [error, setError] = useState("");
  const [lookups, setLookups] = useState<Record<string, Option[]>>({});

  const search = useCallback(async (q: string) => {
    setSearching(true);
    setError("");
    try {
      const data = await api<{ rows: Farmer[] }>(`/api/v1/admin/farmers/search?q=${encodeURIComponent(q)}`);
      setResults(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => { void search(""); }, [search]);

  useEffect(() => {
    void (async () => {
      try {
        const keys = "sale_items,animals,breeds,products,loan_products,loan_purposes";
        const res = await fetch(`/api/admin/lookups?keys=${keys}`);
        const json = (await res.json()) as { ok?: boolean; data?: Record<string, Option[]> };
        if (json.ok && json.data) setLookups(json.data);
      } catch {
        /* the forms fall back to free-text ids */
      }
    })();
  }, []);

  async function pick(id: string) {
    setLoadingFile(true);
    setError("");
    try {
      setFile(await api<FarmerFile>(`/api/v1/admin/farmer-file?user_id=${encodeURIComponent(id)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that farmer.");
    } finally {
      setLoadingFile(false);
    }
  }

  const profile = file?.profile;

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Users · on behalf of a farmer</p>
          <h1 className="page-title">Act for a farmer</h1>
          <p className="subtitle">
            List an animal, place an order or start a loan application for a farmer who called it in — through the
            same endpoints and the same rules the app uses. Everything is recorded against the farmer, with your
            admin id in the audit trail.
          </p>
        </div>
      </section>

      {error ? <div className="notice is-error">{error}</div> : null}

      <div className="act-layout">
        <section className="panel act-picker">
          <div className="panel-header">
            <div><h2>Choose a farmer</h2><p>Search by name, phone or id.</p></div>
          </div>
          <div className="act-search">
            <div className="search-box">
              <Search size={16} />
              <input
                value={query}
                placeholder="Name, phone or id…"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void search(query); }}
              />
            </div>
            <button className="btn" type="button" onClick={() => void search(query)} disabled={searching}>
              {searching ? <Loader2 size={15} className="act-spin" /> : <Search size={15} />} Search
            </button>
          </div>
          <ul className="act-results">
            {results.map((farmer) => (
              <li key={farmer.id}>
                <button
                  type="button"
                  className={`act-result${profile?.id === farmer.id ? " is-active" : ""}`}
                  onClick={() => void pick(farmer.id)}
                >
                  <span className="act-result-main">
                    <strong>{farmer.full_name}</strong>
                    <span>{farmer.phone} · {farmer.area || "no area"}</span>
                  </span>
                  <span className="act-result-tags">
                    {Number(farmer.is_kyc_verified) ? <span className="status-pill green">KYC</span> : null}
                    {farmer.open_loans > 0 ? <span className="status-pill gold">Loan</span> : null}
                    {farmer.listings > 0 ? <span className="pill">{farmer.listings} listed</span> : null}
                  </span>
                </button>
              </li>
            ))}
            {!searching && results.length === 0 ? <li className="act-empty">No farmer matches that.</li> : null}
          </ul>
        </section>

        <section className="act-work">
          {loadingFile ? (
            <div className="panel is-padded"><p className="empty-note"><Loader2 size={15} className="act-spin" /> Loading the farmer’s file…</p></div>
          ) : !file || !profile ? (
            <div className="panel is-padded">
              <div className="table-empty">
                <strong>Pick a farmer to start</strong>
                <span>Their file loads here with what they already have on the platform, and what would stop each action.</span>
              </div>
            </div>
          ) : (
            <>
              <FarmerHeader file={file} />
              <nav className="filter-tabs act-tabs">
                <button type="button" className={`filter-tab${tab === "listing" ? " active" : ""}`} onClick={() => setTab("listing")}>
                  <Store size={14} /> New sale listing
                </button>
                <button type="button" className={`filter-tab${tab === "order" ? " active" : ""}`} onClick={() => setTab("order")}>
                  <ShoppingCart size={14} /> Place an order
                </button>
                <button type="button" className={`filter-tab${tab === "loan" ? " active" : ""}`} onClick={() => setTab("loan")}>
                  <HandCoins size={14} /> Start a loan application
                </button>
              </nav>

              {tab === "listing" ? <ListingForm file={file} lookups={lookups} onDone={() => void pick(String(profile.id))} /> : null}
              {tab === "order" ? <OrderForm file={file} lookups={lookups} onDone={() => void pick(String(profile.id))} /> : null}
              {tab === "loan" ? <LoanForm file={file} lookups={lookups} onDone={() => void pick(String(profile.id))} /> : null}
            </>
          )}
        </section>
      </div>
    </AdminShell>
  );
}

/* --- the farmer's file, above the forms ---------------------------------- */

function FarmerHeader({ file }: { file: FarmerFile }) {
  const p = file.profile;
  const id = s(p.id);
  return (
    <section className="panel act-head">
      <div className="act-head-top">
        <div className="act-head-id">
          <span className="act-avatar"><UserRound size={20} /></span>
          <div>
            <h2>{s(p.full_name) || `Farmer #${id}`}</h2>
            <p>
              <PhoneCall size={12} /> {s(p.phone) || "no phone"} · {[s(p.village), s(p.upazila), s(p.district)].filter(Boolean).join(", ") || "no address"}
            </p>
          </div>
        </div>
        <div className="act-head-actions">
          <Link className="btn sm" href={`/manage/view?resource=users&id=${id}`}>Full record</Link>
          <Link className="btn sm" href={`/manage/form?resource=users&id=${id}`}>Edit profile</Link>
          <Link className="btn sm" href={`/manage/form?resource=app/user-banking`}>Banking</Link>
          <Link className="btn sm" href={`/manage/form?resource=app/user-farm`}>Farm info</Link>
          <Link className="btn sm" href={`/users/kyc`}>KYC documents</Link>
        </div>
      </div>

      <div className="act-facts">
        <span className="detail-fact"><span className="detail-fact-l">Status</span><span className="detail-fact-v">{s(p.status)}</span></span>
        <span className="detail-fact"><span className="detail-fact-l">KYC</span><span className="detail-fact-v">{Number(p.is_kyc_verified) ? "Verified" : "Not verified"}</span></span>
        <span className="detail-fact"><span className="detail-fact-l">Listings</span><span className="detail-fact-v">{file.listings.length}</span></span>
        <span className="detail-fact"><span className="detail-fact-l">Orders</span><span className="detail-fact-v">{file.orders.length}</span></span>
        <span className="detail-fact"><span className="detail-fact-l">Loans</span><span className="detail-fact-v">{file.loans.length}</span></span>
        {file.readiness ? (
          <span className="detail-fact">
            <span className="detail-fact-l">Readiness</span>
            <span className="detail-fact-v">{s(file.readiness.grade)} · {s(file.readiness.score)}</span>
          </span>
        ) : null}
        {file.farm ? (
          <span className="detail-fact">
            <span className="detail-fact-l">Land</span>
            <span className="detail-fact-v">{s(file.farm.total_land_decimals) || "—"} dec</span>
          </span>
        ) : null}
        {file.officers.length ? (
          <span className="detail-fact">
            <span className="detail-fact-l">Officer</span>
            <span className="detail-fact-v">{s(file.officers[0].name)}</span>
          </span>
        ) : null}
      </div>

      {file.active_loan ? (
        <p className="act-note is-warn">
          <AlertTriangle size={14} /> Open loan application {s(file.active_loan.application_code)} — {s(file.active_loan.status).replace(/_/g, " ")}.
          {" "}<Link href={`/loan/applications/${s(file.active_loan.id)}`}>Open the workspace</Link>
        </p>
      ) : null}
    </section>
  );
}

function Blockers({ list, action }: { list: Block[]; action: string }) {
  if (!list.length) return null;
  return (
    <div className="act-blockers">
      <h3><AlertTriangle size={14} /> Before you can {action}</h3>
      <ul>
        {list.map((b) => (
          <li key={b.id}><strong>{b.label}</strong><span>{b.detail}</span></li>
        ))}
      </ul>
    </div>
  );
}

/* --- 1. sale listing ------------------------------------------------------ */

type AnimalRead = {
  species: string; breed_guess: string; coat_colour: string;
  age_estimate_months: number | null; weight_estimate_kg: number | null;
  body_condition_1_5: number | null; horn_status: string; visible_issues: string[];
  photo_quality: string; title_en: string; title_bn: string;
  description_en: string; description_bn: string; confidence: number; notes: string;
};

function ListingForm({ file, lookups, onDone }: { file: FarmerFile; lookups: Record<string, Option[]>; onDone: () => void }) {
  const p = file.profile;
  const [form, setForm] = useState<Record<string, string>>({
    sale_item_id: "", animal_id: "", breed_id: "", title_en: "", title_bn: "", description: "",
    age_months: "", weight_kg: "", quantity: "1", unit: "piece", farmer_expected_price: "",
    contact_name: s(p.full_name), contact_phone: s(p.phone), address_text: [s(p.village), s(p.upazila), s(p.district)].filter(Boolean).join(", ")
  });
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<AnimalRead | null>(null);
  const [quote, setQuote] = useState<Row | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiField, setAiField] = useState<string>("");
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  // Breeds are grouped by species, animals carry their species too, so picking
  // "Cattle" narrows the breed list to cattle breeds.
  const species = useMemo(
    () => (lookups.animals ?? []).find((a) => a.id === form.animal_id)?.group ?? "",
    [lookups.animals, form.animal_id]
  );
  const breeds = useMemo<SelectOption[]>(
    () => fromLookup((lookups.breeds ?? []).filter((b) => !species || !b.group || b.group === species)),
    [lookups.breeds, species]
  );

  // The B2B preset behind the farmer's earning estimate: same endpoint the app
  // shows the farmer, so the number quoted on the phone is the app's number.
  useEffect(() => {
    const weight = Number(form.weight_kg);
    if (!form.animal_id || !Number.isFinite(weight) || weight <= 0) { setQuote(null); return; }
    let alive = true;
    void (async () => {
      try {
        const params = new URLSearchParams({
          animal_id: form.animal_id, user_id: s(p.id), weight: String(weight)
        });
        if (form.breed_id) params.set("breed_id", form.breed_id);
        if (form.sale_item_id) params.set("sale_item_id", form.sale_item_id);
        const data = await api<Row>(`/api/v1/app/sale/price-quote?${params.toString()}`);
        if (alive) setQuote(data);
      } catch {
        if (alive) setQuote(null);
      }
    })();
    return () => { alive = false; };
  }, [form.animal_id, form.breed_id, form.sale_item_id, form.weight_kg, p.id]);

  async function upload(chosen: File) {
    setUploading(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", chosen);
      body.append("folder", "sale-listings");
      const res = await fetch("/api/upload", { method: "POST", body });
      const json = (await res.json()) as { ok?: boolean; message?: string; url?: string; path?: string };
      if (!res.ok || !json.ok) throw new Error(json.message ?? "Upload failed.");
      const url = json.url ?? json.path ?? "";
      setPhotos((list) => [...list, url]);
      // Read the first photo straight away: it is what the estimate hangs on.
      if (photos.length === 0) await readPhoto(chosen);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  /** Sent as a data URL: no storage round trip, and no public URL required. */
  async function readPhoto(chosen: File) {
    setReading(true);
    setMessage("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("That file could not be read."));
        reader.readAsDataURL(chosen);
      });
      const result = await api<AnimalRead>("/api/v1/admin/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "animal_photo",
          image: dataUrl,
          context: { district: s(p.district), upazila: s(p.upazila), animal: labelOf(lookups.animals, form.animal_id) }
        })
      });
      setRead(result);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The photo could not be read.");
    } finally {
      setReading(false);
    }
  }

  /** The admin decides what to keep — nothing is applied until this is clicked. */
  function applyRead() {
    if (!read) return;
    setForm((f) => ({
      ...f,
      age_months: read.age_estimate_months != null && !f.age_months ? String(read.age_estimate_months) : f.age_months,
      weight_kg: read.weight_estimate_kg != null && !f.weight_kg ? String(read.weight_estimate_kg) : f.weight_kg,
      title_en: read.title_en && !f.title_en ? read.title_en : f.title_en,
      title_bn: read.title_bn && !f.title_bn ? read.title_bn : f.title_bn,
      description: read.description_en && !f.description ? read.description_en : f.description
    }));
    const breed = (lookups.breeds ?? []).find((b) => read.breed_guess && b.label.toLowerCase().includes(read.breed_guess.toLowerCase()));
    if (breed && !form.breed_id) set("breed_id", breed.id);
  }

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const payload: Record<string, unknown> = {
        user_id: s(p.id),
        sale_item_id: form.sale_item_id,
        animal_id: form.animal_id || null,
        breed_id: form.breed_id || null,
        title_en: form.title_en,
        title_bn: form.title_bn || null,
        description: form.description || null,
        age_months: form.age_months || null,
        weight_kg: form.weight_kg || null,
        quantity: form.quantity || "1",
        unit: form.unit || "piece",
        farmer_expected_price: form.farmer_expected_price || null,
        estimated_earning: estimatedEarning,
        pricing_rule_id: priceRule ? s(priceRule.id) : null,
        contact_name: form.contact_name || null,
        contact_phone: form.contact_phone || null,
        contact_is_self: 1,
        address_text: form.address_text || null,
        division: s(p.division) || null,
        district: s(p.district) || null,
        upazila: s(p.upazila) || null,
        media_json: photos.length ? JSON.stringify(photos) : null,
        ai_analysis_json: read ? JSON.stringify({ ...read, source: "admin_photo_read" }) : null,
        status: "submitted"
      };
      const result = await api<{ insertId?: number }>("/api/v1/sale/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      setMessage(`Listing created for ${s(p.full_name)} (record #${result?.insertId ?? "?"}). It enters the approval queue exactly as an app submission does.`);
      setForm((f) => ({ ...f, title_en: "", title_bn: "", description: "", weight_kg: "", age_months: "", farmer_expected_price: "" }));
      setPhotos([]);
      setRead(null);
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The listing could not be created.");
    } finally {
      setBusy(false);
    }
  }

  const priceRule = (quote?.rule ?? null) as Row | null;
  const breakdown = (quote?.breakdown ?? null) as Row | null;
  // The number the farmer is quoted on the phone: net rate x live weight.
  const estimatedEarning = breakdown
    ? Math.round(Number(breakdown.net_farmer_rate ?? 0) * Number(form.weight_kg || 0))
    : null;
  const ready = form.sale_item_id && form.title_en.trim() && Number(form.weight_kg) > 0;
  const blocked = file.blockers.listing.length > 0;

  return (
    <section className="panel is-padded act-form">
      <Blockers list={file.blockers.listing} action="list an animal" />

      <h3 className="act-form-title"><Store size={15} /> Animal for sale</h3>
      <p className="muted">
        The same six-step workflow follows: this lands as <code>submitted</code> and goes through field verification,
        pricing and the contract like any app listing.
      </p>

      {/* Photo first: it is what the AI read and the weight estimate hang on. */}
      <div className="act-photos">
        <div className="act-photo-row">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void upload(chosen);
              event.target.value = "";
            }}
          />
          <button className="btn" type="button" onClick={() => fileInput.current?.click()} disabled={uploading || reading}>
            {uploading ? <Loader2 size={15} className="act-spin" /> : <Camera size={15} />} Add photo
          </button>
          {photos.length ? <span className="act-photo-count">{photos.length} uploaded</span> : null}
          {reading ? <span className="act-photo-count"><Loader2 size={13} className="act-spin" /> reading the photo…</span> : null}
        </div>
        {photos.length ? (
          <div className="act-photo-strip">
            {photos.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            ))}
          </div>
        ) : null}

        {read ? (
          <div className={`act-read${read.species ? "" : " is-empty"}`}>
            <div className="act-read-head">
              <strong><Sparkles size={14} /> What the photo shows</strong>
              <span className="act-read-conf">confidence {Math.round((read.confidence ?? 0) * 100)}% · photo {read.photo_quality || "?"}</span>
            </div>
            {read.species ? (
              <>
                <ul className="act-read-list">
                  <li><span>Species</span><strong>{read.species}</strong></li>
                  <li><span>Breed guess</span><strong>{read.breed_guess || "—"}</strong></li>
                  <li><span>Colour</span><strong>{read.coat_colour || "—"}</strong></li>
                  <li><span>Age estimate</span><strong>{read.age_estimate_months != null ? `${read.age_estimate_months} months` : "—"}</strong></li>
                  <li><span>Weight estimate</span><strong>{read.weight_estimate_kg != null ? `${read.weight_estimate_kg} kg` : "—"}</strong></li>
                  <li><span>Condition</span><strong>{read.body_condition_1_5 != null ? `${read.body_condition_1_5}/5` : "—"}</strong></li>
                </ul>
                {read.visible_issues.length ? (
                  <p className="act-note is-warn"><AlertTriangle size={13} /> Visible: {read.visible_issues.join(", ")}</p>
                ) : null}
                <div className="act-read-actions">
                  <button className="btn primary sm" type="button" onClick={applyRead}><Check size={14} /> Fill empty fields</button>
                  <button className="btn sm" type="button" onClick={() => setRead(null)}><X size={14} /> Dismiss</button>
                  <span className="ai-panel-note">An estimate from one photo. Confirm the weight on the scale before pricing.</span>
                </div>
              </>
            ) : (
              <p className="act-note is-warn"><AlertTriangle size={13} /> {read.notes || "No animal could be read from that photo."}</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="form-grid act-grid">
        <div className="field">
          <label className="field-label"><span className="field-label-text">Item</span><b aria-hidden="true">*</b></label>
          <Select
            value={form.sale_item_id}
            placeholder="Category · item"
            options={fromLookup(lookups.sale_items ?? [])}
            onChange={(v) => set("sale_item_id", v)}
          />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Animal</span></label>
          <Select value={form.animal_id} placeholder="Pick an animal" options={fromLookup(lookups.animals ?? [])} onChange={(v) => { set("animal_id", v); set("breed_id", ""); }} />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Breed</span></label>
          <Select value={form.breed_id} placeholder="Pick a breed" options={breeds} onChange={(v) => set("breed_id", v)} />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Live weight (kg)</span><b aria-hidden="true">*</b></label>
          <input className="input" inputMode="decimal" value={form.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} placeholder="e.g. 220" />
          <small className="field-hint">Drives the earning estimate and the price rule.</small>
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Age (months)</span></label>
          <input className="input" inputMode="numeric" value={form.age_months} onChange={(e) => set("age_months", e.target.value)} placeholder="e.g. 26" />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Farmer’s expected price (৳)</span></label>
          <input className="input" inputMode="decimal" value={form.farmer_expected_price} onChange={(e) => set("farmer_expected_price", e.target.value)} placeholder="what the farmer asked for" />
        </div>

        <div className="field field-wide">
          <label className="field-label">
            <span className="field-label-text">Title (English)</span><b aria-hidden="true">*</b>
            <AiAssistLaunch label="Listing title" hasText={Boolean(form.title_en.trim())} canTranslate={false} onOpen={() => setAiField("title_en")} />
          </label>
          <input className="input" value={form.title_en} onChange={(e) => set("title_en", e.target.value)} placeholder="e.g. Cross Friesian bull, 26 months" />
          {aiField === "title_en" ? (
            <AiAssistPanel
              label="Listing title" resource="sale/listings" length="short" value={form.title_en}
              context={() => listingContext(form, lookups, p)}
              onInsert={(t) => set("title_en", t)} onClose={() => setAiField("")}
            />
          ) : null}
        </div>
        <div className="field field-wide">
          <label className="field-label">
            <span className="field-label-text">Title (Bangla)</span>
            <AiAssistLaunch label="Listing title (Bangla)" hasText={Boolean(form.title_bn.trim())} canTranslate={Boolean(form.title_en.trim())} onOpen={(m) => setAiField(m === "translate" ? "title_bn:translate" : "title_bn")} />
          </label>
          <input className="input" value={form.title_bn} onChange={(e) => set("title_bn", e.target.value)} />
          {aiField.startsWith("title_bn") ? (
            <AiAssistPanel
              label="Listing title (Bangla)" resource="sale/listings" language="bn" length="short"
              value={form.title_bn} translateFrom={form.title_en}
              autoRun={aiField.endsWith(":translate") ? "translate" : undefined}
              context={() => listingContext(form, lookups, p)}
              onInsert={(t) => set("title_bn", t)} onClose={() => setAiField("")}
            />
          ) : null}
        </div>
        <div className="field field-wide">
          <label className="field-label">
            <span className="field-label-text">Description</span>
            <AiAssistLaunch label="Listing description" hasText={Boolean(form.description.trim())} canTranslate={false} onOpen={() => setAiField("description")} />
          </label>
          <textarea className="input" value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} />
          {aiField === "description" ? (
            <AiAssistPanel
              label="Listing description" resource="sale/listings" length="medium" value={form.description}
              context={() => listingContext(form, lookups, p)}
              onInsert={(t) => set("description", t)} onClose={() => setAiField("")}
            />
          ) : null}
        </div>
      </div>

      {priceRule ? (
        <div className="act-quote">
          <h4>Price rule applied</h4>
          <ul>
            <li><span>District</span><strong>{s(priceRule.district) || "any"}</strong></li>
            <li><span>Farmer rate</span><strong>{taka(breakdown?.net_farmer_rate)}/{s(priceRule.unit) || "kg"}</strong></li>
            <li><span>Deductions</span><strong>{taka(breakdown?.total_deductions)}/{s(priceRule.unit) || "kg"}</strong></li>
            <li><span>At {form.weight_kg} kg the farmer receives</span><strong>{taka(estimatedEarning)}</strong></li>
          </ul>
        </div>
      ) : form.weight_kg && form.animal_id ? (
        <p className="act-note is-warn"><AlertTriangle size={13} /> No active price rule covers this animal in {s(p.district) || "this district"} — the listing can still be created, and pricing is set in the workflow.</p>
      ) : null}

      {message ? <p className={`act-note ${/could not|failed/i.test(message) ? "is-bad" : "is-ok"}`}>{message}</p> : null}

      <div className="act-actions">
        <button className="btn primary" type="button" onClick={() => void submit()} disabled={busy || blocked || !ready}>
          {busy ? <Loader2 size={16} className="act-spin" /> : <Store size={16} />} Create the listing
        </button>
        <span className="ai-panel-note">
          {blocked ? "Blocked — see above." : ready ? "Files as the farmer, into the approval queue." : "Item, title and weight are required."}
        </span>
      </div>
    </section>
  );
}

function listingContext(form: Record<string, string>, lookups: Record<string, Option[]>, p: Row) {
  return {
    animal: labelOf(lookups.animals, form.animal_id),
    breed: labelOf(lookups.breeds, form.breed_id),
    item: labelOf(lookups.sale_items, form.sale_item_id),
    age_months: form.age_months,
    weight_kg: form.weight_kg,
    district: s(p.district),
    upazila: s(p.upazila),
    existing_description: form.description
  };
}

function labelOf(options: Option[] | undefined, value: string) {
  return (options ?? []).find((o) => o.id === value)?.label ?? "";
}

/* --- 2. order ------------------------------------------------------------- */

type Line = { product_id: string; quantity: string };

function OrderForm({ file, lookups, onDone }: { file: FarmerFile; lookups: Record<string, Option[]>; onDone: () => void }) {
  const p = file.profile;
  const [lines, setLines] = useState<Line[]>([{ product_id: "", quantity: "1" }]);
  const [address, setAddress] = useState(
    s(file.farm?.farm_address) || [s(p.village), s(p.upazila), s(p.district)].filter(Boolean).join(", ")
  );
  const [method, setMethod] = useState("cash_on_delivery");
  const [deliveryFee, setDeliveryFee] = useState("0");
  const [promo, setPromo] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const usable = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
  const blocked = file.blockers.order.length > 0;

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<Row>("/api/v1/app/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: s(p.id),
          items: usable.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity) })),
          delivery_address: address,
          payment_method: method,
          delivery_fee: Number(deliveryFee) || 0,
          promo_code: promo.trim() || undefined,
          notes: notes.trim() || undefined
        })
      });
      setMessage(`Order ${s(result.order_code) || "placed"} created for ${s(p.full_name)} — ${taka(result.payable_amount)} payable. Stock and promotions were applied by the same code the app uses.`);
      setLines([{ product_id: "", quantity: "1" }]);
      setPromo("");
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The order could not be placed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel is-padded act-form">
      <Blockers list={file.blockers.order} action="place an order" />
      <h3 className="act-form-title"><ShoppingCart size={15} /> Order from the catalogue</h3>
      <p className="muted">
        Goes through the app’s order endpoint: stock is deducted under a lock, the first-purchase discount and any
        voucher are evaluated, and the farmer gets the same notifications.
      </p>

      <div className="act-lines">
        {lines.map((line, index) => (
          <div className="act-line" key={index}>
            <Select
              value={line.product_id}
              placeholder="Pick a product"
              options={fromLookup(lookups.products ?? [])}
              onChange={(v) => setLines((list) => list.map((l, i) => (i === index ? { ...l, product_id: v } : l)))}
            />
            <input
              className="input act-line-qty"
              inputMode="decimal"
              value={line.quantity}
              onChange={(e) => setLines((list) => list.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
              aria-label="Quantity"
            />
            <button
              type="button"
              className="btn sm"
              onClick={() => setLines((list) => (list.length === 1 ? list : list.filter((_, i) => i !== index)))}
              disabled={lines.length === 1}
              aria-label="Remove line"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button className="btn small add" type="button" onClick={() => setLines((list) => [...list, { product_id: "", quantity: "1" }])}>
          <Package size={14} /> Add another product
        </button>
      </div>

      <div className="form-grid act-grid">
        <div className="field field-wide">
          <label className="field-label"><span className="field-label-text">Delivery address</span><b aria-hidden="true">*</b></label>
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          <small className="field-hint">Prefilled from the farmer’s farm address, then their profile.</small>
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Payment method</span></label>
          <Select
            value={method}
            options={[
              { value: "cash_on_delivery", label: "Cash on delivery" },
              { value: "bkash", label: "bKash" },
              { value: "nagad", label: "Nagad" },
              { value: "bank_transfer", label: "Bank transfer" }
            ]}
            onChange={setMethod}
          />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Delivery fee (৳)</span></label>
          <input className="input" inputMode="decimal" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Promo code</span></label>
          <input className="input" value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="optional" />
        </div>
        <div className="field field-wide">
          <label className="field-label"><span className="field-label-text">Note for the warehouse</span></label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. called in by phone, deliver after 4pm" />
        </div>
      </div>

      {message ? <p className={`act-note ${/could not|failed|cannot/i.test(message) ? "is-bad" : "is-ok"}`}>{message}</p> : null}

      <div className="act-actions">
        <button className="btn primary" type="button" onClick={() => void submit()} disabled={busy || blocked || usable.length === 0 || !address.trim()}>
          {busy ? <Loader2 size={16} className="act-spin" /> : <ShoppingCart size={16} />} Place the order
        </button>
        <span className="ai-panel-note">
          {blocked ? "Blocked — see above." : usable.length ? `${usable.length} line${usable.length === 1 ? "" : "s"} ready.` : "Add at least one product."}
        </span>
      </div>
    </section>
  );
}

/* --- 3. loan application -------------------------------------------------- */

function LoanForm({ file, lookups, onDone }: { file: FarmerFile; lookups: Record<string, Option[]>; onDone: () => void }) {
  const p = file.profile;
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [tenure, setTenure] = useState("12");
  const [mode, setMode] = useState("monthly");
  const [purpose, setPurpose] = useState("");
  const [purposeText, setPurposeText] = useState("");
  const [consents, setConsents] = useState<string[]>([]);
  const [quote, setQuote] = useState<Row | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [consentTypes, setConsentTypes] = useState<Row[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        setConsentTypes(await api<Row[]>("/api/v1/loan/consent-types?surface=admin"));
      } catch {
        setConsentTypes([]);
      }
    })();
  }, []);
  const required = consentTypes.filter((c) => Number(c.is_required) === 1);
  const allRequired = required.every((c) => consents.includes(s(c.consent_key)));
  const blocked = file.blockers.loan.some((b) => b.id !== "kyc");

  // The farmer is quoted the same schedule the app would show them.
  useEffect(() => {
    const principal = Number(amount);
    if (!productId || !Number.isFinite(principal) || principal <= 0) { setQuote(null); return; }
    let alive = true;
    void (async () => {
      try {
        const data = await api<Row>("/api/v1/app/finance/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: s(p.id), product_id: productId, amount: principal,
            tenure_months: Number(tenure) || 12, repayment_mode: mode
          })
        });
        if (alive) setQuote(data);
      } catch {
        if (alive) setQuote(null);
      }
    })();
    return () => { alive = false; };
  }, [productId, amount, tenure, mode, p.id]);

  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<Row>("/api/v1/app/finance/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: s(p.id),
          product_id: productId,
          amount: Number(amount),
          tenure_months: Number(tenure) || 12,
          repayment_mode: mode,
          purpose_code: purpose || undefined,
          purpose_text: purposeText.trim() || undefined,
          consents,
          // Filed from a desk: the farmer is not here to give a GPS fix, so the
          // application carries their profile district instead and says so.
          filed_by_admin: true,
          checkin_district_id: s(p.district_id) || undefined,
          checkin_upazila_id: s(p.upazila_id) || undefined
        })
      });
      setMessage(`Application ${s(result.application_code) || "created"} filed for ${s(p.full_name)}. Open the workspace to capture evidence and run the assessment.`);
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "The application could not be filed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel is-padded act-form">
      <Blockers list={file.blockers.loan} action="start a loan application" />
      <h3 className="act-form-title"><HandCoins size={15} /> Loan application</h3>
      <p className="muted">
        Filed against the farmer through the app’s own endpoint, so the product terms, the quote and the one-open-application
        rule all apply. The officer confirms below that each consent was actually collected.
      </p>

      <div className="form-grid act-grid">
        <div className="field">
          <label className="field-label"><span className="field-label-text">Product</span><b aria-hidden="true">*</b></label>
          <Select value={productId} placeholder="Pick a loan product" options={fromLookup(lookups.loan_products ?? [])} onChange={setProductId} />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Amount (৳)</span><b aria-hidden="true">*</b></label>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 80000" />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Tenure (months)</span></label>
          <input className="input" inputMode="numeric" value={tenure} onChange={(e) => setTenure(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Repayment</span></label>
          <Select
            value={mode}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "weekly", label: "Weekly" },
              { value: "one_time", label: "One time" }
            ]}
            onChange={setMode}
          />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Purpose</span></label>
          <Select value={purpose} placeholder="Pick a purpose" options={fromLookup(lookups.loan_purposes ?? [])} onChange={setPurpose} />
        </div>
        <div className="field field-wide">
          <label className="field-label"><span className="field-label-text">What the money is for</span></label>
          <input className="input" value={purposeText} onChange={(e) => setPurposeText(e.target.value)} placeholder="in the farmer's words" />
        </div>
      </div>

      {quote ? (
        <div className="act-quote">
          <h4>Quote at these terms</h4>
          <ul>
            <li><span>Instalment</span><strong>{taka(quote.emi_amount)}</strong></li>
            <li><span>Instalments</span><strong>{s(quote.installment_count)}</strong></li>
            <li><span>Total interest</span><strong>{taka(quote.total_interest)}</strong></li>
            <li><span>Total payable</span><strong>{taka(quote.total_payable)}</strong></li>
          </ul>
        </div>
      ) : null}

      <div className="act-consents">
        <h4>Consents collected from the farmer</h4>
        <p className="muted">Each one is recorded against the application with your admin id. Tick only what you actually collected.</p>
        {consentTypes.map((consent) => {
          const key = s(consent.consent_key);
          return (
            <label className="act-consent" key={key}>
              <input
                type="checkbox"
                checked={consents.includes(key)}
                onChange={(event) =>
                  setConsents((list) => (event.target.checked ? [...list, key] : list.filter((c) => c !== key)))
                }
              />
              <span>
                {s(consent.title_en) || key}
                {Number(consent.is_required) === 1 ? <b className="act-consent-req">required</b> : null}
              </span>
            </label>
          );
        })}
      </div>

      {message ? <p className={`act-note ${/could not|failed|already|Consent/i.test(message) ? "is-bad" : "is-ok"}`}>{message}</p> : null}

      <div className="act-actions">
        <button className="btn primary" type="button" onClick={() => void submit()} disabled={busy || blocked || !productId || !(Number(amount) > 0) || !allRequired}>
          {busy ? <Loader2 size={16} className="act-spin" /> : <HandCoins size={16} />} File the application
        </button>
        <span className="ai-panel-note">
          {blocked ? "Blocked — see above." : !allRequired ? "Every required consent must be ticked." : "Files as the farmer, into the credit queue."}
        </span>
      </div>
    </section>
  );
}
