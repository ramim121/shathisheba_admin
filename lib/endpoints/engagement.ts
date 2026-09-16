import { executeQuery, queryRows } from "@/lib/db";
import type { Row } from "./shared";
import { geoContains, geoFilter, getUserGeo } from "@/lib/geo-scope";
import { ruleFees } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Home partner strip
// ---------------------------------------------------------------------------

// GET /api/v1/app/partners — active buyers/partners, in the admin's order.
export async function getAppPartners() {
  return queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, name_en, name_bn, kind, badge_en, badge_bn, tagline_en, tagline_bn,
            description_en, description_bn, logo_url, website, phone
       FROM business_partners
      WHERE is_active = 1
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at IS NULL OR ends_at >= NOW())
      ORDER BY sort_order, id`
  );
}

// POST /api/v1/admin/partners/reorder { ids } — the strip shows them in this order.
export async function reorderPartners(ids: unknown) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) throw new Error("ids is required.");
  for (let i = 0; i < list.length; i += 1) {
    await executeQuery("UPDATE business_partners SET sort_order = ? WHERE id = ?", [i + 1, list[i]]);
  }
  return { ordered: list.length };
}

// ---------------------------------------------------------------------------
// Market overview
// ---------------------------------------------------------------------------

const OPEN_LISTING = "'submitted','field_verification','verified','contracted','shipped'";

/**
 * GET /api/v1/app/market/overview — what the market looks like from the
 * farmer's area: the rates that would price their animal today, what is being
 * listed and sold around them, and the market updates meant for them, each
 * labelled with the area it applies to.
 */
export async function getAppMarketOverview(userId?: string | null) {
  const geo = await getUserGeo(userId);
  const rateArea = geoContains("upazila", "r", geo);
  const [rules, areaRow] = await Promise.all([
    queryRows<Row>(
      `SELECT r.*, CAST(r.id AS CHAR) AS id,
              si.name_en AS item_en, si.name_bn AS item_bn,
              a.name_en AS animal_en, a.name_bn AS animal_bn, a.emoji,
              b.name_en AS breed_en, b.name_bn AS breed_bn,
              COALESCE(gu.name_en, gd.name_en, gv.name_en) AS area_en,
              COALESCE(gu.name_bn, gd.name_bn, gv.name_bn) AS area_bn
         FROM sale_pricing_rules r
         JOIN sale_items si ON si.id = r.sale_item_id
         LEFT JOIN animals a ON a.id = r.animal_id
         LEFT JOIN animal_breeds b ON b.id = r.breed_id
         LEFT JOIN geo_upazilas gu ON gu.id = r.upazila_id
         LEFT JOIN geo_districts gd ON gd.id = r.district_id
         LEFT JOIN geo_divisions gv ON gv.id = r.division_id
        WHERE r.is_active = 1
          AND r.effective_from <= CURDATE()
          AND (r.effective_to IS NULL OR r.effective_to >= CURDATE())
          AND ${rateArea.sql}
        ORDER BY si.id, (r.upazila_id IS NOT NULL) DESC, (r.district_id IS NOT NULL) DESC, r.effective_from DESC
        LIMIT 20`,
      rateArea.params
    ),
    geo.district_id
      ? queryRows<Row>("SELECT name_en, name_bn FROM geo_districts WHERE id = ? LIMIT 1", [geo.district_id])
      : Promise.resolve([] as Row[])
  ]);

  const rates = rules.map((r) => {
    const f = ruleFees(r);
    const dressing = Number(r.dressing_pct ?? 50) || 50;
    return {
      id: r.id,
      rule_name: r.rule_name ?? null,
      item_en: r.item_en, item_bn: r.item_bn,
      animal_en: r.animal_en ?? null, animal_bn: r.animal_bn ?? null, emoji: r.emoji ?? null,
      breed_en: r.breed_en ?? null, breed_bn: r.breed_bn ?? null,
      b2b_live: f.b2b,
      b2b_meat: Number(r.b2b_meat_rate ?? 0) || Math.round((f.b2b * 100) / dressing),
      net_farmer: f.net,
      net_farmer_meat: Math.round(((f.net * 100) / dressing) * 100) / 100,
      unit: r.unit ?? "kg",
      area_en: r.area_en ?? "All districts",
      area_bn: r.area_bn ?? "সারা দেশ",
      scope: r.upazila_id ? "upazila" : r.district_id ? "district" : r.division_id ? "division" : "national",
      effective_from: r.effective_from
    };
  });

  // Listing activity around the farmer: their district, or the whole country
  // for someone with no location yet. Counts only — never who listed what.
  const scope = geo.district_id ? "l.district_id = ?" : "1 = 1";
  const scopeParams = geo.district_id ? [geo.district_id] : [];
  const [stats] = await queryRows<Row>(
    `SELECT SUM(l.status IN (${OPEN_LISTING})) AS open_count,
            SUM(l.status = 'paid' AND l.paid_at >= NOW() - INTERVAL 30 DAY) AS paid_30d,
            SUM(l.created_at >= NOW() - INTERVAL 7 DAY) AS new_7d,
            AVG(CASE WHEN l.status IN (${OPEN_LISTING}) THEN COALESCE(l.verified_weight_kg, l.weight_kg) END) AS avg_live_weight,
            AVG(CASE WHEN l.status = 'paid' AND l.verified_weight_kg > 0 THEN l.paid_amount / l.verified_weight_kg END) AS avg_paid_per_kg
       FROM sale_listings l
      WHERE ${scope}`,
    scopeParams
  );
  const byAnimal = await queryRows<Row>(
    `SELECT a.name_en, a.name_bn, a.emoji, COUNT(*) AS n
       FROM sale_listings l JOIN animals a ON a.id = l.animal_id
      WHERE l.status IN (${OPEN_LISTING}) AND ${scope}
      GROUP BY a.id ORDER BY n DESC LIMIT 5`,
    scopeParams
  );

  const updArea = await geoFilter("market_updates", "m", geo);
  const updates = await queryRows<Row>(
    `SELECT CAST(m.id AS CHAR) AS id, m.title_en, m.title_bn, m.body_en, m.body_bn, m.image_url,
            m.update_type, m.category, m.created_at, m.updated_at, m.starts_at, m.ends_at,
            (m.image_url IS NOT NULL OR m.detail_en IS NOT NULL OR m.detail_bn IS NOT NULL) AS has_detail,
            CASE WHEN m.upazila_id IS NOT NULL THEN 'upazila' WHEN m.district_id IS NOT NULL THEN 'district'
                 WHEN m.division_id IS NOT NULL THEN 'division' ELSE 'national' END AS scope,
            COALESCE(gu.name_en, gd.name_en, gv.name_en, 'Nationwide') AS scope_en,
            COALESCE(gu.name_bn, gd.name_bn, gv.name_bn, 'সারা দেশ') AS scope_bn
       FROM market_updates m
       LEFT JOIN geo_upazilas gu ON gu.id = m.upazila_id
       LEFT JOIN geo_districts gd ON gd.id = m.district_id
       LEFT JOIN geo_divisions gv ON gv.id = m.division_id
      WHERE m.status = 'active' AND (m.ends_at IS NULL OR m.ends_at >= NOW()) AND ${updArea.sql}
      ORDER BY (m.district_id <=> ?) DESC, m.sort_order, m.created_at DESC
      LIMIT 30`,
    [...updArea.params, geo.district_id]
  );

  return {
    area: areaRow[0] ? { district_en: areaRow[0].name_en, district_bn: areaRow[0].name_bn } : null,
    rates,
    listings: {
      open: Number(stats?.open_count ?? 0),
      paid_30d: Number(stats?.paid_30d ?? 0),
      new_7d: Number(stats?.new_7d ?? 0),
      avg_live_weight: stats?.avg_live_weight === null || stats?.avg_live_weight === undefined ? null : Math.round(Number(stats.avg_live_weight)),
      avg_paid_per_kg: stats?.avg_paid_per_kg === null || stats?.avg_paid_per_kg === undefined ? null : Math.round(Number(stats.avg_paid_per_kg) * 100) / 100,
      by_animal: byAnimal.map((b) => ({ name_en: b.name_en, name_bn: b.name_bn, emoji: b.emoji, count: Number(b.n) }))
    },
    updates
  };
}
