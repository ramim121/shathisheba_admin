import { executeQuery, queryRows } from "@/lib/db";

/**
 * What was asked, what was answered, and what the gate decided.
 *
 * The old assistant kept none of this — it ran on the phone and left no trace,
 * so nobody could answer "what is she actually being asked", "what did we get
 * wrong", or "what did that cost". Every one of the seven console pages reads
 * from the four writers below.
 *
 * Nothing here may throw into a caller's path. A farmer's answer must not be
 * lost because the audit of it failed; a failed write is logged and dropped,
 * the same rule lib/audit.ts has followed since it was written.
 */

type Row = Record<string, unknown>;

/** Turns inside this window continue the same conversation rather than starting one. */
const CONTINUE_MINUTES = 90;

export async function openConversation(input: {
  userId: string | number;
  path: "ask" | "live";
  districtId?: string | number | null;
  fresh?: boolean;
}): Promise<number | null> {
  try {
    if (!input.fresh) {
      const [recent] = await queryRows<Row>(
        `SELECT id FROM apa_conversations
          WHERE user_id = ? AND path = ? AND last_at > NOW() - INTERVAL ? MINUTE
          ORDER BY id DESC LIMIT 1`,
        [input.userId, input.path, CONTINUE_MINUTES]
      );
      if (recent) return Number(recent.id);
    }
    const res = await executeQuery(
      "INSERT INTO apa_conversations (user_id, path, district_id) VALUES (?, ?, ?)",
      [input.userId, input.path, input.districtId ?? null]
    );
    return Number((res as { insertId?: number }).insertId ?? 0) || null;
  } catch (error) {
    console.error("apa conversation open failed", error);
    return null;
  }
}

export type MessageInput = {
  conversationId: number | null;
  userId: string | number;
  role: "user" | "assistant";
  inputMode?: "text" | "voice" | "photo" | "live";
  body?: string | null;
  transcript?: string | null;
  advice?: string | null;
  imageUrl?: string | null;
  audioSeconds?: number | null;
  tools?: unknown;
  sources?: unknown;
  suggestions?: unknown;
  refused?: boolean;
  refusalReason?: string | null;
  hedged?: boolean;
  model?: string | null;
  latencyMs?: number | null;
  ip?: string | null;
};

function json(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export async function logMessage(input: MessageInput): Promise<number | null> {
  if (!input.conversationId) return null;
  try {
    const res = await executeQuery(
      `INSERT INTO apa_messages
         (conversation_id, user_id, role, input_mode, body, transcript, advice, image_url,
          audio_seconds, tools_json, sources_json, suggestions_json, refused, refusal_reason,
          hedged, model, latency_ms, request_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.conversationId,
        input.userId,
        input.role,
        input.inputMode ?? "text",
        input.body ?? null,
        input.transcript ?? null,
        input.advice ?? null,
        input.imageUrl?.slice(0, 500) ?? null,
        input.audioSeconds ?? null,
        json(input.tools),
        json(input.sources),
        json(input.suggestions),
        input.refused ? 1 : 0,
        input.refusalReason?.slice(0, 190) ?? null,
        input.hedged ? 1 : 0,
        input.model?.slice(0, 80) ?? null,
        input.latencyMs ?? null,
        input.ip?.slice(0, 45) ?? null
      ]
    );
    if (input.role === "assistant") {
      await executeQuery(
        `UPDATE apa_conversations
            SET turn_count = turn_count + 1,
                refused_count = refused_count + ?,
                last_at = NOW()
          WHERE id = ?`,
        [input.refused ? 1 : 0, input.conversationId]
      );
    }
    return Number((res as { insertId?: number }).insertId ?? 0) || null;
  } catch (error) {
    console.error("apa message write failed", error);
    return null;
  }
}

/** The first thing a farmer said becomes the conversation's name in the console. */
export async function nameConversation(conversationId: number | null, title: string): Promise<void> {
  if (!conversationId || !title.trim()) return;
  try {
    await executeQuery(
      "UPDATE apa_conversations SET title = COALESCE(title, ?) WHERE id = ?",
      [title.trim().slice(0, 190), conversationId]
    );
  } catch {
    /* a nameless conversation still reads fine */
  }
}

export type ScopeLogInput = {
  userId?: string | number | null;
  messageId?: number | null;
  input: string;
  verdict: "in_scope" | "out_of_scope" | "ambiguous";
  topic?: string | null;
  confidence?: number | null;
  model?: string | null;
  latencyMs?: number | null;
};

export async function logScope(entry: ScopeLogInput): Promise<number | null> {
  try {
    const res = await executeQuery(
      `INSERT INTO apa_scope_log
         (user_id, message_id, input_text, verdict, topic, confidence, model, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.userId ?? null,
        entry.messageId ?? null,
        entry.input.slice(0, 1000),
        entry.verdict,
        entry.topic?.slice(0, 80) ?? null,
        entry.confidence ?? null,
        entry.model?.slice(0, 80) ?? null,
        entry.latencyMs ?? null
      ]
    );
    return Number((res as { insertId?: number }).insertId ?? 0) || null;
  } catch (error) {
    console.error("apa scope write failed", error);
    return null;
  }
}

/** Attach a scope verdict to the message it produced, once the message exists. */
export async function attachScopeMessage(scopeId: number | null, messageId: number | null): Promise<void> {
  if (!scopeId || !messageId) return;
  try {
    await executeQuery("UPDATE apa_scope_log SET message_id = ? WHERE id = ?", [messageId, scopeId]);
  } catch {
    /* the verdict is still reviewable without the link */
  }
}

export type ToolLogInput = {
  messageId?: number | null;
  userId: string | number;
  tool: string;
  args?: unknown;
  ok: boolean;
  error?: string | null;
  rows?: number;
  latencyMs?: number | null;
};

export async function logToolCall(entry: ToolLogInput): Promise<void> {
  try {
    await executeQuery(
      `INSERT INTO apa_tool_calls (message_id, user_id, tool, args_json, ok, error, rows_returned, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.messageId ?? null,
        entry.userId,
        entry.tool.slice(0, 60),
        json(entry.args),
        entry.ok ? 1 : 0,
        entry.error?.slice(0, 255) ?? null,
        entry.rows ?? 0,
        entry.latencyMs ?? null
      ]
    );
  } catch (error) {
    console.error("apa tool write failed", error);
  }
}

/** Tool rows are written before the message id exists; this fills it in. */
export async function attachToolMessage(userId: string | number, messageId: number | null): Promise<void> {
  if (!messageId) return;
  try {
    await executeQuery(
      `UPDATE apa_tool_calls SET message_id = ?
        WHERE user_id = ? AND message_id IS NULL AND created_at > NOW() - INTERVAL 2 MINUTE`,
      [messageId, userId]
    );
  } catch {
    /* the call is still counted on the usage page */
  }
}
