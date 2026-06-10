// Applies migration 017 (admin_sessions) and seeds the bootstrap admin login.
// Password hashing mirrors lib/auth.ts (scrypt$salt$hash). Idempotent.
// DB credentials come from .env.local via _dbconfig.cjs — never hardcoded here.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { randomBytes, scryptSync } = require("node:crypto");
const DB = { ...require("./_dbconfig.cjs"), multipleStatements: true };

const ADMIN = {
  name: "Tech Admin",
  email: "tech@digigramventures.com",
  password: "1234",
  role: "super_admin"
};

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

(async () => {
  const root = path.resolve(__dirname, "..");
  const c = await mysql.createConnection(DB);
  await c.query(fs.readFileSync(path.join(root, "database/migrations/017_admin_auth.sql"), "utf8"));

  const hash = hashPassword(ADMIN.password);
  const [rows] = await c.query("SELECT id FROM admin_users WHERE email = ?", [ADMIN.email]);
  if (rows.length) {
    await c.query("UPDATE admin_users SET name=?, password_hash=?, role=?, is_active=1 WHERE id=?", [ADMIN.name, hash, ADMIN.role, rows[0].id]);
    console.log("updated admin:", ADMIN.email, "id", rows[0].id);
  } else {
    const [ins] = await c.query(
      "INSERT INTO admin_users (name, email, password_hash, role, is_active) VALUES (?,?,?,?,1)",
      [ADMIN.name, ADMIN.email, hash, ADMIN.role]
    );
    console.log("created admin:", ADMIN.email, "id", ins.insertId);
  }
  const [chk] = await c.query("SELECT id, name, email, role, is_active FROM admin_users WHERE email = ?", [ADMIN.email]);
  console.log("admin row:", JSON.stringify(chk[0]));
  await c.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
