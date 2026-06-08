"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, RefreshCw, Trophy } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";

type Overview = { user_id: string; full_name: string; phone: string; learning_points: number; completed: number; attempted: number; avg_quiz: number | null };
type Detail = { content_id: string; title_en: string; content_type: string; module_title: string; category_name: string; status: string; progress_pct: number; quiz_score: number | null; quiz_passed: number; points_awarded: number; completed_at: string | null };

function fmt(v: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
}

export function LearningProgress() {
  const [rows, setRows] = useState<Overview[]>([]);
  const [detail, setDetail] = useState<Detail[] | null>(null);
  const [activeUser, setActiveUser] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/app/learning/progress-overview", { cache: "no-store" });
      const json = await res.json();
      setRows(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function openUser(u: Overview) {
    setActiveUser(u);
    setDetail(null);
    const res = await fetch(`/api/v1/app/learning/user-progress?user_id=${u.user_id}`, { cache: "no-store" });
    const json = await res.json();
    setDetail(json.data ?? []);
  }

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Training</p>
          <h1 className="page-title">Learning Progress</h1>
          <p className="subtitle">Per-user read/complete status, quiz scores and earned points across the training module.</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={() => void load()} type="button"><RefreshCw size={18} /> Refresh</button>
        </div>
      </section>

      <section className="learn-studio">
        <div className="panel">
          <div className="panel-header">
            <div><h2>Learners</h2><p>{loading ? "Loading…" : `${rows.length} active learner(s).`}</p></div>
            <Status label={`${rows.length}`} />
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>User</th><th>Points</th><th>Completed</th><th>Attempted</th><th>Avg quiz</th><th></th></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.user_id} style={{ cursor: "pointer", background: activeUser?.user_id === u.user_id ? "rgba(123,21,54,0.06)" : undefined }} onClick={() => void openUser(u)}>
                    <td><strong>{u.full_name}</strong><div style={{ color: "#9ca3af", fontSize: 12 }}>{u.phone}</div></td>
                    <td><span className="tag"><Trophy size={12} /> {u.learning_points}</span></td>
                    <td>{u.completed}</td>
                    <td>{u.attempted}</td>
                    <td>{u.avg_quiz != null ? `${u.avg_quiz}%` : "—"}</td>
                    <td><ChevronRight size={16} color="#9ca3af" /></td>
                  </tr>
                ))}
                {!loading && rows.length === 0 ? <tr><td colSpan={6} style={{ color: "#9ca3af" }}>No learning activity yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        {activeUser ? (
          <div className="panel">
            <div className="panel-header">
              <div><h2>{activeUser.full_name}</h2><p>{activeUser.learning_points} points · {activeUser.completed} completed</p></div>
              <Status label={detail ? `${detail.length}` : "…"} />
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Content</th><th>Category</th><th>Status</th><th>Quiz</th><th>Points</th><th>When</th></tr></thead>
                <tbody>
                  {(detail ?? []).map((d) => (
                    <tr key={d.content_id}>
                      <td><strong>{d.title_en}</strong><div style={{ color: "#9ca3af", fontSize: 12 }}>{d.content_type} · {d.module_title}</div></td>
                      <td>{d.category_name}</td>
                      <td><Status label={d.status} /></td>
                      <td>{d.quiz_score != null ? `${d.quiz_score}%${d.quiz_passed ? " ✓" : ""}` : "—"}</td>
                      <td>{d.points_awarded}</td>
                      <td>{fmt(d.completed_at)}</td>
                    </tr>
                  ))}
                  {detail && detail.length === 0 ? <tr><td colSpan={6} style={{ color: "#9ca3af" }}>No content attempted.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </AdminShell>
  );
}
