// Disbursement, repayment and collections — SRS §16E, §16F.2–16F.3, §20.2.
//
// This is the part where money actually moves, so the invariants are stricter
// than anywhere else in the codebase:
//
//   * Terms are SNAPSHOTTED at disbursement (DAT-04 / ADM-LON-44). A live loan
//     reads its rate, tenure and instalment from `loan_accounts`, never from
//     `loan_products`. Repricing a product must not silently reprice somebody's
//     outstanding loan.
//
//   * SUM(schedule.amount_due) == account.total_payable, exactly (DAT-05). The
//     pricing engine asserts this before the rows are written; if it ever throws
//     the disbursement fails rather than creating a loan whose instalments do not
//     add up to what was borrowed.
//
//   * A payment is allocated oldest-due-first and never over-allocated. Money
//     that arrives is either applied to a specific instalment or spread across
//     the arrears in order — never dropped, never counted twice.
//
//   * Every write is one transaction. A disbursement that created the account but
//     not the schedule would be a loan with no repayment obligation.

import { queryRows, withTransaction, type Tx } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { computeQuote, generateSchedule, maturityDate, type ProductTerms } from "@/lib/finance/pricing-engine";
import type { Row } from "./shared";

// Money crosses the JS boundary as taka strings from mysql2. Compare in paisa.
const paisa = (v: unknown) => Math.round(Number(v ?? 0) * 100);
const taka = (p: number) => Math.round(p) / 100;

/**
 * A MySQL DATE has no timezone; mysql2 hands it back as a Date at local midnight.
 * Two things then go wrong if it is passed through untouched:
 *
 *   `String(date)`      → "Sat Mar 14 2026 00:00:00 GMT+0600 (…)" — unparseable
 *                          by a client and unreadable on a screen.
 *   `JSON.stringify`    → "2026-03-13T18:00:00.000Z" — the day *before*, at
 *                          +06:00, because UTC serialisation walks it backwards.
 *
 * A due date that displays a day early is a farmer told the wrong deadline, so
 * every date leaving this file goes through here and keeps its calendar day.
 */
export function isoDay(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Ctx = { adminId: number | null; ip?: string | null; userAgent?: string | null };

const DISBURSE_ROLES = ["super_admin", "hq_admin", "credit_approver"];
export const COLLECT_ROLES = ["super_admin", "hq_admin", "credit_approver", "credit_analyst", "field_officer"];

export function mayDisburse(role: string) {
  return DISBURSE_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Disbursement (§16F.2)
// ---------------------------------------------------------------------------

export async function disburseLoan(payload: Record<string, unknown>, ctx: Ctx) {
  const applicationId = Number(payload.application_id);
  if (!Number.isFinite(applicationId)) throw new Error("A numeric application_id is required.");

  const disbursedAmount = payload.amount == null ? null : Number(payload.amount);
  if (disbursedAmount != null && !(disbursedAmount > 0)) {
    throw new Error("The disbursed amount must be greater than zero.");
  }

  const result = await withTransaction(async (tx: Tx) => {
    const apps = await tx.query<Row>(
      `SELECT a.id, a.user_id, a.loan_product_id, a.application_code, a.status,
              a.requested_amount, a.approved_amount, a.recommended_amount,
              a.tenure_months, a.repayment_mode
       FROM loan_applications a WHERE a.id = ? FOR UPDATE`,
      [applicationId]
    );
    const app = apps[0];
    if (!app) throw new Error("Application not found.");

    // An application must be approved before money leaves. Disbursing anything
    // else means a loan exists that no one signed off.
    if (app.status !== "approved") {
      throw new Error(`Only an approved application can be disbursed; this one is "${app.status}".`);
    }

    const existing = await tx.query<Row>(
      "SELECT id FROM loan_accounts WHERE application_id = ?",
      [applicationId]
    );
    // application_id is UNIQUE, so a second insert would fail anyway — but a
    // clear refusal beats a duplicate-key error reaching an officer who has just
    // been told the money went out.
    if (existing.length > 0) throw new Error("This application has already been disbursed.");

    const products = await tx.query<Row>(
      `SELECT interest_rate_annual, interest_method, weeks_per_month, first_payment_offset_days,
              grace_period_months, processing_fee_pct, processing_fee_flat, min_amount, max_amount
       FROM loan_products WHERE id = ?`,
      [app.loan_product_id]
    );
    const product = products[0];
    if (!product) throw new Error("The loan product for this application no longer exists.");

    const principal = disbursedAmount
      ?? Number(app.approved_amount ?? app.recommended_amount ?? app.requested_amount);

    const terms: ProductTerms = {
      interest_rate_annual: Number(product.interest_rate_annual),
      interest_method: product.interest_method as ProductTerms["interest_method"],
      weeks_per_month: Number(product.weeks_per_month ?? 4),
      first_payment_offset_days: Number(product.first_payment_offset_days ?? 30),
      grace_period_months: Number(product.grace_period_months ?? 0),
      processing_fee_pct: Number(product.processing_fee_pct ?? 0),
      processing_fee_flat: Number(product.processing_fee_flat ?? 0),
    };

    const quote = computeQuote(
      principal,
      Number(app.tenure_months),
      app.repayment_mode as "weekly" | "monthly" | "one_time",
      terms
    );

    // Disbursement date comes from the caller so a payment made on Friday and
    // recorded on Monday still dates the schedule from Friday.
    const disbursedAt = payload.disbursed_at ? new Date(String(payload.disbursed_at)) : new Date();
    if (Number.isNaN(disbursedAt.getTime())) throw new Error("disbursed_at is not a valid date.");

    // Throws if the instalments do not sum to total_payable (DAT-05). Inside the
    // transaction on purpose: a schedule that does not reconcile must not exist.
    const schedule = generateSchedule(quote, disbursedAt, terms);

    const account = await tx.execute(
      `INSERT INTO loan_accounts
         (application_id, user_id, loan_product_id, principal, interest_rate_annual, interest_method,
          tenure_months, repayment_mode, weeks_per_month, total_interest, processing_fee, total_payable,
          installment_count, emi_amount, final_emi_amount, effective_annual_rate,
          disbursed_at, first_due_date, maturity_date,
          amount_paid, outstanding_total, next_due_date, next_due_amount, overdue_amount, days_past_due, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 0, ?, ?, ?, 0, 0, 'active')`,
      [
        applicationId, app.user_id, app.loan_product_id,
        quote.principal, quote.interest_rate_annual, quote.interest_method,
        quote.tenure_months, quote.repayment_mode, terms.weeks_per_month,
        quote.total_interest, quote.processing_fee, quote.total_payable,
        quote.installment_count, quote.emi_amount, quote.final_emi_amount, quote.effective_annual_rate,
        disbursedAt, schedule[0].due_date, maturityDate(schedule),
        quote.total_payable, schedule[0].due_date, schedule[0].amount_due,
      ]
    );
    const accountId = Number(account.insertId);

    for (const row of schedule) {
      await tx.execute(
        `INSERT INTO loan_repayment_schedule
           (loan_account_id, installment_no, due_date, principal_component, interest_component,
            fee_component, penalty_accrued, amount_due, amount_paid, status, days_overdue)
         VALUES (?,?,?,?,?,?,0,?,0,'pending',0)`,
        [
          accountId, row.installment_no, row.due_date,
          row.principal_component, row.interest_component, row.fee_component, row.amount_due,
        ]
      );
    }

    await tx.execute(
      "UPDATE loan_applications SET status = 'disbursed', approved_amount = ? WHERE id = ?",
      [quote.principal, applicationId]
    );
    await tx.execute(
      `INSERT INTO loan_application_events (application_id, from_status, to_status, actor_type, actor_id, note_bn, note_en)
       VALUES (?, 'approved', 'disbursed', 'admin', ?, ?, ?)`,
      [
        applicationId, ctx.adminId,
        `৳${quote.principal} বিতরণ করা হয়েছে।`,
        `Disbursed ৳${quote.principal} over ${quote.installment_count} ${quote.repayment_mode} instalments.`,
      ]
    );

    return {
      account_id: accountId,
      application_code: app.application_code,
      principal: quote.principal,
      total_payable: quote.total_payable,
      installment_count: quote.installment_count,
      first_due_date: schedule[0].due_date,
      maturity_date: maturityDate(schedule),
    };
  });

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: "loan.disburse",
    entityType: "loan_accounts",
    entityId: result.account_id,
    after: result,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Repayment (§16E.1, §16F.3)
// ---------------------------------------------------------------------------

/**
 * Recompute an account's aggregates from its schedule. Derived rather than
 * incremented: a running total that drifts from the rows it summarises is worse
 * than no total, because every screen then shows a confident wrong number.
 */
async function refreshAccount(tx: Tx, accountId: number) {
  const rows = await tx.query<Row>(
    `SELECT installment_no, due_date, amount_due, amount_paid, status
     FROM loan_repayment_schedule WHERE loan_account_id = ? ORDER BY installment_no`,
    [accountId]
  );

  let paid = 0;
  let due = 0;
  let overdue = 0;
  let nextDate: string | null = null;
  let nextAmount = 0;
  let oldestOverdue: string | null = null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const r of rows) {
    const amountDue = paisa(r.amount_due);
    const amountPaid = paisa(r.amount_paid);
    paid += amountPaid;
    due += amountDue;

    const remaining = amountDue - amountPaid;
    if (remaining <= 0) continue;

    const dueDate = new Date(String(r.due_date));
    dueDate.setHours(0, 0, 0, 0);

    if (dueDate < today) {
      overdue += remaining;
      if (!oldestOverdue) oldestOverdue = isoDay(r.due_date);
    }
    if (!nextDate) {
      nextDate = isoDay(r.due_date);
      nextAmount = remaining;
    }
  }

  const outstanding = due - paid;
  const daysPastDue = oldestOverdue
    ? Math.max(0, Math.floor((today.getTime() - new Date(oldestOverdue).setHours(0, 0, 0, 0)) / 86400000))
    : 0;

  await tx.execute(
    `UPDATE loan_accounts
        SET amount_paid = ?, outstanding_total = ?, next_due_date = ?, next_due_amount = ?,
            overdue_amount = ?, days_past_due = ?,
            status = CASE WHEN ? <= 0 THEN 'closed' ELSE status END
      WHERE id = ?`,
    [taka(paid), taka(outstanding), nextDate, taka(nextAmount), taka(overdue), daysPastDue, outstanding, accountId]
  );

  return {
    amount_paid: taka(paid),
    outstanding_total: taka(outstanding),
    next_due_date: nextDate,
    next_due_amount: taka(nextAmount),
    overdue_amount: taka(overdue),
    days_past_due: daysPastDue,
    closed: outstanding <= 0,
  };
}

/**
 * Record a repayment and allocate it across the schedule.
 *
 * Oldest instalment first. A farmer paying ৳5,000 against ৳3,000 of arrears and a
 * ৳4,000 instalment due next week clears the arrears and part-pays the instalment
 * — which is what they intended and what the collections report needs to be true.
 * Money beyond the total outstanding is refused rather than parked: an
 * over-payment sitting in a loan account is a reconciliation problem later.
 */
export async function recordRepayment(payload: Record<string, unknown>, ctx: Ctx) {
  const accountId = Number(payload.loan_account_id);
  if (!Number.isFinite(accountId)) throw new Error("A numeric loan_account_id is required.");

  const amountPaisa = paisa(payload.amount);
  if (!(amountPaisa > 0)) throw new Error("The amount must be greater than zero.");

  const kind = String(payload.kind ?? "payment");
  if (!["payment", "waiver", "penalty"].includes(kind)) throw new Error(`Unknown kind "${kind}".`);

  const paidAt = payload.paid_at ? new Date(String(payload.paid_at)) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw new Error("paid_at is not a valid date.");

  const result = await withTransaction(async (tx: Tx) => {
    const accounts = await tx.query<Row>(
      "SELECT id, user_id, outstanding_total, status FROM loan_accounts WHERE id = ? FOR UPDATE",
      [accountId]
    );
    const account = accounts[0];
    if (!account) throw new Error("Loan account not found.");
    if (account.status === "closed") throw new Error("This loan is already closed.");

    const outstanding = paisa(account.outstanding_total);
    if (amountPaisa > outstanding) {
      throw new Error(
        `That is more than the outstanding balance (৳${taka(outstanding)}). Record the exact amount or close the loan.`
      );
    }

    // Unpaid rows, oldest first. FOR UPDATE so two collectors recording at once
    // cannot both allocate against the same instalment.
    const rows = await tx.query<Row>(
      `SELECT id, installment_no, due_date, amount_due, amount_paid
       FROM loan_repayment_schedule
       WHERE loan_account_id = ? AND amount_paid < amount_due
       ORDER BY installment_no
       FOR UPDATE`,
      [accountId]
    );

    let remaining = amountPaisa;
    const allocations: { schedule_id: number; installment_no: number; applied: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const row of rows) {
      if (remaining <= 0) break;
      const shortfall = paisa(row.amount_due) - paisa(row.amount_paid);
      const applied = Math.min(remaining, shortfall);
      const nowPaid = paisa(row.amount_paid) + applied;
      const settled = nowPaid >= paisa(row.amount_due);

      const dueDate = new Date(String(row.due_date));
      dueDate.setHours(0, 0, 0, 0);
      const overdueDays = settled ? 0 : Math.max(0, Math.floor((today.getTime() - dueDate.getTime()) / 86400000));

      await tx.execute(
        `UPDATE loan_repayment_schedule
            SET amount_paid = ?, paid_at = ?, status = ?, days_overdue = ?
          WHERE id = ?`,
        [
          taka(nowPaid),
          settled ? paidAt : null,
          settled ? "paid" : overdueDays > 0 ? "overdue" : "partial",
          overdueDays,
          row.id,
        ]
      );

      await tx.execute(
        `INSERT INTO loan_repayments
           (loan_account_id, schedule_id, amount, paid_at, method, reference, kind, recorded_by, note)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          accountId, row.id, taka(applied), paidAt,
          payload.method == null ? null : String(payload.method),
          payload.reference == null ? null : String(payload.reference),
          kind, ctx.adminId,
          payload.note == null ? null : String(payload.note),
        ]
      );

      allocations.push({ schedule_id: Number(row.id), installment_no: Number(row.installment_no), applied: taka(applied) });
      remaining -= applied;
    }

    // Should be unreachable — the outstanding check above bounds the amount — but
    // silently swallowing money is not an acceptable failure mode.
    if (remaining > 0) {
      throw new Error(`৳${taka(remaining)} could not be allocated to any instalment.`);
    }

    const summary = await refreshAccount(tx, accountId);

    if (summary.closed) {
      const app = await tx.query<Row>("SELECT application_id FROM loan_accounts WHERE id = ?", [accountId]);
      if (app[0]) {
        await tx.execute("UPDATE loan_applications SET status = 'closed' WHERE id = ?", [app[0].application_id]);
        await tx.execute(
          `INSERT INTO loan_application_events (application_id, to_status, actor_type, actor_id, note_bn, note_en)
           VALUES (?, 'closed', 'admin', ?, 'ঋণ সম্পূর্ণ পরিশোধ হয়েছে।', 'Loan fully repaid.')`,
          [app[0].application_id, ctx.adminId]
        );
      }
    }

    return { account_id: accountId, amount: taka(amountPaisa), allocations, ...summary };
  });

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: "loan.repayment.record",
    entityType: "loan_repayments",
    entityId: accountId,
    after: { amount: result.amount, allocations: result.allocations, outstanding: result.outstanding_total },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return result;
}

/**
 * Recompute arrears across every active loan. Days-past-due is a function of the
 * calendar, so it goes stale on its own without anybody touching the data — this
 * is what a nightly job would call.
 */
export async function refreshAllArrears(ctx: Ctx) {
  const accounts = await queryRows<Row>("SELECT id FROM loan_accounts WHERE status = 'active'");
  let changed = 0;

  for (const a of accounts) {
    await withTransaction(async (tx: Tx) => {
      await tx.execute(
        `UPDATE loan_repayment_schedule
            SET status = 'overdue', days_overdue = DATEDIFF(CURDATE(), due_date)
          WHERE loan_account_id = ? AND amount_paid < amount_due AND due_date < CURDATE()
            AND status <> 'waived'`,
        [a.id]
      );
      await tx.execute(
        `UPDATE loan_repayment_schedule
            SET status = 'due'
          WHERE loan_account_id = ? AND amount_paid < amount_due AND due_date = CURDATE()
            AND status = 'pending'`,
        [a.id]
      );
      await refreshAccount(tx, Number(a.id));
    });
    changed += 1;
  }

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: "loan.arrears.refresh",
    entityType: "loan_accounts",
    after: { accounts: changed },
  });

  return { accounts: changed };
}

// ---------------------------------------------------------------------------
// Collections (§16F.3, §20.2)
// ---------------------------------------------------------------------------

/** Aging buckets. Every figure queried — ADM-LON-34 forbids seeded credit numbers. */
export async function getCollections(params: URLSearchParams) {
  const district = params.get("district");
  const where = district ? "AND a.district = ?" : "";
  const args = district ? [district] : [];

  const buckets = await queryRows<Row>(
    `SELECT
       CASE
         WHEN acc.days_past_due = 0 THEN 'current'
         WHEN acc.days_past_due BETWEEN 1 AND 30 THEN '1_30'
         WHEN acc.days_past_due BETWEEN 31 AND 60 THEN '31_60'
         WHEN acc.days_past_due BETWEEN 61 AND 90 THEN '61_90'
         ELSE 'over_90'
       END AS bucket,
       COUNT(*) AS accounts,
       COALESCE(SUM(acc.outstanding_total), 0) AS outstanding,
       COALESCE(SUM(acc.overdue_amount), 0) AS overdue
     FROM loan_accounts acc
     JOIN loan_applications a ON a.id = acc.application_id
     WHERE acc.status = 'active' ${where}
     GROUP BY bucket`,
    args
  );

  const order = ["current", "1_30", "31_60", "61_90", "over_90"];
  const byBucket = new Map(buckets.map((b) => [String(b.bucket), b]));

  const overdue = await queryRows<Row>(
    `SELECT
       CAST(acc.id AS CHAR) AS id,
       a.application_code AS code,
       u.full_name AS farmer,
       u.phone,
       a.district,
       acc.outstanding_total AS outstanding,
       acc.overdue_amount AS overdue,
       acc.days_past_due AS dpd,
       DATE_FORMAT(acc.next_due_date, '%Y-%m-%d') AS next_due_date
     FROM loan_accounts acc
     JOIN loan_applications a ON a.id = acc.application_id
     JOIN app_users u ON u.id = acc.user_id
     WHERE acc.status = 'active' AND acc.days_past_due > 0 ${where}
     ORDER BY acc.days_past_due DESC, acc.overdue_amount DESC
     LIMIT 100`,
    args
  );

  const portfolio = await queryRows<Row>(
    `SELECT
       COUNT(*) AS active_loans,
       COALESCE(SUM(acc.principal), 0) AS disbursed,
       COALESCE(SUM(acc.amount_paid), 0) AS collected,
       COALESCE(SUM(acc.outstanding_total), 0) AS outstanding,
       COALESCE(SUM(acc.overdue_amount), 0) AS overdue,
       COALESCE(SUM(acc.days_past_due > 0), 0) AS accounts_in_arrears
     FROM loan_accounts acc
     JOIN loan_applications a ON a.id = acc.application_id
     WHERE acc.status = 'active' ${where}`,
    args
  );

  const p = portfolio[0] ?? {};
  const outstandingTotal = Number(p.outstanding ?? 0);
  const overdueTotal = Number(p.overdue ?? 0);

  return {
    portfolio: {
      active_loans: Number(p.active_loans ?? 0),
      disbursed: Number(p.disbursed ?? 0),
      collected: Number(p.collected ?? 0),
      outstanding: outstandingTotal,
      overdue: overdueTotal,
      accounts_in_arrears: Number(p.accounts_in_arrears ?? 0),
      // Portfolio at risk: the share of what is still owed that is already late.
      par_pct: outstandingTotal > 0 ? Math.round((overdueTotal / outstandingTotal) * 10000) / 100 : 0,
    },
    buckets: order.map((key) => ({
      bucket: key,
      accounts: Number(byBucket.get(key)?.accounts ?? 0),
      outstanding: Number(byBucket.get(key)?.outstanding ?? 0),
      overdue: Number(byBucket.get(key)?.overdue ?? 0),
    })),
    overdue,
  };
}

// ---------------------------------------------------------------------------
// The farmer's loan account (MOB-LON-31) — read-only in v1
// ---------------------------------------------------------------------------

export async function getLoanAccount(userId: string) {
  if (!userId) throw new Error("A user id is required.");

  const accounts = await queryRows<Row>(
    `SELECT acc.id, acc.principal, acc.interest_rate_annual, acc.repayment_mode,
            acc.tenure_months, acc.total_payable, acc.installment_count,
            acc.emi_amount, acc.amount_paid, acc.outstanding_total,
            acc.next_due_date, acc.next_due_amount, acc.overdue_amount,
            acc.days_past_due, acc.disbursed_at, acc.first_due_date, acc.maturity_date,
            acc.status, a.application_code
     FROM loan_accounts acc
     JOIN loan_applications a ON a.id = acc.application_id
     WHERE acc.user_id = ?
     ORDER BY acc.disbursed_at DESC LIMIT 1`,
    [userId]
  );

  const account = accounts[0];
  if (!account) return { has_account: false, account: null, schedule: [], payments: [] };

  const schedule = await queryRows<Row>(
    `SELECT installment_no, due_date, amount_due, amount_paid, status, days_overdue,
            penalty_accrued
     FROM loan_repayment_schedule WHERE loan_account_id = ? ORDER BY installment_no`,
    [account.id]
  );

  const payments = await queryRows<Row>(
    `SELECT amount, paid_at, method, reference, kind
     FROM loan_repayments WHERE loan_account_id = ? AND kind = 'payment'
     ORDER BY paid_at DESC LIMIT 50`,
    [account.id]
  );

  const paidCount = schedule.filter((s) => s.status === "paid").length;

  // Everything an overdue borrower needs on one object, rather than left for
  // the app to derive from thirty schedule rows: how many instalments are
  // behind, how much penalty has accrued, and which arrears bucket the account
  // has fallen into — the bucket is what decides who contacts them next.
  const overdueRows = schedule.filter((s) => s.status === "overdue" || (s.status === "partial" && Number(s.days_overdue) > 0));
  const penaltyAccrued = schedule.reduce((sum, s) => sum + Number(s.penalty_accrued ?? 0), 0);
  const dpd = Number(account.days_past_due ?? 0);
  const bucket = dpd <= 0 ? "current" : dpd <= 30 ? "1_30" : dpd <= 60 ? "31_60" : dpd <= 90 ? "61_90" : "90_plus";

  // Who the farmer should actually talk to. Their own district's field officer,
  // not a national hotline nobody answers.
  const officers = await queryRows<Row>(
    `SELECT o.name, o.phone, o.upazila, o.district
       FROM zone_officers o
       JOIN app_users u ON u.id = ?
      WHERE o.is_active = 1 AND o.officer_role = 'field_officer' AND o.district = u.district
      ORDER BY o.id LIMIT 1`,
    [userId]
  );

  return {
    has_account: true,
    arrears: {
      is_overdue: dpd > 0,
      days_past_due: dpd,
      bucket,
      overdue_amount: Number(account.overdue_amount ?? 0),
      overdue_installments: overdueRows.length,
      penalty_accrued: penaltyAccrued,
      oldest_due_date: overdueRows.length ? isoDay(overdueRows[0].due_date) : null,
      officer: officers[0]
        ? { name: String(officers[0].name), phone: String(officers[0].phone ?? ""), area: String(officers[0].upazila ?? officers[0].district ?? "") }
        : null
    },
    account: {
      ...account,
      next_due_date: isoDay(account.next_due_date),
      first_due_date: isoDay(account.first_due_date),
      maturity_date: isoDay(account.maturity_date),
      // The one number a borrower actually tracks, and the one nobody wants to
      // compute from a table of thirty rows.
      installments_paid: paidCount,
      installments_total: schedule.length,
      progress_pct: schedule.length ? Math.round((paidCount / schedule.length) * 100) : 0,
      is_overdue: Number(account.days_past_due) > 0,
    },
    schedule: schedule.map((s) => ({ ...s, due_date: isoDay(s.due_date) })),
    payments,
  };
}
