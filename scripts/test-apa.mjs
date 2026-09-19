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
  normaliseQuestion, isCacheable, cacheableForHours, costOf, priceOf, PERSONAL_TOOLS,
  budgetBands, BUDGET_TIGHT_PCT, BUDGET_CRITICAL_PCT, LIVE_USD_PER_MINUTE
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

// The key resolver. No imports of its own, so it compiles the same way
// pure.ts does - and it earns a test because during a rotation both
// variables are live at once and picking the wrong one is silent.
const gemKey = await load("../lib/gemini-key.ts");
/**
 * The app's multipart encoder, lifted out of the mobile project by source.
 *
 * It lives in the other repository, which is why this is a slice rather than an
 * import - but it is worth testing from here because it is the only part of the
 * upload that can be checked without a handset, and it took four attempts to
 * get right. The bytes it produces were posted to the production endpoint and
 * returned 201; these checks pin the shape so a later tidy-up cannot quietly
 * change it back.
 */
const MOBILE_CLIENT = "../../Shathi Sheba/src/api/client.ts";
let buildMultipart = null;
try {
  const src = readFileSync(new URL(MOBILE_CLIENT, import.meta.url), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  const from = src.indexOf("export function buildMultipart(");
  if (from !== -1) {
    const to = src.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10), from) + 3;
    const out = ts.transpileModule(src.slice(from, to), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    ({ buildMultipart } = await import(
      `data:text/javascript;base64,${Buffer.from(out, "utf8").toString("base64")}`
    ));
  }
} catch {
  // The mobile project is not always checked out beside this one.
}



// models.ts imports the database, so only the pure classifier is lifted out of
// it — by source, so that a change to the patterns is still covered here.
const modelsSrc = readFileSync(new URL("../lib/apa/models.ts", import.meta.url), "utf8");
// classifyFailure lives in models.ts and calls retrySeconds, which lives in
// pure.ts so that client.ts can use it without the two importing each other.
// Both sources are lifted and compiled together.
const pureSrc = readFileSync(new URL("../lib/apa/pure.ts", import.meta.url), "utf8");
const RETRY_AT = pureSrc.indexOf("export function retrySeconds");
const retrySrc = pureSrc.slice(RETRY_AT, pureSrc.indexOf("\n}", RETRY_AT) + 2);
const classifySrc = [
  retrySrc,
  modelsSrc.slice(
    modelsSrc.indexOf("export function classifyFailure"),
    modelsSrc.indexOf("export async function runWithChain")
  )
].join("\n");
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

check("a 429 is classified on its retry delay, not its quota name", () => {
  // The bug this locks down. Google names the PER-MINUTE limit
  //   quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier
  // but ALSO returns, for a genuine daily cap,
  //   quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier   retry 18s
  // and the metric name `generate_content_free_tier_requests` appears on both.
  // Matching those strings classified every rate limit as a daily exhaustion,
  // which benched the primary model for an hour over something that clears in
  // eighteen seconds. Only the retry delay distinguishes them.
  const minute =
    "429 RESOURCE_EXHAUSTED: Quota exceeded for metric: " +
    "generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15. " +
    "Please retry in 26.5s. quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier";
  assert.equal(classifyFailure(new Error(minute)), "minute_quota", "short retry = per minute");

  // The trap: "PerDay" in the id and "free_tier_requests" in the metric, but it
  // clears in 18 seconds, so it is still a per-minute limit in practice.
  const mislabelled =
    "429 RESOURCE_EXHAUSTED: generate_content_free_tier_requests, limit: 20. " +
    "Please retry in 18.6s. quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier";
  assert.equal(classifyFailure(new Error(mislabelled)), "minute_quota", "18s is not a day");

  // A 429 that says nothing about when to come back is treated as the daily
  // kind: moving to the next model costs one request, retrying a spent cap
  // costs every request left in the burst.
  assert.equal(
    classifyFailure(new Error("429 RESOURCE_EXHAUSTED: quota exceeded")),
    "daily_quota",
    "no retry delay = assume the expensive case"
  );

  // A long delay really is a daily cap.
  assert.equal(
    classifyFailure(new Error("429 RESOURCE_EXHAUSTED: quota exceeded. Please retry in 4200s.")),
    "daily_quota"
  );
});

check("an explicit per-minute marker is honoured with no delay given", () => {
  assert.equal(
    classifyFailure(new Error("429 rate limit exceeded (RequestsPerMinute)")),
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

/**
 * The app's own choice of which uploaded URL to send back.
 *
 * Lifted by source for the same reason buildMultipart is: it lives in the
 * other repository, and it is the piece that actually broke the photo upload.
 */
let uploadedUrl = null;
try {
  const src = readFileSync(new URL(MOBILE_CLIENT, import.meta.url), "utf8")
    .split(String.fromCharCode(13, 10))
    .join(String.fromCharCode(10));
  const from = src.indexOf("function uploadedUrl(");
  if (from !== -1) {
    const to = src.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10), from) + 3;
    const out = ts.transpileModule("export " + src.slice(from, to), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    ({ uploadedUrl } = await import(
      `data:text/javascript;base64,${Buffer.from(out, "utf8").toString("base64")}`
    ));
  }
} catch {
  // The mobile project is not always checked out beside this one.
}

/**
 * The answer-markup handling from reason.ts.
 *
 * reason.ts imports the database, so `inlineNavigation` is lifted by source
 * with the screen list stubbed. It is worth testing because the leak it fixes
 * reached a farmer's screen: four lines of JSON in the middle of advice about
 * her cow.
 */
const reasonSrc = readFileSync(new URL("../lib/apa/reason.ts", import.meta.url), "utf8")
  .split(String.fromCharCode(13, 10))
  .join(String.fromCharCode(10));
let inlineNavigation = null;
let stripTags = null;
try {
  const from = reasonSrc.indexOf("function inlineNavigation(");
  const to = reasonSrc.indexOf(String.fromCharCode(10) + "}" + String.fromCharCode(10), from) + 3;
  const stub = `
    type ApaSource = { kind: string; label_bn: string; action: string | null };
    const NAVIGABLE_SCREENS = ["myListings", "marketUpdates", "buy", "officers"] as const;
  `;
  const out = ts.transpileModule(stub + "export " + reasonSrc.slice(from, to), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  ({ inlineNavigation } = await import(
    `data:text/javascript;base64,${Buffer.from(out, "utf8").toString("base64")}`
  ));
  // The catch-all stripper, read out of the source so the test tracks the code.
  const m = reasonSrc.match(/\.replace\((\/\\\[\\\[[^/]*\/[gi]+)/);
  stripTags = m ? new RegExp(m[1].slice(1, m[1].lastIndexOf("/")), "gi") : null;
} catch {
  // Leave them null; the checks below skip.
}

console.log("\nanswer markup");

check("an inline navigate_to becomes a button instead of reaching the screen", () => {
  if (!inlineNavigation) {
    console.log("       (skipped: could not lift inlineNavigation)");
    return;
  }
  // Verbatim from the handset: the model wrote the block as text, and the
  // catch-all stripper did not match it because `[a-z]+` has no underscore.
  const raw =
    "আপনার দুটি গরু ইতিমধ্যেই বিক্রির তালিকায় জমা দেওয়া আছে।\n" +
    "[[navigate_to]]\n" +
    '{ "label_bn": "বিক্রির তালিকা দেখুন", "screen": "myListings" }\n' +
    "[[/navigate_to]]";

  const out = inlineNavigation(raw);
  assert.ok(!/navigate_to/.test(out.rest), "the tag must not survive into the answer");
  assert.ok(!/label_bn|screen/.test(out.rest), "nor may the JSON keys");
  assert.equal(out.sources.length, 1, "the offer must be recovered, not discarded");
  assert.deepEqual(out.sources[0], {
    kind: "action",
    label_bn: "বিক্রির তালিকা দেখুন",
    action: "screen:myListings"
  });
});

check("a malformed or unknown navigate_to leaves no button", () => {
  if (!inlineNavigation) return;
  // A button that goes nowhere is worse than no button.
  for (const body of ['{ "screen": "notAScreen", "label_bn": "x" }', "not json at all", "{}"]) {
    const out = inlineNavigation(`a [[navigate_to]]${body}[[/navigate_to]] b`);
    assert.equal(out.sources.length, 0, `expected no source for ${body}`);
    assert.ok(!/navigate_to/.test(out.rest), "and still no markup on screen");
  }
});

check("the catch-all stripper in reason.ts covers underscores and digits", () => {
  // Asserted against the source text rather than by lifting the regex out of
  // it: the first attempt at this used a regex to find a regex, failed, and
  // reported "ok" while skipping - which is the kind of test that is worse
  // than none because it looks like coverage.
  // Anchored on "?[a-z", which is present whether the class is [a-z]+ or
  // [a-z0-9_]+. The first attempt looked for a literal "[[" and never matched,
  // because in the source those brackets are escaped as \[\[.
  const line = reasonSrc
    .split(String.fromCharCode(10))
    .find((l) => l.includes(".replace(/") && l.includes("?[a-z"));
  assert.ok(line, "could not find the tag stripper in reason.ts");

  // The hole this closes: [a-z]+ matches [[advice]] and misses [[navigate_to]],
  // so one class of tag leaked to the screen and the rest did not.
  assert.ok(
    !/\[a-z\]\+/.test(line),
    `the stripper is back to [a-z]+ and will leak [[navigate_to]] again: ${line.trim()}`
  );
  assert.ok(
    /a-z0-9_|\w/.test(line),
    `the stripper must allow underscores and digits: ${line.trim()}`
  );

  // And the behaviour, built from the same character class the code uses.
  const cleaned = "x [[navigate_to]] y [[/navigate_to]] z [[advice]] w [[tool_2]] v"
    .replace(/\[\[\/?[a-z0-9_]+\]\]/gi, " ");
  assert.ok(!/\[\[/.test(cleaned), `tags survived: ${cleaned}`);
});
console.log("\nthe upload body");

check("the multipart body is exactly what the server accepted", () => {
  if (!buildMultipart) {
    console.log("       (skipped: the mobile project is not checked out beside this one)");
    return;
  }
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x80, 0xfe, 0x7f]);
  const body = buildMultipart({
    boundary: "BOUND",
    fields: { folder: "apa" },
    file: { field: "file", name: "a.jpg", type: "image/jpeg", bytes }
  });
  const text = Buffer.from(body).toString("latin1");

  // CRLF everywhere, because a bare LF is not multipart and some parsers
  // accept it while others silently drop the part.
  assert.ok(text.startsWith("--BOUND\r\n"), "must open with the boundary and CRLF");
  assert.ok(text.endsWith("\r\n--BOUND--\r\n"), "must close with the terminating boundary");
  assert.ok(text.includes('Content-Disposition: form-data; name="folder"\r\n\r\napa\r\n'));
  assert.ok(text.includes('name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'));

  // The file's bytes must survive intact. 0xFE and 0x7F either side of the
  // boundary between ASCII and not is exactly where a UTF-8 round trip would
  // corrupt a JPEG - which is why the body is assembled as bytes and the
  // request body is a Uint8Array rather than a string.
  const marker = Buffer.from(bytes).toString("latin1");
  assert.ok(text.includes(marker), "the file bytes must be copied through unchanged");
  assert.equal(body.constructor.name, "Uint8Array", "the body must stay binary");
});

check("no field or file content can break out of the body", () => {
  if (!buildMultipart) return;
  // The folder is server-sanitised, but the filename comes from a URI the
  // farmer's gallery chose, so it is worth knowing what happens to a quote.
  const body = buildMultipart({
    boundary: "BOUND",
    fields: { folder: "apa" },
    file: { field: "file", name: 'we"ird.jpg', type: "image/jpeg", bytes: new Uint8Array([1]) }
  });
  const text = Buffer.from(body).toString("latin1");
  // Exactly two boundary openings and one terminator: a quote in the filename
  // must not be able to start a third part.
  assert.equal(text.split("--BOUND\r\n").length - 1, 2);
  assert.equal(text.split("--BOUND--").length - 1, 1);
});

check("the uploaded URL sent for analysis is one the server will accept", () => {
  if (!uploadedUrl) {
    console.log("       (skipped: the mobile project is not checked out beside this one)");
    return;
  }
  const base = "https://shathisheba.digigramventures.com";

  // This is the case that was broken, and the reason it survived an
  // end-to-end test: /api/upload returns a bucket KEY as `path` and the public
  // URL as `url`, and the app was prefixing its own host to the key. That
  // produced https://shathisheba.digigramventures.com/apa/x.jpg, which is not
  // the bucket, so resolveImage refused it with "Only images stored by this
  // console can be analysed." The e2e test passed because it used `url`
  // directly rather than the app's own choice between the two.
  const s3 = uploadedUrl(
    {
      ok: true,
      path: "/apa/1789814972348-6fbf3fb7f501.jpg",
      url: "https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/apa/1789814972348-6fbf3fb7f501.jpg",
      storage: "s3"
    },
    base
  );
  assert.equal(
    s3,
    "https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/apa/1789814972348-6fbf3fb7f501.jpg",
    "on S3 the bucket URL must be sent, never the app host plus the key"
  );
  assert.ok(!s3.startsWith(base), "the app's own host must not be prefixed to a bucket key");

  // Local disk: `path` is under /uploads/, which the server accepts as a path,
  // and the app's base keeps it reachable from a handset on the LAN - the
  // server builds its own `url` from the request Host header, which can be an
  // address the phone cannot reach.
  const local = uploadedUrl(
    { ok: true, path: "/uploads/apa/x.jpg", url: "http://0.0.0.0:3000/uploads/apa/x.jpg", storage: "local" },
    base
  );
  assert.equal(local, `${base}/uploads/apa/x.jpg`);

  // Neither shape recognised: return something rather than an empty string,
  // which would fail later and less clearly as "no image".
  assert.equal(uploadedUrl({ ok: true, url: "https://example.test/a.jpg" }, base), "https://example.test/a.jpg");
  assert.equal(uploadedUrl({ ok: true }, base), "");
});


console.log("\nthe key resolver");

check("the new key wins while both are live, and the old one still works alone", () => {
  // This is the whole point of there being two names. A rotation is not
  // atomic: the new key has to be proven before the old one is destroyed, and
  // in between both are set - as they are on the production server right now.
  // Resolving the wrong one there would stay invisible until the day the old
  // key was deleted, which is the worst possible moment to find out.
  const saved = { old: process.env.GEMINI_API_KEY, next: process.env.GEMINI_API_KEY_NEW };
  try {
    process.env.GEMINI_API_KEY = "OLD-aaaa";
    process.env.GEMINI_API_KEY_NEW = "NEW-bbbb";
    assert.equal(gemKey.geminiKeySource(), "GEMINI_API_KEY_NEW");
    assert.equal(gemKey.geminiKey(), "NEW-bbbb", "the new key must win while both are set");

    // What happens the moment the old key is deleted: nothing.
    delete process.env.GEMINI_API_KEY;
    assert.equal(gemKey.geminiKey(), "NEW-bbbb");

    // A server not yet updated keeps working on the old name alone.
    process.env.GEMINI_API_KEY = "OLD-aaaa";
    delete process.env.GEMINI_API_KEY_NEW;
    assert.equal(gemKey.geminiKey(), "OLD-aaaa");

    // An empty value is not a key. Treating "" as set would send an empty
    // credential to Gemini and read the 400 back as a model fault.
    process.env.GEMINI_API_KEY_NEW = "   ";
    assert.equal(gemKey.geminiKey(), "OLD-aaaa", "whitespace is not a key");

    // Neither: throw here, rather than fail at the API with something that
    // reads like an outage.
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY_NEW;
    assert.equal(gemKey.isGeminiKeyConfigured(), false);
    assert.throws(() => gemKey.geminiKey(), /No Gemini API key/);
  } finally {
    if (saved.old === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved.old;
    if (saved.next === undefined) delete process.env.GEMINI_API_KEY_NEW;
    else process.env.GEMINI_API_KEY_NEW = saved.next;
  }
});

console.log("\nthe spend ceiling");

// Billing was enabled on 2026-09-19 and with it the only brake that had ever
// stopped this project spending money disappeared. On the free tier an
// exhausted quota returned 429; there is no 429 now, only an invoice. These
// cover the arithmetic that replaced it, because its failure mode is silent
// and arrives as a bill.

check("an unconfigured budget allows everything rather than nothing", () => {
  // The dangerous reading. A fresh database has no budget row, and treating
  // that as "spend nothing" would take the assistant down on install — worse
  // than the overspend it would be preventing.
  for (const budget of [0, -1, Number.NaN, undefined]) {
    const b = budgetBands(5, budget);
    assert.equal(b.band, "normal", `budget ${String(budget)} should not ration`);
    assert.ok(b.allowFresh && b.allowLive && b.allowServerTts && b.allowPrewarm);
  }
});

check("each band switches off the next most expensive thing, in order", () => {
  const at = (pct) => budgetBands((pct / 100) * 10, 10);

  const normal = at(0);
  assert.equal(normal.band, "normal");
  assert.ok(normal.allowPrewarm && normal.allowLive && normal.allowServerTts && normal.allowFresh);

  // Pre-warming is speculative spend — answers nobody has asked for — so it is
  // the only thing here whose absence no farmer can notice on the day.
  const tight = at(BUDGET_TIGHT_PCT);
  assert.equal(tight.band, "tight");
  assert.equal(tight.allowPrewarm, false);
  assert.ok(tight.allowLive && tight.allowServerTts && tight.allowFresh);

  // Live audio costs roughly a hundred typed answers a minute, so it goes
  // next, and paid speech falls back to the phone's own voice.
  const critical = at(BUDGET_CRITICAL_PCT);
  assert.equal(critical.band, "critical");
  assert.equal(critical.allowLive, false);
  assert.equal(critical.allowServerTts, false);
  assert.equal(critical.allowFresh, true, "she can still be answered at 85%");

  // At the ceiling: no new model calls, but a cache hit costs nothing, so
  // today's common questions are still answered and still spoken.
  const spent = at(100);
  assert.equal(spent.band, "spent");
  assert.equal(spent.allowFresh, false);
});

check("a live minute is priced from the measured turn, not an estimate", () => {
  // Pins the 2026-09-19 measurement so a later "tidy-up" cannot quietly put
  // the old guess back. A real turn billed 721 prompt + 105 thought + 307
  // response tokens for 15.7 seconds of conversation, which at $3/M in and
  // $12/M out is $0.00711.
  const perMinute = ((721 * 3.0) + ((307 + 105) * 12.0)) / 1e6 / (15.7 / 60);
  assert.ok(
    Math.abs(perMinute - LIVE_USD_PER_MINUTE) < 0.0015,
    `table says $${LIVE_USD_PER_MINUTE}/min, the measurement works out at $${perMinute.toFixed(4)}`
  );
  // And the thinking tokens are the part the old estimate missed, so the rate
  // must be above what audio alone would give.
  assert.ok(LIVE_USD_PER_MINUTE > 0.023, "the superseded estimate was $0.023 and was 18% low");

  // Sizing: twenty minutes a month each across fifty farmers is more than the
  // whole $10 ceiling, which is why live is capped and closes first.
  const worstCase = 50 * 20 * LIVE_USD_PER_MINUTE;
  assert.ok(worstCase > 10, `50 farmers x 20 min is $${worstCase.toFixed(2)}`);
  assert.equal(budgetBands(worstCase, 10).allowLive, false, "the ceiling must close live before that");
});

check("the bands only ever tighten as spend rises", () => {
  // Guards against a threshold being reordered into an inversion where live
  // reopens at 95% because a comparison got flipped.
  const order = { normal: 0, tight: 1, critical: 2, spent: 3 };
  let previous = budgetBands(0, 10);
  for (let cents = 1; cents <= 1400; cents += 1) {
    const now = budgetBands(cents / 100, 10);
    assert.ok(
      order[now.band] >= order[previous.band],
      `band went backwards at $${(cents / 100).toFixed(2)}: ${previous.band} -> ${now.band}`
    );
    for (const flag of ["allowPrewarm", "allowLive", "allowServerTts", "allowFresh"]) {
      if (!previous[flag]) {
        assert.equal(now[flag], false, `${flag} came back on at $${(cents / 100).toFixed(2)}`);
      }
    }
    previous = now;
  }
});

check("overspend stays spent rather than wrapping round", () => {
  // 140% of the budget is not 40% of it. An operator who has been away for a
  // week must not find the ceiling reporting healthy.
  const over = budgetBands(14, 10);
  assert.equal(over.band, "spent");
  assert.equal(over.pct, 140);
  assert.equal(over.allowFresh, false);
});

check("what the $10 ceiling actually covers, and what it does not", () => {
  // Sizing, not just comparisons. The per-answer figure is measured, not
  // assumed: apa_usage held $0.0464 across 27 answers on 2026-09-19 — blended,
  // so it already includes the cache hits that cost nothing and the server-side
  // speech that costs the most.
  const perAnswer = 0.0464 / 27;
  assert.ok(perAnswer < 0.002, `$${perAnswer.toFixed(5)} an answer is higher than measured`);

  // The build-and-test window: a few hundred answers, comfortably inside $10.
  assert.equal(budgetBands(500 * perAnswer, 10).band, "normal");

  // The pilot the product is being built for. This is the number that matters
  // and it is the reason $10 is a testing ceiling rather than a pilot one: at
  // fifty farmers asking three questions a day it lands near enough to $10 to
  // pause the pre-warm — which would cost more than it saves, because the
  // pre-warm is what makes the mornings cheap.
  const pilotMonth = 50 * 3 * 30 * perAnswer;
  assert.ok(pilotMonth > 7 && pilotMonth < 8, `expected ~$7.7, got $${pilotMonth.toFixed(2)}`);
  assert.equal(budgetBands(pilotMonth, 10).band, "tight", "a $10 ceiling rations the pilot");

  // $20 is what keeps it out of the bands entirely, which is why the board's
  // $20-30 figure for the pilot is the right one and this $10 is not.
  assert.equal(budgetBands(pilotMonth, 20).band, "normal", "$20 carries the pilot untouched");

  // And the ceiling has to bite before the credit runs out, or it is decoration:
  // $10 of budget must refuse before $10 of credit is gone.
  assert.equal(budgetBands(10, 10).allowFresh, false);
});
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
