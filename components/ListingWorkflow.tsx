"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Camera, ClipboardCheck, Edit3, FileSignature, Scale, Truck, Wallet } from "lucide-react";
import { Status } from "@/components/Status";
import { Select } from "@/components/Select";

const YES_NO = [{ value: "1", label: "Yes" }, { value: "0", label: "No" }];

/**
 * A sale listing's six steps, driven from the console. The farmer's app shows
 * the same trail (done green, current brown). Every action posts to
 * admin/sale/listing-workflow, which refuses a step whose predecessor is not
 * done, and returns the refreshed workflow.
 */

type Row = Record<string, unknown>;
type Step = { key: string; index: number; title_en: string; desc_en: string; state: "done" | "current" | "upcoming"; date: string | null; note: string | null };
type Slot = { key: string; group: string; label: string; hint: string };
type CheckItem = { key: string; label: string; detail: string };
type Workflow = {
  listing: Row;
  pricing_rule: Row | null;
  verification: Row | null;
  contract: Row | null;
  officers: Row[];
  steps: Step[];
  photo_slots: Slot[];
  checklist_items: CheckItem[];
  statuses: string[];
};

const val = (x: unknown) => (x === null || x === undefined || x === "" ? "—" : String(x));
const has = (x: unknown) => x !== null && x !== undefined && x !== "";
const day = (x: unknown) => {
  if (!has(x)) return "—";
  const d = new Date(String(x));
  return Number.isNaN(d.getTime()) ? String(x) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const money = (x: unknown) => (has(x) ? `৳${Number(x).toLocaleString("en-BD", { maximumFractionDigits: 2 })}` : "—");
const dateInput = (x: unknown) => (has(x) ? String(x).slice(0, 10) : "");

function fields(e: FormEvent<HTMLFormElement>): Record<string, string> {
  e.preventDefault();
  return Object.fromEntries(Array.from(new FormData(e.currentTarget).entries()).map(([k, v]) => [k, String(v)]));
}

export function ListingWorkflow({ listingId }: { listingId: string }) {
  const [wf, setWf] = useState<Workflow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [checklist, setChecklist] = useState<Record<string, { ok: boolean; note: string }>>({});

  const adopt = useCallback((next: Workflow) => {
    setWf(next);
    setPhotos({ ...((next.verification?.photos_json as Record<string, string>) ?? {}) });
    setChecklist({ ...((next.verification?.checklist_json as Record<string, { ok: boolean; note: string }>) ?? {}) });
  }, []);

  const load = useCallback(async () => {
    const r = await fetch(`/api/v1/admin/sale/listing-workflow?listing_id=${encodeURIComponent(listingId)}`, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (r.ok && j?.data) adopt(j.data as Workflow);
    else setError(j?.message ?? "Could not load this listing.");
    setLoaded(true);
  }, [listingId, adopt]);

  useEffect(() => { void load(); }, [load]);

  async function act(action: string, data: Record<string, unknown>, done = "Saved.") {
    setBusy(action);
    setMessage("");
    setError("");
    const r = await fetch("/api/v1/admin/sale/listing-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listing_id: listingId, action, data })
    });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok || !j.ok) {
      setError(j.message ?? "That did not save.");
      return;
    }
    adopt(j.result as Workflow);
    setMessage(done);
  }

  async function upload(slot: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "verification");
    setBusy(`photo:${slot}`);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (r.ok && j.ok && j.url) setPhotos((p) => ({ ...p, [slot]: String(j.url) }));
    else setError(j.message ?? "Upload failed.");
  }

  if (!loaded) return <p className="page-sub">Loading listing…</p>;
  if (!wf) {
    return (
      <div className="panel empty-state">
        <h1>Sale listing not found</h1>
        <p>{error || `No sale listing exists for id ${listingId}.`}</p>
        <Link className="btn primary" href="/sale">Back to listings</Link>
      </div>
    );
  }

  const l = wf.listing;
  const v = wf.verification;
  const c = wf.contract;
  const rule = wf.pricing_rule;
  const stepState = (key: string) => wf.steps.find((s) => s.key === key)?.state ?? "upcoming";
  const cardClass = (key: string) => `panel wf-card ${stepState(key)}`;
  const weight = Number(l.verified_weight_kg || l.weight_kg || 0);
  const netRate = rule ? Number(rule.net_farmer_rate ?? 0) : 0;
  const farmerAmount = weight && netRate ? Math.round(weight * netRate) : null;

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
          <Status label={val(l.status)} />
          <Link className="btn ghost" href={`/manage/form?resource=sale/listings&id=${encodeURIComponent(listingId)}`}><Edit3 size={18} /> Edit fields</Link>
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice" style={{ background: "#FDEEEE", borderColor: "#F2B8B8", color: "#8A1F1F" }}>{error}</div> : null}

      <ol className="wf-steps">
        {wf.steps.map((s) => (
          <li key={s.key} className={`wf-step ${s.state}`}>
            <span className="wf-num">{s.state === "done" ? "✓" : s.index}</span>
            <b>{s.title_en}</b>
            <span>{s.date ? day(s.date) : s.state === "current" ? "In progress" : ""}</span>
          </li>
        ))}
      </ol>

      <div className="wf-grid">
        <article className="panel wf-card">
          <h2><Scale size={18} /> Listing</h2>
          <div className="wf-facts">
            <div><span>Farmer</span><strong>{val(l.farmer_name)}</strong><br />{val(l.farmer_phone)}</div>
            <div><span>Location</span><strong>{val(l.upazila_name)}</strong><br />{[l.district_name, l.division_name].filter(Boolean).join(", ")}</div>
            <div><span>Live weight (farmer)</span><strong>{val(l.weight_kg)} kg</strong></div>
            <div><span>Verified weight</span><strong>{has(l.verified_weight_kg) ? `${l.verified_weight_kg} kg` : "—"}</strong></div>
            <div><span>Age</span><strong>{has(l.age_months) ? `${l.age_months} months` : "—"}</strong></div>
            <div><span>Estimated earning</span><strong>{money(l.estimated_earning)}</strong></div>
            <div style={{ gridColumn: "1 / -1" }}><span>Address</span><strong>{val(l.address_text)}</strong></div>
          </div>
        </article>

        <article className="panel wf-card">
          <h2><FileSignature size={18} /> Price rule attached</h2>
          {rule ? (
            <>
              <p className="muted">
                <Link href={`/manage/view?resource=sale/pricing&id=${encodeURIComponent(String(rule.id))}`}><b>{val(rule.name)}</b></Link> · {val(rule.area)} · from {day(rule.effective_from)}{" "}
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

      {/* Step 2 — field verification */}
      <section className={cardClass("field_visit")}>
        <h2><Camera size={18} /> 2 · Field verification</h2>
        <p className="muted">The field officer visits, photographs the animal against the checklist, confirms identity and weighs it.</p>
        <form className="wf-form" onSubmit={(e) => void act("schedule_visit", fields(e), "Visit scheduled.")}>
          <label>Visit date<input type="date" name="visit_date" defaultValue={dateInput(v?.visit_date ?? l.field_visit_date)} required /></label>
          <label>Field officer
            <Select
              name="officer_id"
              defaultValue={val(v?.officer_id) === "—" ? "" : String(v?.officer_id)}
              options={[
                { value: "", label: "—" },
                ...wf.officers.map((o) => ({ value: String(o.id), label: `${String(o.name)}${o.upazila || o.district ? ` · ${o.upazila ?? o.district}` : ""}` }))
              ]}
            />
          </label>
          <button className="btn ghost" type="submit" disabled={busy === "schedule_visit"}>Schedule visit</button>
        </form>

        <form
          onSubmit={(e) => {
            const f = fields(e);
            void act("save_verification", { ...f, photos, checklist }, f.result === "passed" ? "Verification passed." : "Verification saved.");
          }}
        >
          <h3 style={{ margin: "16px 0 4px", fontSize: 14 }}>Photo checklist</h3>
          <div className="wf-photos">
            {wf.photo_slots.map((slot) => (
              <div className="wf-photo" key={slot.key}>
                {photos[slot.key] ? <a href={photos[slot.key]} target="_blank" rel="noreferrer"><img src={photos[slot.key]} alt={slot.label} /></a> : <div className="ph"><Camera size={20} /></div>}
                <strong>{slot.label}</strong>
                <small>{slot.hint}</small>
                <input type="file" accept="image/*" disabled={busy === `photo:${slot.key}`} onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(slot.key, file); }} />
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
            <label>Dentition<input name="dentition" placeholder="e.g. 2 permanent incisors" defaultValue={String(v?.dentition ?? "")} /></label>
            <label>Estimated age (months)<input name="estimated_age_months" inputMode="numeric" defaultValue={String(v?.estimated_age_months ?? l.age_months ?? "")} /></label>
            <label>Legs / hooves
              <Select
                name="legs_condition"
                defaultValue={String(v?.legs_condition ?? "")}
                options={[
                  { value: "", label: "—" },
                  { value: "good", label: "Good" },
                  { value: "minor_issue", label: "Minor issue" },
                  { value: "lame", label: "Lame" },
                  { value: "injured", label: "Injured" }
                ]}
              />
            </label>
            <label>Body condition score (1–5)<input name="body_condition_score" inputMode="decimal" defaultValue={String(v?.body_condition_score ?? "")} /></label>
            <label>Ear tag number<input name="tag_number" defaultValue={String(v?.tag_number ?? "")} /></label>
            <label>Unique mark<input name="unique_mark" defaultValue={String(v?.unique_mark ?? "")} /></label>
            <label>Verified live weight (kg)<input name="verified_weight_kg" inputMode="decimal" defaultValue={String(v?.verified_weight_kg ?? l.verified_weight_kg ?? "")} /></label>
            <label>Result
              <Select
                name="result"
                defaultValue={String(v?.result ?? "pending")}
                options={[
                  { value: "pending", label: "Pending" },
                  { value: "passed", label: "Passed" },
                  { value: "recheck", label: "Recheck needed" },
                  { value: "failed", label: "Failed (rejects listing)" }
                ]}
              />
            </label>
            <label className="wide">Health notes<textarea name="health_notes" rows={2} defaultValue={String(v?.health_notes ?? "")} /></label>
            <button className="btn primary" type="submit" disabled={busy === "save_verification"}><ClipboardCheck size={16} /> Save verification</button>
          </div>
        </form>
      </section>

      {/* Step 3 — product profile */}
      <section className={cardClass("profile_approved")}>
        <h2><BadgeCheck size={18} /> 3 · Product profile approved</h2>
        <p className="muted">Approve once verification has passed. The listing then becomes available to buyers.</p>
        <button className="btn primary" type="button" disabled={l.status !== "verified" || busy === "approve_profile"} onClick={() => void act("approve_profile", {}, "Product profile approved.")}>
          Approve product profile
        </button>
        {has(l.approved_at) ? <span className="muted" style={{ marginLeft: 10 }}>Approved {day(l.approved_at)}</span> : null}
      </section>

      {/* Step 4 — contract */}
      <section className={cardClass("contract")}>
        <h2><FileSignature size={18} /> 4 · Purchase contract accepted</h2>
        <form className="wf-form" onSubmit={(e) => void act("accept_contract", fields(e), "Contract recorded.")}>
          <label>Buyer name<input name="buyer_name" required defaultValue={String(c?.buyer_name ?? "")} /></label>
          <label>Buyer organisation<input name="buyer_org" defaultValue={String(c?.buyer_org ?? "")} /></label>
          <label>Buyer phone<input name="buyer_phone" defaultValue={String(c?.buyer_phone ?? "")} /></label>
          <label>Agreed rate (৳/kg live)<input name="agreed_rate_per_kg" inputMode="decimal" required defaultValue={String(c?.agreed_rate_per_kg ?? rule?.b2b_market_rate ?? "")} /></label>
          <label>Agreed weight (kg)<input name="agreed_weight_kg" inputMode="decimal" defaultValue={String(c?.agreed_weight_kg ?? l.verified_weight_kg ?? "")} /></label>
          <label>Contract amount (৳, blank = rate × weight)<input name="contract_amount" inputMode="decimal" defaultValue={String(c?.contract_amount ?? "")} /></label>
          <label>Weight tolerance %<input name="weight_tolerance_pct" inputMode="decimal" defaultValue={String(c?.weight_tolerance_pct ?? "3")} /></label>
          <label>Advance to farmer (৳)<input name="advance_amount" inputMode="decimal" defaultValue={String(c?.advance_amount ?? "")} /></label>
          <label>Payment terms (days)<input name="payment_terms_days" inputMode="numeric" defaultValue={String(c?.payment_terms_days ?? "7")} /></label>
          <label>Contract ref<input name="contract_ref" placeholder="auto" defaultValue={String(c?.contract_ref ?? "")} /></label>
          <button className="btn primary" type="submit" disabled={busy === "accept_contract"}>Record contract</button>
        </form>
      </section>

      {/* Steps 5-6 carry the post-sale flow A-E */}
      <section className={cardClass("shipped")}>
        <h2><Truck size={18} /> 5 · Product shipped — post-sale flow</h2>
        <p className="muted">A handover → B transport → C receive → D invoice → E collection.</p>
        <div className="wf-sub">
          <div>
            <h3>A · Handover</h3>
            <small>Farmer signs custody transfer after receiving the advance.</small>
            {c?.handover_at ? <p className="done-line">✓ {day(c.handover_at)} · signed by {val(c.handover_signed_by)}</p> : null}
            <form className="wf-form" onSubmit={(e) => void act("handover", fields(e), "Handover recorded.")}>
              <label>Signed by<input name="handover_signed_by" required defaultValue={String(c?.handover_signed_by ?? l.farmer_name ?? "")} /></label>
              <label>Advance paid at<input type="datetime-local" name="advance_paid_at" /></label>
              <label className="wide">Note<input name="handover_note" defaultValue={String(c?.handover_note ?? "")} /></label>
              <button className="btn ghost" type="submit" disabled={busy === "handover"}>Record handover</button>
            </form>
          </div>
          <div>
            <h3>B · Transport</h3>
            <small>Platform dispatches with the digital animal record. Marks the listing shipped.</small>
            {c?.dispatched_at ? <p className="done-line">✓ {day(c.dispatched_at)} · {val(c.vehicle_ref)} · record {val(c.digital_record_ref)}</p> : null}
            <form className="wf-form" onSubmit={(e) => void act("dispatch", fields(e), "Dispatched.")}>
              <label>Vehicle<input name="vehicle_ref" required defaultValue={String(c?.vehicle_ref ?? "")} /></label>
              <label>Driver phone<input name="driver_phone" defaultValue={String(c?.driver_phone ?? "")} /></label>
              <label>Digital record ref<input name="digital_record_ref" placeholder="auto" defaultValue={String(c?.digital_record_ref ?? "")} /></label>
              <button className="btn ghost" type="submit" disabled={busy === "dispatch"}>Dispatch</button>
            </form>
          </div>
          <div>
            <h3>C · Receive</h3>
            <small>Buyer checks identity, condition and weight tolerance.</small>
            {c?.received_at ? (
              <p className="done-line">
                ✓ {day(c.received_at)} · {val(c.received_weight_kg)} kg · identity {Number(c.identity_ok) === 1 ? "ok" : "not ok"} · condition {Number(c.condition_ok) === 1 ? "ok" : "not ok"} ·
                weight {Number(c.weight_within_tolerance) === 1 ? "within" : "outside"} tolerance
              </p>
            ) : null}
            <form className="wf-form" onSubmit={(e) => void act("receive", fields(e), "Receipt recorded.")}>
              <label>Received weight (kg)<input name="received_weight_kg" inputMode="decimal" required defaultValue={String(c?.received_weight_kg ?? "")} /></label>
              <label>Identity matches<Select name="identity_ok" defaultValue="1" options={YES_NO} /></label>
              <label>Condition acceptable<Select name="condition_ok" defaultValue="1" options={YES_NO} /></label>
              <label className="wide">Note<input name="receive_note" defaultValue={String(c?.receive_note ?? "")} /></label>
              <button className="btn ghost" type="submit" disabled={busy === "receive"}>Record receipt</button>
            </form>
          </div>
          <div>
            <h3>D · Invoice</h3>
            <small>Acceptance starts the agreed payment clock.</small>
            {c?.invoiced_at ? <p className="done-line">✓ {val(c.invoice_no)} · {money(c.invoice_amount)} · due {day(c.payment_due_at)}</p> : null}
            <form className="wf-form" onSubmit={(e) => void act("invoice", fields(e), "Invoice issued.")}>
              <label>Invoice no.<input name="invoice_no" placeholder="auto" defaultValue={String(c?.invoice_no ?? "")} /></label>
              <label>Amount (৳, blank = received × rate)<input name="invoice_amount" inputMode="decimal" defaultValue={String(c?.invoice_amount ?? "")} /></label>
              <button className="btn ghost" type="submit" disabled={busy === "invoice"}>Issue invoice</button>
            </form>
          </div>
          <div>
            <h3>E · Collection</h3>
            <small>Buyer pays the designated bank account.</small>
            {c?.collected_at ? <p className="done-line">✓ {day(c.collected_at)} · {money(c.collected_amount)} · {val(c.collection_reference)}</p> : null}
            <form className="wf-form" onSubmit={(e) => void act("collect", fields(e), "Collection recorded.")}>
              <label>Collected (৳)<input name="collected_amount" inputMode="decimal" required defaultValue={String(c?.collected_amount ?? c?.invoice_amount ?? "")} /></label>
              <label>Bank account<input name="bank_account_ref" defaultValue={String(c?.bank_account_ref ?? "")} /></label>
              <label>Reference<input name="collection_reference" defaultValue={String(c?.collection_reference ?? "")} /></label>
              <button className="btn ghost" type="submit" disabled={busy === "collect"}>Record collection</button>
            </form>
          </div>
        </div>
      </section>

      {/* Step 6 — farmer payment */}
      <section className={cardClass("paid")}>
        <h2><Wallet size={18} /> 6 · Payment to the farmer</h2>
        {has(l.paid_at) ? <p className="done-line">✓ Paid {money(l.paid_amount)} on {day(l.paid_at)} · {val(l.payment_method)} · {val(l.payment_reference)}</p> : null}
        <form className="wf-form" onSubmit={(e) => void act("pay_farmer", fields(e), "Farmer payment recorded.")}>
          <label>Amount (৳)<input name="paid_amount" inputMode="decimal" required defaultValue={String(l.paid_amount ?? farmerAmount ?? "")} /></label>
          <label>Method
            <Select
              name="payment_method"
              defaultValue={String(l.payment_method ?? "bank_transfer")}
              options={[
                { value: "bank_transfer", label: "Bank transfer" },
                { value: "bkash", label: "bKash" },
                { value: "nagad", label: "Nagad" },
                { value: "cheque", label: "Cheque" },
                { value: "cash", label: "Cash" }
              ]}
            />
          </label>
          <label>Reference<input name="payment_reference" defaultValue={String(l.payment_reference ?? "")} /></label>
          <button className="btn primary" type="submit" disabled={busy === "pay_farmer"}>Record payment</button>
        </form>
      </section>

      <section className="panel wf-card">
        <h2>Correct the status</h2>
        <p className="muted">Only for fixing a mistake — the steps above set the status themselves.</p>
        <form className="wf-form" onSubmit={(e) => void act("set_status", fields(e), "Status changed.")}>
          <label>Status
            <Select
              name="status"
              defaultValue={String(l.status)}
              options={wf.statuses.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
            />
          </label>
          <button className="btn ghost" type="submit" disabled={busy === "set_status"}>Set status</button>
        </form>
      </section>
    </>
  );
}
