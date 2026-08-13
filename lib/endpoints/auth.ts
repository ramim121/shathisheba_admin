import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";
import { generateToken } from "@/lib/auth";
import { isSmsDevMode, sendSms } from "@/lib/sms";
import { RateLimitError } from "@/lib/errors";
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

export async function buildAppUser(user: Row) {
  const profile = typeof user.profile_json === "string" ? safeJson(user.profile_json) : (user.profile_json as Row | null);
  const roles = await getUserRoles(user.id as number);
  const kyc = await buildKycSummary(user.id as number);
  return {
    id: String(user.id),
    full_name: user.full_name ?? null,
    display_name: user.display_name ?? null,
    phone: user.phone ?? null,
    gender: user.gender ?? null,
    date_of_birth: user.date_of_birth ?? null,
    division: user.division ?? null,
    district: user.district ?? null,
    upazila: user.upazila ?? null,
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

// POST /api/v1/app/auth/request-otp  { phone }
// Generates a one-time code, stores it (5 min expiry), and sends it via BulkSMSBD.
// In dev mode (OTP_DEV_MODE=true) the SMS is skipped and the code is returned.
export async function requestOtp(payload: Row, requestIp: string | null = null) {
  const phone = (payload.phone ?? "").toString().trim();
  if (!/^[0-9+]{6,15}$/.test(phone)) {
    throw new Error("A valid phone number is required.");
  }
  await assertOtpRateLimit(phone, requestIp);

  const code = String(Math.floor(1000 + Math.random() * 9000));

  // Invalidate any earlier unconsumed codes for this phone, then store the new one.
  await executeQuery("UPDATE app_otps SET consumed = 1 WHERE phone = ? AND consumed = 0", [phone]);
  await executeQuery(
    "INSERT INTO app_otps (phone, code, request_ip, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))",
    [phone, code, requestIp]
  );

  const brand = process.env.OTP_BRAND || "Shathi Sheba";
  const sms = await sendSms(phone, `${brand} OTP is ${code}`);

  return {
    sent: sms.ok,
    expires_in_seconds: 300,
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

  if (!isMaster) {
    const otps = await queryRows<Row>(
      "SELECT id, code, attempts FROM app_otps WHERE phone = ? AND consumed = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
      [phone]
    );
    const otp = otps[0];
    if (!otp) {
      throw new Error("Code expired or not found. Please request a new code.");
    }
    if (Number(otp.attempts) >= 5) {
      throw new Error("Too many attempts. Please request a new code.");
    }
    if (String(otp.code) !== code) {
      await executeQuery("UPDATE app_otps SET attempts = attempts + 1 WHERE id = ?", [otp.id]);
      throw new Error("Incorrect code.");
    }
    await executeQuery("UPDATE app_otps SET consumed = 1 WHERE id = ?", [otp.id]);
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

// POST /api/v1/app/profile  { user_id, full_name, gender, date_of_birth?, profile_image_url? }
// Saves the Personal Information screen and marks personal_info_completed.
