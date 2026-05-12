import Link from "next/link";
import { ArrowLeft, Edit3 } from "lucide-react";
import { AdminShell } from "@/components/AdminShell";
import { Status } from "@/components/Status";
import { getResourceRelated, getResourceRow } from "@/lib/db-resources";
import type { ManagementPageProps } from "@/components/ManagementPage";
import { getListRoute } from "@/lib/resource-routes";

type Props = {
  config: ManagementPageProps;
  resource: string;
  id: string;
};

function printable(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export async function ResourceDetailPage({ config, resource, id }: Props) {
  const row = await getResourceRow(resource, id);
  const related = await getResourceRelated(resource, id);
  const listHref = getListRoute(resource);

  return (
    <AdminShell>
      <section className="detail-hero">
        <div>
          <Link className="back-link" href={listHref}><ArrowLeft size={18} /> Back to list</Link>
          <p className="eyeline">Record Details</p>
          <h1 className="page-title">{config.entityName} #{id}</h1>
          <p className="subtitle">Full database view for this record, including related tables where available.</p>
        </div>
        <div className="detail-actions">
          <Status label={row?.status ? printable(row.status) : row ? "Loaded" : "Missing"} />
          <Link className="btn primary" href={`/manage/form?resource=${encodeURIComponent(resource)}&id=${encodeURIComponent(id)}`}><Edit3 size={18} /> Edit</Link>
        </div>
      </section>

      {!row ? (
        <div className="panel empty-state">
          <h2>Record not found</h2>
          <p>No data was found for this resource and id.</p>
        </div>
      ) : (
        <section className="dashboard-layout">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Main Record</h2>
                <p>All available columns from the database table.</p>
              </div>
            </div>
            <div className="definition-list">
              {Object.entries(row).map(([key, value]) => (
                <div key={key}>
                  <span>{key}</span>
                  <strong>{printable(value)}</strong>
                </div>
              ))}
            </div>
          </div>

          <aside className="panel">
            <div className="panel-header">
              <div>
                <h2>Related Data</h2>
                <p>Joined or linked records that help explain this item.</p>
              </div>
            </div>
            <pre className="json-box">{JSON.stringify(related, null, 2)}</pre>
          </aside>
        </section>
      )}
    </AdminShell>
  );
}
