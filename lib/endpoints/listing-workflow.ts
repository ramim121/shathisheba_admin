import { queryRows, withTransaction, type Tx } from "@/lib/db";
import type { Row } from "./shared";
import { getListingProgress } from "./progress";
import { ruleFees } from "@/lib/pricing";
import { notifyListing, reasonVars } from "@/lib/notices";
import { postListingMilestone } from "@/lib/community-posts";
import type { Vars } from "@/lib/notify";

/**
 * The admin side of a sale listing's six steps:
 *
 *   1 Submitted -> 2 Field verification -> 3 Verified
 *   -> 4 Purchase contract -> 5 Shipped -> 6 Payment
 *
 * There is no approval step and a listing never becomes a Buy-from-Shathi
 * product: the console records each section, and the status follows from what
 * has been saved. Cancel closes a listing at any point; Reject is the
 * post-shipping outcome. Both stay in the database, stay visible to the farmer,
 * and are excluded from every count.
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

const MANUAL_STATUSES = ["draft", "submitted", "field_verification", "verified", "contracted", "shipped", "paid", "cancelled", "rejected"];

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

/** Accepts ["url", ...] or [{url,name}, ...] from the console. */
function docs(v: unknown): { url: string; name: string }[] {
  const raw = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return { url: entry, name: entry.split("/").pop() ?? "document" };
      const e = entry as Row;
      const url = String(e.url ?? "");
      return url ? { url, name: String(e.name ?? url.split("/").pop() ?? "document").slice(0, 190) } : null;
    })
    .filter(Boolean)
    .slice(0, 20) as { url: string; name: string }[];
}

function parseJson(v: unknown): Row {
  if (!v) return {};
  if (typeof v === "object") return v as Row;
  try { return JSON.parse(String(v)) as Row; } catch { return {}; }
}

// Insert-or-update of the one row a listing has in a side table. Column names
// come from this file only, never from the request.
async function upsert(tx: Tx, table: "listing_contracts" | "listing_field_verifications" | "listing_animal_profile" | "listing_shipments", listingId: number, fields: Record<string, unknown>) {
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

// The sections the console saves one at a time, and the status each one leaves
// behind. Nothing here is an "approval": a section is saved, and the listing's
// status is a consequence of what has been recorded so far.
export const SECTIONS = [
  { key: "field_verification", label: "Field verification", status_after: "verified", hint: "Visit, photos, checklist, verified weight" },
  { key: "vaccination", label: "Vaccination & health", status_after: null, hint: "Doses given, next due, vet — all optional" },
  { key: "animal_profile", label: "Animal profile", status_after: null, hint: "Feed, housing, marks, insurance — all optional" },
  { key: "contract", label: "Purchase contract", status_after: "contracted", hint: "Buyer, agreed rate and weight, advance, papers" },
  { key: "shipping", label: "Shipping", status_after: "shipped", hint: "Dispatch, vehicle, driver, arrival, documents" },
  { key: "payment", label: "Payment to farmer", status_after: "paid", hint: "Amount, method, reference" }
] as const;

// GET /api/v1/admin/sale/listing-workflow?listing_id=
export async function getListingWorkflow(listingId?: string | number | null) {
  if (!listingId) throw new Error("listing_id is required.");
  const rows = await queryRows<Row>(
    `SELECT CAST(l.id AS CHAR) AS id, l.listing_code, l.title_en, l.title_bn, l.status, l.description,
            l.age_months, l.weight_kg, l.meat_weight_kg, l.dressing_pct, l.quantity, l.unit,
            l.farmer_expected_price, l.estimated_earning, l.contact_phone, l.contact_name, l.address_text,
            l.media_json, l.ai_analysis_json, l.created_at, l.field_visit_date, l.field_visit_note,
            l.verified_weight_kg, l.verified_at, l.contracted_at, l.shipped_at,
            l.paid_at, l.paid_amount, l.payment_method, l.payment_reference,
            l.cancelled_at, l.cancel_reason, l.rejected_at, l.reject_reason,
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
  const [profile] = await queryRows<Row>("SELECT * FROM listing_animal_profile WHERE listing_id = ? LIMIT 1", [listingId]);
  const [shipment] = await queryRows<Row>("SELECT * FROM listing_shipments WHERE listing_id = ? LIMIT 1", [listingId]);
  const vaccinations = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, vaccine_name, dose_no, given_on, next_due_on, vet_name, batch_no, notes,
            document_url, created_at, updated_at
       FROM listing_vaccinations WHERE listing_id = ? ORDER BY COALESCE(given_on, created_at) DESC, id DESC`,
    [listingId]
  );
  const officers = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, name, phone, district, upazila FROM zone_officers
      WHERE is_active = 1 AND officer_role = 'field_officer' ORDER BY name`
  );
  const progress = await getListingProgress(String(listingId), null);
  const status = String(listing.status);

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
    contract: contract ? { ...contract, documents_json: docs(contract.documents_json) } : null,
    animal_profile: profile ?? null,
    shipment: shipment ? { ...shipment, documents_json: docs(shipment.documents_json) } : null,
    vaccinations,
    officers,
    steps: progress?.steps ?? [],
    photo_slots: PHOTO_SLOTS,
    checklist_items: CHECKLIST_ITEMS,
    sections: SECTIONS.map((s) => ({
      ...s,
      saved_at:
        s.key === "field_verification" ? verification?.updated_at ?? null
          : s.key === "contract" ? contract?.updated_at ?? null
          : s.key === "shipping" ? shipment?.updated_at ?? null
          : s.key === "animal_profile" ? profile?.updated_at ?? null
          : s.key === "vaccination" ? vaccinations[0]?.updated_at ?? null
          : listing.paid_at ?? null
    })),
    statuses: MANUAL_STATUSES,
    closed: status === "cancelled" || status === "rejected",
    can_cancel: !["cancelled", "rejected"].includes(status),
    // Rejection is the post-shipping outcome: the buyer refused what arrived.
    can_reject: ["shipped", "paid"].includes(status)
  };
}

// POST /api/v1/admin/sale/listing-workflow  { listing_id, action, data }
export async function saveListingWorkflow(payload: Row, adminId: unknown) {
  const listingId = Number(payload.listing_id);
  if (!listingId) throw new Error("listing_id is required.");
  const action = String(payload.action ?? "");
  const d = (payload.data ?? {}) as Row;
  // What the action ended up doing, for the notification/community step below.
  let outcome = "";

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
    // A closed listing is a record, not a workspace.
    const open = () => need(!["cancelled", "rejected"].includes(status), "This listing is closed; reopen it by setting a status before editing.");

    switch (action) {
      // --- Field verification -------------------------------------------
      // One section: schedule the visit, record the visit, or both. The result
      // decides whether the listing becomes verified.
      case "schedule_visit":
      case "save_field_verification":
      case "save_verification": {
        open();
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
        // Only the weight is insisted on, and only to pass: everything else is
        // evidence the officer adds as they get it.
        if (result === "passed") need(weight !== null && weight > 0, "Record the verified weight before marking verification passed.");
        const legs = ["good", "minor_issue", "lame", "injured"].includes(String(d.legs_condition)) ? String(d.legs_condition) : null;
        const visit = dt(d.visit_date, true) ?? (v?.visit_date ? String(v.visit_date).slice(0, 10) : null);
        await upsert(tx, "listing_field_verifications", listingId, {
          officer_id: num(d.officer_id, "Officer") ?? v?.officer_id ?? null,
          visit_date: visit,
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
          await setListing(
            "status = 'verified', verified_weight_kg = ?, verified_at = NOW(), field_visit_date = COALESCE(?, field_visit_date), field_visit_note = COALESCE(?, field_visit_note)",
            [weight, visit, text(d.health_notes, 5000)]
          );
          outcome = "verified";
        } else {
          // Anything short of a pass keeps the listing in verification; a failed
          // check is a note, not a rejection (rejection is a deliberate button).
          const wasScheduled = Boolean(v?.visit_date);
          await setListing(
            "status = IF(status IN ('draft','submitted','field_verification'), 'field_verification', status), field_visit_date = COALESCE(?, field_visit_date), field_visit_note = COALESCE(?, field_visit_note)",
            [visit, text(d.health_notes, 5000)]
          );
          if (visit && !wasScheduled) outcome = "visit_scheduled";
        }
        return;
      }

      // --- Vaccination & health ------------------------------------------
      case "save_vaccination": {
        open();
        const name = required(text(d.vaccine_name, 160), "Vaccine name");
        const fields = {
          vaccine_name: name,
          dose_no: text(d.dose_no, 40),
          given_on: dt(d.given_on, true),
          next_due_on: dt(d.next_due_on, true),
          vet_name: text(d.vet_name, 160),
          batch_no: text(d.batch_no, 80),
          notes: text(d.notes, 500),
          document_url: text(d.document_url, 500),
          recorded_by: adminId ?? null
        };
        const id = d.id ? Number(d.id) : 0;
        if (id) {
          const cols = Object.keys(fields);
          await tx.execute(
            `UPDATE listing_vaccinations SET ${cols.map((c) => `\`${c}\` = ?`).join(", ")} WHERE id = ? AND listing_id = ?`,
            [...cols.map((c) => (fields as Row)[c]), id, listingId]
          );
        } else {
          const cols = Object.keys(fields);
          await tx.execute(
            `INSERT INTO listing_vaccinations (listing_id, ${cols.map((c) => `\`${c}\``).join(", ")})
             VALUES (?, ${cols.map(() => "?").join(", ")})`,
            [listingId, ...cols.map((c) => (fields as Row)[c])]
          );
        }
        return;
      }
      case "delete_vaccination": {
        open();
        const id = required(num(d.id, "Vaccination"), "Vaccination");
        await tx.execute("DELETE FROM listing_vaccinations WHERE id = ? AND listing_id = ?", [id, listingId]);
        return;
      }

      // --- Animal profile (every field optional) ---------------------------
      case "save_animal_profile": {
        open();
        const horn = ["intact", "dehorned", "polled"].includes(String(d.horn_status)) ? String(d.horn_status) : null;
        const temperament = ["calm", "normal", "aggressive"].includes(String(d.temperament)) ? String(d.temperament) : null;
        await upsert(tx, "listing_animal_profile", listingId, {
          deworming_on: dt(d.deworming_on, true),
          last_treatment_on: dt(d.last_treatment_on, true),
          last_treatment_note: text(d.last_treatment_note, 400),
          feed_type: text(d.feed_type, 160),
          feeding_note: text(d.feeding_note, 400),
          housing_type: text(d.housing_type, 160),
          horn_status: horn,
          is_castrated: flag(d.is_castrated),
          temperament,
          colour: text(d.colour, 120),
          distinguishing_marks: text(d.distinguishing_marks, 400),
          insurance_ref: text(d.insurance_ref, 120),
          vet_name: text(d.vet_name, 160),
          vet_phone: text(d.vet_phone, 32),
          health_notes: text(d.health_notes, 5000),
          updated_by: adminId ?? null
        });
        return;
      }

      // --- Purchase contract ------------------------------------------------
      case "save_contract":
      case "accept_contract": {
        open();
        const rate = num(d.agreed_rate_per_kg, "Agreed rate");
        const weight = num(d.agreed_weight_kg, "Agreed weight") ?? (l.verified_weight_kg === null ? null : Number(l.verified_weight_kg));
        const buyer = required(text(d.buyer_name, 190), "Buyer name");
        await upsert(tx, "listing_contracts", listingId, {
          contract_ref: text(d.contract_ref, 60) ?? c?.contract_ref ?? `PC-${l.listing_code}`,
          buyer_name: buyer,
          buyer_phone: text(d.buyer_phone, 32),
          buyer_org: text(d.buyer_org, 190),
          agreed_rate_per_kg: rate,
          agreed_weight_kg: weight,
          contract_amount: num(d.contract_amount, "Contract amount")
            ?? (rate !== null && weight !== null ? Math.round(rate * Number(weight) * 100) / 100 : null),
          weight_tolerance_pct: num(d.weight_tolerance_pct, "Weight tolerance") ?? c?.weight_tolerance_pct ?? 3,
          advance_amount: num(d.advance_amount, "Advance"),
          advance_paid_at: dt(d.advance_paid_at),
          payment_terms_days: num(d.payment_terms_days, "Payment terms"),
          payment_due_at: dt(d.payment_due_at, true),
          bank_account_ref: text(d.bank_account_ref, 120),
          signed_by: text(d.signed_by, 190),
          signed_at: dt(d.signed_at),
          contract_file_url: text(d.contract_file_url, 500),
          documents_json: d.documents === undefined ? undefined : JSON.stringify(docs(d.documents)),
          notes: text(d.notes, 5000),
          accepted_at: c?.accepted_at ? undefined : NOW
        });
        // A contract exists, so the listing is contracted — unless it has
        // already moved further down the line.
        if (!["shipped", "paid"].includes(status)) {
          await setListing("status = 'contracted', contracted_at = COALESCE(contracted_at, NOW())", []);
          outcome = "contracted";
        }
        return;
      }

      // --- Shipping -----------------------------------------------------------
      case "save_shipping":
      case "dispatch": {
        open();
        need(Boolean(c?.buyer_name) || Boolean(d.allow_without_contract), "Record the purchase contract before shipping.");
        await upsert(tx, "listing_shipments", listingId, {
          dispatched_at: dt(d.dispatched_at) ?? NOW,
          vehicle_type: text(d.vehicle_type, 80),
          vehicle_ref: text(d.vehicle_ref, 80),
          driver_name: text(d.driver_name, 160),
          driver_phone: text(d.driver_phone, 32),
          transporter: text(d.transporter, 190),
          from_address: text(d.from_address, 400),
          to_address: text(d.to_address, 400),
          expected_arrival_at: dt(d.expected_arrival_at),
          arrived_at: dt(d.arrived_at),
          loading_weight_kg: num(d.loading_weight_kg, "Loading weight"),
          condition_note: text(d.condition_note, 5000),
          documents_json: d.documents === undefined ? undefined : JSON.stringify(docs(d.documents)),
          updated_by: adminId ?? null
        });
        // Keep the older contract-side dispatch columns in step for the
        // post-sale reports that already read them.
        await upsert(tx, "listing_contracts", listingId, {
          dispatched_at: dt(d.dispatched_at) ?? NOW,
          vehicle_ref: text(d.vehicle_ref, 80),
          driver_phone: text(d.driver_phone, 32),
          digital_record_ref: text(d.digital_record_ref, 80) ?? c?.digital_record_ref ?? `${l.listing_code}${v?.tag_number ? `/${v.tag_number}` : ""}`
        });
        if (status !== "paid") {
          await setListing("status = 'shipped', shipped_at = COALESCE(shipped_at, NOW())", []);
          outcome = "shipped";
        }
        return;
      }

      // --- Post-sale detail kept from the older flow -------------------------
      case "handover": {
        open();
        await upsert(tx, "listing_contracts", listingId, {
          advance_paid_at: dt(d.advance_paid_at) ?? NOW,
          handover_at: dt(d.handover_at) ?? NOW,
          handover_signed_by: text(d.handover_signed_by, 190),
          handover_note: text(d.handover_note, 5000)
        });
        return;
      }
      case "receive": {
        open();
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
        await upsert(tx, "listing_shipments", listingId, { arrived_at: dt(d.received_at) ?? NOW });
        return;
      }
      case "invoice": {
        open();
        const amount = num(d.invoice_amount, "Invoice amount")
          ?? Math.round(Number(c?.received_weight_kg ?? 0) * Number(c?.agreed_rate_per_kg ?? 0) * 100) / 100;
        await upsert(tx, "listing_contracts", listingId, {
          invoice_no: text(d.invoice_no, 60) ?? c?.invoice_no ?? `INV-${l.listing_code}`,
          invoice_amount: amount,
          invoiced_at: dt(d.invoiced_at) ?? NOW,
          payment_due_at: dt(d.payment_due_at, true)
        });
        await tx.execute(
          `UPDATE listing_contracts SET payment_due_at = DATE_ADD(DATE(invoiced_at), INTERVAL COALESCE(payment_terms_days, 0) DAY)
            WHERE listing_id = ? AND payment_due_at IS NULL`,
          [listingId]
        );
        return;
      }
      case "collect": {
        open();
        await upsert(tx, "listing_contracts", listingId, {
          collected_at: dt(d.collected_at) ?? NOW,
          collected_amount: required(num(d.collected_amount, "Collected amount"), "Collected amount"),
          bank_account_ref: text(d.bank_account_ref, 120),
          collection_reference: text(d.collection_reference, 120)
        });
        return;
      }

      // --- Payment to the farmer ---------------------------------------------
      case "save_payment":
      case "pay_farmer": {
        open();
        const method = ["cash", "cheque", "bank_transfer", "bkash", "nagad"].includes(String(d.payment_method)) ? String(d.payment_method) : null;
        await setListing("status = 'paid', paid_at = COALESCE(?, NOW()), paid_amount = ?, payment_method = ?, payment_reference = ?", [
          dt(d.paid_at),
          required(num(d.paid_amount, "Paid amount"), "Paid amount"),
          required(method, "Payment method"),
          text(d.payment_reference, 80)
        ]);
        outcome = "paid";
        return;
      }

      // --- Closing a listing ---------------------------------------------------
      case "cancel_listing": {
        need(!["cancelled", "rejected"].includes(status), "This listing is already closed.");
        await setListing("status = 'cancelled', cancelled_at = NOW(), cancel_reason = ?", [text(d.reason, 400)]);
        outcome = "cancelled";
        return;
      }
      case "reject_listing": {
        need(["shipped", "paid"].includes(status), "A listing can only be rejected once it has been shipped.");
        await setListing("status = 'rejected', rejected_at = NOW(), reject_reason = ?", [text(d.reason, 400)]);
        outcome = "rejected";
        return;
      }

      // --- Manual correction ----------------------------------------------
      case "set_status": {
        const next = String(d.status ?? "");
        need(MANUAL_STATUSES.includes(next), "Unknown status.");
        // Reopening a closed listing must not leave last week's cancellation
        // reason on the row — the app would still show it as closed.
        if (next === "cancelled" || next === "rejected") {
          await setListing("status = ?", [next]);
        } else {
          await setListing("status = ?, cancelled_at = NULL, cancel_reason = NULL, rejected_at = NULL, reject_reason = NULL", [next]);
        }
        return;
      }
      default:
        throw new Error(`Unknown action "${action}".`);
    }
  });

  // Tell the farmer what just happened, and put the milestones the community
  // cares about on the feed. Neither may break the save that already committed.
  const EVENT: Record<string, string> = {
    visit_scheduled: "listing_visit_scheduled",
    verified: "listing_verified",
    contracted: "listing_contracted",
    shipped: "listing_shipped",
    paid: "listing_paid",
    cancelled: "listing_cancelled",
    rejected: "listing_cancelled"
  };
  const event = EVENT[outcome];
  if (event) {
    try {
      await notifyListing(listingId, event, listingEventVars(outcome, d));
    } catch {
      /* delivery is best-effort */
    }
  }
  if (outcome === "verified") await postListingMilestone(listingId, "verified");
  if (outcome === "paid") await postListingMilestone(listingId, "paid");

  return getListingWorkflow(listingId);
}

const METHOD: Record<string, [string, string]> = {
  cash: ["cash", "নগদ"], cheque: ["cheque", "চেক"], bank_transfer: ["bank transfer", "ব্যাংক ট্রান্সফার"], bkash: ["bKash", "বিকাশ"], nagad: ["Nagad", "নগদ (মোবাইল)"]
};

function listingEventVars(outcome: string, d: Row): Vars {
  if (outcome === "visit_scheduled" && d.visit_date) {
    const date = new Date(`${String(d.visit_date).slice(0, 10)}T00:00:00`);
    const opts = { day: "numeric", month: "long", year: "numeric" } as const;
    return { visit_date: { en: date.toLocaleDateString("en-GB", opts), bn: date.toLocaleDateString("bn-BD", opts) } };
  }
  if (outcome === "contracted") {
    const advance = Number(d.advance_amount ?? 0);
    return {
      buyer: String(d.buyer_org || d.buyer_name || ""),
      rate: Number(d.agreed_rate_per_kg ?? 0),
      advance: advance > 0 ? { en: ` An advance of ৳${advance.toLocaleString("en-IN")} is on its way.`, bn: ` ৳${advance.toLocaleString("en-IN")} অগ্রিম পাঠানো হচ্ছে।` } : ""
    };
  }
  if (outcome === "paid") {
    const [en, bn] = METHOD[String(d.payment_method)] ?? [String(d.payment_method ?? ""), String(d.payment_method ?? "")];
    return { amount: Number(d.paid_amount ?? 0), method: { en, bn }, reference: String(d.payment_reference || "—") };
  }
  if (outcome === "verified") return { weight: Number(d.verified_weight_kg ?? 0) };
  if (outcome === "cancelled" || outcome === "rejected") return reasonVars(d.reason);
  return {};
}
