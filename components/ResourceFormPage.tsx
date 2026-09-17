"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  ImageIcon,
  Lock,
  RotateCcw,
  Save,
  Upload
} from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import type { ManagementPageProps } from "@/components/ManagementPage";
import { getListRoute } from "@/lib/resource-routes";
import type { LookupOption } from "@/lib/admin-lookups";
import { GeoFields, type GeoValue } from "@/components/GeoFields";
import { Select, fromLookup, type SelectOption } from "@/components/Select";
import { MultiSelect, splitIds } from "@/components/MultiSelect";
import { checkShape, feeKind, fieldFromMessage, formatNote, kindOf } from "@/lib/form-validation";
import "@/components/admin-forms.css";

type Props = {
  config: ManagementPageProps;
  resource: string;
  id?: string;
};

type DetailResponse = {
  ok: boolean;
  message?: string;
  data?: {
    row?: Record<string, unknown> | null;
  };
};

type FormField = ManagementPageProps["formFields"][number];
type FeeMode = "pct" | "flat";
type Tone = "ok" | "warn" | "error";

const REQUIRED_MESSAGE = "This field is required";
const FEE_HINT = "Flat ৳/kg, when set, is used instead of a percentage.";

// Columns that make a record meaningless when blank, wherever they appear. It
// used to also hold "unit", "status", "partner_project_id", the order totals
// and the generated codes — all of which the server defaults or which are
// optional on some forms — and put a red * on "Project (optional)" and "Unit"
// on the pricing rule form. A page that needs more says `required: true`.
const REQUIRED_BY_NAME = new Set([
  "full_name",
  "phone",
  "slug",
  "name_en",
  "title_en",
  "body_en",
  "sale_category_id",
  "buy_category_id",
  "learning_category_id",
  "learning_module_id",
  "content_type",
  "user_id"
]);

// A label that says "optional" or "blank = any" is a promise to the admin;
// nothing may contradict it with an asterisk.
const OPTIONAL_LABEL = /\b(optional|blank)\b/i;

function isRequired(field: FormField) {
  if (field.readOnly) return false;
  if (OPTIONAL_LABEL.test(field.label)) return false;
  if (field.required !== undefined) return field.required === true;
  return REQUIRED_BY_NAME.has(field.name);
}

function pctKeyOf(field: FormField) {
  return field.pctName ?? `${field.name}_pct`;
}

// Decimal columns come back as "8.50" or "2.000"; nobody types those.
function trimNumber(raw: string) {
  return /^-?\d+\.\d+$/.test(raw) ? raw.replace(/\.?0+$/, "") : raw;
}

const pad = (n: number) => String(n).padStart(2, "0");

// The API serialises DATE/DATETIME as UTC ISO strings, which a date input
// silently rejects — and a rejected value then saved as blank. Convert to the
// local wall-clock form the inputs accept.
function toInputDate(raw: string, withTime: boolean) {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return withTime ? `${raw}T00:00` : raw;
  const plain = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/);
  if (plain) return withTime ? `${plain[1]}T${plain[2]}` : plain[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const day = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  return withTime ? `${day}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}` : day;
}

function getRecordValue(row: Record<string, unknown>, fieldName: string) {
  return row[fieldName] ?? row[fieldName.toUpperCase()] ?? row[fieldName.toLowerCase()];
}

function asText(raw: unknown) {
  return raw === null || raw === undefined ? "" : String(raw);
}

function valuesFromRow(fields: FormField[], row: Record<string, unknown>) {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = asText(getRecordValue(row, field.name));
    if (field.type === "fee") {
      values[field.name] = trimNumber(raw);
      values[pctKeyOf(field)] = trimNumber(asText(getRecordValue(row, pctKeyOf(field))));
    } else if (field.type === "date" || field.type === "datetime") {
      values[field.name] = toInputDate(raw, field.type === "datetime");
    } else {
      values[field.name] = raw;
    }
  }
  return values;
}

// Flat wins only when it actually holds money; a stored 0 flat next to a
// percentage is the server's default, not a choice.
function modesFromValues(fields: FormField[], values: Record<string, string>) {
  const modes: Record<string, FeeMode> = {};
  for (const field of fields) {
    if (field.type !== "fee") continue;
    const flat = Number(values[field.name]);
    modes[field.name] = values[field.name] !== "" && Number.isFinite(flat) && flat > 0 ? "flat" : "pct";
  }
  return modes;
}

// "1"/"0" option lists are booleans; show them as such, submit them unchanged.
function optionLabels(options: string[]): SelectOption[] {
  const boolean = options.length === 2 && options.every((option) => option === "1" || option === "0");
  return options.map((option) => ({ value: option, label: boolean ? (option === "1" ? "Yes" : "No") : option }));
}

// "Animal (blank = any)" -> "Any"; the empty choice should say what blank means.
function blankLabel(field: FormField) {
  const said = field.label.match(/blank\s*=\s*([^)]+)/i)?.[1]?.trim();
  return said ? said.charAt(0).toUpperCase() + said.slice(1) : "None";
}

// Every create/edit form is split into the same sections, in the same order,
// so an admin moving between a loan product and a partner project finds things
// in the same place. A field's section comes from its name unless the page says
// otherwise.
const SECTION_ORDER = ["Basics", "Details", "Pricing & numbers", "Location", "Schedule", "Settings", "Advanced"] as const;

const SECTION_BLURB: Record<string, string> = {
  Basics: "Names, codes, and the records this one links to.",
  Details: "Descriptions and text shown to farmers, in English and Bangla.",
  "Pricing & numbers": "Amounts, rates, limits and quantities.",
  Location: "Where this applies. Pick an upazila, or a district or division for a wider area.",
  Schedule: "When it starts, ends, or happened.",
  Settings: "Status, visibility and ordering.",
  Advanced: "Structured JSON. Edit with care — it is read by code."
};

// Used when sections are merged, so "Pricing & numbers" + "Location" reads
// "Pricing & location" rather than "Pricing & numbers & location".
const SECTION_SHORT: Record<string, string> = { "Pricing & numbers": "Pricing" };

// A tab holding one or two fields is a click that buys nothing, and a form
// short enough to see at once needs no tabs at all.
const MIN_SECTION_FIELDS = 3;
const SINGLE_PAGE_MAX_FIELDS = 8;

type Section = { name: string; parts: string[]; fields: FormField[] };

function sectionOf(field: FormField): string {
  if (field.section) return field.section;
  const n = field.name.toLowerCase();
  if (field.type === "geo" || /address/.test(n)) return "Location";
  if (/json|payload|metadata/.test(n)) return "Advanced";
  if (field.type === "date" || field.type === "datetime" || /(_at$|_date$|^starts|^ends|^effective_|_from$|_to$)/.test(n)) return "Schedule";
  if (field.type === "fee" || /(price|rate|fee|amount|cost|pct|percent|tenure|interest|capacity|quantity|qty|stock|weight|^min_|^max_|_months|score|limit|threshold|factor|earning|dressing|weight_kg|count)/.test(n)) return "Pricing & numbers";
  if (field.type === "textarea" || /(description|body|detail|summary|overview|note|content|answer|question|explanation|rationale|terms|benefit|ingredient|helper|message)/.test(n)) return "Details";
  if (/^(status|is_|sort_order|scope|visibility|priority|send_push|pref_|region_based|severity)/.test(n)) return "Settings";
  return "Basics";
}

function sectionName(parts: string[]) {
  if (parts.length === 1) return parts[0];
  const words = parts.map((part, index) => {
    const short = SECTION_SHORT[part] ?? part;
    const known = (SECTION_ORDER as readonly string[]).includes(part);
    return index > 0 && known ? short.toLowerCase() : short;
  });
  return words.length === 2 ? `${words[0]} & ${words[1]}` : `${words.slice(0, -1).join(", ")} & ${words[words.length - 1]}`;
}

function buildSections(fields: FormField[]): Section[] {
  const groups = new Map<string, FormField[]>();
  for (const field of fields) {
    const name = sectionOf(field);
    groups.set(name, [...(groups.get(name) ?? []), field]);
  }
  const known = SECTION_ORDER.filter((name) => groups.has(name));
  const custom = [...groups.keys()].filter((name) => !(SECTION_ORDER as readonly string[]).includes(name));
  const sections = [...known, ...custom].map((name) => ({ parts: [name], fields: groups.get(name)! }));

  // Fold the smallest undersized section into its smaller neighbour until
  // every tab carries at least MIN_SECTION_FIELDS. Neighbours only, so the
  // familiar Basics -> Advanced order survives the merge.
  while (sections.length > 1) {
    let smallest = -1;
    sections.forEach((section, index) => {
      if (section.fields.length >= MIN_SECTION_FIELDS) return;
      if (smallest < 0 || section.fields.length < sections[smallest].fields.length) smallest = index;
    });
    if (smallest < 0) break;
    const prev = sections[smallest - 1];
    const next = sections[smallest + 1];
    const partner = !prev ? smallest + 1 : !next ? smallest - 1 : next.fields.length <= prev.fields.length ? smallest + 1 : smallest - 1;
    const first = Math.min(smallest, partner);
    sections.splice(first, 2, {
      parts: [...sections[first].parts, ...sections[first + 1].parts],
      fields: [...sections[first].fields, ...sections[first + 1].fields]
    });
  }
  return sections.map((section) => ({ ...section, name: sectionName(section.parts) }));
}

function blurbOf(section: Section) {
  return section.parts.map((part) => SECTION_BLURB[part]).filter(Boolean).join(" ");
}

export function ResourceFormPage({ config, resource, id }: Props) {
  const [record, setRecord] = useState<Record<string, unknown>>({});
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [feeModes, setFeeModes] = useState<Record<string, FeeMode>>({});
  const [geoValue, setGeoValue] = useState<GeoValue>({ division_id: "", district_id: "", upazila_id: "" });
  // Remounts the geo picker on Reset — it keeps its own state between loads.
  const [geoKey, setGeoKey] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focusRequest, setFocusRequest] = useState<{ name: string; at: number } | null>(null);
  // Named options for every foreign-key field on this form, keyed by lookup name.
  const [lookups, setLookups] = useState<Record<string, LookupOption[]>>({});
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<Tone>("ok");
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const isEdit = Boolean(id);
  const listHref = useMemo(() => getListRoute(resource), [resource]);
  // The page is a server component, so every RSC re-render hands us a fresh
  // `formFields` array with the same contents. Keying the effects below on the
  // field names instead of that identity stops a stray re-render from blanking
  // a half-filled form (and wiping the "Record created" confirmation with it).
  const fieldsKey = useMemo(() => config.formFields.map((field) => `${field.name}:${field.type ?? ""}`).join("|"), [config.formFields]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const formFields = useMemo(() => config.formFields, [fieldsKey]);
  const sections = useMemo(() => buildSections(formFields), [formFields]);
  const wizard = sections.length > 1 && formFields.length > SINGLE_PAGE_MAX_FIELDS;
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  useEffect(() => { setStep(0); setVisited(new Set([0])); }, [resource, id]);

  function goTo(index: number) {
    const next = Math.max(0, Math.min(sections.length - 1, index));
    setStep(next);
    setVisited((v) => new Set(v).add(next));
  }

  function say(text: string, nextTone: Tone = "ok") {
    setMessage(text);
    setTone(nextTone);
  }

  function blankValues() {
    const values: Record<string, string> = {};
    for (const field of formFields) {
      values[field.name] = "";
      if (field.type === "fee") values[pctKeyOf(field)] = "";
    }
    return values;
  }

  function adoptValues(values: Record<string, string>) {
    setFormValues(values);
    setFeeModes(modesFromValues(formFields, values));
    setErrors({});
  }

  useEffect(() => {
    setRecord({});
    setMessage("");
    adoptValues(blankValues());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formFields, resource, id]);

  const lookupKeys = useMemo(
    () => Array.from(new Set(formFields.map((field) => field.lookup).filter(Boolean) as string[])),
    [formFields]
  );

  useEffect(() => {
    if (!lookupKeys.length) {
      setLookups({});
      setLookupState("idle");
      return;
    }
    let alive = true;
    setLookupState("loading");
    void (async () => {
      try {
        const response = await fetch(`/api/admin/lookups?keys=${lookupKeys.join(",")}`, { cache: "no-store" });
        const json = (await response.json()) as { ok: boolean; data?: Record<string, LookupOption[]> };
        if (!alive) return;
        if (json.ok && json.data) {
          setLookups(json.data);
          setLookupState("ready");
        } else {
          setLookups({});
          setLookupState("failed");
        }
      } catch {
        // A failed lookup leaves the field as a plain box rather than blocking
        // the whole form — the id can still be typed by hand.
        if (alive) {
          setLookups({});
          setLookupState("failed");
        }
      }
    })();
    return () => { alive = false; };
  }, [lookupKeys]);

  useEffect(() => {
    if (!id) return;

    async function loadRecord() {
      if (!id) return;
      setLoading(true);
      setMessage("");
      try {
        const response = await fetch(`${config.endpoint}?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const json = (await response.json()) as DetailResponse;
        if (!response.ok || !json.ok) throw new Error(json.message ?? "Could not load record.");
        const row = json.data?.row ?? {};
        setRecord(row);
        adoptValues(valuesFromRow(formFields, row));
      } catch (error) {
        say(error instanceof Error ? error.message : "Could not load record.", "error");
      } finally {
        setLoading(false);
      }
    }

    void loadRecord();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.endpoint, formFields, id]);

  // Scroll to and focus a flagged field once its section is on screen.
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      // One-shot: a later step change must not drag focus back here.
      setFocusRequest(null);
      const box = formRef.current?.querySelector<HTMLElement>(`[data-field="${focusRequest.name}"]`);
      if (!box) return;
      box.scrollIntoView({ block: "center", behavior: "smooth" });
      const control =
        box.querySelector<HTMLElement>("[data-focus]") ??
        box.querySelector<HTMLElement>("input:not([type=hidden]):not(:disabled), textarea:not(:disabled), button:not(:disabled)");
      control?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, step]);

  function resetForm() {
    adoptValues(isEdit ? valuesFromRow(formFields, record) : blankValues());
    setGeoKey((key) => key + 1);
    setMessage("");
  }

  function clearError(name: string) {
    setErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function setValue(key: string, value: string, errorKey = key) {
    setFormValues((current) => ({ ...current, [key]: value }));
    clearError(errorKey);
  }

  function valueOf(field: FormField) {
    if (field.type === "geo") return geoValue.division_id;
    if (field.type === "fee") return formValues[(feeModes[field.name] ?? "pct") === "flat" ? field.name : pctKeyOf(field)] ?? "";
    return formValues[field.name] ?? "";
  }

  // The shape a field's value must have. A `fee` field flips between a
  // percentage and a flat ৳/kg amount, so its rule follows the active half.
  function kindFor(field: FormField) {
    if (field.type === "fee") return feeKind(feeModes[field.name] ?? "pct");
    return kindOf(field, lookupState === "failed");
  }

  /** "" when the field is fine, otherwise the message to show under it. */
  function checkField(field: FormField): string {
    const value = valueOf(field).trim();
    if (!value) return isRequired(field) ? REQUIRED_MESSAGE : "";
    return checkShape(kindFor(field), value);
  }

  function problemsIn(fields: FormField[]) {
    const found: { field: FormField; message: string }[] = [];
    for (const field of fields) {
      const message = checkField(field);
      if (message) found.push({ field, message });
    }
    return found;
  }

  function sectionIndexOf(field: FormField) {
    return sections.findIndex((section) => section.fields.includes(field));
  }

  function flag(problems: { field: FormField; message: string }[]) {
    setErrors((current) => {
      const next = { ...current };
      for (const problem of problems) next[problem.field.name] = problem.message;
      return next;
    });
    jumpTo(problems[0].field);
  }

  /** Opens the field's section if the form is a wizard, then focuses the box. */
  function jumpTo(field: FormField) {
    if (wizard) {
      const index = sectionIndexOf(field);
      if (index >= 0 && index !== step) goTo(index);
    }
    setFocusRequest({ name: field.name, at: Date.now() });
  }

  // Next checks only the step being left; the tabs themselves stay free to
  // click, so an admin can look ahead without filling everything first.
  function goNext() {
    const problems = problemsIn(sections[step]?.fields ?? []);
    if (problems.length) {
      flag(problems);
      return;
    }
    goTo(step + 1);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Browser validation cannot reach a field on a hidden tab — it silently
    // refuses to submit. Check here instead, and open the section with the gap.
    const problems = problemsIn(formFields);
    if (problems.length) {
      // The summary panel below is the message; a banner saying the same thing
      // twice, one on top of the other, is noise.
      setMessage("");
      flag(problems);
      return;
    }
    setErrors({});
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    const url = isEdit ? `${config.endpoint}?id=${encodeURIComponent(id ?? "")}` : config.endpoint;

    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.message ?? "Save failed.");
      // Some saves come back with warnings (e.g. a price rule overlapping another).
      const warnings: string[] = Array.isArray(json.warnings) ? json.warnings : [];
      say(
        `${isEdit ? "Record updated successfully." : "Record created successfully."}${warnings.length ? ` Warning: ${warnings.join(" ")}` : ""}`,
        warnings.length ? "warn" : "ok"
      );
    } catch (error) {
      // The server writes its refusals for a human ("Buyer name is required.",
      // "Agreed rate must be a positive number."). When the message names one of
      // our fields, put it on that field instead of only in the banner — the
      // typed values are left untouched either way.
      const text = error instanceof Error ? error.message : "Save failed.";
      const culprit = fieldFromMessage(text, formFields);
      if (culprit) {
        setErrors((current) => ({ ...current, [culprit.name]: text }));
        jumpTo(culprit);
        // The summary below carries the server's own wording, so the banner
        // only says who refused and that the form is intact.
        say("The server refused this save. Nothing you typed was lost — fix the field marked below.", "error");
      } else {
        say(text, "error");
      }
    } finally {
      setLoading(false);
    }
  }

  async function uploadImage(field: FormField, file: File) {
    setUploading(field.name);
    clearError(field.name);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("folder", field.folder ?? "misc");
      const response = await fetch("/api/upload", { method: "POST", body });
      const json = (await response.json().catch(() => ({}))) as { ok?: boolean; url?: string; message?: string };
      if (!response.ok || !json.ok || !json.url) throw new Error(json.message ?? "Upload failed.");
      setValue(field.name, json.url);
    } catch (error) {
      setErrors((current) => ({ ...current, [field.name]: error instanceof Error ? error.message : "Upload failed." }));
    } finally {
      setUploading(null);
    }
  }

  function errorCount(section: Section) {
    return section.fields.filter((field) => errors[field.name]).length;
  }

  function stepDone(index: number) {
    if (!visited.has(index) || index === step) return false;
    return problemsIn(sections[index].fields).length === 0 && errorCount(sections[index]) === 0;
  }

  /** Every flagged field, in form order, for the summary above the fields. */
  const issues = formFields
    .filter((field) => errors[field.name])
    .map((field) => ({ field, message: errors[field.name], section: sections[sectionIndexOf(field)]?.name }));

  /** Re-check one field as the admin leaves it, so a fix clears the flag. */
  function revalidate(field: FormField) {
    const message = checkField(field);
    setErrors((current) => {
      if (!message && !(field.name in current)) return current;
      const next = { ...current };
      if (message) next[field.name] = message;
      else delete next[field.name];
      return next;
    });
  }

  function placeholderOf(field: FormField) {
    return field.value ? `e.g. ${field.value}` : undefined;
  }

  function renderControl(field: FormField, ids: { control: string; label: string; describedBy?: string }) {
    const value = formValues[field.name] ?? "";
    const readOnly = Boolean(field.readOnly);
    const required = isRequired(field);
    const invalid = Boolean(errors[field.name]);
    // Read-only controls carry no name, so FormData leaves them out.
    const name = readOnly ? undefined : field.name;
    const common = {
      id: ids.control,
      "aria-invalid": invalid || undefined,
      "aria-required": required || undefined,
      "aria-describedby": ids.describedBy
    };
    const lookupsDown = lookupState === "failed";

    switch (field.type) {
      case "geo": {
        const idOf = (key: string) => {
          const raw = record[key];
          return raw === null || raw === undefined || raw === "" ? null : String(raw);
        };
        return (
          <GeoFields
            key={geoKey}
            initial={{ division_id: idOf("division_id"), district_id: idOf("district_id"), upazila_id: idOf("upazila_id") }}
            required={required}
            disabled={readOnly}
            invalid={invalid}
            onChange={(next) => {
              setGeoValue(next);
              if (next.division_id) clearError(field.name);
            }}
          />
        );
      }

      case "fee": {
        const mode = feeModes[field.name] ?? "pct";
        const pctKey = pctKeyOf(field);
        const activeKey = mode === "flat" ? field.name : pctKey;
        const choose = (next: FeeMode) => {
          setFeeModes((current) => ({ ...current, [field.name]: next }));
          clearError(field.name);
        };
        const onSegmentKey = (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            choose(mode === "pct" ? "flat" : "pct");
          }
        };
        return (
          <div className="fee-field">
            <div className="seg" role="radiogroup" aria-labelledby={ids.label} onKeyDown={onSegmentKey}>
              {(["pct", "flat"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={mode === option}
                  tabIndex={mode === option ? 0 : -1}
                  disabled={readOnly}
                  onClick={() => choose(option)}
                >
                  {option === "pct" ? "% of live price" : "৳ flat per kg"}
                </button>
              ))}
            </div>
            <div className="input-affix">
              <input
                {...common}
                data-focus
                className="input"
                type="text"
                inputMode="decimal"
                disabled={readOnly}
                value={formValues[activeKey] ?? ""}
                placeholder={mode === "pct" ? "e.g. 2" : "e.g. 8.5"}
                onChange={(event) => setValue(activeKey, event.target.value, field.name)}
                onBlur={() => revalidate(field)}
              />
              <span className="affix" aria-hidden="true">{mode === "pct" ? "%" : "৳/kg"}</span>
            </div>
            {/* Both columns always go up: the inactive one blank, so the server
                clears it instead of keeping a stale figure that would win. */}
            {readOnly ? null : (
              <>
                <input type="hidden" name={field.name} value={mode === "flat" ? formValues[field.name] ?? "" : ""} />
                <input type="hidden" name={pctKey} value={mode === "pct" ? formValues[pctKey] ?? "" : ""} />
              </>
            )}
          </div>
        );
      }

      case "image":
        return (
          <div className="image-field">
            <span className="image-thumb" aria-hidden="true">
              {value ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={value} src={value} alt="" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
              ) : (
                <ImageIcon size={16} />
              )}
            </span>
            <input
              {...common}
              className="input"
              type="text"
              inputMode="url"
              name={name}
              disabled={readOnly}
              value={value}
              placeholder="https://… or upload a file"
              onChange={(event) => setValue(field.name, event.target.value)}
              onBlur={() => revalidate(field)}
            />
            {readOnly ? null : (
              <label className={`btn ghost btn-ctl${uploading === field.name ? " is-busy" : ""}`} aria-disabled={uploading === field.name || undefined}>
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  disabled={uploading === field.name}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void uploadImage(field, file);
                  }}
                />
                <Upload size={15} /> {uploading === field.name ? "Uploading…" : "Upload"}
              </label>
            )}
          </div>
        );

      case "multi-lookup":
        if (lookupsDown) {
          return (
            <input {...common} className="input" type="text" name={name} disabled={readOnly} value={value} placeholder="Ids, comma-separated (options did not load)" onChange={(event) => setValue(field.name, event.target.value)} />
          );
        }
        return (
          <MultiSelect
            id={ids.control}
            name={name}
            disabled={readOnly}
            invalid={invalid}
            aria-labelledby={ids.label}
            aria-describedby={ids.describedBy}
            options={fromLookup(lookups[field.lookup ?? ""] ?? [])}
            value={splitIds(value)}
            placeholder={lookupState === "loading" ? "Loading options…" : "Search and pick…"}
            onChange={(next) => setValue(field.name, next.join(","))}
          />
        );

      case "textarea":
        return (
          <textarea {...common} className="input" name={name} disabled={readOnly} value={value} placeholder={placeholderOf(field)} onChange={(event) => setValue(field.name, event.target.value)} onBlur={() => revalidate(field)} />
        );

      default:
        break;
    }

    if (field.lookup && !lookupsDown) {
      const known = fromLookup(lookups[field.lookup] ?? []);
      const options: SelectOption[] = required ? [...known] : [{ value: "", label: blankLabel(field) }, ...known];
      // A stored id whose row has since gone (or fell outside the list's limit)
      // would otherwise silently reset to blank on the next save.
      if (value && !known.some((option) => option.value === value)) options.push({ value, label: `id ${value} (not in list)` });
      return (
        <Select
          id={ids.control}
          name={name}
          disabled={readOnly}
          invalid={invalid}
          aria-describedby={ids.describedBy}
          options={options}
          value={value}
          placeholder={lookupState === "loading" ? "Loading options…" : `Select ${field.label.toLowerCase()}`}
          onChange={(next) => setValue(field.name, next)}
        />
      );
    }

    if (field.type === "select") {
      const known = optionLabels(field.options ?? []);
      const options: SelectOption[] = required ? [...known] : [{ value: "", label: "Not set" }, ...known];
      if (value && !known.some((option) => option.value === value)) options.push({ value, label: `${value} (current)` });
      return (
        <Select
          id={ids.control}
          name={name}
          disabled={readOnly}
          invalid={invalid}
          aria-describedby={ids.describedBy}
          options={options}
          value={value}
          placeholder={`Select ${field.label.toLowerCase()}`}
          onChange={(next) => setValue(field.name, next)}
        />
      );
    }

    return (
      <input
        {...common}
        className="input"
        name={name}
        type={field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text"}
        disabled={readOnly}
        value={value}
        placeholder={field.type === "date" || field.type === "datetime" ? undefined : field.lookup ? "Id (options did not load)" : placeholderOf(field)}
        onChange={(event) => setValue(field.name, event.target.value)}
        onBlur={() => revalidate(field)}
      />
    );
  }

  function renderField(field: FormField) {
    const required = isRequired(field);
    const error = errors[field.name];
    const control = `field-${field.name}`;
    const label = `${control}-label`;
    // "Required" belongs in the help text as well as on the label: the asterisk
    // is easy to miss, and the format note says what a valid value looks like
    // before the admin finds out by being refused.
    const hint = field.type === "fee" ? field.hint ?? FEE_HINT : field.hint ?? (field.readOnly ? "" : formatNote(kindFor(field)));
    // With an error showing, a "Required" chip under the same box says nothing
    // the red message above it has not already said.
    // Only when there is something to say: the "required" state is already
    // on the label (red asterisk) and on the control (aria-required).
    const showHintRow = Boolean(hint);
    const describedBy = [error ? `${control}-error` : "", showHintRow ? `${control}-hint` : ""].filter(Boolean).join(" ") || undefined;
    const wide = field.type === "textarea" || field.type === "geo" || field.type === "multi-lookup";
    return (
      <div
        className={`field${wide ? " field-wide" : ""}${error ? " has-error" : ""}${field.readOnly ? " is-readonly" : ""}`}
        key={field.name}
        data-field={field.name}
      >
        <label className="field-label" id={label} htmlFor={field.type === "geo" ? undefined : control}>
          <span className="field-label-text" title={field.label}>{field.label}</span>
          {required ? <b aria-hidden="true">*</b> : null}
          {required ? <span className="sr-only"> (required)</span> : null}
          {field.readOnly ? <span className="field-lock"><Lock size={11} aria-hidden="true" /> Read-only</span> : null}
        </label>
        {renderControl(field, { control, label, describedBy })}
        {error ? (
          <small className="field-error" id={`${control}-error`} role="alert">
            <AlertCircle size={13} aria-hidden="true" /> {error}
          </small>
        ) : null}
        {showHintRow ? (
          <small className="field-hint" id={`${control}-hint`}>
            {hint}
          </small>
        ) : null}
      </div>
    );
  }

  const current = sections[step] ?? sections[0];
  const isLast = step >= sections.length - 1;

  return (
    <AdminShell>
      {/* Full width. The right-hand "Source / Save behaviour / After save" cards
          repeated the same boilerplate on every form and took a third of the
          screen from the fields. */}
      <section className="form-head">
        <Link className="back-link" href={listHref}><ArrowLeft size={18} /> Back to list</Link>
        <p className="eyeline">{isEdit ? `Edit record · #${id}` : "Create record"}</p>
        <h1 className="page-title">{isEdit ? `Edit ${config.entityName}` : `Create ${config.entityName}`}</h1>
        <p className="subtitle">{config.description}</p>
        {wizard ? (
          <nav className="form-steps" aria-label="Form sections">
            {sections.map((section, index) => {
              const done = stepDone(index);
              const bad = errorCount(section);
              return (
                <button
                  key={section.name}
                  type="button"
                  className={`form-step${index === step ? " active" : ""}${done ? " done" : ""}${bad ? " has-errors" : ""}`}
                  onClick={() => goTo(index)}
                  aria-current={index === step ? "step" : undefined}
                  aria-label={bad ? `${section.name}, ${bad} field${bad === 1 ? "" : "s"} need attention` : undefined}
                >
                  <span className="form-step-num">{done ? <Check size={13} /> : index + 1}</span>
                  <span className="form-step-name">{section.name}</span>
                  {bad ? <span className="form-step-err">{bad}</span> : <small>{section.fields.length}</small>}
                </button>
              );
            })}
          </nav>
        ) : null}
      </section>

      <form className="resource-editor" onSubmit={submitForm} noValidate ref={formRef}>
        <section className="panel resource-form">
          <div className="panel-header form-panel-header">
            <div>
              <h2><FilePenLine size={20} /> {wizard ? current.name : `${config.entityName} information`}</h2>
              <p>{wizard ? blurbOf(current) : isEdit ? `Fields are prefilled from record #${id}.` : "Fill in the fields below. Fields marked * are required."}</p>
            </div>
            <Status label={isEdit ? "Editing" : "New record"} />
          </div>
          {message ? <div className={`notice is-${tone}`} role={tone === "error" ? "alert" : "status"}>{message}</div> : null}
          {/* One place that names every problem, because a flagged field can sit
              on a tab that is not open. Each entry jumps to its field. */}
          {issues.length ? (
            <div className="form-issues" role="alert" tabIndex={-1}>
              <p className="form-issues-head">
                <AlertTriangle size={15} aria-hidden="true" />
                {issues.length === 1 ? "1 field needs attention" : `${issues.length} fields need attention`}
              </p>
              <ul className="form-issues-list">
                {issues.map((issue) => (
                  <li key={issue.field.name}>
                    <button className="form-issues-jump" type="button" onClick={() => jumpTo(issue.field)}>
                      {issue.field.label}
                    </button>
                    <span>{issue.message}</span>
                    {wizard && issue.section ? <span className="form-issues-where">in {issue.section}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* Every section stays mounted so the form submits all of it; only
              the active one is shown. */}
          {wizard ? (
            sections.map((section, index) => (
              <div className="form-grid" key={section.name} hidden={index !== step}>
                {section.fields.map(renderField)}
              </div>
            ))
          ) : (
            <div className="form-grid">{formFields.map(renderField)}</div>
          )}
        </section>

        <div className="sticky-actions">
          <div>
            <strong>{config.entityName}</strong>
            <span>
              {loading
                ? "Saving changes..."
                : wizard
                  ? `Step ${step + 1} of ${sections.length} · ${current.name}`
                  : isEdit ? `Editing record ${id}` : "Ready to create"}
            </span>
          </div>
          <div className="form-actions">
            {wizard && step > 0 ? (
              <button className="btn ghost" type="button" onClick={() => goTo(step - 1)}><ChevronLeft size={18} /> Back</button>
            ) : null}
            {wizard && !isLast ? (
              <button className="btn ghost" type="button" onClick={goNext}>Next <ChevronRight size={18} /></button>
            ) : null}
            <button className="btn primary" disabled={loading || Boolean(uploading)} type="submit"><Save size={18} /> {isEdit ? "Save changes" : "Create"}</button>
            <button className="btn ghost" onClick={resetForm} type="button"><RotateCcw size={18} /> Reset</button>
            <Link className="btn ghost" href={listHref}>Cancel</Link>
          </div>
        </div>
      </form>
    </AdminShell>
  );
}
