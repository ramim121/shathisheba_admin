import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";

// Reference and catalogue reads: geography, sale taxonomy, buy categories,
// market updates, weather and price quoting. All are lookup data with no
// personal information, which is why they are the public tier of the API.

export async function getAppMarketUpdates(district?: string | null) {
  // Location-first: a user's district updates sort to the top, then national ones.
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, title_en, title_bn, body_en, body_bn,
             image_url, detail_en, detail_bn, update_type, category, status,
             district, upazila, created_at,
             (image_url IS NOT NULL OR detail_en IS NOT NULL OR detail_bn IS NOT NULL) AS has_detail
      FROM market_updates
      WHERE status = 'active'
      ORDER BY (district = ?) DESC, sort_order, created_at DESC
    `,
    [district ?? null]
  );
}

export async function getAppMarketUpdate(id: string) {
  const rows = await queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, title_en, title_bn, body_en, body_bn,
             image_url, detail_en, detail_bn, update_type, category, status,
             district, upazila, starts_at, ends_at, created_at
      FROM market_updates
      WHERE id = ?
      LIMIT 1
    `,
    [id]
  );
  return rows[0] ?? null;
}

export async function getAppWeatherAlerts(district?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, title_en, title_bn, body_en, body_bn,
             body_en AS description_en, body_bn AS description_bn,
             alert_type, severity, district, upazila
      FROM weather_alerts
      WHERE is_active = 1 AND (? IS NULL OR district = ? OR district IS NULL)
      ORDER BY starts_at DESC, created_at DESC
    `,
    [district ?? null, district ?? null]
  );
}

export async function getAppSaleCategories() {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, slug, name_en, name_bn,
             description_en, description_bn, emoji, interest_slug,
             pref_selectable,
             IF(is_active = 1, 'active', 'soon') AS status
      FROM sale_categories
      ORDER BY sort_order, id
    `
  );
}

// GET /api/v1/sale/animals?species=cattle
// Animal master for the "Animal Type" dropdown (Cow, Bull, Buffalo, Poultry, Goat, Sheep).
export async function getAppAnimals(species?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, slug, name_en, name_bn, species, emoji,
             CAST(sale_category_id AS CHAR) AS sale_category_id
      FROM animals
      WHERE is_active = 1 AND (? IS NULL OR species = ?)
      ORDER BY sort_order, id
    `,
    [species ?? null, species ?? null]
  );
}

// GET /api/v1/geo/divisions
export async function getAppGeoDivisions() {
  return queryRows<Row>(
    "SELECT CAST(id AS CHAR) AS id, name_en, name_bn FROM geo_divisions ORDER BY sort_order, name_en"
  );
}

// GET /api/v1/geo/districts?division_id=3
export async function getAppGeoDistricts(divisionId?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, CAST(division_id AS CHAR) AS division_id, name_en, name_bn
      FROM geo_districts
      WHERE (? IS NULL OR division_id = ?)
      ORDER BY name_en
    `,
    [divisionId ?? null, divisionId ?? null]
  );
}

// GET /api/v1/geo/upazilas?district_id=12  (upazila == thana for listing addresses)
export async function getAppGeoUpazilas(districtId?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, CAST(district_id AS CHAR) AS district_id, name_en, name_bn
      FROM geo_upazilas
      WHERE (? IS NULL OR district_id = ?)
      ORDER BY name_en
    `,
    [districtId ?? null, districtId ?? null]
  );
}

// GET /api/v1/app/sale/price-quote?animal_id=&breed_id=&district=&weight=
// Resolves the approved forward-linkage B2B preset for an animal + breed + region
// (most-specific match wins) and returns the per-kg breakdown + net farmer rate.
export async function getSalePriceQuote(params: {
  animal_id?: string | null;
  breed_id?: string | null;
  sale_item_id?: string | null;
  district?: string | null;
  weight?: string | null;
}) {
  const animalId = params.animal_id ?? null;
  const breedId = params.breed_id ?? null;
  const saleItemId = params.sale_item_id ?? null;
  const district = params.district ?? null;
  const rows = await queryRows<Row>(
    `
      SELECT CAST(r.id AS CHAR) AS id, CAST(r.sale_item_id AS CHAR) AS sale_item_id,
             CAST(r.animal_id AS CHAR) AS animal_id, CAST(r.breed_id AS CHAR) AS breed_id,
             r.district, r.division, r.unit,
             r.b2b_market_rate, r.farmer_rate,
             r.platform_fee, r.logistics_fee, r.warehouse_vet_fee,
             (
               (r.animal_id IS NOT NULL AND r.animal_id = ?) * 8 +
               (r.breed_id IS NOT NULL AND r.breed_id = ?) * 4 +
               (r.district IS NOT NULL AND r.district = ?) * 2
             ) AS match_score
      FROM sale_pricing_rules r
      WHERE r.is_active = 1
        AND (? IS NULL OR r.sale_item_id = ?)
        AND (r.animal_id IS NULL OR r.animal_id = ?)
        AND (r.breed_id IS NULL OR r.breed_id = ?)
        AND (r.district IS NULL OR r.district = ?)
      ORDER BY match_score DESC, r.effective_from DESC, r.id DESC
      LIMIT 1
    `,
    [animalId, breedId, district, saleItemId, saleItemId, animalId, breedId, district]
  );
  const rule = rows[0] ?? null;
  if (!rule) return { rule: null, breakdown: null };
  const b2b = Number(rule.b2b_market_rate ?? 0);
  const platform = Number(rule.platform_fee ?? 0);
  const logistics = Number(rule.logistics_fee ?? 0);
  const vet = Number(rule.warehouse_vet_fee ?? 0);
  const deductions = platform + logistics + vet;
  const netFarmerRate = Number(rule.farmer_rate ?? b2b - deductions);
  const weight = Number(params.weight ?? 0) || 0;
  return {
    rule,
    breakdown: {
      unit: rule.unit ?? "kg",
      district: rule.district ?? null,
      b2b_market_rate: b2b,
      platform_fee: platform,
      logistics_fee: logistics,
      warehouse_vet_fee: vet,
      total_deductions: deductions,
      net_farmer_rate: netFarmerRate,
      weight_kg: weight,
      estimated_earning: weight > 0 ? weight * netFarmerRate : null
    }
  };
}

export async function getAppSaleItems() {
  return queryRows<Row>(
    `
      SELECT CAST(si.id AS CHAR) AS id, si.slug, si.name_en, si.name_bn,
             si.description_en, si.description_bn, si.status, si.metadata,
             sc.slug AS category_slug
      FROM sale_items si
      JOIN sale_categories sc ON sc.id = si.sale_category_id
      ORDER BY sc.sort_order, si.id
    `
  );
}

export async function getAppBreeds(species?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, animal_type, name_en, name_bn, sort_order, is_active
      FROM animal_breeds
      WHERE is_active = 1 AND (? IS NULL OR animal_type = ?)
      ORDER BY animal_type, sort_order, id
    `,
    [species ?? null, species ?? null]
  );
}

export async function getAppPricing() {
  return queryRows<Row>(
    `
      SELECT CAST(r.id AS CHAR) AS id, CAST(r.sale_item_id AS CHAR) AS sale_item_id,
             CAST(r.animal_id AS CHAR) AS animal_id, CAST(r.breed_id AS CHAR) AS breed_id,
             si.slug AS item_slug, si.name_en AS item_name,
             a.name_en AS animal_name, b.name_en AS breed_name,
             r.district, r.division, r.b2b_market_rate, r.farmer_rate,
             r.platform_fee, r.logistics_fee, r.warehouse_vet_fee, r.unit
      FROM sale_pricing_rules r
      JOIN sale_items si ON si.id = r.sale_item_id
      LEFT JOIN animals a ON a.id = r.animal_id
      LEFT JOIN animal_breeds b ON b.id = r.breed_id
      WHERE r.is_active = 1
      ORDER BY r.effective_from DESC, r.id DESC
    `
  );
}

// Only surface categories that actually have sellable products (availability-gated),
// with a live product_count so the app can badge/sort them.
export async function getAppBuyCategories() {
  return queryRows<Row>(
    `
      SELECT CAST(c.id AS CHAR) AS id, c.slug, c.interest_slug, c.name_en, c.name_bn,
             c.description_en, c.description_bn,
             COUNT(p.id) AS product_count
      FROM buy_categories c
      JOIN products p ON p.buy_category_id = c.id AND p.status IN ('active','out_of_stock')
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.sort_order, c.id
    `
  );
}

export async function getAppProducts(category?: string | null, interest?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, p.sku, p.name_en, p.name_bn,
             p.short_description_en, p.short_description_bn,
             p.package_size, p.unit, p.price, p.stock_qty, p.low_stock_threshold,
             p.delivery_window, p.status, p.metadata,
             JSON_UNQUOTE(JSON_EXTRACT(p.metadata, '$.image_url')) AS image_url,
             c.slug AS category_slug, c.name_en AS category_name
      FROM products p
      JOIN buy_categories c ON c.id = p.buy_category_id
      WHERE (? IS NULL OR c.slug = ?)
        AND (? IS NULL OR c.interest_slug = ?)
        AND p.status IN ('active','out_of_stock')
      ORDER BY (p.status = 'active') DESC, p.updated_at DESC, p.id DESC
    `,
    [category ?? null, category ?? null, interest ?? null, interest ?? null]
  );
}
