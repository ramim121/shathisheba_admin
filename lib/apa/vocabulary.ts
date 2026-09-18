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
let cache: { at: number; terms: string[] } | null = null;

/** Gemini caps the bias list; past this the tail stops helping anyway. */
const MAX_TERMS = 500;

export async function biasTerms(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.terms;
  try {
    const rows = await queryRows<{ term: string }>(
      `SELECT term FROM apa_vocabulary
        WHERE is_active = 1
        ORDER BY heard_count DESC, sort_order, term
        LIMIT ${MAX_TERMS}`
    );
    cache = { at: Date.now(), terms: rows.map((r) => r.term) };
  } catch {
    // A missing table must not stop a farmer being heard — it only makes the
    // transcription slightly worse.
    cache = { at: Date.now(), terms: [] };
  }
  return cache.terms;
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
  const terms = (await biasTerms()).filter((t) => text.includes(t));
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
