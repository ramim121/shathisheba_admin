// Applies database/migrations/035 statement by statement. MySQL 8.0 has no
// ADD COLUMN IF NOT EXISTS, so "already exists" errors mean that statement was
// applied on an earlier run and are skipped; anything else stops the run.
// Usage (from the project root): node scripts/apply-035.cjs
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const cfg = require("./_dbconfig.cjs");

const ALREADY = new Set([
  "ER_DUP_FIELDNAME", // 1060 duplicate column
  "ER_DUP_KEYNAME", // 1061 duplicate index
  "ER_TABLE_EXISTS_ERROR", // 1050
  "ER_FK_DUP_NAME", // 1826 duplicate foreign key
  "ER_DUP_KEY" // 1022
]);

function statements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n")
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

(async () => {
  const file = path.resolve(__dirname, "..", "database", "migrations", "035_promotions_listing_workflow_product_geo.sql");
  const conn = await mysql.createConnection({ ...cfg, multipleStatements: false, charset: "utf8mb4" });
  let applied = 0;
  let skipped = 0;
  for (const stmt of statements(fs.readFileSync(file, "utf8"))) {
    const head = stmt.replace(/\s+/g, " ").slice(0, 90);
    try {
      const [res] = await conn.query(stmt);
      applied++;
      console.log(`ok   ${head}${res && res.affectedRows !== undefined ? `  (rows ${res.affectedRows})` : ""}`);
    } catch (e) {
      if (ALREADY.has(e.code)) {
        skipped++;
        console.log(`skip ${head}  (${e.code})`);
        continue;
      }
      console.error(`FAIL ${head}\n     ${e.code}: ${e.message}`);
      await conn.end();
      process.exit(1);
    }
  }
  console.log(`\n${applied} applied, ${skipped} already present.`);
  await conn.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
