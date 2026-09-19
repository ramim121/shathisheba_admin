import { genai, parseJson } from "@/lib/apa/client";
import { looksAgricultural } from "@/lib/apa/pure";
import { apaPrompt } from "@/lib/apa/config";
import { logScope } from "@/lib/apa/log";
import { runWithChain, thinkingFor, usageOf } from "@/lib/apa/models";

/**
 * Layer 1 of the scope restriction: is this a farming question at all?
 *
 * There are two layers on purpose. This one is a separate, cheap call that sees
 * only the question — it cannot be talked out of its job by anything in the
 * conversation, because it has no conversation. Layer 2 is the instruction
 * attached to the answering model, which catches what slips through. Neither
 * alone is enough: a prompt is a request, and a classifier without a second
 * opinion refuses things it should not.
 *
 * The bias is deliberate and asymmetric. Refusing a farmer's badly-phrased
 * question about her own field is the failure that loses a user; answering
 * something loosely agricultural costs a fraction of a paisa. So `ambiguous`
 * resolves to *allow*, and every verdict — allow and refuse alike — is logged
 * for the Scope Review queue, because a log that only holds refusals cannot
 * show what the gate turned away by mistake.
 *
 * Two things here were measured rather than assumed:
 *
 *   - **Thinking must be off.** With it on, the model spent the entire output
 *     budget reasoning and returned `finishReason: MAX_TOKENS` with no content
 *     at all. The parse fell through to `ambiguous`, ambiguous allows, and so
 *     *every* question was reaching the answering model. A gate that fails open
 *     silently is not a gate.
 *   - **Accuracy differs sharply by model** on the same ten labelled cases:
 *     `gemini-2.5-flash` 10/10 at 1.3s, `gemini-3.1-flash-lite` 9/10,
 *     `gemini-3.5-flash` 7/10, `gemma-4-31b-it` 2/10 at 21s.
 */

export type Verdict = "in_scope" | "out_of_scope" | "ambiguous";

export type ScopeResult = {
  verdict: Verdict;
  /** What the pipeline should actually do — `ambiguous` lands here as true. */
  allow: boolean;
  topic: string;
  confidence: number;
  latencyMs: number;
  model: string;
  scopeLogId: number | null;
};

type Raw = { verdict?: string; topic?: string; confidence?: number };

export async function classifyScope(input: {
  text: string;
  userId?: string | number | null;
  /** Fallback chain; the first model that answers wins. */
  models: string[];
  /** A photo of an animal or a field is agricultural by construction. */
  hasImage?: boolean;
  /**
   * What was being talked about a moment ago, newest last.
   *
   * Without this the gate judged every message alone, and a follow-up has no
   * farming words in it. Measured on a real conversation: a photo of a cow was
   * answered, and the next question — "এটা কি ছ্যাবলা?", *is it contagious?* —
   * was **refused as off-topic**, because in isolation it is four words about
   * nothing. She had done nothing wrong and the app told her it only discusses
   * farming, immediately after discussing her animal.
   *
   * Only the previous turns are used, never the current message, so the
   * conversation can widen the gate but cannot be used to smuggle a new topic
   * past it: the message still has to be plausible *in that context*.
   */
  context?: string[];
}): Promise<ScopeResult> {
  const text = (input.text ?? "").trim();
  const started = Date.now();

  const shortcut = (topic: string): Promise<ScopeResult> =>
    finish("in_scope", topic, 1, started, input, "shortcut");

  if (!text) return shortcut("empty");
  if (input.hasImage) return shortcut("photo");
  if (looksAgricultural(text)) return shortcut("keyword");

  // A short reply inside a conversation that was already agricultural is a
  // follow-up, not a new subject. "How much?", "is it contagious?", "and the
  // other field?" are all in scope when the previous turn was, and none of
  // them survive being read on their own.
  //
  // Length-bounded on purpose: this widens the gate for the pronouns and
  // fragments that depend on context, not for a paragraph that has changed the
  // subject and would simply inherit permission from what came before.
  const recent = (input.context ?? []).filter(Boolean);
  if (recent.length && text.length <= 60 && recent.some((line) => looksAgricultural(line))) {
    return shortcut("follow_up");
  }

  const instruction = await apaPrompt("classify");
  // The conversation goes to the model too, labelled as background rather than
  // as the thing being judged - so a borderline fragment is read the way a
  // person would read it, and the verdict is still about the message.
  const history = recent.length
    ? `\n\nWHAT WAS BEING DISCUSSED JUST BEFORE (background only, do not classify this):\n${recent
        .slice(-3)
        .map((line) => `- ${line.slice(0, 200)}`)
        .join("\n")}`
    : "";
  const prompt = `${instruction}${history}\n\nMESSAGE:\n"""${text.slice(0, 1500)}"""`;

  let verdict: Verdict = "ambiguous";
  let topic = "other";
  let confidence = 0;
  let model = input.models[0] ?? "unknown";

  try {
    const attempt = await runWithChain({
      job: "classify",
      chain: input.models,
      call: async (candidate) => {
        const res = await genai().models.generateContent({
          model: candidate,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            temperature: 0,
            responseMimeType: "application/json",
            maxOutputTokens: 200,
            ...thinkingFor(candidate)
          } as never
        });
        if (!res.text) {
          throw new Error(`empty classification (${res.candidates?.[0]?.finishReason ?? "no reason"})`);
        }
        return { value: res.text, usage: usageOf(res) };
      }
    });

    model = attempt.model;
    const parsed = parseJson<Raw>(attempt.result, {});
    const raw = String(parsed.verdict ?? "").toLowerCase();
    verdict = raw === "in_scope" || raw === "out_of_scope" ? raw : "ambiguous";
    topic = String(parsed.topic ?? "other").slice(0, 80);
    confidence = Number(parsed.confidence ?? 0) || 0;
  } catch (error) {
    // The gate failing open is the correct trade here: a farmer gets an answer
    // she might not have, rather than a refusal she certainly should not have.
    // The verdict is logged as ambiguous so the review queue shows it either way.
    console.error("apa scope classify failed", error);
  }

  return finish(verdict, topic, confidence, started, input, model);
}

async function finish(
  verdict: Verdict,
  topic: string,
  confidence: number,
  started: number,
  input: { text: string; userId?: string | number | null },
  model: string
): Promise<ScopeResult> {
  const latencyMs = Date.now() - started;
  const scopeLogId = await logScope({
    userId: input.userId ?? null,
    input: input.text,
    verdict,
    topic,
    confidence,
    model,
    latencyMs
  });
  return {
    verdict,
    allow: verdict !== "out_of_scope",
    topic,
    confidence,
    latencyMs,
    model,
    scopeLogId
  };
}

/**
 * Three things she could ask instead, chosen from what we know she grows.
 *
 * A refusal that ends there is a dead end; the design puts three tappable
 * suggestions under it so the screen is still useful to someone who cannot
 * compose a new question (SRS 7.6, rule V8).
 */
export function refusalSuggestions(context: { crops?: string[]; livestock?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const crop of (context.crops ?? []).slice(0, 2)) out.push(`আমার ${crop}ের রোগ`);
  if (context.livestock) out.push("গরুর খাবার");
  while (out.length < 3) {
    const fallback = ["আমার ধানের রোগ", "গরুর খাবার", "আজকের বাজারদর"][out.length];
    if (!out.includes(fallback)) out.push(fallback);
    else break;
  }
  return out.slice(0, 3);
}
