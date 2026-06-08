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

// POST /api/v1/app/ai/cattle-analyze
// Stub AI estimate so the List Cattle screen's prefill is wired. Swap with a real model later.
export function cattleAnalyzeStub() {
  return {
    breed: "Cross Friesian",
    animal_type: "Bull",
    condition: "healthy",
    estimated_age_months: 26,
    estimated_weight_kg: 210,
    confidence: 0.88,
    field_verification: "pending",
    note: "AI estimate. Field officer will verify weight with a portable scale."
  };
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
             description_en, description_bn,
             IF(is_active = 1, 'active', 'soon') AS status
      FROM sale_categories
      ORDER BY sort_order, id
    `
  );
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

export async function getAppBreeds() {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, animal_type, name_en, name_bn, is_active
      FROM animal_breeds
      WHERE is_active = 1
      ORDER BY animal_type, id
    `
  );
}

export async function getAppPricing() {
  return queryRows<Row>(
    `
      SELECT CAST(r.id AS CHAR) AS id, CAST(r.sale_item_id AS CHAR) AS sale_item_id,
             si.slug AS item_slug, si.name_en AS item_name,
             r.district, r.b2b_market_rate, r.farmer_rate,
             r.platform_fee, r.logistics_fee, r.warehouse_vet_fee, r.unit
      FROM sale_pricing_rules r
      JOIN sale_items si ON si.id = r.sale_item_id
      WHERE r.is_active = 1
      ORDER BY r.effective_from DESC, r.id DESC
    `
  );
}

export async function getAppBuyCategories() {
  return queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, slug, name_en, name_bn,
             description_en, description_bn
      FROM buy_categories
      WHERE is_active = 1
      ORDER BY sort_order, id
    `
  );
}

export async function getAppProducts(category?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, p.sku, p.name_en, p.name_bn,
             p.short_description_en, p.short_description_bn,
             p.package_size, p.unit, p.price, p.stock_qty, p.low_stock_threshold,
             p.delivery_window, p.status, p.metadata, c.slug AS category_slug
      FROM products p
      JOIN buy_categories c ON c.id = p.buy_category_id
      WHERE (? IS NULL OR c.slug = ?)
      ORDER BY p.updated_at DESC, p.id DESC
    `,
    [category ?? null, category ?? null]
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
             district, upazila, status, capacity, lender_name,
             max_credit_amount, start_date, end_date, steps_json
      FROM partner_projects
      ORDER BY created_at DESC, id DESC
    `
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

export async function getAppCommunityPosts(scope?: string | null) {
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, u.full_name AS farmer_name,
             p.post_type, p.body, p.image_url, p.is_official, p.like_count, p.comment_count,
             p.district, p.upazila, p.scope, p.status, p.created_at
      FROM community_posts p
      JOIN app_users u ON u.id = p.user_id
      WHERE p.status = 'visible' AND (? IS NULL OR p.scope = ?)
      ORDER BY p.is_official DESC, p.created_at DESC
      LIMIT 50
    `,
    [scope && scope !== "all" ? scope : null, scope && scope !== "all" ? scope : null]
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
async function buildAppUser(user: Row) {
  const profile = typeof user.profile_json === "string" ? safeJson(user.profile_json) : (user.profile_json as Row | null);
  const roles = await getUserRoles(user.id as number);
  return {
    id: String(user.id),
    full_name: user.full_name ?? null,
    display_name: user.display_name ?? null,
    phone: user.phone ?? null,
    gender: user.gender ?? null,
    date_of_birth: user.date_of_birth ?? null,
    district: user.district ?? null,
    upazila: user.upazila ?? null,
    profile_image_url: user.profile_image_url ?? null,
    status: user.status ?? "active",
    roles,
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
    "SELECT id, full_name, display_name, phone, gender, date_of_birth, district, upazila, profile_image_url, status, personal_info_completed, profile_json FROM app_users WHERE phone = ? LIMIT 1",
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
      "SELECT id, full_name, display_name, phone, gender, date_of_birth, district, upazila, profile_image_url, status, personal_info_completed, profile_json FROM app_users WHERE id = ? LIMIT 1",
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
           personal_info_completed = 1
     WHERE id = ?`,
    [
      fullName,
      (payload.display_name ?? "").toString(),
      fullName,
      gender,
      (payload.date_of_birth ?? null) as string | null,
      (payload.profile_image_url ?? "").toString(),
      userId
    ]
  );

  const rows = await queryRows<Row>(
    "SELECT id, full_name, display_name, phone, gender, date_of_birth, district, upazila, profile_image_url, status, personal_info_completed, profile_json FROM app_users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (rows.length === 0) throw new Error("User not found.");
  return { user: await buildAppUser(rows[0]) };
}

// GET /api/v1/app/me?user_id=  -> current user with roles + onboarding gates.
export async function getAppMe(userId?: string | null) {
  if (!userId) throw new Error("user_id is required.");
  const rows = await queryRows<Row>(
    "SELECT id, full_name, display_name, phone, gender, date_of_birth, district, upazila, profile_image_url, status, personal_info_completed, profile_json FROM app_users WHERE id = ? LIMIT 1",
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
