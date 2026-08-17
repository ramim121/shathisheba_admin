"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Eye, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";

type ApiEndpoint = {
  method: string;
  path: string;
  desc?: string;
};

type CatalogResponse = {
  ok: boolean;
  data?: {
    endpoints?: ApiEndpoint[];
    database_resources?: {
      resource: string;
      collection: string;
      detail: string;
      methods: string[];
    }[];
  };
};

export default function ApiViewerPage() {
  const [catalog, setCatalog] = useState<CatalogResponse["data"]>({});
  const [selectedPath, setSelectedPath] = useState("/api/v1/catalog");
  const [jsonText, setJsonText] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const endpoints = useMemo(() => {
    const documented = catalog?.endpoints ?? [];
    const generated = (catalog?.database_resources ?? []).map((item) => ({
      method: "GET",
      path: item.collection,
      desc: `${item.resource} database collection`
    }));
    // A generated collection can restate a documented endpoint. De-duplicate on
    // method+path so the registry lists each route once — this also gives the
    // rows genuinely unique React keys.
    const seen = new Set<string>();
    return [...documented, ...generated].filter((e) => {
      const key = `${e.method} ${e.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [catalog]);

  // Grouped by the part of the platform each route serves, rather than one flat
  // list of ~70 rows. The order is the order someone debugging would look in.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (e: ApiEndpoint) =>
      !q || e.path.toLowerCase().includes(q) || (e.desc ?? "").toLowerCase().includes(q);

    const sections: { title: string; blurb: string; test: (p: string) => boolean }[] = [
      { title: "Finance — Readiness", blurb: "Feature 1: the self-declared readiness check.",
        test: (p) => p.includes("/finance/readiness") },
      { title: "Finance — Loan", blurb: "Feature 2: products, quoting, applications and consents.",
        test: (p) => p.includes("/finance/") || p.includes("/loan") },
      // Ahead of Authentication & Profile, which would otherwise claim this on
      // the bare "/users" in the path — it is a maintenance operation, not a
      // profile one, and it is the last place someone should have to hunt for.
      { title: "Admin — Maintenance", blurb: "Destructive back-office operations. Guarded, transactional and audit-logged.",
        test: (p) => p.includes("/clear-records") },
      { title: "Authentication & Profile", blurb: "OTP handshake, the app user record and its profile modules.",
        test: (p) => /\/(auth|me|users|banking|farm|kyc|preferences|profile)/.test(p) },
      { title: "Marketplace — Sell", blurb: "Listings, sale taxonomy, pricing and confirmations.",
        test: (p) => p.includes("/sale") },
      { title: "Marketplace — Buy", blurb: "Buy catalogue, orders and payments.",
        test: (p) => p.includes("/buy") || p.includes("/orders") },
      { title: "Projects & Partners", blurb: "Contract farming, enrolment and ledgers.",
        test: (p) => p.includes("/partners") || p.includes("/projects") },
      { title: "Learning", blurb: "Training tree, progress and quizzes.",
        test: (p) => p.includes("/learning") },
      { title: "Community", blurb: "Feed, officers and moderation.",
        test: (p) => p.includes("/community") },
      { title: "Content & Reference", blurb: "Geography, weather, market updates, FAQ and interests.",
        test: (p) => /\/(geo|weather|market-updates|faq|interests|assistant|settings)/.test(p) },
      { title: "Admin & Reporting", blurb: "Console-side aggregates and back-office resources.",
        test: (p) => p.includes("/admin") || p.includes("/reports") || p.includes("/audit") },
    ];

    const assigned = new Set<string>();
    const out = sections.map((s) => {
      const rows = endpoints.filter((e) => {
        const key = `${e.method} ${e.path}`;
        if (assigned.has(key)) return false;
        if (!s.test(e.path)) return false;
        assigned.add(key);
        return true;
      }).filter(match);
      return { ...s, rows };
    });

    const rest = endpoints.filter((e) => !assigned.has(`${e.method} ${e.path}`)).filter(match);
    if (rest.length) out.push({ title: "Other", blurb: "Everything not covered above.", test: () => true, rows: rest });
    return out.filter((s) => s.rows.length > 0);
  }, [endpoints, query]);

  async function loadJson(path = selectedPath) {
    setMessage("Loading API data...");
    try {
      const response = await fetch(path, { cache: "no-store" });
      const json = await response.json();
      setSelectedPath(path);
      setJsonText(JSON.stringify(json, null, 2));
      setMessage(response.ok ? "Loaded live JSON response." : json.message ?? "Request failed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load API data.");
    }
  }

  useEffect(() => {
    async function loadCatalog() {
      try {
        const response = await fetch("/api/v1/catalog", { cache: "no-store" });
        const json = (await response.json()) as CatalogResponse;
        setCatalog(json.data ?? {});
        setJsonText(JSON.stringify(json, null, 2));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load API catalog.");
      }
    }

    void loadCatalog();
  }, []);

  return (
    <AdminShell>
      <section className="topbar compact-topbar">
        <div>
          <p className="eyeline">API Viewer</p>
          <h1 className="page-title">Live app API data</h1>
          <p className="subtitle">Open any endpoint and inspect its database-backed JSON response on this page.</p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" onClick={() => navigator.clipboard.writeText(jsonText)} type="button"><Copy size={16} /> Copy JSON</button>
          <button className="btn ghost" onClick={() => void loadJson()} type="button"><RefreshCw size={16} /> Reload</button>
        </div>
      </section>

      <section className="api-viewer-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Endpoint Registry</h2>
              <p>Select an endpoint to load its current JSON output.</p>
            </div>
            <Status label={`${endpoints.length} endpoints`} />
          </div>
          <div className="api-filter">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by path or purpose…"
              aria-label="Filter endpoints"
            />
            {query ? <button type="button" onClick={() => setQuery("")}>×</button> : null}
          </div>

          <div className="table-wrap">
            {grouped.map((section) => {
              const isOpen = collapsed[section.title] !== true;
              return (
                <div className="api-group" key={section.title}>
                  <button
                    type="button"
                    className="api-group-head"
                    onClick={() => setCollapsed((c) => ({ ...c, [section.title]: isOpen }))}
                    aria-expanded={isOpen}
                  >
                    <span className="api-group-title">{section.title}</span>
                    <span className="api-group-count">{section.rows.length}</span>
                    <span className="api-group-chevron">{isOpen ? "−" : "+"}</span>
                  </button>
                  {isOpen ? (
                    <>
                      <p className="api-group-blurb">{section.blurb}</p>
                      <table>
                        <thead>
                          <tr>
                            <th>Method</th>
                            <th>Path</th>
                            <th>Purpose</th>
                            <th>Open</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((endpoint) => (
                            <tr key={`${endpoint.method} ${endpoint.path}`}>
                              <td><span className="tag">{endpoint.method}</span></td>
                              <td><code>{endpoint.path}</code></td>
                              <td>{endpoint.desc}</td>
                              <td>
                                <div className="row-actions">
                                  <button onClick={() => void loadJson(endpoint.path)} title="Load JSON" type="button"><Eye size={15} /></button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  ) : null}
                </div>
              );
            })}
            {grouped.length === 0 ? (
              <p className="api-group-blurb">No endpoint matches “{query}”.</p>
            ) : null}
          </div>

          <style jsx>{`
            .api-filter { display:flex; gap:8px; align-items:center; padding:0 0 12px; }
            .api-filter input { flex:1; padding:9px 12px; border:1px solid #E8D7DF; border-radius:9px; font-size:14px; }
            .api-filter button { border:1px solid #E8D7DF; background:#fff; border-radius:9px; width:34px; height:34px; cursor:pointer; }
            .api-group { border-top:1px solid #F4E8EE; }
            .api-group:first-child { border-top:none; }
            .api-group-head { width:100%; display:flex; align-items:center; gap:10px; background:none; border:none;
                              padding:12px 2px; cursor:pointer; text-align:left; }
            .api-group-title { font-weight:700; font-size:14px; color:#2B0B1E; }
            .api-group-count { background:#F4E8EE; color:#871449; border-radius:999px; padding:2px 9px; font-size:12px; font-weight:700; }
            .api-group-chevron { margin-left:auto; color:#9B5173; font-size:16px; font-weight:700; }
            .api-group-blurb { margin:0 0 8px; color:#6b6b6b; font-size:12.5px; }
          `}</style>
        </div>

        <div className="panel api-json-panel">
          <div className="panel-header">
            <div>
              <h2>JSON Response</h2>
              <p><code>{selectedPath}</code></p>
            </div>
            <Status label={message || "Ready"} />
          </div>
          <pre className="json-box json-formatter"><code>{jsonText}</code></pre>
        </div>
      </section>
    </AdminShell>
  );
}
