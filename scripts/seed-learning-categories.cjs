// Applies migration 015 + seeds 6 new learning categories (beyond agriculture)
// with a module and dummy article + quiz content each. Idempotent by slug.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const DB = { ...require("./_dbconfig.cjs"), multipleStatements: true };

const categories = [
  {
    slug: "disaster-management", emoji: "🌀", section: "social",
    name_en: "Disaster Management", name_bn: "দুর্যোগ ব্যবস্থাপনা",
    desc_en: "Prepare for floods, cyclones and emergencies to protect family, livestock and crops.",
    desc_bn: "পরিবার, পশু ও ফসল রক্ষায় বন্যা, ঘূর্ণিঝড় ও জরুরি অবস্থার প্রস্তুতি।",
    module_en: "Flood & Cyclone Preparedness", module_bn: "বন্যা ও ঘূর্ণিঝড় প্রস্তুতি",
    article_en: "## Before a disaster\n\nKeep an emergency kit (dry food, water, torch, papers). Know your nearest shelter and the early-warning signals.\n\n## During a flood\n\nMove livestock to high ground early. Switch off electricity. Do not cross fast-moving water.\n\n## After\n\nBoil water before drinking. Check animals for injury and disease.",
    article_bn: "## দুর্যোগের আগে\n\nজরুরি কিট রাখুন (শুকনো খাবার, পানি, টর্চ, কাগজপত্র)। নিকটস্থ আশ্রয়কেন্দ্র ও আগাম সতর্কসংকেত জানুন।\n\n## বন্যার সময়\n\nপশু আগেভাগে উঁচু জায়গায় নিন। বিদ্যুৎ বন্ধ করুন। দ্রুত স্রোতে নামবেন না।\n\n## পরে\n\nপানি ফুটিয়ে পান করুন। পশুর আঘাত ও রোগ পরীক্ষা করুন।",
    quiz: [
      { q: "Where should livestock go before a flood?", q_bn: "বন্যার আগে পশু কোথায় নেবেন?", options: ["High ground", "Near the river", "Inside the house"], options_bn: ["উঁচু জায়গায়", "নদীর কাছে", "ঘরের ভেতরে"], answer: 0 },
      { q: "What should you do with drinking water after a flood?", q_bn: "বন্যার পরে পানি নিয়ে কী করবেন?", options: ["Drink directly", "Boil it first", "Add sugar"], options_bn: ["সরাসরি পান", "আগে ফোটান", "চিনি মেশান"], answer: 1 },
    ],
  },
  {
    slug: "disability-training", emoji: "♿", section: "social",
    name_en: "Disability & Inclusion", name_bn: "প্রতিবন্ধী ও অন্তর্ভুক্তি",
    desc_en: "Basic sign language, support for visually impaired, and inclusive farming practices.",
    desc_bn: "মৌলিক সাইন ল্যাঙ্গুয়েজ, দৃষ্টিপ্রতিবন্ধীদের সহায়তা ও অন্তর্ভুক্তিমূলক চাষ।",
    module_en: "Basic Sign Language & Vision Support", module_bn: "মৌলিক সাইন ল্যাঙ্গুয়েজ ও দৃষ্টি সহায়তা",
    article_en: "## Communicating with the deaf\n\nLearn common signs: hello, water, food, help, doctor. Face the person, keep hands visible, be patient.\n\n## Supporting the blind\n\nDescribe surroundings, offer your arm to guide, keep tools in fixed places. Use texture and sound cues on the farm.",
    article_bn: "## বধির ব্যক্তির সাথে যোগাযোগ\n\nপ্রচলিত সাইন শিখুন: হ্যালো, পানি, খাবার, সাহায্য, ডাক্তার। মুখোমুখি দাঁড়ান, হাত দৃশ্যমান রাখুন, ধৈর্য ধরুন।\n\n## দৃষ্টিপ্রতিবন্ধীকে সহায়তা\n\nচারপাশ বর্ণনা করুন, পথ দেখাতে হাত ধরতে দিন, যন্ত্রপাতি নির্দিষ্ট জায়গায় রাখুন। খামারে স্পর্শ ও শব্দ সংকেত ব্যবহার করুন।",
    quiz: [
      { q: "When signing, your hands should be…", q_bn: "সাইন করার সময় হাত থাকা উচিত…", options: ["Hidden", "Visible to the person", "In pockets"], options_bn: ["লুকানো", "ব্যক্তির কাছে দৃশ্যমান", "পকেটে"], answer: 1 },
      { q: "To guide a blind person you…", q_bn: "দৃষ্টিপ্রতিবন্ধীকে পথ দেখাতে…", options: ["Push them", "Offer your arm", "Walk away"], options_bn: ["ধাক্কা দিন", "হাত ধরতে দিন", "চলে যান"], answer: 1 },
    ],
  },
  {
    slug: "business-101", emoji: "💼", section: "livelihood",
    name_en: "Business Basics 101", name_bn: "ব্যবসা শিক্ষা ১০১",
    desc_en: "Simple accounting, pricing, savings and profit for farmer-run businesses.",
    desc_bn: "কৃষক-পরিচালিত ব্যবসার সহজ হিসাব, মূল্য নির্ধারণ, সঞ্চয় ও মুনাফা।",
    module_en: "Farm Business Accounting & Profit", module_bn: "খামার ব্যবসার হিসাব ও মুনাফা",
    article_en: "## Know your numbers\n\nProfit = Income − Cost. Write every cost (feed, labour, transport) and every sale in a notebook.\n\n## Price right\n\nAdd a margin over your cost; check the market rate. Keep some savings for the next cycle and emergencies.",
    article_bn: "## হিসাব জানুন\n\nমুনাফা = আয় − খরচ। প্রতিটি খরচ (খাদ্য, শ্রম, পরিবহন) ও প্রতিটি বিক্রি খাতায় লিখুন।\n\n## সঠিক মূল্য\n\nখরচের ওপর মার্জিন যোগ করুন; বাজারদর দেখুন। পরবর্তী চক্র ও জরুরি প্রয়োজনে কিছু সঞ্চয় রাখুন।",
    quiz: [
      { q: "Profit equals…", q_bn: "মুনাফা সমান…", options: ["Income + Cost", "Income − Cost", "Cost − Income"], options_bn: ["আয় + খরচ", "আয় − খরচ", "খরচ − আয়"], answer: 1 },
      { q: "Why keep savings?", q_bn: "সঞ্চয় কেন রাখবেন?", options: ["No reason", "Next cycle & emergencies", "To spend now"], options_bn: ["কারণ নেই", "পরের চক্র ও জরুরি", "এখনই খরচ"], answer: 1 },
    ],
  },
  {
    slug: "handicrafts", emoji: "🧶", section: "livelihood",
    name_en: "Handicrafts", name_bn: "হস্তশিল্প",
    desc_en: "Earn extra income with bamboo, cane, jute and clay handicrafts.",
    desc_bn: "বাঁশ, বেত, পাট ও মাটির হস্তশিল্পে বাড়তি আয়।",
    module_en: "Bamboo & Cane Handicrafts", module_bn: "বাঁশ ও বেতের হস্তশিল্প",
    article_en: "## Start small\n\nMake baskets, trays and stools from local bamboo. Cure bamboo to prevent insects.\n\n## Sell smart\n\nGood finishing sells better. Take photos, sell at local fairs and online groups.",
    article_bn: "## ছোট থেকে শুরু\n\nস্থানীয় বাঁশ দিয়ে ঝুড়ি, ট্রে ও টুল বানান। পোকা ঠেকাতে বাঁশ শোধন করুন।\n\n## বুদ্ধিমানের মতো বিক্রি\n\nভালো ফিনিশিং বেশি বিক্রি হয়। ছবি তুলুন, স্থানীয় মেলা ও অনলাইন গ্রুপে বিক্রি করুন।",
    quiz: [
      { q: "Why cure bamboo?", q_bn: "বাঁশ শোধন কেন?", options: ["For colour", "To prevent insects", "To make it heavy"], options_bn: ["রঙের জন্য", "পোকা ঠেকাতে", "ভারী করতে"], answer: 1 },
    ],
  },
  {
    slug: "artisanal", emoji: "🪡", section: "livelihood",
    name_en: "Artisanal Skills", name_bn: "কারুশিল্প ও সেলাই",
    desc_en: "Sewing, tailoring, embroidery and simple design to start a home business.",
    desc_bn: "ঘরে ব্যবসা শুরু করতে সেলাই, দর্জি, এমব্রয়ডারি ও সহজ ডিজাইন।",
    module_en: "Getting Started with Sewing & Design", module_bn: "সেলাই ও পোশাক ডিজাইন শুরু",
    article_en: "## Tools & basics\n\nLearn straight, curved and hem stitches. Measure twice, cut once.\n\n## Add value\n\nSimple embroidery and good fitting raise the price. Take custom orders from neighbours.",
    article_bn: "## যন্ত্র ও মৌলিক\n\nসোজা, বাঁকা ও হেম সেলাই শিখুন। দুইবার মাপুন, একবার কাটুন।\n\n## মূল্য বাড়ান\n\nসহজ এমব্রয়ডারি ও ভালো ফিটিং দাম বাড়ায়। প্রতিবেশীদের কাছ থেকে অর্ডার নিন।",
    quiz: [
      { q: "Good cutting rule?", q_bn: "ভালো কাটার নিয়ম?", options: ["Cut first", "Measure twice, cut once", "Guess it"], options_bn: ["আগে কাটুন", "দুইবার মাপুন একবার কাটুন", "আন্দাজে"], answer: 1 },
    ],
  },
  {
    slug: "climate-resilience", emoji: "🌍", section: "climate",
    name_en: "Climate Resilience", name_bn: "জলবায়ু সহনশীলতা",
    desc_en: "Adapt to drought, salinity, heat and erratic rain with resilient practices.",
    desc_bn: "খরা, লবণাক্ততা, তাপ ও অনিয়মিত বৃষ্টিতে মানিয়ে নিতে সহনশীল কৌশল।",
    module_en: "Coping with Drought & Salinity", module_bn: "খরা ও লবণাক্ততা মোকাবিলা",
    article_en: "## Save water\n\nMulch the soil, use drip irrigation, harvest rainwater in ponds.\n\n## Choose smart crops\n\nUse drought- and salt-tolerant varieties. Diversify so one failure does not ruin the season.",
    article_bn: "## পানি সাশ্রয়\n\nমাটিতে মালচ দিন, ড্রিপ সেচ ব্যবহার করুন, পুকুরে বৃষ্টির পানি ধরে রাখুন।\n\n## বুদ্ধিমান ফসল\n\nখরা ও লবণসহিষ্ণু জাত ব্যবহার করুন। বৈচিত্র্য আনুন যাতে একটির ক্ষতি পুরো মৌসুম নষ্ট না করে।",
    quiz: [
      { q: "Which saves water?", q_bn: "কোনটি পানি বাঁচায়?", options: ["Flood irrigation", "Drip irrigation", "No mulch"], options_bn: ["প্লাবন সেচ", "ড্রিপ সেচ", "মালচ নেই"], answer: 1 },
      { q: "Why diversify crops?", q_bn: "ফসল বৈচিত্র্য কেন?", options: ["Looks nice", "One failure won't ruin the season", "Costs more"], options_bn: ["দেখতে সুন্দর", "একটির ক্ষতি মৌসুম নষ্ট করবে না", "খরচ বাড়ে"], answer: 1 },
    ],
  },
];

(async () => {
  const root = path.resolve(__dirname, "..");
  const c = await mysql.createConnection(DB);
  await c.query(fs.readFileSync(path.join(root, "database/migrations/015_learning_sections.sql"), "utf8"));

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const [rows] = await c.query("SELECT id FROM learning_categories WHERE slug = ?", [cat.slug]);
    let catId;
    if (rows.length) {
      catId = rows[0].id;
      await c.query("UPDATE learning_categories SET name_en=?, name_bn=?, emoji=?, section=?, description_en=?, description_bn=?, is_active=1, sort_order=? WHERE id=?",
        [cat.name_en, cat.name_bn, cat.emoji, cat.section, cat.desc_en, cat.desc_bn, 10 + i, catId]);
    } else {
      const [r] = await c.query("INSERT INTO learning_categories (slug, name_en, name_bn, emoji, section, description_en, description_bn, sort_order, is_active) VALUES (?,?,?,?,?,?,?,?,1)",
        [cat.slug, cat.name_en, cat.name_bn, cat.emoji, cat.section, cat.desc_en, cat.desc_bn, 10 + i]);
      catId = r.insertId;
    }

    const [mod] = await c.query("SELECT id FROM learning_modules WHERE learning_category_id=? AND title_en=?", [catId, cat.module_en]);
    let modId;
    if (mod.length) {
      modId = mod[0].id;
      await c.query("UPDATE learning_modules SET title_bn=?, level=1, status='published', emoji=? WHERE id=?", [cat.module_bn, cat.emoji, modId]);
    } else {
      const [r] = await c.query("INSERT INTO learning_modules (learning_category_id, title_en, title_bn, level, emoji, sort_order, status) VALUES (?,?,?,1,?,1,'published')",
        [catId, cat.module_en, cat.module_bn, cat.emoji]);
      modId = r.insertId;
    }

    const artTitleEn = cat.module_en + " — Guide";
    const [art] = await c.query("SELECT id FROM learning_contents WHERE learning_module_id=? AND content_type='article' AND quiz_json IS NULL", [modId]);
    if (art.length) {
      await c.query("UPDATE learning_contents SET title_en=?, title_bn=?, body_en=?, body_bn=?, points=10, status='published' WHERE id=?",
        [artTitleEn, cat.module_bn + " — গাইড", cat.article_en, cat.article_bn, art[0].id]);
    } else {
      await c.query("INSERT INTO learning_contents (learning_module_id, content_type, title_en, title_bn, body_en, body_bn, points, sort_order, status) VALUES (?,?,?,?,?,?,10,1,'published')",
        [modId, "article", artTitleEn, cat.module_bn + " — গাইড", cat.article_en, cat.article_bn]);
    }

    const quizJson = JSON.stringify(cat.quiz.map((qz) => ({ q: qz.q, q_bn: qz.q_bn, options: qz.options, options_bn: qz.options_bn, answer: qz.answer })));
    const [qz] = await c.query("SELECT id FROM learning_contents WHERE learning_module_id=? AND quiz_json IS NOT NULL", [modId]);
    if (qz.length) {
      await c.query("UPDATE learning_contents SET title_en=?, title_bn=?, body_en=?, body_bn=?, quiz_json=?, points=15, status='published' WHERE id=?",
        ["Quick quiz", "ছোট কুইজ", "Test what you learned.", "যা শিখলেন তা যাচাই করুন।", quizJson, qz[0].id]);
    } else {
      await c.query("INSERT INTO learning_contents (learning_module_id, content_type, title_en, title_bn, body_en, body_bn, quiz_json, points, sort_order, status) VALUES (?,?,?,?,?,?,?,15,2,'published')",
        [modId, "article", "Quick quiz", "ছোট কুইজ", "Test what you learned.", "যা শিখলেন তা যাচাই করুন।", quizJson]);
    }
  }

  const [cats] = await c.query("SELECT section, COUNT(*) n FROM learning_categories WHERE is_active=1 GROUP BY section");
  console.log("sections:", JSON.stringify(cats));
  const [tot] = await c.query("SELECT (SELECT COUNT(*) FROM learning_categories WHERE is_active=1) cats, (SELECT COUNT(*) FROM learning_modules WHERE status='published') mods, (SELECT COUNT(*) FROM learning_contents WHERE status='published') contents");
  console.log("totals:", JSON.stringify(tot[0]));
  await c.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
