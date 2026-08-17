// Lender decision-support packs and submissions — SRS §20.1, ADM-LON-26…30.
//
// Three rules shape this file:
//
//   * **Consent is checked at submission, every time** (ADM-LON-30). Not at
//     application, not cached on the row — read from `loan_consents` at the
//     moment of sharing, because consent can be revoked between the two.
//
//   * **Tenant isolation** (ADM-LON-28). A lender sees their own submissions and
//     nothing else. Every pack view and export is appended to
//     `lender_pack_access` before the data is returned, so a leak is
//     reconstructable even if nobody noticed at the time.
//
//   * **A decline is structured** (ADM-LON-29). Free text cannot be learned from.
//     The code feeds the model; the text is for the human reading the file.
//
// On format (ADM-LON-27): the pack is produced as CSV and as a self-contained
// printable HTML document rather than a binary PDF. Rendering Bangla in a
// generated PDF needs an embedded OpenType font with the right shaping tables —
// several megabytes in the bundle, and a class of silent failure where text
// renders as boxes only for the people who read Bangla. Printing the HTML from a
// browser uses the system's own Bangla font and is correct by construction. The
// trade-off is recorded in OPEN-ISSUES rather than hidden here.

import { queryRows, withTransaction, type Tx } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import type { Row } from "./shared";

type Ctx = { adminId: number | null; ip?: string | null; userAgent?: string | null };

export const LENDER_ROLES = ["super_admin", "hq_admin", "credit_approver", "credit_analyst"];

const SUBMISSION_STATUSES = [
  "prepared", "submitted", "under_review", "info_requested", "approved", "declined", "withdrawn",
] as const;

/**
 * Which transitions are legal. A decline that can be flipped back to "under
 * review" by a stray click is a decline nobody can rely on, and `approved` and
 * `declined` are terminal for exactly that reason — a change of mind is a new
 * submission, which leaves both decisions on the record.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  prepared: ["submitted", "withdrawn"],
  submitted: ["under_review", "info_requested", "approved", "declined", "withdrawn"],
  under_review: ["info_requested", "approved", "declined", "withdrawn"],
  info_requested: ["under_review", "submitted", "approved", "declined", "withdrawn"],
  approved: [],
  declined: [],
  withdrawn: [],
};

const money = (v: unknown) => (v == null ? null : Number(v));
const parseJson = <T,>(v: unknown, fallback: T): T => {
  if (v == null) return fallback;
  if (typeof v === "object") return v as T;
  try { return JSON.parse(String(v)) as T; } catch { return fallback; }
};

// ---------------------------------------------------------------------------
// The pack (ADM-LON-26)
// ---------------------------------------------------------------------------

export async function buildLenderPack(applicationId: string, ctx: Ctx & { lenderId?: number | null; action?: "view" | "export_csv" | "export_pdf" }) {
  const id = Number(applicationId);
  if (!Number.isFinite(id)) throw new Error("A numeric application_id is required.");

  const apps = await queryRows<Row>(
    `SELECT a.id, a.application_code, a.user_id, a.status, a.requested_amount,
            a.recommended_amount, a.approved_amount, a.purpose_code, a.purpose_text,
            a.tenure_months, a.repayment_mode, a.district, a.upazila, a.created_at,
            u.full_name, u.phone, u.district AS home_district, u.is_kyc_verified, u.nid_number,
            p.name_en AS product_name, p.interest_rate_annual, p.interest_method
     FROM loan_applications a
     JOIN app_users u ON u.id = a.user_id
     JOIN loan_products p ON p.id = a.loan_product_id
     WHERE a.id = ?`,
    [id]
  );
  const app = apps[0];
  if (!app) throw new Error("Application not found.");

  const nid = app.nid_number ? String(app.nid_number) : null;

  const [assessment] = await queryRows<Row>(
    `SELECT total_score, grade, readiness_status, data_confidence, hard_stop,
            hard_stop_codes_json, primary_pathway, reason_codes_json, inherent_grade,
            structured_readiness, recommended_amount, verified_field_pct,
            scorecard_model_version, sequence_no, created_at
     FROM credit_assessments
     WHERE application_id = ? AND is_shadow = 0 AND status <> 'superseded'
     ORDER BY sequence_no DESC LIMIT 1`,
    [id]
  );

  const [criteria, debts, assets, verifications, documents, safeguards, mpoweru, evidence, account] =
    await Promise.all([
      assessment
        ? queryRows<Row>(
            `SELECT cac.criterion_code, cac.weight, cac.effective_rating, cac.weighted_score, cac.had_data
             FROM credit_assessment_criteria cac
             JOIN credit_assessments ca ON ca.id = cac.assessment_id
             WHERE ca.application_id = ? AND ca.is_shadow = 0 AND ca.status <> 'superseded'
             ORDER BY cac.weight DESC`,
            [id]
          )
        : Promise.resolve([]),
      queryRows<Row>(
        `SELECT lender_name, lender_type, outstanding_amount, installment_amount,
                installment_freq, payment_status, verification_status
         FROM loan_existing_debts WHERE application_id = ? ORDER BY outstanding_amount DESC`,
        [id]
      ),
      queryRows<Row>(
        `SELECT asset_type, description, quantity, unit, estimated_value, ownership_status, verification_status
         FROM loan_assets WHERE application_id = ? ORDER BY estimated_value DESC`,
        [id]
      ),
      queryRows<Row>(
        `SELECT i.label_en, v.verdict FROM loan_verification_items i
         LEFT JOIN loan_field_verifications v ON v.item_code = i.code AND v.application_id = ?
         WHERE i.is_active = 1 ORDER BY i.sort_order`,
        [id]
      ),
      queryRows<Row>(
        "SELECT doc_type, status, is_required FROM loan_documents WHERE application_id = ? ORDER BY is_required DESC, doc_type",
        [id]
      ),
      queryRows<Row>(
        "SELECT safeguard_type, detail, is_confirmed FROM loan_safeguards WHERE application_id = ?",
        [id]
      ),
      // Band only. Factor-level output is never exported to a lender unless the
      // EcoDev contract explicitly permits it (ADM-LON-24 / BLU §7.1).
      queryRows<Row>(
        `SELECT status, band, normalised_score, model_version, is_stub
         FROM mpoweru_sessions WHERE application_id = ? ORDER BY id DESC LIMIT 1`,
        [id]
      ),
      queryRows<Row>(
        "SELECT section, field_key, value_number, verification_status FROM loan_evidence WHERE application_id = ?",
        [id]
      ),
      queryRows<Row>(
        `SELECT principal, total_payable, amount_paid, outstanding_total, days_past_due, status
         FROM loan_accounts WHERE application_id = ? LIMIT 1`,
        [id]
      ),
    ]);

  const reasonCodes = parseJson<string[]>(assessment?.reason_codes_json, []);
  const reasons = reasonCodes.length
    ? await queryRows<Row>(
        `SELECT code, polarity, label_en, label_bn FROM credit_reason_codes
         WHERE code IN (${reasonCodes.map(() => "?").join(",")}) ORDER BY sort_order`,
        reasonCodes
      )
    : [];

  const fin = (key: string) =>
    money(evidence.find((e) => e.section === "financial" && e.field_key === key)?.value_number);

  const income = fin("monthly_income_total");
  const expense = fin("monthly_expense_total");
  const installment = fin("proposed_installment");

  // Appended before the data is returned, so a pack that was read is on the
  // record even if the request then failed on the way out.
  await queryRows(
    `INSERT INTO lender_pack_access (application_id, lender_id, admin_user_id, action, ip_address)
     VALUES (?,?,?,?,?)`,
    [id, ctx.lenderId ?? null, ctx.adminId ?? null, ctx.action ?? "view", ctx.ip ?? null]
  );

  return {
    generated_at: new Date().toISOString(),
    // §20.1's fifteen sections, in the order the SRS lists them.
    identity: {
      application_code: app.application_code,
      name: app.full_name,
      phone: app.phone,
      // Masked in the pack. A lender needs to know identity was verified, not to
      // hold the number — and a pack is the document most likely to be emailed on.
      nid_masked: nid ? `•••• •••• ${nid.slice(-4)}` : null,
      identity_verified: Number(app.is_kyc_verified) === 1,
      district: app.district ?? app.home_district,
      upazila: app.upazila,
    },
    request: {
      product: app.product_name,
      requested_amount: money(app.requested_amount),
      recommended_amount: money(app.recommended_amount),
      approved_amount: money(app.approved_amount),
      tenure_months: Number(app.tenure_months),
      repayment_mode: app.repayment_mode,
      interest_rate_annual: money(app.interest_rate_annual),
      interest_method: app.interest_method,
      purpose: app.purpose_code,
      purpose_detail: app.purpose_text,
      applied_on: app.created_at,
    },
    financial_summary: {
      monthly_income: income,
      monthly_expenses: expense,
      net_surplus: income != null && expense != null ? Math.round((income - expense) * 100) / 100 : null,
      proposed_installment: installment,
      dscr:
        income != null && expense != null && installment
          ? Math.round(((income - expense) / installment) * 100) / 100
          : null,
    },
    existing_debt: debts,
    assets,
    score: assessment
      ? {
          total_score: money(assessment.total_score),
          grade: assessment.grade,
          inherent_grade: assessment.inherent_grade,
          readiness_status: assessment.readiness_status,
          structured_readiness: assessment.structured_readiness,
          data_confidence: assessment.data_confidence,
          verified_field_pct: money(assessment.verified_field_pct),
          hard_stop: Number(assessment.hard_stop) === 1,
          hard_stop_codes: parseJson<string[]>(assessment.hard_stop_codes_json, []),
          primary_pathway: assessment.primary_pathway,
          model_version: assessment.scorecard_model_version,
          assessment_no: Number(assessment.sequence_no),
          assessed_at: assessment.created_at,
          criteria,
        }
      : null,
    risk_factors: {
      strengths: reasons.filter((r) => r.polarity === "positive").map((r) => r.label_en),
      concerns: reasons.filter((r) => r.polarity === "negative").map((r) => r.label_en),
    },
    safeguards,
    field_verification: verifications.map((v) => ({
      item: v.label_en,
      verdict: v.verdict ?? "not_started",
    })),
    documentation: documents,
    behavioural: mpoweru[0]
      ? {
          status: mpoweru[0].status,
          band: mpoweru[0].band,
          normalised_score: money(mpoweru[0].normalised_score),
          model_version: mpoweru[0].model_version,
          // Surfaced deliberately. A lender must never mistake a stub number for
          // a real behavioural assessment.
          is_simulated: Number(mpoweru[0].is_stub) === 1,
        }
      : null,
    repayment: account[0]
      ? {
          principal: money(account[0].principal),
          total_payable: money(account[0].total_payable),
          amount_paid: money(account[0].amount_paid),
          outstanding: money(account[0].outstanding_total),
          days_past_due: Number(account[0].days_past_due),
          status: account[0].status,
        }
      : null,
  };
}

/** CSV export (ADM-LON-27). Flat key/value so Bangla names survive any importer. */
export function packToCsv(pack: Awaited<ReturnType<typeof buildLenderPack>>): string {
  const lines: string[] = [];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const emit = (section: string, key: string, value: unknown) =>
    lines.push([esc(section), esc(key), esc(value)].join(","));

  lines.push("section,field,value");

  const walk = (section: string, value: unknown, prefix = "") => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(section, item, prefix ? `${prefix}.${i + 1}` : String(i + 1)));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(section, v, prefix ? `${prefix}.${k}` : k);
      }
      return;
    }
    emit(section, prefix, value);
  };

  for (const [section, value] of Object.entries(pack)) walk(section, value);
  // A BOM so Excel opens UTF-8 Bangla correctly instead of as mojibake — the one
  // place where the default behaviour is wrong for exactly the fields that matter.
  // Written as an escape, not a literal: a literal BOM is invisible in a diff and
  // is silently dropped by any tool that normalises the file.
  return "\uFEFF" + lines.join("\n");
}

// ---------------------------------------------------------------------------
// Submissions (ADM-LON-29/30)
// ---------------------------------------------------------------------------

export async function submitToLender(payload: Record<string, unknown>, ctx: Ctx) {
  const applicationId = Number(payload.application_id);
  const lenderId = Number(payload.lender_id);
  if (!Number.isFinite(applicationId)) throw new Error("A numeric application_id is required.");
  if (!Number.isFinite(lenderId)) throw new Error("A numeric lender_id is required.");

  return withTransaction(async (tx: Tx) => {
    const lenders = await tx.query<Row>(
      "SELECT id, name_en, min_grade, min_confidence, max_amount, is_active FROM lenders WHERE id = ?",
      [lenderId]
    );
    const lender = lenders[0];
    if (!lender) throw new Error("Lender not found.");
    if (Number(lender.is_active) !== 1) throw new Error(`${lender.name_en} is not active.`);

    const apps = await tx.query<Row>(
      `SELECT a.id, a.user_id, a.application_code, a.requested_amount, a.recommended_amount,
              a.current_assessment_id
       FROM loan_applications a WHERE a.id = ? FOR UPDATE`,
      [applicationId]
    );
    const app = apps[0];
    if (!app) throw new Error("Application not found.");

    // ADM-LON-30. Read now, not from a cached flag: consent can be revoked
    // between the application and the moment of sharing, and this is the moment
    // that matters.
    const consents = await tx.query<Row>(
      `SELECT consent_version, status FROM loan_consents
       WHERE application_id = ? AND consent_key = 'share_with_lender'
       ORDER BY id DESC LIMIT 1`,
      [applicationId]
    );
    const consent = consents[0];
    if (!consent || consent.status !== "granted") {
      throw new Error(
        "This application cannot be shared: the farmer has not granted (or has revoked) consent to share with a lender."
      );
    }

    const assessments = await tx.query<Row>(
      `SELECT id, grade, data_confidence, hard_stop, recommended_amount
       FROM credit_assessments
       WHERE application_id = ? AND is_shadow = 0 AND status <> 'superseded'
       ORDER BY sequence_no DESC LIMIT 1`,
      [applicationId]
    );
    const assessment = assessments[0];
    if (!assessment) throw new Error("Assess the application before submitting it to a lender.");
    if (Number(assessment.hard_stop) === 1) {
      throw new Error("A hard-stopped application cannot be submitted to a lender.");
    }

    // Lender-specific eligibility (ADM-LON-38). Checked here so a submission that
    // the lender would reject on their own rules never reaches them.
    const gradeOrder = ["A", "B", "C", "D"];
    if (lender.min_grade && gradeOrder.indexOf(String(assessment.grade)) > gradeOrder.indexOf(String(lender.min_grade))) {
      throw new Error(`${lender.name_en} accepts grade ${lender.min_grade} and above; this is ${assessment.grade}.`);
    }
    const confOrder = ["high", "medium", "low"];
    if (lender.min_confidence && confOrder.indexOf(String(assessment.data_confidence)) > confOrder.indexOf(String(lender.min_confidence))) {
      throw new Error(`${lender.name_en} requires ${lender.min_confidence} data confidence; this is ${assessment.data_confidence}.`);
    }

    const amount = Number(
      payload.amount ?? assessment.recommended_amount ?? app.recommended_amount ?? app.requested_amount
    );
    if (lender.max_amount && amount > Number(lender.max_amount)) {
      throw new Error(`${lender.name_en} caps submissions at ৳${lender.max_amount}.`);
    }

    const existing = await tx.query<Row>(
      "SELECT id, status FROM lender_submissions WHERE application_id = ? AND lender_id = ?",
      [applicationId, lenderId]
    );
    if (existing[0] && !["withdrawn", "declined"].includes(String(existing[0].status))) {
      throw new Error(`This application is already with ${lender.name_en} (${existing[0].status}).`);
    }

    let submissionId: number;
    if (existing[0]) {
      submissionId = Number(existing[0].id);
      await tx.execute(
        `UPDATE lender_submissions
            SET status = 'submitted', submitted_amount = ?, assessment_id = ?,
                consent_verified_at = NOW(), consent_version = ?,
                submitted_by = ?, submitted_at = NOW(),
                decline_reason_code = NULL, decline_reason_text = NULL, decided_at = NULL
          WHERE id = ?`,
        [amount, assessment.id, consent.consent_version, ctx.adminId, submissionId]
      );
    } else {
      const result = await tx.execute(
        `INSERT INTO lender_submissions
           (application_id, lender_id, assessment_id, status, submitted_amount,
            consent_verified_at, consent_version, submitted_by, submitted_at)
         VALUES (?,?,?, 'submitted', ?, NOW(), ?, ?, NOW())`,
        [applicationId, lenderId, assessment.id, amount, consent.consent_version, ctx.adminId]
      );
      submissionId = Number(result.insertId);
    }

    await tx.execute(
      `INSERT INTO lender_submission_events (submission_id, from_status, to_status, note, actor_admin_id)
       VALUES (?, ?, 'submitted', ?, ?)`,
      [submissionId, existing[0]?.status ?? null, `Submitted to ${lender.name_en} for ৳${amount}.`, ctx.adminId]
    );

    await tx.execute(
      "UPDATE loan_applications SET status = 'submitted_to_lender' WHERE id = ?",
      [applicationId]
    );
    await tx.execute(
      `INSERT INTO loan_application_events (application_id, to_status, actor_type, actor_id, note_bn, note_en)
       VALUES (?, 'submitted_to_lender', 'admin', ?, ?, ?)`,
      [applicationId, ctx.adminId, `${lender.name_en}-এ পাঠানো হয়েছে।`, `Submitted to ${lender.name_en}.`]
    );

    await recordAudit({
      actorAdminId: ctx.adminId,
      action: "lender.submission.create",
      entityType: "lender_submissions",
      entityId: submissionId,
      after: { application_id: applicationId, lender_id: lenderId, amount, consent_version: consent.consent_version },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { submission_id: submissionId, lender: lender.name_en, amount, status: "submitted" };
  });
}

export async function recordLenderDecision(payload: Record<string, unknown>, ctx: Ctx) {
  const submissionId = Number(payload.submission_id);
  const to = String(payload.status ?? "");
  if (!Number.isFinite(submissionId)) throw new Error("A numeric submission_id is required.");
  if (!SUBMISSION_STATUSES.includes(to as (typeof SUBMISSION_STATUSES)[number])) {
    throw new Error(`Unknown status "${to}".`);
  }

  return withTransaction(async (tx: Tx) => {
    const rows = await tx.query<Row>(
      "SELECT id, application_id, status FROM lender_submissions WHERE id = ? FOR UPDATE",
      [submissionId]
    );
    const submission = rows[0];
    if (!submission) throw new Error("Submission not found.");

    const from = String(submission.status);
    if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      throw new Error(
        `A submission cannot go from "${from}" to "${to}".` +
          (ALLOWED_TRANSITIONS[from]?.length === 0
            ? " That decision is final — record a new submission instead, so both decisions stay on the record."
            : ` Allowed: ${ALLOWED_TRANSITIONS[from].join(", ")}.`)
      );
    }

    // ADM-LON-29. A decline without a structured code teaches the model nothing,
    // and "we said no" a year later with no reason is not a record.
    if (to === "declined" && !String(payload.decline_reason_code ?? "").trim()) {
      throw new Error("A decline needs a structured reason code so the model can learn from it.");
    }
    if (to === "approved" && !(Number(payload.approved_amount) > 0)) {
      throw new Error("An approval needs the approved amount.");
    }
    if (to === "info_requested" && !String(payload.info_requested_text ?? "").trim()) {
      throw new Error("Say what information the lender is asking for.");
    }

    await tx.execute(
      `UPDATE lender_submissions
          SET status = ?, approved_amount = ?, conditions = ?,
              decline_reason_code = ?, decline_reason_text = ?, info_requested_text = ?,
              decided_at = CASE WHEN ? IN ('approved','declined') THEN NOW() ELSE decided_at END
        WHERE id = ?`,
      [
        to,
        payload.approved_amount == null ? null : Number(payload.approved_amount),
        payload.conditions == null ? null : String(payload.conditions),
        payload.decline_reason_code == null ? null : String(payload.decline_reason_code),
        payload.decline_reason_text == null ? null : String(payload.decline_reason_text),
        payload.info_requested_text == null ? null : String(payload.info_requested_text),
        to, submissionId,
      ]
    );

    await tx.execute(
      `INSERT INTO lender_submission_events (submission_id, from_status, to_status, note, actor_admin_id)
       VALUES (?,?,?,?,?)`,
      [submissionId, from, to, (payload.note ?? payload.decline_reason_text ?? payload.info_requested_text ?? null) as string | null, ctx.adminId]
    );

    // The application follows the lender.
    const appStatus =
      to === "approved" ? "approved"
      : to === "declined" ? "lender_declined"
      : to === "info_requested" ? "info_requested"
      : to === "under_review" ? "lender_review"
      : null;

    if (appStatus) {
      await tx.execute(
        "UPDATE loan_applications SET status = ?, approved_amount = COALESCE(?, approved_amount) WHERE id = ?",
        [appStatus, to === "approved" ? Number(payload.approved_amount) : null, submission.application_id]
      );
      await tx.execute(
        `INSERT INTO loan_application_events (application_id, to_status, actor_type, actor_id, note_bn, note_en)
         VALUES (?, ?, 'admin', ?, ?, ?)`,
        [
          submission.application_id, appStatus, ctx.adminId,
          `ঋণদাতার সিদ্ধান্ত: ${to}`,
          `Lender decision: ${to}${payload.decline_reason_code ? ` (${payload.decline_reason_code})` : ""}`,
        ]
      );
    }

    await recordAudit({
      actorAdminId: ctx.adminId,
      action: "lender.submission.decision",
      entityType: "lender_submissions",
      entityId: submissionId,
      before: { status: from },
      after: { status: to, approved_amount: payload.approved_amount ?? null, decline_reason_code: payload.decline_reason_code ?? null },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { submission_id: submissionId, from, to };
  });
}

/** Lender pipeline. `lender_id` scopes it; without one, the whole book. */
export async function getLenderPipeline(params: URLSearchParams) {
  const lenderId = params.get("lender_id");
  const where = lenderId ? "WHERE s.lender_id = ?" : "";
  const args = lenderId ? [Number(lenderId)] : [];

  const rows = await queryRows<Row>(
    `SELECT CAST(s.id AS CHAR) AS id, CAST(s.application_id AS CHAR) AS application_id,
            CAST(s.lender_id AS CHAR) AS lender_id,
            s.status, s.submitted_amount, s.approved_amount,
            s.decline_reason_code, s.submitted_at, s.decided_at,
            a.application_code, u.full_name AS farmer, a.district,
            l.name_en AS lender, ca.grade, ca.data_confidence
     FROM lender_submissions s
     JOIN loan_applications a ON a.id = s.application_id
     JOIN app_users u ON u.id = a.user_id
     JOIN lenders l ON l.id = s.lender_id
     LEFT JOIN credit_assessments ca ON ca.id = s.assessment_id
     ${where}
     ORDER BY s.submitted_at DESC, s.id DESC
     LIMIT 200`,
    args
  );

  const summary = await queryRows<Row>(
    `SELECT s.status, COUNT(*) AS n, COALESCE(SUM(s.submitted_amount), 0) AS amount
     FROM lender_submissions s ${where} GROUP BY s.status`,
    args
  );

  return { rows, summary };
}
