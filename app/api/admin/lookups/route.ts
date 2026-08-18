import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getLookupOptions, isLookupKey } from "@/lib/admin-lookups";

// GET /api/admin/lookups?keys=animals,breeds
//
// Feeds the named dropdowns on the admin forms. Several fields on one form each
// need their own list, so the route takes a comma-separated set and answers in
// one round trip rather than N.
//
// Staff-only: these lists name every farmer, officer and listing in the system.
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ ok: false, message: "Admin session required." }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get("keys") ?? "";
  const keys = raw
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key && isLookupKey(key));

  const entries = await Promise.all(
    keys.map(async (key) => [key, await getLookupOptions(key)] as const)
  );

  return NextResponse.json({ ok: true, data: Object.fromEntries(entries) });
}
