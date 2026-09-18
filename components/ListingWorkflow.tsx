"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft, Ban, Camera, Edit3, FileSignature, Info, Paperclip,
  PawPrint, Plus, Scale, Syringe, Trash2, Truck, Wallet, X, XCircle
} from "lucide-react";
import { Status } from "@/components/Status";
import { Select } from "@/components/Select";
import { DeleteDialog } from "@/components/DeleteDialog";
import "./listing-workflow.css";

/**
 * The listing workspace.
 *
 * A listing is never approved and never becomes a Buy-from-Shathi product. The
 * console records it section by section — field verification, vaccination,
 * animal profile, contract, shipping, payment — and the status is a
 * consequence of what has been saved: a visit date puts it in field
 * verification, a passed result verifies it, a contract contracts it, and so
 * on. Each card therefore posts only its own section and reports its own
 * result, so a half-finished profile never blocks the contract next to it.
 *
 * Closing a listing is the one deliberate act: Cancel at any time, Reject only
 * once something has actually shipped. Both ask for a reason and then leave the
 * record read-only.
 */

type Row = Record<string, unknown>;
type Doc = { url: string; name: string };
type Step = { key: string; index: number; title_en: string; desc_en: string; state: "done" | "current" | "upcoming"; date: string | null; note: string | null };
type Slot = { key: string; group: string; label: string; hint: string };
type CheckItem = { key: string; label: string; detail: string };
type Section = { key: string; label: string; hint: string; status_after: string | null; saved_at: string | null };
type Workflow = {
  listing: Row;
  pricing_rule: Row | null;
  verification: Row | null;
  contract: Row | null;
  animal_profile: Row | null;
  shipment: Row | null;
  vaccinations: Row[];
  officers: Row[];
  steps: Step[];
  photo_slots: Slot[];
  checklist_items: CheckItem[];
  sections: Section[];
  statuses: string[];
  closed: boolean;
  can_cancel: boolean;
  can_reject: boolean;
};

const YES_NO = [{ value: "", label: "—" }, { value: "1", label: "Yes" }, { value: "0", label: "No" }];

const has = (x: unknown) => x !== null && x !== undefined && x !== "";
const s = (x: unknown) => (x === null || x === undefined ? "" : String(x));
const val = (x: unknown) => (has(x) ? String(x) : "—");
const day = (x: unknown) => {
  if (!has(x)) return "—";
  const d = new Date(String(x));
  return Number.isNaN(d.getTime()) ? String(x) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
/** "12 Sep, 14:03" — short enough to sit in a card header. */
const stamp = (x: unknown) => {
  if (!has(x)) return null;
  const d = new Date(String(x));
  if (Number.isNaN(d.getTime())) return String(x);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
};
const money = (x: unknown) => (has(x) ? `৳${Number(x).toLocaleString("en-BD", { maximumFractionDigits: 2 })}` : "—");
/**
 * A DATE column comes back as an ISO instant ("2026-07-31T18:00:00.000Z" for
 * the 1st of August in a +06 database), so slicing the string off the front
 * loses a day every time a form is re-opened and saved. Read the local parts.
 */
const dateInput = (x: unknown) => {
  if (!has(x)) return "";
  const raw = String(x);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** A <input type="datetime-local"> wants exactly "YYYY-MM-DDTHH:mm". */
const timeInput = (x: unknown) => {
  if (!has(x)) return "";
  const d = new Date(String(x));
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const human = (x: unknown) => s(x).replace(/_/g, " ");

function fields(e: FormEvent<HTMLFormElement>): Record<string, string> {
  e.preventDefault();
  return Object.fromEntries(Array.from(new FormData(e.currentTarget).entries()).map(([k, v]) => [k, String(v)]));
}

/** Attachments arrive as [{url,name}] but older rows may hold bare URLs. */
function readDocs(v: unknown): Doc[] {
  if (!Array.isArray(v)) return [];
  const out: Doc[] = [];
  for (const entry of v) {
    if (typeof entry === "string") {
      if (/^(https?:\/\/|\/)/.test(entry)) out.push({ url: entry, name: entry.split("/").pop() || "document" });
    } else if (entry && typeof entry === "object") {
      const url = s((entry as Row).url);
      if (url) out.push({ url, name: s((entry as Row).name) || url.split("/").pop() || "document" });
    }
  }
  return out;
}

// --- Pieces every section card is built from --------------------------------

function CardHead({ icon, section, extra }: { icon: ReactNode; section: Section | undefined; extra?: ReactNode }) {
  const saved = stamp(section?.saved_at);
  return (
    <>
      <div className="lw-card-h">
        <h2>{icon} {section?.label ?? "Section"}</h2>
        <div className="lw-card-chips">
          {extra}
          <span className={`lw-chip ${section?.status_after ? "set" : ""}`}>
            {section?.status_after ? `sets status → ${human(section.status_after)}` : "does not change the status"}
          </span>
          {saved ? <span className="lw-chip saved">saved {saved}</span> : <span className="lw-chip">not saved yet</span>}
        </div>
      </div>
      {section?.hint ? <p className="lw-hint">{section.hint}</p> : null}
    </>
  );
}

function SaveRow({ label, busy, note, children }: { label: string; busy: boolean; note?: { ok?: string; bad?: string }; children?: ReactNode }) {
  return (
    <div className="lw-save">
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : label}</button>
      {children}
      {note?.ok ? <span className="lw-msg ok">{note.ok}</span> : null}
      {note?.bad ? <span className="lw-msg bad">{note.bad}</span> : null}
    </div>
  );
}

/** A file list a section posts as `data.documents`. */
function Docs({ title, docs, onAdd, onRemove, busy }: { title: string; docs: Doc[]; onAdd: (file: File) => void; onRemove: (index: number) => void; busy: boolean }) {
  return (
    <div className="lw-docs">
      <p className="lw-hint" style={{ margin: "0 0 7px" }}><Paperclip size={13} /> {title}</p>
      {docs.length ? (
        <ul className="lw-docs-list">
          {docs.map((d, i) => (
            <li key={`${d.url}-${i}`}>
              <a href={d.url} target="_blank" rel="noreferrer">{d.name}</a>
              <button type="button" className="lw-x" aria-label={`Remove ${d.name}`} onClick={() => onRemove(i)}><X size={14} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="lw-empty">No files attached.</p>}
      <label className="lw-docs-add">
        Attach a photo or scan
        <input
          type="file"
          accept="image/*"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onAdd(f); e.target.value = ""; }}
        />
        {busy ? <span>uploading…</span> : null}
      </label>
    </div>
  );
}

// --- The workspace ----------------------------------------------------------

export function ListingWorkflow({ listingId }: { listingId: string }) {
  const [wf, setWf] = useState<Workflow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fatal, setFatal] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<Record<string, { ok?: string; bad?: string }>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [checklist, setChecklist] = useState<Record<string, { ok: boolean; note: string }>>({});
  // Attachments are only posted when this session actually changed them, so a
  // save of any other field can never quietly wipe a file list.
  const [cDocs, setCDocs] = useState<Doc[]>([]);
  const [cDocsDirty, setCDocsDirty] = useState(false);
  const [cFile, setCFile] = useState("");
  const [sDocs, setSDocs] = useState<Doc[]>([]);
  const [sDocsDirty, setSDocsDirty] = useState(false);
  // null = the dose form is closed; {} = adding; a row = editing that dose.
  const [vax, setVax] = useState<Row | null>(null);
  const [vaxDoc, setVaxDoc] = useState("");
  const [vaxKey, setVaxKey] = useState(0);
  const [modal, setModal] = useState<"" | "cancel" | "reject">("");
  const [pendingDose, setPendingDose] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState("");

  const adopt = useCallback((next: Workflow) => {
    setWf(next);
    setPhotos({ ...((next.verification?.photos_json as Record<string, string>) ?? {}) });
    setChecklist({ ...((next.verification?.checklist_json as Record<string, { ok: boolean; note: string }>) ?? {}) });
    setCDocs(readDocs(next.contract?.documents_json));
    setCDocsDirty(false);
    setCFile(s(next.contract?.contract_file_url));
    setSDocs(readDocs(next.shipment?.documents_json));
    setSDocsDirty(false);
  }, []);

  const load = useCallback(async () => {
    const r = await fetch(`/api/v1/admin/sale/listing-workflow?listing_id=${encodeURIComponent(listingId)}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.data) adopt(j.data as Workflow);
    else setFatal(j?.message ?? "Could not load this listing.");
    setLoaded(true);
  }, [listingId, adopt]);

  useEffect(() => { void load(); }, [load]);

  /** Posts one section and reports back inside that section's own card. */
  async function act(key: string, action: string, data: Record<string, unknown>, done = "Saved.") {
    setBusy(key);
    setNote((n) => ({ ...n, [key]: {} }));
    const r = await fetch("/api/v1/admin/sale/listing-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listing_id: listingId, action, data })
    });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok || !j.ok) {
      setNote((n) => ({ ...n, [key]: { bad: j.message ?? "That did not save." } }));
      return false;
    }
    adopt(j.result as Workflow);
    setNote((n) => ({ ...n, [key]: { ok: done } }));
    return true;
  }

  async function upload(folder: string, file: File, busyKey: string): Promise<string | null> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);
    setBusy(busyKey);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (r.ok && j.ok && j.url) return String(j.url);
    setNote((n) => ({ ...n, [busyKey.split(":")[0]]: { bad: j.message ?? "Upload failed." } }));
    return null;
  }

  if (!loaded) return <p className="page-sub">Loading listing…</p>;
  if (!wf) {
    return (
      <div className="panel empty-state">
        <h1>Sale listing not found</h1>
        <p>{fatal || `No sale listing exists for id ${listingId}.`}</p>
        <Link className="btn primary" href="/sale">Back to listings</Link>
      </div>
    );
  }

  const l = wf.listing;
  const v = wf.verification;
  const c = wf.contract;
  const ap = wf.animal_profile;
  const sh = wf.shipment;
  const rule = wf.pricing_rule;
  const closed = wf.closed;
  const status = s(l.status);
  const section = (key: string) => wf.sections?.find((x) => x.key === key);
  const weight = Number(l.verified_weight_kg || l.weight_kg || 0);
  const netRate = rule ? Number(rule.net_farmer_rate ?? 0) : 0;
  const farmerAmount = weight && netRate ? Math.round(weight * netRate) : null;

  // Why the listing sits where it does — read off what has actually been saved.
  function why(): ReactNode {
    switch (status) {
      case "draft":
        return <>The farmer has not submitted this listing yet. Nothing has been recorded.</>;
      case "submitted":
        return <>Submitted {day(l.created_at)} and waiting on the field officer. <strong>Save a visit date</strong> in field verification to start the visit.</>;
      case "field_verification":
        return (
          <>
            A field visit is on record{has(v?.visit_date) ? <> for <strong>{day(v?.visit_date)}</strong></> : null}
            {has(v?.result) && s(v?.result) !== "pending" ? <> and the last result was <strong>{human(v?.result)}</strong></> : null}.
            It becomes <strong>verified</strong> when the verification is saved with result <em>passed</em> and a verified weight.
          </>
        );
      case "verified":
        return <>Field verification passed{has(l.verified_at) ? <> on <strong>{day(l.verified_at)}</strong></> : null}{has(l.verified_weight_kg) ? <> at <strong>{s(l.verified_weight_kg)} kg</strong></> : null}. Saving a purchase contract moves it on.</>;
      case "contracted":
        return <>A purchase contract{has(c?.buyer_name) ? <> with <strong>{val(c?.buyer_name)}</strong></> : null} was saved{has(l.contracted_at) ? <> on <strong>{day(l.contracted_at)}</strong></> : null}. Saving the shipping section marks it shipped.</>;
      case "shipped":
        return <>Shipping was recorded{has(l.shipped_at) ? <> on <strong>{day(l.shipped_at)}</strong></> : null}{has(sh?.vehicle_ref) ? <> on <strong>{val(sh?.vehicle_ref)}</strong></> : null}. Record the payment to the farmer to finish.</>;
      case "paid":
        return <>The farmer was paid <strong>{money(l.paid_amount)}</strong>{has(l.paid_at) ? <> on <strong>{day(l.paid_at)}</strong></> : null} by {human(l.payment_method) || "—"}. This listing is complete.</>;
      case "cancelled":
        return <>Cancelled on <strong>{day(l.cancelled_at)}</strong>. {val(l.cancel_reason)}</>;
      case "rejected":
        return <>Rejected after shipping on <strong>{day(l.rejected_at)}</strong>. {val(l.reject_reason)}</>;
      default:
        return <>Status <strong>{human(status)}</strong>.</>;
    }
  }

  async function closeListing() {
    const key = "close";
    const ok = await act(key, modal === "cancel" ? "cancel_listing" : "reject_listing", { reason }, modal === "cancel" ? "Listing cancelled." : "Listing rejected.");
    if (ok) { setModal(""); setReason(""); }
  }

  return (
    <>
      <section className="detail-hero">
        <div>
          <Link className="back-link" href="/sale"><ArrowLeft size={18} /> Sale listings</Link>
          <p className="eyeline">Sale listing · {val(l.listing_code)}</p>
          <h1 className="page-title">{val(l.title_en)}</h1>
          <p className="subtitle">{[l.category_name, l.item_name, l.animal_name, l.breed_name].filter(Boolean).join(" / ")}</p>
        </div>
        <div className="detail-actions">
          <Status label={status} />
          <Link className="btn ghost" href={`/manage/form?resource=sale/listings&id=${encodeURIComponent(listingId)}`}><Edit3 size={18} /> Edit fields</Link>
        </div>
      </section>

      {/* --- Status strip: where it is, why, and how to close it ------------ */}
      <section className="panel lw-strip">
        <div className="lw-strip-top">
          <div>
            <div className="lw-strip-now">
              <span className="lw-kicker">Current status</span>
              <Status label={status} />
            </div>
            <p className="lw-why" style={{ marginTop: 8 }}>{why()}</p>
          </div>
          <div className="lw-acts">
            {wf.can_cancel ? (
              <button type="button" className="lw-danger-btn" onClick={() => { setModal("cancel"); setReason(""); }}>
                <Ban size={15} /> Cancel listing
              </button>
            ) : null}
            {wf.can_reject ? (
              <button type="button" className="lw-danger-btn" onClick={() => { setModal("reject"); setReason(""); }}>
                <XCircle size={15} /> Reject
              </button>
            ) : null}
          </div>
        </div>
        {note.close?.bad ? <p className="lw-msg bad" style={{ marginBottom: 10 }}>{note.close.bad}</p> : null}
        {wf.steps.length ? (
          <ol className="wf-steps" style={{ margin: 0 }}>
            {wf.steps.map((step) => (
              <li key={step.key} className={`wf-step ${step.state}`}>
                <span className="wf-num">{step.state === "done" ? "✓" : step.index}</span>
                <b>{step.title_en}</b>
                <span>{step.date ? day(step.date) : step.state === "current" ? "In progress" : ""}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {closed ? (
        <div className="lw-closed">
          <span className="lw-closed-icon">{status === "cancelled" ? <Ban size={18} /> : <XCircle size={18} />}</span>
          <div>
            <h3>This listing is {status === "cancelled" ? "cancelled" : "rejected"} — the sections below are read-only.</h3>
            <p>
              Closed on <strong>{day(status === "cancelled" ? l.cancelled_at : l.rejected_at)}</strong>.
              {" "}Reason: {val(status === "cancelled" ? l.cancel_reason : l.reject_reason)}
              {" · "}It stays on record and stays visible to the farmer. To work on it again, set a status below.
            </p>
          </div>
        </div>
      ) : null}

      {/* --- Facts ---------------------------------------------------------- */}
      <div className="wf-grid">
        <article className="panel wf-card">
          <h2><Scale size={18} /> Listing</h2>
          <div className="wf-facts">
            <div><span>Farmer</span><strong>{val(l.farmer_name)}</strong><br />{val(l.farmer_phone)}</div>
            <div><span>Location</span><strong>{val(l.upazila_name)}</strong><br />{[l.district_name, l.division_name].filter(Boolean).join(", ")}</div>
            <div><span>Live weight (farmer)</span><strong>{val(l.weight_kg)} kg</strong></div>
            <div><span>Verified weight</span><strong>{has(l.verified_weight_kg) ? `${s(l.verified_weight_kg)} kg` : "—"}</strong></div>
            <div><span>Age</span><strong>{has(l.age_months) ? `${s(l.age_months)} months` : "—"}</strong></div>
            <div><span>Estimated earning</span><strong>{money(l.estimated_earning)}</strong></div>
            <div style={{ gridColumn: "1 / -1" }}><span>Address</span><strong>{val(l.address_text)}</strong></div>
          </div>
        </article>

        <article className="panel wf-card">
          <h2><FileSignature size={18} /> Price rule attached</h2>
          {rule ? (
            <>
              <p className="muted">
                <Link href={`/manage/view?resource=sale/pricing&id=${encodeURIComponent(s(rule.id))}`}><b>{val(rule.name)}</b></Link> · {val(rule.area)} · from {day(rule.effective_from)}{" "}
                {rule.active ? <span className="vbadge vb-ok">active</span> : <span className="vbadge vb-warn">retired</span>}
              </p>
              <div className="wf-facts">
                <div><span>B2B market rate</span><strong>{money(rule.b2b_market_rate)}/kg live</strong></div>
                <div><span>B2B meat rate</span><strong>{money(rule.b2b_meat_rate)}/kg meat</strong></div>
                <div><span>Platform fee</span><strong>{has(rule.platform_fee_pct) ? `${Number(rule.platform_fee_pct)}% of live amount` : `${money(rule.platform_fee)}/kg`}</strong></div>
                <div><span>Logistics & transport</span><strong>{money(rule.logistics_fee)}/kg</strong></div>
                <div><span>Warehousing & care</span><strong>{money(rule.warehouse_vet_fee)}/kg</strong></div>
                <div><span>Net farmer rate</span><strong>{money(rule.net_farmer_rate)}/kg live</strong></div>
                <div style={{ gridColumn: "1 / -1" }}><span>Farmer receives at {weight || "?"} kg</span><strong>{farmerAmount ? money(farmerAmount) : "—"}</strong></div>
              </div>
            </>
          ) : (
            <p className="muted">No price rule is attached to this listing. New livestock listings attach the active rule automatically.</p>
          )}
        </article>
      </div>

      {/* --- 1 · Field verification ----------------------------------------- */}
      <section className="panel wf-card lw-card">
        <CardHead icon={<Camera size={18} />} section={section("field_verification")} />
        <form
          onSubmit={(e) => {
            const f = fields(e);
            void act("field_verification", "save_field_verification", { ...f, photos, checklist },
              f.result === "passed" ? "Saved — verification passed, the listing is verified." : "Field verification saved.");
          }}
        >
          <fieldset className="lw-fs" disabled={closed}>
            <div className="wf-form">
              <label>Visit date<input type="date" name="visit_date" defaultValue={dateInput(v?.visit_date ?? l.field_visit_date)} /></label>
              <label>Field officer
                <Select
                  name="officer_id"
                  defaultValue={s(v?.officer_id)}
                  options={[
                    { value: "", label: "—" },
                    ...wf.officers.map((o) => ({ value: s(o.id), label: `${s(o.name)}${o.upazila || o.district ? ` · ${s(o.upazila ?? o.district)}` : ""}` }))
                  ]}
                />
              </label>
            </div>

            <p className="lw-sub-h">Photo checklist</p>
            <div className="wf-photos">
              {wf.photo_slots.map((slot) => (
                <div className="wf-photo" key={slot.key}>
                  {photos[slot.key]
                    ? <a href={photos[slot.key]} target="_blank" rel="noreferrer"><img src={photos[slot.key]} alt={slot.label} /></a>
                    : <div className="ph"><Camera size={20} /></div>}
                  <strong>{slot.label}</strong>
                  <small>{slot.hint}</small>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy === `field_verification:${slot.key}`}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      const url = await upload("verification", file, `field_verification:${slot.key}`);
                      if (url) setPhotos((p) => ({ ...p, [slot.key]: url }));
                    }}
                  />
                </div>
              ))}
            </div>

            {wf.checklist_items.map((item) => {
              const entry = checklist[item.key] ?? { ok: false, note: "" };
              return (
                <div className="wf-check" key={item.key}>
                  <input type="checkbox" checked={entry.ok} onChange={(e) => setChecklist((cl) => ({ ...cl, [item.key]: { ...entry, ok: e.target.checked } }))} />
                  <span><b>{item.label}</b><br /><small>{item.detail}</small></span>
                  <input type="text" placeholder="Note" value={entry.note} onChange={(e) => setChecklist((cl) => ({ ...cl, [item.key]: { ...entry, note: e.target.value } }))} />
                </div>
              );
            })}

            <div className="wf-form" style={{ marginTop: 12 }}>
              <label>Dentition<input name="dentition" placeholder="e.g. 2 permanent incisors" defaultValue={s(v?.dentition)} /></label>
              <label>Estimated age (months)<input name="estimated_age_months" inputMode="numeric" defaultValue={s(v?.estimated_age_months ?? l.age_months)} /></label>
              <label>Legs / hooves
                <Select
                  name="legs_condition"
                  defaultValue={s(v?.legs_condition)}
                  options={[
                    { value: "", label: "—" },
                    { value: "good", label: "Good" },
                    { value: "minor_issue", label: "Minor issue" },
                    { value: "lame", label: "Lame" },
                    { value: "injured", label: "Injured" }
                  ]}
                />
              </label>
              <label>Body condition score (1–5)<input name="body_condition_score" inputMode="decimal" defaultValue={s(v?.body_condition_score)} /></label>
              <label>Ear tag number<input name="tag_number" defaultValue={s(v?.tag_number)} /></label>
              <label>Unique mark<input name="unique_mark" defaultValue={s(v?.unique_mark)} /></label>
              <label>Verified live weight (kg)<input name="verified_weight_kg" inputMode="decimal" defaultValue={s(v?.verified_weight_kg ?? l.verified_weight_kg)} /></label>
              <label>Result
                <Select
                  name="result"
                  defaultValue={s(v?.result) || "pending"}
                  options={[
                    { value: "pending", label: "Pending" },
                    { value: "passed", label: "Passed — verifies the listing" },
                    { value: "recheck", label: "Recheck needed — a note" },
                    { value: "failed", label: "Failed — a note, not a rejection" }
                  ]}
                />
              </label>
              <label className="wide">Health notes<textarea name="health_notes" rows={2} defaultValue={s(v?.health_notes)} /></label>
            </div>
            <p className="lw-hint" style={{ margin: "10px 0 0" }}>
              A visit date alone puts the listing in <b>field verification</b>. Result <b>passed</b> with a verified weight makes it <b>verified</b>.
              <b> Failed</b> and <b>recheck</b> are recorded as notes — they never reject a listing; use the Reject button for that.
            </p>
            <SaveRow label="Save field verification" busy={busy === "field_verification"} note={note.field_verification} />
          </fieldset>
        </form>
      </section>

      {/* --- 2 · Vaccination & health ---------------------------------------- */}
      <section className="panel wf-card lw-card">
        <CardHead
          icon={<Syringe size={18} />}
          section={section("vaccination")}
          extra={<span className="lw-chip">{wf.vaccinations.length} dose{wf.vaccinations.length === 1 ? "" : "s"}</span>}
        />
        <fieldset className="lw-fs" disabled={closed}>
          {wf.vaccinations.length ? (
            <div className="lw-vax">
              {wf.vaccinations.map((row) => {
                const editing = s(vax?.id) === s(row.id);
                return (
                  <div className={`lw-vax-row${editing ? " editing" : ""}`} key={s(row.id)}>
                    <div className="lw-vax-main">
                      <strong>{val(row.vaccine_name)}{has(row.dose_no) ? ` · dose ${s(row.dose_no)}` : ""}</strong>
                      <div className="lw-vax-meta">
                        <span>Given {day(row.given_on)}</span>
                        <span>Next due {day(row.next_due_on)}</span>
                        {has(row.vet_name) ? <span>Vet {s(row.vet_name)}</span> : null}
                        {has(row.batch_no) ? <span>Batch {s(row.batch_no)}</span> : null}
                        {has(row.document_url) ? <a href={s(row.document_url)} target="_blank" rel="noreferrer">Document</a> : null}
                      </div>
                      {has(row.notes) ? <p className="lw-vax-note">{s(row.notes)}</p> : null}
                    </div>
                    <div className="lw-vax-acts">
                      <button
                        type="button"
                        className="lw-mini"
                        onClick={() => { setVax(row); setVaxDoc(s(row.document_url)); setVaxKey((k) => k + 1); }}
                      ><Edit3 size={13} /> Edit</button>
                      <button
                        type="button"
                        className="lw-mini bad"
                        disabled={busy === "vaccination"}
                        onClick={() => setPendingDose({ id: String(row.id), name: s(row.vaccine_name) })}
                      ><Trash2 size={13} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="lw-empty">No doses recorded yet.</p>}

          {vax === null ? (
            <div className="lw-save" style={{ borderTop: 0, paddingTop: 0, marginTop: 4 }}>
              <button type="button" className="btn ghost" onClick={() => { setVax({}); setVaxDoc(""); setVaxKey((k) => k + 1); }}>
                <Plus size={16} /> Add a dose
              </button>
              {note.vaccination?.ok ? <span className="lw-msg ok">{note.vaccination.ok}</span> : null}
              {note.vaccination?.bad ? <span className="lw-msg bad">{note.vaccination.bad}</span> : null}
            </div>
          ) : (
            <form
              className="lw-vax-form"
              key={vaxKey}
              onSubmit={async (e) => {
                const f = fields(e);
                const ok = await act("vaccination", "save_vaccination",
                  { ...f, id: vax?.id ?? undefined, document_url: vaxDoc },
                  vax?.id ? "Dose updated." : "Dose added.");
                if (ok) { setVax(null); setVaxDoc(""); }
              }}
            >
              <p className="lw-sub-h" style={{ marginTop: 0 }}>{vax?.id ? "Edit dose" : "New dose"}</p>
              <div className="wf-form">
                <label>Vaccine name *<input name="vaccine_name" required defaultValue={s(vax?.vaccine_name)} /></label>
                <label>Dose<input name="dose_no" placeholder="1st / booster" defaultValue={s(vax?.dose_no)} /></label>
                <label>Given on<input type="date" name="given_on" defaultValue={dateInput(vax?.given_on)} /></label>
                <label>Next due<input type="date" name="next_due_on" defaultValue={dateInput(vax?.next_due_on)} /></label>
                <label>Vet<input name="vet_name" defaultValue={s(vax?.vet_name)} /></label>
                <label>Batch no.<input name="batch_no" defaultValue={s(vax?.batch_no)} /></label>
                <label className="wide">Notes<textarea name="notes" rows={2} defaultValue={s(vax?.notes)} /></label>
              </div>
              <div className="lw-docs">
                <p className="lw-hint" style={{ margin: "0 0 7px" }}><Paperclip size={13} /> Vaccination card or certificate (optional)</p>
                {vaxDoc ? (
                  <ul className="lw-docs-list">
                    <li>
                      <a href={vaxDoc} target="_blank" rel="noreferrer">{vaxDoc.split("/").pop()}</a>
                      <button type="button" className="lw-x" aria-label="Remove document" onClick={() => setVaxDoc("")}><X size={14} /></button>
                    </li>
                  </ul>
                ) : null}
                <label className="lw-docs-add">
                  Attach a photo or scan
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy === "vaccination:doc"}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      const url = await upload("vaccination", file, "vaccination:doc");
                      if (url) setVaxDoc(url);
                    }}
                  />
                  {busy === "vaccination:doc" ? <span>uploading…</span> : null}
                </label>
              </div>
              <SaveRow label={vax?.id ? "Save dose" : "Add dose"} busy={busy === "vaccination"} note={note.vaccination}>
                <button type="button" className="btn ghost" onClick={() => { setVax(null); setVaxDoc(""); }}>Cancel</button>
              </SaveRow>
            </form>
          )}
        </fieldset>
      </section>

      {/* --- 3 · Animal profile --------------------------------------------- */}
      <section className="panel wf-card lw-card">
        <CardHead icon={<PawPrint size={18} />} section={section("animal_profile")} />
        <p className="lw-optional"><Info size={15} /> Nothing in this section is required. Fill in whatever is known — a blank field simply stays blank, and saving never fails for a missing answer.</p>
        <form onSubmit={(e) => void act("animal_profile", "save_animal_profile", fields(e), "Animal profile saved.")}>
          <fieldset className="lw-fs" disabled={closed}>
            <div className="wf-form">
              <label>Deworming date<input type="date" name="deworming_on" defaultValue={dateInput(ap?.deworming_on)} /></label>
              <label>Last treatment date<input type="date" name="last_treatment_on" defaultValue={dateInput(ap?.last_treatment_on)} /></label>
              <label className="wide">Last treatment note<input name="last_treatment_note" defaultValue={s(ap?.last_treatment_note)} /></label>
              <label>Feed type<input name="feed_type" placeholder="e.g. green fodder + concentrate" defaultValue={s(ap?.feed_type)} /></label>
              <label className="wide">Feeding note<input name="feeding_note" defaultValue={s(ap?.feeding_note)} /></label>
              <label>Housing<input name="housing_type" placeholder="e.g. tin-roof shed, tethered" defaultValue={s(ap?.housing_type)} /></label>
              <label>Horn status
                <Select
                  name="horn_status"
                  defaultValue={s(ap?.horn_status)}
                  options={[{ value: "", label: "—" }, { value: "intact", label: "Intact" }, { value: "dehorned", label: "Dehorned" }, { value: "polled", label: "Polled (naturally hornless)" }]}
                />
              </label>
              <label>Castrated<Select name="is_castrated" defaultValue={has(ap?.is_castrated) ? s(Number(ap?.is_castrated)) : ""} options={YES_NO} /></label>
              <label>Temperament
                <Select
                  name="temperament"
                  defaultValue={s(ap?.temperament)}
                  options={[{ value: "", label: "—" }, { value: "calm", label: "Calm" }, { value: "normal", label: "Normal" }, { value: "aggressive", label: "Aggressive" }]}
                />
              </label>
              <label>Colour<input name="colour" defaultValue={s(ap?.colour)} /></label>
              <label className="wide">Distinguishing marks<input name="distinguishing_marks" defaultValue={s(ap?.distinguishing_marks)} /></label>
              <label>Insurance ref<input name="insurance_ref" defaultValue={s(ap?.insurance_ref)} /></label>
              <label>Vet name<input name="vet_name" defaultValue={s(ap?.vet_name)} /></label>
              <label>Vet phone<input name="vet_phone" inputMode="tel" defaultValue={s(ap?.vet_phone)} /></label>
              <label className="wide">Health notes<textarea name="health_notes" rows={2} defaultValue={s(ap?.health_notes)} /></label>
            </div>
            <SaveRow label="Save animal profile" busy={busy === "animal_profile"} note={note.animal_profile} />
          </fieldset>
        </form>
      </section>

      {/* --- 4 · Purchase contract ------------------------------------------ */}
      <section className="panel wf-card lw-card">
        <CardHead icon={<FileSignature size={18} />} section={section("contract")} />
        <form
          onSubmit={(e) => {
            const f = fields(e);
            void act("contract", "save_contract",
              { ...f, contract_file_url: cFile, ...(cDocsDirty ? { documents: cDocs } : {}) },
              "Contract saved — the listing is contracted.");
          }}
        >
          <fieldset className="lw-fs" disabled={closed}>
            <div className="wf-form">
              <label>Buyer name *<input name="buyer_name" required defaultValue={s(c?.buyer_name)} /></label>
              <label>Buyer organisation<input name="buyer_org" defaultValue={s(c?.buyer_org)} /></label>
              <label>Buyer phone<input name="buyer_phone" inputMode="tel" defaultValue={s(c?.buyer_phone)} /></label>
              <label>Agreed rate (৳/kg live)<input name="agreed_rate_per_kg" inputMode="decimal" defaultValue={s(c?.agreed_rate_per_kg ?? rule?.b2b_market_rate)} /></label>
              <label>Agreed weight (kg)<input name="agreed_weight_kg" inputMode="decimal" defaultValue={s(c?.agreed_weight_kg ?? l.verified_weight_kg)} /></label>
              <label>Contract amount (৳, blank = rate × weight)<input name="contract_amount" inputMode="decimal" defaultValue={s(c?.contract_amount)} /></label>
              <label>Weight tolerance %<input name="weight_tolerance_pct" inputMode="decimal" defaultValue={s(c?.weight_tolerance_pct) || "3"} /></label>
              <label>Advance to farmer (৳)<input name="advance_amount" inputMode="decimal" defaultValue={s(c?.advance_amount)} /></label>
              <label>Advance paid at<input type="datetime-local" name="advance_paid_at" defaultValue={timeInput(c?.advance_paid_at)} /></label>
              <label>Payment terms (days)<input name="payment_terms_days" inputMode="numeric" defaultValue={s(c?.payment_terms_days) || "7"} /></label>
              <label>Payment due<input type="date" name="payment_due_at" defaultValue={dateInput(c?.payment_due_at)} /></label>
              <label>Bank account ref<input name="bank_account_ref" defaultValue={s(c?.bank_account_ref)} /></label>
              <label>Signed by<input name="signed_by" defaultValue={s(c?.signed_by)} /></label>
              <label>Signed at<input type="datetime-local" name="signed_at" defaultValue={timeInput(c?.signed_at)} /></label>
              <label>Contract ref<input name="contract_ref" placeholder="auto" defaultValue={s(c?.contract_ref)} /></label>
              <label className="wide">Notes<textarea name="notes" rows={2} defaultValue={s(c?.notes)} /></label>
            </div>

            <div className="lw-docs">
              <p className="lw-hint" style={{ margin: "0 0 7px" }}><Paperclip size={13} /> Signed contract file</p>
              {cFile ? (
                <ul className="lw-docs-list">
                  <li>
                    <a href={cFile} target="_blank" rel="noreferrer">{cFile.split("/").pop()}</a>
                    <button type="button" className="lw-x" aria-label="Remove contract file" onClick={() => setCFile("")}><X size={14} /></button>
                  </li>
                </ul>
              ) : <p className="lw-empty">No contract file uploaded.</p>}
              <label className="lw-docs-add">
                Upload a photo or scan of the contract
                <input
                  type="file"
                  accept="image/*"
                  disabled={busy === "contract:file"}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const url = await upload("contracts", file, "contract:file");
                    if (url) setCFile(url);
                  }}
                />
                {busy === "contract:file" ? <span>uploading…</span> : null}
              </label>
            </div>

            <Docs
              title="Other contract papers (bill of sale, buyer letter, ID copies)"
              docs={cDocs}
              busy={busy === "contract:doc"}
              onRemove={(i) => { setCDocs((d) => d.filter((_, x) => x !== i)); setCDocsDirty(true); }}
              onAdd={async (file) => {
                const url = await upload("contracts", file, "contract:doc");
                if (url) { setCDocs((d) => [...d, { url, name: file.name }]); setCDocsDirty(true); }
              }}
            />

            <SaveRow label="Save contract" busy={busy === "contract"} note={note.contract} />
          </fieldset>
        </form>
      </section>

      {/* --- 5 · Shipping ---------------------------------------------------- */}
      <section className="panel wf-card lw-card">
        <CardHead icon={<Truck size={18} />} section={section("shipping")} />
        <form
          onSubmit={(e) => {
            const f = fields(e);
            void act("shipping", "save_shipping",
              { ...f, ...(sDocsDirty ? { documents: sDocs } : {}) },
              "Shipping saved — the listing is shipped.");
          }}
        >
          <fieldset className="lw-fs" disabled={closed}>
            <div className="wf-form">
              <label>Dispatched at<input type="datetime-local" name="dispatched_at" defaultValue={timeInput(sh?.dispatched_at ?? c?.dispatched_at)} /></label>
              <label>Vehicle type<input name="vehicle_type" placeholder="truck / pickup" defaultValue={s(sh?.vehicle_type)} /></label>
              <label>Vehicle ref<input name="vehicle_ref" placeholder="registration" defaultValue={s(sh?.vehicle_ref ?? c?.vehicle_ref)} /></label>
              <label>Driver name<input name="driver_name" defaultValue={s(sh?.driver_name)} /></label>
              <label>Driver phone<input name="driver_phone" inputMode="tel" defaultValue={s(sh?.driver_phone ?? c?.driver_phone)} /></label>
              <label>Transporter<input name="transporter" defaultValue={s(sh?.transporter)} /></label>
              <label className="wide">From address<input name="from_address" defaultValue={s(sh?.from_address ?? l.address_text)} /></label>
              <label className="wide">To address<input name="to_address" defaultValue={s(sh?.to_address)} /></label>
              <label>Expected arrival<input type="datetime-local" name="expected_arrival_at" defaultValue={timeInput(sh?.expected_arrival_at)} /></label>
              <label>Arrived at<input type="datetime-local" name="arrived_at" defaultValue={timeInput(sh?.arrived_at)} /></label>
              <label>Loading weight (kg)<input name="loading_weight_kg" inputMode="decimal" defaultValue={s(sh?.loading_weight_kg)} /></label>
              <label>Digital record ref<input name="digital_record_ref" placeholder="auto" defaultValue={s(c?.digital_record_ref)} /></label>
              <label className="wide">Condition note<textarea name="condition_note" rows={2} defaultValue={s(sh?.condition_note)} /></label>
            </div>

            <Docs
              title="Shipping papers (challan, gate pass, transport receipt)"
              docs={sDocs}
              busy={busy === "shipping:doc"}
              onRemove={(i) => { setSDocs((d) => d.filter((_, x) => x !== i)); setSDocsDirty(true); }}
              onAdd={async (file) => {
                const url = await upload("shipping", file, "shipping:doc");
                if (url) { setSDocs((d) => [...d, { url, name: file.name }]); setSDocsDirty(true); }
              }}
            />

            <p className="lw-hint" style={{ margin: "10px 0 0" }}>A purchase contract with a buyer must be saved before shipping can be recorded.</p>
            <SaveRow label="Save shipping" busy={busy === "shipping"} note={note.shipping} />
          </fieldset>
        </form>
      </section>

      {/* --- 6 · Payment to the farmer --------------------------------------- */}
      <section className="panel wf-card lw-card">
        <CardHead icon={<Wallet size={18} />} section={section("payment")} />
        {has(l.paid_at) ? <p className="done-line">✓ Paid {money(l.paid_amount)} on {day(l.paid_at)} · {human(l.payment_method)} · {val(l.payment_reference)}</p> : null}
        <form onSubmit={(e) => void act("payment", "save_payment", fields(e), "Payment recorded — the listing is paid.")}>
          <fieldset className="lw-fs" disabled={closed}>
            <div className="wf-form">
              <label>Amount (৳) *<input name="paid_amount" inputMode="decimal" required defaultValue={s(l.paid_amount ?? farmerAmount ?? "")} /></label>
              <label>Method *
                <Select
                  name="payment_method"
                  defaultValue={s(l.payment_method) || "bank_transfer"}
                  options={[
                    { value: "bank_transfer", label: "Bank transfer" },
                    { value: "bkash", label: "bKash" },
                    { value: "nagad", label: "Nagad" },
                    { value: "cheque", label: "Cheque" },
                    { value: "cash", label: "Cash" }
                  ]}
                />
              </label>
              <label>Reference<input name="payment_reference" defaultValue={s(l.payment_reference)} /></label>
              <label>Paid at<input type="datetime-local" name="paid_at" defaultValue={timeInput(l.paid_at)} /></label>
            </div>
            <SaveRow label="Record payment" busy={busy === "payment"} note={note.payment} />
          </fieldset>
        </form>
      </section>

      {/* --- Post-sale contract detail (kept from the older flow) ------------- */}
      <details className="panel wf-card lw-card lw-more">
        <summary>Post-sale contract detail — handover, receipt, invoice, collection</summary>
        <p className="lw-hint">Optional buyer-side paperwork that hangs off the contract. None of it changes the listing status.</p>
        <fieldset className="lw-fs" disabled={closed}>
          <div className="wf-sub">
            <div>
              <h3>A · Handover</h3>
              <small>Farmer signs custody transfer after receiving the advance.</small>
              {has(c?.handover_at) ? <p className="done-line">✓ {day(c?.handover_at)} · signed by {val(c?.handover_signed_by)}</p> : null}
              <form onSubmit={(e) => void act("handover", "handover", fields(e), "Handover recorded.")}>
                <div className="wf-form">
                  <label>Signed by<input name="handover_signed_by" required defaultValue={s(c?.handover_signed_by ?? l.farmer_name)} /></label>
                  <label>Advance paid at<input type="datetime-local" name="advance_paid_at" defaultValue={timeInput(c?.advance_paid_at)} /></label>
                  <label className="wide">Note<input name="handover_note" defaultValue={s(c?.handover_note)} /></label>
                </div>
                <SaveRow label="Record handover" busy={busy === "handover"} note={note.handover} />
              </form>
            </div>
            <div>
              <h3>B · Receive</h3>
              <small>Buyer checks identity, condition and weight tolerance.</small>
              {has(c?.received_at) ? (
                <p className="done-line">
                  ✓ {day(c?.received_at)} · {val(c?.received_weight_kg)} kg · identity {Number(c?.identity_ok) === 1 ? "ok" : "not ok"} · condition {Number(c?.condition_ok) === 1 ? "ok" : "not ok"} ·
                  weight {Number(c?.weight_within_tolerance) === 1 ? "within" : "outside"} tolerance
                </p>
              ) : null}
              <form onSubmit={(e) => void act("receive", "receive", fields(e), "Receipt recorded.")}>
                <div className="wf-form">
                  <label>Received weight (kg)<input name="received_weight_kg" inputMode="decimal" required defaultValue={s(c?.received_weight_kg)} /></label>
                  <label>Identity matches<Select name="identity_ok" defaultValue="1" options={YES_NO.slice(1)} /></label>
                  <label>Condition acceptable<Select name="condition_ok" defaultValue="1" options={YES_NO.slice(1)} /></label>
                  <label className="wide">Note<input name="receive_note" defaultValue={s(c?.receive_note)} /></label>
                </div>
                <SaveRow label="Record receipt" busy={busy === "receive"} note={note.receive} />
              </form>
            </div>
            <div>
              <h3>C · Invoice</h3>
              <small>Acceptance starts the agreed payment clock.</small>
              {has(c?.invoiced_at) ? <p className="done-line">✓ {val(c?.invoice_no)} · {money(c?.invoice_amount)} · due {day(c?.payment_due_at)}</p> : null}
              <form onSubmit={(e) => void act("invoice", "invoice", fields(e), "Invoice issued.")}>
                <div className="wf-form">
                  <label>Invoice no.<input name="invoice_no" placeholder="auto" defaultValue={s(c?.invoice_no)} /></label>
                  <label>Amount (৳, blank = received × rate)<input name="invoice_amount" inputMode="decimal" defaultValue={s(c?.invoice_amount)} /></label>
                </div>
                <SaveRow label="Issue invoice" busy={busy === "invoice"} note={note.invoice} />
              </form>
            </div>
            <div>
              <h3>D · Collection</h3>
              <small>Buyer pays the designated bank account.</small>
              {has(c?.collected_at) ? <p className="done-line">✓ {day(c?.collected_at)} · {money(c?.collected_amount)} · {val(c?.collection_reference)}</p> : null}
              <form onSubmit={(e) => void act("collect", "collect", fields(e), "Collection recorded.")}>
                <div className="wf-form">
                  <label>Collected (৳)<input name="collected_amount" inputMode="decimal" required defaultValue={s(c?.collected_amount ?? c?.invoice_amount)} /></label>
                  <label>Bank account<input name="bank_account_ref" defaultValue={s(c?.bank_account_ref)} /></label>
                  <label>Reference<input name="collection_reference" defaultValue={s(c?.collection_reference)} /></label>
                </div>
                <SaveRow label="Record collection" busy={busy === "collect"} note={note.collect} />
              </form>
            </div>
          </div>
        </fieldset>
      </details>

      {/* --- Manual correction ------------------------------------------------ */}
      <section className="panel wf-card lw-card">
        <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Correct the status</h2>
        <p className="lw-hint">Only for fixing a mistake — the sections above set the status themselves. This is also how a cancelled or rejected listing is reopened.</p>
        <form onSubmit={(e) => void act("set_status", "set_status", fields(e), "Status changed.")}>
          <div className="wf-form">
            <label>Status
              <Select name="status" defaultValue={status} options={wf.statuses.map((x) => ({ value: x, label: human(x) }))} />
            </label>
          </div>
          <SaveRow label="Set status" busy={busy === "set_status"} note={note.set_status} />
        </form>
      </section>

      {/* --- Cancel / Reject reason ------------------------------------------- */}
      {modal ? (
        <div className="lw-modal-back" role="dialog" aria-modal="true" onClick={() => setModal("")}>
          <div className="lw-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal === "cancel" ? "Cancel this listing" : "Reject this listing"}</h3>
            <p>
              {modal === "cancel"
                ? "The listing closes, stays on record and stays visible to the farmer. It is counted nowhere. Tell the farmer why."
                : "Rejection is the post-shipping outcome — the buyer refused what arrived. The listing closes and stays on record. Tell the farmer why."}
            </p>
            <textarea
              rows={3}
              autoFocus
              maxLength={400}
              value={reason}
              placeholder={modal === "cancel" ? "e.g. Farmer sold the animal locally" : "e.g. Weight outside tolerance on arrival"}
              onChange={(e) => setReason(e.target.value)}
            />
            {note.close?.bad ? <p className="lw-msg bad" style={{ marginTop: 10 }}>{note.close.bad}</p> : null}
            <div className="lw-modal-foot">
              <button type="button" className="btn ghost" onClick={() => setModal("")}>Back</button>
              <button type="button" className="lw-danger-btn" disabled={busy === "close" || !reason.trim()} onClick={() => void closeListing()}>
                {busy === "close" ? "Saving…" : modal === "cancel" ? "Cancel the listing" : "Reject the listing"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* A dose is a row inside the listing, not a resource of its own, so the
          dialog confirms and hands the work back through onConfirm. */}
      {pendingDose ? (
        <DeleteDialog
          resource="sale/listings"
          endpoint=""
          entityName="Vaccination dose"
          id={pendingDose.id}
          fallbackTitle={`${pendingDose.name} dose`}
          heading="Delete this vaccination dose?"
          description="The dose is removed from this listing's vaccination record. Nothing else on the listing changes."
          onCancel={() => setPendingDose(null)}
          onConfirm={async () => { await act("vaccination", "delete_vaccination", { id: pendingDose.id }, "Dose deleted."); }}
          onDeleted={() => setPendingDose(null)}
        />
      ) : null}
    </>
  );
}
