// Unit tests for lib/finance/scorecard-engine.ts — SRS §19, §25.
// No database. TypeScript is transpiled in memory, so there is no build step.
//
//   node scripts/test-scorecard-engine.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

async function loadTs(relative) {
  const source = readFileSync(path.join(root, relative), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js, "utf8").toString("base64"));
}

const E = await loadTs("lib/finance/scorecard-engine.ts");

let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${ok ? "" : `  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

// ---------------------------------------------------------------------------
// The seeded model, mirrored from migration 024
// ---------------------------------------------------------------------------
const MODEL = {
  version: "sc-v1",
  grade_a_min: 80, grade_b_min: 70, grade_c_min: 60,
  confidence_high_pct: 80, confidence_med_pct: 50,
};

const CRITERIA = [
  { code: "cash_flow",        label_bn: "", label_en: "Cash flow",        weight: 25, layer: "quantitative", metric: "dscr" },
  { code: "existing_debt",    label_bn: "", label_en: "Existing debt",    weight: 15, layer: "quantitative", metric: "debt_burden_ratio" },
  { code: "enterprise",       label_bn: "", label_en: "Enterprise",       weight: 10, layer: "quantitative", metric: "enterprise_years" },
  { code: "transactions",     label_bn: "", label_en: "Transactions",     weight: 10, layer: "quantitative", metric: "platform_transactions" },
  { code: "mpoweru",          label_bn: "", label_en: "mPowerU",          weight: 20, layer: "qualitative",  metric: "mpoweru_score" },
  { code: "management",       label_bn: "", label_en: "Management",       weight: 8,  layer: "qualitative",  metric: "training_completed" },
  { code: "field_validation", label_bn: "", label_en: "Field validation", weight: 7,  layer: "qualitative",  metric: "verification_ratio" },
  { code: "documentation",    label_bn: "", label_en: "Documentation",    weight: 5,  layer: "qualitative",  metric: "document_ratio" },
];

const band = (code, metric, rows) =>
  rows.map(([sort_order, min_value, max_value, rating]) => ({
    criterion_code: code, metric, sort_order, min_value, max_value, rating,
  }));

const RULES = [
  ...band("cash_flow", "dscr", [[1, 2, null, 5], [2, 1.5, 2, 4], [3, 1.2, 1.5, 3], [4, 1, 1.2, 2], [5, null, 1, 1]]),
  ...band("existing_debt", "debt_burden_ratio", [[1, null, 0.1, 5], [2, 0.1, 0.25, 4], [3, 0.25, 0.4, 3], [4, 0.4, 0.6, 2], [5, 0.6, null, 1]]),
  ...band("enterprise", "enterprise_years", [[1, 5, null, 5], [2, 3, 5, 4], [3, 2, 3, 3], [4, 1, 2, 2], [5, null, 1, 1]]),
  ...band("transactions", "platform_transactions", [[1, 12, null, 5], [2, 6, 12, 4], [3, 3, 6, 3], [4, 1, 3, 2], [5, null, 1, 0]]),
  ...band("mpoweru", "mpoweru_score", [[1, 80, null, 5], [2, 65, 80, 4], [3, 50, 65, 3], [4, 35, 50, 2], [5, null, 35, 1]]),
  ...band("management", "training_completed", [[1, 8, null, 5], [2, 5, 8, 4], [3, 3, 5, 3], [4, 1, 3, 2], [5, null, 1, 1]]),
  ...band("field_validation", "verification_ratio", [[1, 0.9, null, 5], [2, 0.7, 0.9, 4], [3, 0.5, 0.7, 3], [4, 0.25, 0.5, 2], [5, null, 0.25, 1]]),
  ...band("documentation", "document_ratio", [[1, 1, null, 5], [2, 0.8, 1, 4], [3, 0.6, 0.8, 3], [4, 0.3, 0.6, 2], [5, null, 0.3, 1]]),
];

const HARD_STOPS = [
  ["identity_unverified", "identity_unverified", true],
  ["critical_kyc_missing", "critical_kyc_missing", true],
  ["consent_missing", "consent_missing", false],
  ["active_default", "active_default", false],
  ["no_repayment_source", "no_repayment_source", true],
  ["contradictory_evidence", "contradictory_evidence", true],
  ["prohibited_purpose", "prohibited_purpose", false],
].map(([code, check_key, overridable]) => ({ code, check_key, overridable, label_bn: "", label_en: code }));

const PATHWAYS = [
  [1, null, null, true, null, "currently_decline", "currently_ineligible", null],
  [2, "A", "high", false, null, "submit_to_bank", "bank_ready", 1],
  [3, "A", null, false, null, "additional_verification", "conditionally_ready", 1],
  [4, "B", "high", false, null, "submit_to_bank", "bank_ready", 0.9],
  [5, "B", "medium", false, null, "submit_to_mfi", "conditionally_ready", 0.8],
  [6, "B", null, false, true, "join_shathi_project", "project_ready", 0.8],
  [7, "B", null, false, null, "additional_verification", "development_required", null],
  [8, "C", null, false, true, "join_shathi_project", "project_ready", 0.6],
  [9, "C", null, false, null, "reduced_loan_limit", "development_required", 0.5],
  [10, "D", null, false, null, "complete_development", "development_required", null],
].map(([sort_order, when_grade, when_confidence, when_hard_stop, when_safeguards, pathway_code, readiness_status, amount_factor]) => ({
  sort_order, when_grade, when_confidence, when_hard_stop, when_safeguards,
  pathway_code, readiness_status, amount_factor, label_bn: "", label_en: pathway_code,
}));

// A clean, fully evidenced, strong applicant. Individual tests degrade it.
const PERFECT = {
  monthly_income_total: 60000, monthly_expense_total: 30000, proposed_installment: 10000,
  existing_installment_total: 3000, has_active_default: false,
  enterprise_years: 8, platform_transactions: 20, training_completed: 10,
  mpoweru_score: 90,
  verification_items_total: 11, verification_items_verified: 11, has_contradictory_verdict: false,
  documents_required: 6, documents_verified: 6,
  identity_verified: true, critical_kyc_present: true, consents_complete: true, purpose_permitted: true,
  material_fields_total: 40, material_fields_verified: 40,
  confirmed_safeguards: [], requested_amount: 100000,
};

const run = (input, overrides) =>
  E.scoreApplication({
    model: MODEL, criteria: CRITERIA, rules: RULES,
    hardStopRules: HARD_STOPS, pathwayRules: PATHWAYS,
    input: { ...PERFECT, ...input }, overrides,
  });

// ---------------------------------------------------------------------------
section("ENG-15 — structure");
check("weights total 100", CRITERIA.reduce((s, c) => s + c.weight, 0), 100);
check("quantitative layer totals 60", CRITERIA.filter((c) => c.layer === "quantitative").reduce((s, c) => s + c.weight, 0), 60);
check("qualitative layer totals 40", CRITERIA.filter((c) => c.layer === "qualitative").reduce((s, c) => s + c.weight, 0), 40);

section("ENG-16 — rating to weighted score");
{
  const perfect = run({});
  check("all-5 ratings score exactly 100", perfect.total_score, 100);
  check("grade A", perfect.grade, "A");
  const cf = perfect.criteria.find((c) => c.criterion_code === "cash_flow");
  check("cash flow earns its full 25", cf.weighted_score, 25);
  check("rating 5 = 100% earned", cf.effective_rating, 5);
}
{
  // rating 3 on a weight-25 criterion is 60% of 25 = 15
  const r = run({ monthly_income_total: 60000, monthly_expense_total: 45800, proposed_installment: 10000 });
  const cf = r.criteria.find((c) => c.criterion_code === "cash_flow");
  check("DSCR 1.42 rates 3", cf.computed_rating, 3);
  check("rating 3 on weight 25 = 15.00", cf.weighted_score, 15);
}
check("total is the sum of the displayed parts", (() => {
  const r = run({ mpoweru_score: 60, enterprise_years: 2.5, training_completed: 4 });
  return Math.round(r.criteria.reduce((s, c) => s + c.weighted_score, 0) * 100) / 100 === r.total_score;
})(), true);

section("ENG-17 — bands are min-inclusive, max-exclusive");
check("DSCR exactly 2.0 rates 5", E.rateByRules(RULES.filter((r) => r.criterion_code === "cash_flow"), 2.0), 5);
check("DSCR 1.9999 rates 4", E.rateByRules(RULES.filter((r) => r.criterion_code === "cash_flow"), 1.9999), 4);
check("DSCR exactly 1.5 rates 4", E.rateByRules(RULES.filter((r) => r.criterion_code === "cash_flow"), 1.5), 4);
check("DSCR 0.5 rates 1", E.rateByRules(RULES.filter((r) => r.criterion_code === "cash_flow"), 0.5), 1);
check("null value rates null, not 0", E.rateByRules(RULES.filter((r) => r.criterion_code === "cash_flow"), null), null);

section("ENG-17 — analyst override");
{
  const r = run({}, { mpoweru: { rating: 2, reason: "Contradicted by field visit" } });
  const m = r.criteria.find((c) => c.criterion_code === "mpoweru");
  check("computed rating is preserved alongside the override", m.computed_rating, 5);
  check("override rating is recorded", m.override_rating, 2);
  check("override drives the weighted score", m.weighted_score, 8);
  check("override lowers the total", r.total_score, 88);
}

section("ENG-18 — missing data rates 0 and is flagged");
{
  const r = run({ mpoweru_score: null });
  const m = r.criteria.find((c) => c.criterion_code === "mpoweru");
  check("no mPowerU rates 0", m.computed_rating, 0);
  check("no mPowerU is flagged as no-data", m.had_data, false);
  check("the 20 points are lost, not redistributed", r.total_score, 80);
  check("still graded on the full 100", r.grade, "A");
}
{
  // No income at all: DSCR and debt ratio both become unknowable.
  const r = run({ monthly_income_total: null });
  const cf = r.criteria.find((c) => c.criterion_code === "cash_flow");
  const ed = r.criteria.find((c) => c.criterion_code === "existing_debt");
  check("no income leaves DSCR without data", cf.had_data, false);
  check("no income leaves debt ratio without data", ed.had_data, false);
}
{
  // Zero recorded debt with known income is a real 0, and rates 5.
  const r = run({ existing_installment_total: 0 });
  const ed = r.criteria.find((c) => c.criterion_code === "existing_debt");
  check("zero debt with known income has data", ed.had_data, true);
  check("zero debt rates 5", ed.computed_rating, 5);
}

section("ENG-19 — grade bands");
check("80.00 is an A", E.gradeFor(80, MODEL), "A");
check("79.99 is a B", E.gradeFor(79.99, MODEL), "B");
check("70.00 is a B", E.gradeFor(70, MODEL), "B");
check("69.99 is a C", E.gradeFor(69.99, MODEL), "C");
check("60.00 is a C", E.gradeFor(60, MODEL), "C");
check("59.99 is a D", E.gradeFor(59.99, MODEL), "D");
check("0 is a D", E.gradeFor(0, MODEL), "D");

section("ENG-20 — data confidence");
check("fully verified + field work + mPowerU + docs = high", run({}).data_confidence, "high");
check("high confidence reports 100%", run({}).verified_field_pct, 100);
check("field work incomplete cannot be high", run({ verification_items_verified: 10 }).data_confidence, "medium");
check("no mPowerU cannot be high", run({ mpoweru_score: null }).data_confidence, "medium");
check("documents incomplete cannot be high", run({ documents_verified: 5 }).data_confidence, "medium");
check("60% verified with identity is medium", run({ material_fields_verified: 24, verification_items_verified: 8 }).data_confidence, "medium");
check("40% verified is low", run({ material_fields_verified: 16, verification_items_verified: 4 }).data_confidence, "low");

section("ENG-22 — hard stops are independent of and prior to the score");
{
  const r = run({ consents_complete: false });
  check("missing consent is a hard stop", r.hard_stop, true);
  check("the code is reported", r.hard_stops.map((h) => h.code), ["consent_missing"]);
  check("the score is still computed in full", r.total_score, 100);
  check("the grade is still reported", r.grade, "A");
  check("readiness is overridden to currently_ineligible", r.readiness_status, "currently_ineligible");
  check("pathway is currently_decline", r.primary_pathway, "currently_decline");
  check("no recommended amount under a hard stop", r.recommended_amount, null);
}
check("unverified identity hard stops", run({ identity_verified: false }).hard_stop, true);
check("active default hard stops", run({ has_active_default: true }).hard_stop, true);
check("contradictory verdict hard stops", run({ has_contradictory_verdict: true }).hard_stop, true);
check("prohibited purpose hard stops", run({ purpose_permitted: false }).hard_stop, true);
check("expenses exceeding income hard stops", run({ monthly_expense_total: 70000 }).hard_stop, true);
check("several hard stops all reported", run({ identity_verified: false, consents_complete: false }).hard_stops.length, 2);
check("consent_missing is not overridable", HARD_STOPS.find((h) => h.code === "consent_missing").overridable, false);
{
  // A configured rule the engine cannot evaluate must fail loudly, not pass.
  let threw = false;
  try {
    E.evaluateHardStops([{ code: "x", check_key: "not_implemented", label_bn: "", label_en: "", overridable: false }], PERFECT);
  } catch { threw = true; }
  check("an unimplemented check_key throws rather than passing", threw, true);
}

section("ENG-21 / ENG-29 — readiness and pathway");
// Two worked applicants, arithmetic spelled out so the expected grade is checked
// rather than assumed. Both are medium confidence (28/40 verified, identity done).
//
// GRADE_B = 25 + 15 + 6 + 4 + 12 + 3.2 + 5.6 + 4 = 74.80
const GRADE_B = {
  enterprise_years: 2, platform_transactions: 2, training_completed: 2,
  mpoweru_score: 55, verification_items_verified: 8,
  documents_verified: 5, material_fields_verified: 28,
};
// GRADE_C = 25 + 15 + 6 + 4 + 8 + 3.2 + 2.8 + 4 = 68.00
const GRADE_C = { ...GRADE_B, mpoweru_score: 40, verification_items_verified: 5 };

check("A + high + clean = bank_ready", run({}).readiness_status, "bank_ready");
check("A + high + clean = submit_to_bank", run({}).primary_pathway, "submit_to_bank");
check("the worked B case really is 74.80", run(GRADE_B).total_score, 74.8);
check("the worked C case really is 68.00", run(GRADE_C).total_score, 68);
{
  const r = run(GRADE_B);
  check("B scores as a B", r.grade, "B");
  check("B + medium routes to an MFI", r.primary_pathway, "submit_to_mfi");
  check("B + medium is conditionally_ready", r.readiness_status, "conditionally_ready");
}
{
  // A high-A with medium confidence must not go straight to a bank.
  const r = run({ mpoweru_score: 70, documents_verified: 5, material_fields_verified: 30 });
  check("A + medium is still an A", r.grade, "A");
  check("A + medium asks for more verification", r.primary_pathway, "additional_verification");
}
{
  const r = run({ mpoweru_score: null, enterprise_years: 0.5, training_completed: 0, platform_transactions: 0 });
  check("weak applicant grades D", r.grade, "D");
  check("D routes to a development plan", r.primary_pathway, "complete_development");
  check("D is development_required", r.readiness_status, "development_required");
}

section("ENG-25/26 — safeguards never move the inherent grade");
{
  const bare = run(GRADE_C);
  const safe = run({ ...GRADE_C, confirmed_safeguards: ["b2b_buyer"] });
  check("safeguards do not change the score", safe.total_score, bare.total_score);
  check("safeguards do not change the grade", safe.grade, bare.grade);
  check("inherent grade is unchanged", safe.inherent_grade, bare.inherent_grade);
  check("safeguards produce a structured readiness", safe.structured_readiness, "project_ready");
  check("without safeguards there is no structured readiness", bare.structured_readiness, null);
  check("safeguards route to a project", safe.primary_pathway, "join_shathi_project");
  check("the inherent route without safeguards is a reduced limit", bare.primary_pathway, "reduced_loan_limit");
}
{
  // Grade A has no safeguard-specific rule, so safeguards change nothing and the
  // engine says so rather than restating the inherent route as "structured".
  const safe = run({ confirmed_safeguards: ["guarantee"] });
  check("no safeguard rule for grade A leaves structured readiness null", safe.structured_readiness, null);
  check("grade A still routes to a bank", safe.primary_pathway, "submit_to_bank");
}
{
  // A hard stop is not survivable by adding a guarantee.
  const r = run({ consents_complete: false, confirmed_safeguards: ["guarantee", "insurance"] });
  check("safeguards cannot clear a hard stop", r.readiness_status, "currently_ineligible");
  check("no structured readiness under a hard stop", r.structured_readiness, null);
}

section("ENG-31 — recommended amount");
{
  const r = run({});
  check("grade A gets the full requested amount", r.recommended_amount, 100000);
  check("no rationale when nothing was reduced", r.recommended_rationale, null);
}
{
  const r = run(GRADE_C);
  check("grade C is offered half", r.recommended_amount, 50000);
  check("a reduction carries a rationale", typeof r.recommended_rationale, "string");
}
{
  const r = run(GRADE_B);
  check("grade B is offered 80%", r.recommended_amount, 80000);
}
{
  // Safeguards can raise the offer without touching the grade.
  const r = run({ ...GRADE_C, confirmed_safeguards: ["b2b_buyer"] });
  check("safeguards lift a C offer from 50% to 60%", r.recommended_amount, 60000);
  check("but the grade is untouched", r.grade, "C");
}

section("ENG-27 — reason codes");
{
  const r = run({});
  check("a strong applicant gets only positive codes", r.reason_codes.every((c) => !c.startsWith("insufficient") && !c.startsWith("high_debt")), true);
  check("strong cash flow is reported first (heaviest criterion)", r.reason_codes[0], "strong_cash_flow");
}
{
  const r = run({ mpoweru_score: 20, existing_installment_total: 45000 });
  check("high debt is called out", r.reason_codes.includes("high_debt_burden"), true);
  check("low behavioural is called out", r.reason_codes.includes("low_behavioural"), true);
}
{
  const r = run({ mpoweru_score: null });
  check("a no-data criterion produces a negative code", r.reason_codes.includes("low_behavioural"), true);
}
check("rating 3 says nothing either way", (() => {
  const r = E.deriveReasonCodes([{ criterion_code: "cash_flow", weight: 25, effective_rating: 3, had_data: true }]);
  return r.length;
})(), 0);

section("ENG-33 — reproducibility");
{
  const a = run({ mpoweru_score: 71, enterprise_years: 3.5 });
  const b = run({ mpoweru_score: 71, enterprise_years: 3.5 });
  check("the same input gives the same result", JSON.stringify(a), JSON.stringify(b));
  check("the model version is recorded", a.model_version, "sc-v1");
}

section("boundary sweep — every score reconciles and grades consistently");
{
  let bad = 0;
  for (const mp of [0, 20, 40, 60, 80, 100]) {
    for (const yrs of [0.5, 1.5, 2.5, 4, 6]) {
      for (const tx of [0, 2, 4, 8, 15]) {
        const r = run({ mpoweru_score: mp, enterprise_years: yrs, platform_transactions: tx });
        const sum = Math.round(r.criteria.reduce((s, c) => s + c.weighted_score, 0) * 100) / 100;
        if (sum !== r.total_score) bad++;
        if (r.total_score < 0 || r.total_score > 100) bad++;
        if (E.gradeFor(r.total_score, MODEL) !== r.grade) bad++;
      }
    }
  }
  check("150 combinations reconcile, stay in 0–100 and grade consistently", bad, 0);
}

console.log(`\n===== ${failures === 0 ? "all" : ""} ${failures} failed =====`);
process.exit(failures ? 1 : 0);
