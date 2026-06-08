"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Plus, RefreshCw, Save, Trash2, Video, X } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import { MarkdownEditor } from "@/components/MarkdownEditor";

type ModuleRow = { id: string; title: string; category: string; status: string };
type ContentRow = {
  id: string; learning_module_id: string; content_type: string; title_en: string; title_bn?: string;
  body_en?: string; video_url?: string; duration_seconds?: string | number; points?: string | number;
  image_url?: string; summary_en?: string; quiz_json?: string | null; sort_order?: string | number; status: string;
};
type Question = { q: string; options: string[]; answer: number };

type Draft = {
  id?: string; learning_module_id: string; content_type: "article" | "video"; title_en: string; title_bn: string;
  body_en: string; video_url: string; duration_seconds: string; points: string; image_url: string;
  summary_en: string; sort_order: string; status: string; quiz: Question[];
};

function parseQuiz(raw: unknown): Question[] {
  let v: unknown = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    const o = x as { q?: unknown; options?: unknown[]; answer?: unknown };
    return { q: String(o.q ?? ""), options: Array.isArray(o.options) ? o.options.map((p) => String(p)) : ["", ""], answer: Number(o.answer ?? 0) };
  });
}

function emptyDraft(moduleId: string): Draft {
  return { learning_module_id: moduleId, content_type: "article", title_en: "", title_bn: "", body_en: "", video_url: "", duration_seconds: "", points: "10", image_url: "", summary_en: "", sort_order: "1", status: "published", quiz: [] };
}

export function LearningStudio() {
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [contents, setContents] = useState<ContentRow[]>([]);
  const [moduleId, setModuleId] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [m, c] = await Promise.all([
        fetch("/api/v1/learning/modules?surface=admin", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/v1/learning/contents?surface=admin", { cache: "no-store" }).then((r) => r.json())
      ]);
      setModules(m.data ?? []);
      setContents(c.data ?? []);
      setModuleId((prev) => prev || (m.data?.[0] ? String(m.data[0].id) : ""));
    } catch {
      setMessage("Could not load learning data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const moduleContents = useMemo(
    () => contents.filter((c) => String(c.learning_module_id) === String(moduleId)).sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)),
    [contents, moduleId]
  );

  function editContent(c: ContentRow) {
    setDraft({
      id: c.id,
      learning_module_id: String(c.learning_module_id),
      content_type: c.content_type === "video" ? "video" : "article",
      title_en: c.title_en ?? "",
      title_bn: c.title_bn ?? "",
      body_en: c.body_en ?? "",
      video_url: c.video_url ?? "",
      duration_seconds: c.duration_seconds ? String(c.duration_seconds) : "",
      points: c.points ? String(c.points) : "10",
      image_url: c.image_url ?? "",
      summary_en: c.summary_en ?? "",
      sort_order: c.sort_order ? String(c.sort_order) : "1",
      status: c.status ?? "published",
      quiz: parseQuiz(c.quiz_json)
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.title_en.trim()) { setMessage("English title is required."); return; }
    setSaving(true);
    setMessage("");
    const payload: Record<string, unknown> = {
      learning_module_id: draft.learning_module_id,
      content_type: draft.content_type,
      title_en: draft.title_en,
      title_bn: draft.title_bn,
      points: Number(draft.points) || 0,
      image_url: draft.image_url,
      summary_en: draft.summary_en,
      sort_order: Number(draft.sort_order) || 0,
      status: draft.status
    };
    if (draft.content_type === "article") {
      payload.body_en = draft.body_en;
      payload.quiz_json = draft.quiz.length ? JSON.stringify(draft.quiz) : "[]";
    } else {
      payload.video_url = draft.video_url;
      payload.duration_seconds = Number(draft.duration_seconds) || 0;
    }
    try {
      const url = draft.id ? `/api/v1/learning/contents?id=${draft.id}` : "/api/v1/learning/contents";
      const res = await fetch(url, { method: draft.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "Save failed.");
      setMessage(draft.id ? "Content updated." : "Content created.");
      setDraft(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setMessage("");
    try {
      const res = await fetch(`/api/v1/learning/contents?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message ?? "Delete failed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed.");
    }
  }

  function setQ(i: number, patch: Partial<Question>) {
    if (!draft) return;
    const quiz = draft.quiz.map((q, idx) => (idx === i ? { ...q, ...patch } : q));
    setDraft({ ...draft, quiz });
  }

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Training</p>
          <h1 className="page-title">Learning Studio</h1>
          <p className="subtitle">Author articles (Markdown + image), add YouTube videos, build quizzes, and set points per content. Pick a subcategory to manage its content.</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={() => void load()} type="button"><RefreshCw size={18} /> Refresh</button>
          <button className="btn primary" onClick={() => setDraft(emptyDraft(moduleId))} disabled={!moduleId} type="button"><Plus size={18} /> New Content</button>
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      <div className="field" style={{ maxWidth: 460, marginBottom: 14 }}>
        <label>Subcategory (module)</label>
        <select value={moduleId} onChange={(e) => { setModuleId(e.target.value); setDraft(null); }}>
          {modules.map((m) => <option key={m.id} value={m.id}>{m.category} — {m.title}</option>)}
        </select>
      </div>

      <section className="learn-studio">
        <div className="panel">
          <div className="panel-header">
            <div><h2>Content</h2><p>{loading ? "Loading…" : `${moduleContents.length} item(s) in this subcategory.`}</p></div>
            <Status label={`${moduleContents.length}`} />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Title</th><th>Points</th><th>Quiz</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {moduleContents.map((c) => (
                  <tr key={c.id}>
                    <td>{c.content_type === "video" ? <span className="tag"><Video size={12} /> Video</span> : <span className="tag"><FileText size={12} /> Article</span>}</td>
                    <td><strong>{c.title_en}</strong></td>
                    <td>{c.points ?? 0}</td>
                    <td>{parseQuiz(c.quiz_json).length || "—"}</td>
                    <td><Status label={c.status} /></td>
                    <td>
                      <div className="row-actions">
                        <button onClick={() => editContent(c)} title="Edit" type="button"><FileText size={15} /></button>
                        <button onClick={() => void remove(c.id)} title="Delete" type="button"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && moduleContents.length === 0 ? <tr><td colSpan={6} style={{ color: "#9ca3af" }}>No content yet. Use “New Content”.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        {draft ? (
          <div className="panel learn-editor">
            <div className="panel-header">
              <div><h2>{draft.id ? "Edit content" : "New content"}</h2><p>Markdown article or YouTube video.</p></div>
              <button className="btn ghost" onClick={() => setDraft(null)} type="button"><X size={16} /> Close</button>
            </div>
            <div className="learn-editor-body">
              <div className="field">
                <label>Type</label>
                <select value={draft.content_type} onChange={(e) => setDraft({ ...draft, content_type: e.target.value as "article" | "video" })}>
                  <option value="article">Article</option>
                  <option value="video">Video</option>
                </select>
              </div>
              <div className="form-grid2">
                <div className="field"><label>English title</label><input value={draft.title_en} onChange={(e) => setDraft({ ...draft, title_en: e.target.value })} /></div>
                <div className="field"><label>Bangla title</label><input value={draft.title_bn} onChange={(e) => setDraft({ ...draft, title_bn: e.target.value })} /></div>
                <div className="field"><label>Points</label><input type="number" value={draft.points} onChange={(e) => setDraft({ ...draft, points: e.target.value })} /></div>
                <div className="field"><label>Sort order</label><input type="number" value={draft.sort_order} onChange={(e) => setDraft({ ...draft, sort_order: e.target.value })} /></div>
                <div className="field"><label>Image URL</label><input value={draft.image_url} onChange={(e) => setDraft({ ...draft, image_url: e.target.value })} placeholder="https://…" /></div>
                <div className="field"><label>Status</label>
                  <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                    <option value="published">published</option><option value="draft">draft</option><option value="archived">archived</option>
                  </select>
                </div>
              </div>

              {draft.content_type === "video" ? (
                <div className="form-grid2">
                  <div className="field"><label>YouTube URL</label><input value={draft.video_url} onChange={(e) => setDraft({ ...draft, video_url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" /></div>
                  <div className="field"><label>Duration (seconds)</label><input type="number" value={draft.duration_seconds} onChange={(e) => setDraft({ ...draft, duration_seconds: e.target.value })} /></div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}><label>Description (shown under video)</label><textarea value={draft.body_en} onChange={(e) => setDraft({ ...draft, body_en: e.target.value })} /></div>
                </div>
              ) : (
                <>
                  <div className="field"><label>Article body (Markdown)</label><MarkdownEditor value={draft.body_en} onChange={(v) => setDraft({ ...draft, body_en: v })} /></div>
                  <div className="quiz-builder">
                    <div className="quiz-builder-head">
                      <strong>Quiz ({draft.quiz.length})</strong>
                      <button className="btn ghost" type="button" onClick={() => setDraft({ ...draft, quiz: [...draft.quiz, { q: "", options: ["", ""], answer: 0 }] })}><Plus size={14} /> Add question</button>
                    </div>
                    <p className="subtitle" style={{ margin: "0 0 8px" }}>Reader passes at ≥80% to complete the article. Pick the correct option with the radio.</p>
                    {draft.quiz.map((q, i) => (
                      <div className="quiz-q" key={i}>
                        <div className="quiz-q-head">
                          <input placeholder={`Question ${i + 1}`} value={q.q} onChange={(e) => setQ(i, { q: e.target.value })} />
                          <button type="button" className="quiz-del" onClick={() => setDraft({ ...draft, quiz: draft.quiz.filter((_, idx) => idx !== i) })}><Trash2 size={14} /></button>
                        </div>
                        {q.options.map((opt, oi) => (
                          <label className="quiz-opt" key={oi}>
                            <input type="radio" checked={q.answer === oi} onChange={() => setQ(i, { answer: oi })} />
                            <input value={opt} placeholder={`Option ${oi + 1}`} onChange={(e) => setQ(i, { options: q.options.map((o, idx) => (idx === oi ? e.target.value : o)) })} />
                            {q.options.length > 2 ? <button type="button" className="quiz-del" onClick={() => setQ(i, { options: q.options.filter((_, idx) => idx !== oi), answer: 0 })}><X size={13} /></button> : null}
                          </label>
                        ))}
                        <button type="button" className="quiz-addopt" onClick={() => setQ(i, { options: [...q.options, ""] })}>+ option</button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="form-actions">
                <button className="btn primary" onClick={() => void save()} disabled={saving} type="button"><Save size={16} /> {saving ? "Saving…" : "Save content"}</button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </AdminShell>
  );
}
