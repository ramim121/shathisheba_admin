import { queryRows, withTransaction, type Tx } from "@/lib/db";
import { resourceTable } from "@/lib/db-resources";

type Row = Record<string, unknown>;

/**
 * What a delete would take with it.
 *
 * Deleting a record in the console used to be one browser confirm() with no
 * idea of the blast radius. This walks the foreign keys pointing at the row's
 * table — and their children — and counts what hangs off it, so the modal can
 * say "this order, its 3 line items and 2 status events" before anything is
 * removed. Each relation also carries a stable `key`, which the preview and
 * the cascade delete use to name a relation without ever taking a table or
 * column name from the request.
 *
 * Read-only apart from `cascadeDelete`, and every table/column name comes from
 * information_schema.
 */

type Link = { table: string; column: string; onDelete: string };

async function childrenOf(table: string): Promise<Link[]> {
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

/**
 * What happens to the dependent rows:
 *   cascade — the database removes them with the record
 *   detach  — they survive with the link blanked (SET NULL), and usually stop
 *             meaning anything: an order item with no order, a repayment with
 *             no loan account
 *   block   — the foreign key refuses the delete until they are gone
 */
export type ImpactEffect = "cascade" | "detach" | "block";

export type ImpactEntry = {
  /** Stable name for this relation; the only relation identifier a client sends back. */
  key: string;
  table: string;
  column: string;
  label: string;
  rows: number;
  effect: ImpactEffect;
  /** Set on a second-level relation: the child table it hangs off. */
  via?: string;
};

export type DeleteImpact = {
  resource: string;
  id: string;
  table: string;
  exists: boolean;
  title: string | null;
  /** Every dependent relation with at least one row, blockers first. */
  entries: ImpactEntry[];
  /** Kept for callers that only want the two buckets. */
  cascades: ImpactEntry[];
  blockers: ImpactEntry[];
  total: number;
  blockedRows: number;
};

function effectOf(rule: string): ImpactEffect {
  if (rule === "CASCADE") return "cascade";
  if (rule === "SET NULL") return "detach";
  return "block";
}

/**
 * The relation graph for one row, two levels deep — enough to describe the
 * damage without walking the whole schema. Shared by the impact summary, the
 * row preview and the cascade delete so all three agree on what is reachable.
 */
async function relationsFor(table: string, rowId: string): Promise<ImpactEntry[]> {
  const entries: ImpactEntry[] = [];
  const seen = new Set<string>([table]);

  for (const child of await childrenOf(table)) {
    const [c] = await queryRows<Row>(
      `SELECT COUNT(*) AS n FROM \`${child.table}\` WHERE \`${child.column}\` = ?`,
      [rowId]
    );
    const rows = Number(c?.n ?? 0);
    if (rows) {
      entries.push({
        key: `${child.table}.${child.column}`,
        table: child.table,
        column: child.column,
        label: label(child.table),
        rows,
        effect: effectOf(child.onDelete)
      });
    }
    if (seen.has(child.table)) continue;
    seen.add(child.table);

    for (const grand of await childrenOf(child.table)) {
      if (seen.has(grand.table)) continue;
      const [g] = await queryRows<Row>(
        `SELECT COUNT(*) AS n FROM \`${grand.table}\` WHERE \`${grand.column}\` IN
           (SELECT id FROM \`${child.table}\` WHERE \`${child.column}\` = ?)`,
        [rowId]
      ).catch(() => [{ n: 0 }] as Row[]);
      const rows2 = Number(g?.n ?? 0);
      if (!rows2) continue;
      entries.push({
        key: `${grand.table}.${grand.column}@${child.table}.${child.column}`,
        table: grand.table,
        column: grand.column,
        label: `${label(grand.table)} (via ${label(child.table).toLowerCase()})`,
        rows: rows2,
        effect: effectOf(grand.onDelete),
        via: child.table
      });
    }
  }

  // Blockers first: they are what the admin has to decide about.
  const order: Record<ImpactEffect, number> = { block: 0, cascade: 1, detach: 2 };
  return entries.sort((a, b) => order[a.effect] - order[b.effect] || b.rows - a.rows);
}

function titleOf(row: Row | undefined, rowId: string): string | null {
  if (!row) return null;
  return String(
    row.name_en ?? row.title_en ?? row.full_name ?? row.name ?? row.title ??
    row.listing_code ?? row.order_code ?? row.application_code ?? row.sku ?? row.code ?? `#${rowId}`
  );
}

export async function getDeleteImpact(resource?: string | null, id?: string | null): Promise<DeleteImpact> {
  const key = String(resource ?? "").trim();
  const rowId = String(id ?? "").trim();
  if (!key || !rowId) throw new Error("target and target_id are required.");
  const table = resourceTable(key);
  if (!table) throw new Error(`Unknown resource "${key}".`);

  const [row] = await queryRows<Row>(`SELECT * FROM \`${table}\` WHERE id = ? LIMIT 1`, [rowId]);
  const entries = row ? await relationsFor(table, rowId) : [];
  const blockers = entries.filter((e) => e.effect === "block");

  return {
    resource: key,
    id: rowId,
    table,
    exists: Boolean(row),
    title: titleOf(row, rowId),
    entries,
    cascades: entries.filter((e) => e.effect !== "block"),
    blockers,
    total: entries.reduce((sum, e) => sum + e.rows, 0),
    blockedRows: blockers.reduce((sum, e) => sum + e.rows, 0)
  };
}

/* ---------------------------------------------------------------------------
   Row preview
   --------------------------------------------------------------------------- */

const PREVIEW_LIMIT = 25;

/** Columns worth showing in a preview: skip blobs, JSON and secrets. */
async function previewColumns(table: string): Promise<string[]> {
  const cols = await queryRows<Row>(
    `SELECT COLUMN_NAME AS c, DATA_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [table]
  );
  const usable = cols
    .filter((c) => !["json", "blob", "longblob", "mediumblob", "longtext", "mediumtext"].includes(String(c.t)))
    .map((c) => String(c.c))
    .filter((c) => !/password|token|secret|_json$/i.test(c));

  // Identity and state first, then the columns that say what the row *is*,
  // and timestamps last. Ordering by position alone filled the preview with
  // created_at/updated_at/moderated_at and left out the post's own scope.
  const isIdentity = (c: string) => /^(id|.*_code|code|sku|name.*|title.*|full_name|label.*|status|.*_status)$/i.test(c);
  const isDate = (c: string) => /_at$|_on$|_date$|^date_/i.test(c);
  const isForeignKey = (c: string) => /_id$/i.test(c) && c !== "id";
  const identity = usable.filter(isIdentity);
  const body = usable.filter((c) => !isIdentity(c) && !isDate(c) && !isForeignKey(c));
  const keys = usable.filter((c) => isForeignKey(c) && !isIdentity(c));
  const dates = usable.filter((c) => isDate(c) && !isIdentity(c));
  return [...new Set([...identity, ...body, ...keys, ...dates])].slice(0, 7);
}

export type ImpactRows = {
  key: string;
  table: string;
  label: string;
  effect: ImpactEffect;
  columns: string[];
  rows: Row[];
  total: number;
  truncated: boolean;
};

/**
 * Resolve a relation key against the foreign-key graph, structurally — no row
 * counts. The summary endpoint counts every relation because that is what it
 * is for; a preview only needs to know that this one relation really hangs off
 * this table, and re-counting the whole graph to answer that made expanding a
 * row take seconds.
 */
async function resolveRelation(table: string, key: string): Promise<ImpactEntry | null> {
  const [childPart, viaPart] = key.split("@");
  const [childTable, childColumn] = childPart.split(".");
  if (!childTable || !childColumn) return null;

  if (!viaPart) {
    const link = (await childrenOf(table)).find((l) => l.table === childTable && l.column === childColumn);
    if (!link) return null;
    return {
      key,
      table: link.table,
      column: link.column,
      label: label(link.table),
      rows: 0,
      effect: effectOf(link.onDelete)
    };
  }

  const [viaTable, viaColumn] = viaPart.split(".");
  const parentLink = (await childrenOf(table)).find((l) => l.table === viaTable && l.column === viaColumn);
  if (!parentLink) return null;
  const link = (await childrenOf(viaTable)).find((l) => l.table === childTable && l.column === childColumn);
  if (!link) return null;
  return {
    key,
    table: link.table,
    column: link.column,
    label: `${label(link.table)} (via ${label(viaTable).toLowerCase()})`,
    rows: 0,
    effect: effectOf(link.onDelete),
    via: viaTable
  };
}

/**
 * The actual dependent rows behind one relation, for the "View" disclosure in
 * the delete modal. `relationKey` is matched against the graph rebuilt from
 * information_schema — a name that is not in it is rejected, so the request
 * cannot reach a table the record does not own.
 */
export async function getDeleteImpactRows(
  resource?: string | null,
  id?: string | null,
  relationKey?: string | null
): Promise<ImpactRows> {
  const key = String(resource ?? "").trim();
  const rowId = String(id ?? "").trim();
  const rel = String(relationKey ?? "").trim();
  if (!key || !rowId || !rel) throw new Error("target, target_id and relation are required.");
  const table = resourceTable(key);
  if (!table) throw new Error(`Unknown resource "${key}".`);

  const entry = await resolveRelation(table, rel);
  if (!entry) throw new Error("That relation is not part of this record.");

  const columns = await previewColumns(entry.table);
  const select = columns.map((c) => `\`${c}\``).join(", ") || "*";
  const where = entry.via
    ? `\`${entry.column}\` IN (SELECT id FROM \`${entry.via}\` WHERE \`${relParentColumn(entry)}\` = ?)`
    : `\`${entry.column}\` = ?`;

  const [count] = await queryRows<Row>(`SELECT COUNT(*) AS n FROM \`${entry.table}\` WHERE ${where}`, [rowId]);
  const total = Number(count?.n ?? 0);
  const rows = total
    ? await queryRows<Row>(
        `SELECT ${select} FROM \`${entry.table}\` WHERE ${where} ORDER BY 1 DESC LIMIT ${PREVIEW_LIMIT}`,
        [rowId]
      )
    : [];

  return {
    key: entry.key,
    table: entry.table,
    label: entry.label,
    effect: entry.effect,
    columns,
    rows,
    total,
    truncated: total > rows.length
  };
}

/** The parent-side column encoded in a second-level relation key. */
function relParentColumn(entry: ImpactEntry): string {
  const viaPart = entry.key.split("@")[1] ?? "";
  return viaPart.split(".")[1] ?? "id";
}

/* ---------------------------------------------------------------------------
   Cascade delete
   --------------------------------------------------------------------------- */

export type CascadeResult = { table: string; label: string; rows: number }[];

/**
 * Clear the rows that would otherwise refuse the delete, deepest first, in one
 * transaction. Only relations the graph above reports as `block` are touched,
 * and only when the caller asked for it explicitly — the modal makes the admin
 * tick the box after showing them what is in there.
 */
export async function clearDeleteBlockers(resource: string, id: string): Promise<CascadeResult> {
  const table = resourceTable(resource);
  if (!table) throw new Error(`Unknown resource "${resource}".`);
  const entries = (await relationsFor(table, id)).filter((e) => e.effect === "block");
  if (entries.length === 0) return [];

  // Second-level rows first: deleting the child they hang off would be refused
  // while they still point at it.
  const deepest = [...entries].sort((a, b) => (b.via ? 1 : 0) - (a.via ? 1 : 0));

  return withTransaction(async (tx: Tx) => {
    const done: CascadeResult = [];
    for (const entry of deepest) {
      const result = entry.via
        ? await tx.execute(
            `DELETE child FROM \`${entry.table}\` child
               JOIN \`${entry.via}\` parent ON parent.id = child.\`${entry.column}\`
              WHERE parent.\`${relParentColumn(entry)}\` = ?`,
            [id]
          )
        : await tx.execute(
            `DELETE FROM \`${entry.table}\` WHERE \`${entry.column}\` = ?`,
            [id]
          );
      done.push({ table: entry.table, label: entry.label, rows: Number(result?.affectedRows ?? entry.rows) });
    }
    return done;
  });
}
