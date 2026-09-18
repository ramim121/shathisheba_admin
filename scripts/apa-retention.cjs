// Prunes what Shathi Apa no longer needs, and keeps what is worth keeping.
//
//   node scripts/apa-retention.cjs            # apply
//   node scripts/apa-retention.cjs --dry-run  # count only
//
// Run it nightly from cron:
//   15 2 * * *  cd /var/www/html/shathisheba-admin && node scripts/apa-retention.cjs >> /var/log/apa-retention.log 2>&1
//
// At 18,000 questions a month this table grows by ~36,000 message rows and
// 18,000 scope-log rows a month, each with a VARCHAR(1000). That is fine this
// year and unpleasant in three.
//
// What goes and what stays is a deliberate split:
//
//   * **Message bodies and transcripts** are pruned. They are the largest
//     thing here and the least reusable — a farmer's question from eight months
//     ago tells you nothing you have not already learned from it.
//   * **Scope verdicts stay.** They are the training-data asset: a labelled
//     corpus of real Bangla farm questions with a verdict and, where a staff
//     member looked, a correction. Nobody else has that.
//   * **Feedback stays**, for the same reason, and the answer it referred to is
//     snapshotted onto the feedback row before the message body goes, so a
//     thumbs-down remains readable after the pruning.
//   * **Yesterday's answer cache goes** entirely: the cache key contains the
//     day, so an old row can never be hit again.
const mysql = require("mysql2/promise");
const cfg = require("./_dbconfig.cjs");

(async () => {
  const dryRun = process.argv.includes("--dry-run");
  const conn = await mysql.createConnection({ ...cfg, charset: "utf8mb4" });

  const [[setting]] = await conn.query(
    "SELECT value_text FROM app_settings WHERE setting_key = 'apa_retention_days' LIMIT 1"
  );
  const days = Math.max(30, Number(setting?.value_text ?? 180) || 180);
  console.log(`retention: ${days} days${dryRun ? " (dry run)" : ""}`);

  const steps = [
    {
      what: "feedback answer snapshots (taken before the body is pruned)",
      count: `SELECT COUNT(*) AS n FROM apa_feedback f
                JOIN apa_messages m ON m.id = f.message_id
               WHERE f.answer_snapshot IS NULL AND m.body IS NOT NULL`,
      run: `UPDATE apa_feedback f
              JOIN apa_messages m ON m.id = f.message_id
               SET f.answer_snapshot = LEFT(m.body, 4000)
             WHERE f.answer_snapshot IS NULL AND m.body IS NOT NULL`,
    },
    {
      what: `message bodies older than ${days} days`,
      count: `SELECT COUNT(*) AS n FROM apa_messages
               WHERE created_at < NOW() - INTERVAL ${days} DAY
                 AND (body IS NOT NULL OR transcript IS NOT NULL)`,
      // The row survives so the conversation still has its shape and its
      // counts; only the text and the image reference go.
      run: `UPDATE apa_messages
               SET body = NULL, transcript = NULL, advice = NULL, image_url = NULL
             WHERE created_at < NOW() - INTERVAL ${days} DAY
               AND (body IS NOT NULL OR transcript IS NOT NULL)`,
    },
    {
      what: "answer cache rows from an earlier day",
      count: "SELECT COUNT(*) AS n FROM apa_answer_cache WHERE for_day < CURDATE()",
      run: "DELETE FROM apa_answer_cache WHERE for_day < CURDATE()",
    },
    {
      what: "speech cache rows never hit in 60 days",
      count: `SELECT COUNT(*) AS n FROM apa_speech_cache
               WHERE created_at < NOW() - INTERVAL 60 DAY AND hits = 0`,
      run: `DELETE FROM apa_speech_cache
             WHERE created_at < NOW() - INTERVAL 60 DAY AND hits = 0`,
    },
    {
      what: `tool call rows older than ${days} days`,
      count: `SELECT COUNT(*) AS n FROM apa_tool_calls WHERE created_at < NOW() - INTERVAL ${days} DAY`,
      run: `DELETE FROM apa_tool_calls WHERE created_at < NOW() - INTERVAL ${days} DAY`,
    },
    {
      what: `app-side AI call rows older than ${days} days`,
      count: `SELECT COUNT(*) AS n FROM apa_app_ai_calls WHERE created_at < NOW() - INTERVAL ${days} DAY`,
      run: `DELETE FROM apa_app_ai_calls WHERE created_at < NOW() - INTERVAL ${days} DAY`,
    },
    {
      what: "per-model call counters older than a year",
      count: "SELECT COUNT(*) AS n FROM apa_model_calls WHERE for_day < CURDATE() - INTERVAL 365 DAY",
      run: "DELETE FROM apa_model_calls WHERE for_day < CURDATE() - INTERVAL 365 DAY",
    },
    {
      what: "live sessions left open by a killed app, older than a day",
      count: `SELECT COUNT(*) AS n FROM apa_live_sessions
               WHERE closed_at IS NULL AND minted_at < NOW() - INTERVAL 1 DAY`,
      run: `UPDATE apa_live_sessions
               SET closed_at = NOW(), end_reason = COALESCE(end_reason, 'reaped')
             WHERE closed_at IS NULL AND minted_at < NOW() - INTERVAL 1 DAY`,
    },
    {
      what: "empty conversations with nothing in them",
      count: `SELECT COUNT(*) AS n FROM apa_conversations c
               WHERE c.turn_count = 0 AND c.started_at < NOW() - INTERVAL 2 DAY
                 AND NOT EXISTS (SELECT 1 FROM apa_messages m WHERE m.conversation_id = c.id)`,
      run: `DELETE c FROM apa_conversations c
             WHERE c.turn_count = 0 AND c.started_at < NOW() - INTERVAL 2 DAY
               AND NOT EXISTS (SELECT 1 FROM apa_messages m WHERE m.conversation_id = c.id)`,
    },
  ];

  for (const step of steps) {
    const [[{ n }]] = await conn.query(step.count);
    if (!Number(n)) {
      console.log(`  nothing  ${step.what}`);
      continue;
    }
    if (dryRun) {
      console.log(`  would    ${n} — ${step.what}`);
      continue;
    }
    const [res] = await conn.query(step.run);
    console.log(`  done     ${res.affectedRows ?? n} — ${step.what}`);
  }

  // What is deliberately untouched, said out loud so nobody adds it later by
  // mistake.
  const [[kept]] = await conn.query(
    `SELECT (SELECT COUNT(*) FROM apa_scope_log) AS scope_verdicts,
            (SELECT COUNT(*) FROM apa_feedback) AS feedback,
            (SELECT COUNT(*) FROM apa_vocabulary) AS vocabulary,
            (SELECT COUNT(*) FROM apa_prompt_versions) AS prompt_versions`
  );
  console.log(
    `\nkept on purpose: ${kept.scope_verdicts} scope verdicts, ${kept.feedback} feedback rows, ` +
      `${kept.vocabulary} vocabulary terms, ${kept.prompt_versions} prompt versions.`
  );
  console.log("Those four are the training corpus and the audit trail. They are not pruned.");

  await conn.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
