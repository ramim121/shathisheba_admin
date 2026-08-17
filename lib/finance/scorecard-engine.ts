// The 100-point credit scorecard — SRS §19 / LRG §12–§23.
//
// Pure functions. Nothing here opens a connection, reads a clock or generates an
// id: the caller loads the model and the evidence, calls in, and persists what
// comes back. That is what makes ENG-33 achievable — an assessment is reproducible
// only if re-running the stored snapshot through the stored model version cannot
// consult anything else.
//
// Four properties this file exists to guarantee:
//
//   1. Missing data rates 0 and is flagged (ENG-18). It is never skipped and never
//      averaged away. Averaging away an absent criterion rewards the incomplete
//      application over the complete one that answered honestly and scored badly.
//
//   2. Hard stops are evaluated independently of, and before, the score (ENG-22).
//      A hard-stopped application still gets a full score, because the reviewer
//      needs to see both — "declined, and would have been a B" is a different
//      conversation from "declined, and was a D".
//
//   3. Safeguards never touch the inherent grade (ENG-26). They produce a second,
//      parallel result. A guarantee makes a loan safer to write; it does not make
//      the borrower stronger, and conflating the two is how a portfolio ends up
//      mispriced.
//
//   4. The total is the sum of the criterion scores as displayed. Each criterion
//      is rounded once, then summed — so a reviewer adding up the column on screen
//      always gets the number at the top.

export type Grade = "A" | "B" | "C" | "D";
export type Confidence = "high" | "medium" | "low";
export type ReadinessStatus =
  | "bank_ready"
  | "conditionally_ready"
  | "project_ready"
  | "development_required"
  | "currently_ineligible";

export type Criterion = {
  code: string;
  label_bn: string;
  label_en: string;
  weight: number;          // points out of 100
  layer: "quantitative" | "qualitative";
  metric: string;          // which derived metric its rules read
};

export type RatingRule = {
  criterion_code: string;
  sort_order: number;
  metric: string;
  min_value: number | null;   // inclusive
  max_value: number | null;   // exclusive
  rating: number;             // 0..5
  label_en?: string | null;
};

export type ModelThresholds = {
  version: string;
  grade_a_min: number;
  grade_b_min: number;
  grade_c_min: number;
  confidence_high_pct: number;
  confidence_med_pct: number;
};

// Everything the engine is allowed to look at. Assembled by the caller from the
// evidence tables and snapshotted verbatim onto the assessment.
export type AssessmentInput = {
  // Financial profile (§18.3.8)
  monthly_income_total: number | null;
  monthly_expense_total: number | null;
  proposed_installment: number | null;
  // Existing debt (§18.3.9)
  existing_installment_total: number | null;
  has_active_default: boolean;
  // Enterprise (§18.3.6)
  enterprise_years: number | null;
  // Platform behaviour (§18.3.10)
  platform_transactions: number | null;
  training_completed: number | null;
  // mPowerU (§18.5) — null when the assessment has not completed
  mpoweru_score: number | null;
  // Field verification (§18.4)
  verification_items_total: number;
  verification_items_verified: number;
  has_contradictory_verdict: boolean;
  // Documents (§18.3.5)
  documents_required: number;
  documents_verified: number;
  // Gates
  identity_verified: boolean;
  critical_kyc_present: boolean;
  consents_complete: boolean;
  purpose_permitted: boolean;
  // Data confidence (ENG-20)
  material_fields_total: number;
  material_fields_verified: number;
  // Safeguards (ENG-25)
  confirmed_safeguards: string[];
  // Request
  requested_amount: number;
};

export type CriterionResult = {
  criterion_code: string;
  label_bn: string;
  label_en: string;
  weight: number;
  metric_key: string;
  metric_value: number | null;
  computed_rating: number;
  effective_rating: number;
  override_rating: number | null;
  weighted_score: number;
  had_data: boolean;
  note_en: string | null;
};

export type HardStopRule = {
  code: string;
  label_bn: string;
  label_en: string;
  check_key: string;
  overridable: boolean;
};

export type HardStopHit = { code: string; label_bn: string; label_en: string; overridable: boolean };

export type PathwayRule = {
  sort_order: number;
  when_grade: string | null;
  when_confidence: string | null;
  when_hard_stop: boolean | null;
  when_safeguards: boolean | null;
  pathway_code: string;
  readiness_status: ReadinessStatus;
  amount_factor: number | null;
  label_bn: string;
  label_en: string;
};

export type ScorecardResult = {
  total_score: number;
  grade: Grade;
  inherent_grade: Grade;
  data_confidence: Confidence;
  verified_field_pct: number;
  hard_stop: boolean;
  hard_stops: HardStopHit[];
  readiness_status: ReadinessStatus;
  structured_readiness: ReadinessStatus | null;
  primary_pathway: string | null;
  pathway_label_bn: string | null;
  pathway_label_en: string | null;
  recommended_amount: number | null;
  recommended_rationale: string | null;
  reason_codes: string[];
  criteria: CriterionResult[];
  model_version: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * The derived values the rating rules are written against. A metric is `null`
 * when the evidence it needs is absent — which is different from zero, and the
 * difference is the whole of ENG-18. A farmer with no recorded debt has a debt
 * burden of 0 and should rate 5; a farmer whose debt was never asked about has
 * no ratio at all and must rate 0 with the gap made visible.
 */
export function deriveMetrics(input: AssessmentInput): Record<string, number | null> {
  const income = input.monthly_income_total;
  const expense = input.monthly_expense_total;
  const installment = input.proposed_installment;

  // Net surplus divided by the instalment this loan would add.
  let dscr: number | null = null;
  if (income != null && expense != null && installment != null && installment > 0) {
    dscr = (income - expense) / installment;
  }

  // Existing obligations as a share of income. Absent income makes it unknowable;
  // present income with no recorded debt is a genuine zero.
  let debtBurden: number | null = null;
  if (income != null && income > 0 && input.existing_installment_total != null) {
    debtBurden = input.existing_installment_total / income;
  }

  const verificationRatio =
    input.verification_items_total > 0
      ? input.verification_items_verified / input.verification_items_total
      : null;

  // No required documents is not the same as none verified; it means the
  // requirement was never set, so the criterion has nothing to judge.
  const documentRatio =
    input.documents_required > 0 ? input.documents_verified / input.documents_required : null;

  return {
    dscr,
    debt_burden_ratio: debtBurden,
    enterprise_years: input.enterprise_years,
    platform_transactions: input.platform_transactions,
    mpoweru_score: input.mpoweru_score,
    training_completed: input.training_completed,
    verification_ratio: verificationRatio,
    document_ratio: documentRatio,
  };
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

/**
 * ENG-17. Bands are min-inclusive, max-exclusive, evaluated in `sort_order`;
 * the first band containing the value wins. Returns null when no band matches,
 * which the caller treats as no-data rather than guessing.
 */
export function rateByRules(rules: RatingRule[], value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const ordered = [...rules].sort((a, b) => a.sort_order - b.sort_order);
  for (const rule of ordered) {
    const aboveMin = rule.min_value == null || value >= rule.min_value;
    const belowMax = rule.max_value == null || value < rule.max_value;
    if (aboveMin && belowMax) return rule.rating;
  }
  return null;
}

export function gradeFor(score: number, t: ModelThresholds): Grade {
  if (score >= t.grade_a_min) return "A";
  if (score >= t.grade_b_min) return "B";
  if (score >= t.grade_c_min) return "C";
  return "D";
}

/**
 * ENG-20. Confidence is about how much of the evidence someone other than the
 * applicant stood behind — not how much of it exists. An application can be
 * complete and still be low confidence.
 */
export function deriveConfidence(input: AssessmentInput, t: ModelThresholds): {
  level: Confidence;
  verified_pct: number;
} {
  const pct =
    input.material_fields_total > 0
      ? round2((input.material_fields_verified / input.material_fields_total) * 100)
      : 0;

  const fieldWorkDone =
    input.verification_items_total > 0 &&
    input.verification_items_verified === input.verification_items_total;
  const documentationComplete =
    input.documents_required > 0 && input.documents_verified === input.documents_required;

  if (
    pct >= t.confidence_high_pct &&
    fieldWorkDone &&
    input.mpoweru_score != null &&
    documentationComplete
  ) {
    return { level: "high", verified_pct: pct };
  }
  if (pct >= t.confidence_med_pct && input.identity_verified) {
    return { level: "medium", verified_pct: pct };
  }
  return { level: "low", verified_pct: pct };
}

// ---------------------------------------------------------------------------
// Hard stops (ENG-22/23) — before the score, independent of it
// ---------------------------------------------------------------------------

const HARD_STOP_CHECKS: Record<string, (i: AssessmentInput) => boolean> = {
  identity_unverified: (i) => !i.identity_verified,
  critical_kyc_missing: (i) => !i.critical_kyc_present,
  consent_missing: (i) => !i.consents_complete,
  active_default: (i) => i.has_active_default,
  // No income recorded at all, or expenses at least equal to income: there is
  // nothing to repay from. Zero income and zero expenses is "never asked", which
  // is caught by identity/KYC rather than pretended to be solvency.
  no_repayment_source: (i) =>
    i.monthly_income_total == null ||
    i.monthly_income_total <= 0 ||
    (i.monthly_expense_total != null && i.monthly_expense_total >= i.monthly_income_total),
  contradictory_evidence: (i) => i.has_contradictory_verdict,
  prohibited_purpose: (i) => !i.purpose_permitted,
};

export function evaluateHardStops(rules: HardStopRule[], input: AssessmentInput): HardStopHit[] {
  const hits: HardStopHit[] = [];
  for (const rule of rules) {
    const check = HARD_STOP_CHECKS[rule.check_key];
    // An unrecognised check_key must not silently pass. Someone configured a rule
    // the engine cannot evaluate; treating that as "no hard stop" would approve on
    // the strength of a control that was never run.
    if (!check) {
      throw new Error(
        `Hard-stop rule "${rule.code}" names check "${rule.check_key}", which the engine does not implement.`
      );
    }
    if (check(input)) {
      hits.push({
        code: rule.code,
        label_bn: rule.label_bn,
        label_en: rule.label_en,
        overridable: rule.overridable,
      });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Pathway (ENG-29/30/31)
// ---------------------------------------------------------------------------

/**
 * First match on the ordered rule set wins. A NULL condition means "any".
 *
 * `safeguardSpecificOnly` restricts the search to rules that explicitly require
 * safeguards. Without it the structured pass is toothless: a rule like
 * "B + medium confidence → MFI" carries `when_safeguards = NULL`, so it matches
 * whether or not safeguards exist and pre-empts the lower-priority
 * "B + safeguards → project" rule every time. The structured recommendation would
 * then always equal the inherent one, and ENG-25's two results would collapse
 * into one that ignores the safeguards it was supposed to price in.
 */
export function selectPathway(
  rules: PathwayRule[],
  ctx: { grade: Grade; confidence: Confidence; hardStop: boolean; hasSafeguards: boolean },
  safeguardSpecificOnly = false
): PathwayRule | null {
  const ordered = [...rules].sort((a, b) => a.sort_order - b.sort_order);
  for (const rule of ordered) {
    if (safeguardSpecificOnly && rule.when_safeguards !== true) continue;
    if (rule.when_hard_stop != null && rule.when_hard_stop !== ctx.hardStop) continue;
    if (rule.when_grade != null && rule.when_grade !== ctx.grade) continue;
    if (rule.when_confidence != null && rule.when_confidence !== ctx.confidence) continue;
    if (rule.when_safeguards != null && rule.when_safeguards !== ctx.hasSafeguards) continue;
    return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reason codes (ENG-27)
// ---------------------------------------------------------------------------

/**
 * Derived from the criterion results rather than from the raw evidence, so the
 * explanation a farmer reads and the score they were given cannot disagree.
 * Rating 4–5 is a strength, 0–2 is a gap, 3 is unremarkable and says nothing.
 */
const POSITIVE_BY_CRITERION: Record<string, string> = {
  cash_flow: "strong_cash_flow",
  existing_debt: "low_existing_debt",
  enterprise: "established_enterprise",
  transactions: "strong_transactions",
  mpoweru: "high_behavioural",
  field_validation: "verified_assets",
};

const NEGATIVE_BY_CRITERION: Record<string, string> = {
  cash_flow: "insufficient_surplus",
  existing_debt: "high_debt_burden",
  enterprise: "weak_enterprise",
  transactions: "limited_transactions",
  mpoweru: "low_behavioural",
  field_validation: "verification_incomplete",
  documentation: "missing_document",
};

export function deriveReasonCodes(criteria: CriterionResult[]): string[] {
  const codes: string[] = [];
  // Heaviest criteria first — the reasons that moved the score most come first.
  const ordered = [...criteria].sort((a, b) => b.weight - a.weight);
  for (const c of ordered) {
    if (!c.had_data || c.effective_rating <= 2) {
      const code = NEGATIVE_BY_CRITERION[c.criterion_code];
      if (code && !codes.includes(code)) codes.push(code);
    } else if (c.effective_rating >= 4) {
      const code = POSITIVE_BY_CRITERION[c.criterion_code];
      if (code && !codes.includes(code)) codes.push(code);
    }
  }
  return codes;
}

// ---------------------------------------------------------------------------
// The whole assessment
// ---------------------------------------------------------------------------

export function scoreApplication(args: {
  model: ModelThresholds;
  criteria: Criterion[];
  rules: RatingRule[];
  hardStopRules: HardStopRule[];
  pathwayRules: PathwayRule[];
  input: AssessmentInput;
  /** ENG-17 analyst overrides, keyed by criterion code. Recorded, not hidden. */
  overrides?: Record<string, { rating: number; reason: string }>;
}): ScorecardResult {
  const { model, criteria, rules, hardStopRules, pathwayRules, input } = args;
  const overrides = args.overrides ?? {};
  const metrics = deriveMetrics(input);

  const results: CriterionResult[] = criteria.map((criterion) => {
    const metricValue = metrics[criterion.metric] ?? null;
    const criterionRules = rules.filter((r) => r.criterion_code === criterion.code);
    const computed = rateByRules(criterionRules, metricValue);

    // ENG-18. No data is a 0 that says so, not an absence that disappears.
    const hadData = computed != null;
    const computedRating = computed ?? 0;

    const override = overrides[criterion.code];
    const effective = override ? override.rating : computedRating;

    return {
      criterion_code: criterion.code,
      label_bn: criterion.label_bn,
      label_en: criterion.label_en,
      weight: criterion.weight,
      metric_key: criterion.metric,
      metric_value: metricValue == null ? null : round2(metricValue),
      computed_rating: computedRating,
      effective_rating: effective,
      override_rating: override ? override.rating : null,
      weighted_score: round2((criterion.weight * effective) / 5),
      had_data: hadData,
      note_en: hadData ? null : "No data captured for this criterion",
    };
  });

  // Sum the rounded parts, so the column on screen adds up to the headline.
  const total = round2(results.reduce((sum, r) => sum + r.weighted_score, 0));

  const hardStops = evaluateHardStops(hardStopRules, input);
  const hasHardStop = hardStops.length > 0;

  const grade = gradeFor(total, model);
  const { level: confidence, verified_pct } = deriveConfidence(input, model);
  const hasSafeguards = input.confirmed_safeguards.length > 0;

  // ENG-25/26. Two results: what the borrower is, and what the structure makes
  // possible. The inherent grade is computed without safeguards and never moves.
  const inherent = selectPathway(pathwayRules, {
    grade,
    confidence,
    hardStop: hasHardStop,
    hasSafeguards: false,
  });
  // Only a rule written for safeguards counts as a structured result. If none
  // matches, the safeguards did not change the recommendation and saying so is
  // more honest than restating the inherent one under a different name.
  const structured = hasSafeguards
    ? selectPathway(
        pathwayRules,
        { grade, confidence, hardStop: hasHardStop, hasSafeguards: true },
        true
      )
    : null;

  const chosen = structured ?? inherent;

  let recommendedAmount: number | null = null;
  let recommendedRationale: string | null = null;
  if (chosen?.amount_factor != null) {
    recommendedAmount = round2(input.requested_amount * chosen.amount_factor);
    if (recommendedAmount < input.requested_amount) {
      recommendedRationale =
        `Grade ${grade} with ${confidence} data confidence supports ` +
        `${Math.round(chosen.amount_factor * 100)}% of the requested amount.`;
    }
  }

  return {
    total_score: total,
    grade,
    inherent_grade: grade,
    data_confidence: confidence,
    verified_field_pct: verified_pct,
    hard_stop: hasHardStop,
    hard_stops: hardStops,
    // ENG-21 R6: a hard stop overrides every other rule.
    readiness_status: hasHardStop ? "currently_ineligible" : inherent?.readiness_status ?? "development_required",
    structured_readiness: structured && !hasHardStop ? structured.readiness_status : null,
    primary_pathway: chosen?.pathway_code ?? null,
    pathway_label_bn: chosen?.label_bn ?? null,
    pathway_label_en: chosen?.label_en ?? null,
    recommended_amount: hasHardStop ? null : recommendedAmount,
    recommended_rationale: hasHardStop ? null : recommendedRationale,
    reason_codes: deriveReasonCodes(results),
    criteria: results,
    model_version: model.version,
  };
}
