import { queryRows } from "@/lib/db";
import { resourceTable } from "@/lib/db-resources";

type Row = Record<string, unknown>;

/**
 * What a delete would take with it.
 *
 * Deleting a record in the console used to be one browser confirm() with no
 * idea of the blast radius. This walks the foreign keys pointing at the row's
 * table — and their children — and counts what hangs off it, so the modal can
 * say "this order, its 3 line items and 2 status events" before anything is
 * removed.
 *
 * Read-only, and the table/column names come from information_schema rather
 * than from the request.
 */

type Child = { table: string; column: string; onDelete: string };

async function childrenOf(table: string): Promise<Child[]> {
  return (await queryRows<Row>(
    `SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS c, r.DELETE_RULE AS d
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME = ?`,
    [table]
  )).map((r) => ({ table: String(r.t), column: String(r.c), onDelete: String(r.d ?? "RESTRICT") }));
}

/** "order_items" → "Order items" */
function label(table: string) {
  const words = table.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type DeleteImpact = {
  resource: string;
  id: string;
  table: string;
  exists: boolean;
  title: string | null;
  /** Rows removed with the record, deepest first. */
  cascades: { table: string; label: string; rows: number }[];
  /** Rows that would block the delete (the FK refuses it). */
  blockers: { table: string; label: string; rows: number }[];
  total: number;
};

export async function getDeleteImpact(resource?: string | null, id?: string | null): Promise<DeleteImpact> {
  const key = String(resource ?? "").trim();
  const rowId = String(id ?? "").trim();
  if (!key || !rowId) throw new Error("target and target_id are required.");
  const table = resourceTable(key);
  if (!table) throw new Error(`Unknown resource "${key}".`);

  const [row] = await queryRows<Row>(`SELECT * FROM \`${table}\` WHERE id = ? LIMIT 1`, [rowId]);
  const cascades: { table: string; label: string; rows: number }[] = [];
  const blockers: { table: string; label: string; rows: number }[] = [];

  if (row) {
    // One level of children, then their children — deep enough to describe the
    // damage without walking the whole schema.
    const seen = new Set<string>([table]);
    const level1 = await childrenOf(table);
    for (const child of level1) {
      const [c] = await queryRows<Row>(`SELECT COUNT(*) AS n FROM \`${child.table}\` WHERE \`${child.column}\` = ?`, [rowId]);
      const n = Number(c?.n ?? 0);
      if (!n) continue;
      const entry = { table: child.table, label: label(child.table), rows: n };
      if (child.onDelete === "CASCADE" || child.onDelete === "SET NULL") cascades.push(entry);
      else blockers.push(entry);
      if (seen.has(child.table)) continue;
      seen.add(child.table);
      for (const grand of await childrenOf(child.table)) {
        if (seen.has(grand.table)) continue;
        const [g] = await queryRows<Row>(
          `SELECT COUNT(*) AS n FROM \`${grand.table}\` WHERE \`${grand.column}\` IN
             (SELECT id FROM \`${child.table}\` WHERE \`${child.column}\` = ?)`,
          [rowId]
        ).catch(() => [{ n: 0 }] as Row[]);
        const gn = Number(g?.n ?? 0);
        if (!gn) continue;
        const entry2 = { table: grand.table, label: `${label(grand.table)} (via ${label(child.table).toLowerCase()})`, rows: gn };
        if (grand.onDelete === "CASCADE" || grand.onDelete === "SET NULL") cascades.push(entry2);
        else blockers.push(entry2);
      }
    }
  }

  const title = row
    ? String(
        row.name_en ?? row.title_en ?? row.full_name ?? row.name ?? row.title ??
        row.listing_code ?? row.order_code ?? row.application_code ?? row.sku ?? row.code ?? `#${rowId}`
      )
    : null;

  return {
    resource: key,
    id: rowId,
    table,
    exists: Boolean(row),
    title,
    cascades,
    blockers,
    total: [...cascades, ...blockers].reduce((sum, c) => sum + c.rows, 0)
  };
}
