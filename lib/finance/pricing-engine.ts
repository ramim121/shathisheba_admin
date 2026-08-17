// Loan pricing, EMI and schedule generation — SRS §16B–16C (ENG-40…ENG-48) / KB §7.2–7.3.
//
// Every figure the platform shows a farmer originates here.
//
// Money is held in integer paisa throughout. Binary floating point cannot
// represent ৳0.01 exactly, and a cent of drift multiplied across 96 instalments
// is a schedule that does not reconcile — which the spec (correctly) calls a
// defect, not a rounding nuisance. Values cross the boundary as 2dp numbers
// only at the edges of this module.
//
// Flat rate is deliberate: interest accrues on the full original principal for
// the whole tenure, so a farmer can verify the total with a calculator in one
// step. Reducing balance is configurable but unused in v1.

export type RepaymentMode = "weekly" | "monthly" | "one_time";
export type InterestMethod = "flat" | "reducing_balance";

export type ProductTerms = {
  interest_rate_annual: number;
  interest_method: InterestMethod;
  weeks_per_month: number;
  first_payment_offset_days: number;
  grace_period_months: number;
  processing_fee_pct: number;
  processing_fee_flat: number;
};

export type Quote = {
  principal: number;
  tenure_months: number;
  repayment_mode: RepaymentMode;
  interest_rate_annual: number;
  interest_method: InterestMethod;
  total_interest: number;
  processing_fee: number;
  total_payable: number;
  installment_count: number;
  emi_amount: number;
  final_emi_amount: number;
  effective_annual_rate: number;
};

export type ScheduleRow = {
  installment_no: number;
  due_date: string;           // YYYY-MM-DD
  principal_component: number;
  interest_component: number;
  fee_component: number;
  amount_due: number;
};

const toPaisa = (taka: number): number => Math.round((taka + Number.EPSILON) * 100);
const toTaka = (paisa: number): number => Math.round(paisa) / 100;

/** Instalment count for a mode. One-time settles once, at maturity. */
export function installmentCount(mode: RepaymentMode, tenureMonths: number, weeksPerMonth: number): number {
  if (mode === "one_time") return 1;
  if (mode === "weekly") return tenureMonths * (weeksPerMonth || 4);
  return tenureMonths;
}

/**
 * ENG-40/41. Flat-rate interest on the full principal for the whole tenure.
 * All arithmetic in paisa; the caller receives 2dp taka.
 */
export function computeQuote(
  principalTaka: number,
  tenureMonths: number,
  mode: RepaymentMode,
  terms: ProductTerms
): Quote {
  const principal = toPaisa(principalTaka);

  // principal × rate% × (months / 12), evaluated as integers before dividing so
  // the single rounding happens once, at the end.
  const interest = Math.round((principal * terms.interest_rate_annual * tenureMonths) / (100 * 12));

  const feePct = Math.round((principal * (terms.processing_fee_pct || 0)) / 100);
  const feeFlat = toPaisa(terms.processing_fee_flat || 0);
  const fee = feePct + feeFlat;

  const totalPayable = principal + interest + fee;
  const n = installmentCount(mode, tenureMonths, terms.weeks_per_month);

  // ENG-45: the final instalment absorbs the residue so the schedule reconciles
  // to the total exactly. Never distribute the remainder across instalments.
  const emi = Math.round(totalPayable / n);
  const finalEmi = totalPayable - emi * (n - 1);

  return {
    principal: toTaka(principal),
    tenure_months: tenureMonths,
    repayment_mode: mode,
    interest_rate_annual: terms.interest_rate_annual,
    interest_method: terms.interest_method,
    total_interest: toTaka(interest),
    processing_fee: toTaka(fee),
    total_payable: toTaka(totalPayable),
    installment_count: n,
    emi_amount: toTaka(emi),
    final_emi_amount: toTaka(finalEmi),
    effective_annual_rate: effectiveAnnualRate(terms.interest_rate_annual, n),
  };
}

/**
 * ENG-42. A flat rate understates true cost against reducing balance. Shown to
 * admins and lenders only — never on the farmer's quote screen, where it would
 * be confused with the headline rate (ENG-43).
 */
export function effectiveAnnualRate(annualRate: number, n: number): number {
  if (n <= 1) return Math.round(annualRate * 100) / 100;
  return Math.round(annualRate * 2 * (n / (n + 1)) * 100) / 100;
}

/** Adds months, clamping to the last valid day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsClamped(date: Date, months: number): Date {
  const targetDay = date.getUTCDate();
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(targetDay, lastDay));
  return d;
}

const addDays = (date: Date, days: number): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * ENG-46. Due dates from the disbursement date. Generated once at disbursement
 * and persisted — never recomputed on read (ENG-47). Pre-disbursement figures
 * are a quote; post-disbursement figures are a contract.
 */
export function generateSchedule(
  quote: Quote,
  disbursementDate: Date,
  terms: ProductTerms
): ScheduleRow[] {
  const offset = terms.first_payment_offset_days ?? 30;
  let first = addDays(disbursementDate, offset);
  if (terms.grace_period_months) first = addMonthsClamped(first, terms.grace_period_months);

  const n = quote.installment_count;
  const totalPaisa = toPaisa(quote.total_payable);
  const interestPaisa = toPaisa(quote.total_interest);
  const feePaisa = toPaisa(quote.processing_fee);
  const emiPaisa = toPaisa(quote.emi_amount);
  const finalPaisa = toPaisa(quote.final_emi_amount);

  // Under `flat`, interest and fee split evenly across instalments, with the
  // remainder landing on the last one so the components also reconcile.
  const interestPer = Math.round(interestPaisa / n);
  const feePer = Math.round(feePaisa / n);

  const rows: ScheduleRow[] = [];
  for (let i = 1; i <= n; i++) {
    let due: Date;
    if (quote.repayment_mode === "one_time") {
      due = addMonthsClamped(disbursementDate, quote.tenure_months);
    } else if (quote.repayment_mode === "weekly") {
      due = addDays(first, (i - 1) * 7);
    } else {
      due = addMonthsClamped(first, i - 1);
    }

    const isLast = i === n;
    const amountDue = isLast ? finalPaisa : emiPaisa;
    const interestComp = isLast ? interestPaisa - interestPer * (n - 1) : interestPer;
    const feeComp = isLast ? feePaisa - feePer * (n - 1) : feePer;
    const principalComp = amountDue - interestComp - feeComp;

    rows.push({
      installment_no: i,
      due_date: iso(due),
      principal_component: toTaka(principalComp),
      interest_component: toTaka(interestComp),
      fee_component: toTaka(feeComp),
      amount_due: toTaka(amountDue),
    });
  }

  // DAT-05 / ENG-45. Assert rather than trust: a schedule that does not
  // reconcile must never reach the database or a farmer's screen.
  const sum = rows.reduce((s, r) => s + toPaisa(r.amount_due), 0);
  if (sum !== totalPaisa) {
    throw new Error(
      `Schedule does not reconcile: instalments sum to ${toTaka(sum)} but total payable is ${quote.total_payable}`
    );
  }
  return rows;
}

/** Maturity date for an account — the last instalment's due date. */
export function maturityDate(rows: ScheduleRow[]): string {
  return rows[rows.length - 1].due_date;
}

/** Clamp a requested amount to the product bounds, reporting whether it moved. */
export function clampAmount(
  amount: number,
  min: number,
  max: number,
  step: number
): { value: number; clamped: boolean } {
  let v = amount;
  let clamped = false;
  if (step > 0) {
    const snapped = Math.round(v / step) * step;
    if (snapped !== v) { v = snapped; clamped = true; }
  }
  if (min > 0 && v < min) { v = min; clamped = true; }
  if (max > 0 && v > max) { v = max; clamped = true; }
  return { value: v, clamped };
}
