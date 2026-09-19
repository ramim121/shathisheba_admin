import { executeQuery, queryRows } from "@/lib/db";
import { apaConfig } from "@/lib/apa/config";
import { genai } from "@/lib/apa/client";
import { runWithChain, thinkingFor, usageOf } from "@/lib/apa/models";
import { bengaliDate } from "@/lib/apa/calendar";
import { parseJson } from "@/lib/apa/client";
import { getBoolSetting } from "@/lib/settings";

/**
 * The four chips on an empty Shathi Apa chat.
 *
 * They used to be four hard-coded strings, identical for every farmer, and
 * wrong for most: a fish farmer with no cattle was offered "what is today's
 * cattle price", and in আশ্বিন everyone was asked "what should I plant this
 * season" when the aman is already standing in the field.
 *
 * Two layers, and the cheap one carries most of the value:
 *
 *   1. **Derived** — built from her own `user_interests` and farm record, with
 *      **no model call**. Instant, free, available on her first ever launch,
 *      and already far better than four fixed strings.
 *   2. **Generated** — one model request a week per farmer, which reads the
 *      same facts plus the Bengali month and writes four questions in her
 *      register. Cached for the week, because the app opens many times more
 *      often than it is used and spending a request per launch would burn the
 *      day's allowance on questions nobody asked.
 *
 * If generation is switched off, fails, or has not run yet, layer 1 is what she
 * sees. There is no state in which she gets nothing.
 */

type Row = Record<string, unknown>;

export type Starter = { text: string; icon: string };

/** The icons the app already has art for. */
type Icon = "weather" | "photo" | "market" | "crop" | "livestock" | "fish" | "money" | "learn";

const FALLBACK: Starter[] = [
  { text: "আজ কি বৃষ্টি হবে?", icon: "weather" },
  { text: "গাছের অসুখ দেখাতে চাই", icon: "photo" },
  { text: "আজকের বাজারদর কত?", icon: "market" },
  { text: "এখন কী কাজ করতে হবে?", icon: "crop" }
];

/** ISO-ish week key, e.g. 2026-W38. Stable across a timezone, good enough. */
export function currentWeek(at = new Date()): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------------------
   What we know about her
   --------------------------------------------------------------------------- */

type Facts = {
  interests: Array<{ slug: string; name_bn: string }>;
  primaryFocus: string | null;
  cropTypes: string | null;
  livestock: number;
  ponds: number;
  landDecimals: number;
  district: string | null;
};

async function factsFor(userId: string): Promise<Facts> {
  const [interests, farmRows, profileRows] = await Promise.all([
    queryRows<Row>(
      `SELECT c.slug, c.name_bn
         FROM user_interests i
         JOIN interest_categories c ON c.id = i.interest_category_id
        WHERE i.user_id = ? AND c.is_active = 1
        ORDER BY c.sort_order, c.id
        LIMIT 8`,
      [userId]
    ),
    queryRows<Row>(
      `SELECT primary_focus, crop_types, livestock_count, pond_count, total_land_decimals
         FROM app_user_farm WHERE user_id = ? LIMIT 1`,
      [userId]
    ),
    queryRows<Row>(
      `SELECT d.name_bn AS district
         FROM app_users u LEFT JOIN geo_districts d ON d.id = u.district_id
        WHERE u.id = ? LIMIT 1`,
      [userId]
    )
  ]);

  const farm = farmRows[0] ?? {};
  return {
    interests: interests.map((r) => ({ slug: String(r.slug), name_bn: String(r.name_bn ?? "") })),
    primaryFocus: farm.primary_focus ? String(farm.primary_focus) : null,
    cropTypes: farm.crop_types ? String(farm.crop_types) : null,
    livestock: Number(farm.livestock_count ?? 0),
    ponds: Number(farm.pond_count ?? 0),
    landDecimals: Number(farm.total_land_decimals ?? 0),
    district: profileRows[0]?.district ? String(profileRows[0].district) : null
  };
}

/* ---------------------------------------------------------------------------
   Layer 1 — derived, free, always available
   --------------------------------------------------------------------------- */

/**
 * Four questions from her own record, with no model call.
 *
 * Deliberately conservative: each line is a question this platform can actually
 * answer well, and none of them names a crop or an animal she has not told us
 * she has. A wrong-but-specific suggestion ("your goats") is worse than a
 * general one, because it says we were not listening.
 */
export function derivedStarters(facts: Facts): Starter[] {
  const slugs = new Set(facts.interests.map((i) => i.slug));
  const out: Starter[] = [];
  const push = (text: string, icon: Icon) => {
    if (out.length < 4 && !out.some((s) => s.text === text)) out.push({ text, icon });
  };

  // Weather is first for everyone who grows or keeps anything: it is the
  // question most asked and the one we answer best.
  const season = bengaliDate(new Date());
  push("আজ কি বৃষ্টি হবে?", "weather");

  if (slugs.has("livestock-poultry") || facts.livestock > 0) {
    push("গরু-ছাগলের অসুখ দেখাতে চাই", "photo");
    push("আজকের গরুর দাম কত?", "market");
  }
  if (slugs.has("crops") || facts.cropTypes) {
    push(`${season.month} মাসে কী কাজ করতে হবে?`, "crop");
    push("ফসলের পাতায় দাগ — কী করব?", "photo");
  }
  if (slugs.has("fishery") || facts.ponds > 0) {
    push("পুকুরের মাছ মরছে কেন?", "fish");
  }
  if (slugs.has("finance") || slugs.has("loan")) {
    push("আমি কত টাকা ঋণ পেতে পারি?", "money");
  }
  if (slugs.has("training") || slugs.has("learning")) {
    push("আমার জন্য কোন প্রশিক্ষণ ভালো?", "learn");
  }

  // Anything still empty falls back to the general set rather than to nothing.
  for (const f of FALLBACK) push(f.text, f.icon as Icon);
  return out.slice(0, 4);
}

/* ---------------------------------------------------------------------------
   Layer 2 — generated, once a week
   --------------------------------------------------------------------------- */

const INSTRUCTION = [
  "You write the four opening suggestions on a Bangladeshi farming assistant's empty chat screen.",
  "",
  "The farmer is a smallholder in Bangladesh. She may read Bangla slowly. She taps one of these",
  "instead of typing, so each must be a complete question she would actually ask out loud.",
  "",
  "RULES",
  "1. Bangla only. No English words, no transliteration, no Latin digits.",
  "2. Each question at most 8 words. They are chips on a small screen.",
  "3. Only about what she told us she does. Never mention an animal or a crop that is not in her",
  "   facts below — suggesting 'your goats' to someone with no goats says we were not listening.",
  "4. Fit the Bengali month given. Do not ask what to plant in a month when the crop is already",
  "   standing.",
  "5. One of the four should be something a photograph answers, if she keeps animals or grows crops.",
  "6. No greetings, no pleasantries, no 'how can I help'. Four questions, nothing else.",
  "",
  'Reply with JSON only: {"starters":[{"text":"...","icon":"weather|photo|market|crop|livestock|fish|money|learn"}]}'
].join("\n");

async function generate(facts: Facts, models: string[]): Promise<{ starters: Starter[]; model: string } | null> {
  const season = bengaliDate(new Date());
  const basis = [
    `Bengali month: ${season.month} (${season.seasonNote}).`,
    facts.district ? `District: ${facts.district}.` : "",
    facts.interests.length ? `Interests: ${facts.interests.map((i) => i.name_bn).join(", ")}.` : "",
    facts.primaryFocus ? `Primary focus: ${facts.primaryFocus}.` : "",
    facts.cropTypes ? `Crops: ${facts.cropTypes}.` : "",
    facts.livestock ? `Livestock: ${facts.livestock}.` : "",
    facts.ponds ? `Ponds: ${facts.ponds}.` : "",
    facts.landDecimals ? `Land: ${facts.landDecimals} decimals.` : ""
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const attempt = await runWithChain<Starter[]>({
      job: "classify",
      chain: models,
      call: async (model) => {
        const res = await genai().models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: `FACTS\n${basis}` }] }],
          config: {
            systemInstruction: INSTRUCTION,
            temperature: 0.7,
            maxOutputTokens: 300,
            responseMimeType: "application/json",
            ...thinkingFor(model)
          } as never
        });
        const parsed = parseJson<{ starters?: Array<{ text?: unknown; icon?: unknown }> }>(res.text ?? "", {});
        const clean = (parsed.starters ?? [])
          .map((s) => ({ text: String(s.text ?? "").trim(), icon: String(s.icon ?? "crop") }))
          // Bangla only, and short. A chip that overflows is worse than a
          // generic one, and a Latin word in it means the rules were ignored.
          .filter((s) => s.text.length >= 6 && s.text.length <= 60 && /[ঀ-৿]/.test(s.text))
          .filter((s) => !/[A-Za-z0-9]/.test(s.text))
          .slice(0, 4);
        if (clean.length < 3) throw new Error(`only ${clean.length} usable starters came back`);
        return { value: clean, usage: usageOf(res) };
      }
    });
    return { starters: attempt.result, model: attempt.model };
  } catch (error) {
    // Never fatal: the derived set is already good, and an empty chat screen is
    // not worth failing an entitlement read over.
    console.error("apa starter generation failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/* ---------------------------------------------------------------------------
   What the endpoint calls
   --------------------------------------------------------------------------- */

/**
 * Her four opening questions.
 *
 * Returns immediately with whatever is best available and never throws. The
 * generated set is written for the week on first use; every later open that
 * week is a single indexed read.
 */
export async function startersFor(userId: string | null | undefined): Promise<Starter[]> {
  if (!userId) return FALLBACK;
  try {
    const week = currentWeek();
    const [cached] = await queryRows<Row>(
      "SELECT starters_json FROM apa_starters WHERE user_id = ? AND for_week = ? LIMIT 1",
      [userId, week]
    );
    if (cached?.starters_json) {
      const held = typeof cached.starters_json === "string"
        ? (JSON.parse(cached.starters_json) as Starter[])
        : (cached.starters_json as Starter[]);
      if (Array.isArray(held) && held.length) return held.slice(0, 4);
    }

    const facts = await factsFor(String(userId));
    const derived = derivedStarters(facts);

    const cfg = await apaConfig();
    const mayGenerate = await getBoolSetting("apa_starters_ai", true);
    if (!mayGenerate) {
      await remember(String(userId), week, derived, "derived", facts);
      return derived;
    }

    const made = await generate(facts, cfg.models.classify);
    const chosen = made?.starters?.length ? made.starters : derived;
    await remember(String(userId), week, chosen, made?.model ?? "derived", facts);
    return chosen;
  } catch (error) {
    console.error("apa starters failed", error instanceof Error ? error.message : error);
    return FALLBACK;
  }
}

async function remember(
  userId: string,
  week: string,
  starters: Starter[],
  model: string,
  facts: Facts
): Promise<void> {
  try {
    const basis = [
      facts.interests.map((i) => i.slug).join(","),
      facts.cropTypes ?? "",
      facts.livestock ? `livestock:${facts.livestock}` : "",
      facts.ponds ? `ponds:${facts.ponds}` : ""
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 500);
    await executeQuery(
      `INSERT INTO apa_starters (user_id, for_week, starters_json, model, basis)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE starters_json = VALUES(starters_json), model = VALUES(model)`,
      [userId, week, JSON.stringify(starters), model.slice(0, 80), basis]
    );
  } catch (error) {
    // A cache that cannot be written is a slower screen, not a broken one.
    console.error("apa starter cache write failed", error instanceof Error ? error.message : error);
  }
}
