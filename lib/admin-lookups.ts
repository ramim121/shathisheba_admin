import { queryRows } from "@/lib/db";

/**
 * Named options for the admin forms.
 *
 * Every foreign key on a form used to be a bare number box: "Animal id", "Breed
 * id", "Sale item id". Filling one correctly meant already knowing that 6 is
 * "Local / Deshi" — which nobody does. Each entry here turns one such column
 * into a picker that shows the name and submits the id.
 *
 * The SQL is fixed per key and takes no caller input, so a bad `key` returns
 * nothing rather than reaching the database at all.
 */

export type LookupOption = { id: string; label: string; group?: string };

const LOOKUPS: Record<string, string> = {
  users: `
    SELECT CAST(id AS CHAR) AS id,
           CONCAT(full_name, ' · ', phone) AS label,
           COALESCE(district, 'Unassigned') AS \`group\`
    FROM app_users
    ORDER BY full_name
    LIMIT 500
  `,
  "sale-categories": `
    SELECT CAST(id AS CHAR) AS id,
           CONCAT(name_en, ' / ', COALESCE(name_bn, '')) AS label,
           IF(is_active = 1, 'Active', 'Inactive') AS \`group\`
    FROM sale_categories
    ORDER BY sort_order, name_en
  `,
  "sale-items": `
    SELECT CAST(si.id AS CHAR) AS id,
           CONCAT(si.name_en, ' / ', COALESCE(si.name_bn, '')) AS label,
           c.name_en AS \`group\`
    FROM sale_items si
    JOIN sale_categories c ON c.id = si.sale_category_id
    ORDER BY c.sort_order, si.name_en
  `,
  animals: `
    SELECT CAST(id AS CHAR) AS id,
           CONCAT(COALESCE(emoji, ''), ' ', name_en, ' / ', COALESCE(name_bn, '')) AS label,
           species AS \`group\`
    FROM animals
    ORDER BY sort_order, name_en
  `,
  breeds: `
    SELECT CAST(id AS CHAR) AS id,
           CONCAT(name_en, ' / ', COALESCE(name_bn, '')) AS label,
           animal_type AS \`group\`
    FROM animal_breeds
    WHERE is_active = 1
    ORDER BY animal_type, sort_order, name_en
  `,
  "buy-categories": `
    SELECT CAST(id AS CHAR) AS id,
           CONCAT(name_en, ' / ', COALESCE(name_bn, '')) AS label,
           IF(is_active = 1, 'Active', 'Inactive') AS \`group\`
    FROM buy_categories
    ORDER BY sort_order, name_en
  `,
  products: `
    SELECT CAST(p.id AS CHAR) AS id,
           CONCAT(p.name_en, ' · ৳', p.price, '/', p.unit) AS label,
           c.name_en AS \`group\`
    FROM products p
    JOIN buy_categories c ON c.id = p.buy_category_id
    ORDER BY c.sort_order, p.name_en
    LIMIT 500
  `,
  "learning-categories": `
    SELECT CAST(id AS CHAR) AS id,
           CONCAT(name_en, ' / ', COALESCE(name_bn, '')) AS label
    FROM learning_categories
    ORDER BY sort_order, name_en
  `,
  "learning-modules": `
    SELECT CAST(m.id AS CHAR) AS id,
           m.title_en AS label,
           c.name_en AS \`group\`
    FROM learning_modules m
    LEFT JOIN learning_categories c ON c.id = m.learning_category_id
    ORDER BY c.sort_order, m.title_en
    LIMIT 500
  `,
  "partner-projects": `
    SELECT CAST(id AS CHAR) AS id,
           CONCAT(project_code, ' · ', name_en) AS label,
           IF(is_active = 1, 'Active', 'Closed / coming soon') AS \`group\`
    FROM partner_projects
    ORDER BY is_active DESC, name_en
  `,
  "zone-officers": `
    SELECT CAST(id AS CHAR) AS id,
           CONCAT(name, ' · ', phone) AS label,
           CONCAT(COALESCE(district, ''), ' — ', officer_role) AS \`group\`
    FROM zone_officers
    WHERE is_active = 1
    ORDER BY district, name
  `,
  "geo-divisions": `
    SELECT CAST(id AS CHAR) AS id,
           CONCAT(name_en, ' / ', COALESCE(name_bn, '')) AS label
    FROM geo_divisions
    ORDER BY sort_order, name_en
  `,
  "geo-districts": `
    SELECT CAST(d.id AS CHAR) AS id,
           CONCAT(d.name_en, ' / ', COALESCE(d.name_bn, '')) AS label,
           v.name_en AS \`group\`
    FROM geo_districts d
    JOIN geo_divisions v ON v.id = d.division_id
    ORDER BY v.sort_order, d.name_en
  `,
  "sale-listings": `
    SELECT CAST(l.id AS CHAR) AS id,
           CONCAT(l.listing_code, ' · ', COALESCE(u.full_name, 'Unknown')) AS label,
           l.status AS \`group\`
    FROM sale_listings l
    LEFT JOIN app_users u ON u.id = l.user_id
    ORDER BY l.created_at DESC
    LIMIT 300
  `,
  "scorecard-criteria": `
    SELECT CAST(c.id AS CHAR) AS id,
           CONCAT(c.code, ' · ', c.name_en) AS label,
           m.name AS \`group\`
    FROM scorecard_criteria c
    LEFT JOIN scorecard_models m ON m.id = c.scorecard_model_id
    ORDER BY m.name, c.sort_order
  `,
  lenders: `
    SELECT CAST(id AS CHAR) AS id, name AS label
    FROM lenders
    ORDER BY name
  `,
  "loan-products": `
    SELECT CAST(id AS CHAR) AS id,
           CONCAT(name_en, ' · ', interest_rate_pct, '%') AS label
    FROM loan_products
    ORDER BY name_en
  `
};

export function isLookupKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOOKUPS, key);
}

export async function getLookupOptions(key: string): Promise<LookupOption[]> {
  const sql = LOOKUPS[key];
  if (!sql) return [];
  const rows = await queryRows<Record<string, unknown>>(sql);
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    label: String(row.label ?? row.id ?? ""),
    group: row.group === null || row.group === undefined ? undefined : String(row.group)
  }));
}
