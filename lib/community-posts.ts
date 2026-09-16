import { executeQuery, queryRows } from "@/lib/db";

type Row = Record<string, unknown>;

/**
 * Community posts the platform writes by itself — a listing reaching a
 * milestone, an order completing. They carry is_system = 1 so they are exempt
 * from the per-user daily cap, and source_type/source_id so the same event
 * never posts twice.
 */

/** How many posts a person may write per day. System posts do not count. */
export const DAILY_POST_LIMIT = 3;

export async function postsLeftToday(userId: unknown): Promise<number> {
  if (!userId) return 0;
  const [row] = await queryRows<Row>(
    `SELECT COUNT(*) AS n FROM community_posts
      WHERE user_id = ? AND is_system = 0 AND status <> 'removed' AND created_at >= CURDATE()`,
    [userId]
  );
  return Math.max(0, DAILY_POST_LIMIT - Number(row?.n ?? 0));
}

/** Throws the message the app shows when someone is out of posts for today. */
export async function assertCanPost(userId: unknown) {
  const left = await postsLeftToday(userId);
  if (left <= 0) {
    throw new Error(`You have reached today's limit of ${DAILY_POST_LIMIT} community posts. Please post again tomorrow.`);
  }
  return left;
}

// A short marker per milestone keeps the "already posted" check cheap.
const MARK: Record<string, string> = {
  submitted: "New listing:",
  verified: "Field verification complete:",
  paid: "Sold and paid:"
};

async function alreadyPosted(sourceType: string, sourceId: unknown, marker: string) {
  const [row] = await queryRows<Row>(
    "SELECT COUNT(*) AS n FROM community_posts WHERE source_type = ? AND source_id = ? AND body LIKE ?",
    [sourceType, sourceId, `%${marker}%`]
  );
  return Number(row?.n ?? 0) > 0;
}

async function insertPost(p: {
  userId: unknown; body: string; imageUrl?: string | null; district?: unknown; upazila?: unknown;
  sourceType: string; sourceId: unknown; system: boolean; postType?: string; scope?: string;
}) {
  const res = await executeQuery(
    `INSERT INTO community_posts
       (user_id, scope, post_type, body, image_url, district, upazila, status, is_official, is_system, source_type, source_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'visible', ?, ?, ?, ?)`,
    [
      p.userId ?? null, p.scope ?? "district", p.postType ?? (p.system ? "notice" : "general"),
      p.body, p.imageUrl ?? null, p.district ?? null, p.upazila ?? null,
      p.system ? 1 : 0, p.system ? 1 : 0, p.sourceType, p.sourceId ?? null
    ]
  );
  return String(res.insertId);
}

function title(l: Row) {
  return String(l.title_en || l.item_name || l.animal_name || "Livestock listing");
}
function qty(l: Row) {
  return `${Number(l.quantity ?? 1)} ${String(l.unit || "piece")}`;
}
function area(l: Row) {
  return [l.upazila, l.district].filter(Boolean).join(", ") || "Bangladesh";
}
function weight(l: Row) {
  const w = Number(l.verified_weight_kg ?? 0);
  return w > 0 ? `, ${w} kg verified` : "";
}
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
function bn(n: number | string) {
  return String(n).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}
function weightBn(l: Row) {
  const w = Number(l.verified_weight_kg ?? 0);
  return w > 0 ? `, যাচাইকৃত ${bn(w)} কেজি` : "";
}

// Bangla first — it is what most of the feed reads — with the English line
// under it, because one `body` column serves both languages.
const LISTING_LINE: Record<string, (l: Row) => string> = {
  submitted: (l) =>
    `🐄 নতুন তালিকা: ${title(l)} — ${qty(l)}, ${area(l)}। পরবর্তী ধাপ মাঠ যাচাই।
` +
    `New listing: ${title(l)} — ${qty(l)} in ${area(l)}. Field verification is next.`,
  verified: (l) =>
    `✅ মাঠ যাচাই সম্পন্ন: ${title(l)} — ${qty(l)}, ${area(l)}${weightBn(l)}। শাথী সেবার মাঠ কর্মকর্তা যাচাই করেছেন।
` +
    `Field verification complete: ${title(l)} — ${qty(l)} in ${area(l)}${weight(l)}. Verified by a Shathi Sheba field officer.`,
  paid: (l) =>
    `💰 বিক্রি ও পরিশোধ সম্পন্ন: ${title(l)} — ${qty(l)}, ${area(l)}। কৃষক পেমেন্ট পেয়েছেন।
` +
    `Sold and paid: ${title(l)} — ${qty(l)} in ${area(l)}. The farmer has been paid.`
};

/**
 * Announce a listing milestone. Best-effort: a failed post must never fail the
 * workflow action that triggered it.
 */
export async function postListingMilestone(listingId: unknown, milestone: "submitted" | "verified" | "paid") {
  try {
    const line = LISTING_LINE[milestone];
    if (!line) return null;
    const [l] = await queryRows<Row>(
      `SELECT l.id, CAST(l.user_id AS CHAR) AS user_id, l.title_en, l.quantity, l.unit, l.district, l.upazila,
              l.media_json, l.verified_weight_kg, si.name_en AS item_name, a.name_en AS animal_name
         FROM sale_listings l
         LEFT JOIN sale_items si ON si.id = l.sale_item_id
         LEFT JOIN animals a ON a.id = l.animal_id
        WHERE l.id = ? LIMIT 1`,
      [listingId]
    );
    if (!l) return null;
    if (await alreadyPosted("listing", listingId, MARK[milestone])) return null;
    const media = Array.isArray(l.media_json) ? (l.media_json as unknown[]) : [];
    return await insertPost({
      userId: l.user_id, body: line(l), imageUrl: media.length ? String(media[0]) : null,
      district: l.district, upazila: l.upazila, sourceType: "listing", sourceId: listingId, system: true
    });
  } catch {
    return null;
  }
}

/** Announce a delivered order. */
export async function postOrderCompleted(orderId: unknown) {
  try {
    const [o] = await queryRows<Row>(
      `SELECT o.id, CAST(o.user_id AS CHAR) AS user_id, o.order_code, o.district, o.upazila,
              (SELECT p.name_en FROM order_items oi JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id = o.id ORDER BY oi.id LIMIT 1) AS product,
              (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS items
         FROM orders o WHERE o.id = ? LIMIT 1`,
      [orderId]
    );
    if (!o) return null;
    if (await alreadyPosted("order", orderId, "Delivered:")) return null;
    const extra = Number(o.items ?? 1) - 1;
    const where = [o.upazila, o.district].filter(Boolean).join(", ") || "Bangladesh";
    const product = String(o.product || "Order");
    const body =
      `📦 ডেলিভারি সম্পন্ন: ${product}${extra > 0 ? ` +আরও ${bn(extra)}টি` : ""} — ${where}, শাথী থেকে কিনুন।
` +
      `Delivered: ${product}${extra > 0 ? ` +${extra} more` : ""} — delivered in ${where} through Buy from Shathi.`;
    return await insertPost({
      userId: o.user_id, body, district: o.district, upazila: o.upazila,
      sourceType: "order", sourceId: orderId, system: true
    });
  } catch {
    return null;
  }
}

const STATUS_LINE: Record<string, { en: string; bn: string }> = {
  submitted: { en: "is listed and waiting for field verification", bn: "তালিকাভুক্ত, মাঠ যাচাইয়ের অপেক্ষায়" },
  field_verification: { en: "is being verified by a field officer", bn: "মাঠ কর্মকর্তা যাচাই করছেন" },
  verified: { en: "passed field verification", bn: "মাঠ যাচাইয়ে উত্তীর্ণ" },
  contracted: { en: "has a purchase contract", bn: "ক্রয় চুক্তি হয়েছে" },
  shipped: { en: "is on its way to the buyer", bn: "ক্রেতার কাছে পাঠানো হয়েছে" },
  paid: { en: "is sold and paid", bn: "বিক্রি ও পরিশোধ সম্পন্ন" },
  cancelled: { en: "was cancelled", bn: "বাতিল হয়েছে" },
  rejected: { en: "was rejected", bn: "বাতিল হয়েছে" }
};

/**
 * The farmer sharing their own listing update from the app. This is a normal
 * user post: it counts against the daily cap.
 */
export async function shareListingToCommunity(userId: unknown, listingId: unknown, note?: unknown) {
  if (!userId) throw new Error("Sign in to share a listing.");
  if (!listingId) throw new Error("listing_id is required.");
  const [l] = await queryRows<Row>(
    `SELECT l.id, CAST(l.user_id AS CHAR) AS user_id, l.title_en, l.status, l.quantity, l.unit,
            l.district, l.upazila, l.media_json, l.verified_weight_kg,
            si.name_en AS item_name, a.name_en AS animal_name
       FROM sale_listings l
       LEFT JOIN sale_items si ON si.id = l.sale_item_id
       LEFT JOIN animals a ON a.id = l.animal_id
      WHERE l.id = ? LIMIT 1`,
    [listingId]
  );
  if (!l) throw new Error("Listing not found.");
  if (String(l.user_id) !== String(userId)) throw new Error("You can only share your own listing.");
  await assertCanPost(userId);

  const state = STATUS_LINE[String(l.status)] ?? "has an update";
  const own = String(note ?? "").trim().slice(0, 500);
  const body = `${own ? `${own}\n\n` : ""}🐄 My listing ${title(l)} (${qty(l)}) ${state}${weight(l)} — ${area(l)}.`;
  const media = Array.isArray(l.media_json) ? (l.media_json as unknown[]) : [];
  const id = await insertPost({
    userId, body, imageUrl: media.length ? String(media[0]) : null,
    district: l.district, upazila: l.upazila, sourceType: "listing_share", sourceId: listingId,
    system: false, postType: "livestock", scope: "district"
  });
  return { post_id: id, posts_left_today: await postsLeftToday(userId) };
}
