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
export * from "./endpoints/apa";
export * from "./endpoints/apa-console";
export * from "./endpoints/app-ai";

import { getUserRoles, safeJson, type Row } from "./endpoints/shared";
import { buildAppUser, buildKycSummary } from "./endpoints/auth";
import { getBoolSetting } from "@/lib/settings";
import { GeoLockedError, LocationRequiredError, geoFilter, geoRowVisible, getGeoScope, getUserGeo, weatherGeo } from "@/lib/geo-scope";
import { resolveGeoIds, toGeoId, type GeoIds, type GeoResolved } from "@/lib/geo";
import { assertAreaCovered, assertOperational, getAreaStatus } from "@/lib/operational";
import { PromoError, evaluatePromotions, getOrderPromotion, recordOrderPromotion } from "@/lib/promotions";
import { deliversTo, getDistributorById, pickDistributor, productDistributors, type Distributor } from "@/lib/distribution";
import { recordOrderEvent } from "@/lib/order-events";
import { notifyEnrollment, notifyOrder } from "@/lib/notices";


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
        -- The icon has always been an id into media_assets; nothing resolved it,
        -- so every category reached the app with an emoji and no artwork.
        (SELECT url FROM media_assets a WHERE a.id = interest_categories.icon_asset_id) AS icon_url,
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
export async function getHomeFeed(userId?: string | null, gpsDistrictId?: string | null, gpsUpazilaId?: string | null) {
  const userRows = userId
    ? await queryRows<Row>("SELECT id, full_name, display_name, district, upazila FROM app_users WHERE id = ? LIMIT 1", [userId])
    : [];
  const user = userRows[0] ?? null;

  // There used to be a hard-coded "Mymensingh" fallback here, so a farmer with
  // no district on file was shown Mymensingh's weather as if it were theirs.
  const wxGeo = await weatherGeo(userId, gpsDistrictId, gpsUpazilaId);
  const wx = await geoFilter("weather_alerts", "w", wxGeo);
  const weatherRows = await queryRows<Row>(
    `
      SELECT
        w.district, w.upazila, w.alert_type, w.severity, w.title_en, w.title_bn,
        w.body_en, w.body_bn, w.weather_payload
      FROM weather_alerts w
      WHERE w.is_active = 1 AND ${wx.sql}
      ORDER BY (w.upazila_id <=> ?) DESC, (w.district_id <=> ?) DESC, w.starts_at DESC
      LIMIT 1
    `,
    [...wx.params, wxGeo.upazila_id, wxGeo.district_id]
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
          (SELECT COALESCE(SUM(estimated_earning), 0) FROM sale_listings WHERE user_id = ? AND status IN ('contracted','shipped','paid')) AS earning
      `,
      [userId, userId, userId]
    );
    listingCount = Number(stats[0]?.listings ?? 0);
    orderCount = Number(stats[0]?.orders ?? 0);
    earning = Number(stats[0]?.earning ?? 0);
  }

  const userGeo = await getUserGeo(userId);
  const mk = await geoFilter("market_updates", "m", userGeo);
  const marketUpdates = await queryRows<Row>(
    `
      SELECT CAST(m.id AS CHAR) AS id, m.title_en, m.title_bn, m.body_en, m.update_type, m.status
      FROM market_updates m
      WHERE m.status = 'active' AND ${mk.sql}
      ORDER BY (m.district_id <=> ?) DESC, m.sort_order, m.created_at DESC
      LIMIT 6
    `,
    [...mk.params, userGeo.district_id]
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
      district: (user?.district as string) ?? null,
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

const round2 = (n: number) => Math.round(n * 100) / 100;

type OrderLine = { product_id: number; name_en: string; quantity: number; unit_price: number; line_total: number };

type OrderContext = {
  lines: OrderLine[];
  /** Who fulfils it; null when the manufacturer ships directly (anywhere). */
  distributor: Distributor | null;
  delivery: GeoResolved;
};

// Everything an order depends on, worked out the same way for the quote and
// for placement:
//  - prices come from the catalogue, never from the request (the app sending
//    unit_price used to be what the order was charged at);
//  - the distributor is the one serving the buyer's own area;
//  - the delivery address must lie inside that distributor's area. An
//    upazila-level distributor fixes it outright; a district- or
//    division-level one lets the buyer choose within it.
async function buildOrder(userId: unknown, input: Row, items: Row[]): Promise<OrderContext> {
  const ids = items.map((i) => Number(i.product_id)).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) throw new Error("Choose a product to order.");
  const [rows, buyerGeo, links] = await Promise.all([
    queryRows<Row>(`SELECT id, name_en, price, status FROM products WHERE id IN (${ids.map(() => "?").join(",")})`, ids),
    getUserGeo(userId),
    productDistributors(ids)
  ]);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const lines: OrderLine[] = [];
  let distributor: Distributor | null = null;
  for (const item of items) {
    const p = byId.get(Number(item.product_id));
    if (!p || p.status !== "active") throw new Error(`${p?.name_en ?? "That product"} is not available right now.`);
    const pick = pickDistributor(links.get(Number(p.id)), buyerGeo);
    if (!pick.available) throw new GeoLockedError(`${p.name_en} is not sold in your area.`);
    if (pick.distributor) {
      if (distributor && distributor.id !== pick.distributor.id) {
        throw new Error("These products come from different distributors — please order them separately.");
      }
      distributor = pick.distributor;
    }
    const quantity = Number(item.quantity ?? 0);
    if (!(quantity > 0)) throw new Error("Quantity must be at least 1.");
    const unit = Number(p.price ?? 0);
    lines.push({ product_id: Number(p.id), name_en: String(p.name_en), quantity, unit_price: unit, line_total: round2(quantity * unit) });
  }

  const picked = ["delivery_division_id", "delivery_district_id", "delivery_upazila_id"].some((k) => toGeoId(input[k]));
  let delivery = picked
    ? await resolveGeoIds({ division_id: input.delivery_division_id, district_id: input.delivery_district_id, upazila_id: input.delivery_upazila_id })
    : await resolveGeoIds(buyerGeo);
  if (distributor) {
    if (distributor.lock === "upazila") {
      delivery = await resolveGeoIds({ upazila_id: distributor.upazila_id });
    } else if (!deliversTo(distributor, delivery)) {
      throw new GeoLockedError(`${distributor.short_name_en ?? distributor.name_en} delivers only within ${distributor.area_en}.`);
    }
  }
  if (!delivery.upazila_id) throw new LocationRequiredError("Choose the delivery upazila.");
  return { lines, distributor, delivery };
}

function publicDistributor(d: Distributor | null) {
  if (!d) return null;
  return {
    id: String(d.id), name_en: d.name_en, name_bn: d.name_bn, short_name_en: d.short_name_en, short_name_bn: d.short_name_bn,
    logo_url: d.logo_url, phone: d.phone, address_en: d.address_en, address_bn: d.address_bn,
    lock: d.lock, area_en: d.area_en, area_bn: d.area_bn,
    division_id: d.division_id, district_id: d.district_id, upazila_id: d.upazila_id,
    division: d.division, district: d.district, upazila: d.upazila,
    division_bn: d.division_bn, district_bn: d.district_bn, upazila_bn: d.upazila_bn
  };
}

// GET /api/v1/app/orders/quote?product_id=&quantity=&code=&division_id=&district_id=&upazila_id=
// Everything the order screens show before the buyer commits: subtotal, the
// discount that will apply and why, who delivers, how far the address is
// locked, and whether it is deliverable. Problems are reported, not thrown —
// the screen explains them.
export async function getOrderQuote(q: URLSearchParams) {
  const userId = q.get("user_id");
  const productId = q.get("product_id");
  const quantity = Number(q.get("quantity") ?? 1) || 1;
  let ctx: OrderContext | null = null;
  let deliveryError: string | null = null;
  let deliveryCode: string | null = null;
  try {
    ctx = await buildOrder(userId, {
      delivery_division_id: q.get("division_id"),
      delivery_district_id: q.get("district_id"),
      delivery_upazila_id: q.get("upazila_id")
    }, [{ product_id: productId, quantity }]);
    const area = await getAreaStatus("orders", ctx.delivery);
    if (area.state === "zone_inactive") {
      deliveryError = "Shathi Sheba does not deliver to that area yet. Choose an address inside an active zone.";
      deliveryCode = "zone_inactive";
    }
  } catch (error) {
    deliveryError = error instanceof Error ? error.message : "That address cannot be used.";
    deliveryCode = (error as { code?: string }).code ?? "invalid_request";
  }
  // A failed address check still prices the product, so the total shows
  // while the problem is explained.
  let subtotal = ctx ? round2(ctx.lines.reduce((s, l) => s + l.line_total, 0)) : 0;
  if (!ctx && productId) {
    const [p] = await queryRows<Row>("SELECT price FROM products WHERE id = ? LIMIT 1", [productId]);
    subtotal = round2(Number(p?.price ?? 0) * quantity);
  }
  const promo = await evaluatePromotions({ userId, subtotal, code: q.get("code"), geo: ctx?.delivery ?? (await getUserGeo(userId)) });
  const discount = promo.applied?.discount ?? 0;
  const d = ctx?.delivery ?? null;
  return {
    subtotal,
    delivery_fee: 0,
    discount,
    payable: round2(subtotal - discount),
    promotion: promo.applied,
    first_purchase: promo.first_purchase,
    is_first_purchase: promo.is_first_purchase,
    code_status: promo.code_status,
    code_error: promo.code_error,
    deliverable: !deliveryError,
    delivery_error: deliveryError,
    delivery_error_code: deliveryCode,
    distributor: publicDistributor(ctx?.distributor ?? null),
    delivery_lock: ctx?.distributor?.lock ?? "none",
    delivery: d
      ? {
          division_id: d.division_id, district_id: d.district_id, upazila_id: d.upazila_id,
          division: d.division, district: d.district, upazila: d.upazila,
          division_bn: d.division_bn, district_bn: d.district_bn, upazila_bn: d.upazila_bn
        }
      : null
  };
}

// POST /api/v1/app/orders
// Composite order placement: orders + order_items + the discount, in one call.
export async function placeOrder(payload: Row) {
  const userId = payload.user_id;
  const items = Array.isArray(payload.items) ? (payload.items as Row[]) : [];
  if (!userId || items.length === 0) {
    throw new Error("user_id and at least one item are required.");
  }
  // The buyer's profile must be complete and inside a zone, and so must the
  // address the order is going to.
  await assertOperational(userId, "orders");
  const ctx = await buildOrder(userId, payload, items);
  const { lines, delivery, distributor } = ctx;
  await assertAreaCovered("orders", delivery);

  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));
  const deliveryFee = Math.max(0, Number(payload.delivery_fee ?? 0) || 0);
  const code = typeof payload.promo_code === "string" ? payload.promo_code : null;
  const orderCode = `ORD-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;

  // Header, line items, the discount and the first timeline entry are one unit
  // of work: a half-created order is unfulfillable and there is no repair path
  // for the customer. The buyer's row is locked so two orders placed at once
  // cannot both take the first-purchase discount.
  const placed = await withTransaction(async (tx) => {
    await tx.query("SELECT id FROM app_users WHERE id = ? FOR UPDATE", [userId]);
    const promo = await evaluatePromotions({ userId, subtotal, code, geo: delivery }, tx);
    // A code the buyer typed that cannot be used stops the order — they were
    // shown a total with it. A code merely outranked by a better automatic
    // discount does not.
    if (code && promo.code_status === "invalid") throw new PromoError(promo.code_error ?? "That promo code cannot be used.");
    const discount = promo.applied?.discount ?? 0;
    const payable = round2(subtotal + deliveryFee - discount);

    const orderResult = await tx.execute(
      `
        INSERT INTO orders
          (order_code, user_id, distributor_id, total_amount, delivery_fee, discount_amount, payable_amount, payment_method, payment_status, fulfillment_status, delivery_address, district, upazila, division_id, district_id, upazila_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'placed', ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orderCode,
        userId,
        distributor?.id ?? null,
        subtotal,
        deliveryFee,
        discount,
        payable,
        payload.payment_method ?? "cash",
        payload.delivery_address ?? "Address",
        delivery.district,
        delivery.upazila,
        delivery.division_id,
        delivery.district_id,
        delivery.upazila_id,
        payload.notes ?? null
      ]
    );

    const newOrderId = orderResult.insertId;
    for (const line of lines) {
      await tx.execute(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)",
        [newOrderId, line.product_id, line.quantity, line.unit_price, line.line_total]
      );
    }
    if (promo.applied) await recordOrderPromotion(tx, newOrderId, userId, subtotal, promo.applied);
    await recordOrderEvent(newOrderId, "placed", { tx, note: "Order placed" });
    return { orderId: newOrderId, discount, payable, promotion: promo.applied };
  });

  await notifyOrder(placed.orderId, "order_placed");

  return {
    order_id: placed.orderId,
    order_code: orderCode,
    total_amount: subtotal,
    delivery_fee: deliveryFee,
    discount_amount: placed.discount,
    payable_amount: placed.payable,
    promotion: placed.promotion,
    distributor: publicDistributor(distributor),
    delivery: { division: delivery.division, district: delivery.district, upazila: delivery.upazila, division_bn: delivery.division_bn, district_bn: delivery.district_bn, upazila_bn: delivery.upazila_bn },
    estimated_delivery: "1-3 working days"
  };
}

// GET /api/v1/app/orders/detail?order_id=
// One order as the buyer sees it: items, delivery, payment summary, discount,
// who delivers, and the timeline.
export async function getAppOrderDetail(orderId?: string | null, userId?: string | null) {
  if (!orderId || !userId) return null;
  const [o] = await queryRows<Row>(
    `SELECT CAST(o.id AS CHAR) AS id, o.order_code, o.total_amount, o.delivery_fee, o.discount_amount, o.payable_amount,
            o.payment_method, o.payment_status, o.fulfillment_status, o.delivery_address, o.created_at, o.updated_at,
            o.upazila, o.district, gv.name_en AS division, gu.name_bn AS upazila_bn, gd.name_bn AS district_bn, gv.name_bn AS division_bn,
            CAST(o.distributor_id AS CHAR) AS distributor_id
       FROM orders o
       LEFT JOIN geo_upazilas gu ON gu.id = o.upazila_id
       LEFT JOIN geo_districts gd ON gd.id = o.district_id
       LEFT JOIN geo_divisions gv ON gv.id = o.division_id
      WHERE o.id = ? AND o.user_id = ?
      LIMIT 1`,
    [orderId, userId]
  );
  if (!o) return null;
  const [items, events, promotion, distributor] = await Promise.all([
    queryRows<Row>(
      `SELECT CAST(oi.product_id AS CHAR) AS product_id, oi.quantity, oi.unit_price, oi.line_total,
              p.name_en, p.name_bn, p.unit, p.package_size, p.package_size_bn,
              JSON_UNQUOTE(JSON_EXTRACT(p.metadata, '$.image_url')) AS image_url,
              CAST(m.id AS CHAR) AS manufacturer_id, COALESCE(m.short_name_en, m.name_en) AS manufacturer_name,
              COALESCE(m.short_name_bn, m.name_bn) AS manufacturer_name_bn
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
        WHERE oi.order_id = ?`,
      [orderId]
    ),
    queryRows<Row>("SELECT kind, status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id", [orderId]),
    getOrderPromotion(orderId),
    getDistributorById(o.distributor_id)
  ]);

  const status = String(o.fulfillment_status);
  const cancelled = status === "cancelled";
  const at = (...statuses: string[]) =>
    (events.filter((e) => e.kind === "fulfillment" && statuses.includes(String(e.status))).pop()?.created_at as string | undefined) ?? null;
  // The step the order is standing on; delivered means every step is done.
  const current = { placed: 1, confirmed: 2, assigned: 3, in_transit: 3, delivered: 4 }[status] ?? 1;
  const who = distributor ? distributor.short_name_en ?? distributor.name_en : null;
  const whoBn = distributor ? distributor.short_name_bn ?? distributor.name_bn ?? who : null;
  const defs = [
    { key: "placed", title_en: "Order placed", title_bn: "অর্ডার দেওয়া হয়েছে", desc_en: "We received your order", desc_bn: "আপনার অর্ডার পেয়েছি", date: at("placed") ?? o.created_at },
    { key: "confirmed", title_en: "Confirmed", title_bn: "নিশ্চিত হয়েছে", desc_en: "Stock checked and approved", desc_bn: "মজুদ যাচাই করে অনুমোদিত", date: at("confirmed") },
    { key: "on_the_way", title_en: "On the way", title_bn: "পথে আছে", desc_en: who ? `Dispatched by ${who}` : "Dispatched to you", desc_bn: whoBn ? `${whoBn} পাঠিয়েছে` : "আপনার কাছে পাঠানো হয়েছে", date: at("assigned", "in_transit") },
    { key: "delivered", title_en: "Delivered", title_bn: "ডেলিভারি সম্পন্ন", desc_en: "Handed over to you", desc_bn: "আপনার হাতে পৌঁছেছে", date: at("delivered") }
  ];
  const steps = defs.map((s, i) => ({
    ...s,
    index: i + 1,
    note: null,
    state: cancelled ? (i === 0 ? "done" : "upcoming") : i < current ? "done" : i === current ? "current" : "upcoming"
  }));
  return {
    order: o,
    items,
    promotion,
    distributor: publicDistributor(distributor),
    steps,
    cancelled,
    cancelled_at: cancelled ? at("cancelled") : null,
    payments: events.filter((e) => e.kind === "payment")
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
    `SELECT is_active, status, name_en, region_based, division_id, district_id, upazila_id
       FROM partner_projects WHERE id = ? LIMIT 1`,
    [projectId]
  );
  const project = projectRows[0];
  if (!project) throw new Error("That project no longer exists.");
  if (Number(project.is_active ?? 0) !== 1 || String(project.status) !== "open") {
    throw new Error("This project is not accepting new applications.");
  }
  // Joining a project needs field coverage where the farmer is.
  await assertOperational(userId, "partner_projects");
  // The project list already hides out-of-area projects; this is the check that
  // holds when someone calls the API directly.
  if (Number(project.region_based ?? 1) === 1) {
    const scope = await getGeoScope("partner_projects");
    if (!geoRowVisible(scope, project as Partial<GeoIds>, await getUserGeo(userId))) {
      throw new GeoLockedError("This project is only open to farmers in its area.");
    }
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
  await notifyEnrollment(result.insertId, "enrollment_submitted");
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
    await tx.execute("UPDATE sale_listings SET status = 'paid', paid_at = COALESCE(paid_at, NOW()) WHERE id = ?", [listingId]);
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
             investment_amount, duration_label, duration_label_bn, region_based, is_active,
             income_amount, income_label_en, income_label_bn,
             model_en, model_bn, loan_partners_en, loan_partners_bn, loan_partner_logos,
             -- Bangla place names and the lenders' logos, as the area tab has.
             (SELECT name_bn FROM geo_upazilas WHERE id = p.upazila_id) AS upazila_bn,
             (SELECT name_bn FROM geo_districts WHERE id = p.district_id) AS district_bn,
             (SELECT name_bn FROM geo_divisions WHERE id = p.division_id) AS division_bn,
             capacity_label_en, capacity_label_bn, terms_json,
             platform_fee, logistics_fee, warehouse_vet_fee,
             status, capacity, lender_name, max_credit_amount,
             start_date, end_date, steps_json
      FROM partner_projects p
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

// GET /api/v1/app/projects/active?user_id=&division=&district=
// "Projects active in your area": active, non-expired projects that are either
// open to all (region_based=0) or match the user's division/district. Projects
// matching the user's interests are flagged (matches_interest) for the tag.
export async function getAppActiveProjects(userId?: string | null) {
  const geo = await getUserGeo(userId);
  const area = await geoFilter("partner_projects", "p", geo);
  const interests = await userRootInterestSlugs(userId);
  const interestList = interests.length ? interests : [""];
  const placeholders = interestList.map(() => "?").join(", ");
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, p.project_code, p.name_en, p.name_bn,
             p.interest_slug, p.division, p.district, p.upazila, p.image_url,
             CAST(p.division_id AS CHAR) AS division_id, CAST(p.district_id AS CHAR) AS district_id,
             CAST(p.upazila_id AS CHAR) AS upazila_id,
             p.summary_en, p.summary_bn, p.market_overview_en, p.market_overview_bn,
             p.investment_amount, p.duration_label, p.duration_label_bn, p.region_based, p.lender_name,
             p.income_amount, p.income_label_en, p.income_label_bn,
             p.model_en, p.model_bn, p.loan_partners_en, p.loan_partners_bn, p.loan_partner_logos, p.duration_label_bn,
             (SELECT name_bn FROM geo_upazilas WHERE id = p.upazila_id) AS upazila_bn,
             (SELECT name_bn FROM geo_districts WHERE id = p.district_id) AS district_bn,
             (SELECT name_bn FROM geo_divisions WHERE id = p.division_id) AS division_bn,
             p.capacity_label_en, p.capacity_label_bn, p.terms_json, p.is_active,
             p.max_credit_amount, p.capacity, p.status, p.start_date, p.end_date,
             (p.interest_slug IN (${placeholders})) AS matches_interest,
             (SELECT COUNT(*) FROM partner_applications a WHERE a.partner_project_id = p.id) AS enrolled
      FROM partner_projects p
      WHERE p.is_active = 1
        AND p.status IN ('open', 'opening_soon')
        AND (p.end_date IS NULL OR p.end_date >= CURDATE())
        -- National projects show everywhere. A region-based project must name
        -- an area (one with none used to match nobody silently) and contain the
        -- farmer at the configured level.
        AND (p.region_based = 0
             OR (COALESCE(p.upazila_id, p.district_id, p.division_id) IS NOT NULL AND ${area.sql}))
      ORDER BY matches_interest DESC, FIELD(p.status,'open','opening_soon'), p.start_date
    `,
    [...interestList, ...area.params]
  );
}

// GET /api/v1/app/projects/public
// The public project showcase, for the DigiGram marketing website.
//
// WHY A SEPARATE HANDLER RATHER THAN OPENING UP app/projects/active.
// `active` is a *personalised* read: it takes a user_id, resolves that farmer's
// geography and interests, and filters the list to their area. None of that
// means anything to an anonymous web visitor, and making user_id optional there
// would leave a personal-data endpoint reachable without a token — the exact
// class of bug SEC-01 was about.
//
// This returns the same rows with the personal dimension removed: no user, no
// region filter, no interest flag, and no `enrolled` count (how many farmers
// applied is an operating figure, not brochure copy). Every column below is
// already public-facing — it is what the app prints on the project card.
//
// Region-based projects are included but carry their district so the website
// can label them ("Natore, Rajshahi"); the site is a showcase, not an
// application path, so there is nobody to filter them for.
export async function getPublicProjects() {
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, p.project_code, p.name_en, p.name_bn,
             p.interest_slug, p.division, p.district, p.upazila, p.image_url,
             p.summary_en, p.summary_bn, p.market_overview_en, p.market_overview_bn,
             p.duration_label, p.duration_label_bn, p.lender_name,
             p.income_amount, p.income_label_en, p.income_label_bn,
             p.model_en, p.model_bn, p.loan_partners_en, p.loan_partners_bn,
             p.loan_partner_logos,
             (SELECT name_bn FROM geo_upazilas WHERE id = p.upazila_id) AS upazila_bn,
             (SELECT name_bn FROM geo_districts WHERE id = p.district_id) AS district_bn,
             (SELECT name_bn FROM geo_divisions WHERE id = p.division_id) AS division_bn,
             p.capacity_label_en, p.capacity_label_bn, p.capacity,
             p.status, p.start_date, p.end_date
      FROM partner_projects p
      WHERE p.is_active = 1
        AND p.status IN ('open', 'opening_soon')
        AND (p.end_date IS NULL OR p.end_date >= CURDATE())
      ORDER BY FIELD(p.status,'open','opening_soon'), p.start_date, p.id
    `
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
             p.summary_en, p.summary_bn, p.duration_label, p.duration_label_bn, p.investment_amount,
             p.income_amount, p.income_label_en, p.income_label_bn,
             p.model_en, p.model_bn, p.loan_partners_en, p.loan_partners_bn, p.loan_partner_logos, p.duration_label_bn,
             (SELECT name_bn FROM geo_upazilas WHERE id = p.upazila_id) AS upazila_bn,
             (SELECT name_bn FROM geo_districts WHERE id = p.district_id) AS district_bn,
             (SELECT name_bn FROM geo_divisions WHERE id = p.division_id) AS division_bn,
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
export async function getSaleCategoryAvailability(userId?: string | null) {
  const geo = await getUserGeo(userId);
  const [names] = await queryRows<Row>(
    "SELECT division, district, upazila FROM app_users WHERE id = ? LIMIT 1",
    [userId ?? null]
  );
  const region = { division: names?.division ?? null, district: names?.district ?? null, upazila: names?.upazila ?? null };

  // The project gate is a coverage decision, not a law. With it off, every
  // category the app has actually built is open everywhere — a farmer in an
  // uncovered upazila saw a screen of greyed-out tiles reading "no project in
  // your area", which is indistinguishable from a broken app. Which categories
  // are genuinely sellable is decided by sale_categories.is_active and by what
  // the app has screens for, not by this.
  const gated = await getBoolSetting("sale_require_project", false);

  if (!gated) {
    const categories = await queryRows<Row>(
      `SELECT COALESCE(interest_slug, slug) AS slug FROM sale_categories WHERE is_active = 1`
    );
    return { region, available: categories.map((r) => String(r.slug)), gated: false };
  }

  const area = await geoFilter("partner_projects", "p", geo);
  const rows = await queryRows<Row>(
    `
      SELECT DISTINCT p.interest_slug
      FROM partner_projects p
      WHERE p.is_active = 1
        AND p.status IN ('open', 'opening_soon')
        AND (p.end_date IS NULL OR p.end_date >= CURDATE())
        AND p.interest_slug IS NOT NULL
        AND (p.region_based = 0
             OR (COALESCE(p.upazila_id, p.district_id, p.division_id) IS NOT NULL AND ${area.sql}))
    `,
    area.params
  );
  const available = rows.map((r) => String(r.interest_slug));
  return { region, available, gated: true };
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

export async function getAppCommunityPosts(scope?: string | null, _district?: string | null, filter?: string | null, userId?: string | null) {
  const s = scope && scope !== "all" ? scope : null;
  const geo = await getUserGeo(userId);

  // "Sale listings" filter: active listings of the farmer's area. A listing
  // carries its seller's location (it inherits it at creation), and is shown
  // only to farmers inside it at the sale_listings scope — by id, so "Dhaka
  // District" and "Dhaka" are no longer two different places.
  if (filter === "listings") {
    const area = await geoFilter("sale_listings", "l", geo);
    return queryRows<Row>(
      `
        SELECT CONCAT('listing-', l.id) AS id, u.full_name AS farmer_name,
               'notice' AS post_type,
               CONCAT('🏷️ ', COALESCE(l.title_en, 'Marketplace item'), ' — ', l.quantity, ' ', l.unit,
                      COALESCE(CONCAT(' · ৳', FORMAT(l.farmer_expected_price, 0)), '')) AS body,
               JSON_UNQUOTE(JSON_EXTRACT(l.media_json, '$[0]')) AS image_url,
               0 AS is_official, 0 AS like_count, 0 AS comment_count,
               l.district, l.upazila, 'district' AS scope, 'visible' AS status, l.created_at,
               (SELECT name_bn FROM geo_districts WHERE id = l.district_id) AS district_bn,
               (SELECT name_bn FROM geo_upazilas WHERE id = l.upazila_id) AS upazila_bn,
               1 AS is_listing
        FROM sale_listings l
        JOIN app_users u ON u.id = l.user_id
        WHERE l.status NOT IN ('draft','cancelled','rejected') AND ${area.sql}
        ORDER BY l.created_at DESC
        LIMIT 50
      `,
      area.params
    );
  }

  const mine = filter === "mine" && userId ? userId : null;
  // "all" drops the regional restriction; the default regional feed shows
  // Bangladesh-wide posts plus posts inside the farmer's area.
  const regional = filter !== "all" && !mine;
  const area = await geoFilter("community_posts", "p", geo);
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, u.full_name AS farmer_name,
             p.post_type, p.body, p.image_url, p.is_official, p.like_count, p.comment_count,
             p.district, p.upazila, p.scope, p.status, p.created_at,
             (SELECT name_bn FROM geo_districts WHERE id = p.district_id) AS district_bn,
             (SELECT name_bn FROM geo_upazilas WHERE id = p.upazila_id) AS upazila_bn,
             (p.post_type = 'notice' AND p.body LIKE '🏷️%') AS is_listing
      FROM community_posts p
      JOIN app_users u ON u.id = p.user_id
      WHERE p.status = 'visible' AND (? IS NULL OR p.scope = ?)
        AND (? IS NULL OR p.user_id = ?)
        AND (${regional ? `(p.scope = 'bangladesh' OR ${area.sql})` : "1 = 1"})
      ORDER BY p.is_official DESC, p.created_at DESC
      LIMIT 50
    `,
    [s, s, mine, mine, ...(regional ? area.params : [])]
  );
}

export async function getAppOfficers(userId?: string | null) {
  // Officers covering the farmer's area at the zone_officers scope. An officer
  // with no area set belongs to no one — "district IS NULL" used to make them
  // everyone's.
  const geo = await getUserGeo(userId);
  const area = await geoFilter("zone_officers", "o", geo);
  return queryRows<Row>(
    `
      SELECT CAST(o.id AS CHAR) AS id, o.name, o.officer_role AS role,
             o.district, o.upazila, o.phone,
             (SELECT name_bn FROM geo_districts WHERE id = o.district_id) AS district_bn,
             (SELECT name_bn FROM geo_upazilas WHERE id = o.upazila_id) AS upazila_bn
      FROM zone_officers o
      WHERE o.is_active = 1
        AND COALESCE(o.upazila_id, o.district_id, o.division_id) IS NOT NULL
        AND ${area.sql}
      ORDER BY (o.upazila_id <=> ?) DESC, o.district, o.upazila, o.officer_role
    `,
    [...area.params, geo.upazila_id]
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
             l.status, l.created_at, l.media_json,
             l.cancelled_at, l.cancel_reason, l.rejected_at, l.reject_reason,
             l.verified_at, l.contracted_at, l.shipped_at,
             -- Progress fields so the card can show the live stage without a
             -- second round trip per listing.
             l.field_visit_date, l.verified_weight_kg, l.paid_at, l.paid_amount,
             si.name_en AS item_name, si.name_bn AS item_name_bn,
             a.name_en AS animal_name, a.name_bn AS animal_name_bn,
             b.name_en AS breed_name, b.name_bn AS breed_name_bn,
             l.age_months, l.dressing_pct,
             c.slug AS category_slug
      FROM sale_listings l
      LEFT JOIN sale_items si ON si.id = l.sale_item_id
      LEFT JOIN sale_categories c ON c.id = si.sale_category_id
      LEFT JOIN animals a ON a.id = l.animal_id
      LEFT JOIN animal_breeds b ON b.id = l.breed_id
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
      SELECT CAST(o.id AS CHAR) AS id, o.order_code, o.total_amount, o.delivery_fee, o.discount_amount, o.payable_amount,
             o.payment_method, o.payment_status, o.fulfillment_status, o.district, o.upazila, o.created_at, o.updated_at,
             (SELECT op.source FROM order_promotions op WHERE op.order_id = o.id LIMIT 1) AS promo_source,
             (SELECT op.status FROM order_promotions op WHERE op.order_id = o.id LIMIT 1) AS promo_status,
             COUNT(oi.id) AS item_count,
             SUM(oi.quantity) AS total_qty,
             ANY_VALUE(p.unit) AS unit,
             GROUP_CONCAT(CONCAT(p.name_en, ' ×', oi.quantity + 0) SEPARATOR ', ') AS items_summary,
             GROUP_CONCAT(CONCAT(COALESCE(p.name_bn, p.name_en), ' ×', oi.quantity + 0) SEPARATOR ', ') AS items_summary_bn,
             JSON_UNQUOTE(JSON_EXTRACT(MAX(p.metadata), '$.image_url')) AS image_url,
             ANY_VALUE(COALESCE(d.short_name_en, d.name_en)) AS distributor_name,
             ANY_VALUE(COALESCE(d.short_name_bn, d.name_bn)) AS distributor_name_bn,
             ANY_VALUE(gu.name_bn) AS upazila_bn, ANY_VALUE(gd.name_bn) AS district_bn
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN distributors d ON d.id = o.distributor_id
      LEFT JOIN geo_upazilas gu ON gu.id = o.upazila_id
      LEFT JOIN geo_districts gd ON gd.id = o.district_id
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
       (SELECT COUNT(*) FROM sale_listings WHERE status IN ('submitted','field_verification','verified','contracted','shipped')) AS listings_active,
       (SELECT COUNT(*) FROM sale_listings WHERE status NOT IN ('cancelled','rejected')) AS listings_total,
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
