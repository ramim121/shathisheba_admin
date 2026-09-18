import { genai, retrying } from "@/lib/apa/client";
import { apaPrompt } from "@/lib/apa/config";
import { TOOL_DECLARATIONS, activeProjectContext, runTool, type ApaSource, type ToolContext } from "@/lib/apa/tools";

/**
 * The answer itself.
 *
 * Shape of an answer, in the order the design puts it on screen: what to do,
 * then why, then where the figure came from, then what she might ask next. A
 * farmer standing in a field reads the first line and acts; the paragraph under
 * it is for the ones who want it.
 *
 * Three disclaimers are not optional and are enforced here rather than
 * requested in the prompt, because a model that forgets one half the time is
 * the same as not having it:
 *
 *   - anything about an animal's health ends with a named person to call;
 *   - a diagnosis from a photo is always marked as a first impression;
 *   - a figure a tool failed to fetch is never presented as today's number.
 *
 * The model is asked to mark its own blocks with `[[advice]]`, `[[caution]]`
 * and `[[suggest]]`. Tagged text rather than JSON because JSON mode and
 * function calling do not compose, and losing the grounding tools to gain a
 * schema would be the wrong trade.
 */

type Row = Record<string, unknown>;

export type ApaAnswer = {
  text: string;
  advice: { kind: "advice" | "likely"; title_bn: string; body: string } | null;
  caution: string | null;
  suggestions: string[];
  sources: ApaSource[];
  needs_officer: boolean;
  tools_used: string[];
  hedged: boolean;
  model: string;
  latencyMs: number;
};

/** Topics where an answer that does not end with a person is an unsafe answer. */
const HEALTH_WORDS = [
  "রোগ", "অসুখ", "জ্বর", "ওষুধ", "চিকিৎসা", "টিকা", "ইনজেকশন", "ডোজ", "মাত্রা",
  "ফোলা", "রক্ত", "মরে", "মারা", "কীটনাশক", "বিষ", "স্প্রে",
  "disease", "sick", "fever", "medicine", "dose", "dosage", "vaccine", "injection", "pesticide", "spray"
];

function touchesHealth(text: string): boolean {
  const t = text.toLowerCase();
  return HEALTH_WORDS.some((w) => t.includes(w));
}

const MAX_TOOL_ROUNDS = 3;

export async function answer(input: {
  question: string;
  model: string;
  ctx: ToolContext;
  /** Prior turns, oldest first, already trimmed by the caller. */
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  image?: { data: string; mimeType: string } | null;
  language?: "bn" | "en";
}): Promise<ApaAnswer> {
  const started = Date.now();
  const [persona, scope, project] = await Promise.all([
    apaPrompt("persona"),
    apaPrompt("scope"),
    activeProjectContext(input.ctx.userId)
  ]);

  const systemInstruction = [
    persona,
    "",
    scope,
    "",
    "WHERE THIS FARMER IS:",
    `District: ${input.ctx.districtName ?? "unknown"}. Upazila: ${input.ctx.upazilaName ?? "unknown"}.`,
    project ? `She is enrolled in: ${project}.` : "",
    "",
    "USING THE TOOLS:",
    "- Never state a weather condition, a price, a grade, an instalment or a stock level without calling the tool for it first. The app shows these numbers on its own screens and the farmer will see both.",
    "- If a tool fails or returns nothing, say plainly that you could not fetch it today, give the general guidance instead and mark it as general. Never fill the gap with a number.",
    "- Call get_my_profile whenever the advice depends on where she is or what she keeps.",
    "",
    "THE EARLIER TURNS:",
    "- They are background, not a question. Answer only the last message. Do not re-answer or summarise what came before, and do not carry a figure from an earlier turn into an answer about something else.",
    "",
    "HOW TO LAY THE ANSWER OUT:",
    "Write the answer as plain Bangla text, two to five short sentences or bullets. Then, where they apply, add these blocks exactly as written:",
    "",
    "[[advice]]What she should do today, one or two sentences.[[/advice]]",
    "[[likely]]For a photo or a described symptom: what it probably is, and the common name.[[/likely]]",
    "[[caution]]A warning she must read before acting.[[/caution]]",
    "[[suggest]]first follow-up | second follow-up | third[[/suggest]]",
    "",
    "Use [[advice]] when there is an action. Use [[likely]] instead when you are naming a probable disease. Never both. Keep [[suggest]] to three short questions she might ask next, in her words.",
    "Nothing else may be marked up: no headings, no bold, no tables."
  ]
    .filter(Boolean)
    .join("\n");

  const contents: Array<{ role: string; parts: unknown[] }> = [];
  for (const turn of (input.history ?? []).slice(-6)) {
    contents.push({ role: turn.role === "user" ? "user" : "model", parts: [{ text: turn.text }] });
  }
  const askParts: unknown[] = [{ text: input.question || "এই ছবিটা দেখে বলুন কী হয়েছে।" }];
  if (input.image) {
    askParts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.data } });
  }
  contents.push({ role: "user", parts: askParts });

  const sources: ApaSource[] = [];
  const toolsUsed: string[] = [];
  let toolFailed = false;
  let text = "";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const res = await retrying(() => genai().models.generateContent({
      model: input.model,
      contents: contents as never,
      config: {
        systemInstruction,
        temperature: 0.4,
        maxOutputTokens: 900,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS as never }]
      } as never
    }));

    const parts = (res.candidates?.[0]?.content?.parts ?? []) as Array<{
      text?: string;
      functionCall?: { name?: string; args?: Row };
    }>;
    const calls = parts.filter((p) => p.functionCall?.name);
    text = parts.map((p) => p.text ?? "").join("").trim() || text;

    if (!calls.length || round === MAX_TOOL_ROUNDS) break;

    contents.push({ role: "model", parts: parts as unknown[] });
    const responses: unknown[] = [];
    for (const call of calls) {
      const name = String(call.functionCall?.name);
      const outcome = await runTool(name, (call.functionCall?.args ?? {}) as Row, input.ctx);
      toolsUsed.push(name);
      if (!outcome.ok) toolFailed = true;
      for (const source of outcome.sources) {
        if (!sources.some((s) => s.kind === source.kind && s.label_bn === source.label_bn)) sources.push(source);
      }
      responses.push({ functionResponse: { name, response: { result: outcome.data } } });
    }
    contents.push({ role: "user", parts: responses });
  }

  return finish({
    raw: text,
    question: input.question,
    sources,
    toolsUsed,
    toolFailed,
    hasImage: Boolean(input.image),
    model: input.model,
    latencyMs: Date.now() - started
  });
}

/* ---------------------------------------------------------------------------
   Parsing, and the disclaimers that are not the model's to forget
   --------------------------------------------------------------------------- */

function block(raw: string, tag: string): { body: string; rest: string } {
  const re = new RegExp(`\\[\\[${tag}\\]\\]([\\s\\S]*?)\\[\\[\\/${tag}\\]\\]`, "i");
  const match = raw.match(re);
  if (!match) return { body: "", rest: raw };
  return { body: match[1].trim(), rest: raw.replace(re, " ") };
}

function finish(input: {
  raw: string;
  question: string;
  sources: ApaSource[];
  toolsUsed: string[];
  toolFailed: boolean;
  hasImage: boolean;
  model: string;
  latencyMs: number;
}): ApaAnswer {
  let rest = input.raw;
  const advice = block(rest, "advice");
  rest = advice.rest;
  const likely = block(rest, "likely");
  rest = likely.rest;
  const caution = block(rest, "caution");
  rest = caution.rest;
  const suggest = block(rest, "suggest");
  rest = suggest.rest;

  const text = rest
    // An unclosed tag from a truncated generation must not reach the screen.
    .replace(/\[\[\/?[a-z]+\]\]/gi, " ")
    .replace(/\s*\n\s*\n\s*\n+/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const suggestions = suggest.body
    .split(/\||\n/)
    .map((s) => s.replace(/^[-*•\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 3);

  const health = touchesHealth(`${input.question} ${text} ${advice.body} ${likely.body}`);

  let cautionText = caution.body || null;
  // A first impression from a photograph is always a first impression. The
  // model says so most of the time; "most of the time" is not a safety control.
  if (input.hasImage && likely.body && !cautionText) {
    cautionText = "এটি প্রাথমিক ধারণা। নিশ্চিত হতে স্থানীয় প্রাণিসম্পদ কর্মকর্তার সাথে কথা বলুন।";
  }
  // A number we could not fetch is never today's number.
  if (input.toolFailed && !cautionText) {
    cautionText = "এটি সাধারণ ধারণা, আজকের নিশ্চিত তথ্য নয়। একটু পরে আবার চেষ্টা করুন।";
  }

  return {
    text,
    advice: advice.body
      ? { kind: "advice", title_bn: "পরামর্শ", body: advice.body }
      : likely.body
        ? { kind: "likely", title_bn: "সম্ভবত", body: likely.body }
        : null,
    caution: cautionText,
    suggestions,
    // A chip may only claim a source that actually answered. A failed tool
    // leaves no chip behind, because there is nothing to tap through to.
    sources: input.sources,
    needs_officer: health,
    tools_used: Array.from(new Set(input.toolsUsed)),
    hedged: Boolean(cautionText) || input.toolFailed,
    model: input.model,
    latencyMs: input.latencyMs
  };
}
