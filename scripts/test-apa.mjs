// Checks for the parts of Shathi Apa that can be wrong silently.
//
//   node scripts/test-apa.mjs
//
// There is no test runner in this project, so this is plain Node with
// assertions — it needs nothing installed and nothing running. It covers four
// things, each of which has already been wrong once or would be expensive to
// discover in production:
//
//   1. The scope shortcut. `includes()` on Bangla matched "ধান" inside
//      "প্রধানমন্ত্রী", so a question about the prime minister skipped the scope
//      gate entirely as a question about rice.
//   2. The WAV header. Off by one field and the phone plays silence.
//   3. The live token's restrictions. The SRS calls an unconstrained token a
//      release blocker; this fails the run if the assertion can be bypassed.
//   4. The money and minute arithmetic, including the three independent bounds
//      on a duration the phone reports about itself.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// The module under test is TypeScript with no imports of its own, so it is
// compiled here rather than through the Next build — which keeps this script
// runnable on its own, which is the whole point of it.
const ts = require("typescript");
const source = readFileSync(new URL("../lib/apa/pure.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const pure = await import(`data:text/javascript;base64,${Buffer.from(js, "utf8").toString("base64")}`);

const {
  looksAgricultural, pcm16ToWav, speakable, audioSeconds, sampleRateFrom,
  estimateAskCost, estimateLiveCost, chargeableSeconds, assertConstrained
} = pure;

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}\n       ${error.message}`);
    process.exitCode = 1;
  }
}

/* ------------------------------------------------------------------ 1. scope */

console.log("\nscope shortcut");

check("a farming question skips the classifier", () => {
  for (const q of [
    "আজ কি বৃষ্টি হবে? ধান কাটবো নাকি দুই দিন পরে?",
    "গরুর দাম কত?",
    "ধানের রোগ হয়েছে",
    "ফসলগুলো শুকিয়ে যাচ্ছে",
    "আমার খামারে সমস্যা",
    "cattle price today",
    "my cow is sick"
  ]) {
    assert.equal(looksAgricultural(q), true, `should shortcut: ${q}`);
  }
});

check("a Bangla compound that merely contains a keyword does not", () => {
  // প্রধানমন্ত্রী contains ধান; ধানমন্ডি is a Dhaka neighbourhood. Both reached
  // the assistant as agriculture questions before the tokeniser was fixed.
  for (const q of [
    "বাংলাদেশের প্রধানমন্ত্রী কে?",
    "ধানমন্ডিতে কীভাবে যাবো?",
    "আজকের ক্রিকেট খেলার স্কোর কত?",
    "আমার ছেলের জ্বর হয়েছে",
    "who is the president"
  ]) {
    assert.equal(looksAgricultural(q), false, `should NOT shortcut: ${q}`);
  }
});

check("an attached Bangla suffix still matches its stem", () => {
  for (const q of ["গরুর", "ধানের", "ফসলগুলো", "খামারে", "মাছটি", "বীজও"]) {
    assert.equal(looksAgricultural(q), true, `suffix form should match: ${q}`);
  }
});

/* ------------------------------------------------------------------ 2. audio */

console.log("\naudio");

check("the WAV header describes the samples that follow it", () => {
  const pcm = Buffer.alloc(960, 7);
  const wav = pcm16ToWav(pcm, 24000);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length, "RIFF size");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.subarray(12, 16).toString("ascii"), "fmt ");
  assert.equal(wav.readUInt32LE(16), 16, "fmt chunk size");
  assert.equal(wav.readUInt16LE(20), 1, "format must be PCM");
  assert.equal(wav.readUInt16LE(22), 1, "channels");
  assert.equal(wav.readUInt32LE(24), 24000, "sample rate");
  assert.equal(wav.readUInt32LE(28), 24000 * 2, "byte rate");
  assert.equal(wav.readUInt16LE(32), 2, "block align");
  assert.equal(wav.readUInt16LE(34), 16, "bits per sample");
  assert.equal(wav.subarray(36, 40).toString("ascii"), "data");
  assert.equal(wav.readUInt32LE(40), pcm.length, "data size");
  assert.deepEqual(wav.subarray(44), pcm, "samples must be untouched");
});

check("the sample rate is read out of the mime type", () => {
  assert.equal(sampleRateFrom("audio/l16; rate=24000"), 24000);
  assert.equal(sampleRateFrom("audio/l16; rate=16000"), 16000);
  assert.equal(sampleRateFrom("audio/wav"), 24000, "falls back rather than returning NaN");
  assert.equal(sampleRateFrom(undefined), 24000);
});

check("markdown is stripped to what a voice would say", () => {
  const spoken = speakable("## আজকের পরামর্শ\n\n- **ধান** কাটুন\n- সার দিন\n\nবিস্তারিত [এখানে](https://x.test)");
  assert.ok(!/[*#[\]()]/.test(spoken), `markup survived: ${spoken}`);
  assert.ok(spoken.includes("ধান কাটুন"), spoken);
  assert.ok(spoken.includes("এখানে"), "link text must be kept");
  assert.ok(!spoken.includes("https"), "the url must not be read aloud");
});

check("a clip's duration is estimated per container", () => {
  // Exact for raw PCM16: two bytes a sample.
  assert.equal(audioSeconds(16000 * 2, "audio/l16; rate=16000"), 1);
  // A WAV of the same audio carries 44 bytes of header that are not samples.
  assert.ok(Math.abs(audioSeconds(16000 * 2 + 44, "audio/wav; rate=16000") - 1) < 0.01);
  assert.ok(audioSeconds(160000, "audio/m4a") > 0, "a compressed clip still gets a figure");
});

/* --------------------------------------------------- 3. the release blocker */

console.log("\nlive token restrictions (AC-APA-11)");

const validSetup = () => ({
  model: "models/gemini-3.8-live",
  systemInstruction: { parts: [{ text: "x".repeat(400) }] },
  tools: [{ functionDeclarations: [{ name: "get_weather" }] }]
});

check("a properly constrained token is accepted", () => {
  assertConstrained({ bidiGenerateContentSetup: validSetup() });
  assertConstrained({ bidi_generate_content_setup: validSetup() }, "snake_case is accepted too");
});

check("a token with no setup is refused", () => {
  assert.throws(() => assertConstrained({ uses: 1 }), /unrestricted key/);
});

check("a token with no system instruction is refused", () => {
  const setup = validSetup();
  delete setup.systemInstruction;
  assert.throws(() => assertConstrained({ bidiGenerateContentSetup: setup }), /system instruction/);
});

check("a token whose instruction has been emptied out is refused", () => {
  const setup = { ...validSetup(), systemInstruction: { parts: [{ text: "be nice" }] } };
  assert.throws(() => assertConstrained({ bidiGenerateContentSetup: setup }), /too short/);
});

check("a token with no model pinned is refused", () => {
  const setup = validSetup();
  delete setup.model;
  assert.throws(() => assertConstrained({ bidiGenerateContentSetup: setup }), /no model pinned/);
});

check("code execution can never reach a tool list", () => {
  for (const tool of [
    { codeExecution: {} },
    { code_execution: {} },
    { googleSearch: {} },
    { urlContext: {} }
  ]) {
    const setup = { ...validSetup(), tools: [tool] };
    assert.throws(
      () => assertConstrained({ bidiGenerateContentSetup: setup }),
      /unrestricted capability/,
      `${JSON.stringify(tool)} must be refused`
    );
  }
});

/* ------------------------------------------------- 4. money and minutes */

console.log("\nquota arithmetic");

check("a duration the phone reports is bounded three ways", () => {
  // What it claims.
  assert.equal(chargeableSeconds({ claimed: 120, wallSeconds: 600, capSeconds: 900, connected: true }), 120);
  // The wall clock, when it claims more than could have elapsed.
  assert.equal(chargeableSeconds({ claimed: 9999, wallSeconds: 100, capSeconds: 900, connected: true }), 105);
  // The session cap, when both are larger.
  assert.equal(chargeableSeconds({ claimed: 9999, wallSeconds: 9999, capSeconds: 900, connected: true }), 900);
  // A call that never connected is free, whatever it claims.
  assert.equal(chargeableSeconds({ claimed: 500, wallSeconds: 500, capSeconds: 900, connected: false }), 0);
  // Nonsense cannot produce a negative charge or a NaN.
  assert.equal(chargeableSeconds({ claimed: -50, wallSeconds: 10, capSeconds: 900, connected: true }), 0);
  assert.equal(chargeableSeconds({ claimed: NaN, wallSeconds: 10, capSeconds: 900, connected: true }), 0);
});

check("cost rises with every input and is never negative", () => {
  const base = estimateAskCost({ promptChars: 0, answerChars: 0 });
  assert.equal(base, 0);
  const text = estimateAskCost({ promptChars: 1000, answerChars: 1000 });
  assert.ok(text > 0);
  assert.ok(estimateAskCost({ promptChars: 1000, answerChars: 1000, ttsChars: 1000 }) > text);
  assert.ok(estimateAskCost({ promptChars: 1000, answerChars: 1000, transcribeSeconds: 30 }) > text);
  assert.ok(estimateLiveCost(60) > estimateLiveCost(30));
  assert.equal(estimateLiveCost(0), 0);
});

check("a live minute costs more than a typed question", () => {
  // If this ever inverts, the quota is being spent on the wrong thing.
  const typed = estimateAskCost({ promptChars: 200, answerChars: 800, ttsChars: 800 });
  assert.ok(estimateLiveCost(60) > typed, `live ${estimateLiveCost(60)} vs typed ${typed}`);
});

console.log(
  process.exitCode
    ? "\nthere are failures above.\n"
    : `\nall ${passed} checks passed.\n`
);
