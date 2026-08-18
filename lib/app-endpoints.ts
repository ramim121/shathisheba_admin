import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import { generateToken } from "@/lib/auth";
import { isSmsDevMode, sendSms } from "@/lib/sms";
import { RateLimitError } from "@/lib/errors";
import { recordAudit } from "@/lib/audit";

// Composite, app-facing read/write helpers used by the mobile app.
// These sit on top of the generic CRUD resources and shape responses
// the way each app screen consumes them.
//
// The bulk of this file now lives in ./endpoints/*, split by domain. This
// module keeps the cross-domain flows (home feed, orders, listings, admin
// stats) and re-exports the rest, so `@/lib/app-endpoints` remains the single
// import surface for the API route.
export * from "./endpoints/shared";
export * from "./endpoints/reference";
export * from "./endpoints/auth";
export * from "./endpoints/profile";
export * from "./endpoints/community";
export * from "./endpoints/learning";
export * from "./endpoints/approvals";
export * from "./endpoints/finance";
export * from "./endpoints/admin-loan";
export { getQuestionnaireIntegrity } from "./finance/questionnaire-guard";
export { getScorecardIntegrity } from "./finance/scorecard-guard";
export * from "./endpoints/credit-assessment";
export * from "./endpoints/finance-result";
export * from "./endpoints/loan-workspace";
export * from "./endpoints/loan-servicing";
export * from "./endpoints/mpoweru";
export * from "./endpoints/lender-pack";
export * from "./endpoints/finance-notifications";
export * from "./endpoints/admin-maintenance";

import { getUserRoles, safeJson, type Row } from "./endpoints/shared";
import { buildAppUser, buildKycSummary } from "./endpoints/auth";


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

  // Header and line items are one unit of work: a half-created order (header with
  // no items, or some items missing) is unfulfillable and there is no repair path
  // for the customer, so it must never reach the database.
  const orderId = await withTransaction(async (tx) => {
    const orderResult = await tx.execute(
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

    const newOrderId = orderResult.insertId;
    for (const item of items) {
      const qty = Number(item.quantity ?? 0);
      const price = Number(item.unit_price ?? 0);
      await tx.execute(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)",
        [newOrderId, item.product_id, qty, price, qty * price]
      );
    }
    return newOrderId;
  });

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

  // A project withdrawn from the market keeps serving the farmers already in
  // it but takes no new applications. Enforced here rather than only in the
  // app, because the app's copy of `is_active` can be a cached page old.
  const projectRows = await queryRows<Row>(
    "SELECT is_active, status, name_en FROM partner_projects WHERE id = ? LIMIT 1",
    [projectId]
  );
  const project = projectRows[0];
  if (!project) throw new Error("That project no longer exists.");
  if (Number(project.is_active ?? 0) !== 1 || String(project.status) !== "open") {
    throw new Error("This project is not accepting new applications.");
  }

  // One live application per farmer per project — a second submission is a
  // double tap, not a second enrolment.
  const existing = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, application_code FROM partner_applications
      WHERE user_id = ? AND partner_project_id = ? AND status <> 'rejected'
      ORDER BY id DESC LIMIT 1`,
    [userId, projectId]
  );
  if (existing[0]) {
    return {
      application_id: Number(existing[0].id),
      application_code: String(existing[0].application_code),
      status: "existing"
    };
  }

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

  // A confirmed payment and a sold listing must land together — a payment marked
  // confirmed against a listing still showing as for-sale (or the reverse) is a
  // dispute between a field officer and a farmer with money already handed over.
  await withTransaction(async (tx) => {
    await tx.execute(
      "UPDATE payment_confirmations SET status = 'confirmed', confirmed_at = NOW() WHERE id = ?",
      [confirmation.id]
    );
    await tx.execute("UPDATE sale_listings SET status = 'sold' WHERE id = ?", [listingId]);
  });

  return { confirmation_id: confirmation.id, sale_listing_id: listingId, status: "confirmed" };
}

// ---------------------------------------------------------------------------
// App-facing list reads.
// The /api/v1 route is consumed by the mobile app (the admin panel reads
// lib/db-resources directly, server-side). These return RAW bilingual + detail
// columns the app's rowTitle/rowBody/localized helpers expect, instead of the
// admin-table display shapes in lib/db-resources.ts.
// ---------------------------------------------------------------------------

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
             income_amount, income_label_en, income_label_bn,
             model_en, model_bn, loan_partners_en, loan_partners_bn,
             capacity_label_en, capacity_label_bn, terms_json,
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
             p.income_amount, p.income_label_en, p.income_label_bn,
             p.model_en, p.model_bn, p.loan_partners_en, p.loan_partners_bn,
             p.capacity_label_en, p.capacity_label_bn, p.terms_json, p.is_active,
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
             p.income_amount, p.income_label_en, p.income_label_bn,
             p.model_en, p.model_bn, p.loan_partners_en, p.loan_partners_bn,
             p.capacity_label_en, p.capacity_label_bn, p.is_active,
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

// (Admin notification feature removed — the approvals to-do dashboard covers it.)

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
export async function getMyListings(userId?: string | null) {
  if (!userId) return [];
  return queryRows<Row>(
    `
      SELECT CAST(l.id AS CHAR) AS id, l.listing_code, l.title_en, l.title_bn,
             l.description, l.quantity, l.unit, l.weight_kg, l.meat_weight_kg,
             l.farmer_expected_price, l.estimated_earning,
             l.status, l.approved_at, l.created_at, l.media_json,
             -- Progress fields so the card can show the live stage without a
             -- second round trip per listing.
             l.field_visit_date, l.verified_weight_kg, l.paid_at, l.paid_amount,
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

// GET /api/v1/app/admin/stats -> live dashboard counters (replaces the old seed numbers).
export async function getAdminStats() {
  const rows = await queryRows<Row>(
    `SELECT
       (SELECT COUNT(*) FROM app_users) AS farmers,
       (SELECT COUNT(*) FROM app_users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS farmers_30d,
       (SELECT COUNT(*) FROM sale_listings WHERE status = 'active') AS listings_active,
       (SELECT COUNT(*) FROM sale_listings) AS listings_total,
       (SELECT COUNT(*) FROM orders) AS orders_total,
       (SELECT COUNT(*) FROM orders WHERE fulfillment_status = 'delivered') AS orders_delivered,
       (SELECT COUNT(*) FROM products WHERE status = 'active') AS products_active`
  );
  return rows[0] ?? {};
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
