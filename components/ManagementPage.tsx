"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Edit3, Eye, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import { getListRoute } from "@/lib/resource-routes";

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
  formFields: _formFields
}: ManagementPageProps) {
  const [rows, setRows] = useState<ManagementRow[]>(initialRows);
  const [message, setMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const resource = useMemo(() => endpoint.replace(/^\/api\/v1\//, ""), [endpoint]);
  const createHref = `/manage/form?resource=${encodeURIComponent(resource)}`;

  async function loadRows() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(json.message ?? "Could not fetch records.");
      }
      if (Array.isArray(json.data)) {
        setRows(json.data);
      } else if (json.data && typeof json.data === "object") {
        setRows(Object.entries(json.data).map(([key, value]) => ({
          id: key,
          name: key.replace(/_/g, " "),
          scope: "API summary",
          frequency: "Live",
          owner: typeof value === "object" && value !== null ? JSON.stringify(value) : String(value),
          status: "Active"
        })));
      } else {
        setRows([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not fetch records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
  }, [endpoint]);

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
          <Link className="btn primary" href={createHref}><Plus size={18} /> Create {entityName}</Link>
        </div>
      </section>

      <section className="list-layout">
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
                        <Link href={`/manage/view?resource=${encodeURIComponent(resource)}&id=${encodeURIComponent(row.id)}`} title="View details"><Eye size={16} /></Link>
                        <Link href={`/manage/form?resource=${encodeURIComponent(resource)}&id=${encodeURIComponent(row.id)}`} title="Edit"><Edit3 size={16} /></Link>
                        <button onClick={() => void deleteRow(row.id)} title="Delete" type="button"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
