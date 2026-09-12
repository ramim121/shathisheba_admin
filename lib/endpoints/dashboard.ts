import { queryRows } from "@/lib/db";

type Row = Record<string, unknown>;

/**
 * GET /api/v1/admin/dashboard/overview — what the MIS dashboard charts and
 * lists, straight from the tables: six months of activity, the latest events
 * across the app, and the market updates currently on the home screen.
 */
export async function getDashboardOverview() {
  // Month buckets, oldest first, so months with no activity still plot as 0.
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleString("en-GB", { month: "short" })
    });
  }
  const since = `${months[0].key}-01`;
  const monthly = async (table: string) => {
    const rows = await queryRows<Row>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, COUNT(*) AS n FROM ${table} WHERE created_at >= ? GROUP BY ym`,
      [since]
    );
    return new Map(rows.map((r) => [String(r.ym), Number(r.n)]));
  };
  const [orders, listings, enrollments, farmers] = await Promise.all([
    monthly("orders"), monthly("sale_listings"), monthly("partner_applications"), monthly("app_users")
  ]);
  const trend = months.map((m) => ({
    month: m.label,
    orders: orders.get(m.key) ?? 0,
    listings: listings.get(m.key) ?? 0,
    enrollments: enrollments.get(m.key) ?? 0,
    farmers: farmers.get(m.key) ?? 0
  }));

  const activity = await queryRows<Row>(
    `(SELECT 'order' AS kind, CAST(o.id AS CHAR) AS id, o.order_code AS ref, u.full_name AS who,
             CONCAT('৳', FORMAT(o.payable_amount, 0)) AS detail, o.fulfillment_status AS status, o.created_at AS at
        FROM orders o JOIN app_users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 6)
     UNION ALL
     (SELECT 'listing', CAST(l.id AS CHAR), l.listing_code, u.full_name,
             COALESCE(l.title_en, ''), l.status, l.created_at
        FROM sale_listings l JOIN app_users u ON u.id = l.user_id ORDER BY l.created_at DESC LIMIT 6)
     UNION ALL
     (SELECT 'enrollment', CAST(a.id AS CHAR), a.application_code, u.full_name,
             COALESCE(p.name_en, ''), a.status, a.created_at
        FROM partner_applications a JOIN app_users u ON u.id = a.user_id
        LEFT JOIN partner_projects p ON p.id = a.partner_project_id ORDER BY a.created_at DESC LIMIT 6)
     UNION ALL
     (SELECT 'farmer', CAST(u.id AS CHAR), u.phone, u.full_name, COALESCE(u.district, ''), u.status, u.created_at
        FROM app_users u ORDER BY u.created_at DESC LIMIT 6)
     ORDER BY at DESC LIMIT 10`
  );

  const updates = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, title_en AS title,
            CONCAT(COALESCE(district, 'All districts'), IFNULL(CONCAT(' / ', upazila), '')) AS area,
            update_type AS type, status, created_at
       FROM market_updates ORDER BY created_at DESC LIMIT 4`
  );

  return { trend, activity, updates };
}
