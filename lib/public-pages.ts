import { headers } from "next/headers";

/**
 * Shared facts for the public pages (/privacy, /terms, /delete-account,
 * /loan-disclosure). One place, so the operator name, contact address and
 * "last updated" date cannot disagree between pages.
 */

export type Lang = "bn" | "en";

export const PUBLIC_SITE = "https://shathisheba.digigramventures.com";
export const CONTACT_EMAIL = "info@digigramventures.com";
export const LOGO_URL = "https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/brand/shathi-sheba-logo.png";

export const OPERATOR: Record<Lang, string> = {
  en: "Digigram Ventures Ltd.",
  bn: "ডিজিগ্রাম ভেঞ্চারস লিমিটেড"
};

/** Change this whenever the wording of a policy page changes. */
export const LAST_UPDATED: Record<Lang, string> = {
  en: "18 October 2026",
  bn: "১৮ অক্টোবর ২০২৬"
};

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The page's language: `?lang=bn|en` when given (the app links with the
 * language it is set to), otherwise the browser's first preference — Bangla
 * for a phone set to Bangla, English for everyone else, Play's reviewers
 * included.
 */
export async function resolveLang(searchParams: Promise<SearchParams> | SearchParams): Promise<Lang> {
  const sp = await searchParams;
  const raw = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
  if (raw === "bn" || raw === "en") return raw;
  const accept = (await headers()).get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("bn") ? "bn" : "en";
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** A number written for the page's language: grouped, and in Bangla digits for Bangla. */
export function formatNumber(n: number, lang: Lang, fractionDigits?: number): string {
  const text = n.toLocaleString("en-IN", {
    minimumFractionDigits: fractionDigits ?? 0,
    maximumFractionDigits: fractionDigits ?? 2
  });
  return lang === "bn" ? text.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]) : text;
}
