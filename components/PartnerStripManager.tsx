"use client";

import { useCallback, useEffect, useState, type DragEvent } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Edit3, GripVertical, ImageIcon, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { DeleteDialog } from "@/components/DeleteDialog";

type Partner = {
  id: string;
  name: string;
  kind: string;
  badge: string;
  logo_url: string;
  sort_order: number;
  active: boolean;
};

const KIND_LABEL: Record<string, string> = { buyer: "Buyer", partner: "Partner", sponsor: "Sponsor" };
const FORM_HREF = "/manage/form?resource=home/partners";

function toPartner(row: Record<string, unknown>): Partner {
  return {
    id: String(row.id),
    name: String(row.name ?? row.name_en ?? ""),
    kind: String(row.kind ?? ""),
    badge: row.badge === null || row.badge === undefined ? "" : String(row.badge),
    logo_url: row.logo_url ? String(row.logo_url) : "",
    sort_order: Number(row.sort_order ?? 0),
    active: String(row.status ?? "Active").toLowerCase() === "active"
  };
}

function Logo({ partner, size }: { partner: Partner; size: "sm" | "lg" }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`ps-logo ps-logo-${size}`}>
      {partner.logo_url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={partner.logo_url} alt="" onError={() => setBroken(true)} />
      ) : partner.name ? (
        <span className="ps-logo-initial">{partner.name.trim().charAt(0).toUpperCase()}</span>
      ) : (
        <ImageIcon size={16} />
      )}
    </span>
  );
}

export function PartnerStripManager() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [busy, setBusy] = useState<string>("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Partner | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/home/partners?surface=admin", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok || !Array.isArray(j.data)) throw new Error(j.message ?? "Could not load partners.");
      const list = (j.data as Record<string, unknown>[]).map(toPartner);
      // Stable by id as a tiebreak, so equal sort_orders do not shuffle on refresh.
      list.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id, undefined, { numeric: true }));
      setPartners(list);
      setState("ready");
    } catch (error) {
      setState("failed");
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load partners." });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Optimistic: the list moves at once, and snaps back if the server refuses.
  async function reorder(next: Partner[]) {
    const previous = partners;
    setPartners(next);
    setBusy("reorder");
    setMessage(null);
    try {
      const r = await fetch("/api/v1/admin/partners/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.map((p) => p.id) })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message ?? "The new order was not saved.");
      setMessage({ tone: "ok", text: "Order saved — the app shows it on next refresh." });
    } catch (error) {
      setPartners(previous);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The new order was not saved." });
    } finally {
      setBusy("");
    }
  }

  function move(index: number, step: -1 | 1) {
    const to = index + step;
    if (to < 0 || to >= partners.length) return;
    const next = [...partners];
    [next[index], next[to]] = [next[to], next[index]];
    void reorder(next);
  }

  function dropOn(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const from = partners.findIndex((p) => p.id === dragId);
    const to = partners.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...partners];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void reorder(next);
  }

  async function setActive(partner: Partner, active: boolean) {
    setBusy(`active:${partner.id}`);
    setMessage(null);
    setPartners((list) => list.map((p) => (p.id === partner.id ? { ...p, active } : p)));
    try {
      const r = await fetch(`/api/v1/home/partners?id=${encodeURIComponent(partner.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: active ? "1" : "0" })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message ?? "Could not change visibility.");
    } catch (error) {
      setPartners((list) => list.map((p) => (p.id === partner.id ? { ...p, active: !active } : p)));
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not change visibility." });
    } finally {
      setBusy("");
    }
  }

  function afterDelete(partner: Partner) {
    setPendingDelete(null);
    setPartners((list) => list.filter((p) => p.id !== partner.id));
    setMessage({ tone: "ok", text: `${partner.name} deleted.` });
  }

  const visible = partners.filter((p) => p.active);

  function dragProps(partner: Partner) {
    return {
      draggable: busy === "",
      onDragStart: (event: DragEvent<HTMLLIElement>) => {
        setDragId(partner.id);
        event.dataTransfer.effectAllowed = "move";
        // Firefox refuses to start a drag without data.
        event.dataTransfer.setData("text/plain", partner.id);
      },
      onDragOver: (event: DragEvent<HTMLLIElement>) => {
        if (!dragId) return;
        event.preventDefault();
        if (overId !== partner.id) setOverId(partner.id);
      },
      onDrop: (event: DragEvent<HTMLLIElement>) => {
        event.preventDefault();
        dropOn(partner.id);
        setDragId(null);
        setOverId(null);
      },
      onDragEnd: () => { setDragId(null); setOverId(null); }
    };
  }

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Engagement</p>
          <h1 className="page-title">Home partners</h1>
          <p className="subtitle">The buyer and partner logos on the app&apos;s home screen. Drag or use the arrows to set the order; switch a card off to hide it without deleting it.</p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn ghost" onClick={() => void load()}><RefreshCw size={16} /> Refresh</button>
          <Link className="btn primary" href={FORM_HREF}><Plus size={16} /> Add partner</Link>
        </div>
      </section>

      <section className="panel ps-preview">
        <div className="panel-header">
          <div>
            <h2>As farmers see it</h2>
            <p>Active partners only, in order. Start and end dates set on a partner also apply in the app.</p>
          </div>
          <span className="ps-preview-count">{visible.length} shown</span>
        </div>
        <div className="ps-phone">
          <div className="ps-phone-head">
            <strong>Our buyers &amp; partners</strong>
            <span>See all</span>
          </div>
          <div className="ps-strip">
            {visible.length === 0 ? <p className="ps-strip-empty">Nothing to show — the strip is hidden in the app.</p> : null}
            {visible.map((partner) => (
              <div key={partner.id} className="ps-strip-card">
                <Logo partner={partner} size="lg" />
                <span className="ps-strip-name">{partner.name}</span>
                {partner.badge ? <span className="ps-strip-badge">{partner.badge}</span> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {message ? <div className={`ps-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</div> : null}

      <section className="panel ps-list-panel">
        <div className="panel-header">
          <div>
            <h2>Partners</h2>
            <p>Top of the list is first on the phone.</p>
          </div>
          {busy === "reorder" ? <span className="ps-saving"><Loader2 size={13} className="spin" /> Saving order…</span> : null}
        </div>
        {state === "loading" ? <p className="ps-empty"><Loader2 size={14} className="spin" /> Loading partners…</p> : null}
        {state === "ready" && partners.length === 0 ? (
          <div className="ps-empty">
            No partners yet. <Link href={FORM_HREF}>Add the first one</Link>.
          </div>
        ) : null}
        <ol className="ps-list">
          {partners.map((partner, index) => (
            <li
              key={partner.id}
              className={`ps-card${partner.active ? "" : " is-off"}${dragId === partner.id ? " is-dragging" : ""}${overId === partner.id && dragId !== partner.id ? " is-over" : ""}`}
              {...dragProps(partner)}
            >
              <span className="ps-grip" title="Drag to reorder" aria-hidden="true"><GripVertical size={16} /></span>
              <span className="ps-pos">{index + 1}</span>
              <Logo partner={partner} size="sm" />
              <div className="ps-card-main">
                <strong>{partner.name}</strong>
                <span className="ps-card-meta">
                  {partner.kind ? <span className={`ps-kind k-${partner.kind}`}>{KIND_LABEL[partner.kind] ?? partner.kind}</span> : null}
                  {partner.badge ? <span className="ps-badge">{partner.badge}</span> : null}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={partner.active}
                aria-label={`Show ${partner.name} in the app`}
                className={`ps-switch${partner.active ? " on" : ""}`}
                disabled={busy.startsWith("active:")}
                onClick={() => void setActive(partner, !partner.active)}
              >
                <span className="ps-switch-track" aria-hidden="true"><span /></span>
                {partner.active ? "Shown" : "Hidden"}
              </button>
              <div className="ps-actions">
                <button type="button" title="Move up" aria-label="Move up" disabled={index === 0 || busy !== ""} onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
                <button type="button" title="Move down" aria-label="Move down" disabled={index === partners.length - 1 || busy !== ""} onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
                <Link href={`${FORM_HREF}&id=${encodeURIComponent(partner.id)}`} title="Edit" aria-label={`Edit ${partner.name}`}><Edit3 size={15} /></Link>
                <button type="button" className="danger" title="Delete" aria-label={`Delete ${partner.name}`} disabled={busy !== ""} onClick={() => setPendingDelete(partner)}><Trash2 size={15} /></button>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {pendingDelete ? (
        <DeleteDialog
          resource="home/partners"
          endpoint="/api/v1/home/partners"
          entityName="Home partner"
          id={pendingDelete.id}
          fallbackTitle={pendingDelete.name}
          onCancel={() => setPendingDelete(null)}
          onDeleted={() => afterDelete(pendingDelete)}
        />
      ) : null}
    </AdminShell>
  );
}
