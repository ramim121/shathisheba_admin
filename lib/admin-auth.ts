import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { queryRows, executeQuery } from "@/lib/db";
import { generateToken } from "@/lib/auth";

// Cookie-based admin authentication. Sessions live in admin_sessions (migration 017)
// and reference admin_users. The mobile app never touches these — it has its own
// app_sessions flow — so this only protects the admin panel + admin-only API.

export const ADMIN_COOKIE = "admin_session";
const SESSION_DAYS = 7;

export type AdminUser = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  district: string | null;
  upazila: string | null;
  is_active: number;
};

function mysqlDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// Create a session row + return its token. Also stamps last_login_at.
export async function createAdminSession(adminUserId: number, userAgent?: string | null, ip?: string | null) {
  const token = generateToken() + generateToken();
  const expires = mysqlDateTime(new Date(Date.now() + SESSION_DAYS * 86400_000));
  await executeQuery(
    "INSERT INTO admin_sessions (admin_user_id, token, user_agent, ip, expires_at) VALUES (?,?,?,?,?)",
    [adminUserId, token, userAgent?.slice(0, 255) ?? null, ip ?? null, expires]
  );
  await executeQuery("UPDATE admin_users SET last_login_at = NOW() WHERE id = ?", [adminUserId]);
  return { token, expires };
}

// Resolve a valid (unexpired, active) admin from a session token.
export async function getAdminByToken(token: string | undefined | null): Promise<AdminUser | null> {
  if (!token) return null;
  const rows = await queryRows<AdminUser>(
    `SELECT a.id, a.name, a.email, a.phone, a.role, a.district, a.upazila, a.is_active
       FROM admin_sessions s
       JOIN admin_users a ON a.id = s.admin_user_id
      WHERE s.token = ? AND s.expires_at > NOW() AND a.is_active = 1
      LIMIT 1`,
    [token]
  );
  return rows[0] ?? null;
}

// Server component / route handler helper — reads the cookie jar.
export async function getCurrentAdmin(): Promise<AdminUser | null> {
  const jar = await cookies();
  return getAdminByToken(jar.get(ADMIN_COOKIE)?.value);
}

// API guard: returns the admin or null (caller returns 401). Reads the request cookie.
export async function requireAdmin(request: NextRequest): Promise<AdminUser | null> {
  return getAdminByToken(request.cookies.get(ADMIN_COOKIE)?.value);
}

export async function destroyAdminSession(token: string | undefined | null) {
  if (!token) return;
  await executeQuery("DELETE FROM admin_sessions WHERE token = ?", [token]);
}
