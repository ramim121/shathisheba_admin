type Tone = "green" | "blue" | "gold" | "red" | "grey" | "rose";

// Exact status codes first — they come straight from the database enums.
const TONE_BY_CODE: Record<string, Tone> = {
  active: "green", paid: "green", delivered: "green", approved: "green", published: "green", verified: "green",
  completed: "green", sent: "green", open: "green", disbursed: "green", granted: "green", resolved: "green", visible: "green",
  confirmed: "blue", assigned: "blue", in_transit: "blue", contracted: "blue", sold: "blue", shipped: "blue",
  processing: "blue", with_lender: "blue", assessing: "blue", live: "blue", scheduled: "blue",
  pending: "gold", submitted: "gold", placed: "gold", draft: "gold", field_verification: "gold", queued: "gold",
  opening_soon: "gold", collecting: "gold", in_review: "gold", review: "gold", new: "gold", awaiting: "gold",
  rejected: "red", cancelled: "red", canceled: "red", failed: "red", suspended: "red", overdue: "red",
  blocked: "red", flagged: "red", reported: "red", low_stock: "red", defaulted: "red",
  skipped: "grey", inactive: "grey", archived: "grey", closed: "grey", expired: "grey", retired: "grey", hidden: "grey", paused: "grey"
};

function toneFor(label: string): Tone {
  const code = label.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (TONE_BY_CODE[code]) return TONE_BY_CODE[code];
  // Free-text labels ("12 records", "3 low stock", "Live MIS") — match on words.
  if (/(active|paid|ready|visible|published|in stock|stock ok|delivered|approved)/.test(code.replace(/_/g, " "))) return "green";
  if (/(pending|soon|watch|verification|draft|await)/.test(code)) return "gold";
  if (/(reject|fail|low|overdue|cancel|moderation|report)/.test(code)) return "red";
  return "rose";
}

/** "field_verification" → "Field verification"; free text is left alone. */
function humanize(label: string): string {
  if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(label)) return label;
  const words = label.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function Status({ label }: { label: string }) {
  const text = String(label ?? "");
  return <span className={`status-pill ${toneFor(text)}`}>{humanize(text)}</span>;
}
