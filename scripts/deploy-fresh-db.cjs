// One-shot fresh-database deploy: applies every migration (001→019) in order,
// then the seed SQL files. Idempotent where the underlying SQL is. Target DB
// comes from MYSQL_* env vars (see _dbconfig.cjs) — credentials are never
// hardcoded here. Usage:
//   MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DATABASE=shathi_sheba \
//     node scripts/deploy-fresh-db.cjs
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const DB = { ...require("./_dbconfig.cjs"), multipleStatements: true, connectTimeout: 30000 };

const root = path.resolve(__dirname, "..");

async function runSqlFile(conn, file) {
  let sql = fs.readFileSync(file, "utf8");
  // The files target a database literally named shathi_sheba. When deploying to a
  // pre-created database of the same name this is a no-op; strip CREATE DATABASE
  // in case the target user lacks that privilege.
  sql = sql.replace(/CREATE DATABASE IF NOT EXISTS[^;]+;/gi, "");
  await conn.query(sql);
}

(async () => {
  console.log(`Target: ${DB.host} / ${DB.database}`);
  const conn = await mysql.createConnection(DB);

  // Fresh-deploy semantics: start from an empty schema. Drops whatever partial
  // state exists in the TARGET database (guarded by FK checks off).
  if (process.env.DEPLOY_WIPE === "1") {
    const [existing] = await conn.query("SHOW TABLES");
    const names = existing.map((r) => Object.values(r)[0]);
    if (names.length) {
      console.log(`wiping ${names.length} existing table(s) in ${DB.database} ...`);
      await conn.query("SET FOREIGN_KEY_CHECKS = 0");
      for (const t of names) await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
      await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    }
  }

  // Replays history in the order it actually happened: base schema (001-002),
  // then the base sample/seed data those-era files expect, then the rest of the
  // migrations (010 references sale_items seeded by 001), then the geo dataset
  // (its tables are created by migration 010).
  const plan = [
    ["database/migrations", ["001_initial_shathi_sheba_mysql.sql", "002_app_alignment.sql"]],
    ["database/seeds", ["001_sample_data.sql", "002_app_alignment.sql"]],
    ["database/migrations", fs.readdirSync(path.join(root, "database/migrations")).filter((f) => f.endsWith(".sql") && !/^00[12]_/.test(f)).sort()],
    ["database/seeds", ["003_bd_geo.sql"]]
  ];
  for (const [dir, files] of plan) {
    for (const f of files) {
      process.stdout.write(`${dir.includes("seeds") ? "seed" : "migration"} ${f} ... `);
      await runSqlFile(conn, path.join(root, dir, f));
      console.log("ok");
    }
  }

  // Verification: table count + key reference-data row counts.
  const [tables] = await conn.query("SHOW TABLES");
  const checks = [
    "geo_divisions", "geo_districts", "geo_upazilas", "sale_categories", "sale_items",
    "animals", "animal_breeds", "buy_categories", "products", "partner_projects",
    "sale_pricing_rules", "learning_modules", "learning_contents", "app_users", "admin_users"
  ];
  const counts = {};
  for (const t of checks) {
    try {
      const [r] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      counts[t] = r[0].n;
    } catch {
      counts[t] = "MISSING";
    }
  }
  console.log(`\ntables: ${tables.length}`);
  console.log(JSON.stringify(counts, null, 2));
  await conn.end();
})().catch((e) => {
  console.error("DEPLOY FAILED:", e.message);
  process.exit(1);
});
