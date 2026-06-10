import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/me -> current admin (or 401). Used by AdminShell to show identity
// and to bounce to /login when the cookie is missing or expired.
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, admin });
}
