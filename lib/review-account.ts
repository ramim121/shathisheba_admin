/**
 * The Google Play review account.
 *
 * Play's reviewers must be able to sign in, and they do not have a
 * Bangladeshi SIM to receive the SMS code. APP_REVIEW_PHONE names ONE phone
 * number; for that number alone:
 *
 *   * request-code sends no SMS — the stored code is APP_REVIEW_CODE;
 *   * verify accepts APP_REVIEW_CODE through the ordinary path, so it still
 *     expires after five minutes, still allows five tries per code, and still
 *     sits under the per-phone and per-address request limits. Because this
 *     code never changes, wrong guesses for the number are also capped per
 *     day (lib/endpoints/auth.ts);
 *   * a loan application may skip the physical GPS check-in (zone rules,
 *     consents and everything else still apply).
 *
 * This works in production on purpose — that is where the reviewers are. It is
 * not OTP_DEV_MASTER: no other number is affected, and nothing here can widen
 * to one. Unset either variable and the review path is simply off.
 *
 * APP_REVIEW_PHONE: 11-digit local form (01XXXXXXXXX) — the app's phone field
 *                   takes 11 characters. Use a number no real subscriber has.
 * APP_REVIEW_CODE:  4 to 6 digits — the app's code field accepts 4–6.
 */

let warned = false;

/** Phone numbers compared in one form: 01XXXXXXXXX for Bangladeshi mobiles, digits otherwise. */
export function canonicalPhone(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length === 13) return `0${digits.slice(3)}`;
  if (digits.length === 10 && digits.startsWith("1")) return `0${digits}`;
  return digits;
}

function reviewAccount(): { phone: string; code: string } | null {
  const phone = canonicalPhone(process.env.APP_REVIEW_PHONE);
  const code = String(process.env.APP_REVIEW_CODE ?? "").trim();
  if (!phone && !code) return null;
  if (phone.length < 6 || !/^\d{4,6}$/.test(code)) {
    if (!warned) {
      warned = true;
      console.warn("APP_REVIEW_PHONE / APP_REVIEW_CODE are set but invalid (phone of 6+ digits, code of 4-6 digits). The review sign-in is off.");
    }
    return null;
  }
  return { phone, code };
}

/** Is this the configured review number? */
export function isReviewPhone(raw: unknown): boolean {
  const account = reviewAccount();
  return Boolean(account) && canonicalPhone(raw) === account!.phone;
}

/** The static code, for the review number only; null for every other number. */
export function reviewCodeFor(raw: unknown): string | null {
  const account = reviewAccount();
  return account && canonicalPhone(raw) === account.phone ? account.code : null;
}
