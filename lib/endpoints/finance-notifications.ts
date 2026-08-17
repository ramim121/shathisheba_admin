// Repayment and lifecycle notifications — SRS §23, §16E.3.
//
// A queue rather than a fire-and-forget send. An SMS that failed silently is
// indistinguishable from one nobody read, and repayment reminders are exactly
// where that difference costs money — the farmer who was never reminded and the
// farmer who ignored the reminder need different follow-up.
//
// Deduplication is by a natural key rather than a timestamp window: one
// notification per user, kind and subject per day. Without it a retry, a second
// cron run, or a manual "send reminders" click sends the same message twice, and
// people who get duplicate messages learn to ignore all of them.

import { queryRows, withTransaction, type Tx } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { sendSms, isSmsDevMode } from "@/lib/sms";
import type { Row } from "./shared";

type Ctx = { adminId: number | null; ip?: string | null; userAgent?: string | null };

const taka = (v: unknown) => `৳${Number(v ?? 0).toLocaleString("en-BD", { maximumFractionDigits: 0 })}`;

const isoDay = (value: unknown): string => {
  const d = value instanceof Date ? value : new Date(String(value));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Build the reminder set for today. Three windows, because they need different
 * words: a nudge, a due-today, and an overdue that names the number of days.
 */
export async function queueRepaymentReminders(ctx: Ctx) {
  // Lateness is read from the due date, not from `days_past_due`.
  //
  // That column is a cache refreshed by a repayment or the arrears job, so a loan
  // disbursed against a back-dated schedule — or any loan whose refresh has not
  // run yet — still carries 0 there while being weeks overdue. Reminding people
  // based on a stale cache means the farmers who most need the reminder are
  // exactly the ones who do not get it.
  //
  // `effective_dpd` is computed here for the same reason, and the message quotes
  // it rather than the column.
  const due = await queryRows<Row>(
    `SELECT acc.id AS account_id, acc.user_id, acc.application_id,
            acc.next_due_date, acc.next_due_amount, acc.overdue_amount,
            u.full_name, a.application_code,
            DATEDIFF(acc.next_due_date, CURDATE()) AS days_until,
            GREATEST(DATEDIFF(CURDATE(), acc.next_due_date), 0) AS effective_dpd
     FROM loan_accounts acc
     JOIN app_users u ON u.id = acc.user_id
     JOIN loan_applications a ON a.id = acc.application_id
     WHERE acc.status = 'active'
       AND acc.next_due_date IS NOT NULL
       AND acc.outstanding_total > 0
       AND (DATEDIFF(acc.next_due_date, CURDATE()) IN (3, 0)
            OR acc.next_due_date < CURDATE())`
  );

  let queued = 0;
  let skipped = 0;

  for (const r of due) {
    const daysUntil = Number(r.days_until);
    const dpd = Number(r.effective_dpd);

    let kind: string;
    let bodyBn: string;
    let bodyEn: string;

    if (dpd > 0) {
      kind = "overdue";
      // The overdue figure can lag the same way the day count does, so fall back
      // to the instalment amount rather than telling someone ৳0 is overdue.
      const amount = Number(r.overdue_amount) > 0 ? r.overdue_amount : r.next_due_amount;
      bodyBn = `শাথী সেবা: আপনার ${taka(amount)} কিস্তি ${dpd} দিন বকেয়া। অনুগ্রহ করে পরিশোধ করুন বা কর্মকর্তার সঙ্গে যোগাযোগ করুন।`;
      bodyEn = `Shathi Sheba: ${taka(amount)} is ${dpd} days overdue. Please pay or contact your officer.`;
    } else if (daysUntil === 0) {
      kind = "due_today";
      bodyBn = `শাথী সেবা: আজ আপনার ${taka(r.next_due_amount)} কিস্তির তারিখ।`;
      bodyEn = `Shathi Sheba: your instalment of ${taka(r.next_due_amount)} is due today.`;
    } else {
      kind = "due_soon";
      bodyBn = `শাথী সেবা: ${isoDay(r.next_due_date)} তারিখে আপনার ${taka(r.next_due_amount)} কিস্তি দিতে হবে।`;
      bodyEn = `Shathi Sheba: your instalment of ${taka(r.next_due_amount)} is due on ${isoDay(r.next_due_date)}.`;
    }

    // The due date is part of the key, not today's date. A reminder for the same
    // instalment is the same reminder whenever it is generated — which is what
    // stops a re-run from sending it again.
    const dedupeKey = `${kind}:${r.account_id}:${isoDay(r.next_due_date)}:${dpd > 0 ? isoDay(new Date()) : "x"}`;

    const result = await queryRows<Row>(
      `INSERT IGNORE INTO finance_notifications
         (user_id, application_id, loan_account_id, kind, channel, body_bn, body_en, dedupe_key)
       VALUES (?,?,?,?, 'sms', ?, ?, ?)`,
      [r.user_id, r.application_id, r.account_id, kind, bodyBn, bodyEn, dedupeKey]
    );
    // INSERT IGNORE reports 0 affected rows when the dedupe key already existed.
    if ((result as unknown as { affectedRows?: number }).affectedRows === 0) skipped += 1;
    else queued += 1;
  }

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: "finance.notifications.queue",
    entityType: "finance_notifications",
    after: { candidates: due.length, queued, skipped },
  });

  return { candidates: due.length, queued, skipped };
}

/** Queue a one-off lifecycle notification (assessed, disbursed, plan assigned). */
export async function queueFinanceNotification(input: {
  userId: number;
  applicationId?: number | null;
  kind: string;
  bodyBn: string;
  bodyEn: string;
  dedupeKey: string;
}) {
  await queryRows(
    `INSERT IGNORE INTO finance_notifications
       (user_id, application_id, kind, channel, body_bn, body_en, dedupe_key)
     VALUES (?,?,?, 'sms', ?, ?, ?)`,
    [input.userId, input.applicationId ?? null, input.kind, input.bodyBn, input.bodyEn, input.dedupeKey]
  );
}

/**
 * Send what is queued.
 *
 * A failure marks the row `failed` with the reason and increments `attempts`
 * rather than throwing — one unreachable number must not stop the batch, and the
 * row stays visible for whoever asks why a farmer says they were never told.
 */
export async function dispatchFinanceNotifications(ctx: Ctx, limit = 100) {
  const pending = await queryRows<Row>(
    `SELECT n.id, n.user_id, n.kind, n.body_bn, n.body_en, n.attempts, u.phone
     FROM finance_notifications n
     JOIN app_users u ON u.id = n.user_id
     WHERE n.status = 'queued' AND n.scheduled_for <= NOW() AND n.attempts < 3
     ORDER BY n.scheduled_for LIMIT ?`,
    [limit]
  );

  let sent = 0;
  let failed = 0;

  for (const n of pending) {
    const phone = String(n.phone ?? "");
    if (!phone) {
      await withTransaction(async (tx: Tx) => {
        await tx.execute(
          "UPDATE finance_notifications SET status = 'skipped', last_error = 'No phone number on the account' WHERE id = ?",
          [n.id]
        );
      });
      continue;
    }

    try {
      // Bangla is the farmer's language; the English copy is for the console.
      const result = await sendSms(phone, String(n.body_bn));
      await withTransaction(async (tx: Tx) => {
        await tx.execute(
          `UPDATE finance_notifications
              SET status = ?, attempts = attempts + 1, sent_at = NOW(), last_error = ?
            WHERE id = ?`,
          [result.ok ? "sent" : "failed", result.ok ? null : String(result.raw ?? "SMS gateway refused").slice(0, 400), n.id]
        );
      });
      if (result.ok) sent += 1; else failed += 1;
    } catch (error) {
      await withTransaction(async (tx: Tx) => {
        await tx.execute(
          "UPDATE finance_notifications SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?",
          [String((error as Error).message ?? error).slice(0, 400), n.id]
        );
      });
      failed += 1;
    }
  }

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: "finance.notifications.dispatch",
    entityType: "finance_notifications",
    after: { attempted: pending.length, sent, failed, dev_mode: isSmsDevMode() },
  });

  return { attempted: pending.length, sent, failed, dev_mode: isSmsDevMode() };
}

export async function getNotificationQueue(params: URLSearchParams) {
  const status = params.get("status");
  const where = status ? "WHERE n.status = ?" : "";
  const args = status ? [status] : [];

  const rows = await queryRows<Row>(
    `SELECT CAST(n.id AS CHAR) AS id, n.kind, n.status, n.attempts, n.body_en,
            n.last_error, n.scheduled_for, n.sent_at, u.full_name AS farmer, u.phone
     FROM finance_notifications n JOIN app_users u ON u.id = n.user_id
     ${where} ORDER BY n.id DESC LIMIT 200`,
    args
  );
  const summary = await queryRows<Row>(
    "SELECT status, COUNT(*) AS n FROM finance_notifications GROUP BY status"
  );
  return { rows, summary };
}
