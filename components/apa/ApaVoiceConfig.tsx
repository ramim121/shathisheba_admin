"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Save, ShieldAlert } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Select } from "@/components/Select";
import { Failed, Loading, n, post, s, useApi, when, type Row } from "@/components/apa/shared";
import { ApaPromptHistory } from "@/components/apa/ApaPromptHistory";
import "@/components/apa/apa-console.css";

/**
 * Every number Shathi Apa costs money for, and the instructions that restrict her.
 *
 * None of this is a constant in code, deliberately. The first month in
 * production is the only way to learn what a live minute really costs, how many
 * free questions convert a farmer into a verified one, and what downlink is
 * genuinely too slow for a call — and all of it has to be changeable at 9pm
 * without a deploy.
 *
 * The scope instruction has a floor: below two hundred characters the server
 * refuses the save. An assistant whose restriction has been emptied out is not
 * a misconfiguration, it is a general-purpose chatbot on our invoice.
 */

type Config = {
  settings: Row[];
  prompts: Row[];
  resolved: Row;
  voices: Array<{ name: string; note: string }>;
};

type Field =
  | { key: string; label: string; help: string; kind: "toggle" }
  | { key: string; label: string; help: string; kind: "number"; unit?: string }
  | { key: string; label: string; help: string; kind: "select"; options: string[] }
  | { key: string; label: string; help: string; kind: "voice" }
  | { key: string; label: string; help: string; kind: "chain"; placeholder?: string };

const GROUPS: Array<{ title: string; note: string; fields: Field[] }> = [
  {
    title: "Who may use her",
    note: "Verification is the gate, because verification is what the platform actually wants. A trial comes first so she sees the value before she is asked for anything.",
    fields: [
      { key: "apa_enabled", label: "Shathi Apa is on", help: "Off shows farmers a closed state rather than an error.", kind: "toggle" },
      { key: "apa_free_questions", label: "Free questions before the wall", help: "What an unverified farmer gets. Zero locks her out from the first tap — the soft wall is what makes verification feel earned rather than demanded.", kind: "number" }
    ]
  },
  {
    title: "Live conversation",
    note: "The expensive path. Everything here is a ceiling the app cannot raise.",
    fields: [
      { key: "apa_live_mic_enabled", label: "The app may open the microphone", help: "Off until an app build ships that can capture PCM16 on Android. The live screen explains the wait rather than showing a dead button.", kind: "toggle" },
      { key: "apa_live_minutes_monthly", label: "Minutes per farmer per month", help: "Resets on the first of the month.", kind: "number", unit: "min" },
      { key: "apa_live_session_minutes", label: "Longest single call", help: "The app warns two minutes before this.", kind: "number", unit: "min" },
      { key: "apa_data_mb_per_minute", label: "Data cost quoted to the farmer", help: "Shown in the pre-flight notice, in the unit her data pack is sold in.", kind: "number", unit: "MB/min" },
      { key: "apa_bandwidth_floor_kbps", label: "Downlink below which we offer a voice message", help: "Caught before the call starts rather than after it fails.", kind: "number", unit: "kbps" }
    ]
  },
  {
    title: "Her voice",
    note: "Read-aloud is the control a farmer who cannot read uses most.",
    fields: [
      { key: "apa_voice_name", label: "Voice", help: "Used for read-aloud and for live.", kind: "voice" },
      { key: "apa_autoplay_voice", label: "Read the answer aloud when the question was spoken", help: "A typed question gets a speaker button instead — reading aloud to someone sitting with other people is not a kindness.", kind: "toggle" },
      { key: "apa_speech_rate", label: "Speaking pace", help: "The farmer can override this in her own settings.", kind: "select", options: ["slow", "normal", "fast"] },
      { key: "apa_tts_max_chars", label: "Longest answer read aloud", help: "Past this the app shows the text and says so, rather than stopping mid-sentence.", kind: "number", unit: "chars" }
    ]
  },
  {
    title: "Models",
    note: "Each of these is a chain, tried left to right, comma separated. The free tier caps requests per model per day, so a second entry is not a nicety — it is what keeps the assistant answering after the first model is spent. Watch it work on Requests and quota.",
    fields: [
      { key: "apa_model_text", label: "Answers and calls tools", help: "First entry does the work; the rest are the safety net.", kind: "chain", placeholder: "gemini-3.1-flash-lite,gemini-2.5-flash" },
      { key: "apa_model_classify", label: "Scope gate", help: "Cheap and reliable matters more than clever — most questions never reach it, because an obvious farming question is let through without a model call at all.", kind: "chain", placeholder: "gemini-2.5-flash,gemini-3.1-flash-lite" },
      { key: "apa_model_transcribe", label: "Speech to text", help: "", kind: "chain", placeholder: "gemini-3.5-transcribe" },
      { key: "apa_model_tts", label: "Text to speech", help: "Only reached by a handset with no Bangla voice of its own, and only when read-aloud below is not set to device.", kind: "chain", placeholder: "gemini-2.5-flash-preview-tts" },
      { key: "apa_model_live", label: "Live conversation", help: "Audio out only; the transcript strip comes from output transcription.", kind: "chain", placeholder: "gemini-3.8-live" },
      { key: "apa_model_vision", label: "Reads a photo", help: "", kind: "chain", placeholder: "gemini-3.1-flash-lite,gemini-2.5-flash" }
    ]
  },
  {
    // Everything here exists because the free tier caps *requests*, not money.
    // A request not made is worth more than a request made cheaply.
    title: "Cost and quota controls",
    note: "The four levers, in order of what they return. None of these change what a farmer sees when things are working; all of them change how many requests a day it takes to get there.",
    fields: [
      {
        key: "apa_tts_mode",
        label: "Who reads the answer aloud",
        help: "device — the phone's own engine, always: free, instant, works offline, and the single largest saving available. device_then_server synthesises for handsets with no Bangla voice installed. server synthesises every answer and is the most expensive setting here.",
        kind: "select",
        options: ["device", "device_then_server", "server"]
      },
      {
        key: "apa_answer_cache_hours",
        label: "How long an answer may be reused",
        help: "Fifty farmers in one upazila asking the same thing on the same morning is one model call. Never across districts, never across days, never anything personal. Zero switches the cache off.",
        kind: "number",
        unit: "hours"
      },
      {
        key: "apa_prompt_examples",
        label: "Send the worked examples with every answer",
        help: "Longer prompt, noticeably better register and far less invention. It also pushes the instruction past the caching thresholds — 2,048 tokens on 2.5, 4,096 on 3.x — so on a paid tier it partly pays for itself.",
        kind: "toggle"
      },
      {
        key: "apa_image_max_px",
        label: "Longest edge of a photo sent to a model",
        help: "Gemini bills an image in 768-pixel tiles. A camera original is about five times the tokens of the same photo at 1024, for the same answer about the same spot on the same leaf. The phone reads this and shrinks before uploading.",
        kind: "number",
        unit: "px"
      },
      {
        key: "apa_fair_share_pct",
        label: "Start rationing at",
        help: "The daily cap belongs to the project, not the farmer — so without this, one heavy user can spend the day's allowance before most farmers have woken up. Past this share of the day's own headroom, the per-farmer daily limit tightens. 100 switches it off.",
        kind: "number",
        unit: "% of the day"
      },
      {
        key: "apa_prewarm_enabled",
        label: "Fill the cache overnight",
        help: "The allowance resets at midnight Pacific — 2pm in Dhaka — and almost nothing is asked until the next morning. scripts/apa-prewarm.cjs spends a few dozen of those idle requests on the questions farmers ask every morning, so those mornings cost nothing.",
        kind: "toggle"
      },
      {
        key: "apa_retention_days",
        label: "Keep message bodies for",
        help: "Transcripts and answers are pruned past this. Scope verdicts, feedback, vocabulary and prompt history are never pruned — they are the training corpus and the audit trail.",
        kind: "number",
        unit: "days"
      }
    ]
  },
  {
    title: "Limits and spend",
    note: "Abuse ceilings, not product limits. A farmer will never meet these.",
    fields: [
      { key: "apa_ask_per_minute", label: "Questions per farmer per minute", help: "", kind: "number" },
      { key: "apa_ask_per_day", label: "Questions per farmer per day", help: "", kind: "number" },
      { key: "apa_budget_usd", label: "Monthly budget", help: "What the Usage and Cost page measures against.", kind: "number", unit: "USD" }
    ]
  }
];

const PROMPT_HELP: Record<string, string> = {
  persona: "Who she is and how she writes. Attached to every answer.",
  scope: "What counts as farming. This is the control, not a request — it is attached to the live token too, where the phone cannot override it. Must stay at least 200 characters.",
  live: "Extra instruction for a spoken call: short turns, no markdown, numbers as words.",
  refusal_bn: "The exact sentence a farmer sees when her question is out of scope."
};

export function ApaVoiceConfig() {
  const feed = useApi<Config>("/api/v1/admin/apa/config");
  const [values, setValues] = useState<Record<string, string>>({});
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!feed.data) return;
    setValues(Object.fromEntries(feed.data.settings.map((row) => [s(row.setting_key), s(row.value_text)])));
    setPrompts(Object.fromEntries(feed.data.prompts.map((row) => [s(row.prompt_key), s(row.body)])));
  }, [feed.data]);

  const original = feed.data
    ? Object.fromEntries(feed.data.settings.map((row) => [s(row.setting_key), s(row.value_text)]))
    : {};
  const originalPrompts = feed.data
    ? Object.fromEntries(feed.data.prompts.map((row) => [s(row.prompt_key), s(row.body)]))
    : {};
  const changedSettings = Object.keys(values).filter((k) => values[k] !== original[k]);
  const changedPrompts = Object.keys(prompts).filter((k) => prompts[k] !== originalPrompts[k]);
  const dirty = changedSettings.length + changedPrompts.length;

  async function save() {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await post("/api/v1/admin/apa/config", {
        settings: Object.fromEntries(changedSettings.map((k) => [k, values[k]])),
        prompts: Object.fromEntries(changedPrompts.map((k) => [k, prompts[k]]))
      });
      setSaved(`Saved ${dirty} change${dirty === 1 ? "" : "s"}. Live within ten seconds.`);
      feed.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const on = (key: string) => ["1", "true", "yes", "on"].includes((values[key] ?? "").toLowerCase());

  return (
    <AdminShell>
      <section className="page-head">
        <div>
          <p className="eyeline">Shathi Apa</p>
          <h1 className="page-title">Voice configuration</h1>
          <p className="page-sub">
            Everything the assistant costs money for, and the instructions that restrict her. Changes
            reach the app within ten seconds; nothing here needs a deploy.
          </p>
        </div>
        <div className="toolbar">
          <button className="btn primary" type="button" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? <Loader2 size={16} className="apa-spin" /> : <Save size={16} />}
            {dirty ? `Save ${dirty} change${dirty === 1 ? "" : "s"}` : "Saved"}
          </button>
        </div>
      </section>

      {feed.loading ? <Loading /> : null}
      {feed.error ? <Failed message={feed.error} onRetry={feed.reload} /> : null}
      {error ? <Failed message={error} /> : null}
      {saved ? <p className="apa-state">{saved}</p> : null}

      {feed.data ? (
        <>
          {!on("apa_live_mic_enabled") ? (
            <p className="apa-locked-note">
              <AlertTriangle size={15} />
              The live microphone is off. The server side is complete — tokens mint with their
              restrictions and minutes are accounted for — but no shipped app build can capture
              PCM16 audio on Android yet, so the live screen shows farmers an honest “arriving with
              the next update” state instead of a button that cannot work. Turn this on when that
              build ships.
            </p>
          ) : null}

          <div className="panel-grid">
            {GROUPS.map((group) => (
              <section className="panel is-padded" key={group.title}>
                <h2 className="act-form-title">{group.title}</h2>
                <p className="muted">{group.note}</p>
                <div className="apa-config">
                  {group.fields.map((field) => (
                    <div className="apa-setting" key={field.key}>
                      <div className="apa-setting-label">
                        <strong>{field.label}</strong>
                        {field.help ? <span>{field.help}</span> : null}
                        <code>{field.key}</code>
                      </div>
                      <div>
                        {field.kind === "toggle" ? (
                          <button
                            type="button"
                            className={`apa-toggle${on(field.key) ? " on" : ""}`}
                            aria-pressed={on(field.key)}
                            onClick={() => set(field.key, on(field.key) ? "0" : "1")}
                          >
                            <span className="apa-switch"><i /></span>
                            {on(field.key) ? "On" : "Off"}
                          </button>
                        ) : field.kind === "number" ? (
                          <div className="apa-toolbar-right">
                            <input
                              className="input"
                              type="number"
                              min={0}
                              style={{ maxWidth: 120 }}
                              value={values[field.key] ?? ""}
                              onChange={(e) => set(field.key, e.target.value)}
                              aria-label={field.label}
                            />
                            {field.unit ? <span className="muted">{field.unit}</span> : null}
                          </div>
                        ) : field.kind === "chain" ? (
                          <input
                            className="input"
                            type="text"
                            spellCheck={false}
                            placeholder={field.placeholder}
                            value={values[field.key] ?? ""}
                            onChange={(e) => set(field.key, e.target.value)}
                            aria-label={field.label}
                          />
                        ) : field.kind === "voice" ? (
                          <Select
                            value={values[field.key] ?? ""}
                            onChange={(v) => set(field.key, v)}
                            options={feed.data!.voices.map((v) => ({ value: v.name, label: `${v.name} — ${v.note}` }))}
                          />
                        ) : (
                          <Select
                            value={values[field.key] ?? ""}
                            onChange={(v) => set(field.key, v)}
                            options={Array.from(new Set([...(field.options ?? []), values[field.key]].filter(Boolean))).map((o) => ({
                              value: String(o),
                              label: String(o)
                            }))}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <section className="panel is-padded">
            <h2 className="act-form-title"><ShieldAlert size={15} /> Instructions</h2>
            <p className="muted">
              These are attached to every path, including the live token, where the phone cannot
              override them. Written in English on purpose — the model follows English instructions
              about writing Bangla more reliably than Bangla instructions.
            </p>
            <div className="panel-grid">
              {feed.data.prompts.map((row) => {
                const key = s(row.prompt_key);
                return (
                  <div className="apa-prompt" key={key}>
                    <label className="field-label" htmlFor={`prompt-${key}`}>
                      <span className="field-label-text">{s(row.label)}</span>
                    </label>
                    <small className="field-hint">{PROMPT_HELP[key] ?? ""}</small>
                    <textarea
                      id={`prompt-${key}`}
                      className="input"
                      value={prompts[key] ?? ""}
                      onChange={(e) => setPrompts((p) => ({ ...p, [key]: e.target.value }))}
                    />
                    <small className="field-hint">
                      {(prompts[key] ?? "").length} characters
                      {key === "scope" && (prompts[key] ?? "").length < 200 ? " — too short to restrict anything" : ""}
                      {s(row.updated_by_name) ? ` · last changed by ${s(row.updated_by_name)}, ${when(row.updated_at)}` : ""}
                    </small>
                  </div>
                );
              })}
            </div>
          </section>

          <ApaPromptHistory current={originalPrompts} onRestored={feed.reload} />

          <section className="panel is-padded">
            <h2 className="act-form-title">What the server is using right now</h2>
            <p className="muted">
              Resolved from the values above, through the same code path every request takes.
            </p>
            <div className="def-grid">
              {[
                ["Free questions", String(n((feed.data.resolved as Row).freeQuestions))],
                ["Live minutes a month", String(n((feed.data.resolved as Row).liveMinutesMonthly))],
                ["Session cap", `${n((feed.data.resolved as Row).liveSessionMinutes)} min`],
                ["Voice", s((feed.data.resolved as Row).voiceName)],
                ["Microphone", (feed.data.resolved as Row).liveMicEnabled ? "enabled" : "held back"],
                ["Answering model", s(((feed.data.resolved as Row).models as Row)?.text)],
                ["Scope gate", s(((feed.data.resolved as Row).models as Row)?.classify)],
                ["Live model", s(((feed.data.resolved as Row).models as Row)?.live)]
              ].map(([label, value]) => (
                <div className="def-item" key={label}>
                  <span className="def-label">{label}</span>
                  <span className="def-value">{value}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </AdminShell>
  );
}
