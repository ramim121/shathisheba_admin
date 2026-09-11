import { queryRows, withTransaction, type Tx } from "@/lib/db";
import type { Row } from "@/lib/endpoints/shared";
import type { GeoIds } from "@/lib/geo";
import { geoRowVisible, getUserGeo } from "@/lib/geo-scope";
import { notify } from "@/lib/notify";

/**
 * Buy from Shathi promotions.
 *
 * One discount per order, chosen in this order:
 *
 *   1. First purchase — automatic. A buyer with no successful purchase gets the
 *      active first-purchase promotion (flat ৳200) on an order whose subtotal is
 *      over its minimum (৳500). While that order waits for approval the offer is
 *      spent; if the order is rejected it is released and applies to the next
 *      order; if the order fails after approval the buyer is issued a voucher.
 *   2. Voucher — automatic. An available voucher is used on the next order that
 *      clears its minimum, then it is gone.
 *   3. Promo code — typed by the buyer, never on a first purchase. When the
 *      buyer also holds a voucher, whichever saves more is used and the other
 *      is kept.
 *
 * Order state drives promotion state (`syncOrderPromotion`), so every path that
 * changes an order — the approvals queue, the orders editor, a payment marked
 * failed — ends up in the same place.
 */

export class PromoError extends Error {
  code = "promo_invalid";
}

/** An order counts as a purchase from confirmation on; cancelled and failed ones do not. */
const SUCCESS_SQL = "fulfillment_status IN ('confirmed','assigned','in_transit','delivered') AND payment_status <> 'failed'";

type Runner = { query<T>(sql: string, values?: unknown[]): Promise<T[]> };
const pool: Runner = { query: (sql, values) => queryRows(sql, values ?? []) };

export type Promotion = {
  id: number;
  code: string | null;
  kind: "first_purchase" | "promo_code";
  name_en: string;
  name_bn: string | null;
  discount_type: "flat" | "percent";
  discount_value: number;
  max_discount: number | null;
  min_order_amount: number;
  usage_limit_total: number | null;
  usage_limit_per_user: number;
  voucher_on_failure: number;
  division_id: number | null;
  district_id: number | null;
  upazila_id: number | null;
};

export type AppliedDiscount = {
  source: "first_purchase" | "promo_code" | "voucher";
  promotion_id: number | null;
  voucher_id: number | null;
  code: string | null;
  discount: number;
  label_en: string;
  label_bn: string;
};

export type PromoEvaluation = {
  subtotal: number;
  /** No successful purchase yet — codes are not accepted until there is one. */
  is_first_purchase: boolean;
  first_purchase: { active: boolean; eligible: boolean; amount: number; min_order_amount: number; reason: string | null };
  applied: AppliedDiscount | null;
  /**
   * applied    - the code is the discount on this order
   * superseded - valid, but an automatic discount is used instead
   * invalid    - cannot be used; `code_error` says why
   */
  code_status: "applied" | "superseded" | "invalid" | null;
  code_error: string | null;
};

const round = (n: number) => Math.round(n * 100) / 100;

function toPromotion(r: Row): Promotion {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: Number(r.id),
    code: (r.code as string) ?? null,
    kind: r.kind as Promotion["kind"],
    name_en: String(r.name_en ?? ""),
    name_bn: (r.name_bn as string) ?? null,
    discount_type: r.discount_type as Promotion["discount_type"],
    discount_value: Number(r.discount_value ?? 0),
    max_discount: num(r.max_discount),
    min_order_amount: Number(r.min_order_amount ?? 0),
    usage_limit_total: num(r.usage_limit_total),
    usage_limit_per_user: Number(r.usage_limit_per_user ?? 1),
    voucher_on_failure: Number(r.voucher_on_failure ?? 0),
    division_id: num(r.division_id),
    district_id: num(r.district_id),
    upazila_id: num(r.upazila_id)
  };
}

function discountFor(p: Promotion, subtotal: number): number {
  const raw = p.discount_type === "percent" ? (subtotal * p.discount_value) / 100 : p.discount_value;
  const capped = p.max_discount !== null ? Math.min(raw, p.max_discount) : raw;
  return round(Math.max(0, Math.min(capped, subtotal)));
}

const LIVE = "is_active = 1 AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW())";

async function activeFirstPurchase(db: Runner): Promise<Promotion | null> {
  const rows = await db.query<Row>(`SELECT * FROM promotions WHERE kind = 'first_purchase' AND ${LIVE} ORDER BY id DESC LIMIT 1`);
  return rows[0] ? toPromotion(rows[0]) : null;
}

async function hasSuccessfulPurchase(db: Runner, userId: unknown): Promise<boolean> {
  const rows = await db.query<Row>(`SELECT 1 FROM orders WHERE user_id = ? AND ${SUCCESS_SQL} LIMIT 1`, [userId]);
  return rows.length > 0;
}

/**
 * Whether the first-purchase offer is still the buyer's: not waiting on another
 * order, not already spent, and not already turned into a voucher.
 */
async function firstPurchaseTaken(db: Runner, userId: unknown): Promise<boolean> {
  const rows = await db.query<Row>(
    "SELECT 1 FROM order_promotions WHERE user_id = ? AND source = 'first_purchase' AND status IN ('applied','approved','failed') LIMIT 1",
    [userId]
  );
  return rows.length > 0;
}

async function usableVoucher(db: Runner, userId: unknown, subtotal: number) {
  const rows = await db.query<Row>(
    `SELECT id, amount, min_order_amount FROM user_vouchers
      WHERE user_id = ? AND status = 'available' AND (expires_at IS NULL OR expires_at >= NOW())
      ORDER BY amount DESC, id ASC`,
    [userId]
  );
  const v = rows.find((r) => subtotal > Number(r.min_order_amount ?? 0));
  return v ? { id: Number(v.id), amount: round(Math.min(Number(v.amount), subtotal)) } : null;
}

async function checkCode(db: Runner, userId: unknown, code: string, subtotal: number, geo: GeoIds): Promise<{ promo: Promotion; discount: number } | string> {
  const rows = await db.query<Row>("SELECT * FROM promotions WHERE code = ? AND kind = 'promo_code' LIMIT 1", [code]);
  if (!rows[0]) return "That promo code does not exist.";
  const p = toPromotion(rows[0]);
  const live = await db.query<Row>(`SELECT 1 FROM promotions WHERE id = ? AND ${LIVE}`, [p.id]);
  if (!live.length) return "That promo code has expired or is not active.";
  if (!geoRowVisible("upazila", p, geo)) return "That promo code is not valid in your delivery area.";
  if (!(subtotal > p.min_order_amount)) return `That promo code needs an order over ৳${p.min_order_amount}.`;
  if (p.usage_limit_total !== null) {
    const [c] = await db.query<Row>("SELECT COUNT(*) AS n FROM order_promotions WHERE promotion_id = ? AND status IN ('applied','approved')", [p.id]);
    if (Number(c?.n ?? 0) >= p.usage_limit_total) return "That promo code has been fully used.";
  }
  const [mine] = await db.query<Row>(
    "SELECT COUNT(*) AS n FROM order_promotions WHERE promotion_id = ? AND user_id = ? AND status IN ('applied','approved')",
    [p.id, userId]
  );
  if (Number(mine?.n ?? 0) >= p.usage_limit_per_user) return "You have already used this promo code.";
  return { promo: p, discount: discountFor(p, subtotal) };
}

/** The discount an order would get. Pure read; `placeOrder` re-runs it inside its transaction. */
export async function evaluatePromotions(
  input: { userId: unknown; subtotal: number; code?: string | null; geo: GeoIds },
  db: Runner = pool
): Promise<PromoEvaluation> {
  const subtotal = round(Math.max(0, input.subtotal));
  const code = (input.code ?? "").trim().toUpperCase() || null;
  const [fp, succeeded, taken] = await Promise.all([
    activeFirstPurchase(db),
    hasSuccessfulPurchase(db, input.userId),
    firstPurchaseTaken(db, input.userId)
  ]);
  const isFirst = !succeeded;

  let fpReason: string | null = null;
  let fpEligible = false;
  if (!fp) fpReason = "no_offer";
  else if (!isFirst) fpReason = "already_purchased";
  else if (taken) fpReason = "in_use";
  else if (!geoRowVisible("upazila", fp, input.geo)) fpReason = "outside_area";
  else if (!(subtotal > fp.min_order_amount)) fpReason = "below_minimum";
  else fpEligible = true;

  const result: PromoEvaluation = {
    subtotal,
    is_first_purchase: isFirst,
    first_purchase: {
      active: Boolean(fp),
      eligible: fpEligible,
      amount: fp ? fp.discount_value : 0,
      min_order_amount: fp ? fp.min_order_amount : 0,
      reason: fpReason
    },
    applied: null,
    code_status: null,
    code_error: null
  };

  if (fpEligible && fp) {
    result.applied = {
      source: "first_purchase",
      promotion_id: fp.id,
      voucher_id: null,
      code: null,
      discount: discountFor(fp, subtotal),
      label_en: "First purchase discount",
      label_bn: "প্রথম কেনাকাটার ছাড়"
    };
    if (code) {
      result.code_status = "superseded";
      result.code_error = "Promo codes can't be used on your first purchase — your first-purchase discount is applied instead.";
    }
    return result;
  }

  const voucher = await usableVoucher(db, input.userId, subtotal);
  const voucherDiscount: AppliedDiscount | null = voucher
    ? { source: "voucher", promotion_id: null, voucher_id: voucher.id, code: null, discount: voucher.amount, label_en: "Voucher", label_bn: "ভাউচার" }
    : null;

  if (code) {
    if (isFirst) {
      result.code_status = "invalid";
      result.code_error = "Promo codes can be used from your second purchase on.";
    } else {
      const checked = await checkCode(db, input.userId, code, subtotal, input.geo);
      if (typeof checked === "string") {
        result.code_status = "invalid";
        result.code_error = checked;
      } else if (!voucherDiscount || checked.discount > voucherDiscount.discount) {
        result.code_status = "applied";
        result.applied = {
          source: "promo_code",
          promotion_id: checked.promo.id,
          voucher_id: null,
          code,
          discount: checked.discount,
          label_en: `Promo ${code}`,
          label_bn: `প্রোমো ${code}`
        };
        return result;
      } else {
        result.code_status = "superseded";
        result.code_error = "Your voucher saves more on this order, so it is used instead. The code is still yours for later.";
      }
    }
  }
  result.applied = voucherDiscount;
  return result;
}

/** Records the discount on a freshly inserted order. Runs inside `placeOrder`'s transaction. */
export async function recordOrderPromotion(tx: Tx, orderId: number, userId: unknown, subtotal: number, applied: AppliedDiscount) {
  await tx.execute(
    `INSERT INTO order_promotions (order_id, user_id, promotion_id, voucher_id, source, code, discount_amount, order_subtotal, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'applied')`,
    [orderId, userId, applied.promotion_id, applied.voucher_id, applied.source, applied.code, applied.discount, subtotal]
  );
  if (applied.voucher_id) {
    const held = await tx.execute(
      "UPDATE user_vouchers SET status = 'reserved', reserved_order_id = ? WHERE id = ? AND status = 'available'",
      [orderId, applied.voucher_id]
    );
    // Someone else's order took it between the quote and now.
    if (held.affectedRows !== 1) throw new PromoError("Your voucher was just used on another order. Please review the total and try again.");
  }
}

/**
 * Moves an order's discount to match the order. Idempotent: calling it twice,
 * or after an unrelated edit, changes nothing.
 */
export async function syncOrderPromotion(orderId: string | number, tx?: Tx): Promise<string | null> {
  // Set when this call issues a first-purchase voucher, so the buyer is told
  // once — after the change is saved, not on every later re-sync.
  let issued: { userId: unknown; amount: number; min: number } | null = null;
  const work = async (db: Tx) => {
    const rows = await db.query<Row>(
      `SELECT op.*, o.fulfillment_status, o.payment_status, p.voucher_on_failure, p.min_order_amount AS promo_min
         FROM order_promotions op
         JOIN orders o ON o.id = op.order_id
         LEFT JOIN promotions p ON p.id = op.promotion_id
        WHERE op.order_id = ?
        FOR UPDATE`,
      [orderId]
    );
    const op = rows[0];
    if (!op) return null;
    const fulfil = String(op.fulfillment_status);
    const payFailed = String(op.payment_status) === "failed";
    const ended = fulfil === "cancelled" || payFailed;
    const succeeded = !ended && ["confirmed", "assigned", "in_transit", "delivered"].includes(fulfil);
    const status = String(op.status);

    const setStatus = (next: string, note: string) =>
      db.execute("UPDATE order_promotions SET status = ?, note = ?, decided_at = NOW() WHERE id = ?", [next, note, op.id]);
    const releaseVoucher = () =>
      db.execute("UPDATE user_vouchers SET status = 'available', reserved_order_id = NULL WHERE id = ? AND reserved_order_id = ?", [op.voucher_id, orderId]);

    if (status === "applied" && succeeded) {
      await setStatus("approved", "Order confirmed");
      if (op.voucher_id) await db.execute("UPDATE user_vouchers SET status = 'redeemed' WHERE id = ?", [op.voucher_id]);
      return "approved";
    }
    if (status === "applied" && ended) {
      // Rejected before approval: nothing was spent, so the offer goes back.
      await setStatus("released", "Order rejected before approval — discount returned to the buyer");
      if (op.voucher_id) await releaseVoucher();
      return "released";
    }
    if (status === "approved" && ended) {
      await setStatus("failed", "Order failed after approval");
      if (op.source === "first_purchase" && Number(op.voucher_on_failure) === 1) {
        // INSERT IGNORE on (source_order_id, reason): one voucher per failed order.
        const created = await db.execute(
          `INSERT IGNORE INTO user_vouchers (user_id, promotion_id, amount, min_order_amount, reason, source_order_id, status, note)
           VALUES (?, ?, ?, ?, 'first_purchase_failed', ?, 'available', 'First purchase failed after approval')`,
          [op.user_id, op.promotion_id, op.discount_amount, op.promo_min ?? 0, orderId]
        );
        if (created.affectedRows === 1) issued = { userId: op.user_id, amount: Number(op.discount_amount), min: Number(op.promo_min ?? 0) };
      }
      if (op.voucher_id) {
        await db.execute("UPDATE user_vouchers SET status = 'available', reserved_order_id = NULL WHERE id = ?", [op.voucher_id]);
      }
      return "failed";
    }
    return status;
  };
  const status = tx ? await work(tx) : await withTransaction(work);
  const voucher = issued as { userId: unknown; amount: number; min: number } | null;
  if (voucher) await notify(voucher.userId, "voucher_issued", { amount: voucher.amount, min: voucher.min }, { screen: "buyCategories" });
  return status;
}

/** What the catalogue shows: whether the first-purchase sticker applies to this buyer, and any vouchers held. */
export async function getPromotionStatus(userId: unknown) {
  const geo = await getUserGeo(userId);
  const [fp, succeeded, taken, vouchers] = await Promise.all([
    activeFirstPurchase(pool),
    userId ? hasSuccessfulPurchase(pool, userId) : Promise.resolve(false),
    userId ? firstPurchaseTaken(pool, userId) : Promise.resolve(false),
    userId
      ? queryRows<Row>(
          `SELECT CAST(id AS CHAR) AS id, amount, min_order_amount, expires_at FROM user_vouchers
            WHERE user_id = ? AND status = 'available' AND (expires_at IS NULL OR expires_at >= NOW())`,
          [userId]
        )
      : Promise.resolve([] as Row[])
  ]);
  const show = Boolean(fp) && !succeeded && !taken && (!fp || geoRowVisible("upazila", fp, geo));
  return {
    first_purchase: fp
      ? { eligible: show, amount: fp.discount_value, min_order_amount: fp.min_order_amount, name_en: fp.name_en, name_bn: fp.name_bn }
      : { eligible: false, amount: 0, min_order_amount: 0, name_en: "", name_bn: "" },
    vouchers
  };
}

/** The discount line for an order, for the admin approval panel and the order screens. */
export async function getOrderPromotion(orderId: string | number) {
  const rows = await queryRows<Row>(
    `SELECT CAST(op.id AS CHAR) AS id, op.source, op.code, op.discount_amount, op.order_subtotal, op.status,
            op.note, op.decided_at, p.name_en AS promotion_name, CAST(op.voucher_id AS CHAR) AS voucher_id
       FROM order_promotions op LEFT JOIN promotions p ON p.id = op.promotion_id
      WHERE op.order_id = ? LIMIT 1`,
    [orderId]
  );
  return rows[0] ?? null;
}
