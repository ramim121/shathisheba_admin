import { queryRows } from "@/lib/db";
import type { GeoIds } from "@/lib/geo";
import { geoRowVisible } from "@/lib/geo-scope";

/**
 * Who delivers a Buy from Shathi product to a buyer.
 *
 * A product may be carried by several distributors, each serving an area
 * (blank = nationwide, or a division / district / upazila). The buyer gets
 * the most local distributor whose area contains their profile location, and
 * the order's delivery address is locked to that distributor's area. A
 * product with no distributor is shipped by its manufacturer, anywhere; one
 * whose distributors all serve elsewhere is not offered to this buyer.
 */

export type DeliveryLock = "none" | "division" | "district" | "upazila";

export type Distributor = GeoIds & {
  id: number;
  code: string | null;
  name_en: string;
  name_bn: string | null;
  short_name_en: string | null;
  short_name_bn: string | null;
  logo_url: string | null;
  phone: string | null;
  address_en: string | null;
  address_bn: string | null;
  division: string | null;
  district: string | null;
  upazila: string | null;
  division_bn: string | null;
  district_bn: string | null;
  upazila_bn: string | null;
  lock: DeliveryLock;
  /** "Lalpur, Natore" / "Natore district" / "Nationwide". */
  area_en: string;
  area_bn: string;
};

const SELECT = `
  SELECT d.id, d.code, d.name_en, d.name_bn, d.short_name_en, d.short_name_bn, d.logo_url, d.phone,
         d.address_en, d.address_bn, d.division_id, d.district_id, d.upazila_id,
         gv.name_en AS division, gv.name_bn AS division_bn,
         gd.name_en AS district, gd.name_bn AS district_bn,
         gu.name_en AS upazila, gu.name_bn AS upazila_bn`;
const JOINS = `
  LEFT JOIN geo_divisions gv ON gv.id = d.division_id
  LEFT JOIN geo_districts gd ON gd.id = d.district_id
  LEFT JOIN geo_upazilas gu ON gu.id = d.upazila_id`;

const id = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function shape(r: Record<string, unknown>): Distributor {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const lock: DeliveryLock = r.upazila_id ? "upazila" : r.district_id ? "district" : r.division_id ? "division" : "none";
  const area_en =
    lock === "upazila" ? `${r.upazila}, ${r.district}` : lock === "district" ? `${r.district} district` : lock === "division" ? `${r.division} division` : "Nationwide";
  const area_bn =
    lock === "upazila" ? `${r.upazila_bn ?? r.upazila}, ${r.district_bn ?? r.district}` : lock === "district" ? `${r.district_bn ?? r.district} জেলা` : lock === "division" ? `${r.division_bn ?? r.division} বিভাগ` : "সারা দেশ";
  return {
    id: Number(r.id),
    code: s(r.code),
    name_en: String(r.name_en ?? ""),
    name_bn: s(r.name_bn),
    short_name_en: s(r.short_name_en),
    short_name_bn: s(r.short_name_bn),
    logo_url: s(r.logo_url),
    phone: s(r.phone),
    address_en: s(r.address_en),
    address_bn: s(r.address_bn),
    division_id: id(r.division_id),
    district_id: id(r.district_id),
    upazila_id: id(r.upazila_id),
    division: s(r.division),
    district: s(r.district),
    upazila: s(r.upazila),
    division_bn: s(r.division_bn),
    district_bn: s(r.district_bn),
    upazila_bn: s(r.upazila_bn),
    lock,
    area_en,
    area_bn
  };
}

const specificity = (d: Distributor) => (d.upazila_id ? 3 : d.district_id ? 2 : d.division_id ? 1 : 0);

/** Active distributors of each product, keyed by product id. */
export async function productDistributors(productIds: number[]): Promise<Map<number, Distributor[]>> {
  const out = new Map<number, Distributor[]>();
  if (!productIds.length) return out;
  const rows = await queryRows<Record<string, unknown>>(
    `${SELECT}, pd.product_id
       FROM product_distributors pd
       JOIN distributors d ON d.id = pd.distributor_id AND d.is_active = 1
       ${JOINS}
      WHERE pd.is_active = 1 AND pd.product_id IN (${productIds.map(() => "?").join(",")})`,
    productIds
  );
  for (const r of rows) {
    const key = Number(r.product_id);
    out.set(key, [...(out.get(key) ?? []), shape(r)]);
  }
  return out;
}

/**
 * The distributor that serves a buyer at `geo`. `available` is false when the
 * product has distributors but none covers the buyer.
 */
export function pickDistributor(list: Distributor[] | undefined, geo: GeoIds): { available: boolean; distributor: Distributor | null } {
  if (!list || !list.length) return { available: true, distributor: null };
  const covering = list.filter((d) => geoRowVisible("upazila", d, geo)).sort((a, b) => specificity(b) - specificity(a));
  return covering.length ? { available: true, distributor: covering[0] } : { available: false, distributor: null };
}

export async function getDistributorById(distributorId: unknown): Promise<Distributor | null> {
  if (!distributorId) return null;
  const rows = await queryRows<Record<string, unknown>>(`${SELECT} FROM distributors d ${JOINS} WHERE d.id = ? LIMIT 1`, [distributorId]);
  return rows[0] ? shape(rows[0]) : null;
}

/** Whether a delivery address lies inside the distributor's area. */
export function deliversTo(d: Distributor, geo: GeoIds): boolean {
  return geoRowVisible("upazila", d, geo);
}
