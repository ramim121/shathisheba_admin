"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { Select } from "@/components/Select";
import {
  ListChecks, Store, HandCoins, ScrollText, UsersRound, ShieldCheck,
  CheckCircle2, XCircle, ChevronRight, Loader2, ExternalLink, BadgeCheck, AlertTriangle,
  PackageCheck, Edit3, Boxes, ArrowRight, History, GitCompareArrows, X
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
type Change = { field: string; label: string; before: string | null; after: string | null };
type PreviousDecision = { decision: string; decided_at: string };
type Detail = {
  type: string; item: Row; verification: Verification | null; documents: Row[];
  changes?: Change[]; previous_decision?: PreviousDecision | null;
};
type Selected = { type: string; id: string; title: string };
type QueueKey = "listings" | "enrollments" | "kyc" | "users" | "orders";
type DecisionResult = { previous_status?: string | null; status?: string; effects?: string[] };
/** A decision just made: its banner, and (while `showRow`) its flash row in the queue. */
type Decision = {
  key: number; queue: QueueKey | null; id: string; title: string; action: "approve" | "reject";
  previousStatus: string | null; status: string; effects: string[]; showRow: boolean;
};

// Long enough to read the flash row, short enough that the queue does not
// fill up with things that are already done.
const FLASH_MS = 4000;

const QUEUE_OF: Record<string, QueueKey> = {
  enrollment: "enrollments", kyc: "kyc", user: "users", order: "orders"
};

function humanStatus(s: string | null | undefined) {
  return String(s ?? "").replace(/_/g, " ");
}

// What the officer opens the listing workspace to do next. Listings are never
// approved — the status is a consequence of the section that gets recorded.
const LISTING_NEXT: Record<string, string> = {
  draft: "not submitted yet",
  submitted: "record field verification",
  field_verification: "finish field verification",
  verified: "record the purchase contract",
  contracted: "record shipping",
  shipped: "record the payment to the farmer"
};

function transitionText(d: { previousStatus: string | null; status: string }) {
  return d.previousStatus && d.previousStatus !== d.status
    ? `${humanStatus(d.previousStatus)} → ${humanStatus(d.status)}`
    : humanStatus(d.status);
}

/** Outcome of a decision with its side effects as chips. */
function DecisionBanner({ d, onDismiss }: { d: Omit<Decision, "key" | "queue" | "id" | "showRow">; onDismiss: () => void }) {
  const ok = d.action === "approve";
  return (
    <div className={`aq-result ${ok ? "is-ok" : "is-bad"}`} role="status">
      <span className="aq-result-icon">{ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}</span>
      <div className="aq-result-main">
        <p className="aq-result-line">
          <strong>{ok ? "Approved ✓" : "Rejected ✕"}</strong> {d.title} <span className="aq-result-trans">· {transitionText(d)}</span>
        </p>
        {d.effects.length ? (
          <ul className="aq-effects">{d.effects.map((e, i) => <li key={i}>{e}</li>)}</ul>
        ) : null}
      </div>
      <button type="button" className="aq-result-x" aria-label="Dismiss" onClick={onDismiss}><X size={15} /></button>
    </div>
  );
}

const DOC_LABEL: Record<string, string> = {
  nid_front: "NID Front", nid_back: "NID Back", selfie: "User Photo",
  trade_license: "Trade License", passbook: "Bank Passbook", other: "Other"
};

// Listings are a worklist, not a decision queue: a row opens the listing
// workspace, where each section is recorded and the status follows from it.
const QUEUE_META = {
  listings: { title: "List-for-sale Listings", icon: Store, viewAll: "/sale", note: "Worklist — open one to record the next section" },
  enrollments: { title: "Project Enrollments", icon: HandCoins, viewAll: "/partners", note: "Partner project applications" },
  kyc: { title: "KYC Documents", icon: ScrollText, viewAll: "/users/kyc", note: "Uploaded identity documents to verify" },
  users: { title: "New Users", icon: UsersRound, viewAll: "/users", note: "New registrations — approval grants seller role" },
  orders: { title: "Buy Orders", icon: PackageCheck, viewAll: "/orders", note: "Placed orders pending inventory validation" }
} as const;

// Resource keys for the generic edit form, so admins can fill missing fields in place.
const EDIT_RESOURCE: Record<string, string> = {
  enrollment: "partners/applications", kyc: "app/user-kyc", user: "users", order: "buy/orders"
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
  const [reqDocs, setReqDocs] = useState<string[]>([]);
  const [reqMsg, setReqMsg] = useState("");
  const [decideError, setDecideError] = useState("");
  const [note, setNote] = useState("");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  // Result of verifying a single KYC document from inside the drawer.
  const [docDecision, setDocDecision] = useState<Omit<Decision, "key" | "queue" | "id" | "showRow"> | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

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

  function pushDecision(d: Omit<Decision, "key" | "showRow">) {
    const key = Date.now() + Math.random();
    setDecisions((prev) => [{ ...d, key, showRow: true }, ...prev].slice(0, 4));
    timers.current.push(window.setTimeout(() => {
      setDecisions((prev) => prev.map((x) => (x.key === key ? { ...x, showRow: false } : x)));
    }, FLASH_MS));
  }

  function dismissDecision(key: number) {
    setDecisions((prev) => prev.filter((x) => x.key !== key));
  }

  useEffect(() => {
    loadQueues();
    fetch("/api/admin/me").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.ok) setAdminId(j.admin.id); });
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
        setNote("");
        setDocDecision(null);
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
    const doc = detail?.documents.find((d) => String(d.id) === docId);
    const json = await fetch("/api/v1/app/admin/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "kyc", id: docId, action, admin_id: adminId })
    }).then((r) => r.json()).catch(() => null);
    if (selected) await openDetail(selected);
    // After openDetail, which clears the previous one.
    if (json?.ok) {
      const result = (json.result ?? {}) as DecisionResult;
      setDocDecision({
        title: DOC_LABEL[String(doc?.doc_type)] || "Document",
        action,
        previousStatus: result.previous_status ?? null,
        status: result.status ?? (action === "approve" ? "verified" : "rejected"),
        effects: Array.isArray(result.effects) ? result.effects : []
      });
    }
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
    setActing(true);
    try {
      const body: Record<string, unknown> = { type: selected.type, id: selected.id, action, admin_id: adminId };
      if (note.trim()) body.note = note.trim();
      const res = await fetch("/api/v1/app/admin/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.ok) {
        const result = (json.result ?? {}) as DecisionResult;
        pushDecision({
          queue: QUEUE_OF[selected.type] ?? null,
          id: selected.id,
          title: selected.title,
          action,
          previousStatus: result.previous_status ?? null,
          status: result.status ?? (action === "approve" ? "approved" : "rejected"),
          effects: Array.isArray(result.effects) ? result.effects : []
        });
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

  const changes = detail?.changes ?? [];
  const changedFields = new Set(changes.map((c) => c.field));

  function queueItemType(key: keyof typeof QUEUE_META): string {
    return key === "listings" ? "listing" : key === "enrollments" ? "enrollment" : key === "users" ? "user" : key === "orders" ? "order" : "kyc";
  }

  function renderQueue(key: keyof typeof QUEUE_META, all: Row[]) {
    const meta = QUEUE_META[key];
    const Icon = meta.icon;
    const flashes = decisions.filter((d) => d.showRow && d.queue === key);
    const flashIds = new Set(flashes.map((d) => d.id));
    // The reload may not have dropped a just-decided item yet; the flash row
    // stands in for it so it never shows twice.
    const items = flashIds.size ? all.filter((it) => !flashIds.has(String(it.id))) : all;
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
          {flashes.map((d) => (
            <div className={`aq-item aq-flash ${d.action === "approve" ? "is-ok" : "is-bad"}`} key={`flash-${d.key}`} role="status">
              <div className="aq-item-main">
                <span className="aq-item-title">{d.title}</span>
                <span className="aq-flash-line">
                  {d.action === "approve" ? "Approved ✓" : "Rejected ✕"} · {transitionText(d)}
                </span>
              </div>
              <button type="button" className="aq-flash-x" aria-label="Dismiss" onClick={() => dismissDecision(d.key)}><X size={14} /></button>
            </div>
          ))}
          {items.length === 0 && flashes.length === 0 ? <p className="aq-empty">Nothing pending 🎉</p> : items.slice(0, 12).map((it) => {
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
            // A listing row is a link into its workspace, not a decision.
            if (key === "listings") {
              return (
                <Link className="aq-item" key={id} href={`/sale/${encodeURIComponent(id)}`} style={{ textDecoration: "none" }}>
                  <div className="aq-item-main">
                    <span className="aq-item-title">{title}</span>
                    <span className="aq-item-sub">{sub}</span>
                  </div>
                  <span className="aq-kyc ok" style={{ background: "#f4eef7", color: "#6b3f7a" }}>
                    {humanStatus(String(it.status ?? ""))} · {LISTING_NEXT[String(it.status)] ?? "open the workspace"}
                  </span>
                  <span className={`aq-kyc ${kycOk ? "ok" : "warn"}`}>{kycOk ? <BadgeCheck size={13} /> : <AlertTriangle size={13} />}{kycOk ? "KYC" : "no KYC"}</span>
                  <ChevronRight size={16} className="aq-chev" />
                </Link>
              );
            }
            return (
              <button className="aq-item" key={id} onClick={() => openDetail({ type: queueItemType(key), id, title })}>
                <div className="aq-item-main">
                  <span className="aq-item-title">{title}</span>
                  <span className="aq-item-sub">{sub}</span>
                </div>
                {key === "enrollments" ? (
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
          <p className="page-sub">
            Decisional to-do queue. Review each applicant&apos;s KYC verification, then approve or reject.
            {" "}Sale listings are not approved — their rows open the listing workspace, where each section is recorded.
            {" "}{queues ? <strong>{queues.counts.total} open.</strong> : null}
          </p>
        </div>
        <button className="aq-refresh" onClick={() => loadQueues()} disabled={loading}>
          {loading ? <Loader2 size={13} className="spin" style={{ verticalAlign: "-2px", marginRight: 5 }} /> : null}Refresh
        </button>
      </div>

      {decisions.length ? (
        <div className="aq-results">
          {decisions.map((d) => <DecisionBanner key={d.key} d={d} onDismiss={() => dismissDecision(d.key)} />)}
        </div>
      ) : null}

      {/* Only the first load blanks the grid: a flash row has to stay on
          screen while the queues reload underneath it. */}
      {!queues ? (
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
                {docDecision ? <DecisionBanner d={docDecision} onDismiss={() => setDocDecision(null)} /> : null}

                {detail.previous_decision ? (
                  <p className="aq-prevnote">
                    <History size={13} /> Last reviewed: <strong>{humanStatus(detail.previous_decision.decision)}</strong> on {fmtDate(detail.previous_decision.decided_at)}
                    {changes.length ? " — since resubmitted with changes." : "."}
                  </p>
                ) : null}

                {changes.length ? (
                  <div className="aq-changes">
                    <h3 className="vpanel-title"><GitCompareArrows size={15} /> Changed since last review <span className="aq-count">{changes.length}</span></h3>
                    <ul>
                      {changes.map((c) => (
                        <li key={c.field}>
                          <span className="aq-change-label">{c.label}</span>
                          <span className="aq-change-vals">
                            <del>{c.before === null || c.before === "" ? "—" : c.before}</del>
                            <ArrowRight size={12} aria-hidden="true" />
                            <ins>{c.after === null || c.after === "" ? "—" : c.after}</ins>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

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

                {detail.type === "order" && detail.item.promotion ? (() => {
                  const p = detail.item.promotion as Row;
                  const source = p.source === "first_purchase" ? "First-purchase discount" : p.source === "voucher" ? "Voucher" : `Promo code ${String(p.code ?? "")}`;
                  const state: Record<string, string> = {
                    applied: "Approving this order confirms the discount (a first purchase is then spent). Rejecting it returns the discount to the buyer for their next order.",
                    approved: "Confirmed with the order.",
                    released: "Returned to the buyer — the order was rejected before approval.",
                    failed: "The order failed after approval. A first-purchase discount has been turned into a voucher for the next order."
                  };
                  return (
                    <div className="invpanel promo-panel">
                      <h3 className="vpanel-title">🏷️ Discount on this order</h3>
                      <p><strong>{source}</strong>: −৳{String(p.discount_amount)} on ৳{String(p.order_subtotal)} — buyer pays ৳{String(detail.item.payable_amount)}.</p>
                      <p className="pubform-note">{state[String(p.status)] ?? String(p.status)}</p>
                    </div>
                  );
                })() : null}

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
                        <div className={`vitem-row${changedFields.has(k) ? " is-changed" : ""}`} key={k} title={changedFields.has(k) ? "Changed since last review" : undefined}>
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
              <div className="aq-note-wrap">
                <input
                  className="input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (optional) — the reason, kept with the decision"
                  aria-label="Decision note"
                  maxLength={500}
                />
              </div>
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
