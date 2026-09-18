import { executeQuery, queryRows } from "@/lib/db";
import { invalidateSettings } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { apaConfig, invalidateApaPrompts } from "@/lib/apa/config";
import { invalidateVocabulary } from "@/lib/apa/vocabulary";
import { setEntitlementGrant } from "@/lib/apa/entitlement";
import { MODEL_PRICES, speechCostPerMinute } from "@/lib/apa/quota";
import { jsonArray } from "@/lib/endpoints/apa";
import { FREE_RPD, forgetSpentModels, modelCallsToday, modelCallsTrend, spentModels } from "@/lib/apa/models";
import { cacheStats, pruneAnswerCache } from "@/lib/apa/cache";
import { prewarmAnswer } from "@/lib/apa/prewarm";

/**
 * The seven console pages.
 *
 * Every figure on them is a query against the tables migration 041 created —
 * none of it is estimated in the browser and none of it is sampled. The point
 * of the console is to answer four questions a week after launch: what are
 * farmers actually asking, what did the scope gate get wrong, what is this
 * costing, and who is it reaching. A page that cannot answer its question from
 * the database is a page that will be believed anyway, which is worse than not
 * having it.
 */

type Row = Record<string, unknown>;

const period = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
};

/* ---------------------------------------------------------------------------
   1. Conversations
   --------------------------------------------------------------------------- */

export async function getApaConsoleConversations(params: {
  q?: string | null;
  filter?: string | null;
  district?: string | null;
  limit?: number;
}) {
  const q = String(params.q ?? "").trim();
  const like = `%${q}%`;
  const filter = String(params.filter ?? "all");
  const limit = Math.min(200, Math.max(10, Number(params.limit ?? 50)));

  const [stats] = await queryRows<Row>(
    `SELECT
       (SELECT COUNT(*) FROM apa_messages WHERE role = 'user' AND created_at > NOW() - INTERVAL 30 DAY) AS questions,
       (SELECT COUNT(DISTINCT user_id) FROM apa_messages WHERE created_at > NOW() - INTERVAL 30 DAY) AS farmers,
       (SELECT COUNT(*) FROM apa_messages WHERE refused = 1 AND created_at > NOW() - INTERVAL 30 DAY) AS refused,
       (SELECT COUNT(*) FROM apa_messages
         WHERE role = 'assistant' AND JSON_LENGTH(COALESCE(sources_json, JSON_ARRAY())) > 0
           AND created_at > NOW() - INTERVAL 30 DAY) AS grounded,
       (SELECT COUNT(*) FROM apa_messages
         WHERE role = 'assistant' AND created_at > NOW() - INTERVAL 30 DAY) AS answers,
       (SELECT ROUND(AVG(latency_ms)) FROM apa_messages
         WHERE role = 'assistant' AND created_at > NOW() - INTERVAL 7 DAY) AS avg_latency_ms,
       (SELECT COUNT(*) FROM apa_messages WHERE input_mode = 'voice' AND role = 'user'
         AND created_at > NOW() - INTERVAL 30 DAY) AS voice,
       (SELECT COUNT(*) FROM apa_messages WHERE input_mode = 'photo' AND role = 'user'
         AND created_at > NOW() - INTERVAL 30 DAY) AS photo`
  );

  const where: string[] = ["1 = 1"];
  const values: unknown[] = [];
  if (q) {
    where.push("(c.title LIKE ? OR u.full_name LIKE ? OR u.phone LIKE ?)");
    values.push(like, like, like);
  }
  if (filter === "refused") where.push("c.refused_count > 0");
  if (filter === "live") where.push("c.path = 'live'");
  if (filter === "flagged") where.push("c.flagged = 1");
  if (filter === "downvoted") {
    where.push(
      "EXISTS (SELECT 1 FROM apa_messages m JOIN apa_feedback f ON f.message_id = m.id WHERE m.conversation_id = c.id AND f.vote = 'down')"
    );
  }
  if (params.district) {
    where.push("c.district_id = ?");
    values.push(params.district);
  }

  const rows = await queryRows<Row>(
    `SELECT CAST(c.id AS CHAR) AS id, c.path, c.title, c.turn_count, c.refused_count, c.flagged,
            c.started_at, c.last_at,
            CAST(c.user_id AS CHAR) AS user_id, u.full_name, u.phone,
            d.name_en AS district,
            (SELECT COUNT(*) FROM apa_messages m JOIN apa_feedback f ON f.message_id = m.id
              WHERE m.conversation_id = c.id AND f.vote = 'down') AS downvotes,
            (SELECT GROUP_CONCAT(DISTINCT t.tool ORDER BY t.tool SEPARATOR ',')
               FROM apa_tool_calls t JOIN apa_messages m2 ON m2.id = t.message_id
              WHERE m2.conversation_id = c.id) AS tools
       FROM apa_conversations c
       JOIN app_users u ON u.id = c.user_id
       LEFT JOIN geo_districts d ON d.id = c.district_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.last_at DESC
      LIMIT ?`,
    [...values, limit]
  );

  const answers = Number(stats?.answers ?? 0);
  return {
    metrics: {
      questions: Number(stats?.questions ?? 0),
      farmers: Number(stats?.farmers ?? 0),
      refused: Number(stats?.refused ?? 0),
      grounded_pct: answers ? Math.round((Number(stats?.grounded ?? 0) / answers) * 100) : 0,
      avg_latency_ms: Number(stats?.avg_latency_ms ?? 0),
      voice: Number(stats?.voice ?? 0),
      photo: Number(stats?.photo ?? 0)
    },
    rows
  };
}

/** One conversation, every turn, with what each answer was grounded on. */
export async function getApaConsoleConversation(id: string | null) {
  if (!id) throw new Error("A conversation id is required.");
  const [conversation] = await queryRows<Row>(
    `SELECT CAST(c.id AS CHAR) AS id, c.path, c.title, c.turn_count, c.refused_count, c.flagged,
            c.started_at, c.last_at, CAST(c.user_id AS CHAR) AS user_id,
            u.full_name, u.phone, u.is_kyc_verified,
            d.name_en AS district, z.name_en AS upazila
       FROM apa_conversations c
       JOIN app_users u ON u.id = c.user_id
       LEFT JOIN geo_districts d ON d.id = c.district_id
       LEFT JOIN geo_upazilas z ON z.id = u.upazila_id
      WHERE c.id = ? LIMIT 1`,
    [id]
  );
  if (!conversation) throw new Error("No conversation with that id.");

  const messages = await queryRows<Row>(
    `SELECT CAST(m.id AS CHAR) AS id, m.role, m.input_mode, m.body, m.transcript, m.advice,
            m.image_url, m.audio_seconds, m.tools_json, m.sources_json, m.suggestions_json,
            m.refused, m.refusal_reason, m.hedged, m.model, m.latency_ms, m.created_at,
            f.vote, f.reason AS vote_reason,
            s.verdict, s.topic, s.confidence, s.corrected_to
       FROM apa_messages m
       LEFT JOIN apa_feedback f ON f.message_id = m.id
       LEFT JOIN apa_scope_log s ON s.message_id = m.id
      WHERE m.conversation_id = ?
      ORDER BY m.id`,
    [id]
  );

  const tools = await queryRows<Row>(
    `SELECT t.tool, t.ok, t.error, t.rows_returned, t.latency_ms, CAST(t.message_id AS CHAR) AS message_id
       FROM apa_tool_calls t
       JOIN apa_messages m ON m.id = t.message_id
      WHERE m.conversation_id = ?
      ORDER BY t.id`,
    [id]
  );

  return {
    conversation,
    messages: messages.map(({ tools_json, sources_json, suggestions_json, ...m }) => ({
      ...m,
      tools: jsonArray(tools_json),
      sources: jsonArray(sources_json),
      suggestions: jsonArray(suggestions_json)
    })),
    tool_calls: tools
  };
}

export async function flagApaConversation(id: string, flagged: boolean, adminId: number) {
  await executeQuery("UPDATE apa_conversations SET flagged = ? WHERE id = ?", [flagged ? 1 : 0, id]);
  await recordAudit({
    actorAdminId: adminId,
    action: flagged ? "apa_conversation_flagged" : "apa_conversation_unflagged",
    entityType: "apa_conversations",
    entityId: id
  });
  return { ok: true, flagged };
}

/* ---------------------------------------------------------------------------
   2. Scope review — the tuning queue
   --------------------------------------------------------------------------- */

export async function getApaScopeReview(params: { verdict?: string | null; limit?: number }) {
  const limit = Math.min(200, Math.max(10, Number(params.limit ?? 60)));
  const verdict = String(params.verdict ?? "review");

  const [stats] = await queryRows<Row>(
    `SELECT
       COUNT(*) AS total,
       SUM(verdict = 'out_of_scope') AS refused,
       SUM(verdict = 'ambiguous') AS ambiguous,
       SUM(corrected_at IS NOT NULL) AS corrected,
       SUM(corrected_to = 'in_scope' AND verdict = 'out_of_scope') AS wrongly_refused,
       SUM(corrected_to = 'out_of_scope' AND verdict <> 'out_of_scope') AS wrongly_allowed,
       ROUND(AVG(latency_ms)) AS avg_latency_ms
     FROM apa_scope_log
     WHERE created_at > NOW() - INTERVAL 30 DAY`
  );

  const where: string[] = ["s.created_at > NOW() - INTERVAL 60 DAY"];
  if (verdict === "review") where.push("s.verdict <> 'in_scope' AND s.corrected_at IS NULL");
  else if (verdict === "corrected") where.push("s.corrected_at IS NOT NULL");
  else if (verdict === "in_scope") where.push("s.verdict = 'in_scope'");
  else if (verdict === "out_of_scope") where.push("s.verdict = 'out_of_scope'");
  else if (verdict === "ambiguous") where.push("s.verdict = 'ambiguous'");

  const rows = await queryRows<Row>(
    `SELECT CAST(s.id AS CHAR) AS id, s.input_text, s.verdict, s.topic, s.confidence,
            s.model, s.latency_ms, s.corrected_to, s.corrected_note, s.corrected_at,
            s.created_at, CAST(s.message_id AS CHAR) AS message_id,
            u.full_name, CAST(s.user_id AS CHAR) AS user_id,
            a.name AS corrected_by_name,
            (SELECT m.body FROM apa_messages m
              WHERE m.conversation_id = (SELECT conversation_id FROM apa_messages WHERE id = s.message_id)
                AND m.role = 'assistant' AND m.id > s.message_id
              ORDER BY m.id LIMIT 1) AS answer
       FROM apa_scope_log s
       LEFT JOIN app_users u ON u.id = s.user_id
       LEFT JOIN admin_users a ON a.id = s.corrected_by
      WHERE ${where.join(" AND ")}
      ORDER BY s.created_at DESC
      LIMIT ?`,
    [limit]
  );

  const total = Number(stats?.total ?? 0);
  return {
    metrics: {
      refusal_rate: total ? Number(((Number(stats?.refused ?? 0) / total) * 100).toFixed(1)) : 0,
      ambiguous: Number(stats?.ambiguous ?? 0),
      corrected: Number(stats?.corrected ?? 0),
      wrongly_refused: Number(stats?.wrongly_refused ?? 0),
      wrongly_allowed: Number(stats?.wrongly_allowed ?? 0),
      avg_latency_ms: Number(stats?.avg_latency_ms ?? 0),
      total
    },
    rows
  };
}

/**
 * A staff correction. This does not re-run anything and does not change what
 * the farmer was told — it is the training signal, and the reason the log holds
 * allow verdicts as well as refusals.
 */
export async function correctApaScope(payload: Row, adminId: number) {
  const id = String(payload.id ?? "").trim();
  const to = String(payload.corrected_to ?? "").trim();
  if (!id) throw new Error("A verdict id is required.");
  if (to !== "in_scope" && to !== "out_of_scope") throw new Error("corrected_to must be in_scope or out_of_scope.");

  await executeQuery(
    `UPDATE apa_scope_log
        SET corrected_to = ?, corrected_by = ?, corrected_note = ?, corrected_at = NOW()
      WHERE id = ?`,
    [to, adminId, String(payload.note ?? "").slice(0, 255) || null, id]
  );
  await recordAudit({
    actorAdminId: adminId,
    action: "apa_scope_corrected",
    entityType: "apa_scope_log",
    entityId: id,
    after: { corrected_to: to }
  });
  return { ok: true, corrected_to: to };
}

/* ---------------------------------------------------------------------------
   3. Vocabulary
   --------------------------------------------------------------------------- */

export async function getApaVocabulary(params: { group?: string | null; q?: string | null }) {
  const where: string[] = ["1 = 1"];
  const values: unknown[] = [];
  if (params.group && params.group !== "all") {
    where.push("term_group = ?");
    values.push(params.group);
  }
  if (params.q) {
    where.push("(term LIKE ? OR meaning_en LIKE ?)");
    values.push(`%${params.q}%`, `%${params.q}%`);
  }

  const [stats] = await queryRows<Row>(
    `SELECT COUNT(*) AS total, SUM(is_active = 1) AS active,
            SUM(heard_count > 0) AS heard, COUNT(DISTINCT term_group) AS group_count
       FROM apa_vocabulary`
  );
  const groups = await queryRows<Row>(
    `SELECT term_group, COUNT(*) AS n, SUM(heard_count) AS heard
       FROM apa_vocabulary GROUP BY term_group ORDER BY n DESC`
  );
  const rows = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, term, term_group, meaning_en, note, is_active,
            heard_count, sort_order, updated_at
       FROM apa_vocabulary
      WHERE ${where.join(" AND ")}
      ORDER BY heard_count DESC, term_group, term
      LIMIT 400`,
    values
  );

  // Words farmers actually said that are not on the list yet. This is the page's
  // whole reason to exist a month in: the seed list is a hundred and forty
  // guesses, and this is the evidence.
  const missing = await queryRows<Row>(
    `SELECT s.input_text, s.created_at
       FROM apa_scope_log s
      WHERE s.created_at > NOW() - INTERVAL 14 DAY AND s.verdict = 'in_scope'
      ORDER BY s.created_at DESC
      LIMIT 200`
  );

  return {
    metrics: {
      total: Number(stats?.total ?? 0),
      active: Number(stats?.active ?? 0),
      heard: Number(stats?.heard ?? 0),
      groups: Number(stats?.group_count ?? 0)
    },
    groups,
    rows,
    candidates: suggestTerms(
      missing.map((m) => String(m.input_text ?? "")),
      rows.map((r) => String(r.term))
    )
  };
}

/**
 * Words that keep turning up in transcripts and are not in the bias list.
 *
 * Crude on purpose: Bangla words of four characters or more, seen three times
 * or more, not already a term. A cleverer extractor would be harder to explain
 * to the staff member deciding whether to add one.
 */
function suggestTerms(texts: string[], known: string[]): Array<{ term: string; seen: number }> {
  const seen = new Map<string, number>();
  const knownSet = new Set(known);
  for (const text of texts) {
    for (const word of text.split(/[\s,।?!.।]+/)) {
      const term = word.trim();
      if (term.length < 4 || term.length > 30) continue;
      if (!/[ঀ-৿]/.test(term)) continue;
      if (knownSet.has(term)) continue;
      seen.set(term, (seen.get(term) ?? 0) + 1);
    }
  }
  return Array.from(seen.entries())
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([term, n]) => ({ term, seen: n }));
}

export async function saveApaVocabulary(payload: Row, adminId: number) {
  const id = String(payload.id ?? "").trim();
  const term = String(payload.term ?? "").trim();
  if (!id && !term) throw new Error("A term is required.");

  if (payload.remove === true && id) {
    await executeQuery("DELETE FROM apa_vocabulary WHERE id = ?", [id]);
    invalidateVocabulary();
    await recordAudit({ actorAdminId: adminId, action: "apa_vocabulary_deleted", entityType: "apa_vocabulary", entityId: id });
    return { ok: true, removed: true };
  }

  if (id) {
    await executeQuery(
      `UPDATE apa_vocabulary
          SET term = COALESCE(NULLIF(?, ''), term),
              term_group = COALESCE(NULLIF(?, ''), term_group),
              meaning_en = ?, note = ?, is_active = ?, sort_order = ?
        WHERE id = ?`,
      [
        term,
        String(payload.term_group ?? "").trim(),
        String(payload.meaning_en ?? "").trim() || null,
        String(payload.note ?? "").trim() || null,
        payload.is_active === false ? 0 : 1,
        Number(payload.sort_order ?? 0) || 0,
        id
      ]
    );
  } else {
    await executeQuery(
      `INSERT INTO apa_vocabulary (term, term_group, meaning_en, note, is_active, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_active = 1, term_group = VALUES(term_group)`,
      [
        term,
        String(payload.term_group ?? "general").trim() || "general",
        String(payload.meaning_en ?? "").trim() || null,
        String(payload.note ?? "").trim() || null,
        payload.is_active === false ? 0 : 1,
        Number(payload.sort_order ?? 0) || 0,
        adminId
      ]
    );
  }
  invalidateVocabulary();
  await recordAudit({
    actorAdminId: adminId,
    action: id ? "apa_vocabulary_updated" : "apa_vocabulary_added",
    entityType: "apa_vocabulary",
    entityId: id || null,
    after: { term }
  });
  return { ok: true };
}

/* ---------------------------------------------------------------------------
   4. Voice config
   --------------------------------------------------------------------------- */

/**
 * Which settings the console may write.
 *
 * A whitelist rather than "anything starting apa_", because this endpoint takes
 * a key straight from a form post and a typo in one of these names must not
 * create a new row that nothing ever reads.
 *
 * Anything absent here is reported back rather than dropped — see the note in
 * saveApaVoiceConfig on why silence was the wrong behaviour.
 */
const SETTING_KEYS = [
  "apa_enabled", "apa_free_questions", "apa_live_minutes_monthly", "apa_live_session_minutes",
  "apa_live_mic_enabled", "apa_live_client_ready", "apa_bandwidth_floor_kbps",
  "apa_data_mb_per_minute", "apa_voice_name", "apa_autoplay_voice", "apa_speech_rate",
  "apa_tts_max_chars", "apa_model_text", "apa_model_classify", "apa_model_transcribe",
  "apa_model_tts", "apa_model_live", "apa_model_vision", "apa_ask_per_minute",
  "apa_ask_per_day", "apa_budget_usd",
  // The cost and quota controls.
  "apa_tts_mode", "apa_answer_cache_hours", "apa_speech_cache_enabled", "apa_prompt_examples",
  "apa_image_max_px", "apa_fair_share_pct", "apa_prewarm_enabled", "apa_retention_days"
];

export async function getApaVoiceConfig() {
  const settings = await queryRows<Row>(
    `SELECT setting_key, value_text, description, updated_at FROM app_settings
      WHERE setting_key LIKE 'apa\\_%' ORDER BY setting_key`
  );
  const prompts = await queryRows<Row>(
    `SELECT CAST(p.id AS CHAR) AS id, p.prompt_key, p.label, p.body, p.updated_at, a.name AS updated_by_name
       FROM apa_prompts p LEFT JOIN admin_users a ON a.id = p.updated_by
      ORDER BY FIELD(p.prompt_key, 'persona', 'scope', 'live', 'refusal_bn'), p.prompt_key`
  );
  const config = await apaConfig();
  return { settings, prompts, resolved: config, voices: VOICES };
}

/** The prebuilt Gemini voices worth offering for Bangla. */
const VOICES = [
  { name: "Aoede", note: "Warm, measured — the current default" },
  { name: "Kore", note: "Firm, clear on a poor speaker" },
  { name: "Puck", note: "Brighter, younger" },
  { name: "Charon", note: "Lower, slower" }
];

export async function saveApaVoiceConfig(payload: Row, adminId: number) {
  const settings = (payload.settings ?? {}) as Record<string, unknown>;
  const written: string[] = [];
  // An unrecognised key used to be skipped in silence, which meant a setting
  // added to the form but not to the list above appeared to save and did
  // nothing — the kind of thing that costs an afternoon to notice.
  const ignored = Object.keys(settings).filter((key) => !SETTING_KEYS.includes(key));
  if (ignored.length) {
    throw new Error(
      `These are not settings this page may change: ${ignored.join(", ")}. Add them to SETTING_KEYS if that is wrong.`
    );
  }
  for (const [key, value] of Object.entries(settings)) {
    await executeQuery(
      `INSERT INTO app_settings (setting_key, value_text) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)`,
      [key, String(value ?? "").slice(0, 255)]
    );
    written.push(key);
  }

  const prompts = (payload.prompts ?? {}) as Record<string, unknown>;
  for (const [key, body] of Object.entries(prompts)) {
    const text = String(body ?? "").trim();
    if (!text) continue;
    // A scope instruction that has been emptied out is an assistant with no
    // restriction, so the floor is enforced here as well as in the token mint.
    if (key === "scope" && text.length < 200) {
      throw new Error("The scope instruction is too short to restrict anything. Keep it at least 200 characters.");
    }
    // Keep what is being replaced. The scope instruction is the safety
    // control; an accidental paste over it used to be unrecoverable, and the
    // audit log recorded only which key changed, not what was lost.
    const [before] = await queryRows<Row>(
      "SELECT body FROM apa_prompts WHERE prompt_key = ? LIMIT 1",
      [key]
    );
    if (before?.body && String(before.body) !== text) {
      await executeQuery(
        "INSERT INTO apa_prompt_versions (prompt_key, body, chars, changed_by, note) VALUES (?, ?, ?, ?, ?)",
        [key, before.body, String(before.body).length, adminId, "replaced from the console"]
      );
    }
    await executeQuery(
      "UPDATE apa_prompts SET body = ?, updated_by = ? WHERE prompt_key = ?",
      [text, adminId, key]
    );
    written.push(`prompt:${key}`);
  }

  invalidateSettings();
  invalidateApaPrompts();
  await recordAudit({
    actorAdminId: adminId,
    action: "apa_config_saved",
    entityType: "app_settings",
    after: { keys: written }
  });
  return { ok: true, written };
}

/* ---------------------------------------------------------------------------
   5. Usage and cost
   --------------------------------------------------------------------------- */

export async function getApaUsage(params: { months?: number }) {
  const months = Math.min(12, Math.max(1, Number(params.months ?? 6)));
  const cfg = await apaConfig();

  const [now] = await queryRows<Row>(
    `SELECT COALESCE(SUM(ask_count), 0) AS asks,
            COALESCE(SUM(voice_count), 0) AS voice,
            COALESCE(SUM(photo_count), 0) AS photo,
            COALESCE(SUM(live_sessions), 0) AS live_sessions,
            COALESCE(SUM(live_seconds), 0) AS live_seconds,
            COALESCE(SUM(transcribe_seconds), 0) AS transcribe_seconds,
            COALESCE(SUM(tts_chars), 0) AS tts_chars,
            COALESCE(SUM(tool_calls), 0) AS tool_calls,
            COALESCE(SUM(est_cost_usd), 0) AS cost,
            COUNT(DISTINCT user_id) AS farmers
       FROM apa_usage WHERE period = ?`,
    [period()]
  );

  const trend = await queryRows<Row>(
    `SELECT period,
            SUM(ask_count) AS asks,
            SUM(live_seconds) AS live_seconds,
            SUM(est_cost_usd) AS cost,
            COUNT(DISTINCT user_id) AS farmers
       FROM apa_usage
      GROUP BY period ORDER BY period DESC LIMIT ?`,
    [months]
  );

  const topUsers = await queryRows<Row>(
    `SELECT CAST(u.user_id AS CHAR) AS user_id, a.full_name, a.phone,
            d.name_en AS district,
            u.ask_count, u.voice_count, u.live_seconds, u.est_cost_usd
       FROM apa_usage u
       JOIN app_users a ON a.id = u.user_id
       LEFT JOIN geo_districts d ON d.id = a.district_id
      WHERE u.period = ?
      ORDER BY u.est_cost_usd DESC, u.ask_count DESC
      LIMIT 12`,
    [period()]
  );

  const tools = await queryRows<Row>(
    `SELECT tool, COUNT(*) AS calls, SUM(ok = 0) AS failures, ROUND(AVG(latency_ms)) AS avg_ms
       FROM apa_tool_calls WHERE created_at > NOW() - INTERVAL 30 DAY
      GROUP BY tool ORDER BY calls DESC`
  );

  const sessions = await queryRows<Row>(
    `SELECT end_reason, COUNT(*) AS n, ROUND(AVG(charged_seconds)) AS avg_seconds
       FROM apa_live_sessions WHERE minted_at > NOW() - INTERVAL 30 DAY
      GROUP BY end_reason ORDER BY n DESC`
  );

  const cost = Number(now?.cost ?? 0);
  return {
    period: period(),
    budget_usd: cfg.budgetUsd,
    metrics: {
      asks: Number(now?.asks ?? 0),
      voice: Number(now?.voice ?? 0),
      photo: Number(now?.photo ?? 0),
      farmers: Number(now?.farmers ?? 0),
      live_sessions: Number(now?.live_sessions ?? 0),
      live_minutes: Math.round(Number(now?.live_seconds ?? 0) / 60),
      transcribe_minutes: Math.round(Number(now?.transcribe_seconds ?? 0) / 60),
      tts_chars: Number(now?.tts_chars ?? 0),
      tool_calls: Number(now?.tool_calls ?? 0),
      cost_usd: Number(cost.toFixed(2)),
      budget_pct: cfg.budgetUsd ? Math.round((cost / cfg.budgetUsd) * 100) : 0,
      cost_per_farmer: now?.farmers ? Number((cost / Number(now.farmers)).toFixed(3)) : 0
    },
    trend: trend.reverse(),
    top_users: topUsers,
    tools,
    sessions,
    prices: MODEL_PRICES,
    speech_cost_per_minute: speechCostPerMinute(cfg.models.tts[0])
  };
}

/* ---------------------------------------------------------------------------
   6. Access and tiers
   --------------------------------------------------------------------------- */

export async function getApaAccess(params: { q?: string | null; tier?: string | null; limit?: number }) {
  const q = String(params.q ?? "").trim();
  const like = `%${q}%`;
  const limit = Math.min(200, Math.max(10, Number(params.limit ?? 50)));
  const cfg = await apaConfig();

  // The funnel the feature exists to move. Each step is a count of farmers who
  // have touched Apa at all, so the denominator is the people it is reaching
  // rather than the whole user table.
  const [funnel] = await queryRows<Row>(
    `SELECT
       (SELECT COUNT(DISTINCT user_id) FROM apa_messages) AS tried,
       (SELECT COUNT(*) FROM apa_entitlements WHERE trial_used > 0) AS started_trial,
       (SELECT COUNT(*) FROM apa_entitlements e JOIN app_users u ON u.id = e.user_id
         WHERE e.trial_used >= ? AND u.is_kyc_verified = 0) AS hit_wall,
       (SELECT COUNT(DISTINCT e.user_id) FROM apa_entitlements e
          JOIN app_user_kyc_documents k ON k.user_id = e.user_id
         WHERE e.trial_used > 0 AND k.status = 'pending') AS submitted_kyc,
       (SELECT COUNT(DISTINCT e.user_id) FROM apa_entitlements e
          JOIN app_users u ON u.id = e.user_id
         WHERE e.trial_used > 0 AND u.is_kyc_verified = 1) AS verified,
       (SELECT COUNT(*) FROM apa_entitlements WHERE granted_tier IS NOT NULL) AS granted,
       (SELECT COUNT(*) FROM apa_entitlements WHERE is_blocked = 1) AS blocked`,
    [cfg.freeQuestions]
  );

  const where: string[] = ["1 = 1"];
  const values: unknown[] = [];
  if (q) {
    where.push("(u.full_name LIKE ? OR u.phone LIKE ? OR CAST(u.id AS CHAR) = ?)");
    values.push(like, like, q);
  }
  if (params.tier === "granted") where.push("e.granted_tier IS NOT NULL");
  if (params.tier === "blocked") where.push("e.is_blocked = 1");
  if (params.tier === "verified") where.push("u.is_kyc_verified = 1");
  if (params.tier === "wall") where.push(`e.trial_used >= ${Number(cfg.freeQuestions)} AND u.is_kyc_verified = 0`);

  const rows = await queryRows<Row>(
    `SELECT CAST(u.id AS CHAR) AS user_id, u.full_name, u.phone, u.is_kyc_verified,
            d.name_en AS district,
            COALESCE(e.trial_used, 0) AS trial_used,
            e.granted_tier, e.tier_source, e.tier_expires_at, e.is_blocked, e.blocked_reason,
            e.live_minutes_override, e.reason,
            a.name AS granted_by_name,
            COALESCE(mu.ask_count, 0) AS ask_count,
            COALESCE(mu.live_seconds, 0) AS live_seconds
       FROM app_users u
       LEFT JOIN apa_entitlements e ON e.user_id = u.id
       LEFT JOIN admin_users a ON a.id = e.granted_by
       LEFT JOIN geo_districts d ON d.id = u.district_id
       LEFT JOIN apa_usage mu ON mu.user_id = u.id AND mu.period = ?
      WHERE ${where.join(" AND ")}
        AND (e.id IS NOT NULL OR EXISTS (SELECT 1 FROM apa_messages m WHERE m.user_id = u.id))
      ORDER BY COALESCE(mu.ask_count, 0) DESC, u.created_at DESC
      LIMIT ?`,
    [period(), ...values, limit]
  );

  const tried = Number(funnel?.tried ?? 0);
  const pct = (n: unknown) => (tried ? Math.round((Number(n ?? 0) / tried) * 100) : 0);
  return {
    free_questions: cfg.freeQuestions,
    funnel: [
      { id: "tried", label: "Asked Apa at least once", count: tried, pct: 100 },
      { id: "started_trial", label: "Spent a trial question", count: Number(funnel?.started_trial ?? 0), pct: pct(funnel?.started_trial) },
      { id: "hit_wall", label: "Reached the soft wall", count: Number(funnel?.hit_wall ?? 0), pct: pct(funnel?.hit_wall) },
      { id: "submitted_kyc", label: "Submitted a document", count: Number(funnel?.submitted_kyc ?? 0), pct: pct(funnel?.submitted_kyc) },
      { id: "verified", label: "Verified", count: Number(funnel?.verified ?? 0), pct: pct(funnel?.verified) }
    ],
    metrics: {
      tried,
      verified: Number(funnel?.verified ?? 0),
      granted: Number(funnel?.granted ?? 0),
      blocked: Number(funnel?.blocked ?? 0),
      conversion_pct: pct(funnel?.verified)
    },
    rows
  };
}

export async function grantApaTier(payload: Row, adminId: number) {
  const userId = String(payload.user_id ?? "").trim();
  if (!userId) throw new Error("A farmer is required.");
  const tier = String(payload.tier ?? "").trim();
  const valid = ["verified_free", "premium", "staff"];
  const chosen = valid.includes(tier) ? (tier as "verified_free" | "premium" | "staff") : null;

  await setEntitlementGrant({
    userId,
    tier: chosen,
    expiresAt: String(payload.expires_at ?? "").trim() || null,
    reason: String(payload.reason ?? "").trim() || null,
    adminId,
    blocked: payload.blocked === true,
    blockedReason: String(payload.blocked_reason ?? "").trim() || null,
    liveMinutes:
      payload.live_minutes === null || payload.live_minutes === undefined || payload.live_minutes === ""
        ? null
        : Number(payload.live_minutes),
    resetTrial: payload.reset_trial === true
  });

  await recordAudit({
    actorAdminId: adminId,
    action: payload.blocked === true ? "apa_access_blocked" : chosen ? "apa_tier_granted" : "apa_tier_cleared",
    entityType: "apa_entitlements",
    entityId: userId,
    after: { tier: chosen, blocked: payload.blocked === true, reason: payload.reason ?? null }
  });
  return { ok: true, tier: chosen };
}

/* ---------------------------------------------------------------------------
   7. Answer feedback
   --------------------------------------------------------------------------- */

export async function getApaFeedback(params: { vote?: string | null; state?: string | null; limit?: number }) {
  const limit = Math.min(200, Math.max(10, Number(params.limit ?? 60)));

  const [stats] = await queryRows<Row>(
    `SELECT COUNT(*) AS total,
            SUM(vote = 'up') AS up,
            SUM(vote = 'down') AS down,
            SUM(vote = 'down' AND reviewed_at IS NULL) AS open_down
       FROM apa_feedback WHERE created_at > NOW() - INTERVAL 90 DAY`
  );
  const [answers] = await queryRows<Row>(
    `SELECT COUNT(*) AS n FROM apa_messages
      WHERE role = 'assistant' AND created_at > NOW() - INTERVAL 90 DAY`
  );

  const where: string[] = ["1 = 1"];
  if (params.vote === "down") where.push("f.vote = 'down'");
  if (params.vote === "up") where.push("f.vote = 'up'");
  if (params.state === "open") where.push("f.reviewed_at IS NULL");
  if (params.state === "reviewed") where.push("f.reviewed_at IS NOT NULL");

  const rows = await queryRows<Row>(
    `SELECT CAST(f.id AS CHAR) AS id, f.vote, f.reason, f.note, f.created_at,
            f.reviewed_at, f.review_note, a.name AS reviewed_by_name,
            CAST(m.id AS CHAR) AS message_id, m.body AS answer, m.advice, m.input_mode,
            m.model, m.hedged, m.sources_json,
            CAST(m.conversation_id AS CHAR) AS conversation_id,
            (SELECT q.transcript FROM apa_messages q
              WHERE q.conversation_id = m.conversation_id AND q.role = 'user' AND q.id < m.id
              ORDER BY q.id DESC LIMIT 1) AS asked_transcript,
            (SELECT q.body FROM apa_messages q
              WHERE q.conversation_id = m.conversation_id AND q.role = 'user' AND q.id < m.id
              ORDER BY q.id DESC LIMIT 1) AS asked,
            u.full_name, u.phone
       FROM apa_feedback f
       JOIN apa_messages m ON m.id = f.message_id
       JOIN app_users u ON u.id = f.user_id
       LEFT JOIN admin_users a ON a.id = f.reviewed_by
      WHERE ${where.join(" AND ")}
      ORDER BY (f.vote = 'down' AND f.reviewed_at IS NULL) DESC, f.created_at DESC
      LIMIT ?`,
    [limit]
  );

  const reasons = await queryRows<Row>(
    `SELECT COALESCE(reason, 'unstated') AS reason, COUNT(*) AS n
       FROM apa_feedback WHERE vote = 'down' GROUP BY reason ORDER BY n DESC`
  );

  const total = Number(stats?.total ?? 0);
  return {
    metrics: {
      total,
      up: Number(stats?.up ?? 0),
      down: Number(stats?.down ?? 0),
      open_down: Number(stats?.open_down ?? 0),
      satisfaction_pct: total ? Math.round((Number(stats?.up ?? 0) / total) * 100) : 0,
      // How many answers got any vote at all. A satisfaction figure from three
      // votes out of nine hundred is not a satisfaction figure, and the page
      // should say so rather than print a confident percentage.
      response_pct: Number(answers?.n ?? 0)
        ? Number(((total / Number(answers.n)) * 100).toFixed(1))
        : 0
    },
    reasons,
    rows: rows.map(({ sources_json, ...r }) => ({ ...r, sources: jsonArray(sources_json) }))
  };
}

export async function reviewApaFeedback(payload: Row, adminId: number) {
  const id = String(payload.id ?? "").trim();
  if (!id) throw new Error("A feedback id is required.");
  await executeQuery(
    "UPDATE apa_feedback SET reviewed_at = NOW(), reviewed_by = ?, review_note = ? WHERE id = ?",
    [adminId, String(payload.note ?? "").slice(0, 255) || null, id]
  );
  await recordAudit({
    actorAdminId: adminId,
    action: "apa_feedback_reviewed",
    entityType: "apa_feedback",
    entityId: id
  });
  return { ok: true };
}


/* ---------------------------------------------------------------------------
   8. Requests and quota
   --------------------------------------------------------------------------- */

/**
 * How many calls went to each model today, and how much of its daily allowance
 * that is likely to be.
 *
 * This page exists because the free tier caps requests **per model per project
 * per day** — measured: `gemini-3.6-flash` reports `quotaValue: 20` — so
 * "how many calls have we made" is only a meaningful question per model. The
 * old Usage page could not answer it at all, and the first sign of trouble was
 * a farmer being told the assistant was busy.
 *
 * The allowances below are observed, not published: Google's rate-limit page
 * now defers to AI Studio, so `KNOWN_FREE_RPD` holds what this project's own
 * 429s reported and `observed` marks which of them we have actually seen. A
 * figure nobody has confirmed is shown as unknown rather than guessed at.
 */
// The allowances themselves live in lib/apa/models.ts, beside the runner that
// trips over them and the fair-share guard that rations what is left.
const KNOWN_FREE_RPD = FREE_RPD;

export async function getApaQuota() {
  const cfg = await apaConfig();
  const [rows, trend, cache, answered] = await Promise.all([
    modelCallsToday(),
    modelCallsTrend(14),
    cacheStats(),
    // The denominator for "how many answers came out of the cache" has to be
    // answers, not model calls: a retry down a fallback chain is two calls and
    // one answer, and a cache hit is an answer with no call at all.
    queryRows<Row>(
      `SELECT COUNT(*) AS answers,
              COALESCE(SUM(from_cache), 0) AS from_cache,
              COALESCE(SUM(asked_clarification), 0) AS clarifications
         FROM apa_messages
        WHERE role = 'assistant' AND created_at >= CURDATE()`
    )
  ]);

  // Per job as well as per model. A model's total is the wrong number to show
  // against one job in a chain — `gemini-3.1-flash-lite` answering thirteen
  // questions and classifying none would otherwise read, on the scope-gate
  // row, as thirteen scope-gate calls.
  const jobCalls: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const job = String(row.job);
    const model = String(row.model);
    jobCalls[job] = jobCalls[job] ?? {};
    jobCalls[job][model] = (jobCalls[job][model] ?? 0) + Number(row.calls ?? 0);
  }
  // `text` is the configured name of the job the runner records as `answer`.
  if (jobCalls.answer && !jobCalls.text) jobCalls.text = jobCalls.answer;

  const byModel = new Map<string, Row>();
  for (const row of rows) {
    const model = String(row.model);
    const existing = byModel.get(model) ?? {
      model,
      jobs: [] as string[],
      calls: 0, ok_calls: 0, quota_errors: 0, other_errors: 0,
      tokens_in: 0, tokens_out: 0, cached_tokens: 0, est_cost_usd: 0,
      last_error: null as string | null, last_quota_at: null as unknown
    };
    (existing.jobs as string[]).push(String(row.job));
    existing.calls = Number(existing.calls) + Number(row.calls ?? 0);
    existing.ok_calls = Number(existing.ok_calls) + Number(row.ok_calls ?? 0);
    existing.quota_errors = Number(existing.quota_errors) + Number(row.quota_errors ?? 0);
    existing.other_errors = Number(existing.other_errors) + Number(row.other_errors ?? 0);
    existing.tokens_in = Number(existing.tokens_in) + Number(row.tokens_in ?? 0);
    existing.tokens_out = Number(existing.tokens_out) + Number(row.tokens_out ?? 0);
    existing.cached_tokens = Number(existing.cached_tokens) + Number(row.cached_tokens ?? 0);
    existing.est_cost_usd = Number(existing.est_cost_usd) + Number(row.est_cost_usd ?? 0);
    if (row.last_error) existing.last_error = String(row.last_error);
    if (row.last_quota_at) existing.last_quota_at = row.last_quota_at;
    byModel.set(model, existing);
  }

  // Every model named in a chain appears, even at zero calls, so a configured
  // fallback that has never been reached is visible rather than absent.
  const configured = new Map<string, string[]>();
  for (const [job, chain] of Object.entries(cfg.models)) {
    for (const model of chain as string[]) {
      configured.set(model, [...(configured.get(model) ?? []), job]);
    }
  }
  for (const [model, jobs] of configured) {
    if (!byModel.has(model)) {
      byModel.set(model, {
        model, jobs, calls: 0, ok_calls: 0, quota_errors: 0, other_errors: 0,
        tokens_in: 0, tokens_out: 0, cached_tokens: 0, est_cost_usd: 0,
        last_error: null, last_quota_at: null
      });
    }
  }

  const spent = new Set(spentModels());
  const models = Array.from(byModel.values())
    .map((row): Row => {
      const model = String(row.model);
      const known = KNOWN_FREE_RPD[model];
      const used = Number(row.calls);
      return {
        ...row,
        jobs: Array.from(new Set(row.jobs as string[])),
        configured_for: configured.get(model) ?? [],
        in_use: configured.has(model),
        // First in a chain is the one we want; the rest are the safety net.
        is_primary: Object.values(cfg.models).some((chain) => (chain as string[])[0] === model),
        free_rpd: known?.rpd ?? null,
        free_rpd_observed: known?.observed ?? false,
        remaining: known ? Math.max(0, known.rpd - used) : null,
        used_pct: known ? Math.min(100, Math.round((used / known.rpd) * 100)) : null,
        exhausted: spent.has(model) || Number(row.quota_errors) > 0
      };
    })
    .sort((a, b) => Number(b.calls) - Number(a.calls));

  const totals = { calls: 0, ok: 0, quota: 0, other: 0, cost: 0, cached: 0 };
  for (const m of models) {
    totals.calls += Number(m.calls ?? 0);
    totals.ok += Number(m.ok_calls ?? 0);
    totals.quota += Number(m.quota_errors ?? 0);
    totals.other += Number(m.other_errors ?? 0);
    totals.cost += Number(m.est_cost_usd ?? 0);
    totals.cached += Number(m.cached_tokens ?? 0);
  }

  const asked = answered[0] ?? {};
  const answers = Number(asked.answers ?? 0);
  const fromCache = Number(asked.from_cache ?? 0);

  return {
    day: new Date().toISOString().slice(0, 10),
    // Google's daily quotas reset at midnight Pacific, which is what a staff
    // member in Dhaka needs told rather than left to work out.
    resets_at: nextPacificMidnight(),
    tts_mode: cfg.ttsMode,
    chains: cfg.models,
    job_calls: jobCalls,
    models,
    totals,
    // Today, in answers rather than calls.
    answers: {
      total: answers,
      from_cache: fromCache,
      from_model: Math.max(0, answers - fromCache),
      cache_pct: answers ? Math.round((fromCache / answers) * 100) : 0,
      clarifications: Number(asked.clarifications ?? 0)
    },
    trend,
    cache,
    exhausted: Array.from(spent)
  };
}

/** When the per-day counters go back to zero, in both places it matters. */
function nextPacificMidnight(): { utc: string; dhaka: string; hours_away: number } {
  const now = new Date();
  // Pacific is UTC-7 in summer and UTC-8 in winter; the eight-hour offset is
  // the safe one to quote because it never claims the reset has happened early.
  const offsetHours = 8;
  const pacificNow = new Date(now.getTime() - offsetHours * 3_600_000);
  const nextMidnight = Date.UTC(
    pacificNow.getUTCFullYear(), pacificNow.getUTCMonth(), pacificNow.getUTCDate() + 1
  ) + offsetHours * 3_600_000;
  const at = new Date(nextMidnight);
  return {
    utc: at.toISOString(),
    dhaka: at.toLocaleString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }),
    hours_away: Number(((nextMidnight - now.getTime()) / 3_600_000).toFixed(1))
  };
}

/** Clear the in-process "this model is spent" hints — after a key change. */
export async function resetApaQuotaHints(adminId: number) {
  forgetSpentModels();
  const pruned = await pruneAnswerCache();
  await recordAudit({
    actorAdminId: adminId,
    action: "apa_quota_hints_reset",
    entityType: "apa_model_calls",
    after: { pruned_cache_rows: pruned }
  });
  return { ok: true, pruned_cache_rows: pruned };
}

/* ---------------------------------------------------------------------------
   9. Prompt history
   --------------------------------------------------------------------------- */

export async function getApaPromptVersions(promptKey: string | null) {
  const where = promptKey ? "WHERE v.prompt_key = ?" : "";
  const values = promptKey ? [promptKey] : [];
  const rows = await queryRows<Row>(
    `SELECT CAST(v.id AS CHAR) AS id, v.prompt_key, v.chars, v.note, v.created_at,
            a.name AS changed_by_name,
            LEFT(v.body, 400) AS preview
       FROM apa_prompt_versions v
       LEFT JOIN admin_users a ON a.id = v.changed_by
       ${where}
      ORDER BY v.id DESC
      LIMIT 60`,
    values
  );
  return { rows };
}

export async function getApaPromptVersion(id: string) {
  const [row] = await queryRows<Row>(
    "SELECT CAST(id AS CHAR) AS id, prompt_key, body, chars, created_at FROM apa_prompt_versions WHERE id = ? LIMIT 1",
    [id]
  );
  if (!row) throw new Error("No such prompt version.");
  return row;
}

/**
 * Put an earlier version back.
 *
 * The scope instruction is the safety control, so losing it to a bad paste must
 * be recoverable in one click rather than by finding whoever has a copy.
 */
export async function revertApaPrompt(payload: Row, adminId: number) {
  const id = String(payload.id ?? "").trim();
  if (!id) throw new Error("A version id is required.");
  const version = await getApaPromptVersion(id);
  const key = String(version.prompt_key);
  const body = String(version.body);

  if (key === "scope" && body.trim().length < 200) {
    throw new Error("That version of the scope instruction is too short to restrict anything.");
  }

  const [current] = await queryRows<Row>("SELECT body FROM apa_prompts WHERE prompt_key = ? LIMIT 1", [key]);
  if (current?.body) {
    await executeQuery(
      "INSERT INTO apa_prompt_versions (prompt_key, body, chars, changed_by, note) VALUES (?, ?, ?, ?, ?)",
      [key, current.body, String(current.body).length, adminId, `replaced by revert to version ${id}`]
    );
  }
  await executeQuery("UPDATE apa_prompts SET body = ?, updated_by = ? WHERE prompt_key = ?", [body, adminId, key]);
  invalidateApaPrompts();
  await recordAudit({
    actorAdminId: adminId,
    action: "apa_prompt_reverted",
    entityType: "apa_prompts",
    entityId: id,
    before: { chars: current?.body ? String(current.body).length : 0 },
    after: { prompt_key: key, chars: body.length }
  });
  return { ok: true, prompt_key: key, chars: body.length };
}


/* ---------------------------------------------------------------------------
   10. Pre-warming the cache
   --------------------------------------------------------------------------- */

/**
 * Answer one question ahead of time and hold it for the day.
 *
 * Called by `scripts/apa-prewarm.cjs` just after the quota resets, when the
 * day's allowance is idle. It lives under `admin/` rather than behind a new
 * shared secret deliberately: the script already has database credentials, so
 * it mints itself a short-lived admin session and deletes it afterwards, and
 * no second authentication mechanism has to exist or be kept secret.
 *
 * All of the judgement about whether an answer may be held is in
 * lib/apa/prewarm.ts, which discards rather than caches whenever it is unsure.
 */
export async function prewarmApaAnswer(payload: Row) {
  const userId = String(payload.user_id ?? "").trim();
  const question = String(payload.text ?? "").trim();
  if (!userId) throw new Error("A user id is required — the district comes from it.");
  if (!question) throw new Error("A question is required.");
  return prewarmAnswer({ userId, question });
}
