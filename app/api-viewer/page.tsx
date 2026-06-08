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
  const endpoints = useMemo(() => {
    const documented = catalog?.endpoints ?? [];
    const generated = (catalog?.database_resources ?? []).map((item) => ({
      method: "GET",
      path: item.collection,
      desc: `${item.resource} database collection`
    }));
    return [...documented, ...generated];
  }, [catalog]);

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
          <div className="table-wrap">
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
                {endpoints.map((endpoint) => (
                  <tr key={`${endpoint.method}-${endpoint.path}`}>
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
          </div>
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
