import { executeQuery, queryRows } from "@/lib/db";
import type { Row } from "@/lib/endpoints/shared";
import { emailProvider, sendEmail } from "@/lib/email";
import { pushProviders, sendPush, type PushDevice } from "@/lib/push";

/**
 * Notifications for app users: one call per business event
 * (`notify(userId, "order_confirmed", vars)`), delivered on every channel the
 * event's template has switched on — the in-app inbox, push, and email — in the
 * language the user's app is set to.
 *
 * Templates live in notification_templates and are edited in the console. Text
 * uses {{placeholders}}; numbers passed as numbers are grouped (1,20,450) and
 * written in Bangla digits for Bangla readers, strings are used as given.
 *
 * A notification must never break the action that caused it, so every failure
 * is caught and recorded in notification_outbox instead of thrown.
 */

export type Lang = "bn" | "en";
/** A value, or the same value in both languages ({ en, bn }) when the words differ. */
export type Vars = Record<string, string | number | null | undefined | { en: string; bn: string }>;
export type DeliveryResult = {
  inapp: boolean;
  push: { sent: number; skipped: number; failed: number };
  email: "sent" | "skipped" | "failed" | "no_email" | "off";
};

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const bnDigits = (s: string) => s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);

function formatNumber(n: number, lang: Lang): string {
  const text = n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return lang === "bn" ? bnDigits(text) : text;
}

export function fill(text: string | null | undefined, vars: Vars, lang: Lang): string {
  return String(text ?? "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => {
    const v = vars[key];
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return lang === "bn" ? v.bn || v.en : v.en;
    return typeof v === "number" ? formatNumber(v, lang) : String(v);
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LOGO = "https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/brand/shathi-sheba-logo.png";
const CATEGORY: Record<string, [string, string]> = {
  order: ["Buy from Shathi", "শাথী থেকে কিনুন"],
  listing: ["Your sale listing", "আপনার বিক্রির তালিকা"],
  enrollment: ["Shathi Partner projects", "শাথী পার্টনার প্রকল্প"],
  promotion: ["Offers", "অফার"],
  account: ["Your account", "আপনার অ্যাকাউন্ট"],
  general: ["Shathi Sheba", "শাথী সেবা"]
};

/**
 * The branded email: logo, maroon title band, paragraphs, an optional button,
 * and a bilingual footer. Table layout and inline styles, because email clients
 * ignore most of CSS. Body text: blank line = paragraph, **bold**, line breaks kept.
 */
export function renderEmailHtml(opts: { lang: Lang; category: string; title: string; subject: string; body: string; cta?: string | null; ctaUrl?: string | null }): string {
  const [catEn, catBn] = CATEGORY[opts.category] ?? CATEGORY.general;
  const paragraphs = opts.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\*\*(.+?)\*\*/g, "<strong style=\"color:#871449\">$1</strong>").replace(/\n/g, "<br>")}</p>`)
    .join("");
  const url = opts.ctaUrl || process.env.APP_OPEN_URL || "https://shathisheba.digigramventures.com";
  const font = "'Hind Siliguri','Noto Sans Bengali','Segoe UI',Arial,sans-serif";
  return `<!doctype html>
<html lang="${opts.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:#F6EEF2;font-family:${font};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.body.replace(/\*\*/g, "").slice(0, 140))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6EEF2;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E8D7DF;">
<tr><td style="padding:20px 28px;border-bottom:1px solid #F0E3E9;"><img src="${LOGO}" alt="Shathi Sheba" height="40" style="display:block;height:40px;border:0"></td></tr>
<tr><td style="background:#871449;padding:26px 28px;">
<div style="color:#F9D7E6;font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;font-family:${font}">${esc(opts.lang === "bn" ? catBn : catEn)}</div>
<div style="color:#FFFFFF;font-size:22px;font-weight:700;line-height:1.35;margin-top:6px;font-family:${font}">${esc(opts.title)}</div>
</td></tr>
<tr><td style="padding:26px 28px 12px;color:#2B0B1E;font-size:15px;line-height:1.7;font-family:${font}">${paragraphs}</td></tr>
${opts.cta ? `<tr><td style="padding:0 28px 28px;"><a href="${esc(url)}" style="display:inline-block;background:#F59E0B;color:#3D2600;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;font-family:${font}">${esc(opts.cta)} →</a></td></tr>` : ""}
<tr><td style="padding:18px 28px;background:#FCFAF8;border-top:1px solid #F0E3E9;color:#9B5173;font-size:12px;line-height:1.6;font-family:${font}">
${opts.lang === "bn"
    ? "শাথী সেবা — গ্রামীণ উদ্যোক্তার সাথী · ডিজিগ্রাম ভেঞ্চারস লিমিটেড<br>আপনি শাথী সেবা অ্যাপ ব্যবহার করেন বলে এই ইমেইল পেয়েছেন। ভাষা আপনার অ্যাপের সেটিং অনুযায়ী।"
    : "Shathi Sheba — a companion for rural enterprise · DigiGram Ventures Ltd.<br>You received this because you use the Shathi Sheba app. The language follows your app setting."}
</td></tr>
</table></td></tr></table></body></html>`;
}

type Recipient = { id: number; name: string; email: string | null; lang: Lang };
type Message = {
  eventKey: string | null;
  broadcastId?: number | null;
  title: string;
  body: string;
  data: Record<string, string>;
  channels: { inapp: boolean; push: boolean; email: boolean };
  email?: { subject: string; html: string; text: string } | null;
};

async function loadRecipients(ids: number[]): Promise<Recipient[]> {
  if (!ids.length) return [];
  const rows = await queryRows<Row>(
    `SELECT id, COALESCE(display_name, full_name) AS name, email, app_lang FROM app_users WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name ?? ""),
    email: r.email ? String(r.email).trim() || null : null,
    lang: r.app_lang === "en" ? "en" : "bn"
  }));
}

async function deliver(user: Recipient, msg: Message): Promise<DeliveryResult> {
  const result: DeliveryResult = { inapp: false, push: { sent: 0, skipped: 0, failed: 0 }, email: msg.channels.email ? "no_email" : "off" };
  if (msg.channels.inapp) {
    await executeQuery(
      "INSERT INTO user_notifications (user_id, event_key, broadcast_id, title, body, data_json, lang) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [user.id, msg.eventKey, msg.broadcastId ?? null, msg.title.slice(0, 190), msg.body.slice(0, 600), JSON.stringify(msg.data), user.lang]
    );
    result.inapp = true;
  }
  if (msg.channels.push) {
    const devices = (await queryRows<Row>(
      "SELECT id, token, provider FROM push_devices WHERE user_id = ? AND is_active = 1",
      [user.id]
    )).map((d) => ({ id: Number(d.id), token: String(d.token), provider: d.provider as PushDevice["provider"] }));
    if (devices.length) {
      const sent = await sendPush(devices, { title: msg.title, body: msg.body, data: msg.data });
      for (const r of sent) {
        result.push[r.status] += 1;
        await executeQuery(
          `INSERT INTO notification_outbox (channel, user_id, event_key, broadcast_id, recipient, subject, body, payload_json, status, error, attempts, sent_at)
           VALUES ('push', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, IF(? = 'sent', NOW(), NULL))`,
          [user.id, msg.eventKey, msg.broadcastId ?? null, r.token.slice(0, 250), msg.title, msg.body, JSON.stringify(msg.data), r.status, r.error ?? null, r.status]
        );
        if (r.deactivate) await executeQuery("UPDATE push_devices SET is_active = 0 WHERE id = ?", [r.deviceId]);
      }
    }
  }
  if (msg.channels.email && user.email && msg.email) {
    const r = await sendEmail(user.email, msg.email.subject, msg.email.html, msg.email.text);
    result.email = r.status;
    await executeQuery(
      `INSERT INTO notification_outbox (channel, user_id, event_key, broadcast_id, recipient, subject, body, status, error, attempts, sent_at)
       VALUES ('email', ?, ?, ?, ?, ?, ?, ?, ?, 1, IF(? = 'sent', NOW(), NULL))`,
      [user.id, msg.eventKey, msg.broadcastId ?? null, user.email, msg.email.subject, msg.email.html, r.status, r.error ?? null, r.status]
    );
  }
  return result;
}

function templateFor(t: Row, lang: Lang, vars: Vars) {
  const pick = (key: string) => String((lang === "bn" ? t[`${key}_bn`] ?? t[`${key}_en`] : t[`${key}_en`] ?? t[`${key}_bn`]) ?? "");
  const title = fill(pick("title"), vars, lang);
  const body = fill(pick("body"), vars, lang);
  const subject = fill(pick("email_subject") || pick("title"), vars, lang);
  const emailBody = fill(pick("email_body") || pick("body"), vars, lang);
  const cta = pick("cta_label") || null;
  return {
    title,
    body,
    email: {
      subject,
      html: renderEmailHtml({ lang, category: String(t.category ?? "general"), title, subject, body: emailBody, cta }),
      text: emailBody.replace(/\*\*/g, "")
    }
  };
}

/**
 * Send the template for `eventKey` to one app user. Never throws; returns what
 * was delivered, or null when there is no active template or no such user.
 */
export async function notify(userId: unknown, eventKey: string, vars: Vars = {}, data: Record<string, string> = {}): Promise<DeliveryResult | null> {
  try {
    if (!userId) return null;
    const [t] = await queryRows<Row>("SELECT * FROM notification_templates WHERE event_key = ? AND is_active = 1 LIMIT 1", [eventKey]);
    if (!t) return null;
    const [user] = await loadRecipients([Number(userId)]);
    if (!user) return null;
    const content = templateFor(t, user.lang, { name: user.name, ...vars });
    return await deliver(user, {
      eventKey,
      title: content.title,
      body: content.body,
      data: { event: eventKey, ...data },
      channels: { inapp: Number(t.send_inapp) === 1, push: Number(t.send_push) === 1, email: Number(t.send_email) === 1 },
      email: content.email
    });
  } catch (error) {
    console.error("notify failed", eventKey, error);
    return null;
  }
}

/** One sentence for the admin: who was told, and how. */
export function describeDelivery(r: DeliveryResult | null, who = "User"): string {
  if (!r) return `${who} not notified (no active template)`;
  const parts = [r.inapp ? "in-app" : null, r.push.sent ? `push ×${r.push.sent}` : r.push.skipped ? "push skipped (Firebase not set up)" : null, r.email === "sent" ? "email" : r.email === "skipped" ? "email queued (no provider)" : null].filter(Boolean);
  return `${who} notified: ${parts.join(", ") || "no channel"}`;
}

// ---------------------------------------------------------------------------
// Admin: previews, test sends, broadcasts
// ---------------------------------------------------------------------------

const SAMPLE: Record<Lang, Vars> = {
  en: {
    name: "Rahima Begum", order_code: "ORD-2026-01234", items: "DigiGram Cattle Feed Grower ×20", payable: 600, discount_line: " (you saved ৳200)",
    delivery_area: "Lalpur, Natore", by_distributor: " by Walia Shimul", reason: "", reason_line: "", listing_code: "SAL-APP-17890",
    animal: "Cow · Local / Deshi", estimate: 120450, visit_date: "12 Sep 2026", weight: 310, buyer: "Bengal Meat", rate: 425,
    advance: " An advance of ৳20,000 is on its way.", amount: 124775, method: "bank transfer", reference: "TRX-8841",
    project: "Cattle Fattening Project", min: 500
  },
  bn: {
    name: "রহিমা বেগম", order_code: "ORD-2026-01234", items: "ডিজিগ্রাম ক্যাটল ফিড গ্রোয়ার ×২০", payable: 600, discount_line: " (৳২০০ ছাড় পেয়েছেন)",
    delivery_area: "লালপুর, নাটোর", by_distributor: " — ওয়ালিয়া শিমুল", reason: "", reason_line: "", listing_code: "SAL-APP-17890",
    animal: "গাভী · দেশি", estimate: 120450, visit_date: "১২ সেপ্টেম্বর ২০২৬", weight: 310, buyer: "বেঙ্গল মিট", rate: 425,
    advance: " ৳২০,০০০ অগ্রিম পাঠানো হচ্ছে।", amount: 124775, method: "ব্যাংক ট্রান্সফার", reference: "TRX-8841",
    project: "গরু মোটাতাজাকরণ প্রকল্প", min: 500
  }
};

export function previewTemplate(template: Row, lang: Lang) {
  const content = templateFor(template, lang, SAMPLE[lang]);
  return { subject: content.email.subject, title: content.title, body: content.body, html: content.email.html };
}

export async function testTemplate(eventKey: string, userId: unknown) {
  const [u] = await loadRecipients([Number(userId)]);
  if (!u) throw new Error("User not found.");
  const r = await notify(u.id, eventKey, SAMPLE[u.lang], { test: "1" });
  if (!r) throw new Error("That template is not active.");
  return r;
}

export async function notificationStatus() {
  const [counts] = await queryRows<Row>(
    `SELECT (SELECT COUNT(*) FROM push_devices WHERE is_active = 1) AS devices,
            (SELECT COUNT(*) FROM app_users WHERE email IS NOT NULL AND email <> '') AS users_with_email,
            (SELECT COUNT(*) FROM app_users) AS users`
  );
  const push = pushProviders();
  return {
    email_provider: emailProvider(),
    push_fcm: push.fcm,
    push_expo: push.expo,
    devices: Number(counts?.devices ?? 0),
    users_with_email: Number(counts?.users_with_email ?? 0),
    users: Number(counts?.users ?? 0)
  };
}

export const AUDIENCE_ROLES = ["shathisheba_seller", "shathisheba_buyer", "field_officer", "project_member"] as const;

/** The app users a broadcast reaches. Suspended accounts never receive one. */
export async function audienceUserIds(target: string, roles: string[] = [], userIds: Array<string | number> = []): Promise<number[]> {
  if (target === "users") {
    const ids = userIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return [];
    const rows = await queryRows<Row>(`SELECT id FROM app_users WHERE status <> 'suspended' AND id IN (${ids.map(() => "?").join(",")})`, ids);
    return rows.map((r) => Number(r.id));
  }
  if (target === "roles") {
    const wanted = roles.filter((r) => (AUDIENCE_ROLES as readonly string[]).includes(r));
    if (!wanted.length) return [];
    const roleKeys = wanted.filter((r) => r !== "project_member");
    const parts: string[] = [];
    const params: unknown[] = [];
    if (roleKeys.length) {
      parts.push(`SELECT user_id FROM app_user_roles WHERE role IN (${roleKeys.map(() => "?").join(",")})`);
      params.push(...roleKeys);
    }
    if (wanted.includes("project_member")) parts.push("SELECT user_id FROM partner_applications WHERE status = 'approved'");
    const rows = await queryRows<Row>(
      `SELECT DISTINCT u.id FROM app_users u JOIN (${parts.join(" UNION ")}) x ON x.user_id = u.id WHERE u.status <> 'suspended'`,
      params
    );
    return rows.map((r) => Number(r.id));
  }
  const rows = await queryRows<Row>("SELECT id FROM app_users WHERE status <> 'suspended'");
  return rows.map((r) => Number(r.id));
}

export async function audienceSummary(target: string, roles: string[], userIds: string[]) {
  const ids = await audienceUserIds(target, roles, userIds);
  if (!ids.length) return { count: 0, with_push: 0, with_email: 0 };
  const list = ids.map(() => "?").join(",");
  const [row] = await queryRows<Row>(
    `SELECT (SELECT COUNT(DISTINCT user_id) FROM push_devices WHERE is_active = 1 AND user_id IN (${list})) AS with_push,
            (SELECT COUNT(*) FROM app_users WHERE email IS NOT NULL AND email <> '' AND id IN (${list})) AS with_email`,
    [...ids, ...ids]
  );
  return { count: ids.length, with_push: Number(row?.with_push ?? 0), with_email: Number(row?.with_email ?? 0) };
}

export type BroadcastInput = {
  title_en: string; title_bn: string; body_en: string; body_bn: string;
  target: "all" | "roles" | "users"; roles?: string[]; user_ids?: Array<string | number>;
  send_push?: boolean; send_inapp?: boolean; send_email?: boolean;
};

export async function sendBroadcast(input: BroadcastInput, adminId: unknown) {
  const need = (v: unknown, label: string) => { if (!String(v ?? "").trim()) throw new Error(`${label} is required.`); };
  need(input.title_en, "English title"); need(input.title_bn, "Bangla title");
  need(input.body_en, "English message"); need(input.body_bn, "Bangla message");
  const target = input.target === "roles" || input.target === "users" ? input.target : "all";
  const channels = { push: input.send_push !== false, inapp: input.send_inapp !== false, email: input.send_email === true };
  if (!channels.push && !channels.inapp && !channels.email) throw new Error("Pick at least one channel.");
  const ids = await audienceUserIds(target, input.roles ?? [], input.user_ids ?? []);
  if (!ids.length) throw new Error("No one matches that audience.");

  const created = await executeQuery(
    `INSERT INTO broadcasts (title_en, title_bn, body_en, body_bn, target, target_roles, target_user_ids, send_push, send_inapp, send_email, recipients, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.title_en, input.title_bn, input.body_en, input.body_bn, target, JSON.stringify(input.roles ?? []), JSON.stringify((input.user_ids ?? []).map(String)),
     channels.push ? 1 : 0, channels.inapp ? 1 : 0, channels.email ? 1 : 0, ids.length, adminId ?? null]
  );
  const broadcastId = created.insertId;
  const totals = { recipients: ids.length, push_sent: 0, push_skipped: 0, emails_queued: 0 };
  for (const user of await loadRecipients(ids)) {
    const title = user.lang === "en" ? input.title_en : input.title_bn;
    const body = user.lang === "en" ? input.body_en : input.body_bn;
    const r = await deliver(user, {
      eventKey: "broadcast",
      broadcastId,
      title,
      body,
      data: { event: "broadcast", broadcast_id: String(broadcastId) },
      channels,
      email: { subject: title, html: renderEmailHtml({ lang: user.lang, category: "general", title, subject: title, body }), text: body }
    });
    totals.push_sent += r.push.sent;
    totals.push_skipped += r.push.skipped + r.push.failed;
    if (r.email === "sent" || r.email === "skipped") totals.emails_queued += 1;
  }
  await executeQuery(
    "UPDATE broadcasts SET push_sent = ?, push_skipped = ?, emails_queued = ?, sent_at = NOW() WHERE id = ?",
    [totals.push_sent, totals.push_skipped, totals.emails_queued, broadcastId]
  );
  return { broadcast_id: broadcastId, ...totals };
}

// ---------------------------------------------------------------------------
// App: the inbox, devices and language
// ---------------------------------------------------------------------------

export async function getInbox(userId: unknown) {
  if (!userId) return { items: [], unread: 0 };
  const items = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, event_key, title, body, data_json, read_at, created_at
       FROM user_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60`,
    [userId]
  );
  const [u] = await queryRows<Row>("SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND read_at IS NULL", [userId]);
  return { items, unread: Number(u?.n ?? 0) };
}

export async function markRead(userId: unknown, id?: unknown) {
  if (!userId) throw new Error("user_id is required.");
  if (id) await executeQuery("UPDATE user_notifications SET read_at = NOW() WHERE user_id = ? AND id = ? AND read_at IS NULL", [userId, id]);
  else await executeQuery("UPDATE user_notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL", [userId]);
  return getInbox(userId);
}

export async function registerDevice(userId: unknown, payload: Row) {
  const token = String(payload.token ?? "").trim();
  if (!userId || !token) throw new Error("user_id and token are required.");
  const provider = token.startsWith("ExponentPushToken") || token.startsWith("ExpoPushToken") ? "expo" : "fcm";
  // A token moves with the phone, not the account: if someone else signs in on
  // this phone, the token now belongs to them.
  await executeQuery(
    `INSERT INTO push_devices (user_id, token, provider, platform, app_version, is_active, last_seen_at)
     VALUES (?, ?, ?, ?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), provider = VALUES(provider), platform = VALUES(platform),
                             app_version = VALUES(app_version), is_active = 1, last_seen_at = NOW()`,
    [userId, token, provider, String(payload.platform ?? "").slice(0, 20) || null, String(payload.app_version ?? "").slice(0, 40) || null]
  );
  return { registered: true, provider };
}

export async function unregisterDevice(userId: unknown, token: unknown) {
  await executeQuery("UPDATE push_devices SET is_active = 0 WHERE user_id = ? AND token = ?", [userId, String(token ?? "")]);
  return { unregistered: true };
}

export async function setAppLang(userId: unknown, lang: unknown) {
  const value = lang === "en" ? "en" : "bn";
  await executeQuery("UPDATE app_users SET app_lang = ? WHERE id = ?", [value, userId]);
  return { app_lang: value };
}
