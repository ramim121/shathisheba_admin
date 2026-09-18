"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * The scaffolding the seven Shathi Apa pages share.
 *
 * Each page is one read and one or two writes against /api/v1/admin/apa/*, so
 * the fetching, the loading state and the failure state are the same shape
 * seven times over. Pulling them here keeps each page file about its own
 * question rather than about plumbing.
 */

export type Row = Record<string, unknown>;

export const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const n = (v: unknown) => Number(v ?? 0);

/** Thousands separators, because these pages are read at a glance. */
export const num = (v: unknown) => n(v).toLocaleString("en-GB");

export function useApi<T>(url: string): {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    // An empty url means "nothing selected yet" — a panel that renders before a
    // row is picked must not fetch the page it is sitting on.
    if (!url) {
      setData(null);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (!j.ok) throw new Error(j.message ?? "That could not be loaded.");
        setData((j.data ?? j.result) as T);
        setError("");
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "That could not be loaded.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export async function post(url: string, body: unknown): Promise<Row> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = (await res.json()) as { ok?: boolean; message?: string; result?: Row };
  if (!res.ok || !json.ok) throw new Error(json.message ?? "That did not save.");
  return json.result ?? {};
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="apa-state">
      <Loader2 size={15} className="apa-spin" /> {label}
    </p>
  );
}

export function Failed({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <p className="apa-state is-bad">
      <AlertTriangle size={15} /> {message}
      {onRetry ? (
        <button type="button" className="btn sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </p>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="apa-empty">
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

export type Metric = {
  label: string;
  value: string;
  note?: string;
  tone?: "" | "tone-gold" | "tone-leaf" | "tone-sky" | "tone-plum" | "tone-red";
};

export function MetricBand({ metrics }: { metrics: Metric[] }) {
  return (
    <section className="grid metrics">
      {metrics.map((m) => (
        <div className={`metric ${m.tone ?? ""}`} key={m.label}>
          <span>{m.label}</span>
          <strong>{m.value}</strong>
          {m.note ? <small>{m.note}</small> : null}
        </div>
      ))}
    </section>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  options
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
}) {
  return (
    <div className="filter-tabs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`filter-tab${value === o.value ? " active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined ? <em className="apa-tab-count">{o.count}</em> : null}
        </button>
      ))}
    </div>
  );
}

/** "3 minutes ago" is easier to judge than a timestamp when scanning a queue. */
export function ago(value: unknown): string {
  const t = new Date(s(value)).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function when(value: unknown): string {
  const t = new Date(s(value)).getTime();
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** Seconds as the console reads them: 0:42, 3:20, 1:02:15. */
export function clock(seconds: unknown): string {
  const total = Math.max(0, Math.round(n(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function Bar({ pct, tone = "" }: { pct: number; tone?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <span className={`apa-bar ${tone}`} role="presentation">
      <i style={{ width: `${clamped}%` }} />
    </span>
  );
}
