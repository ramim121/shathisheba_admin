import { NextRequest, NextResponse } from "next/server";
import { queryRows, executeQuery } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { requireAdmin } from "@/lib/admin-auth";

const ROLES = ["super_admin", "hq_admin", "marketplace_manager", "content_editor", "field_officer", "auditor"];

type AdminListRow = {
  id: number; name: string; email: string; phone: string | null;
  role: string; district: string | null; upazila: string | null;
  is_active: number; last_login_at: string | null; created_at: string;
};

// GET /api/admin/users -> list admin users (auth required).
export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  const rows = await queryRows<AdminListRow>(
    `SELECT id, name, email, phone, role, district, upazila, is_active, last_login_at, created_at
       FROM admin_users ORDER BY created_at DESC`
  );
  return NextResponse.json({ ok: true, data: rows });
}

// POST /api/admin/users -> create a new admin user (auth required).
// Body: { name, email, password, role?, phone?, district?, upazila? }
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  if (admin.role !== "super_admin" && admin.role !== "hq_admin") {
    return NextResponse.json({ ok: false, message: "Only super_admin / hq_admin can add admins." }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, string>;
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const role = ROLES.includes(body.role) ? body.role : "hq_admin";
  if (!name || !email || password.length < 4) {
    return NextResponse.json({ ok: false, message: "name, email and a password (4+ chars) are required." }, { status: 400 });
  }
  const existing = await queryRows<{ id: number }>("SELECT id FROM admin_users WHERE email = ? LIMIT 1", [email]);
  if (existing.length) {
    return NextResponse.json({ ok: false, message: "An admin with this email already exists." }, { status: 409 });
  }
  const result = await executeQuery(
    `INSERT INTO admin_users (name, email, phone, password_hash, role, district, upazila, is_active)
     VALUES (?,?,?,?,?,?,?,1)`,
    [name, email, body.phone || null, hashPassword(password), role, body.district || null, body.upazila || null]
  );
  return NextResponse.json({ ok: true, id: result.insertId, admin: { id: result.insertId, name, email, role } }, { status: 201 });
}
