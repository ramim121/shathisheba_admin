import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { getAdminByToken, ADMIN_COOKIE, type AdminUser } from "@/lib/admin-auth";

// Bearer-token authentication for the mobile app surface (/api/v1/*).
//
// The session row already existed before this module: verifyOtpLogin() inserts
// into app_sessions with a 90-day expiry and hands the token back to the phone,
// which keeps it in AsyncStorage. What was missing was anyone checking it — the
// route trusted a client-supplied ?user_id= instead, so any caller could read or
// write as any user. This module closes that: the phone sends
// `Authorization: Bearer <token>`, and every user-scoped handler takes its
// user_id from the row this resolves, never from the request.
//
// The admin console browses the same /api/v1 surface with ?surface=admin, so an
// admin_session cookie is accepted as a second, higher-privileged caller kind.

export type AppSessionUser = {
  id: number;
  full_name: string | null;
  phone: string | null;
  status: string | null;
  roles: string[];
};

export type Caller =
  | { kind: "app"; user: AppSessionUser; admin: null }
  | { kind: "admin"; user: null; admin: AdminUser }
  | { kind: "anon"; user: null; admin: null };

const ANON: Caller = { kind: "anon", user: null, admin: null };

export function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Resolve a live (unexpired) app session to its user, with roles attached.
export async function getAppUserByToken(token: string | null | undefined): Promise<AppSessionUser | null> {
  if (!token) return null;
  const rows = await queryRows<Omit<AppSessionUser, "roles">>(
    `SELECT u.id, u.full_name, u.phone, u.status
       FROM app_sessions s
       JOIN app_users u ON u.id = s.user_id
      WHERE s.token = ? AND (s.expires_at IS NULL OR s.expires_at > NOW())
      LIMIT 1`,
    [token]
  );
  const user = rows[0];
  if (!user) return null;
  const roleRows = await queryRows<{ role: string }>(
    "SELECT role FROM app_user_roles WHERE user_id = ?",
    [user.id]
  );
  return { ...user, roles: roleRows.map((r) => r.role) };
}

// Identify the caller behind a request: app user (Bearer), admin (cookie), or anonymous.
export async function resolveCaller(request: NextRequest): Promise<Caller> {
  const token = bearerToken(request);
  if (token) {
    const user = await getAppUserByToken(token);
    if (user) return { kind: "app", user, admin: null };
  }
  const admin = await getAdminByToken(request.cookies.get(ADMIN_COOKIE)?.value);
  if (admin) return { kind: "admin", user: null, admin };
  return ANON;
}

export function unauthorized(message = "Authentication required.") {
  return NextResponse.json({ ok: false, message, code: "unauthenticated" }, { status: 401 });
}

export function forbidden(message = "You do not have access to this resource.") {
  return NextResponse.json({ ok: false, message, code: "forbidden" }, { status: 403 });
}

// The user_id a handler should act on. An app caller is pinned to its own
// session — a client-supplied user_id is ignored, not merely validated, so
// there is no parameter to tamper with. An admin may act on any user_id
// (the console legitimately reads other people's records).
export function effectiveUserId(caller: Caller, requested: string | number | null | undefined): string | null {
  if (caller.kind === "app") return String(caller.user.id);
  if (caller.kind === "admin") return requested == null || requested === "" ? null : String(requested);
  return null;
}
