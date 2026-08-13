import { queryRows } from "@/lib/db";

// Types and helpers shared by more than one endpoint domain. Kept separate so
// the domain modules form a directed graph rather than importing each other in
// a ring.

export type Row = Record<string, unknown>;

export type AppRole = string;

// A user's granted roles, used by the auth handshake and by the approvals
// console when it grants the seller role.
export async function getUserRoles(userId: string | number): Promise<AppRole[]> {
  const rows = await queryRows<Row>("SELECT role FROM app_user_roles WHERE user_id = ? ORDER BY role", [userId]);
  return rows.map((r) => r.role as AppRole);
}

// Tolerant JSON parse for TEXT/JSON columns that may hold a string, already-
// parsed object, or nothing at all.
export function safeJson(value: unknown): Row | null {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value) as Row;
  } catch {
    return null;
  }
}
