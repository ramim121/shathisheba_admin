"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Edit3, Eye, Filter, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
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

const PAGE_SIZES = [10, 25, 50, 100];

// Treats values that look numeric (incl. ৳ / commas / %) as numbers for sorting.
function asSortable(value: unknown): number | string {
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  const numeric = raw.replace(/[৳,%\s]/g, "").replace(/[^0-9.\-]/g, "");
  if (numeric !== "" && !Number.isNaN(Number(numeric)) && /[0-9]/.test(raw)) return Number(numeric);
  return raw.toLowerCase();
}

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
  const [query, setQuery] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const resource = useMemo(() => endpoint.replace(/^\/api\/v1\//, ""), [endpoint]);
  const createHref = `/manage/form?resource=${encodeURIComponent(resource)}`;
  const allColumns: ManagementColumn[] = useMemo(() => [...columns, { key: "status", label: "Status" }], [columns]);

  // global search -> per-column filters -> sort
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((row) =>
      (!q || Object.values(row).some((value) => value !== undefined && String(value).toLowerCase().includes(q)))
    );
    const active = Object.entries(colFilters).filter(([, v]) => v.trim() !== "");
    if (active.length) {
      out = out.filter((row) => active.every(([key, v]) => String(row[key] ?? "").toLowerCase().includes(v.trim().toLowerCase())));
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = asSortable(sortKey === "status" ? a.status : a[sortKey]);
        const bv = asSortable(sortKey === "status" ? b.status : b[sortKey]);
        let cmp = 0;
        if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, query, colFilters, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredRows, currentPage, pageSize]
  );

  useEffect(() => { setPage(1); }, [query, colFilters, pageSize, endpoint]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function exportCsv() {
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [allColumns.map((c) => escape(c.label)).join(",")];
    for (const row of filteredRows) {
      lines.push(allColumns.map((c) => escape(c.key === "status" ? row.status ?? "Active" : row[c.key])).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${resource.replace(/\//g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadRows() {
    setLoading(true);
    setMessage("");
    try {
      const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}surface=admin`;
      const response = await fetch(url, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.message ?? "Could not fetch records.");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  async function deleteRow(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Delete this record? This cannot be undone.")) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`${endpoint}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.message ?? "Delete failed.");
      setMessage("Record deleted from MySQL.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setLoading(false);
    }
  }

  const activeFilterCount = Object.values(colFilters).filter((v) => v.trim() !== "").length;

  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">Manage App Data</p>
          <h1 className="page-title">{title}</h1>
          <p className="subtitle">{description}</p>
        </div>
        <div className="toolbar">
          <div className="search-box">
            <Search size={16} />
            <input
              aria-label="Search records"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search all ${entityName.toLowerCase()}…`}
              type="search"
              value={query}
            />
          </div>
          <button className={`btn ghost${showFilters ? " active" : ""}`} onClick={() => setShowFilters((s) => !s)} type="button">
            <Filter size={18} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
          <button className="btn ghost" onClick={exportCsv} type="button"><Download size={18} /> Export</button>
          <button className="btn ghost" onClick={loadRows} type="button"><RefreshCw size={18} /> Refresh</button>
          <Link className="btn primary" href={createHref}><Plus size={18} /> Create {entityName}</Link>
        </div>
      </section>

      <section className="list-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{entityName} Records</h2>
              <p>Sort, filter, paginate and export what the mobile app receives from <code>{endpoint}</code>.</p>
            </div>
            <Status label={loading ? "Loading" : `${filteredRows.length}${filteredRows.length !== rows.length ? ` of ${rows.length}` : ""} records`} />
          </div>
          {message ? <div className="notice">{message}</div> : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {allColumns.map((column) => {
                    const sorted = sortKey === column.key;
                    return (
                      <th key={column.key}>
                        <button type="button" className="th-sort" onClick={() => toggleSort(column.key)}>
                          {column.label}
                          {sorted ? (sortDir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ChevronsUpDown size={13} className="th-sort-idle" />}
                        </button>
                      </th>
                    );
                  })}
                  <th>Actions</th>
                </tr>
                {showFilters ? (
                  <tr className="filter-row">
                    {allColumns.map((column) => (
                      <th key={column.key}>
                        <input
                          className="col-filter"
                          value={colFilters[column.key] ?? ""}
                          placeholder="Filter…"
                          onChange={(e) => setColFilters((f) => ({ ...f, [column.key]: e.target.value }))}
                        />
                      </th>
                    ))}
                    <th>
                      {activeFilterCount ? (
                        <button type="button" className="link-clear" onClick={() => setColFilters({})}>Clear</button>
                      ) : null}
                    </th>
                  </tr>
                ) : null}
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((column) => (
                      <td key={column.key}>{row[column.key]}</td>
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
                {!loading && filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={allColumns.length + 1} style={{ color: "#9ca3af", padding: "20px 12px" }}>
                      {query || activeFilterCount ? "No records match the current search/filters." : "No records yet. Use Create to add the first one."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <div className="page-size">
              <span>Rows per page</span>
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="pager">
              <span>
                {filteredRows.length === 0 ? "0" : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, filteredRows.length)}`} of {filteredRows.length}
              </span>
              <button className="btn ghost sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} type="button">Prev</button>
              <span className="page-indicator">Page {currentPage}/{totalPages}</span>
              <button className="btn ghost sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} type="button">Next</button>
            </div>
          </div>
        </div>
      </section>
    </AdminShell>
  );
}
