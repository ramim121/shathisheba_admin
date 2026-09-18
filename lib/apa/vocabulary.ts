import { executeQuery, queryRows } from "@/lib/db";

/**
 * The words the transcriber is told to expect.
 *
 * A general Bangla speech model has never heard "গলাফুলা" as one word, so it
 * returns "গলা ফুলা" and the answer that comes back is about a swollen throat
 * in a person. Handing the model the vocabulary in advance is the difference
 * between a diagnosis and a shrug, and it is the single cheapest accuracy win
 * available on this path.
 *
 * Cached for a minute: every voice message reads it, and the list changes when
 * a staff member adds a term, not between requests.
 */

const TTL_MS = 60_000;
let cache: { at: number; terms: Array<{ term: string; group: string; heard: number }> } | null = null;

/**
 * How many terms go on the wire.
 *
 * Measured: the full 141-term list is 565 input tokens on **every** voice
 * message, and the table is allowed to grow. Sending all of it was costing more
 * than the transcription itself on short clips, so the list is ranked and
 * trimmed: terms this farmer's own crops and animals make likely, then terms
 * that have actually been heard, then the rest.
 */
const MAX_TERMS = 120;

async function all(): Promise<Array<{ term: string; group: string; heard: number }>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.terms;
  try {
    const rows = await queryRows<{ term: string; term_group: string; heard_count: number }>(
      `SELECT term, term_group, heard_count FROM apa_vocabulary
        WHERE is_active = 1
        ORDER BY heard_count DESC, sort_order, term`
    );
    cache = {
      at: Date.now(),
      terms: rows.map((r) => ({ term: r.term, group: r.term_group, heard: Number(r.heard_count ?? 0) }))
    };
  } catch {
    // A missing table must not stop a farmer being heard — it only makes the
    // transcription slightly worse.
    cache = { at: Date.now(), terms: [] };
  }
  return cache.terms;
}

/**
 * The bias list for one farmer, most relevant first.
 *
 * Relevance is crude and deliberately so: the groups her farm profile implies,
 * then anything already heard on the platform, then the remainder to fill the
 * budget. A cleverer ranking would be harder to explain to the staff member
 * deciding whether a term is worth keeping.
 */
export async function biasTerms(userId?: string | number | null): Promise<string[]> {
  const terms = await all();
  if (!terms.length) return [];
  if (!userId) return terms.slice(0, MAX_TERMS).map((t) => t.term);

  const groups = await relevantGroups(userId);
  const scored = terms.map((t) => ({
    term: t.term,
    score: (groups.has(t.group) ? 1000 : 0) + Math.min(t.heard, 500),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_TERMS).map((t) => t.term);
}

/** Which vocabulary groups this farmer's own farm makes likely. */
async function relevantGroups(userId: string | number): Promise<Set<string>> {
  const always = new Set(["platform", "measure", "weather", "general"]);
  try {
    const [farm] = await queryRows<{ crop_types: string | null; livestock_count: number | null; pond_count: number | null; primary_focus: string | null }>(
      "SELECT crop_types, livestock_count, pond_count, primary_focus FROM app_user_farm WHERE user_id = ? LIMIT 1",
      [userId]
    );
    if (!farm) return new Set([...always, "crop", "crop_disease", "crop_pest", "livestock", "livestock_disease", "input"]);
    const focus = `${farm.crop_types ?? ""} ${farm.primary_focus ?? ""}`.toLowerCase();
    if (farm.crop_types || /crop|ধান|সবজি|ফসল/.test(focus)) {
      always.add("crop"); always.add("crop_disease"); always.add("crop_pest"); always.add("input");
    }
    if (Number(farm.livestock_count ?? 0) > 0 || /cattle|livestock|গরু|পশু/.test(focus)) {
      always.add("livestock"); always.add("livestock_disease"); always.add("poultry");
    }
    if (Number(farm.pond_count ?? 0) > 0 || /fish|মাছ|পুকুর/.test(focus)) {
      always.add("fish");
    }
    // A farmer with nothing recorded gets the common groups rather than nothing.
    if (always.size <= 4) {
      always.add("crop"); always.add("crop_disease"); always.add("livestock"); always.add("livestock_disease");
    }
    return always;
  } catch {
    return new Set([...always, "crop", "livestock"]);
  }
}

export function invalidateVocabulary() {
  cache = null;
}

/**
 * Count the terms that actually turned up in a transcript.
 *
 * This is what makes the Vocabulary page worth opening: without it the list is
 * a hundred and forty guesses, and with it the staff member can see that
 * "গলাফুলা" is heard forty times a week and "ভার্মি কম্পোস্ট" never.
 */
export async function recordHeardTerms(transcript: string): Promise<void> {
  const text = (transcript ?? "").trim();
  if (!text) return;
  const terms = (await all()).map((t) => t.term).filter((t) => text.includes(t));
  if (!terms.length) return;
  try {
    const marks = terms.map(() => "?").join(", ");
    await executeQuery(
      `UPDATE apa_vocabulary SET heard_count = heard_count + 1 WHERE term IN (${marks})`,
      terms
    );
  } catch {
    /* counting is a nicety; never fail a farmer's question over it */
  }
}
