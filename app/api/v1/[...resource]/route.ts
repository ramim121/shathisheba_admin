import { NextRequest, NextResponse } from "next/server";
import { resolveCaller, unauthorized, forbidden, type Caller } from "@/lib/app-auth";
import { checkAccess } from "@/lib/api-access";
import { RateLimitError, isDatabaseError } from "@/lib/errors";
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
  listResourcePage,
  parseListPage,
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
  verifyOtpLogin,
  getFinanceSummary,
  getReadinessQuestions,
  getReadinessLatest,
  getReadinessSignals,
  getReadinessHistory,
  submitReadiness,
  getLoanProducts,
  createQuote,
  getQuoteSchedule,
  createLoanApplication,
  getLoanApplications,
  getLoanApplicationDetail,
  withdrawLoanApplication,
  getLoanConsents,
  getLoanPurposes,
  getCreditDashboard,
  getLoanQueue,
  getQuestionnaireIntegrity,
  getScorecardIntegrity,
  getAssessment,
  runAssessment,
  getFarmerAssessment,
  getAssessmentHistory,
  getDevelopmentPlan,
  requestReassessment,
  previewUserRecords,
  clearUserRecords
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
  "app/community/moderation": (q) => getCommunityModeration(q.get("filter")),
  "app/learning/overview": (q) => getAppLearningOverview(q.get("user_id")),
  "app/learning/modules": (q) => getAppLearningCategoryModules(q.get("category_id"), q.get("user_id")),
  "app/learning/contents": (q) => getAppLearningModuleContents(q.get("module_id"), q.get("user_id")),
  "app/learning/content": (q) => getAppLearningContent(q.get("content_id"), q.get("user_id")),
  "app/learning/user-progress": (q) => getUserLearningProgress(q.get("user_id")),
  "app/learning/progress-overview": () => getLearningProgressOverview(),

  // Finance — Feature 1 (readiness) and Feature 2 (loan) reads. user_id is
  // already pinned to the session by scopedParams() before these run.
  "app/finance/summary": (q) => getFinanceSummary(q.get("user_id")!),
  "app/finance/readiness/questions": () => getReadinessQuestions(),
  "app/finance/readiness/latest": (q) => getReadinessLatest(q.get("user_id")!),
  "app/finance/readiness/signals": (q) => getReadinessSignals(q.get("user_id")!),
  "app/finance/readiness/history": (q) => getReadinessHistory(q.get("user_id")!),
  "app/finance/loan-products": () => getLoanProducts(),
  "app/finance/applications": (q) => getLoanApplications(q.get("user_id")!),
  "app/finance/consents": (q) => getLoanConsents(q.get("user_id")!),
  "app/finance/purposes": () => getLoanPurposes(),
  // The farmer's own view of their assessment. Deliberately excludes weights,
  // per-criterion ratings and raw reason codes (MOB-LON-26).
  "app/finance/assessment": (q) => getFarmerAssessment(q.get("user_id")!),
  "app/finance/assessment/history": (q) => getAssessmentHistory(q.get("user_id")!),
  "app/finance/development-plan": (q) => getDevelopmentPlan(q.get("user_id")!),

  // Admin finance aggregates. Staff-only via ADMIN_ONLY in lib/api-access.ts.
  "admin/loan/dashboard": () => getCreditDashboard(),
  "admin/loan/queue": (q) => getLoanQueue(q),
  "admin/loan/questionnaire/integrity": () => getQuestionnaireIntegrity(),
  "admin/loan/scorecard/integrity": () => getScorecardIntegrity(),
  "admin/loan/assessment": (q) => getAssessment(q.get("application_id") ?? ""),
  "admin/users/clear-records/preview": (q) => previewUserRecords(q.get("identifier") ?? "")
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

// Writes to a path with no resource behind it used to answer `ok: true` with 201
// Created and echo the payload back — a success response for something that was
// never stored. A client had no way to tell a real write from a typo'd path.
function unknownResource(method: string, resource: string) {
  return NextResponse.json(
    {
      ok: false,
      message: `No writable resource at '${resource}'. Check GET /api/v1/catalog for the available resources.`,
      code: "unknown_resource",
      method
    },
    { status: 404 }
  );
}

function dbError(error: unknown) {
  // A deliberate refusal is not a database failure — surface it as 429 so the
  // client can back off instead of treating it as a server fault and retrying.
  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { ok: false, message: error.message, code: "rate_limited", retry_after: error.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } }
    );
  }
  // Input the caller can fix is a 400, not a 500 — and its message is safe to
  // show, because it was written for the user. A real database fault stays a 500
  // and does not leak the driver's message to the client.
  if (!isDatabaseError(error)) {
    const message = error instanceof Error ? error.message : "Invalid request.";
    return NextResponse.json({ ok: false, message, code: "invalid_request" }, { status: 400 });
  }
  console.error("database error", error);
  return NextResponse.json(
    {
      ok: false,
      message: "A database error occurred. Please try again.",
      source: "mysql"
    },
    { status: 500 }
  );
}

// Best-effort client address for rate limiting. Behind Vercel/any proxy the
// socket address is the proxy, so the forwarded header is the useful one.
function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 45) || null;
  return request.headers.get("x-real-ip")?.slice(0, 45) ?? null;
}

// Identify the caller and apply the access policy in one step. Returns either a
// ready-to-send rejection or the caller, so each verb handler is a two-line guard.
async function guard(
  request: NextRequest,
  resource: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
): Promise<{ deny: NextResponse; caller: null } | { deny: null; caller: Caller }> {
  const caller = await resolveCaller(request);
  const decision = checkAccess(caller, resource, method);
  if (decision.allow) return { deny: null, caller };
  return {
    deny: decision.reason === "unauthenticated" ? unauthorized() : forbidden(),
    caller: null
  };
}

// Pin every user-scoped read to the session's own user. The mobile app still
// sends ?user_id=, but for an app caller that value is overwritten rather than
// trusted, so there is no parameter left to tamper with. Admins keep the
// supplied id — the console legitimately inspects other people's records.
function scopedParams(request: NextRequest, caller: Caller): URLSearchParams {
  const params = new URLSearchParams(request.nextUrl.searchParams);
  if (caller.kind === "app") {
    params.set("user_id", String(caller.user.id));
  }
  return params;
}

// Same pinning for write payloads.
function scopedPayload(payload: unknown, caller: Caller): Record<string, unknown> {
  const body = (payload ?? {}) as Record<string, unknown>;
  if (caller.kind === "app") {
    return { ...body, user_id: caller.user.id };
  }
  return body;
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
  const { deny, caller } = await guard(request, resource, "GET");
  if (deny) return deny;
  const searchParams = scopedParams(request, caller);

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

  // Finance application detail: app/finance/applications/{code}. Ownership is
  // enforced by the query itself — it filters on the session's user_id.
  if (resource.startsWith("app/finance/applications/")) {
    const code = resource.slice("app/finance/applications/".length);
    try {
      return envelope(await getLoanApplicationDetail(searchParams.get("user_id")!, code), {
        source: "mysql", surface: "app", resource: "app/finance/applications/{code}",
      });
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
  // ?surface=admin returns admin-column-shaped rows; only an admin caller may ask
  // for it, so an app token cannot opt out of the app-shaped projection.
  const adminSurface = caller.kind === "admin" && searchParams.get("surface") === "admin";

  if (!id && appReadHandlers[resource] && !adminSurface) {
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
      const listed = await listResourcePage(resource, parseListPage(searchParams));
      return envelope(listed?.rows ?? [], {
        source: "mysql",
        resource,
        total: listed?.total ?? null,
        limit: listed?.limit ?? null,
        offset: listed?.offset ?? 0,
        truncated: listed?.truncated ?? false
      });
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
  const { deny, caller } = await guard(request, exact, "POST");
  if (deny) return deny;
  const payload = scopedPayload(await request.json().catch(() => ({})), caller);

  // App action routes (composite writes that the mobile screens call directly).
  try {
    // ---- Account maintenance ------------------------------------------------
    // Destructive and irreversible, so it carries three guards beyond the normal
    // admin check: super_admin only, the caller must echo back the exact phone
    // number, and every run is audit-logged with per-table counts.
    if (exact === "admin/users/clear-records") {
      if (caller.kind !== "admin" || caller.admin.role !== "super_admin") {
        return forbidden("Clearing account records is restricted to super administrators.");
      }
      const identifier = String((payload as Record<string, unknown>).identifier ?? "");
      const confirm = String((payload as Record<string, unknown>).confirm ?? "");
      if (!identifier) return dbError(new Error("Provide the account's phone number or id."));
      if (confirm !== identifier) {
        return dbError(new Error("Type the account's phone number exactly to confirm."));
      }
      const result = await clearUserRecords(
        identifier,
        {
          resetOnboarding: (payload as Record<string, unknown>).reset_onboarding !== false,
          resetRoles: (payload as Record<string, unknown>).reset_roles === true,
        },
        { adminId: caller.admin.id, ip: clientIp(request), userAgent: request.headers.get("user-agent") }
      );
      return NextResponse.json({ ok: true, source: "mysql", action: "records_cleared", result }, { status: 200 });
    }

    // ---- Credit assessment (P4) ---------------------------------------------
    // Scoring is a credit decision, so it is restricted to the credit roles and
    // never available to the field officer who captured the evidence
    // (separation of duties, ENG-24 / BLU §11.3). Criterion overrides carry the
    // same restriction: an override is an analyst's judgement, recorded as such.
    if (exact === "admin/loan/assess") {
      const CREDIT_ROLES = ["super_admin", "hq_admin", "credit_analyst", "credit_approver"];
      if (caller.kind !== "admin" || !CREDIT_ROLES.includes(caller.admin.role)) {
        return forbidden("Running a credit assessment is restricted to credit staff.");
      }
      const body = payload as Record<string, unknown>;
      const applicationId = Number(body.application_id);
      if (!Number.isFinite(applicationId)) {
        return dbError(new Error("A numeric application_id is required."));
      }
      const rawOverrides = (body.overrides ?? {}) as Record<string, { rating?: unknown; reason?: unknown }>;
      const overrides: Record<string, { rating: number; reason: string }> = {};
      for (const [code, value] of Object.entries(rawOverrides)) {
        const rating = Number(value?.rating);
        const reason = String(value?.reason ?? "").trim();
        if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
          return dbError(new Error(`Override for "${code}" must be an integer rating from 0 to 5.`));
        }
        // ENG-17 requires a reason. An unexplained override is indistinguishable
        // from a mistake when someone reviews the file later.
        if (!reason) return dbError(new Error(`Override for "${code}" requires a reason.`));
        overrides[code] = { rating, reason };
      }
      const result = await runAssessment({
        applicationId,
        adminId: caller.admin.id,
        shadow: body.shadow === true,
        overrides: Object.keys(overrides).length ? overrides : undefined,
      });
      return NextResponse.json({ ok: true, source: "mysql", action: "assessed", result }, { status: 200 });
    }

    // ---- Finance writes -----------------------------------------------------
    if (exact === "app/finance/reassessment-request") {
      return NextResponse.json({ ok: true, source: "mysql", action: "reassessment_requested", result: await requestReassessment(payload) }, { status: 200 });
    }
    if (exact === "app/finance/readiness/submit") {
      return NextResponse.json({ ok: true, source: "mysql", action: "readiness_scored", result: await submitReadiness(payload) }, { status: 200 });
    }
    if (exact === "app/finance/quote") {
      return NextResponse.json({ ok: true, source: "mysql", action: "quoted", result: await createQuote(payload) }, { status: 200 });
    }
    if (exact === "app/finance/quote/schedule") {
      return NextResponse.json({ ok: true, source: "mysql", action: "schedule_previewed", result: await getQuoteSchedule(payload) }, { status: 200 });
    }
    if (exact === "app/finance/applications") {
      return NextResponse.json({ ok: true, source: "mysql", action: "application_created", result: await createLoanApplication(payload) }, { status: 201 });
    }
    if (segments[0] === "app" && segments[1] === "finance" && segments[2] === "applications" && segments[4] === "withdraw") {
      const uid = String((payload as Record<string, unknown>).user_id ?? "");
      return NextResponse.json({ ok: true, source: "mysql", action: "withdrawn", result: await withdrawLoanApplication(uid, segments[3]) }, { status: 200 });
    }

    if (exact === "app/auth/request-otp") {
      return NextResponse.json({ ok: true, source: "mysql", action: "otp_sent", result: await requestOtp(payload, clientIp(request)) }, { status: 200 });
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
      // The console does not send admin_id; take it from the authenticated
      // session so the audit trail names a real administrator.
      const decision = await decideApproval(
        { ...payload, admin_id: payload.admin_id ?? caller.admin?.id ?? null },
        { ip: clientIp(request), userAgent: request.headers.get("user-agent") }
      );
      return NextResponse.json({ ok: true, source: "mysql", action: "approval_decided", result: decision }, { status: 200 });
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
  return unknownResource("POST", resource);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const context = await resolveResourceContext(params, request);
  const resource = context.resource;
  const { deny, caller } = await guard(request, resource, "PUT");
  if (deny) return deny;
  const payload = scopedPayload(await request.json().catch(() => ({})), caller);
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
  return unknownResource("PUT", resource);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await resolveResourceContext(params, request);
  const resource = context.resource;
  const { deny, caller } = await guard(request, resource, "PATCH");
  if (deny) return deny;
  const payload = scopedPayload(await request.json().catch(() => ({})), caller);
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
  return unknownResource("PATCH", resource);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const context = await resolveResourceContext(params, request);
  const resource = context.resource;
  const { deny } = await guard(request, resource, "DELETE");
  if (deny) return deny;
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
  return unknownResource("DELETE", resource);
}
