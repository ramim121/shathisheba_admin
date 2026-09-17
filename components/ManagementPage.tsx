"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, Edit3, Eye, Filter, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import { Select } from "@/components/Select";
import { DeleteDialog } from "@/components/DeleteDialog";

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
  formFields: {
    label: string;
    name: string;
    /**
     * fee — `name` is the flat ৳/kg column, `pctName` the percent column; one
     *       toggle picks which holds the value, the other submits blank.
     * image — URL box plus an upload button (POST /api/upload) and a preview.
     * multi-lookup — several `lookup` records, submitted as "1,2,3".
     */
    type?: "text" | "textarea" | "select" | "date" | "datetime" | "geo" | "fee" | "image" | "multi-lookup";
    options?: string[];
    /** Overrides the form's built-in required-field list. */
    required?: boolean;
    /** Shown disabled with its value, and left out of the submitted payload. */
    readOnly?: boolean;
    /** Which form section the field belongs to; inferred from its name if absent. */
    section?: string;
    /** Key into lib/admin-lookups — renders a name picker that submits the id. */
    lookup?: string;
    /** type "fee": the percent column paired with the flat column in `name`. */
    pctName?: string;
    /** type "image": upload folder passed to /api/upload (default "misc"). */
    folder?: string;
    value?: string;
    hint?: string;
  }[];
  /** Shown between the page header and the table — e.g. a warning banner. */
  banner?: ReactNode;
};

const PAGE_SIZES = [10, 25, 50, 100];

// Records with a purpose-built detail screen open there; everything else opens
// the generic record view.
const DETAIL_ROUTES: Record<string, (id: string) => string> = {
  "sale/listings": (id) => `/sale/${encodeURIComponent(id)}`,
  "loan/applications": (id) => `/loan/applications/${encodeURIComponent(id)}`
};

const CODE_RE = /^[A-Z]{2,6}(-[A-Z0-9]+){1,4}$/;
const MONEY_RE = /৳\s?(-?\d+(?:\.\d+)?)/g;

/** ৳151200.00 → ৳1,51,200 (Bangladeshi grouping, paisa only when non-zero). */
function formatMoney(text: string): string {
  return text.replace(MONEY_RE, (_, n: string) => {
    const v = Number(n);
    return `৳${v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(v) ? 0 : 2 })}`;
  });
}

/** Presentation only — sorting, filtering and CSV export still use the raw value. */
function renderCell(value: unknown): ReactNode {
  if (value === undefined || value === null || String(value).trim() === "") return <span className="cell-muted">—</span>;
  const raw = String(value);
  if (CODE_RE.test(raw)) return <span className="cell-code">{raw}</span>;
  if (raw.includes("৳")) {
    const parts = formatMoney(raw).split(" · ");
    return (
      <span className="cell-money">
        {parts.map((part, i) => <span key={i}>{i ? <span className="cell-sep">·</span> : null}{part}</span>)}
      </span>
    );
  }
  return raw;
}

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
  formFields: _formFields,
  banner
}: ManagementPageProps) {
  const router = useRouter();
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
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const resource = useMemo(() => endpoint.replace(/^\/api\/v1\//, ""), [endpoint]);
  const createHref = `/manage/form?resource=${encodeURIComponent(resource)}`;
  const detailHref = (id: string) =>
    DETAIL_ROUTES[resource]?.(id) ?? `/manage/view?resource=${encodeURIComponent(resource)}&id=${encodeURIComponent(id)}`;
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

  // The first non-empty cell is the closest thing a generic table has to a
  // name; the modal replaces it with the record's real title once it loads.
  function rowTitle(row: ManagementRow) {
    for (const column of columns) {
      const value = row[column.key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
    }
    return `#${row.id}`;
  }

  function askDelete(row: ManagementRow) {
    setMessage("");
    setPendingDelete({ id: row.id, title: rowTitle(row) });
  }

  async function afterDelete(id: string) {
    setPendingDelete(null);
    // Drop the row immediately so the table matches what just happened, then
    // refresh to pick up anything else the delete changed. The confirmation is
    // set last because loadRows() clears the message as it starts.
    setRows((current) => current.filter((row) => row.id !== id));
    await loadRows();
    setMessage("Record deleted from MySQL.");
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

      {banner}
      <section className="list-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{entityName} Records</h2>
              <p>Click a row to open it. Sort by any column, filter, or export to CSV.</p>
            </div>
            <Status label={loading ? "Loading" : `${filteredRows.length}${filteredRows.length !== rows.length ? ` of ${rows.length}` : ""} records`} />
          </div>
          {message ? <div className="notice">{message}</div> : null}
          {/* What is currently narrowing the table, and a way out of each one —
              column filters used to be invisible once the filter row was
              collapsed again. */}
          {activeFilterCount || query ? (
            <div className="active-filters">
              <span className="active-filters-label">Filtered by</span>
              {query ? (
                <button type="button" className="filter-chip" onClick={() => setQuery("")}>
                  search: <b>{query}</b><X size={13} />
                </button>
              ) : null}
              {Object.entries(colFilters)
                .filter(([, v]) => v.trim() !== "")
                .map(([key, value]) => (
                  <button
                    type="button"
                    className="filter-chip"
                    key={key}
                    onClick={() => setColFilters((f) => ({ ...f, [key]: "" }))}
                  >
                    {allColumns.find((c) => c.key === key)?.label ?? key}: <b>{value}</b><X size={13} />
                  </button>
                ))}
              <button type="button" className="link-clear" onClick={() => { setColFilters({}); setQuery(""); }}>
                Clear all
              </button>
            </div>
          ) : null}
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
                  <tr
                    key={row.id}
                    className="row-link"
                    // The whole row opens the record; the edit/delete controls
                    // inside it keep their own behaviour.
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
                      router.push(detailHref(row.id));
                    }}
                  >
                    {columns.map((column) => (
                      <td key={column.key}>{renderCell(row[column.key])}</td>
                    ))}
                    <td><Status label={row.status ?? "Active"} /></td>
                    <td>
                      <div className="row-actions">
                        <Link href={detailHref(row.id)} title="View details"><Eye size={16} /></Link>
                        <Link href={`/manage/form?resource=${encodeURIComponent(resource)}&id=${encodeURIComponent(row.id)}`} title="Edit"><Edit3 size={16} /></Link>
                        <button onClick={() => askDelete(row)} title="Delete" type="button"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {/* Placeholder rows while the fetch is in flight, so the table
                    keeps its shape instead of collapsing to a single line. */}
                {loading && rows.length === 0
                  ? Array.from({ length: 6 }, (_, i) => (
                      <tr key={`skeleton-${i}`} aria-hidden="true">
                        {allColumns.map((column) => (
                          <td key={column.key}><span className="cell-skeleton" /></td>
                        ))}
                        <td><span className="cell-skeleton" /></td>
                      </tr>
                    ))
                  : null}
                {!loading && filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={allColumns.length + 1} className="table-empty">
                      {query || activeFilterCount ? (
                        <>
                          <strong>No {entityName.toLowerCase()} match this search.</strong>
                          <span>Clear the search box or the column filters to see every record.</span>
                        </>
                      ) : (
                        <>
                          <strong>No records yet.</strong>
                          <span>Use “Create {entityName}” to add the first one.</span>
                        </>
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <div className="page-size">
              <span>Rows per page</span>
              <Select
                size="sm"
                aria-label="Rows per page"
                value={String(pageSize)}
                options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
                onChange={(v) => setPageSize(Number(v))}
              />
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

      {pendingDelete ? (
        <DeleteDialog
          // A handful of pages carry a filter in the endpoint; the impact
          // lookup wants the bare resource key.
          resource={resource.split("?")[0]}
          endpoint={endpoint}
          entityName={entityName}
          id={pendingDelete.id}
          fallbackTitle={pendingDelete.title}
          onCancel={() => setPendingDelete(null)}
          onDeleted={(deletedId) => void afterDelete(deletedId)}
        />
      ) : null}
    </AdminShell>
  );
}
