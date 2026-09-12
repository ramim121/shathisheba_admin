import { queryRows, withTransaction } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import type { Row } from "./shared";
import { DATASETS, WIPE_PLAN, type DatasetKey } from "@/lib/clear-records-datasets";

export { DATASETS };

// Account maintenance — "Clear Records".
//
// Wipes everything an app user has *done* while leaving the account and its
// basic profile intact, so the same phone number can be taken through a flow
// repeatedly during testing without re-registering.
//
// Deliberate choices:
//   * The account row itself is never deleted, and neither are name, phone,
//     district or profile image.
//   * Child rows are removed explicitly, oldest-dependency-first, rather than
//     relying on ON DELETE CASCADE — half the relevant foreign keys are
//     NO ACTION, so a cascade would silently leave orders, listings, posts and
//     partner applications behind.
//   * The whole wipe is one transaction. A partially-cleared account is worse
//     than an uncleared one, because it looks clean while still failing the
//     "one active application" guard.
//   * Every run is audit-logged with the per-table counts, since this is a
//     destructive operation on real user data.

export type { DatasetKey } from "@/lib/clear-records-datasets";

export type ClearScope = {
  /** Datasets to clear. Empty means nothing is deleted. */
  datasets: DatasetKey[];
  /** Also reset the onboarding gates so the app treats the account as new. */
  resetOnboarding: boolean;
  /** Also drop granted roles (login re-grants the buyer role automatically). */
  resetRoles: boolean;
};

export type ClearResult = {
  user: { id: string; full_name: string | null; phone: string | null };
  deleted: { table: string; rows: number }[];
  total: number;
  reset: string[];
};

/** Preview what a wipe would remove, without removing anything. */
export async function previewUserRecords(identifier: string, datasets?: DatasetKey[]) {
  const user = await findUser(identifier);
  const counts: { table: string; rows: number }[] = [];
  // No selection means "show me everything that exists", which is what the
  // console wants before any box has been ticked.
  const wanted = datasets && datasets.length ? new Set(datasets) : null;

  for (const step of WIPE_PLAN) {
    if (wanted && !wanted.has(step.dataset)) continue;
    const countSql = step.sql.replace(/^DELETE FROM (\S+)/, "SELECT COUNT(*) AS n FROM $1");
    try {
      const rows = await queryRows<Row>(countSql, [user.id]);
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) counts.push({ table: step.table, rows: n });
    } catch {
      // A table that does not exist in this environment is simply skipped.
    }
  }
  if (!wanted || wanted.has("sessions")) {
    const sessions = await queryRows<Row>("SELECT COUNT(*) AS n FROM app_sessions WHERE user_id = ?", [user.id]);
    if (Number(sessions[0]?.n ?? 0) > 0) counts.push({ table: "app_sessions", rows: Number(sessions[0].n) });
  }

  return {
    user: { id: String(user.id), full_name: user.full_name as string, phone: user.phone as string },
    deleted: counts,
    total: counts.reduce((s, c) => s + c.rows, 0),
    reset: [],
  } satisfies ClearResult;
}

/** Perform the wipe. Requires the caller to have already confirmed. */
export async function clearUserRecords(
  identifier: string,
  scope: ClearScope,
  actor: { adminId?: number | string | null; ip?: string | null; userAgent?: string | null }
): Promise<ClearResult> {
  const user = await findUser(identifier);
  const deleted: { table: string; rows: number }[] = [];
  const reset: string[] = [];

  const wanted = new Set(scope.datasets ?? []);
  if (wanted.size === 0 && !scope.resetOnboarding && !scope.resetRoles) {
    throw new Error("Choose at least one dataset to clear.");
  }

  await withTransaction(async (tx) => {
    for (const step of WIPE_PLAN) {
      if (!wanted.has(step.dataset)) continue;
      try {
        const res = await tx.execute(step.sql, [user.id]);
        if (res.affectedRows > 0) deleted.push({ table: step.table, rows: res.affectedRows });
      } catch (error) {
        // Never swallow silently: a table we cannot clear means the account is
        // not actually fresh, and the caller must know which one.
        throw new Error(
          `Could not clear ${step.table}: ${error instanceof Error ? error.message : "unknown error"}`
        );
      }
    }

    // Sessions last, so the phone is logged out only once the wipe has
    // committed rather than mid-way through.
    if (wanted.has("sessions")) {
      const sess = await tx.execute("DELETE FROM app_sessions WHERE user_id = ?", [user.id]);
      if (sess.affectedRows > 0) deleted.push({ table: "app_sessions", rows: sess.affectedRows });
      const otp = await tx.execute("DELETE FROM app_otps WHERE phone = ?", [user.phone]);
      if (otp.affectedRows > 0) deleted.push({ table: "app_otps", rows: otp.affectedRows });
    }

    if (scope.resetOnboarding) {
      // Clears the gates the app routes on, so the next login walks the full
      // first-run journey again. Name, phone, district and photo are untouched.
      await tx.execute(
        `UPDATE app_users
            SET personal_info_completed = 0,
                is_kyc_verified = 0,
                nid_number = NULL,
                profile_json = NULL
          WHERE id = ?`,
        [user.id]
      );
      reset.push("onboarding gates", "preferences", "KYC verified flag");
    }
    if (scope.resetRoles) {
      await tx.execute("DELETE FROM app_user_roles WHERE user_id = ?", [user.id]);
      reset.push("roles (buyer is re-granted on next login)");
    }
  });

  await recordAudit({
    actorAdminId: actor.adminId ?? null,
    action: "app_user.clear_records",
    entityType: "app_user",
    entityId: user.id as number,
    before: { phone: user.phone, full_name: user.full_name },
    after: { deleted, reset, total: deleted.reduce((s, d) => s + d.rows, 0) },
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });

  return {
    user: { id: String(user.id), full_name: user.full_name as string, phone: user.phone as string },
    deleted,
    total: deleted.reduce((s, d) => s + d.rows, 0),
    reset,
  };
}

async function findUser(identifier: string): Promise<Row> {
  const key = String(identifier ?? "").trim();
  if (!key) throw new Error("Provide a phone number or user id.");
  const rows = await queryRows<Row>(
    "SELECT id, full_name, phone FROM app_users WHERE phone = ? OR id = ? LIMIT 1",
    [key, /^\d+$/.test(key) ? Number(key) : 0]
  );
  const user = rows[0];
  if (!user) throw new Error(`No account found for '${key}'.`);
  return user;
}
