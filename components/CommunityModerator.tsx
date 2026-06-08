"use client";

import { useCallback, useEffect, useState } from "react";
import { EyeOff, Eye, RefreshCw, Sparkles, Star, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";

type Post = {
  id: string;
  author: string;
  user_id: string;
  post_type: string;
  scope: string;
  body: string;
  image_url?: string | null;
  is_official: number;
  like_count: number;
  comment_count: number;
  report_count: number;
  status: string;
  ai_flag?: string | null;
  ai_reason?: string | null;
  ai_checked_at?: string | null;
  district?: string | null;
  upazila?: string | null;
  created_at: string;
};

type Filter = "all" | "flagged" | "official" | "hidden";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "flagged", label: "Flagged" },
  { key: "official", label: "Official" },
  { key: "hidden", label: "Hidden" }
];

function aiClass(flag?: string | null) {
  if (flag === "remove") return "ai-chip remove";
  if (flag === "review") return "ai-chip review";
  if (flag === "safe") return "ai-chip safe";
  return "ai-chip none";
}

function fmt(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function CommunityModerator() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string>("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/app/community/moderation?filter=${f}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "Could not load posts.");
      setPosts(json.data ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load posts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function moderate(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setMessage("");
    try {
      const res = await fetch("/api/v1/app/community/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "Update failed.");
      await load(filter);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setBusyId("");
    }
  }

  async function aiFlag(id: string) {
    setBusyId(id);
    setMessage("");
    try {
      const res = await fetch("/api/v1/app/community/ai-flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "AI check failed.");
      setMessage(`AI: post #${id} → ${json.result.flag} (${json.result.reason})`);
      await load(filter);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI check failed.");
    } finally {
      setBusyId("");
    }
  }

  async function aiScan() {
    setScanning(true);
    setMessage("Running Gemini moderation on unscanned posts…");
    try {
      const res = await fetch("/api/v1/app/community/ai-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 25 })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "AI scan failed.");
      const c = json.result.counts;
      setMessage(`Scanned ${json.result.scanned} posts — safe ${c.safe}, review ${c.review}, remove ${c.remove}.`);
      await load(filter);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI scan failed.");
    } finally {
      setScanning(false);
    }
  }

  const flaggedCount = posts.filter((p) => p.ai_flag === "remove" || p.ai_flag === "review" || p.report_count > 0).length;

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Community</p>
          <h1 className="page-title">Posts &amp; Moderation</h1>
          <p className="subtitle">Manage community posts, highlight official Shathi Sheba posts, hide or remove content, and run Gemini AI moderation to auto-flag unsafe posts.</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={() => void load(filter)} type="button"><RefreshCw size={18} /> Refresh</button>
          <button className="btn primary" onClick={() => void aiScan()} disabled={scanning} type="button">
            <Sparkles size={18} /> {scanning ? "Scanning…" : "AI Scan"}
          </button>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
        <div className="panel" style={{ padding: 16 }}>
          <p className="subtitle" style={{ margin: 0 }}>Total posts</p>
          <h2 style={{ margin: "6px 0 0", fontSize: 28 }}>{posts.length}</h2>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <p className="subtitle" style={{ margin: 0 }}>Needs attention</p>
          <h2 style={{ margin: "6px 0 0", fontSize: 28, color: "#b33737" }}>{flaggedCount}</h2>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <p className="subtitle" style={{ margin: 0 }}>Official</p>
          <h2 style={{ margin: "6px 0 0", fontSize: 28, color: "#9b6610" }}>{posts.filter((p) => p.is_official).length}</h2>
        </div>
      </section>

      <div className="filter-tabs">
        {FILTERS.map((f) => (
          <button className={`filter-tab${filter === f.key ? " active" : ""}`} key={f.key} onClick={() => setFilter(f.key)} type="button">
            {f.label}
          </button>
        ))}
      </div>

      {message ? <div className="notice">{message}</div> : null}

      <section className="panel" style={{ marginTop: 12 }}>
        <div className="panel-header">
          <div><h2>Community Posts</h2><p>{loading ? "Loading…" : `${posts.length} posts in “${filter}”.`}</p></div>
          <Status label={loading ? "Loading" : `${posts.length}`} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Author</th><th>Post</th><th>Scope</th><th>AI</th><th>Reports</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.author}</strong>
                    {p.is_official ? <span className="tag" style={{ marginLeft: 6 }}><Star size={11} /> Official</span> : null}
                    <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 2 }}>{fmt(p.created_at)}</div>
                  </td>
                  <td style={{ maxWidth: 320 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flex: "none" }} />
                      ) : null}
                      <span style={{ display: "block" }}>{p.body || <em style={{ color: "#9ca3af" }}>(no text)</em>}</span>
                    </div>
                  </td>
                  <td>{p.scope}<div style={{ color: "#9ca3af", fontSize: 11 }}>{p.post_type}</div></td>
                  <td>
                    <span className={aiClass(p.ai_flag)} title={p.ai_reason ?? ""}>{p.ai_flag ?? "—"}</span>
                  </td>
                  <td>{p.report_count > 0 ? <strong style={{ color: "#b33737" }}>{p.report_count}</strong> : "0"}</td>
                  <td><Status label={p.status} /></td>
                  <td>
                    <div className="row-actions">
                      <button onClick={() => void aiFlag(p.id)} disabled={busyId === p.id} title="AI moderate this post" type="button"><Sparkles size={15} /></button>
                      <button onClick={() => void moderate(p.id, { is_official: p.is_official ? 0 : 1 })} disabled={busyId === p.id} title={p.is_official ? "Unset official" : "Mark official"} type="button"><Star size={15} /></button>
                      {p.status === "visible" ? (
                        <button onClick={() => void moderate(p.id, { status: "hidden" })} disabled={busyId === p.id} title="Hide" type="button"><EyeOff size={15} /></button>
                      ) : (
                        <button onClick={() => void moderate(p.id, { status: "visible" })} disabled={busyId === p.id} title="Show" type="button"><Eye size={15} /></button>
                      )}
                      <button onClick={() => void moderate(p.id, { status: "removed" })} disabled={busyId === p.id} title="Remove" type="button"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && posts.length === 0 ? (
                <tr><td colSpan={7} style={{ color: "#9ca3af" }}>No posts match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
