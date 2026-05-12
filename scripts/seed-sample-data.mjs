import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const root = process.cwd();
const envPath = path.join(root, ".env.local");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = process.env[key] ?? value;
  }
}

const sqlPath = path.join(root, "database", "seeds", "001_sample_data.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  charset: "utf8mb4",
  multipleStatements: true
});

try {
  await connection.query(sql);
  const [rows] = await connection.query(`
    SELECT 'app_users' AS table_name, COUNT(*) AS total FROM app_users
    UNION ALL SELECT 'interest_categories', COUNT(*) FROM interest_categories
    UNION ALL SELECT 'weather_alerts', COUNT(*) FROM weather_alerts
    UNION ALL SELECT 'sale_listings', COUNT(*) FROM sale_listings
    UNION ALL SELECT 'products', COUNT(*) FROM products
    UNION ALL SELECT 'orders', COUNT(*) FROM orders
    UNION ALL SELECT 'learning_modules', COUNT(*) FROM learning_modules
    UNION ALL SELECT 'partner_applications', COUNT(*) FROM partner_applications
    UNION ALL SELECT 'community_posts', COUNT(*) FROM community_posts
  `);
  console.table(rows);
} finally {
  await connection.end();
}
