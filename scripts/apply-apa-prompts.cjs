// Loads database/prompts/*.txt into apa_prompts, keeping the previous body as a
// version row.
//
//   node scripts/apply-apa-prompts.cjs            # apply every prompt file
//   node scripts/apply-apa-prompts.cjs scope      # apply one
//   node scripts/apply-apa-prompts.cjs --check    # compare, change nothing
//
// The prompts live as files rather than as SQL literals for two reasons: they
// contain apostrophes and several thousand characters of Bangla that a migration
// would mangle, and the scope instruction is a safety control that deserves to
// be reviewable in a diff.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const cfg = require("./_dbconfig.cjs");

const DIR = path.resolve(__dirname, "..", "database", "prompts");

const LABELS = {
  persona: "Who Shathi Apa is, and the five prohibitions",
  scope: "What counts as in scope",
  examples: "Worked examples, crop calendar and vocabulary",
  live: "Extra instruction for a spoken call",
  refusal_bn: "The refusal, in Bangla",
  classify: "The scope gate's own instruction",
};

(async () => {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const only = args.filter((a) => !a.startsWith("--"));

  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.replace(/\.txt$/, ""))
    .filter((k) => !only.length || only.includes(k));

  if (!files.length) throw new Error(`No prompt files matched in ${DIR}`);

  const conn = await mysql.createConnection({ ...cfg, charset: "utf8mb4" });
  let changed = 0;

  for (const key of files) {
    const body = fs.readFileSync(path.join(DIR, `${key}.txt`), "utf8").replace(/\r\n/g, "\n").trim();
    const [rows] = await conn.query("SELECT body FROM apa_prompts WHERE prompt_key = ? LIMIT 1", [key]);
    const current = rows[0]?.body ?? null;

    if (current !== null && current.trim() === body) {
      console.log(`  same     ${key} (${body.length} chars)`);
      continue;
    }

    if (check) {
      console.log(`  DIFFERS  ${key}: db ${current === null ? "(absent)" : current.length + " chars"} -> file ${body.length} chars`);
      changed += 1;
      continue;
    }

    // Keep what is being replaced before replacing it.
    if (current !== null) {
      await conn.query(
        "INSERT INTO apa_prompt_versions (prompt_key, body, chars, note) VALUES (?, ?, ?, ?)",
        [key, current, current.length, "replaced by scripts/apply-apa-prompts.cjs"]
      );
    }

    await conn.query(
      `INSERT INTO apa_prompts (prompt_key, label, body) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE body = VALUES(body), label = VALUES(label)`,
      [key, LABELS[key] ?? key, body]
    );
    console.log(`  ${current === null ? "added   " : "updated "} ${key} (${body.length} chars)`);
    changed += 1;
  }

  await conn.end();
  console.log(check ? `\n${changed} prompt(s) differ from the files.` : `\n${changed} prompt(s) written.`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
