"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Database, FilePenLine, Info, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import type { ManagementPageProps } from "@/components/ManagementPage";
import { getListRoute } from "@/lib/resource-routes";

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

export function ResourceFormPage({ config, resource, id }: Props) {
  const [record, setRecord] = useState<Record<string, unknown>>({});
  const [formValues, setFormValues] = useState<Record<string, string>>({});
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
                  ) : field.type === "select" ? (
                    <select name={field.name} onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))} required={required} value={value}>
                      <option value="">Select {field.label.toLowerCase()}</option>
                      {field.options?.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input name={field.name} onChange={(event) => setFormValues((current) => ({ ...current, [field.name]: event.target.value }))} placeholder={getPlaceholder(field.label, field.value ?? "")} required={required} value={value} />
                  )}
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
