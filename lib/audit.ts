import { executeQuery } from "@/lib/db";

// audit_logs has existed since migration 001 and was exposed as a read-only admin
// resource, but nothing ever inserted into it — the approval console could change
// a farmer's status, publish a listing or confirm an order with no record of who
// did it. These helpers are the writers.
//
// Auditing must never break the action it is recording: a failed insert is
// swallowed (and logged to the server console) rather than rolling back an
// approval that otherwise succeeded.

export type AuditEntry = {
  actorAdminId?: number | string | null;
  action: string;
  entityType: string;
  entityId?: number | string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

function asJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function asId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await executeQuery(
      `INSERT INTO audit_logs
         (actor_admin_id, action, entity_type, entity_id, before_json, after_json, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        asId(entry.actorAdminId),
        entry.action.slice(0, 120),
        entry.entityType.slice(0, 100),
        asId(entry.entityId),
        asJson(entry.before),
        asJson(entry.after),
        entry.ip?.slice(0, 64) ?? null,
        entry.userAgent?.slice(0, 1000) ?? null
      ]
    );
  } catch (error) {
    console.error("audit write failed", entry.action, entry.entityType, error);
  }
}
