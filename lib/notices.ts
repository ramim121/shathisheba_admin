import { queryRows } from "@/lib/db";
import type { Row } from "@/lib/endpoints/shared";
import { notify, type DeliveryResult, type Vars } from "@/lib/notify";

/**
 * The notification for an order, a listing or a project application, built
 * from the record itself so every caller (placement, the approvals queue, the
 * listing workflow, the orders editor) sends the same words.
 */

const both = (en: unknown, bn: unknown) => ({ en: String(en ?? ""), bn: String(bn ?? en ?? "") });

export async function notifyOrder(orderId: unknown, event: string, extra: Vars = {}): Promise<DeliveryResult | null> {
  const [o] = await queryRows<Row>(
    `SELECT o.id, o.user_id, o.order_code, o.payable_amount, o.discount_amount,
            o.upazila, o.district, gu.name_bn AS upazila_bn, gd.name_bn AS district_bn,
            COALESCE(d.short_name_en, d.name_en) AS dist_en, COALESCE(d.short_name_bn, d.name_bn) AS dist_bn,
            (SELECT GROUP_CONCAT(CONCAT(p.name_en, ' ×', oi.quantity + 0) SEPARATOR ', ') FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS items_en,
            (SELECT GROUP_CONCAT(CONCAT(COALESCE(p.name_bn, p.name_en), ' ×', oi.quantity + 0) SEPARATOR ', ') FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id) AS items_bn
       FROM orders o
       LEFT JOIN distributors d ON d.id = o.distributor_id
       LEFT JOIN geo_upazilas gu ON gu.id = o.upazila_id
       LEFT JOIN geo_districts gd ON gd.id = o.district_id
      WHERE o.id = ? LIMIT 1`,
    [orderId]
  );
  if (!o) return null;
  const discount = Number(o.discount_amount ?? 0);
  return notify(o.user_id, event, {
    order_code: String(o.order_code),
    items: both(o.items_en, o.items_bn),
    payable: Number(o.payable_amount ?? 0),
    discount_line: discount > 0 ? { en: ` (you saved ৳${discount.toLocaleString("en-IN")})`, bn: ` (৳${discount.toLocaleString("en-IN")} ছাড় পেয়েছেন)` } : "",
    delivery_area: both([o.upazila, o.district].filter(Boolean).join(", "), [o.upazila_bn || o.upazila, o.district_bn || o.district].filter(Boolean).join(", ")),
    by_distributor: o.dist_en ? { en: ` by ${o.dist_en}`, bn: ` — ${o.dist_bn || o.dist_en}` } : "",
    reason: "",
    reason_line: "",
    ...extra
  }, { order_id: String(o.id), screen: "orderDetail" });
}

export async function notifyListing(listingId: unknown, event: string, extra: Vars = {}): Promise<DeliveryResult | null> {
  const [l] = await queryRows<Row>(
    `SELECT l.id, l.user_id, l.listing_code, l.estimated_earning, l.verified_weight_kg, l.weight_kg,
            a.name_en AS animal_en, a.name_bn AS animal_bn, b.name_en AS breed_en, b.name_bn AS breed_bn,
            si.name_en AS item_en, si.name_bn AS item_bn
       FROM sale_listings l
       LEFT JOIN animals a ON a.id = l.animal_id
       LEFT JOIN animal_breeds b ON b.id = l.breed_id
       LEFT JOIN sale_items si ON si.id = l.sale_item_id
      WHERE l.id = ? LIMIT 1`,
    [listingId]
  );
  if (!l) return null;
  const animalEn = [l.animal_en || l.item_en, l.breed_en].filter(Boolean).join(" · ") || "livestock";
  const animalBn = [l.animal_bn || l.item_bn || l.animal_en, l.breed_bn || l.breed_en].filter(Boolean).join(" · ") || "পশু";
  return notify(l.user_id, event, {
    listing_code: String(l.listing_code),
    animal: { en: animalEn, bn: animalBn },
    estimate: Math.round(Number(l.estimated_earning ?? 0)),
    weight: Number(l.verified_weight_kg ?? l.weight_kg ?? 0),
    reason: "",
    reason_line: "",
    ...extra
  }, { listing_id: String(l.id), screen: "listingProgress" });
}

export async function notifyEnrollment(applicationId: unknown, event: string, extra: Vars = {}): Promise<DeliveryResult | null> {
  const [a] = await queryRows<Row>(
    `SELECT a.id, a.user_id, p.name_en, p.name_bn FROM partner_applications a
       JOIN partner_projects p ON p.id = a.partner_project_id WHERE a.id = ? LIMIT 1`,
    [applicationId]
  );
  if (!a) return null;
  return notify(a.user_id, event, { project: both(a.name_en, a.name_bn), reason: "", reason_line: "", ...extra }, { application_id: String(a.id), screen: "projectProgress" });
}

/** A rejection note as a sentence for the templates' {{reason}} / {{reason_line}}. */
export function reasonVars(note: unknown): Vars {
  const text = String(note ?? "").trim();
  if (!text) return {};
  return { reason: { en: ` Reason: ${text}.`, bn: ` কারণ: ${text}।` }, reason_line: { en: `\n\nReason: ${text}`, bn: `\n\nকারণ: ${text}` } };
}
