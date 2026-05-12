import type { ResultSetHeader } from "mysql2";
import { executeQuery, queryRows } from "@/lib/db";

type ResourceConfig = {
  table: string;
  idColumn?: string;
  listSql: string;
  allowedInsert: string[];
  allowedUpdate: string[];
  defaults?: Record<string, unknown>;
};

const configs: Record<string, ResourceConfig> = {
  interests: {
    table: "interest_categories",
    listSql: `
      SELECT
        CAST(c.id AS CHAR) AS id,
        CONCAT(COALESCE(c.emoji, ''), ' ', c.name_en) AS name,
        c.name_bn AS bangla,
        COALESCE(GROUP_CONCAT(child.name_en ORDER BY child.sort_order SEPARATOR ', '), '') AS items,
        c.slug,
        IF(c.is_active = 1, 'Active', 'Inactive') AS status
      FROM interest_categories c
      LEFT JOIN interest_categories child ON child.parent_id = c.id
      WHERE c.parent_id IS NULL
      GROUP BY c.id
      ORDER BY c.sort_order, c.id
    `,
    allowedInsert: ["parent_id", "slug", "name_en", "name_bn", "description_en", "description_bn", "emoji", "sort_order", "step_group", "is_selectable", "is_active"],
    allowedUpdate: ["parent_id", "slug", "name_en", "name_bn", "description_en", "description_bn", "emoji", "sort_order", "step_group", "is_selectable", "is_active"],
    defaults: { slug: "new-interest", name_en: "New interest", is_active: 1 }
  },
  weather: {
    table: "weather_alerts",
    listSql: `
      SELECT
        CAST(id AS CHAR) AS id,
        CONCAT(district, IFNULL(CONCAT(' / ', upazila), '')) AS location,
        title_en AS headline,
        CONCAT(alert_type, ' · ', severity) AS metrics,
        COALESCE(body_bn, body_en) AS advice,
        severity AS status
      FROM weather_alerts
      ORDER BY created_at DESC
    `,
    allowedInsert: ["district", "upazila", "alert_type", "severity", "title_en", "title_bn", "body_en", "body_bn", "weather_payload", "source", "starts_at", "ends_at", "send_push", "is_active"],
    allowedUpdate: ["district", "upazila", "alert_type", "severity", "title_en", "title_bn", "body_en", "body_bn", "weather_payload", "source", "starts_at", "ends_at", "send_push", "is_active"],
    defaults: { district: "Mymensingh", alert_type: "custom", severity: "info", title_en: "New weather alert", body_en: "Weather advisory", starts_at: new Date(), source: "admin_local" }
  },
  "market-updates": {
    table: "market_updates",
    listSql: `
      SELECT
        CAST(id AS CHAR) AS id,
        title_en AS title,
        CONCAT(COALESCE(district, 'All districts'), IFNULL(CONCAT(' / ', upazila), '')) AS area,
        update_type AS type,
        status
      FROM market_updates
      ORDER BY sort_order, created_at DESC
    `,
    allowedInsert: ["title_en", "title_bn", "body_en", "body_bn", "update_type", "district", "upazila", "status", "starts_at", "ends_at", "sort_order"],
    allowedUpdate: ["title_en", "title_bn", "body_en", "body_bn", "update_type", "district", "upazila", "status", "starts_at", "ends_at", "sort_order"],
    defaults: { title_en: "New market update", update_type: "notice", status: "draft" }
  },
  "sale/categories": {
    table: "sale_categories",
    listSql: "SELECT CAST(id AS CHAR) AS id, slug, name_en, name_bn, IF(is_active = 1, 'Active', 'Inactive') AS status FROM sale_categories ORDER BY sort_order, id",
    allowedInsert: ["slug", "name_en", "name_bn", "description_en", "description_bn", "is_active", "sort_order"],
    allowedUpdate: ["slug", "name_en", "name_bn", "description_en", "description_bn", "is_active", "sort_order"],
    defaults: { slug: "new-sale-category", name_en: "New sale category", is_active: 1 }
  },
  "sale/listings": {
    table: "sale_listings",
    listSql: `
      SELECT
        CAST(l.id AS CHAR) AS id,
        l.listing_code AS code,
        u.full_name AS farmer,
        CONCAT(COALESCE(sc.name_en, ''), ' / ', COALESCE(si.name_en, ''), ' / ', COALESCE(b.name_en, '')) AS item,
        CONCAT('৳', COALESCE(l.farmer_expected_price, 0), ' · ৳', COALESCE(l.estimated_earning, 0)) AS price,
        l.status
      FROM sale_listings l
      JOIN app_users u ON u.id = l.user_id
      JOIN sale_items si ON si.id = l.sale_item_id
      JOIN sale_categories sc ON sc.id = si.sale_category_id
      LEFT JOIN animal_breeds b ON b.id = l.breed_id
      ORDER BY l.created_at DESC
    `,
    allowedInsert: ["listing_code", "user_id", "sale_item_id", "breed_id", "title_en", "title_bn", "age_months", "weight_kg", "quantity", "unit", "farmer_expected_price", "estimated_earning", "contact_phone", "address_text", "ai_analysis_json", "status"],
    allowedUpdate: ["sale_item_id", "breed_id", "title_en", "title_bn", "age_months", "weight_kg", "quantity", "unit", "farmer_expected_price", "estimated_earning", "contact_phone", "address_text", "ai_analysis_json", "status", "approved_by", "approved_at"],
    defaults: { listing_code: `SAL-${Date.now()}`, quantity: 1, unit: "piece", status: "submitted" }
  },
  "sale/items": {
    table: "sale_items",
    listSql: `
      SELECT
        CAST(si.id AS CHAR) AS id,
        si.slug,
        si.name_en AS name,
        sc.name_en AS category,
        COALESCE(si.name_bn, '') AS bangla,
        si.status
      FROM sale_items si
      JOIN sale_categories sc ON sc.id = si.sale_category_id
      ORDER BY sc.sort_order, si.id
    `,
    allowedInsert: ["sale_category_id", "slug", "name_en", "name_bn", "description_en", "description_bn", "status", "metadata"],
    allowedUpdate: ["sale_category_id", "slug", "name_en", "name_bn", "description_en", "description_bn", "status", "metadata"],
    defaults: { slug: "new-sale-item", name_en: "New sale item", status: "active" }
  },
  "sale/breeds": {
    table: "animal_breeds",
    listSql: `
      SELECT
        CAST(id AS CHAR) AS id,
        animal_type,
        name_en AS name,
        COALESCE(name_bn, '') AS bangla,
        IF(is_active = 1, 'Active', 'Inactive') AS status
      FROM animal_breeds
      ORDER BY animal_type, id
    `,
    allowedInsert: ["animal_type", "name_en", "name_bn", "is_active"],
    allowedUpdate: ["animal_type", "name_en", "name_bn", "is_active"],
    defaults: { animal_type: "cattle", name_en: "New breed", is_active: 1 }
  },
  "sale/pricing": {
    table: "sale_pricing_rules",
    listSql: `
      SELECT
        CAST(r.id AS CHAR) AS id,
        si.name_en AS item,
        COALESCE(r.district, 'All districts') AS district,
        CONCAT('Market ', r.b2b_market_rate, ' / Farmer ', r.farmer_rate) AS rates,
        CONCAT('Fees ', r.platform_fee + r.logistics_fee + r.warehouse_vet_fee, ' per ', r.unit) AS fees,
        IF(r.is_active = 1, 'Active', 'Inactive') AS status
      FROM sale_pricing_rules r
      JOIN sale_items si ON si.id = r.sale_item_id
      ORDER BY r.effective_from DESC, r.id DESC
    `,
    allowedInsert: ["sale_item_id", "district", "effective_from", "effective_to", "b2b_market_rate", "farmer_rate", "platform_fee", "logistics_fee", "warehouse_vet_fee", "unit", "is_active"],
    allowedUpdate: ["sale_item_id", "district", "effective_from", "effective_to", "b2b_market_rate", "farmer_rate", "platform_fee", "logistics_fee", "warehouse_vet_fee", "unit", "is_active"],
    defaults: { effective_from: new Date(), b2b_market_rate: 0, farmer_rate: 0, platform_fee: 0, logistics_fee: 0, warehouse_vet_fee: 0, unit: "kg", is_active: 1 }
  },
  "buy/categories": {
    table: "buy_categories",
    listSql: "SELECT CAST(id AS CHAR) AS id, slug, name_en, name_bn, IF(is_active = 1, 'Active', 'Inactive') AS status FROM buy_categories ORDER BY sort_order, id",
    allowedInsert: ["slug", "name_en", "name_bn", "description_en", "description_bn", "sort_order", "is_active"],
    allowedUpdate: ["slug", "name_en", "name_bn", "description_en", "description_bn", "sort_order", "is_active"],
    defaults: { slug: "new-buy-category", name_en: "New buy category", is_active: 1 }
  },
  "buy/products": {
    table: "products",
    listSql: `
      SELECT
        CAST(p.id AS CHAR) AS id,
        p.sku,
        p.name_en AS name,
        c.name_en AS category,
        CONCAT(p.stock_qty, ' ', p.unit, ' · ৳', p.price) AS stock,
        p.status
      FROM products p
      JOIN buy_categories c ON c.id = p.buy_category_id
      ORDER BY p.updated_at DESC
    `,
    allowedInsert: ["buy_category_id", "sku", "name_en", "name_bn", "short_description_en", "short_description_bn", "unit", "package_size", "price", "stock_qty", "low_stock_threshold", "delivery_window", "status", "metadata"],
    allowedUpdate: ["buy_category_id", "sku", "name_en", "name_bn", "short_description_en", "short_description_bn", "unit", "package_size", "price", "stock_qty", "low_stock_threshold", "delivery_window", "status", "metadata"],
    defaults: { sku: `SKU-${Date.now()}`, name_en: "New product", unit: "piece", price: 0, stock_qty: 0, status: "draft" }
  },
  "buy/orders": {
    table: "orders",
    listSql: `
      SELECT
        CAST(o.id AS CHAR) AS id,
        o.order_code AS code,
        u.full_name AS customer,
        CONCAT(COUNT(oi.id), ' item(s)') AS product,
        CONCAT('৳', o.payable_amount) AS amount,
        o.fulfillment_status AS status
      FROM orders o
      JOIN app_users u ON u.id = o.user_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `,
    allowedInsert: ["order_code", "user_id", "total_amount", "delivery_fee", "payable_amount", "payment_method", "payment_status", "fulfillment_status", "delivery_address", "district", "upazila", "notes"],
    allowedUpdate: ["total_amount", "delivery_fee", "payable_amount", "payment_method", "payment_status", "fulfillment_status", "delivery_address", "district", "upazila", "notes"],
    defaults: { order_code: `ORD-${Date.now()}`, total_amount: 0, delivery_fee: 0, payable_amount: 0, payment_method: "cash", payment_status: "pending", fulfillment_status: "placed", delivery_address: "Address" }
  },
  "orders/payments": {
    table: "orders",
    listSql: `
      SELECT
        CAST(o.id AS CHAR) AS id,
        o.order_code AS code,
        u.full_name AS customer,
        o.payment_method AS method,
        CONCAT('৳', o.payable_amount) AS amount,
        o.payment_status AS status
      FROM orders o
      JOIN app_users u ON u.id = o.user_id
      ORDER BY o.updated_at DESC
    `,
    allowedInsert: ["order_code", "user_id", "total_amount", "delivery_fee", "payable_amount", "payment_method", "payment_status", "fulfillment_status", "delivery_address", "district", "upazila", "notes"],
    allowedUpdate: ["payment_method", "payment_status", "notes"],
    defaults: { order_code: `PAY-${Date.now()}`, total_amount: 0, delivery_fee: 0, payable_amount: 0, payment_method: "cash", payment_status: "pending", fulfillment_status: "placed", delivery_address: "Address" }
  },
  "learning/modules": {
    table: "learning_modules",
    listSql: `
      SELECT
        CAST(m.id AS CHAR) AS id,
        m.title_en AS title,
        c.name_en AS category,
        CONCAT(COUNT(lc.id), ' contents') AS contents,
        '0%' AS completion,
        m.status
      FROM learning_modules m
      JOIN learning_categories c ON c.id = m.learning_category_id
      LEFT JOIN learning_contents lc ON lc.learning_module_id = m.id
      GROUP BY m.id
      ORDER BY m.sort_order, m.id
    `,
    allowedInsert: ["learning_category_id", "title_en", "title_bn", "subtitle_en", "subtitle_bn", "thumbnail_asset_id", "sort_order", "status"],
    allowedUpdate: ["learning_category_id", "title_en", "title_bn", "subtitle_en", "subtitle_bn", "thumbnail_asset_id", "sort_order", "status"],
    defaults: { title_en: "New learning module", status: "draft" }
  },
  "partners/projects": {
    table: "partner_projects",
    listSql: `
      SELECT
        CAST(p.id AS CHAR) AS id,
        p.name_en AS name,
        p.lender_name AS lender,
        CONCAT(COUNT(a.id), '/', p.capacity) AS enrollment,
        '0%' AS progress,
        p.status
      FROM partner_projects p
      LEFT JOIN partner_applications a ON a.partner_project_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `,
    allowedInsert: ["project_code", "name_en", "name_bn", "lender_name", "district", "upazila", "start_date", "end_date", "capacity", "max_credit_amount", "status", "steps_json"],
    allowedUpdate: ["name_en", "name_bn", "lender_name", "district", "upazila", "start_date", "end_date", "capacity", "max_credit_amount", "status", "steps_json"],
    defaults: { project_code: `PRJ-${Date.now()}`, name_en: "New partner project", capacity: 0, status: "draft" }
  },
  "partners/applications": {
    table: "partner_applications",
    listSql: `
      SELECT
        CAST(a.id AS CHAR) AS id,
        a.application_code AS code,
        CONCAT(COALESCE(a.full_name_per_nid, u.full_name), ' · ', COALESCE(a.nid_number, 'NID pending')) AS name,
        p.name_en AS project,
        a.current_step AS step,
        a.status
      FROM partner_applications a
      JOIN app_users u ON u.id = a.user_id
      JOIN partner_projects p ON p.id = a.partner_project_id
      ORDER BY a.updated_at DESC
    `,
    allowedInsert: ["application_code", "user_id", "partner_project_id", "current_step", "full_name_per_nid", "nid_number", "total_land_decimals", "livestock_count", "primary_income_source", "annual_household_income", "mobile_banking_provider", "banking_json", "farm_assessment_json", "verification_notes", "status", "assigned_officer_id"],
    allowedUpdate: ["current_step", "full_name_per_nid", "nid_number", "total_land_decimals", "livestock_count", "primary_income_source", "annual_household_income", "mobile_banking_provider", "banking_json", "farm_assessment_json", "verification_notes", "status", "assigned_officer_id", "approved_by", "approved_at"],
    defaults: { application_code: `KYC-${Date.now()}`, current_step: "project_selection", status: "draft" }
  },
  "community/posts": {
    table: "community_posts",
    listSql: `
      SELECT
        CAST(p.id AS CHAR) AS id,
        u.full_name AS author,
        p.scope,
        CONCAT(p.post_type, ' · ', p.report_count, ' reports') AS type,
        p.body,
        p.status
      FROM community_posts p
      JOIN app_users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
    `,
    allowedInsert: ["user_id", "scope", "post_type", "body", "district", "upazila", "status"],
    allowedUpdate: ["scope", "post_type", "body", "district", "upazila", "status", "like_count", "comment_count", "report_count", "moderated_by", "moderated_at"],
    defaults: { scope: "upazila", post_type: "general", body: "New community post", status: "visible" }
  },
  "community/reports": {
    table: "community_posts",
    listSql: `
      SELECT
        CAST(p.id AS CHAR) AS id,
        u.full_name AS author,
        p.scope,
        p.post_type AS type,
        p.report_count AS reports,
        p.status
      FROM community_posts p
      JOIN app_users u ON u.id = p.user_id
      WHERE p.report_count > 0 OR p.status IN ('moderation', 'hidden', 'removed')
      ORDER BY p.report_count DESC, p.updated_at DESC
    `,
    allowedInsert: ["user_id", "scope", "post_type", "body", "district", "upazila", "status"],
    allowedUpdate: ["status", "moderated_by", "moderated_at", "report_count"],
    defaults: { scope: "upazila", post_type: "general", body: "Reported community post", status: "moderation" }
  },
  users: {
    table: "app_users",
    listSql: `
      SELECT
        CAST(id AS CHAR) AS id,
        full_name AS name,
        phone,
        CONCAT(COALESCE(district, ''), ' / ', COALESCE(upazila, '')) AS location,
        'App user' AS activity,
        status
      FROM app_users
      ORDER BY created_at DESC
    `,
    allowedInsert: ["full_name", "display_name", "phone", "email", "gender", "date_of_birth", "district", "upazila", "union_name", "village", "latitude", "longitude", "status", "profile_json"],
    allowedUpdate: ["full_name", "display_name", "phone", "email", "gender", "date_of_birth", "district", "upazila", "union_name", "village", "latitude", "longitude", "status", "profile_json"],
    defaults: { full_name: "New user", phone: `01${Date.now().toString().slice(-9)}`, status: "active" }
  }
};

export function hasDbResource(resource: string) {
  return Boolean(configs[resource]);
}

function normalizePayload(payload: Record<string, unknown>, config: ResourceConfig, mode: "insert" | "update") {
  const allowed = mode === "insert" ? config.allowedInsert : config.allowedUpdate;
  const aliased = { ...payload };

  if (!aliased.name_en && aliased.title_en && allowed.includes("name_en")) aliased.name_en = aliased.title_en;
  if (!aliased.name_bn && aliased.title_bn && allowed.includes("name_bn")) aliased.name_bn = aliased.title_bn;
  if (!aliased.description_en && aliased.description && allowed.includes("description_en")) aliased.description_en = aliased.description;
  if (!aliased.body_en && aliased.description && allowed.includes("body_en")) aliased.body_en = aliased.description;
  if (typeof aliased.status === "string" && allowed.includes("is_active")) {
    aliased.is_active = aliased.status.toLowerCase() === "inactive" ? 0 : 1;
  }

  const source = mode === "insert" ? { ...config.defaults, ...aliased } : aliased;
  const entries = Object.entries(source).filter(([key, value]) => allowed.includes(key) && value !== undefined && value !== "");
  return Object.fromEntries(entries);
}

export async function listResource(resource: string) {
  const config = configs[resource];
  if (!config) return null;
  return queryRows<Record<string, unknown>>(config.listSql);
}

export async function createResource(resource: string, payload: Record<string, unknown>) {
  const config = configs[resource];
  if (!config) return null;
  const data = normalizePayload(payload, config, "insert");

  if (Object.keys(data).length === 0) {
    throw new Error("No allowed fields were provided for insert.");
  }

  const columns = Object.keys(data);
  const placeholders = columns.map(() => "?").join(", ");
  const result = await executeQuery(
    `INSERT INTO ${config.table} (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${placeholders})`,
    Object.values(data)
  );
  return { insertId: result.insertId, affectedRows: result.affectedRows };
}

export async function updateResource(resource: string, id: string, payload: Record<string, unknown>) {
  const config = configs[resource];
  if (!config) return null;
  const idColumn = config.idColumn ?? "id";
  const data = normalizePayload(payload, config, "update");

  if (Object.keys(data).length === 0) {
    throw new Error("No allowed fields were provided for update.");
  }

  const assignments = Object.keys(data).map((column) => `\`${column}\` = ?`).join(", ");
  const result = await executeQuery(
    `UPDATE ${config.table} SET ${assignments} WHERE \`${idColumn}\` = ?`,
    [...Object.values(data), id]
  );
  return { affectedRows: result.affectedRows, changedRows: (result as ResultSetHeader).changedRows };
}

export async function deleteResource(resource: string, id: string) {
  const config = configs[resource];
  if (!config) return null;
  const idColumn = config.idColumn ?? "id";
  const result = await executeQuery(`DELETE FROM ${config.table} WHERE \`${idColumn}\` = ?`, [id]);
  return { affectedRows: result.affectedRows };
}

export async function getSaleListingDetail(id: string) {
  const rows = await queryRows<Record<string, unknown>>(
    `
      SELECT
        l.*,
        u.full_name AS farmer_name,
        u.phone AS farmer_phone,
        u.district AS farmer_district,
        u.upazila AS farmer_upazila,
        si.name_en AS item_name,
        si.name_bn AS item_name_bn,
        sc.name_en AS category_name,
        b.name_en AS breed_name
      FROM sale_listings l
      JOIN app_users u ON u.id = l.user_id
      JOIN sale_items si ON si.id = l.sale_item_id
      JOIN sale_categories sc ON sc.id = si.sale_category_id
      LEFT JOIN animal_breeds b ON b.id = l.breed_id
      WHERE l.id = ?
      LIMIT 1
    `,
    [id]
  );
  return rows[0] ?? null;
}
