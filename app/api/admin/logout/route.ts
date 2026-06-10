import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, destroyAdminSession } from "@/lib/admin-auth";

// POST /api/admin/logout -> deletes the session row and clears the cookie.
export async function POST(request: NextRequest) {
  await destroyAdminSession(request.cookies.get(ADMIN_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", expires: new Date(0) });
  return res;
}
