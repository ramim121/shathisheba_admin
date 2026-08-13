import type { Caller } from "@/lib/app-auth";

// Access policy for /api/v1/*. Three tiers:
//
//   PUBLIC_READS     reference/lookup data with no personal information, plus the
//                    catalog. Readable before login because the app renders
//                    dropdowns and category tiles on the splash/registration path.
//   PUBLIC_WRITES    the auth bootstrap only — you cannot present a token before
//                    you have one.
//   ADMIN_ONLY       console/back-office surfaces and anything that exposes other
//                    people's records in bulk.
//
// Everything not listed requires an authenticated caller (app user or admin).
// Default-deny is the point: a new resource added to db-resources.ts is private
// until someone deliberately lists it here.

export const PUBLIC_READS = new Set<string>([
  "catalog",
  "settings",
  "faq",
  "weather",
  "interests",
  "app/onboarding",
  "geo/divisions",
  "geo/districts",
  "geo/upazilas",
  "sale/categories",
  "sale/animals",
  "sale/breeds",
  "sale/items",
  "sale/pricing",
  "buy/categories",
  "buy/products",
  "learning/categories",
  "learning/modules",
  "learning/contents",
  "market-updates",
  "app/market-updates"
]);

export const PUBLIC_WRITES = new Set<string>(["app/auth/request-otp", "app/auth/verify-otp"]);

export const ADMIN_ONLY = new Set<string>([
  "admin/users",
  "audit/logs",
  "reports",
  "orders/payments",
  "community/reports",
  "sale/confirmations",
  "app/admin/stats",
  "app/admin/inventory",
  "app/admin/approvals",
  "app/admin/approval",
  "app/admin/approve",
  "app/admin/set-required-docs",
  "app/users-with-roles",
  "app/user-roles/set",
  "app/community/moderation",
  "app/community/moderate",
  "app/community/ai-flag",
  "app/community/ai-scan",
  "app/learning/progress-overview"
]);

// Generic-CRUD tables an authenticated app user may create rows in. Every other
// table is admin-write-only — before this list, any anonymous caller could POST,
// PUT, PATCH or DELETE any of the 29 CRUD-backed tables.
export const APP_WRITABLE_RESOURCES = new Set<string>([
  "sale/listings",
  "buy/orders",
  "orders/items",
  "community/posts",
  "community/comments",
  "community/posts/like",
  "user/interests"
]);

// Collapse instance-scoped paths onto the collection key the policy is written
// against, so `community/posts/42/like` is judged as `community/posts/like`
// rather than falling through to the default deny.
export function policyKey(resource: string): string {
  const like = resource.match(/^community\/posts\/[^/]+\/like$/);
  if (like) return "community/posts/like";
  return resource;
}

// ---------------------------------------------------------------------------
// Administrator roles
//
// admin_users.role has carried six values since migration 017, the console
// renders them, and /api/admin/users restricts who may create an admin — but no
// other surface ever read the field. Every signed-in admin, including an
// `auditor` whose entire purpose is read-only review, could approve loan
// enrolments, confirm orders against stock, change any user's roles and delete
// rows from any table. These are the boundaries that were missing.
//
// A domain not named in a role's grant list is read-only for that role; reads
// stay open to any admin because the console's own navigation assumes it.

export type AdminDomain =
  | "approvals"      // publishing listings, enrolments, order confirmation, KYC
  | "marketplace"    // products, pricing, categories, inventory
  | "content"        // learning, market updates, weather, FAQ, assistant prompts
  | "community"      // moderation
  | "users"          // app users, roles, banking, KYC records
  | "system";        // admin accounts, audit log, geography

// Which write domains each role may act in. `super_admin` is deliberately absent
// from the map and short-circuits to full access below.
const ROLE_GRANTS: Record<string, AdminDomain[]> = {
  hq_admin: ["approvals", "marketplace", "content", "community", "users"],
  marketplace_manager: ["marketplace", "approvals"],
  content_editor: ["content"],
  field_officer: ["approvals"],
  auditor: []
};

// Which domain a resource belongs to, for write purposes.
function domainOf(resource: string): AdminDomain {
  if (resource.startsWith("app/admin/approve") || resource.startsWith("app/admin/set-required-docs")) return "approvals";
  if (resource.startsWith("partners/") || resource.startsWith("sale/confirmations")) return "approvals";
  if (resource.startsWith("sale/") || resource.startsWith("buy/") || resource.startsWith("orders/")) return "marketplace";
  if (resource.startsWith("learning/") || resource.startsWith("market-updates") || resource.startsWith("weather")
      || resource.startsWith("faq") || resource.startsWith("assistant/") || resource.startsWith("interests")) return "content";
  if (resource.startsWith("community/") || resource.startsWith("app/community/")) return "community";
  if (resource.startsWith("users") || resource.startsWith("app/user") || resource.startsWith("user/")) return "users";
  return "system";
}

export function adminMayWrite(role: string | null | undefined, resource: string): boolean {
  if (role === "super_admin") return true;
  const grants = ROLE_GRANTS[role ?? ""];
  if (!grants) return false;
  return grants.includes(domainOf(policyKey(resource)));
}

export type AccessDecision = { allow: true } | { allow: false; reason: "unauthenticated" | "forbidden" };

const ALLOW: AccessDecision = { allow: true };
const NEEDS_AUTH: AccessDecision = { allow: false, reason: "unauthenticated" };
const FORBIDDEN: AccessDecision = { allow: false, reason: "forbidden" };

export function checkAccess(
  caller: Caller,
  rawResource: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
): AccessDecision {
  if (caller.kind === "admin") {
    // Reads stay open to any admin; writes are constrained by role.
    if (method === "GET") return ALLOW;
    return adminMayWrite(caller.admin.role, rawResource) ? ALLOW : FORBIDDEN;
  }
  const resource = policyKey(rawResource);

  if (ADMIN_ONLY.has(resource)) {
    return caller.kind === "anon" ? NEEDS_AUTH : FORBIDDEN;
  }

  if (method === "GET") {
    if (PUBLIC_READS.has(resource)) return ALLOW;
    return caller.kind === "app" ? ALLOW : NEEDS_AUTH;
  }

  if (PUBLIC_WRITES.has(resource)) return ALLOW;
  if (caller.kind === "anon") return NEEDS_AUTH;

  // Authenticated app user. Named app/* actions carry their own ownership checks
  // in app-endpoints.ts; generic table writes are limited to the allowlist, and
  // destructive verbs on generic tables stay with admins.
  if (resource.startsWith("app/")) return ALLOW;
  if (method === "POST" && APP_WRITABLE_RESOURCES.has(resource)) return ALLOW;
  if (resource === "community/posts" && method === "PATCH") return ALLOW;
  return FORBIDDEN;
}
