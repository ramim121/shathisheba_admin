"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Loader2, Mail, RotateCcw, Save, Search, Send, Smartphone } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import { Select } from "@/components/Select";
import { NotificationStatusBanner } from "@/components/NotificationStatusBanner";
import { CharCount, PhonePreview, PUSH_BODY_LIMIT, PUSH_TITLE_LIMIT, useUserOptions } from "@/components/NotificationPreview";

type ListRow = { id: string; event_key: string; name: string; category: string; channels: string; status: string };
type Draft = Record<string, string>;
type Lang = "bn" | "en";
type PreviewResult = { subject: string; title: string; body: string; html: string };
type TestResult = { inapp: boolean; push: { sent: number; skipped: number; failed: number }; email: "sent" | "skipped" | "failed" | "no_email" };

const TEXT_KEYS = [
  "name", "category",
  "title_en", "title_bn", "body_en", "body_bn",
  "email_subject_en", "email_subject_bn", "email_body_en", "email_body_bn",
  "cta_label_en", "cta_label_bn"
] as const;
const FLAG_KEYS = ["send_push", "send_inapp", "send_email", "is_active"] as const;

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

const EMAIL_RESULT: Record<TestResult["email"], string> = {
  sent: "Email sent",
  skipped: "Email skipped (channel off or no provider — queued in the delivery log)",
  failed: "Email failed — see the delivery log",
  no_email: "This user has no email address"
};

function toDraft(row: Record<string, unknown>): Draft {
  const draft: Draft = { event_key: String(row.event_key ?? "") };
  for (const key of TEXT_KEYS) draft[key] = row[key] === null || row[key] === undefined ? "" : String(row[key]);
  // Flags arrive as 1/0, "1"/"0" or booleans depending on the driver.
  for (const key of FLAG_KEYS) draft[key] = row[key] === true || String(row[key]) === "1" ? "1" : "0";
  return draft;
}

function sameDraft(a: Draft | null, b: Draft | null) {
  if (!a || !b) return a === b;
  return [...TEXT_KEYS, ...FLAG_KEYS].every((key) => (a[key] ?? "") === (b[key] ?? ""));
}

export function NotificationTemplates() {
  const [rows, setRows] = useState<ListRow[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "failed">("loading");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [lang, setLang] = useState<Lang>("bn");
  const [previewMode, setPreviewMode] = useState<"push" | "email">("push");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "failed">("idle");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [testUser, setTestUser] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState("");
  const users = useUserOptions();
  const lastFocus = useRef<{ key: string; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  const dirty = !sameDraft(saved, draft);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/notifications/templates?surface=admin", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok || !Array.isArray(j.data)) throw new Error();
      setRows(j.data.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        event_key: String(row.event_key ?? ""),
        name: String(row.name ?? row.event_key ?? ""),
        category: String(row.category ?? "") || "Other",
        channels: String(row.channels ?? ""),
        status: String(row.status ?? "Active")
      })));
      setListState("ready");
    } catch {
      setListState("failed");
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  async function open(id: string) {
    if (id === selectedId) return;
    if (dirty && !window.confirm("Discard unsaved changes to this template?")) return;
    setSelectedId(id);
    setLoadingRecord(true);
    setMessage(null);
    setTestResult(null);
    setTestError("");
    setPreview(null);
    try {
      const r = await fetch(`/api/v1/notifications/templates?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message ?? "Could not load the template.");
      const row = (j.data?.row ?? j.data ?? {}) as Record<string, unknown>;
      const next = toDraft(row);
      setSaved(next);
      setDraft(next);
    } catch (error) {
      setSaved(null);
      setDraft(null);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not load the template." });
    } finally {
      setLoadingRecord(false);
    }
  }

  // Open the first template so the screen never starts as an empty editor.
  useEffect(() => {
    if (listState === "ready" && !selectedId && rows.length) void open(rows[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listState, rows]);

  // Debounced so typing does not fire a render request per keystroke; the
  // abort drops a slow earlier answer that would overwrite a newer one.
  useEffect(() => {
    if (!draft) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewState("loading");
      try {
        const r = await fetch("/api/v1/admin/notifications/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template: draft, lang }),
          signal: controller.signal
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error();
        setPreview(j.result as PreviewResult);
        setPreviewState("idle");
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") setPreviewState("failed");
      }
    }, 450);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [draft, lang]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = rows.filter((row) => !q || `${row.name} ${row.event_key} ${row.category}`.toLowerCase().includes(q));
    const map = new Map<string, ListRow[]>();
    for (const row of hits) map.set(row.category, [...(map.get(row.category) ?? []), row]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows, query]);

  const placeholders = useMemo(() => {
    if (!draft) return [];
    const found = new Set<string>();
    for (const key of TEXT_KEYS) for (const match of (draft[key] ?? "").matchAll(PLACEHOLDER)) found.add(match[1]);
    return [...found].sort();
  }, [draft]);

  function set(key: string, value: string) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  // Drops {{token}} at the caret of whichever field was last focused, so the
  // admin never has to retype a placeholder name from memory.
  function insertToken(token: string) {
    const target = lastFocus.current;
    if (!target || !draft) return;
    const { key, el } = target;
    const value = draft[key] ?? "";
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const text = `{{${token}}}`;
    set(key, value.slice(0, start) + text + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }

  async function save() {
    if (!draft || !selectedId) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, string> = {};
      for (const key of [...TEXT_KEYS, ...FLAG_KEYS]) payload[key] = draft[key] ?? "";
      const r = await fetch(`/api/v1/notifications/templates?id=${encodeURIComponent(selectedId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message ?? "Save failed.");
      setSaved(draft);
      setMessage({ tone: "ok", text: "Template saved. New notifications for this event use it right away." });
      void loadList();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Save failed." });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!draft || !testUser) return;
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      const r = await fetch("/api/v1/admin/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_key: draft.event_key, user_id: testUser })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message ?? "The test could not be sent.");
      setTestResult(j.result as TestResult);
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "The test could not be sent.");
    } finally {
      setTesting(false);
    }
  }

  function textField(base: string, label: string, opts: { multiline?: boolean; limit?: number; hint?: string } = {}) {
    if (!draft) return null;
    const key = `${base}_${lang}`;
    const common = {
      id: `tpl-${key}`,
      className: "input",
      value: draft[key] ?? "",
      lang,
      onFocus: (event: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => { lastFocus.current = { key, el: event.currentTarget }; },
      onChange: (event: { target: { value: string } }) => set(key, event.target.value)
    };
    return (
      <div className={`ntf-field${opts.multiline ? " wide" : ""}`}>
        <label htmlFor={common.id}>
          <span>{label}</span>
          {opts.limit ? <CharCount value={draft[key] ?? ""} limit={opts.limit} /> : null}
        </label>
        {opts.multiline ? <textarea {...common} rows={base === "email_body" ? 8 : 3} /> : <input {...common} type="text" />}
        {opts.hint ? <small>{opts.hint}</small> : null}
      </div>
    );
  }

  function toggle(key: (typeof FLAG_KEYS)[number], label: string, icon: React.ReactNode) {
    if (!draft) return null;
    const on = draft[key] === "1";
    return (
      <button type="button" role="switch" aria-checked={on} className={`ntf-toggle${on ? " on" : ""}`} onClick={() => set(key, on ? "0" : "1")}>
        {icon} {label}
        <span className="ntf-switch" aria-hidden="true"><span /></span>
      </button>
    );
  }

  const pushOn = draft?.send_push === "1";
  const inappOn = draft?.send_inapp === "1";
  const emailOn = draft?.send_email === "1";

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Engagement</p>
          <h1 className="page-title">Notification templates</h1>
          <p className="subtitle">The words sent for each app event — an order confirmed, a listing approved, a loan decided — in Bangla and English, per channel.</p>
        </div>
      </section>

      <NotificationStatusBanner />

      <div className="ntf-layout">
        <aside className="panel ntf-list">
          <div className="ntf-list-search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates…" aria-label="Search templates" />
          </div>
          <div className="ntf-list-body">
            {listState === "loading" ? <p className="ntf-empty"><Loader2 size={14} className="spin" /> Loading…</p> : null}
            {listState === "failed" ? <p className="ntf-empty">Could not load templates.</p> : null}
            {listState === "ready" && grouped.length === 0 ? <p className="ntf-empty">{query ? `No template matches “${query}”.` : "No templates yet."}</p> : null}
            {grouped.map(([category, items]) => (
              <div key={category} className="ntf-group">
                <h3>{category}</h3>
                {items.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`ntf-item${row.id === selectedId ? " active" : ""}${row.status.toLowerCase() === "inactive" ? " off" : ""}`}
                    onClick={() => void open(row.id)}
                  >
                    <span className="ntf-item-name">{row.name}{row.id === selectedId && dirty ? <i className="ntf-dirty" title="Unsaved changes" /> : null}</span>
                    <span className="ntf-item-sub">{row.channels || "No channels"}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <section className="panel ntf-editor">
          {!draft ? (
            <div className="ntf-editor-empty">
              {loadingRecord ? <><Loader2 size={16} className="spin" /> Loading template…</> : message?.tone === "error" ? message.text : "Pick a template on the left."}
            </div>
          ) : (
            <>
              <div className="panel-header">
                <div>
                  <h2>{draft.name || draft.event_key}</h2>
                  <p>Event <code>{draft.event_key}</code></p>
                </div>
                <Status label={draft.is_active === "1" ? "Active" : "Inactive"} />
              </div>

              {message ? <div className={`notice ntf-notice is-${message.tone}`}>{message.text}</div> : null}

              <div className="ntf-editor-grid">
                <div className="ntf-form">
                  <div className="ntf-row">
                    <div className="ntf-field">
                      <label htmlFor="tpl-name"><span>Name</span></label>
                      <input id="tpl-name" className="input" value={draft.name} onChange={(e) => set("name", e.target.value)} />
                    </div>
                    <div className="ntf-field">
                      <label htmlFor="tpl-category"><span>Category</span></label>
                      <input id="tpl-category" className="input" value={draft.category} onChange={(e) => set("category", e.target.value)} />
                    </div>
                  </div>

                  <div className="ntf-toggles">
                    {toggle("send_push", "Push", <Smartphone size={14} />)}
                    {toggle("send_inapp", "In-app", <BellRing size={14} />)}
                    {toggle("send_email", "Email", <Mail size={14} />)}
                    {toggle("is_active", "Template active", <CheckCircle2 size={14} />)}
                  </div>

                  <div className="seg ntf-lang" role="radiogroup" aria-label="Language">
                    {(["bn", "en"] as const).map((l) => (
                      <button key={l} type="button" role="radio" aria-checked={lang === l} onClick={() => setLang(l)}>
                        {l === "bn" ? "বাংলা" : "English"}
                      </button>
                    ))}
                  </div>

                  <fieldset className="ntf-fieldset">
                    <legend>Push &amp; in-app</legend>
                    {textField("title", "Title", { limit: PUSH_TITLE_LIMIT })}
                    {textField("body", "Message", { multiline: true, limit: PUSH_BODY_LIMIT })}
                    {textField("cta_label", "Button label", { hint: "Shown on the in-app card, e.g. “View order”." })}
                  </fieldset>

                  <fieldset className="ntf-fieldset">
                    <legend>Email</legend>
                    {textField("email_subject", "Subject")}
                    {textField("email_body", "Body", { multiline: true, hint: "Plain text. A blank line starts a new paragraph, **bold** for emphasis, {{placeholders}} for the person's details." })}
                  </fieldset>

                  {placeholders.length ? (
                    <div className="ntf-tokens">
                      <span>Placeholders — click to insert at the cursor:</span>
                      {placeholders.map((token) => (
                        <button key={token} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertToken(token)}>{`{{${token}}}`}</button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="ntf-preview">
                  <div className="ntf-preview-head">
                    <div className="seg" role="radiogroup" aria-label="Preview">
                      <button type="button" role="radio" aria-checked={previewMode === "push"} onClick={() => setPreviewMode("push")}><Smartphone size={13} /> Push &amp; in-app</button>
                      <button type="button" role="radio" aria-checked={previewMode === "email"} onClick={() => setPreviewMode("email")}><Mail size={13} /> Email</button>
                    </div>
                    <span className="ntf-preview-state">
                      {previewState === "loading" ? <><Loader2 size={12} className="spin" /> Rendering</> : previewState === "failed" ? <><AlertTriangle size={12} /> Preview unavailable</> : "Sample values"}
                    </span>
                  </div>

                  {previewMode === "push" ? (
                    <>
                      {!pushOn && !inappOn ? <p className="ntf-off-note">Push and in-app are both off for this event.</p> : null}
                      <PhonePreview
                        lang={lang}
                        title={preview?.title ?? draft[`title_${lang}`] ?? ""}
                        body={preview?.body ?? draft[`body_${lang}`] ?? ""}
                        cta={draft[`cta_label_${lang}`]}
                        showPush={pushOn}
                        showInApp={inappOn}
                      />
                    </>
                  ) : (
                    <div className="ntf-email">
                      {!emailOn ? <p className="ntf-off-note">Email is off for this event — shown for reference.</p> : null}
                      <div className="ntf-email-subject"><span>Subject</span> {preview?.subject || draft[`email_subject_${lang}`] || "—"}</div>
                      {preview?.html ? (
                        // Sandboxed with no permissions: the rendered email is
                        // shown, never allowed to run anything in the console.
                        <iframe className="ntf-email-frame" title="Email preview" sandbox="" srcDoc={preview.html} />
                      ) : (
                        <div className="ntf-email-frame ntf-email-wait">{previewState === "failed" ? "The email preview could not be rendered." : "Rendering…"}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="ntf-footer">
                <div className="ntf-test">
                  <span className="ntf-test-label">Send test to</span>
                  <div className="ntf-test-pick">
                    <Select
                      options={users.options}
                      value={testUser}
                      onChange={setTestUser}
                      searchable
                      placeholder={users.state === "loading" ? "Loading users…" : users.state === "failed" ? "Users did not load" : "Pick a user…"}
                      aria-label="Test recipient"
                    />
                  </div>
                  <button type="button" className="btn ghost" disabled={!testUser || testing} onClick={() => void sendTest()}>
                    {testing ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Send test
                  </button>
                  {dirty ? <small className="ntf-test-note">Tests use the saved version — save first to test your edits.</small> : null}
                </div>
                <div className="ntf-save">
                  <button type="button" className="btn ghost" disabled={!dirty || saving} onClick={() => setDraft(saved)}><RotateCcw size={15} /> Revert</button>
                  <button type="button" className="btn primary" disabled={!dirty || saving} onClick={() => void save()}>
                    {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Save template
                  </button>
                </div>
              </div>

              {testError ? <div className="notice ntf-notice is-error">{testError}</div> : null}
              {testResult ? (
                <div className="ntf-test-result">
                  <span className={testResult.inapp ? "ok" : "muted"}><BellRing size={13} /> In-app {testResult.inapp ? "delivered" : "not created"}</span>
                  <span className={testResult.push.sent ? "ok" : testResult.push.failed ? "bad" : "muted"}>
                    <Smartphone size={13} /> Push: {testResult.push.sent} sent · {testResult.push.skipped} skipped · {testResult.push.failed} failed
                  </span>
                  <span className={testResult.email === "sent" ? "ok" : testResult.email === "failed" ? "bad" : "muted"}><Mail size={13} /> {EMAIL_RESULT[testResult.email] ?? testResult.email}</span>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
