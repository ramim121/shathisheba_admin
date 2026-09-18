"use client";

import { useEffect, useState } from "react";
import { Check, Languages, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import "@/components/ai-assist.css";

type Mode = "draft" | "translate";

/**
 * Writing help for a form field, in two pieces on purpose.
 *
 * The launcher belongs on the label row and the panel belongs under the
 * control — rendering both from one component put the panel inside the
 * <label>, which pushed the input out of its own field. The parent owns which
 * field is open; the panel owns the suggestion.
 *
 * Nothing here writes to the database. A suggestion lands in a preview and the
 * admin presses "Use this", which fills the input they were already editing,
 * so a bad generation costs one click.
 */

export function AiAssistLaunch({
  label,
  hasText,
  canTranslate,
  onOpen,
  disabled
}: {
  label: string;
  hasText: boolean;
  canTranslate: boolean;
  onOpen: (mode: Mode) => void;
  disabled?: boolean;
}) {
  return (
    <span className="ai-launch">
      <button
        type="button"
        className="ai-chip-btn"
        onClick={() => onOpen("draft")}
        disabled={disabled}
        title={hasText ? `Improve this ${label.toLowerCase()} with AI` : `Write this ${label.toLowerCase()} with AI`}
      >
        <Sparkles size={12} aria-hidden="true" /> AI
      </button>
      {canTranslate ? (
        <button
          type="button"
          className="ai-chip-btn"
          onClick={() => onOpen("translate")}
          disabled={disabled}
          title="Translate the English text into this field"
        >
          <Languages size={12} aria-hidden="true" /> Translate
        </button>
      ) : null}
    </span>
  );
}

export function AiAssistPanel({
  label,
  resource,
  context,
  value,
  translateFrom,
  language = "en",
  length = "medium",
  autoRun,
  onInsert,
  onClose
}: {
  label: string;
  resource?: string;
  context?: () => Record<string, unknown>;
  value?: string;
  translateFrom?: string;
  language?: "en" | "bn";
  length?: "short" | "medium" | "long";
  /** Which request to fire on open; "translate" when the admin asked for it. */
  autoRun?: Mode;
  onInsert: (text: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<Mode | "">("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [instruction, setInstruction] = useState("");

  const hasText = Boolean(value?.trim());
  const canTranslate = Boolean(translateFrom?.trim());

  async function run(mode: Mode, steer = instruction) {
    setBusy(mode);
    setError("");
    try {
      const body =
        mode === "translate"
          ? { task: "translate", text: translateFrom ?? "", to: language }
          : {
              task: "draft",
              label,
              resource,
              context: context?.() ?? {},
              existing: value ?? "",
              language,
              instruction: steer,
              length
            };
      const response = await fetch("/api/v1/admin/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const json = (await response.json()) as { ok?: boolean; message?: string; result?: { text?: string } };
      if (!response.ok || !json.ok) throw new Error(json.message ?? "The AI request failed.");
      const text = String(json.result?.text ?? "").trim();
      if (!text) throw new Error("The model returned nothing usable.");
      setResult(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AI request failed.");
    } finally {
      setBusy("");
    }
  }

  // Opening through "Translate" should not need a second click.
  useEffect(() => {
    if (autoRun === "translate" && canTranslate) void run("translate");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <span className="ai-panel-title">
          <Sparkles size={13} aria-hidden="true" /> {hasText ? "Improve" : "Write"} · {label}
        </span>
        <button type="button" className="ai-panel-close" onClick={onClose} aria-label="Close AI help">
          <X size={14} />
        </button>
      </div>

      <div className="ai-panel-row">
        <input
          className="input"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Optional steer — e.g. mention the vaccination record"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void run("draft");
            }
          }}
        />
        <button type="button" className="btn primary sm" onClick={() => void run("draft")} disabled={busy !== ""}>
          {busy === "draft" ? <Loader2 size={14} className="ai-spin" /> : <Sparkles size={14} />}
          {hasText ? "Improve" : "Write"}
        </button>
        {canTranslate ? (
          <button type="button" className="btn sm" onClick={() => void run("translate")} disabled={busy !== ""}>
            {busy === "translate" ? <Loader2 size={14} className="ai-spin" /> : <Languages size={14} />}
            Translate
          </button>
        ) : null}
      </div>

      {error ? <p className="ai-panel-error">{error}</p> : null}

      {result ? (
        <>
          <div className="ai-panel-result">{result}</div>
          <div className="ai-panel-actions">
            <button
              type="button"
              className="btn primary sm"
              onClick={() => {
                onInsert(result);
                onClose();
              }}
            >
              <Check size={14} /> Use this
            </button>
            <button type="button" className="btn sm" onClick={() => void run("draft")} disabled={busy !== ""}>
              <RefreshCw size={14} /> Again
            </button>
            <span className="ai-panel-note">Checked by you, not by the model — it can be wrong.</span>
          </div>
        </>
      ) : busy === "" ? (
        <p className="ai-panel-note">
          The suggestion uses what is already on this form. Nothing is saved until you save the record.
        </p>
      ) : null}
    </div>
  );
}
