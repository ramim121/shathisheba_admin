import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";
import { recordAudit } from "@/lib/audit";
import { getUserRoles } from "./shared";
import { buildKycSummary } from "./auth";
import { getOrderPromotion, syncOrderPromotion } from "@/lib/promotions";
import { recordOrderEvent } from "@/lib/order-events";
import { describeDelivery } from "@/lib/notify";
import { notifyEnrollment, notifyListing, notifyOrder, reasonVars } from "@/lib/notices";

// The approvals console: the five work queues, the per-item verification panel,
// and the decision engine that publishes listings, confirms orders against
// stock, and grants roles. Every decision is written to audit_logs.

// The listing worklist: every listing still being worked on. Nothing here is
// approved — the officer opens one to record the next section. Paid listings
// are finished; cancelled and rejected ones are closed and counted nowhere.
const PENDING_LISTING_STATUSES = ["submitted", "field_verification", "verified", "contracted", "shipped"];
const PENDING_ENROLLMENT_STATUSES = ["submitted", "needs_document", "officer_verification", "ready_to_approve"];

// Verification panel for one applicant: presence/status of each required check.
async function buildVerificationPanel(userId: number | string) {
  const summary = await buildKycSummary(userId);
  const users = await queryRows<Row>(
    "SELECT id, full_name, phone, nid_number, is_kyc_verified, status FROM app_users WHERE id = ? LIMIT 1",
    [userId]
  );
  const u = users[0] || {};
  return {
    in_system: users.length > 0,
    nid: summary.nid,                       // verified | pending | rejected | none
    user_photo: summary.selfie,             // term: "User Photo" (doc_type 'selfie')
    trade_license: summary.trade_license,
    banking: summary.banking,
    document_count: summary.document_count,
    nid_number: u.nid_number ?? null,
    is_kyc_verified: Number(u.is_kyc_verified ?? 0) === 1,
    user_status: u.status ?? null
  };
}

// GET /api/v1/app/admin/approvals -> counts + recent items per queue.
// Listings appear here as a worklist — the officer opens one to record field
// verification, vaccination and the rest — not as something to approve.
export async function getApprovalQueues() {
  const listings = await queryRows<Row>(
    `SELECT CAST(l.id AS CHAR) AS id, l.listing_code, COALESCE(l.title_en, si.name_en, 'Listing') AS title,
            l.status, l.quantity, l.unit, l.farmer_expected_price, l.created_at,
            CAST(l.user_id AS CHAR) AS user_id, u.full_name, u.phone, u.is_kyc_verified
       FROM sale_listings l
       JOIN app_users u ON u.id = l.user_id
       LEFT JOIN sale_items si ON si.id = l.sale_item_id
      WHERE l.status IN (?, ?, ?, ?, ?)
      ORDER BY l.created_at DESC LIMIT 40`,
    PENDING_LISTING_STATUSES
  );
  const enrollments = await queryRows<Row>(
    `SELECT CAST(a.id AS CHAR) AS id, a.application_code, a.status, a.current_step, a.created_at,
            CAST(a.user_id AS CHAR) AS user_id, u.full_name, u.phone, u.is_kyc_verified,
            p.name_en AS project_name, p.interest_slug
       FROM partner_applications a
       JOIN app_users u ON u.id = a.user_id
       JOIN partner_projects p ON p.id = a.partner_project_id
      WHERE a.status IN (?, ?, ?, ?)
      ORDER BY a.created_at DESC LIMIT 40`,
    PENDING_ENROLLMENT_STATUSES
  );
  const kyc = await queryRows<Row>(
    `SELECT CAST(k.id AS CHAR) AS id, CAST(k.user_id AS CHAR) AS user_id, k.doc_type, k.document_url, k.status, k.created_at,
            u.full_name, u.phone
       FROM app_user_kyc_documents k
       JOIN app_users u ON u.id = k.user_id
      WHERE k.status = 'pending'
      ORDER BY k.created_at DESC LIMIT 60`
  );
  const users = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, full_name, phone, district, upazila, is_kyc_verified, created_at
       FROM app_users WHERE status = 'pending'
      ORDER BY created_at DESC LIMIT 40`
  );
  // Placed buy orders pending inventory validation, with stock-coverage flag.
  const orders = await queryRows<Row>(
    `SELECT CAST(o.id AS CHAR) AS id, o.order_code, o.payable_amount, o.discount_amount, o.payment_method, o.district, o.created_at,
            (SELECT op.source FROM order_promotions op WHERE op.order_id = o.id LIMIT 1) AS promo_source,
            CAST(o.user_id AS CHAR) AS user_id, u.full_name, u.phone,
            COUNT(oi.id) AS item_count,
            GROUP_CONCAT(CONCAT(p.name_en, ' ×', oi.quantity) SEPARATOR ', ') AS items_summary,
            MIN(p.stock_qty >= oi.quantity) AS stock_ok
       FROM orders o
       JOIN app_users u ON u.id = o.user_id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
      WHERE o.fulfillment_status = 'placed'
      GROUP BY o.id
      ORDER BY o.created_at DESC LIMIT 40`
  );
  return {
    counts: {
      listings: listings.length,
      enrollments: enrollments.length,
      kyc: kyc.length,
      users: users.length,
      orders: orders.length,
      total: listings.length + enrollments.length + kyc.length + users.length + orders.length
    },
    listings,
    enrollments,
    kyc,
    users,
    orders
  };
}

// GET /api/v1/app/admin/approval?type=&id= -> one item + applicant verification panel.
export async function getApprovalDetail(type?: string | null, id?: string | null) {
  if (!type || !id) throw new Error("type and id are required.");
  let item: Row | null = null;
  let userId: string | number | null = null;

  if (type === "listing") {
    const rows = await queryRows<Row>(
      `SELECT l.*, si.name_en AS item_name, u.full_name, u.phone, u.district, u.upazila
         FROM sale_listings l JOIN app_users u ON u.id = l.user_id
         LEFT JOIN sale_items si ON si.id = l.sale_item_id WHERE l.id = ? LIMIT 1`,
      [id]
    );
    item = rows[0] || null;
    userId = item?.user_id as string;
  } else if (type === "enrollment") {
    const rows = await queryRows<Row>(
      `SELECT a.*, u.full_name, u.phone, u.district, u.upazila, p.name_en AS project_name
         FROM partner_applications a JOIN app_users u ON u.id = a.user_id
         JOIN partner_projects p ON p.id = a.partner_project_id WHERE a.id = ? LIMIT 1`,
      [id]
    );
    item = rows[0] || null;
    userId = item?.user_id as string;
  } else if (type === "kyc") {
    const rows = await queryRows<Row>(
      `SELECT k.*, u.full_name, u.phone FROM app_user_kyc_documents k
         JOIN app_users u ON u.id = k.user_id WHERE k.id = ? LIMIT 1`,
      [id]
    );
    item = rows[0] || null;
    userId = item?.user_id as string;
  } else if (type === "user") {
    const rows = await queryRows<Row>("SELECT * FROM app_users WHERE id = ? LIMIT 1", [id]);
    item = rows[0] || null;
    userId = id;
  } else if (type === "order") {
    const rows = await queryRows<Row>(
      `SELECT o.*, u.full_name, u.phone FROM orders o JOIN app_users u ON u.id = o.user_id WHERE o.id = ? LIMIT 1`,
      [id]
    );
    item = rows[0] || null;
    userId = item?.user_id as string;
    if (item) {
      // Per-line inventory status + a short stock-movement history for decisions.
      const lines = await queryRows<Row>(
        `SELECT CAST(oi.product_id AS CHAR) AS product_id, p.name_en, oi.quantity, oi.unit_price, oi.line_total,
                p.stock_qty, p.low_stock_threshold, p.unit,
                (p.stock_qty >= oi.quantity) AS stock_ok,
                (SELECT COALESCE(SUM(oi2.quantity), 0) FROM order_items oi2
                   JOIN orders o2 ON o2.id = oi2.order_id
                  WHERE oi2.product_id = oi.product_id AND o2.fulfillment_status = 'placed' AND o2.id <> o.id) AS other_pending_qty
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           JOIN orders o ON o.id = oi.order_id
          WHERE oi.order_id = ?`,
        [id]
      );
      item.promotion = await getOrderPromotion(id);
      const productIds = lines.map((l) => l.product_id);
      const history = productIds.length
        ? await queryRows<Row>(
            `SELECT CAST(m.product_id AS CHAR) AS product_id, p.name_en, m.change_qty, m.reason, m.ref_code, m.created_at
               FROM inventory_movements m JOIN products p ON p.id = m.product_id
              WHERE m.product_id IN (${productIds.map(() => "?").join(",")})
              ORDER BY m.created_at DESC LIMIT 15`,
            productIds
          )
        : [];
      (item as Row).order_lines = lines;
      (item as Row).inventory_history = history;
    }
  } else {
    throw new Error("Unknown approval type.");
  }

  if (!item) throw new Error("Approval item not found.");
  const verification = userId ? await buildVerificationPanel(userId) : null;
  const documents = userId
    ? await queryRows<Row>(
        "SELECT CAST(id AS CHAR) AS id, doc_type, document_url, status, note, created_at FROM app_user_kyc_documents WHERE user_id = ? ORDER BY created_at",
        [userId]
      )
    : [];
  const history = await changesSinceLastDecision(type, id);
  return { type, item, verification, documents, changes: history.changes, previous_decision: history.previous };
}

// Recompute app_users.is_kyc_verified from current document statuses
// (verified NID + verified user photo == identity verified).
async function refreshUserKycVerified(userId: string | number) {
  const summary = await buildKycSummary(userId);
  const verified = summary.nid === "verified" && summary.selfie === "verified" ? 1 : 0;
  await executeQuery("UPDATE app_users SET is_kyc_verified = ? WHERE id = ?", [verified, userId]);
  return verified === 1;
}

// POST /api/v1/app/admin/set-required-docs  { application_id, required_docs: string[], admin_id? }
// Marks KYC documents as mandatory for one project application. The application
// drops to needs_document until the user uploads + an admin verifies them.
export async function setApprovalRequirements(payload: Row) {
  const appId = payload.application_id;
  const docs = Array.isArray(payload.required_docs) ? (payload.required_docs as unknown[]).map(String) : [];
  if (!appId) throw new Error("application_id is required.");
  const allowed = ["nid_front", "nid_back", "selfie", "trade_license", "passbook"];
  const cleaned = docs.filter((d) => allowed.includes(d));
  await executeQuery(
    `UPDATE partner_applications SET required_docs = ?,
        status = IF(? > 0 AND status IN ('submitted','officer_verification','ready_to_approve'), 'needs_document', status)
      WHERE id = ?`,
    [JSON.stringify(cleaned), cleaned.length, appId]
  );
  return { application_id: String(appId), required_docs: cleaned };
}

// Throws if any admin-required doc for this application is not yet verified.
async function assertRequiredDocsVerified(application: Row) {
  const raw = application.required_docs;
  const required: string[] = Array.isArray(raw) ? (raw as unknown[]).map(String)
    : typeof raw === "string" && raw.trim().startsWith("[") ? JSON.parse(raw) : [];
  if (!required.length) return;
  const docs = await queryRows<Row>(
    "SELECT doc_type, status FROM app_user_kyc_documents WHERE user_id = ? ORDER BY created_at",
    [application.user_id]
  );
  const latest: Record<string, string> = {};
  for (const d of docs) latest[String(d.doc_type)] = String(d.status);
  const missing = required.filter((r) => latest[r] !== "verified");
  if (missing.length) {
    const label = (t: string) => t === "selfie" ? "User Photo" : t.replace(/_/g, " ");
    throw new Error(`Cannot approve yet — required document(s) not verified: ${missing.map(label).join(", ")}.`);
  }
}

// POST /api/v1/app/admin/approve  { type, id, action: 'approve'|'reject', admin_id?, note? }
// Every approval decision is recorded in audit_logs. The decision itself lives in
// applyApprovalDecision(); this wrapper exists so all five branches are covered by
// one writer and none can be added later without an audit trail.
// The table behind each approval type, and which column holds its status.
const ITEM_TABLE: Record<string, { table: string; status: string }> = {
  listing: { table: "sale_listings", status: "status" },
  enrollment: { table: "partner_applications", status: "status" },
  order: { table: "orders", status: "fulfillment_status" },
  kyc: { table: "app_user_kyc_documents", status: "status" },
  user: { table: "app_users", status: "status" }
};

async function readItem(type: string, id: unknown): Promise<Row | null> {
  const t = ITEM_TABLE[type];
  if (!t || !id) return null;
  const rows = await queryRows<Row>(`SELECT * FROM ${t.table} WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

// Columns that change on every decision or are not the applicant's content.
const NOT_CONTENT = /^(id|created_at|updated_at|approved_at|approved_by|status|fulfillment_status|payment_status|current_step|verification_notes|app_lang|.*password.*|.*_hash|.*token.*|otp.*|last_.*)$/;

const humanize = (k: string) => k.replace(/_json$/, "").replace(/_id$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function normalise(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * What the applicant changed since the item was last decided: the current row
 * against the snapshot taken at that decision. Empty for a first submission.
 */
async function changesSinceLastDecision(type: string, id: unknown) {
  const [snap] = await queryRows<Row>(
    "SELECT decision, data_json, created_at FROM approval_snapshots WHERE item_type = ? AND item_id = ? ORDER BY id DESC LIMIT 1",
    [type, id]
  );
  if (!snap) return { changes: [], previous: null };
  const current = await readItem(type, id);
  const before = (typeof snap.data_json === "string" ? JSON.parse(snap.data_json) : snap.data_json) as Row;
  const changes = current
    ? Object.keys(current)
        .filter((k) => !NOT_CONTENT.test(k))
        .flatMap((k) => {
          const a = normalise(before?.[k]);
          const b = normalise(current[k]);
          return a === b ? [] : [{ field: k, label: humanize(k), before: a?.slice(0, 300) ?? null, after: b?.slice(0, 300) ?? null }];
        })
    : [];
  return { changes, previous: { decision: String(snap.decision), decided_at: snap.created_at } };
}

/** Plain sentences for the admin: what this decision just did. */
async function decisionEffects(type: string, id: unknown, approve: boolean, result: Row, note: string | null): Promise<string[]> {
  const out: string[] = [];
  if (type === "listing") {
    out.push("Listings are handled in the listing workspace");
  } else if (type === "enrollment") {
    out.push(approve ? "Farmer enrolled in the project" : "Application rejected");
    out.push(describeDelivery(await notifyEnrollment(id, approve ? "enrollment_approved" : "enrollment_rejected", approve ? {} : reasonVars(note)), "Farmer"));
  } else if (type === "order") {
    if (approve) {
      out.push(`Stock deducted for ${Number(result.deducted ?? 0)} product(s)`);
      const promo = await getOrderPromotion(String(id));
      if (promo) out.push(`Discount of ৳${Number(promo.discount_amount)} approved`);
    } else {
      out.push("Order cancelled");
      if (result.promotion === "released") out.push("Discount returned to the buyer for their next order");
    }
    out.push(describeDelivery(await notifyOrder(id, approve ? "order_confirmed" : "order_cancelled", approve ? {} : reasonVars(note)), "Buyer"));
  } else if (type === "kyc") {
    out.push(approve ? "Document verified" : "Document rejected");
    if (result.user_kyc_verified) out.push("User is now fully KYC-verified");
  } else if (type === "user") {
    out.push(approve ? "Account activated · seller role granted" : "Account suspended");
  }
  return out;
}

export async function decideApproval(payload: Row, context: { ip?: string | null; userAgent?: string | null } = {}) {
  const type = String(payload.type || "");
  const before = await readItem(type, payload.id);
  const result = (await applyApprovalDecision(payload)) as Row;
  const approve = payload.action === "approve";
  const note = payload.note ? String(payload.note).slice(0, 255) : null;
  const effects = await decisionEffects(type, payload.id, approve, result, note);
  // The version that was decided on, so a re-submission can be compared with it.
  if (before) {
    await executeQuery(
      "INSERT INTO approval_snapshots (item_type, item_id, decision, data_json, admin_id) VALUES (?, ?, ?, ?, ?)",
      [type, payload.id, String(payload.action), JSON.stringify(before), payload.admin_id ?? null]
    );
  }
  await recordAudit({
    actorAdminId: (payload.admin_id ?? null) as number | string | null,
    action: `approval.${String(payload.action || "unknown")}`,
    entityType: String(payload.type || "unknown"),
    entityId: (payload.id ?? null) as number | string | null,
    after: { ...result, effects },
    ip: context.ip ?? null,
    userAgent: context.userAgent ?? null
  });
  const statusColumn = ITEM_TABLE[type]?.status;
  return { ...result, previous_status: before && statusColumn ? (before[statusColumn] as string) ?? null : null, effects };
}

async function applyApprovalDecision(payload: Row) {
  const type = String(payload.type || "");
  const id = payload.id;
  const action = String(payload.action || "");
  const adminId = payload.admin_id ?? null;
  const note = payload.note ? String(payload.note).slice(0, 255) : null;
  if (!id || (action !== "approve" && action !== "reject")) {
    throw new Error("id and a valid action (approve|reject) are required.");
  }
  const approve = action === "approve";

  if (type === "listing") {
    // Listings are not approved any more. Everything a listing needs is
    // recorded section by section in the listing workspace, and cancelling or
    // rejecting one happens there too.
    throw new Error("Listings are handled in the listing workspace (Marketplace → Listings), not the approval queue.");
  }
  if (type === "enrollment") {
    if (approve) {
      const apps = await queryRows<Row>("SELECT user_id, required_docs FROM partner_applications WHERE id = ? LIMIT 1", [id]);
      if (!apps[0]) throw new Error("Application not found.");
      await assertRequiredDocsVerified(apps[0]);
    }
    await executeQuery(
      "UPDATE partner_applications SET status = ?, current_step = ?, approved_by = ?, approved_at = NOW(), verification_notes = COALESCE(?, verification_notes) WHERE id = ?",
      [approve ? "approved" : "rejected", approve ? "approval" : "rejected", adminId, note, id]
    );
    return { type, id: String(id), status: approve ? "approved" : "rejected" };
  }
  if (type === "order") {
    const orders = await queryRows<Row>("SELECT id, order_code, fulfillment_status FROM orders WHERE id = ? LIMIT 1", [id]);
    const order = orders[0];
    if (!order) throw new Error("Order not found.");
    if (!approve) {
      // Rejected before approval: any discount on it goes back to the buyer.
      await executeQuery("UPDATE orders SET fulfillment_status = 'cancelled' WHERE id = ?", [id]);
      await recordOrderEvent(String(id), "cancelled", { note: note ?? "Rejected at stock check" });
      const promotion = await syncOrderPromotion(String(id));
      return { type, id: String(id), status: "cancelled", promotion };
    }
    // Stock check, deduction, ledger and order status are one unit of work.
    // Previously each statement committed on its own: a failure partway through
    // left some products decremented for an order that was never confirmed, and
    // nothing recorded that it had happened. The rows are locked FOR UPDATE so
    // two admins confirming different orders cannot both pass the sufficiency
    // check against the same stock and oversell it.
    const deducted = await withTransaction(async (tx) => {
      const items = await tx.query<Row>(
        `SELECT oi.product_id, oi.quantity, p.name_en, p.stock_qty
           FROM order_items oi JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = ?
          FOR UPDATE`,
        [id]
      );
      const short = items.filter((it) => Number(it.stock_qty) < Number(it.quantity));
      if (short.length) {
        throw new Error(`Insufficient stock for: ${short.map((s) => `${s.name_en} (need ${s.quantity}, have ${s.stock_qty})`).join("; ")}.`);
      }
      for (const it of items) {
        await tx.execute(
          "UPDATE products SET stock_qty = stock_qty - ?, status = IF(stock_qty - ? <= 0, 'out_of_stock', status) WHERE id = ?",
          [it.quantity, it.quantity, it.product_id]
        );
        await tx.execute(
          "INSERT INTO inventory_movements (product_id, change_qty, reason, ref_code, note) VALUES (?, ?, 'order', ?, ?)",
          [it.product_id, -Number(it.quantity), order.order_code, `Order approved by admin #${adminId ?? "?"}`]
        );
      }
      await tx.execute("UPDATE orders SET fulfillment_status = 'confirmed' WHERE id = ?", [id]);
      await recordOrderEvent(String(id), "confirmed", { tx, note: "Stock checked and approved" });
      // Approving the order approves its discount (a first purchase is spent).
      await syncOrderPromotion(String(id), tx);
      return items.length;
    });
    return { type, id: String(id), status: "confirmed", deducted };
  }
  if (type === "kyc") {
    const docs = await queryRows<Row>("SELECT user_id FROM app_user_kyc_documents WHERE id = ? LIMIT 1", [id]);
    await executeQuery(
      "UPDATE app_user_kyc_documents SET status = ?, note = COALESCE(?, note) WHERE id = ?",
      [approve ? "verified" : "rejected", note, id]
    );
    let kycVerified = false;
    if (docs[0]?.user_id) kycVerified = await refreshUserKycVerified(docs[0].user_id as number);
    return { type, id: String(id), status: approve ? "verified" : "rejected", user_kyc_verified: kycVerified };
  }
  if (type === "user") {
    await executeQuery("UPDATE app_users SET status = ? WHERE id = ?", [approve ? "active" : "suspended", id]);
    if (approve) {
      // Approving a user automatically grants the seller role.
      await executeQuery(
        "INSERT IGNORE INTO app_user_roles (user_id, role, assigned_by) VALUES (?, 'shathisheba_seller', ?)",
        [id, adminId]
      );
    }
    return {
      type,
      id: String(id),
      status: approve ? "active" : "suspended",
      roles: approve ? await getUserRoles(String(id)) : []
    };
  }
  throw new Error("Unknown approval type.");
}
