// Loads MySQL connection config from environment / .env.local so scripts never
// hardcode credentials (safe to commit). Run scripts from the project root, or
// with MYSQL_* env vars set.
const fs = require("fs");
const path = require("path");

function loadEnvFile() {
  const file = path.resolve(__dirname, "..", ".env.local");
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key] !== undefined) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch {
    /* no .env.local — rely on process.env */
  }
}

loadEnvFile();

if (!process.env.MYSQL_HOST || !process.env.MYSQL_PASSWORD) {
  throw new Error("Missing MYSQL_* env vars. Set them or provide .env.local in the project root.");
}

module.exports = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  charset: "utf8mb4"
};
