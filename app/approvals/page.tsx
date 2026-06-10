"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import {
  ListChecks, Store, HandCoins, ScrollText, UsersRound, ShieldCheck,
  CheckCircle2, XCircle, ChevronRight, Loader2, ExternalLink, BadgeCheck, AlertTriangle,
  PackageCheck, Edit3, Boxes
} from "lucide-react";

type Row = Record<string, unknown>;
type Queues = {
  counts: { listings: number; enrollments: number; kyc: number; users: number; orders: number; total: number };
  listings: Row[]; enrollments: Row[]; kyc: Row[]; users: Row[]; orders: Row[];
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
  users: { title: "New Users", icon: UsersRound, viewAll: "/users", note: "New registrations — approval grants seller role" },
  orders: { title: "Buy Orders", icon: PackageCheck, viewAll: "/orders", note: "Placed orders pending inventory validation" }
} as const;

// Resource keys for the generic edit form, so admins can fill missing fields in place.
const EDIT_RESOURCE: Record<string, string> = {
  listing: "sale/listings", enrollment: "partners/applications", kyc: "app/user-kyc", user: "users", order: "buy/orders"
};

const REQUIRABLE_DOCS: Array<[string, string]> = [
  ["nid_front", "NID Front"], ["nid_back", "NID Back"], ["selfie", "User Photo"],
  ["trade_license", "Trade License"], ["passbook", "Bank Passbook"]
];

function fmt(v: unknown) {
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

function fmtDate(v: unknown) {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
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
  const [reqDocs, setReqDocs] = useState<string[]>([]);
  const [reqMsg, setReqMsg] = useState("");
  const [decideError, setDecideError] = useState("");

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
        setDecideError("");
        setReqMsg("");
        if (sel.type === "listing") {
          const it = json.data.item as Row;
          setPub({
            price: it.farmer_expected_price ? String(it.farmer_expected_price) : "",
            stock: it.quantity ? String(it.quantity) : "",
            buy_category_id: "",
            description: (it.description as string) || ""
          });
        }
        if (sel.type === "enrollment") {
          const raw = (json.data.item as Row).required_docs;
          const parsed = Array.isArray(raw) ? raw.map(String)
            : typeof raw === "string" && raw.trim().startsWith("[") ? (JSON.parse(raw) as string[]) : [];
          setReqDocs(parsed);
        }
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Verify / reject one KYC document inline, then refresh the open drawer.
  async function decideDoc(docId: string, action: "approve" | "reject") {
    await fetch("/api/v1/app/admin/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "kyc", id: docId, action, admin_id: adminId })
    }).catch(() => {});
    if (selected) openDetail(selected);
    loadQueues();
  }

  // Save which documents are mandatory for this specific project application.
  async function saveRequiredDocs() {
    if (!selected || !detail) return;
    setReqMsg("");
    const res = await fetch("/api/v1/app/admin/set-required-docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application_id: selected.id, required_docs: reqDocs, admin_id: adminId })
    });
    const json = await res.json().catch(() => null);
    setReqMsg(json?.ok ? "Requirements saved — application moves to needs-document until uploaded & verified." : (json?.message || "Failed to save."));
    loadQueues();
  }

  // Admin uploads a required document on the applicant's behalf: file -> /api/upload,
  // then attach to the user's KYC documents and auto-verify it.
  async function uploadDocForUser(docType: string, file: File) {
    if (!detail) return;
    const applicantId = (detail.item as Row).user_id;
    if (!applicantId) { setReqMsg("No applicant user on this record."); return; }
    setReqMsg(`Uploading ${DOC_LABEL[docType] || docType}…`);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "kyc");
      const up = await fetch("/api/upload", { method: "POST", body: form });
      const upJson = await up.json();
      if (!up.ok || !upJson.url) throw new Error(upJson.message || "Upload failed.");
      const docRes = await fetch("/api/v1/app/kyc-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: applicantId, doc_type: docType, document_url: upJson.url, note: `Uploaded by admin #${adminId ?? "?"}` })
      });
      const docJson = await docRes.json();
      const newDocId = docJson?.result?.id;
      if (!docRes.ok || !newDocId) throw new Error(docJson.message || "Could not attach the document.");
      // Auto-verify: the admin sourced this document directly.
      await fetch("/api/v1/app/admin/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "kyc", id: String(newDocId), action: "approve", admin_id: adminId })
      });
      setReqMsg(`${DOC_LABEL[docType] || docType} uploaded, assigned to the applicant and verified.`);
      if (selected) openDetail(selected);
      loadQueues();
    } catch (e) {
      setReqMsg(e instanceof Error ? e.message : "Upload failed.");
    }
  }

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
      } else {
        setDecideError(json.message || "The decision could not be applied.");
      }
    } finally {
      setActing(false);
    }
  }

  function queueItemType(key: keyof typeof QUEUE_META): string {
    return key === "listings" ? "listing" : key === "enrollments" ? "enrollment" : key === "users" ? "user" : key === "orders" ? "order" : "kyc";
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
              key === "orders" ? `${fmt(it.order_code)} · ৳${Number(it.payable_amount || 0).toLocaleString()}` :
              `${fmt(it.full_name)}`;
            const sub =
              key === "listings" ? `${fmt(it.full_name)} · ${fmt(it.listing_code)} · ৳${Number(it.farmer_expected_price || 0).toLocaleString()} · ${fmtDate(it.created_at)}` :
              key === "enrollments" ? `${fmt(it.full_name)} · ${fmt(it.application_code)} · step: ${String(it.current_step || "").replace(/_/g, " ")} · ${fmtDate(it.created_at)}` :
              key === "orders" ? `${fmt(it.full_name)} · ${fmt(it.items_summary)} · ${fmtDate(it.created_at)}` :
              key === "users" ? `${fmt(it.phone)} · ${[it.district, it.upazila].filter(Boolean).join(", ") || "no region"} · ${fmtDate(it.created_at)}` :
              `${fmt(it.full_name)} · ${fmt(it.phone)} · ${fmtDate(it.created_at)}`;
            const kycOk = Number(it.is_kyc_verified) === 1;
            const stockOk = Number(it.stock_ok) === 1;
            return (
              <button className="aq-item" key={id} onClick={() => openDetail({ type: queueItemType(key), id, title })}>
                <div className="aq-item-main">
                  <span className="aq-item-title">{title}</span>
                  <span className="aq-item-sub">{sub}</span>
                </div>
                {(key === "listings" || key === "enrollments") ? (
                  <span className={`aq-kyc ${kycOk ? "ok" : "warn"}`}>{kycOk ? <BadgeCheck size={13} /> : <AlertTriangle size={13} />}{kycOk ? "KYC" : "no KYC"}</span>
                ) : null}
                {key === "orders" ? (
                  <span className={`aq-kyc ${stockOk ? "ok" : "warn"}`}>{stockOk ? <BadgeCheck size={13} /> : <AlertTriangle size={13} />}{stockOk ? "stock" : "low stock"}</span>
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
          {renderQueue("orders", queues.orders || [])}
          {renderQueue("kyc", queues.kyc)}
          {renderQueue("users", queues.users)}
        </div>
      )}

      {selected ? (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className={`drawer${selected.type === "enrollment" ? " drawer-wide" : ""}`} onClick={(e) => e.stopPropagation()}>
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

                <Link className="aq-editlink" href={`/manage/form?resource=${encodeURIComponent(EDIT_RESOURCE[detail.type] || "users")}&id=${encodeURIComponent(selected.id)}`}>
                  <Edit3 size={14} /> Add / fix missing fields on this record
                </Link>

                {detail.type === "enrollment" ? (
                  <div className="reqpanel">
                    <h3 className="vpanel-title"><ShieldCheck size={15} /> Required documents for this project</h3>
                    <p className="pubform-note">Tick a document to make it mandatory before this application can be approved.</p>
                    <div className="reqpanel-grid">
                      {REQUIRABLE_DOCS.map(([key, label]) => {
                        const checked = reqDocs.includes(key);
                        const have = detail.documents.some((d) => String(d.doc_type) === key && String(d.status) === "verified");
                        return (
                          <div className="reqpanel-row" key={key}>
                            <label className="reqpanel-check">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => setReqDocs(e.target.checked ? [...reqDocs, key] : reqDocs.filter((d) => d !== key))}
                              />
                              {label}
                            </label>
                            {have ? <span className="vbadge vb-ok">✓ verified</span> : checked ? (
                              <label className="reqpanel-upload">
                                ⬆ Upload
                                <input
                                  type="file"
                                  accept="image/*,.pdf"
                                  style={{ display: "none" }}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) uploadDocForUser(key, f);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <button type="button" className="reqpanel-save" onClick={saveRequiredDocs}>Save requirements</button>
                    {reqMsg ? <p className="pubform-note" style={{ marginTop: 8 }}>{reqMsg}</p> : null}
                  </div>
                ) : null}

                {detail.type === "order" && Array.isArray(detail.item.order_lines) ? (
                  <div className="invpanel">
                    <h3 className="vpanel-title"><Boxes size={15} /> Inventory check</h3>
                    <table className="au-table">
                      <thead><tr><th>Product</th><th>Ordered</th><th>In stock</th><th>Other pending</th><th>OK</th></tr></thead>
                      <tbody>
                        {(detail.item.order_lines as Row[]).map((l) => (
                          <tr key={String(l.product_id)}>
                            <td>{fmt(l.name_en)}</td>
                            <td>{fmt(l.quantity)}</td>
                            <td>{fmt(l.stock_qty)}</td>
                            <td>{fmt(l.other_pending_qty)}</td>
                            <td>{Number(l.stock_ok) === 1 ? <span className="vbadge vb-ok">✓</span> : <span className="vbadge vb-bad">short</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {Array.isArray(detail.item.inventory_history) && (detail.item.inventory_history as Row[]).length ? (
                      <>
                        <h4 className="invpanel-sub">Recent stock movements</h4>
                        {(detail.item.inventory_history as Row[]).map((m, i) => (
                          <p className="invpanel-row" key={i}>
                            <span>{fmtDate(m.created_at)}</span> · {fmt(m.name_en)} · <strong className={Number(m.change_qty) < 0 ? "txt-warn" : "txt-ok"}>{Number(m.change_qty) > 0 ? "+" : ""}{fmt(m.change_qty)}</strong> · {fmt(m.reason)} {m.ref_code ? `(${m.ref_code})` : ""}
                          </p>
                        ))}
                      </>
                    ) : <p className="pubform-note" style={{ marginTop: 8 }}>No prior stock movements for these products.</p>}
                    <p className="pubform-note" style={{ marginTop: 8 }}>Approving confirms the order and deducts the quantities above from inventory.</p>
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
                        <div className="vdoc" key={String(d.id)}>
                          <a href={String(d.document_url)} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={String(d.document_url)} alt={DOC_LABEL[String(d.doc_type)] || "doc"} />
                          </a>
                          <span className="vdoc-label">{DOC_LABEL[String(d.doc_type)] || fmt(d.doc_type)}</span>
                          <span className={`vdoc-status s-${d.status}`}>{fmt(d.status)}</span>
                          {String(d.status) === "pending" ? (
                            <span className="vdoc-actions">
                              <button type="button" className="vdoc-ok" onClick={() => decideDoc(String(d.id), "approve")}>✓ Verify</button>
                              <button type="button" className="vdoc-no" onClick={() => decideDoc(String(d.id), "reject")}>✕</button>
                            </span>
                          ) : null}
                        </div>
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

            <footer className="drawer-foot-wrap">
              {decideError ? <p className="drawer-error"><AlertTriangle size={14} /> {decideError}</p> : null}
              <div className="drawer-foot">
                <button className="btn-reject" disabled={acting} onClick={() => decide("reject")}><XCircle size={16} /> Reject</button>
                <button className="btn-approve" disabled={acting} onClick={() => decide("approve")}>{acting ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} Approve</button>
              </div>
            </footer>
          </aside>
        </div>
      ) : null}
    </AdminShell>
  );
}
