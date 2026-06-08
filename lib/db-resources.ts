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

function simpleConfig(table: string, allowedFields: string[], defaults: Record<string, unknown> = {}): ResourceConfig {
  return {
    table,
    listSql: `SELECT CAST(id AS CHAR) AS id, ${allowedFields.map((field) => `\`${field}\``).join(", ")} FROM ${table} ORDER BY id DESC`,
    allowedInsert: allowedFields,
    allowedUpdate: allowedFields,
    defaults
  };
}

const configs: Record<string, ResourceConfig> = {
  "admin/users": simpleConfig(
    "admin_users",
    ["name", "email", "phone", "password_hash", "role", "district", "upazila", "is_active", "last_login_at"],
    { name: "New admin", email: `admin-${Date.now()}@shathisheba.local`, password_hash: "change-me", role: "hq_admin", is_active: 1 }
  ),
  "media/assets": simpleConfig(
    "media_assets",
    ["owner_type", "owner_id", "asset_type", "title", "alt_text", "url", "mime_type", "size_bytes", "metadata", "uploaded_by"],
    { owner_type: "system", asset_type: "image", url: "https://example.com/asset.jpg" }
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
    ["slug", "name_en", "name_bn", "emoji", "description_en", "description_bn", "interest_slug", "sort_order", "is_active"],
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
  "notifications/campaigns": simpleConfig(
    "notification_campaigns",
    ["title_en", "title_bn", "body_en", "body_bn", "target_json", "campaign_type", "status", "scheduled_at", "sent_at", "created_by"],
    { title_en: "New notification", body_en: "Notification body", target_json: "{}", campaign_type: "custom", status: "draft" }
  ),
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

function normalizePayload(payload: Record<string, unknown>, config: ResourceConfig, mode: "insert" | "update") {
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

export async function listResource(resource: string) {
  const config = configs[resource];
  if (!config) return null;
  return queryRows<Record<string, unknown>>(config.listSql);
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
