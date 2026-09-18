"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Ban, ChevronDown, Loader2, ShieldAlert, Trash2, Unlink, X } from "lucide-react";
import "@/components/DeleteDialog.css";

type Effect = "cascade" | "detach" | "block";

type ImpactEntry = {
  key: string;
  table: string;
  column: string;
  label: string;
  rows: number;
  effect: Effect;
  via?: string;
};

type Impact = {
  resource: string;
  id: string;
  table: string;
  exists: boolean;
  title: string | null;
  entries: ImpactEntry[];
  cascades: ImpactEntry[];
  blockers: ImpactEntry[];
  total: number;
  blockedRows: number;
};

type RowsPayload = {
  key: string;
  table: string;
  label: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  truncated: boolean;
};

type Props = {
  /** Resource key as the API knows it, e.g. "buy/products". */
  resource: string;
  /** List endpoint; DELETE goes to `${endpoint}?id=…`. */
  endpoint: string;
  entityName: string;
  id: string;
  /** Best label the table already has, shown until the impact call answers. */
  fallbackTitle?: string;
  onCancel: () => void;
  onDeleted: (id: string) => void;
  /**
   * For destructive actions that are not a resource DELETE (a workflow action,
   * a row inside another record). The dialog then confirms without looking up
   * an impact, and calls this instead of issuing the DELETE itself.
   */
  onConfirm?: () => Promise<void>;
  /** Overrides the "Delete this X?" heading for such actions. */
  heading?: string;
  /** Replaces the standard "this removes the record" description. */
  description?: string;
};

const EFFECT: Record<Effect, { title: string; note: string; icon: typeof Ban; tone: string }> = {
  block: {
    title: "Blocks this delete",
    note: "The database refuses the delete while these rows point at the record. Include them below to remove them first, or reassign them by hand.",
    icon: Ban,
    tone: "is-block"
  },
  cascade: {
    title: "Deleted with the record",
    note: "The database removes these automatically. This cannot be undone.",
    icon: AlertTriangle,
    tone: "is-cascade"
  },
  detach: {
    title: "Kept, but unlinked",
    note: "These rows survive with their link to this record blanked, which usually leaves them meaningless — an order item with no order, a repayment with no loan account.",
    icon: Unlink,
    tone: "is-detach"
  }
};

const ORDER: Effect[] = ["block", "cascade", "detach"];

/** "Order items" + 1 row reads better as "1 order item". */
function nounOf(entry: ImpactEntry) {
  const [head, ...rest] = entry.label.split(" (");
  const tail = rest.length ? ` (${rest.join(" (")}` : "";
  if (entry.rows !== 1) return { noun: head, tail };
  const singular = head.replace(/\b(\w+?)(ies|s)\b$/, (word, stem: string, suffix: string) =>
    suffix === "ies" ? `${stem}y` : /ss$/.test(word) ? word : stem
  );
  return { noun: singular, tail };
}

/** The label as it appears in a list row: "Partner application", "App sessions". */
function rowLabel(entry: ImpactEntry) {
  const { noun, tail } = nounOf(entry);
  return `${noun}${tail}`;
}

function humanColumn(column: string) {
  return column.replace(/_/g, " ").replace(/\bid\b/gi, "ID").replace(/^./, (c) => c.toUpperCase());
}

/** Cell text: dates shortened, money grouped, blanks marked, long text clipped. */
function cell(column: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return value.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const text = String(value);
  if (/_at$|_on$|_date$/.test(column) && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  if (/amount|price|total|fee|payable/i.test(column) && /^-?\d+(\.\d+)?$/.test(text)) {
    return `৳${Number(text).toLocaleString("en-IN")}`;
  }
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Confirms a delete by first showing what it takes with it.
 *
 * Replaces window.confirm("Delete this record?"), which told the admin nothing:
 * deleting a user silently took their sessions, roles, notifications and
 * readiness answers with it, or failed with an opaque database error because a
 * sale listing still pointed at them. /admin/delete-impact walks the foreign
 * keys, so both of those are visible before the button is pressed — and each
 * relation opens to show the actual rows, because "4 loan applications" is not
 * enough to decide with.
 */
export function DeleteDialog({
  resource,
  endpoint,
  entityName,
  id,
  fallbackTitle,
  onCancel,
  onDeleted,
  onConfirm,
  heading,
  description
}: Props) {
  const simple = Boolean(onConfirm);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(!simple);
  const [impactError, setImpactError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [rows, setRows] = useState<Record<string, RowsPayload>>({});
  const [rowsError, setRowsError] = useState<Record<string, string>>({});
  const [loadingRows, setLoadingRows] = useState<Record<string, boolean>>({});
  const [includeBlockers, setIncludeBlockers] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const close = useCallback(() => {
    if (deleting) return;
    onCancel();
  }, [deleting, onCancel]);

  // The key handler is installed once, on mount, so it must reach the current
  // close through a ref — a dependency on `close` would tear the listener down
  // and put focus back on the page every time the parent re-rendered.
  const closeRef = useRef(close);
  closeRef.current = close;

  // Impact is read-only, so a failure here is reported but never blocks the
  // admin from deleting — it just means the confirmation is less informed.
  useEffect(() => {
    if (simple) return;
    let alive = true;
    setLoadingImpact(true);
    setImpactError("");
    void (async () => {
      try {
        // A bare ?id= makes the API router fetch one record, hence target/target_id.
        const url = `/api/v1/admin/delete-impact?target=${encodeURIComponent(resource)}&target_id=${encodeURIComponent(id)}`;
        const response = await fetch(url, { cache: "no-store" });
        const json = (await response.json()) as { ok?: boolean; message?: string; data?: Impact };
        if (!alive) return;
        if (!response.ok || !json.ok || !json.data) throw new Error(json.message ?? "Could not check what this delete affects.");
        setImpact(json.data);
      } catch (error) {
        if (alive) setImpactError(error instanceof Error ? error.message : "Could not check what this delete affects.");
      } finally {
        if (alive) setLoadingImpact(false);
      }
    })();
    return () => { alive = false; };
  }, [resource, id, simple]);

  // Esc closes, Tab stays inside the dialog, and focus returns to the page.
  useEffect(() => {
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const box = dialogRef.current;
      if (!box) return;
      const stops = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!stops.length) {
        event.preventDefault();
        box.focus();
        return;
      }
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === box)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      restoreFocus.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The portal only exists after the first client render, so the dialog cannot
  // be focused until then.
  useEffect(() => {
    if (mounted) dialogRef.current?.focus();
  }, [mounted]);

  /** Rows are fetched the first time a relation is expanded, then cached. */
  async function toggleRows(entry: ImpactEntry) {
    const next = !open[entry.key];
    setOpen((o) => ({ ...o, [entry.key]: next }));
    if (!next || rows[entry.key] || loadingRows[entry.key]) return;
    setLoadingRows((l) => ({ ...l, [entry.key]: true }));
    setRowsError((e) => ({ ...e, [entry.key]: "" }));
    try {
      const url = `/api/v1/admin/delete-impact/rows?target=${encodeURIComponent(resource)}&target_id=${encodeURIComponent(id)}&relation=${encodeURIComponent(entry.key)}`;
      const response = await fetch(url, { cache: "no-store" });
      const json = (await response.json()) as { ok?: boolean; message?: string; data?: RowsPayload };
      if (!response.ok || !json.ok || !json.data) throw new Error(json.message ?? "Could not load these rows.");
      setRows((r) => ({ ...r, [entry.key]: json.data as RowsPayload }));
    } catch (error) {
      setRowsError((e) => ({ ...e, [entry.key]: error instanceof Error ? error.message : "Could not load these rows." }));
    } finally {
      setLoadingRows((l) => ({ ...l, [entry.key]: false }));
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      if (onConfirm) {
        await onConfirm();
        onDeleted(id);
        return;
      }
      const url = `${endpoint}?id=${encodeURIComponent(id)}${includeBlockers ? "&cascade=1" : ""}`;
      const response = await fetch(url, { method: "DELETE" });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!response.ok || !json.ok) throw new Error(json.message ?? "Delete failed.");
      onDeleted(id);
    } catch (error) {
      // Stay open: the message belongs next to the record it is about.
      setDeleteError(error instanceof Error ? error.message : "Delete failed.");
      setDeleting(false);
    }
  }

  const title = impact?.title ?? fallbackTitle ?? `#${id}`;
  const entries = impact?.entries ?? [];
  const blockers = entries.filter((e) => e.effect === "block");
  const blockedRows = blockers.reduce((sum, e) => sum + e.rows, 0);
  const gone = Boolean(impact && !impact.exists);
  const groups = ORDER.map((effect) => [effect, entries.filter((e) => e.effect === effect)] as const)
    .filter(([, list]) => list.length > 0);
  const blocked = blockers.length > 0 && !includeBlockers;

  if (!mounted) return null;

  return createPortal(
    <div
      className="ddlg-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div
        className="ddlg"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ddlg-title"
        aria-describedby="ddlg-desc"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="ddlg-head">
          <span className="ddlg-mark" aria-hidden="true"><ShieldAlert size={21} /></span>
          <div>
            <h2 id="ddlg-title">{heading ?? `Delete this ${entityName.replace(/s$/, "").toLowerCase()}?`}</h2>
            <p id="ddlg-desc">
              {gone
                ? "This record is no longer in the database — it may already have been deleted."
                : description ?? "This removes the record from MySQL permanently. Check what goes with it before confirming."}
            </p>
          </div>
          <button className="ddlg-close" type="button" onClick={close} disabled={deleting} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="ddlg-body">
          <div className="ddlg-record">
            <p className="ddlg-record-title">{title}</p>
            <p className="ddlg-record-meta">
              {entityName} · id <code>{id}</code>
              {impact?.table ? <> · table <code>{impact.table}</code></> : null}
              {impact && impact.total > 0 ? <> · {impact.total.toLocaleString("en-US")} dependent row{impact.total === 1 ? "" : "s"}</> : null}
            </p>
          </div>

          {loadingImpact ? (
            <p className="ddlg-loading">
              <Loader2 size={16} className="ddlg-spin" aria-hidden="true" />
              Checking what else refers to this record…
            </p>
          ) : null}

          {impactError ? (
            <p className="ddlg-note is-warn">
              {impactError} You can still delete, but the related records could not be counted first.
            </p>
          ) : null}

          {groups.map(([effect, list]) => {
            const meta = EFFECT[effect];
            const Icon = meta.icon;
            return (
              <div className={`ddlg-group ${meta.tone}`} key={effect}>
                <h3><Icon size={15} aria-hidden="true" /> {meta.title}</h3>
                <ul className="ddlg-list">
                  {list.map((entry) => {
                    const isOpen = Boolean(open[entry.key]);
                    const payload = rows[entry.key];
                    return (
                      <li key={entry.key} className="ddlg-rel">
                        <div className="ddlg-rel-head">
                          <span className="ddlg-count">{entry.rows.toLocaleString("en-US")}</span>
                          <span className="ddlg-rel-label">{rowLabel(entry)}</span>
                          <span className="ddlg-table">{entry.table}</span>
                          <button
                            type="button"
                            className={`ddlg-view${isOpen ? " is-open" : ""}`}
                            onClick={() => void toggleRows(entry)}
                            aria-expanded={isOpen}
                          >
                            {loadingRows[entry.key]
                              ? <Loader2 size={13} className="ddlg-spin" aria-hidden="true" />
                              : <ChevronDown size={13} aria-hidden="true" />}
                            {isOpen ? "Hide" : "View"}
                          </button>
                        </div>

                        {isOpen ? (
                          <div className="ddlg-rel-body">
                            {rowsError[entry.key] ? (
                              <p className="ddlg-note is-warn">{rowsError[entry.key]}</p>
                            ) : payload ? (
                              <>
                                <div className="ddlg-rel-table">
                                  <table>
                                    <thead>
                                      <tr>{payload.columns.map((c) => <th key={c}>{humanColumn(c)}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                      {payload.rows.map((r, i) => (
                                        <tr key={i}>
                                          {payload.columns.map((c) => <td key={c}>{cell(c, r[c])}</td>)}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                {payload.truncated ? (
                                  <p className="ddlg-rel-more">
                                    Showing {payload.rows.length} of {payload.total.toLocaleString("en-US")} rows.
                                  </p>
                                ) : null}
                              </>
                            ) : !loadingRows[entry.key] ? (
                              <p className="ddlg-rel-more">No rows came back.</p>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <p className="ddlg-note is-plain">{meta.note}</p>

                {effect === "block" ? (
                  <label className="ddlg-include">
                    <input
                      type="checkbox"
                      checked={includeBlockers}
                      onChange={(event) => setIncludeBlockers(event.target.checked)}
                      disabled={deleting}
                    />
                    <span>
                      <strong>
                        Also delete the {blockedRows.toLocaleString("en-US")} blocking row{blockedRows === 1 ? "" : "s"} above
                      </strong>
                      <em>
                        They are removed first, in one transaction with this record — if any part fails, nothing is
                        deleted. Open each relation above and check what is in it before ticking this.
                      </em>
                    </span>
                  </label>
                ) : null}
              </div>
            );
          })}

          {!loadingImpact && !impactError && !entries.length && !gone && !simple ? (
            <p className="ddlg-note is-plain">Nothing else in the database refers to this record. Only this row will be deleted.</p>
          ) : null}

          {deleteError ? <p className="ddlg-note is-error" role="alert">{deleteError}</p> : null}
        </div>

        <div className="ddlg-foot">
          <span className="ddlg-foot-note">
            {deleting
              ? "Deleting…"
              : blocked
                ? "Blocked — tick the box above to clear the blocking rows."
                : includeBlockers
                  ? `Deletes this record and ${blockedRows.toLocaleString("en-US")} blocking row${blockedRows === 1 ? "" : "s"}.`
                  : "This cannot be undone."}
          </span>
          <button className="ddlg-btn" type="button" onClick={close} disabled={deleting}>Cancel</button>
          <button
            className="ddlg-btn is-danger"
            type="button"
            onClick={() => void confirmDelete()}
            disabled={deleting || loadingImpact || gone || blocked}
          >
            {deleting ? <Loader2 size={16} className="ddlg-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
            {deleting ? "Deleting…" : includeBlockers ? "Delete with dependents" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
