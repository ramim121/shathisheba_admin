import { randomBytes, randomInt } from "node:crypto";
import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";
import { generateToken } from "@/lib/auth";
import { isSmsDevMode, sendSms } from "@/lib/sms";
import { RateLimitError } from "@/lib/errors";
import { deleteAccount } from "@/lib/account-deletion";
import { canonicalPhone, reviewCodeFor } from "@/lib/review-account";
import { getUserRoles, safeJson } from "./shared";

// Mobile authentication: OTP issue and verify, the request throttle that keeps
// the SMS balance and the 4-digit code space from being brute-forced, and the
// app-user payload the phone stores after a successful login.

export async function buildKycSummary(userId: number | string) {
  const docs = await queryRows<Row>(
    "SELECT doc_type, status, created_at FROM app_user_kyc_documents WHERE user_id = ? ORDER BY created_at",
    [userId]
  );
  const latest: Record<string, string> = {};
  for (const d of docs) latest[String(d.doc_type)] = String(d.status); // last wins (chronological)
  const banking = await queryRows<Row>("SELECT 1 FROM app_user_banking WHERE user_id = ? LIMIT 1", [userId]);
  const statusOf = (...types: string[]) => {
    const found = types.map((t) => latest[t]).filter(Boolean);
    if (found.includes("verified")) return "verified";
    if (found.includes("pending")) return "pending";
    if (found.includes("rejected")) return "rejected";
    return "none";
  };
  return {
    nid: statusOf("nid_front", "nid_back"),
    selfie: statusOf("selfie"),
    trade_license: statusOf("trade_license"),
    banking: banking.length > 0,
    document_count: docs.length
  };
}

/**
 * The farmer's approved location with both languages, and whether a profile
 * change is waiting for review. Read here rather than trusted from the caller's
 * row, because buildAppUser is fed by several SELECTs that predate the ids.
 */
async function loadUserGeoSummary(userId: unknown) {
  const [g] = await queryRows<Row>(
    `SELECT u.division_id, u.district_id, u.upazila_id, u.village,
            v.name_en AS division, d.name_en AS district, z.name_en AS upazila,
            v.name_bn AS division_bn, d.name_bn AS district_bn, z.name_bn AS upazila_bn
       FROM app_users u
       LEFT JOIN geo_divisions v ON v.id = u.division_id
       LEFT JOIN geo_districts d ON d.id = u.district_id
       LEFT JOIN geo_upazilas z ON z.id = u.upazila_id
      WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  const [pending] = await queryRows<Row>(
    "SELECT id, created_at FROM profile_change_requests WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
    [userId]
  );
  const id = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    division_id: id(g?.division_id),
    district_id: id(g?.district_id),
    upazila_id: id(g?.upazila_id),
    division: (g?.division as string) ?? null,
    district: (g?.district as string) ?? null,
    upazila: (g?.upazila as string) ?? null,
    division_bn: (g?.division_bn as string) ?? null,
    district_bn: (g?.district_bn as string) ?? null,
    upazila_bn: (g?.upazila_bn as string) ?? null,
    village: (g?.village as string) ?? null,
    profile_change_pending: Boolean(pending),
    profile_change_request_id: id(pending?.id)
  };
}

export async function buildAppUser(user: Row) {
  const profile = typeof user.profile_json === "string" ? safeJson(user.profile_json) : (user.profile_json as Row | null);
  const roles = await getUserRoles(user.id as number);
  const kyc = await buildKycSummary(user.id as number);
  const geo = await loadUserGeoSummary(user.id);
  return {
    id: String(user.id),
    full_name: user.full_name ?? null,
    display_name: user.display_name ?? null,
    phone: user.phone ?? null,
    gender: user.gender ?? null,
    date_of_birth: user.date_of_birth ?? null,
    // Names, ids and Bangla names all come from the geo summary, joined fresh
    // from the masters rather than taken from whatever row the caller passed.
    ...geo,
    profile_image_url: user.profile_image_url ?? null,
    status: user.status ?? "active",
    roles,
    preferences: (profile && profile.preferences) ?? null,
    is_kyc_verified: Number(user.is_kyc_verified ?? 0) === 1,
    nid_number: user.nid_number ?? null,
    kyc,
    needs_personal_info: Number(user.personal_info_completed ?? 0) === 0,
    needs_preferences: !(profile && profile.preferences)
  };
}

// Request-OTP throttling. The code is four digits and verify allows five guesses
// per code, so unlimited resends would hand an attacker unlimited guesses (each
// new code resets the attempt counter) as well as unlimited SMS spend.
const OTP_RESEND_INTERVAL_SECONDS = 60;
const OTP_MAX_PER_PHONE_PER_HOUR = 5;
const OTP_MAX_PER_IP_PER_HOUR = 20;

async function assertOtpRateLimit(phone: string, requestIp: string | null) {
  const recent = await queryRows<Row>(
    `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age_seconds
       FROM app_otps WHERE phone = ? ORDER BY id DESC LIMIT 1`,
    [phone]
  );
  const age = recent[0] ? Number(recent[0].age_seconds) : null;
  if (age !== null && age < OTP_RESEND_INTERVAL_SECONDS) {
    const wait = OTP_RESEND_INTERVAL_SECONDS - age;
    throw new RateLimitError(`Please wait ${wait} seconds before requesting another code.`, wait);
  }

  const perPhone = await queryRows<Row>(
    "SELECT COUNT(*) AS n FROM app_otps WHERE phone = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)",
    [phone]
  );
  if (Number(perPhone[0]?.n ?? 0) >= OTP_MAX_PER_PHONE_PER_HOUR) {
    throw new RateLimitError("Too many codes requested for this number. Please try again in an hour.", 3600);
  }

  if (requestIp) {
    const perIp = await queryRows<Row>(
      "SELECT COUNT(*) AS n FROM app_otps WHERE request_ip = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)",
      [requestIp]
    );
    if (Number(perIp[0]?.n ?? 0) >= OTP_MAX_PER_IP_PER_HOUR) {
      throw new RateLimitError("Too many code requests from this device. Please try again later.", 3600);
    }
  }
}

// What a code is for. A sign-in code does not confirm a deletion and a
// deletion code does not sign anyone in (migration 055); both draw on the same
// request budget above, so the second flow does not double the SMS spend.
type OtpPurpose = "login" | "account_deletion";

const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 5;

// Sign-in codes stay four digits: the app's code field is built around them.
// A deletion code is typed into the web page, which takes any length, so it
// gets six — a hundred times fewer guesses for the flow that destroys data.
function newOtpCode(digits: 4 | 6 = 4): string {
  return String(randomInt(10 ** (digits - 1), 10 ** digits));
}

async function storeOtp(phone: string, purpose: OtpPurpose, code: string, requestIp: string | null) {
  // Invalidate any earlier unconsumed code for this phone and purpose, then store the new one.
  await executeQuery("UPDATE app_otps SET consumed = 1 WHERE phone = ? AND purpose = ? AND consumed = 0", [phone, purpose]);
  await executeQuery(
    `INSERT INTO app_otps (phone, purpose, code, request_ip, expires_at)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${OTP_TTL_SECONDS} SECOND))`,
    [phone, purpose, code, requestIp]
  );
}

// The review number's code never changes, so the per-code attempt limit alone
// would let a patient guesser work through the whole code space a few
// requests at a time. Its wrong guesses are therefore also capped per day,
// across every code issued to it.
const REVIEW_MAX_WRONG_PER_DAY = 10;

async function assertReviewNotLocked(phone: string) {
  const [row] = await queryRows<Row>(
    "SELECT COALESCE(SUM(attempts), 0) AS n FROM app_otps WHERE phone = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)",
    [phone]
  );
  if (Number(row?.n ?? 0) >= REVIEW_MAX_WRONG_PER_DAY) {
    throw new RateLimitError("Too many incorrect codes for this number. Please try again tomorrow.", 3600);
  }
}

/**
 * Check a submitted code against the newest live code for this phone and
 * purpose. Wrong guesses count against the code; the right one consumes it.
 */
async function consumeOtp(phone: string, purpose: OtpPurpose, code: string) {
  const otps = await queryRows<Row>(
    `SELECT id, code, attempts FROM app_otps
      WHERE phone = ? AND purpose = ? AND consumed = 0 AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1`,
    [phone, purpose]
  );
  const otp = otps[0];
  if (!otp) {
    throw new Error("Code expired or not found. Please request a new code.");
  }
  if (Number(otp.attempts) >= OTP_MAX_ATTEMPTS) {
    throw new Error("Too many attempts. Please request a new code.");
  }
  if (String(otp.code) !== code) {
    await executeQuery("UPDATE app_otps SET attempts = attempts + 1 WHERE id = ?", [otp.id]);
    throw new Error("Incorrect code.");
  }
  await executeQuery("UPDATE app_otps SET consumed = 1 WHERE id = ?", [otp.id]);
}

// POST /api/v1/app/auth/request-otp  { phone }
// Generates a one-time code, stores it (5 min expiry), and sends it via BulkSMSBD.
// In dev mode (OTP_DEV_MODE=true) the SMS is skipped and the code is returned.
// The Play review number (APP_REVIEW_PHONE) gets no SMS: its stored code is
// APP_REVIEW_CODE, and the response has the ordinary shape.
export async function requestOtp(payload: Row, requestIp: string | null = null) {
  const phone = (payload.phone ?? "").toString().trim();
  if (!/^[0-9+]{6,15}$/.test(phone)) {
    throw new Error("A valid phone number is required.");
  }
  await assertOtpRateLimit(phone, requestIp);

  const reviewCode = reviewCodeFor(phone);
  if (reviewCode) await assertReviewNotLocked(phone);
  const code = reviewCode ?? newOtpCode();
  await storeOtp(phone, "login", code, requestIp);

  if (reviewCode) {
    return {
      sent: true,
      expires_in_seconds: OTP_TTL_SECONDS,
      dev_otp: isSmsDevMode() ? code : undefined,
      gateway_code: null
    };
  }

  const brand = process.env.OTP_BRAND || "Shathi Sheba";
  const sms = await sendSms(phone, `${brand} OTP is ${code}`);

  return {
    sent: sms.ok,
    expires_in_seconds: OTP_TTL_SECONDS,
    // Only exposed in dev mode so testing works without spending SMS credits.
    dev_otp: isSmsDevMode() ? code : undefined,
    gateway_code: sms.code
  };
}

// POST /api/v1/app/auth/verify-otp  { phone, code }
// Verifies the code (or the master dev code), creates the user on first login
// with the default buyer role, issues a session token, and returns the app user.
export async function verifyOtpLogin(payload: Row) {
  const phone = (payload.phone ?? "").toString().trim();
  const code = (payload.code ?? "").toString().trim();
  if (!phone || !code) {
    throw new Error("Phone and code are required.");
  }

  // A master code that verifies any phone number is a login backdoor for every
  // account on the platform. It stays available for local testing, but it is
  // refused outright in production regardless of what the environment says, so
  // a stray value in a deployed .env cannot re-open it.
  const master = process.env.OTP_DEV_MASTER;
  const masterAllowed = process.env.NODE_ENV !== "production";
  if (master && !masterAllowed) {
    console.warn("OTP_DEV_MASTER is set in production and is being ignored. Remove it from the environment.");
  }
  const isMaster = masterAllowed && Boolean(master) && code === master;

  // Sign-in codes only: a code sent to confirm an account deletion is not a
  // way in. The review number's static code arrives here as an ordinary
  // stored code (requestOtp), so it is checked, limited and consumed like any
  // other — and only ever for that one number.
  if (!isMaster) {
    await consumeOtp(phone, "login", code);
  }

  const existing = await queryRows<Row>(
    "SELECT id, full_name, display_name, phone, gender, date_of_birth, division, district, upazila, profile_image_url, status, personal_info_completed, is_kyc_verified, nid_number, profile_json FROM app_users WHERE phone = ? LIMIT 1",
    [phone]
  );

  let user = existing[0];
  let isNew = false;

  if (!user) {
    const result = await executeQuery(
      "INSERT INTO app_users (full_name, phone, status, personal_info_completed) VALUES ('Shathi user', ?, 'active', 0)",
      [phone]
    );
    await executeQuery(
      "INSERT IGNORE INTO app_user_roles (user_id, role) VALUES (?, 'shathisheba_buyer')",
      [result.insertId]
    );
    const rows = await queryRows<Row>(
      "SELECT id, full_name, display_name, phone, gender, date_of_birth, division, district, upazila, profile_image_url, status, personal_info_completed, is_kyc_verified, nid_number, profile_json FROM app_users WHERE id = ? LIMIT 1",
      [result.insertId]
    );
    user = rows[0];
    isNew = true;
  } else {
    // Ensure the buyer role exists for any pre-existing/seeded user.
    await executeQuery("INSERT IGNORE INTO app_user_roles (user_id, role) VALUES (?, 'shathisheba_buyer')", [user.id]);
  }

  const token = generateToken();
  await executeQuery(
    "INSERT INTO app_sessions (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 90 DAY))",
    [user.id, token]
  );

  return { token, is_new: isNew, user: await buildAppUser(user) };
}

// ---------------------------------------------------------------------------
// Account deletion from the public web page (/delete-account)
//
// Google Play requires a way to delete an account without the app. Owning the
// phone is the proof, exactly as it is for signing in: a code goes to the
// number by SMS, and the code confirms the deletion.
// ---------------------------------------------------------------------------

// The page takes a number however people write it (+880…, 880…, 01…); the app
// stores the 11-digit form, so that is the form codes are kept under and the
// one limits are counted on — writing the number differently cannot buy a
// second budget. An account stored in some other form is still found.
function deletionPhone(payload: Row): { phone: string; raw: string } {
  const raw = (payload.phone ?? "").toString().trim();
  const phone = canonicalPhone(raw);
  if (!/^[0-9]{6,15}$/.test(phone)) throw new Error("A valid phone number is required.");
  return { phone, raw };
}

async function liveAccountFor(phone: string, raw: string): Promise<Row | null> {
  const [user] = await queryRows<Row>(
    "SELECT id FROM app_users WHERE phone IN (?, ?) AND status <> 'deleted' ORDER BY (phone = ?) DESC LIMIT 1",
    [phone, raw, phone]
  );
  return user ?? null;
}

// POST /api/v1/public/account-deletion/request-code  { phone }  ->  { ok, sent: true }
//
// Answers identically whether or not the number has an account, so the page
// cannot be used to find out who is a Shathi Sheba user:
//   * a code row is stored either way, so the resend interval and the hourly
//     cap behave the same for both;
//   * for a number with no account the stored code is not digits, can never
//     be matched, and no SMS is sent;
//   * the SMS for a real account goes out after the response (`defer`), so
//     the gateway's latency does not separate the two cases either.
export async function requestAccountDeletionCode(
  payload: Row,
  requestIp: string | null,
  opts: { defer?: (task: () => Promise<void>) => void } = {}
): Promise<{ sent: true }> {
  const { phone, raw } = deletionPhone(payload);
  await assertOtpRateLimit(phone, requestIp);

  const account = await liveAccountFor(phone, raw);
  const reviewCode = account ? reviewCodeFor(phone) : null;
  if (reviewCode) await assertReviewNotLocked(phone);
  const code = account ? reviewCode ?? newOtpCode(6) : `x${randomBytes(3).toString("hex")}`;
  await storeOtp(phone, "account_deletion", code, requestIp);

  // The review number receives no SMS here either; its code is the static one.
  if (account && !reviewCode) {
    const brand = process.env.OTP_BRAND || "Shathi Sheba";
    const message = `${brand} account deletion code: ${code}. Do not share it. If you did not ask to delete your account, ignore this message.`;
    const send = async () => {
      try {
        const sms = await sendSms(phone, message);
        if (!sms.ok) console.error("account deletion SMS was not accepted by the gateway", sms.code);
      } catch (error) {
        console.error("account deletion SMS failed", error instanceof Error ? error.message : error);
      }
    };
    if (opts.defer) opts.defer(send);
    else await send();
  }
  return { sent: true };
}

// POST /api/v1/public/account-deletion/confirm  { phone, code }  ->  { ok, result: { deleted: true } }
export async function confirmAccountDeletionCode(payload: Row): Promise<{ deleted: true }> {
  const { phone, raw } = deletionPhone(payload);
  const code = (payload.code ?? "").toString().trim();
  if (!code) throw new Error("Enter the code we sent you.");
  // Codes are digits. Anything else is wrong without a lookup — the same
  // answer for every number — and it keeps the placeholder code stored for a
  // number with no account unmatchable by construction.
  if (!/^\d{4,8}$/.test(code)) throw new Error("Incorrect code.");
  await consumeOtp(phone, "account_deletion", code);

  // A code that matched was sent to a live account. It can only be missing
  // now if it was deleted in the meantime, which is the outcome asked for.
  const account = await liveAccountFor(phone, raw);
  if (account) await deleteAccount(Number(account.id), "web");
  return { deleted: true };
}

// POST /api/v1/app/profile  { user_id, full_name, gender, date_of_birth?, profile_image_url? }
// Saves the Personal Information screen and marks personal_info_completed.
