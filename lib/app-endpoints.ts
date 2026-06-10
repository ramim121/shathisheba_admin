import { executeQuery, queryRows } from "@/lib/db";
import { generateToken } from "@/lib/auth";
import { isSmsDevMode, sendSms } from "@/lib/sms";

// Composite, app-facing read/write helpers used by the mobile app.
// These sit on top of the generic CRUD resources and shape responses
// the way each app screen consumes them.

type Row = Record<string, unknown>;

// GET /api/v1/app/onboarding
// Returns root interest categories with their children grouped by step_group,
// matching the multi-step onboarding screens.
export async function getOnboardingTree() {
  const rows = await queryRows<Row>(
    `
      SELECT
        CAST(id AS CHAR) AS id,
        CAST(parent_id AS CHAR) AS parent_id,
        slug,
        name_en,
        name_bn,
        emoji,
        sort_order,
        step_group,
        is_selectable,
        is_active
      FROM interest_categories
      WHERE is_active = 1
      ORDER BY sort_order, id
    `
  );

  const roots = rows.filter((row) => row.parent_id === null);
  return roots.map((root) => {
    const children = rows.filter((row) => String(row.parent_id) === String(root.id));
    return {
      id: root.id,
      slug: root.slug,
      name_en: root.name_en,
      name_bn: root.name_bn,
      emoji: root.emoji,
      step_group: root.step_group,
      is_selectable: root.is_selectable,
      children: children.map((child) => ({
        id: child.id,
        slug: child.slug,
        name_en: child.name_en,
        name_bn: child.name_bn,
        emoji: child.emoji,
        step_group: child.step_group
      }))
    };
  });
}

// GET /api/v1/app/home
// Greeting, weather summary, quick stats, service tiles, market updates,
// and the Ask Shathi Apa card — mirrors the Home screen.
export async function getHomeFeed(userId?: string | null, district?: string | null) {
  const userRows = userId
    ? await queryRows<Row>("SELECT id, full_name, display_name, district, upazila FROM app_users WHERE id = ? LIMIT 1", [userId])
    : [];
  const user = userRows[0] ?? null;
  const targetDistrict = district ?? (user?.district as string | undefined) ?? "Mymensingh";

  const weatherRows = await queryRows<Row>(
    `
      SELECT
        district, upazila, alert_type, severity, title_en, title_bn,
        body_en, body_bn, weather_payload
      FROM weather_alerts
      WHERE is_active = 1 AND (district = ? OR district IS NULL)
      ORDER BY (district = ?) DESC, starts_at DESC
      LIMIT 1
    `,
    [targetDistrict, targetDistrict]
  );

  let listingCount = 0;
  let orderCount = 0;
  let earning = 0;
  if (userId) {
    const stats = await queryRows<Row>(
      `
        SELECT
          (SELECT COUNT(*) FROM sale_listings WHERE user_id = ?) AS listings,
          (SELECT COUNT(*) FROM orders WHERE user_id = ?) AS orders,
          (SELECT COALESCE(SUM(estimated_earning), 0) FROM sale_listings WHERE user_id = ? AND status IN ('active','sold')) AS earning
      `,
      [userId, userId, userId]
    );
    listingCount = Number(stats[0]?.listings ?? 0);
    orderCount = Number(stats[0]?.orders ?? 0);
    earning = Number(stats[0]?.earning ?? 0);
  }

  const marketUpdates = await queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, title_en, title_bn, body_en, update_type, status
      FROM market_updates
      WHERE status = 'active' AND (district = ? OR district IS NULL)
      ORDER BY sort_order, created_at DESC
      LIMIT 6
    `,
    [targetDistrict]
  );

  const assistantRows = await queryRows<Row>(
    `
      SELECT prompt_type, title_en, title_bn, body_en, body_bn
      FROM ai_assistant_prompts
      WHERE is_active = 1
      ORDER BY prompt_type, sort_order, id
    `
  );
  const assistantConfig = assistantRows.find((row) => row.prompt_type === "config") ?? null;
  const quickPrompts = assistantRows.filter((row) => row.prompt_type === "quick_prompt");

  return {
    greeting: {
      name: (user?.display_name as string) ?? (user?.full_name as string) ?? "Farmer",
      district: targetDistrict,
      upazila: (user?.upazila as string) ?? null
    },
    weather: weatherRows[0] ?? null,
    stats: { listings: listingCount, orders: orderCount, earnings: earning },
    services: [
      { key: "list-for-sale", title_en: "List for Sale", title_bn: "বিক্রির জন্য তালিকা", subtitle_en: "Sell livestock & produce" },
      { key: "buy-from-shathi", title_en: "Buy from Shathi", title_bn: "শাথী থেকে কিনুন", subtitle_en: "Seeds, feed, fertilizer & more" },
      { key: "training-modules", title_en: "Training Modules", title_bn: "প্রশিক্ষণ মডিউল", subtitle_en: "Videos & expert advice" },
      { key: "shathi-partner", title_en: "Shathi Partner", title_bn: "শাথী পার্টনার", subtitle_en: "Contract farming & loans" }
    ],
    market_updates: marketUpdates,
    assistant: { config: assistantConfig, quick_prompts: quickPrompts }
  };
}

// POST /api/v1/app/orders
// Composite order placement: orders + order_items in one call.
export async function placeOrder(payload: Row) {
  const userId = payload.user_id;
  const items = Array.isArray(payload.items) ? (payload.items as Row[]) : [];
  if (!userId || items.length === 0) {
    throw new Error("user_id and at least one item are required.");
  }

  const totalAmount = items.reduce((sum, item) => {
    const qty = Number(item.quantity ?? 0);
    const price = Number(item.unit_price ?? 0);
    return sum + qty * price;
  }, 0);
  const deliveryFee = Number(payload.delivery_fee ?? (totalAmount >= 500 ? 0 : 0));
  const payable = totalAmount + deliveryFee;
  const orderCode = `ORD-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;

  const orderResult = await executeQuery(
    `
      INSERT INTO orders
        (order_code, user_id, total_amount, delivery_fee, payable_amount, payment_method, payment_status, fulfillment_status, delivery_address, district, upazila, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 'placed', ?, ?, ?, ?)
    `,
    [
      orderCode,
      userId,
      totalAmount,
      deliveryFee,
      payable,
      payload.payment_method ?? "cash",
      payload.delivery_address ?? "Address",
      payload.district ?? null,
      payload.upazila ?? null,
      payload.notes ?? null
    ]
  );

  const orderId = orderResult.insertId;
  for (const item of items) {
    const qty = Number(item.quantity ?? 0);
    const price = Number(item.unit_price ?? 0);
    await executeQuery(
      "INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)",
      [orderId, item.product_id, qty, price, qty * price]
    );
  }

  return {
    order_id: orderId,
    order_code: orderCode,
    total_amount: totalAmount,
    delivery_fee: deliveryFee,
    payable_amount: payable,
    estimated_delivery: "1-3 working days"
  };
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/v1/app/kyc/submit
// Creates a partner KYC application for a project and records the NID on the
// user profile. Returns the created application.
export async function submitKycApplication(payload: Row) {
  const userId = payload.user_id;
  const projectId = payload.partner_project_id;
  if (!userId) throw new Error("user_id is required.");
  if (!projectId) throw new Error("A project is required.");
  const fullName = (payload.full_name_per_nid ?? "").toString().trim();
  const nid = (payload.nid_number ?? "").toString().trim();
  if (!fullName) throw new Error("Full name (per NID) is required.");
  if (!nid) throw new Error("NID number is required.");

  // Record the NID on the user profile (best-effort; does not overwrite).
  await executeQuery(
    "UPDATE app_users SET nid_number = COALESCE(NULLIF(nid_number, ''), ?) WHERE id = ?",
    [nid, userId]
  );

  const code = (payload.application_code ?? `KYC-APP-${Date.now()}`).toString();
  const result = await executeQuery(
    `
      INSERT INTO partner_applications
        (application_code, user_id, partner_project_id, current_step,
         full_name_per_nid, nid_number, total_land_decimals, livestock_count,
         primary_income_source, annual_household_income, mobile_banking_provider,
         verification_notes, status)
      VALUES (?, ?, ?, 'personal_kyc', ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
    `,
    [
      code, userId, projectId,
      fullName, nid,
      payload.total_land_decimals != null ? Number(payload.total_land_decimals) : null,
      payload.livestock_count != null ? Number(payload.livestock_count) : null,
      (payload.primary_income_source ?? null) as string | null,
      payload.annual_household_income != null ? Number(payload.annual_household_income) : null,
      (payload.mobile_banking_provider ?? null) as string | null,
      (payload.verification_notes ?? "Submitted from mobile app.") as string,
    ]
  );
  return { application_id: result.insertId, application_code: code, status: "submitted" };
}

// POST /api/v1/app/sale/confirm
// Records actual weight + final amount, creates a payment_confirmation, issues a 10-min OTP.
export async function createSaleConfirmation(payload: Row) {
  const listingId = payload.sale_listing_id;
  if (!listingId) {
    throw new Error("sale_listing_id is required.");
  }

  const listings = await queryRows<Row>(
    `
      SELECT l.id, l.weight_kg, COALESCE(r.farmer_rate, 0) AS farmer_rate
      FROM sale_listings l
      LEFT JOIN sale_pricing_rules r ON r.sale_item_id = l.sale_item_id AND r.is_active = 1
      WHERE l.id = ?
      ORDER BY r.effective_from DESC
      LIMIT 1
    `,
    [listingId]
  );
  if (listings.length === 0) {
    throw new Error("Sale listing not found.");
  }

  const actualWeight = Number(payload.actual_weight_kg ?? listings[0].weight_kg ?? 0);
  const farmerRate = Number(listings[0].farmer_rate ?? 0);
  const finalAmount = Number(payload.final_amount ?? actualWeight * farmerRate);
  const otp = generateOtp();

  const result = await executeQuery(
    `
      INSERT INTO payment_confirmations
        (sale_listing_id, actual_weight_kg, final_amount, otp_code, otp_expires_at, status)
      VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 'pending')
    `,
    [listingId, actualWeight, finalAmount, otp]
  );

  return {
    confirmation_id: result.insertId,
    sale_listing_id: listingId,
    actual_weight_kg: actualWeight,
    final_amount: finalAmount,
    otp_code: otp,
    expires_in_minutes: 10
  };
}

// POST /api/v1/app/sale/verify-otp
// Verifies the OTP (single-use, expiry-checked), confirms payment and marks listing sold.
export async function verifyOtp(payload: Row) {
  const otp = payload.otp_code;
  const listingId = payload.sale_listing_id;
  if (!otp || !listingId) {
    throw new Error("sale_listing_id and otp_code are required.");
  }

  const rows = await queryRows<Row>(
    `
      SELECT id, otp_code, otp_expires_at, status
      FROM payment_confirmations
      WHERE sale_listing_id = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [listingId]
  );
  const confirmation = rows[0];
  if (!confirmation) {
    throw new Error("No pending confirmation found for this listing.");
  }

  const expired = new Date(confirmation.otp_expires_at as string).getTime() < Date.now();
  if (expired) {
    await executeQuery("UPDATE payment_confirmations SET status = 'expired' WHERE id = ?", [confirmation.id]);
    throw new Error("OTP has expired. Generate a new one.");
  }

  if (String(confirmation.otp_code) !== String(otp)) {
    throw new Error("Invalid OTP.");
  }

  await executeQuery(
    "UPDATE payment_confirmations SET status = 'confirmed', confirmed_at = NOW() WHERE id = ?",
    [confirmation.id]
  );
  await executeQuery("UPDATE sale_listings SET status = 'sold' WHERE id = ?", [listingId]);

  return { confirmation_id: confirmation.id, sale_listing_id: listingId, status: "confirmed" };
}

// ---------------------------------------------------------------------------
// App-facing list reads.
// The /api/v1 route is consumed by the mobile app (the admin panel reads
// lib/db-resources directly, server-side). These return RAW bilingual + detail
// columns the app's rowTitle/rowBody/localized helpers expect, instead of the
// admin-table display shapes in lib/db-resources.ts.
// ---------------------------------------------------------------------------

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

export async function getAppLearningModules() {
  return queryRows<Row>(
    `
      SELECT CAST(m.id AS CHAR) AS id, m.title_en, m.title_bn,
             m.subtitle_en, m.subtitle_bn, m.status, c.slug AS category_slug
      FROM learning_modules m
      JOIN learning_categories c ON c.id = m.learning_category_id
      ORDER BY m.sort_order, m.id
    `
  );
}

export async function getAppLearningContents() {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, CAST(learning_module_id AS CHAR) AS learning_module_id,
             content_type, title_en, title_bn, body_en, body_bn,
             video_url, duration_seconds, quiz_json, status
      FROM learning_contents
      WHERE status = 'published' OR status IS NULL
      ORDER BY sort_order, id
    `
  );
}

export async function getAppPartnerProjects() {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, project_code, name_en, name_bn,
             interest_slug, division, district, upazila, image_url,
             summary_en, summary_bn, market_overview_en, market_overview_bn,
             investment_amount, duration_label, region_based, is_active,
             platform_fee, logistics_fee, warehouse_vet_fee,
             status, capacity, lender_name, max_credit_amount,
             start_date, end_date, steps_json
      FROM partner_projects
      ORDER BY created_at DESC, id DESC
    `
  );
}

// Root interest slugs a user selected (children resolved up to their root).
async function userRootInterestSlugs(userId?: string | null): Promise<string[]> {
  if (!userId) return [];
  const rows = await queryRows<Row>(
    `
      SELECT DISTINCT COALESCE(parent.slug, ic.slug) AS root_slug
      FROM user_interests ui
      JOIN interest_categories ic ON ic.id = ui.interest_category_id
      LEFT JOIN interest_categories parent ON parent.id = ic.parent_id
      WHERE ui.user_id = ?
    `,
    [userId]
  );
  return rows.map((r) => String(r.root_slug)).filter(Boolean);
}

async function resolveUserRegion(userId?: string | null, division?: string | null, district?: string | null) {
  if ((division && district) || !userId) return { division: division ?? null, district: district ?? null };
  const u = await queryRows<Row>("SELECT district FROM app_users WHERE id = ? LIMIT 1", [userId]);
  return { division: division ?? null, district: district ?? (u[0]?.district as string | undefined) ?? null };
}

// GET /api/v1/app/projects/active?user_id=&division=&district=
// "Projects active in your area": active, non-expired projects that are either
// open to all (region_based=0) or match the user's division/district. Projects
// matching the user's interests are flagged (matches_interest) for the tag.
export async function getAppActiveProjects(userId?: string | null, division?: string | null, district?: string | null) {
  const region = await resolveUserRegion(userId, division, district);
  const interests = await userRootInterestSlugs(userId);
  const interestList = interests.length ? interests : [""];
  const placeholders = interestList.map(() => "?").join(", ");
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, p.project_code, p.name_en, p.name_bn,
             p.interest_slug, p.division, p.district, p.upazila, p.image_url,
             p.summary_en, p.summary_bn, p.market_overview_en, p.market_overview_bn,
             p.investment_amount, p.duration_label, p.region_based, p.lender_name,
             p.max_credit_amount, p.capacity, p.status, p.start_date, p.end_date,
             (p.interest_slug IN (${placeholders})) AS matches_interest,
             (SELECT COUNT(*) FROM partner_applications a WHERE a.partner_project_id = p.id) AS enrolled
      FROM partner_projects p
      WHERE p.is_active = 1
        AND p.status IN ('open', 'opening_soon')
        AND (p.end_date IS NULL OR p.end_date >= CURDATE())
        AND (p.region_based = 0 OR p.division = ? OR p.district = ?)
      ORDER BY matches_interest DESC, FIELD(p.status,'open','opening_soon'), p.start_date
    `,
    [...interestList, region.division, region.district]
  );
}

// GET /api/v1/app/projects/mine?user_id=
// "My Projects": the projects a user has enrolled in (via partner_applications).
export async function getAppMyProjects(userId?: string | null) {
  if (!userId) return [];
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, p.project_code, p.name_en, p.name_bn,
             p.interest_slug, p.division, p.district, p.upazila, p.image_url,
             p.summary_en, p.summary_bn, p.duration_label, p.investment_amount,
             p.status AS project_status, p.start_date, p.end_date, p.steps_json,
             CAST(a.id AS CHAR) AS application_id, a.application_code,
             a.current_step, a.status AS application_status,
             (a.status = 'approved') AS is_approved,
             u.is_kyc_verified AS kyc_verified,
             (a.nid_number IS NOT NULL AND a.nid_number <> '') AS kyc_submitted,
             (EXISTS (SELECT 1 FROM app_user_banking b WHERE b.user_id = a.user_id)) AS has_banking,
             (a.farm_assessment_json IS NOT NULL
               OR EXISTS (SELECT 1 FROM app_user_farm f WHERE f.user_id = a.user_id)) AS has_farm_assessment,
             a.created_at AS applied_at
      FROM partner_applications a
      JOIN partner_projects p ON p.id = a.partner_project_id
      JOIN app_users u ON u.id = a.user_id
      WHERE a.user_id = ?
      ORDER BY a.updated_at DESC, a.id DESC
    `,
    [userId]
  );
}

// GET /api/v1/app/sale/category-availability?user_id=&division=&district=
// Returns the interest_slugs that have at least one active project in the
// user's region (or open) — used to enable/disable List-for-Sale categories.
export async function getSaleCategoryAvailability(userId?: string | null, division?: string | null, district?: string | null) {
  const region = await resolveUserRegion(userId, division, district);
  const rows = await queryRows<Row>(
    `
      SELECT DISTINCT p.interest_slug
      FROM partner_projects p
      WHERE p.is_active = 1
        AND p.status IN ('open', 'opening_soon')
        AND (p.end_date IS NULL OR p.end_date >= CURDATE())
        AND p.interest_slug IS NOT NULL
        AND (p.region_based = 0 OR p.division = ? OR p.district = ?)
    `,
    [region.division, region.district]
  );
  const available = rows.map((r) => String(r.interest_slug));
  return { region, available };
}

// GET /api/v1/app/projects/prev-rates?animal_id=&breed_id=&district=
// Previous B2B market rates for the same animal/breed/region (for the admin
// project-pricing section and the app's market context).
export async function getProjectPrevRates(animalId?: string | null, breedId?: string | null, district?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(r.id AS CHAR) AS id, CAST(r.partner_project_id AS CHAR) AS partner_project_id,
             r.district, r.division, r.b2b_market_rate, r.farmer_rate, r.unit,
             r.effective_from, p.name_en AS project_name
      FROM sale_pricing_rules r
      LEFT JOIN partner_projects p ON p.id = r.partner_project_id
      WHERE (? IS NULL OR r.animal_id = ?)
        AND (? IS NULL OR r.breed_id = ?)
        AND (? IS NULL OR r.district = ?)
      ORDER BY r.effective_from DESC, r.id DESC
      LIMIT 20
    `,
    [animalId ?? null, animalId ?? null, breedId ?? null, breedId ?? null, district ?? null, district ?? null]
  );
}

export async function getAppPartnerLedgers() {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, CAST(partner_application_id AS CHAR) AS partner_application_id,
             entry_type, title_en, title_bn, amount, entry_date
      FROM project_ledgers
      ORDER BY entry_date DESC, id DESC
    `
  );
}

export async function getAppCommunityPosts(scope?: string | null, district?: string | null, filter?: string | null, userId?: string | null) {
  const s = scope && scope !== "all" ? scope : null;
  const d = district && district.trim() ? district.trim() : null;

  // "Sale listings" filter: approved listings of the user's area straight from
  // the marketplace table, shaped like feed posts.
  if (filter === "listings") {
    return queryRows<Row>(
      `
        SELECT CONCAT('listing-', l.id) AS id, u.full_name AS farmer_name,
               'notice' AS post_type,
               CONCAT('🏷️ ', COALESCE(l.title_en, 'Marketplace item'), ' — ', l.quantity, ' ', l.unit,
                      COALESCE(CONCAT(' · ৳', FORMAT(l.farmer_expected_price, 0)), '')) AS body,
               JSON_UNQUOTE(JSON_EXTRACT(l.media_json, '$[0]')) AS image_url,
               0 AS is_official, 0 AS like_count, 0 AS comment_count,
               l.district, l.upazila, 'district' AS scope, 'visible' AS status, l.created_at,
               1 AS is_listing
        FROM sale_listings l
        JOIN app_users u ON u.id = l.user_id
        WHERE l.status = 'active'
          AND (? IS NULL OR l.district IS NULL OR l.district = ?)
        ORDER BY l.created_at DESC
        LIMIT 50
      `,
      [d, d]
    );
  }

  const mine = filter === "mine" && userId ? userId : null;
  // "all" drops the regional restriction; default/"regional" keeps it.
  const regional = filter === "all" ? null : d;
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, u.full_name AS farmer_name,
             p.post_type, p.body, p.image_url, p.is_official, p.like_count, p.comment_count,
             p.district, p.upazila, p.scope, p.status, p.created_at,
             (p.post_type = 'notice' AND p.body LIKE '🏷️%') AS is_listing
      FROM community_posts p
      JOIN app_users u ON u.id = p.user_id
      WHERE p.status = 'visible' AND (? IS NULL OR p.scope = ?)
        AND (? IS NULL OR p.user_id = ?)
        -- Regional feed: nationwide posts always show; district-tagged posts only
        -- show to users of that district (when the app sends one).
        AND (? IS NULL OR p.district IS NULL OR p.scope = 'bangladesh' OR p.district = ?)
      ORDER BY p.is_official DESC, p.created_at DESC
      LIMIT 50
    `,
    [s, s, mine, mine, regional, regional]
  );
}

export async function getAppOfficers(district?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, name, officer_role AS role,
             district, upazila, phone
      FROM zone_officers
      WHERE is_active = 1 AND (? IS NULL OR district = ? OR district IS NULL)
      ORDER BY district, upazila, officer_role
    `,
    [district ?? null, district ?? null]
  );
}

export async function getAppProfileUsers(userId?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, display_name, full_name, phone,
             email, district, upazila, status
      FROM app_users
      WHERE (? IS NULL OR id = ?)
      ORDER BY (? IS NOT NULL AND id = ?) DESC, created_at DESC
      LIMIT 20
    `,
    [userId ?? null, userId ?? null, userId ?? null, userId ?? null]
  );
}

export const APP_ROLES = ["field_officer", "shathisheba_seller", "shathisheba_buyer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export async function getUserRoles(userId: string | number): Promise<AppRole[]> {
  const rows = await queryRows<Row>("SELECT role FROM app_user_roles WHERE user_id = ? ORDER BY role", [userId]);
  return rows.map((r) => r.role as AppRole);
}

// POST /api/v1/app/user-roles/set  { user_id, roles: string[] }
// Replaces a user's roles with the given set (multi-select from the admin).
export async function setUserRoles(payload: Row) {
  const userId = payload.user_id;
  if (!userId) throw new Error("user_id is required.");
  const incoming = Array.isArray(payload.roles) ? (payload.roles as unknown[]).map(String) : [];
  const roles = incoming.filter((r): r is AppRole => (APP_ROLES as readonly string[]).includes(r));
  if (roles.length === 0) {
    throw new Error("Select at least one role.");
  }
  const users = await queryRows<Row>("SELECT id, full_name, phone FROM app_users WHERE id = ? LIMIT 1", [userId]);
  if (users.length === 0) throw new Error("User not found.");

  await executeQuery("DELETE FROM app_user_roles WHERE user_id = ?", [userId]);
  for (const role of roles) {
    await executeQuery(
      "INSERT IGNORE INTO app_user_roles (user_id, role, assigned_by) VALUES (?, ?, ?)",
      [userId, role, payload.assigned_by ?? null]
    );
  }
  return {
    user_id: String(userId),
    full_name: users[0].full_name,
    phone: users[0].phone,
    roles: await getUserRoles(String(userId))
  };
}

// GET /api/v1/app/admin/notifications
// Admin alerts: newly registered app users and KYC documents awaiting approval.
export async function getAdminNotifications() {
  const newUsers = await queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, full_name, phone,
             CONCAT(COALESCE(district,''), CASE WHEN upazila IS NOT NULL THEN CONCAT(' / ', upazila) ELSE '' END) AS location,
             created_at
      FROM app_users
      ORDER BY created_at DESC
      LIMIT 15
    `
  );
  const pendingKyc = await queryRows<Row>(
    `
      SELECT CAST(k.id AS CHAR) AS id, CAST(k.user_id AS CHAR) AS user_id,
             u.full_name, u.phone, k.doc_type, k.document_url, k.created_at
      FROM app_user_kyc_documents k
      JOIN app_users u ON u.id = k.user_id
      WHERE k.status = 'pending'
      ORDER BY k.created_at DESC
      LIMIT 30
    `
  );
  const counts = await queryRows<Row>(
    `
      SELECT
        (SELECT COUNT(*) FROM app_users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) AS new_users_24h,
        (SELECT COUNT(*) FROM app_users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS new_users_7d,
        (SELECT COUNT(*) FROM app_user_kyc_documents WHERE status = 'pending') AS pending_kyc
    `
  );
  const c = counts[0] || {};
  return {
    counts: {
      new_users_24h: Number(c.new_users_24h ?? 0),
      new_users_7d: Number(c.new_users_7d ?? 0),
      pending_kyc: Number(c.pending_kyc ?? 0),
      total: Number(c.new_users_24h ?? 0) + Number(c.pending_kyc ?? 0)
    },
    new_users: newUsers,
    pending_kyc: pendingKyc
  };
}

// GET /api/v1/app/users-with-roles  -> users + their role array (for the admin role editor).
export async function getUsersWithRoles() {
  const rows = await queryRows<Row>(
    `
      SELECT CAST(u.id AS CHAR) AS id, u.full_name, u.phone,
             CONCAT(COALESCE(u.district,''), CASE WHEN u.upazila IS NOT NULL THEN CONCAT(' / ', u.upazila) ELSE '' END) AS location,
             COALESCE(GROUP_CONCAT(r.role ORDER BY r.role SEPARATOR ','), '') AS roles
      FROM app_users u
      LEFT JOIN app_user_roles r ON r.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT 500
    `
  );
  return rows.map((r) => ({ ...r, roles: r.roles ? String(r.roles).split(",").filter(Boolean) : [] }));
}

// Shapes the app-facing user object: identity, profile fields, roles, and the
// onboarding gates (personal info + preferences) the app uses to route screens.
// Latest KYC document status per type + banking presence, for the contact
// section chips and the profile KYC screen.
async function buildKycSummary(userId: number | string) {
  const docs = await queryRows<Row>(
    "SELECT doc_type, status, created_at FROM app_user_kyc_documents WHERE user_id = ? ORDER BY created_at",
    [userId]
  );
  const latest: Record<string, string> = {};
  for (const d of docs) latest[String(d.doc_type)] = String(d.status); // last wins (chronological)
  const banking = await queryRows<Row>("SELECT 1 FROM app_user_banking WHERE user_id = ? LIMIT 1", [userId]);
  const statusOf = (...types: string[]) => {
    const found = types.map((t) => latest[t]).filter(Boolean);
    if (found.includes("verified")) return "verified";
    if (found.includes("pending")) return "pending";
    if (found.includes("rejected")) return "rejected";
    return "none";
  };
  return {
    nid: statusOf("nid_front", "nid_back"),
    selfie: statusOf("selfie"),
    trade_license: statusOf("trade_license"),
    banking: banking.length > 0,
    document_count: docs.length
  };
}

async function buildAppUser(user: Row) {
  const profile = typeof user.profile_json === "string" ? safeJson(user.profile_json) : (user.profile_json as Row | null);
  const roles = await getUserRoles(user.id as number);
  const kyc = await buildKycSummary(user.id as number);
  return {
    id: String(user.id),
    full_name: user.full_name ?? null,
    display_name: user.display_name ?? null,
    phone: user.phone ?? null,
    gender: user.gender ?? null,
    date_of_birth: user.date_of_birth ?? null,
    division: user.division ?? null,
    district: user.district ?? null,
    upazila: user.upazila ?? null,
    profile_image_url: user.profile_image_url ?? null,
    status: user.status ?? "active",
    roles,
    preferences: (profile && profile.preferences) ?? null,
    is_kyc_verified: Number(user.is_kyc_verified ?? 0) === 1,
    nid_number: user.nid_number ?? null,
    kyc,
    needs_personal_info: Number(user.personal_info_completed ?? 0) === 0,
    needs_preferences: !(profile && profile.preferences)
  };
}

// POST /api/v1/app/auth/request-otp  { phone }
// Generates a one-time code, stores it (5 min expiry), and sends it via BulkSMSBD.
// In dev mode (OTP_DEV_MODE=true) the SMS is skipped and the code is returned.
export async function requestOtp(payload: Row) {
  const phone = (payload.phone ?? "").toString().trim();
  if (!/^[0-9+]{6,15}$/.test(phone)) {
    throw new Error("A valid phone number is required.");
  }
  const code = String(Math.floor(1000 + Math.random() * 9000));

  // Invalidate any earlier unconsumed codes for this phone, then store the new one.
  await executeQuery("UPDATE app_otps SET consumed = 1 WHERE phone = ? AND consumed = 0", [phone]);
  await executeQuery(
    "INSERT INTO app_otps (phone, code, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))",
    [phone, code]
  );

  const brand = process.env.OTP_BRAND || "Shathi Sheba";
  const sms = await sendSms(phone, `${brand} OTP is ${code}`);

  return {
    sent: sms.ok,
    expires_in_seconds: 300,
    // Only exposed in dev mode so testing works without spending SMS credits.
    dev_otp: isSmsDevMode() ? code : undefined,
    gateway_code: sms.code
  };
}

// POST /api/v1/app/auth/verify-otp  { phone, code }
// Verifies the code (or the master dev code), creates the user on first login
// with the default buyer role, issues a session token, and returns the app user.
export async function verifyOtpLogin(payload: Row) {
  const phone = (payload.phone ?? "").toString().trim();
  const code = (payload.code ?? "").toString().trim();
  if (!phone || !code) {
    throw new Error("Phone and code are required.");
  }

  const master = process.env.OTP_DEV_MASTER;
  const isMaster = Boolean(master) && code === master;

  if (!isMaster) {
    const otps = await queryRows<Row>(
      "SELECT id, code, attempts FROM app_otps WHERE phone = ? AND consumed = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
      [phone]
    );
    const otp = otps[0];
    if (!otp) {
      throw new Error("Code expired or not found. Please request a new code.");
    }
    if (Number(otp.attempts) >= 5) {
      throw new Error("Too many attempts. Please request a new code.");
    }
    if (String(otp.code) !== code) {
      await executeQuery("UPDATE app_otps SET attempts = attempts + 1 WHERE id = ?", [otp.id]);
      throw new Error("Incorrect code.");
    }
    await executeQuery("UPDATE app_otps SET consumed = 1 WHERE id = ?", [otp.id]);
  }

  const existing = await queryRows<Row>(
    "SELECT id, full_name, display_name, phone, gender, date_of_birth, division, district, upazila, profile_image_url, status, personal_info_completed, is_kyc_verified, nid_number, profile_json FROM app_users WHERE phone = ? LIMIT 1",
    [phone]
  );

  let user = existing[0];
  let isNew = false;

  if (!user) {
    const result = await executeQuery(
      "INSERT INTO app_users (full_name, phone, status, personal_info_completed) VALUES ('Shathi user', ?, 'active', 0)",
      [phone]
    );
    await executeQuery(
      "INSERT IGNORE INTO app_user_roles (user_id, role) VALUES (?, 'shathisheba_buyer')",
      [result.insertId]
    );
    const rows = await queryRows<Row>(
      "SELECT id, full_name, display_name, phone, gender, date_of_birth, division, district, upazila, profile_image_url, status, personal_info_completed, is_kyc_verified, nid_number, profile_json FROM app_users WHERE id = ? LIMIT 1",
      [result.insertId]
    );
    user = rows[0];
    isNew = true;
  } else {
    // Ensure the buyer role exists for any pre-existing/seeded user.
    await executeQuery("INSERT IGNORE INTO app_user_roles (user_id, role) VALUES (?, 'shathisheba_buyer')", [user.id]);
  }

  const token = generateToken();
  await executeQuery(
    "INSERT INTO app_sessions (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY))",
    [user.id, token]
  );

  return { token, is_new: isNew, user: await buildAppUser(user) };
}

// POST /api/v1/app/profile  { user_id, full_name, gender, date_of_birth?, profile_image_url? }
// Saves the Personal Information screen and marks personal_info_completed.
export async function savePersonalInfo(payload: Row) {
  const userId = payload.user_id;
  const fullName = (payload.full_name ?? payload.display_name ?? "").toString().trim();
  const gender = (payload.gender ?? "").toString().trim();
  if (!userId) throw new Error("user_id is required.");
  if (!fullName) throw new Error("Name is required.");
  if (!["male", "female", "other", "undisclosed"].includes(gender)) {
    throw new Error("A valid gender is required.");
  }

  await executeQuery(
    `UPDATE app_users
       SET full_name = ?, display_name = COALESCE(NULLIF(?, ''), display_name, ?),
           gender = ?, date_of_birth = ?, profile_image_url = COALESCE(NULLIF(?, ''), profile_image_url),
           division = COALESCE(NULLIF(?, ''), division),
           district = COALESCE(NULLIF(?, ''), district),
           upazila = COALESCE(NULLIF(?, ''), upazila),
           latitude = COALESCE(?, latitude),
           longitude = COALESCE(?, longitude),
           personal_info_completed = 1
     WHERE id = ?`,
    [
      fullName,
      (payload.display_name ?? "").toString(),
      fullName,
      gender,
      (payload.date_of_birth ?? null) as string | null,
      (payload.profile_image_url ?? "").toString(),
      (payload.division ?? "").toString(),
      (payload.district ?? "").toString(),
      (payload.upazila ?? "").toString(),
      payload.latitude != null ? Number(payload.latitude) : null,
      payload.longitude != null ? Number(payload.longitude) : null,
      userId
    ]
  );

  const rows = await queryRows<Row>(
    "SELECT id, full_name, display_name, phone, gender, date_of_birth, division, district, upazila, profile_image_url, status, personal_info_completed, is_kyc_verified, nid_number, profile_json FROM app_users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (rows.length === 0) throw new Error("User not found.");
  return { user: await buildAppUser(rows[0]) };
}

// GET /api/v1/app/me?user_id=  -> current user with roles + onboarding gates.
export async function getAppMe(userId?: string | null) {
  if (!userId) throw new Error("user_id is required.");
  const rows = await queryRows<Row>(
    "SELECT id, full_name, display_name, phone, gender, date_of_birth, division, district, upazila, profile_image_url, status, personal_info_completed, is_kyc_verified, nid_number, profile_json FROM app_users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (rows.length === 0) throw new Error("User not found.");
  return buildAppUser(rows[0]);
}

// --- Menu modules: banking, farm, KYC documents (app + admin) ---

export async function getUserBanking(userId?: string | null) {
  if (!userId) throw new Error("user_id is required.");
  const rows = await queryRows<Row>("SELECT * FROM app_user_banking WHERE user_id = ? LIMIT 1", [userId]);
  return rows[0] ?? null;
}

export async function saveUserBanking(payload: Row) {
  const userId = payload.user_id;
  if (!userId) throw new Error("user_id is required.");
  await executeQuery(
    `INSERT INTO app_user_banking (user_id, bank_name, branch_name, account_name, account_number, mobile_provider, mobile_account, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE bank_name=VALUES(bank_name), branch_name=VALUES(branch_name),
       account_name=VALUES(account_name), account_number=VALUES(account_number),
       mobile_provider=VALUES(mobile_provider), mobile_account=VALUES(mobile_account), notes=VALUES(notes)`,
    [
      userId,
      (payload.bank_name ?? null) as string | null,
      (payload.branch_name ?? null) as string | null,
      (payload.account_name ?? null) as string | null,
      (payload.account_number ?? null) as string | null,
      (payload.mobile_provider ?? null) as string | null,
      (payload.mobile_account ?? null) as string | null,
      (payload.notes ?? null) as string | null
    ]
  );
  return getUserBanking(String(userId));
}

export async function getUserFarm(userId?: string | null) {
  if (!userId) throw new Error("user_id is required.");
  const rows = await queryRows<Row>("SELECT * FROM app_user_farm WHERE user_id = ? LIMIT 1", [userId]);
  return rows[0] ?? null;
}

export async function saveUserFarm(payload: Row) {
  const userId = payload.user_id;
  if (!userId) throw new Error("user_id is required.");
  await executeQuery(
    `INSERT INTO app_user_farm (user_id, total_land_decimals, primary_focus, crop_types, livestock_count, pond_count, farm_address, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE total_land_decimals=VALUES(total_land_decimals), primary_focus=VALUES(primary_focus),
       crop_types=VALUES(crop_types), livestock_count=VALUES(livestock_count), pond_count=VALUES(pond_count),
       farm_address=VALUES(farm_address), notes=VALUES(notes)`,
    [
      userId,
      payload.total_land_decimals != null ? Number(payload.total_land_decimals) : null,
      (payload.primary_focus ?? null) as string | null,
      (payload.crop_types ?? null) as string | null,
      payload.livestock_count != null ? Number(payload.livestock_count) : null,
      payload.pond_count != null ? Number(payload.pond_count) : null,
      (payload.farm_address ?? null) as string | null,
      (payload.notes ?? null) as string | null
    ]
  );
  return getUserFarm(String(userId));
}

export async function getUserKycDocuments(userId?: string | null) {
  if (!userId) throw new Error("user_id is required.");
  return queryRows<Row>(
    "SELECT CAST(id AS CHAR) AS id, doc_type, document_url, status, note, created_at FROM app_user_kyc_documents WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
}

export async function addUserKycDocument(payload: Row) {
  const userId = payload.user_id;
  const url = (payload.document_url ?? "").toString();
  if (!userId) throw new Error("user_id is required.");
  if (!url) throw new Error("document_url is required.");
  const docType = (payload.doc_type ?? "other").toString();
  const result = await executeQuery(
    "INSERT INTO app_user_kyc_documents (user_id, doc_type, document_url, note) VALUES (?, ?, ?, ?)",
    [userId, docType, url, (payload.note ?? null) as string | null]
  );
  return { id: result.insertId, doc_type: docType, document_url: url, status: "pending" };
}

function safeJson(value: unknown): Row | null {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value) as Row;
  } catch {
    return null;
  }
}

// POST /api/v1/app/preferences
// Persists onboarding selections for a user: a full snapshot into
// app_users.profile_json.preferences, plus matched rows into user_interests
// (matched by interest_categories slug / name_en / name_bn).
export async function saveUserPreferences(payload: Row) {
  const userId = payload.user_id;
  if (!userId) {
    throw new Error("user_id is required.");
  }
  // selection: array of tokens (slugs / english / bangla labels) the user picked.
  const selection: string[] = Array.isArray(payload.selection)
    ? (payload.selection as unknown[]).map((s) => String(s))
    : [];
  const snapshot = payload.snapshot ?? { categories: payload.categories ?? null, selection };

  const users = await queryRows<Row>("SELECT id, profile_json FROM app_users WHERE id = ? LIMIT 1", [userId]);
  if (users.length === 0) {
    throw new Error("User not found.");
  }
  const existingProfile = (typeof users[0].profile_json === "string"
    ? safeJson(users[0].profile_json)
    : (users[0].profile_json as Row | null)) ?? {};
  const mergedProfile = { ...existingProfile, preferences: snapshot, preferences_updated_at: new Date().toISOString() };

  await executeQuery("UPDATE app_users SET profile_json = ? WHERE id = ?", [JSON.stringify(mergedProfile), userId]);

  // App preference keys -> interest_categories slugs where they differ.
  const slugAliases: Record<string, string> = {
    cattle: "livestock-poultry",
    livestock: "livestock-poultry"
  };
  const aliased = selection.map((s) => slugAliases[s.toLowerCase()] ?? s);

  let matchedIds: number[] = [];
  if (aliased.length > 0) {
    const lowered = aliased.map((s) => s.toLowerCase());
    const placeholders = lowered.map(() => "?").join(", ");
    const matches = await queryRows<Row>(
      `
        SELECT id FROM interest_categories
        WHERE is_active = 1 AND (
          LOWER(slug) IN (${placeholders})
          OR LOWER(name_en) IN (${placeholders})
          OR name_bn IN (${selection.map(() => "?").join(", ")})
        )
      `,
      [...lowered, ...lowered, ...selection]
    );
    matchedIds = matches.map((m) => Number(m.id));
  }

  // Replace this user's interests with the matched set.
  await executeQuery("DELETE FROM user_interests WHERE user_id = ?", [userId]);
  for (const interestId of matchedIds) {
    await executeQuery(
      "INSERT IGNORE INTO user_interests (user_id, interest_category_id) VALUES (?, ?)",
      [userId, interestId]
    );
  }

  return {
    user_id: String(userId),
    saved_interest_count: matchedIds.length,
    snapshot_saved: true
  };
}

// POST /api/v1/community/posts/{id}/like
export async function likePost(id: string) {
  const result = await executeQuery(
    "UPDATE community_posts SET like_count = like_count + 1 WHERE id = ?",
    [id]
  );
  const rows = await queryRows<Row>("SELECT like_count FROM community_posts WHERE id = ?", [id]);
  return { post_id: id, like_count: Number(rows[0]?.like_count ?? 0), affected: result.affectedRows };
}

// ── Community moderation (admin backend) ────────────────────────────────────

// GET /api/v1/app/community/moderation?filter=all|flagged|official|hidden
// Full post list for the admin moderation panel, including the Gemini verdict.
export async function getCommunityModeration(filter?: string | null) {
  let where = "1=1";
  if (filter === "flagged") where = "(p.ai_flag IN ('review','remove') OR p.report_count > 0)";
  else if (filter === "official") where = "p.is_official = 1";
  else if (filter === "hidden") where = "p.status IN ('hidden','removed','moderation')";
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, u.full_name AS author, CAST(p.user_id AS CHAR) AS user_id,
             p.post_type, p.scope, p.body, p.image_url, p.is_official,
             p.like_count, p.comment_count, p.report_count, p.status,
             p.ai_flag, p.ai_reason, p.ai_checked_at, p.district, p.upazila, p.created_at
      FROM community_posts p
      JOIN app_users u ON u.id = p.user_id
      WHERE ${where}
      ORDER BY p.is_official DESC,
               FIELD(p.ai_flag, 'remove', 'review') DESC,
               p.report_count DESC, p.created_at DESC
      LIMIT 200
    `
  );
}

// POST /api/v1/app/community/moderate  { id, status?, is_official? }
// Admin manual action: change visibility status or toggle the official flag.
export async function moderateCommunityPost(payload: Row) {
  const id = String(payload.id ?? "");
  if (!id) throw new Error("Post id is required.");
  const sets: string[] = [];
  const values: unknown[] = [];
  if (payload.status !== undefined) {
    sets.push("status = ?");
    values.push(String(payload.status));
  }
  if (payload.is_official !== undefined) {
    sets.push("is_official = ?");
    values.push(Number(payload.is_official) ? 1 : 0);
  }
  if (sets.length === 0) throw new Error("Nothing to update (status or is_official required).");
  sets.push("moderated_at = NOW()");
  await executeQuery(`UPDATE community_posts SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
  const rows = await queryRows<Row>(
    "SELECT CAST(id AS CHAR) AS id, status, is_official FROM community_posts WHERE id = ?",
    [id]
  );
  return rows[0] ?? { id };
}

// POST /api/v1/app/community/ai-flag  { id }
// Run Gemini moderation on a single post; store the verdict. A "remove" verdict
// moves the post to 'moderation' so it drops out of the app feed pending review.
export async function aiFlagCommunityPost(payload: Row) {
  const { moderatePostText } = await import("@/lib/gemini");
  const id = String(payload.id ?? "");
  if (!id) throw new Error("Post id is required.");
  const rows = await queryRows<Row>("SELECT CAST(id AS CHAR) AS id, body, status FROM community_posts WHERE id = ?", [id]);
  const post = rows[0];
  if (!post) throw new Error("Post not found.");

  const verdict = await moderatePostText(String(post.body ?? ""));
  const nextStatus = verdict.flag === "remove" && post.status === "visible" ? "moderation" : String(post.status);
  await executeQuery(
    "UPDATE community_posts SET ai_flag = ?, ai_reason = ?, ai_checked_at = NOW(), status = ? WHERE id = ?",
    [verdict.flag, verdict.reason, nextStatus, id]
  );
  return { id, ...verdict, status: nextStatus };
}

// POST /api/v1/app/community/ai-scan  { limit?, rescan? }
// Batch-moderate posts. By default only posts never scanned (ai_checked_at IS NULL);
// rescan=true re-checks everything. Returns a per-post summary + counts.
export async function aiScanCommunityPosts(payload: Row) {
  const { moderatePostText } = await import("@/lib/gemini");
  const limit = Math.min(Math.max(Number(payload.limit ?? 25) || 25, 1), 50);
  const rescan = Boolean(payload.rescan);
  const rows = await queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, body, status
      FROM community_posts
      WHERE ${rescan ? "1=1" : "ai_checked_at IS NULL"}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
  );

  const results: Array<{ id: string; flag: string; reason: string }> = [];
  const counts = { safe: 0, review: 0, remove: 0 };
  for (const post of rows) {
    const id = String(post.id);
    try {
      const verdict = await moderatePostText(String(post.body ?? ""));
      const nextStatus = verdict.flag === "remove" && post.status === "visible" ? "moderation" : String(post.status);
      await executeQuery(
        "UPDATE community_posts SET ai_flag = ?, ai_reason = ?, ai_checked_at = NOW(), status = ? WHERE id = ?",
        [verdict.flag, verdict.reason, nextStatus, id]
      );
      counts[verdict.flag] += 1;
      results.push({ id, flag: verdict.flag, reason: verdict.reason });
    } catch (error) {
      results.push({ id, flag: "error", reason: error instanceof Error ? error.message : "AI error" });
    }
  }
  return { scanned: results.length, counts, results };
}

// ── Learning / Training module (gamified: categories > modules(levels) > content) ─

type QuizQuestion = { q: string; options: string[]; answer: number };

function parseQuiz(raw: unknown): QuizQuestion[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && Array.isArray((x as { options?: unknown }).options))
    .map((x) => {
      const o = x as { q?: unknown; options: unknown[]; answer?: unknown };
      return { q: String(o.q ?? ""), options: o.options.map((op) => String(op)), answer: Number(o.answer ?? 0) };
    });
}

export function youtubeId(url?: string | null): string | null {
  if (!url) return null;
  const s = String(url);
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}

function levelFromPoints(points: number) {
  return Math.floor(points / 50) + 1;
}

async function preferredInterestSlugs(userId?: string | null): Promise<string[]> {
  if (!userId) return [];
  const rows = await queryRows<Row>(
    "SELECT ic.slug FROM user_interests ui JOIN interest_categories ic ON ic.id = ui.interest_category_id WHERE ui.user_id = ?",
    [userId]
  );
  return rows.map((r) => String(r.slug));
}

// GET /api/v1/app/learning/overview?user_id=1
// Training home: points, level, next content, and all categories with the
// user's preference flag + per-category completion counts.
export async function getAppLearningOverview(userId?: string | null) {
  const uid = userId ?? null;
  const cats = await queryRows<Row>(
    `
      SELECT CAST(c.id AS CHAR) AS id, c.slug, c.name_en, c.name_bn, c.emoji,
             c.description_en, c.description_bn, c.interest_slug, c.section,
             COUNT(DISTINCT m.id) AS module_count,
             COUNT(DISTINCT ct.id) AS content_count,
             COUNT(DISTINCT CASE WHEN p.status = 'completed' THEN ct.id END) AS completed_count
      FROM learning_categories c
      LEFT JOIN learning_modules m ON m.learning_category_id = c.id AND m.status = 'published'
      LEFT JOIN learning_contents ct ON ct.learning_module_id = m.id AND ct.status = 'published'
      LEFT JOIN user_learning_progress p ON p.learning_content_id = ct.id AND p.user_id = ?
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.sort_order, c.id
    `,
    [uid]
  );
  const preferred = new Set(await preferredInterestSlugs(uid));
  const categories = cats.map((c) => ({
    ...c,
    module_count: Number(c.module_count),
    content_count: Number(c.content_count),
    completed_count: Number(c.completed_count),
    preferred: preferred.has(String(c.interest_slug))
  }));
  // preference-first ordering
  categories.sort((a, b) => Number(b.preferred) - Number(a.preferred));

  let points = 0;
  if (uid) {
    const u = await queryRows<Row>("SELECT learning_points FROM app_users WHERE id = ?", [uid]);
    points = Number(u[0]?.learning_points ?? 0);
  }

  let next: Row | null = null;
  if (uid) {
    const nx = await queryRows<Row>(
      `
        SELECT CAST(ct.id AS CHAR) AS id, ct.title_en, ct.title_bn, ct.content_type,
               m.title_en AS module_title, CAST(m.id AS CHAR) AS module_id, m.level,
               c.name_en AS category_name, CAST(c.id AS CHAR) AS category_id, c.interest_slug
        FROM learning_contents ct
        JOIN learning_modules m ON m.id = ct.learning_module_id AND m.status = 'published'
        JOIN learning_categories c ON c.id = m.learning_category_id AND c.is_active = 1
        LEFT JOIN user_learning_progress p ON p.learning_content_id = ct.id AND p.user_id = ?
        WHERE ct.status = 'published' AND (p.status IS NULL OR p.status <> 'completed')
        ORDER BY m.level, ct.sort_order, ct.id
        LIMIT 20
      `,
      [uid]
    );
    next = nx.find((r) => preferred.has(String(r.interest_slug))) ?? nx[0] ?? null;
  }

  const totalContent = categories.reduce((s, c) => s + c.content_count, 0);
  const totalCompleted = categories.reduce((s, c) => s + c.completed_count, 0);
  return {
    points,
    level: levelFromPoints(points),
    total_content: totalContent,
    completed_content: totalCompleted,
    next,
    categories
  };
}

// GET /api/v1/app/learning/modules?category_id=1&user_id=1
// Subcategories (modules) within a category, with level + completion.
export async function getAppLearningCategoryModules(categoryId?: string | null, userId?: string | null) {
  if (!categoryId) return [];
  const rows = await queryRows<Row>(
    `
      SELECT CAST(m.id AS CHAR) AS id, m.title_en, m.title_bn, m.subtitle_en, m.subtitle_bn,
             m.level, m.emoji,
             COUNT(DISTINCT ct.id) AS content_count,
             COUNT(DISTINCT CASE WHEN p.status = 'completed' THEN ct.id END) AS completed_count,
             COALESCE(SUM(ct.points), 0) AS total_points
      FROM learning_modules m
      LEFT JOIN learning_contents ct ON ct.learning_module_id = m.id AND ct.status = 'published'
      LEFT JOIN user_learning_progress p ON p.learning_content_id = ct.id AND p.user_id = ?
      WHERE m.learning_category_id = ? AND m.status = 'published'
      GROUP BY m.id
      ORDER BY m.level, m.sort_order, m.id
    `,
    [userId ?? null, categoryId]
  );
  return rows.map((r) => ({
    ...r,
    level: Number(r.level),
    content_count: Number(r.content_count),
    completed_count: Number(r.completed_count),
    total_points: Number(r.total_points)
  }));
}

// GET /api/v1/app/learning/contents?module_id=1&user_id=1
// Article + video cards within a subcategory, with per-user progress.
export async function getAppLearningModuleContents(moduleId?: string | null, userId?: string | null) {
  if (!moduleId) return [];
  const rows = await queryRows<Row>(
    `
      SELECT CAST(ct.id AS CHAR) AS id, ct.content_type, ct.title_en, ct.title_bn,
             ct.points, ct.image_url, ct.duration_seconds,
             LEFT(COALESCE(ct.body_en, ''), 160) AS excerpt,
             ct.video_url IS NOT NULL AS has_video,
             ct.quiz_json IS NOT NULL AS has_quiz,
             ct.sort_order,
             COALESCE(p.status, 'not_started') AS status,
             COALESCE(p.progress_pct, 0) AS progress_pct,
             p.quiz_score, COALESCE(p.quiz_passed, 0) AS quiz_passed
      FROM learning_contents ct
      LEFT JOIN user_learning_progress p ON p.learning_content_id = ct.id AND p.user_id = ?
      WHERE ct.learning_module_id = ? AND ct.status = 'published'
      ORDER BY ct.sort_order, ct.id
    `,
    [userId ?? null, moduleId]
  );
  return rows.map((r) => ({
    ...r,
    points: Number(r.points),
    progress_pct: Number(r.progress_pct),
    has_quiz: Number(r.has_quiz) === 1,
    has_video: Number(r.has_video) === 1,
    completed: r.status === "completed"
  }));
}

// GET /api/v1/app/learning/content?id=1&user_id=1
// Full content for the reader/player. Quiz answers are NOT included (grading
// happens server-side via submit-quiz).
export async function getAppLearningContent(contentId?: string | null, userId?: string | null) {
  if (!contentId) return null;
  const rows = await queryRows<Row>(
    `
      SELECT CAST(ct.id AS CHAR) AS id, ct.content_type, ct.title_en, ct.title_bn,
             ct.body_en, ct.body_bn, ct.video_url, ct.duration_seconds, ct.points,
             ct.image_url, ct.summary_en, ct.summary_bn, ct.quiz_json,
             CAST(ct.learning_module_id AS CHAR) AS module_id,
             m.title_en AS module_title, m.level,
             c.name_en AS category_name, CAST(c.id AS CHAR) AS category_id,
             COALESCE(p.status, 'not_started') AS status,
             COALESCE(p.progress_pct, 0) AS progress_pct,
             p.quiz_score, COALESCE(p.quiz_passed, 0) AS quiz_passed
      FROM learning_contents ct
      JOIN learning_modules m ON m.id = ct.learning_module_id
      JOIN learning_categories c ON c.id = m.learning_category_id
      LEFT JOIN user_learning_progress p ON p.learning_content_id = ct.id AND p.user_id = ?
      WHERE ct.id = ?
      LIMIT 1
    `,
    [userId ?? null, contentId]
  );
  const row = rows[0];
  if (!row) return null;
  const quiz = parseQuiz(row.quiz_json);
  return {
    ...row,
    points: Number(row.points),
    progress_pct: Number(row.progress_pct),
    quiz_passed: Number(row.quiz_passed) === 1,
    youtube_id: youtubeId(row.video_url as string | null),
    has_quiz: quiz.length > 0,
    // strip answers — only questions + options reach the client
    quiz: quiz.map((q) => ({ q: q.q, options: q.options })),
    quiz_json: undefined
  };
}

async function completeContent(
  uid: string,
  contentId: string,
  points: number,
  fields: { progress_pct?: number; quiz_score?: number | null; quiz_passed?: number }
) {
  const existing = await queryRows<Row>(
    "SELECT status, points_awarded FROM user_learning_progress WHERE user_id = ? AND learning_content_id = ?",
    [uid, contentId]
  );
  const alreadyCompleted = existing[0]?.status === "completed";
  const newAward = alreadyCompleted ? 0 : points;
  await executeQuery(
    `
      INSERT INTO user_learning_progress
        (user_id, learning_content_id, status, completed_at, progress_pct, points_awarded, quiz_score, quiz_passed)
      VALUES (?, ?, 'completed', NOW(), ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = 'completed',
        completed_at = IFNULL(completed_at, NOW()),
        progress_pct = GREATEST(progress_pct, VALUES(progress_pct)),
        points_awarded = GREATEST(points_awarded, VALUES(points_awarded)),
        quiz_score = VALUES(quiz_score),
        quiz_passed = VALUES(quiz_passed)
    `,
    [uid, contentId, fields.progress_pct ?? 100, points, fields.quiz_score ?? null, fields.quiz_passed ?? 0]
  );
  if (newAward > 0) {
    await executeQuery("UPDATE app_users SET learning_points = learning_points + ? WHERE id = ?", [newAward, uid]);
  }
  const tp = await queryRows<Row>("SELECT learning_points FROM app_users WHERE id = ?", [uid]);
  const totalPoints = Number(tp[0]?.learning_points ?? 0);
  return { completed: true, points_awarded: newAward, total_points: totalPoints, level: levelFromPoints(totalPoints) };
}

// POST /api/v1/app/learning/progress { user_id, content_id, progress_pct }
// Video watch tracking. Completes (and awards points once) at >=90% for video,
// or at 100% for an article that has no quiz.
export async function markLearningProgress(payload: Row) {
  const uid = String(payload.user_id ?? "");
  const contentId = String(payload.content_id ?? "");
  if (!uid || !contentId) throw new Error("user_id and content_id are required.");
  const pct = Math.max(0, Math.min(100, Number(payload.progress_pct ?? 0)));
  const rows = await queryRows<Row>(
    "SELECT content_type, points, quiz_json FROM learning_contents WHERE id = ?",
    [contentId]
  );
  const content = rows[0];
  if (!content) throw new Error("Content not found.");
  const points = Number(content.points ?? 0);
  const hasQuiz = content.quiz_json != null;

  const completes =
    (content.content_type === "video" && pct >= 90) ||
    (content.content_type === "article" && !hasQuiz && pct >= 100);

  if (completes) {
    return completeContent(uid, contentId, points, { progress_pct: pct });
  }

  await executeQuery(
    `
      INSERT INTO user_learning_progress (user_id, learning_content_id, status, progress_pct)
      VALUES (?, ?, 'in_progress', ?)
      ON DUPLICATE KEY UPDATE
        status = IF(status = 'completed', 'completed', 'in_progress'),
        progress_pct = GREATEST(progress_pct, VALUES(progress_pct))
    `,
    [uid, contentId, pct]
  );
  return { completed: false, progress_pct: pct };
}

// POST /api/v1/app/learning/submit-quiz { user_id, content_id, answers: number[] }
// Grades against stored answers. >=80% marks the content completed + awards points.
export async function submitLearningQuiz(payload: Row) {
  const uid = String(payload.user_id ?? "");
  const contentId = String(payload.content_id ?? "");
  if (!uid || !contentId) throw new Error("user_id and content_id are required.");
  const answers = Array.isArray(payload.answers) ? (payload.answers as unknown[]).map((a) => Number(a)) : [];
  const rows = await queryRows<Row>("SELECT points, quiz_json FROM learning_contents WHERE id = ?", [contentId]);
  const content = rows[0];
  if (!content) throw new Error("Content not found.");
  const quiz = parseQuiz(content.quiz_json);
  if (quiz.length === 0) throw new Error("This content has no quiz.");

  let correct = 0;
  quiz.forEach((question, i) => {
    if (answers[i] === question.answer) correct += 1;
  });
  const total = quiz.length;
  const score = Math.round((correct / total) * 100);
  const passed = score >= 80;
  const points = Number(content.points ?? 0);

  if (passed) {
    const done = await completeContent(uid, contentId, points, { progress_pct: 100, quiz_score: score, quiz_passed: 1 });
    return { passed: true, score, correct, total, ...done };
  }

  await executeQuery(
    `
      INSERT INTO user_learning_progress (user_id, learning_content_id, status, progress_pct, quiz_score, quiz_passed)
      VALUES (?, ?, 'in_progress', 100, ?, 0)
      ON DUPLICATE KEY UPDATE
        status = IF(status = 'completed', 'completed', 'in_progress'),
        quiz_score = VALUES(quiz_score),
        quiz_passed = quiz_passed
    `,
    [uid, contentId, score]
  );
  const tp = await queryRows<Row>("SELECT learning_points FROM app_users WHERE id = ?", [uid]);
  return { passed: false, score, correct, total, points_awarded: 0, total_points: Number(tp[0]?.learning_points ?? 0) };
}

// GET /api/v1/app/learning/user-progress?user_id=1  (admin viewer + app history)
export async function getUserLearningProgress(userId?: string | null) {
  if (!userId) return [];
  return queryRows<Row>(
    `
      SELECT CAST(p.learning_content_id AS CHAR) AS content_id, ct.title_en, ct.content_type,
             m.title_en AS module_title, c.name_en AS category_name,
             p.status, p.progress_pct, p.quiz_score, p.quiz_passed, p.points_awarded, p.completed_at
      FROM user_learning_progress p
      JOIN learning_contents ct ON ct.id = p.learning_content_id
      JOIN learning_modules m ON m.id = ct.learning_module_id
      JOIN learning_categories c ON c.id = m.learning_category_id
      WHERE p.user_id = ?
      ORDER BY p.updated_at DESC, p.completed_at DESC
    `,
    [userId]
  );
}

// GET /api/v1/app/learning/progress-overview  (admin: all users' learning stats)
export async function getLearningProgressOverview() {
  return queryRows<Row>(
    `
      SELECT CAST(u.id AS CHAR) AS user_id, u.full_name, u.phone, u.learning_points,
             COUNT(CASE WHEN p.status = 'completed' THEN 1 END) AS completed,
             COUNT(p.learning_content_id) AS attempted,
             ROUND(AVG(p.quiz_score), 0) AS avg_quiz
      FROM app_users u
      LEFT JOIN user_learning_progress p ON p.user_id = u.id
      GROUP BY u.id
      HAVING attempted > 0 OR u.learning_points > 0
      ORDER BY u.learning_points DESC, completed DESC
      LIMIT 200
    `
  );
}

// GET /api/v1/app/sale/my-listings?user_id=
// A seller's own listings with approval status — shown in the app's My Listings
// screen (submitted/field_verification = pending; active = approved; etc).
export async function getMyListings(userId?: string | null) {
  if (!userId) return [];
  return queryRows<Row>(
    `
      SELECT CAST(l.id AS CHAR) AS id, l.listing_code, l.title_en, l.title_bn,
             l.description, l.quantity, l.unit, l.weight_kg,
             l.farmer_expected_price, l.estimated_earning,
             l.status, l.approved_at, l.created_at, l.media_json,
             si.name_en AS item_name, si.name_bn AS item_name_bn,
             c.slug AS category_slug
      FROM sale_listings l
      LEFT JOIN sale_items si ON si.id = l.sale_item_id
      LEFT JOIN sale_categories c ON c.id = si.sale_category_id
      WHERE l.user_id = ?
      ORDER BY l.created_at DESC
      LIMIT 100
    `,
    [userId]
  );
}

// GET /api/v1/app/orders/mine?user_id=  -> a buyer's own orders + items.
export async function getMyOrders(userId?: string | null) {
  if (!userId) return [];
  return queryRows<Row>(
    `
      SELECT CAST(o.id AS CHAR) AS id, o.order_code, o.total_amount, o.delivery_fee, o.payable_amount,
             o.payment_method, o.payment_status, o.fulfillment_status, o.district, o.upazila, o.created_at,
             COUNT(oi.id) AS item_count,
             GROUP_CONCAT(CONCAT(p.name_en, ' ×', oi.quantity) SEPARATOR ', ') AS items_summary,
             JSON_UNQUOTE(JSON_EXTRACT(MAX(p.metadata), '$.image_url')) AS image_url
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.user_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 50
    `,
    [userId]
  );
}

// GET /api/v1/app/admin/inventory -> stock overview + pending demand + recent movements
// for the admin Orders → Inventory page.
export async function getInventoryOverview() {
  const products = await queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, p.sku, p.name_en, p.unit, p.price, p.stock_qty,
             p.low_stock_threshold, p.status, c.name_en AS category_name,
             COALESCE(pend.qty, 0) AS pending_qty,
             COALESCE(conf.qty, 0) AS confirmed_qty
      FROM products p
      JOIN buy_categories c ON c.id = p.buy_category_id
      LEFT JOIN (SELECT oi.product_id, SUM(oi.quantity) AS qty FROM order_items oi
                   JOIN orders o ON o.id = oi.order_id WHERE o.fulfillment_status = 'placed'
                  GROUP BY oi.product_id) pend ON pend.product_id = p.id
      LEFT JOIN (SELECT oi.product_id, SUM(oi.quantity) AS qty FROM order_items oi
                   JOIN orders o ON o.id = oi.order_id WHERE o.fulfillment_status IN ('confirmed','assigned','in_transit','delivered')
                  GROUP BY oi.product_id) conf ON conf.product_id = p.id
      ORDER BY (p.stock_qty <= p.low_stock_threshold) DESC, pend.qty DESC, p.name_en
    `
  );
  const movements = await queryRows<Row>(
    `SELECT CAST(m.id AS CHAR) AS id, CAST(m.product_id AS CHAR) AS product_id, p.name_en,
            m.change_qty, m.reason, m.ref_code, m.note, m.created_at
       FROM inventory_movements m JOIN products p ON p.id = m.product_id
      ORDER BY m.created_at DESC LIMIT 60`
  );
  return { products, movements };
}

// ===========================================================================
// Approvals to-do dashboard (admin). Four queues: sale listings, project
// enrollments, KYC documents, and newly-registered users. Each item carries the
// applicant's KYC verification panel so an admin can decide in one place.
// ===========================================================================

const PENDING_LISTING_STATUSES = ["submitted", "field_verification"];
const PENDING_ENROLLMENT_STATUSES = ["submitted", "needs_document", "officer_verification", "ready_to_approve"];

// Verification panel for one applicant: presence/status of each required check.
async function buildVerificationPanel(userId: number | string) {
  const summary = await buildKycSummary(userId);
  const users = await queryRows<Row>(
    "SELECT id, full_name, phone, nid_number, is_kyc_verified, status FROM app_users WHERE id = ? LIMIT 1",
    [userId]
  );
  const u = users[0] || {};
  return {
    in_system: users.length > 0,
    nid: summary.nid,                       // verified | pending | rejected | none
    user_photo: summary.selfie,             // term: "User Photo" (doc_type 'selfie')
    trade_license: summary.trade_license,
    banking: summary.banking,
    document_count: summary.document_count,
    nid_number: u.nid_number ?? null,
    is_kyc_verified: Number(u.is_kyc_verified ?? 0) === 1,
    user_status: u.status ?? null
  };
}

// GET /api/v1/app/admin/approvals -> counts + recent items per queue.
export async function getApprovalQueues() {
  const listings = await queryRows<Row>(
    `SELECT CAST(l.id AS CHAR) AS id, l.listing_code, COALESCE(l.title_en, si.name_en, 'Listing') AS title,
            l.status, l.quantity, l.unit, l.farmer_expected_price, l.created_at,
            CAST(l.user_id AS CHAR) AS user_id, u.full_name, u.phone, u.is_kyc_verified
       FROM sale_listings l
       JOIN app_users u ON u.id = l.user_id
       LEFT JOIN sale_items si ON si.id = l.sale_item_id
      WHERE l.status IN (?, ?)
      ORDER BY l.created_at DESC LIMIT 40`,
    PENDING_LISTING_STATUSES
  );
  const enrollments = await queryRows<Row>(
    `SELECT CAST(a.id AS CHAR) AS id, a.application_code, a.status, a.current_step, a.created_at,
            CAST(a.user_id AS CHAR) AS user_id, u.full_name, u.phone, u.is_kyc_verified,
            p.name_en AS project_name, p.interest_slug
       FROM partner_applications a
       JOIN app_users u ON u.id = a.user_id
       JOIN partner_projects p ON p.id = a.partner_project_id
      WHERE a.status IN (?, ?, ?, ?)
      ORDER BY a.created_at DESC LIMIT 40`,
    PENDING_ENROLLMENT_STATUSES
  );
  const kyc = await queryRows<Row>(
    `SELECT CAST(k.id AS CHAR) AS id, CAST(k.user_id AS CHAR) AS user_id, k.doc_type, k.document_url, k.status, k.created_at,
            u.full_name, u.phone
       FROM app_user_kyc_documents k
       JOIN app_users u ON u.id = k.user_id
      WHERE k.status = 'pending'
      ORDER BY k.created_at DESC LIMIT 60`
  );
  const users = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, full_name, phone, district, upazila, is_kyc_verified, created_at
       FROM app_users WHERE status = 'pending'
      ORDER BY created_at DESC LIMIT 40`
  );
  // Placed buy orders pending inventory validation, with stock-coverage flag.
  const orders = await queryRows<Row>(
    `SELECT CAST(o.id AS CHAR) AS id, o.order_code, o.payable_amount, o.payment_method, o.district, o.created_at,
            CAST(o.user_id AS CHAR) AS user_id, u.full_name, u.phone,
            COUNT(oi.id) AS item_count,
            GROUP_CONCAT(CONCAT(p.name_en, ' ×', oi.quantity) SEPARATOR ', ') AS items_summary,
            MIN(p.stock_qty >= oi.quantity) AS stock_ok
       FROM orders o
       JOIN app_users u ON u.id = o.user_id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
      WHERE o.fulfillment_status = 'placed'
      GROUP BY o.id
      ORDER BY o.created_at DESC LIMIT 40`
  );
  return {
    counts: {
      listings: listings.length,
      enrollments: enrollments.length,
      kyc: kyc.length,
      users: users.length,
      orders: orders.length,
      total: listings.length + enrollments.length + kyc.length + users.length + orders.length
    },
    listings,
    enrollments,
    kyc,
    users,
    orders
  };
}

// GET /api/v1/app/admin/approval?type=&id= -> one item + applicant verification panel.
export async function getApprovalDetail(type?: string | null, id?: string | null) {
  if (!type || !id) throw new Error("type and id are required.");
  let item: Row | null = null;
  let userId: string | number | null = null;

  if (type === "listing") {
    const rows = await queryRows<Row>(
      `SELECT l.*, si.name_en AS item_name, u.full_name, u.phone, u.district, u.upazila
         FROM sale_listings l JOIN app_users u ON u.id = l.user_id
         LEFT JOIN sale_items si ON si.id = l.sale_item_id WHERE l.id = ? LIMIT 1`,
      [id]
    );
    item = rows[0] || null;
    userId = item?.user_id as string;
  } else if (type === "enrollment") {
    const rows = await queryRows<Row>(
      `SELECT a.*, u.full_name, u.phone, u.district, u.upazila, p.name_en AS project_name
         FROM partner_applications a JOIN app_users u ON u.id = a.user_id
         JOIN partner_projects p ON p.id = a.partner_project_id WHERE a.id = ? LIMIT 1`,
      [id]
    );
    item = rows[0] || null;
    userId = item?.user_id as string;
  } else if (type === "kyc") {
    const rows = await queryRows<Row>(
      `SELECT k.*, u.full_name, u.phone FROM app_user_kyc_documents k
         JOIN app_users u ON u.id = k.user_id WHERE k.id = ? LIMIT 1`,
      [id]
    );
    item = rows[0] || null;
    userId = item?.user_id as string;
  } else if (type === "user") {
    const rows = await queryRows<Row>("SELECT * FROM app_users WHERE id = ? LIMIT 1", [id]);
    item = rows[0] || null;
    userId = id;
  } else if (type === "order") {
    const rows = await queryRows<Row>(
      `SELECT o.*, u.full_name, u.phone FROM orders o JOIN app_users u ON u.id = o.user_id WHERE o.id = ? LIMIT 1`,
      [id]
    );
    item = rows[0] || null;
    userId = item?.user_id as string;
    if (item) {
      // Per-line inventory status + a short stock-movement history for decisions.
      const lines = await queryRows<Row>(
        `SELECT CAST(oi.product_id AS CHAR) AS product_id, p.name_en, oi.quantity, oi.unit_price, oi.line_total,
                p.stock_qty, p.low_stock_threshold, p.unit,
                (p.stock_qty >= oi.quantity) AS stock_ok,
                (SELECT COALESCE(SUM(oi2.quantity), 0) FROM order_items oi2
                   JOIN orders o2 ON o2.id = oi2.order_id
                  WHERE oi2.product_id = oi.product_id AND o2.fulfillment_status = 'placed' AND o2.id <> o.id) AS other_pending_qty
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           JOIN orders o ON o.id = oi.order_id
          WHERE oi.order_id = ?`,
        [id]
      );
      const productIds = lines.map((l) => l.product_id);
      const history = productIds.length
        ? await queryRows<Row>(
            `SELECT CAST(m.product_id AS CHAR) AS product_id, p.name_en, m.change_qty, m.reason, m.ref_code, m.created_at
               FROM inventory_movements m JOIN products p ON p.id = m.product_id
              WHERE m.product_id IN (${productIds.map(() => "?").join(",")})
              ORDER BY m.created_at DESC LIMIT 15`,
            productIds
          )
        : [];
      (item as Row).order_lines = lines;
      (item as Row).inventory_history = history;
    }
  } else {
    throw new Error("Unknown approval type.");
  }

  if (!item) throw new Error("Approval item not found.");
  const verification = userId ? await buildVerificationPanel(userId) : null;
  const documents = userId
    ? await queryRows<Row>(
        "SELECT CAST(id AS CHAR) AS id, doc_type, document_url, status, note, created_at FROM app_user_kyc_documents WHERE user_id = ? ORDER BY created_at",
        [userId]
      )
    : [];
  return { type, item, verification, documents };
}

// Recompute app_users.is_kyc_verified from current document statuses
// (verified NID + verified user photo == identity verified).
async function refreshUserKycVerified(userId: string | number) {
  const summary = await buildKycSummary(userId);
  const verified = summary.nid === "verified" && summary.selfie === "verified" ? 1 : 0;
  await executeQuery("UPDATE app_users SET is_kyc_verified = ? WHERE id = ?", [verified, userId]);
  return verified === 1;
}

// Publish an approved seller listing into Buy-from-Shathi as a managed Product.
// Admin-set price/stock/description/category come from the approval payload;
// sku = listing_code keeps it idempotent (re-approve updates the same product).
async function upsertProductFromListing(l: Row, payload: Row) {
  let categoryId = payload.buy_category_id ? Number(payload.buy_category_id) : 0;
  if (!categoryId) {
    const cat = await queryRows<Row>("SELECT id FROM buy_categories WHERE slug = 'livestock' LIMIT 1");
    categoryId = cat[0] ? Number(cat[0].id) : 1;
  }
  const price = Number(payload.price ?? l.farmer_expected_price ?? 0);
  if (!(price > 0)) throw new Error("A product price (> 0) is required to publish this listing to Buy-from-Shathi.");
  const stock = Number(payload.stock ?? payload.stock_qty ?? l.quantity ?? 0);
  const name = String(payload.name || l.title_en || l.item_name || "Marketplace item").slice(0, 190);
  const description = (payload.description ?? l.description ?? null) as string | null;
  const unit = String(l.unit || "piece");
  const media = Array.isArray(l.media_json) ? (l.media_json as unknown[]) : [];
  const imageUrl = media.length ? String(media[0]) : null;
  const metadata = JSON.stringify({ source_listing_id: l.id, image_url: imageUrl, images: media, seller_user_id: l.user_id });
  const sku = String(l.listing_code);
  await executeQuery(
    `INSERT INTO products (buy_category_id, sku, name_en, short_description_en, unit, package_size, price, stock_qty, status, metadata)
     VALUES (?,?,?,?,?,?,?,?, 'active', ?)
     ON DUPLICATE KEY UPDATE buy_category_id=VALUES(buy_category_id), name_en=VALUES(name_en),
       short_description_en=VALUES(short_description_en), unit=VALUES(unit), package_size=VALUES(package_size),
       price=VALUES(price), stock_qty=VALUES(stock_qty), status='active', metadata=VALUES(metadata)`,
    [categoryId, sku, name, description, unit, `${l.quantity} ${unit}`, price, stock, metadata]
  );
  const prod = await queryRows<Row>("SELECT CAST(id AS CHAR) AS id, sku, name_en, price, stock_qty, status FROM products WHERE sku = ? LIMIT 1", [sku]);
  return prod[0] ?? null;
}

// Announce an approved listing in the regional community feed so nearby buyers see it.
async function announceListingInCommunity(l: Row, product: Row | null) {
  try {
    const media = Array.isArray(l.media_json) ? (l.media_json as unknown[]) : [];
    const priceText = product?.price ? ` Price: ৳${Number(product.price).toLocaleString()}.` : "";
    const regionTag = [l.district, l.upazila].filter(Boolean).map((r) => `#${String(r).replace(/\s+/g, "")}`).join(" ");
    const body = `🏷️ New verified listing: ${String(l.title_en || l.item_name || "Marketplace item")} — ${l.quantity} ${l.unit}.${priceText} Available in Buy from Shathi. ${regionTag}`.trim();
    await executeQuery(
      `INSERT INTO community_posts (user_id, scope, post_type, body, image_url, district, upazila, status)
       VALUES (?, 'district', 'notice', ?, ?, ?, ?, 'visible')`,
      [l.user_id, body, media.length ? String(media[0]) : null, l.district ?? null, l.upazila ?? null]
    );
  } catch {
    // The announcement is best-effort; never fail the approval because of it.
  }
}

// POST /api/v1/app/admin/set-required-docs  { application_id, required_docs: string[], admin_id? }
// Marks KYC documents as mandatory for one project application. The application
// drops to needs_document until the user uploads + an admin verifies them.
export async function setApprovalRequirements(payload: Row) {
  const appId = payload.application_id;
  const docs = Array.isArray(payload.required_docs) ? (payload.required_docs as unknown[]).map(String) : [];
  if (!appId) throw new Error("application_id is required.");
  const allowed = ["nid_front", "nid_back", "selfie", "trade_license", "passbook"];
  const cleaned = docs.filter((d) => allowed.includes(d));
  await executeQuery(
    `UPDATE partner_applications SET required_docs = ?,
        status = IF(? > 0 AND status IN ('submitted','officer_verification','ready_to_approve'), 'needs_document', status)
      WHERE id = ?`,
    [JSON.stringify(cleaned), cleaned.length, appId]
  );
  return { application_id: String(appId), required_docs: cleaned };
}

// Throws if any admin-required doc for this application is not yet verified.
async function assertRequiredDocsVerified(application: Row) {
  const raw = application.required_docs;
  const required: string[] = Array.isArray(raw) ? (raw as unknown[]).map(String)
    : typeof raw === "string" && raw.trim().startsWith("[") ? JSON.parse(raw) : [];
  if (!required.length) return;
  const docs = await queryRows<Row>(
    "SELECT doc_type, status FROM app_user_kyc_documents WHERE user_id = ? ORDER BY created_at",
    [application.user_id]
  );
  const latest: Record<string, string> = {};
  for (const d of docs) latest[String(d.doc_type)] = String(d.status);
  const missing = required.filter((r) => latest[r] !== "verified");
  if (missing.length) {
    const label = (t: string) => t === "selfie" ? "User Photo" : t.replace(/_/g, " ");
    throw new Error(`Cannot approve yet — required document(s) not verified: ${missing.map(label).join(", ")}.`);
  }
}

// POST /api/v1/app/admin/approve  { type, id, action: 'approve'|'reject', admin_id?, note? }
export async function decideApproval(payload: Row) {
  const type = String(payload.type || "");
  const id = payload.id;
  const action = String(payload.action || "");
  const adminId = payload.admin_id ?? null;
  const note = payload.note ? String(payload.note).slice(0, 255) : null;
  if (!id || (action !== "approve" && action !== "reject")) {
    throw new Error("id and a valid action (approve|reject) are required.");
  }
  const approve = action === "approve";

  if (type === "listing") {
    const rows = await queryRows<Row>(
      `SELECT l.*, si.name_en AS item_name FROM sale_listings l
         LEFT JOIN sale_items si ON si.id = l.sale_item_id WHERE l.id = ? LIMIT 1`,
      [id]
    );
    const l = rows[0];
    if (!l) throw new Error("Listing not found.");
    // Create/refresh the Buy-from-Shathi product first; if price is missing this
    // throws before the listing is marked active.
    const product = approve ? await upsertProductFromListing(l, payload) : null;
    await executeQuery(
      "UPDATE sale_listings SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?",
      [approve ? "active" : "rejected", adminId, id]
    );
    if (approve) await announceListingInCommunity(l, product);
    return { type, id: String(id), status: approve ? "active" : "rejected", product };
  }
  if (type === "enrollment") {
    if (approve) {
      const apps = await queryRows<Row>("SELECT user_id, required_docs FROM partner_applications WHERE id = ? LIMIT 1", [id]);
      if (!apps[0]) throw new Error("Application not found.");
      await assertRequiredDocsVerified(apps[0]);
    }
    await executeQuery(
      "UPDATE partner_applications SET status = ?, current_step = ?, approved_by = ?, approved_at = NOW(), verification_notes = COALESCE(?, verification_notes) WHERE id = ?",
      [approve ? "approved" : "rejected", approve ? "approval" : "rejected", adminId, note, id]
    );
    return { type, id: String(id), status: approve ? "approved" : "rejected" };
  }
  if (type === "order") {
    const orders = await queryRows<Row>("SELECT id, order_code, fulfillment_status FROM orders WHERE id = ? LIMIT 1", [id]);
    const order = orders[0];
    if (!order) throw new Error("Order not found.");
    if (!approve) {
      await executeQuery("UPDATE orders SET fulfillment_status = 'cancelled' WHERE id = ?", [id]);
      return { type, id: String(id), status: "cancelled" };
    }
    // Inventory validation: every line must be coverable by current stock.
    const items = await queryRows<Row>(
      `SELECT oi.product_id, oi.quantity, p.name_en, p.stock_qty
         FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`,
      [id]
    );
    const short = items.filter((it) => Number(it.stock_qty) < Number(it.quantity));
    if (short.length) {
      throw new Error(`Insufficient stock for: ${short.map((s) => `${s.name_en} (need ${s.quantity}, have ${s.stock_qty})`).join("; ")}.`);
    }
    // Deduct stock + write the inventory ledger.
    for (const it of items) {
      await executeQuery(
        "UPDATE products SET stock_qty = stock_qty - ?, status = IF(stock_qty - ? <= 0, 'out_of_stock', status) WHERE id = ?",
        [it.quantity, it.quantity, it.product_id]
      );
      await executeQuery(
        "INSERT INTO inventory_movements (product_id, change_qty, reason, ref_code, note) VALUES (?, ?, 'order', ?, ?)",
        [it.product_id, -Number(it.quantity), order.order_code, `Order approved by admin #${adminId ?? "?"}`]
      );
    }
    await executeQuery("UPDATE orders SET fulfillment_status = 'confirmed' WHERE id = ?", [id]);
    return { type, id: String(id), status: "confirmed", deducted: items.length };
  }
  if (type === "kyc") {
    const docs = await queryRows<Row>("SELECT user_id FROM app_user_kyc_documents WHERE id = ? LIMIT 1", [id]);
    await executeQuery(
      "UPDATE app_user_kyc_documents SET status = ?, note = COALESCE(?, note) WHERE id = ?",
      [approve ? "verified" : "rejected", note, id]
    );
    let kycVerified = false;
    if (docs[0]?.user_id) kycVerified = await refreshUserKycVerified(docs[0].user_id as number);
    return { type, id: String(id), status: approve ? "verified" : "rejected", user_kyc_verified: kycVerified };
  }
  if (type === "user") {
    await executeQuery("UPDATE app_users SET status = ? WHERE id = ?", [approve ? "active" : "suspended", id]);
    if (approve) {
      // Approving a user automatically grants the seller role.
      await executeQuery(
        "INSERT IGNORE INTO app_user_roles (user_id, role, assigned_by) VALUES (?, 'shathisheba_seller', ?)",
        [id, adminId]
      );
    }
    return {
      type,
      id: String(id),
      status: approve ? "active" : "suspended",
      roles: approve ? await getUserRoles(String(id)) : []
    };
  }
  throw new Error("Unknown approval type.");
}
