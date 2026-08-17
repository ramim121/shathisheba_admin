// The Loan Application Workspace — SRS §18, ADM-LON-13…20.
//
// Reads everything an officer needs about one application, and takes the writes
// back. The scorecard in lib/finance/scorecard-engine.ts reads exactly what this
// file writes; if the two ever disagree about a field key, the criterion silently
// rates 0, so the key list lives here in one place and the engine's loader reads
// the same names.
//
// Two rules hold across every write:
//
//   * Every save carries evidence metadata (ADM-LON-13). The generic upsert takes
//     source type and verification status alongside the value, because a number
//     with no provenance is a number the scorecard cannot weigh honestly.
//   * Every save is audited (ADM-LON-15), with the previous value, because "who
//     changed the income figure after the field visit" is the first question
//     anyone asks when an assessment looks wrong.

import { executeQuery, queryRows, withTransaction, type Tx } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import type { Row } from "./shared";

// Table names in these statements come from ROW_SPECS below, never from a
// request. Column names are filtered against the same allow-list. Values are
// always bound — nothing user-supplied is ever concatenated into SQL.
const executeScoped = executeQuery;

// The evidence keys the scorecard actually reads. Anything not on this list is
// still storable — the workspace captures more than the model uses — but these
// are the ones whose names must not drift.
export const SCORED_FIELDS = [
  { section: "financial", key: "monthly_income_total", numeric: true },
  { section: "financial", key: "monthly_expense_total", numeric: true },
  { section: "financial", key: "proposed_installment", numeric: true },
  { section: "financial", key: "debt_section_complete", numeric: false },
  { section: "enterprise", key: "years_experience", numeric: true },
  { section: "mpoweru", key: "normalised_score", numeric: true },
  { section: "request", key: "purpose_prohibited", numeric: false },
] as const;

const SECTIONS = new Set([
  "kyc", "address", "enterprise", "financial", "market", "request", "mpoweru",
]);

const SOURCE_TYPES = new Set([
  "self_reported", "field_observed", "document", "cooperative", "transaction",
]);

const VERIFICATION_STATUSES = new Set([
  "unverified", "verified", "partially_verified", "unable_to_verify", "contradictory",
]);

const VERDICTS = new Set([
  "verified", "partially_verified", "self_reported_only", "unable_to_verify", "contradictory",
]);

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getLoanWorkspace(applicationId: string) {
  const id = Number(applicationId);
  if (!Number.isFinite(id)) throw new Error("A numeric application_id is required.");

  const apps = await queryRows<Row>(
    `SELECT a.id, a.application_code, a.user_id, a.status, a.requested_amount,
            a.recommended_amount, a.purpose_code, a.tenure_months, a.repayment_mode,
            a.district, a.upazila, a.manual_review_required, a.manual_review_reason,
            a.current_assessment_id, a.created_at,
            u.full_name, u.phone, u.is_kyc_verified, u.nid_number,
            p.name_en AS product_name, p.code AS product_code
     FROM loan_applications a
     JOIN app_users u ON u.id = a.user_id
     JOIN loan_products p ON p.id = a.loan_product_id
     WHERE a.id = ?`,
    [id]
  );
  const application = apps[0];
  if (!application) throw new Error("Application not found.");

  // NID is masked here. The workspace is a working screen an officer keeps open
  // beside a farmer; the full number belongs on the one audited view, not on
  // every glance (SEC-18 direction, even though encryption at rest is deferred).
  const nid = application.nid_number ? String(application.nid_number) : null;
  application.nid_number = nid ? `•••• •••• ${nid.slice(-4)}` : null;

  const [evidence, assets, debts, verifications, documents, safeguards, events, visits] =
    await Promise.all([
      queryRows<Row>(
        `SELECT section, field_key, value_text, value_number, source_type,
                verification_status, confidence, discrepancy_note, is_material,
                collected_at, verified_at
         FROM loan_evidence WHERE application_id = ? ORDER BY section, field_key`,
        [id]
      ),
      queryRows<Row>(
        `SELECT id, asset_type, description, quantity, unit, estimated_value,
                ownership_status, verification_status, note
         FROM loan_assets WHERE application_id = ? ORDER BY id`,
        [id]
      ),
      queryRows<Row>(
        `SELECT id, lender_name, lender_type, loan_type, original_amount, outstanding_amount,
                installment_amount, installment_freq, remaining_tenure_months,
                payment_status, late_payments_12m, was_rescheduled, had_default,
                verification_status, note
         FROM loan_existing_debts WHERE application_id = ? ORDER BY id`,
        [id]
      ),
      queryRows<Row>(
        `SELECT i.code, i.label_bn, i.label_en, i.sort_order,
                v.verdict, v.comment, v.verified_at, v.reverify_requested
         FROM loan_verification_items i
         LEFT JOIN loan_field_verifications v
                ON v.item_code = i.code AND v.application_id = ?
         WHERE i.is_active = 1
         ORDER BY i.sort_order`,
        [id]
      ),
      queryRows<Row>(
        `SELECT id, doc_type, file_key, status, rejection_reason, expires_on, is_required, verified_at
         FROM loan_documents WHERE application_id = ? ORDER BY is_required DESC, doc_type`,
        [id]
      ),
      queryRows<Row>(
        "SELECT id, safeguard_type, detail, is_confirmed FROM loan_safeguards WHERE application_id = ? ORDER BY id",
        [id]
      ),
      queryRows<Row>(
        `SELECT from_status, to_status, actor_type, actor_name, note_bn, note_en, created_at
         FROM loan_application_events WHERE application_id = ? ORDER BY created_at DESC LIMIT 50`,
        [id]
      ),
      queryRows<Row>(
        "SELECT id, proposed_at, status, confirmed_at, completed_at, note FROM loan_field_visits WHERE application_id = ? ORDER BY proposed_at DESC",
        [id]
      ),
    ]);

  const materialTotal = evidence.filter((e) => Number(e.is_material) === 1).length;
  const materialVerified = evidence.filter(
    (e) => Number(e.is_material) === 1 && e.verification_status === "verified"
  ).length;

  // The requirement checklist (§18.2). What the analyst is blocked on, computed
  // rather than remembered — a checklist someone has to keep in their head is a
  // checklist that gets skipped on the busy day.
  const consents = await queryRows<Row>(
    "SELECT COUNT(*) AS n FROM loan_consents WHERE application_id = ? AND status = 'granted'",
    [id]
  );
  const verifiedItems = verifications.filter((v) => v.verdict === "verified").length;
  const contradictory = verifications.filter((v) => v.verdict === "contradictory").length;
  const requiredDocs = documents.filter((d) => Number(d.is_required) === 1);
  const scoredPresent = SCORED_FIELDS.filter((f) =>
    evidence.some((e) => e.section === f.section && e.field_key === f.key)
  ).length;

  const checklist = [
    { key: "identity", label: "Identity verified", done: Number(application.is_kyc_verified) === 1, blocking: true },
    { key: "consents", label: "Six required consents granted", done: Number(consents[0]?.n ?? 0) >= 6, blocking: true },
    { key: "financials", label: "Financial profile captured", done: scoredPresent >= 3, blocking: true },
    { key: "debt", label: "Existing debt section completed", done: debts.length > 0 || evidence.some((e) => e.field_key === "debt_section_complete"), blocking: true },
    { key: "documents", label: "Required documents verified", done: requiredDocs.length > 0 && requiredDocs.every((d) => d.status === "verified"), blocking: false },
    { key: "field", label: "Field verification complete", done: verifications.length > 0 && verifiedItems === verifications.length, blocking: false },
    { key: "mpoweru", label: "Behavioural assessment complete", done: evidence.some((e) => e.section === "mpoweru" && e.field_key === "normalised_score"), blocking: false },
    // ADM-LON-19. A single contradictory verdict blocks progression outright.
    { key: "no_contradiction", label: "No contradictory findings", done: contradictory === 0, blocking: true },
  ];

  return {
    application,
    checklist,
    ready_to_score: checklist.filter((c) => c.blocking).every((c) => c.done),
    evidence,
    assets,
    debts,
    verifications,
    documents,
    safeguards,
    visits,
    events,
    coverage: {
      material_fields_total: materialTotal,
      material_fields_verified: materialVerified,
      verified_pct: materialTotal ? Math.round((materialVerified / materialTotal) * 10000) / 100 : 0,
      verification_items_total: verifications.length,
      verification_items_verified: verifiedItems,
      contradictory_count: contradictory,
      scored_fields_present: scoredPresent,
      scored_fields_total: SCORED_FIELDS.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

type SaveContext = { adminId: number | null; ip?: string | null; userAgent?: string | null };

/**
 * Upsert a batch of evidence fields. Batched on purpose: an officer fills a
 * section and saves it, and a partial save that lands half a financial profile
 * would be scored as though the other half were absent.
 */
export async function saveLoanEvidence(payload: Record<string, unknown>, ctx: SaveContext) {
  const applicationId = Number(payload.application_id);
  if (!Number.isFinite(applicationId)) throw new Error("A numeric application_id is required.");

  const fields = Array.isArray(payload.fields) ? (payload.fields as Record<string, unknown>[]) : [];
  if (fields.length === 0) throw new Error("No fields were provided.");
  if (fields.length > 200) throw new Error("Too many fields in one save (limit 200).");

  for (const f of fields) {
    const section = String(f.section ?? "");
    if (!SECTIONS.has(section)) throw new Error(`Unknown section "${section}".`);
    if (!String(f.field_key ?? "").trim()) throw new Error("Every field needs a field_key.");
    if (f.source_type != null && !SOURCE_TYPES.has(String(f.source_type))) {
      throw new Error(`Unknown source_type "${f.source_type}".`);
    }
    if (f.verification_status != null && !VERIFICATION_STATUSES.has(String(f.verification_status))) {
      throw new Error(`Unknown verification_status "${f.verification_status}".`);
    }
  }

  const before = await queryRows<Row>(
    "SELECT section, field_key, value_text, value_number, verification_status FROM loan_evidence WHERE application_id = ?",
    [applicationId]
  );

  const saved = await withTransaction(async (tx: Tx) => {
    for (const f of fields) {
      const numeric = f.value_number == null || f.value_number === "" ? null : Number(f.value_number);
      if (numeric != null && !Number.isFinite(numeric)) {
        throw new Error(`Field "${f.field_key}" has a non-numeric value_number.`);
      }
      await tx.execute(
        `INSERT INTO loan_evidence
           (application_id, section, field_key, value_text, value_number, source_type,
            source_reference, verification_status, verified_by, collected_at, verified_at,
            confidence, discrepancy_note, is_material)
         VALUES (?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?)
         ON DUPLICATE KEY UPDATE
           value_text = VALUES(value_text),
           value_number = VALUES(value_number),
           source_type = VALUES(source_type),
           source_reference = VALUES(source_reference),
           verification_status = VALUES(verification_status),
           verified_by = VALUES(verified_by),
           verified_at = VALUES(verified_at),
           confidence = VALUES(confidence),
           discrepancy_note = VALUES(discrepancy_note),
           is_material = VALUES(is_material)`,
        [
          applicationId,
          String(f.section),
          String(f.field_key),
          f.value_text == null ? null : String(f.value_text),
          numeric,
          String(f.source_type ?? "self_reported"),
          f.source_reference == null ? null : String(f.source_reference),
          String(f.verification_status ?? "unverified"),
          f.verification_status === "verified" ? ctx.adminId : null,
          f.verification_status === "verified" ? new Date() : null,
          String(f.confidence ?? "low"),
          f.discrepancy_note == null ? null : String(f.discrepancy_note),
          f.is_material === false ? 0 : 1,
        ]
      );
    }
    return fields.length;
  });

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: "loan.evidence.save",
    entityType: "loan_evidence",
    entityId: applicationId,
    before,
    after: fields,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { application_id: applicationId, saved };
}

/**
 * Record field-verification verdicts. ADM-LON-19: a `contradictory` verdict on
 * any item raises mandatory manual review on the application and blocks
 * automatic progression — set here rather than left to the caller, because a
 * rule the caller has to remember is a rule that holds until someone is busy.
 */
export async function saveFieldVerification(payload: Record<string, unknown>, ctx: SaveContext) {
  const applicationId = Number(payload.application_id);
  if (!Number.isFinite(applicationId)) throw new Error("A numeric application_id is required.");

  const items = Array.isArray(payload.items) ? (payload.items as Record<string, unknown>[]) : [];
  if (items.length === 0) throw new Error("No verification items were provided.");

  const known = new Set(
    (await queryRows<Row>("SELECT code FROM loan_verification_items WHERE is_active = 1")).map((r) => String(r.code))
  );
  for (const item of items) {
    const code = String(item.item_code ?? "");
    if (!known.has(code)) throw new Error(`Unknown verification item "${code}".`);
    if (!VERDICTS.has(String(item.verdict ?? ""))) throw new Error(`Unknown verdict "${item.verdict}".`);
  }

  const before = await queryRows<Row>(
    "SELECT item_code, verdict FROM loan_field_verifications WHERE application_id = ?",
    [applicationId]
  );

  const result = await withTransaction(async (tx: Tx) => {
    for (const item of items) {
      await tx.execute(
        `INSERT INTO loan_field_verifications
           (application_id, item_code, verdict, comment, photo_url, document_url,
            gps_lat, gps_lng, verified_by, verified_at)
         VALUES (?,?,?,?,?,?,?,?,?,NOW())
         ON DUPLICATE KEY UPDATE
           verdict = VALUES(verdict), comment = VALUES(comment),
           photo_url = VALUES(photo_url), document_url = VALUES(document_url),
           gps_lat = VALUES(gps_lat), gps_lng = VALUES(gps_lng),
           verified_by = VALUES(verified_by), verified_at = VALUES(verified_at)`,
        [
          applicationId,
          String(item.item_code),
          String(item.verdict),
          item.comment == null ? null : String(item.comment),
          item.photo_url == null ? null : String(item.photo_url),
          item.document_url == null ? null : String(item.document_url),
          item.gps_lat == null ? null : Number(item.gps_lat),
          item.gps_lng == null ? null : Number(item.gps_lng),
          ctx.adminId,
        ]
      );
    }

    const contradictory = await tx.query<Row>(
      "SELECT COUNT(*) AS n FROM loan_field_verifications WHERE application_id = ? AND verdict = 'contradictory'",
      [applicationId]
    );
    const flagged = Number(contradictory[0]?.n ?? 0) > 0;

    await tx.execute(
      "UPDATE loan_applications SET manual_review_required = ?, manual_review_reason = ? WHERE id = ?",
      [
        flagged ? 1 : 0,
        flagged ? "A field verification item was recorded as contradictory." : null,
        applicationId,
      ]
    );

    return { saved: items.length, manual_review_required: flagged };
  });

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: "loan.verification.save",
    entityType: "loan_field_verifications",
    entityId: applicationId,
    before,
    after: items,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Repeating collections (§18.3.7, §18.3.9, §18.3.5, §18.4)
//
// These are rows rather than fields, so they get their own tables and their own
// editors. One generic handler rather than four near-identical ones: the shape
// differs, the rules — belongs to this application, validated enum, audited,
// delete is by id and scoped — do not.
// ---------------------------------------------------------------------------

type RowSpec = {
  table: string;
  /** Columns an officer may write. Anything else in the payload is ignored. */
  fields: string[];
  /** Enum columns and their permitted values, checked before the write. */
  enums?: Record<string, string[]>;
  required?: string[];
  numeric?: string[];
};

const ROW_SPECS: Record<string, RowSpec> = {
  assets: {
    table: "loan_assets",
    fields: ["asset_type", "description", "quantity", "unit", "estimated_value",
             "ownership_status", "verification_status", "evidence_url", "photo_url",
             "gps_lat", "gps_lng", "note"],
    enums: {
      asset_type: ["land", "cattle", "shed", "machinery", "equipment", "inventory", "premises", "other"],
      ownership_status: ["owned", "leased", "shared", "mortgaged", "disputed", "unknown"],
      verification_status: [...VERIFICATION_STATUSES],
    },
    required: ["asset_type"],
    numeric: ["quantity", "estimated_value", "gps_lat", "gps_lng"],
  },
  debts: {
    table: "loan_existing_debts",
    fields: ["lender_name", "lender_type", "loan_type", "original_amount", "outstanding_amount",
             "installment_amount", "installment_freq", "remaining_tenure_months", "payment_status",
             "late_payments_12m", "was_rescheduled", "had_default", "verification_status", "note"],
    enums: {
      lender_type: ["bank", "mfi", "cooperative", "supplier", "informal", "family", "other"],
      installment_freq: ["weekly", "biweekly", "monthly", "quarterly", "seasonal", "one_time"],
      payment_status: ["current", "1_30_late", "31_60_late", "61_90_late", "over_90_late", "rescheduled", "defaulted"],
      verification_status: [...VERIFICATION_STATUSES],
    },
    required: ["lender_name"],
    numeric: ["original_amount", "outstanding_amount", "installment_amount", "remaining_tenure_months", "late_payments_12m"],
  },
  documents: {
    table: "loan_documents",
    fields: ["doc_type", "file_key", "status", "rejection_reason", "expires_on", "is_required"],
    enums: { status: ["uploaded", "verified", "rejected", "expired", "re_requested"] },
    required: ["doc_type", "file_key"],
  },
  visits: {
    table: "loan_field_visits",
    fields: ["officer_id", "proposed_at", "status", "confirmed_at", "completed_at", "gps_lat", "gps_lng", "note"],
    enums: { status: ["proposed", "confirmed", "declined", "completed", "cancelled"] },
    required: ["proposed_at"],
    numeric: ["gps_lat", "gps_lng"],
  },
};

export function isRowCollection(name: string) {
  return Object.hasOwn(ROW_SPECS, name);
}

export async function saveWorkspaceRow(
  collection: string,
  payload: Record<string, unknown>,
  ctx: SaveContext
) {
  const spec = ROW_SPECS[collection];
  if (!spec) throw new Error(`Unknown collection "${collection}".`);

  const applicationId = Number(payload.application_id);
  if (!Number.isFinite(applicationId)) throw new Error("A numeric application_id is required.");

  const rowId = payload.id == null || payload.id === "" ? null : Number(payload.id);
  if (rowId != null && !Number.isFinite(rowId)) throw new Error("id must be numeric.");

  // Deletes are scoped by application as well as id, so a guessed id from another
  // applicant's file cannot be removed through this endpoint.
  if (payload.delete === true) {
    if (rowId == null) throw new Error("An id is required to delete.");
    const before = await queryRows<Row>(
      `SELECT * FROM ${spec.table} WHERE id = ? AND application_id = ?`,
      [rowId, applicationId]
    );
    if (before.length === 0) throw new Error("That row does not belong to this application.");
    await executeScoped(`DELETE FROM ${spec.table} WHERE id = ? AND application_id = ?`, [rowId, applicationId]);
    await recordAudit({
      actorAdminId: ctx.adminId, action: `loan.${collection}.delete`,
      entityType: spec.table, entityId: rowId, before: before[0],
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return { collection, deleted: rowId };
  }

  const data: Record<string, unknown> = {};
  for (const field of spec.fields) {
    if (!(field in payload)) continue;
    let value = payload[field];
    if (value === "") value = null;

    if (value != null && spec.enums?.[field] && !spec.enums[field].includes(String(value))) {
      throw new Error(`"${value}" is not a valid ${field.replace(/_/g, " ")}.`);
    }
    if (value != null && spec.numeric?.includes(field)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${field.replace(/_/g, " ")} must be a number.`);
      value = n;
    }
    data[field] = value;
  }

  for (const field of spec.required ?? []) {
    if (rowId == null && (data[field] == null || data[field] === "")) {
      throw new Error(`${field.replace(/_/g, " ")} is required.`);
    }
  }
  if (Object.keys(data).length === 0) throw new Error("Nothing to save.");

  let savedId = rowId;
  let before: Row | null = null;

  if (rowId == null) {
    const columns = ["application_id", ...Object.keys(data)];
    const result = await executeScoped(
      `INSERT INTO ${spec.table} (${columns.map((c) => `\`${c}\``).join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})`,
      [applicationId, ...Object.values(data)]
    );
    savedId = Number(result.insertId);
  } else {
    const existing = await queryRows<Row>(
      `SELECT * FROM ${spec.table} WHERE id = ? AND application_id = ?`,
      [rowId, applicationId]
    );
    if (existing.length === 0) throw new Error("That row does not belong to this application.");
    before = existing[0];
    await executeScoped(
      `UPDATE ${spec.table} SET ${Object.keys(data).map((c) => `\`${c}\` = ?`).join(", ")}
       WHERE id = ? AND application_id = ?`,
      [...Object.values(data), rowId, applicationId]
    );
  }

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: `loan.${collection}.save`,
    entityType: spec.table,
    entityId: savedId,
    before,
    after: data,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { collection, id: savedId };
}

/** Assign development-plan tasks from templates or ad hoc (§18.3.15). */
export async function assignDevelopmentTasks(payload: Record<string, unknown>, ctx: SaveContext) {
  const applicationId = Number(payload.application_id);
  if (!Number.isFinite(applicationId)) throw new Error("A numeric application_id is required.");

  const codes = Array.isArray(payload.template_codes) ? payload.template_codes.map(String) : [];
  if (codes.length === 0) throw new Error("Choose at least one task.");

  const app = (await queryRows<Row>("SELECT user_id, current_assessment_id FROM loan_applications WHERE id = ?", [applicationId]))[0];
  if (!app) throw new Error("Application not found.");

  const templates = await queryRows<Row>(
    `SELECT code, title_bn, title_en, detail_bn, detail_en, action_deeplink, default_days, sort_order
     FROM development_plan_templates
     WHERE code IN (${codes.map(() => "?").join(",")}) AND is_active = 1`,
    codes
  );
  if (templates.length === 0) throw new Error("None of those tasks exist.");

  const assigned = await withTransaction(async (tx: Tx) => {
    for (const t of templates) {
      await tx.execute(
        `INSERT INTO development_plan_tasks
           (application_id, user_id, assessment_id, template_code, title_bn, title_en,
            detail_bn, detail_en, action_deeplink, due_on, status, sort_order)
         VALUES (?,?,?,?,?,?,?,?,?, DATE_ADD(CURDATE(), INTERVAL ? DAY), 'assigned', ?)`,
        [
          applicationId, app.user_id, app.current_assessment_id, t.code,
          t.title_bn, t.title_en, t.detail_bn, t.detail_en, t.action_deeplink,
          Number(t.default_days ?? 30), Number(t.sort_order ?? 0),
        ]
      );
    }
    return templates.length;
  });

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: "loan.development_plan.assign",
    entityType: "development_plan_tasks",
    entityId: applicationId,
    after: { codes },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { application_id: applicationId, assigned };
}
