// mPowerU orchestration — SRS §18.5, ADM-LON-21…25.
//
// Everything provider-specific is behind lib/mpoweru/adapter.ts. This file owns
// the parts that stay ours whatever EcoDev's API turns out to be: when a session
// may be created, what is stored, who may see which half of the result, and how a
// completion becomes a number the scorecard can read.

import { queryRows, withTransaction, type Tx } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import {
  assertDriverUsableHere,
  getMpowerUDriver,
  isStubDriver,
  respondentIdFor,
  type MpowerUStatus,
} from "@/lib/mpoweru/adapter";
import type { Row } from "./shared";

type Ctx = { adminId: number | null; ip?: string | null; userAgent?: string | null };

/** Factor-level output is analyst-and-above (ADM-LON-24). */
export const FACTOR_ROLES = ["super_admin", "hq_admin", "credit_analyst", "credit_approver"];

const parseJson = <T,>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
};

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export async function startMpowerUSession(payload: Record<string, unknown>, ctx: Ctx) {
  const applicationId = Number(payload.application_id);
  if (!Number.isFinite(applicationId)) throw new Error("A numeric application_id is required.");

  const driver = getMpowerUDriver();
  assertDriverUsableHere(driver);

  const apps = await queryRows<Row>(
    `SELECT a.id, a.user_id, a.district, u.district AS user_district
     FROM loan_applications a JOIN app_users u ON u.id = a.user_id WHERE a.id = ?`,
    [applicationId]
  );
  const app = apps[0];
  if (!app) throw new Error("Application not found.");

  // One live session per application. Without this, a double-tap on a slow
  // connection sits the farmer two assessments and the later result silently
  // replaces the earlier one.
  const live = await queryRows<Row>(
    `SELECT provider_session_id, status, assessment_url FROM mpoweru_sessions
     WHERE application_id = ? AND status IN ('created','in_progress','submitted','processing')
     ORDER BY id DESC LIMIT 1`,
    [applicationId]
  );
  if (live[0]) {
    return {
      reused: true,
      provider_session_id: live[0].provider_session_id,
      status: live[0].status,
      assessment_url: live[0].assessment_url,
    };
  }

  const idempotencyKey = `app-${applicationId}-${respondentIdFor(Number(app.user_id)).slice(0, 12)}`;

  const handle = await driver.createSession({
    applicationId,
    userId: Number(app.user_id),
    // Minimum attributes only (ADM-LON-22). No name, no phone, no document.
    attributes: {
      district: (app.district ?? app.user_district ?? null) as string | null,
      language: "bn",
    },
    idempotencyKey,
  });

  await withTransaction(async (tx: Tx) => {
    await tx.execute(
      `INSERT INTO mpoweru_sessions
         (application_id, user_id, driver, provider_session_id, respondent_id, idempotency_key,
          status, assessment_url, expires_at, questionnaire_version, model_version, is_stub, requested_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status), assessment_url = VALUES(assessment_url), expires_at = VALUES(expires_at)`,
      [
        applicationId, app.user_id, driver.name, handle.provider_session_id, handle.respondent_id,
        idempotencyKey, handle.status, handle.assessment_url, handle.expires_at,
        handle.questionnaire_version, handle.model_version, isStubDriver(driver) ? 1 : 0, ctx.adminId,
      ]
    );
    await tx.execute(
      `INSERT INTO loan_application_events (application_id, to_status, actor_type, actor_id, note_bn, note_en)
       VALUES (?, 'behavioral_pending', 'admin', ?, 'আচরণগত মূল্যায়ন শুরু হয়েছে।', ?)`,
      [applicationId, ctx.adminId, `mPowerU session created via the ${driver.name} driver.`]
    );
  });

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: "mpoweru.session.create",
    entityType: "mpoweru_sessions",
    entityId: applicationId,
    // The respondent id is deliberately absent from the audit body: it is a
    // pseudonym, and copying it next to the application id in a widely-read table
    // is the one place the pseudonymisation could be undone.
    after: { driver: driver.name, status: handle.status, is_stub: isStubDriver(driver) },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return {
    reused: false,
    provider_session_id: handle.provider_session_id,
    status: handle.status,
    assessment_url: handle.assessment_url,
    is_stub: isStubDriver(driver),
  };
}

// ---------------------------------------------------------------------------
// Completion — shared by the webhook and the poller (ADM-LON-23)
// ---------------------------------------------------------------------------

/**
 * Pull the result and, if complete, write the normalised band into
 * `loan_evidence` where the scorecard reads it.
 *
 * Safe to call repeatedly and from both paths. A webhook that arrives twice, or
 * arrives and is then polled, must not produce two scores.
 */
export async function syncMpowerUSession(providerSessionId: string, ctx: Ctx) {
  const driver = getMpowerUDriver();

  const sessions = await queryRows<Row>(
    "SELECT id, application_id, user_id, status FROM mpoweru_sessions WHERE provider_session_id = ? AND driver = ?",
    [providerSessionId, driver.name]
  );
  const session = sessions[0];
  if (!session) throw new Error("Unknown mPowerU session.");

  if (session.status === "completed") {
    return { provider_session_id: providerSessionId, status: "completed", already: true };
  }

  const result = await driver.fetchResult(providerSessionId);

  await withTransaction(async (tx: Tx) => {
    await tx.execute(
      `UPDATE mpoweru_sessions
          SET status = ?, normalised_score = ?, band = ?, factors_json = ?,
              risk_flags_json = ?, development_areas_json = ?,
              questionnaire_version = ?, model_version = ?, failure_reason = ?,
              completed_at = CASE WHEN ? = 'completed' THEN NOW() ELSE completed_at END,
              last_polled_at = NOW()
        WHERE id = ?`,
      [
        result.status, result.normalised_score, result.band,
        result.factors ? JSON.stringify(result.factors) : null,
        JSON.stringify(result.risk_flags ?? []),
        JSON.stringify(result.development_areas ?? []),
        result.questionnaire_version, result.model_version, result.failure_reason,
        result.status, session.id,
      ]
    );

    // ADM-LON-25 / LRG §11.4. A failure writes nothing. The criterion then has no
    // data, which the scorecard rates 0 *and flags* — a visible gap rather than a
    // silent penalty for the provider's outage.
    if (result.status === "completed" && result.normalised_score != null) {
      await tx.execute(
        `INSERT INTO loan_evidence
           (application_id, section, field_key, value_number, source_type,
            source_reference, verification_status, verified_at, confidence, is_material)
         VALUES (?, 'mpoweru', 'normalised_score', ?, 'transaction', ?, 'verified', NOW(), 'high', 1)
         ON DUPLICATE KEY UPDATE
           value_number = VALUES(value_number), source_reference = VALUES(source_reference),
           verification_status = VALUES(verification_status), verified_at = VALUES(verified_at)`,
        [session.application_id, result.normalised_score, `mpoweru:${providerSessionId}`]
      );
    }
  });

  await recordAudit({
    actorAdminId: ctx.adminId,
    action: "mpoweru.session.sync",
    entityType: "mpoweru_sessions",
    entityId: Number(session.id),
    // The band, not the factors. Audit rows are read far more widely than the
    // session table, and factor-level output is restricted (ADM-LON-24).
    after: { status: result.status, normalised_score: result.normalised_score, band: result.band },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return {
    provider_session_id: providerSessionId,
    status: result.status,
    normalised_score: result.normalised_score,
    band: result.band,
    already: false,
  };
}

/** Poll every session the provider has not reported on. The webhook fallback. */
export async function pollPendingMpowerUSessions(ctx: Ctx) {
  const pending = await queryRows<Row>(
    `SELECT provider_session_id FROM mpoweru_sessions
     WHERE status IN ('created','in_progress','submitted','processing')
     ORDER BY COALESCE(last_polled_at, created_at) LIMIT 50`
  );

  let completed = 0;
  const failures: string[] = [];
  for (const s of pending) {
    try {
      const r = await syncMpowerUSession(String(s.provider_session_id), ctx);
      if (r.status === "completed") completed += 1;
    } catch (error) {
      // One provider hiccup must not stop the rest of the batch.
      failures.push(String(s.provider_session_id));
    }
  }

  return { polled: pending.length, completed, failed: failures.length };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getMpowerUStatus(applicationId: string, role: string) {
  const id = Number(applicationId);
  if (!Number.isFinite(id)) throw new Error("A numeric application_id is required.");

  const rows = await queryRows<Row>(
    `SELECT provider_session_id, driver, status, assessment_url, normalised_score, band,
            factors_json, risk_flags_json, development_areas_json,
            questionnaire_version, model_version, failure_reason, is_stub,
            created_at, completed_at
     FROM mpoweru_sessions WHERE application_id = ? ORDER BY id DESC`,
    [id]
  );

  const maySeeFactors = FACTOR_ROLES.includes(role);

  return {
    sessions: rows.map((r) => ({
      provider_session_id: r.provider_session_id,
      driver: r.driver,
      status: r.status,
      assessment_url: r.assessment_url,
      normalised_score: r.normalised_score == null ? null : Number(r.normalised_score),
      band: r.band,
      risk_flags: parseJson<string[]>(r.risk_flags_json, []),
      development_areas: parseJson<string[]>(r.development_areas_json, []),
      // ADM-LON-24 — omitted entirely rather than nulled, so a field officer's
      // payload gives no hint that the field exists.
      ...(maySeeFactors ? { factors: parseJson<Record<string, number> | null>(r.factors_json, null) } : {}),
      questionnaire_version: r.questionnaire_version,
      model_version: r.model_version,
      failure_reason: r.failure_reason,
      // Surfaced so nobody mistakes an invented score for a real one.
      is_stub: Number(r.is_stub) === 1,
      created_at: r.created_at,
      completed_at: r.completed_at,
    })),
    // The integration is not live yet; the console should say so rather than
    // present stub numbers as an assessment.
    driver_is_stub: rows[0] ? Number(rows[0].is_stub) === 1 : true,
  };
}

/**
 * Webhook entry point. Signature verification happens in the driver; a payload
 * that fails it is dropped, because an unauthenticated webhook that sets a
 * behavioural score writes 20 points onto any application from the internet.
 */
export async function handleMpowerUWebhook(rawBody: string, headers: Record<string, string>) {
  const driver = getMpowerUDriver();
  if (!driver.verifyWebhook(rawBody, headers)) {
    throw new Error("Webhook signature verification failed.");
  }
  const { provider_session_id, status } = driver.parseWebhook(rawBody);
  const synced = await syncMpowerUSession(provider_session_id, { adminId: null });
  return { ...synced, reported_status: status as MpowerUStatus };
}
