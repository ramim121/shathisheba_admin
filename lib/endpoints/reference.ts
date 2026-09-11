import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";
import { geoFilter, getUserGeo, weatherGeo } from "@/lib/geo-scope";
import { getDistributorById, pickDistributor, productDistributors } from "@/lib/distribution";
import { ruleFees } from "@/lib/pricing";
import { resolveGeoNames, type GeoIds } from "@/lib/geo";

// Reference and catalogue reads: geography, sale taxonomy, buy categories,
// market updates, weather and price quoting. All are lookup data with no
// personal information, which is why they are the public tier of the API.

export async function getAppMarketUpdates(userId?: string | null) {
  // Untargeted updates show everywhere; targeted ones only inside their area at
  // the market_updates scope. The farmer's own district still sorts first.
  const geo = await getUserGeo(userId);
  const area = await geoFilter("market_updates", "m", geo);
  return queryRows<Row>(
    `
      SELECT CAST(m.id AS CHAR) AS id, m.title_en, m.title_bn, m.body_en, m.body_bn,
             m.image_url, m.detail_en, m.detail_bn, m.update_type, m.category, m.status,
             m.district, m.upazila, m.created_at,
             (m.image_url IS NOT NULL OR m.detail_en IS NOT NULL OR m.detail_bn IS NOT NULL) AS has_detail
      FROM market_updates m
      WHERE m.status = 'active' AND ${area.sql}
      ORDER BY (m.district_id <=> ?) DESC, m.sort_order, m.created_at DESC
    `,
    [...area.params, geo.district_id]
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

export async function getAppWeatherAlerts(userId?: string | null, gpsDistrictId?: string | null, gpsUpazilaId?: string | null) {
  const geo = await weatherGeo(userId, gpsDistrictId, gpsUpazilaId);
  const area = await geoFilter("weather_alerts", "w", geo);
  return queryRows<Row>(
    `
      SELECT CAST(w.id AS CHAR) AS id, w.title_en, w.title_bn, w.body_en, w.body_bn,
             w.body_en AS description_en, w.body_bn AS description_bn,
             w.alert_type, w.severity, w.district, w.upazila
      FROM weather_alerts w
      WHERE w.is_active = 1 AND ${area.sql}
      ORDER BY (w.upazila_id <=> ?) DESC, (w.district_id <=> ?) DESC, w.starts_at DESC, w.created_at DESC
    `,
    [...area.params, geo.upazila_id, geo.district_id]
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

// GET /api/v1/geo/upazilas?district_id=12
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
  user_id?: string | null;
  district?: string | null;
  weight?: string | null;
  meat_weight?: string | null;
}) {
  const animalId = params.animal_id ?? null;
  const breedId = params.breed_id ?? null;
  const saleItemId = params.sale_item_id ?? null;
  // The seller's approved location decides the rule. A district name is still
  // accepted from older app builds, resolved to an id rather than compared as
  // text.
  let geo: GeoIds = await getUserGeo(params.user_id);
  if (!geo.district_id && params.district) {
    const r = await resolveGeoNames({ district: params.district });
    geo = { division_id: r.division_id, district_id: r.district_id, upazila_id: r.upazila_id };
  }
  const area = await geoFilter("sale_pricing", "r", geo);
  const rows = await queryRows<Row>(
    `
      SELECT CAST(r.id AS CHAR) AS id, CAST(r.sale_item_id AS CHAR) AS sale_item_id,
             CAST(r.animal_id AS CHAR) AS animal_id, CAST(r.breed_id AS CHAR) AS breed_id,
             r.district, r.division, r.unit,
             r.b2b_market_rate, r.b2b_meat_rate, r.dressing_pct, r.farmer_rate,
             r.platform_fee, r.platform_fee_pct, r.logistics_fee, r.logistics_fee_pct,
             r.warehouse_vet_fee, r.warehouse_vet_fee_pct,
             (
               -- Animal and breed outrank geography; among equals the most
               -- specific area wins. Geo weights sum to 7, below breed's 32.
               (r.animal_id IS NOT NULL AND r.animal_id = ?) * 64 +
               (r.breed_id IS NOT NULL AND r.breed_id = ?) * 32 +
               (r.upazila_id IS NOT NULL AND r.upazila_id <=> ?) * 4 +
               (r.district_id IS NOT NULL AND r.district_id <=> ?) * 2 +
               (r.division_id IS NOT NULL AND r.division_id <=> ?) * 1
             ) AS match_score
      FROM sale_pricing_rules r
      WHERE r.is_active = 1
        AND (? IS NULL OR r.sale_item_id = ?)
        -- Without this the app, which sends an animal but no sale item, could
        -- be priced off a crop rule: district alone outscored the national
        -- cattle rule and a 200 kg bull came back at the tomato rate. An
        -- animal pins the quote to that animal's sale category.
        AND (
          ? IS NULL
          OR r.sale_item_id IN (
            SELECT si.id FROM sale_items si
            JOIN animals a ON a.sale_category_id = si.sale_category_id
            WHERE a.id = ?
          )
        )
        AND (r.animal_id IS NULL OR r.animal_id = ?)
        AND (r.breed_id IS NULL OR r.breed_id = ?)
        AND ${area.sql}
      ORDER BY match_score DESC, r.effective_from DESC, r.id DESC
      LIMIT 1
    `,
    [animalId, breedId, geo.upazila_id, geo.district_id, geo.division_id,
     saleItemId, saleItemId, animalId, animalId, animalId, breedId, ...area.params]
  );
  const rule = rows[0] ?? null;
  if (!rule) return { rule: null, breakdown: null };

  // Everything on this quote is per kilo of LIVE weight. Traders buy live, so
  // that is the basis the whole breakdown reconciles against; the meat figures
  // are the same money re-expressed for farmers and beparis, who deal in meat.
  const b2bLive = Number(rule.b2b_market_rate ?? 0);
  const dressing = Number(rule.dressing_pct ?? 50) || 50;
  const b2bMeat = Number(rule.b2b_meat_rate ?? 0) || (dressing > 0 ? (b2bLive * 100) / dressing : 0);

  // Each fee is a flat ৳/kg or a % of the live rate (lib/pricing.ts). The net
  // is always derived, so a stale stored farmer_rate cannot drift away from
  // the arithmetic the farmer sees on the screen.
  const fees = ruleFees(rule);
  const platform = fees.platform.amount;
  const logistics = fees.logistics.amount;
  const vet = fees.care.amount;
  const pct = fees.platform.pct;
  const deductions = fees.deductions;
  const netFarmerRate = fees.net;

  // Either weight identifies the animal; whichever the caller sends, the other
  // is derived so both sides of the trade see their own unit.
  const liveIn = Number(params.weight ?? 0) || 0;
  const meatIn = Number(params.meat_weight ?? 0) || 0;
  const liveWeight = liveIn > 0 ? liveIn : meatIn > 0 ? (meatIn * 100) / dressing : 0;
  const meatWeight = meatIn > 0 ? meatIn : (liveWeight * dressing) / 100;

  return {
    rule,
    breakdown: {
      unit: rule.unit ?? "kg",
      district: rule.district ?? null,
      basis: "live_weight",
      dressing_pct: dressing,
      b2b_market_rate: b2bLive,
      b2b_meat_rate: b2bMeat,
      platform_fee: platform,
      platform_fee_pct: pct,
      logistics_fee: logistics,
      logistics_fee_pct: fees.logistics.pct,
      warehouse_vet_fee: vet,
      warehouse_vet_fee_pct: fees.care.pct,
      total_deductions: deductions,
      net_farmer_rate: netFarmerRate,
      net_farmer_meat_rate: dressing > 0 ? (netFarmerRate * 100) / dressing : 0,
      weight_kg: liveWeight,
      meat_weight_kg: meatWeight,
      estimated_earning: liveWeight > 0 ? liveWeight * netFarmerRate : null
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
// A product is offered where one of its distributors serves the buyer (see
// lib/distribution.ts); a product with no distributor is sold everywhere.
// Filtered in code rather than SQL because the same pick also names the
// distributor the order will go to.
export async function getAppBuyCategories(userId?: string | null) {
  const [cats, products, geo] = await Promise.all([
    queryRows<Row>(
      `SELECT CAST(c.id AS CHAR) AS id, c.slug, c.interest_slug, c.name_en, c.name_bn, c.description_en, c.description_bn
         FROM buy_categories c WHERE c.is_active = 1 ORDER BY c.sort_order, c.id`
    ),
    queryRows<Row>("SELECT id, buy_category_id FROM products WHERE status IN ('active','out_of_stock')"),
    getUserGeo(userId)
  ]);
  const links = await productDistributors(products.map((p) => Number(p.id)));
  const counts = new Map<string, number>();
  for (const p of products) {
    if (!pickDistributor(links.get(Number(p.id)), geo).available) continue;
    const key = String(p.buy_category_id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return cats.filter((c) => counts.has(String(c.id))).map((c) => ({ ...c, product_count: counts.get(String(c.id)) ?? 0 }));
}

export async function getAppProducts(category?: string | null, interest?: string | null, userId?: string | null, manufacturerId?: string | null) {
  const [rows, geo] = await Promise.all([
    queryRows<Row>(
      `
        SELECT CAST(p.id AS CHAR) AS id, p.sku, p.name_en, p.name_bn,
               p.short_description_en, p.short_description_bn,
               p.package_size, p.package_size_bn, p.unit, p.price, p.stock_qty, p.low_stock_threshold,
               p.delivery_window, p.delivery_window_bn, p.status, p.metadata,
               JSON_UNQUOTE(JSON_EXTRACT(p.metadata, '$.image_url')) AS image_url,
               CAST(m.id AS CHAR) AS manufacturer_id, m.name_en AS manufacturer_name, m.name_bn AS manufacturer_name_bn,
               COALESCE(m.short_name_en, m.name_en) AS manufacturer_short, COALESCE(m.short_name_bn, m.name_bn) AS manufacturer_short_bn,
               m.logo_url AS manufacturer_logo,
               c.slug AS category_slug, c.name_en AS category_name, c.name_bn AS category_name_bn
        FROM products p
        JOIN buy_categories c ON c.id = p.buy_category_id
        LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
        WHERE (? IS NULL OR c.slug = ?)
          AND (? IS NULL OR c.interest_slug = ?)
          AND (? IS NULL OR p.manufacturer_id = ?)
          AND p.status IN ('active','out_of_stock')
        ORDER BY (p.status = 'active') DESC, p.updated_at DESC, p.id DESC
      `,
      [category ?? null, category ?? null, interest ?? null, interest ?? null, manufacturerId ?? null, manufacturerId ?? null]
    ),
    getUserGeo(userId)
  ]);
  const links = await productDistributors(rows.map((r) => Number(r.id)));
  return rows.flatMap((r) => {
    const pick = pickDistributor(links.get(Number(r.id)), geo);
    if (!pick.available) return [];
    const d = pick.distributor;
    return [{
      ...r,
      distributor_id: d ? String(d.id) : null,
      distributor_name: d ? d.short_name_en ?? d.name_en : null,
      distributor_name_bn: d ? d.short_name_bn ?? d.name_bn : null,
      distributor_logo: d?.logo_url ?? null,
      distributor_lock: d?.lock ?? "none",
      distributor_area: d?.area_en ?? "Nationwide",
      distributor_area_bn: d?.area_bn ?? "সারা দেশ"
    }];
  });
}

// GET /api/v1/app/brands/manufacturer?manufacturer_id=  — the modal behind "Made by".
export async function getAppManufacturer(manufacturerId?: string | null) {
  if (!manufacturerId) return null;
  const [m] = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, code, name_en, name_bn, short_name_en, short_name_bn, logo_url,
            description_en, description_bn, address_en, address_bn, factory_address_en, factory_address_bn,
            phone, email, website, registration_no, contact_person, established_year
       FROM manufacturers WHERE id = ? AND is_active = 1 LIMIT 1`,
    [manufacturerId]
  );
  if (!m) return null;
  const [count] = await queryRows<Row>("SELECT COUNT(*) AS n FROM products WHERE manufacturer_id = ? AND status = 'active'", [manufacturerId]);
  return { ...m, kind: "manufacturer", product_count: Number(count?.n ?? 0) };
}

// GET /api/v1/app/brands/distributor?distributor_id=  — the modal behind "Distributed by".
export async function getAppDistributor(distributorId?: string | null) {
  const d = await getDistributorById(distributorId);
  if (!d) return null;
  const [extra] = await queryRows<Row>(
    `SELECT description_en, description_bn, services_en, services_bn, email, website, registration_no,
            contact_person, established_year
       FROM distributors WHERE id = ? AND is_active = 1 LIMIT 1`,
    [distributorId]
  );
  if (!extra) return null;
  const [count] = await queryRows<Row>(
    `SELECT COUNT(*) AS n FROM product_distributors pd JOIN products p ON p.id = pd.product_id
      WHERE pd.distributor_id = ? AND pd.is_active = 1 AND p.status = 'active'`,
    [distributorId]
  );
  return { ...d, ...extra, id: String(d.id), kind: "distributor", product_count: Number(count?.n ?? 0) };
}
