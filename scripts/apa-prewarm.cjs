// Fill the answer cache before the farmers wake up.
//
//   node scripts/apa-prewarm.cjs                  # apply
//   node scripts/apa-prewarm.cjs --dry-run        # show what it would ask
//   node scripts/apa-prewarm.cjs --limit 40       # cap the requests
//   node scripts/apa-prewarm.cjs --days 21        # widen the history window
//
// Run it shortly after the quota reset (midnight Pacific = 14:00 Dhaka):
//   30 14 * * *  cd /var/www/html/shathisheba-admin && node scripts/apa-prewarm.cjs >> /var/log/apa-prewarm.log 2>&1
//
// WHY THIS EXISTS
//
// The analysis document's fourth lever was Gemini's Batch API: half price for
// work that can wait a day. It is measured as unavailable here —
// `models/*:batchGenerateContent` returns
//
//     HTTP 400  FAILED_PRECONDITION  "Precondition check failed."
//
// on this project's key, which is what Google returns when a feature needs
// billing enabled. So the discount is not reachable from the free tier, and
// this is the free-tier substitute for it.
//
// The observation it trades on: the per-model daily allowance resets at
// midnight Pacific, which is two in the afternoon in Dhaka, and almost nothing
// is asked between then and the next morning. That leaves most of a day's
// requests sitting idle overnight. Spending a few dozen of them on the
// questions farmers demonstrably ask every morning means those mornings are
// served out of the cache at a cost of zero requests — which on a
// request-capped tier is worth more than a 50% discount on money we are not
// spending.
//
// WHAT IT WILL AND WILL NOT PRE-WARM
//
// Only questions whose answers have never needed a grounding tool. A question
// that reads the weather or today's market price cannot be usefully answered in
// advance — the answer would be about yesterday — and the cache's own windows
// already keep those short. Pure agronomy ("how do I dry paddy after the
// harvest", "what fertiliser for aman") is stable for the whole day, which is
// exactly why it is worth holding.
//
// The guard is belt-and-braces rather than a prediction: if a pre-warm call
// turns out to hit a tool after all, or comes back marked not cacheable, the
// answer is **discarded** instead of stored. Writing a stale weather answer
// into a cache that fifty farmers will be served from is worse than making
// fifty requests.
//
// It is also per district. The district is part of the cache key because the
// whole value of an answer is that it is about her area, and an answer
// generated with Rangpur's context must never be served to Khulna.

const crypto = require("crypto");
const mysql = require("mysql2/promise");
const cfgDb = require("./_dbconfig.cjs");

// The pipeline is TypeScript under `@/` aliases, so it is reached through the
// running server rather than imported. That also means a pre-warm exercises
// exactly the code path a farmer's question takes, including the prompt in
// force right now — a warm-up against a different code path would cache
// answers the live path would never have produced.
const ORIGIN = process.env.SELF_ORIGIN || "http://127.0.0.1:3000";

/**
 * Authenticate as an admin for the length of this run, and no longer.
 *
 * This script already holds the database credentials, so it mints itself a
 * session row and deletes it at the end. The alternative — a shared secret
 * header on a new public endpoint — would mean a second authentication
 * mechanism to keep out of logs, backups and process lists, in exchange for
 * nothing. A ten-minute session that is revoked in a `finally` is a smaller
 * surface than a permanent secret.
 */
async function mintSession(conn) {
  const [[admin]] = await conn.query(
    "SELECT id FROM admin_users WHERE is_active = 1 ORDER BY id LIMIT 1"
  );
  if (!admin) throw new Error("no active admin user to run as");
  const token = `prewarm_${crypto.randomBytes(24).toString("hex")}`;
  await conn.query(
    `INSERT INTO admin_sessions (admin_user_id, token, user_agent, expires_at)
     VALUES (?, ?, 'apa-prewarm', NOW() + INTERVAL 10 MINUTE)`,
    [admin.id, token]
  );
  return token;
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const DRY = process.argv.includes("--dry-run");
const LIMIT = Math.max(1, Number(arg("--limit", 60)) || 60);
const DAYS = Math.max(3, Number(arg("--days", 14)) || 14);
/** A question one person asked once is not a pattern. */
const MIN_ASKS = Math.max(2, Number(arg("--min-asks", 2)) || 2);

(async () => {
  const conn = await mysql.createConnection({ ...cfgDb, charset: "utf8mb4" });

  const [[setting]] = await conn.query(
    "SELECT value_text FROM app_settings WHERE setting_key = 'apa_prewarm_enabled' LIMIT 1"
  );
  if (!DRY && setting && String(setting.value_text) === "0") {
    console.log("apa_prewarm_enabled is off — nothing to do.");
    await conn.end();
    return;
  }

  // What farmers actually ask, per district, that never needed a tool.
  //
  // `tools_json` on the assistant reply is the record of whether a
  // grounding lookup happened. An empty array is the signal that the answer was
  // general agronomy, which is the only kind worth holding for a day.
  const [rows] = await conn.query(
    `SELECT c.district_id,
            d.name_bn AS district_name,
            m.body AS question,
            COUNT(*) AS asks,
            MAX(u.id) AS any_user_id
       FROM apa_messages m
       JOIN apa_conversations c ON c.id = m.conversation_id
       LEFT JOIN geo_districts d ON d.id = c.district_id
       JOIN app_users u ON u.id = m.user_id
       JOIN apa_messages a
            ON a.conversation_id = m.conversation_id
           AND a.role = 'assistant'
           AND a.id = (SELECT MIN(x.id) FROM apa_messages x
                        WHERE x.conversation_id = m.conversation_id
                          AND x.role = 'assistant' AND x.id > m.id)
      WHERE m.role = 'user'
        AND m.body IS NOT NULL
        AND CHAR_LENGTH(m.body) BETWEEN 8 AND 300
        AND m.created_at > NOW() - INTERVAL ? DAY
        AND a.refused = 0
        AND COALESCE(JSON_LENGTH(a.tools_json), 0) = 0
        AND c.district_id IS NOT NULL
      GROUP BY c.district_id, d.name_bn, m.body
     HAVING asks >= ?
      ORDER BY asks DESC, c.district_id
      LIMIT ?`,
    [DAYS, MIN_ASKS, LIMIT * 3]
  );

  if (!rows.length) {
    console.log(
      `Nothing worth pre-warming: no tool-free question was asked ${MIN_ASKS}+ times in the last ${DAYS} days.`
    );
    console.log("That is the normal answer early on — it needs a fortnight of real questions first.");
    await conn.end();
    return;
  }

  // Context for the log line only. Whether a particular question is already
  // held is decided by the server, against its own key function — re-deriving
  // that hash here in a second language would drift the first time either side
  // changed.
  const [[heldToday]] = await conn.query(
    "SELECT COUNT(*) AS n FROM apa_answer_cache WHERE for_day = CURDATE()"
  );

  console.log(
    `${rows.length} candidate question/district pairs from ${DAYS} days · ${heldToday.n} already held for today` +
      (DRY ? " (dry run)" : "")
  );

  let asked = 0;
  let stored = 0;
  let discarded = 0;
  let failed = 0;
  let held = 0;
  const session = DRY ? "" : await mintSession(conn);

  try {
  for (const row of rows) {
    if (asked >= LIMIT) {
      console.log(`\nStopping at the ${LIMIT}-request limit.`);
      break;
    }

    const label = `[${row.district_name || row.district_id}] ${String(row.question).slice(0, 52)}`;



    if (DRY) {
      console.log(`  would ask  ${label}  (asked ${row.asks}×)`);
      asked += 1;
      continue;
    }

    try {
      // Driven through the ordinary endpoint as the farmer who asked it, so
      // the district, the farm context and the prompt are the real ones. The
      // `prewarm` flag tells the server to answer and cache without logging a
      // conversation turn or spending her trial.
      const res = await fetch(`${ORIGIN}/api/v1/admin/apa/prewarm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `admin_session=${session}`
        },
        body: JSON.stringify({
          user_id: String(row.any_user_id),
          text: String(row.question)
        })
      });
      const json = await res.json();
      asked += 1;

      if (!res.ok || !json.ok) {
        failed += 1;
        console.log(`  failed     ${label} — ${json.message || res.status}`);
        continue;
      }
      if (json.result.stored) {
        stored += 1;
        console.log(`  cached     ${label}`);
      } else if (json.result.reason === "already held for today") {
        // No model request was spent, so it does not count against the limit.
        asked -= 1;
        held += 1;
        console.log(`  held       ${label}`);
      } else {
        discarded += 1;
        console.log(`  discarded  ${label} — ${json.result.reason}`);
      }
    } catch (error) {
      failed += 1;
      console.log(`  failed     ${label} — ${error.message}`);
    }
  }

  } finally {
    // Revoked even if the loop threw. A forgotten admin session is exactly the
    // kind of thing that sits in a table for a year.
    if (session) {
      await conn
        .query("DELETE FROM admin_sessions WHERE token = ?", [session])
        .catch(() => undefined);
    }
  }

  console.log(
    `\n${asked} requests spent · ${stored} newly cached · ${held} already held · ${discarded} discarded as not cacheable · ${failed} failed`
  );
  if (stored) {
    console.log(
      `Those ${stored} answers cost nothing to serve for the rest of today, however many farmers ask them.`
    );
  }
  if (discarded) {
    console.log(
      "Discarded means the answer reached a grounding tool after all, or came back hedged — held back on purpose rather than cached stale."
    );
  }

  await conn.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
