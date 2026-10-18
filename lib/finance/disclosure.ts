import { queryRows } from "@/lib/db";
import {
  clampAmount, computeQuote, effectiveAnnualRate, generateSchedule,
  type ProductTerms, type Quote, type RepaymentMode
} from "@/lib/finance/pricing-engine";

/**
 * Loan cost disclosure — what Google Play's Financial Services policy asks of
 * an app that connects people with personal loans, shown in the app, on the
 * public /loan-disclosure page, and copied into the store listing:
 *
 *   * the minimum and maximum repayment period;
 *   * the MAXIMUM APR — interest plus every fee, as a yearly rate;
 *   * a representative example of the total cost of a loan;
 *   * and no loan that must be repaid in full within 60 days.
 *
 * Every figure comes from the pricing engine that quotes the farmer
 * (computeQuote), so the disclosure cannot drift from what the app charges.
 *
 * The APR is the engine's EFFECTIVE annual rate (ENG-42), not the headline
 * flat rate. Interest here is flat — charged on the whole original amount for
 * the whole term — while the amount actually owed falls with every
 * instalment, so the true yearly cost is close to twice the flat rate. The
 * farmer's quote screen still shows the flat rate (ENG-43); the disclosure is
 * where the comparable figure belongs. Checked against the annualised IRR of
 * every real schedule: the engine's rate is never below it, so the disclosed
 * maximum does not understate.
 *
 * With a processing fee the same formula is applied to interest + fee. No
 * active product charges a fee today, and in that case the figure is exactly
 * computeQuote's effective_annual_rate.
 */

type Row = Record<string, unknown>;

/** Play: nothing offered may have to be repaid in full within 60 days. */
export const MIN_FULL_REPAYMENT_DAYS = 61;

/** The example used wherever a representative loan is shown. */
const REPRESENTATIVE_PRINCIPAL = 50_000;
const REPRESENTATIVE_TENURE = 12;
const REPRESENTATIVE_MODE: RepaymentMode = "monthly";
const REPRESENTATIVE_PRODUCT = "general";

const MODES: RepaymentMode[] = ["weekly", "monthly", "one_time"];

export type Representative = {
  principal: number;
  tenure_months: number;
  repayment_mode: RepaymentMode;
  installment_count: number;
  emi_amount: number;
  total_interest: number;
  processing_fee: number;
  total_payable: number;
  apr_pct: number;
};

export type ProductDisclosure = {
  nominal_rate_pct: number;
  interest_method: string;
  apr_min_pct: number;
  apr_max_pct: number;
  tenure_min_months: number;
  tenure_max_months: number;
  processing_fee_pct: number;
  processing_fee_flat: number;
  late_penalty_pct: number;
  representative: Representative;
};

function parseList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** The engine's terms for a loan_products row. */
export function termsFromRow(row: Row): ProductTerms {
  return {
    interest_rate_annual: Number(row.interest_rate_annual),
    interest_method: row.interest_method as ProductTerms["interest_method"],
    weeks_per_month: Number(row.weeks_per_month || 4),
    first_payment_offset_days: Number(row.first_payment_offset_days || 30),
    grace_period_months: Number(row.grace_period_months || 0),
    processing_fee_pct: Number(row.processing_fee_pct || 0),
    processing_fee_flat: Number(row.processing_fee_flat || 0)
  };
}

/** APR for a quote: the engine's effective annual rate, with fees counted as cost. */
export function disclosureApr(quote: Quote): number {
  if (!quote.processing_fee) return quote.effective_annual_rate;
  const cost = quote.total_interest + quote.processing_fee;
  const allInFlatRate = (cost / quote.principal) * (12 / quote.tenure_months) * 100;
  return effectiveAnnualRate(allInFlatRate, quote.installment_count);
}

/** Days from disbursement to the last instalment, on the real schedule. */
export function fullRepaymentDays(quote: Quote, terms: ProductTerms, from: Date = new Date()): number {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const rows = generateSchedule(quote, start, terms);
  return Math.round((Date.parse(rows[rows.length - 1].due_date) - start.getTime()) / 86_400_000);
}

function offeredTenures(row: Row): number[] {
  return [...new Set(parseList(row.allowed_tenures_json).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

function offeredModes(row: Row): RepaymentMode[] {
  const listed = parseList(row.allowed_repayment_modes_json).map(String);
  return MODES.filter((m) => listed.includes(m));
}

// An amount the product would actually quote: snapped to its step, inside its bounds.
function productAmount(row: Row, wanted: number): number {
  return clampAmount(wanted, Number(row.min_amount), Number(row.max_amount), Number(row.amount_step)).value;
}

/**
 * The disclosure for one product, or null when it cannot be bounded (no
 * tenures or no repayment modes configured — createQuote would then accept
 * any, and no maximum could honestly be stated).
 */
export function productDisclosure(row: Row): ProductDisclosure | null {
  const terms = termsFromRow(row);
  const tenures = offeredTenures(row);
  const modes = offeredModes(row);
  if (!tenures.length || !modes.length || !(terms.interest_rate_annual >= 0)) return null;

  const representativeAmount = productAmount(row, REPRESENTATIVE_PRINCIPAL);
  // A flat fee weighs most on the smallest loan and least on the largest, so
  // the extremes are taken at the product's bounds. Without one, APR does not
  // depend on the amount at all.
  const smallest = Number(row.min_amount) > 0 ? productAmount(row, Number(row.min_amount)) : representativeAmount;
  const largest = Number(row.max_amount) > 0 ? productAmount(row, Number(row.max_amount)) : representativeAmount;

  let aprMax = -Infinity;
  let aprMin = Infinity;
  const offered: { tenure: number; mode: RepaymentMode }[] = [];
  for (const tenure of tenures) {
    for (const mode of modes) {
      const atSmallest = computeQuote(smallest, tenure, mode, terms);
      // Not offered: createQuote refuses it (Play's 60-day rule).
      if (fullRepaymentDays(atSmallest, terms) < MIN_FULL_REPAYMENT_DAYS) continue;
      offered.push({ tenure, mode });
      aprMax = Math.max(aprMax, disclosureApr(atSmallest));
      aprMin = Math.min(aprMin, disclosureApr(computeQuote(largest, tenure, mode, terms)));
    }
  }
  if (!offered.length) return null;

  // ৳50,000 over 12 months, monthly — or the offered combination nearest it.
  const example = [...offered].sort(
    (a, b) =>
      Math.abs(a.tenure - REPRESENTATIVE_TENURE) - Math.abs(b.tenure - REPRESENTATIVE_TENURE) ||
      Number(b.mode === REPRESENTATIVE_MODE) - Number(a.mode === REPRESENTATIVE_MODE)
  )[0];
  const q = computeQuote(representativeAmount, example.tenure, example.mode, terms);
  const offeredTenure = offered.map((o) => o.tenure);

  return {
    nominal_rate_pct: terms.interest_rate_annual,
    interest_method: terms.interest_method,
    apr_min_pct: aprMin,
    apr_max_pct: aprMax,
    tenure_min_months: Math.min(...offeredTenure),
    tenure_max_months: Math.max(...offeredTenure),
    processing_fee_pct: terms.processing_fee_pct,
    processing_fee_flat: terms.processing_fee_flat,
    late_penalty_pct: Number(row.late_penalty_pct || 0),
    representative: {
      principal: q.principal,
      tenure_months: q.tenure_months,
      repayment_mode: q.repayment_mode,
      installment_count: q.installment_count,
      emi_amount: q.emi_amount,
      total_interest: q.total_interest,
      processing_fee: q.processing_fee,
      total_payable: q.total_payable,
      apr_pct: disclosureApr(q)
    }
  };
}

/** Is this product row one a farmer can be quoted on? Mirrors createQuote's check. */
export function isOffered(row: Row): boolean {
  return Number(row.is_active) === 1;
}

const money = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bn = (s: string) => s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);

function feeMaxima(disclosures: ProductDisclosure[]) {
  return {
    processing_fee_pct_max: Math.max(0, ...disclosures.map((d) => d.processing_fee_pct)),
    processing_fee_flat_max: Math.max(0, ...disclosures.map((d) => d.processing_fee_flat)),
    late_penalty_pct_max: Math.max(0, ...disclosures.map((d) => d.late_penalty_pct))
  };
}

function feesNotes(disclosures: ProductDisclosure[]): { en: string; bn: string } {
  const { processing_fee_pct_max: feePct, processing_fee_flat_max: feeFlat, late_penalty_pct_max: late } = feeMaxima(disclosures);

  const en: string[] = [];
  const bnText: string[] = [];
  if (!feePct && !feeFlat) {
    en.push("There is no processing fee or any other charge on these loans: the only cost is the interest, and the APR includes it.");
    bnText.push("এই ঋণে কোনো প্রসেসিং ফি বা অন্য কোনো চার্জ নেই: একমাত্র খরচ সুদ, এবং বার্ষিক খরচের হার (APR) তা অন্তর্ভুক্ত করে।");
  } else {
    const parts = [feePct ? `${money(feePct)}% of the amount` : null, feeFlat ? `৳${money(feeFlat)}` : null].filter(Boolean).join(" plus ");
    const partsBn = [feePct ? `ঋণের ${bn(money(feePct))}%` : null, feeFlat ? `৳${bn(money(feeFlat))}` : null].filter(Boolean).join(" ও ");
    en.push(`A processing fee of up to ${parts} applies, and is included in the APR.`);
    bnText.push(`সর্বোচ্চ ${partsBn} প্রসেসিং ফি প্রযোজ্য, যা বার্ষিক খরচের হারে (APR) অন্তর্ভুক্ত।`);
  }
  if (!late) {
    en.push("No late-payment fee is set on these loans.");
    bnText.push("এই ঋণে দেরিতে পরিশোধের কোনো জরিমানা নির্ধারিত নেই।");
  } else {
    en.push(`A late-payment penalty of up to ${money(late)}% may apply to an overdue instalment.`);
    bnText.push(`কিস্তি দেরিতে দিলে সর্বোচ্চ ${bn(money(late))}% জরিমানা প্রযোজ্য হতে পারে।`);
  }
  return { en: en.join(" "), bn: bnText.join(" ") };
}

export type PublicLoanDisclosure = {
  apr_min_pct: number | null;
  apr_max_pct: number | null;
  tenure_min_months: number | null;
  tenure_max_months: number | null;
  fees_note: string;
  fees_note_bn: string;
  /** The largest fee any offered product charges; all zero means "no fees". */
  fees: { processing_fee_pct_max: number; processing_fee_flat_max: number; late_penalty_pct_max: number };
  representative: (Representative & {
    product_code: string;
    product_name_en: string;
    product_name_bn: string;
    nominal_rate_pct: number;
    interest_method: string;
  }) | null;
  products: {
    code: string;
    name_en: string;
    name_bn: string;
    nominal_rate_pct: number;
    interest_method: string;
    apr_max_pct: number;
    tenure_min_months: number;
    tenure_max_months: number;
  }[];
};

/**
 * GET public/loan-disclosure — the aggregate across every product a farmer can
 * currently be quoted on. Read by the app, the public page and the store
 * listing's copy; no personal data.
 */
export async function getPublicLoanDisclosure(): Promise<PublicLoanDisclosure> {
  const rows = await queryRows<Row>("SELECT * FROM loan_products WHERE is_active = 1 ORDER BY sort_order, id");
  const items = rows
    .map((row) => ({ row, d: productDisclosure(row) }))
    .filter((x): x is { row: Row; d: ProductDisclosure } => x.d !== null);
  const notes = feesNotes(items.map((x) => x.d));
  const fees = feeMaxima(items.map((x) => x.d));
  if (!items.length) {
    return {
      apr_min_pct: null, apr_max_pct: null, tenure_min_months: null, tenure_max_months: null,
      fees_note: notes.en, fees_note_bn: notes.bn, fees, representative: null, products: []
    };
  }

  const example = items.find((x) => x.row.code === REPRESENTATIVE_PRODUCT) ?? items[0];
  return {
    apr_min_pct: Math.min(...items.map((x) => x.d.apr_min_pct)),
    apr_max_pct: Math.max(...items.map((x) => x.d.apr_max_pct)),
    tenure_min_months: Math.min(...items.map((x) => x.d.tenure_min_months)),
    tenure_max_months: Math.max(...items.map((x) => x.d.tenure_max_months)),
    fees_note: notes.en,
    fees_note_bn: notes.bn,
    fees,
    representative: {
      ...example.d.representative,
      product_code: String(example.row.code),
      product_name_en: String(example.row.name_en ?? ""),
      product_name_bn: String(example.row.name_bn ?? ""),
      nominal_rate_pct: example.d.nominal_rate_pct,
      interest_method: example.d.interest_method
    },
    products: items.map(({ row, d }) => ({
      code: String(row.code),
      name_en: String(row.name_en ?? ""),
      name_bn: String(row.name_bn ?? ""),
      nominal_rate_pct: d.nominal_rate_pct,
      interest_method: d.interest_method,
      apr_max_pct: d.apr_max_pct,
      tenure_min_months: d.tenure_min_months,
      tenure_max_months: d.tenure_max_months
    }))
  };
}
