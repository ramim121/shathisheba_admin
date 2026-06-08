import { NextRequest, NextResponse } from "next/server";
import {
  apiCatalog,
  buyOrders,
  buyProducts,
  communityPosts,
  interestCategories,
  learningModules,
  marketUpdates,
  partnerApplications,
  partnerProjects,
  priceBreakdown,
  saleListings,
  weatherAlerts
} from "@/lib/data";
import {
  createResource,
  deleteResource,
  getDbResourceKeys,
  getResourceRelated,
  getResourceRow,
  hasDbResource,
  listResource,
  updateResource
} from "@/lib/db-resources";
import {
  cattleAnalyzeStub,
  createSaleConfirmation,
  getAppBreeds,
  getAppBuyCategories,
  getAppCommunityPosts,
  getAppLearningContents,
  getAppLearningModules,
  getAppMarketUpdate,
  getAppMarketUpdates,
  getAppMe,
  getAppOfficers,
  getAppPartnerLedgers,
  getAppPartnerProjects,
  getAppPricing,
  getAppProducts,
  getAppProfileUsers,
  getAppSaleCategories,
  getAppSaleItems,
  getAppWeatherAlerts,
  getAdminNotifications,
  getHomeFeed,
  getOnboardingTree,
  getUserBanking,
  getUserFarm,
  getUserKycDocuments,
  getUsersWithRoles,
  setUserRoles,
  likePost,
  placeOrder,
  requestOtp,
  addUserKycDocument,
  savePersonalInfo,
  saveUserBanking,
  saveUserFarm,
  saveUserPreferences,
  verifyOtp,
  verifyOtpLogin
} from "@/lib/app-endpoints";

// App-facing list reads. The mobile app hits these generic resource paths and
// needs raw bilingual/detail columns; the admin panel reads lib/db-resources
// directly (server-side) so reshaping these responses does not affect admin.
type AppReadHandler = (searchParams: URLSearchParams) => Promise<unknown>;

const appReadHandlers: Record<string, AppReadHandler> = {
  "market-updates": (q) => getAppMarketUpdates(q.get("district")),
  weather: (q) => getAppWeatherAlerts(q.get("district")),
  "sale/categories": () => getAppSaleCategories(),
  "sale/items": () => getAppSaleItems(),
  "sale/breeds": () => getAppBreeds(),
  "sale/pricing": () => getAppPricing(),
  "buy/categories": () => getAppBuyCategories(),
  "buy/products": (q) => getAppProducts(q.get("category")),
  "learning/modules": () => getAppLearningModules(),
  "learning/contents": () => getAppLearningContents(),
  "partners/projects": () => getAppPartnerProjects(),
  "partners/ledgers": () => getAppPartnerLedgers(),
  "community/posts": (q) => getAppCommunityPosts(q.get("scope")),
  "community/officers": (q) => getAppOfficers(q.get("district")),
  users: (q) => getAppProfileUsers(q.get("user_id")),
  "app/users": (q) => getAppProfileUsers(q.get("user_id")),
  "app/me": (q) => getAppMe(q.get("user_id")),
  "app/banking": (q) => getUserBanking(q.get("user_id")),
  "app/farm": (q) => getUserFarm(q.get("user_id")),
  "app/kyc-documents": (q) => getUserKycDocuments(q.get("user_id")),
  "app/users-with-roles": () => getUsersWithRoles(),
  "app/admin/notifications": () => getAdminNotifications()
};

type Params = {
  params: Promise<{
    resource: string[];
  }>;
};

const saleCategories = [
  { slug: "crops", name_en: "Crops", name_bn: "ফসল", active: true, description: "Grains, vegetables, fruits" },
  { slug: "livestock", name_en: "Livestock", name_bn: "গবাদি পশু", active: true, description: "Cattle, goat, poultry, fish" },
  { slug: "inputs", name_en: "Inputs", name_bn: "ইনপুট", active: true, description: "Seeds, feed, fertilizer" },
  { slug: "machinery", name_en: "Machinery", name_bn: "যন্ত্রপাতি", active: true, description: "Rent and lease" }
];

const animalTypes = [
  { category: "cattle", type: "Bull", type_bn: "ষাঁড়", breeds: ["Cross Friesian", "Local", "Sahiwal", "Red Chittagong"] },
  { category: "goat", type: "Goat", type_bn: "ছাগল", breeds: ["Black Bengal", "Jamnapari", "Local"] },
  { category: "poultry", type: "Poultry", type_bn: "পোল্ট্রি", breeds: ["Broiler", "Layer", "Native"] }
];

const buyCategories = [
  { slug: "shadhin-feed", name_en: "Shadhin Feed", name_bn: "স্বাধীন ফিড", description: "Own brand" },
  { slug: "seeds", name_en: "Seeds", name_bn: "বীজ", description: "Certified varieties" },
  { slug: "fertilizer", name_en: "Fertilizer", name_bn: "সার", description: "Urea, DAP, organic" },
  { slug: "agri-medicine", name_en: "Agri-medicine", name_bn: "কৃষি ঔষধ", description: "Pesticide, vet" },
  { slug: "tools", name_en: "Tools", name_bn: "যন্ত্র", description: "Hand and electric" },
  { slug: "machinery-rental", name_en: "Machinery rental", name_bn: "যন্ত্র ভাড়া", description: "Tractor, tiller" }
];

function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    meta,
    data
  });
}

function accepted(method: string, payload: unknown, resource: string) {
  return NextResponse.json(
    {
      ok: true,
      message: `${method} accepted for ${resource}. Replace seed handler with DB service when MySQL is connected.`,
      received: payload
    },
    { status: method === "POST" ? 201 : 202 }
  );
}

function dbError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown database error";
  return NextResponse.json(
    {
      ok: false,
      message,
      source: "mysql"
    },
    { status: 500 }
  );
}

async function resolveResourceContext(params: Params["params"], request: NextRequest) {
  const { resource: segments } = await params;
  const exactResource = segments.join("/");
  const queryId = request.nextUrl.searchParams.get("id");

  if (hasDbResource(exactResource)) {
    return { resource: exactResource, id: queryId };
  }

  if (segments.length > 1) {
    const id = segments[segments.length - 1];
    const resource = segments.slice(0, -1).join("/");
    if (hasDbResource(resource)) {
      return { resource, id: queryId ?? id };
    }
  }

  return { resource: exactResource, id: queryId };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { resource, id } = await resolveResourceContext(params, request);
  const searchParams = request.nextUrl.searchParams;

  // App market updates: list (location-first) or blog detail by id.
  if (resource === "app/market-updates") {
    try {
      if (id) {
        return envelope(await getAppMarketUpdate(id), { source: "mysql", surface: "app", resource, id });
      }
      return envelope(await getAppMarketUpdates(searchParams.get("district")), { source: "mysql", surface: "app", resource });
    } catch (error) {
      return dbError(error);
    }
  }

  // App-shaped list reads take priority over the admin-shaped generic CRUD
  // (collection requests only; detail `?id=` still uses getResourceRow).
  if (!id && appReadHandlers[resource]) {
    try {
      const data = await appReadHandlers[resource](searchParams);
      return envelope(data ?? [], { source: "mysql", surface: "app", resource });
    } catch (error) {
      return dbError(error);
    }
  }

  if (hasDbResource(resource)) {
    try {
      if (id) {
        const row = await getResourceRow(resource, id);
        const related = await getResourceRelated(resource, id);
        return envelope({ row, related }, { source: "mysql", resource, id });
      }
      const rows = await listResource(resource);
      return envelope(rows ?? [], { source: "mysql", resource });
    } catch (error) {
      return dbError(error);
    }
  }

  switch (resource) {
    case "app/onboarding":
      try {
        return envelope(await getOnboardingTree(), { source: "mysql", surface: "onboarding-multi-step" });
      } catch (error) {
        return dbError(error);
      }
    case "app/home":
      try {
        return envelope(
          await getHomeFeed(searchParams.get("user_id"), searchParams.get("district")),
          { source: "mysql", surface: "mobile-home" }
        );
      } catch (error) {
        return dbError(error);
      }
    case "interests":
      return envelope(interestCategories, { purpose: "Splash onboarding category and child item setup" });
    case "weather":
      return envelope(weatherAlerts, {
        district: searchParams.get("district") ?? "all",
        source: "weather-server-plus-local-critical-alerts"
      });
    case "market-updates":
      return envelope(marketUpdates, { surface: "mobile-homepage" });
    case "sale/categories":
      return envelope({ categories: saleCategories, animal_types: animalTypes, price_breakdown: priceBreakdown });
    case "sale/listings":
      return envelope(saleListings, { status: searchParams.get("status") ?? "all" });
    case "buy/categories":
      return envelope(buyCategories);
    case "buy/products":
      return envelope(buyProducts, { category: searchParams.get("category") ?? "all" });
    case "buy/orders":
      return envelope(buyOrders, { status: searchParams.get("status") ?? "all" });
    case "learning/modules":
      return envelope(learningModules, { include: "categories,contents,completion_rules" });
    case "partners/projects":
      return envelope(partnerProjects);
    case "partners/applications":
      return envelope(partnerApplications, { queue: "kyc,due-diligence,field-verification,approval" });
    case "community/posts":
      return envelope(communityPosts, { scope: searchParams.get("scope") ?? "all" });
    case "users":
      return envelope([
        { id: "USR-1", full_name: "Md. Rahim", phone: "01712-345678", district: "Mymensingh", upazila: "Mymensingh Sadar", status: "active" },
        { id: "USR-2", full_name: "Fatema Khatun", phone: "01812-222333", district: "Mymensingh", upazila: "Mymensingh Sadar", status: "active" },
        { id: "USR-3", full_name: "Sadia Khatun", phone: "01933-555888", district: "Dhaka", upazila: "Dhaka", status: "active" }
      ]);
    case "reports":
      return envelope({
        marketplace: { sale_listings: saleListings.length, buy_orders: buyOrders.length },
        approvals: { partner_applications: partnerApplications.length },
        content: { learning_modules: learningModules.length },
        community: { posts: communityPosts.length }
      });
    case "settings":
      return envelope([
        { key: "weather_push_enabled", value: true },
        { key: "sale_ai_prefill", value: "enabled" },
        { key: "community_auto_moderation", value: "review" }
      ]);
    case "catalog":
      return envelope({
        endpoints: apiCatalog,
        database_resources: getDbResourceKeys().map((key) => ({
          resource: key,
          collection: `/api/v1/${key}`,
          detail: `/api/v1/${key}/{id}`,
          methods: ["GET", "POST", "PATCH", "PUT", "DELETE"]
        }))
      });
    default:
      return NextResponse.json(
        {
          ok: false,
          message: "Unknown API resource",
          available: apiCatalog.map((endpoint) => endpoint.path)
        },
        { status: 404 }
      );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { resource: segments } = await params;
  const exact = segments.join("/");
  const payload = await request.json().catch(() => ({}));

  // App action routes (composite writes that the mobile screens call directly).
  try {
    if (exact === "app/auth/request-otp") {
      return NextResponse.json({ ok: true, source: "mysql", action: "otp_sent", result: await requestOtp(payload) }, { status: 200 });
    }
    if (exact === "app/auth/verify-otp") {
      return NextResponse.json({ ok: true, source: "mysql", action: "authenticated", result: await verifyOtpLogin(payload) }, { status: 200 });
    }
    if (exact === "app/profile") {
      return NextResponse.json({ ok: true, source: "mysql", action: "profile_saved", result: await savePersonalInfo(payload) }, { status: 200 });
    }
    if (exact === "app/banking") {
      return NextResponse.json({ ok: true, source: "mysql", action: "banking_saved", result: await saveUserBanking(payload) }, { status: 200 });
    }
    if (exact === "app/farm") {
      return NextResponse.json({ ok: true, source: "mysql", action: "farm_saved", result: await saveUserFarm(payload) }, { status: 200 });
    }
    if (exact === "app/kyc-documents") {
      return NextResponse.json({ ok: true, source: "mysql", action: "kyc_added", result: await addUserKycDocument(payload) }, { status: 201 });
    }
    if (exact === "app/preferences") {
      return NextResponse.json({ ok: true, source: "mysql", action: "preferences_saved", result: await saveUserPreferences(payload) }, { status: 201 });
    }
    if (exact === "app/user-roles/set") {
      return NextResponse.json({ ok: true, source: "mysql", action: "roles_updated", result: await setUserRoles(payload) }, { status: 200 });
    }
    if (exact === "app/orders") {
      return NextResponse.json({ ok: true, source: "mysql", action: "order_placed", result: await placeOrder(payload) }, { status: 201 });
    }
    if (exact === "app/sale/confirm") {
      return NextResponse.json({ ok: true, source: "mysql", action: "confirmation_created", result: await createSaleConfirmation(payload) }, { status: 201 });
    }
    if (exact === "app/sale/verify-otp") {
      return NextResponse.json({ ok: true, source: "mysql", action: "payment_confirmed", result: await verifyOtp(payload) });
    }
    if (exact === "app/ai/cattle-analyze") {
      return envelope(cattleAnalyzeStub(), { source: "ai-stub", surface: "list-cattle" });
    }
    if (segments.length === 4 && segments[0] === "community" && segments[1] === "posts" && segments[3] === "like") {
      return NextResponse.json({ ok: true, source: "mysql", action: "liked", result: await likePost(segments[2]) });
    }
  } catch (error) {
    return dbError(error);
  }

  const { resource } = await resolveResourceContext(params, request);
  if (hasDbResource(resource)) {
    try {
      const result = await createResource(resource, payload);
      return NextResponse.json({ ok: true, source: "mysql", action: "created", resource, result }, { status: 201 });
    } catch (error) {
      return dbError(error);
    }
  }
  return accepted("POST", payload, resource);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const context = await resolveResourceContext(params, request);
  const resource = context.resource;
  const payload = await request.json().catch(() => ({}));
  const id = context.id ?? String((payload as Record<string, unknown>).id ?? "");
  if (hasDbResource(resource)) {
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing id for update." }, { status: 400 });
    }
    try {
      const result = await updateResource(resource, id, payload);
      return NextResponse.json({ ok: true, source: "mysql", action: "updated", resource, id, result });
    } catch (error) {
      return dbError(error);
    }
  }
  return accepted("PUT", payload, resource);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await resolveResourceContext(params, request);
  const resource = context.resource;
  const payload = await request.json().catch(() => ({}));
  const id = context.id ?? String((payload as Record<string, unknown>).id ?? "");
  if (hasDbResource(resource)) {
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing id for update." }, { status: 400 });
    }
    try {
      const result = await updateResource(resource, id, payload);
      return NextResponse.json({ ok: true, source: "mysql", action: "updated", resource, id, result });
    } catch (error) {
      return dbError(error);
    }
  }
  return accepted("PATCH", payload, resource);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const context = await resolveResourceContext(params, request);
  const resource = context.resource;
  const payload = await request.json().catch(() => ({}));
  const id = context.id ?? String((payload as Record<string, unknown>).id ?? "");
  if (hasDbResource(resource)) {
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing id for delete." }, { status: 400 });
    }
    try {
      const result = await deleteResource(resource, id);
      return NextResponse.json({ ok: true, source: "mysql", action: "deleted", resource, id, result });
    } catch (error) {
      return dbError(error);
    }
  }
  return accepted("DELETE", payload, resource);
}
