import { Copy, Edit3, Eye, Plus, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import { apiCatalog } from "@/lib/data";

export default function ApiViewerPage() {
  return (
    <AdminShell>
      <section className="topbar">
        <div>
          <p className="eyeline">API Viewer</p>
          <h1 className="page-title">App API endpoints and admin endpoint definitions</h1>
          <p className="subtitle">
            Manage the endpoint catalog separately from the JSON API itself. Use this page to view, edit, delete, document, and test app endpoints.
          </p>
        </div>
        <div className="toolbar">
          <button className="btn ghost" type="button"><Copy size={18} /> Copy collection</button>
          <button className="btn primary" type="button"><Plus size={18} /> Add endpoint</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Endpoint Registry</h2>
            <p>These rows are admin-manageable records. The live JSON routes remain under <code>/api/v1/*</code>.</p>
          </div>
          <Status label={`${apiCatalog.length} endpoints`} />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Path</th>
                <th>Purpose</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {apiCatalog.map((endpoint) => (
                <tr key={`${endpoint.method}-${endpoint.path}`}>
                  <td><span className="tag">{endpoint.method}</span></td>
                  <td><code>{endpoint.path}</code></td>
                  <td>{endpoint.desc}</td>
                  <td><Status label="Published" /></td>
                  <td>
                    <div className="row-actions">
                      <a title="Open JSON" href={endpoint.path.split("?")[0]}><Eye size={16} /></a>
                      <button title="Edit endpoint documentation" type="button"><Edit3 size={16} /></button>
                      <button title="Delete from catalog" type="button"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel admin-form" style={{ marginTop: 18 }}>
        <div className="panel-header" style={{ margin: "-18px -18px 6px" }}>
          <div>
            <h2>Create / Edit API Definition</h2>
            <p>Define visible API docs for the mobile app team without changing route code directly.</p>
          </div>
        </div>
        <div className="field">
          <label>Method</label>
          <select defaultValue="GET">
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>PATCH</option>
            <option>DELETE</option>
          </select>
        </div>
        <div className="field">
          <label>Path</label>
          <input defaultValue="/api/v1/interests" />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea defaultValue="Splash onboarding categories and nested items" />
        </div>
        <div className="field">
          <label>Sample response notes</label>
          <textarea defaultValue="Returns ok, generated_at, meta, and data envelope." />
        </div>
        <div className="form-actions">
          <button className="btn primary" type="button">Save Endpoint</button>
          <button className="btn ghost" type="button">Delete Endpoint</button>
        </div>
      </section>
    </AdminShell>
  );
}
