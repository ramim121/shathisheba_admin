// Applies one or more SQL migrations by filename, in the order given:
//
//   node scripts/apply-migrations.cjs 028_sale_progress_pricing_projects.sql
//
// Every migration in database/migrations/ is written to be idempotent, so a
// re-run is a no-op rather than an error. Failures are reported per file and do
// not stop the remaining ones — a migration that has already been applied
// should not block the one after it.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DB = { ...require("./_dbconfig.cjs"), multipleStatements: true };
const DIR = path.join(__dirname, "..", "database", "migrations");

(async () => {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: node scripts/apply-migrations.cjs <file.sql> [...]");
    process.exit(1);
  }
  const conn = await mysql.createConnection(DB);
  let failed = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(DIR, file), "utf8");
    try {
      await conn.query(sql);
      console.log("OK  " + file);
    } catch (e) {
      failed += 1;
      console.log("ERR " + file + ": " + e.message);
    }
  }
  await conn.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
