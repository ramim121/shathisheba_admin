import Link from "next/link";
import { AlertTriangle, ArrowLeft, Edit3, Database, Link2 } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import { getResourceRelated, getResourceRow } from "@/lib/db-resources";
import { queryRows } from "@/lib/db";
import type { ManagementPageProps } from "@/components/ManagementPage";
import { getListRoute } from "@/lib/resource-routes";

type Props = {
  config: ManagementPageProps;
  resource: string;
  id: string;
};

function humanizeKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\bid\b/gi, "ID")
    .replace(/\bbn\b/gi, "(BN)")
    .replace(/\ben\b/gi, "(EN)")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function looksLikeImageUrl(value: unknown) {
  if (typeof value !== "string") return false;
  return /^(https?:\/\/|\/uploads\/|\/)/.test(value) && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(value);
}

function looksLikeUrl(value: unknown) {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

// Collects every image URL on the record (single image fields + media_json arrays).
function collectImages(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    if (looksLikeImageUrl(value)) out.push(value as string);
    else if (/image|photo|media|document|thumbnail|avatar/i.test(key)) {
      if (typeof value === "string" && value.startsWith("http")) out.push(value);
      else if (Array.isArray(value)) value.forEach((u) => typeof u === "string" && out.push(u));
      else if (typeof value === "string" && value.trim().startsWith("[")) {
        try { JSON.parse(value).forEach((u: unknown) => typeof u === "string" && out.push(u)); } catch { /* not json */ }
      }
    }
  }
  return [...new Set(out)].filter(Boolean);
}

function isMoneyKey(key: string) {
  return /price|amount|earning|rate|fee|income|investment|balance|total/i.test(key);
}

// "10 Jun 2026, 3:45 PM" — compact, professional date rendering.
function formatDate(d: Date, withTime = true): string {
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (!withTime) return date;
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date}, ${time}`;
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  const s = String(value);
  if (/^(is_|has_|send_|can_)/.test(key) || key === "active") {
    if (s === "1" || s === "true") return "Yes";
    if (s === "0" || s === "false") return "No";
  }
  if (/_at$|_date$|^date_/.test(key) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return formatDate(d, /_at$/.test(key));
  }
  if (isMoneyKey(key) && /^\d+(\.\d+)?$/.test(s)) return "৳" + Number(s).toLocaleString();
  return s;
}

// Pick the most human title for the record header.
function pickTitle(row: Record<string, unknown>, fallback: string): string {
  for (const k of ["title_en", "name_en", "full_name", "display_name", "name", "title", "project_name", "listing_code", "application_code", "order_code", "sku", "email"]) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return fallback;
}

const STATUS_TONE: Record<string, string> = {
  active: "ok", approved: "ok", verified: "ok", open: "ok", paid: "ok", live: "ok",
  pending: "warn", submitted: "warn", draft: "warn", opening_soon: "warn", needs_document: "warn", officer_verification: "warn", ready_to_approve: "warn",
  rejected: "bad", cancelled: "bad", suspended: "bad", out_of_stock: "bad", inactive: "bad", sold: "muted"
};

// A short list of the most useful facts to surface as chips at the top.
function keyFacts(row: Record<string, unknown>): Array<[string, string]> {
  const wanted = ["status", "phone", "email", "district", "upazila", "current_step",
    "interest_slug", "category_slug", "created_at"];
  const facts: Array<[string, string]> = [];
  for (const k of wanted) {
    if (k in row && row[k] !== null && row[k] !== "" && row[k] !== undefined) {
      facts.push([humanizeKey(k), formatValue(k, row[k])]);
    }
    if (facts.length >= 6) break;
  }
  return facts;
}

/**
 * The numbers worth reading before anything else — money, weights, counts and
 * scores — promoted out of the 40-row field grid into tiles at the top. A
 * record view where the price, the stock and the payable amount are three rows
 * among forty makes the reader hunt for them.
 */
const HEADLINE = [
  "price", "payable_amount", "total_amount", "final_amount", "amount", "contract_amount",
  "farmer_expected_price", "estimated_earning", "investment_amount", "income_amount",
  "requested_amount", "approved_amount", "recommended_amount", "principal", "outstanding_total",
  "overdue_amount", "emi_amount", "discount_amount", "stock_qty", "quantity", "weight_kg",
  "verified_weight_kg", "actual_weight_kg", "total_score", "score", "learning_points",
  "capacity", "total_land_decimals", "livestock_count", "recipients", "usage_limit_total"
];

function headlineMetrics(row: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const key of HEADLINE) {
    const value = row[key];
    if (value === null || value === undefined || value === "" || Number(value) === 0) continue;
    out.push([humanizeKey(key), formatValue(key, value)]);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Fields that mean "someone has to look at this". They are shown as a callout
 * above the record instead of being left to be noticed in the grid.
 */
const ATTENTION: Array<{ key: string; when?: (v: unknown) => boolean; label: (v: unknown) => string; tone: "bad" | "warn" }> = [
  { key: "manual_review_required", when: (v) => String(v) === "1", label: () => "Manual review required", tone: "bad" },
  { key: "manual_review_reason", label: (v) => `Review reason: ${String(v)}`, tone: "bad" },
  { key: "hard_stop", when: (v) => String(v) === "1", label: () => "Hard stop triggered", tone: "bad" },
  { key: "reject_reason", label: (v) => `Rejected: ${String(v)}`, tone: "bad" },
  { key: "cancel_reason", label: (v) => `Cancelled: ${String(v)}`, tone: "bad" },
  { key: "rejection_reason", label: (v) => `Rejected: ${String(v)}`, tone: "bad" },
  { key: "decline_reason_text", label: (v) => `Declined: ${String(v)}`, tone: "bad" },
  { key: "needs_correction_note", label: (v) => `Correction asked: ${String(v)}`, tone: "warn" },
  { key: "gate_reason", label: (v) => `Gate: ${String(v)}`, tone: "warn" },
  { key: "risk_flag", label: (v) => `Risk flag: ${String(v)}`, tone: "warn" },
  { key: "ai_reason", label: (v) => `AI moderation: ${String(v)}`, tone: "warn" },
  { key: "last_error", label: (v) => `Last error: ${String(v)}`, tone: "bad" },
  { key: "discrepancy_note", label: (v) => `Discrepancy: ${String(v)}`, tone: "warn" },
  { key: "is_kyc_verified", when: (v) => String(v) === "0", label: () => "KYC not verified", tone: "warn" },
  { key: "report_count", when: (v) => Number(v) > 0, label: (v) => `${v} report${Number(v) === 1 ? "" : "s"} on this post`, tone: "warn" },
  { key: "days_past_due", when: (v) => Number(v) > 0, label: (v) => `${v} day${Number(v) === 1 ? "" : "s"} past due`, tone: "bad" }
];

function attentionNotes(row: Record<string, unknown>) {
  const out: Array<{ label: string; tone: "bad" | "warn" }> = [];
  for (const rule of ATTENTION) {
    const value = row[rule.key];
    if (value === null || value === undefined || value === "") continue;
    if (rule.when ? !rule.when(value) : false) continue;
    if (!rule.when && !String(value).trim()) continue;
    out.push({ label: rule.label(value), tone: rule.tone });
  }
  return out;
}

/**
 * Which section a column belongs to. Forty columns in one alphabetical grid is
 * a data dump; the same forty under seven headings is a record.
 */
const GROUPS = [
  { id: "identity", title: "Identity", test: (k: string) => /^(.*_code|code|sku|slug|name.*|title.*|full_name|display_name|label.*|subtitle.*|short_name.*|email|phone|.*_phone|nid_number|contact.*|username|emoji|icon)$/i.test(k) },
  { id: "state", title: "Status & workflow", test: (k: string) => /^(status|.*_status|is_.*|has_.*|can_.*|send_.*|current_step|step|stage|.*_stage|verdict|decision|grade|.*_grade|result|polarity|flag|.*_flag|overridable|priority|severity|.*_required|.*_revocable|reverify_requested|pending_user_action|coming_soon|region_based|active)$/i.test(k) },
  { id: "money", title: "Money & measures", test: (k: string) => /(amount|price|fee|rate|interest|payable|principal|outstanding|balance|score|weight|quantity|qty|count|points|percent|pct|tenure|capacity|decimals|limit|duration|size|threshold|installment|emi|discount|investment|income|total)/i.test(k) },
  { id: "where", title: "Location", test: (k: string) => /^(division.*|district.*|upazila.*|union_name|village|address.*|.*_address|latitude|longitude|gps_.*|checkin_.*|area|zone.*|region.*|from_address|to_address)$/i.test(k) },
  { id: "who", title: "People & ownership", test: (k: string) => /^(user_id|.*_by|.*_admin_id|officer_id|assigned_.*|owner.*|actor.*|reviewer.*|created_by|lender_name|buyer.*|farmer.*|vet_name|driver.*|transporter)$/i.test(k) },
  { id: "links", title: "Media & links", test: (k: string) => /(url|image|photo|logo|thumbnail|document|file|deeplink|website|asset)/i.test(k) },
  { id: "when", title: "Dates", test: (k: string) => /(_at$|_on$|_date$|^date_|expires|starts|ends|due)/i.test(k) },
  { id: "refs", title: "References", test: (k: string) => /_id$/i.test(k) },
  { id: "other", title: "Other fields", test: () => true }
] as const;

function groupOf(key: string) {
  return (GROUPS.find((g) => g.test(key)) ?? GROUPS[GROUPS.length - 1]).id;
}

/**
 * "district_id" normally reads better as "District" — except on the tables
 * that kept the legacy text column beside the id, where dropping the suffix
 * printed "District" twice in the same group.
 */
function fieldLabel(key: string, row: Record<string, unknown>) {
  const label = humanizeKey(key);
  const bare = key.replace(/_id$/i, "");
  if (/_id$/i.test(key) && bare in row) return label;
  return label.replace(/ ID$/i, "");
}

function FieldValue({ k, v }: { k: string; v: unknown }) {
  if (looksLikeImageUrl(v)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <a href={String(v)} target="_blank" rel="noreferrer"><img src={String(v)} alt={k} className="def-thumb" /></a>;
  }
  if (looksLikeUrl(v)) {
    return <a className="def-link" href={String(v)} target="_blank" rel="noreferrer"><Link2 size={13} /> {String(v).replace(/^https?:\/\//, "").slice(0, 48)}</a>;
  }
  if (k === "status" || /^(is_|has_|can_)/.test(k) || k === "active") {
    const sv = formatValue(k, v);
    const tone = STATUS_TONE[String(v)] || (sv === "Yes" ? "ok" : sv === "No" ? "muted" : "muted");
    return <span className={`def-badge db-${tone}`}>{sv}</span>;
  }
  return <strong className="def-value">{formatValue(k, v)}</strong>;
}

// Foreign-key columns -> where their human name lives. Detail pages show the
// name (with the id de-emphasised) instead of a bare number.
const FK_LOOKUP: Record<string, { table: string; nameCol: string }> = {
  user_id: { table: "app_users", nameCol: "full_name" },
  approved_by: { table: "admin_users", nameCol: "name" },
  moderated_by: { table: "admin_users", nameCol: "name" },
  assigned_officer_id: { table: "admin_users", nameCol: "name" },
  admin_user_id: { table: "admin_users", nameCol: "name" },
  sale_item_id: { table: "sale_items", nameCol: "name_en" },
  sale_category_id: { table: "sale_categories", nameCol: "name_en" },
  animal_id: { table: "animals", nameCol: "name_en" },
  breed_id: { table: "animal_breeds", nameCol: "name_en" },
  buy_category_id: { table: "buy_categories", nameCol: "name_en" },
  partner_project_id: { table: "partner_projects", nameCol: "name_en" },
  product_id: { table: "products", nameCol: "name_en" },
  order_id: { table: "orders", nameCol: "order_code" },
  learning_category_id: { table: "learning_categories", nameCol: "name_en" },
  learning_module_id: { table: "learning_modules", nameCol: "title_en" },
  community_post_id: { table: "community_posts", nameCol: "id" }
};

async function resolveFkNames(row: Record<string, unknown>): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  await Promise.all(
    Object.entries(row).map(async ([key, value]) => {
      const fk = FK_LOOKUP[key];
      if (!fk || value === null || value === undefined || value === "") return;
      try {
        const rows = await queryRows<Record<string, unknown>>(
          `SELECT ${fk.nameCol} AS name FROM ${fk.table} WHERE id = ? LIMIT 1`,
          [value]
        );
        if (rows[0]?.name) resolved[key] = String(rows[0].name);
      } catch {
        // Lookup failures fall back to showing the raw id.
      }
    })
  );
  return resolved;
}

export async function ResourceDetailPage({ config, resource, id }: Props) {
  const row = (await getResourceRow(resource, id)) as Record<string, unknown> | null;
  const related = (await getResourceRelated(resource, id)) as Record<string, unknown[]>;
  const fkNames = row ? await resolveFkNames(row) : {};
  const listHref = getListRoute(resource);
  const images = row ? collectImages(row) : [];
  const entries = row ? Object.entries(row) : [];
  const hasRelated = Object.values(related || {}).some((v) => Array.isArray(v) && v.length);
  const title = row ? pickTitle(row, `${config.entityName} #${id}`) : `${config.entityName} #${id}`;
  const facts = row ? keyFacts(row) : [];
  const metrics = row ? headlineMetrics(row) : [];
  const notes = row ? attentionNotes(row) : [];
  // Non-null fields first (the useful data), null/empty last and dimmed.
  const sorted = entries.sort((a, b) => {
    const an = a[1] === null || a[1] === "" || a[1] === undefined ? 1 : 0;
    const bn = b[1] === null || b[1] === "" || b[1] === undefined ? 1 : 0;
    return an - bn;
  });
  // Scalars, grouped; JSON and object columns keep their own panel.
  const scalars = sorted.filter(
    ([key, value]) => key !== "id" && !(typeof value === "object" && value !== null && !(value instanceof Date))
  );
  const sections = GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    fields: scalars.filter(([key]) => groupOf(key) === group.id)
  })).filter((group) => group.fields.length > 0);

  return (
    <AdminShell>
      <section className="detail-hero">
        <div className="detail-hero-main">
          <Link className="back-link" href={listHref}><ArrowLeft size={18} /> Back to {config.entityName}</Link>
          <p className="eyeline">{config.entityName} · Record #{id}</p>
          <h1 className="page-title">{title}</h1>
          {facts.length ? (
            <div className="detail-facts">
              {facts.map(([label, value]) => (
                <span className="detail-fact" key={label}><span className="detail-fact-l">{label}</span><span className="detail-fact-v">{value}</span></span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="detail-actions">
          {row?.status ? <Status label={String(row.status)} /> : null}
          <Link className="btn primary" href={`/manage/form?resource=${encodeURIComponent(resource)}&id=${encodeURIComponent(id)}`}><Edit3 size={18} /> Edit</Link>
        </div>
      </section>

      {/* What someone has to act on, before the field grid. */}
      {notes.length ? (
        <section className="detail-alerts">
          {notes.map((note) => (
            <p className={`detail-alert is-${note.tone}`} key={note.label}>
              <AlertTriangle size={15} aria-hidden="true" /> {note.label}
            </p>
          ))}
        </section>
      ) : null}

      {/* The numbers the record is mostly consulted for. */}
      {metrics.length ? (
        <section className="grid metrics detail-metrics">
          {metrics.map(([label, value]) => (
            <div className="metric" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
      ) : null}

      {!row ? (
        <div className="panel empty-state">
          <h2>Record not found</h2>
          <p>No data was found for this resource and id.</p>
        </div>
      ) : (
        <section className="dashboard-layout">
          <div className="panel">
            {images.length ? (
              <>
                <div className="panel-header"><div><h2>Media</h2><p>{images.length} image{images.length > 1 ? "s" : ""} on this record.</p></div></div>
                <div className="detail-gallery">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {images.map((src) => <a key={src} href={src} target="_blank" rel="noreferrer"><img src={src} alt="" className="detail-img" /></a>)}
                </div>
              </>
            ) : null}
            <div className="panel-header">
              <div>
                <h2><Database size={16} />Record fields</h2>
                <p>{entries.length} columns from <code>{resource}</code>, grouped by what they describe.</p>
              </div>
            </div>
            {sections.map((group) => (
              <div className="def-section" key={group.id}>
                <h3 className="def-section-title">
                  {group.title} <span className="def-section-count">{group.fields.length}</span>
                </h3>
                <div className="def-grid">
                  {group.fields.map(([key, value]) => {
                    const isEmpty = value === null || value === "" || value === undefined;
                    const fkName = fkNames[key];
                    return (
                      <div key={key} className={`def-item${isEmpty ? " def-item-empty" : ""}`}>
                        <span className="def-label">{fieldLabel(key, row ?? {})}</span>
                        {fkName
                          ? <strong className="def-value">{fkName} <span className="def-fk-id">#{String(value)}</span></strong>
                          : <FieldValue k={key} v={value} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <aside className="panel">
            <div className="panel-header">
              <div>
                <h2><Link2 size={16} />Related Data</h2>
                <p>Linked records from joined tables.</p>
              </div>
            </div>
            {/* Structured (JSON) columns live here, with the related tables. */}
            {sorted
              .filter(([, value]) => typeof value === "object" && value !== null && !(value instanceof Date))
              .map(([key, value]) => (
                <div key={key} className="related-block">
                  <h3 className="related-title">{humanizeKey(key)}</h3>
                  <pre className="json-box small">{formatValue(key, value)}</pre>
                </div>
              ))}
            {!hasRelated ? (
              <p className="muted-note">No related records for this item.</p>
            ) : (
              Object.entries(related).map(([name, arr]) => {
                if (!Array.isArray(arr) || arr.length === 0) return null;
                const cols = Object.keys(arr[0] as Record<string, unknown>).slice(0, 5);
                return (
                  <div key={name} className="related-block">
                    <h3 className="related-title">{humanizeKey(name)} <span className="related-count">{arr.length}</span></h3>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead><tr>{cols.map((c) => <th key={c}>{humanizeKey(c)}</th>)}</tr></thead>
                        <tbody>
                          {(arr as Record<string, unknown>[]).slice(0, 25).map((r, i) => (
                            <tr key={i}>{cols.map((c) => <td key={c}>{formatValue(c, r[c])}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </aside>
        </section>
      )}
    </AdminShell>
  );
}
