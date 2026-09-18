"use client";

import { useEffect, useState } from "react";
import { Camera, Loader2, Megaphone, Send, X } from "lucide-react";
import { Select } from "@/components/Select";
import { AiAssistLaunch, AiAssistPanel } from "@/components/AiAssist";

type Row = Record<string, unknown>;
type Scope = "bangladesh" | "division" | "district" | "upazila";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: "bangladesh", label: "Everyone in Bangladesh" },
  { value: "division", label: "One division" },
  { value: "district", label: "One district" },
  { value: "upazila", label: "One upazila" }
];

const TYPES = [
  { value: "notice", label: "Notice" },
  { value: "alert", label: "Alert" },
  { value: "tip", label: "Tip / advice" },
  { value: "market", label: "Market information" }
];

/**
 * An official post, written from the console.
 *
 * The platform had no voice in its own feed: every post belongs to a farmer,
 * so a vaccination camp or a price warning had to be typed by someone on a
 * phone. This writes one through the same table with `is_official` set, and
 * resolves the target area to ids — the feed filters on ids, so a notice meant
 * for one district and saved without one would quietly go national.
 */
export function NoticeComposer({
  onPosted,
  onCancel
}: {
  onPosted: (message: string) => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<Scope>("district");
  const [type, setType] = useState("notice");
  const [body, setBody] = useState("");
  const [divisions, setDivisions] = useState<Row[]>([]);
  const [districts, setDistricts] = useState<Row[]>([]);
  const [upazilas, setUpazilas] = useState<Row[]>([]);
  const [divisionId, setDivisionId] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [image, setImage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ai, setAi] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [dv, dt] = await Promise.all([
          fetch("/api/v1/geo/divisions?surface=admin").then((r) => r.json()),
          fetch("/api/v1/geo/districts?surface=admin").then((r) => r.json())
        ]);
        setDivisions(dv?.data ?? []);
        setDistricts(dt?.data ?? []);
      } catch {
        /* the pickers stay empty and the notice can still go national */
      }
    })();
  }, []);

  // Upazilas are only fetched once a district is chosen: the full list is 499.
  useEffect(() => {
    if (!district) { setUpazilas([]); setUpazila(""); return; }
    void (async () => {
      try {
        const res = await fetch("/api/v1/geo/upazilas?surface=admin");
        const json = await res.json();
        setUpazilas((json?.data ?? []).filter((u: Row) => s(u.district) === district));
      } catch {
        setUpazilas([]);
      }
    })();
  }, [district]);

  async function upload(chosen: File) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", chosen);
      form.append("folder", "community");
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = (await res.json()) as { ok?: boolean; message?: string; url?: string };
      if (!res.ok || !json.ok || !json.url) throw new Error(json.message ?? "Upload failed.");
      setImage(json.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function post() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/app/community/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          post_type: type,
          body,
          image_url: image || undefined,
          district: scope === "district" || scope === "upazila" ? district : undefined,
          upazila: scope === "upazila" ? upazila : undefined,
          division_id: scope === "division" ? divisionId : undefined
        })
      });
      const json = (await res.json()) as { ok?: boolean; message?: string; result?: { reach?: string } };
      if (!res.ok || !json.ok) throw new Error(json.message ?? "The notice could not be posted.");
      onPosted(`Official notice posted to ${json.result?.reach ?? "the feed"}.`);
      setBody("");
      setImage("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The notice could not be posted.");
    } finally {
      setBusy(false);
    }
  }

  const targeted =
    scope === "bangladesh" ||
    (scope === "division" && divisionId) ||
    (scope === "district" && district) ||
    (scope === "upazila" && district && upazila);
  const ready = body.trim().length >= 10 && targeted;

  return (
    <section className="panel is-padded notice-composer">
      <div className="notice-head">
        <h3><Megaphone size={15} /> Official notice</h3>
        <button type="button" className="btn sm" onClick={onCancel}><X size={14} /> Close</button>
      </div>
      <p className="muted">
        Posted with the official flag, which the app sorts to the top of the feed. Reach is saved as ids, so the
        notice only reaches the area chosen here.
      </p>

      <div className="form-grid notice-grid">
        <div className="field">
          <label className="field-label"><span className="field-label-text">Who sees it</span><b aria-hidden="true">*</b></label>
          <Select value={scope} options={SCOPES} onChange={(v) => setScope(v as Scope)} />
        </div>
        <div className="field">
          <label className="field-label"><span className="field-label-text">Kind</span></label>
          <Select value={type} options={TYPES} onChange={setType} />
        </div>

        {scope === "division" ? (
          <div className="field">
            <label className="field-label"><span className="field-label-text">Division</span><b aria-hidden="true">*</b></label>
            <Select
              value={divisionId}
              placeholder="Pick a division"
              options={divisions.map((d) => ({ value: s(d.id), label: s(d.name) }))}
              onChange={setDivisionId}
            />
          </div>
        ) : null}

        {scope === "district" || scope === "upazila" ? (
          <div className="field">
            <label className="field-label"><span className="field-label-text">District</span><b aria-hidden="true">*</b></label>
            <Select
              value={district}
              placeholder="Pick a district"
              options={districts.map((d) => ({ value: s(d.name), label: s(d.name), group: s(d.division) }))}
              onChange={(v) => { setDistrict(v); setUpazila(""); }}
            />
          </div>
        ) : null}

        {scope === "upazila" ? (
          <div className="field">
            <label className="field-label"><span className="field-label-text">Upazila</span><b aria-hidden="true">*</b></label>
            <Select
              value={upazila}
              placeholder={district ? "Pick an upazila" : "Pick a district first"}
              options={upazilas.map((u) => ({ value: s(u.name), label: s(u.name) }))}
              onChange={setUpazila}
            />
          </div>
        ) : null}

        <div className="field field-wide">
          <label className="field-label">
            <span className="field-label-text">The notice</span><b aria-hidden="true">*</b>
            <AiAssistLaunch
              label="Community notice"
              hasText={Boolean(body.trim())}
              canTranslate={false}
              onOpen={() => setAi(true)}
            />
          </label>
          <textarea
            className="input"
            rows={4}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write it as a farmer would read it — what is happening, where, and what they should do."
          />
          {ai ? (
            <AiAssistPanel
              label="Community notice"
              resource="community/posts"
              length="medium"
              language="bn"
              value={body}
              context={() => ({
                kind: type,
                audience: scope === "bangladesh" ? "all farmers in Bangladesh" : upazila || district || "the chosen division",
                district,
                upazila
              })}
              onInsert={setBody}
              onClose={() => setAi(false)}
            />
          ) : null}
          <small className="field-hint">
            {body.trim().length < 10 ? "At least a sentence." : `${body.trim().length} characters.`}
          </small>
        </div>
      </div>

      <div className="notice-media">
        <label className="btn sm">
          {uploading ? <Loader2 size={14} className="ai-spin" /> : <Camera size={14} />} Add a photo
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void upload(chosen);
              event.target.value = "";
            }}
          />
        </label>
        {image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="" className="notice-thumb" />
            <button type="button" className="btn sm" onClick={() => setImage("")}><X size={13} /> Remove</button>
          </>
        ) : null}
      </div>

      {error ? <p className="act-note is-bad">{error}</p> : null}

      <div className="act-actions">
        <button className="btn primary" type="button" onClick={() => void post()} disabled={busy || !ready}>
          {busy ? <Loader2 size={16} className="ai-spin" /> : <Send size={16} />} Post the notice
        </button>
        <span className="ai-panel-note">
          {!targeted ? "Choose the area it is for." : !body.trim() ? "Write the notice." : "Appears at the top of the feed for that area."}
        </span>
      </div>
    </section>
  );
}
