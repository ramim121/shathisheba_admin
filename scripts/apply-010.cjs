// Applies migration 010 + seeds the official BD geo dataset to the live DB.
// Also writes a reproducible seeds/003_bd_geo.sql. Idempotent.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const DB = { ...require("./_dbconfig.cjs"), multipleStatements: true };

function esc(v) {
  if (v === null || v === undefined) return "NULL";
  return "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function buildGeoSql(geo) {
  const lines = [];
  lines.push("-- Shathi Sheba — seed 003: official Bangladesh geocode (8 divisions / 64 districts / 494 upazilas)");
  lines.push("USE shathi_sheba;");
  lines.push("");
  const divVals = geo.divisions.map((d, i) => `(${Number(d.id)}, ${esc(d.name)}, ${esc(d.bn_name)}, ${i + 1})`);
  lines.push("INSERT INTO geo_divisions (id, name_en, name_bn, sort_order) VALUES");
  lines.push(divVals.join(",\n") + "\nON DUPLICATE KEY UPDATE name_en=VALUES(name_en), name_bn=VALUES(name_bn), sort_order=VALUES(sort_order);");
  lines.push("");
  const distVals = geo.districts.map((d) => `(${Number(d.id)}, ${Number(d.division_id)}, ${esc(d.name)}, ${esc(d.bn_name)})`);
  lines.push("INSERT INTO geo_districts (id, division_id, name_en, name_bn) VALUES");
  lines.push(distVals.join(",\n") + "\nON DUPLICATE KEY UPDATE division_id=VALUES(division_id), name_en=VALUES(name_en), name_bn=VALUES(name_bn);");
  lines.push("");
  const upaVals = geo.upazilas.map((u) => `(${Number(u.id)}, ${Number(u.district_id)}, ${esc(u.name)}, ${esc(u.bn_name)})`);
  lines.push("INSERT INTO geo_upazilas (id, district_id, name_en, name_bn) VALUES");
  lines.push(upaVals.join(",\n") + "\nON DUPLICATE KEY UPDATE district_id=VALUES(district_id), name_en=VALUES(name_en), name_bn=VALUES(name_bn);");
  lines.push("");
  return lines.join("\n");
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const migration = fs.readFileSync(path.join(root, "database/migrations/010_livestock_listing.sql"), "utf8");
  const geo = JSON.parse(fs.readFileSync(path.join(root, "scripts/geo/bd-geo.json"), "utf8"));

  const geoSql = buildGeoSql(geo);
  const seedPath = path.join(root, "database/seeds/003_bd_geo.sql");
  fs.writeFileSync(seedPath, geoSql, "utf8");
  console.log("wrote", path.relative(root, seedPath));

  const c = await mysql.createConnection(DB);
  console.log("running migration 010 ...");
  await c.query(migration);
  console.log("seeding geo (divisions/districts/upazilas) ...");
  await c.query(geoSql);

  const [[a]] = await c.query("SELECT COUNT(*) n FROM animals");
  const [[b]] = await c.query("SELECT COUNT(*) n FROM animal_breeds");
  const [[d1]] = await c.query("SELECT COUNT(*) n FROM geo_divisions");
  const [[d2]] = await c.query("SELECT COUNT(*) n FROM geo_districts");
  const [[d3]] = await c.query("SELECT COUNT(*) n FROM geo_upazilas");
  const [[sc]] = await c.query("SELECT COUNT(*) n FROM sale_categories");
  const [[pr]] = await c.query("SELECT COUNT(*) n FROM sale_pricing_rules");
  console.log({ animals: a.n, breeds: b.n, divisions: d1.n, districts: d2.n, upazilas: d3.n, sale_categories: sc.n, pricing_rules: pr.n });
  await c.end();
  console.log("done.");
})().catch((e) => { console.error("APPLY ERROR:", e.message); process.exit(1); });
