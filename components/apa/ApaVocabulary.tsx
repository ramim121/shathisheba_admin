"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Select } from "@/components/Select";
import {
  Empty, Failed, Loading, MetricBand, num, post, s, n, useApi, type Row
} from "@/components/apa/shared";
import "@/components/apa/apa-console.css";

/**
 * The words the transcriber is told to expect.
 *
 * A general Bangla speech model has never heard "গলাফুলা" as a single word, so
 * it returns "গলা ফুলা" and the answer that comes back is about a person's
 * sore throat. Every term on this list is a question a farmer would otherwise
 * have had to ask twice.
 *
 * The seeded hundred and forty are guesses. What makes this page worth opening
 * a month in is the two columns the guesses cannot give you: how often each
 * term was actually heard, and which words keep turning up in transcripts that
 * are not on the list at all.
 */

type Vocab = {
  metrics: { total: number; active: number; heard: number; groups: number };
  groups: Row[];
  rows: Row[];
  candidates: Array<{ term: string; seen: number }>;
};

const GROUP_LABEL: Record<string, string> = {
  livestock_disease: "Livestock disease",
  poultry: "Poultry",
  crop_disease: "Crop disease",
  crop_pest: "Crop pests",
  crop: "Crops",
  input: "Inputs",
  livestock: "Livestock",
  fish: "Fish farming",
  measure: "Measures",
  weather: "Weather",
  platform: "Shathi Sheba",
  general: "General"
};

const label = (key: string) => GROUP_LABEL[key] ?? key.replace(/_/g, " ");

export function ApaVocabulary() {
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [newTerm, setNewTerm] = useState("");
  const [newGroup, setNewGroup] = useState("general");
  const [newMeaning, setNewMeaning] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const feed = useApi<Vocab>(
    `/api/v1/admin/apa/vocabulary?group=${encodeURIComponent(group)}&q=${encodeURIComponent(query)}`
  );

  async function save(body: Row, key: string) {
    setBusy(key);
    setError("");
    try {
      await post("/api/v1/admin/apa/vocabulary", body);
      feed.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy("");
    }
  }

  async function add() {
    const term = newTerm.trim();
    if (!term) return;
    await save({ term, term_group: newGroup, meaning_en: newMeaning.trim() }, "add");
    setNewTerm("");
    setNewMeaning("");
  }

  return (
    <AdminShell>
      <section className="page-head">
        <div>
          <p className="eyeline">Shathi Apa</p>
          <h1 className="page-title">Transcription vocabulary</h1>
          <p className="page-sub">
            Farm words handed to the speech model before it listens. Without them a farmer saying
            <span className="apa-term"> গলাফুলা</span> gets back “গলা ফুলা” and an answer about a person.
          </p>
        </div>
      </section>

      {feed.data ? (
        <MetricBand
          metrics={[
            { label: "Terms", value: num(feed.data.metrics.total), note: `${num(feed.data.metrics.active)} active` },
            { label: "Actually heard", value: num(feed.data.metrics.heard), note: "at least once", tone: "tone-leaf" },
            { label: "Groups", value: num(feed.data.metrics.groups), tone: "tone-sky" },
            { label: "New words spotted", value: num(feed.data.candidates.length), note: "said 3+ times, not listed", tone: "tone-gold" }
          ]}
        />
      ) : null}

      {feed.data?.candidates.length ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Heard but not listed</h2>
              <p>Bangla words that turned up three or more times in the last fortnight. Tap to add one.</p>
            </div>
          </div>
          <div className="apa-candidates">
            {feed.data.candidates.map((c) => (
              <button
                key={c.term}
                type="button"
                className="apa-candidate"
                disabled={busy === c.term}
                onClick={() => void save({ term: c.term, term_group: "general" }, c.term)}
              >
                {busy === c.term ? <Loader2 size={13} className="apa-spin" /> : <Plus size={13} />}
                {c.term} <em>{c.seen}×</em>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="apa-toolbar">
          <div className="apa-vocab-groups">
            <button
              type="button"
              className={`chip-btn${group === "all" ? " active" : ""}`}
              onClick={() => setGroup("all")}
            >
              All
            </button>
            {(feed.data?.groups ?? []).map((g) => (
              <button
                key={s(g.term_group)}
                type="button"
                className={`chip-btn${group === s(g.term_group) ? " active" : ""}`}
                onClick={() => setGroup(s(g.term_group))}
              >
                {label(s(g.term_group))} <em className="apa-tab-count">{num(g.n)}</em>
              </button>
            ))}
          </div>
          <div className="search-box">
            <Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a term…" aria-label="Find a term" />
            {q ? <button type="button" onClick={() => setQ("")} aria-label="Clear"><X size={14} /></button> : null}
          </div>
        </div>

        <div className="apa-toolbar">
          <div className="apa-toolbar-right" style={{ flex: 1 }}>
            <input
              className="input"
              style={{ maxWidth: 220 }}
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              placeholder="New term in Bangla"
              aria-label="New term"
            />
            <div style={{ minWidth: 190 }}>
              <Select
                value={newGroup}
                onChange={setNewGroup}
                options={Object.keys(GROUP_LABEL).map((k) => ({ value: k, label: GROUP_LABEL[k] }))}
              />
            </div>
            <input
              className="input"
              style={{ maxWidth: 240 }}
              value={newMeaning}
              onChange={(e) => setNewMeaning(e.target.value)}
              placeholder="What it means, in English"
              aria-label="Meaning"
            />
            <button type="button" className="btn primary sm" disabled={!newTerm.trim() || busy === "add"} onClick={() => void add()}>
              {busy === "add" ? <Loader2 size={14} className="apa-spin" /> : <Plus size={14} />} Add
            </button>
          </div>
        </div>

        {error ? <Failed message={error} /> : null}
        {feed.loading ? <Loading /> : null}
        {feed.error ? <Failed message={feed.error} onRetry={feed.reload} /> : null}
        {feed.data && !feed.data.rows.length && !feed.loading ? <Empty title="No terms match" /> : null}

        {feed.data?.rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Means</th>
                  <th>Group</th>
                  <th>Heard</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {feed.data.rows.map((row) => {
                  const id = s(row.id);
                  return (
                    <tr key={id}>
                      <td className="apa-term">{s(row.term)}</td>
                      <td>{s(row.meaning_en) || <span className="muted">—</span>}</td>
                      <td>{label(s(row.term_group))}</td>
                      <td>{n(row.heard_count) ? num(row.heard_count) : <span className="muted">never</span>}</td>
                      <td>
                        <button
                          type="button"
                          className={`apa-toggle${n(row.is_active) === 1 ? " on" : ""}`}
                          disabled={busy === id}
                          aria-pressed={n(row.is_active) === 1}
                          onClick={() =>
                            void save(
                              {
                                id,
                                term: s(row.term),
                                term_group: s(row.term_group),
                                meaning_en: s(row.meaning_en),
                                is_active: n(row.is_active) !== 1
                              },
                              id
                            )
                          }
                        >
                          <span className="apa-switch"><i /></span>
                          {n(row.is_active) === 1 ? "On" : "Off"}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn sm ghost"
                          disabled={busy === id}
                          onClick={() => void save({ id, remove: true }, id)}
                          aria-label={`Remove ${s(row.term)}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </AdminShell>
  );
}
