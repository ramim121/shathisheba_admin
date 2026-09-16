import type { ManagementPageProps } from "@/components/ManagementPage";

type FormField = ManagementPageProps["formFields"][number];

/**
 * Client-side shape checks for the generic create/edit form.
 *
 * A missing or malformed value used to travel all the way to MySQL before
 * anybody noticed: the admin got "A database error occurred" (the driver's
 * message is deliberately not leaked) with no idea which of thirty boxes was
 * wrong. These rules catch the obvious cases before the POST, and the kind is
 * inferred from the column name so ~70 pages get it without per-page config.
 *
 * Deliberately conservative: a rule that wrongly blocks a legitimate save is
 * far worse than one that lets a value through to the server, so anything
 * rendered as a picker (select / lookup / multi-lookup) is never shape-checked,
 * and a column whose name ends in a textual suffix is never treated as a number.
 */
export type FieldKind =
  | "text"
  | "number"
  | "percent"
  | "integer"
  | "email"
  | "phone"
  | "url"
  | "date"
  | "datetime"
  | "json";

/** Columns that carry a quantity of something. Matched whole-token on the name. */
const NUMERIC_TOKENS = new Set([
  "price", "amount", "cost", "fee", "fees", "charge", "rate", "salary", "balance",
  "budget", "total", "paisa", "deposit", "installment", "emi", "principal",
  "commission", "discount", "qty", "quantity", "stock", "count", "capacity",
  "limit", "tenure", "tenures", "weight", "kg", "score", "months", "days",
  "weeks", "years", "duration", "age", "threshold", "step", "points", "interest",
  "earning", "earnings", "dressing", "target", "quota", "cap"
]);

/** A column whose name ends this way holds words, whatever tokens precede it. */
const TEXTUAL_SUFFIX = /_(type|types|mode|modes|status|unit|units|code|codes|label|name|text|note|notes|title|slug|key|keys|url|json|method|reason|remark|remarks|by|bn|en|desc|description|summary|body|message|icon|image|photo|color|colour)$/;

const PERCENT_NAME = /(^|_)(pct|percent|percentage)(_|$)/;
const EMAIL_NAME = /(^|_)e?mail(_|$)/;
const PHONE_NAME = /(^|_)(phone|mobile|msisdn|whatsapp|contact_no|cell)(_|$)/;
// Only names that say "url"/"link". "icon" holds an emoji on several forms and
// "image" a file name, so neither may be forced into a URL shape.
const URL_NAME = /(_url|_link)$|^(url|link)$/;
// "Mobile banking provider" holds "bKash", not a phone number.
const NOT_A_VALUE = /_(provider|type|method|network|operator|name|label|account)$/;
const JSON_NAME = /(^|_)(json|payload|metadata|meta|config)(_|$)|_json$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?\d{6,15}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function tokensOf(name: string) {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** True when the control is a free-text box the admin can type anything into. */
function isFreeText(field: FormField, lookupsDown: boolean) {
  if (field.readOnly) return false;
  if (field.type === "multi-lookup") return false;
  if (field.type === "select" || (field.options?.length ?? 0) > 0) return false;
  if (field.lookup && !lookupsDown) return false;
  return true;
}

/**
 * What shape a field's value must have. `lookupsDown` matters because a lookup
 * whose option list failed to load degrades to a box the admin types an id into.
 */
export function kindOf(field: FormField, lookupsDown = false): FieldKind {
  if (field.type === "date") return "date";
  if (field.type === "datetime") return "datetime";
  if (field.type === "geo") return "text";
  if (!isFreeText(field, lookupsDown)) return "text";

  const name = field.name.toLowerCase();
  if (field.type === "image") return "url";
  if (field.lookup || /_id$/.test(name)) return "integer";
  if (JSON_NAME.test(name)) return "json";
  if (EMAIL_NAME.test(name)) return "email";
  if (PHONE_NAME.test(name) && !NOT_A_VALUE.test(name)) return "phone";
  if (URL_NAME.test(name)) return "url";
  if (PERCENT_NAME.test(name) || /%/.test(field.label)) return "percent";
  if (TEXTUAL_SUFFIX.test(name)) return "text";
  if (name === "sort_order" || name === "priority") return "number";
  if (tokensOf(name).some((token) => NUMERIC_TOKENS.has(token))) return "number";
  return "text";
}

/** The kind of a `fee` field depends on which half of its toggle is active. */
export function feeKind(mode: "pct" | "flat"): FieldKind {
  return mode === "pct" ? "percent" : "number";
}

/**
 * Checks one already-trimmed, non-empty value. Returns "" when it is fine.
 * Presence is checked by the caller, which knows what is required.
 */
export function checkShape(kind: FieldKind, raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  switch (kind) {
    case "number": {
      const n = Number(value.replace(/,/g, ""));
      if (!Number.isFinite(n)) return "Enter a number — letters and symbols are not allowed.";
      if (n < 0) return "Cannot be negative.";
      return "";
    }
    case "percent": {
      const n = Number(value.replace(/[%\s,]/g, ""));
      if (!Number.isFinite(n)) return "Enter a number — letters and symbols are not allowed.";
      if (n < 0 || n > 100) return "Enter a percentage between 0 and 100.";
      return "";
    }
    case "integer": {
      if (!/^\d+$/.test(value)) return "Enter the record's numeric id.";
      if (Number(value) <= 0) return "Enter the record's numeric id.";
      return "";
    }
    case "email":
      return EMAIL_RE.test(value) ? "" : "Enter a valid email address, e.g. name@example.com.";
    case "phone": {
      const digits = value.replace(/[\s\-().]/g, "");
      return PHONE_RE.test(digits) ? "" : "Enter a valid phone number — 6 to 15 digits.";
    }
    case "url": {
      if (/^(\/|data:)/.test(value)) return "";
      if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(value)) return "Enter a full URL starting with https://, or upload a file.";
      return "";
    }
    case "date":
      return isRealDate(value, false) ? "" : "Enter a real date (YYYY-MM-DD).";
    case "datetime":
      return isRealDate(value, true) ? "" : "Enter a real date and time.";
    case "json":
      try {
        JSON.parse(value);
        return "";
      } catch {
        return "Enter valid JSON, e.g. {\"key\": \"value\"}.";
      }
    default:
      return "";
  }
}

function isRealDate(value: string, withTime: boolean) {
  const match = withTime ? DATETIME_RE.test(value) : DATE_RE.test(value);
  if (!match) return false;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return false;
  if (withTime) {
    const [hh, mm] = value.slice(11).split(":").map(Number);
    if (hh > 23 || mm > 59) return false;
  }
  return true;
}

/** A short note about the expected format, shown under the box when nothing better is set. */
export function formatNote(kind: FieldKind): string {
  switch (kind) {
    case "number":
      return "Numbers only, zero or more.";
    case "percent":
      return "A percentage between 0 and 100.";
    case "email":
      return "Format: name@example.com.";
    case "phone":
      return "Digits only, e.g. 01712345678.";
    case "url":
      return "A full https:// address.";
    case "json":
      return "Valid JSON — read by code, so edit with care.";
    default:
      return "";
  }
}

const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

// Messages the server writes about one value, as opposed to a general refusal.
const FIELD_SHAPED = /(is required|must be|cannot be|can not be|is not valid|invalid|too long|already (exists|taken|in use)|duplicate|between .* and )/i;

/**
 * Maps a server rejection back onto the field it is about.
 *
 * The API writes its refusals for a human — "Buyer name is required.",
 * "Agreed rate must be a positive number.", "Field 'sort_order' must be a
 * finite number." — so the field is usually named in the text. Matching the
 * longest field name/label that appears as whole words in the message avoids
 * "rate" hijacking a message about "agreed rate".
 */
export function fieldFromMessage(message: string, fields: FormField[]): FormField | null {
  if (!message || !FIELD_SHAPED.test(message)) return null;
  const haystack = ` ${norm(message)} `;
  let best: { field: FormField; length: number } | null = null;
  for (const field of fields) {
    if (field.readOnly) continue;
    const candidates = [
      norm(field.name),
      // "Buyer name (optional)" and "Animal (blank = any)" are matched on the
      // part before the parenthesis, which is what the server would quote.
      norm(field.label.replace(/\(.*?\)/g, ""))
    ];
    if (field.pctName) candidates.push(norm(field.pctName));
    for (const candidate of candidates) {
      if (candidate.length < 3) continue;
      if (!haystack.includes(` ${candidate} `)) continue;
      if (!best || candidate.length > best.length) best = { field, length: candidate.length };
    }
  }
  return best?.field ?? null;
}
