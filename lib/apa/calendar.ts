/**
 * Today's date, in the form a Bangladeshi farmer thinks in.
 *
 * This exists because of a measured error. Asked what to plant, the model
 * announced it was আষাঢ় when it was in fact আশ্বিন — wrong by three months, in
 * an assistant whose central job is telling farmers when to sow and when to
 * harvest. It was not hallucinating wildly; it simply had no idea what day it
 * was, because nothing told it. So the date goes into every question's context
 * block, and the instruction forbids the model from naming a month unless the
 * context block supplied one.
 *
 * Month boundaries follow the Bangladesh calendar as revised in 2019, where
 * ১ বৈশাখ is fixed to 14 April. Day-of-month is derived from the boundary rather
 * than from the reform's month-length table: the agronomic advice turns on the
 * month and the season, and a boundary table cannot be subtly wrong in a way
 * that matters, whereas a hand-copied length table can.
 */

type MonthSpan = {
  /** Gregorian month (1-12) and day the Bengali month begins. */
  from: [number, number];
  bengali: string;
  latin: string;
  season: "গ্রীষ্ম" | "বর্ষা" | "শরৎ" | "হেমন্ত" | "শীত" | "বসন্ত";
  /** What a farmer is actually doing, for the model's orientation. */
  note: string;
};

// Ordered by Gregorian start date within the year, beginning 14 April.
const MONTHS: MonthSpan[] = [
  { from: [4, 14], bengali: "বৈশাখ", latin: "Boishakh", season: "গ্রীষ্ম",
    note: "pre-monsoon Kharif-1; Boro harvest finishing, Aus land preparation, nor'wester storms" },
  { from: [5, 15], bengali: "জ্যৈষ্ঠ", latin: "Joishtho", season: "গ্রীষ্ম",
    note: "hot and dry; Aus sowing, jute growing, mango and litchi harvest" },
  { from: [6, 15], bengali: "আষাঢ়", latin: "Ashar", season: "বর্ষা",
    note: "monsoon arrives; Aman seedbeds, jute retting, flood risk begins" },
  { from: [7, 16], bengali: "শ্রাবণ", latin: "Srabon", season: "বর্ষা",
    note: "heaviest rain; Aman transplanting, waterlogging and flood risk at its highest" },
  { from: [8, 16], bengali: "ভাদ্র", latin: "Bhadro", season: "শরৎ",
    note: "late monsoon; Aman growing, Aus harvest, Rabi planning starts" },
  { from: [9, 16], bengali: "আশ্বিন", latin: "Ashwin", season: "শরৎ",
    note: "end of Kharif-2; Aman standing in the field, Rabi preparation — land, seed and mustard timing" },
  { from: [10, 17], bengali: "কার্তিক", latin: "Kartik", season: "হেমন্ত",
    note: "Aman maturing; mustard and lentil sowing, the lean season in the north" },
  { from: [11, 16], bengali: "অগ্রহায়ণ", latin: "Ogrohayon", season: "হেমন্ত",
    note: "Aman harvest — the main rice harvest of the year; wheat and potato planting" },
  { from: [12, 16], bengali: "পৌষ", latin: "Poush", season: "শীত",
    note: "cold and dry Rabi season; Boro seedbeds, potato and vegetable growing, fog damage risk" },
  { from: [1, 15], bengali: "মাঘ", latin: "Magh", season: "শীত",
    note: "coldest weeks; Boro transplanting, mustard harvest, irrigation begins in earnest" },
  { from: [2, 13], bengali: "ফাল্গুন", latin: "Falgun", season: "বসন্ত",
    note: "warming; Boro growing and needing water, potato and lentil harvest" },
  { from: [3, 15], bengali: "চৈত্র", latin: "Choitro", season: "বসন্ত",
    note: "hot and dry; Boro heading and most thirsty, hailstorm risk, jute sowing" }
];

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bn = (value: number | string) => String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);

export type BengaliDate = {
  /** "18 September 2026" */
  gregorian: string;
  /** "৪ আশ্বিন ১৪৩৩" */
  bengali: string;
  month: string;
  monthLatin: string;
  season: string;
  seasonNote: string;
};

export function bengaliDate(at: Date = new Date()): BengaliDate {
  // Build every month boundary in a window either side of today and take the
  // latest one that has already started.
  //
  // The first version walked the array picking the last match, which was wrong
  // at exactly the date that matters most: the array runs April to March, so a
  // Choitro span starting 15 March matched "on or after" for 14 April and
  // overwrote Boishakh. 14 April came out as ৩১ চৈত্র instead of ১ বৈশাখ — the
  // Bengali New Year, read wrong. Enumerating real dates removes the class of
  // bug rather than patching this instance of it.
  const year = at.getFullYear();
  const candidates: Array<{ start: Date; span: MonthSpan; bengaliYear: number }> = [];

  for (const offset of [-1, 0]) {
    // One Bengali year begins on 14 April of `year + offset`.
    const cycleYear = year + offset;
    for (const span of MONTHS) {
      const [fm, fd] = span.from;
      // Boishakh to Choitro: months starting in April or later belong to the
      // cycle's own Gregorian year, January to March fall into the next one.
      const gregorianYear = fm >= 4 ? cycleYear : cycleYear + 1;
      candidates.push({
        start: new Date(gregorianYear, fm - 1, fd),
        span,
        bengaliYear: cycleYear - 593
      });
    }
  }

  candidates.sort((a, b) => a.start.getTime() - b.start.getTime());
  const midnight = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  let current = candidates[0];
  for (const candidate of candidates) {
    if (candidate.start.getTime() <= midnight.getTime()) current = candidate;
    else break;
  }

  const dayOfMonth = Math.floor((midnight.getTime() - current.start.getTime()) / 86_400_000) + 1;

  return {
    gregorian: at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    bengali: `${bn(dayOfMonth)} ${current.span.bengali} ${bn(current.bengaliYear)}`,
    month: current.span.bengali,
    monthLatin: current.span.latin,
    season: current.span.season,
    seasonNote: current.span.note
  };
}
