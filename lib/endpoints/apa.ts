import { executeQuery, queryRows } from "@/lib/db";
import { apaConfig } from "@/lib/apa/config";
import { isApaConfigured } from "@/lib/apa/client";
import { resolveEntitlement } from "@/lib/apa/entitlement";
import { safeJson, type Row } from "@/lib/endpoints/shared";

/**
 * App-facing reads and small writes for Shathi Apa.
 *
 * The composite paths — asking a question, opening a live call — live in
 * lib/apa/*. What is left here is what every other app screen needs: the
 * entitlement the UI renders from, the conversation history it shows offline,
 * the two-tap feedback under an answer, and the settings screen.
 */

/* ---------------------------------------------------------------------------
   The one payload the app renders every Apa surface from
   --------------------------------------------------------------------------- */

export async function getApaEntitlement(userId?: string | null) {
  const cfg = await apaConfig();
  const entitlement = await resolveEntitlement(userId, cfg);
  return {
    ...entitlement,
    // Configured separately from enabled: a server with no key must present a
    // closed feature rather than a broken one.
    configured: isApaConfigured(),
    starters: STARTERS,
    unlock: UNLOCK_BENEFITS
  };
}

/** The four chips on an empty chat, and the three under a refusal. */
const STARTERS = [
  { text: "আজ কি বৃষ্টি হবে?", icon: "weather" },
  { text: "গরুর অসুখ দেখাতে চাই", icon: "photo" },
  { text: "আজকের গরুর দাম কত?", icon: "market" },
  { text: "এই মৌসুমে কী লাগাবো?", icon: "crop" }
];

/**
 * What verification buys, in her terms.
 *
 * Three concrete gains, each naming something she has already tried — not a
 * feature list and not a pricing table. This is a trust exchange and the copy
 * says so plainly (SRS D3).
 */
const UNLOCK_BENEFITS = [
  {
    id: "unlimited",
    icon: "mic",
    title_bn: "যত খুশি প্রশ্ন",
    detail_bn: "ভয়েস, লেখা বা ছবি — কোনো গণনা নেই"
  },
  {
    id: "live",
    icon: "phone",
    title_bn: "লাইভ কথা",
    detail_bn: "মাসে ২০ মিনিট সরাসরি আলাপ"
  },
  {
    id: "photo",
    icon: "camera",
    title_bn: "ছবি দেখিয়ে পরামর্শ",
    detail_bn: "অসুস্থ পশু ও ফসলের প্রাথমিক ধারণা"
  }
];

/* ---------------------------------------------------------------------------
   History
   --------------------------------------------------------------------------- */

export async function getApaConversations(userId?: string | null, limit = 20) {
  if (!userId) return [];
  return queryRows<Row>(
    `SELECT CAST(c.id AS CHAR) AS id, c.path, c.title, c.turn_count, c.started_at, c.last_at,
            (SELECT m.body FROM apa_messages m
              WHERE m.conversation_id = c.id AND m.role = 'assistant'
              ORDER BY m.id DESC LIMIT 1) AS last_answer
       FROM apa_conversations c
      WHERE c.user_id = ?
      ORDER BY c.last_at DESC
      LIMIT ?`,
    [userId, limit]
  );
}

/**
 * One conversation, in full.
 *
 * Ownership is in the WHERE clause rather than checked after the read, so there
 * is no path on which the rows are fetched and then judged.
 */
export async function getApaConversation(userId: string | null | undefined, id: string | null) {
  if (!userId || !id) throw new Error("A conversation id is required.");
  const [conversation] = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, path, title, turn_count, started_at, last_at
       FROM apa_conversations WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId]
  );
  if (!conversation) throw new Error("That conversation was not found.");

  const messages = await queryRows<Row>(
    `SELECT CAST(m.id AS CHAR) AS id, m.role, m.input_mode, m.body, m.transcript, m.advice,
            m.image_url, m.audio_seconds, m.sources_json, m.suggestions_json,
            m.refused, m.created_at,
            f.vote AS my_vote
       FROM apa_messages m
       LEFT JOIN apa_feedback f ON f.message_id = m.id AND f.user_id = m.user_id
      WHERE m.conversation_id = ?
      ORDER BY m.id
      LIMIT 200`,
    [id]
  );

  return {
    conversation,
    messages: messages.map(({ sources_json, suggestions_json, ...m }) => ({
      ...m,
      sources: jsonArray(sources_json),
      suggestions: jsonArray(suggestions_json)
    }))
  };
}

/**
 * mysql2 hands a JSON column back already parsed, but a column written before
 * the driver was upgraded comes back as a string. `safeJson` only handles the
 * second case and only for objects, so arrays need this.
 */
export function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** "আলাপের রেকর্ড মুছুন" on the settings screen. Her data, her call. */
export async function clearApaHistory(userId?: string | null) {
  if (!userId) throw new Error("user_id is required.");
  const res = await executeQuery("DELETE FROM apa_conversations WHERE user_id = ?", [userId]);
  // Messages, tool calls and feedback cascade; the scope log keeps the verdict
  // with its message_id nulled, because the review queue is about our gate and
  // not about her.
  return { deleted: Number((res as { affectedRows?: number }).affectedRows ?? 0) };
}

/* ---------------------------------------------------------------------------
   Feedback
   --------------------------------------------------------------------------- */

const FEEDBACK_REASONS = new Set(["wrong", "confusing", "not_my_area", "too_long", "unsafe", "other"]);

export async function submitApaFeedback(payload: Row) {
  const userId = payload.user_id;
  const messageId = String(payload.message_id ?? "").trim();
  const vote = String(payload.vote ?? "").trim();
  if (!userId) throw new Error("user_id is required.");
  if (!messageId) throw new Error("message_id is required.");
  if (vote !== "up" && vote !== "down") throw new Error("vote must be up or down.");

  // The message must be hers. Without this, one farmer could vote on another's
  // answer and the Feedback page would be reading noise.
  const [owned] = await queryRows<Row>(
    "SELECT id FROM apa_messages WHERE id = ? AND user_id = ? AND role = 'assistant' LIMIT 1",
    [messageId, userId]
  );
  if (!owned) throw new Error("That answer was not found.");

  const reason = String(payload.reason ?? "").trim();
  await executeQuery(
    `INSERT INTO apa_feedback (message_id, user_id, vote, reason, note)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE vote = VALUES(vote), reason = VALUES(reason), note = VALUES(note),
                             reviewed_at = NULL, reviewed_by = NULL`,
    [
      messageId,
      userId,
      vote,
      FEEDBACK_REASONS.has(reason) ? reason : null,
      String(payload.note ?? "").trim().slice(0, 500) || null
    ]
  );
  return { ok: true, vote };
}

/* ---------------------------------------------------------------------------
   Her own settings
   --------------------------------------------------------------------------- */

export type ApaUserSettings = {
  read_aloud: boolean;
  speech_rate: "slow" | "normal" | "fast";
  language: "bn" | "en";
  data_warning: boolean;
  wifi_only_live: boolean;
};

const DEFAULTS: ApaUserSettings = {
  read_aloud: true,
  speech_rate: "normal",
  language: "bn",
  // Cannot be permanently dismissed, only acknowledged — spending someone
  // else's data without saying so is not a setting we offer (SRS S1).
  data_warning: true,
  wifi_only_live: false
};

function readSettings(profileJson: unknown): ApaUserSettings {
  const profile = (typeof profileJson === "string" ? safeJson(profileJson) : (profileJson as Row | null)) ?? {};
  const apa = (profile.apa ?? {}) as Partial<ApaUserSettings>;
  return {
    read_aloud: apa.read_aloud !== false,
    speech_rate: ["slow", "normal", "fast"].includes(String(apa.speech_rate))
      ? (apa.speech_rate as ApaUserSettings["speech_rate"])
      : DEFAULTS.speech_rate,
    language: apa.language === "en" ? "en" : "bn",
    data_warning: true,
    wifi_only_live: apa.wifi_only_live === true
  };
}

export async function getApaSettings(userId?: string | null) {
  const cfg = await apaConfig();
  const [user] = userId
    ? await queryRows<Row>("SELECT profile_json FROM app_users WHERE id = ? LIMIT 1", [userId])
    : [];
  const entitlement = await resolveEntitlement(userId, cfg);
  return {
    settings: readSettings(user?.profile_json),
    live: entitlement.live,
    tier: entitlement.tier,
    // The quota hero at the top of the settings screen, phrased the way the
    // design phrases it: what is left, before any switch.
    renews_on: nextMonthLabel()
  };
}

export async function saveApaSettings(payload: Row) {
  const userId = payload.user_id;
  if (!userId) throw new Error("user_id is required.");
  const [user] = await queryRows<Row>("SELECT profile_json FROM app_users WHERE id = ? LIMIT 1", [userId]);
  if (!user) throw new Error("User not found.");

  const profile =
    (typeof user.profile_json === "string" ? safeJson(user.profile_json) : (user.profile_json as Row | null)) ?? {};
  const current = readSettings(user.profile_json);
  const next: ApaUserSettings = {
    read_aloud: payload.read_aloud === undefined ? current.read_aloud : payload.read_aloud === true,
    speech_rate: ["slow", "normal", "fast"].includes(String(payload.speech_rate))
      ? (String(payload.speech_rate) as ApaUserSettings["speech_rate"])
      : current.speech_rate,
    language: payload.language === "en" ? "en" : payload.language === "bn" ? "bn" : current.language,
    data_warning: true,
    wifi_only_live:
      payload.wifi_only_live === undefined ? current.wifi_only_live : payload.wifi_only_live === true
  };

  await executeQuery("UPDATE app_users SET profile_json = ? WHERE id = ?", [
    JSON.stringify({ ...profile, apa: next }),
    userId
  ]);
  return { settings: next };
}

function nextMonthLabel(): string {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const months = [
    "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
    "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"
  ];
  return `১ ${months[next.getUTCMonth()]}`;
}
