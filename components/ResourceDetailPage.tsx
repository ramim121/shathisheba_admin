import Link from "next/link";
import { ArrowLeft, Edit3, Database, Link2 } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import { getResourceRelated, getResourceRow } from "@/lib/db-resources";
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

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  const s = String(value);
  if (/^(is_|has_|send_|can_)/.test(key) || key === "active") {
    if (s === "1" || s === "true") return "Yes";
    if (s === "0" || s === "false") return "No";
  }
  if (/_at$|_date$|^date_/.test(key) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
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
  const wanted = ["status", "phone", "email", "district", "upazila", "price", "stock_qty", "quantity",
    "farmer_expected_price", "amount", "total_amount", "investment_amount", "current_step",
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

export async function ResourceDetailPage({ config, resource, id }: Props) {
  const row = (await getResourceRow(resource, id)) as Record<string, unknown> | null;
  const related = (await getResourceRelated(resource, id)) as Record<string, unknown[]>;
  const listHref = getListRoute(resource);
  const images = row ? collectImages(row) : [];
  const entries = row ? Object.entries(row) : [];
  const hasRelated = Object.values(related || {}).some((v) => Array.isArray(v) && v.length);
  const title = row ? pickTitle(row, `${config.entityName} #${id}`) : `${config.entityName} #${id}`;
  const facts = row ? keyFacts(row) : [];
  // Non-null fields first (the useful data), null/empty last and dimmed.
  const sorted = entries.sort((a, b) => {
    const an = a[1] === null || a[1] === "" || a[1] === undefined ? 1 : 0;
    const bn = b[1] === null || b[1] === "" || b[1] === undefined ? 1 : 0;
    return an - bn;
  });

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
                <h2><Database size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} />Record Fields</h2>
                <p>{entries.length} columns from <code>{resource}</code>.</p>
              </div>
            </div>
            <div className="def-grid">
              {sorted.map(([key, value]) => {
                const isJson = typeof value === "object" && value !== null;
                const isEmpty = value === null || value === "" || value === undefined;
                return (
                  <div key={key} className={`def-item${isJson ? " def-item-wide" : ""}${isEmpty ? " def-item-empty" : ""}`}>
                    <span className="def-label">{humanizeKey(key)}</span>
                    {isJson
                      ? <pre className="json-box small">{formatValue(key, value)}</pre>
                      : <FieldValue k={key} v={value} />}
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="panel">
            <div className="panel-header">
              <div>
                <h2><Link2 size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} />Related Data</h2>
                <p>Linked records from joined tables.</p>
              </div>
            </div>
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
