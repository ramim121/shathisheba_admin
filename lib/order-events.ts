import { executeQuery, type Tx } from "@/lib/db";

/**
 * The order timeline the buyer sees. orders only holds the current status, so
 * each change is also written here with its time. Every path that changes an
 * order status calls this: placement, the approvals queue, and the orders /
 * payments editors.
 */
export async function recordOrderEvent(
  orderId: string | number,
  status: string,
  opts: { kind?: "fulfillment" | "payment"; note?: string | null; tx?: Tx } = {}
) {
  const sql = "INSERT INTO order_events (order_id, kind, status, note) VALUES (?, ?, ?, ?)";
  const values = [orderId, opts.kind ?? "fulfillment", status, opts.note ?? null];
  if (opts.tx) await opts.tx.execute(sql, values);
  else await executeQuery(sql, values);
}
