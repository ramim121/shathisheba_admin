import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";
import {
  scoreReadiness, gradeLabel,
  type Question, type Depth, type AnswerInput,
} from "@/lib/finance/readiness-engine";
import {
  computeQuote, generateSchedule, clampAmount, installmentCount,
  type ProductTerms, type RepaymentMode,
} from "@/lib/finance/pricing-engine";

// Farmer-facing finance endpoints (/api/v1/app/finance/*).
//
// Two rules hold throughout this module:
//   * user_id always comes from the validated session. The route layer pins it
//     before these functions are called, so nothing here trusts a client value.
//   * Nothing that reaches the farmer contains weights, per-question points or
//     the scoring formula (P6 / API-04). The filtering happens here, on the
//     server — not in the mobile presentation layer.

const QUESTION_COLUMNS = `
  id, sort_order, part, category, weight, flag, flag_code,
  branch_parent_order, branch_show_when,
  question_bn, question_en, helper_bn, helper_en,
  strength_bn, strength_en, gap_bn, gap_en,
  action_title_bn, action_title_en, action_rationale_bn, action_rationale_en, action_deeplink`;

async function activeSet(): Promise<Row | null> {
  const rows = await queryRows<Row>(
    "SELECT id, version FROM readiness_question_sets WHERE status='active' ORDER BY id DESC LIMIT 1"
  );
  return rows[0] ?? null;
}

async function loadQuestions(setId: number | string): Promise<Row[]> {
  return queryRows<Row>(
    `SELECT ${QUESTION_COLUMNS} FROM readiness_questions
      WHERE set_id = ? AND is_active = 1 ORDER BY sort_order`,
    [setId]
  );
}

function toEngineQuestions(rows: Row[]): Question[] {
  return rows.map((r) => ({
    id: Number(r.id),
    sort_order: Number(r.sort_order),
    part: r.part as Question["part"],
    category: r.category as Question["category"],
    weight: Number(r.weight),
    flag: (r.flag ?? null) as Question["flag"],
    flag_code: (r.flag_code ?? null) as string | null,
    branch_parent_order: r.branch_parent_order == null ? null : Number(r.branch_parent_order),
    branch_show_when: (r.branch_show_when ?? null) as Question["branch_show_when"],
  }));
}

// GET app/finance/readiness/questions
// Deliberately omits weight, flag and category — a client that cannot see the
// weights cannot reverse-engineer the model (P6 / MOB-RDY-11).
export async function getReadinessQuestions() {
  const set = await activeSet();
  if (!set) return { set_version: null, questions: [] };
  const rows = await loadQuestions(set.id as number);
  const byOrder = new Map(rows.map((r) => [Number(r.sort_order), r]));
  return {
    set_version: set.version,
    parts: [
      { part: "core", count: rows.filter((r) => r.part === "core").length },
      { part: "deep", count: rows.filter((r) => r.part === "deep").length },
    ],
    questions: rows.map((r) => ({
      id: String(r.id),
      part: r.part,
      sort_order: Number(r.sort_order),
      question_bn: r.question_bn,
      question_en: r.question_en,
      helper_bn: r.helper_bn,
      helper_en: r.helper_en,
      // Branching is server-declared; the client evaluates only this rule.
      branch_parent_id: r.branch_parent_order == null
        ? null
        : String(byOrder.get(Number(r.branch_parent_order))?.id ?? ""),
      branch_show_when: r.branch_show_when,
    })),
  };
}

// ---------------------------------------------------------------------------
// Corroboration signals (ENG-08). Each is platform-observable and independent of
// what the user claimed, which is what makes confidence resistant to gaming.
// ---------------------------------------------------------------------------
export async function getReadinessSignals(userId: string | number) {
  const catalogue = await queryRows<Row>(
    "SELECT code, label_bn, label_en, source_check, fix_deeplink FROM readiness_confidence_signals WHERE is_active=1 ORDER BY sort_order"
  );
  const present = await detectSignals(userId);
  return catalogue.map((s) => ({
    code: s.code,
    label_bn: s.label_bn,
    label_en: s.label_en,
    fix_deeplink: s.fix_deeplink,
    present: present.includes(String(s.code)),
  }));
}

export async function detectSignals(userId: string | number): Promise<string[]> {
  const [u] = await queryRows<Row>(
    "SELECT is_kyc_verified, personal_info_completed FROM app_users WHERE id = ? LIMIT 1",
    [userId]
  );
  const one = async (sql: string, params: unknown[] = [userId]) => {
    const r = await queryRows<Row>(sql, params);
    return Number(r[0]?.n ?? 0) > 0;
  };

  const signals: string[] = [];
  // S1 needs both a verified document and the verified flag on the profile — one
  // without the other is not corroboration.
  const kycDocs = await one(
    "SELECT COUNT(*) AS n FROM app_user_kyc_documents WHERE user_id = ? AND status='verified'"
  );
  if (kycDocs && Number(u?.is_kyc_verified ?? 0) === 1) signals.push("S1");
  if (await one("SELECT COUNT(*) AS n FROM app_user_banking WHERE user_id = ?")) signals.push("S2");
  if (await one("SELECT COUNT(*) AS n FROM app_user_farm WHERE user_id = ?")) signals.push("S3");
  if (await one(
    `SELECT (SELECT COUNT(*) FROM orders WHERE user_id = ?)
          + (SELECT COUNT(*) FROM sale_listings WHERE user_id = ? AND status IN ('active','sold')) AS n`,
    [userId, userId]
  )) signals.push("S4");
  if (await one("SELECT COUNT(*) AS n FROM partner_applications WHERE user_id = ?")) signals.push("S5");
  if (await one("SELECT COUNT(*) AS n FROM user_learning_progress WHERE user_id = ?")) signals.push("S6");
  if (Number(u?.personal_info_completed ?? 0) === 1) signals.push("S7");
  return signals;
}

// POST app/finance/readiness/submit
// Part 2 reuses the stored Part 1 answers rather than making the user retake
// them (AC-R-19); the whole scored set is rewritten as a new immutable row.
export async function submitReadiness(payload: Row) {
  const userId = payload.user_id;
  if (!userId) throw new Error("A signed-in user is required.");
  const part = String(payload.part || "core") as "core" | "deep";
  const submitted = Array.isArray(payload.answers) ? (payload.answers as Row[]) : [];
  if (!submitted.length) throw new Error("No answers were submitted.");

  const set = await activeSet();
  if (!set) throw new Error("No active readiness question set is configured.");
  const rows = await loadQuestions(set.id as number);
  const questions = toEngineQuestions(rows);

  // Merge with the previous check's answers so a later Part 2 builds on Part 1.
  const prior = new Map<number, boolean>();
  if (part === "deep") {
    const last = await queryRows<Row>(
      `SELECT a.question_id, a.answer FROM readiness_answers a
         JOIN readiness_assessments s ON s.id = a.assessment_id
        WHERE s.user_id = ? AND a.presented = 1
        ORDER BY s.created_at DESC LIMIT 40`,
      [userId]
    );
    last.forEach((r) => {
      const qid = Number(r.question_id);
      if (!prior.has(qid) && r.answer != null) prior.set(qid, Number(r.answer) === 1);
    });
  }

  const merged = new Map<number, boolean>(prior);
  submitted.forEach((a) => merged.set(Number(a.question_id), Boolean(a.answer)));
  const answers: AnswerInput[] = [...merged].map(([question_id, answer]) => ({ question_id, answer }));

  const depth: Depth = part === "deep" ? "full" : "core";

  // MOB-RDY-13: every presented question in the submitted part must be answered.
  const askedThisPart = questions.filter((q) => (depth === "full" ? true : q.part === "core"));
  const missing = askedThisPart.filter((q) => {
    if (q.branch_parent_order != null) {
      const parent = questions.find((p) => p.sort_order === q.branch_parent_order);
      const parentAns = parent ? merged.get(parent.id) : undefined;
      if (parentAns !== (q.branch_show_when === "yes")) return false; // suppressed
    }
    return !merged.has(q.id);
  });
  if (missing.length) {
    throw new Error(`Please answer every question before submitting (${missing.length} remaining).`);
  }

  const signals = await detectSignals(userId as string);
  const result = scoreReadiness(questions, answers, depth, signals);

  const priorId = (
    await queryRows<Row>("SELECT id FROM readiness_assessments WHERE user_id = ? ORDER BY id DESC LIMIT 1", [userId])
  )[0]?.id ?? null;

  const assessmentId = await withTransaction(async (tx) => {
    const ins = await tx.execute(
      `INSERT INTO readiness_assessments
        (user_id, question_set_version, depth, score, grade, readiness_status, data_confidence,
         signals_present, signal_count, kyc_pct, enterprise_pct, financial_pct,
         gate_triggered, gate_reason, risk_flag, in_scope_weight, branch_weight, supersedes_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        userId, set.version, result.depth, result.score, result.grade, result.readiness_status,
        result.data_confidence, JSON.stringify(result.signals_present), result.signal_count,
        result.kyc_pct, result.enterprise_pct, result.financial_pct,
        result.gate_triggered ? 1 : 0, result.gate_reason, result.risk_flag,
        result.in_scope_weight, result.branch_weight, priorId,
      ]
    );
    const id = ins.insertId;
    for (const a of result.answers) {
      await tx.execute(
        `INSERT INTO readiness_answers
          (assessment_id, question_id, part, answer, presented, branch_suppressed, rating, weighted_value)
         VALUES (?,?,?,?,?,?,?,?)`,
        [id, a.question_id, a.part, a.answer == null ? null : a.answer ? 1 : 0,
         a.presented ? 1 : 0, a.branch_suppressed ? 1 : 0, a.rating, a.weighted_value]
      );
    }
    return id;
  });

  return shapeReadinessResult(assessmentId, rows, result);
}

// Farmer-safe result shape: strengths, gaps and ranked actions, with no weights.
function shapeReadinessResult(assessmentId: number, questionRows: Row[], result: ReturnType<typeof scoreReadiness>) {
  const byId = new Map(questionRows.map((r) => [Number(r.id), r]));
  const answered = result.answers.filter((a) => a.presented);

  const strengths = answered
    .filter((a) => a.answer === true)
    .map((a) => {
      const q = byId.get(a.question_id)!;
      return { bn: q.strength_bn, en: q.strength_en };
    })
    .filter((s) => s.bn);

  // Gaps and actions are ranked by weight descending so the highest-impact
  // item is first (MOB-RDY-18 / AC-R-13). The weight orders the list but is
  // never itself returned.
  const gapRows = answered
    .filter((a) => a.answer === false)
    .map((a) => ({ a, q: byId.get(a.question_id)! }))
    .sort((x, y) => Number(y.q.weight) - Number(x.q.weight));

  return {
    assessment_id: String(assessmentId),
    score: result.score,
    grade: result.grade,
    grade_label: gradeLabel(result.grade),
    readiness_status: result.readiness_status,
    data_confidence: result.data_confidence,
    depth: result.depth,
    categories: {
      kyc: result.kyc_pct,
      enterprise: result.enterprise_pct,
      financial: result.financial_pct,
    },
    gate_triggered: result.gate_triggered,
    gate_reason: result.gate_reason,
    risk_flag: result.risk_flag,
    signal_count: result.signal_count,
    signals_present: result.signals_present,
    strengths,
    gaps: gapRows.map(({ q }) => ({ bn: q.gap_bn, en: q.gap_en })),
    actions: gapRows.map(({ q }) => ({
      title_bn: q.action_title_bn,
      title_en: q.action_title_en,
      rationale_bn: q.action_rationale_bn,
      rationale_en: q.action_rationale_en,
      deeplink: q.action_deeplink,
    })),
  };
}

export async function getReadinessLatest(userId: string | number) {
  const rows = await queryRows<Row>(
    "SELECT * FROM readiness_assessments WHERE user_id = ? ORDER BY id DESC LIMIT 1",
    [userId]
  );
  const a = rows[0];
  if (!a) return null;

  const set = await activeSet();
  const questionRows = set ? await loadQuestions(set.id as number) : [];
  const stored = await queryRows<Row>(
    "SELECT question_id, part, answer, presented, branch_suppressed, rating, weighted_value FROM readiness_answers WHERE assessment_id = ?",
    [a.id]
  );

  const byId = new Map(questionRows.map((r) => [Number(r.id), r]));
  const result = {
    score: Number(a.score),
    grade: a.grade,
    readiness_status: a.readiness_status,
    data_confidence: a.data_confidence,
    depth: a.depth,
    kyc_pct: Number(a.kyc_pct),
    enterprise_pct: Number(a.enterprise_pct),
    financial_pct: Number(a.financial_pct),
    gate_triggered: Number(a.gate_triggered) === 1,
    gate_reason: a.gate_reason,
    risk_flag: a.risk_flag,
    signal_count: Number(a.signal_count),
    signals_present: typeof a.signals_present === "string" ? JSON.parse(a.signals_present) : (a.signals_present ?? []),
    answers: stored.map((s) => ({
      question_id: Number(s.question_id),
      sort_order: Number(byId.get(Number(s.question_id))?.sort_order ?? 0),
      part: s.part,
      answer: s.answer == null ? null : Number(s.answer) === 1,
      presented: Number(s.presented) === 1,
      branch_suppressed: Number(s.branch_suppressed) === 1,
      rating: Number(s.rating),
      weighted_value: Number(s.weighted_value),
    })),
  } as ReturnType<typeof scoreReadiness>;

  return {
    ...shapeReadinessResult(Number(a.id), questionRows, result),
    created_at: a.created_at,
  };
}

export async function getReadinessHistory(userId: string | number) {
  return queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, score, grade, readiness_status, data_confidence, depth, created_at
       FROM readiness_assessments WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
    [userId]
  );
}

// ---------------------------------------------------------------------------
// Loan products and quoting
// ---------------------------------------------------------------------------
export async function getLoanProducts() {
  const rows = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, code, name_bn, name_en, description_bn, description_en, icon,
            interest_rate_annual, interest_method, allowed_tenures_json, allowed_repayment_modes_json,
            min_amount, max_amount, amount_step, weeks_per_month, first_payment_offset_days,
            collateral_required, is_active, coming_soon, sort_order
       FROM loan_products ORDER BY sort_order, id`
  );
  const parse = (v: unknown) => {
    if (Array.isArray(v)) return v;
    if (typeof v === "string" && v.trim()) { try { return JSON.parse(v); } catch { return []; } }
    return [];
  };
  return rows.map((r) => ({
    ...r,
    allowed_tenures: parse(r.allowed_tenures_json),
    allowed_repayment_modes: parse(r.allowed_repayment_modes_json),
    is_active: Number(r.is_active) === 1,
    coming_soon: Number(r.coming_soon) === 1,
  }));
}

async function productTerms(productId: string | number): Promise<{ row: Row; terms: ProductTerms }> {
  const rows = await queryRows<Row>("SELECT * FROM loan_products WHERE id = ? LIMIT 1", [productId]);
  const row = rows[0];
  if (!row) throw new Error("That finance product was not found.");
  if (Number(row.is_active) !== 1) throw new Error("That finance product is not available yet.");
  return {
    row,
    terms: {
      interest_rate_annual: Number(row.interest_rate_annual),
      interest_method: row.interest_method as ProductTerms["interest_method"],
      weeks_per_month: Number(row.weeks_per_month || 4),
      first_payment_offset_days: Number(row.first_payment_offset_days || 30),
      grace_period_months: Number(row.grace_period_months || 0),
      processing_fee_pct: Number(row.processing_fee_pct || 0),
      processing_fee_flat: Number(row.processing_fee_flat || 0),
    },
  };
}

// POST app/finance/quote — the EMI calculator. Every quote shown is persisted so
// a later dispute about "what I was told" is answerable from the record (ENG-48).
export async function createQuote(payload: Row, persist = true) {
  const userId = payload.user_id;
  const { row, terms } = await productTerms(payload.product_id as string);

  const tenures: number[] = (() => {
    const v = row.allowed_tenures_json;
    if (Array.isArray(v)) return v.map(Number);
    try { return JSON.parse(String(v || "[]")).map(Number); } catch { return []; }
  })();
  const tenure = Number(payload.tenure_months);
  if (tenures.length && !tenures.includes(tenure)) {
    throw new Error("That repayment period is not available for this product.");
  }

  const modes: string[] = (() => {
    const v = row.allowed_repayment_modes_json;
    if (Array.isArray(v)) return v.map(String);
    try { return JSON.parse(String(v || "[]")).map(String); } catch { return []; }
  })();
  const mode = String(payload.repayment_mode || "monthly") as RepaymentMode;
  if (modes.length && !modes.includes(mode)) {
    throw new Error("That repayment option is not available for this product.");
  }

  const requested = Number(payload.amount);
  if (!Number.isFinite(requested) || requested <= 0) throw new Error("Enter the amount you need.");
  const { value: amount } = clampAmount(
    requested, Number(row.min_amount), Number(row.max_amount), Number(row.amount_step)
  );
  if (amount !== requested) {
    throw new Error(
      `Amount must be between ${Number(row.min_amount)} and ${Number(row.max_amount)}.`
    );
  }

  const quote = computeQuote(amount, tenure, mode, terms);

  // An approximate first due date until disbursement is known (MOB-LON-08C).
  const firstDue = new Date(Date.now() + terms.first_payment_offset_days * 86400_000)
    .toISOString().slice(0, 10);
  const preview = generateSchedule(quote, new Date(), terms).slice(0, 6);

  let quoteId: number | null = null;
  if (persist && userId) {
    const ins = await executeQuery(
      `INSERT INTO loan_quotes
        (user_id, loan_product_id, product_version, principal, tenure_months, repayment_mode,
         interest_rate_annual, interest_method, total_interest, processing_fee, total_payable,
         installment_count, emi_amount, final_emi_amount, effective_annual_rate)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [userId, row.id, row.version ?? "v1", quote.principal, quote.tenure_months, quote.repayment_mode,
       quote.interest_rate_annual, quote.interest_method, quote.total_interest, quote.processing_fee,
       quote.total_payable, quote.installment_count, quote.emi_amount, quote.final_emi_amount,
       quote.effective_annual_rate]
    );
    quoteId = ins.insertId;
  }

  // effective_annual_rate is deliberately withheld from the farmer payload
  // (ENG-43) — it reads as a competing headline rate and confuses more than
  // it discloses. Admin and lender surfaces get it from the stored row.
  const { effective_annual_rate, ...farmerSafe } = quote;
  return {
    quote_id: quoteId ? String(quoteId) : null,
    ...farmerSafe,
    first_due_estimate: firstDue,
    schedule_preview: preview,
  };
}

// Full projected schedule for the pre-submission preview screen (MOB-LON-08G).
export async function getQuoteSchedule(payload: Row) {
  const { terms } = await productTerms(payload.product_id as string);
  const quote = computeQuote(
    Number(payload.amount), Number(payload.tenure_months),
    String(payload.repayment_mode || "monthly") as RepaymentMode, terms
  );
  const rows = generateSchedule(quote, new Date(), terms);
  let balance = quote.total_payable;
  return {
    installment_count: quote.installment_count,
    total_payable: quote.total_payable,
    rows: rows.map((r) => {
      balance = Math.round((balance - r.amount_due) * 100) / 100;
      return { ...r, balance_after: Math.max(0, balance) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------
const REQUIRED_CONSENTS = [
  "profile_creation", "kyc_verification", "field_verification",
  "financial_assessment", "mpoweru_assessment", "share_with_lender",
];

// POST app/finance/applications — composite and transactional (API-02).
// A half-created credit application is far more damaging than a half-created
// order, so application, consents and the first event are one unit of work.
export async function createLoanApplication(payload: Row) {
  const userId = payload.user_id;
  if (!userId) throw new Error("A signed-in user is required.");

  const active = await queryRows<Row>(
    `SELECT application_code FROM loan_applications
      WHERE user_id = ? AND status NOT IN ('closed','withdrawn','cancelled','lender_declined','ineligible')
      LIMIT 1`,
    [userId]
  );
  if (active[0]) throw new Error("You already have an active application.");

  const consents = Array.isArray(payload.consents) ? (payload.consents as string[]) : [];
  const missing = REQUIRED_CONSENTS.filter((k) => !consents.includes(k));
  if (missing.length) {
    const [t] = await queryRows<Row>(
      "SELECT title_en FROM loan_consent_types WHERE consent_key = ? LIMIT 1", [missing[0]]
    );
    throw new Error(`Consent required: ${t?.title_en ?? missing[0]}`);
  }

  const { row: product } = await productTerms(payload.product_id as string);
  const quote = await createQuote({ ...payload, user_id: userId }, true);

  const [user] = await queryRows<Row>(
    "SELECT division, district, upazila FROM app_users WHERE id = ? LIMIT 1", [userId]
  );
  const code = `LON-APP-${Date.now()}`;

  const applicationId = await withTransaction(async (tx) => {
    const ins = await tx.execute(
      `INSERT INTO loan_applications
        (application_code, user_id, loan_product_id, linked_project_id, requested_amount,
         purpose_code, purpose_text, tenure_months, repayment_mode, quote_id, status,
         division, district, upazila, submitted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'submitted', ?,?,?, NOW())`,
      [code, userId, product.id, payload.linked_project_id ?? null, quote.principal,
       payload.purpose_code ?? "other", payload.purpose_text ?? null,
       quote.tenure_months, quote.repayment_mode, quote.quote_id,
       user?.division ?? null, user?.district ?? null, user?.upazila ?? null]
    );
    const id = ins.insertId;

    // One row per consent, each with its own version (MOB-LON-10A) — the record
    // stays granular even though the interaction is a single "agree to all".
    for (const key of REQUIRED_CONSENTS) {
      const [t] = await tx.query<Row>(
        "SELECT version FROM loan_consent_types WHERE consent_key = ? LIMIT 1", [key]
      );
      await tx.execute(
        `INSERT INTO loan_consents (application_id, user_id, consent_key, consent_version, status, channel, acting_user_id)
         VALUES (?,?,?,?, 'granted', 'app', ?)`,
        [id, userId, key, t?.version ?? "v1", userId]
      );
    }

    await tx.execute(
      `INSERT INTO loan_application_events (application_id, from_status, to_status, actor_type, actor_id, note_bn, note_en)
       VALUES (?, NULL, 'submitted', 'user', ?, ?, ?)`,
      [id, userId, "আবেদন জমা হয়েছে", "Application submitted"]
    );
    if (quote.quote_id) {
      await tx.execute("UPDATE loan_quotes SET application_id = ? WHERE id = ?", [id, quote.quote_id]);
    }
    return id;
  });

  return {
    application_id: String(applicationId),
    application_code: code,
    status: "submitted",
    quote: {
      principal: quote.principal,
      tenure_months: quote.tenure_months,
      repayment_mode: quote.repayment_mode,
      total_payable: quote.total_payable,
      emi_amount: quote.emi_amount,
      installment_count: quote.installment_count,
    },
  };
}

const STAGE_MAP: Array<{ index: number; states: string[]; bn: string; en: string; owner_bn: string; owner_en: string }> = [
  { index: 1, states: ["submitted"], bn: "আবেদন জমা হয়েছে", en: "Application submitted", owner_bn: "আপনি", owner_en: "You" },
  { index: 2, states: ["ineligible"], bn: "প্রাথমিক যাচাই", en: "Initial screening", owner_bn: "শাথী সেবা", owner_en: "Shathi Sheba" },
  { index: 3, states: ["kyc_in_progress"], bn: "কাগজপত্র সংগ্রহ", en: "Document collection", owner_bn: "মাঠ কর্মকর্তা", owner_en: "Field officer" },
  { index: 4, states: ["field_verification"], bn: "মাঠ যাচাই", en: "Field verification", owner_bn: "মাঠ কর্মকর্তা", owner_en: "Field officer" },
  { index: 5, states: ["behavioral_pending"], bn: "আচরণগত মূল্যায়ন", en: "Behavioural assessment", owner_bn: "আপনি", owner_en: "You" },
  { index: 6, states: ["under_assessment", "assessed"], bn: "ঝুঁকি মূল্যায়ন", en: "Risk assessment", owner_bn: "শাথী সেবা", owner_en: "Shathi Sheba" },
  { index: 7, states: ["pending_submission", "submitted_to_lender", "lender_review", "info_requested"], bn: "ব্যাংক/এমএফআই-তে প্রেরণ", en: "Sent to lender", owner_bn: "অংশীদার প্রতিষ্ঠান", owner_en: "Partner institution" },
  { index: 8, states: ["approved", "disbursed", "repaying", "closed"], bn: "সিদ্ধান্ত ও বিতরণ", en: "Decision & disbursement", owner_bn: "অংশীদার প্রতিষ্ঠান", owner_en: "Partner institution" },
];

export function stageForStatus(status: string): number {
  const hit = STAGE_MAP.find((s) => s.states.includes(status));
  return hit ? hit.index : 1;
}

export async function getLoanApplications(userId: string | number) {
  return queryRows<Row>(
    `SELECT CAST(a.id AS CHAR) AS id, a.application_code, a.status, a.requested_amount,
            a.tenure_months, a.repayment_mode, a.pending_user_action, a.created_at, a.submitted_at,
            p.name_bn AS product_bn, p.name_en AS product_en, p.icon AS product_icon,
            p.interest_rate_annual
       FROM loan_applications a JOIN loan_products p ON p.id = a.loan_product_id
      WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 20`,
    [userId]
  );
}

export async function getLoanApplicationDetail(userId: string | number, code: string) {
  const rows = await queryRows<Row>(
    `SELECT CAST(a.id AS CHAR) AS id, a.application_code, a.status, a.requested_amount, a.recommended_amount,
            a.approved_amount, a.purpose_code, a.purpose_text, a.tenure_months, a.repayment_mode,
            a.pending_user_action, a.district, a.created_at, a.submitted_at,
            p.name_bn AS product_bn, p.name_en AS product_en, p.icon AS product_icon,
            p.interest_rate_annual, p.stage_sla_json
       FROM loan_applications a JOIN loan_products p ON p.id = a.loan_product_id
      WHERE a.user_id = ? AND a.application_code = ? LIMIT 1`,
    [userId, code]
  );
  const app = rows[0];
  if (!app) throw new Error("Application not found.");

  const events = await queryRows<Row>(
    `SELECT from_status, to_status, actor_type, actor_name, note_bn, note_en, created_at
       FROM loan_application_events WHERE application_id = ? ORDER BY created_at, id`,
    [app.id]
  );
  const quote = (
    await queryRows<Row>(
      `SELECT principal, tenure_months, repayment_mode, total_interest, processing_fee, total_payable,
              installment_count, emi_amount, final_emi_amount
         FROM loan_quotes WHERE application_id = ? ORDER BY id DESC LIMIT 1`,
      [app.id]
    )
  )[0] ?? null;

  const currentStage = stageForStatus(String(app.status));
  return {
    ...app,
    quote,
    stage_index: currentStage,
    stage_total: 8,
    stages: STAGE_MAP.map((s) => ({
      index: s.index,
      title_bn: s.bn,
      title_en: s.en,
      owner_bn: s.owner_bn,
      owner_en: s.owner_en,
      state: s.index < currentStage ? "complete" : s.index === currentStage ? "active" : "pending",
    })),
    events,
  };
}

export async function withdrawLoanApplication(userId: string | number, code: string) {
  const rows = await queryRows<Row>(
    "SELECT id, status FROM loan_applications WHERE user_id = ? AND application_code = ? LIMIT 1",
    [userId, code]
  );
  const app = rows[0];
  if (!app) throw new Error("Application not found.");
  const terminal = ["approved", "disbursed", "repaying", "closed", "withdrawn", "cancelled"];
  if (terminal.includes(String(app.status))) {
    throw new Error("This application can no longer be withdrawn.");
  }
  await withTransaction(async (tx) => {
    await tx.execute("UPDATE loan_applications SET status='withdrawn', pending_user_action=NULL WHERE id = ?", [app.id]);
    await tx.execute(
      `INSERT INTO loan_application_events (application_id, from_status, to_status, actor_type, actor_id, note_bn, note_en)
       VALUES (?,?, 'withdrawn', 'user', ?, ?, ?)`,
      [app.id, app.status, userId, "আবেদন প্রত্যাহার করা হয়েছে", "Application withdrawn"]
    );
  });
  return { application_code: code, status: "withdrawn" };
}

// ---------------------------------------------------------------------------
// GET app/finance/summary — drives the home Finance Passport card and, once a
// loan is live, the repayment ticker. One request backs both (MOB-LON-38).
// ---------------------------------------------------------------------------
export async function getFinanceSummary(userId: string | number) {
  const [readiness] = await queryRows<Row>(
    `SELECT score, grade, readiness_status, data_confidence, depth, created_at
       FROM readiness_assessments WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  const [app] = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, application_code, status, pending_user_action, current_assessment_id
       FROM loan_applications WHERE user_id = ?
        AND status NOT IN ('withdrawn','cancelled') ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  const [account] = app
    ? await queryRows<Row>(
        `SELECT CAST(id AS CHAR) AS id, next_due_date, next_due_amount, installment_count,
                outstanding_total, days_past_due, status,
                (SELECT COUNT(*) FROM loan_repayment_schedule s WHERE s.loan_account_id = loan_accounts.id AND s.status='paid') AS paid_count
           FROM loan_accounts WHERE application_id = ? LIMIT 1`,
        [app.id]
      )
    : [];

  const disbursed = !!account;
  const graded = !!app?.current_assessment_id;

  // Precedence: loan_graded > loan_in_progress > readiness > readiness_partial > not_assessed
  let state = "not_assessed";
  if (graded) state = "loan_graded";
  else if (app) state = "loan_in_progress";
  else if (readiness) state = readiness.depth === "core" ? "readiness_partial" : "readiness";

  let nextPayment: Row | null = null;
  if (account?.next_due_date) {
    const due = new Date(String(account.next_due_date));
    const days = Math.ceil((due.getTime() - Date.now()) / 86400_000);
    nextPayment = {
      amount: Number(account.next_due_amount ?? 0),
      due_date: account.next_due_date,
      days_remaining: days,
      state: days < 0 ? "overdue" : days === 0 ? "due_today" : days <= 3 ? "due_soon" : "normal",
      installment_no: Number(account.paid_count ?? 0) + 1,
      total_installments: Number(account.installment_count ?? 0),
    };
  }

  return {
    state,
    grade: graded ? null : readiness?.grade ?? null,
    score: graded ? null : readiness ? Number(readiness.score) : null,
    readiness_status: readiness?.readiness_status ?? null,
    data_confidence: readiness?.data_confidence ?? null,
    depth: readiness?.depth ?? null,
    is_verified: graded,
    application_code: app?.application_code ?? null,
    stage: app ? stageForStatus(String(app.status)) : null,
    stage_index: app ? stageForStatus(String(app.status)) : null,
    stage_total: 8,
    pending_user_action: app?.pending_user_action ?? null,
    // The self-check retires at first disbursement, not at approval (D6) — an
    // approval can still fall through before money moves.
    can_take_readiness: !disbursed,
    can_apply: !app && ["bank_ready_indicative", "conditionally_ready", "project_ready"]
      .includes(String(readiness?.readiness_status ?? "")),
    next_payment: nextPayment,
  };
}

// The purpose picker in the apply flow. The admin-side `loan/purposes` resource
// is staff-only, so the app reads this app-shaped view instead of being granted
// access to a back-office surface.
export async function getLoanPurposes() {
  return queryRows<Row>(
    `SELECT code, label_bn, label_en, icon
       FROM loan_purposes WHERE is_active = 1 ORDER BY sort_order, id`
  );
}

export async function getLoanConsents(userId: string | number) {
  return queryRows<Row>(
    `SELECT t.consent_key, t.title_bn, t.title_en, t.description_bn, t.description_en,
            t.is_required, t.is_revocable, t.version,
            c.status, c.granted_at, c.revoked_at
       FROM loan_consent_types t
       LEFT JOIN loan_consents c
         ON c.consent_key = t.consent_key AND c.user_id = ?
      WHERE t.is_active = 1 AND t.collected_at_stage = 'apply'
      ORDER BY t.sort_order`,
    [userId]
  );
}
