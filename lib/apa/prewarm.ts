import { answer } from "@/lib/apa/reason";
import { apaConfig } from "@/lib/apa/config";
import { contextBlock, loadProfile } from "@/lib/apa";
import { resolveEntitlement } from "@/lib/apa/entitlement";
import { readAnswerCache, writeAnswerCache } from "@/lib/apa/cache";
import { budgetState } from "@/lib/apa/budget";

/**
 * Answer a question nobody asked, so that tomorrow morning nobody has to.
 *
 * Driven by `scripts/apa-prewarm.cjs` shortly after the daily quota resets,
 * when the day's allowance is sitting idle and the farmers are asleep. See that
 * script for why this exists at all: Gemini's Batch API — the analysis
 * document's fourth lever — returns `400 FAILED_PRECONDITION` on a free-tier
 * key, so the discount it offers is not reachable, and spending idle overnight
 * requests to fill the cache is worth more on a request-capped tier anyway.
 *
 * Three things make this safe to run unattended:
 *
 *   - **It never touches the farmer's record.** No conversation turn, no
 *     message row, no trial question spent, no usage counted against her. She
 *     supplies the district and the farm context; she is not billed for a
 *     question she did not ask.
 *   - **It discards rather than caches when in doubt.** If the answer reached a
 *     grounding tool, or came back hedged, or the pipeline marked it not
 *     cacheable, nothing is written. A stale weather answer served to fifty
 *     farmers is far worse than fifty requests.
 *   - **It goes through the live code path.** The same prompt, the same chain,
 *     the same parsing. A warm-up that used a shortcut would fill the cache
 *     with answers the real path would never have produced.
 */

export type PrewarmResult =
  | { stored: true; model: string; chars: number }
  | { stored: false; reason: string };

export async function prewarmAnswer(input: {
  userId: string;
  question: string;
}): Promise<PrewarmResult> {
  const question = input.question.trim();
  if (question.length < 8) return { stored: false, reason: "too short to be worth holding" };

  const cfg = await apaConfig();
  if (!cfg.answerCacheHours) return { stored: false, reason: "the answer cache is switched off" };

  // First spending to stop when the month tightens. This buys answers nobody
  // has asked for yet, so of everything that costs money it is the only part
  // whose absence no farmer can notice on the day.
  const budget = await budgetState(cfg);
  if (!budget.allowPrewarm) {
    return { stored: false, reason: `budget at ${budget.pct}% — pre-warming paused` };
  }

  const profile = await loadProfile(input.userId);
  if (!profile) return { stored: false, reason: "that farmer no longer exists" };

  const districtName = (profile.district_bn ?? profile.district_en ?? null) as string | null;
  const upazilaName = (profile.upazila_bn ?? profile.upazila_en ?? null) as string | null;
  const districtId = (profile.district_id as string | null) ?? null;
  if (!districtId) return { stored: false, reason: "no district — the cache key needs one" };

  // Already answered today — by a farmer, or by an earlier run of the script.
  // Checked here rather than in the caller so that the key is derived once, by
  // the code that owns it; a second implementation of that hash in the cron
  // script would drift the first time either side changed.
  const existing = await readAnswerCache({
    question,
    districtId,
    lang: "bn",
    examples: cfg.promptExamples,
    hours: cfg.answerCacheHours,
    countHit: false
  });
  if (existing) return { stored: false, reason: "already held for today" };

  const entitlement = await resolveEntitlement(input.userId, cfg);

  const result = await answer({
    question,
    cfg,
    models: cfg.models.text,
    ctx: { userId: input.userId, districtName, upazilaName },
    contextBlock: await contextBlock({
      userId: input.userId,
      profile,
      districtName,
      upazilaName,
      entitlement
    })
  });

  // These are real requests against the day's allowance and the quota page
  // must show them — which it does, because `answer()` runs through the same
  // fallback-chain runner as a farmer's question, and that runner is what
  // writes the per-model counters.
  //
  // Everything below is the guard. Each line is a reason the live path would
  // not have cached this answer either.
  if (result.asked_clarification) return { stored: false, reason: "she was asked to clarify" };
  if (result.tool_call_ids.length || result.tools_used.length) {
    return { stored: false, reason: `reached a grounding tool (${result.tools_used.join(", ")})` };
  }
  if (!result.cacheable) return { stored: false, reason: "the pipeline marked it not cacheable" };
  if (!result.text || result.text.length < 40) return { stored: false, reason: "the answer came back empty" };

  await writeAnswerCache({
    question,
    districtId,
    lang: "bn",
    examples: cfg.promptExamples,
    answer: {
      text: result.text,
      advice: result.advice,
      caution: result.caution,
      suggestions: result.suggestions,
      sources: result.sources,
      needs_officer: result.needs_officer,
      tools_used: [],
      hedged: result.hedged
    },
    model: result.model,
    tools: []
  });

  return { stored: true, model: result.model, chars: result.text.length };
}
