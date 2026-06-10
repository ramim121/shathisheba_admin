"use client";

import { useEffect, useState, useCallback } from "react";
import { AdminShell } from "@/components/AdminShell";
import { Boxes, RefreshCw, AlertTriangle } from "lucide-react";

type Row = Record<string, unknown>;

function n(v: unknown) {
  return Number(v ?? 0);
}

function fmtDate(v: unknown) {
  if (!v) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export default function InventoryPage() {
  const [data, setData] = useState<{ products: Row[]; movements: Row[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/app/admin/inventory");
      const json = await res.json();
      if (json.ok) setData(json.data);
      else setError(json.message || "Failed to load inventory.");
    } catch {
      setError("Network error while loading inventory.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const products = data?.products ?? [];
  const lowCount = products.filter((p) => n(p.stock_qty) <= n(p.low_stock_threshold)).length;

  return (
    <AdminShell>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Boxes size={22} style={{ verticalAlign: "-4px", marginRight: 8 }} />Product Inventory</h1>
          <p className="page-sub">
            Live stock, pending demand from placed orders, and the movement ledger.
            {lowCount ? <strong className="txt-warn"> {lowCount} product(s) low on stock.</strong> : null}
          </p>
        </div>
        <button className="aq-refresh" onClick={load}><RefreshCw size={14} style={{ verticalAlign: "-2px", marginRight: 5 }} />Refresh</button>
      </div>

      {error ? <p className="drawer-error" style={{ margin: "0 0 14px" }}><AlertTriangle size={14} /> {error}</p> : null}
      {loading ? <p className="page-sub">Loading inventory…</p> : (
        <div className="inv-layout">
          <div className="au-card">
            <h2 className="au-card-title">Stock by product ({products.length})</h2>
            <table className="au-table">
              <thead>
                <tr><th>Product</th><th>Category</th><th>In stock</th><th>Pending orders</th><th>Sold / confirmed</th><th>Status</th></tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const low = n(p.stock_qty) <= n(p.low_stock_threshold);
                  const short = n(p.stock_qty) < n(p.pending_qty);
                  return (
                    <tr key={String(p.id)}>
                      <td><strong>{String(p.name_en)}</strong><br /><span className="inv-sku">{String(p.sku)}</span></td>
                      <td>{String(p.category_name)}</td>
                      <td><strong>{n(p.stock_qty)}</strong> {String(p.unit)}</td>
                      <td>{n(p.pending_qty) > 0 ? <span className={short ? "vbadge vb-bad" : "vbadge vb-warn"}>{n(p.pending_qty)} {short ? "— exceeds stock!" : "pending"}</span> : "—"}</td>
                      <td>{n(p.confirmed_qty) || "—"}</td>
                      <td>
                        {String(p.status) === "active"
                          ? (low ? <span className="vbadge vb-warn">low stock</span> : <span className="vbadge vb-ok">active</span>)
                          : <span className="vbadge vb-bad">{String(p.status).replace(/_/g, " ")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <aside className="au-card">
            <h2 className="au-card-title">Movement ledger</h2>
            {(data?.movements ?? []).length === 0 ? <p className="page-sub">No stock movements recorded yet.</p> : null}
            {(data?.movements ?? []).map((m) => (
              <p className="invpanel-row" key={String(m.id)}>
                <span>{fmtDate(m.created_at)}</span> · {String(m.name_en)} ·{" "}
                <strong className={n(m.change_qty) < 0 ? "txt-warn" : "txt-ok"}>{n(m.change_qty) > 0 ? "+" : ""}{n(m.change_qty)}</strong>{" "}
                · {String(m.reason)}{m.ref_code ? ` (${m.ref_code})` : ""}
              </p>
            ))}
          </aside>
        </div>
      )}
    </AdminShell>
  );
}
