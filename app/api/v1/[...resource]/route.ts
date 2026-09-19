import { NextRequest, NextResponse } from "next/server";
import { resolveCaller, unauthorized, forbidden, type Caller } from "@/lib/app-auth";
import { checkAccess } from "@/lib/api-access";
import { RateLimitError, isDatabaseError } from "@/lib/errors";
import { resolveGeoNames, searchUpazilas } from "@/lib/geo";
import { GEO_FEATURES, getAllGeoScopes, inheritUserGeo, type GeoFeature } from "@/lib/geo-scope";
import { getMyChangeRequest, listProfileChangeRequests, reviewProfileChangeRequest } from "@/lib/endpoints/profile-changes";
import { recordAudit } from "@/lib/audit";
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
  postCommunityNotice,
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
  getPublicProjects,
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
  getOrderQuote,
  getAppOrderDetail,
  getAppManufacturer,
  getAppDistributor,
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
  getLoanWorkspace,
  saveLoanEvidence,
  saveFieldVerification,
  assignDevelopmentTasks,
  saveWorkspaceRow,
  isRowCollection,
  disburseLoan,
  recordRepayment,
  refreshAllArrears,
  getCollections,
  getLoanAccount,
  mayDisburse,
  COLLECT_ROLES,
  startMpowerUSession,
  syncMpowerUSession,
  pollPendingMpowerUSessions,
  getMpowerUStatus,
  buildLenderPack,
  packToCsv,
  submitToLender,
  recordLenderDecision,
  getLenderPipeline,
  LENDER_ROLES,
  runShadowComparison,
  queueRepaymentReminders,
  dispatchFinanceNotifications,
  getNotificationQueue,
  previewUserRecords,
  clearUserRecords,
  DATASETS,
  type DatasetKey
} from "@/lib/app-endpoints";
import { assertOperational, getOperationalStatus, getOperationalZones } from "@/lib/operational";
import {
  getListingProgress,
  getMyProjectApplications,
  getProjectApplicationProgress
} from "@/lib/endpoints/progress";
import { getListingWorkflow, saveListingWorkflow } from "@/lib/endpoints/listing-workflow";
import { getPricingOverlaps, pricingWarningsFor } from "@/lib/endpoints/pricing-overlaps";
import { getPromotionStatus } from "@/lib/promotions";
import {
  audienceSummary,
  getInbox,
  markRead,
  notificationStatus,
  previewTemplate,
  registerDevice,
  sendBroadcast,
  setAppLang,
  testTemplate,
  unregisterDevice,
  type BroadcastInput
} from "@/lib/notify";
import { notifyListing } from "@/lib/notices";
import { assertCanPost, postListingMilestone, postsLeftToday, shareListingToCommunity } from "@/lib/community-posts";
import { getAppMarketOverview, getAppPartners, reorderPartners } from "@/lib/endpoints/engagement";
import { getDashboardOverview } from "@/lib/endpoints/dashboard";
import { getDeleteImpact, getDeleteImpactRows, clearDeleteBlockers } from "@/lib/endpoints/delete-impact";
import { isAiConfigured, runAssist, type AssistRequest } from "@/lib/ai-assist";
import { getFarmerFile, searchFarmers } from "@/lib/endpoints/farmer-file";
import { askApa } from "@/lib/apa";
import { appAnalyzePhoto, appListingDescription, appSpeak, appSpeechConfig, appSummarize } from "@/lib/endpoints/app-ai";
import { ApaLockedError } from "@/lib/apa/entitlement";
import { closeLiveSession, markLiveConnected, saveLiveTranscript, startLiveSession } from "@/lib/apa/live";
import {
  clearApaHistory,
  getApaClientErrors,
  getApaConversation,
  getApaConversations,
  getApaEntitlement,
  getApaSettings,
  reportApaClientError,
  saveApaSettings,
  submitApaFeedback
} from "@/lib/endpoints/apa";
import {
  correctApaScope,
  flagApaConversation,
  getApaAccess,
  getApaConsoleConversation,
  getApaConsoleConversations,
  getApaFeedback,
  getApaScopeReview,
  getApaUsage,
  getApaVocabulary,
  getApaVoiceConfig,
  grantApaTier,
  reviewApaFeedback,
  saveApaVocabulary,
  saveApaVoiceConfig,
  getApaQuota,
  getApaPromptVersions,
  getApaPromptVersion,
  resetApaQuotaHints,
  revertApaPrompt,
  prewarmApaAnswer
} from "@/lib/endpoints/apa-console";

// App-facing list reads. The mobile app hits these generic resource paths and
// needs raw bilingual/detail columns; the admin panel reads lib/db-resources
// directly (server-side) so reshaping these responses does not affect admin.
type AppReadHandler = (searchParams: URLSearchParams) => Promise<unknown>;

const appReadHandlers: Record<string, AppReadHandler> = {
  "market-updates": (q) => getAppMarketUpdates(q.get("user_id")),
  weather: (q) => getAppWeatherAlerts(q.get("user_id"), q.get("gps_district_id"), q.get("gps_upazila_id")),
  "sale/categories": () => getAppSaleCategories(),
  "sale/items": () => getAppSaleItems(),
  "sale/breeds": (q) => getAppBreeds(q.get("species")),
  "sale/animals": (q) => getAppAnimals(q.get("species")),
  "sale/pricing": () => getAppPricing(),
  "geo/divisions": () => getAppGeoDivisions(),
  "geo/districts": (q) => getAppGeoDistricts(q.get("division_id")),
  "geo/upazilas": (q) => getAppGeoUpazilas(q.get("district_id")),
  "geo/search": (q) => searchUpazilas(q.get("q") ?? "", Number(q.get("limit") ?? 20)),
  "geo/resolve": (q) => resolveGeoNames({ division: q.get("division"), district: q.get("district"), upazila: q.get("upazila") }),
  "app/geo/scopes": () => getAllGeoScopes(),
  // Which offerings the farmer can use where they are, and why not if not.
  "app/operational-status": (q) => getOperationalStatus(q.get("user_id")),
  "admin/geo/zones": () => getOperationalZones(),
  "app/profile/change-request": (q) => getMyChangeRequest(q.get("user_id")),
  "admin/geo/scopes": async () => {
    const values = await getAllGeoScopes();
    return GEO_FEATURES.map((feature) => ({ ...feature, value: values[feature.key] }));
  },
  "admin/profile-requests": (q) => listProfileChangeRequests(q.get("status")),
  // Only products sold where the buyer is (per-product area, set in Product setup).
  "buy/categories": (q) => getAppBuyCategories(q.get("user_id")),
  "buy/products": (q) => getAppProducts(q.get("category"), q.get("interest"), q.get("user_id"), q.get("manufacturer_id")),
  // "Made by" / "Distributed by" detail modals. Not ?id= — that means a
  // single-record read of a CRUD resource to this route.
  "app/brands/manufacturer": (q) => getAppManufacturer(q.get("manufacturer_id")),
  "app/brands/distributor": (q) => getAppDistributor(q.get("distributor_id")),
  "learning/modules": () => getAppLearningModules(),
  "learning/contents": () => getAppLearningContents(),
  "partners/projects": () => getAppPartnerProjects(),
  "partners/ledgers": () => getAppPartnerLedgers(),
  "app/projects/active": (q) => getAppActiveProjects(q.get("user_id")),
  // Anonymous showcase read for the marketing website. See getPublicProjects.
  "app/projects/public": () => getPublicProjects(),
  "app/projects/mine": (q) => getAppMyProjects(q.get("user_id")),
  "app/projects/prev-rates": (q) => getProjectPrevRates(q.get("animal_id"), q.get("breed_id"), q.get("district")),
  "app/sale/category-availability": (q) => getSaleCategoryAvailability(q.get("user_id")),
  "app/sale/my-listings": (q) => getMyListings(q.get("user_id")),
  "app/sale/listing-progress": (q) => getListingProgress(q.get("listing_id"), q.get("user_id")),
  "app/projects/applications": (q) => getMyProjectApplications(q.get("user_id")),
  "app/projects/application-progress": (q) =>
    getProjectApplicationProgress(q.get("application_id"), q.get("user_id")),
  "app/orders/mine": (q) => getMyOrders(q.get("user_id")),
  // Order screen: subtotal, discount and why, and whether the address is deliverable.
  "app/orders/quote": (q) => getOrderQuote(q),
  "app/orders/detail": (q) => getAppOrderDetail(q.get("order_id"), q.get("user_id")),
  // Notifications inbox, home partner strip, market overview.
  "app/notifications": (q) => getInbox(q.get("user_id")),
  "app/community/quota": async (q) => ({ posts_left_today: await postsLeftToday(q.get("user_id")) }),
  "app/partners": () => getAppPartners(),
  "app/market/overview": (q) => getAppMarketOverview(q.get("user_id")),
  "admin/notifications/status": () => notificationStatus(),
  "admin/dashboard/overview": () => getDashboardOverview(),
  // `target`/`target_id`, not `resource`/`id`: a bare ?id= means "one record"
  // to the generic resolver and would never reach this handler.
  // The console's act-for-a-farmer console: who they are, and what the
  // platform would refuse to let them do.
  "admin/farmers/search": (q) => searchFarmers(q.get("q"), Number(q.get("limit") ?? 20) || 20),
  "admin/farmer-file": (q) => getFarmerFile(q.get("user_id")),
  "admin/delete-impact": (q) => getDeleteImpact(q.get("target"), q.get("target_id")),
  // The dependent rows behind one relation, for the modal's "View" disclosure.
  "admin/delete-impact/rows": (q) => getDeleteImpactRows(q.get("target"), q.get("target_id"), q.get("relation")),
  "admin/notifications/audience": (q) =>
    audienceSummary(q.get("target") ?? "all", (q.get("roles") ?? "").split(",").filter(Boolean), (q.get("user_ids") ?? "").split(",").filter(Boolean)),
  // Catalogue sticker: is the first-purchase offer still this buyer's.
  "app/promotions/status": (q) => getPromotionStatus(q.get("user_id")),
  "admin/sale/listing-workflow": (q) => getListingWorkflow(q.get("listing_id")),
  "admin/sale/pricing/overlaps": () => getPricingOverlaps(),
  "app/admin/inventory": () => getInventoryOverview(),
  "app/admin/stats": () => getAdminStats(),
  "community/posts": (q) => getAppCommunityPosts(q.get("scope"), q.get("district"), q.get("filter"), q.get("user_id")),
  "community/officers": (q) => getAppOfficers(q.get("user_id")),
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
  "app/finance/readiness/questions": (q) => getReadinessQuestions(q.get("user_id")),
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
  "app/finance/loan-account": (q) => getLoanAccount(q.get("user_id")!),

  // Admin finance aggregates. Staff-only via ADMIN_ONLY in lib/api-access.ts.
  "admin/loan/dashboard": () => getCreditDashboard(),
  "admin/loan/queue": (q) => getLoanQueue(q),
  "admin/loan/questionnaire/integrity": () => getQuestionnaireIntegrity(),
  "admin/loan/scorecard/integrity": () => getScorecardIntegrity(),
  "admin/loan/assessment": (q) => getAssessment(q.get("application_id") ?? ""),
  "admin/loan/workspace": (q) => getLoanWorkspace(q.get("application_id") ?? ""),
  "admin/loan/collections": (q) => getCollections(q),
  // Role decides whether factor-level output is included at all (ADM-LON-24), so
  // it is threaded through the query rather than read from the handler.
  "admin/loan/mpoweru": (q) => getMpowerUStatus(q.get("application_id") ?? "", q.get("__role") ?? ""),
  "admin/loan/lenders/pipeline": (q) => getLenderPipeline(q),
  "admin/loan/notifications": (q) => getNotificationQueue(q),
  "admin/users/clear-records/preview": (q) =>
    previewUserRecords(
      q.get("identifier") ?? "",
      q.get("datasets") ? (q.get("datasets")!.split(",").filter(Boolean) as DatasetKey[]) : undefined
    )
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

const CODED_STATUS: Record<string, number> = {
  geo_locked: 403,
  change_pending: 409,
  location_required: 422,
  zone_inactive: 403,
  invalid_geo: 400,
  promo_invalid: 422,
  // Shathi Apa: a busy model is the server's problem, not a bad request.
  apa_busy: 503,
  apa_unconfigured: 503,
  apa_timeout: 504,
  apa_failed: 502
};

// Creations a farmer makes inherit the farmer's approved location, at the
// feature's geo scope. The client's own location fields are discarded.
const GEO_INHERIT: Record<string, GeoFeature> = {
  "sale/listings": "sale_listings",
  "community/posts": "community_posts",
  "community/reports": "community_posts"
};

// A farmer who has not verified is not an error. The refusal carries the whole
// unlock screen — the steps, how many are done, what verification buys — so the
// app renders the state the server decided rather than a hard-coded guess at it.
function apaLocked(error: ApaLockedError) {
  const status = error.code === "apa_disabled" ? 503 : error.code === "apa_live_unavailable" ? 409 : 403;
  return NextResponse.json(
    { ok: false, message: error.message, code: error.code, entitlement: error.entitlement },
    { status }
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
    // A refusal the app handles specifically keeps its code: geo_locked opens
    // the "outside your area" screen, change_pending the "under review" state,
    // location_required the prompt to finish the profile.
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && CODED_STATUS[code]) {
      // A masked model failure carries how long to wait, where the upstream
      // told us. The app counts that down and keeps its retry button disabled
      // until it reaches zero, which is the difference between "try again
      // later" and a button that works when pressed.
      const wait = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
      const seconds = typeof wait === "number" && Number.isFinite(wait) ? Math.ceil(wait) : null;
      return NextResponse.json(
        { ok: false, message, code, ...(seconds ? { retry_after: seconds } : {}) },
        {
          status: CODED_STATUS[code],
          ...(seconds ? { headers: { "Retry-After": String(seconds) } } : {})
        }
      );
    }
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

// Where the phone should fetch a file this request produced. Built from the
// forwarded host so the URL is reachable by the caller — a phone on the LAN in
// development, the production domain in a release build — rather than from the
// address the server happens to be bound to.
function requestOrigin(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (request.nextUrl.protocol === "https:" ? "https" : "http");
  return `${proto}://${host}`;
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
        user_id: searchParams.get("user_id"),
        district: searchParams.get("district"),
        weight: searchParams.get("weight"),
        meat_weight: searchParams.get("meat_weight")
      });
      return envelope(quote, { source: "mysql", surface: "app", resource });
    } catch (error) {
      return dbError(error);
    }
  }

  // ---- Shathi Apa ---------------------------------------------------------
  if (resource.startsWith("app/apa/") || resource.startsWith("admin/apa/")) {
    try {
      switch (resource) {
        case "app/apa/entitlement":
          return envelope(await getApaEntitlement(searchParams.get("user_id")), { source: "mysql", surface: "app", resource });
        case "app/apa/conversations":
          return envelope(
            id
              ? await getApaConversation(searchParams.get("user_id"), id)
              : await getApaConversations(searchParams.get("user_id"), Number(searchParams.get("limit") ?? 20)),
            { source: "mysql", surface: "app", resource }
          );
        case "app/apa/settings":
          return envelope(await getApaSettings(searchParams.get("user_id")), { source: "mysql", surface: "app", resource });
        case "admin/apa/conversations":
          return envelope(
            id
              ? await getApaConsoleConversation(id)
              : await getApaConsoleConversations({
                  q: searchParams.get("q"),
                  filter: searchParams.get("filter"),
                  district: searchParams.get("district"),
                  limit: Number(searchParams.get("limit") ?? 50)
                }),
            { source: "mysql", surface: "admin", resource }
          );
        case "admin/apa/scope-review":
          return envelope(
            await getApaScopeReview({ verdict: searchParams.get("verdict"), limit: Number(searchParams.get("limit") ?? 60) }),
            { source: "mysql", surface: "admin", resource }
          );
        case "admin/apa/vocabulary":
          return envelope(await getApaVocabulary({ group: searchParams.get("group"), q: searchParams.get("q") }), {
            source: "mysql", surface: "admin", resource
          });
        case "admin/apa/config":
          return envelope(await getApaVoiceConfig(), { source: "mysql", surface: "admin", resource });
        case "admin/apa/usage":
          return envelope(await getApaUsage({ months: Number(searchParams.get("months") ?? 6) }), {
            source: "mysql", surface: "admin", resource
          });
        case "admin/apa/access":
          return envelope(
            await getApaAccess({ q: searchParams.get("q"), tier: searchParams.get("tier"), limit: Number(searchParams.get("limit") ?? 50) }),
            { source: "mysql", surface: "admin", resource }
          );
        case "app/apa/speech-config":
          return envelope(await appSpeechConfig(), { source: "mysql", surface: "app", resource });
        case "admin/apa/quota":
          return envelope(await getApaQuota(), { source: "mysql", surface: "admin", resource });
        case "admin/apa/prompt-versions":
          return envelope(
            id
              ? await getApaPromptVersion(id)
              : await getApaPromptVersions(searchParams.get("prompt_key")),
            { source: "mysql", surface: "admin", resource }
          );
        case "admin/apa/client-errors":
          return NextResponse.json({ ok: true, ...(await getApaClientErrors(Number(searchParams.get("limit") ?? 60))) });
        case "admin/apa/feedback":
          return envelope(
            await getApaFeedback({ vote: searchParams.get("vote"), state: searchParams.get("state"), limit: Number(searchParams.get("limit") ?? 60) }),
            { source: "mysql", surface: "admin", resource }
          );
      }
    } catch (error) {
      if (error instanceof ApaLockedError) return apaLocked(error);
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

  // The lender pack. Not an appReadHandler because a CSV export is not an
  // envelope — the browser needs a text/csv body with a filename.
  if (resource === "admin/loan/lenders/pack") {
    if (caller.kind !== "admin") return forbidden("Lender packs are staff-only.");
    const format = (searchParams.get("format") ?? "json").toLowerCase();
    try {
      const pack = await buildLenderPack(searchParams.get("application_id") ?? "", {
        adminId: caller.admin.id,
        ip: clientIp(request),
        lenderId: searchParams.get("lender_id") ? Number(searchParams.get("lender_id")) : null,
        action: format === "csv" ? "export_csv" : "view",
      });
      if (format === "csv") {
        return new NextResponse(packToCsv(pack), {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="lender-pack-${pack.identity.application_code}.csv"`,
          },
        });
      }
      return envelope(pack, { source: "mysql", surface: "admin", resource });
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
      return envelope(await getAppMarketUpdates(searchParams.get("user_id")), { source: "mysql", surface: "app", resource });
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
      // A handler that filters its response by admin role reads it from here.
      // Set rather than merged from the client: `__role` arriving in the query
      // string must never be able to widen what a caller is shown.
      searchParams.set("__role", caller.kind === "admin" ? caller.admin.role : "");
      const data = await appReadHandlers[resource](searchParams);
      // `?? []` used to be the default here, which turned a handler's deliberate
      // `null` — "this user has no readiness assessment" — into an empty array.
      // An empty array is truthy, so the app read it as a result and rendered a
      // result screen against it. Nullish stays nullish; list handlers already
      // return arrays and are unaffected.
      return envelope(data ?? null, { source: "mysql", surface: "app", resource });
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
          await getHomeFeed(searchParams.get("user_id"), searchParams.get("gps_district_id"), searchParams.get("gps_upazila_id")),
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
      // Which datasets to clear is now the caller's choice. Defaulting to the
      // two finance ones matches why this exists — re-running a loan or
      // readiness flow against the same number — and means a careless call
      // cannot take the whole account with it.
      const rawDatasets = (payload as Record<string, unknown>).datasets;
      const datasets = Array.isArray(rawDatasets)
        ? (rawDatasets.map(String) as DatasetKey[])
        : (["loan", "readiness", "sessions"] as DatasetKey[]);
      const known = new Set(DATASETS.map((d) => d.key));
      const unknown = datasets.filter((d) => !known.has(d));
      if (unknown.length) return dbError(new Error(`Unknown dataset: ${unknown.join(", ")}`));

      const result = await clearUserRecords(
        identifier,
        {
          datasets,
          resetOnboarding: (payload as Record<string, unknown>).reset_onboarding !== false,
          resetRoles: (payload as Record<string, unknown>).reset_roles === true,
        },
        { adminId: caller.admin.id, ip: clientIp(request), userAgent: request.headers.get("user-agent") }
      );
      return NextResponse.json({ ok: true, source: "mysql", action: "records_cleared", result }, { status: 200 });
    }

    // ---- Lender packs and submissions (P6 / §20.1) --------------------------
    if (exact === "admin/loan/lenders/submit" || exact === "admin/loan/lenders/decision") {
      if (caller.kind !== "admin" || !LENDER_ROLES.includes(caller.admin.role)) {
        return forbidden("Lender submissions are restricted to credit staff.");
      }
      const ctx = { adminId: caller.admin.id, ip: clientIp(request), userAgent: request.headers.get("user-agent") };
      const body = payload as Record<string, unknown>;
      const result = exact === "admin/loan/lenders/submit"
        ? await submitToLender(body, ctx)
        : await recordLenderDecision(body, ctx);
      return NextResponse.json({ ok: true, source: "mysql", action: "lender", result }, { status: 200 });
    }

    // ---- Champion/challenger (ENG-34) ---------------------------------------
    if (exact === "admin/loan/scorecard/shadow-run") {
      const CREDIT_ROLES = ["super_admin", "hq_admin", "credit_analyst", "credit_approver"];
      if (caller.kind !== "admin" || !CREDIT_ROLES.includes(caller.admin.role)) {
        return forbidden("Running a shadow comparison is restricted to credit staff.");
      }
      const result = await runShadowComparison(payload as Record<string, unknown>, caller.admin.id);
      return NextResponse.json({ ok: true, source: "mysql", action: "shadow_compared", result }, { status: 200 });
    }

    // ---- Notifications (§23) -------------------------------------------------
    if (exact === "admin/loan/notifications/queue" || exact === "admin/loan/notifications/dispatch") {
      const NOTIFY_ROLES = ["super_admin", "hq_admin", "credit_approver", "credit_analyst"];
      if (caller.kind !== "admin" || !NOTIFY_ROLES.includes(caller.admin.role)) {
        return forbidden("Sending finance notifications is restricted to credit staff.");
      }
      const ctx = { adminId: caller.admin.id, ip: clientIp(request), userAgent: request.headers.get("user-agent") };
      const result = exact === "admin/loan/notifications/queue"
        ? await queueRepaymentReminders(ctx)
        : await dispatchFinanceNotifications(ctx);
      return NextResponse.json({ ok: true, source: "mysql", action: "notifications", result }, { status: 200 });
    }

    // ---- mPowerU (P5) — stub driver until EcoDev supply a sandbox -----------
    if (exact === "admin/loan/mpoweru/start" || exact === "admin/loan/mpoweru/sync" || exact === "admin/loan/mpoweru/poll") {
      const MPOWERU_ROLES = ["super_admin", "hq_admin", "credit_analyst", "credit_approver", "field_officer"];
      if (caller.kind !== "admin" || !MPOWERU_ROLES.includes(caller.admin.role)) {
        return forbidden("Behavioural assessments are restricted to staff.");
      }
      const ctx = {
        adminId: caller.admin.id, ip: clientIp(request), userAgent: request.headers.get("user-agent"),
      };
      const body = payload as Record<string, unknown>;
      const result =
        exact === "admin/loan/mpoweru/start" ? await startMpowerUSession(body, ctx)
        : exact === "admin/loan/mpoweru/sync" ? await syncMpowerUSession(String(body.provider_session_id ?? ""), ctx)
        : await pollPendingMpowerUSessions(ctx);
      return NextResponse.json({ ok: true, source: "mpoweru", action: "mpoweru", result }, { status: 200 });
    }

    // ---- Disbursement, repayment, collections (P6) --------------------------
    // Disbursement is the moment money leaves, so it is the narrowest permission
    // in the finance surface: approver and above, never the analyst who scored
    // the file and never the officer who collected the evidence.
    if (exact === "admin/loan/disburse") {
      if (caller.kind !== "admin" || !mayDisburse(caller.admin.role)) {
        return forbidden("Disbursing a loan is restricted to credit approvers.");
      }
      const result = await disburseLoan(payload as Record<string, unknown>, {
        adminId: caller.admin.id, ip: clientIp(request), userAgent: request.headers.get("user-agent"),
      });
      return NextResponse.json({ ok: true, source: "mysql", action: "disbursed", result }, { status: 201 });
    }

    if (exact === "admin/loan/repayment" || exact === "admin/loan/arrears/refresh") {
      if (caller.kind !== "admin" || !COLLECT_ROLES.includes(caller.admin.role)) {
        return forbidden("Recording repayments is restricted to credit and field staff.");
      }
      const ctx = {
        adminId: caller.admin.id, ip: clientIp(request), userAgent: request.headers.get("user-agent"),
      };
      const result = exact === "admin/loan/repayment"
        ? await recordRepayment(payload as Record<string, unknown>, ctx)
        : await refreshAllArrears(ctx);
      return NextResponse.json({ ok: true, source: "mysql", action: "recorded", result }, { status: 200 });
    }

    // ---- Loan workspace capture (P3) ----------------------------------------
    // Field officers own data capture (§18.3), so the write roles are wider than
    // scoring — but never wider than staff.
    // Repeating rows: assets, existing debt, documents, field visits.
    if (exact.startsWith("admin/loan/rows/")) {
      const CAPTURE_ROLES = ["super_admin", "hq_admin", "credit_analyst", "credit_approver", "field_officer"];
      if (caller.kind !== "admin" || !CAPTURE_ROLES.includes(caller.admin.role)) {
        return forbidden("Capturing loan evidence is restricted to staff.");
      }
      const collection = exact.slice("admin/loan/rows/".length);
      if (!isRowCollection(collection)) {
        return dbError(new Error(`Unknown workspace collection "${collection}".`));
      }
      const result = await saveWorkspaceRow(collection, payload as Record<string, unknown>, {
        adminId: caller.admin.id, ip: clientIp(request), userAgent: request.headers.get("user-agent"),
      });
      return NextResponse.json({ ok: true, source: "mysql", action: "saved", result }, { status: 200 });
    }

    if (exact === "admin/loan/evidence" || exact === "admin/loan/verification" || exact === "admin/loan/development-plan") {
      const CAPTURE_ROLES = ["super_admin", "hq_admin", "credit_analyst", "credit_approver", "field_officer"];
      if (caller.kind !== "admin" || !CAPTURE_ROLES.includes(caller.admin.role)) {
        return forbidden("Capturing loan evidence is restricted to staff.");
      }
      const ctx = {
        adminId: caller.admin.id,
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent"),
      };
      const body = payload as Record<string, unknown>;
      const result =
        exact === "admin/loan/evidence" ? await saveLoanEvidence(body, ctx)
        : exact === "admin/loan/verification" ? await saveFieldVerification(body, ctx)
        : await assignDevelopmentTasks(body, ctx);
      return NextResponse.json({ ok: true, source: "mysql", action: "saved", result }, { status: 200 });
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
      // `filed_by_admin` is decided here, from the session, so an app caller
      // cannot ask to skip the GPS check-in by putting it in the body.
      const result = await createLoanApplication({
        ...(payload as Record<string, unknown>),
        filed_by_admin: caller.kind === "admin"
      });
      if (caller.kind === "admin") {
        await recordAudit({
          actorAdminId: caller.admin.id,
          action: "loan_application_filed_for_farmer",
          entityType: "loan_application",
          entityId: String((result as Record<string, unknown>)?.id ?? ""),
          after: { user_id: (payload as Record<string, unknown>).user_id ?? null },
          ip: clientIp(request),
          userAgent: request.headers.get("user-agent")
        });
      }
      return NextResponse.json({ ok: true, source: "mysql", action: "application_created", result }, { status: 201 });
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
    // ---- Notifications ------------------------------------------------------
    if (exact === "app/community/share-listing") {
      const p = payload as Record<string, unknown>;
      return NextResponse.json({
        ok: true,
        action: "listing_shared",
        result: await shareListingToCommunity(p.user_id, p.listing_id, p.note)
      });
    }
    if (exact === "app/notifications/read") {
      const p = payload as Record<string, unknown>;
      return NextResponse.json({ ok: true, action: "notifications_read", result: await markRead(p.user_id, p.id) });
    }
    if (exact === "app/push/register") {
      const p = payload as Record<string, unknown>;
      return NextResponse.json({ ok: true, action: "push_registered", result: await registerDevice(p.user_id, p) });
    }
    if (exact === "app/push/unregister") {
      const p = payload as Record<string, unknown>;
      return NextResponse.json({ ok: true, action: "push_unregistered", result: await unregisterDevice(p.user_id, p.token) });
    }
    if (exact === "app/me/lang") {
      const p = payload as Record<string, unknown>;
      return NextResponse.json({ ok: true, action: "lang_saved", result: await setAppLang(p.user_id, p.lang) });
    }
    if (exact === "admin/notifications/preview") {
      if (caller.kind !== "admin") return forbidden();
      const p = payload as Record<string, unknown>;
      return NextResponse.json({ ok: true, result: previewTemplate((p.template ?? {}) as Record<string, unknown>, p.lang === "en" ? "en" : "bn") });
    }
    if (exact === "admin/notifications/test") {
      if (caller.kind !== "admin") return forbidden();
      const p = payload as Record<string, unknown>;
      return NextResponse.json({ ok: true, result: await testTemplate(String(p.event_key ?? ""), p.user_id) });
    }
    if (exact === "admin/notifications/broadcast") {
      if (caller.kind !== "admin") return forbidden("Only staff can send notifications.");
      const result = await sendBroadcast(payload as unknown as BroadcastInput, caller.admin.id);
      await recordAudit({
        actorAdminId: caller.admin.id,
        action: "broadcast_sent",
        entityType: "broadcast",
        entityId: result.broadcast_id,
        after: result,
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent")
      });
      return NextResponse.json({ ok: true, action: "broadcast_sent", result });
    }
    // ---- App-side AI help that is not the assistant -----------------------
    // The listing writer, the photo reader, the article summariser and every
    // read-aloud button. They lived on the phone with the key until now.
    if (exact.startsWith("app/ai/")) {
      const p = payload as Record<string, unknown>;
      switch (exact) {
        case "app/ai/speak":
          return NextResponse.json({
            ok: true,
            action: "ai_speak",
            result: await appSpeak({ ...p, origin: requestOrigin(request) })
          });
        case "app/ai/summarize":
          return NextResponse.json({ ok: true, action: "ai_summarize", result: await appSummarize(p) });
        case "app/ai/listing-description":
          return NextResponse.json({ ok: true, action: "ai_listing_description", result: await appListingDescription(p) });
        case "app/ai/analyze-photo":
          return NextResponse.json({ ok: true, action: "ai_analyze_photo", result: await appAnalyzePhoto(p) });
      }
    }

    // ---- Shathi Apa -------------------------------------------------------
    if (exact.startsWith("app/apa/") || exact.startsWith("admin/apa/")) {
      const p = payload as Record<string, unknown>;
      try {
        switch (exact) {
          case "app/apa/ask": {
            const mode = String(p.mode ?? "text");
            const result = await askApa({
              userId: String(p.user_id ?? ""),
              mode: mode === "voice" || mode === "photo" ? mode : "text",
              text: p.text ? String(p.text) : null,
              audio: p.audio && typeof p.audio === "object"
                ? {
                    data: String((p.audio as Record<string, unknown>).data ?? ""),
                    mimeType: String((p.audio as Record<string, unknown>).mime_type ?? "audio/m4a")
                  }
                : null,
              imageUrl: p.image_url ? String(p.image_url) : null,
              conversationId: p.conversation_id ? Number(p.conversation_id) : null,
              speakAnswer: p.speak === true,
              // The phone reports whether it found a Bangla voice of its own.
              // No voice installed is the only reason the server synthesises.
              needsServerSpeech: p.needs_server_speech === true,
              lang: p.lang === "en" ? "en" : "bn",
              origin: requestOrigin(request),
              ip: clientIp(request)
            });
            return NextResponse.json({ ok: true, action: "apa_answer", result });
          }
          case "app/apa/live/start":
            return NextResponse.json({
              ok: true,
              action: "apa_live_started",
              result: await startLiveSession({
                userId: String(p.user_id ?? ""),
                conversationId: p.conversation_id ? Number(p.conversation_id) : null,
                ip: clientIp(request)
              })
            });
          case "app/apa/live/connected":
            await markLiveConnected(Number(p.session_id ?? 0), String(p.user_id ?? ""));
            return NextResponse.json({ ok: true, action: "apa_live_connected" });
          case "app/apa/live/close":
            return NextResponse.json({
              ok: true,
              action: "apa_live_closed",
              result: await closeLiveSession({
                sessionId: Number(p.session_id ?? 0),
                userId: String(p.user_id ?? ""),
                seconds: Number(p.seconds ?? 0),
                bytes: Number(p.bytes ?? 0),
                reason: String(p.reason ?? "ended"),
                resumed: Number(p.resumed ?? 0)
              })
            });
          case "app/apa/live/transcript":
            return NextResponse.json({
              ok: true,
              action: "apa_live_transcript",
              result: {
                saved: await saveLiveTranscript({
                  userId: String(p.user_id ?? ""),
                  sessionId: Number(p.session_id ?? 0),
                  turns: Array.isArray(p.turns) ? (p.turns as Array<{ role: "user" | "assistant"; text: string }>) : []
                })
              }
            });
          case "app/apa/feedback":
            return NextResponse.json({ ok: true, action: "apa_feedback", result: await submitApaFeedback(p) });
          case "app/apa/settings":
            return NextResponse.json({ ok: true, action: "apa_settings_saved", result: await saveApaSettings(p) });
          case "app/apa/client-error":
            // Fire-and-forget from the phone. Always 200, because a diagnostics
            // channel that can fail the screen it is diagnosing is worse than
            // none at all.
            return NextResponse.json({
              ok: true,
              action: "apa_client_error",
              result: await reportApaClientError({ ...p, user_id: String(p.user_id ?? caller.user?.id ?? "") })
            });
          case "app/apa/history/clear":
            return NextResponse.json({ ok: true, action: "apa_history_cleared", result: await clearApaHistory(String(p.user_id ?? "")) });
        }

        if (caller.kind !== "admin") return forbidden("The Shathi Apa console is staff-only.");
        switch (exact) {
          case "admin/apa/conversation/flag":
            return NextResponse.json({
              ok: true,
              result: await flagApaConversation(String(p.id ?? ""), p.flagged !== false, caller.admin.id)
            });
          case "admin/apa/scope-correct":
            return NextResponse.json({ ok: true, result: await correctApaScope(p, caller.admin.id) });
          case "admin/apa/vocabulary":
            return NextResponse.json({ ok: true, result: await saveApaVocabulary(p, caller.admin.id) });
          case "admin/apa/config":
            return NextResponse.json({ ok: true, result: await saveApaVoiceConfig(p, caller.admin.id) });
          case "admin/apa/grant":
            return NextResponse.json({ ok: true, result: await grantApaTier(p, caller.admin.id) });
          case "admin/apa/prewarm":
            return NextResponse.json({ ok: true, result: await prewarmApaAnswer(p) });
          case "admin/apa/quota/reset":
            return NextResponse.json({ ok: true, result: await resetApaQuotaHints(caller.admin.id) });
          case "admin/apa/prompt-revert":
            return NextResponse.json({ ok: true, result: await revertApaPrompt(p, caller.admin.id) });
          case "admin/apa/feedback/review":
            return NextResponse.json({ ok: true, result: await reviewApaFeedback(p, caller.admin.id) });
        }
      } catch (error) {
        if (error instanceof ApaLockedError) return apaLocked(error);
        return dbError(error);
      }
    }

    if (exact === "admin/ai/assist") {
      if (caller.kind !== "admin") return forbidden("Only staff can use AI assistance.");
      if (!isAiConfigured()) {
        return NextResponse.json({ ok: false, message: "AI assistance is not configured on this server." }, { status: 503 });
      }
      try {
        const result = await runAssist(payload as unknown as AssistRequest);
        return NextResponse.json({ ok: true, action: "ai_assist", task: (payload as Record<string, unknown>).task, result });
      } catch (error) {
        // A model or quota failure is the admin's problem to see, not a 500.
        return NextResponse.json(
          { ok: false, message: error instanceof Error ? error.message : "The AI request failed." },
          { status: 422 }
        );
      }
    }
    if (exact === "admin/partners/reorder") {
      if (caller.kind !== "admin") return forbidden();
      return NextResponse.json({ ok: true, result: await reorderPartners((payload as Record<string, unknown>).ids) });
    }
    if (exact === "admin/sale/listing-workflow") {
      if (caller.kind !== "admin") return forbidden("Only staff can move a listing through its steps.");
      const p = payload as Record<string, unknown>;
      const result = await saveListingWorkflow(p, caller.admin.id);
      await recordAudit({
        actorAdminId: caller.admin.id,
        action: `listing_${String(p.action ?? "update")}`,
        entityType: "sale_listing",
        entityId: String(p.listing_id ?? ""),
        after: { status: result?.listing?.status ?? null },
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent")
      });
      return NextResponse.json({ ok: true, source: "mysql", action: "listing_workflow", result });
    }
    if (exact === "admin/profile-requests/review") {
      if (caller.kind !== "admin") return forbidden("Only staff can review profile changes.");
      const p = payload as Record<string, unknown>;
      const result = await reviewProfileChangeRequest(p.id, p.decision, p.note, caller.admin.id);
      await recordAudit({
        actorAdminId: caller.admin.id,
        action: `profile_change_${result.status}`,
        entityType: "profile_change_request",
        entityId: result.id,
        after: { user_id: result.user_id, note: p.note ?? null },
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent")
      });
      return NextResponse.json({ ok: true, source: "mysql", action: "profile_change_reviewed", result }, { status: 200 });
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
    if (exact === "app/community/notice") {
      if (caller.kind !== "admin") return forbidden("Only staff can post an official notice.");
      const result = await postCommunityNotice(payload as Record<string, unknown>, caller.admin.id);
      await recordAudit({
        actorAdminId: caller.admin.id,
        action: "community_notice_posted",
        entityType: "community_post",
        entityId: result.id,
        after: { scope: result.scope, reach: result.reach },
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent")
      });
      return NextResponse.json({ ok: true, action: "notice_posted", result }, { status: 201 });
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
      const result = await placeOrder(payload);
      // An order a staff member placed for a farmer is worth being able to find.
      if (caller.kind === "admin") {
        await recordAudit({
          actorAdminId: caller.admin.id,
          action: "order_placed_for_farmer",
          entityType: "order",
          entityId: String((result as Record<string, unknown>)?.id ?? ""),
          after: {
            user_id: (payload as Record<string, unknown>).user_id ?? null,
            order_code: (result as Record<string, unknown>)?.order_code ?? null
          },
          ip: clientIp(request),
          userAgent: request.headers.get("user-agent")
        });
      }
      return NextResponse.json({ ok: true, source: "mysql", action: "order_placed", result }, { status: 201 });
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
      // Listing needs field coverage at the listing scope's level.
      if (caller.kind === "app" && resource === "sale/listings") {
        await assertOperational(caller.user.id, "sale_listings");
      }
      const input: Record<string, unknown> = caller.kind === "app" && GEO_INHERIT[resource]
        ? { ...(await inheritUserGeo(GEO_INHERIT[resource], payload as Record<string, unknown>, caller.user.id)) }
        : { ...(payload as Record<string, unknown>) };
      if (resource === "sale/listings" && !input.pricing_rule_id) {
        // Record the rule the farmer was quoted on, so the console can show
        // which price rule a listing is attached to.
        const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
        const quote = await getSalePriceQuote({
          animal_id: str(input.animal_id),
          breed_id: str(input.breed_id),
          sale_item_id: str(input.sale_item_id),
          user_id: caller.kind === "app" ? String(caller.user.id) : str(input.user_id)
        });
        if (quote.rule) input.pricing_rule_id = quote.rule.id;
      }
      if (resource === "community/posts" && caller.kind === "app") {
        // Three posts per person per day. The platform's own milestone posts
        // carry is_system and are exempt; an app caller cannot set either flag.
        await assertCanPost(caller.user.id);
        delete input.is_system;
        delete input.is_official;
      }
      const result = await createResource(resource, input);
      if (resource === "sale/listings" && caller.kind === "app" && result?.insertId) {
        await notifyListing(result.insertId, "listing_submitted");
        // A new listing announces itself in the regional feed.
        await postListingMilestone(result.insertId, "submitted");
      }
      const warnings = resource === "sale/pricing" && result?.insertId ? await pricingWarningsFor(result.insertId) : [];
      return NextResponse.json({ ok: true, source: "mysql", action: "created", resource, result, warnings }, { status: 201 });
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
      // A price rule save reports any active rule it now overlaps.
      const warnings = resource === "sale/pricing" ? await pricingWarningsFor(id) : [];
      return NextResponse.json({ ok: true, source: "mysql", action: "updated", resource, id, result, warnings });
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
      // A price rule save reports any active rule it now overlaps.
      const warnings = resource === "sale/pricing" ? await pricingWarningsFor(id) : [];
      return NextResponse.json({ ok: true, source: "mysql", action: "updated", resource, id, result, warnings });
    } catch (error) {
      return dbError(error);
    }
  }
  return unknownResource("PATCH", resource);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const context = await resolveResourceContext(params, request);
  const resource = context.resource;
  const { deny, caller } = await guard(request, resource, "DELETE");
  if (deny) return deny;
  const payload = await request.json().catch(() => ({}));
  const id = context.id ?? String((payload as Record<string, unknown>).id ?? "");
  // The console asks for this only after showing the admin the blocking rows
  // and having them tick a box; the rows cleared are the ones the FK graph
  // reports as blocking, never a table named in the request.
  const cascade = request.nextUrl.searchParams.get("cascade") === "1";
  if (hasDbResource(resource)) {
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing id for delete." }, { status: 400 });
    }
    try {
      const cleared = cascade ? await clearDeleteBlockers(resource, id) : [];
      const result = await deleteResource(resource, id);
      if (caller?.kind === "admin") {
        await recordAudit({
          actorAdminId: caller.admin.id,
          action: cascade ? "record_deleted_cascade" : "record_deleted",
          entityType: resource,
          entityId: id,
          before: cascade ? { cleared } : undefined,
          ip: clientIp(request),
          userAgent: request.headers.get("user-agent")
        });
      }
      return NextResponse.json({ ok: true, source: "mysql", action: "deleted", resource, id, result, cleared });
    } catch (error) {
      return dbError(error);
    }
  }
  return unknownResource("DELETE", resource);
}
