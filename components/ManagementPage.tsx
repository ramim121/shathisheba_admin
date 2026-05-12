"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Edit3, Eye, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";

export type ManagementColumn = {
  key: string;
  label: string;
};

export type ManagementRow = {
  id: string;
  status?: string;
  [key: string]: string | number | undefined;
};

export type ManagementPageProps = {
  title: string;
  description: string;
  entityName: string;
  endpoint: string;
  columns: ManagementColumn[];
  rows: ManagementRow[];
  formFields: { label: string; name: string; type?: "text" | "textarea" | "select"; options?: string[]; value?: string }[];
};

export function ManagementPage({
  title,
  description,
  entityName,
  endpoint,
  columns,
  rows: initialRows,
  formFields
}: ManagementPageProps) {
  const [rows, setRows] = useState<ManagementRow[]>(initialRows);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function loadRows() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.message ?? "Could not fetch records.");
      }
      setRows(json.data ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not fetch records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, [endpoint]);

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    const url = editingId ? `${endpoint}?id=${encodeURIComponent(editingId)}` : endpoint;
    const method = editingId ? "PATCH" : "POST";

    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.message ?? "Save failed.");
      }
      setMessage(editingId ? "Record updated in MySQL." : "Record inserted into MySQL.");
      setEditingId(null);
      event.currentTarget.reset();
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteRow(id: string) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.message ?? "Delete failed.");
      }
      setMessage("Record deleted from MySQL.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setLoading(false);
    }
  }

  const detailBase = endpoint === "/api/v1/sale/listings" ? "/sale" : null;

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Manage App Data</p>
          <h1 className="page-title">{title}</h1>
          <p className="subtitle">{description}</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" type="button"><Search size={18} /> Search</button>
          <button className="btn ghost" type="button"><Download size={18} /> Export</button>
          <button className="btn ghost" onClick={loadRows} type="button"><RefreshCw size={18} /> Refresh</button>
          <button className="btn primary" type="button"><Plus size={18} /> Create {entityName}</button>
        </div>
      </section>

      <section className="crud-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{entityName} Records</h2>
              <p>View, edit, delete, publish, and control what the mobile app receives from <code>{endpoint}</code>.</p>
            </div>
            <Status label={loading ? "Loading" : `${rows.length} records`} />
          </div>
          {message ? <div className="notice">{message}</div> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map((column) => <th key={column.key}>{column.label}</th>)}
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((column) => (
                      <td key={column.key}>
                        {row[column.key]}
                      </td>
                    ))}
                    <td><Status label={row.status ?? "Active"} /></td>
                    <td>
                      <div className="row-actions">
                        {detailBase ? (
                          <Link href={`${detailBase}/${row.id}`} title="View details"><Eye size={16} /></Link>
                        ) : (
                          <button title="View" type="button"><Eye size={16} /></button>
                        )}
                        <button onClick={() => setEditingId(row.id)} title="Edit" type="button"><Edit3 size={16} /></button>
                        <button onClick={() => void deleteRow(row.id)} title="Delete" type="button"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <form className="panel admin-form" onSubmit={submitForm}>
          <div className="panel-header" style={{ margin: "-18px -18px 6px" }}>
            <div>
              <h2>{editingId ? `Edit ${entityName}` : `Create ${entityName}`}</h2>
              <p>{editingId ? `Updating MySQL id ${editingId}.` : "Submitting creates a new MySQL record."}</p>
            </div>
          </div>

          {formFields.map((field) => (
            <div className="field" key={field.name}>
              <label>{field.label}</label>
              {field.type === "textarea" ? (
                <textarea defaultValue={field.value} name={field.name} />
              ) : field.type === "select" ? (
                <select defaultValue={field.value ?? field.options?.[0]} name={field.name}>
                  {field.options?.map((option) => <option key={option}>{option}</option>)}
                </select>
              ) : (
                <input defaultValue={field.value} name={field.name} />
              )}
            </div>
          ))}

          <div className="form-actions">
            <button className="btn primary" disabled={loading} type="submit">Save {entityName}</button>
            <button className="btn ghost" onClick={() => setEditingId(null)} type="reset">Clear</button>
          </div>
        </form>
      </section>
    </AdminShell>
  );
}
