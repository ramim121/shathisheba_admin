import { genai, parseJson, retrying } from "@/lib/apa/client";
import { looksAgricultural } from "@/lib/apa/pure";
import { apaPrompt } from "@/lib/apa/config";
import { logScope } from "@/lib/apa/log";

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
 * something loosely agricultural costs a fraction of a cent. So `ambiguous`
 * resolves to *allow*, and every verdict — allow and refuse alike — is logged
 * for the Scope Review queue, because a log that only holds refusals cannot
 * show what the gate turned away by mistake.
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
  model: string;
  /** A photo of an animal or a field is agricultural by construction. */
  hasImage?: boolean;
}): Promise<ScopeResult> {
  const text = (input.text ?? "").trim();
  const started = Date.now();

  const shortcut = (topic: string): Promise<ScopeResult> =>
    finish("in_scope", topic, 1, started, input, "shortcut");

  if (!text) return shortcut("empty");
  if (input.hasImage) return shortcut("photo");
  if (looksAgricultural(text)) return shortcut("keyword");

  const scope = await apaPrompt("scope");
  const prompt = [
    scope,
    "",
    "Classify the farmer's message below. Return strict JSON and nothing else:",
    '{"verdict":"in_scope|out_of_scope|ambiguous","topic":"crop|livestock|poultry|fish|weather|market|money|platform|other","confidence":0.0}',
    "",
    "Use `ambiguous` when you genuinely cannot tell. Do not answer the message.",
    "",
    `MESSAGE:\n"""${text.slice(0, 1500)}"""`
  ].join("\n");

  let verdict: Verdict = "ambiguous";
  let topic = "other";
  let confidence = 0;
  try {
    const res = await retrying(() => genai().models.generateContent({
      model: input.model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        maxOutputTokens: 200,
        // Thinking off, and this is not an optimisation. With it on, the whole
        // output budget was spent reasoning before a single character of JSON
        // was produced: the call came back `finishReason: MAX_TOKENS` with no
        // parts at all, the parse fell through to `ambiguous`, and because
        // ambiguous allows, *every* question was reaching the answering model.
        // A gate that fails open silently is not a gate.
        thinkingConfig: { thinkingBudget: 0 }
      } as never
    }));
    if (!res.text) {
      throw new Error(`empty classification (${res.candidates?.[0]?.finishReason ?? "no reason"})`);
    }
    const parsed = parseJson<Raw>(res.text, {});
    const raw = String(parsed.verdict ?? "").toLowerCase();
    verdict = raw === "in_scope" || raw === "out_of_scope" ? raw : "ambiguous";
    topic = String(parsed.topic ?? "other").slice(0, 80);
    confidence = Number(parsed.confidence ?? 0) || 0;
  } catch (error) {
    // The gate failing open is the correct trade here: a farmer gets an answer
    // she might not have, rather than a refusal she certainly should not have.
    // The verdict is logged as ambiguous so the queue shows it either way.
    console.error("apa scope classify failed", error);
  }

  return finish(verdict, topic, confidence, started, input, input.model);
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
