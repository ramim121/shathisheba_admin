"use client";

import { useMemo, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Empty, Failed, Loading, num, post, s, useApi, when, type Row } from "@/components/apa/shared";

/**
 * Every earlier version of every instruction, with a diff and a one-click
 * restore.
 *
 * The scope instruction is the safety control: it is the only thing standing
 * between a farming assistant and a general-purpose chatbot running on our
 * invoice. It is also a textarea in a web form, which means one bad paste at
 * 9pm can empty it, and until now the audit log recorded only *that* a prompt
 * changed — not what was lost. Recovering meant finding whoever still had a
 * copy.
 *
 * So every save snapshots the body it replaced, and this is where those
 * snapshots are read. The diff matters as much as the restore: the common case
 * is not "put back the whole thing", it is "which three lines did I change
 * before the answers got worse".
 */

type Version = Row & {
  id: string;
  prompt_key: string;
  chars: number;
  note: string | null;
  created_at: string;
  changed_by_name: string | null;
  preview: string;
};

const KEY_LABEL: Record<string, string> = {
  persona: "Who she is",
  scope: "What she may answer",
  examples: "Worked examples",
  classify: "Scope gate instruction",
  live: "Live conversation",
  refusal_bn: "Refusal wording"
};
const keyName = (key: string) => KEY_LABEL[key] ?? key.replace(/_/g, " ");

/* ---------------------------------------------------------------------------
   A line diff
   --------------------------------------------------------------------------- */

type Line = { kind: "same" | "add" | "del"; text: string };

/**
 * Longest common subsequence over lines.
 *
 * A word-level diff would be prettier and much less useful here: these are
 * instructions written as paragraphs and bullet points, and "this bullet
 * changed" is the unit someone actually reasons about. Bounded at 400 lines a
 * side because the table is rendered in the browser and a prompt is never
 * anywhere near that long — past it we show the two bodies without a diff
 * rather than lock the tab up in a quadratic loop.
 */
function diffLines(before: string, after: string): Line[] | null {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > 400 || b.length > 400) return null;

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) { out.push({ kind: "del", text: a[i] }); i += 1; }
  while (j < b.length) { out.push({ kind: "add", text: b[j] }); j += 1; }
  return out;
}

/** Unchanged runs longer than this are folded — nobody reads them. */
const CONTEXT = 2;

function fold(lines: Line[]): Array<Line | { kind: "gap"; text: string }> {
  const out: Array<Line | { kind: "gap"; text: string }> = [];
  let run = 0;
  const flush = () => {
    if (run > CONTEXT * 2) {
      const hidden = run - CONTEXT * 2;
      out.splice(out.length - (run - CONTEXT), hidden, {
        kind: "gap",
        text: `${hidden} unchanged line${hidden === 1 ? "" : "s"}`
      });
    }
    run = 0;
  };
  for (const line of lines) {
    if (line.kind === "same") {
      run += 1;
      out.push(line);
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out;
}

/* ---------------------------------------------------------------------------
   The panel
   --------------------------------------------------------------------------- */

export function ApaPromptHistory({
  current,
  onRestored
}: {
  /** The bodies in force right now, keyed by prompt_key, to diff against. */
  current: Record<string, string>;
  onRestored: () => void;
}) {
  const feed = useApi<{ rows: Version[] }>("/api/v1/admin/apa/prompt-versions");
  const [openId, setOpenId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const detail = useApi<Row>(openId ? `/api/v1/admin/apa/prompt-versions?id=${openId}` : "");
  const open = feed.data?.rows.find((r) => r.id === openId) ?? null;

  const diff = useMemo(() => {
    if (!open || !detail.data) return null;
    const older = s(detail.data.body);
    const live = current[open.prompt_key] ?? "";
    const lines = diffLines(older, live);
    return lines ? fold(lines) : null;
  }, [current, detail.data, open]);

  const changed = diff
    ? diff.filter((l) => l.kind === "add" || l.kind === "del").length
    : 0;

  async function restore(id: string, key: string) {
    setBusy(true);
    setNote("");
    try {
      const out = await post("/api/v1/admin/apa/prompt-revert", { id });
      setNote(`Restored “${keyName(s(out.prompt_key) || key)}” — ${num(out.chars)} characters now in force.`);
      setOpenId("");
      feed.reload();
      onRestored();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "That could not be restored.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel is-padded">
      <h2 className="act-form-title"><History size={15} /> Earlier versions</h2>
      <p className="muted">
        Every save keeps the text it replaced. The scope instruction is the one control that stops
        this being a general-purpose chatbot, so losing it to a bad paste has to be one click to
        undo rather than a search for whoever still has a copy.
      </p>

      {feed.loading ? <Loading /> : null}
      {feed.error ? <Failed message={feed.error} onRetry={feed.reload} /> : null}
      {note ? <p className="apa-state">{note}</p> : null}

      {feed.data && !feed.data.rows.length ? (
        <Empty
          title="No earlier versions yet"
          detail="One appears here the first time an instruction is changed."
        />
      ) : null}

      {feed.data?.rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Instruction</th>
                <th>Length</th>
                <th>Replaced</th>
                <th>By</th>
                <th>Why</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {feed.data.rows.map((row) => {
                const live = (current[row.prompt_key] ?? "").length;
                const delta = live ? row.chars - live : 0;
                return (
                  <tr key={row.id}>
                    <td><strong>{keyName(row.prompt_key)}</strong></td>
                    <td>
                      {num(row.chars)}
                      {live ? (
                        <small className="apa-hist-delta">
                          {delta === 0 ? "same as now" : delta > 0 ? `${num(delta)} longer than now` : `${num(-delta)} shorter than now`}
                        </small>
                      ) : null}
                    </td>
                    <td>{when(row.created_at)}</td>
                    <td>{s(row.changed_by_name) || <span className="muted">a script</span>}</td>
                    <td className="apa-hist-note">{s(row.note) || <span className="muted">—</span>}</td>
                    <td>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => setOpenId(openId === row.id ? "" : row.id)}
                      >
                        {openId === row.id ? "Close" : "Compare"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {open ? (
        <div className="apa-hist-panel">
          <div className="apa-hist-head">
            <div>
              <strong>{keyName(open.prompt_key)}</strong>
              <span className="muted">
                {" "}— the version from {when(open.created_at)}, against what is in force now
              </span>
            </div>
            <button
              type="button"
              className="btn sm"
              disabled={busy || changed === 0}
              onClick={() => void restore(open.id, open.prompt_key)}
              title={changed === 0 ? "This is already what is in force" : undefined}
            >
              <RotateCcw size={14} /> {busy ? "Restoring…" : "Restore this version"}
            </button>
          </div>

          {detail.loading ? <Loading label="Reading that version…" /> : null}
          {detail.error ? <Failed message={detail.error} onRetry={detail.reload} /> : null}

          {detail.data ? (
            diff ? (
              <>
                <p className="muted apa-hist-legend">
                  {changed === 0 ? (
                    "Identical to what is in force — nothing to restore."
                  ) : (
                    <>
                      <em className="apa-hist-key is-del">removed since</em> that version ·{" "}
                      <em className="apa-hist-key is-add">added since</em> it · {changed} changed line
                      {changed === 1 ? "" : "s"}
                    </>
                  )}
                </p>
                <div className="apa-hist-diff">
                  {diff.map((line, i) =>
                    line.kind === "gap" ? (
                      <span className="apa-hist-gap" key={i}>{line.text}</span>
                    ) : (
                      <span className={`apa-hist-line is-${line.kind}`} key={i}>
                        {line.text || " "}
                      </span>
                    )
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="muted apa-hist-legend">
                  Too long to compare line by line. The stored version is shown in full.
                </p>
                <div className="apa-hist-diff">
                  {s(detail.data.body).split("\n").map((line, i) => (
                    <span className="apa-hist-line is-same" key={i}>{line || " "}</span>
                  ))}
                </div>
              </>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
