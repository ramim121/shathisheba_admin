"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Ban, Loader2, ShieldAlert, Trash2, X } from "lucide-react";
import "@/components/DeleteDialog.css";

type ImpactEntry = { table: string; label: string; rows: number };

type Impact = {
  resource: string;
  id: string;
  table: string;
  exists: boolean;
  title: string | null;
  cascades: ImpactEntry[];
  blockers: ImpactEntry[];
  total: number;
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
};

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

/** The label as it appears mid-sentence: "1 partner application". */
function countLabel(entry: ImpactEntry) {
  const { noun, tail } = nounOf(entry);
  return `${entry.rows.toLocaleString("en-US")} ${noun.toLowerCase()}${tail}`;
}

function joinList(parts: string[]) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Confirms a delete by first showing what it takes with it.
 *
 * Replaces window.confirm("Delete this record?"), which told the admin nothing:
 * deleting a user silently took their sessions, roles, notifications and
 * readiness answers with it, or failed with an opaque database error because a
 * sale listing still pointed at them. /admin/delete-impact walks the foreign
 * keys, so both of those are visible before the button is pressed.
 */
export function DeleteDialog({ resource, endpoint, entityName, id, fallbackTitle, onCancel, onDeleted }: Props) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(true);
  const [impactError, setImpactError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [mounted, setMounted] = useState(false);
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
  }, [resource, id]);

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

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
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
  const cascades = impact?.cascades ?? [];
  const blockers = impact?.blockers ?? [];
  const gone = Boolean(impact && !impact.exists);

  const cascadeSentence = useMemo(() => joinList(cascades.map(countLabel)), [cascades]);
  const blockerSentence = useMemo(() => joinList(blockers.map(countLabel)), [blockers]);

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
            <h2 id="ddlg-title">Delete this {entityName.replace(/s$/, "").toLowerCase()}?</h2>
            <p id="ddlg-desc">
              {gone
                ? "This record is no longer in the database — it may already have been deleted."
                : "This removes the record from MySQL permanently. Check what goes with it before confirming."}
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

          {blockers.length ? (
            <div className="ddlg-group is-danger">
              <h3><Ban size={15} aria-hidden="true" /> This delete will be blocked</h3>
              <ul className="ddlg-list">
                {blockers.map((entry) => (
                  <li key={`b-${entry.table}`}>
                    <span className="ddlg-count">{entry.rows.toLocaleString("en-US")}</span>
                    <span>{rowLabel(entry)} still refer{entry.rows === 1 ? "s" : ""} to this record</span>
                    <span className="ddlg-table">{entry.table}</span>
                  </li>
                ))}
              </ul>
              <p className="ddlg-note is-warn" style={{ marginTop: 8 }}>
                {blockerSentence} refer{blockers.length === 1 && blockers[0].rows === 1 ? "s" : ""} to this record and the database will
                refuse the delete. Remove or reassign {blockers.length === 1 ? "it" : "them"} first.
              </p>
            </div>
          ) : null}

          {cascades.length ? (
            <div className="ddlg-group">
              <h3><AlertTriangle size={15} aria-hidden="true" /> Deleting this will also delete</h3>
              <ul className="ddlg-list">
                {cascades.map((entry) => (
                  <li key={`c-${entry.table}`}>
                    <span className="ddlg-count">{entry.rows.toLocaleString("en-US")}</span>
                    <span>{rowLabel(entry)}</span>
                    <span className="ddlg-table">{entry.table}</span>
                  </li>
                ))}
              </ul>
              <p className="ddlg-note is-plain" style={{ marginTop: 8 }}>
                In total {cascadeSentence} will be removed along with this record. This cannot be undone.
              </p>
            </div>
          ) : null}

          {!loadingImpact && !impactError && !cascades.length && !blockers.length && !gone ? (
            <p className="ddlg-note is-plain">Nothing else in the database refers to this record. Only this row will be deleted.</p>
          ) : null}

          {deleteError ? <p className="ddlg-note is-error" role="alert">{deleteError}</p> : null}
        </div>

        <div className="ddlg-foot">
          <span className="ddlg-foot-note">
            {deleting ? "Deleting…" : blockers.length ? "Expected to fail — see above." : "This cannot be undone."}
          </span>
          <button className="ddlg-btn" type="button" onClick={close} disabled={deleting}>Cancel</button>
          <button className="ddlg-btn is-danger" type="button" onClick={() => void confirmDelete()} disabled={deleting || loadingImpact || gone}>
            {deleting ? <Loader2 size={16} className="ddlg-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
