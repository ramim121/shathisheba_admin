// Running an assessment: gather the evidence, score it, persist the result.
//
// The engine in lib/finance/scorecard-engine.ts is pure and knows nothing about
// this database. This file is the seam — it loads the model and the evidence,
// hands both to the engine, and writes back what comes out along with a verbatim
// snapshot of everything it read (ENG-33).
//
// Assessments are immutable (ENG-32). Running one again does not update the last;
// it supersedes it and inserts the next sequence number, in one transaction, so a
// reader never sees two live assessments or none.

import { queryRows, withTransaction, type Tx } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import {
  scoreApplication,
  type AssessmentInput,
  type Criterion,
  type HardStopRule,
  type ModelThresholds,
  type PathwayRule,
  type RatingRule,
  type ScorecardResult,
} from "@/lib/finance/scorecard-engine";
import type { Row } from "./shared";

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};

// Which derived metric each criterion's rules read. Kept here rather than in the
// database because it is a contract between the engine's deriveMetrics() and the
// seeded criteria — a value an admin could edit into something the engine does
// not compute would silently rate every applicant 0.
const CRITERION_METRIC: Record<string, string> = {
  cash_flow: "dscr",
  existing_debt: "debt_burden_ratio",
  enterprise: "enterprise_years",
  transactions: "platform_transactions",
  mpoweru: "mpoweru_score",
  management: "training_completed",
  field_validation: "verification_ratio",
  documentation: "document_ratio",
};

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

async function loadModel(tx: Tx, status: "active" | "shadow") {
  const models = await tx.query<Row>(
    `SELECT id, version, grade_a_min, grade_b_min, grade_c_min,
            confidence_high_pct, confidence_med_pct
     FROM scorecard_models WHERE status = ? ORDER BY id DESC LIMIT 1`,
    [status]
  );
  const model = models[0];
  if (!model) throw new Error(`No ${status} scorecard model is configured.`);

  const criteriaRows = await tx.query<Row>(
    `SELECT code, label_bn, label_en, weight, layer FROM scorecard_criteria
     WHERE model_id = ? AND is_active = 1 ORDER BY sort_order`,
    [model.id]
  );

  const criteria: Criterion[] = criteriaRows.map((c) => {
    const metric = CRITERION_METRIC[String(c.code)];
    if (!metric) {
      // Better to refuse than to score every applicant 0 on a criterion the
      // engine has no metric for.
      throw new Error(
        `Criterion "${c.code}" has no metric the engine computes. Add it to CRITERION_METRIC or deactivate the criterion.`
      );
    }
    return {
      code: String(c.code),
      label_bn: String(c.label_bn),
      label_en: String(c.label_en),
      weight: Number(c.weight),
      layer: c.layer as Criterion["layer"],
      metric,
    };
  });

  const rules = (await tx.query<Row>(
    `SELECT sc.code AS criterion_code, rr.sort_order, rr.metric,
            rr.min_value, rr.max_value, rr.rating, rr.label_en
     FROM scorecard_rating_rules rr
     JOIN scorecard_criteria sc ON sc.id = rr.criterion_id
     WHERE sc.model_id = ? AND rr.is_active = 1 AND sc.is_active = 1
     ORDER BY sc.sort_order, rr.sort_order`,
    [model.id]
  )).map<RatingRule>((r) => ({
    criterion_code: String(r.criterion_code),
    sort_order: Number(r.sort_order),
    metric: String(r.metric),
    min_value: n(r.min_value),
    max_value: n(r.max_value),
    rating: Number(r.rating),
    label_en: (r.label_en ?? null) as string | null,
  }));

  const thresholds: ModelThresholds = {
    version: String(model.version),
    grade_a_min: Number(model.grade_a_min),
    grade_b_min: Number(model.grade_b_min),
    grade_c_min: Number(model.grade_c_min),
    confidence_high_pct: Number(model.confidence_high_pct),
    confidence_med_pct: Number(model.confidence_med_pct),
  };

  return { modelId: Number(model.id), thresholds, criteria, rules };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

const evidenceNumber = (rows: Row[], section: string, key: string): number | null => {
  const hit = rows.find((r) => r.section === section && r.field_key === key);
  return hit ? n(hit.value_number) : null;
};

const evidenceFlag = (rows: Row[], section: string, key: string): boolean => {
  const hit = rows.find((r) => r.section === section && r.field_key === key);
  if (!hit) return false;
  const raw = String(hit.value_text ?? "").toLowerCase();
  return raw === "true" || raw === "yes" || Number(hit.value_number) === 1;
};

export async function loadAssessmentInput(tx: Tx, applicationId: number) {
  const apps = await tx.query<Row>(
    `SELECT a.id, a.user_id, a.requested_amount, a.tenure_months, a.repayment_mode,
            a.purpose_code, u.is_kyc_verified, u.nid_number
     FROM loan_applications a JOIN app_users u ON u.id = a.user_id
     WHERE a.id = ?`,
    [applicationId]
  );
  const app = apps[0];
  if (!app) throw new Error("Application not found.");

  const evidence = await tx.query<Row>(
    "SELECT section, field_key, value_text, value_number, verification_status, is_material FROM loan_evidence WHERE application_id = ?",
    [applicationId]
  );

  const [debts] = [await tx.query<Row>(
    `SELECT COALESCE(SUM(installment_amount), 0) AS installments,
            SUM(payment_status IN ('over_90_late','defaulted') OR had_default = 1) AS bad,
            COUNT(*) AS rows_present
     FROM loan_existing_debts WHERE application_id = ?`,
    [applicationId]
  )];
  const debt = debts[0] ?? {};

  const [verifications] = [await tx.query<Row>(
    `SELECT COUNT(*) AS total,
            SUM(verdict = 'verified') AS verified,
            SUM(verdict = 'contradictory') AS contradictory
     FROM loan_field_verifications WHERE application_id = ?`,
    [applicationId]
  )];
  const verification = verifications[0] ?? {};

  const [documents] = [await tx.query<Row>(
    `SELECT SUM(is_required = 1) AS required, SUM(is_required = 1 AND status = 'verified') AS verified
     FROM loan_documents WHERE application_id = ?`,
    [applicationId]
  )];
  const doc = documents[0] ?? {};

  // Platform behaviour is queried, never self-reported — that is what makes it
  // corroborating evidence rather than another claim.
  const [txCounts] = [await tx.query<Row>(
    `SELECT
       (SELECT COUNT(*) FROM orders WHERE user_id = ?) +
       (SELECT COUNT(*) FROM sale_listings WHERE user_id = ? AND status = 'sold') AS n`,
    [app.user_id, app.user_id]
  )];

  const [training] = [await tx.query<Row>(
    "SELECT COUNT(*) AS n FROM user_learning_progress WHERE user_id = ? AND status = 'completed'",
    [app.user_id]
  )];

  const [consents] = [await tx.query<Row>(
    "SELECT COUNT(*) AS n FROM loan_consents WHERE application_id = ? AND status = 'granted'",
    [applicationId]
  )];

  const [safeguardRows] = [await tx.query<Row>(
    "SELECT safeguard_type FROM loan_safeguards WHERE application_id = ? AND is_confirmed = 1",
    [applicationId]
  )];

  const materialRows = evidence.filter((r) => Number(r.is_material) === 1);

  const input: AssessmentInput = {
    monthly_income_total: evidenceNumber(evidence, "financial", "monthly_income_total"),
    monthly_expense_total: evidenceNumber(evidence, "financial", "monthly_expense_total"),
    proposed_installment: evidenceNumber(evidence, "financial", "proposed_installment"),
    // A row count of zero means nobody recorded any debt; that is a genuine zero
    // only once the section has been visited, which the officer marks explicitly.
    existing_installment_total:
      Number(debt.rows_present ?? 0) > 0 || evidenceFlag(evidence, "financial", "debt_section_complete")
        ? Number(debt.installments ?? 0)
        : null,
    has_active_default: Number(debt.bad ?? 0) > 0,
    enterprise_years: evidenceNumber(evidence, "enterprise", "years_experience"),
    platform_transactions: Number(txCounts[0]?.n ?? 0),
    training_completed: Number(training[0]?.n ?? 0),
    mpoweru_score: evidenceNumber(evidence, "mpoweru", "normalised_score"),
    verification_items_total: Number(verification.total ?? 0),
    verification_items_verified: Number(verification.verified ?? 0),
    has_contradictory_verdict: Number(verification.contradictory ?? 0) > 0,
    documents_required: Number(doc.required ?? 0),
    documents_verified: Number(doc.verified ?? 0),
    identity_verified: Number(app.is_kyc_verified) === 1,
    critical_kyc_present: Boolean(app.nid_number),
    consents_complete: Number(consents[0]?.n ?? 0) >= 6,
    purpose_permitted: !evidenceFlag(evidence, "request", "purpose_prohibited"),
    material_fields_total: materialRows.length,
    material_fields_verified: materialRows.filter((r) => r.verification_status === "verified").length,
    confirmed_safeguards: safeguardRows.map((r) => String(r.safeguard_type)),
    requested_amount: Number(app.requested_amount),
  };

  return { app, input, evidence };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export type RunResult = ScorecardResult & { assessment_id: number; sequence_no: number };

export async function runAssessment(params: {
  applicationId: number;
  adminId: number | null;
  shadow?: boolean;
  overrides?: Record<string, { rating: number; reason: string }>;
}): Promise<RunResult> {
  const { applicationId, adminId } = params;
  const shadow = params.shadow === true;

  return withTransaction(async (tx) => {
    const { app, input, evidence } = await loadAssessmentInput(tx, applicationId);
    const { thresholds, criteria, rules } = await loadModel(tx, shadow ? "shadow" : "active");

    const hardStopRules = (await tx.query<Row>(
      "SELECT code, label_bn, label_en, check_key, overridable FROM credit_hard_stop_rules WHERE is_active = 1 ORDER BY sort_order"
    )).map<HardStopRule>((r) => ({
      code: String(r.code),
      label_bn: String(r.label_bn),
      label_en: String(r.label_en),
      check_key: String(r.check_key),
      overridable: Number(r.overridable) === 1,
    }));

    const pathwayRules = (await tx.query<Row>(
      `SELECT sort_order, when_grade, when_confidence, when_hard_stop, when_safeguards,
              pathway_code, readiness_status, amount_factor, label_bn, label_en
       FROM credit_pathway_rules WHERE is_active = 1 ORDER BY sort_order`
    )).map<PathwayRule>((r) => ({
      sort_order: Number(r.sort_order),
      when_grade: (r.when_grade ?? null) as string | null,
      when_confidence: (r.when_confidence ?? null) as string | null,
      when_hard_stop: r.when_hard_stop == null ? null : Number(r.when_hard_stop) === 1,
      when_safeguards: r.when_safeguards == null ? null : Number(r.when_safeguards) === 1,
      pathway_code: String(r.pathway_code),
      readiness_status: r.readiness_status as PathwayRule["readiness_status"],
      amount_factor: n(r.amount_factor),
      label_bn: String(r.label_bn),
      label_en: String(r.label_en),
    }));

    const result = scoreApplication({
      model: thresholds,
      criteria,
      rules,
      hardStopRules,
      pathwayRules,
      input,
      overrides: params.overrides,
    });

    // ENG-32. Supersede rather than overwrite, and take the next sequence number
    // inside the same transaction so two concurrent runs cannot collide.
    const [seqRow] = await tx.query<Row>(
      "SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next FROM credit_assessments WHERE application_id = ? AND is_shadow = ?",
      [applicationId, shadow ? 1 : 0]
    );
    const sequenceNo = Number(seqRow?.next ?? 1);

    if (!shadow) {
      await tx.execute(
        "UPDATE credit_assessments SET status = 'superseded' WHERE application_id = ? AND is_shadow = 0 AND status <> 'superseded'",
        [applicationId]
      );
    }

    const inserted = await tx.execute(
      `INSERT INTO credit_assessments
        (application_id, user_id, sequence_no, scorecard_model_version,
         total_score, grade, readiness_status, data_confidence,
         hard_stop, hard_stop_codes_json, primary_pathway, reason_codes_json,
         inherent_grade, structured_readiness, recommended_amount, recommended_rationale,
         verified_field_pct, input_snapshot_json, is_shadow, computed_by, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'computed')`,
      [
        applicationId, app.user_id, sequenceNo, result.model_version,
        result.total_score, result.grade, result.readiness_status, result.data_confidence,
        result.hard_stop ? 1 : 0,
        JSON.stringify(result.hard_stops.map((h) => h.code)),
        result.primary_pathway,
        JSON.stringify(result.reason_codes),
        result.inherent_grade, result.structured_readiness,
        result.recommended_amount, result.recommended_rationale,
        result.verified_field_pct,
        // The snapshot is what makes the score reproducible a year from now, after
        // the evidence has been edited and the model re-tuned (ENG-33).
        JSON.stringify({ input, evidence_row_count: evidence.length, thresholds, criteria, rules }),
        shadow ? 1 : 0, adminId,
      ]
    );
    const assessmentId = Number(inserted.insertId);

    for (const c of result.criteria) {
      await tx.execute(
        `INSERT INTO credit_assessment_criteria
          (assessment_id, criterion_code, weight, computed_rating, override_rating, override_reason,
           override_by, effective_rating, weighted_score, metric_key, metric_value, had_data, note_en)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          assessmentId, c.criterion_code, c.weight, c.computed_rating,
          c.override_rating, params.overrides?.[c.criterion_code]?.reason ?? null,
          c.override_rating == null ? null : adminId,
          c.effective_rating, c.weighted_score, c.metric_key, c.metric_value,
          c.had_data ? 1 : 0, c.note_en,
        ]
      );
    }

    if (!shadow) {
      await tx.execute(
        `UPDATE loan_applications
            SET current_assessment_id = ?, recommended_amount = ?,
                manual_review_required = ?, manual_review_reason = ?,
                status = CASE WHEN ? = 1 THEN 'hard_stopped' ELSE 'assessed' END
          WHERE id = ?`,
        [
          assessmentId, result.recommended_amount,
          // ADM-LON-19: a contradictory field verdict forces a human to look.
          input.has_contradictory_verdict ? 1 : 0,
          input.has_contradictory_verdict ? "A field verification item was recorded as contradictory." : null,
          result.hard_stop ? 1 : 0,
          applicationId,
        ]
      );

      const noteEn =
        `Scored ${result.total_score} (grade ${result.grade}, ${result.data_confidence} confidence)` +
        (result.hard_stop ? ` — hard stop: ${result.hard_stops.map((h) => h.code).join(", ")}` : "");

      await tx.execute(
        `INSERT INTO loan_application_events
           (application_id, to_status, actor_type, actor_id, note_bn, note_en)
         VALUES (?, ?, 'admin', ?, ?, ?)`,
        [
          applicationId,
          result.hard_stop ? "hard_stopped" : "assessed",
          adminId,
          `স্কোর ${result.total_score} — গ্রেড ${result.grade}`,
          noteEn,
        ]
      );
    }

    return { ...result, assessment_id: assessmentId, sequence_no: sequenceNo };
  }).then(async (result) => {
    await recordAudit({
      actorAdminId: params.adminId ?? null,
      action: shadow ? "credit.assessment.shadow" : "credit.assessment.run",
      entityType: "credit_assessments",
      entityId: result.assessment_id,
      after: {
        application_id: applicationId,
        total_score: result.total_score,
        grade: result.grade,
        readiness_status: result.readiness_status,
        hard_stop: result.hard_stop,
      },
    });
    return result;
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getAssessment(applicationId: string) {
  const id = Number(applicationId);
  if (!Number.isFinite(id)) throw new Error("A numeric application id is required.");

  const rows = await queryRows<Row>(
    `SELECT id, sequence_no, scorecard_model_version, total_score, grade, readiness_status,
            data_confidence, hard_stop, hard_stop_codes_json, primary_pathway, reason_codes_json,
            inherent_grade, structured_readiness, recommended_amount, recommended_rationale,
            verified_field_pct, status, created_at
     FROM credit_assessments
     WHERE application_id = ? AND is_shadow = 0 AND status <> 'superseded'
     ORDER BY sequence_no DESC LIMIT 1`,
    [id]
  );
  const assessment = rows[0];
  if (!assessment) return { assessment: null, criteria: [], history: [] };

  const criteria = await queryRows<Row>(
    `SELECT cac.criterion_code, cac.weight, cac.computed_rating, cac.override_rating,
            cac.override_reason, cac.effective_rating, cac.weighted_score,
            cac.metric_key, cac.metric_value, cac.had_data, cac.note_en
     FROM credit_assessment_criteria cac WHERE cac.assessment_id = ?
     ORDER BY cac.weight DESC`,
    [assessment.id]
  );

  const history = await queryRows<Row>(
    `SELECT sequence_no, total_score, grade, readiness_status, data_confidence, created_at
     FROM credit_assessments WHERE application_id = ? AND is_shadow = 0
     ORDER BY sequence_no DESC`,
    [id]
  );

  return { assessment, criteria, history };
}
