// Seeds 7 sample cattle projects (3 open-region, 4 regional) + their B2B price
// presets. Idempotent on project_code. Retires the two earlier demo projects.
const mysql = require("mysql2/promise");
const DB = require("./_dbconfig.cjs");

const STEPS = JSON.stringify({ steps: ["Project selection", "Personal KYC", "Banking info", "Farm assessment", "Field verification", "Approval"] });
const IMG = [
  "https://images.unsplash.com/photo-1605694099042-91f25b8e6c1d?w=800",
  "https://images.unsplash.com/photo-1546445317-29d45f9b5b1a?w=800",
  "https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=800",
  "https://images.unsplash.com/photo-1516467508483-a7212febe31a?w=800",
  "https://images.unsplash.com/photo-1563281577-a7be47e20db9?w=800",
  "https://images.unsplash.com/photo-1574226516831-e1dff420e562?w=800",
  "https://images.unsplash.com/photo-1597393353415-b3730f3719fe?w=800",
];

// b2b, platform, logistics, vet → net = b2b - platform - logistics - vet
const projects = [
  // ── 3 OPEN-REGION (region_based = 0) ──────────────────────────────────────
  { code: "PRJ-CTL-01", name_en: "National Eid Cattle Fattening 2026", name_bn: "জাতীয় ঈদ গরু মোটাতাজাকরণ ২০২৬",
    region_based: 0, division: null, district: null, upazila: null, status: "open", capacity: 200, invest: 150000, months: 4, duration: "4 months",
    lender: "DigiGram Ventures", b2b: 750, platform: 50, logistics: 15, vet: 15,
    summary_en: "Cattle fattening for Eid with guaranteed buy-back at the approved B2B rate.", summary_bn: "ঈদ উপলক্ষে গরু মোটাতাজাকরণ — অনুমোদিত দরে নিশ্চিত ক্রয়।",
    market_en: "Strong nationwide Eid demand; live cattle averaging Tk 750/kg B2B with secured offtake.", market_bn: "সারাদেশে ঈদে চাহিদা বেশি; জীবন্ত গরু গড়ে ৭৫০ টাকা/কেজি, নিশ্চিত ক্রয়।" },
  { code: "PRJ-CTL-02", name_en: "Premium Beef Supply (Year-round)", name_bn: "প্রিমিয়াম বিফ সরবরাহ (সারা বছর)",
    region_based: 0, division: null, district: null, upazila: null, status: "open", capacity: 120, invest: 200000, months: 6, duration: "6 months",
    lender: "City Bank Agri", b2b: 820, platform: 55, logistics: 20, vet: 20,
    summary_en: "Year-round premium beef line for hotels and processors at a higher B2B rate.", summary_bn: "হোটেল ও প্রসেসরের জন্য সারা বছর প্রিমিয়াম বিফ, উচ্চ দরে।",
    market_en: "Premium grade buyers pay Tk 820/kg; steady demand outside Eid season too.", market_bn: "প্রিমিয়াম ক্রেতারা ৮২০ টাকা/কেজি দেয়; ঈদের বাইরেও চাহিদা স্থির।" },
  { code: "PRJ-CTL-03", name_en: "Dairy Bull Buyback Program", name_bn: "ডেইরি বুল বাইব্যাক প্রোগ্রাম",
    region_based: 0, division: null, district: null, upazila: null, status: "opening_soon", capacity: 150, invest: 90000, months: 3, duration: "3 months",
    lender: "BRAC Bank", b2b: 700, platform: 45, logistics: 18, vet: 12,
    summary_en: "Short-cycle buyback of surplus dairy bulls across the country.", summary_bn: "সারাদেশে উদ্বৃত্ত ডেইরি বলদের স্বল্পমেয়াদি ক্রয়।",
    market_en: "Quick 3-month turnaround; Tk 700/kg B2B with lower holding cost.", market_bn: "দ্রুত ৩ মাসের চক্র; ৭০০ টাকা/কেজি, কম ধারণ খরচ।" },
  // ── 4 REGIONAL (region_based = 1) ─────────────────────────────────────────
  { code: "PRJ-CTL-04", name_en: "Dhaka Metro Cattle Supply", name_bn: "ঢাকা মেট্রো গরু সরবরাহ",
    region_based: 1, division: "Dhaka", district: "Dhaka", upazila: "Dhaka", status: "open", capacity: 80, invest: 250000, months: 5, duration: "5 months",
    lender: "DigiGram Ventures", b2b: 880, platform: 60, logistics: 25, vet: 20,
    summary_en: "Urban-premium cattle supply for Dhaka markets and processors.", summary_bn: "ঢাকার বাজার ও প্রসেসরের জন্য শহুরে-প্রিমিয়াম গরু সরবরাহ।",
    market_en: "Dhaka metro commands Tk 880/kg B2B; highest rate, short logistics legs.", market_bn: "ঢাকা মেট্রোতে ৮৮০ টাকা/কেজি; সর্বোচ্চ দর, কম পরিবহন।" },
  { code: "PRJ-CTL-05", name_en: "Chattogram Red Cattle Program", name_bn: "চট্টগ্রাম লাল গরু প্রকল্প",
    region_based: 1, division: "Chattagram", district: "Chattogram", upazila: "Chattogram Sadar", status: "open", capacity: 100, invest: 180000, months: 5, duration: "5 months",
    lender: "IFIC Agri", b2b: 800, platform: 55, logistics: 22, vet: 18,
    summary_en: "Red Chittagong breed fattening with port-city buyer linkage.", summary_bn: "বন্দর-নগরীর ক্রেতা সংযোগসহ চট্টগ্রামের লাল গরু মোটাতাজাকরণ।",
    market_en: "Red Chittagong fetches Tk 800/kg; strong local heritage demand.", market_bn: "চট্টগ্রামের লাল গরু ৮০০ টাকা/কেজি; স্থানীয় চাহিদা শক্তিশালী।" },
  { code: "PRJ-CTL-06", name_en: "North Bengal Fattening (Rangpur)", name_bn: "উত্তরবঙ্গ মোটাতাজাকরণ (রংপুর)",
    region_based: 1, division: "Rangpur", district: "Rangpur", upazila: "Rangpur Sadar", status: "open", capacity: 130, invest: 110000, months: 4, duration: "4 months",
    lender: "Bank Asia Agri", b2b: 720, platform: 48, logistics: 14, vet: 13,
    summary_en: "Low-cost North Bengal fattening with cheap feed and local breeds.", summary_bn: "সস্তা খাদ্য ও দেশি জাতে উত্তরবঙ্গে কম খরচে মোটাতাজাকরণ।",
    market_en: "Tk 720/kg B2B; lowest input cost belt, healthy margins.", market_bn: "৭২০ টাকা/কেজি; সবচেয়ে কম উপকরণ খরচের অঞ্চল, ভালো মার্জিন।" },
  { code: "PRJ-CTL-07", name_en: "Jashore Cattle Collection", name_bn: "যশোর গরু সংগ্রহ",
    region_based: 1, division: "Khulna", district: "Jashore", upazila: "Jashore Sadar", status: "opening_soon", capacity: 90, invest: 130000, months: 4, duration: "4 months",
    lender: "Pubali Agri", b2b: 760, platform: 50, logistics: 16, vet: 14,
    summary_en: "South-west collection hub feeding Khulna and border markets.", summary_bn: "খুলনা ও সীমান্ত বাজারের জন্য দক্ষিণ-পশ্চিম সংগ্রহ কেন্দ্র।",
    market_en: "Tk 760/kg B2B; cross-region buyer access via Jashore hub.", market_bn: "৭৬০ টাকা/কেজি; যশোর হাব দিয়ে আন্তঃঅঞ্চল ক্রেতা সংযোগ।" },
];

(async () => {
  const c = await mysql.createConnection(DB);
  // Retire the two earlier demo projects so the sample set is clean.
  await c.query("UPDATE partner_projects SET is_active = 0, status = 'closed' WHERE project_code IN ('PRJ-2024-EID','PRJ-2025-BORO')");
  const cow = (await c.query("SELECT id FROM animals WHERE slug='cow'"))[0][0].id;

  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const net = p.b2b - p.platform - p.logistics - p.vet;
    await c.query(
      `INSERT INTO partner_projects
        (project_code, name_en, name_bn, interest_slug, division, lender_name, district, upazila, image_url,
         summary_en, summary_bn, market_overview_en, market_overview_bn, investment_amount, duration_label,
         region_based, is_active, platform_fee, logistics_fee, warehouse_vet_fee,
         start_date, end_date, capacity, max_credit_amount, status, steps_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,CURDATE(),DATE_ADD(CURDATE(),INTERVAL ? DAY),?,?,?,?)
       ON DUPLICATE KEY UPDATE
        name_en=VALUES(name_en), name_bn=VALUES(name_bn), interest_slug=VALUES(interest_slug),
        division=VALUES(division), lender_name=VALUES(lender_name), district=VALUES(district), upazila=VALUES(upazila),
        image_url=VALUES(image_url), summary_en=VALUES(summary_en), summary_bn=VALUES(summary_bn),
        market_overview_en=VALUES(market_overview_en), market_overview_bn=VALUES(market_overview_bn),
        investment_amount=VALUES(investment_amount), duration_label=VALUES(duration_label),
        region_based=VALUES(region_based), is_active=1, platform_fee=VALUES(platform_fee),
        logistics_fee=VALUES(logistics_fee), warehouse_vet_fee=VALUES(warehouse_vet_fee),
        start_date=VALUES(start_date), end_date=VALUES(end_date), capacity=VALUES(capacity),
        max_credit_amount=VALUES(max_credit_amount), status=VALUES(status), steps_json=VALUES(steps_json)`,
      [p.code, p.name_en, p.name_bn, "livestock-poultry", p.division, p.lender, p.district, p.upazila, IMG[i],
       p.summary_en, p.summary_bn, p.market_en, p.market_bn, p.invest, p.duration,
       p.region_based, p.platform, p.logistics, p.vet, p.months * 30, p.capacity, p.invest, p.status, STEPS]
    );
    const pid = (await c.query("SELECT id FROM partner_projects WHERE project_code=?", [p.code]))[0][0].id;
    // Refresh the project's B2B preset (cattle, region). Open projects = district NULL.
    await c.query("DELETE FROM sale_pricing_rules WHERE partner_project_id=?", [pid]);
    await c.query(
      `INSERT INTO sale_pricing_rules
        (partner_project_id, sale_item_id, animal_id, breed_id, district, division, effective_from,
         b2b_market_rate, farmer_rate, platform_fee, logistics_fee, warehouse_vet_fee, unit, is_active)
       VALUES (?, 1, ?, NULL, ?, ?, CURDATE(), ?, ?, ?, ?, ?, 'kg', 1)`,
      [pid, cow, p.district, p.division, p.b2b, net, p.platform, p.logistics, p.vet]
    );
  }

  const [rows] = await c.query(
    "SELECT project_code, region_based, COALESCE(district,'(open)') district, status, platform_fee FROM partner_projects WHERE project_code LIKE 'PRJ-CTL-%' ORDER BY project_code"
  );
  console.log("seeded:", JSON.stringify(rows));
  await c.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
