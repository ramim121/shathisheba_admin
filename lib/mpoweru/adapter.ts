// mPowerU behavioural assessment — SRS §18.5, ADM-LON-21…25 / BLU §7.
//
// **EcoDev has not given us a sandbox yet.** Everything below is written against
// the contract the SRS describes rather than against a live API, and the only
// driver that exists is a stub. The point of the adapter is that when the real
// endpoint arrives, one file is written (`drivers/ecodev.ts`) and one environment
// variable is changed — nothing that calls this file moves.
//
// The seams that matter, and why each is here rather than inline:
//
//   * **Pseudonymous respondent id** (ADM-LON-22). The provider is sent a hash,
//     never the user id, and never a document. If the mapping is only ever
//     resolvable on our side, a breach at the provider cannot be joined back to
//     a named farmer.
//
//   * **Idempotency** (ADM-LON-23). Field connectivity retries. A create that is
//     replayed must return the same session, not a second respondent — otherwise
//     a farmer sits two assessments and the second overwrites the first.
//
//   * **Webhook plus polling** (ADM-LON-23). Webhooks are lost. Polling alone is
//     slow. Both, with the same handler, so a completion arriving twice is a
//     no-op rather than a duplicate score.
//
//   * **Failure never scores adversely** (ADM-LON-25 / LRG §11.4). A provider
//     outage leaves the criterion with no data, which the scorecard already rates
//     0 *and flags* — visible as a gap rather than silently penalised as a bad
//     result. The distinction is the whole reason ENG-18 exists.
//
//   * **Factor-level output is role-restricted** (ADM-LON-24). Only the
//     normalised band is written to `loan_evidence`, which is all the engine
//     reads. Raw factor output stays in the session row and is never returned to
//     a field officer or exported to a lender.

export type MpowerUStatus =
  | "created"
  | "in_progress"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "expired";

export type SessionRequest = {
  /** Our application id — used only to derive the pseudonymous id, never sent. */
  applicationId: number;
  userId: number;
  /** Minimum attributes the instrument needs. No names, no documents. */
  attributes: { district?: string | null; enterprise_type?: string | null; language?: "bn" | "en" };
  /** Stable across retries, so a replay cannot create a second respondent. */
  idempotencyKey: string;
};

export type SessionHandle = {
  provider_session_id: string;
  respondent_id: string;
  status: MpowerUStatus;
  /** Where the farmer completes the instrument. Null until the provider issues it. */
  assessment_url: string | null;
  expires_at: string | null;
  questionnaire_version: string | null;
  model_version: string | null;
};

export type SessionResult = {
  provider_session_id: string;
  status: MpowerUStatus;
  /**
   * 0–100 after normalisation. This is the ONLY number that reaches the
   * scorecard. Null while incomplete or failed — never 0, because 0 is a real
   * band and "we do not know" is not.
   */
  normalised_score: number | null;
  band: string | null;
  /** Role-restricted (ADM-LON-24). Stored, never returned to the app or a lender. */
  factors: Record<string, number> | null;
  risk_flags: string[];
  development_areas: string[];
  questionnaire_version: string | null;
  model_version: string | null;
  failure_reason: string | null;
};

export interface MpowerUDriver {
  readonly name: string;
  createSession(request: SessionRequest): Promise<SessionHandle>;
  fetchResult(providerSessionId: string): Promise<SessionResult>;
  /**
   * Verify a webhook body actually came from the provider. Returning false must
   * drop the payload: an unauthenticated webhook that sets a behavioural score is
   * a way to write 20 points onto any application from the internet.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean;
  parseWebhook(rawBody: string): { provider_session_id: string; status: MpowerUStatus };
}

// ---------------------------------------------------------------------------
// Pseudonymisation (ADM-LON-22 / BLU §7.3)
// ---------------------------------------------------------------------------

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * A respondent id the provider can use as a stable key and nobody outside this
 * system can reverse. Salted with MPOWERU_RESPONDENT_SALT so the same user is the
 * same respondent across sessions, but the id is meaningless without the salt.
 */
export function respondentIdFor(userId: number): string {
  const salt = process.env.MPOWERU_RESPONDENT_SALT ?? "";
  if (!salt) {
    // Failing loudly beats emitting a guessable id: an unsalted hash of a small
    // integer is trivially reversed by anyone who guesses the scheme.
    throw new Error("MPOWERU_RESPONDENT_SALT is not set. Refusing to create a reversible respondent id.");
  }
  return createHash("sha256").update(`${salt}:${userId}`).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Normalisation — provider band to our 0–100 (ENG per SRS §18.5)
// ---------------------------------------------------------------------------

/**
 * The provider's own scale is not ours, and the mapping is a business decision
 * rather than arithmetic, so it lives in one named function. When EcoDev tell us
 * their actual scale, this is the only place that changes.
 */
export function normaliseBand(raw: number, scaleMax = 100): number {
  if (!Number.isFinite(raw) || scaleMax <= 0) {
    throw new Error("A behavioural score must be a finite number on a positive scale.");
  }
  const pct = (raw / scaleMax) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Stub driver — the only one that exists today
// ---------------------------------------------------------------------------

/**
 * Deterministic, offline, and obviously fake.
 *
 * Deterministic because a stub that returns random scores makes every test that
 * touches it flaky, and because a demo that shows a different grade each refresh
 * teaches the wrong thing about the product.
 *
 * Obviously fake because the danger with a stub in a credit system is that it
 * quietly reaches production and a real applicant is scored on invented data.
 * Every session id it issues starts with `stub_`, `is_stub` is true on the result,
 * and the endpoint layer refuses to use it when NODE_ENV is production unless
 * MPOWERU_ALLOW_STUB_IN_PRODUCTION is explicitly set.
 */
export class StubMpowerUDriver implements MpowerUDriver {
  readonly name = "stub";

  async createSession(request: SessionRequest): Promise<SessionHandle> {
    const respondent = respondentIdFor(request.userId);
    return {
      provider_session_id: `stub_${createHash("sha256").update(request.idempotencyKey).digest("hex").slice(0, 24)}`,
      respondent_id: respondent,
      status: "created",
      assessment_url: null,
      expires_at: null,
      questionnaire_version: "stub-q1",
      model_version: "stub-m1",
    };
  }

  async fetchResult(providerSessionId: string): Promise<SessionResult> {
    // Derive a stable pseudo-band from the session id so the same application
    // always gets the same number, and different ones spread across the range.
    const digest = createHash("sha256").update(providerSessionId).digest();
    const raw = digest[0] % 101;
    return {
      provider_session_id: providerSessionId,
      status: "completed",
      normalised_score: normaliseBand(raw),
      band: raw >= 80 ? "high" : raw >= 50 ? "medium" : "low",
      factors: null,
      risk_flags: [],
      development_areas: [],
      questionnaire_version: "stub-q1",
      model_version: "stub-m1",
      failure_reason: null,
    };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string>): boolean {
    // Even the stub verifies. A driver that returns true unconditionally would
    // let the real deployment inherit an unauthenticated webhook the day someone
    // copies this class as a starting point.
    const secret = process.env.MPOWERU_WEBHOOK_SECRET ?? "";
    if (!secret) return false;
    const provided = headers["x-mpoweru-signature"] ?? "";
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(rawBody: string) {
    const body = JSON.parse(rawBody) as { session_id?: string; status?: string };
    if (!body.session_id) throw new Error("Webhook payload has no session_id.");
    return {
      provider_session_id: String(body.session_id),
      status: (body.status ?? "completed") as MpowerUStatus,
    };
  }
}

// ---------------------------------------------------------------------------
// Driver selection
// ---------------------------------------------------------------------------

let cached: MpowerUDriver | null = null;

/**
 * Returns the configured driver. Today that is always the stub; when the real
 * one lands, add a branch here on MPOWERU_DRIVER and nothing else changes.
 */
export function getMpowerUDriver(): MpowerUDriver {
  if (cached) return cached;

  const configured = (process.env.MPOWERU_DRIVER ?? "stub").toLowerCase();
  if (configured !== "stub") {
    throw new Error(
      `MPOWERU_DRIVER is "${configured}", but only the stub driver is implemented. ` +
        "EcoDev have not supplied a sandbox; add lib/mpoweru/drivers/<name>.ts and register it here."
    );
  }

  cached = new StubMpowerUDriver();
  return cached;
}

/** Test seam — the driver is cached, so a test that swaps it must be able to reset. */
export function __setMpowerUDriver(driver: MpowerUDriver | null) {
  cached = driver;
}

export function isStubDriver(driver: MpowerUDriver) {
  return driver.name === "stub";
}

/**
 * A stub score is invented. In production that must be a deliberate, noisy
 * choice rather than a default someone forgot to change.
 */
export function assertDriverUsableHere(driver: MpowerUDriver) {
  if (!isStubDriver(driver)) return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.MPOWERU_ALLOW_STUB_IN_PRODUCTION === "true") return;
  throw new Error(
    "The mPowerU stub driver is not permitted in production — it invents behavioural scores. " +
      "Configure a real driver, or set MPOWERU_ALLOW_STUB_IN_PRODUCTION=true if this is a deliberate pilot."
  );
}
