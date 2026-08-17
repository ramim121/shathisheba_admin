// Unit tests for the two finance engines (NFR-11).
//
// Every expected value here is taken verbatim from the machine-verified fixtures
// in SRS §25.1 / §25.4 and KB §10.1 / §10.2. These are pure functions where an
// error is expensive and silent, so the fixtures are asserted exactly — not
// approximately.
//
// Run: node scripts/test-finance-engines.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// The engines are TypeScript; transpile them in-memory rather than adding a
// build step or a test-runner dependency to the project.
async function loadTs(rel) {
  const src = readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}

const readiness = await loadTs("lib/finance/readiness-engine.ts");
const pricing = await loadTs("lib/finance/pricing-engine.ts");

let pass = 0;
const failures = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else failures.push(`${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`);
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}`);
}

// ---------------------------------------------------------------------------
// The seeded instrument, mirrored here so the engine is tested independently of
// the database. Weights match migration 021 exactly.
// ---------------------------------------------------------------------------
const Q = [
  [1, "core", "kyc", 0.07, "gate", "NO_NID", null, null],
  [2, "core", "financial", 0.06, null, null, null, null],
  [3, "core", "enterprise", 0.13, null, null, null, null],
  [4, "core", "financial", 0.07, null, null, null, null],
  [5, "core", "financial", 0.04, null, null, null, null],
  [6, "core", "enterprise", 0.05, null, null, null, null],
  [7, "core", "enterprise", 0.06, null, null, null, null],
  [8, "core", "enterprise", 0.05, null, null, null, null],
  [9, "core", "financial", 0.01, null, null, null, null],
  [10, "core", "financial", 0.05, null, null, null, null],
  [11, "deep", "financial", 0.08, null, null, 9, "yes"],
  [12, "deep", "financial", 0.06, "risk", "ARREARS", 9, "yes"],
  [13, "deep", "financial", 0.02, null, null, 9, "yes"],
  [14, "deep", "financial", 0.05, null, null, null, null],
  [15, "deep", "financial", 0.04, null, null, null, null],
  [16, "deep", "financial", 0.04, null, null, null, null],
  [17, "deep", "enterprise", 0.04, null, null, null, null],
  [18, "deep", "enterprise", 0.03, null, null, null, null],
  [19, "deep", "kyc", 0.02, null, null, null, null],
  [20, "deep", "kyc", 0.03, null, null, null, null],
].map(([o, part, category, weight, flag, flag_code, bp, bw]) => ({
  id: o, sort_order: o, part, category, weight,
  flag, flag_code, branch_parent_order: bp, branch_show_when: bw,
}));

const yesTo = (orders) => Q.map((q) => ({ question_id: q.id, answer: orders.includes(q.sort_order) }));
const ALL = Q.map((q) => q.sort_order);
const allExcept = (...skip) => ALL.filter((o) => !skip.includes(o));

console.log("\n=== Readiness scoring (SRS §25.1) ===");

// AC-R-01
let r = readiness.scoreReadiness(Q, yesTo(ALL), "full", ["S1", "S2", "S3"]);
check("AC-R-01 all 20 Yes -> 100.00 / A", [r.score, r.grade], [100, "A"]);
check("AC-R-01 status bank_ready_indicative", r.readiness_status, "bank_ready_indicative");

// AC-R-02 — core only is capped, however good the answers
r = readiness.scoreReadiness(Q, yesTo(ALL), "core", ["S1", "S2", "S3"]);
check("AC-R-02 all core Yes -> 100.00 / A", [r.score, r.grade], [100, "A"]);
check("AC-R-02 core caps at conditionally_ready", r.readiness_status, "conditionally_ready");
check("AC-R-14 core forces low confidence", r.data_confidence, "low");

// AC-R-03 — thin file: Q11/12/13 suppressed, half credit on 0.16
r = readiness.scoreReadiness(Q, yesTo(allExcept(9)), "full", []);
check("AC-R-03 never borrowed -> 91.00 / A", [r.score, r.grade], [91, "A"]);
check("AC-R-03 three questions suppressed", r.answers.filter((a) => a.branch_suppressed).length, 3);
check("AC-R-03 branch weight 0.16", r.branch_weight, 0.16);

// AC-R-07 — arrears caps the status despite a grade-A score
r = readiness.scoreReadiness(Q, yesTo(allExcept(12)), "full", ["S1", "S2", "S3"]);
check("AC-R-07 arrears -> 94.00 / A", [r.score, r.grade], [94, "A"]);
check("AC-R-07 status capped to development_required", r.readiness_status, "development_required");
check("AC-R-07 risk flag ARREARS", r.risk_flag, "ARREARS");

// AC-R-06 — the NID gate overrides everything
r = readiness.scoreReadiness(Q, yesTo(allExcept(1)), "full", ["S2", "S3", "S4"]);
check("AC-R-06 no NID -> 93.00", r.score, 93);
check("AC-R-06 gated to currently_ineligible", r.readiness_status, "currently_ineligible");
check("AC-R-06 gate reason NO_NID", r.gate_reason, "NO_NID");

// AC-R-04 / AC-R-05 — the same person, two depths
r = readiness.scoreReadiness(Q, yesTo([1, 2, 3, 4, 7, 9, 11, 14]), "full", []);
check("AC-R-04 typical smallholder full -> 53.00 / D", [r.score, r.grade], [53, "D"]);
r = readiness.scoreReadiness(Q, yesTo([1, 2, 3, 4, 7]), "core", []);
check("AC-R-05 same person core -> 66.10 / C", [r.score, r.grade], [66.1, "C"]);

// AC-R-08 — boundaries inclusive at the lower bound
check("AC-R-08 boundaries", [59.99, 60, 69.99, 70, 79.99, 80].map(readiness.gradeFor),
  ["D", "C", "C", "B", "B", "A"]);

// AC-R-15/16/17 — confidence rules
check("AC-R-15 full + 3 signals + S1 -> medium", readiness.deriveConfidence("full", ["S1", "S2", "S3"]), "medium");
check("AC-R-16 full + 3 signals, no S1 -> low", readiness.deriveConfidence("full", ["S2", "S3", "S4"]), "low");
check("AC-R-17 confidence is never high", ["low", "medium"].includes(readiness.deriveConfidence("full", ["S1", "S2", "S3", "S4", "S5", "S6", "S7"])), true);
check("AC-R-18 score>=80 low confidence -> conditionally_ready",
  readiness.deriveStatus({ score: 85, depth: "full", confidence: "low", enterprisePct: 100, gateTriggered: false, riskTriggered: false }),
  "conditionally_ready");

// Rule 6 — the project-ready path
check("project_ready when 60-69.99 and enterprise>=70",
  readiness.deriveStatus({ score: 65, depth: "full", confidence: "low", enterprisePct: 75, gateTriggered: false, riskTriggered: false }),
  "project_ready");
check("development_required when 60-69.99 and enterprise<70",
  readiness.deriveStatus({ score: 65, depth: "full", confidence: "low", enterprisePct: 40, gateTriggered: false, riskTriggered: false }),
  "development_required");
check("AC-R-04 grade D label is not 'Unacceptable'", readiness.gradeLabel("D").en, "Needs development");

// ---------------------------------------------------------------------------
console.log("\n=== Pricing / EMI (SRS §25.4) ===");

const terms = (rate) => ({
  interest_rate_annual: rate, interest_method: "flat", weeks_per_month: 4,
  first_payment_offset_days: 30, grace_period_months: 0,
  processing_fee_pct: 0, processing_fee_flat: 0,
});

let q = pricing.computeQuote(50000, 4, "monthly", terms(7));
check("AC-E-01 livestock 7% 4mo monthly",
  [q.total_interest, q.total_payable, q.installment_count, q.emi_amount, q.final_emi_amount],
  [1166.67, 51166.67, 4, 12791.67, 12791.66]);

q = pricing.computeQuote(50000, 12, "monthly", terms(7));
check("AC-E-02 livestock 7% 12mo monthly",
  [q.total_interest, q.total_payable, q.emi_amount], [3500, 53500, 4458.33]);

q = pricing.computeQuote(50000, 12, "weekly", terms(7));
check("AC-E-03 livestock 7% 12mo weekly", [q.installment_count, q.emi_amount], [48, 1114.58]);

q = pricing.computeQuote(50000, 24, "monthly", terms(13));
check("AC-E-04 general 13% 24mo monthly",
  [q.total_interest, q.total_payable, q.installment_count, q.emi_amount], [13000, 63000, 24, 2625]);

q = pricing.computeQuote(50000, 24, "weekly", terms(13));
check("AC-E-05 general 13% 24mo weekly", [q.installment_count, q.emi_amount], [96, 656.25]);

q = pricing.computeQuote(50000, 6, "monthly", terms(15));
check("AC-E-06 cooperative 15% 6mo monthly",
  [q.total_interest, q.total_payable, q.installment_count, q.emi_amount], [3750, 53750, 6, 8958.33]);

q = pricing.computeQuote(50000, 12, "weekly", terms(15));
check("AC-E-07 cooperative 15% 12mo weekly", [q.installment_count, q.emi_amount], [48, 1197.92]);

// AC-E-08 — the residue case the spec calls out explicitly
q = pricing.computeQuote(100000, 24, "weekly", terms(15));
check("AC-E-08 ৳100k 15% 24mo weekly",
  [q.installment_count, q.emi_amount, q.final_emi_amount], [96, 1354.17, 1353.85]);
let rows = pricing.generateSchedule(q, new Date(Date.UTC(2026, 8, 1)), terms(15));
const sumPaisa = rows.reduce((s, x) => s + Math.round(x.amount_due * 100), 0);
check("AC-E-08 Σ instalments == total payable exactly", sumPaisa, Math.round(q.total_payable * 100));

// AC-E-10 — one-time settlement
q = pricing.computeQuote(50000, 4, "one_time", terms(7));
check("AC-E-10 one-time n=1", [q.installment_count, q.emi_amount], [1, 51166.67]);

// AC-E-09 — the invariant across every combination
console.log("  ... checking Σ == total for every product/tenure/mode combination");
let combos = 0, broken = 0;
for (const [rate, tenures] of [[7, [4, 6, 12]], [13, [6, 12, 24]], [15, [6, 12, 24]]]) {
  for (const months of tenures) {
    for (const mode of ["weekly", "monthly", "one_time"]) {
      for (const amount of [5000, 12345, 50000, 100000, 287654]) {
        const qq = pricing.computeQuote(amount, months, mode, terms(rate));
        const rr = pricing.generateSchedule(qq, new Date(Date.UTC(2026, 0, 31)), terms(rate));
        const s = rr.reduce((acc, x) => acc + Math.round(x.amount_due * 100), 0);
        combos++;
        if (s !== Math.round(qq.total_payable * 100)) broken++;
      }
    }
  }
}
check(`AC-E-09 all ${combos} combinations reconcile`, broken, 0);

// AC-E-11/12/13 — due-date generation
q = pricing.computeQuote(50000, 6, "monthly", terms(7));
rows = pricing.generateSchedule(q, new Date(Date.UTC(2026, 8, 1)), terms(7));
check("AC-E-11 monthly due dates", rows.map((x) => x.due_date),
  ["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]);

q = pricing.computeQuote(50000, 12, "weekly", terms(7));
rows = pricing.generateSchedule(q, new Date(Date.UTC(2026, 8, 1)), terms(7));
check("AC-E-12 weekly first six", rows.slice(0, 6).map((x) => x.due_date),
  ["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29", "2026-11-05"]);

// Disbursed 31 Jan -> first due 2 Mar (+30d), then month-end clamping applies
q = pricing.computeQuote(50000, 6, "monthly", terms(7));
rows = pricing.generateSchedule(q, new Date(Date.UTC(2026, 0, 31)), terms(7));
check("AC-E-13 month-end clamp produces valid dates",
  rows.every((x) => !Number.isNaN(Date.parse(x.due_date))), true);
check("AC-E-13 no duplicate or skipped months", new Set(rows.map((x) => x.due_date)).size, rows.length);
// 31 Aug + 1 month must clamp to 30 Sep, not roll into October
check("AC-E-13 31 Aug +1mo clamps to 30 Sep",
  pricing.addMonthsClamped(new Date(Date.UTC(2026, 7, 31)), 1).toISOString().slice(0, 10), "2026-09-30");
check("AC-E-13 31 Jan +1mo clamps to 28 Feb",
  pricing.addMonthsClamped(new Date(Date.UTC(2026, 0, 31)), 1).toISOString().slice(0, 10), "2026-02-28");

// AC-E-17 — a zero fee is omitted, never rendered as ৳0
q = pricing.computeQuote(50000, 12, "monthly", terms(7));
check("AC-E-17 zero processing fee", q.processing_fee, 0);

// AC-E-15 — amount clamping
check("AC-E-15 below min clamps up", pricing.clampAmount(500, 10000, 200000, 1000).value, 10000);
check("AC-E-15 above max clamps down", pricing.clampAmount(999999, 10000, 200000, 1000).value, 200000);
check("AC-E-15 reports that it clamped", pricing.clampAmount(999999, 10000, 200000, 1000).clamped, true);

// ENG-42 — effective rate is higher than the flat headline rate
check("ENG-42 effective rate exceeds flat rate", pricing.effectiveAnnualRate(7, 12) > 7, true);

console.log(`\n===== ${pass} passed, ${failures.length} failed =====`);
if (failures.length) {
  console.log("\nFAILURES:");
  failures.forEach((f) => console.log(`  ${f}`));
  process.exit(1);
}
