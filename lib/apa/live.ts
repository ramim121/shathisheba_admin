import { executeQuery, queryRows } from "@/lib/db";
import { apaConfig } from "@/lib/apa/config";
import { friendlyModelError, isApaConfigured, isOurError } from "@/lib/apa/client";
import { assertApaAccess, resolveEntitlement, type ApaEntitlement } from "@/lib/apa/entitlement";
import { openConversation } from "@/lib/apa/log";
import { addUsage, estimateLiveCost, reconcileAbandonedSessions } from "@/lib/apa/quota";
import { chargeableSeconds } from "@/lib/apa/pure";
import { mintLiveToken, type LiveToken } from "@/lib/apa/token";

/**
 * A live conversation: minting, accounting, and the honest receipt at the end.
 *
 * Everything expensive about this feature is decided here rather than on the
 * phone, because the phone is the one part of the system that can be modified
 * by the person it is billing. The app is handed a token that is already
 * restricted, a ceiling it cannot raise, and a session row that is charged
 * whether or not it ever tells us the call ended.
 *
 * The quota is told to her before she starts and again when she stops, and
 * never in between. A number counting down mid-conversation manufactures
 * exactly the anxiety the whole design is built to avoid (SRS V4); the only
 * in-session exception is a single quiet line under two minutes remaining.
 */

type Row = Record<string, unknown>;

export type LiveStart = {
  session_id: number;
  token: LiveToken;
  /** Seconds this particular call may run — the smaller of cap and balance. */
  allowed_seconds: number;
  entitlement: ApaEntitlement;
  notice: {
    data_mb_per_minute: number;
    bandwidth_floor_kbps: number;
    minutes_left: number;
  };
};

export async function startLiveSession(input: {
  userId: string;
  conversationId?: number | null;
  ip?: string | null;
}): Promise<LiveStart> {
  if (!isApaConfigured()) throw new Error("Shathi Apa is not configured on this server.");
  const cfg = await apaConfig();

  // Sweep anything left open by a killed app before reading the balance, or a
  // phone that dies mid-call becomes a way to talk for free.
  await reconcileAbandonedSessions(input.userId, cfg.liveSessionMinutes * 60);

  // Re-checked at mint time and not merely at screen-open time: the token is
  // the thing that costs money, so it is the thing the check has to guard.
  const entitlement = await assertApaAccess(input.userId, "live", cfg);

  const allowed = Math.min(entitlement.live.session_seconds_max, entitlement.live.seconds_left);
  if (allowed < 30) {
    throw new Error("এ মাসের লাইভ কথা প্রায় শেষ। ভয়েস মেসেজ পাঠান — উত্তর একই রকম পাবেন।");
  }

  const [profile] = await queryRows<Row>(
    `SELECT u.district_id, d.name_bn AS district_bn, z.name_bn AS upazila_bn
       FROM app_users u
       LEFT JOIN geo_districts d ON d.id = u.district_id
       LEFT JOIN geo_upazilas z ON z.id = u.upazila_id
      WHERE u.id = ? LIMIT 1`,
    [input.userId]
  );

  const conversationId =
    input.conversationId ??
    (await openConversation({
      userId: input.userId,
      path: "live",
      districtId: (profile?.district_id as string | null) ?? null,
      fresh: true
    }));

  let token;
  try {
    ({ token } = await mintLiveToken({
      model: cfg.models.live,
      voice: cfg.voiceName,
      sessionMinutes: Math.ceil(allowed / 60),
      districtName: (profile?.district_bn as string | null) ?? null,
      upazilaName: (profile?.upazila_bn as string | null) ?? null
    }));
  } catch (error) {
    // assertConstrained() throwing is a bug in this code, not a Google outage,
    // and must not be dressed up as one — it is logged loudly and the farmer is
    // told the line is closed rather than handed an unrestricted session.
    if (isOurError(error)) throw error;
    console.error("apa live mint failed", error);
    throw friendlyModelError(error);
  }

  const res = await executeQuery(
    `INSERT INTO apa_live_sessions (user_id, conversation_id, token_name, model, request_ip)
     VALUES (?, ?, ?, ?, ?)`,
    [input.userId, conversationId, token.name.slice(0, 190), cfg.models.live, input.ip?.slice(0, 45) ?? null]
  );

  await addUsage(input.userId, { live_sessions: 1 });

  return {
    session_id: Number((res as { insertId?: number }).insertId ?? 0),
    token,
    allowed_seconds: allowed,
    entitlement,
    notice: {
      data_mb_per_minute: cfg.dataMbPerMinute,
      bandwidth_floor_kbps: cfg.bandwidthFloorKbps,
      minutes_left: Math.floor(entitlement.live.seconds_left / 60)
    }
  };
}

/** The socket opened. From here the clock is running and the minutes are real. */
export async function markLiveConnected(sessionId: number, userId: string): Promise<void> {
  await executeQuery(
    "UPDATE apa_live_sessions SET connected_at = COALESCE(connected_at, NOW()) WHERE id = ? AND user_id = ?",
    [sessionId, userId]
  );
}

export type LiveReceipt = {
  seconds: number;
  minutes_left: number;
  data_mb: number;
  entitlement: ApaEntitlement;
};

/**
 * The end of a call, and the receipt the farmer is shown.
 *
 * The duration the phone reports is clamped: to the session cap, to the
 * balance, and to the wall-clock time since the row was created. The client
 * reporting its own usage is fine as long as nothing trusts it, and the server
 * has three independent bounds on the number.
 */
export async function closeLiveSession(input: {
  sessionId: number;
  userId: string;
  seconds: number;
  bytes?: number;
  reason?: string;
  resumed?: number;
}): Promise<LiveReceipt> {
  const cfg = await apaConfig();
  const [row] = await queryRows<Row>(
    `SELECT id, connected_at, closed_at, charged_seconds,
            TIMESTAMPDIFF(SECOND, COALESCE(connected_at, minted_at), NOW()) AS wall_seconds
       FROM apa_live_sessions WHERE id = ? AND user_id = ? LIMIT 1`,
    [input.sessionId, input.userId]
  );
  if (!row) throw new Error("That conversation was not found.");

  const alreadyClosed = Boolean(row.closed_at);
  const seconds = chargeableSeconds({
    claimed: Number(input.seconds),
    wallSeconds: Number(row.wall_seconds ?? 0),
    capSeconds: cfg.liveSessionMinutes * 60,
    connected: Boolean(row.connected_at)
  });

  if (!alreadyClosed) {
    await executeQuery(
      `UPDATE apa_live_sessions
          SET closed_at = NOW(),
              charged_seconds = ?,
              bytes_estimate = ?,
              resumed_count = ?,
              end_reason = ?
        WHERE id = ? AND user_id = ?`,
      [
        seconds,
        Math.max(0, Math.round(Number(input.bytes) || 0)),
        Math.max(0, Math.round(Number(input.resumed) || 0)),
        (input.reason ?? "ended").slice(0, 60),
        input.sessionId,
        input.userId
      ]
    );
    if (seconds > 0) {
      await addUsage(input.userId, {
        live_seconds: seconds,
        est_cost_usd: estimateLiveCost(seconds)
      });
    }
  }

  const entitlement = await resolveEntitlement(input.userId, cfg);
  const charged = alreadyClosed ? Number(row.charged_seconds ?? 0) : seconds;
  return {
    seconds: charged,
    minutes_left: Math.floor(entitlement.live.seconds_left / 60),
    // Stated in MB because that is the unit her data pack is sold in.
    data_mb: Number(((charged / 60) * cfg.dataMbPerMinute).toFixed(1)),
    entitlement
  };
}

/**
 * Lines the phone captured during a live call, saved so the conversation is
 * readable afterwards. The design promises "পুরো আলাপ চ্যাটে সংরক্ষিত আছে" on
 * the receipt, and a promise the app cannot keep is worse than no promise.
 */
export async function saveLiveTranscript(input: {
  userId: string;
  sessionId: number;
  turns: Array<{ role: "user" | "assistant"; text: string }>;
}): Promise<number> {
  const [session] = await queryRows<Row>(
    "SELECT conversation_id FROM apa_live_sessions WHERE id = ? AND user_id = ? LIMIT 1",
    [input.sessionId, input.userId]
  );
  const conversationId = session?.conversation_id ? Number(session.conversation_id) : null;
  if (!conversationId) return 0;

  let written = 0;
  for (const turn of input.turns.slice(0, 200)) {
    const text = String(turn.text ?? "").trim();
    if (!text) continue;
    await executeQuery(
      `INSERT INTO apa_messages (conversation_id, user_id, role, input_mode, body)
       VALUES (?, ?, ?, 'live', ?)`,
      [conversationId, input.userId, turn.role === "user" ? "user" : "assistant", text.slice(0, 4000)]
    );
    written += 1;
  }
  if (written) {
    await executeQuery(
      "UPDATE apa_conversations SET turn_count = turn_count + ?, last_at = NOW() WHERE id = ?",
      [Math.ceil(written / 2), conversationId]
    );
  }
  return written;
}
