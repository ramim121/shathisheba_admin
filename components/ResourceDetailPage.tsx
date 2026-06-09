import Link from "next/link";
import { ArrowLeft, Edit3 } from "lucide-react";
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
  return s;
}

export async function ResourceDetailPage({ config, resource, id }: Props) {
  const row = (await getResourceRow(resource, id)) as Record<string, unknown> | null;
  const related = (await getResourceRelated(resource, id)) as Record<string, unknown[]>;
  const listHref = getListRoute(resource);
  const images = row ? collectImages(row) : [];
  const entries = row ? Object.entries(row) : [];
  const hasRelated = Object.values(related || {}).some((v) => Array.isArray(v) && v.length);

  return (
    <AdminShell>
      <section className="detail-hero">
        <div>
          <Link className="back-link" href={listHref}><ArrowLeft size={18} /> Back to list</Link>
          <p className="eyeline">Record Details</p>
          <h1 className="page-title">{config.entityName} #{id}</h1>
          <p className="subtitle">Full database view for this record, including related tables where available.</p>
        </div>
        <div className="detail-actions">
          <Status label={row?.status ? String(row.status) : row ? "Loaded" : "Missing"} />
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
                  {images.map((src) => <img key={src} src={src} alt="" className="detail-img" />)}
                </div>
              </>
            ) : null}
            <div className="panel-header">
              <div>
                <h2>Main Record</h2>
                <p>All available columns from the database table.</p>
              </div>
            </div>
            <div className="def-grid">
              {entries.map(([key, value]) => {
                const isJson = typeof value === "object" && value !== null;
                return (
                  <div key={key} className={`def-item${isJson ? " def-item-wide" : ""}`}>
                    <span className="def-label">{humanizeKey(key)}</span>
                    {isJson
                      ? <pre className="json-box small">{formatValue(key, value)}</pre>
                      : <strong className="def-value">{formatValue(key, value)}</strong>}
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="panel">
            <div className="panel-header">
              <div>
                <h2>Related Data</h2>
                <p>Joined or linked records that help explain this item.</p>
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
