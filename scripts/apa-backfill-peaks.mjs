// Fill in the waveform envelope for speech clips cached before it existed.
//
//   node scripts/apa-backfill-peaks.mjs --dry-run    # measure, write nothing
//   node scripts/apa-backfill-peaks.mjs              # measure and store
//
// Migration 053 added `apa_speech_cache.peaks_json`. New clips are measured at
// synthesis; this does the same for the ones already cached, so an answer
// synthesised last week draws its real shape rather than the fallback.
//
// It uses the shipping `waveformPeaks` from lib/apa/pure.ts — compiled here the
// same way scripts/test-apa.mjs does — rather than a copy, so a backfilled clip
// gets exactly the envelope a fresh one would. Idempotent: rows that already
// have an envelope are skipped.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const mysql = require("mysql2/promise");
const cfg = require("./_dbconfig.cjs");

const DRY = process.argv.includes("--dry-run");

const source = readFileSync(new URL("../lib/apa/pure.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { waveformPeaks, parsePeaks } = await import(
  `data:text/javascript;base64,${Buffer.from(js, "utf8").toString("base64")}`
);

/**
 * The PCM inside a WAV file.
 *
 * Found by walking the chunks for "data" rather than assuming a 44-byte header:
 * every clip this system wrote has one, but a file that arrived any other way
 * might carry a LIST chunk first, and reading its metadata as audio would
 * draw a waveform of text.
 */
function pcmOf(wav) {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let at = 12;
  while (at + 8 <= wav.length) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === "data") return wav.subarray(at + 8, Math.min(wav.length, at + 8 + size));
    at += 8 + size + (size % 2);
  }
  return null;
}

const db = await mysql.createConnection(cfg);
try {
  const [rows] = await db.query(
    "SELECT id, audio_url, peaks_json FROM apa_speech_cache ORDER BY id"
  );
  let done = 0;
  let skipped = 0;
  const failed = [];

  for (const row of rows) {
    if (parsePeaks(row.peaks_json)) {
      skipped += 1;
      continue;
    }
    try {
      const res = await fetch(row.audio_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pcm = pcmOf(Buffer.from(await res.arrayBuffer()));
      if (!pcm || pcm.length < 2) throw new Error("not a PCM WAV");
      const peaks = waveformPeaks(pcm);
      if (!DRY) {
        await db.query("UPDATE apa_speech_cache SET peaks_json = ? WHERE id = ?", [
          JSON.stringify(peaks),
          row.id
        ]);
      }
      done += 1;
      if (done <= 2) {
        // Two samples, so a run shows what it is storing rather than a count.
        const bars = peaks.map((v) => " ▁▂▃▄▅▆▇█"[Math.round(v * 8)]).join("");
        console.log(`  #${row.id}  ${bars}`);
      }
    } catch (error) {
      failed.push(`#${row.id} ${error.message}`);
    }
  }

  console.log("");
  console.log(`${DRY ? "would store" : "stored"}: ${done}   already had one: ${skipped}   failed: ${failed.length}`);
  for (const f of failed.slice(0, 10)) console.log("  " + f);
  if (failed.length) process.exitCode = 1;
} finally {
  await db.end();
}
