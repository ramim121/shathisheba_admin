"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";

// The Loan Application Workspace (SRS §18).
//
// Three panes: the applicant and the capture sections on the left, the score on
// the right, the requirement checklist above both. The checklist is computed by
// the server rather than remembered by the officer — a checklist someone has to
// hold in their head is a checklist that gets skipped on the busy day.
//
// Only the sections the scorecard actually reads are editable here: financial
// profile, existing debt, enterprise experience, behavioural score, and the
// eleven-item field verification. The remaining §18.3 sections are captured
// through the existing KYC and profile surfaces.

type Checklist = { key: string; label: string; done: boolean; blocking: boolean };

type Workspace = {
  application: Record<string, string | number | null>;
  checklist: Checklist[];
  ready_to_score: boolean;
  evidence: { section: string; field_key: string; value_text: string | null; value_number: string | null; source_type: string; verification_status: string }[];
  debts: Record<string, string | number | null>[];
  assets: Record<string, string | number | null>[];
  verifications: { code: string; label_en: string; label_bn: string; verdict: string | null; comment: string | null }[];
  documents: Record<string, string | number | null>[];
  safeguards: Record<string, string | number | null>[];
  visits: Record<string, string | number | null>[];
  events: { to_status: string; actor_type: string; note_en: string | null; created_at: string }[];
  coverage: Record<string, number>;
};

type Assessment = {
  assessment: Record<string, string | number | null> | null;
  criteria: Record<string, string | number | null>[];
  history: Record<string, string | number | null>[];
};

const VERDICTS = ["verified", "partially_verified", "self_reported_only", "unable_to_verify", "contradictory"] as const;

const VERDICT_LABEL: Record<string, string> = {
  verified: "Verified",
  partially_verified: "Partly verified",
  self_reported_only: "Self-reported",
  unable_to_verify: "Could not verify",
  contradictory: "Contradictory",
};

const SOURCE_TYPES = ["self_reported", "field_observed", "document", "cooperative", "transaction"] as const;

// The fields the scorecard reads, grouped as the officer captures them.
const CAPTURE = [
  {
    section: "financial",
    title: "Financial profile",
    hint: "Cash flow is the heaviest criterion at 25 points. Surplus divided by the proposed instalment is the DSCR.",
    fields: [
      { key: "monthly_income_total", label: "Total monthly income (৳)" },
      { key: "monthly_expense_total", label: "Total monthly expenses (৳)" },
      { key: "proposed_installment", label: "Proposed instalment (৳)" },
    ],
  },
  {
    section: "enterprise",
    title: "Enterprise",
    hint: "Years running this enterprise. Ten points.",
    fields: [{ key: "years_experience", label: "Years of experience" }],
  },
  {
    section: "mpoweru",
    title: "Behavioural assessment",
    hint: "Normalised 0–100 band from mPowerU. Twenty points. Leave empty until the assessment completes — an absent score rates 0 and is flagged, never guessed.",
    fields: [{ key: "normalised_score", label: "Normalised score (0–100)" }],
  },
];

function taka(v: string | number | null | undefined) {
  const n = Number(v ?? 0);
  return `৳${n.toLocaleString("en-BD", { maximumFractionDigits: 0 })}`;
}

/** "2026-08-18T06:09:00.000Z" -> "18 Aug 2026, 12:09". */
function when(v: unknown, withTime = true): string {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 16).replace("T", " ");
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function humanise(v: unknown): string {
  return String(v ?? "").replace(/_/g, " ");
}

/** A labelled coverage meter. Two numbers in a sentence do not read as a gap. */
function Meter({ label, done, total }: { label: string; done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const tone = pct === 100 ? "full" : pct >= 60 ? "part" : "low";
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <strong>{done}/{total}</strong>
      </div>
      <div className="meter-track"><div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

type RowField = { name: string; label: string; type: string; options?: string[] };

/**
 * The add-a-row form for the repeating collections. One component rather than
 * four: the fields differ, everything else — clear on submit, disable while
 * saving, never submit an empty row — does not.
 */
function RowForm({
  label, fields, busy, onSubmit,
}: {
  label: string;
  fields: RowField[];
  busy: boolean;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="btn small add" onClick={() => setOpen(true)} disabled={busy}>
        + {label}
      </button>
    );
  }

  return (
    <div className="rowform">
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.type === "select" ? (
            <select
              value={values[f.name] ?? f.options?.[0] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            >
              {(f.options ?? []).map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
            </select>
          ) : (
            <input
              type={f.type}
              value={values[f.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
          )}
        </label>
      ))}
      <div className="rowform-actions">
        <button
          className="btn small primary"
          disabled={busy}
          onClick={() => {
            const payload: Record<string, string> = {};
            for (const f of fields) {
              const v = values[f.name] ?? (f.type === "select" ? f.options?.[0] ?? "" : "");
              if (v !== "") payload[f.name] = v;
            }
            onSubmit(payload);
            setValues({});
            setOpen(false);
          }}
        >
          Save
        </button>
        <button className="btn small" onClick={() => { setValues({}); setOpen(false); }} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function LoanWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Workspace | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [verdicts, setVerdicts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [w, a] = await Promise.all([
      fetch(`/api/v1/admin/loan/workspace?application_id=${id}`).then((r) => r.json()),
      fetch(`/api/v1/admin/loan/assessment?application_id=${id}`).then((r) => r.json()),
    ]);
    if (!w.ok) { setMessage(w.message ?? "Could not load this application."); return; }
    const ws: Workspace = w.data;
    setData(ws);
    setAssessment(a.data ?? null);

    const nextValues: Record<string, string> = {};
    const nextSources: Record<string, string> = {};
    const nextVerified: Record<string, boolean> = {};
    for (const e of ws.evidence) {
      const k = `${e.section}.${e.field_key}`;
      nextValues[k] = e.value_number != null ? String(e.value_number) : String(e.value_text ?? "");
      nextSources[k] = e.source_type;
      nextVerified[k] = e.verification_status === "verified";
    }
    setValues(nextValues);
    setSources(nextSources);
    setVerified(nextVerified);
    setVerdicts(Object.fromEntries(ws.verifications.map((v) => [v.code, v.verdict ?? "self_reported_only"])));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function post(path: string, body: unknown, ok: string) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setMessage(json.ok ? ok : json.message ?? "That did not save.");
      if (json.ok) await load();
    } catch {
      setMessage("The request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  function saveEvidence() {
    const fields = CAPTURE.flatMap((group) =>
      group.fields
        .filter((f) => (values[`${group.section}.${f.key}`] ?? "").trim() !== "")
        .map((f) => {
          const k = `${group.section}.${f.key}`;
          return {
            section: group.section,
            field_key: f.key,
            value_number: values[k],
            source_type: sources[k] ?? "self_reported",
            verification_status: verified[k] ? "verified" : "unverified",
            confidence: verified[k] ? "high" : "low",
          };
        })
    );
    // The debt section being "complete" is a deliberate statement, not an
    // inference. Without it, zero recorded debts is treated as "never asked"
    // rather than "asked, and there is none" — which is the difference between
    // rating 0 and rating 5 on a fifteen-point criterion.
    fields.push({
      section: "financial",
      field_key: "debt_section_complete",
      value_number: "",
      source_type: "field_observed",
      verification_status: "verified",
      confidence: "high",
    });
    if (fields.length === 0) { setMessage("Nothing to save yet."); return; }
    post("admin/loan/evidence", { application_id: Number(id), fields }, `Saved ${fields.length} fields.`);
  }

  function saveVerification() {
    const items = Object.entries(verdicts).map(([item_code, verdict]) => ({ item_code, verdict }));
    post("admin/loan/verification", { application_id: Number(id), items }, "Field verification saved.");
  }

  function runAssessment() {
    post("admin/loan/assess", { application_id: Number(id) }, "Assessment complete.");
  }

  function addRow(collection: string, values: Record<string, string>) {
    post(`admin/loan/rows/${collection}`, { application_id: Number(id), ...values }, "Saved.");
  }
  function patchRow(collection: string, rowId: string, values: Record<string, string>) {
    post(`admin/loan/rows/${collection}`, { application_id: Number(id), id: rowId, ...values }, "Updated.");
  }
  function removeRow(collection: string, rowId: string) {
    post(`admin/loan/rows/${collection}`, { application_id: Number(id), id: rowId, delete: true }, "Removed.");
  }

  if (!data) {
    return (
      <AdminShell>
        <section className="panel"><p className="muted">{message || "Loading…"}</p></section>
        <style jsx>{`.muted { color:#7A6570; font-size:13px; }`}</style>
      </AdminShell>
    );
  }

  const app = data.application;
  const live = assessment?.assessment ?? null;
  const blocking = data.checklist.filter((c) => c.blocking);

  return (
    <AdminShell>
      <section className="panel">
        <div className="ws-head">
          <div>
            <p className="ws-eyebrow">Loan &amp; Credit · {String(app.application_code)}</p>
            <h2 className="ws-name">{String(app.full_name)}</h2>
            <p className="muted">
              {String(app.phone ?? "—")} · {String(app.district ?? "—")} · {String(app.product_name)} ·{" "}
              {taka(app.requested_amount)} over {String(app.tenure_months)} months
            </p>
            <p className="muted">NID {String(app.nid_number ?? "not recorded")}</p>
          </div>
          <Link href="/loan/applications" className="ws-back">← All applications</Link>
        </div>

        {Number(app.manual_review_required) === 1 ? (
          <div className="ws-alert">
            <strong>Manual review required.</strong> {String(app.manual_review_reason ?? "")}
          </div>
        ) : null}

        {/* Requirement checklist (§18.2) */}
        <div className="ws-checklist">
          {data.checklist.map((c) => (
            <span key={c.key} className={`ws-chip ${c.done ? "on" : c.blocking ? "block" : "off"}`}>
              {c.done ? "✓" : c.blocking ? "!" : "○"} {c.label}
            </span>
          ))}
        </div>
        <div className="ws-meters">
          <Meter
            label="Material fields verified"
            done={data.coverage.material_fields_verified}
            total={data.coverage.material_fields_total}
          />
          <Meter
            label="Field verification items"
            done={data.coverage.verification_items_verified}
            total={data.coverage.verification_items_total}
          />
        </div>
        {data.coverage.contradictory_count > 0 ? (
          <p className="ws-contra">
            {data.coverage.contradictory_count} contradictory verdict
            {data.coverage.contradictory_count > 1 ? "s" : ""} — manual review is mandatory and progression is
            blocked until they are resolved.
          </p>
        ) : null}
      </section>

      {message ? <section className="panel"><p className="ws-msg">{message}</p></section> : null}

      <div className="ws-grid">
        <div className="ws-col">
          {CAPTURE.map((group) => (
            <section className="panel" key={group.section}>
              <h3 className="ws-h3">{group.title}</h3>
              <p className="muted ws-hint">{group.hint}</p>
              {group.fields.map((f) => {
                const k = `${group.section}.${f.key}`;
                return (
                  <div className="ws-field" key={k}>
                    <label htmlFor={k}>{f.label}</label>
                    <input
                      id={k}
                      type="number"
                      value={values[k] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                    />
                    <select
                      aria-label={`${f.label} source`}
                      value={sources[k] ?? "self_reported"}
                      onChange={(e) => setSources((s) => ({ ...s, [k]: e.target.value }))}
                    >
                      {SOURCE_TYPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                    </select>
                    <label className="ws-check">
                      <input
                        type="checkbox"
                        checked={verified[k] ?? false}
                        onChange={(e) => setVerified((v) => ({ ...v, [k]: e.target.checked }))}
                      />
                      verified
                    </label>
                  </div>
                );
              })}
            </section>
          ))}

          <section className="panel">
            <h3 className="ws-h3">Existing debt</h3>
            <p className="muted ws-hint">
              Informal, family and supplier credit count here as much as bank debt. A borrower whose only
              recorded obligations are formal looks safer than they are — and that is exactly the applicant
              the scorecard must not over-rate.
            </p>
            {data.debts.length === 0 ? (
              <p className="muted">
                None recorded. Saving the financial profile marks this section as asked, so zero is scored as
                a genuine zero rather than a gap.
              </p>
            ) : (
              <table className="table">
                <thead><tr><th>Lender</th><th>Type</th><th>Outstanding</th><th>Instalment</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {data.debts.map((d) => (
                    <tr key={String(d.id)}>
                      <td>{String(d.lender_name)}</td>
                      <td>{String(d.lender_type)}</td>
                      <td>{taka(d.outstanding_amount)}</td>
                      <td>{taka(d.installment_amount)}</td>
                      <td>{String(d.payment_status).replace(/_/g, " ")}</td>
                      <td>
                        <button className="btn small" onClick={() => removeRow("debts", String(d.id))} disabled={busy}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <RowForm
              busy={busy}
              label="Add a debt"
              fields={[
                { name: "lender_name", label: "Lender", type: "text" },
                { name: "lender_type", label: "Type", type: "select", options: ["bank", "mfi", "cooperative", "supplier", "informal", "family", "other"] },
                { name: "outstanding_amount", label: "Outstanding (৳)", type: "number" },
                { name: "installment_amount", label: "Instalment (৳)", type: "number" },
                { name: "installment_freq", label: "Frequency", type: "select", options: ["monthly", "weekly", "biweekly", "quarterly", "seasonal", "one_time"] },
                { name: "payment_status", label: "Payment status", type: "select", options: ["current", "1_30_late", "31_60_late", "61_90_late", "over_90_late", "rescheduled", "defaulted"] },
              ]}
              onSubmit={(values) => addRow("debts", values)}
            />
          </section>

          <section className="panel">
            <h3 className="ws-h3">Productive assets</h3>
            <p className="muted ws-hint">
              Land, livestock, sheds and machinery. Feeds enterprise economics and gives the field visit
              something specific to verify.
            </p>
            {data.assets.length === 0 ? <p className="muted">None recorded.</p> : (
              <table className="table">
                <thead><tr><th>Type</th><th>Description</th><th>Qty</th><th>Value</th><th>Ownership</th><th>Verified</th><th /></tr></thead>
                <tbody>
                  {data.assets.map((x) => (
                    <tr key={String(x.id)}>
                      <td>{String(x.asset_type)}</td>
                      <td>{String(x.description ?? "—")}</td>
                      <td>{String(x.quantity)} {String(x.unit ?? "")}</td>
                      <td>{taka(x.estimated_value)}</td>
                      <td>{String(x.ownership_status)}</td>
                      <td>{String(x.verification_status).replace(/_/g, " ")}</td>
                      <td>
                        <button className="btn small" onClick={() => removeRow("assets", String(x.id))} disabled={busy}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <RowForm
              busy={busy}
              label="Add an asset"
              fields={[
                { name: "asset_type", label: "Type", type: "select", options: ["land", "cattle", "shed", "machinery", "equipment", "inventory", "premises", "other"] },
                { name: "description", label: "Description", type: "text" },
                { name: "quantity", label: "Quantity", type: "number" },
                { name: "unit", label: "Unit", type: "text" },
                { name: "estimated_value", label: "Value (৳)", type: "number" },
                { name: "ownership_status", label: "Ownership", type: "select", options: ["owned", "leased", "shared", "mortgaged", "disputed", "unknown"] },
                { name: "verification_status", label: "Verification", type: "select", options: ["unverified", "verified", "partially_verified", "unable_to_verify", "contradictory"] },
              ]}
              onSubmit={(values) => addRow("assets", values)}
            />
          </section>

          <section className="panel">
            <h3 className="ws-h3">Documents</h3>
            <p className="muted ws-hint">
              Files live in the private S3 folder and are served through the ownership-checked route; only the
              key is stored. A required document that is not verified blocks the checklist.
            </p>
            {data.documents.length === 0 ? <p className="muted">None uploaded.</p> : (
              <table className="table">
                <thead><tr><th>Document</th><th>Required</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {data.documents.map((d) => (
                    <tr key={String(d.id)}>
                      <td>{humanise(d.doc_type)}</td>
                      <td>{Number(d.is_required) === 1 ? "Yes" : "No"}</td>
                      <td><span className={`docstat s-${String(d.status)}`}>{humanise(d.status)}</span></td>
                      <td className="row-actions">
                        {d.status !== "verified" ? (
                          <button className="btn small" onClick={() => patchRow("documents", String(d.id), { status: "verified" })} disabled={busy}>
                            Verify
                          </button>
                        ) : null}
                        {d.status !== "rejected" ? (
                          <button className="btn small" onClick={() => patchRow("documents", String(d.id), { status: "rejected", rejection_reason: "Illegible or incorrect" })} disabled={busy}>
                            Reject
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <RowForm
              busy={busy}
              label="Record a document"
              fields={[
                { name: "doc_type", label: "Document type", type: "text" },
                { name: "file_key", label: "S3 key", type: "text" },
                { name: "is_required", label: "Required", type: "select", options: ["1", "0"] },
                { name: "status", label: "Status", type: "select", options: ["uploaded", "verified", "rejected", "expired", "re_requested"] },
              ]}
              onSubmit={(values) => addRow("documents", values)}
            />
          </section>

          <section className="panel">
            <h3 className="ws-h3">Field visits</h3>
            <p className="muted ws-hint">Propose a slot, then record the visit once it happens.</p>
            {data.visits.length === 0 ? <p className="muted">No visits scheduled.</p> : (
              <table className="table">
                <thead><tr><th>Proposed</th><th>Status</th><th>Note</th><th /></tr></thead>
                <tbody>
                  {data.visits.map((v) => (
                    <tr key={String(v.id)}>
                      <td>{when(v.proposed_at)}</td>
                      <td>{humanise(v.status)}</td>
                      <td>{String(v.note ?? "—")}</td>
                      <td className="row-actions">
                        {v.status !== "completed" ? (
                          <button className="btn small" onClick={() => patchRow("visits", String(v.id), { status: "completed", completed_at: new Date().toISOString().slice(0, 19).replace("T", " ") })} disabled={busy}>
                            Mark done
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <RowForm
              busy={busy}
              label="Propose a visit"
              fields={[
                { name: "proposed_at", label: "Date and time", type: "datetime-local" },
                { name: "note", label: "Note", type: "text" },
              ]}
              onSubmit={(values) => addRow("visits", values)}
            />
          </section>

          <section className="panel">
            <h3 className="ws-h3">Field verification</h3>
            <p className="muted ws-hint">
              Eleven items, five verdicts. A contradictory verdict raises mandatory manual review and blocks
              progression — it is not a softer version of “could not verify”.
            </p>
            {data.verifications.map((v) => (
              <div className="ws-verify" key={v.code}>
                <span>{v.label_en}</span>
                <select
                  aria-label={v.label_en}
                  value={verdicts[v.code] ?? "self_reported_only"}
                  onChange={(e) => setVerdicts((s) => ({ ...s, [v.code]: e.target.value }))}
                >
                  {VERDICTS.map((d) => <option key={d} value={d}>{VERDICT_LABEL[d]}</option>)}
                </select>
              </div>
            ))}
            <button className="btn" onClick={saveVerification} disabled={busy}>Save verification</button>
          </section>

        </div>

        {/* The rail travels with the officer. Both actions used to sit at the
            foot of a page tall enough to hold six capture sections, so the one
            control the whole screen exists for was off-screen for most of the
            time spent on it. */}
        <div className="ws-col ws-rail">
          <section className="panel">
            <h3 className="ws-h3">Actions</h3>
            <div className="ws-actions">
              <button className="btn primary" onClick={saveEvidence} disabled={busy}>Save captured data</button>
              <button className="btn primary" onClick={runAssessment} disabled={busy || !data.ready_to_score}>
                Run assessment
              </button>
            </div>
            {!data.ready_to_score ? (
              <div className="ws-blocked">
                <strong>Cannot score yet.</strong>
                <ul>
                  {blocking.filter((c) => !c.done).map((c) => <li key={c.key}>{c.label}</li>)}
                </ul>
              </div>
            ) : (
              <p className="muted">Every blocking requirement is met. Scoring will supersede any earlier run.</p>
            )}
          </section>

          <section className="panel">
            <h3 className="ws-h3">Assessment</h3>
            {!live ? (
              <p className="muted">Not scored yet.</p>
            ) : (
              <>
                <div className="ws-score">
                  <span className={`ws-grade g${String(live.grade)}`}>{String(live.grade)}</span>
                  <div className="ws-score-body">
                    <strong>{String(live.total_score)} <span className="ws-outof">/ 100</span></strong>
                    <div className="ws-score-chips">
                      <span className="ws-pill">{humanise(live.readiness_status)}</span>
                      <span className="ws-pill">{humanise(live.data_confidence)} confidence</span>
                    </div>
                  </div>
                </div>
                {Number(live.hard_stop) === 1 ? (
                  <div className="ws-alert">Hard stop — {String(live.hard_stop_codes_json ?? "")}</div>
                ) : null}
                {/* One bar per criterion, scaled against its own weight. The
                    numbers alone made it hard to see which criterion actually
                    cost the applicant the grade. */}
                <div className="crit">
                  {(assessment?.criteria ?? []).map((c) => {
                    const weight = Number(c.weight ?? 0);
                    const got = Number(c.weighted_score ?? 0);
                    const pct = weight > 0 ? Math.max(0, Math.min(100, Math.round((got / weight) * 100))) : 0;
                    return (
                      <div className="crit-row" key={String(c.criterion_code)}>
                        <div className="crit-head">
                          <span>
                            {humanise(c.criterion_code)}
                            {Number(c.had_data) === 0 ? <span className="ws-nodata"> no data</span> : null}
                            {c.override_rating != null ? (
                              <span className="ws-nodata"> overridden from {String(c.computed_rating)}</span>
                            ) : null}
                          </span>
                          <strong>{got} <span className="ws-outof">/ {weight}</span></strong>
                        </div>
                        <div className="meter-track">
                          <div
                            className={`meter-fill ${pct >= 80 ? "full" : pct >= 50 ? "part" : "low"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {(assessment?.history ?? []).length > 1 ? (
                  <p className="muted ws-hint">
                    {(assessment?.history ?? []).length} assessments. Each run supersedes the last; none are edited.
                  </p>
                ) : null}
              </>
            )}
          </section>

          <section className="panel">
            <h3 className="ws-h3">Timeline</h3>
            {data.events.length === 0 ? <p className="muted">Nothing recorded yet.</p> : (
              <ul className="ws-timeline">
                {data.events.slice(0, 12).map((e, i) => (
                  <li key={i}>
                    <strong>{humanise(e.to_status)}</strong>
                    <span className="muted"> · {humanise(e.actor_type)} · {when(e.created_at)}</span>
                    {e.note_en ? <p className="muted">{e.note_en}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <style jsx>{`
        .ws-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; }
        .ws-eyebrow { margin:0 0 4px; font-size:11.5px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:#9B5173; }
        .ws-name { margin:0; font-size:20px; color:#2B0B1E; }
        .ws-back { color:#871449; font-size:13px; text-decoration:none; white-space:nowrap; }
        .muted { color:#7A6570; font-size:13px; margin:4px 0 0; }
        .ws-alert { margin-top:12px; padding:10px 12px; border-radius:8px; background:#FDECEA; color:#8A2F28; font-size:13px; }
        .ws-checklist { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
        .ws-chip { font-size:12px; padding:4px 10px; border-radius:999px; border:1px solid #EBDDE4; color:#7A6570; }
        .ws-chip.on { background:#E6F5ED; border-color:#B7E0C9; color:#1E7A46; }
        .ws-chip.block { background:#FDECEA; border-color:#F0C4BF; color:#8A2F28; }
        .ws-meters { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-top:14px; }
        .ws-contra { margin:12px 0 0; padding:10px 12px; border-radius:8px; background:#FDECEA; color:#8A2F28; font-size:13px; }
        .ws-msg { color:#871449; font-size:13.5px; margin:0; }
        .ws-grid { display:grid; grid-template-columns: 1.35fr 1fr; gap:16px; align-items:start; }
        @media (max-width: 1000px) { .ws-grid { grid-template-columns: 1fr; } }
        .ws-col { display:flex; flex-direction:column; gap:16px; min-width:0; }
        .ws-h3 { margin:0 0 4px; font-size:15px; color:#2B0B1E; }
        .ws-hint { margin-bottom:12px; }
        .ws-field { display:grid; grid-template-columns: 1.4fr 1fr 1fr auto; gap:10px; align-items:center; margin-top:10px; }
        @media (max-width: 720px) { .ws-field { grid-template-columns: 1fr; } }
        .ws-field label { font-size:13px; color:#4A3540; }
        .ws-field input[type=number], .ws-field select { padding:8px 10px; border:1px solid #EBDDE4; border-radius:8px; font-size:13.5px; min-width:0; }
        .ws-check { display:flex; align-items:center; gap:6px; font-size:12.5px; color:#7A6570; }
        .ws-verify { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 0; border-top:1px solid #F4E8EE; font-size:13.5px; color:#4A3540; }
        .ws-verify:first-of-type { border-top:none; }
        .ws-verify select { padding:6px 8px; border:1px solid #EBDDE4; border-radius:8px; font-size:13px; }
        .ws-actions { display:flex; gap:10px; flex-wrap:wrap; }
        .ws-blocked { margin-top:12px; padding:10px 12px; border-radius:8px; background:#FDECEA; color:#8A2F28; font-size:13px; }
        .ws-blocked ul { margin:6px 0 0; padding-left:18px; }
        .ws-blocked li { margin-top:2px; }
        /* Sticky only where there is room for it; on a narrow screen the rail
           stacks under the capture column and pinning it would cover content. */
        @media (min-width: 1001px) { .ws-rail { position:sticky; top:16px; } }
        .ws-actions { flex-direction:column; align-items:stretch; }
        .ws-actions .btn { width:100%; }
        .meter { min-width:0; }
        .meter-head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-size:12.5px; color:#7A6570; }
        .meter-head strong { color:#2B0B1E; font-size:13px; }
        .meter-track { height:8px; border-radius:999px; background:#F0E4EA; margin-top:6px; overflow:hidden; }
        .meter-fill { height:8px; border-radius:999px; background:#871449; }
        .meter-fill.full { background:#1E9E5A; }
        .meter-fill.part { background:#D97706; }
        .meter-fill.low { background:#B4443C; }
        .crit { display:flex; flex-direction:column; gap:12px; margin-top:12px; }
        .crit-head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; font-size:13px; color:#2B0B1E; }
        .crit-head strong { white-space:nowrap; }
        .ws-outof { color:#9B8792; font-weight:600; font-size:12px; }
        .ws-score-body strong { font-size:26px; color:#2B0B1E; }
        .ws-score-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
        .ws-pill { font-size:11.5px; padding:3px 9px; border-radius:999px; background:#F4E8EE; color:#7A2352; font-weight:600; }
        .docstat { font-size:12px; padding:2px 8px; border-radius:999px; background:#F3EEF1; color:#7A6570; }
        .docstat.s-verified { background:#E6F5ED; color:#1E7A46; }
        .docstat.s-rejected { background:#FDECEA; color:#8A2F28; }
        .btn { padding:9px 16px; border-radius:8px; border:1px solid #EBDDE4; background:#fff; color:#871449; font-size:13.5px; font-weight:600; cursor:pointer; margin-top:12px; }
        .btn.primary { background:#871449; color:#fff; border-color:#871449; }
        .btn.small { padding:5px 10px; font-size:12px; margin-top:0; white-space:nowrap; }
        .btn.add { margin-top:12px; }
        .btn:disabled { opacity:.5; cursor:not-allowed; }
        .row-actions { display:flex; gap:6px; }
        .rowform { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin-top:14px; padding-top:14px; border-top:1px solid #F4E8EE; }
        .rowform label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:#7A6570; }
        .rowform input, .rowform select { padding:7px 9px; border:1px solid #EBDDE4; border-radius:8px; font-size:13px; min-width:0; }
        .rowform-actions { display:flex; gap:8px; align-items:flex-end; }
        .ws-score { display:flex; align-items:center; gap:14px; margin:8px 0 14px; }
        .ws-grade { width:56px; height:56px; border-radius:28px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:26px; color:#fff; flex:none; }
        .gA { background:#1E9E5A; } .gB { background:#2563EB; } .gC { background:#D97706; } .gD { background:#B4443C; }
        .ws-nodata { color:#B4443C; font-size:11.5px; }
        .table { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
        .table th { text-align:left; color:#7A6570; font-weight:600; padding:6px 8px; border-bottom:1px solid #F4E8EE; }
        .table td { padding:6px 8px; border-bottom:1px solid #FAF4F7; color:#2B0B1E; }
        .ws-timeline { list-style:none; margin:0; padding:0; }
        .ws-timeline li { padding:8px 0; border-top:1px solid #F4E8EE; font-size:13px; color:#2B0B1E; }
        .ws-timeline li:first-child { border-top:none; }
      `}</style>
    </AdminShell>
  );
}
