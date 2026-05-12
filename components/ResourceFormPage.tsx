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
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const isEdit = Boolean(id);
  const listHref = useMemo(() => getListRoute(resource), [resource]);

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
        setRecord(json.data?.row ?? {});
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load record.");
      } finally {
        setLoading(false);
      }
    }

    void loadRecord();
  }, [config.endpoint, id]);

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
              const rawValue = record[field.name];
              const value = rawValue === null || rawValue === undefined ? field.value ?? "" : String(rawValue);
              return (
                <div className={`field ${field.type === "textarea" ? "field-wide" : ""}`} key={field.name}>
                  <label>
                    <span>{field.label}</span>
                    <small>{index + 1}</small>
                  </label>
                  {field.type === "textarea" ? (
                    <textarea defaultValue={value} name={field.name} placeholder={`Enter ${field.label.toLowerCase()}`} />
                  ) : field.type === "select" ? (
                    <select defaultValue={value || field.options?.[0]} name={field.name}>
                      {field.options?.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input defaultValue={value} name={field.name} placeholder={`Enter ${field.label.toLowerCase()}`} />
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
            <button className="btn ghost" type="reset"><RotateCcw size={18} /> Reset</button>
            <Link className="btn ghost" href={listHref}>Cancel</Link>
          </div>
        </div>
      </form>
    </AdminShell>
  );
}
