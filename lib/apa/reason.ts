import { genai } from "@/lib/apa/client";
import { askInstruction, type ApaConfig } from "@/lib/apa/config";
import { runWithChain, thinkingFor, usageOf, type ModelUsage } from "@/lib/apa/models";
import {
  NAVIGABLE_SCREENS, TOOL_DECLARATIONS, runTool, type ApaSource, type ToolContext, type ToolOutcome
} from "@/lib/apa/tools";

/**
 * The answer itself.
 *
 * Shape of an answer, in the order the design puts it on screen: what to do,
 * then why, then where the figure came from, then what she might ask next. A
 * farmer standing in a field reads the first line and acts; the paragraph under
 * it is for the ones who want it.
 *
 * Three structural decisions, each the result of something going wrong:
 *
 * 1. **The system instruction contains nothing about the individual farmer.**
 *    Her district, farm and today's date go in the user turn. That keeps the
 *    instruction byte-identical across every farmer, which is the condition
 *    Google's implicit prompt cache needs — and, more usefully, it stopped the
 *    model inventing a Bengali month, because the date is now stated rather
 *    than guessed. It had said আষাঢ় in আশ্বিন: wrong by three months, in an
 *    assistant whose job is planting windows.
 *
 * 2. **Disclaimers are enforced here, not requested in the prompt.** A model
 *    that forgets one half the time is the same as not having it. Measured:
 *    with the old soft wording ("say plainly that you could not fetch it") the
 *    model invented a complete three-day forecast; the rule had to become a
 *    prohibition with a consequence before it held.
 *
 * 3. **A tool that found nothing is told apart from a tool that failed.** "No
 *    weather alert for your area today" is a real answer; "I could not reach
 *    the weather data" is a different one, and she acts differently on each.
 *    The distinction was being computed server-side and then thrown away
 *    before the model ever saw it.
 *
 * The model is asked to mark its own blocks with `[[advice]]`, `[[likely]]`,
 * `[[caution]]` and `[[suggest]]`. Tagged text rather than JSON because JSON
 * mode and function calling do not compose, and losing the grounding tools to
 * gain a schema would be the wrong trade.
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
  /** Ids of the apa_tool_calls rows this answer produced, for exact attribution. */
  tool_call_ids: number[];
  hedged: boolean;
  /** True when she was asked one question back instead of being given a guess. */
  asked_clarification: boolean;
  /**
   * Set when the model judged a photograph's subject non-agricultural.
   *
   * The caller turns this into a refusal rather than showing the answer: the
   * description of a bowl of curry is accurate and is not something this
   * assistant should be producing. See PHOTO_RULES.
   */
  off_topic_photo: boolean | null;
  /** What it appeared to show, for the refusal copy and the scope log. */
  off_topic_subject: string | null;
  /** No tool failed and nothing personal was read — safe to cache. */
  cacheable: boolean;
  model: string;
  usage: ModelUsage;
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

/**
 * What a photograph may be about.
 *
 * The scope gate lets every photo through — `classifyScope` short-circuits on
 * `hasImage`, on the reasoning that a picture of an animal or a field is
 * agricultural by construction. That is true of the pictures farmers were
 * expected to send and not of the pictures they actually send. A bowl of cooked
 * dal was answered in detail: "the picture shows a food bowl, rice and curry".
 * Fluent, accurate, and nothing to do with farming — and it spends a vision
 * call and teaches her the assistant will look at anything.
 *
 * So the model is asked to judge the subject first and say so in a tag we can
 * act on, rather than being asked to refuse in prose — which it does
 * inconsistently, and which cannot be detected reliably afterwards.
 *
 * The boundary is drawn at "something a farmer would show a field officer".
 * Raw produce is in, because a farmer photographs her harvest to ask about
 * grading or rot. A cooked meal is out: nothing about a plate of curry can be
 * answered agriculturally, and treating it as food-adjacent is how the
 * assistant ends up as a general-purpose image describer.
 */
const PHOTO_RULES = [
  "[PHOTO RULES]",
  "Before answering, decide what the photograph actually shows.",
  "",
  "You may answer about: crops, plants, leaves, stems, roots, fruit or vegetables (growing or harvested); soil, a field, a pond or its water; cattle, goats, poultry, fish or any farmed animal, including a part of one; an animal's wound, skin, dung or feed; farm inputs such as seed, fertiliser, pesticide, vaccine or feed sacks and their labels; farm tools, irrigation or machinery.",
  "",
  "You must NOT answer about anything else. That includes cooked or prepared food and meals, people or faces, pets, documents, screenshots, screens, vehicles, buildings, and objects with no farming use.",
  "",
  "Use [[off_topic]] ONLY when you can identify a specific thing in the photograph and that thing is not in the allowed list. Name it:",
  "[[off_topic]]the object you can see, in three or four Bangla words[[/off_topic]]",
  "",
  "NEVER use [[off_topic]] for a photograph you cannot make out. Too dark, too blurred, too close, overexposed, or just a flat colour or a pattern with no recognisable object — none of those are off topic, because you do not know what they are. They may well be her crop. For those, answer normally that the picture is not clear enough and say what would help: better light, a little further back, the affected part in the middle.",
  "",
  "The test is: could you name the object to a person? If not, it is unclear, not off topic. Do not guess in order to be helpful, and do not refuse in order to be safe."
].join("\n");

export async function answer(input: {
  question: string;
  cfg: ApaConfig;
  /** Which chain to use — vision for a photo, text otherwise. */
  models: string[];
  ctx: ToolContext;
  /**
   * Everything about this farmer and today, rendered for the user turn. Built
   * by the caller so this function stays ignorant of the database.
   */
  contextBlock: string;
  /** Prior turns, oldest first, already trimmed by the caller. */
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  image?: { data: string; mimeType: string } | null;
}): Promise<ApaAnswer> {
  const started = Date.now();
  const systemInstruction = await askInstruction(input.cfg);

  const contents: Array<{ role: string; parts: unknown[] }> = [];
  for (const turn of (input.history ?? []).slice(-6)) {
    contents.push({ role: turn.role === "user" ? "user" : "model", parts: [{ text: turn.text }] });
  }

  const askText = [
    input.contextBlock.trim(),
    "",
    input.image ? PHOTO_RULES : "",
    "[QUESTION]",
    input.question || "এই ছবিটা দেখে বলুন কী হয়েছে।"
  ]
    .filter((part) => part !== "")
    .join("\n");

  const askParts: unknown[] = [{ text: askText }];
  if (input.image) {
    askParts.push({ inlineData: { mimeType: input.image.mimeType, data: input.image.data } });
  }
  contents.push({ role: "user", parts: askParts });

  const sources: ApaSource[] = [];
  const toolsUsed: string[] = [];
  const toolCallIds: number[] = [];
  let toolFailed = false;
  let personal = false;
  let text = "";
  let model = input.models[0] ?? "unknown";
  const usage: ModelUsage = { tokensIn: 0, tokensOut: 0, cachedTokens: 0 };

  // Tool results are remembered for the length of this answer, so a model that
  // asks for the weather twice across two rounds only costs one query.
  const seen = new Map<string, ToolOutcome>();

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const attempt = await runWithChain({
      job: input.image ? "vision" : "answer",
      chain: input.models,
      call: async (candidate) => {
        const res = await genai().models.generateContent({
          model: candidate,
          contents: contents as never,
          config: {
            systemInstruction,
            temperature: 0.4,
            maxOutputTokens: 900,
            ...thinkingFor(candidate),
            tools: [{ functionDeclarations: TOOL_DECLARATIONS as never }]
          } as never
        });
        return { value: res, usage: usageOf(res) };
      }
    });

    model = attempt.model;
    const res = attempt.result;
    const turnUsage = usageOf(res);
    usage.tokensIn = (usage.tokensIn ?? 0) + (turnUsage.tokensIn ?? 0);
    usage.tokensOut = (usage.tokensOut ?? 0) + (turnUsage.tokensOut ?? 0);
    usage.cachedTokens = (usage.cachedTokens ?? 0) + (turnUsage.cachedTokens ?? 0);

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
      const args = (call.functionCall?.args ?? {}) as Row;
      const cacheKey = `${name}:${JSON.stringify(args)}`;

      let outcome = seen.get(cacheKey);
      if (!outcome) {
        outcome = await runTool(name, args, input.ctx);
        seen.set(cacheKey, outcome);
        toolsUsed.push(name);
        if (outcome.toolCallId) toolCallIds.push(outcome.toolCallId);
        if (!outcome.ok) toolFailed = true;
        if (outcome.personal) personal = true;
        for (const source of outcome.sources) {
          if (!sources.some((s) => s.kind === source.kind && s.label_bn === source.label_bn)) {
            sources.push(source);
          }
        }
      }

      // The model is told which of the three things happened, because it should
      // answer differently for each: data, nothing there, or could not ask.
      responses.push({
        functionResponse: {
          name,
          response: {
            ok: outcome.ok,
            empty: outcome.empty,
            note: !outcome.ok
              ? "This lookup FAILED. Do not state a figure. Say you could not fetch it and give general guidance, marked as general."
              : outcome.empty
                ? "This lookup SUCCEEDED and there is genuinely nothing to report. Say so plainly — it is a real answer, not a failure."
                : "This lookup succeeded. Use these figures exactly; do not round them.",
            result: outcome.data
          }
        }
      });
    }
    contents.push({ role: "user", parts: responses });
  }

  return finish({
    raw: text,
    question: input.question,
    sources,
    toolsUsed,
    toolCallIds,
    toolFailed,
    personal,
    hasImage: Boolean(input.image),
    model,
    usage,
    latencyMs: Date.now() - started
  });
}

/* ---------------------------------------------------------------------------
   Parsing, and the disclaimers that are not the model's to forget
   --------------------------------------------------------------------------- */

/** One chip per destination. The model often offers the same screen twice. */
function dedupeSources(all: ApaSource[]): ApaSource[] {
  const seen = new Set<string>();
  const out: ApaSource[] = [];
  for (const source of all) {
    const key = `${source.kind}:${source.action ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

/**
 * Everything the model writes that was meant to be a function call.
 *
 * It is supposed to call the tool, and usually does. But it leaks the call into
 * the answer text in at least three shapes, and each one has reached a farmer's
 * screen:
 *
 *   1. tagged, with JSON:
 *        [[navigate_to]]
 *        { "label_bn": "বিক্রির তালিকা দেখুন", "screen": "myListings" }
 *        [[/navigate_to]]
 *
 *   2. untagged, as bare fields — this is the one the tag stripper could never
 *      have caught, because there is no tag:
 *        label_bn: ফিন্যান্স হাব খুলুন
 *        screen: financeHub
 *
 *   3. fenced, as a code block containing either of the above.
 *
 * All three are parsed rather than merely deleted: a valid screen becomes the
 * button the model was trying to offer, so the farmer gets the navigation
 * instead of the syntax. A malformed one is dropped silently, because a button
 * that goes nowhere is worse than no button.
 *
 * The field names are ours (`label_bn`, `screen`, `tool_code`), which is what
 * makes stripping them safe: they are not words that appear in Bangla advice
 * about a cow. Nothing is removed on the basis of looking like JSON in general,
 * because an answer may legitimately contain a brace or a colon.
 */
export function scrubToolSyntax(raw: string): { sources: ApaSource[]; rest: string } {
  const sources: ApaSource[] = [];
  let rest = raw;

  const offer = (screen: unknown, label: unknown) => {
    const s = String(screen ?? "").trim();
    const l = String(label ?? "").trim().slice(0, 40);
    if (s && l && (NAVIGABLE_SCREENS as readonly string[]).includes(s)) {
      sources.push({ kind: "action", label_bn: l, action: `screen:${s}` });
    }
  };

  // 1. The tagged form, with a JSON body.
  rest = rest.replace(/\[\[navigate_to\]\]([\s\S]*?)\[\[\/navigate_to\]\]/gi, (_all, body: string) => {
    try {
      const parsed = JSON.parse(String(body).trim()) as Record<string, unknown>;
      offer(parsed.screen, parsed.label_bn ?? parsed.label_en);
    } catch {
      // Not JSON — fall through to the field scan below, which handles the
      // half-written case where the tags arrived and the braces did not.
      const screen = /(?:^|\n)\s*"?screen"?\s*[:=]\s*"?([A-Za-z][A-Za-z0-9_]*)"?/.exec(body);
      const label = /(?:^|\n)\s*"?label_bn"?\s*[:=]\s*"?([^"\n,}]+)"?/.exec(body);
      offer(screen?.[1], label?.[1]);
    }
    return " ";
  });

  // 2. Bare fields on their own lines, the shape with no tag at all. Taken as a
  //    pair so a stray "screen:" in prose cannot produce a button.
  const bareScreen = /(?:^|\n)[ \t]*"?screen"?[ \t]*[:=][ \t]*"?([A-Za-z][A-Za-z0-9_]*)"?[ \t]*,?[ \t]*(?=\n|$)/g;
  const bareLabel = /(?:^|\n)[ \t]*"?label_(?:bn|en)"?[ \t]*[:=][ \t]*"?([^"\n]+?)"?[ \t]*,?[ \t]*(?=\n|$)/g;
  const screenHit = bareScreen.exec(rest);
  const labelHit = bareLabel.exec(rest);
  if (screenHit) offer(screenHit[1], labelHit?.[1]);

  // Removed whether or not they formed a usable pair: a lone "screen:
  // financeHub" is machine syntax either way and must not be read aloud to her.
  rest = rest
    .replace(bareScreen, "\n")
    .replace(bareLabel, "\n")
    // The other field names that have shown up in answer text.
    .replace(/(?:^|\n)[ \t]*"?(?:tool_code|tool_name|function_call|parameters|args|arguments)"?[ \t]*[:=][^\n]*/gi, "\n");

  // 3. A fence left behind once its contents were taken out, and the lone
  //    braces that a partly-stripped JSON object leaves on their own lines.
  rest = rest
    .replace(/```[a-z]*\s*```/gi, " ")
    .replace(/```[a-z]*\n?/gi, " ")
    .replace(/(?:^|\n)[ \t]*[{}][ \t]*(?=\n|$)/g, "\n");

  return { sources, rest };
}

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
  toolCallIds: number[];
  toolFailed: boolean;
  personal: boolean;
  hasImage: boolean;
  model: string;
  usage: ModelUsage;
  latencyMs: number;
}): ApaAnswer {
  let rest = input.raw;

  // The model's own verdict on the photograph's subject. Read before anything
  // else, because an off-topic photo has no answer to parse.
  const offTopic = block(rest, "off_topic");
  rest = offTopic.rest;

  const advice = block(rest, "advice");
  rest = advice.rest;
  const likely = block(rest, "likely");
  rest = likely.rest;
  const caution = block(rest, "caution");
  rest = caution.rest;
  const suggest = block(rest, "suggest");
  rest = suggest.rest;
  // Recovered rather than discarded — see scrubToolSyntax.
  const inlineNav = scrubToolSyntax(rest);
  rest = inlineNav.rest;

  const text = rest
    // An unclosed tag from a truncated generation must not reach the screen.
    // The character class needs `_` and digits: it was `[a-z]+`, which does not
    // match `navigate_to`, and that is how four lines of JSON ended up in the
    // middle of an answer about a farmer's cow.
    .replace(/\[\[\/?[a-z0-9_]+\]\]/gi, " ")
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
    cautionText = "এটি ছবি দেখে প্রাথমিক ধারণা, নিশ্চিত নয়। আজই প্রাণিসম্পদ কর্মকর্তা বা পশু ডাক্তারকে দেখান।";
  }
  // A number we could not fetch is never today's number.
  if (input.toolFailed && !cautionText) {
    cautionText = "এটি সাধারণ ধারণা, আজকের নিশ্চিত তথ্য নয়। একটু পরে আবার চেষ্টা করুন।";
  }

  // One short question back and nothing else is the "ask rather than guess"
  // behaviour, and the caller must not mistake it for a failed answer.
  const sentences = text.split(/[।?!\n]+/).filter((s) => s.trim().length > 2);
  const askedClarification =
    /[?？]|জানালে|কোনটা|কোন গাছ|কী ধরনের/.test(text) &&
    sentences.length <= 2 &&
    !advice.body &&
    !likely.body;

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
    //
    // A leaked tool call is merged in here rather than dropped, de-duplicated
    // against what the tool path already produced: the model often writes the
    // call *and* makes it, and two identical buttons under one answer looks
    // like a bug to the person reading it.
    sources: dedupeSources([...input.sources, ...inlineNav.sources]),
    needs_officer: health,
    tools_used: Array.from(new Set(input.toolsUsed)),
    tool_call_ids: input.toolCallIds,
    hedged: Boolean(cautionText) || input.toolFailed,
    asked_clarification: askedClarification,
    // Set only for a photograph the model judged non-agricultural. The caller
    // turns it into a polite refusal rather than showing the description.
    off_topic_photo: Boolean(offTopic.body) || null,
    off_topic_subject: offTopic.body || null,
    // Never cache a failed lookup, anything personal, or a clarifying question
    // — the last because the next farmer's vague question is not this one.
    cacheable: !input.toolFailed && !input.personal && !askedClarification && text.length > 0,
    model: input.model,
    usage: input.usage,
    latencyMs: input.latencyMs
  };
}
