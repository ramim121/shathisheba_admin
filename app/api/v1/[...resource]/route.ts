import { NextRequest, NextResponse } from "next/server";
import {
  apiCatalog,
  buyOrders,
  communityPosts,
  learningModules,
  partnerApplications,
  saleListings
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
  aiFlagCommunityPost,
  aiScanCommunityPosts,
  submitKycApplication,
  createSaleConfirmation,
  getCommunityModeration,
  moderateCommunityPost,
  getAppLearningOverview,
  getAppLearningCategoryModules,
  getAppLearningModuleContents,
  getAppLearningContent,
  markLearningProgress,
  submitLearningQuiz,
  getUserLearningProgress,
  getLearningProgressOverview,
  getAppBreeds,
  getAppAnimals,
  getAppGeoDivisions,
  getAppGeoDistricts,
  getAppGeoUpazilas,
  getSalePriceQuote,
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
  getAppActiveProjects,
  getAppMyProjects,
  getSaleCategoryAvailability,
  getProjectPrevRates,
  getAppPricing,
  getAppProducts,
  getAppProfileUsers,
  getAppSaleCategories,
  getAppSaleItems,
  getAppWeatherAlerts,
  getAdminNotifications,
  getMyListings,
  getMyOrders,
  getInventoryOverview,
  getAdminStats,
  getApprovalQueues,
  getApprovalDetail,
  decideApproval,
  setApprovalRequirements,
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
  "sale/breeds": (q) => getAppBreeds(q.get("species")),
  "sale/animals": (q) => getAppAnimals(q.get("species")),
  "sale/pricing": () => getAppPricing(),
  "geo/divisions": () => getAppGeoDivisions(),
  "geo/districts": (q) => getAppGeoDistricts(q.get("division_id")),
  "geo/upazilas": (q) => getAppGeoUpazilas(q.get("district_id")),
  "buy/categories": () => getAppBuyCategories(),
  "buy/products": (q) => getAppProducts(q.get("category"), q.get("interest")),
  "learning/modules": () => getAppLearningModules(),
  "learning/contents": () => getAppLearningContents(),
  "partners/projects": () => getAppPartnerProjects(),
  "partners/ledgers": () => getAppPartnerLedgers(),
  "app/projects/active": (q) => getAppActiveProjects(q.get("user_id"), q.get("division"), q.get("district")),
  "app/projects/mine": (q) => getAppMyProjects(q.get("user_id")),
  "app/projects/prev-rates": (q) => getProjectPrevRates(q.get("animal_id"), q.get("breed_id"), q.get("district")),
  "app/sale/category-availability": (q) => getSaleCategoryAvailability(q.get("user_id"), q.get("division"), q.get("district")),
  "app/sale/my-listings": (q) => getMyListings(q.get("user_id")),
  "app/orders/mine": (q) => getMyOrders(q.get("user_id")),
  "app/admin/inventory": () => getInventoryOverview(),
  "app/admin/stats": () => getAdminStats(),
  "community/posts": (q) => getAppCommunityPosts(q.get("scope"), q.get("district"), q.get("filter"), q.get("user_id")),
  "community/officers": (q) => getAppOfficers(q.get("district")),
  users: (q) => getAppProfileUsers(q.get("user_id")),
  "app/users": (q) => getAppProfileUsers(q.get("user_id")),
  "app/me": (q) => getAppMe(q.get("user_id")),
  "app/banking": (q) => getUserBanking(q.get("user_id")),
  "app/farm": (q) => getUserFarm(q.get("user_id")),
  "app/kyc-documents": (q) => getUserKycDocuments(q.get("user_id")),
  "app/users-with-roles": () => getUsersWithRoles(),
  "app/admin/notifications": () => getAdminNotifications(),
  "app/community/moderation": (q) => getCommunityModeration(q.get("filter")),
  "app/learning/overview": (q) => getAppLearningOverview(q.get("user_id")),
  "app/learning/modules": (q) => getAppLearningCategoryModules(q.get("category_id"), q.get("user_id")),
  "app/learning/contents": (q) => getAppLearningModuleContents(q.get("module_id"), q.get("user_id")),
  "app/learning/content": (q) => getAppLearningContent(q.get("content_id"), q.get("user_id")),
  "app/learning/user-progress": (q) => getUserLearningProgress(q.get("user_id")),
  "app/learning/progress-overview": () => getLearningProgressOverview()
};

type Params = {
  params: Promise<{
    resource: string[];
  }>;
};

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

  // App sale price quote: resolve the B2B preset for animal + breed + region.
  if (resource === "app/sale/price-quote") {
    try {
      const quote = await getSalePriceQuote({
        animal_id: searchParams.get("animal_id"),
        breed_id: searchParams.get("breed_id"),
        sale_item_id: searchParams.get("sale_item_id"),
        district: searchParams.get("district"),
        weight: searchParams.get("weight")
      });
      return envelope(quote, { source: "mysql", surface: "app", resource });
    } catch (error) {
      return dbError(error);
    }
  }

  // Admin approvals to-do dashboard: queues + per-item detail with verification panel.
  if (resource === "app/admin/approvals") {
    try {
      return envelope(await getApprovalQueues(), { source: "mysql", surface: "admin", resource });
    } catch (error) {
      return dbError(error);
    }
  }
  if (resource === "app/admin/approval") {
    try {
      return envelope(await getApprovalDetail(searchParams.get("type"), searchParams.get("id")), { source: "mysql", surface: "admin", resource });
    } catch (error) {
      return dbError(error);
    }
  }

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
  // The admin panel passes ?surface=admin to opt out and receive the
  // admin-column-shaped rows from listResource() instead (otherwise its tables
  // would render blank cells against app field names).
  if (!id && appReadHandlers[resource] && searchParams.get("surface") !== "admin") {
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
    if (exact === "app/admin/approve") {
      return NextResponse.json({ ok: true, source: "mysql", action: "approval_decided", result: await decideApproval(payload) }, { status: 200 });
    }
    if (exact === "app/admin/set-required-docs") {
      return NextResponse.json({ ok: true, source: "mysql", action: "requirements_saved", result: await setApprovalRequirements(payload) }, { status: 200 });
    }
    if (exact === "app/community/moderate") {
      return NextResponse.json({ ok: true, source: "mysql", action: "post_moderated", result: await moderateCommunityPost(payload) }, { status: 200 });
    }
    if (exact === "app/community/ai-flag") {
      return NextResponse.json({ ok: true, source: "gemini", action: "post_ai_flagged", result: await aiFlagCommunityPost(payload) }, { status: 200 });
    }
    if (exact === "app/community/ai-scan") {
      return NextResponse.json({ ok: true, source: "gemini", action: "posts_ai_scanned", result: await aiScanCommunityPosts(payload) }, { status: 200 });
    }
    if (exact === "app/learning/progress") {
      return NextResponse.json({ ok: true, source: "mysql", action: "learning_progress", result: await markLearningProgress(payload) }, { status: 200 });
    }
    if (exact === "app/learning/submit-quiz") {
      return NextResponse.json({ ok: true, source: "mysql", action: "quiz_graded", result: await submitLearningQuiz(payload) }, { status: 200 });
    }
    if (exact === "app/orders") {
      return NextResponse.json({ ok: true, source: "mysql", action: "order_placed", result: await placeOrder(payload) }, { status: 201 });
    }
    if (exact === "app/kyc/submit") {
      return NextResponse.json({ ok: true, source: "mysql", action: "kyc_submitted", result: await submitKycApplication(payload) }, { status: 201 });
    }
    if (exact === "app/sale/confirm") {
      return NextResponse.json({ ok: true, source: "mysql", action: "confirmation_created", result: await createSaleConfirmation(payload) }, { status: 201 });
    }
    if (exact === "app/sale/verify-otp") {
      return NextResponse.json({ ok: true, source: "mysql", action: "payment_confirmed", result: await verifyOtp(payload) });
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
