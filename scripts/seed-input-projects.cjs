// Applies migration 016 + seeds Inputs sale items (seeds/feed/fertilizer),
// 2 input + 1 machinery projects, and their fair-price (B2B) presets. Idempotent.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const DB = { ...require("./_dbconfig.cjs"), multipleStatements: true };

const INPUTS_CATEGORY = 3; // sale_categories.slug = 'inputs'

// item slug -> {name, unit, b2b, platform, logistics, handling}
const items = [
  { slug: "seeds", name_en: "Seeds", name_bn: "বীজ", unit: "kg", b2b: 120, platform: 8, logistics: 4, handling: 3 },
  { slug: "feed", name_en: "Feed", name_bn: "ফিড", unit: "kg", b2b: 55, platform: 5, logistics: 3, handling: 2 },
  { slug: "fertilizer", name_en: "Fertilizer", name_bn: "সার", unit: "kg", b2b: 30, platform: 3, logistics: 2, handling: 1 },
];

const STEPS = JSON.stringify({ steps: ["Project selection", "Personal KYC", "Banking info", "Quality check", "Approval"] });
const projects = [
  {
    code: "PRJ-INP-01", interest: "inputs", region_based: 0, division: null, district: null, upazila: null,
    name_en: "Seed Bank Buyback (Open)", name_bn: "সিড ব্যাংক বাইব্যাক (ওপেন)", status: "open",
    image: "https://images.unsplash.com/photo-1530507629858-e3759c1f5c9b?w=800",
    invest: 50000, duration: "Year-round", lender: "DigiGram Inputs",
    summary_en: "Sell surplus certified seeds at a guaranteed fair rate, nationwide.", summary_bn: "সারাদেশে নিশ্চিত ন্যায্য দরে উদ্বৃত্ত প্রত্যয়িত বীজ বিক্রি করুন।",
    market_en: "Quality seed demand is strong; B2B buy rate ~Tk 120/kg.", market_bn: "মানসম্পন্ন বীজের চাহিদা বেশি; B2B দর প্রায় ১২০ টাকা/কেজি।",
    fee: { platform: 8, logistics: 4, vet: 3 },
  },
  {
    code: "PRJ-INP-02", interest: "inputs", region_based: 1, division: "Mymensingh", district: "Mymensingh", upazila: "Mymensingh Sadar",
    name_en: "Feed & Fertilizer Collection — Mymensingh", name_bn: "ফিড ও সার সংগ্রহ — ময়মনসিংহ", status: "open",
    image: "https://images.unsplash.com/photo-1574943320219-553eb213f72d?w=800",
    invest: 40000, duration: "6 months", lender: "Bank Asia Agri",
    summary_en: "Local collection of surplus feed and fertilizer at fair B2B rates.", summary_bn: "ন্যায্য B2B দরে উদ্বৃত্ত ফিড ও সার স্থানীয়ভাবে সংগ্রহ।",
    market_en: "Steady regional demand for feed (~Tk 55/kg) and fertilizer (~Tk 30/kg).", market_bn: "ফিড (~৫৫ টাকা/কেজি) ও সার (~৩০ টাকা/কেজি) এর আঞ্চলিক চাহিদা স্থির।",
    fee: { platform: 5, logistics: 3, vet: 2 },
  },
  {
    code: "PRJ-MAC-01", interest: "machinery", region_based: 1, division: "Dhaka", district: "Dhaka", upazila: "Dhaka",
    name_en: "Machinery Rental & Lease Pool — Dhaka", name_bn: "যন্ত্রপাতি ভাড়া ও লিজ পুল — ঢাকা", status: "opening_soon",
    image: "https://images.unsplash.com/photo-1581094288338-2314dddb7ece?w=800",
    invest: 120000, duration: "12 months", lender: "IPDC Agri",
    summary_en: "List tractors, tillers and harvesters for rent/lease at fair rates.", summary_bn: "ন্যায্য দরে ট্রাক্টর, টিলার ও হারভেস্টার ভাড়া/লিজে দিন।",
    market_en: "High machinery rental demand around Dhaka in peak season.", market_bn: "ঢাকার আশেপাশে পিক মৌসুমে যন্ত্র ভাড়ার চাহিদা বেশি।",
    fee: { platform: 0, logistics: 0, vet: 0 },
  },
];

(async () => {
  const root = path.resolve(__dirname, "..");
  const c = await mysql.createConnection(DB);
  await c.query(fs.readFileSync(path.join(root, "database/migrations/016_listing_description.sql"), "utf8"));

  // 1) Input sale items
  const itemIds = {};
  for (const it of items) {
    const [r] = await c.query("SELECT id FROM sale_items WHERE slug=? AND sale_category_id=?", [it.slug, INPUTS_CATEGORY]);
    if (r.length) {
      itemIds[it.slug] = r[0].id;
      await c.query("UPDATE sale_items SET name_en=?, name_bn=?, status='active' WHERE id=?", [it.name_en, it.name_bn, r[0].id]);
    } else {
      const [ins] = await c.query("INSERT INTO sale_items (sale_category_id, slug, name_en, name_bn, status) VALUES (?,?,?,?,'active')", [INPUTS_CATEGORY, it.slug, it.name_en, it.name_bn]);
      itemIds[it.slug] = ins.insertId;
    }
  }

  // 2) Projects
  const projIds = {};
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    await c.query(
      `INSERT INTO partner_projects
        (project_code, name_en, name_bn, interest_slug, division, lender_name, district, upazila, image_url,
         summary_en, summary_bn, market_overview_en, market_overview_bn, investment_amount, duration_label,
         region_based, is_active, platform_fee, logistics_fee, warehouse_vet_fee,
         start_date, end_date, capacity, status, steps_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 240 DAY),100,?,?)
       ON DUPLICATE KEY UPDATE
        name_en=VALUES(name_en), name_bn=VALUES(name_bn), interest_slug=VALUES(interest_slug),
        division=VALUES(division), lender_name=VALUES(lender_name), district=VALUES(district), upazila=VALUES(upazila),
        image_url=VALUES(image_url), summary_en=VALUES(summary_en), summary_bn=VALUES(summary_bn),
        market_overview_en=VALUES(market_overview_en), market_overview_bn=VALUES(market_overview_bn),
        investment_amount=VALUES(investment_amount), duration_label=VALUES(duration_label),
        region_based=VALUES(region_based), is_active=1, platform_fee=VALUES(platform_fee),
        logistics_fee=VALUES(logistics_fee), warehouse_vet_fee=VALUES(warehouse_vet_fee),
        start_date=VALUES(start_date), end_date=VALUES(end_date), status=VALUES(status), steps_json=VALUES(steps_json)`,
      [p.code, p.name_en, p.name_bn, p.interest, p.division, p.lender, p.district, p.upazila, p.image,
       p.summary_en, p.summary_bn, p.market_en, p.market_bn, p.invest, p.duration,
       p.region_based, p.fee.platform, p.fee.logistics, p.fee.vet, p.status, STEPS]
    );
    projIds[p.code] = (await c.query("SELECT id FROM partner_projects WHERE project_code=?", [p.code]))[0][0].id;
  }

  // 3) Pricing presets for the 3 input items, linked to the open project (INP-01).
  const openProj = projIds["PRJ-INP-01"];
  for (const it of items) {
    const net = it.b2b - it.platform - it.logistics - it.handling;
    const sid = itemIds[it.slug];
    await c.query("DELETE FROM sale_pricing_rules WHERE sale_item_id=? AND partner_project_id=?", [sid, openProj]);
    await c.query(
      `INSERT INTO sale_pricing_rules
        (partner_project_id, sale_item_id, animal_id, breed_id, district, division, effective_from,
         b2b_market_rate, farmer_rate, platform_fee, logistics_fee, warehouse_vet_fee, unit, is_active)
       VALUES (?, ?, NULL, NULL, NULL, NULL, CURDATE(), ?, ?, ?, ?, ?, ?, 1)`,
      [openProj, sid, it.b2b, net, it.platform, it.logistics, it.handling, it.unit]
    );
  }

  const [chk] = await c.query("SELECT slug, name_en FROM sale_items WHERE sale_category_id=?", [INPUTS_CATEGORY]);
  const [pp] = await c.query("SELECT project_code, interest_slug, status FROM partner_projects WHERE project_code IN ('PRJ-INP-01','PRJ-INP-02','PRJ-MAC-01')");
  const [pc] = await c.query("SELECT COUNT(*) n FROM sale_pricing_rules r JOIN sale_items i ON i.id=r.sale_item_id WHERE i.sale_category_id=?", [INPUTS_CATEGORY]);
  console.log("input items:", JSON.stringify(chk));
  console.log("projects:", JSON.stringify(pp));
  console.log("input pricing rules:", pc[0].n);
  await c.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
