import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { ADMIN_COOKIE, createAdminSession } from "@/lib/admin-auth";
import { recordAudit } from "@/lib/audit";

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
  const ip = request.headers.get("x-forwarded-for");
  const userAgent = request.headers.get("user-agent");
  if (!admin || !admin.is_active || !verifyPassword(password, admin.password_hash)) {
    // Failed attempts are recorded too — a run of them against one account is
    // the signal you want in the log, and it is missing if only wins are kept.
    await recordAudit({
      actorAdminId: admin?.id ?? null,
      action: "admin.login.failed",
      entityType: "admin_user",
      entityId: admin?.id ?? null,
      after: { email: email.trim().toLowerCase() },
      ip,
      userAgent
    });
    return NextResponse.json({ ok: false, message: "Invalid email or password." }, { status: 401 });
  }
  const { token, expires } = await createAdminSession(admin.id, userAgent, ip);
  await recordAudit({
    actorAdminId: admin.id,
    action: "admin.login",
    entityType: "admin_user",
    entityId: admin.id,
    after: { email: admin.email, role: admin.role },
    ip,
    userAgent
  });
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
