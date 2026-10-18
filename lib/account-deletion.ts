import { randomBytes } from "node:crypto";
import { executeQuery, queryRows, withTransaction, type Tx } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { collectStrings, removeStoredFiles, type FileRemovalSummary } from "@/lib/stored-files";

/**
 * Deleting an app account — the in-app button, the public web page and the
 * console all end here.
 *
 * The owner's rule, and Google Play's: the person is erased now; the records a
 * business is obliged to keep (orders, sales and payments, loans and
 * repayments, project ledgers) stay for five years with nothing left in them
 * that says who they were about.
 *
 * So there are three kinds of work, all in ONE transaction — a half-deleted
 * account is the worst outcome, because it looks deleted while still holding
 * the NID:
 *
 *   ERASE      rows that are only about the person: sessions, codes, devices,
 *              notifications, KYC, banking, farm, interests, training, profile
 *              changes, readiness checks, roles, community posts and comments,
 *              Shathi Apa conversations, behavioural sessions, coaching tasks,
 *              loan documents, and the decision snapshots that copied any of it.
 *   CLOSE      work still in motion that can no longer finish without the
 *              person: unfinished loan applications are withdrawn and their
 *              consents revoked; open sale listings are cancelled. Anything
 *              where money has already moved (a disbursed loan, a contracted
 *              or shipped sale, a confirmed order) keeps its status for staff
 *              to settle.
 *   STRIP      the kept records lose every identifying and free-text field —
 *              contact name, phone, NID, addresses, photos, documents, GPS
 *              points, notes — and keep amounts, dates, statuses and areas.
 *
 * The account row is kept, anonymised: phone becomes a unique placeholder (so
 * the number can register again as a new, empty account), every personal
 * column is cleared, status becomes 'deleted'. It has to stay — orders,
 * listings and partner applications reference it through NO ACTION keys.
 *
 * Files (KYC scans, photos, contracts) are removed after the commit, best-effort
 * (lib/stored-files.ts): storage failing must not leave the database half-done.
 *
 * Nothing written here — account_deletions, the audit entry — carries a name,
 * a phone number or an address.
 */

export type DeletionVia = "app" | "web" | "admin";
export type AccountDeletionResult = { deleted: true; retention_until: string };

export const RETENTION_YEARS = 5;

type Row = Record<string, unknown>;
type Ctx = { userId: number; phone: string };
// `uncounted`: a step that adjusts other people's rows (a comment count) and is
// not itself something erased or kept.
type Step = { table: string; sql: string; params?: (c: Ctx) => unknown[]; uncounted?: true };

const byUser = (c: Ctx) => [c.userId];

const APPS = "SELECT id FROM loan_applications WHERE user_id = ?";
const LISTINGS = "SELECT id FROM sale_listings WHERE user_id = ?";
const ORDERS = "SELECT id FROM orders WHERE user_id = ?";

const inList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

// Loan applications that have not reached money. Withdrawn on deletion: an
// application nobody can be contacted about must not keep moving towards a
// lender. Disbursed, repaying and finished ones are the five-year record.
const LOAN_OPEN = [
  "draft", "submitted", "kyc_in_progress", "field_verification", "behavioral_pending",
  "under_assessment", "assessed", "development_required", "project_matched",
  "pending_submission", "submitted_to_lender", "lender_review", "info_requested", "approved"
] as const;

// Listings still being offered. A cancelled listing stops appearing in the
// regional "for sale" feed and in the officers' visit queue.
const LISTING_OPEN = ["draft", "submitted", "field_verification", "verified"] as const;

// Files the account's records point at, collected before anything is cleared.
const FILE_REFS: string[] = [
  "SELECT profile_image_url FROM app_users WHERE id = ?",
  "SELECT document_url FROM app_user_kyc_documents WHERE user_id = ?",
  "SELECT requested_json FROM profile_change_requests WHERE user_id = ?",
  "SELECT image_url FROM community_posts WHERE user_id = ? AND is_official = 0",
  "SELECT image_url FROM apa_messages WHERE user_id = ?",
  "SELECT evidence_url FROM development_plan_tasks WHERE user_id = ?",
  "SELECT media_json FROM sale_listings WHERE user_id = ?",
  `SELECT photos_json FROM listing_field_verifications WHERE listing_id IN (${LISTINGS})`,
  `SELECT contract_file_url, documents_json FROM listing_contracts WHERE listing_id IN (${LISTINGS})`,
  `SELECT documents_json FROM listing_shipments WHERE listing_id IN (${LISTINGS})`,
  `SELECT document_url FROM listing_vaccinations WHERE listing_id IN (${LISTINGS})`,
  `SELECT file_key FROM loan_documents WHERE application_id IN (${APPS})`,
  `SELECT photo_url, document_url FROM loan_field_verifications WHERE application_id IN (${APPS})`,
  `SELECT photo_url, evidence_url FROM loan_assets WHERE application_id IN (${APPS})`
];

const ERASE: Step[] = [
  // Decision snapshots are full copies of the row that was decided — for a
  // 'user' decision, the whole account row with its phone and NID.
  { table: "approval_snapshots", sql: "DELETE FROM approval_snapshots WHERE item_type = 'user' AND item_id = ?" },
  { table: "approval_snapshots", sql: "DELETE FROM approval_snapshots WHERE item_type = 'kyc' AND item_id IN (SELECT id FROM app_user_kyc_documents WHERE user_id = ?)" },
  { table: "approval_snapshots", sql: `DELETE FROM approval_snapshots WHERE item_type = 'order' AND item_id IN (${ORDERS})` },
  { table: "approval_snapshots", sql: `DELETE FROM approval_snapshots WHERE item_type = 'listing' AND item_id IN (${LISTINGS})` },
  { table: "approval_snapshots", sql: "DELETE FROM approval_snapshots WHERE item_type = 'enrollment' AND item_id IN (SELECT id FROM partner_applications WHERE user_id = ?)" },

  // Signing in. With the sessions gone every token the phone holds is dead.
  { table: "app_sessions", sql: "DELETE FROM app_sessions WHERE user_id = ?" },
  { table: "app_otps", sql: "DELETE FROM app_otps WHERE phone = ?", params: (c) => [c.phone] },
  { table: "push_devices", sql: "DELETE FROM push_devices WHERE user_id = ?" },

  // What was sent to her.
  { table: "user_notifications", sql: "DELETE FROM user_notifications WHERE user_id = ?" },
  { table: "notification_outbox", sql: "DELETE FROM notification_outbox WHERE user_id = ?" },
  { table: "finance_notifications", sql: "DELETE FROM finance_notifications WHERE user_id = ?" },

  // Profile modules.
  { table: "app_user_kyc_documents", sql: "DELETE FROM app_user_kyc_documents WHERE user_id = ?" },
  { table: "app_user_banking", sql: "DELETE FROM app_user_banking WHERE user_id = ?" },
  { table: "app_user_farm", sql: "DELETE FROM app_user_farm WHERE user_id = ?" },
  { table: "user_interests", sql: "DELETE FROM user_interests WHERE user_id = ?" },
  { table: "user_learning_progress", sql: "DELETE FROM user_learning_progress WHERE user_id = ?" },
  { table: "profile_change_requests", sql: "DELETE FROM profile_change_requests WHERE user_id = ?" },
  { table: "app_user_roles", sql: "DELETE FROM app_user_roles WHERE user_id = ?" },

  // The readiness self-check.
  { table: "readiness_answers", sql: "DELETE FROM readiness_answers WHERE assessment_id IN (SELECT id FROM readiness_assessments WHERE user_id = ?)" },
  { table: "readiness_assessments", sql: "DELETE FROM readiness_assessments WHERE user_id = ?" },

  // Community: her own posts and comments. A staff notice attributed to the
  // account (postCommunityNotice falls back to an app user as author) is not
  // hers and stays. Her comments come off other people's comment counts first.
  {
    table: "community_posts",
    uncounted: true,
    sql: `UPDATE community_posts p
            JOIN (SELECT community_post_id, COUNT(*) AS n FROM community_comments
                   WHERE user_id = ? GROUP BY community_post_id) c ON c.community_post_id = p.id
             SET p.comment_count = GREATEST(p.comment_count - c.n, 0)`
  },
  { table: "community_comments", sql: "DELETE FROM community_comments WHERE user_id = ?" },
  { table: "community_comments", sql: "DELETE FROM community_comments WHERE community_post_id IN (SELECT id FROM community_posts WHERE user_id = ? AND is_official = 0)" },
  // Her reports on other people's posts, the reports on her own posts (which
  // go with them), and her blocks in both directions.
  { table: "community_post_reports", sql: "DELETE FROM community_post_reports WHERE reporter_user_id = ?" },
  { table: "community_post_reports", sql: "DELETE FROM community_post_reports WHERE post_id IN (SELECT id FROM community_posts WHERE user_id = ? AND is_official = 0)" },
  { table: "community_user_blocks", sql: "DELETE FROM community_user_blocks WHERE ? IN (blocker_user_id, blocked_user_id)" },
  { table: "community_posts", sql: "DELETE FROM community_posts WHERE user_id = ? AND is_official = 0" },

  // Behavioural assessment, coaching tasks, and the documents on her loan files.
  { table: "mpoweru_sessions", sql: "DELETE FROM mpoweru_sessions WHERE user_id = ?" },
  { table: "development_plan_tasks", sql: "DELETE FROM development_plan_tasks WHERE user_id = ?" },
  { table: "loan_documents", sql: `DELETE FROM loan_documents WHERE application_id IN (${APPS})` },

  // Shathi Apa: questions, transcripts, photos, answers, feedback, the scope
  // log of her questions. apa_usage and apa_app_ai_calls stay: they are cost
  // accounting with no content, and the monthly budget is computed from them.
  { table: "apa_feedback", sql: "DELETE FROM apa_feedback WHERE user_id = ?" },
  { table: "apa_tool_calls", sql: "DELETE FROM apa_tool_calls WHERE user_id = ?" },
  { table: "apa_scope_log", sql: "DELETE FROM apa_scope_log WHERE user_id = ?" },
  { table: "apa_messages", sql: "DELETE FROM apa_messages WHERE user_id = ?" },
  { table: "apa_live_sessions", sql: "DELETE FROM apa_live_sessions WHERE user_id = ?" },
  { table: "apa_conversations", sql: "DELETE FROM apa_conversations WHERE user_id = ?" },
  { table: "apa_starters", sql: "DELETE FROM apa_starters WHERE user_id = ?" },
  { table: "apa_entitlements", sql: "DELETE FROM apa_entitlements WHERE user_id = ?" },
  { table: "apa_client_errors", sql: "DELETE FROM apa_client_errors WHERE user_id = ?" }
];

const CLOSE: Step[] = [
  {
    table: "loan_application_events",
    sql: `INSERT INTO loan_application_events (application_id, from_status, to_status, actor_type, note_bn, note_en)
          SELECT id, status, 'withdrawn', 'system',
                 'আবেদনকারী অ্যাকাউন্ট মুছে ফেলেছেন — আবেদন প্রত্যাহার করা হয়েছে।',
                 'Withdrawn — the applicant deleted their account.'
            FROM loan_applications WHERE user_id = ? AND status IN (${inList(LOAN_OPEN)})`
  },
  {
    table: "loan_applications",
    sql: `UPDATE loan_applications SET status = 'withdrawn', pending_user_action = NULL
           WHERE user_id = ? AND status IN (${inList(LOAN_OPEN)})`
  },
  {
    table: "loan_consents",
    sql: "UPDATE loan_consents SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = ? AND status = 'granted'"
  },
  {
    table: "sale_listings",
    sql: `UPDATE sale_listings
             SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()),
                 cancel_reason = 'The seller deleted their account.'
           WHERE user_id = ? AND status IN (${inList(LISTING_OPEN)})`
  }
];

const STRIP: Step[] = [
  // Buying: what was bought, for how much, when — not where it went.
  { table: "orders", sql: "UPDATE orders SET delivery_address = '', notes = NULL WHERE user_id = ?" },
  { table: "order_events", sql: `UPDATE order_events SET note = NULL WHERE note IS NOT NULL AND order_id IN (${ORDERS})` },
  { table: "order_promotions", sql: "UPDATE order_promotions SET note = NULL WHERE user_id = ? AND note IS NOT NULL" },
  { table: "user_vouchers", sql: "UPDATE user_vouchers SET note = NULL WHERE user_id = ? AND note IS NOT NULL" },

  // Selling. Animal attributes, weights, prices and the buyer business stay.
  {
    table: "sale_listings",
    sql: `UPDATE sale_listings
             SET contact_name = NULL, contact_phone = NULL, contact_nid = NULL, address_text = NULL,
                 media_json = NULL, description = NULL, ai_analysis_json = NULL, field_visit_note = NULL
           WHERE user_id = ?`
  },
  { table: "listing_field_verifications", sql: `UPDATE listing_field_verifications SET photos_json = NULL WHERE listing_id IN (${LISTINGS})` },
  {
    table: "listing_contracts",
    sql: `UPDATE listing_contracts
             SET signed_by = NULL, handover_signed_by = NULL, contract_file_url = NULL, documents_json = NULL,
                 notes = NULL, handover_note = NULL, receive_note = NULL
           WHERE listing_id IN (${LISTINGS})`
  },
  { table: "listing_shipments", sql: `UPDATE listing_shipments SET from_address = NULL, documents_json = NULL, condition_note = NULL WHERE listing_id IN (${LISTINGS})` },
  { table: "listing_vaccinations", sql: `UPDATE listing_vaccinations SET document_url = NULL, notes = NULL WHERE listing_id IN (${LISTINGS})` },
  { table: "payment_confirmations", sql: `UPDATE payment_confirmations SET otp_code = NULL WHERE sale_listing_id IN (${LISTINGS})` },

  // Partner projects: the enrolment and its ledger stay, the identity goes.
  {
    table: "partner_applications",
    sql: `UPDATE partner_applications
             SET full_name_per_nid = NULL, nid_number = NULL, mobile_banking_provider = NULL,
                 banking_json = NULL, farm_assessment_json = NULL, verification_notes = NULL,
                 field_visit_note = NULL, progress_note = NULL
           WHERE user_id = ?`
  },

  // Loans: amounts, terms, scores, verdicts and the repayment history stay;
  // free text, GPS points, photos and the names of people do not. Event notes
  // are cleared BEFORE the CLOSE step adds its own (impersonal) withdrawal note.
  {
    table: "loan_applications",
    sql: "UPDATE loan_applications SET purpose_text = NULL, needs_correction_note = NULL, checkin_lat = NULL, checkin_lng = NULL WHERE user_id = ?"
  },
  {
    table: "loan_application_events",
    sql: `UPDATE loan_application_events
             SET note_bn = NULL, note_en = NULL, actor_name = IF(actor_type = 'user', NULL, actor_name)
           WHERE application_id IN (${APPS})`
  },
  {
    table: "loan_field_verifications",
    sql: `UPDATE loan_field_verifications
             SET comment = NULL, photo_url = NULL, document_url = NULL, gps_lat = NULL, gps_lng = NULL
           WHERE application_id IN (${APPS})`
  },
  { table: "loan_field_visits", sql: `UPDATE loan_field_visits SET gps_lat = NULL, gps_lng = NULL, note = NULL WHERE application_id IN (${APPS})` },
  {
    table: "loan_evidence",
    sql: `UPDATE loan_evidence SET value_text = NULL, value_json = NULL, source_reference = NULL, discrepancy_note = NULL
           WHERE application_id IN (${APPS})`
  },
  {
    table: "loan_assets",
    sql: `UPDATE loan_assets
             SET description = NULL, evidence_url = NULL, photo_url = NULL, gps_lat = NULL, gps_lng = NULL, note = NULL
           WHERE application_id IN (${APPS})`
  },
  // An informal lender is often a relative; lender_name is NOT NULL.
  { table: "loan_existing_debts", sql: `UPDATE loan_existing_debts SET lender_name = '', note = NULL WHERE application_id IN (${APPS})` },
  { table: "loan_safeguards", sql: `UPDATE loan_safeguards SET detail = NULL WHERE application_id IN (${APPS})` },
  {
    table: "lender_submissions",
    sql: `UPDATE lender_submissions SET conditions = NULL, decline_reason_text = NULL, info_requested_text = NULL
           WHERE application_id IN (${APPS})`
  },
  {
    table: "lender_submission_events",
    sql: `UPDATE lender_submission_events SET note = NULL
           WHERE note IS NOT NULL AND submission_id IN (SELECT id FROM lender_submissions WHERE application_id IN (${APPS}))`
  },
  {
    table: "credit_assessment_criteria",
    sql: `UPDATE credit_assessment_criteria SET override_reason = NULL
           WHERE override_reason IS NOT NULL AND assessment_id IN (SELECT id FROM credit_assessments WHERE user_id = ?)`
  },
  {
    table: "loan_repayments",
    sql: `UPDATE loan_repayments SET note = NULL
           WHERE note IS NOT NULL AND loan_account_id IN (SELECT id FROM loan_accounts WHERE user_id = ?)`
  },

  // "Clear records" audit entries copied the phone number and name.
  {
    table: "audit_logs",
    sql: `UPDATE audit_logs SET before_json = JSON_REMOVE(before_json, '$.phone', '$.full_name')
           WHERE entity_type = 'app_user' AND entity_id = ?
             AND JSON_CONTAINS_PATH(before_json, 'one', '$.phone', '$.full_name')`
  },
  {
    table: "audit_logs",
    sql: `UPDATE audit_logs SET after_json = JSON_REMOVE(after_json, '$.phone', '$.full_name')
           WHERE entity_type = 'app_user' AND entity_id = ?
             AND JSON_CONTAINS_PATH(after_json, 'one', '$.phone', '$.full_name')`
  }
];

type Counts = Record<string, number>;

async function runSteps(tx: Tx, steps: Step[], ctx: Ctx, into: Counts) {
  for (const step of steps) {
    let affected = 0;
    try {
      const res = await tx.execute(step.sql, (step.params ?? byUser)(ctx));
      affected = res.affectedRows;
    } catch (error) {
      // A table this environment has never had holds nothing to erase. Any
      // other failure aborts the whole deletion — a step that silently did not
      // run is a person who silently was not deleted.
      if ((error as { code?: string })?.code === "ER_NO_SUCH_TABLE") continue;
      throw error;
    }
    if (affected > 0 && !step.uncounted) into[step.table] = (into[step.table] ?? 0) + affected;
  }
}

const sum = (c: Counts) => Object.values(c).reduce((s, n) => s + n, 0);

/**
 * Delete an app account. Idempotent: a second call for an account that is
 * already deleted returns the first deletion's retention date.
 */
export async function deleteAccount(
  userId: number | string,
  via: DeletionVia,
  actor: { adminId?: number | string | null } = {}
): Promise<AccountDeletionResult> {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("A valid account is required.");

  const outcome = await withTransaction(async (tx) => {
    // Locked for the whole deletion, so two requests (the app and the web page
    // at once) cannot interleave; the second sees 'deleted' and stops.
    const [user] = await tx.query<Row>("SELECT id, phone, status FROM app_users WHERE id = ? FOR UPDATE", [id]);
    if (!user) throw new Error("Account not found.");
    if (user.status === "deleted") {
      const [prior] = await tx.query<Row>(
        "SELECT id, DATE_FORMAT(retention_until, '%Y-%m-%d') AS retention_until FROM account_deletions WHERE user_id = ? ORDER BY id DESC LIMIT 1",
        [id]
      );
      return { already: true as const, deletionId: Number(prior?.id ?? 0), retentionUntil: String(prior?.retention_until ?? "") };
    }

    const ctx: Ctx = { userId: id, phone: String(user.phone ?? "") };

    // Collect the files before the rows that name them are cleared.
    const refs: string[] = [];
    for (const sql of FILE_REFS) {
      try {
        const rows = await tx.query<Row>(sql, [id]);
        for (const r of rows) collectStrings(Object.values(r), refs);
      } catch (error) {
        if ((error as { code?: string })?.code !== "ER_NO_SUCH_TABLE") throw error;
      }
    }

    const erased: Counts = {};
    const closed: Counts = {};
    const stripped: Counts = {};
    await runSteps(tx, ERASE, ctx, erased);
    await runSteps(tx, STRIP, ctx, stripped);
    await runSteps(tx, CLOSE, ctx, closed);

    // The account row. A placeholder keeps phone NOT NULL UNIQUE satisfied and
    // frees the real number to register again as a new account.
    const placeholder = `deleted-${id}-${randomBytes(4).toString("hex")}`;
    await tx.execute(
      `UPDATE app_users
          SET full_name = 'Deleted user', display_name = NULL, profile_image_url = NULL,
              phone = ?, email = NULL, password_hash = NULL, gender = NULL, date_of_birth = NULL,
              division = NULL, district = NULL, upazila = NULL, union_name = NULL, village = NULL,
              division_id = NULL, district_id = NULL, upazila_id = NULL,
              latitude = NULL, longitude = NULL, nid_number = NULL, profile_json = NULL,
              personal_info_completed = 0, is_kyc_verified = 0, learning_points = 0,
              status = 'deleted', deleted_at = NOW()
        WHERE id = ?`,
      [placeholder, id]
    );

    // The database's date, formatted there, so no JavaScript Date can move it
    // a day across a timezone.
    const [r] = await tx.query<Row>(
      `SELECT DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL ${RETENTION_YEARS} YEAR), '%Y-%m-%d') AS d`
    );
    const retentionUntil = String(r.d);
    const summary = { erased, closed, anonymised: stripped, totals: { erased: sum(erased), closed: sum(closed), anonymised: sum(stripped) } };
    const ins = await tx.execute(
      "INSERT INTO account_deletions (user_id, via, retention_until, summary_json) VALUES (?, ?, ?, ?)",
      [id, via, retentionUntil, JSON.stringify(summary)]
    );
    return { already: false as const, deletionId: ins.insertId, retentionUntil, refs, summary };
  });

  if (outcome.already) {
    return { deleted: true, retention_until: outcome.retentionUntil };
  }

  // After the commit: storage is best-effort and must not hold the rows hostage.
  let files: FileRemovalSummary | { error: string };
  try {
    files = await removeStoredFiles(outcome.refs);
  } catch (error) {
    files = { error: error instanceof Error ? error.message.slice(0, 200) : "file removal failed" };
  }
  try {
    await executeQuery(
      "UPDATE account_deletions SET summary_json = JSON_SET(COALESCE(summary_json, JSON_OBJECT()), '$.files', CAST(? AS JSON)) WHERE id = ?",
      [JSON.stringify(files), outcome.deletionId]
    );
  } catch (error) {
    console.error("account_deletions summary update failed", error);
  }

  // No IP, user agent, name or number: the entry says that an account was
  // deleted, through which door, and how much went.
  await recordAudit({
    actorAdminId: actor.adminId ?? null,
    action: "app_user.account_deleted",
    entityType: "app_user",
    entityId: id,
    after: { via, retention_until: outcome.retentionUntil, ...outcome.summary.totals, files }
  });

  return { deleted: true, retention_until: outcome.retentionUntil };
}

/**
 * The console's door. The administrator must type the account's current phone
 * number, the same guard "Clear records" uses, so a mistyped id cannot delete
 * the wrong person.
 */
export async function deleteAccountAsAdmin(
  userId: unknown,
  confirmPhone: unknown,
  actor: { adminId: number | string }
): Promise<AccountDeletionResult> {
  const id = String(userId ?? "").trim();
  if (!/^\d+$/.test(id)) throw new Error("Provide the account's numeric user_id.");
  const [user] = await queryRows<Row>("SELECT id, phone, status FROM app_users WHERE id = ? LIMIT 1", [id]);
  if (!user) throw new Error("No account has that id.");
  if (user.status !== "deleted" && String(confirmPhone ?? "").trim() !== String(user.phone ?? "")) {
    throw new Error("Type the account's phone number exactly to confirm.");
  }
  return deleteAccount(id, "admin", { adminId: actor.adminId });
}
