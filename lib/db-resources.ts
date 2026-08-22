import type { ResultSetHeader } from "mysql2";
import { executeQuery, queryRows, withTransaction, type Tx } from "@/lib/db";
import { assertQuestionSetIntegrity } from "@/lib/finance/questionnaire-guard";
import { assertScorecardIntegrity } from "@/lib/finance/scorecard-guard";

type ResourceConfig = {
  table: string;
  idColumn?: string;
  listSql: string;
  allowedInsert: string[];
  allowedUpdate: string[];
  defaults?: Record<string, unknown>;
  // Run after the write, on the same connection, before the commit. Throwing
  // rolls the write back — the place to enforce an invariant that spans rows and
  // therefore cannot be expressed as a column constraint.
  afterWrite?: (tx: Tx) => Promise<void>;
};

function simpleConfig(
  table: string,
  allowedFields: string[],
  defaults: Record<string, unknown> = {},
  afterWrite?: (tx: Tx) => Promise<void>
): ResourceConfig {
  return {
    table,
    listSql: `SELECT CAST(id AS CHAR) AS id, ${allowedFields.map((field) => `\`${field}\``).join(", ")} FROM ${table} ORDER BY id DESC`,
    allowedInsert: allowedFields,
    allowedUpdate: allowedFields,
    defaults,
    afterWrite
  };
}

const configs: Record<string, ResourceConfig> = {
  "admin/users": simpleConfig(
    "admin_users",
    ["name", "email", "phone", "password_hash", "role", "district", "upazila", "is_active", "last_login_at"],
    { name: "New admin", email: `admin-${Date.now()}@shathisheba.local`, password_hash: "change-me", role: "hq_admin", is_active: 1 }
  ),
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
  "user/interests": {
    table: "user_interests",
    idColumn: "user_id",
    listSql: `
      SELECT
        CONCAT(ui.user_id, ':', ui.interest_category_id) AS id,
        CAST(ui.user_id AS CHAR) AS user_id,
        u.full_name AS user_name,
        CAST(ui.interest_category_id AS CHAR) AS interest_category_id,
        c.name_en AS interest_name,
        ui.created_at
      FROM user_interests ui
      JOIN app_users u ON u.id = ui.user_id
      JOIN interest_categories c ON c.id = ui.interest_category_id
      ORDER BY ui.created_at DESC
    `,
    allowedInsert: ["user_id", "interest_category_id"],
    allowedUpdate: ["interest_category_id"]
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
    allowedInsert: ["title_en", "title_bn", "body_en", "body_bn", "image_url", "detail_en", "detail_bn", "category", "update_type", "district", "upazila", "status", "starts_at", "ends_at", "sort_order"],
    allowedUpdate: ["title_en", "title_bn", "body_en", "body_bn", "image_url", "detail_en", "detail_bn", "category", "update_type", "district", "upazila", "status", "starts_at", "ends_at", "sort_order"],
    defaults: { title_en: "New market update", update_type: "notice", status: "draft" }
  },
  "sale/categories": {
    table: "sale_categories",
    listSql: "SELECT CAST(id AS CHAR) AS id, CONCAT(COALESCE(emoji,''), ' ', name_en) AS name_en, slug, name_bn, IF(pref_selectable = 1, 'Yes', 'No') AS preference, IF(is_active = 1, 'Active', 'Inactive') AS status FROM sale_categories ORDER BY sort_order, id",
    allowedInsert: ["slug", "name_en", "name_bn", "emoji", "interest_slug", "pref_selectable", "description_en", "description_bn", "is_active", "sort_order"],
    allowedUpdate: ["slug", "name_en", "name_bn", "emoji", "interest_slug", "pref_selectable", "description_en", "description_bn", "is_active", "sort_order"],
    defaults: { slug: "new-sale-category", name_en: "New sale category", pref_selectable: 1, is_active: 1 }
  },
  "sale/animals": {
    table: "animals",
    listSql: "SELECT CAST(id AS CHAR) AS id, CONCAT(COALESCE(emoji,''), ' ', name_en) AS name, slug, name_bn AS bangla, species, IF(is_active = 1, 'Active', 'Inactive') AS status FROM animals ORDER BY sort_order, id",
    allowedInsert: ["slug", "name_en", "name_bn", "species", "emoji", "sale_category_id", "sort_order", "is_active"],
    allowedUpdate: ["slug", "name_en", "name_bn", "species", "emoji", "sale_category_id", "sort_order", "is_active"],
    defaults: { slug: "new-animal", name_en: "New animal", species: "cattle", sale_category_id: 2, is_active: 1 }
  },
  "geo/divisions": {
    table: "geo_divisions",
    listSql: "SELECT CAST(id AS CHAR) AS id, name_en AS name, name_bn AS bangla, sort_order FROM geo_divisions ORDER BY sort_order, name_en",
    allowedInsert: ["id", "name_en", "name_bn", "sort_order"],
    allowedUpdate: ["name_en", "name_bn", "sort_order"],
    defaults: { name_en: "New division" }
  },
  "geo/districts": {
    table: "geo_districts",
    listSql: "SELECT CAST(d.id AS CHAR) AS id, d.name_en AS name, d.name_bn AS bangla, v.name_en AS division FROM geo_districts d JOIN geo_divisions v ON v.id = d.division_id ORDER BY v.name_en, d.name_en",
    allowedInsert: ["id", "division_id", "name_en", "name_bn"],
    allowedUpdate: ["division_id", "name_en", "name_bn"],
    defaults: { name_en: "New district", division_id: 1 }
  },
  "geo/upazilas": {
    table: "geo_upazilas",
    listSql: "SELECT CAST(u.id AS CHAR) AS id, u.name_en AS name, u.name_bn AS bangla, d.name_en AS district FROM geo_upazilas u JOIN geo_districts d ON d.id = u.district_id ORDER BY d.name_en, u.name_en",
    allowedInsert: ["id", "district_id", "name_en", "name_bn"],
    allowedUpdate: ["district_id", "name_en", "name_bn"],
    defaults: { name_en: "New upazila", district_id: 1 }
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
    allowedInsert: ["listing_code", "user_id", "sale_item_id", "animal_id", "breed_id", "title_en", "title_bn", "description", "age_months", "weight_kg", "meat_weight_kg", "dressing_pct", "quantity", "unit", "farmer_expected_price", "estimated_earning", "contact_phone", "contact_name", "contact_nid", "contact_is_self", "address_text", "division", "district", "upazila", "ai_analysis_json", "media_json", "status"],
    allowedUpdate: ["sale_item_id", "animal_id", "breed_id", "title_en", "title_bn", "description", "age_months", "weight_kg", "meat_weight_kg", "dressing_pct", "quantity", "unit", "farmer_expected_price", "estimated_earning", "contact_phone", "contact_name", "contact_nid", "contact_is_self", "address_text", "division", "district", "upazila", "ai_analysis_json", "media_json", "status", "approved_by", "approved_at", "field_visit_date", "field_visit_note", "verified_weight_kg", "paid_at", "paid_amount", "payment_method", "payment_reference"],
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
    allowedInsert: ["animal_type", "name_en", "name_bn", "sort_order", "is_active"],
    allowedUpdate: ["animal_type", "name_en", "name_bn", "sort_order", "is_active"],
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
    allowedInsert: ["sale_item_id", "partner_project_id", "animal_id", "breed_id", "district", "division", "effective_from", "effective_to", "b2b_market_rate", "b2b_meat_rate", "dressing_pct", "farmer_rate", "platform_fee", "platform_fee_pct", "logistics_fee", "warehouse_vet_fee", "unit", "is_active"],
    allowedUpdate: ["sale_item_id", "partner_project_id", "animal_id", "breed_id", "district", "division", "effective_from", "effective_to", "b2b_market_rate", "b2b_meat_rate", "dressing_pct", "farmer_rate", "platform_fee", "platform_fee_pct", "logistics_fee", "warehouse_vet_fee", "unit", "is_active"],
    defaults: { effective_from: new Date(), b2b_market_rate: 0, b2b_meat_rate: 0, dressing_pct: 50, farmer_rate: 0, platform_fee: 0, logistics_fee: 0, warehouse_vet_fee: 0, unit: "kg", is_active: 1 }
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
  "orders/items": simpleConfig(
    "order_items",
    ["order_id", "product_id", "quantity", "unit_price", "line_total"],
    { quantity: 1, unit_price: 0, line_total: 0 }
  ),
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
  "learning/categories": simpleConfig(
    "learning_categories",
    ["slug", "name_en", "name_bn", "emoji", "description_en", "description_bn", "interest_slug", "section", "sort_order", "is_active"],
    { slug: `learning-${Date.now()}`, name_en: "New learning category", sort_order: 0, is_active: 1 }
  ),
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
    allowedInsert: ["learning_category_id", "title_en", "title_bn", "subtitle_en", "subtitle_bn", "level", "emoji", "thumbnail_asset_id", "sort_order", "status"],
    allowedUpdate: ["learning_category_id", "title_en", "title_bn", "subtitle_en", "subtitle_bn", "level", "emoji", "thumbnail_asset_id", "sort_order", "status"],
    defaults: { title_en: "New learning module", level: 1, status: "draft" }
  },
  "learning/contents": simpleConfig(
    "learning_contents",
    ["learning_module_id", "content_type", "title_en", "title_bn", "body_en", "body_bn", "video_url", "duration_seconds", "points", "image_url", "summary_en", "summary_bn", "quiz_json", "sort_order", "status"],
    { content_type: "article", title_en: "New learning content", points: 10, sort_order: 0, status: "draft" }
  ),
  "learning/progress": {
    table: "user_learning_progress",
    idColumn: "user_id",
    listSql: `
      SELECT
        CONCAT(ulp.user_id, ':', ulp.learning_content_id) AS id,
        CAST(ulp.user_id AS CHAR) AS user_id,
        u.full_name AS user_name,
        CAST(ulp.learning_content_id AS CHAR) AS learning_content_id,
        lc.title_en AS content_title,
        ulp.status,
        ulp.completed_at,
        ulp.score
      FROM user_learning_progress ulp
      JOIN app_users u ON u.id = ulp.user_id
      JOIN learning_contents lc ON lc.id = ulp.learning_content_id
      ORDER BY ulp.completed_at DESC, ulp.user_id DESC
    `,
    allowedInsert: ["user_id", "learning_content_id", "status", "completed_at", "score"],
    allowedUpdate: ["status", "completed_at", "score"]
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
    allowedInsert: ["project_code", "name_en", "name_bn", "interest_slug", "lender_name", "division", "district", "upazila", "image_url", "summary_en", "summary_bn", "market_overview_en", "market_overview_bn", "investment_amount", "income_amount", "income_label_en", "income_label_bn", "model_en", "model_bn", "loan_partners_en", "loan_partners_bn", "capacity_label_en", "capacity_label_bn", "terms_json", "duration_label", "region_based", "is_active", "platform_fee", "logistics_fee", "warehouse_vet_fee", "start_date", "end_date", "capacity", "max_credit_amount", "status", "steps_json"],
    allowedUpdate: ["name_en", "name_bn", "interest_slug", "lender_name", "division", "district", "upazila", "image_url", "summary_en", "summary_bn", "market_overview_en", "market_overview_bn", "investment_amount", "income_amount", "income_label_en", "income_label_bn", "model_en", "model_bn", "loan_partners_en", "loan_partners_bn", "capacity_label_en", "capacity_label_bn", "terms_json", "duration_label", "region_based", "is_active", "platform_fee", "logistics_fee", "warehouse_vet_fee", "start_date", "end_date", "capacity", "max_credit_amount", "status", "steps_json"],
    defaults: { project_code: `PRJ-${Date.now()}`, name_en: "New partner project", capacity: 0, region_based: 1, is_active: 1, status: "draft" }
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
    allowedInsert: ["application_code", "user_id", "partner_project_id", "current_step", "full_name_per_nid", "nid_number", "total_land_decimals", "livestock_count", "primary_income_source", "annual_household_income", "mobile_banking_provider", "banking_json", "farm_assessment_json", "verification_notes", "status", "assigned_officer_id", "field_visit_date", "field_visit_note", "docs_verified_at", "contract_started_at", "progress_note"],
    allowedUpdate: ["current_step", "full_name_per_nid", "nid_number", "total_land_decimals", "livestock_count", "primary_income_source", "annual_household_income", "mobile_banking_provider", "banking_json", "farm_assessment_json", "verification_notes", "status", "assigned_officer_id", "approved_by", "approved_at", "field_visit_date", "field_visit_note", "docs_verified_at", "contract_started_at", "progress_note"],
    defaults: { application_code: `KYC-${Date.now()}`, current_step: "project_selection", status: "draft" }
  },
  "partners/ledgers": simpleConfig(
    "project_ledgers",
    ["partner_application_id", "entry_type", "title_en", "title_bn", "amount", "entry_date", "metadata"],
    { entry_type: "adjustment", title_en: "New ledger entry", amount: 0, entry_date: new Date() }
  ),
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
    allowedInsert: ["user_id", "scope", "post_type", "body", "image_url", "is_official", "district", "upazila", "status"],
    allowedUpdate: ["scope", "post_type", "body", "image_url", "is_official", "district", "upazila", "status", "like_count", "comment_count", "report_count", "moderated_by", "moderated_at"],
    defaults: { scope: "upazila", post_type: "general", body: "New community post", status: "visible" }
  },
  "community/comments": simpleConfig(
    "community_comments",
    ["community_post_id", "user_id", "body", "status"],
    { body: "New comment", status: "visible" }
  ),
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
  // ---- Finance: readiness (Feature 1) --------------------------------------
  "loan/questionnaire": {
    table: "readiness_questions",
    listSql: `
      SELECT
        CAST(q.id AS CHAR) AS id,
        q.sort_order AS num,
        q.part,
        q.question_en AS question,
        q.question_bn AS bangla,
        q.category,
        q.weight,
        COALESCE(q.flag, '—') AS flag,
        COALESCE(q.action_deeplink, '—') AS action,
        q.is_active
      FROM readiness_questions q
      JOIN readiness_question_sets s ON s.id = q.set_id AND s.status = 'active'
      ORDER BY q.sort_order
    `,
    allowedInsert: ["set_id","part","sort_order","category","weight","flag","flag_code","branch_parent_order","branch_show_when","question_bn","question_en","helper_bn","helper_en","strength_bn","strength_en","gap_bn","gap_en","action_title_bn","action_title_en","action_rationale_bn","action_rationale_en","action_deeplink","is_active"],
    allowedUpdate: ["part","sort_order","category","weight","flag","flag_code","branch_parent_order","branch_show_when","question_bn","question_en","helper_bn","helper_en","strength_bn","strength_en","gap_bn","gap_en","action_title_bn","action_title_en","action_rationale_bn","action_rationale_en","action_deeplink","is_active"],
    defaults: { part: "core", category: "financial", weight: 0.05, is_active: 1 },
    // ADM-RDY-02. A weight edit that unbalances the live instrument is rejected
    // and rolled back rather than accepted and quietly mis-scored from then on.
    afterWrite: assertQuestionSetIntegrity
  },
  "loan/readiness-checks": {
    table: "readiness_assessments",
    listSql: `
      SELECT
        CAST(a.id AS CHAR) AS id,
        u.full_name AS farmer,
        u.district,
        a.depth,
        a.score,
        a.grade,
        a.readiness_status AS status,
        a.data_confidence AS confidence,
        a.signal_count AS signals,
        IF(EXISTS(SELECT 1 FROM loan_applications la WHERE la.user_id = a.user_id), 'Yes', 'No') AS converted,
        a.created_at
      FROM readiness_assessments a
      JOIN app_users u ON u.id = a.user_id
      ORDER BY a.created_at DESC
    `,
    allowedInsert: [],
    allowedUpdate: []
  },
  "loan/confidence-signals": simpleConfig(
    "readiness_confidence_signals",
    ["code","label_bn","label_en","source_check","fix_deeplink","sort_order","is_active"],
    { code: "S9", label_en: "New signal", label_bn: "নতুন সংকেত", source_check: "custom", is_active: 1 }
  ),

  // ---- Finance: loan (Feature 2) -------------------------------------------
  "loan/products": {
    table: "loan_products",
    listSql: `
      SELECT
        CAST(id AS CHAR) AS id,
        CONCAT(COALESCE(icon,''), ' ', name_en) AS product,
        name_bn AS bangla,
        code,
        CONCAT(interest_rate_annual, '%') AS rate,
        interest_method AS method,
        allowed_tenures_json AS tenures,
        CONCAT('৳', FORMAT(min_amount,0), ' – ৳', FORMAT(max_amount,0)) AS amount_range,
        IF(is_active = 1, 'Live', IF(coming_soon = 1, 'Coming soon', 'Off')) AS availability,
        sort_order
      FROM loan_products
      ORDER BY sort_order, id
    `,
    allowedInsert: ["code","name_bn","name_en","description_bn","description_en","icon","interest_rate_annual","interest_method","allowed_tenures_json","allowed_repayment_modes_json","min_amount","max_amount","amount_step","weeks_per_month","first_payment_offset_days","grace_period_months","processing_fee_pct","processing_fee_flat","late_penalty_pct","late_penalty_grace_days","collateral_required","is_active","coming_soon","sort_order"],
    allowedUpdate: ["name_bn","name_en","description_bn","description_en","icon","interest_rate_annual","interest_method","allowed_tenures_json","allowed_repayment_modes_json","min_amount","max_amount","amount_step","weeks_per_month","first_payment_offset_days","grace_period_months","processing_fee_pct","processing_fee_flat","late_penalty_pct","late_penalty_grace_days","collateral_required","is_active","coming_soon","sort_order"],
    defaults: { interest_method: "flat", amount_step: 1000, weeks_per_month: 4, first_payment_offset_days: 30, is_active: 0, coming_soon: 1 }
  },
  "loan/applications": {
    table: "loan_applications",
    listSql: `
      SELECT
        CAST(a.id AS CHAR) AS id,
        a.application_code AS code,
        u.full_name AS farmer,
        u.phone,
        p.name_en AS product,
        CONCAT('৳', FORMAT(a.requested_amount,0)) AS requested,
        a.status,
        a.district,
        a.repayment_mode AS mode,
        a.tenure_months AS months,
        DATEDIFF(NOW(), a.created_at) AS days_open,
        a.created_at
      FROM loan_applications a
      JOIN app_users u ON u.id = a.user_id
      JOIN loan_products p ON p.id = a.loan_product_id
      ORDER BY a.created_at DESC
    `,
    allowedInsert: [],
    allowedUpdate: ["status","assigned_officer_id","pending_user_action","recommended_amount","approved_amount","needs_correction_note"]
  },
  "loan/consent-types": simpleConfig(
    "loan_consent_types",
    ["consent_key","title_bn","title_en","description_bn","description_en","version","is_required","is_revocable","collected_at_stage","is_active","sort_order"],
    { version: "v1", is_required: 1, is_revocable: 1, collected_at_stage: "apply", is_active: 1 }
  ),
  "loan/purposes": simpleConfig(
    "loan_purposes",
    ["code","label_bn","label_en","icon","is_active","sort_order"],
    { is_active: 1 }
  ),

  // ---- Finance: the 100-point scorecard (Feature 2, P4) ---------------------
  "loan/scorecard-models": simpleConfig(
    "scorecard_models",
    ["version","status","notes","grade_a_min","grade_b_min","grade_c_min",
     "confidence_high_pct","confidence_med_pct"],
    { version: "sc-draft", status: "draft", grade_a_min: 80, grade_b_min: 70, grade_c_min: 60,
      confidence_high_pct: 80, confidence_med_pct: 50 },
    // A weight edit that unbalances a live model is rejected and rolled back, for
    // the same reason as the readiness instrument: the engine normalises, so a
    // wrong total scores every subsequent applicant plausibly and wrongly.
    assertScorecardIntegrity
  ),
  "loan/scorecard-criteria": {
    table: "scorecard_criteria",
    listSql: `
      SELECT
        CAST(c.id AS CHAR) AS id,
        m.version AS model,
        c.sort_order AS num,
        c.code,
        c.label_en AS criterion,
        c.label_bn AS bangla,
        c.weight,
        c.layer,
        COALESCE(c.evidence_source, '—') AS evidence,
        (SELECT COUNT(*) FROM scorecard_rating_rules r WHERE r.criterion_id = c.id) AS rules,
        c.is_active
      FROM scorecard_criteria c
      JOIN scorecard_models m ON m.id = c.model_id
      ORDER BY m.id, c.sort_order
    `,
    allowedInsert: ["model_id","code","sort_order","label_bn","label_en","weight","layer","evidence_source","is_active"],
    allowedUpdate: ["code","sort_order","label_bn","label_en","weight","layer","evidence_source","is_active"],
    defaults: { layer: "quantitative", weight: 0, is_active: 1 },
    afterWrite: assertScorecardIntegrity
  },
  "loan/scorecard-rules": {
    table: "scorecard_rating_rules",
    listSql: `
      SELECT
        CAST(r.id AS CHAR) AS id,
        c.code AS criterion,
        r.metric,
        r.sort_order AS num,
        COALESCE(CAST(r.min_value AS CHAR), '—') AS min_value,
        COALESCE(CAST(r.max_value AS CHAR), '—') AS max_value,
        r.rating,
        COALESCE(r.label_en, '—') AS meaning,
        r.is_active
      FROM scorecard_rating_rules r
      JOIN scorecard_criteria c ON c.id = r.criterion_id
      ORDER BY c.sort_order, r.sort_order
    `,
    allowedInsert: ["criterion_id","sort_order","metric","min_value","max_value","rating","label_bn","label_en","is_active"],
    allowedUpdate: ["sort_order","metric","min_value","max_value","rating","label_bn","label_en","is_active"],
    defaults: { rating: 0, sort_order: 0, is_active: 1 }
  },
  // Platform switches. Deliberately not free-form key creation from the app —
  // a key nothing reads is a setting that silently does nothing.
  "settings/app": simpleConfig(
    "app_settings",
    ["setting_key", "value_text", "description"],
    { value_text: "0" }
  ),
  "loan/hard-stops": simpleConfig(
    "credit_hard_stop_rules",
    ["code","label_bn","label_en","explanation_bn","explanation_en","required_action_bn",
     "required_action_en","check_key","overridable","sort_order","is_active"],
    { check_key: "identity_unverified", overridable: 0, is_active: 1 }
  ),
  "loan/reason-codes": simpleConfig(
    "credit_reason_codes",
    ["code","polarity","label_bn","label_en","criterion_code","sort_order","is_active"],
    { polarity: "negative", is_active: 1 }
  ),
  "loan/pathway-rules": simpleConfig(
    "credit_pathway_rules",
    ["sort_order","when_grade","when_confidence","when_hard_stop","when_safeguards",
     "pathway_code","readiness_status","amount_factor","label_bn","label_en","is_active"],
    { sort_order: 99, readiness_status: "development_required", is_active: 1 }
  ),
  "loan/verification-items": simpleConfig(
    "loan_verification_items",
    ["code","label_bn","label_en","guidance_bn","guidance_en","sort_order","is_active"],
    { is_active: 1 }
  ),
  "loan/development-templates": simpleConfig(
    "development_plan_templates",
    ["code","title_bn","title_en","detail_bn","detail_en","criterion_code",
     "action_deeplink","default_days","sort_order","is_active"],
    { default_days: 30, is_active: 1 }
  ),
  "loan/lenders": simpleConfig(
    "lenders",
    ["code","name_bn","name_en","lender_type","contact_name","contact_email","contact_phone",
     "min_grade","min_confidence","max_amount","notes","is_active"],
    { lender_type: "bank", is_active: 0 }
  ),
  "loan/submissions": {
    table: "lender_submissions",
    listSql: `
      SELECT
        CAST(s.id AS CHAR) AS id,
        a.application_code AS application,
        u.full_name AS farmer,
        l.name_en AS lender,
        s.status,
        CONCAT('৳', FORMAT(COALESCE(s.submitted_amount,0),0)) AS submitted,
        CONCAT('৳', FORMAT(COALESCE(s.approved_amount,0),0)) AS approved,
        COALESCE(s.decline_reason_code, '—') AS decline_reason,
        IF(s.consent_verified_at IS NULL, 'NOT CHECKED', 'Yes') AS consent,
        s.submitted_at
      FROM lender_submissions s
      JOIN loan_applications a ON a.id = s.application_id
      JOIN app_users u ON u.id = a.user_id
      JOIN lenders l ON l.id = s.lender_id
      ORDER BY s.submitted_at DESC, s.id DESC
    `,
    // Decisions go through admin/loan/lenders/decision, which enforces the legal
    // transitions and the structured decline reason. Editing the row directly
    // would let someone move a declined submission back to "under review".
    allowedInsert: [],
    allowedUpdate: []
  },
  "loan/assessments": {
    table: "credit_assessments",
    listSql: `
      SELECT
        CAST(ca.id AS CHAR) AS id,
        a.application_code AS application,
        u.full_name AS farmer,
        ca.sequence_no AS seq,
        ca.scorecard_model_version AS model,
        ca.total_score AS score,
        ca.grade,
        ca.readiness_status AS readiness,
        ca.data_confidence AS confidence,
        IF(ca.hard_stop = 1, 'Yes', 'No') AS hard_stop,
        COALESCE(ca.primary_pathway, '—') AS pathway,
        ca.status,
        ca.created_at
      FROM credit_assessments ca
      JOIN loan_applications a ON a.id = ca.application_id
      JOIN app_users u ON u.id = ca.user_id
      WHERE ca.is_shadow = 0
      ORDER BY ca.created_at DESC
    `,
    // Immutable by design (ENG-32). A correction is a new assessment, not an edit.
    allowedInsert: [],
    allowedUpdate: []
  },
  "loan/accounts": {
    table: "loan_accounts",
    listSql: `
      SELECT
        CAST(acc.id AS CHAR) AS id,
        a.application_code AS code,
        u.full_name AS farmer,
        CONCAT('৳', FORMAT(acc.principal,0)) AS disbursed,
        CONCAT(acc.interest_rate_annual, '%') AS rate,
        acc.repayment_mode AS mode,
        CONCAT('৳', FORMAT(acc.emi_amount,2)) AS installment,
        CONCAT('৳', FORMAT(acc.outstanding_total,0)) AS outstanding,
        acc.next_due_date,
        acc.days_past_due AS dpd,
        acc.status
      FROM loan_accounts acc
      JOIN loan_applications a ON a.id = acc.application_id
      JOIN app_users u ON u.id = acc.user_id
      ORDER BY acc.next_due_date
    `,
    allowedInsert: [],
    allowedUpdate: ["status"]
  },

  // Removed: "notifications/campaigns" and "media/assets".
  //
  // Both were CRUD endpoints over tables that nothing in the platform reads or
  // writes, with no console page and no mobile caller — creating a campaign row
  // sent no notification (the app has no push transport at all), and /api/upload
  // stores its result on the owning record's own column rather than in a media
  // registry. Exposing them implied working features that did not exist. The
  // tables are left in place; restoring an endpoint is a few lines here once a
  // real writer exists behind it.
  "audit/logs": simpleConfig(
    "audit_logs",
    ["actor_admin_id", "action", "entity_type", "entity_id", "before_json", "after_json", "ip_address", "user_agent"],
    { action: "manual", entity_type: "system" }
  ),
  users: {
    table: "app_users",
    listSql: `
      SELECT
        CAST(u.id AS CHAR) AS id,
        u.full_name AS name,
        u.phone,
        CONCAT(COALESCE(u.district, ''), ' / ', COALESCE(u.upazila, '')) AS location,
        COALESCE(GROUP_CONCAT(r.role ORDER BY r.role SEPARATOR ', '), 'shathisheba_buyer') AS roles,
        u.status
      FROM app_users u
      LEFT JOIN app_user_roles r ON r.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `,
    allowedInsert: ["full_name", "display_name", "phone", "email", "gender", "date_of_birth", "district", "upazila", "union_name", "village", "latitude", "longitude", "status", "profile_json"],
    allowedUpdate: ["full_name", "display_name", "phone", "email", "gender", "date_of_birth", "district", "upazila", "union_name", "village", "latitude", "longitude", "status", "profile_json"],
    defaults: { full_name: "New user", phone: `01${Date.now().toString().slice(-9)}`, status: "active" }
  },
  "app/user-roles": {
    table: "app_user_roles",
    listSql: `
      SELECT
        CAST(r.id AS CHAR) AS id,
        CAST(r.user_id AS CHAR) AS user_id,
        u.full_name AS user,
        u.phone,
        r.role,
        r.created_at
      FROM app_user_roles r
      JOIN app_users u ON u.id = r.user_id
      ORDER BY r.created_at DESC, r.id DESC
    `,
    allowedInsert: ["user_id", "role", "assigned_by"],
    allowedUpdate: ["role"],
    defaults: { role: "shathisheba_buyer" }
  },
  "app/user-banking": {
    table: "app_user_banking",
    listSql: `
      SELECT CAST(b.id AS CHAR) AS id, CAST(b.user_id AS CHAR) AS user_id,
             u.full_name AS user, b.bank_name, b.account_number,
             b.mobile_provider, b.mobile_account
      FROM app_user_banking b JOIN app_users u ON u.id = b.user_id
      ORDER BY b.updated_at DESC, b.id DESC
    `,
    allowedInsert: ["user_id", "bank_name", "branch_name", "account_name", "account_number", "mobile_provider", "mobile_account", "notes"],
    allowedUpdate: ["bank_name", "branch_name", "account_name", "account_number", "mobile_provider", "mobile_account", "notes"]
  },
  "app/user-farm": {
    table: "app_user_farm",
    listSql: `
      SELECT CAST(f.id AS CHAR) AS id, CAST(f.user_id AS CHAR) AS user_id,
             u.full_name AS user, f.total_land_decimals, f.primary_focus,
             f.livestock_count, f.pond_count
      FROM app_user_farm f JOIN app_users u ON u.id = f.user_id
      ORDER BY f.updated_at DESC, f.id DESC
    `,
    allowedInsert: ["user_id", "total_land_decimals", "primary_focus", "crop_types", "livestock_count", "pond_count", "farm_address", "notes"],
    allowedUpdate: ["total_land_decimals", "primary_focus", "crop_types", "livestock_count", "pond_count", "farm_address", "notes"]
  },
  "app/user-kyc": {
    table: "app_user_kyc_documents",
    listSql: `
      SELECT CAST(k.id AS CHAR) AS id, CAST(k.user_id AS CHAR) AS user_id,
             u.full_name AS user, k.doc_type, k.document_url, k.status, k.created_at
      FROM app_user_kyc_documents k JOIN app_users u ON u.id = k.user_id
      ORDER BY k.created_at DESC, k.id DESC
    `,
    allowedInsert: ["user_id", "doc_type", "document_url", "status", "note"],
    allowedUpdate: ["doc_type", "document_url", "status", "note"],
    defaults: { doc_type: "other", status: "pending" }
  },
  faq: {
    table: "faq_items",
    listSql: `
      SELECT
        CAST(id AS CHAR) AS id,
        category,
        question_en AS question,
        COALESCE(question_bn, '') AS bangla,
        IF(is_active = 1, 'Active', 'Inactive') AS status
      FROM faq_items
      ORDER BY sort_order, id
    `,
    allowedInsert: ["category", "question_en", "question_bn", "answer_en", "answer_bn", "sort_order", "is_active"],
    allowedUpdate: ["category", "question_en", "question_bn", "answer_en", "answer_bn", "sort_order", "is_active"],
    defaults: { category: "general", question_en: "New question", answer_en: "Answer", sort_order: 0, is_active: 1 }
  },
  "community/officers": {
    table: "zone_officers",
    listSql: `
      SELECT
        CAST(id AS CHAR) AS id,
        name,
        officer_role AS role,
        CONCAT(COALESCE(district, ''), ' / ', COALESCE(upazila, '')) AS zone,
        COALESCE(phone, '') AS phone,
        IF(is_active = 1, 'Active', 'Inactive') AS status
      FROM zone_officers
      ORDER BY district, upazila, officer_role
    `,
    allowedInsert: ["officer_role", "name", "phone", "district", "upazila", "photo_asset_id", "admin_user_id", "is_active"],
    allowedUpdate: ["officer_role", "name", "phone", "district", "upazila", "photo_asset_id", "admin_user_id", "is_active"],
    defaults: { officer_role: "field_officer", name: "New officer", is_active: 1 }
  },
  "assistant/prompts": {
    table: "ai_assistant_prompts",
    listSql: `
      SELECT
        CAST(id AS CHAR) AS id,
        prompt_type AS type,
        title_en AS title,
        COALESCE(title_bn, '') AS bangla,
        IF(is_active = 1, 'Active', 'Inactive') AS status
      FROM ai_assistant_prompts
      ORDER BY prompt_type, sort_order, id
    `,
    allowedInsert: ["prompt_type", "title_en", "title_bn", "body_en", "body_bn", "sort_order", "is_active"],
    allowedUpdate: ["prompt_type", "title_en", "title_bn", "body_en", "body_bn", "sort_order", "is_active"],
    defaults: { prompt_type: "quick_prompt", title_en: "New prompt", sort_order: 0, is_active: 1 }
  },
  "sale/confirmations": {
    table: "payment_confirmations",
    listSql: `
      SELECT
        CAST(pc.id AS CHAR) AS id,
        l.listing_code AS listing,
        CONCAT(COALESCE(pc.actual_weight_kg, 0), ' kg') AS weight,
        CONCAT('৳', COALESCE(pc.final_amount, 0)) AS amount,
        pc.status
      FROM payment_confirmations pc
      JOIN sale_listings l ON l.id = pc.sale_listing_id
      ORDER BY pc.created_at DESC
    `,
    allowedInsert: ["sale_listing_id", "actual_weight_kg", "final_amount", "otp_code", "otp_expires_at", "status"],
    allowedUpdate: ["actual_weight_kg", "final_amount", "otp_code", "otp_expires_at", "status", "confirmed_at"],
    defaults: { status: "pending" }
  }
};

export function hasDbResource(resource: string) {
  return Boolean(configs[resource]);
}

export function getDbResourceKeys() {
  return Object.keys(configs).sort();
}

// Write payloads were only ever filtered against the column allow-list — which
// stops mass assignment, but says nothing about the values themselves. A caller
// could send a 10MB string, a NaN, or thousands of keys, and the first the system
// heard of it was MySQL truncating the value or the driver throwing.
//
// This does not replace per-column schemas; it rejects the shapes that are wrong
// for any column, before the query is built.
const MAX_FIELD_CHARS = 20000;
const MAX_PAYLOAD_FIELDS = 100;

function assertPayloadSane(payload: unknown): asserts payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Request body must be a JSON object.");
  }
  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length > MAX_PAYLOAD_FIELDS) {
    throw new Error(`Too many fields in request body (max ${MAX_PAYLOAD_FIELDS}).`);
  }
  for (const [key, value] of entries) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`Field '${key}' must be a finite number.`);
    }
    if (typeof value === "string" && value.length > MAX_FIELD_CHARS) {
      throw new Error(`Field '${key}' is too long (max ${MAX_FIELD_CHARS} characters).`);
    }
    if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      throw new Error(`Field '${key}' has an unsupported type.`);
    }
  }
}

function normalizePayload(payload: Record<string, unknown>, config: ResourceConfig, mode: "insert" | "update") {
  assertPayloadSane(payload);
  const allowed = mode === "insert" ? config.allowedInsert : config.allowedUpdate;
  const aliased = { ...payload };

  if (!aliased.full_name && aliased.name && allowed.includes("full_name")) aliased.full_name = aliased.name;
  if (!aliased.name && aliased.full_name && allowed.includes("name")) aliased.name = aliased.full_name;
  if (!aliased.name_en && aliased.title_en && allowed.includes("name_en")) aliased.name_en = aliased.title_en;
  if (!aliased.name_en && aliased.name && allowed.includes("name_en")) aliased.name_en = aliased.name;
  if (!aliased.name_bn && aliased.title_bn && allowed.includes("name_bn")) aliased.name_bn = aliased.title_bn;
  if (!aliased.title_en && aliased.name_en && allowed.includes("title_en")) aliased.title_en = aliased.name_en;
  if (!aliased.title_en && aliased.title && allowed.includes("title_en")) aliased.title_en = aliased.title;
  if (!aliased.body && aliased.body_en && allowed.includes("body")) aliased.body = aliased.body_en;
  if (!aliased.body_en && aliased.body && allowed.includes("body_en")) aliased.body_en = aliased.body;
  if (!aliased.description_en && aliased.description && allowed.includes("description_en")) aliased.description_en = aliased.description;
  if (!aliased.body_en && aliased.description && allowed.includes("body_en")) aliased.body_en = aliased.description;
  if (!aliased.delivery_address && aliased.address && allowed.includes("delivery_address")) aliased.delivery_address = aliased.address;
  if (!aliased.address_text && aliased.address && allowed.includes("address_text")) aliased.address_text = aliased.address;
  if (!aliased.payment_status && aliased.payment && allowed.includes("payment_status")) aliased.payment_status = aliased.payment;
  if (!aliased.fulfillment_status && aliased.fulfillment && allowed.includes("fulfillment_status")) aliased.fulfillment_status = aliased.fulfillment;
  if (!aliased.verification_notes && aliased.notes && allowed.includes("verification_notes")) aliased.verification_notes = aliased.notes;
  if (!aliased.assigned_officer_id && aliased.officer && allowed.includes("assigned_officer_id")) aliased.assigned_officer_id = aliased.officer;
  if (!aliased.moderated_by && aliased.admin_id && allowed.includes("moderated_by")) aliased.moderated_by = aliased.admin_id;
  if (typeof aliased.status === "string" && allowed.includes("is_active")) {
    aliased.is_active = aliased.status.toLowerCase() === "inactive" ? 0 : 1;
  }

  const source = mode === "insert" ? { ...config.defaults, ...aliased } : aliased;
  const entries = Object.entries(source)
    .filter(([key, value]) => allowed.includes(key) && value !== undefined && value !== "")
    .map(([key, value]) => {
      if (typeof value === "boolean") return [key, value ? 1 : 0];
      if (value && typeof value === "object" && !(value instanceof Date)) {
        return [key, JSON.stringify(value)];
      }
      return [key, value];
    });
  return Object.fromEntries(entries);
}

// Collection reads used to be unbounded `SELECT ... ORDER BY` with no ceiling —
// every row of every table, every request. Two things changed:
//
//   * callers may now ask for a window (?limit=&offset=) and get a total back, so
//     a table can grow past what a phone or a browser can hold; and
//   * a request that asks for no window still gets a hard cap, so no single query
//     can pull an unbounded result set. The cap is well above today's largest
//     table (geo_upazilas, 494 rows), so no existing screen silently truncates —
//     and when it is ever hit the response says so rather than quietly lying.
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 500;
export const UNPAGED_LIST_CAP = 1000;

export type ListPage = { limit: number; offset: number };

export type ListResult = {
  rows: Record<string, unknown>[];
  total: number | null;
  limit: number;
  offset: number;
  truncated: boolean;
};

// Read a page window off a query string. Returns null when the caller asked for
// no window at all, which selects the capped-but-unpaged path.
export function parseListPage(params: URLSearchParams): ListPage | null {
  const rawLimit = params.get("limit");
  const rawOffset = params.get("offset");
  const rawPage = params.get("page");
  if (rawLimit === null && rawOffset === null && rawPage === null) return null;

  const parsedLimit = Number.parseInt(rawLimit ?? "", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, MAX_LIST_LIMIT)
    : DEFAULT_LIST_LIMIT;

  const parsedOffset = Number.parseInt(rawOffset ?? "", 10);
  if (Number.isFinite(parsedOffset) && parsedOffset >= 0) {
    return { limit, offset: parsedOffset };
  }

  const parsedPage = Number.parseInt(rawPage ?? "", 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 1 ? parsedPage : 1;
  return { limit, offset: (page - 1) * limit };
}

export async function listResource(resource: string, page: ListPage | null = null) {
  const result = await listResourcePage(resource, page);
  return result ? result.rows : null;
}

export async function listResourcePage(resource: string, page: ListPage | null = null): Promise<ListResult | null> {
  const config = configs[resource];
  if (!config) return null;

  // limit/offset are integers parsed above, never caller text, so they are
  // interpolated rather than bound — MySQL will not accept a placeholder for
  // LIMIT through this driver's text protocol.
  if (!page) {
    const rows = await queryRows<Record<string, unknown>>(`${config.listSql} LIMIT ${UNPAGED_LIST_CAP}`);
    return {
      rows,
      total: null,
      limit: UNPAGED_LIST_CAP,
      offset: 0,
      truncated: rows.length === UNPAGED_LIST_CAP
    };
  }

  const limit = Math.min(Math.max(1, Math.trunc(page.limit)), MAX_LIST_LIMIT);
  const offset = Math.max(0, Math.trunc(page.offset));
  const rows = await queryRows<Record<string, unknown>>(
    `${config.listSql} LIMIT ${limit} OFFSET ${offset}`
  );
  const totalRows = await queryRows<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (${config.listSql}) AS counted`
  );
  const total = Number(totalRows[0]?.n ?? 0);
  return { rows, total, limit, offset, truncated: offset + rows.length < total };
}

export async function getResourceRow(resource: string, id: string) {
  if (resource === "sale/listings") {
    return getSaleListingDetail(id);
  }

  const config = configs[resource];
  if (!config) return null;
  const idColumn = config.idColumn ?? "id";
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT * FROM ${config.table} WHERE \`${idColumn}\` = ? LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getResourceRelated(resource: string, id: string) {
  if (resource === "buy/orders" || resource === "orders/payments") {
    return {
      order_items: await queryRows<Record<string, unknown>>(
        `
          SELECT oi.*, p.sku, p.name_en AS product_name
          FROM order_items oi
          JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = ?
        `,
        [id]
      )
    };
  }

  if (resource === "partners/applications") {
    return {
      project_ledgers: await queryRows<Record<string, unknown>>(
        "SELECT * FROM project_ledgers WHERE partner_application_id = ? ORDER BY entry_date DESC",
        [id]
      )
    };
  }

  if (resource === "community/posts" || resource === "community/reports") {
    return {
      comments: await queryRows<Record<string, unknown>>(
        "SELECT * FROM community_comments WHERE community_post_id = ? ORDER BY created_at DESC",
        [id]
      )
    };
  }

  if (resource === "learning/modules") {
    return {
      contents: await queryRows<Record<string, unknown>>(
        "SELECT * FROM learning_contents WHERE learning_module_id = ? ORDER BY sort_order, id",
        [id]
      )
    };
  }

  if (resource === "sale/listings") {
    return {
      pricing_rules: await queryRows<Record<string, unknown>>(
        `
          SELECT r.*
          FROM sale_pricing_rules r
          JOIN sale_listings l ON l.sale_item_id = r.sale_item_id
          WHERE l.id = ?
          ORDER BY r.effective_from DESC
        `,
        [id]
      )
    };
  }

  return {};
}

// Most resources are a single autocommitted statement. A resource carrying an
// afterWrite guard needs the write and the check on one connection so the check
// can veto: same SQL either way, different execution context.
async function runWrite(
  config: ResourceConfig,
  sql: string,
  values: unknown[]
): Promise<ResultSetHeader> {
  if (!config.afterWrite) return executeQuery(sql, values);
  const guard = config.afterWrite;
  return withTransaction(async (tx) => {
    const result = await tx.execute(sql, values);
    await guard(tx);
    return result;
  });
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
  const result = await runWrite(
    config,
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
  const result = await runWrite(
    config,
    `UPDATE ${config.table} SET ${assignments} WHERE \`${idColumn}\` = ?`,
    [...Object.values(data), id]
  );
  return { affectedRows: result.affectedRows, changedRows: (result as ResultSetHeader).changedRows };
}

export async function deleteResource(resource: string, id: string) {
  const config = configs[resource];
  if (!config) return null;
  const idColumn = config.idColumn ?? "id";
  const result = await runWrite(config, `DELETE FROM ${config.table} WHERE \`${idColumn}\` = ?`, [id]);
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
        a.name_en AS animal_name,
        b.name_en AS breed_name
      FROM sale_listings l
      JOIN app_users u ON u.id = l.user_id
      JOIN sale_items si ON si.id = l.sale_item_id
      JOIN sale_categories sc ON sc.id = si.sale_category_id
      LEFT JOIN animals a ON a.id = l.animal_id
      LEFT JOIN animal_breeds b ON b.id = l.breed_id
      WHERE l.id = ?
      LIMIT 1
    `,
    [id]
  );
  return rows[0] ?? null;
}
