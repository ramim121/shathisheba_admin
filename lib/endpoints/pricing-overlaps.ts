import { queryRows } from "@/lib/db";
import type { Row } from "./shared";

/**
 * Active sale pricing rules that can both answer the same quote.
 *
 * Two rules overlap when some animal, somewhere, on some day matches both: the
 * same sale item, dates that intersect, and animal / breed / area that are
 * either equal or left open on one side.
 *
 *   conflict - identical scope. The quote picks the newer effective date, but
 *              nobody chose that on purpose; fix one of them.
 *   nested   - one is more specific (a district inside a national rule, a
 *              breed inside an animal). The specific one wins for its slice;
 *              listed so the broad one is not mistaken for the only rule.
 *
 * The partner project is not part of the scope: the quote does not filter on
 * it, so two rules differing only by project really do collide.
 */
const OVERLAP_SQL = `
  SELECT CAST(a.id AS CHAR) AS a_id, CAST(b.id AS CHAR) AS b_id,
         COALESCE(a.rule_name, CONCAT('Rule #', a.id)) AS a_name,
         COALESCE(b.rule_name, CONCAT('Rule #', b.id)) AS b_name,
         si.name_en AS item,
         COALESCE(au.name_en, ad.name_en, av.name_en, 'All districts') AS a_area,
         COALESCE(bu.name_en, bd.name_en, bv.name_en, 'All districts') AS b_area,
         a.b2b_market_rate AS a_rate, b.b2b_market_rate AS b_rate,
         IF(a.animal_id <=> b.animal_id AND a.breed_id <=> b.breed_id
            AND a.division_id <=> b.division_id AND a.district_id <=> b.district_id AND a.upazila_id <=> b.upazila_id,
            'conflict', 'nested') AS kind
    FROM sale_pricing_rules a
    JOIN sale_pricing_rules b ON b.id > a.id AND b.sale_item_id = a.sale_item_id AND b.is_active = 1
    JOIN sale_items si ON si.id = a.sale_item_id
    LEFT JOIN geo_upazilas au ON au.id = a.upazila_id
    LEFT JOIN geo_districts ad ON ad.id = a.district_id
    LEFT JOIN geo_divisions av ON av.id = a.division_id
    LEFT JOIN geo_upazilas bu ON bu.id = b.upazila_id
    LEFT JOIN geo_districts bd ON bd.id = b.district_id
    LEFT JOIN geo_divisions bv ON bv.id = b.division_id
   WHERE a.is_active = 1
     AND a.effective_from <= COALESCE(b.effective_to, '9999-12-31')
     AND b.effective_from <= COALESCE(a.effective_to, '9999-12-31')
     AND (a.animal_id IS NULL OR b.animal_id IS NULL OR a.animal_id = b.animal_id)
     AND (a.breed_id IS NULL OR b.breed_id IS NULL OR a.breed_id = b.breed_id)
     AND (a.division_id IS NULL OR b.division_id IS NULL OR a.division_id = b.division_id)
     AND (a.district_id IS NULL OR b.district_id IS NULL OR a.district_id = b.district_id)
     AND (a.upazila_id IS NULL OR b.upazila_id IS NULL OR a.upazila_id = b.upazila_id)`;

// GET /api/v1/admin/sale/pricing/overlaps
export async function getPricingOverlaps() {
  const rows = await queryRows<Row>(`${OVERLAP_SQL} ORDER BY kind, si.name_en, a.id`);
  return {
    conflicts: rows.filter((r) => r.kind === "conflict"),
    nested: rows.filter((r) => r.kind === "nested")
  };
}

/** Warnings about one rule, returned with the save that created or changed it. */
export async function pricingWarningsFor(ruleId: string | number): Promise<string[]> {
  const rows = await queryRows<Row>(`${OVERLAP_SQL} AND (a.id = ? OR b.id = ?)`, [ruleId, ruleId]);
  return rows.map((r) => {
    const other = String(r.a_id) === String(ruleId) ? `${r.b_name} (${r.b_area})` : `${r.a_name} (${r.a_area})`;
    return r.kind === "conflict"
      ? `Overlaps ${other} on ${r.item} with the same scope — only the newer one will be used. Deactivate or narrow one of them.`
      : `Overlaps ${other} on ${r.item}; the more specific rule wins where both apply.`;
  });
}
