// Finance Readiness scoring engine — SRS §7 (ENG-01…ENG-12) / KB §5.2–5.3.
//
// Pure functions with no database access, so the whole instrument is unit
// testable and every score is reproducible from its stored inputs (P8).
//
// The two ideas that make this engine correct, and which are easy to get wrong:
//
//   * Out of scope vs branch-suppressed are NOT the same thing. Part 2 not taken
//     is normalised away — the user is scored only on what they were asked.
//     A question suppressed by branching (they have never borrowed, so the
//     repayment questions do not apply) stays in the denominator at HALF credit.
//     Absence of a repayment record is information: it must not be silently
//     ignored, and it must not be punished like a default.
//
//   * Confidence is never derived from the answers. It measures how much of the
//     self-declaration the platform can already corroborate from its own data.
//     That is the anti-gaming defence (P5): answering everything favourably
//     raises the score but cannot raise confidence.

export type Part = "core" | "deep";
export type Depth = "core" | "full";
export type Category = "kyc" | "enterprise" | "financial";
export type Grade = "A" | "B" | "C" | "D";
export type ReadinessStatus =
  | "bank_ready_indicative"
  | "conditionally_ready"
  | "project_ready"
  | "development_required"
  | "currently_ineligible";
export type Confidence = "low" | "medium";

export type Question = {
  id: number;
  sort_order: number;
  part: Part;
  category: Category;
  weight: number;
  flag: "gate" | "risk" | null;
  flag_code: string | null;
  branch_parent_order: number | null;
  branch_show_when: "yes" | "no" | null;
};

export type AnswerInput = { question_id: number; answer: boolean };

export type ScoredAnswer = {
  question_id: number;
  sort_order: number;
  part: Part;
  answer: boolean | null;
  presented: boolean;
  branch_suppressed: boolean;
  rating: 0 | 5;
  weighted_value: number;
};

export type ReadinessResult = {
  score: number;
  grade: Grade;
  readiness_status: ReadinessStatus;
  data_confidence: Confidence;
  depth: Depth;
  kyc_pct: number;
  enterprise_pct: number;
  financial_pct: number;
  in_scope_weight: number;
  branch_weight: number;
  gate_triggered: boolean;
  gate_reason: string | null;
  risk_flag: string | null;
  signal_count: number;
  signals_present: string[];
  answers: ScoredAnswer[];
};

// Half-up to `dp`. Weights are small decimals; scores are 2dp.
function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * Which questions are actually put to the user, given the parts completed and
 * the answers so far. Branching is declared by the data (branch_parent_order +
 * branch_show_when), never hard-coded — the same rule the mobile client follows.
 */
export function resolvePresentation(
  questions: Question[],
  answers: Map<number, boolean>,
  depth: Depth
): { presented: Question[]; suppressed: Question[] } {
  const inScope = questions.filter((q) => (depth === "full" ? true : q.part === "core"));
  const byOrder = new Map(questions.map((q) => [q.sort_order, q]));

  const presented: Question[] = [];
  const suppressed: Question[] = [];

  for (const q of inScope) {
    if (q.branch_parent_order == null || q.branch_show_when == null) {
      presented.push(q);
      continue;
    }
    const parent = byOrder.get(q.branch_parent_order);
    const parentAnswer = parent ? answers.get(parent.id) : undefined;
    const wanted = q.branch_show_when === "yes";
    // An unanswered parent cannot show its children either.
    if (parentAnswer === wanted) presented.push(q);
    else suppressed.push(q);
  }
  return { presented, suppressed };
}

/**
 * ENG-01/ENG-02. Score normalised to the scope actually completed, with
 * branch-suppressed weight retained at half credit (ENG-05A).
 */
export function scoreReadiness(
  questions: Question[],
  rawAnswers: AnswerInput[],
  depth: Depth,
  signals: string[] = []
): ReadinessResult {
  const answers = new Map<number, boolean>(rawAnswers.map((a) => [a.question_id, !!a.answer]));
  const { presented, suppressed } = resolvePresentation(questions, answers, depth);

  const inScopeWeight = presented.reduce((s, q) => s + q.weight, 0);
  const branchWeight = suppressed.reduce((s, q) => s + q.weight, 0);
  const earned = presented.reduce((s, q) => s + (answers.get(q.id) ? q.weight : 0), 0);
  const neutralCredit = 0.5 * branchWeight;

  const denominator = inScopeWeight + branchWeight;
  const score = denominator > 0 ? round(((earned + neutralCredit) / denominator) * 100, 2) : 0;

  // Category percentages use each category's in-scope maximum, not the full model.
  const pct = (cat: Category): number => {
    const inCat = presented.filter((q) => q.category === cat);
    const max = inCat.reduce((s, q) => s + q.weight, 0);
    if (max <= 0) return 0;
    const got = inCat.reduce((s, q) => s + (answers.get(q.id) ? q.weight : 0), 0);
    return round((got / max) * 100, 2);
  };

  const grade = gradeFor(score);

  // Gate and risk flag are looked up by flag, not by question number, so
  // renumbering the instrument in admin cannot silently disable them.
  const gateQ = presented.find((q) => q.flag === "gate");
  const gateTriggered = !!gateQ && answers.get(gateQ.id) === false;
  const riskQ = presented.find((q) => q.flag === "risk");
  const riskTriggered = !!riskQ && answers.get(riskQ.id) === false;

  const enterprisePct = pct("enterprise");
  const confidence = deriveConfidence(depth, signals);
  const status = deriveStatus({
    score,
    depth,
    confidence,
    enterprisePct,
    gateTriggered,
    riskTriggered,
  });

  const scored: ScoredAnswer[] = [
    ...presented.map((q) => {
      const a = answers.get(q.id) ?? false;
      return {
        question_id: q.id,
        sort_order: q.sort_order,
        part: q.part,
        answer: a,
        presented: true,
        branch_suppressed: false,
        rating: (a ? 5 : 0) as 0 | 5,
        weighted_value: round(a ? q.weight : 0, 4),
      };
    }),
    ...suppressed.map((q) => ({
      question_id: q.id,
      sort_order: q.sort_order,
      part: q.part,
      answer: null,
      presented: false,
      branch_suppressed: true,
      rating: 0 as const,
      weighted_value: round(0.5 * q.weight, 4),
    })),
  ].sort((a, b) => a.sort_order - b.sort_order);

  return {
    score,
    grade,
    readiness_status: status,
    data_confidence: confidence,
    depth,
    kyc_pct: pct("kyc"),
    enterprise_pct: enterprisePct,
    financial_pct: pct("financial"),
    in_scope_weight: round(inScopeWeight, 4),
    branch_weight: round(branchWeight, 4),
    gate_triggered: gateTriggered,
    gate_reason: gateTriggered ? gateQ?.flag_code ?? "NO_NID" : null,
    risk_flag: riskTriggered ? riskQ?.flag_code ?? "ARREARS" : null,
    signal_count: signals.length,
    signals_present: signals,
    answers: scored,
  };
}

/** ENG-03. Bands are inclusive at the lower bound. */
export function gradeFor(score: number): Grade {
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

/**
 * ENG-08A. Confidence responds only to independently-held evidence, and can
 * never reach `high` for a self-declared check — that is reserved for
 * field-verified loan assessments.
 */
export function deriveConfidence(depth: Depth, signals: string[]): Confidence {
  const hasVerifiedNid = signals.includes("S1");
  if (depth !== "full") return "low";
  if (signals.length < 3) return "low";
  if (!hasVerifiedNid) return "low";
  return "medium";
}

/** ENG-07. Evaluated top-down; first match wins. */
export function deriveStatus(input: {
  score: number;
  depth: Depth;
  confidence: Confidence;
  enterprisePct: number;
  gateTriggered: boolean;
  riskTriggered: boolean;
}): ReadinessStatus {
  const { score, depth, confidence, enterprisePct, gateTriggered, riskTriggered } = input;
  if (gateTriggered) return "currently_ineligible";
  if (riskTriggered) return "development_required";
  if (score >= 80 && confidence === "medium" && depth === "full") return "bank_ready_indicative";
  if (score >= 80) return "conditionally_ready";
  if (score >= 70) return "conditionally_ready";
  if (score >= 60 && enterprisePct >= 70) return "project_ready";
  if (score >= 60) return "development_required";
  return "development_required";
}

/** ENG-04. The stored grade stays `D`; only the label softens (P4). */
export function gradeLabel(grade: Grade): { bn: string; en: string } {
  switch (grade) {
    case "A": return { bn: "চমৎকার", en: "Excellent" };
    case "B": return { bn: "ভালো", en: "Good" };
    case "C": return { bn: "মোটামুটি", en: "Marginal" };
    default:  return { bn: "উন্নতি প্রয়োজন", en: "Needs development" };
  }
}
