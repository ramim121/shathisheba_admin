"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Database, FilePenLine, Info, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import type { ManagementPageProps } from "@/components/ManagementPage";
import { getListRoute } from "@/lib/resource-routes";
import type { LookupOption } from "@/lib/admin-lookups";

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

// Options arrive already sorted by group; emit <optgroup> so a long list (every
// district, every breed) stays scannable.
function renderLookupOptions(options: LookupOption[]) {
  const grouped = options.some((option) => option.group);
  if (!grouped) {
    return options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>);
  }
  const groups: Array<{ name: string; items: LookupOption[] }> = [];
  for (const option of options) {
    const name = option.group ?? "Other";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(option);
    else groups.push({ name, items: [option] });
  }
  return groups.map((group, index) => (
    <optgroup key={`${group.name}-${index}`} label={group.name}>
      {group.items.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </optgroup>
  ));
}

export function ResourceFormPage({ config, resource, id }: Props) {
  const [record, setRecord] = useState<Record<string, unknown>>({});
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  // Named options for every foreign-key field on this form, keyed by lookup name.
  const [lookups, setLookups] = useState<Record<string, LookupOption[]>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const isEdit = Boolean(id);
  const listHref = useMemo(() => getListRoute(resource), [resource]);
  const requiredFields = useMemo(
    () => new Set(["full_name", "phone", "slug", "name_en", "title_en", "body_en", "district", "starts_at", "update_type", "sale_category_id", "buy_category_id", "sku", "unit", "price", "stock_qty", "order_code", "user_id", "total_amount", "payable_amount", "delivery_address", "learning_category_id", "learning_module_id", "content_type", "project_code", "application_code", "partner_project_id", "current_step", "scope", "post_type", "body", "status"]),
    []
  );

  function getBlankValues() {
    return Object.fromEntries(config.formFields.map((field) => [field.name, ""]));
  }

  function getRecordValue(row: Record<string, unknown>, fieldName: string) {
    return row[fieldName] ?? row[fieldName.toUpperCase()] ?? row[fieldName.toLowerCase()];
  }

  function getPlaceholder(label: string, value: string) {
    if (!isEdit) return `Example: ${value || label}`;
    const existingValue = value ? `: ${value.slice(0, 80)}` : "";
    return `Editing ID ${id}${existingValue}`;
  }

  useEffect(() => {
    setRecord({});
    setMessage("");
    setFormValues(getBlankValues());
  }, [config.formFields, resource, id]);

  const lookupKeys = useMemo(
    () => Array.from(new Set(config.formFields.map((field) => field.lookup).filter(Boolean) as string[])),
    [config.formFields]
  );

  useEffect(() => {
    if (!lookupKeys.length) {
      setLookups({});
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(`/api/admin/lookups?keys=${lookupKeys.join(",")}`, { cache: "no-store" });
        const json = (await response.json()) as { ok: boolean; data?: Record<string, LookupOption[]> };
        if (alive && json.ok && json.data) setLookups(json.data);
      } catch {
        // A failed lookup leaves the field as a plain box rather than blocking
        // the whole form — the id can still be typed by hand.
        if (alive) setLookups({});
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
        setFormValues(Object.fromEntries(config.formFields.map((field) => {
          const rawValue = getRecordValue(row, field.name);
          return [field.name, rawValue === null || rawValue === undefined ? "" : String(rawValue)];
        })));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load record.");
      } finally {
        setLoading(false);
      }
    }

    void loadRecord();
  }, [config.endpoint, config.formFields, id]);

  function resetForm() {
    if (!isEdit) {
      setFormValues(getBlankValues());
      return;
    }

    setFormValues(Object.fromEntries(config.formFields.map((field) => {
      const rawValue = getRecordValue(record, field.name);
      return [field.name, rawValue === null || rawValue === undefined ? "" : String(rawValue)];
    })));
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setMessage(isEdit ? "Record updated successfully." : "Record created successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AdminShell>
      <section className="form-hero">
        <div>
          <Link className="back-link" href={listHref}><ArrowLeft size={18} /> Back to list</Link>
          <p className="eyeline">{isEdit ? "Edit Record" : "Create Record"}</p>
          <h1 className="page-title">{isEdit ? `Edit ${config.entityName}` : `Create ${config.entityName}`}</h1>
          <p className="subtitle">{config.description}</p>
        </div>
        <div className="form-hero-card">
          <Database size={20} />
          <span>Source</span>
          <strong>MySQL / {resource}</strong>
        </div>
      </section>

      <form className="resource-editor" onSubmit={submitForm}>
        <section className="panel resource-form">
          <div className="panel-header form-panel-header">
            <div>
              <h2><FilePenLine size={20} /> {config.entityName} Information</h2>
              <p>{isEdit ? `Fields are prefilled from MySQL id ${id}.` : "Fill the fields below to create a new database record."}</p>
            </div>
            <Status label={isEdit ? "Editing" : "New record"} />
          </div>
          {message ? <div className="notice">{message}</div> : null}
          <div className="form-grid">
            {config.formFields.map((field, index) => {
              const value = formValues[field.name] ?? "";
              const required = requiredFields.has(field.name);
              return (
                <div className={`field ${field.type === "textarea" ? "field-wide" : ""}`} key={field.name}>
                  <label>
                    <span>{field.label}{required ? <b aria-label="required">*</b> : null}</span>
                    <small>{index + 1}</small>
                  </label>
                  {field.type === "textarea" ? (
                    <textarea name={field.name} onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))} placeholder={getPlaceholder(field.label, field.value ?? "")} required={required} value={value} />
                  ) : field.lookup ? (
                    <select name={field.name} onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))} required={required} value={value}>
                      <option value="">{required ? `Select ${field.label.toLowerCase()}` : `— none —`}</option>
                      {renderLookupOptions(lookups[field.lookup] ?? [])}
                      {/* A stored id whose row has since gone (or fell outside the
                          list's limit) would otherwise silently reset to blank on
                          the next save. */}
                      {value && !(lookups[field.lookup] ?? []).some((option) => option.id === value)
                        ? <option value={value}>{`id ${value} (not in list)`}</option>
                        : null}
                    </select>
                  ) : field.type === "select" ? (
                    <select name={field.name} onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))} required={required} value={value}>
                      <option value="">Select {field.label.toLowerCase()}</option>
                      {field.options?.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input
                      name={field.name}
                      type={field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text"}
                      onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      placeholder={field.type === "date" || field.type === "datetime" ? undefined : getPlaceholder(field.label, field.value ?? "")}
                      required={required}
                      value={value}
                    />
                  )}
                  {field.hint ? <small className="field-hint">{field.hint}</small> : null}
                </div>
              );
            })}
          </div>
        </section>

        <aside className="form-rail">
          <div className="panel rail-card">
            <div className="rail-icon"><ShieldCheck size={20} /></div>
            <h3>Save Behavior</h3>
            <p>{isEdit ? "Saving will update the selected row in the remote MySQL database." : "Saving will insert a new row into the mapped MySQL table."}</p>
          </div>
          <div className="panel rail-card">
            <div className="rail-icon"><Info size={20} /></div>
            <h3>After Save</h3>
            <p>Use the list page to view, edit, delete, or inspect the full record with related data.</p>
          </div>
        </aside>

        <div className="sticky-actions">
          <div>
            <strong>{config.entityName}</strong>
            <span>{loading ? "Saving changes..." : isEdit ? `Editing record ${id}` : "Ready to create"}</span>
          </div>
          <div className="form-actions">
            <button className="btn primary" disabled={loading} type="submit"><Save size={18} /> Save</button>
            <button className="btn ghost" onClick={resetForm} type="button"><RotateCcw size={18} /> Reset</button>
            <Link className="btn ghost" href={listHref}>Cancel</Link>
          </div>
        </div>
      </form>
    </AdminShell>
  );
}
