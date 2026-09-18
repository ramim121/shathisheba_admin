// Seeds the community feed with posts at every geographic scope, so the feed
// visibly changes as a farmer's profile area changes.
//
// Why this exists: the feed filter matches a post's division/district/upazila
// ids against the reader's, treating NULL as "everywhere" (lib/geo-scope.ts).
// Before migration 040, most posts carried location as text with no ids, so
// every post was national and the area logic could not be seen working at all.
//
// The set below is deliberately spread:
//   bangladesh  — everyone, everywhere
//   division    — Rajshahi only
//   district    — Natore only
//   upazila     — Lalpur only
//   elsewhere   — Khulna/Dumuria and Mymensingh, which Ramim should NOT see
//
// Switch the reference farmer's district or upazila (Users -> edit profile) and
// the feed changes accordingly. The depth that counts is the
// `geo_scope.community_posts` platform switch: at "district" the upazila is
// ignored, at "upazila" the upazila posts separate too.
//
// Idempotent: every row it writes is tagged source_type='seed', and a re-run
// deletes those and writes them again. Nothing else is touched.
//
// Usage (from the project root):  node scripts/seed-community-posts.cjs

const mysql = require("mysql2/promise");
const cfg = require("./_dbconfig.cjs");

const SEED_TAG = "seed";
const SEED_BATCH = "community-demo-v1";

// Uploaded to the platform's own media bucket by scripts/../api/upload.
const IMG = {
  cow: "https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/community/1789706503754-d3a89dba0d11.png",
  mango: "https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/community/1789706507260-83ecfa2b1b54.png",
  market: "https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/community/1789706508805-621995bc0585.png",
  tractor: "https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/community/1789706510219-48a20fa873f7.png",
  shrimp: "https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/community/1789706511846-fd05fb0e33d8.png"
};

/**
 * scope     — what the app calls the reach of the post
 * where     — resolved to ids; omit a level to leave it NULL (= wider reach)
 * days      — how long ago it was posted, so the feed has a sensible order
 */
const POSTS = [
  // ---- national -----------------------------------------------------------
  {
    scope: "bangladesh",
    type: "notice",
    official: true,
    days: 1,
    body:
      "শাথী সেবায় নতুন সুবিধা: ফাইন্যান্স রেডিনেস চেক। ২০টি প্রশ্নের উত্তর দিলে আপনি জানতে পারবেন ঋণের জন্য আপনি কতটা প্রস্তুত, আর কী ঠিক করলে সুযোগ বাড়বে। অ্যাপের ফাইন্যান্স ট্যাব থেকে শুরু করুন।"
  },
  {
    scope: "bangladesh",
    type: "tip",
    days: 3,
    body:
      "বর্ষায় ধান সংরক্ষণের ৩টি নিয়ম: ১) আগে ভালো করে রোদে শুকান, আর্দ্রতা ১৪%-এর নিচে নামান। ২) চটের বস্তা মাটিতে নয়, কাঠের পাটাতনে রাখুন। ৩) গুদামে বাতাস চলাচলের ব্যবস্থা রাখুন — না হলে ছত্রাক ধরবে।"
  },
  {
    scope: "bangladesh",
    type: "question",
    days: 5,
    body:
      "Has anyone used the new readiness check before applying for a loan? Did the grade change anything for you? I got a C and it listed three gaps I can actually fix this season."
  },

  // ---- Rajshahi division --------------------------------------------------
  {
    scope: "division",
    where: { division: "Rajshahi" },
    type: "tip",
    days: 2,
    image: IMG.mango,
    body:
      "রাজশাহী অঞ্চলের আম চাষিদের জন্য: এই সপ্তাহে হপার পোকার আক্রমণ বাড়ছে। গাছের নিচে ঝরা পাতা পরিষ্কার করুন আর সন্ধ্যার আগে স্প্রে করুন। আমি গত বছর দেরি করে ফেলেছিলাম, অর্ধেক মুকুল নষ্ট হয়েছিল।"
  },
  {
    scope: "division",
    where: { division: "Rajshahi" },
    type: "notice",
    official: true,
    days: 4,
    body:
      "Livestock vaccination camp — Rajshahi division. Free FMD and anthrax vaccination for cattle and goats at all upazila livestock offices from Sunday to Thursday next week. Bring the animal's ear tag number if it has one."
  },

  // ---- Natore district ----------------------------------------------------
  {
    scope: "district",
    where: { division: "Rajshahi", district: "Natore" },
    type: "market",
    days: 1,
    image: IMG.market,
    body:
      "নাটোর বাজারে আজ বোরো ধান মণপ্রতি ১,৩৫০ টাকা পর্যন্ত গেছে। গত সপ্তাহে ছিল ১,২৮০। যাদের ধান শুকানো আছে, এই সপ্তাহেই বেচে দেওয়া ভালো হবে বলে মনে হচ্ছে।"
  },
  {
    scope: "district",
    where: { division: "Rajshahi", district: "Natore" },
    type: "question",
    days: 2,
    body:
      "নাটোরে হাঁসের খাবার (ডাক ফিড) কোথায় ভালো দামে পাওয়া যায়? ৫০ কেজির বস্তা খুঁজছি। এখন যেটা কিনছি সেটায় হাঁসের ডিম কমে গেছে মনে হচ্ছে।"
  },
  {
    scope: "district",
    where: { division: "Rajshahi", district: "Natore" },
    type: "notice",
    official: true,
    days: 6,
    body:
      "Natore cattle fair (গরুর হাট) — 12th to 14th, Natore Sadar ground. Shathi Sheba's field officers will be at the gate to help register animals for sale and to check price rules on the spot."
  },
  {
    scope: "district",
    where: { division: "Rajshahi", district: "Natore" },
    type: "alert",
    days: 3,
    body:
      "নাটোরের কয়েকটা ডিলারের কাছে টিএসপি সার শেষ হয়ে গেছে। যারা এই সপ্তাহে টপ ড্রেসিং করবেন, আগেই খোঁজ নিয়ে রাখুন। সিংড়ার দিকে পাওয়া যাচ্ছে বলে শুনলাম।"
  },

  // ---- Lalpur upazila -----------------------------------------------------
  {
    scope: "upazila",
    where: { division: "Rajshahi", district: "Natore", upazila: "Lalpur" },
    type: "notice",
    days: 1,
    image: IMG.tractor,
    body:
      "লালপুরে আমার পাওয়ার টিলার ভাড়া দেওয়া আছে। বিঘাপ্রতি ৮০০ টাকা, ডিজেল আমার। আগামী দুই সপ্তাহ ফাঁকা আছে। আগ্রহীরা কমেন্টে বলুন, আমি ফোন দেব।"
  },
  {
    scope: "upazila",
    where: { division: "Rajshahi", district: "Natore", upazila: "Lalpur" },
    type: "notice",
    official: true,
    days: 2,
    body:
      "Lalpur: the upazila veterinary officer will visit Duaria and Arbab union on Thursday morning. Free check-up for pregnant cows and calves. Ask your local Shathi Sheba officer for the exact stop times."
  },
  {
    scope: "upazila",
    where: { division: "Rajshahi", district: "Natore", upazila: "Lalpur" },
    type: "story",
    days: 2,
    image: IMG.cow,
    body:
      "আলহামদুলিল্লাহ! আমার ক্রস ফ্রিজিয়ান গাভীটা কাল রাতে বাছুর দিয়েছে — মা আর বাছুর দুটোই ভালো আছে। শাথী সেবার মাধ্যমে যে ফিডটা কিনেছিলাম, সেটাতে দুধ ভালোই বেড়েছিল। দোয়া করবেন।"
  },
  {
    scope: "upazila",
    where: { division: "Rajshahi", district: "Natore", upazila: "Lalpur" },
    type: "question",
    days: 4,
    body:
      "লালপুরে কেউ সেচ পাম্প মিস্ত্রি চেনেন? আমার ৫ হর্স পাওয়ারের পাম্প পানি তুলছে না, ফুট ভাল্ব নষ্ট হয়েছে মনে হয়। ধান শুকিয়ে যাচ্ছে, জরুরি দরকার।"
  },

  // ---- elsewhere: should NOT appear for a Natore farmer -------------------
  {
    scope: "upazila",
    where: { division: "Khulna", district: "Khulna", upazila: "Dumuria" },
    type: "tip",
    days: 2,
    image: IMG.shrimp,
    body:
      "ডুমুরিয়ায় ঘেরের পানিতে লবণাক্ততা এই মাসে বেড়ে গেছে। যাদের বাগদা আছে, ভোরে পানি পরীক্ষা করুন আর দরকার হলে মিষ্টি পানি ঢোকান। গত বছর এই সময়েই আমার অনেক পোনা মরেছিল।"
  },
  {
    scope: "district",
    where: { division: "Mymensingh", district: "Mymensingh" },
    type: "market",
    days: 3,
    body:
      "ময়মনসিংহে রুই আর তেলাপিয়ার পোনা এখন ভালো পাওয়া যাচ্ছে, হাজারপ্রতি দাম গত মাসের চেয়ে কম। যারা পুকুর প্রস্তুত করেছেন, এখনই ছাড়ার সময়।"
  },
  {
    scope: "division",
    where: { division: "Dhaka" },
    type: "tip",
    days: 5,
    body:
      "Rooftop vegetable growing in and around Dhaka: use 12-inch pots with 3 parts soil, 1 part cow dung compost and a handful of sand. Water in the evening, not at midday. Bottle gourd and spinach do best on a sunny roof."
  }
];

async function geoIds(conn, where) {
  const out = { division_id: null, district_id: null, upazila_id: null };
  if (!where) return out;
  if (where.division) {
    const [r] = await conn.query("SELECT id FROM geo_divisions WHERE name_en = ? LIMIT 1", [where.division]);
    if (!r.length) throw new Error(`No division named ${where.division}`);
    out.division_id = r[0].id;
  }
  if (where.district) {
    const [r] = await conn.query("SELECT id, division_id FROM geo_districts WHERE name_en = ? LIMIT 1", [where.district]);
    if (!r.length) throw new Error(`No district named ${where.district}`);
    out.district_id = r[0].id;
    out.division_id = out.division_id ?? r[0].division_id;
  }
  if (where.upazila) {
    const [r] = await conn.query(
      "SELECT id FROM geo_upazilas WHERE name_en = ? AND (? IS NULL OR district_id = ?) LIMIT 1",
      [where.upazila, out.district_id, out.district_id]
    );
    if (!r.length) throw new Error(`No upazila named ${where.upazila}`);
    out.upazila_id = r[0].id;
  }
  return out;
}

/** A plausible author: someone who actually lives there, else anyone active. */
async function authorFor(conn, ids, fallbacks) {
  const tries = [
    ["upazila_id", ids.upazila_id],
    ["district_id", ids.district_id],
    ["division_id", ids.division_id]
  ].filter(([, v]) => v);
  for (const [col, value] of tries) {
    const [rows] = await conn.query(
      `SELECT id FROM app_users WHERE status = 'active' AND ${col} = ? ORDER BY RAND() LIMIT 1`,
      [value]
    );
    if (rows.length) return rows[0].id;
  }
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

(async () => {
  const conn = await mysql.createConnection(cfg);
  try {
    const [[admin]] = await conn.query("SELECT id FROM admin_users WHERE is_active = 1 ORDER BY id LIMIT 1");
    const [anyUsers] = await conn.query("SELECT id FROM app_users WHERE status = 'active' ORDER BY id LIMIT 30");
    if (!anyUsers.length) throw new Error("No active app users to attribute posts to.");
    const fallbacks = anyUsers.map((u) => u.id);

    const [cleared] = await conn.execute(
      "DELETE FROM community_posts WHERE source_type = ? AND source_id = ?",
      [SEED_TAG, SEED_BATCH]
    );
    console.log(`cleared ${cleared.affectedRows} previously seeded post(s)`);

    let written = 0;
    for (const post of POSTS) {
      const ids = await geoIds(conn, post.where);
      const userId = await authorFor(conn, ids, fallbacks);
      // Names are kept alongside the ids: the app reads ids, the console and
      // the CSV export still show a district a human recognises.
      const names = {
        district: post.where?.district ?? null,
        upazila: post.where?.upazila ?? null
      };
      await conn.execute(
        `INSERT INTO community_posts
           (user_id, scope, post_type, body, image_url, is_official, district, upazila,
            status, like_count, comment_count, report_count, moderated_by, moderated_at,
            division_id, district_id, upazila_id, is_system, source_type, source_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?, 'visible', ?, ?, 0, ?, ?, ?,?,?, 0, ?, ?,
                 DATE_SUB(NOW(), INTERVAL ? DAY), DATE_SUB(NOW(), INTERVAL ? DAY))`,
        [
          userId,
          post.scope,
          post.type,
          post.body,
          post.image ?? null,
          post.official ? 1 : 0,
          names.district,
          names.upazila,
          Math.floor(Math.random() * 24) + (post.official ? 6 : 1),
          Math.floor(Math.random() * 6),
          post.official ? admin?.id ?? null : null,
          post.official ? new Date() : null,
          ids.division_id,
          ids.district_id,
          ids.upazila_id,
          SEED_TAG,
          SEED_BATCH,
          post.days,
          post.days
        ]
      );
      written += 1;
      const reach = post.where
        ? [post.where.upazila, post.where.district, post.where.division].filter(Boolean).join(", ")
        : "Bangladesh";
      console.log(`  ${post.scope.padEnd(11)} ${reach.padEnd(28)} user ${userId}${post.image ? " +image" : ""}`);
    }

    console.log(`\n${written} posts seeded.`);

    // What a farmer in the reference area will now see, at the configured depth.
    const [[scope]] = await conn.query(
      "SELECT COALESCE(value_text, 'district') AS v FROM app_settings WHERE setting_key = 'geo_scope.community_posts'"
    );
    const depth = String(scope?.v ?? "district");
    const [[ref]] = await conn.query(
      "SELECT id, full_name, division_id, district_id, upazila_id FROM app_users WHERE full_name = 'Ramim' LIMIT 1"
    );
    if (ref) {
      const levels = depth === "upazila" ? ["division", "district", "upazila"] : depth === "division" ? ["division"] : ["division", "district"];
      const where = levels.map((l) => `(p.${l}_id IS NULL OR p.${l}_id = ?)`).join(" AND ");
      const params = levels.map((l) => ref[`${l}_id`]);
      const [[seen]] = await conn.query(
        `SELECT COUNT(*) AS n FROM community_posts p
          WHERE p.status = 'visible' AND (p.scope = 'bangladesh' OR (${where}))`,
        params
      );
      const [[total]] = await conn.query("SELECT COUNT(*) AS n FROM community_posts WHERE status = 'visible'");
      console.log(
        `\nAt geo_scope.community_posts = "${depth}", ${ref.full_name} (user ${ref.id}) sees ` +
        `${seen.n} of ${total.n} visible posts. Change their district or upazila and re-run this line to watch it move.`
      );
    }
  } finally {
    await conn.end();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
