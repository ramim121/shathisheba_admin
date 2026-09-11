import type { Row } from "@/lib/endpoints/shared";

/**
 * Sale price rule arithmetic, shared by the farmer's quote, the console's
 * listing screen and the rule's stored farmer rate.
 *
 * Every fee is per kg of LIVE weight and is either a flat ৳/kg or a
 * percentage of the live B2B rate. The form only lets one be entered; if old
 * data carries both, a flat figure above zero wins.
 */

export type FeeMode = "pct" | "flat";
export type Fee = { amount: number; mode: FeeMode; pct: number | null };

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function fee(b2bLive: number, flat: unknown, pct: unknown): Fee {
  const f = num(flat);
  const p = num(pct);
  if (f !== null && Number.isFinite(f) && f > 0) return { amount: round2(f), mode: "flat", pct: null };
  if (p !== null && Number.isFinite(p) && p > 0) return { amount: round2((b2bLive * p) / 100), mode: "pct", pct: p };
  return { amount: 0, mode: "flat", pct: null };
}

export function ruleFees(rule: Row) {
  const b2b = Number(rule.b2b_market_rate ?? 0);
  const platform = fee(b2b, rule.platform_fee, rule.platform_fee_pct);
  const logistics = fee(b2b, rule.logistics_fee, rule.logistics_fee_pct);
  const care = fee(b2b, rule.warehouse_vet_fee, rule.warehouse_vet_fee_pct);
  const deductions = round2(platform.amount + logistics.amount + care.amount);
  return { b2b, platform, logistics, care, deductions, net: round2(b2b - deductions) };
}

/** Keeps the stored farmer_rate equal to the arithmetic after every save. */
const feeSql = (flat: string, pct: string) =>
  `IF(COALESCE(${flat}, 0) > 0, ${flat}, b2b_market_rate * COALESCE(${pct}, 0) / 100)`;

export const FARMER_RATE_SQL = `
  UPDATE sale_pricing_rules
     SET farmer_rate = GREATEST(0, b2b_market_rate
           - ${feeSql("platform_fee", "platform_fee_pct")}
           - ${feeSql("logistics_fee", "logistics_fee_pct")}
           - ${feeSql("warehouse_vet_fee", "warehouse_vet_fee_pct")})
   WHERE id = ?`;
