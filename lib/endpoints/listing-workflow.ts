import { queryRows, withTransaction, type Tx } from "@/lib/db";
import type { Row } from "./shared";
import { getListingProgress } from "./progress";
import { ruleFees } from "@/lib/pricing";
import { notifyListing, reasonVars } from "@/lib/notices";
import type { Vars } from "@/lib/notify";

/**
 * The admin side of a sale listing's six steps:
 *
 *   1 Submitted -> 2 Field verification -> 3 Product profile approved
 *   -> 4 Purchase contract accepted -> 5 Product shipped -> 6 Payment
 *
 * Step 2 is the field officer's photo checklist. Steps 4-6 carry the post-sale
 * flow: A handover (farmer signs custody transfer after the advance) -> B
 * transport (dispatched with the digital animal record) -> C receive (buyer
 * checks identity, condition, weight tolerance) -> D invoice (acceptance starts
 * the payment clock) -> E collection (buyer pays the designated account).
 *
 * Each action checks the step before it, so the farmer's trail can never show
 * "shipped" on an animal nobody verified.
 */

export const PHOTO_SLOTS = [
  { key: "muzzle_front", group: "muzzle_front", label: "Muzzle — front", hint: "Straight, close, unobstructed" },
  { key: "muzzle_left", group: "muzzle_angles", label: "Muzzle — left", hint: "Identification view" },
  { key: "muzzle_right", group: "muzzle_angles", label: "Muzzle — right", hint: "Identification view" },
  { key: "body_left", group: "full_body", label: "Full body — left", hint: "Whole animal in frame" },
  { key: "body_right", group: "full_body", label: "Full body — right", hint: "Whole animal in frame" },
  { key: "body_front", group: "full_body", label: "Full body — front", hint: "Whole animal in frame" },
  { key: "body_rear", group: "full_body", label: "Full body — rear", hint: "Whole animal in frame" },
  { key: "teeth", group: "teeth_age", label: "Teeth / age", hint: "Dentition evidence" },
  { key: "legs_hooves", group: "legs_hooves", label: "Legs / hooves", hint: "Mobility, injury, condition" },
  { key: "tag_mark", group: "tag_mark", label: "Tag / mark", hint: "Ear tag or unique visible feature" }
] as const;

export const CHECKLIST_ITEMS = [
  { key: "muzzle_front", label: "Muzzle front", detail: "Straight, close, unobstructed" },
  { key: "muzzle_angles", label: "Muzzle angles", detail: "Left / right identification views" },
  { key: "full_body", label: "Full body", detail: "Left, right, front, rear" },
  { key: "teeth_age", label: "Teeth / age", detail: "Dentition evidence" },
  { key: "legs_hooves", label: "Legs / hooves", detail: "Mobility, injury, condition" },
  { key: "tag_mark", label: "Tag / mark", detail: "Ear tag or unique visible feature" }
] as const;

const MANUAL_STATUSES = ["submitted", "field_verification", "verified", "active", "contracted", "shipped", "paid", "rejected", "cancelled"];

// Marks a column to be written as NOW() on the database clock.
const NOW = Symbol("now");

function dt(v: unknown, dateOnly = false): string | null {
  if (v === null || v === undefined || v === "") return null;
  const m = String(v).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (!m) throw new Error(`Not a date: ${String(v)}`);
  if (dateOnly || !m[2]) return m[1];
  return `${m[1]} ${m[2]}:00`;
}

function num(v: unknown, label: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a positive number.`);
  return n;
}

function flag(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  return v === true || v === 1 || v === "1" || v === "true" || v === "yes" ? 1 : 0;
}

function text(v: unknown, max = 255): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function required<T>(v: T | null, label: string): T {
  if (v === null || v === undefined || (v as unknown) === "") throw new Error(`${label} is required.`);
  return v;
}

function parseJson(v: unknown): Row {
  if (!v) return {};
  if (typeof v === "object") return v as Row;
  try { return JSON.parse(String(v)) as Row; } catch { return {}; }
}

// Insert-or-update of the one row a listing has in a side table. Column names
// come from this file only, never from the request.
async function upsert(tx: Tx, table: "listing_contracts" | "listing_field_verifications", listingId: number, fields: Record<string, unknown>) {
  const cols = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const values = cols.filter((c) => fields[c] !== NOW).map((c) => fields[c]);
  const marks = cols.map((c) => (fields[c] === NOW ? "NOW()" : "?"));
  const update = cols.length ? cols.map((c) => `\`${c}\` = VALUES(\`${c}\`)`).join(", ") : "listing_id = listing_id";
  await tx.execute(
    `INSERT INTO ${table} (listing_id${cols.map((c) => `, \`${c}\``).join("")}) VALUES (?${marks.map((m) => `, ${m}`).join("")})
     ON DUPLICATE KEY UPDATE ${update}`,
    [listingId, ...values]
  );
}

function netFarmerRate(r: Row): number | null {
  if (r.b2b_market_rate === null || r.b2b_market_rate === undefined) return null;
  return ruleFees(r).net;
}

// GET /api/v1/admin/sale/listing-workflow?listing_id=
export async function getListingWorkflow(listingId?: string | number | null) {
  if (!listingId) throw new Error("listing_id is required.");
  const rows = await queryRows<Row>(
    `SELECT CAST(l.id AS CHAR) AS id, l.listing_code, l.title_en, l.title_bn, l.status, l.description,
            l.age_months, l.weight_kg, l.meat_weight_kg, l.dressing_pct, l.quantity, l.unit,
            l.farmer_expected_price, l.estimated_earning, l.contact_phone, l.contact_name, l.address_text,
            l.media_json, l.ai_analysis_json, l.created_at, l.approved_at, l.field_visit_date, l.field_visit_note,
            l.verified_weight_kg, l.verified_at, l.contracted_at, l.shipped_at,
            l.paid_at, l.paid_amount, l.payment_method, l.payment_reference,
            CAST(l.user_id AS CHAR) AS user_id, u.full_name AS farmer_name, u.phone AS farmer_phone,
            si.name_en AS item_name, sc.name_en AS category_name, a.name_en AS animal_name, b.name_en AS breed_name,
            gu.name_en AS upazila_name, gd.name_en AS district_name, gv.name_en AS division_name,
            CAST(l.pricing_rule_id AS CHAR) AS pricing_rule_id,
            r.rule_name, r.b2b_market_rate, r.b2b_meat_rate, r.dressing_pct AS rule_dressing_pct,
            r.platform_fee_pct, r.platform_fee, r.logistics_fee, r.logistics_fee_pct,
            r.warehouse_vet_fee, r.warehouse_vet_fee_pct, r.farmer_rate,
            r.is_active AS rule_active, r.effective_from AS rule_effective_from, r.unit AS rule_unit,
            COALESCE(ru.name_en, rd.name_en, rv.name_en, 'All districts') AS rule_area
       FROM sale_listings l
       JOIN app_users u ON u.id = l.user_id
       LEFT JOIN sale_items si ON si.id = l.sale_item_id
       LEFT JOIN sale_categories sc ON sc.id = si.sale_category_id
       LEFT JOIN animals a ON a.id = l.animal_id
       LEFT JOIN animal_breeds b ON b.id = l.breed_id
       LEFT JOIN geo_upazilas gu ON gu.id = l.upazila_id
       LEFT JOIN geo_districts gd ON gd.id = l.district_id
       LEFT JOIN geo_divisions gv ON gv.id = l.division_id
       LEFT JOIN sale_pricing_rules r ON r.id = l.pricing_rule_id
       LEFT JOIN geo_upazilas ru ON ru.id = r.upazila_id
       LEFT JOIN geo_districts rd ON rd.id = r.district_id
       LEFT JOIN geo_divisions rv ON rv.id = r.division_id
      WHERE l.id = ?
      LIMIT 1`,
    [listingId]
  );
  const listing = rows[0];
  if (!listing) return null;

  const [verification] = await queryRows<Row>("SELECT * FROM listing_field_verifications WHERE listing_id = ? LIMIT 1", [listingId]);
  const [contract] = await queryRows<Row>("SELECT * FROM listing_contracts WHERE listing_id = ? LIMIT 1", [listingId]);
  const officers = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, name, phone, district, upazila FROM zone_officers
      WHERE is_active = 1 AND officer_role = 'field_officer' ORDER BY name`
  );
  const progress = await getListingProgress(String(listingId), null);

  return {
    listing,
    pricing_rule: listing.pricing_rule_id
      ? {
          id: listing.pricing_rule_id,
          name: listing.rule_name ?? `Rule #${listing.pricing_rule_id}`,
          area: listing.rule_area,
          active: Number(listing.rule_active) === 1,
          effective_from: listing.rule_effective_from,
          b2b_market_rate: listing.b2b_market_rate,
          b2b_meat_rate: listing.b2b_meat_rate,
          platform_fee_pct: listing.platform_fee_pct,
          platform_fee: listing.platform_fee,
          logistics_fee: listing.logistics_fee,
          warehouse_vet_fee: listing.warehouse_vet_fee,
          net_farmer_rate: netFarmerRate(listing),
          unit: listing.rule_unit
        }
      : null,
    verification: verification
      ? { ...verification, photos_json: parseJson(verification.photos_json), checklist_json: parseJson(verification.checklist_json) }
      : null,
    contract: contract ?? null,
    officers,
    steps: progress?.steps ?? [],
    photo_slots: PHOTO_SLOTS,
    checklist_items: CHECKLIST_ITEMS,
    statuses: MANUAL_STATUSES
  };
}

// POST /api/v1/admin/sale/listing-workflow  { listing_id, action, data }
export async function saveListingWorkflow(payload: Row, adminId: unknown) {
  const listingId = Number(payload.listing_id);
  if (!listingId) throw new Error("listing_id is required.");
  const action = String(payload.action ?? "");
  const d = (payload.data ?? {}) as Row;

  await withTransaction(async (tx) => {
    const [l] = await tx.query<Row>(
      "SELECT id, status, listing_code, weight_kg, verified_weight_kg FROM sale_listings WHERE id = ? FOR UPDATE",
      [listingId]
    );
    if (!l) throw new Error("Listing not found.");
    const status = String(l.status);
    const [v] = await tx.query<Row>("SELECT * FROM listing_field_verifications WHERE listing_id = ? LIMIT 1", [listingId]);
    const [c] = await tx.query<Row>("SELECT * FROM listing_contracts WHERE listing_id = ? LIMIT 1", [listingId]);
    const setListing = (sql: string, values: unknown[]) => tx.execute(`UPDATE sale_listings SET ${sql} WHERE id = ?`, [...values, listingId]);
    const need = (ok: boolean, message: string) => { if (!ok) throw new Error(message); };

    switch (action) {
      // --- Step 2: field verification -----------------------------------
      case "schedule_visit": {
        need(["draft", "submitted", "field_verification"].includes(status), "Field verification is already complete for this listing.");
        const visit = required(dt(d.visit_date, true), "Visit date");
        await upsert(tx, "listing_field_verifications", listingId, { visit_date: visit, officer_id: num(d.officer_id, "Officer") });
        await setListing("status = 'field_verification', field_visit_date = ?", [visit]);
        return;
      }
      case "save_verification": {
        need(["submitted", "field_verification", "verified"].includes(status), "The profile is already approved; verification can no longer change.");
        const photos: Record<string, string> = {};
        const inPhotos = parseJson(d.photos);
        for (const slot of PHOTO_SLOTS) {
          const url = text(inPhotos[slot.key], 500);
          if (url) {
            need(/^(https?:\/\/|\/)/.test(url), `${slot.label}: not an uploaded photo.`);
            photos[slot.key] = url;
          }
        }
        const checklist: Record<string, { ok: boolean; note: string }> = {};
        const inChecklist = parseJson(d.checklist);
        for (const item of CHECKLIST_ITEMS) {
          const entry = (inChecklist[item.key] ?? {}) as Row;
          checklist[item.key] = { ok: flag(entry.ok) === 1, note: text(entry.note) ?? "" };
        }
        const result = ["pending", "passed", "failed", "recheck"].includes(String(d.result)) ? String(d.result) : "pending";
        const weight = num(d.verified_weight_kg, "Verified weight");
        if (result === "passed") {
          const missing = PHOTO_SLOTS.filter((s) => !photos[s.key]).map((s) => s.label);
          need(!missing.length, `Photos still needed: ${missing.join(", ")}.`);
          const unchecked = CHECKLIST_ITEMS.filter((i) => !checklist[i.key].ok).map((i) => i.label);
          need(!unchecked.length, `Checklist items not confirmed: ${unchecked.join(", ")}.`);
          need(weight !== null && weight > 0, "Verified weight is required to pass verification.");
        }
        const legs = ["good", "minor_issue", "lame", "injured"].includes(String(d.legs_condition)) ? String(d.legs_condition) : null;
        await upsert(tx, "listing_field_verifications", listingId, {
          officer_id: num(d.officer_id, "Officer") ?? v?.officer_id ?? null,
          visit_date: dt(d.visit_date, true) ?? v?.visit_date ?? null,
          photos_json: JSON.stringify(photos),
          checklist_json: JSON.stringify(checklist),
          dentition: text(d.dentition, 80),
          estimated_age_months: num(d.estimated_age_months, "Estimated age"),
          legs_condition: legs,
          body_condition_score: num(d.body_condition_score, "Body condition score"),
          tag_number: text(d.tag_number, 60),
          unique_mark: text(d.unique_mark),
          verified_weight_kg: weight,
          health_notes: text(d.health_notes, 5000),
          result,
          recorded_by: adminId ?? null,
          verified_at: result === "passed" ? NOW : null
        });
        if (result === "passed") {
          await setListing("status = 'verified', verified_weight_kg = ?, verified_at = NOW(), field_visit_note = COALESCE(?, field_visit_note)", [weight, text(d.health_notes, 5000)]);
        } else if (result === "failed") {
          await setListing("status = 'rejected', field_visit_note = COALESCE(?, field_visit_note)", [text(d.health_notes, 5000)]);
        } else {
          await setListing("status = 'field_verification'", []);
        }
        return;
      }
      // --- Step 3: product profile approved ------------------------------
      case "approve_profile": {
        need(status === "verified", "Pass field verification before approving the product profile.");
        need(String(v?.result) === "passed", "Field verification has not passed.");
        await setListing("status = 'active', approved_by = ?, approved_at = NOW()", [adminId ?? null]);
        return;
      }
      // --- Step 4: purchase contract accepted ----------------------------
      case "accept_contract": {
        need(["active", "contracted"].includes(status), "Approve the product profile before recording a contract.");
        const rate = required(num(d.agreed_rate_per_kg, "Agreed rate"), "Agreed rate per kg");
        const weight = num(d.agreed_weight_kg, "Agreed weight") ?? (l.verified_weight_kg === null ? null : Number(l.verified_weight_kg));
        required(weight, "Agreed weight");
        await upsert(tx, "listing_contracts", listingId, {
          contract_ref: text(d.contract_ref, 60) ?? c?.contract_ref ?? `PC-${l.listing_code}`,
          buyer_name: required(text(d.buyer_name, 190), "Buyer name"),
          buyer_phone: text(d.buyer_phone, 32),
          buyer_org: text(d.buyer_org, 190),
          agreed_rate_per_kg: rate,
          agreed_weight_kg: weight,
          contract_amount: num(d.contract_amount, "Contract amount") ?? Math.round(rate * Number(weight) * 100) / 100,
          weight_tolerance_pct: num(d.weight_tolerance_pct, "Weight tolerance") ?? 3,
          advance_amount: num(d.advance_amount, "Advance"),
          payment_terms_days: num(d.payment_terms_days, "Payment terms"),
          accepted_at: c?.accepted_at ? undefined : NOW
        });
        await setListing("status = 'contracted', contracted_at = COALESCE(contracted_at, NOW())", []);
        return;
      }
      // --- A. Handover ----------------------------------------------------
      case "handover": {
        need(status === "contracted" && Boolean(c), "Record the purchase contract first.");
        await upsert(tx, "listing_contracts", listingId, {
          advance_paid_at: dt(d.advance_paid_at) ?? NOW,
          handover_at: dt(d.handover_at) ?? NOW,
          handover_signed_by: required(text(d.handover_signed_by, 190), "Signed by"),
          handover_note: text(d.handover_note, 5000)
        });
        return;
      }
      // --- B. Transport = step 5, product shipped -------------------------
      case "dispatch": {
        need(Boolean(c?.handover_at), "Complete the handover (A) before dispatch.");
        await upsert(tx, "listing_contracts", listingId, {
          dispatched_at: dt(d.dispatched_at) ?? NOW,
          vehicle_ref: required(text(d.vehicle_ref, 80), "Vehicle"),
          driver_phone: text(d.driver_phone, 32),
          digital_record_ref: text(d.digital_record_ref, 80) ?? `${l.listing_code}${v?.tag_number ? `/${v.tag_number}` : ""}`
        });
        await setListing("status = 'shipped', shipped_at = COALESCE(shipped_at, NOW())", []);
        return;
      }
      // --- C. Receive -----------------------------------------------------
      case "receive": {
        need(Boolean(c?.dispatched_at), "Dispatch (B) comes before the buyer receives.");
        const received = required(num(d.received_weight_kg, "Received weight"), "Received weight");
        const agreed = Number(c?.agreed_weight_kg ?? 0);
        const tolerance = Number(c?.weight_tolerance_pct ?? 3);
        const within = agreed > 0 ? (Math.abs(received - agreed) / agreed) * 100 <= tolerance : null;
        await upsert(tx, "listing_contracts", listingId, {
          received_at: dt(d.received_at) ?? NOW,
          received_weight_kg: received,
          identity_ok: flag(d.identity_ok),
          condition_ok: flag(d.condition_ok),
          weight_within_tolerance: within === null ? null : within ? 1 : 0,
          receive_note: text(d.receive_note, 5000)
        });
        return;
      }
      // --- D. Invoice -----------------------------------------------------
      case "invoice": {
        need(Boolean(c?.received_at), "The buyer must receive (C) before invoicing.");
        const amount = num(d.invoice_amount, "Invoice amount")
          ?? Math.round(Number(c?.received_weight_kg ?? 0) * Number(c?.agreed_rate_per_kg ?? 0) * 100) / 100;
        await upsert(tx, "listing_contracts", listingId, {
          invoice_no: text(d.invoice_no, 60) ?? c?.invoice_no ?? `INV-${l.listing_code}`,
          invoice_amount: amount,
          invoiced_at: dt(d.invoiced_at) ?? NOW,
          payment_due_at: dt(d.payment_due_at, true)
        });
        // Acceptance starts the payment clock: due = invoice date + agreed terms.
        await tx.execute(
          `UPDATE listing_contracts SET payment_due_at = DATE_ADD(DATE(invoiced_at), INTERVAL COALESCE(payment_terms_days, 0) DAY)
            WHERE listing_id = ? AND payment_due_at IS NULL`,
          [listingId]
        );
        return;
      }
      // --- E. Collection --------------------------------------------------
      case "collect": {
        need(Boolean(c?.invoiced_at), "Invoice (D) the buyer before recording collection.");
        await upsert(tx, "listing_contracts", listingId, {
          collected_at: dt(d.collected_at) ?? NOW,
          collected_amount: required(num(d.collected_amount, "Collected amount"), "Collected amount"),
          bank_account_ref: text(d.bank_account_ref, 120),
          collection_reference: text(d.collection_reference, 120)
        });
        return;
      }
      // --- Step 6: payment to the farmer ---------------------------------
      case "pay_farmer": {
        need(["shipped", "paid"].includes(status), "The animal must be shipped before the farmer is paid.");
        const method = ["cash", "cheque", "bank_transfer", "bkash", "nagad"].includes(String(d.payment_method)) ? String(d.payment_method) : null;
        await setListing("status = 'paid', paid_at = COALESCE(?, NOW()), paid_amount = ?, payment_method = ?, payment_reference = ?", [
          dt(d.paid_at),
          required(num(d.paid_amount, "Paid amount"), "Paid amount"),
          required(method, "Payment method"),
          text(d.payment_reference, 80)
        ]);
        return;
      }
      // --- Manual correction ----------------------------------------------
      case "set_status": {
        const next = String(d.status ?? "");
        need(MANUAL_STATUSES.includes(next), "Unknown status.");
        await setListing("status = ?", [next]);
        return;
      }
      default:
        throw new Error(`Unknown action "${action}".`);
    }
  });

  // Tell the farmer what just happened on their listing.
  const EVENT: Record<string, string> = {
    schedule_visit: "listing_visit_scheduled",
    approve_profile: "listing_approved",
    accept_contract: "listing_contracted",
    dispatch: "listing_shipped",
    pay_farmer: "listing_paid"
  };
  const event = action === "save_verification"
    ? d.result === "passed" ? "listing_verified" : d.result === "failed" ? "listing_rejected" : null
    : EVENT[action] ?? null;
  if (event) await notifyListing(listingId, event, listingEventVars(action, d));
  return getListingWorkflow(listingId);
}

const METHOD: Record<string, [string, string]> = {
  cash: ["cash", "নগদ"], cheque: ["cheque", "চেক"], bank_transfer: ["bank transfer", "ব্যাংক ট্রান্সফার"], bkash: ["bKash", "বিকাশ"], nagad: ["Nagad", "নগদ (মোবাইল)"]
};

function listingEventVars(action: string, d: Row): Vars {
  if (action === "schedule_visit" && d.visit_date) {
    const date = new Date(`${String(d.visit_date).slice(0, 10)}T00:00:00`);
    const opts = { day: "numeric", month: "long", year: "numeric" } as const;
    return { visit_date: { en: date.toLocaleDateString("en-GB", opts), bn: date.toLocaleDateString("bn-BD", opts) } };
  }
  if (action === "accept_contract") {
    const advance = Number(d.advance_amount ?? 0);
    return {
      buyer: String(d.buyer_org || d.buyer_name || ""),
      rate: Number(d.agreed_rate_per_kg ?? 0),
      advance: advance > 0 ? { en: ` An advance of ৳${advance.toLocaleString("en-IN")} is on its way.`, bn: ` ৳${advance.toLocaleString("en-IN")} অগ্রিম পাঠানো হচ্ছে।` } : ""
    };
  }
  if (action === "pay_farmer") {
    const [en, bn] = METHOD[String(d.payment_method)] ?? [String(d.payment_method ?? ""), String(d.payment_method ?? "")];
    return { amount: Number(d.paid_amount ?? 0), method: { en, bn }, reference: String(d.payment_reference || "—") };
  }
  if (action === "save_verification") {
    return { weight: Number(d.verified_weight_kg ?? 0), ...(d.result === "failed" ? reasonVars(d.health_notes) : {}) };
  }
  return {};
}
