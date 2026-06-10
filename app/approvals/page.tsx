"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import {
  ListChecks, Store, HandCoins, ScrollText, UsersRound, ShieldCheck,
  CheckCircle2, XCircle, ChevronRight, Loader2, ExternalLink, BadgeCheck, AlertTriangle
} from "lucide-react";

type Row = Record<string, unknown>;
type Queues = {
  counts: { listings: number; enrollments: number; kyc: number; users: number; total: number };
  listings: Row[]; enrollments: Row[]; kyc: Row[]; users: Row[];
};
type Verification = {
  in_system: boolean; nid: string; user_photo: string; trade_license: string;
  banking: boolean; document_count: number; nid_number: string | null; is_kyc_verified: boolean; user_status: string | null;
};
type Detail = { type: string; item: Row; verification: Verification | null; documents: Row[] };
type Selected = { type: string; id: string; title: string };

const DOC_LABEL: Record<string, string> = {
  nid_front: "NID Front", nid_back: "NID Back", selfie: "User Photo",
  trade_license: "Trade License", passbook: "Bank Passbook", other: "Other"
};

const QUEUE_META = {
  listings: { title: "List-for-sale Listings", icon: Store, viewAll: "/sale", note: "Seller listings awaiting marketplace approval" },
  enrollments: { title: "Project Enrollments", icon: HandCoins, viewAll: "/partners", note: "Partner project applications" },
  kyc: { title: "KYC Documents", icon: ScrollText, viewAll: "/users/kyc", note: "Uploaded identity documents to verify" },
  users: { title: "New Users", icon: UsersRound, viewAll: "/users", note: "New registrations — approval grants seller role" }
} as const;

function fmt(v: unknown) {
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

function VBadge({ label, status }: { label: string; status: string | boolean }) {
  const s = status === true ? "verified" : status === false ? "none" : String(status);
  const cls = s === "verified" ? "vb-ok" : s === "pending" ? "vb-warn" : s === "rejected" ? "vb-bad" : "vb-none";
  const text = s === "verified" ? "✓" : s === "pending" ? "pending" : s === "rejected" ? "✕" : "none";
  return <span className={`vbadge ${cls}`}>{label}: {text}</span>;
}

export default function ApprovalsPage() {
  const [queues, setQueues] = useState<Queues | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminId, setAdminId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [categories, setCategories] = useState<Row[]>([]);
  const [pub, setPub] = useState({ price: "", stock: "", buy_category_id: "", description: "" });

  const loadQueues = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/app/admin/approvals");
      const json = await res.json();
      if (json.ok) setQueues(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueues();
    fetch("/api/admin/me").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.ok) setAdminId(j.admin.id); });
    // All active buy categories (admin surface — includes empty ones) for the publish dropdown.
    fetch("/api/v1/buy/categories?surface=admin").then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (Array.isArray(j?.data)) setCategories(j.data.filter((c: Row) => Number(c.is_active ?? 1) === 1));
    });
  }, [loadQueues]);

  const openDetail = useCallback(async (sel: Selected) => {
    setSelected(sel);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/v1/app/admin/approval?type=${sel.type}&id=${sel.id}`);
      const json = await res.json();
      if (json.ok) {
        setDetail(json.data);
        if (sel.type === "listing") {
          const it = json.data.item as Row;
          setPub({
            price: it.farmer_expected_price ? String(it.farmer_expected_price) : "",
            stock: it.quantity ? String(it.quantity) : "",
            buy_category_id: "",
            description: (it.description as string) || ""
          });
        }
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function decide(action: "approve" | "reject") {
    if (!selected) return;
    if (selected.type === "listing" && action === "approve" && !(Number(pub.price) > 0)) {
      alert("Set a product price (> 0) before approving — it publishes to Buy-from-Shathi.");
      return;
    }
    setActing(true);
    try {
      const body: Record<string, unknown> = { type: selected.type, id: selected.id, action, admin_id: adminId };
      if (selected.type === "listing" && action === "approve") {
        body.price = Number(pub.price);
        body.stock = Number(pub.stock || 0);
        body.description = pub.description || null;
        if (pub.buy_category_id) body.buy_category_id = Number(pub.buy_category_id);
      }
      const res = await fetch("/api/v1/app/admin/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.ok) {
        setSelected(null);
        setDetail(null);
        loadQueues();
      }
    } finally {
      setActing(false);
    }
  }

  function queueItemType(key: keyof typeof QUEUE_META): string {
    return key === "listings" ? "listing" : key === "enrollments" ? "enrollment" : key === "users" ? "user" : "kyc";
  }

  function renderQueue(key: keyof typeof QUEUE_META, items: Row[]) {
    const meta = QUEUE_META[key];
    const Icon = meta.icon;
    return (
      <section className="aq-card" key={key}>
        <header className="aq-head">
          <div className="aq-head-l">
            <span className="aq-icon"><Icon size={17} /></span>
            <div>
              <h2 className="aq-title">{meta.title} <span className="aq-count">{items.length}</span></h2>
              <p className="aq-note">{meta.note}</p>
            </div>
          </div>
          <Link className="aq-viewall" href={meta.viewAll}>View all <ExternalLink size={13} /></Link>
        </header>
        <div className="aq-list">
          {items.length === 0 ? <p className="aq-empty">Nothing pending 🎉</p> : items.slice(0, 12).map((it) => {
            const id = String(it.id);
            const title =
              key === "listings" ? `${fmt(it.title)} · ${fmt(it.quantity)} ${fmt(it.unit)}` :
              key === "enrollments" ? `${fmt(it.project_name)}` :
              key === "kyc" ? `${DOC_LABEL[String(it.doc_type)] || fmt(it.doc_type)}` :
              `${fmt(it.full_name)}`;
            const sub = `${fmt(it.full_name)}${it.phone ? " · " + fmt(it.phone) : ""}`;
            const kycOk = Number(it.is_kyc_verified) === 1;
            return (
              <button className="aq-item" key={id} onClick={() => openDetail({ type: queueItemType(key), id, title })}>
                <div className="aq-item-main">
                  <span className="aq-item-title">{title}</span>
                  <span className="aq-item-sub">{sub}</span>
                </div>
                {(key === "listings" || key === "enrollments") ? (
                  <span className={`aq-kyc ${kycOk ? "ok" : "warn"}`}>{kycOk ? <BadgeCheck size={13} /> : <AlertTriangle size={13} />}{kycOk ? "KYC" : "no KYC"}</span>
                ) : null}
                <ChevronRight size={16} className="aq-chev" />
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h1 className="page-title"><ListChecks size={22} style={{ verticalAlign: "-4px", marginRight: 8 }} />Approvals</h1>
          <p className="page-sub">Decisional to-do queue. Review each applicant&apos;s KYC verification, then approve or reject. {queues ? <strong>{queues.counts.total} pending.</strong> : null}</p>
        </div>
        <button className="aq-refresh" onClick={loadQueues}>Refresh</button>
      </div>

      {loading || !queues ? (
        <p className="page-sub"><Loader2 size={16} className="spin" style={{ verticalAlign: "-3px" }} /> Loading queues…</p>
      ) : (
        <div className="aq-grid">
          {renderQueue("listings", queues.listings)}
          {renderQueue("enrollments", queues.enrollments)}
          {renderQueue("kyc", queues.kyc)}
          {renderQueue("users", queues.users)}
        </div>
      )}

      {selected ? (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <header className="drawer-head">
              <div>
                <span className="drawer-kicker">{selected.type.toUpperCase()} APPROVAL</span>
                <h2 className="drawer-title">{selected.title}</h2>
              </div>
              <button className="drawer-close" onClick={() => setSelected(null)}>×</button>
            </header>

            {detailLoading || !detail ? (
              <div className="drawer-body"><Loader2 size={18} className="spin" /> Loading…</div>
            ) : (
              <div className="drawer-body">
                {detail.verification ? (
                  <div className="vpanel">
                    <h3 className="vpanel-title"><ShieldCheck size={15} /> KYC Verification</h3>
                    <div className="vpanel-badges">
                      <VBadge label="In system" status={detail.verification.in_system} />
                      <VBadge label="NID" status={detail.verification.nid} />
                      <VBadge label="User Photo" status={detail.verification.user_photo} />
                      <VBadge label="Trade License" status={detail.verification.trade_license} />
                      <VBadge label="Bank info" status={detail.verification.banking} />
                    </div>
                    <div className="vpanel-meta">
                      <span>NID #: <strong>{fmt(detail.verification.nid_number)}</strong></span>
                      <span>Identity: <strong className={detail.verification.is_kyc_verified ? "txt-ok" : "txt-warn"}>{detail.verification.is_kyc_verified ? "verified" : "not verified"}</strong></span>
                      <span>Docs: <strong>{detail.verification.document_count}</strong></span>
                    </div>
                  </div>
                ) : null}

                {detail.type === "listing" ? (
                  <div className="pubform">
                    <h3 className="vpanel-title"><Store size={15} /> Publish to Buy-from-Shathi</h3>
                    <p className="pubform-note">On approval this listing becomes a priced product buyers can order.</p>
                    <div className="pubform-grid">
                      <label>Price (৳) *<input type="number" min="0" value={pub.price} onChange={(e) => setPub({ ...pub, price: e.target.value })} /></label>
                      <label>Stock<input type="number" min="0" value={pub.stock} onChange={(e) => setPub({ ...pub, stock: e.target.value })} /></label>
                    </div>
                    <label className="pubform-block">Category
                      <select value={pub.buy_category_id} onChange={(e) => setPub({ ...pub, buy_category_id: e.target.value })}>
                        <option value="">Livestock (default)</option>
                        {categories.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name_en)}</option>)}
                      </select>
                    </label>
                    <label className="pubform-block">Description
                      <textarea rows={2} value={pub.description} onChange={(e) => setPub({ ...pub, description: e.target.value })} placeholder="Shown to buyers" />
                    </label>
                  </div>
                ) : null}

                {detail.documents.length ? (
                  <div className="vdocs">
                    <h3 className="vpanel-title"><ScrollText size={15} /> Documents</h3>
                    <div className="vdocs-grid">
                      {detail.documents.map((d) => (
                        <a className="vdoc" key={String(d.id)} href={String(d.document_url)} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={String(d.document_url)} alt={DOC_LABEL[String(d.doc_type)] || "doc"} />
                          <span className="vdoc-label">{DOC_LABEL[String(d.doc_type)] || fmt(d.doc_type)}</span>
                          <span className={`vdoc-status s-${d.status}`}>{fmt(d.status)}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="vitem">
                  <h3 className="vpanel-title">Details</h3>
                  <dl className="vitem-dl">
                    {Object.entries(detail.item)
                      .filter(([k, v]) => v !== null && v !== "" && !["password_hash", "profile_json", "ai_analysis_json", "banking_json", "farm_assessment_json"].includes(k))
                      .map(([k, v]) => (
                        <div className="vitem-row" key={k}>
                          <dt>{k.replace(/_/g, " ")}</dt>
                          <dd>{fmt(v)}</dd>
                        </div>
                      ))}
                  </dl>
                </div>
              </div>
            )}

            <footer className="drawer-foot">
              <button className="btn-reject" disabled={acting} onClick={() => decide("reject")}><XCircle size={16} /> Reject</button>
              <button className="btn-approve" disabled={acting} onClick={() => decide("approve")}>{acting ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} Approve</button>
            </footer>
          </aside>
        </div>
      ) : null}
    </AdminShell>
  );
}
