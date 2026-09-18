"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Camera, Flag, Image as ImageIcon, Keyboard, MessageSquareText, Mic, Phone,
  Search, ThumbsDown, Wrench, X
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import {
  Empty, Failed, Loading, MetricBand, Tabs, ago, clock, n, num, post, s, useApi, when,
  type Row
} from "@/components/apa/shared";
import "@/components/apa/apa-console.css";

/**
 * What farmers are actually asking.
 *
 * The first question anyone has a week after launch, and the one the old
 * assistant could not answer at all — it ran on the phone and left no trace.
 * The list is the index; the panel beside it is the conversation read the way
 * it happened, because a table of truncated questions tells you nothing about
 * whether the answer was any good.
 */

type Feed = {
  metrics: {
    questions: number; farmers: number; refused: number; grounded_pct: number;
    avg_latency_ms: number; voice: number; photo: number;
  };
  rows: Row[];
};

type Detail = { conversation: Row; messages: Row[]; tool_calls: Row[] };

type Filter = "all" | "refused" | "downvoted" | "live" | "flagged";

const MODE_ICON: Record<string, typeof Mic> = {
  voice: Mic,
  photo: Camera,
  text: Keyboard,
  live: Phone
};

export function ApaConversations() {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  // The Feedback page links here with a conversation id. Read from the URL
  // rather than useSearchParams so the page needs no Suspense boundary for
  // what is a single optional deep link.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("conversation");
    if (id) setOpenId(id);
  }, []);

  // Debounced so typing a phone number does not fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const feed = useApi<Feed>(
    `/api/v1/admin/apa/conversations?filter=${filter}&q=${encodeURIComponent(query)}`
  );

  return (
    <AdminShell>
      <section className="page-head">
        <div>
          <p className="eyeline">Shathi Apa</p>
          <h1 className="page-title">Conversations</h1>
          <p className="page-sub">
            Every question asked in the last 30 days, what was answered, and what the answer was grounded on.
          </p>
        </div>
      </section>

      {feed.data ? (
        <MetricBand
          metrics={[
            { label: "Questions asked", value: num(feed.data.metrics.questions), note: `${num(feed.data.metrics.farmers)} farmers` },
            { label: "Voice messages", value: num(feed.data.metrics.voice), note: `${num(feed.data.metrics.photo)} photos`, tone: "tone-sky" },
            { label: "Grounded in our data", value: `${feed.data.metrics.grounded_pct}%`, note: "answers citing a source", tone: "tone-leaf" },
            { label: "Refused", value: num(feed.data.metrics.refused), note: "out of scope", tone: "tone-gold" },
            { label: "Median answer time", value: `${(feed.data.metrics.avg_latency_ms / 1000).toFixed(1)}s`, note: "last 7 days", tone: "tone-plum" }
          ]}
        />
      ) : null}

      <div className="apa-split">
        <section className="panel">
          <div className="apa-toolbar">
            <Tabs<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "refused", label: "Refused" },
                { value: "downvoted", label: "Marked unhelpful" },
                { value: "live", label: "Live calls" },
                { value: "flagged", label: "Flagged" }
              ]}
            />
            <div className="search-box">
              <Search size={16} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Question, name or phone…"
                aria-label="Search conversations"
              />
              {q ? <button type="button" onClick={() => setQ("")} aria-label="Clear"><X size={14} /></button> : null}
            </div>
          </div>

          {feed.loading ? <Loading /> : null}
          {feed.error ? <Failed message={feed.error} onRetry={feed.reload} /> : null}
          {feed.data && !feed.data.rows.length && !feed.loading ? (
            <Empty
              title="No conversations yet"
              detail={query ? "Nothing matches that search." : "Answers appear here as farmers start asking."}
            />
          ) : null}

          {feed.data?.rows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Farmer</th>
                    <th>Turns</th>
                    <th>Grounded on</th>
                    <th>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {feed.data.rows.map((row) => {
                    const id = s(row.id);
                    const tools = s(row.tools).split(",").filter(Boolean);
                    return (
                      <tr
                        key={id}
                        onClick={() => setOpenId(id)}
                        className={openId === id ? "is-open" : undefined}
                        style={{ cursor: "pointer" }}
                      >
                        <td>
                          <div className="apa-row-q">
                            <strong>{s(row.title) || (s(row.path) === "live" ? "Live conversation" : "(a photo)")}</strong>
                            <span>
                              {s(row.path) === "live" ? "Live call · " : ""}
                              {n(row.refused_count) > 0 ? `${n(row.refused_count)} refused · ` : ""}
                              {n(row.downvotes) > 0 ? `${n(row.downvotes)} unhelpful · ` : ""}
                              {s(row.district) || "no area"}
                            </span>
                          </div>
                        </td>
                        <td>
                          {s(row.full_name) || "—"}
                          <br />
                          <small className="muted">{s(row.phone)}</small>
                        </td>
                        <td>{num(row.turn_count)}</td>
                        <td>
                          {tools.length ? (
                            <span className="apa-turn-foot">
                              {tools.slice(0, 3).map((t) => (
                                <span className="apa-suggest" key={t}>{t.replace(/_/g, " ")}</span>
                              ))}
                              {tools.length > 3 ? <span className="apa-suggest">+{tools.length - 3}</span> : null}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{ago(row.last_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <ConversationPanel id={openId} onClose={() => setOpenId(null)} onFlagged={feed.reload} />
      </div>
    </AdminShell>
  );
}

/* ---------------------------------------------------------------------------
   One conversation, read as a transcript
   --------------------------------------------------------------------------- */

function ConversationPanel({
  id,
  onClose,
  onFlagged
}: {
  id: string | null;
  onClose: () => void;
  onFlagged: () => void;
}) {
  const detail = useApi<Detail>(id ? `/api/v1/admin/apa/conversations?id=${id}` : "");
  const [busy, setBusy] = useState(false);

  if (!id) {
    return (
      <aside className="panel">
        <Empty title="Pick a conversation" detail="The full exchange opens here, with the tools each answer used." />
      </aside>
    );
  }
  if (detail.loading) return <aside className="panel"><Loading /></aside>;
  if (detail.error) return <aside className="panel"><Failed message={detail.error} onRetry={detail.reload} /></aside>;
  if (!detail.data) return null;

  const c = detail.data.conversation;
  const flagged = n(c.flagged) === 1;

  async function flag() {
    setBusy(true);
    try {
      await post("/api/v1/admin/apa/conversation/flag", { id, flagged: !flagged });
      detail.reload();
      onFlagged();
    } catch {
      /* the button reverts on the next read */
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="panel">
      <div className="panel-header">
        <div>
          <h2>{s(c.full_name) || "Farmer"}</h2>
          <p>
            {s(c.district) || "no district"}
            {s(c.upazila) ? ` · ${s(c.upazila)}` : ""} · {when(c.started_at)}
          </p>
        </div>
        <div className="panel-actions">
          <Link className="btn sm ghost" href={`/manage/view?resource=users&id=${s(c.user_id)}`}>
            Open farmer
          </Link>
          <button type="button" className={`btn sm${flagged ? " danger" : ""}`} onClick={() => void flag()} disabled={busy}>
            <Flag size={14} /> {flagged ? "Unflag" : "Flag"}
          </button>
          <button type="button" className="btn sm ghost" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="apa-thread">
        {detail.data.messages.map((m) => {
          const isUser = s(m.role) === "user";
          const Icon = MODE_ICON[s(m.input_mode)] ?? MessageSquareText;
          const sources = (m.sources ?? []) as Array<{ label_bn?: string }>;
          const suggestions = (m.suggestions ?? []) as string[];
          const tools = (m.tools ?? []) as string[];
          return (
            <article
              key={s(m.id)}
              className={`apa-turn${isUser ? " is-user" : ""}${n(m.refused) === 1 ? " is-refused" : ""}`}
            >
              <header className="apa-turn-head">
                <Icon size={12} />
                {isUser ? "Farmer" : "Shathi Apa"}
                {n(m.audio_seconds) > 0 ? <span>· {clock(m.audio_seconds)}</span> : null}
                {s(m.verdict) && s(m.verdict) !== "in_scope" ? <Status label={s(m.verdict)} /> : null}
                {n(m.hedged) === 1 ? <span>· hedged</span> : null}
                {n(m.latency_ms) > 0 ? <span>· {(n(m.latency_ms) / 1000).toFixed(1)}s</span> : null}
                {s(m.vote) === "down" ? <ThumbsDown size={12} /> : null}
              </header>

              {s(m.image_url) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="apa-turn-photo" src={s(m.image_url)} alt="" />
              ) : null}

              {s(m.transcript) && isUser ? <p className="apa-turn-body">{s(m.transcript)}</p> : null}
              {s(m.body) && !(isUser && s(m.transcript)) ? <p className="apa-turn-body">{s(m.body)}</p> : null}
              {!s(m.body) && !s(m.transcript) && isUser ? (
                <p className="apa-turn-body muted">(voice message — nothing was transcribed)</p>
              ) : null}

              {s(m.advice) ? <p className="apa-turn-advice">{s(m.advice)}</p> : null}

              {sources.length || suggestions.length || tools.length ? (
                <footer className="apa-turn-foot">
                  {sources.map((src, i) => (
                    <span className="apa-source" key={`s${i}`}>{src.label_bn}</span>
                  ))}
                  {tools.map((t) => (
                    <span className="apa-suggest" key={`t${t}`}><Wrench size={10} /> {t.replace(/_/g, " ")}</span>
                  ))}
                  {suggestions.map((sug, i) => (
                    <span className="apa-suggest" key={`g${i}`}>{sug}</span>
                  ))}
                </footer>
              ) : null}
            </article>
          );
        })}
      </div>

      {detail.data.tool_calls.some((t) => n(t.ok) === 0) ? (
        <div className="panel-body">
          <p className="apa-locked-note">
            <ImageIcon size={15} />
            A lookup failed during this conversation, so at least one answer was general rather than
            grounded. The Usage page lists which tool and how often.
          </p>
        </div>
      ) : null}
    </aside>
  );
}
