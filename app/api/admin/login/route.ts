import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { ADMIN_COOKIE, createAdminSession } from "@/lib/admin-auth";

type AdminRow = { id: number; name: string; email: string; role: string; password_hash: string; is_active: number };

// POST /api/admin/login  { email, password } -> sets httpOnly session cookie.
export async function POST(request: NextRequest) {
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!email || !password) {
    return NextResponse.json({ ok: false, message: "Email and password are required." }, { status: 400 });
  }
  const rows = await queryRows<AdminRow>(
    "SELECT id, name, email, role, password_hash, is_active FROM admin_users WHERE email = ? LIMIT 1",
    [email.trim().toLowerCase()]
  );
  const admin = rows[0];
  if (!admin || !admin.is_active || !verifyPassword(password, admin.password_hash)) {
    return NextResponse.json({ ok: false, message: "Invalid email or password." }, { status: 401 });
  }
  const { token, expires } = await createAdminSession(admin.id, request.headers.get("user-agent"), request.headers.get("x-forwarded-for"));
  const res = NextResponse.json({ ok: true, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expires.replace(" ", "T") + "Z")
  });
  return res;
}
