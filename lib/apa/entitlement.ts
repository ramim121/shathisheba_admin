import { executeQuery, queryRows } from "@/lib/db";
import { getAppOfficers } from "@/lib/app-endpoints";
import { apaConfig, type ApaConfig } from "@/lib/apa/config";

/**
 * Who may use Shathi Apa, and how much of her.
 *
 * Build this first and call it from every other path, because it is the only
 * thing standing between a free Gemini bill and the open internet. The rule the
 * rest of the codebase must never break: **the client is told what it may do,
 * and is never asked**. `features` below is the single source of truth the app
 * renders from — no screen anywhere compares a tier string.
 *
 * The tier itself is computed, not stored. A tier written to a row goes stale
 * the moment a KYC document is approved, and the farmer would sit locked out
 * until something happened to rewrite it. `apa_entitlements` holds only what
 * cannot be derived: a staff grant, a block, and how many trial questions have
 * been spent.
 *
 * Verification is the gate because it is what the platform actually wants. A
 * farmer who verifies can take a loan, sell through the B2B rate and be
 * insured; Apa is the reason she finds to do it. So the locked state is never
 * a wall — it is five short steps with the value stated first (SRS D-APA-9).
 */

export type ApaTier = "locked" | "trial" | "verified_free" | "premium" | "staff";

export type ApaFeature = "ask_text" | "ask_voice" | "ask_photo" | "read_aloud" | "live";

export const APA_FEATURES: ApaFeature[] = ["ask_text", "ask_voice", "ask_photo", "read_aloud", "live"];

export type RequirementState = "done" | "todo" | "pending" | "rejected";

export type ApaRequirement = {
  id: string;
  label_bn: string;
  label_en: string;
  detail_bn: string;
  detail_en: string;
  state: RequirementState;
  /** A screen token the app routes to, or null when there is nothing to tap. */
  action: string | null;
  action_label_bn: string | null;
  action_label_en: string | null;
};

export type ApaEntitlement = {
  enabled: boolean;
  tier: ApaTier;
  tier_source: string;
  expires_at: string | null;
  blocked: boolean;
  blocked_reason: string | null;
  features: Record<ApaFeature, boolean>;
  requirements: ApaRequirement[];
  steps_done: number;
  steps_total: number;
  trial: { allowance: number; used: number; left: number; active: boolean };
  live: {
    minutes_monthly: number;
    seconds_used: number;
    seconds_left: number;
    session_seconds_max: number;
    mic_enabled: boolean;
    data_mb_per_minute: number;
    bandwidth_floor_kbps: number;
  };
  voice: { autoplay: boolean; voice_name: string; speech_rate: string };
  /** One line for the app to show above the lock. */
  headline_bn: string;
  headline_en: string;
  /**
   * Her area's field officer, present only while she is locked or waiting on a
   * verification.
   *
   * The unlock screen is where a farmer gets stuck: her NID photograph was
   * rejected, or it has been pending for three days, and the screen has no
   * answer for either beyond "upload it again". A name and a phone number for
   * somebody local is the difference between that screen being a wall and
   * being a next step.
   *
   * Looked up only in those states, because `resolveEntitlement` runs on every
   * question and a verified farmer does not need it.
   */
  officer: { name: string; phone: string | null; role: string | null; area: string | null } | null;
};

/** A refusal the app renders as a screen rather than an error toast. */
export class ApaLockedError extends Error {
  readonly code: string;
  readonly entitlement: ApaEntitlement;
  constructor(code: string, message: string, entitlement: ApaEntitlement) {
    super(message);
    this.name = "ApaLockedError";
    this.code = code;
    this.entitlement = entitlement;
  }
}

type Row = Record<string, unknown>;

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

/* ---------------------------------------------------------------------------
   The five steps
   --------------------------------------------------------------------------- */

/**
 * Deliberately five, not one. "Verify your NID" is a cliff; five named steps
 * with three already ticked is a staircase, and the app shows the count
 * ("৩/৫ ধাপ শেষ") on the locked card so she can see how close she is.
 */
function buildRequirements(user: Row, docs: Row[]): ApaRequirement[] {
  const docState = (...types: string[]): RequirementState => {
    const found = docs.filter((d) => types.includes(String(d.doc_type)));
    if (!found.length) return "todo";
    if (found.some((d) => String(d.status) === "verified")) return "done";
    if (found.some((d) => String(d.status) === "pending")) return "pending";
    return "rejected";
  };
  // A rejected or pending document still counts as *uploaded* for the two
  // photo steps — the farmer did her part. Only `verified` is her problem to
  // fix, and the copy for it never blames her (SRS D5).
  const uploaded = (...types: string[]): RequirementState => {
    const state = docState(...types);
    return state === "pending" ? "done" : state;
  };

  const verified = Number(user.is_kyc_verified ?? 0) === 1;
  const nidPhoto = uploaded("nid_front", "nid_back");
  const selfie = uploaded("selfie");
  const anyRejected = docState("nid_front", "nid_back") === "rejected" || docState("selfie") === "rejected";
  const anyPending = docState("nid_front", "nid_back") === "pending" || docState("selfie") === "pending";

  return [
    {
      id: "location",
      label_bn: "আপনার এলাকা",
      label_en: "Your area",
      detail_bn: "জেলা ও উপজেলা দিলে আপনার এলাকার আবহাওয়া ও দাম বলতে পারব",
      detail_en: "With your district and upazila we can give you local weather and prices",
      state: user.district_id ? "done" : "todo",
      action: user.district_id ? null : "screen:menuProfile",
      action_label_bn: user.district_id ? null : "এলাকা দিন",
      action_label_en: user.district_id ? null : "Add your area"
    },
    {
      id: "nid_number",
      label_bn: "এনআইডি নম্বর",
      label_en: "NID number",
      detail_bn: "লিখুন বা বলে দিন",
      detail_en: "Type it or say it out loud",
      state: String(user.nid_number ?? "").trim() ? "done" : "todo",
      action: String(user.nid_number ?? "").trim() ? null : "screen:menuKyc",
      action_label_bn: String(user.nid_number ?? "").trim() ? null : "নম্বর দিন",
      action_label_en: String(user.nid_number ?? "").trim() ? null : "Add the number"
    },
    {
      id: "nid_photo",
      label_bn: "এনআইডির ছবি",
      label_en: "NID photo",
      detail_bn: "সামনের দিক — ছবি তুলুন",
      detail_en: "The front side — take a photo",
      state: nidPhoto,
      action: nidPhoto === "done" ? null : "screen:menuKyc",
      action_label_bn: nidPhoto === "done" ? null : nidPhoto === "rejected" ? "আবার তুলুন" : "ছবি তুলুন",
      action_label_en: nidPhoto === "done" ? null : nidPhoto === "rejected" ? "Retake it" : "Take a photo"
    },
    {
      id: "selfie",
      label_bn: "আপনার সেলফি",
      label_en: "Your selfie",
      detail_bn: "মুখ স্পষ্ট দেখা যাবে এমন",
      detail_en: "One where your face is clear",
      state: selfie,
      action: selfie === "done" ? null : "screen:menuKyc",
      action_label_bn: selfie === "done" ? null : selfie === "rejected" ? "আবার তুলুন" : "সেলফি তুলুন",
      action_label_en: selfie === "done" ? null : selfie === "rejected" ? "Retake it" : "Take a selfie"
    },
    {
      id: "verified",
      label_bn: "যাচাই",
      label_en: "Verification",
      // Waiting is never a dead screen, and never the farmer's fault.
      detail_bn: verified
        ? "হয়ে গেছে"
        : anyRejected
          ? "ছবিটা আবার তুলতে হবে — একটু পরিষ্কার করে"
          : anyPending
            ? "সাধারণত ৭ কর্মদিবসে শেষ হয়। হয়ে গেলে জানিয়ে দেব।"
            : "উপরের ধাপগুলো শেষ হলে আমরা যাচাই করব",
      detail_en: verified
        ? "Done"
        : anyRejected
          ? "The photo needs retaking — a little clearer"
          : anyPending
            ? "Usually finished within 7 working days. We will let you know."
            : "We check this once the steps above are done",
      state: verified ? "done" : anyRejected ? "rejected" : anyPending ? "pending" : "todo",
      action: verified || anyPending ? null : "screen:menuKyc",
      action_label_bn: verified || anyPending ? null : "যাচাই শুরু করুন",
      action_label_en: verified || anyPending ? null : "Start verifying"
    }
  ];
}

/* ---------------------------------------------------------------------------
   Resolving one farmer
   --------------------------------------------------------------------------- */

function period(at = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The current calendar month, as `apa_usage.period` stores it. */
export const currentPeriod = period;

export async function resolveEntitlement(
  userId: string | number | null | undefined,
  config?: ApaConfig
): Promise<ApaEntitlement> {
  const cfg = config ?? (await apaConfig());
  const id = userId == null ? "" : String(userId);

  const locked = (reason: string, reasonEn?: string): ApaEntitlement => ({
    enabled: cfg.enabled,
    tier: "locked",
    tier_source: "verification",
    expires_at: null,
    // Nothing is known about this caller yet — not even a user id — so there
    // is no area to find an officer for.
    officer: null,
    blocked: false,
    blocked_reason: null,
    features: { ask_text: false, ask_voice: false, ask_photo: false, read_aloud: false, live: false },
    requirements: [],
    steps_done: 0,
    steps_total: 5,
    trial: { allowance: cfg.freeQuestions, used: 0, left: 0, active: false },
    live: liveBlock(cfg, 0),
    voice: { autoplay: cfg.autoplayVoice, voice_name: cfg.voiceName, speech_rate: cfg.speechRate },
    headline_bn: reason,
    headline_en: reasonEn ?? reason
  });

  if (!cfg.enabled) return locked("শাথী আপা এখন বন্ধ আছে। একটু পরে আবার দেখুন।", "Shathi Apa is switched off just now. Please check back shortly.");
  if (!id) return locked("শাথী আপার সাথে কথা বলতে আগে লগ ইন করুন।", "Please sign in to talk to Shathi Apa.");

  const [user] = await queryRows<Row>(
    `SELECT u.id, u.status, u.is_kyc_verified, u.nid_number, u.district_id, u.full_name
       FROM app_users u WHERE u.id = ? LIMIT 1`,
    [id]
  );
  if (!user) return locked("শাথী আপার সাথে কথা বলতে আগে লগ ইন করুন।", "Please sign in to talk to Shathi Apa.");

  const [docs, roles, grant, usage] = await Promise.all([
    queryRows<Row>(
      "SELECT doc_type, status FROM app_user_kyc_documents WHERE user_id = ? ORDER BY id",
      [id]
    ),
    queryRows<Row>("SELECT role FROM app_user_roles WHERE user_id = ?", [id]),
    queryRows<Row>(
      `SELECT granted_tier, tier_source, tier_expires_at, trial_used, is_blocked, blocked_reason,
              live_minutes_override
         FROM apa_entitlements WHERE user_id = ? LIMIT 1`,
      [id]
    ).then((r) => r[0] ?? null),
    queryRows<Row>(
      "SELECT live_seconds FROM apa_usage WHERE user_id = ? AND period = ? LIMIT 1",
      [id, period()]
    ).then((r) => r[0] ?? null)
  ]);

  const requirements = buildRequirements(user, docs);
  const stepsDone = requirements.filter((r) => r.state === "done").length;

  const trialUsed = Number(grant?.trial_used ?? 0);
  const trialLeft = Math.max(0, cfg.freeQuestions - trialUsed);
  const liveSecondsUsed = Number(usage?.live_seconds ?? 0);

  // A block is absolute and says so. Nothing below re-opens it.
  if (Number(grant?.is_blocked ?? 0) === 1) {
    const out = locked(
      s(grant?.blocked_reason) ?? "আপনার অ্যাকাউন্টে শাথী আপা আপাতত বন্ধ আছে।",
      s(grant?.blocked_reason) ?? "Shathi Apa is switched off for your account at the moment."
    );
    out.blocked = true;
    out.blocked_reason = s(grant?.blocked_reason);
    out.requirements = requirements;
    out.steps_done = stepsDone;
    out.trial = { allowance: cfg.freeQuestions, used: trialUsed, left: 0, active: false };
    return out;
  }

  const grantedTier = s(grant?.granted_tier) as ApaTier | null;
  const grantLive =
    !grantedTier || !grant?.tier_expires_at || new Date(String(grant.tier_expires_at)) > new Date();

  const isStaff =
    (grantedTier === "staff" && grantLive) || roles.some((r) => String(r.role) === "field_officer");
  const verified = Number(user.is_kyc_verified ?? 0) === 1 && Boolean(user.district_id);
  const isPremium = grantedTier === "premium" && grantLive;
  const isGrantedFree = grantedTier === "verified_free" && grantLive;

  let tier: ApaTier;
  let tierSource: string;
  if (isStaff) {
    tier = "staff";
    tierSource = "staff";
  } else if (isPremium) {
    tier = "premium";
    tierSource = s(grant?.tier_source) ?? "grant";
  } else if (verified) {
    tier = "verified_free";
    tierSource = "verification";
  } else if (isGrantedFree) {
    tier = "verified_free";
    tierSource = s(grant?.tier_source) ?? "grant";
  } else if (trialLeft > 0) {
    tier = "trial";
    tierSource = "trial";
  } else {
    tier = "locked";
    tierSource = "verification";
  }

  const full = tier === "staff" || tier === "premium" || tier === "verified_free";
  const minutes =
    grant?.live_minutes_override !== null && grant?.live_minutes_override !== undefined
      ? Number(grant.live_minutes_override)
      : cfg.liveMinutesMonthly;

  const features: Record<ApaFeature, boolean> = {
    ask_text: full || tier === "trial",
    ask_voice: full || tier === "trial",
    ask_photo: full || tier === "trial",
    read_aloud: full || tier === "trial",
    // Live is a verified-only feature, and it needs two separate permissions
    // that are easy to confuse:
    //
    //   apa_live_mic_enabled    the platform is willing to pay for live
    //   apa_live_client_ready   builds in the field contain the PCM recorder
    //
    // Until 2026-09-19 only the first was actually consulted, while the config
    // comment claimed both were — so `apa_live_client_ready` sat in the console
    // as an editable switch that did nothing, and an operator reading
    // "client ready: off" would reasonably have concluded live was off.
    //
    // The second one exists because live needs react-native-audio-api, which is
    // native: an OTA update cannot add it, so there is a window in which the
    // server is willing and the installed app cannot. The app has its own
    // LIVE_CLIENT_READY constant for the build it is actually running; this is
    // the fleet-wide counterpart, and the one a staff member can turn off in a
    // hurry when a bad build is out.
    live:
      full &&
      cfg.liveMicEnabled &&
      cfg.liveClientReady &&
      minutes * 60 - liveSecondsUsed > 0
  };

  // Only the farmers who might need it, so the common path stays one query
  // lighter: locked, on the trial, or with a requirement that is not simply
  // outstanding — a rejected or pending verification is the case that needs a
  // human, and it is the one the screen could say nothing useful about.
  const stuck =
    tier === "locked" ||
    tier === "trial" ||
    requirements.some((r) => r.state === "pending" || r.state === "rejected");

  return {
    enabled: true,
    tier,
    tier_source: tierSource,
    expires_at: s(grant?.tier_expires_at),
    officer: stuck ? await areaOfficer(id) : null,
    blocked: false,
    blocked_reason: null,
    features,
    requirements,
    steps_done: stepsDone,
    steps_total: requirements.length,
    trial: {
      allowance: cfg.freeQuestions,
      used: Math.min(trialUsed, cfg.freeQuestions),
      left: trialLeft,
      active: tier === "trial"
    },
    live: { ...liveBlock(cfg, liveSecondsUsed, minutes), mic_enabled: cfg.liveMicEnabled },
    voice: { autoplay: cfg.autoplayVoice, voice_name: cfg.voiceName, speech_rate: cfg.speechRate },
    headline_bn: headline(tier, trialLeft, requirements),
    headline_en: headlineEn(tier, trialLeft, requirements)
  };
}

/**
 * The first field officer covering her area.
 *
 * Deliberately never an error: an unlock screen with no officer on it is a
 * slightly worse unlock screen, and an unlock screen that failed to load
 * because the officer table was busy is a farmer locked out of the assistant.
 */
async function areaOfficer(userId: string): Promise<ApaEntitlement["officer"]> {
  try {
    const officers = (await getAppOfficers(userId)) as Array<Record<string, unknown>>;
    const first = officers?.[0];
    if (!first?.name) return null;
    return {
      name: String(first.name),
      phone: first.phone ? String(first.phone) : null,
      role: first.officer_role ? String(first.officer_role) : null,
      area: first.upazila ? String(first.upazila) : first.district ? String(first.district) : null
    };
  } catch {
    return null;
  }
}

function liveBlock(cfg: ApaConfig, used: number, minutes = cfg.liveMinutesMonthly) {
  return {
    minutes_monthly: minutes,
    seconds_used: used,
    seconds_left: Math.max(0, minutes * 60 - used),
    session_seconds_max: cfg.liveSessionMinutes * 60,
    mic_enabled: cfg.liveMicEnabled,
    data_mb_per_minute: cfg.dataMbPerMinute,
    bandwidth_floor_kbps: cfg.bandwidthFloorKbps
  };
}

function headline(tier: ApaTier, trialLeft: number, requirements: ApaRequirement[]): string {
  if (tier === "trial") {
    return trialLeft === 1 ? "আর ১টি প্রশ্ন বাকি" : `আর ${bn(trialLeft)}টি প্রশ্ন বাকি`;
  }
  if (tier === "locked") {
    const pending = requirements.find((r) => r.id === "verified")?.state === "pending";
    return pending
      ? "যাচাই চলছে — এর মাঝেও ভয়েস মেসেজ পাঠাতে পারবেন"
      : "পরিচয় যাচাই করলে যত খুশি প্রশ্ন করতে পারবেন";
  }
  return "সবসময় পাশে আছি";
}

function headlineEn(tier: ApaTier, trialLeft: number, requirements: ApaRequirement[]): string {
  if (tier === "trial") return trialLeft === 1 ? "1 question left" : `${trialLeft} questions left`;
  if (tier === "locked") {
    const pending = requirements.find((r) => r.id === "verified")?.state === "pending";
    return pending
      ? "Verification in progress — voice messages keep working"
      : "Verify your identity to ask as much as you like";
  }
  return "Always here to help";
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
function bn(n: number): string {
  return String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

/* ---------------------------------------------------------------------------
   The guard every AI endpoint calls
   --------------------------------------------------------------------------- */

/**
 * Throws unless this farmer may use this feature right now. The thrown error
 * carries the whole entitlement so the route can hand the app the unlock
 * screen's contents in the same response — a 403 that leaves the app guessing
 * what to show is the reason lock screens end up hard-coded.
 */
export async function assertApaAccess(
  userId: string | number | null | undefined,
  feature: ApaFeature,
  config?: ApaConfig
): Promise<ApaEntitlement> {
  const ent = await resolveEntitlement(userId, config);
  if (!ent.enabled) throw new ApaLockedError("apa_disabled", ent.headline_bn, ent);
  if (ent.blocked) throw new ApaLockedError("apa_blocked", ent.headline_bn, ent);
  if (ent.features[feature]) return ent;

  if (feature === "live") {
    if (ent.tier === "locked" || ent.tier === "trial") {
      throw new ApaLockedError("apa_locked", "লাইভ কথা বলতে আগে পরিচয় যাচাই করুন।", ent);
    }
    if (!ent.live.mic_enabled) {
      throw new ApaLockedError(
        "apa_live_unavailable",
        "লাইভ কথা পরের অ্যাপ আপডেটে চালু হবে। এখন ভয়েস মেসেজ পাঠান — উত্তর একই রকম পাবেন।",
        ent
      );
    }
    throw new ApaLockedError(
      "apa_quota_spent",
      "এ মাসের লাইভ কথা শেষ। ভয়েস মেসেজ পাঠাতে পারবেন যত খুশি।",
      ent
    );
  }
  throw new ApaLockedError("apa_locked", ent.headline_bn, ent);
}

/* ---------------------------------------------------------------------------
   Writes
   --------------------------------------------------------------------------- */

/** Ensure the row exists so the trial counter and grants have somewhere to go. */
export async function ensureEntitlementRow(userId: string | number): Promise<void> {
  await executeQuery(
    `INSERT INTO apa_entitlements (user_id, trial_started_at)
          VALUES (?, NOW())
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId]
  );
}

/**
 * Spend one trial question. Only called after an answer was actually produced:
 * a refusal, a failure or a clarifying question must not cost the farmer one of
 * her five.
 *
 * The increment is guarded in SQL rather than read-then-written, so two
 * questions in flight at once cannot both see four used and both be answered.
 * The rate limiter bounds how often that could happen, but a counter that can
 * be beaten by double-tapping is not a counter.
 */
export async function spendTrialQuestion(userId: string | number, allowance?: number): Promise<void> {
  await ensureEntitlementRow(userId);
  const cap = allowance ?? Number.MAX_SAFE_INTEGER;
  await executeQuery(
    `UPDATE apa_entitlements
        SET trial_used = trial_used + 1,
            trial_started_at = COALESCE(trial_started_at, NOW())
      WHERE user_id = ? AND trial_used < ?`,
    [userId, cap]
  );
}

export type GrantInput = {
  userId: string | number;
  tier: "verified_free" | "premium" | "staff" | null;
  expiresAt?: string | null;
  reason?: string | null;
  adminId: number | string;
  blocked?: boolean;
  blockedReason?: string | null;
  liveMinutes?: number | null;
  resetTrial?: boolean;
};

/** Staff override, from the Access and Tiers page. */
export async function setEntitlementGrant(input: GrantInput): Promise<void> {
  await ensureEntitlementRow(input.userId);
  await executeQuery(
    `UPDATE apa_entitlements
        SET granted_tier = ?,
            tier_source = ?,
            tier_expires_at = ?,
            granted_by = ?,
            reason = ?,
            is_blocked = ?,
            blocked_reason = ?,
            live_minutes_override = ?,
            trial_used = IF(?, 0, trial_used)
      WHERE user_id = ?`,
    [
      input.tier,
      input.tier === "staff" ? "staff" : input.tier ? "grant" : "verification",
      input.expiresAt || null,
      Number(input.adminId) || null,
      input.reason?.slice(0, 255) ?? null,
      input.blocked ? 1 : 0,
      input.blocked ? (input.blockedReason?.slice(0, 255) ?? null) : null,
      input.liveMinutes ?? null,
      input.resetTrial ? 1 : 0,
      input.userId
    ]
  );
}
