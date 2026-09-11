"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BellRing, CheckCircle2, Loader2, Mail, Megaphone, RotateCcw, Send, Smartphone, UsersRound } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { MultiSelect } from "@/components/MultiSelect";
import { NotificationStatusBanner, useNotificationStatus } from "@/components/NotificationStatusBanner";
import { CharCount, PhonePreview, PUSH_BODY_LIMIT, PUSH_TITLE_LIMIT, ROLE_OPTIONS, useUserOptions } from "@/components/NotificationPreview";

type Target = "all" | "roles" | "users";
type Audience = { count: number; with_push: number; with_email: number };
type SendResult = { broadcast_id: string | number; recipients: number; push_sent: number; push_skipped: number; emails_queued: number };

const BLANK = { title_en: "", title_bn: "", body_en: "", body_bn: "" };
const TARGETS: Array<{ value: Target; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "roles", label: "By group" },
  { value: "users", label: "Specific users" }
];

export function BroadcastComposer() {
  const status = useNotificationStatus();
  const users = useUserOptions();
  const [text, setText] = useState(BLANK);
  const [target, setTarget] = useState<Target>("all");
  const [roles, setRoles] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [channels, setChannels] = useState({ send_push: true, send_inapp: true, send_email: false });
  const [audience, setAudience] = useState<Audience | null>(null);
  const [audienceState, setAudienceState] = useState<"idle" | "loading" | "failed">("idle");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);

  const noOneChosen = (target === "roles" && roles.length === 0) || (target === "users" && userIds.length === 0);

  // Debounced: picking five users in a row should ask for one count, not five.
  useEffect(() => {
    if (noOneChosen) {
      setAudience({ count: 0, with_push: 0, with_email: 0 });
      setAudienceState("idle");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setAudienceState("loading");
      try {
        const params = new URLSearchParams({ target });
        if (target === "roles") params.set("roles", roles.join(","));
        if (target === "users") params.set("user_ids", userIds.join(","));
        const r = await fetch(`/api/v1/admin/notifications/audience?${params}`, { cache: "no-store", signal: controller.signal });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error();
        setAudience(j.data as Audience);
        setAudienceState("idle");
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") setAudienceState("failed");
      }
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [target, roles, userIds, noOneChosen]);

  const enDone = Boolean(text.title_en.trim() && text.body_en.trim());
  const bnDone = Boolean(text.title_bn.trim() && text.body_bn.trim());
  const anyChannel = channels.send_push || channels.send_inapp || channels.send_email;
  const channelNames = [channels.send_push && "push", channels.send_inapp && "in-app", channels.send_email && "email"].filter(Boolean).join(", ");

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!enDone && !bnDone) out.push("Write a title and message in at least one language.");
    if (!anyChannel) out.push("Pick at least one channel.");
    if (noOneChosen) out.push(target === "roles" ? "Pick at least one group." : "Pick at least one user.");
    else if (audience && audience.count === 0) out.push("This audience has no one in it.");
    return out;
  }, [enDone, bnDone, anyChannel, noOneChosen, target, audience]);

  function setField(key: keyof typeof BLANK, value: string) {
    setText((current) => ({ ...current, [key]: value }));
  }

  async function send() {
    if (blockers.length) return;
    const who = audience ? `${audience.count.toLocaleString()} ${audience.count === 1 ? "person" : "people"}` : "this audience";
    const title = text.title_bn.trim() || text.title_en.trim();
    if (!window.confirm(`Send “${title}” to ${who} by ${channelNames}?\n\nThis cannot be recalled once sent.`)) return;
    setSending(true);
    setError("");
    try {
      const r = await fetch("/api/v1/admin/notifications/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...text,
          target,
          roles: target === "roles" ? roles : [],
          user_ids: target === "users" ? userIds : [],
          ...channels
        })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.message ?? "The notification could not be sent.");
      setResult(j.result as SendResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The notification could not be sent.");
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setText(BLANK);
    setTarget("all");
    setRoles([]);
    setUserIds([]);
    setResult(null);
    setError("");
  }

  const emailProviderMissing = status && status.email_provider === "none";

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Engagement</p>
          <h1 className="page-title">Send notification</h1>
          <p className="subtitle">A one-off message to everyone, a group, or chosen people — by push, the in-app inbox and email. Each person gets it in their app language.</p>
        </div>
      </section>

      <NotificationStatusBanner status={status} />

      {result ? (
        <section className="panel bc-result">
          <div className="bc-result-head">
            <CheckCircle2 size={22} />
            <div>
              <h2>Sent to {result.recipients.toLocaleString()} {result.recipients === 1 ? "person" : "people"}</h2>
              <p>Broadcast #{String(result.broadcast_id)}</p>
            </div>
          </div>
          <div className="bc-result-stats">
            <div><strong>{result.recipients.toLocaleString()}</strong><span>In-app recipients</span></div>
            <div><strong>{result.push_sent.toLocaleString()}</strong><span>Push sent</span></div>
            <div><strong>{result.push_skipped.toLocaleString()}</strong><span>Push skipped (no phone registered)</span></div>
            <div><strong>{result.emails_queued.toLocaleString()}</strong><span>Emails queued</span></div>
          </div>
          <div className="bc-result-actions">
            <Link className="btn ghost" href="/notifications/broadcasts">Broadcast history</Link>
            <Link className="btn ghost" href="/notifications/log">Delivery log</Link>
            <button type="button" className="btn primary" onClick={reset}><Megaphone size={15} /> Send another</button>
          </div>
        </section>
      ) : (
        <div className="bc-layout">
          <div className="bc-form">
            <section className="panel">
              <div className="panel-header"><div><h2>Message</h2><p>Write both languages; phones cut long titles and messages off at the counters.</p></div></div>
              <div className="bc-langs">
                {(["bn", "en"] as const).map((lang) => (
                  <div key={lang} className="bc-lang" lang={lang}>
                    <h3>{lang === "bn" ? "বাংলা" : "English"} {(lang === "bn" ? bnDone : enDone) ? <CheckCircle2 size={14} className="txt-ok" /> : null}</h3>
                    <div className="ntf-field">
                      <label htmlFor={`bc-title-${lang}`}><span>Title</span><CharCount value={text[`title_${lang}`]} limit={PUSH_TITLE_LIMIT} /></label>
                      <input id={`bc-title-${lang}`} className="input" value={text[`title_${lang}`]} onChange={(e) => setField(`title_${lang}`, e.target.value)} />
                    </div>
                    <div className="ntf-field">
                      <label htmlFor={`bc-body-${lang}`}><span>Message</span><CharCount value={text[`body_${lang}`]} limit={PUSH_BODY_LIMIT} /></label>
                      <textarea id={`bc-body-${lang}`} className="input" rows={4} value={text[`body_${lang}`]} onChange={(e) => setField(`body_${lang}`, e.target.value)} />
                    </div>
                  </div>
                ))}
              </div>
              {enDone !== bnDone ? (
                <p className="bc-hint"><AlertTriangle size={13} /> {enDone ? "Bangla" : "English"} is empty — people using the app in {enDone ? "Bangla" : "English"} will get the {enDone ? "English" : "Bangla"} text.</p>
              ) : null}
            </section>

            <section className="panel">
              <div className="panel-header"><div><h2>Audience</h2><p>Who receives it.</p></div></div>
              <div className="bc-section">
                <div className="seg" role="radiogroup" aria-label="Audience">
                  {TARGETS.map((t) => (
                    <button key={t.value} type="button" role="radio" aria-checked={target === t.value} onClick={() => setTarget(t.value)}>{t.label}</button>
                  ))}
                </div>
                {target === "roles" ? (
                  <MultiSelect options={ROLE_OPTIONS} value={roles} onChange={setRoles} placeholder="Pick groups…" />
                ) : null}
                {target === "users" ? (
                  <MultiSelect
                    options={users.options}
                    value={userIds}
                    onChange={setUserIds}
                    placeholder={users.state === "loading" ? "Loading users…" : users.state === "failed" ? "Users did not load" : "Search by name or phone…"}
                  />
                ) : null}
                <div className="bc-audience">
                  <UsersRound size={16} />
                  {audienceState === "loading" ? (
                    <span><Loader2 size={13} className="spin" /> Counting…</span>
                  ) : audienceState === "failed" ? (
                    <span className="txt-warn">Could not count this audience.</span>
                  ) : audience ? (
                    <span>
                      <strong>{audience.count.toLocaleString()}</strong> {audience.count === 1 ? "person" : "people"}
                      <em> · {audience.with_push.toLocaleString()} with a phone for push · {audience.with_email.toLocaleString()} with email</em>
                    </span>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header"><div><h2>Channels</h2><p>In-app always lands; push and email depend on what each person has.</p></div></div>
              <div className="bc-channels">
                <label className={`bc-channel${channels.send_push ? " on" : ""}`}>
                  <input type="checkbox" checked={channels.send_push} onChange={(e) => setChannels({ ...channels, send_push: e.target.checked })} />
                  <Smartphone size={16} />
                  <span><strong>Push</strong><small>{audience ? `${audience.with_push.toLocaleString()} of ${audience.count.toLocaleString()} have a registered phone` : "Phones with the app"}</small></span>
                </label>
                <label className={`bc-channel${channels.send_inapp ? " on" : ""}`}>
                  <input type="checkbox" checked={channels.send_inapp} onChange={(e) => setChannels({ ...channels, send_inapp: e.target.checked })} />
                  <BellRing size={16} />
                  <span><strong>In-app inbox</strong><small>Everyone in the audience</small></span>
                </label>
                <label className={`bc-channel${channels.send_email ? " on" : ""}`}>
                  <input type="checkbox" checked={channels.send_email} onChange={(e) => setChannels({ ...channels, send_email: e.target.checked })} />
                  <Mail size={16} />
                  <span>
                    <strong>Email</strong>
                    <small>
                      {audience ? `${audience.with_email.toLocaleString()} have an email address` : "People with an email address"}
                      {emailProviderMissing ? " · queued until an email provider is configured" : ""}
                    </small>
                  </span>
                </label>
              </div>
            </section>
          </div>

          <aside className="panel bc-side">
            <div className="panel-header"><div><h2>Preview</h2><p>Lock screen and in-app inbox.</p></div></div>
            <div className="bc-phones">
              <PhonePreview lang="bn" caption="বাংলা" title={text.title_bn || text.title_en} body={text.body_bn || text.body_en} showPush={channels.send_push} showInApp={channels.send_inapp} />
              <PhonePreview lang="en" caption="English" title={text.title_en || text.title_bn} body={text.body_en || text.body_bn} showPush={channels.send_push} showInApp={channels.send_inapp} />
            </div>
            <div className="bc-send">
              {blockers.length ? (
                <ul className="bc-blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
              ) : (
                <p className="bc-ready">
                  Ready: {audience ? `${audience.count.toLocaleString()} ${audience.count === 1 ? "person" : "people"}` : "audience"} by {channelNames}.
                </p>
              )}
              {error ? <div className="notice ntf-notice is-error">{error}</div> : null}
              <div className="bc-send-actions">
                <button type="button" className="btn ghost" onClick={reset} disabled={sending}><RotateCcw size={15} /> Clear</button>
                <button type="button" className="btn primary" disabled={sending || blockers.length > 0 || audienceState === "loading"} onClick={() => void send()}>
                  {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Send notification
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </AdminShell>
  );
}
