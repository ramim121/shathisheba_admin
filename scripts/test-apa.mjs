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
//   5. The answer cache's key and its windows. Two farmers asking the same
//      thing must collapse to one key, and a weather answer must not outlive
//      the weather.
//   6. Which failures are worth falling down the model chain for. Treating a
//      daily quota error as transient means retrying the same spent model
//      until the farmer gives up.
//   7. The Bengali calendar, whose month the model hallucinated when the date
//      was absent from the prompt — including the 14 April boundary, which a
//      "last match wins" loop got wrong by a whole year.

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
  estimateAskCost, estimateLiveCost, chargeableSeconds, assertConstrained,
  normaliseQuestion, isCacheable, cacheableForHours, costOf, priceOf, PERSONAL_TOOLS
} = pure;

/** Compile a second dependency-free module the same way. */
async function load(relative) {
  const src = readFileSync(new URL(relative, import.meta.url), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(out, "utf8").toString("base64")}`);
}

const { bengaliDate } = await load("../lib/apa/calendar.ts");

// models.ts imports the database, so only the pure classifier is lifted out of
// it — by source, so that a change to the patterns is still covered here.
const modelsSrc = readFileSync(new URL("../lib/apa/models.ts", import.meta.url), "utf8");
const classifySrc = modelsSrc.slice(
  modelsSrc.indexOf("export function classifyFailure"),
  modelsSrc.indexOf("export async function runWithChain")
);
const thinkingSrc = modelsSrc.slice(
  modelsSrc.indexOf("const NO_THINKING_BUDGET"),
  modelsSrc.indexOf("export function classifyFailure")
);
const thinkingFor = (
  await import(
    `data:text/javascript;base64,${Buffer.from(
      ts.transpileModule(thinkingSrc, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText,
      "utf8"
    ).toString("base64")}`
  )
).thinkingFor;

const classifyFailure = (
  await import(
    `data:text/javascript;base64,${Buffer.from(
      ts.transpileModule(`type FailureKind = string;\n${classifySrc}`, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
      }).outputText,
      "utf8"
    ).toString("base64")}`
  )
).classifyFailure;

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

/* ------------------------------------------------------ 5. the answer cache */

console.log("\nanswer cache");

check("the same question asked differently collapses to one key", () => {
  // The whole saving depends on this: fifty farmers type the same question
  // fifty slightly different ways, and each variant that fails to normalise is
  // a model call that did not need to happen.
  const variants = [
    "ধান কাটার পর কীভাবে শুকাবো?",
    "ধান কাটার পর কীভাবে শুকাবো??",
    "ধান কাটার পর কীভাবে শুকাবো।",
    "  ধান   কাটার পর কীভাবে শুকাবো  ",
    "ধান কাটার পর কীভাবে শুকাবো"
  ];
  const first = normaliseQuestion(variants[0]);
  assert.ok(first.length > 5, "normalising must not empty the question");
  for (const v of variants) {
    assert.equal(normaliseQuestion(v), first, `should normalise the same: ${JSON.stringify(v)}`);
  }
});

check("two different questions do not collapse", () => {
  // The opposite failure, and the dangerous one: over-normalising would serve
  // one farmer's answer to a different question.
  assert.notEqual(
    normaliseQuestion("ধান কাটার পর কীভাবে শুকাবো?"),
    normaliseQuestion("ধান কাটার আগে কীভাবে শুকাবো?")
  );
  assert.notEqual(
    normaliseQuestion("গরুর দাম কত?"),
    normaliseQuestion("ছাগলের দাম কত?")
  );
});

check("an answer that read her own records is never cacheable", () => {
  assert.equal(isCacheable([]), true);
  assert.equal(isCacheable(["get_weather"]), true);
  assert.equal(isCacheable(["get_market_price", "get_weather"]), true);
  for (const personal of ["get_my_listings", "get_my_profile", "get_my_orders", "get_finance_status"]) {
    assert.equal(isCacheable([personal]), false, `${personal} must not be cacheable`);
  }
  // One personal tool among several still poisons the whole answer.
  assert.equal(isCacheable(["get_weather", "get_finance_status"]), false);

  // The list must be exactly the tools that read one farmer's own records. A
  // tool added to tools.ts and forgotten here is an answer about her loan
  // served to a stranger, so the names are asserted rather than counted.
  assert.deepEqual(
    [...PERSONAL_TOOLS].sort(),
    ["get_finance_status", "get_my_listings", "get_my_orders", "get_my_profile"]
  );
});

check("a figure that moves during the day gets a shorter window", () => {
  const day = 6;
  assert.equal(cacheableForHours([], day), day, "general agronomy keeps the full window");
  assert.ok(cacheableForHours(["get_weather"], day) < day, "weather must expire sooner");
  assert.ok(cacheableForHours(["get_market_price"], day) < day, "a price must expire sooner");
  // Never longer than asked for, whatever the tool.
  for (const tools of [[], ["get_weather"], ["get_market_price"]]) {
    assert.ok(cacheableForHours(tools, 2) <= 2, "the configured window is a ceiling");
  }
});

/* -------------------------------------------------- 6. falling down the chain */

console.log("\nmodel fallback");

check("a spent daily quota is not retried", () => {
  // The free tier caps requests per model per day. Retrying a model that has
  // said "PerDay" is guaranteed to fail again, so it has to be classified
  // apart from a rate limit that will clear in twenty seconds.
  for (const message of [
    "429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric GenerateRequestsPerDayPerProjectPerModel",
    "free_tier_requests limit reached",
    "quota_metric: generate_content_free_tier_requests, per_day"
  ]) {
    assert.equal(classifyFailure(new Error(message)), "daily_quota", message.slice(0, 40));
  }
});

check("a per-minute limit is told apart from a per-day one", () => {
  assert.equal(
    classifyFailure(new Error("429 rate limit exceeded, retry in 12.3s (PerMinute)")),
    "minute_quota"
  );
});

check("an overloaded model is worth another model, not another try", () => {
  for (const message of ["503 UNAVAILABLE: model is overloaded", "500 INTERNAL", "fetch failed", "ECONNRESET"]) {
    assert.equal(classifyFailure(new Error(message)), "transient", message);
  }
});

check("a bad request is fatal and stops the chain", () => {
  // Walking the whole chain on a malformed request spends every model's
  // allowance on the same mistake.
  assert.equal(classifyFailure(new Error("400 INVALID_ARGUMENT: bad tool schema")), "fatal");
  assert.equal(classifyFailure(new Error("404 model not found")), "fatal");
});

check("a model that rejects thinkingBudget is not sent it", () => {
  // Measured: gemini-3.5-flash-lite and both Gemma models answer a request
  // carrying thinkingConfig with HTTP 400. A 400 is classified fatal, and
  // fatal stops the chain — so sending this field blindly would turn a
  // recoverable quota error into a dead end on exactly the fallbacks that
  // exist to prevent one.
  for (const model of [
    "gemini-3.5-flash-lite",
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
    "gemini-3.5-transcribe",
    "gemini-2.5-flash-preview-tts",
    "gemini-3.1-flash-tts-preview"
  ]) {
    assert.deepEqual(thinkingFor(model), {}, `${model} must not be sent thinkingConfig`);
  }
  // And it is still sent everywhere it is needed: thinking on a scope-gate
  // call spent the whole output budget and returned MAX_TOKENS with no text,
  // which the parser read as "ambiguous", which allows.
  for (const model of ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-3.6-flash"]) {
    assert.deepEqual(
      thinkingFor(model),
      { thinkingConfig: { thinkingBudget: 0 } },
      `${model} must have thinking switched off`
    );
  }
});

/* ------------------------------------------------------- 7. cached discount */

console.log("\ncost of a cached prefix");

check("cached prompt tokens are billed at a tenth", () => {
  const model = "gemini-2.5-flash";
  const cold = costOf({ model, tokensIn: 10000, tokensOut: 500 });
  const warm = costOf({ model, tokensIn: 10000, tokensOut: 500, cachedTokens: 8000 });
  assert.ok(warm < cold, "a cached prefix must cost less");
  // 8,000 of 10,000 tokens at 10% is a 72% saving on the input half.
  const price = priceOf(model);
  const expected =
    ((2000 + 8000 * 0.1) * price.in) / 1_000_000 + (500 * price.out) / 1_000_000;
  assert.ok(Math.abs(warm - expected) < 1e-9, `${warm} vs ${expected}`);
});

check("more cached tokens than input tokens cannot make a call free", () => {
  // Defensive: the API has reported a cached count above the prompt count.
  const odd = costOf({ model: "gemini-2.5-flash", tokensIn: 100, tokensOut: 100, cachedTokens: 999999 });
  assert.ok(odd >= 0, "cost must never go negative");
});

/* ------------------------------------------------------- 8. Bengali calendar */

console.log("\nBengali calendar");

check("the year turns on 14 April, not 13 or 15", () => {
  // The model hallucinated আষাঢ় in আশ্বিন when no date was in the prompt, so
  // the date is now built here — and the boundary got it wrong by a year when
  // it was a "last match wins" loop over month starts.
  assert.equal(bengaliDate(new Date("2026-04-14T06:00:00+06:00")).month, "বৈশাখ");
  assert.equal(bengaliDate(new Date("2026-04-13T06:00:00+06:00")).month, "চৈত্র");
  assert.equal(bengaliDate(new Date("2026-04-15T06:00:00+06:00")).month, "বৈশাখ");
});

check("every month is named and carries a season note", () => {
  const seen = new Set();
  for (let day = 0; day < 365; day += 1) {
    const at = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000);
    const out = bengaliDate(at);
    assert.ok(out.month, `no month for ${at.toISOString().slice(0, 10)}`);
    assert.ok(out.bengali, `no Bengali date for ${at.toISOString().slice(0, 10)}`);
    assert.ok(out.seasonNote, `no season note for ${out.month}`);
    seen.add(out.month);
  }
  assert.equal(seen.size, 12, `expected 12 months across a year, saw ${seen.size}`);
});

console.log(
  process.exitCode
    ? "\nthere are failures above.\n"
    : `\nall ${passed} checks passed.\n`
);
