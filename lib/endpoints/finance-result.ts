// The farmer's view of a credit assessment, its development plan, and the
// improvement narrative between assessments — SRS §15.4–15.5, MOB-LON-24…30.
//
// MOB-LON-26 lists what must never reach this payload: numeric weights,
// per-criterion ratings, the scorecard formula, internal reason codes, and raw
// mPowerU output. The console has all of that; the app gets the three outputs,
// the pathway, and bilingual sentences.
//
// That is not only a privacy rule. A farmer shown "field validation: 2/5" learns
// to game the field visit; a farmer shown "your farm details have not been
// verified yet" learns to get them verified. The second is the behaviour the
// product wants, and it is the only one this endpoint can produce.

import { queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";

const GRADE_LABEL: Record<string, { bn: string; en: string }> = {
  A: { bn: "চমৎকার", en: "Excellent" },
  B: { bn: "ভালো", en: "Good" },
  C: { bn: "মোটামুটি", en: "Marginal" },
  // MOB-LON-27 / P4. Never "rejected", never "poor". D is a starting point.
  D: { bn: "উন্নতি প্রয়োজন", en: "Needs development" },
};

const READINESS_LABEL: Record<string, { bn: string; en: string }> = {
  bank_ready: { bn: "ব্যাংকের জন্য প্রস্তুত", en: "Bank ready" },
  conditionally_ready: { bn: "শর্তসাপেক্ষে প্রস্তুত", en: "Conditionally ready" },
  project_ready: { bn: "প্রকল্পের জন্য প্রস্তুত", en: "Project ready" },
  development_required: { bn: "উন্নয়ন প্রয়োজন", en: "Development required" },
  currently_ineligible: { bn: "এই মুহূর্তে সম্ভব নয়", en: "Not possible at present" },
};

const CONFIDENCE_LABEL: Record<string, { bn: string; en: string }> = {
  high: { bn: "উচ্চ", en: "High" },
  medium: { bn: "মাঝারি", en: "Medium" },
  low: { bn: "কম", en: "Low" },
};

const parseJson = <T,>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};

// GET app/finance/assessment?user_id=
// The live assessment for the farmer's current application.
export async function getFarmerAssessment(userId: string) {
  if (!userId) throw new Error("A user id is required.");

  const rows = await queryRows<Row>(
    `SELECT ca.id, ca.total_score, ca.grade, ca.readiness_status, ca.data_confidence,
            ca.hard_stop, ca.hard_stop_codes_json, ca.primary_pathway, ca.reason_codes_json,
            ca.inherent_grade, ca.structured_readiness, ca.recommended_amount,
            ca.sequence_no, ca.created_at,
            a.application_code, a.requested_amount, a.status AS application_status
     FROM credit_assessments ca
     JOIN loan_applications a ON a.id = ca.application_id
     WHERE ca.user_id = ? AND ca.is_shadow = 0 AND ca.status <> 'superseded'
     ORDER BY ca.created_at DESC LIMIT 1`,
    [userId]
  );

  const a = rows[0];
  if (!a) return { state: "not_assessed", assessment: null };

  const reasonCodes = parseJson<string[]>(a.reason_codes_json, []);
  const hardStopCodes = parseJson<string[]>(a.hard_stop_codes_json, []);

  // Reason codes are internal identifiers (MOB-LON-26). Resolve them to the
  // bilingual sentences an admin maintains, and drop any that no longer resolve
  // rather than leaking the raw code into the UI.
  const explanations = reasonCodes.length
    ? await queryRows<Row>(
        `SELECT code, polarity, label_bn, label_en FROM credit_reason_codes
         WHERE code IN (${reasonCodes.map(() => "?").join(",")}) AND is_active = 1
         ORDER BY sort_order`,
        reasonCodes
      )
    : [];

  const hardStopReasons = hardStopCodes.length
    ? await queryRows<Row>(
        `SELECT label_bn, label_en, required_action_bn, required_action_en
         FROM credit_hard_stop_rules
         WHERE code IN (${hardStopCodes.map(() => "?").join(",")}) AND is_active = 1
         ORDER BY sort_order`,
        hardStopCodes
      )
    : [];

  const pathway = a.primary_pathway
    ? (await queryRows<Row>(
        "SELECT pathway_code, label_bn, label_en FROM credit_pathway_rules WHERE pathway_code = ? AND is_active = 1 LIMIT 1",
        [a.primary_pathway]
      ))[0] ?? null
    : null;

  const grade = String(a.grade);
  const hasHardStop = Number(a.hard_stop) === 1;

  return {
    state: hasHardStop ? "blocked" : "assessed",
    assessment: {
      application_code: a.application_code,
      sequence_no: Number(a.sequence_no),
      assessed_at: a.created_at,

      // P2 — the three outputs are separate, labelled blocks. The score itself is
      // included because the farmer is entitled to their own number; the weights
      // and ratings that produced it are not.
      score: Number(a.total_score),
      grade,
      grade_label: GRADE_LABEL[grade] ?? GRADE_LABEL.D,
      readiness_status: a.readiness_status,
      readiness_label: READINESS_LABEL[String(a.readiness_status)] ?? READINESS_LABEL.development_required,
      data_confidence: a.data_confidence,
      confidence_label: CONFIDENCE_LABEL[String(a.data_confidence)] ?? CONFIDENCE_LABEL.low,

      // MOB-LON-25. Two results shown separately when safeguards changed the
      // outcome — the borrower's own standing, and what the project structure
      // makes possible. Collapsing them would credit the farmer for a guarantee
      // they did not earn.
      inherent_grade: a.inherent_grade,
      structured_readiness: a.structured_readiness,
      structured_readiness_label: a.structured_readiness
        ? READINESS_LABEL[String(a.structured_readiness)] ?? null
        : null,

      requested_amount: Number(a.requested_amount),
      recommended_amount: a.recommended_amount == null ? null : Number(a.recommended_amount),

      pathway: pathway
        ? { code: pathway.pathway_code, label_bn: pathway.label_bn, label_en: pathway.label_en }
        : null,

      strengths: explanations
        .filter((r) => r.polarity === "positive")
        .map((r) => ({ bn: r.label_bn, en: r.label_en })),
      improvements: explanations
        .filter((r) => r.polarity === "negative")
        .map((r) => ({ bn: r.label_bn, en: r.label_en })),

      // MOB-LON-27. A blocked result leads with what would change it.
      blocked: hasHardStop,
      blocked_reasons: hardStopReasons.map((r) => ({
        bn: r.label_bn,
        en: r.label_en,
        action_bn: r.required_action_bn,
        action_en: r.required_action_en,
      })),
    },
  };
}

// GET app/finance/development-plan?user_id=
export async function getDevelopmentPlan(userId: string) {
  if (!userId) throw new Error("A user id is required.");

  const tasks = await queryRows<Row>(
    `SELECT id, title_bn, title_en, detail_bn, detail_en, action_deeplink,
            due_on, status, sort_order
     FROM development_plan_tasks
     WHERE user_id = ? AND status <> 'waived'
     ORDER BY status = 'verified', sort_order, id`,
    [userId]
  );

  const outstanding = tasks.filter((t) => t.status !== "verified").length;

  return {
    tasks: tasks.map((t) => ({
      id: String(t.id),
      title: { bn: t.title_bn, en: t.title_en },
      detail: { bn: t.detail_bn, en: t.detail_en },
      action_link: t.action_deeplink,
      due_on: t.due_on,
      status: t.status,
      done: t.status === "verified",
    })),
    total: tasks.length,
    outstanding,
    // MOB-LON-29. The CTA appears only when there is genuinely nothing left,
    // so asking for reassessment is never a wasted round trip for the farmer or
    // a wasted review for the analyst.
    can_request_reassessment: tasks.length > 0 && outstanding === 0,
  };
}

// POST app/finance/reassessment-request
// MOB-LON-29. The farmer asking to be looked at again once their plan is done.
//
// This does not re-score anything. Reassessment is a credit decision and stays
// with the credit team; all this does is put the application back in the queue
// with a note, so the request is visible rather than a phone call nobody logged.
export async function requestReassessment(payload: Record<string, unknown>) {
  const userId = String(payload.user_id ?? "");
  if (!userId) throw new Error("A user id is required.");

  return withTransaction(async (tx) => {
    const apps = await tx.query<Row>(
      `SELECT id, application_code, status FROM loan_applications
       WHERE user_id = ? AND status NOT IN ('withdrawn','cancelled','closed')
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    const app = apps[0];
    if (!app) throw new Error("You do not have an application to reassess.");

    const outstanding = await tx.query<Row>(
      `SELECT COUNT(*) AS n FROM development_plan_tasks
       WHERE user_id = ? AND status NOT IN ('verified','waived')`,
      [userId]
    );
    // The app hides the button until the plan is clear, but a client is not a
    // control. Checking here keeps the analyst's queue free of requests that
    // cannot yet lead anywhere.
    if (Number(outstanding[0]?.n ?? 0) > 0) {
      throw new Error("Finish the remaining steps in your development plan first.");
    }

    const already = await tx.query<Row>(
      `SELECT id FROM loan_application_events
       WHERE application_id = ? AND to_status = 'under_assessment'
         AND actor_type = 'user' AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
       LIMIT 1`,
      [app.id]
    );
    if (already.length > 0) {
      throw new Error("You have already asked for a reassessment this week.");
    }

    await tx.execute(
      `INSERT INTO loan_application_events
         (application_id, from_status, to_status, actor_type, actor_id, note_bn, note_en)
       VALUES (?, ?, 'under_assessment', 'user', ?, ?, ?)`,
      [
        app.id, app.status, userId,
        "কৃষক পুনরায় মূল্যায়নের আবেদন করেছেন — উন্নয়ন পরিকল্পনা সম্পন্ন।",
        "Farmer requested reassessment — development plan complete.",
      ]
    );

    await tx.execute(
      "UPDATE loan_applications SET status = 'under_assessment', manual_review_required = 1, manual_review_reason = ? WHERE id = ?",
      ["Farmer requested reassessment after completing their development plan.", app.id]
    );

    return { application_code: app.application_code, requested: true };
  });
}

// GET app/finance/assessment/history?user_id=
// MOB-LON-30 — the improvement narrative, not a table of scores.
export async function getAssessmentHistory(userId: string) {
  if (!userId) throw new Error("A user id is required.");

  const rows = await queryRows<Row>(
    `SELECT ca.sequence_no, ca.total_score, ca.grade, ca.readiness_status,
            ca.data_confidence, ca.reason_codes_json, ca.created_at,
            a.application_code
     FROM credit_assessments ca
     JOIN loan_applications a ON a.id = ca.application_id
     WHERE ca.user_id = ? AND ca.is_shadow = 0
     ORDER BY ca.created_at DESC`,
    [userId]
  );

  if (rows.length === 0) return { entries: [], narrative: null };

  const entries = rows.map((r) => ({
    sequence_no: Number(r.sequence_no),
    application_code: r.application_code,
    score: Number(r.total_score),
    grade: r.grade,
    grade_label: GRADE_LABEL[String(r.grade)] ?? GRADE_LABEL.D,
    readiness_status: r.readiness_status,
    data_confidence: r.data_confidence,
    assessed_at: r.created_at,
  }));

  if (rows.length < 2) return { entries, narrative: null };

  const current = rows[0];
  const previous = rows[1];
  const currentCodes = new Set(parseJson<string[]>(current.reason_codes_json, []));
  const previousCodes = new Set(parseJson<string[]>(previous.reason_codes_json, []));

  // What changed, expressed as codes that appeared or disappeared. Resolved to
  // sentences below; a code with no active row is dropped rather than shown raw.
  const resolved = await queryRows<Row>(
    "SELECT code, polarity, label_bn, label_en FROM credit_reason_codes WHERE is_active = 1"
  );
  const byCode = new Map(resolved.map((r) => [String(r.code), r]));

  // A negative code that has gone is a fix, but its label still reads as the
  // problem — listing "Low behavioural assessment result" under "What improved"
  // tells the farmer the opposite of what happened. So each item carries how it
  // moved, and the app phrases it: a disappeared negative is "resolved", a new
  // positive is a plain gain, and the reverse for the other column.
  const say = (code: string, kind: "resolved" | "gained" | "appeared" | "lost") => {
    const row = byCode.get(code);
    return row ? { bn: row.label_bn, en: row.label_en, kind } : null;
  };

  const improved = [
    ...[...previousCodes]
      .filter((c) => !currentCodes.has(c) && byCode.get(c)?.polarity === "negative")
      .map((c) => say(c, "resolved")),
    ...[...currentCodes]
      .filter((c) => !previousCodes.has(c) && byCode.get(c)?.polarity === "positive")
      .map((c) => say(c, "gained")),
  ].filter(Boolean);

  const deteriorated = [
    ...[...currentCodes]
      .filter((c) => !previousCodes.has(c) && byCode.get(c)?.polarity === "negative")
      .map((c) => say(c, "appeared")),
    ...[...previousCodes]
      .filter((c) => !currentCodes.has(c) && byCode.get(c)?.polarity === "positive")
      .map((c) => say(c, "lost")),
  ].filter(Boolean);

  const completedTasks = await queryRows<Row>(
    `SELECT COUNT(*) AS n FROM development_plan_tasks
     WHERE user_id = ? AND status = 'verified' AND verified_at > ?`,
    [userId, previous.created_at]
  );

  return {
    entries,
    narrative: {
      previous: {
        score: Number(previous.total_score),
        grade: previous.grade,
        grade_label: GRADE_LABEL[String(previous.grade)] ?? GRADE_LABEL.D,
        assessed_at: previous.created_at,
      },
      current: {
        score: Number(current.total_score),
        grade: current.grade,
        grade_label: GRADE_LABEL[String(current.grade)] ?? GRADE_LABEL.D,
        assessed_at: current.created_at,
      },
      score_change: Math.round((Number(current.total_score) - Number(previous.total_score)) * 100) / 100,
      grade_changed: current.grade !== previous.grade,
      improved,
      deteriorated,
      actions_completed: Number(completedTasks[0]?.n ?? 0),
    },
  };
}
