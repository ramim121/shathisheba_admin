-- 029_seed_project_marketplace.sql
--
-- Narrows the catalogue to what actually exists today:
--   * one live project (Cattle Fattening), every other project "coming soon"
--   * 18 head of cattle across three breed lots
--   * three DigiGram cattle feeds
--
-- "Coming soon" rather than deleted: a farmer already enrolled in an old
-- project must keep seeing their progress, so the rows stay and only new
-- applications are refused.

-- ---------------------------------------------------------------------------
-- 1. Projects — one open, the rest parked
-- ---------------------------------------------------------------------------

UPDATE partner_projects
   SET status = 'opening_soon', is_active = 0
 WHERE project_code <> 'PRJ-CTL-FAT-01';

INSERT INTO partner_projects
  (project_code, name_en, name_bn, interest_slug, lender_name, image_url,
   summary_en, summary_bn, market_overview_en, market_overview_bn,
   investment_amount, income_amount, income_label_en, income_label_bn,
   model_en, model_bn, loan_partners_en, loan_partners_bn,
   capacity_label_en, capacity_label_bn, terms_json,
   duration_label, region_based, is_active, capacity, max_credit_amount, status, steps_json)
SELECT
  'PRJ-CTL-FAT-01',
  'Cattle Fattening Project', 'গরু মোটাতাজাকরণ প্রকল্প',
  'livestock', 'BRAC Bank & DigiGram Ventures',
  'https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/seed/project-cattle-fattening.png',
  'Fatten cattle over four months with feed, veterinary support and a guaranteed buy-back. Your earnings come from the buy-back price plus a share of the profit.',
  'চার মাসে গরু মোটাতাজা করুন — ফিড, পশু চিকিৎসা ও নিশ্চিত বাই-ব্যাক সহ। বাই-ব্যাক মূল্য ও লাভের ভাগ — দুই থেকেই আপনার আয়।',
  'Demand for finished cattle stays firm through the year and peaks before Eid. A guaranteed buy-back removes the price risk that normally sits with the farmer.',
  'মোটাতাজা গরুর চাহিদা সারা বছর স্থিতিশীল, ঈদের আগে সর্বোচ্চ। নিশ্চিত বাই-ব্যাক থাকায় দামের ঝুঁকি আর কৃষকের ঘাড়ে থাকে না।',
  NULL, 14000.00,
  'Up to ৳14,000 income', 'সর্বোচ্চ ৳১৪,০০০ আয়',
  'Buy back offer + profit share model', 'বাই-ব্যাক অফার + লাভ ভাগাভাগি মডেল',
  'Loan provided by BRAC Bank & DigiGram Ventures', 'ঋণ প্রদান করছে ব্র্যাক ব্যাংক ও ডিজিগ্রাম ভেঞ্চারস',
  '100 farmers in your upazila', 'আপনার উপজেলায় ১০০ জন কৃষক',
  -- Commercial terms are not finalised. The shape is fixed so the app can read
  -- it; the numbers are placeholders the admin overwrites when policy lands.
  JSON_OBJECT(
    'model', 'buyback_profit_share',
    'buyback', JSON_OBJECT(
      'enabled', TRUE,
      'basis', 'live_weight',
      'guaranteed_rate_per_kg', 400,
      'note_en', 'DigiGram buys back every animal at the agreed rate — you are never left holding stock.',
      'note_bn', 'ডিজিগ্রাম প্রতিটি পশু নির্ধারিত দরে ফেরত কিনে নেয় — অবিক্রীত পশু নিয়ে আপনাকে বসে থাকতে হবে না।'
    ),
    'profit_share', JSON_OBJECT(
      'enabled', TRUE,
      'farmer_pct', 60,
      'platform_pct', 40,
      'note_en', 'Any sale above the buy-back rate is shared with you.',
      'note_bn', 'বাই-ব্যাক দরের বেশি দামে বিক্রি হলে সেই বাড়তি লাভের ভাগ আপনি পাবেন।'
    ),
    'finalised', FALSE
  ),
  '4 months', 0, 1, 100, 120000.00, 'open',
  JSON_ARRAY(
    JSON_OBJECT('key', 'submitted',
      'title_en', 'Submitted', 'title_bn', 'জমা হয়েছে',
      'desc_en', 'NID and payment details verification', 'desc_bn', 'এনআইডি ও পেমেন্ট তথ্য যাচাই'),
    JSON_OBJECT('key', 'field_visit',
      'title_en', 'Field officer visit', 'title_bn', 'মাঠ কর্মকর্তার পরিদর্শন',
      'desc_en', 'A field officer visits your farm', 'desc_bn', 'একজন মাঠ কর্মকর্তা আপনার খামারে আসবেন'),
    JSON_OBJECT('key', 'documents',
      'title_en', 'Document verification', 'title_bn', 'কাগজপত্র যাচাই',
      'desc_en', 'Documents checked and the file submitted', 'desc_bn', 'কাগজপত্র যাচাই করে ফাইল জমা দেওয়া হয়'),
    JSON_OBJECT('key', 'approved',
      'title_en', 'Approved — project begins', 'title_bn', 'অনুমোদিত — প্রকল্প শুরু',
      'desc_en', 'Contract signed and input supply starts', 'desc_bn', 'চুক্তি স্বাক্ষর ও উপকরণ সরবরাহ শুরু')
  )
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT project_code FROM partner_projects) t WHERE t.project_code = 'PRJ-CTL-FAT-01'
);

-- ---------------------------------------------------------------------------
-- 2. Cattle — 18 head across three breed lots
-- ---------------------------------------------------------------------------

SET @cat_cattle := (SELECT id FROM (SELECT id FROM buy_categories WHERE slug = 'livestock') t);

-- The old placeholder rows priced a whole animal at a per-kg figure.
UPDATE products SET status = 'inactive'
 WHERE buy_category_id = @cat_cattle AND sku NOT LIKE 'CTL-%';

INSERT INTO products
  (buy_category_id, sku, name_en, name_bn, short_description_en, short_description_bn,
   unit, package_size, price, stock_qty, low_stock_threshold, delivery_window, status, metadata)
SELECT * FROM (
  SELECT
    @cat_cattle AS buy_category_id, 'CTL-LOCAL-01' AS sku,
    'Local Bull (Deshi)' AS name_en, 'দেশি ষাঁড়' AS name_bn,
    'Grass-fed local bull, 180–220 kg live weight. Vaccinated and health-checked.' AS short_description_en,
    'ঘাস খাওয়ানো দেশি ষাঁড়, জীবিত ওজন ১৮০–২২০ কেজি। টিকা ও স্বাস্থ্য পরীক্ষা সম্পন্ন।' AS short_description_bn,
    'head' AS unit, '180–220 kg live' AS package_size,
    76000.00 AS price, 6 AS stock_qty, 2 AS low_stock_threshold,
    '3–5 days after field verification' AS delivery_window, 'active' AS status,
    JSON_OBJECT(
      'image_url', 'https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/seed/cattle-local-deshi-bull.png',
      'breed_id', 2, 'animal_id', 2,
      'features', JSON_ARRAY('Local / Deshi', 'Vaccinated', 'Field verified'),
      'digital_id_prefix', 'SS-CTL-LOC',
      'specs', JSON_ARRAY(
        JSON_OBJECT('label_en', 'Breed', 'label_bn', 'জাত', 'value_en', 'Local / Deshi', 'value_bn', 'দেশি'),
        JSON_OBJECT('label_en', 'Live weight', 'label_bn', 'জীবিত ওজন', 'value_en', '180–220 kg', 'value_bn', '১৮০–২২০ কেজি'),
        JSON_OBJECT('label_en', 'Meat weight', 'label_bn', 'মাংসের ওজন', 'value_en', '90–110 kg', 'value_bn', '৯০–১১০ কেজি'),
        JSON_OBJECT('label_en', 'Age', 'label_bn', 'বয়স', 'value_en', '24–30 months', 'value_bn', '২৪–৩০ মাস'),
        JSON_OBJECT('label_en', 'Teeth', 'label_bn', 'দাঁত', 'value_en', '2 teeth', 'value_bn', '২ দাঁত')
      ),
      'vaccinations', JSON_ARRAY(
        JSON_OBJECT('name_en', 'Foot & Mouth Disease (FMD)', 'name_bn', 'ক্ষুরারোগ (এফএমডি)', 'given_on', '2026-05-12', 'due_on', '2026-11-12', 'status', 'done'),
        JSON_OBJECT('name_en', 'Anthrax', 'name_bn', 'তড়কা', 'given_on', '2026-04-02', 'due_on', '2027-04-02', 'status', 'done'),
        JSON_OBJECT('name_en', 'Black Quarter (BQ)', 'name_bn', 'বাদলা', 'given_on', '2026-04-02', 'due_on', '2027-04-02', 'status', 'done'),
        JSON_OBJECT('name_en', 'Deworming', 'name_bn', 'কৃমিনাশক', 'given_on', '2026-07-20', 'due_on', '2026-10-20', 'status', 'done')
      )
    ) AS metadata
) s WHERE NOT EXISTS (SELECT 1 FROM (SELECT sku FROM products) t WHERE t.sku = 'CTL-LOCAL-01');

INSERT INTO products
  (buy_category_id, sku, name_en, name_bn, short_description_en, short_description_bn,
   unit, package_size, price, stock_qty, low_stock_threshold, delivery_window, status, metadata)
SELECT * FROM (
  SELECT
    @cat_cattle AS buy_category_id, 'CTL-DESHI-02' AS sku,
    'Deshi Fattened Bull' AS name_en, 'দেশি মোটাতাজা ষাঁড়' AS name_bn,
    'Deshi bull finished on DigiGram feed, 230–280 kg live weight. Full vaccination record.' AS short_description_en,
    'ডিজিগ্রাম ফিডে মোটাতাজা করা দেশি ষাঁড়, জীবিত ওজন ২৩০–২৮০ কেজি। সম্পূর্ণ টিকার রেকর্ড।' AS short_description_bn,
    'head' AS unit, '230–280 kg live' AS package_size,
    98000.00 AS price, 7 AS stock_qty, 2 AS low_stock_threshold,
    '3–5 days after field verification' AS delivery_window, 'active' AS status,
    JSON_OBJECT(
      'image_url', 'https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/seed/cattle-deshi-fattened-bull.png',
      'breed_id', 6, 'animal_id', 2,
      'features', JSON_ARRAY('Deshi', 'DigiGram feed finished', 'Field verified'),
      'digital_id_prefix', 'SS-CTL-DSH',
      'specs', JSON_ARRAY(
        JSON_OBJECT('label_en', 'Breed', 'label_bn', 'জাত', 'value_en', 'Deshi', 'value_bn', 'দেশি'),
        JSON_OBJECT('label_en', 'Live weight', 'label_bn', 'জীবিত ওজন', 'value_en', '230–280 kg', 'value_bn', '২৩০–২৮০ কেজি'),
        JSON_OBJECT('label_en', 'Meat weight', 'label_bn', 'মাংসের ওজন', 'value_en', '115–140 kg', 'value_bn', '১১৫–১৪০ কেজি'),
        JSON_OBJECT('label_en', 'Age', 'label_bn', 'বয়স', 'value_en', '30–36 months', 'value_bn', '৩০–৩৬ মাস'),
        JSON_OBJECT('label_en', 'Feed', 'label_bn', 'খাদ্য', 'value_en', 'DigiGram Cattle Feed Finisher', 'value_bn', 'ডিজিগ্রাম ক্যাটল ফিড ফিনিশার')
      ),
      'vaccinations', JSON_ARRAY(
        JSON_OBJECT('name_en', 'Foot & Mouth Disease (FMD)', 'name_bn', 'ক্ষুরারোগ (এফএমডি)', 'given_on', '2026-06-01', 'due_on', '2026-12-01', 'status', 'done'),
        JSON_OBJECT('name_en', 'Anthrax', 'name_bn', 'তড়কা', 'given_on', '2026-03-18', 'due_on', '2027-03-18', 'status', 'done'),
        JSON_OBJECT('name_en', 'Black Quarter (BQ)', 'name_bn', 'বাদলা', 'given_on', '2026-03-18', 'due_on', '2027-03-18', 'status', 'done'),
        JSON_OBJECT('name_en', 'Deworming', 'name_bn', 'কৃমিনাশক', 'given_on', '2026-08-05', 'due_on', '2026-11-05', 'status', 'done')
      )
    ) AS metadata
) s WHERE NOT EXISTS (SELECT 1 FROM (SELECT sku FROM products) t WHERE t.sku = 'CTL-DESHI-02');

INSERT INTO products
  (buy_category_id, sku, name_en, name_bn, short_description_en, short_description_bn,
   unit, package_size, price, stock_qty, low_stock_threshold, delivery_window, status, metadata)
SELECT * FROM (
  SELECT
    @cat_cattle AS buy_category_id, 'CTL-CROSS-03' AS sku,
    'Cross Breed Bull (Friesian Cross)' AS name_en, 'ক্রস ব্রিড ষাঁড় (ফ্রিজিয়ান ক্রস)' AS name_bn,
    'Friesian cross bull, 300–360 kg live weight. Higher meat yield, full health record.' AS short_description_en,
    'ফ্রিজিয়ান ক্রস ষাঁড়, জীবিত ওজন ৩০০–৩৬০ কেজি। বেশি মাংস, সম্পূর্ণ স্বাস্থ্য রেকর্ড।' AS short_description_bn,
    'head' AS unit, '300–360 kg live' AS package_size,
    128000.00 AS price, 5 AS stock_qty, 2 AS low_stock_threshold,
    '3–5 days after field verification' AS delivery_window, 'active' AS status,
    JSON_OBJECT(
      'image_url', 'https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/seed/cattle-cross-friesian-bull.png',
      'breed_id', 1, 'animal_id', 2,
      'features', JSON_ARRAY('Cross breed', 'High meat yield', 'Field verified'),
      'digital_id_prefix', 'SS-CTL-CRS',
      'specs', JSON_ARRAY(
        JSON_OBJECT('label_en', 'Breed', 'label_bn', 'জাত', 'value_en', 'Cross Friesian', 'value_bn', 'ক্রস ফ্রিজিয়ান'),
        JSON_OBJECT('label_en', 'Live weight', 'label_bn', 'জীবিত ওজন', 'value_en', '300–360 kg', 'value_bn', '৩০০–৩৬০ কেজি'),
        JSON_OBJECT('label_en', 'Meat weight', 'label_bn', 'মাংসের ওজন', 'value_en', '150–180 kg', 'value_bn', '১৫০–১৮০ কেজি'),
        JSON_OBJECT('label_en', 'Age', 'label_bn', 'বয়স', 'value_en', '30–40 months', 'value_bn', '৩০–৪০ মাস'),
        JSON_OBJECT('label_en', 'Teeth', 'label_bn', 'দাঁত', 'value_en', '4 teeth', 'value_bn', '৪ দাঁত')
      ),
      'vaccinations', JSON_ARRAY(
        JSON_OBJECT('name_en', 'Foot & Mouth Disease (FMD)', 'name_bn', 'ক্ষুরারোগ (এফএমডি)', 'given_on', '2026-05-28', 'due_on', '2026-11-28', 'status', 'done'),
        JSON_OBJECT('name_en', 'Anthrax', 'name_bn', 'তড়কা', 'given_on', '2026-02-10', 'due_on', '2027-02-10', 'status', 'done'),
        JSON_OBJECT('name_en', 'Black Quarter (BQ)', 'name_bn', 'বাদলা', 'given_on', '2026-02-10', 'due_on', '2027-02-10', 'status', 'done'),
        JSON_OBJECT('name_en', 'Haemorrhagic Septicaemia (HS)', 'name_bn', 'গলাফুলা', 'given_on', '2026-06-15', 'due_on', '2027-06-15', 'status', 'done'),
        JSON_OBJECT('name_en', 'Deworming', 'name_bn', 'কৃমিনাশক', 'given_on', '2026-07-30', 'due_on', '2026-10-30', 'status', 'done')
      )
    ) AS metadata
) s WHERE NOT EXISTS (SELECT 1 FROM (SELECT sku FROM products) t WHERE t.sku = 'CTL-CROSS-03');

-- ---------------------------------------------------------------------------
-- 3. Inputs — the three DigiGram cattle feeds
-- ---------------------------------------------------------------------------

SET @cat_inputs := (SELECT id FROM (SELECT id FROM buy_categories WHERE slug = 'shadhin-feed') t);

UPDATE products SET status = 'inactive'
 WHERE buy_category_id = @cat_inputs AND sku NOT LIKE 'DG-FEED-%';

INSERT INTO products
  (buy_category_id, sku, name_en, name_bn, short_description_en, short_description_bn,
   unit, package_size, price, stock_qty, low_stock_threshold, delivery_window, status, metadata)
SELECT * FROM (
  SELECT
    @cat_inputs AS buy_category_id, 'DG-FEED-DAIRY' AS sku,
    'DigiGram Cattle Feed Dairy' AS name_en, 'ডিজিগ্রাম ক্যাটল ফিড ডেইরি' AS name_bn,
    'Special nutrition for milking cows — supports health, strength and milk production.' AS short_description_en,
    'দুধ দেওয়া গাভীর জন্য বিশেষ পুষ্টি — স্বাস্থ্য, শক্তি ও দুধ উৎপাদন সহায়তায়।' AS short_description_bn,
    'kg' AS unit, '40 kg sack' AS package_size,
    55.00 AS price, 4000 AS stock_qty, 400 AS low_stock_threshold,
    '2–3 days' AS delivery_window, 'active' AS status,
    JSON_OBJECT(
      'image_url', 'https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/seed/feed-dairy.png',
      'features', JSON_ARRAY('40 kg sack', '৳55/kg', 'Dairy formula'),
      'mrp_per_kg', 55,
      'purpose_en', 'For the health, strength and milk production of milking cows',
      'purpose_bn', 'দুধ দেওয়া গাভীর স্বাস্থ্য, শক্তি ও দুধ উৎপাদন সহায়তার জন্য',
      'nutrition', JSON_ARRAY(
        JSON_OBJECT('label_en', 'DM', 'label_bn', 'ডিএম', 'value', '86%'),
        JSON_OBJECT('label_en', 'TDN', 'label_bn', 'টিডিএন', 'value', '74%'),
        JSON_OBJECT('label_en', 'DCP', 'label_bn', 'ডিসিপি', 'value', '18%'),
        JSON_OBJECT('label_en', 'TDN (dry matter basis)', 'label_bn', 'টিডিএন (শুষ্ক পদার্থ ভিত্তিতে)', 'value', '87%'),
        JSON_OBJECT('label_en', 'DCP (dry matter basis)', 'label_bn', 'ডিসিপি (শুষ্ক পদার্থ ভিত্তিতে)', 'value', '21%')
      ),
      'ingredients_en', 'Maize powder, maize bran, crushed wheat, wheat bran, DDGS, rice polish, molasses/chitagur, khesari bran, soybean meal, lentil bran, mustard oil cake, angkush bran and sesame cake.',
      'ingredients_bn', 'ভুট্টা গুঁড়া, মেইজ ব্রান, গম ভাঙা, গমের ভুষি, ডিডিজিএস, রাইস পলিশিং, মোলাসেস/চিটাগুড়, খেসারি ভুষি, সয়াবিন মিল, মসুরের ভুষি, সরিষার খৈল, আংকুশ ভুষি এবং তিলের খৈল।',
      'benefits_en', 'Dairy feed helps sustain milk output and body condition. Its protein supports the higher daily requirement of a milking cow; fibre and digestive aids keep rumen function steady, and the mineral package underpins long-term herd health.',
      'benefits_bn', 'ডেইরি ফিড গাভীর দুধ উৎপাদন ও শরীরের কন্ডিশন বজায় রাখতে সহায়ক। এতে থাকা প্রোটিন দুধ দেওয়া গাভীর বেশি দৈনিক চাহিদা পূরণে সহায়তা করে; ফাইবার ও হজম সহায়ক উপাদান রুমেনের কার্যকারিতা ঠিক রাখে, আর মিনারেল সাপোর্ট দীর্ঘমেয়াদি স্বাস্থ্য ব্যবস্থাপনায় ভূমিকা রাখে।'
    ) AS metadata
) s WHERE NOT EXISTS (SELECT 1 FROM (SELECT sku FROM products) t WHERE t.sku = 'DG-FEED-DAIRY');

INSERT INTO products
  (buy_category_id, sku, name_en, name_bn, short_description_en, short_description_bn,
   unit, package_size, price, stock_qty, low_stock_threshold, delivery_window, status, metadata)
SELECT * FROM (
  SELECT
    @cat_inputs AS buy_category_id, 'DG-FEED-FINISHER' AS sku,
    'DigiGram Cattle Feed Finisher' AS name_en, 'ডিজিগ্রাম ক্যাটল ফিড ফিনিশার' AS name_bn,
    'For good finishing and market readiness in the last stage before sale.' AS short_description_en,
    'বিক্রির আগে গরুর ভালো ফিনিশিং ও বাজার প্রস্তুতির জন্য।' AS short_description_bn,
    'kg' AS unit, '40 kg sack' AS package_size,
    50.00 AS price, 4000 AS stock_qty, 400 AS low_stock_threshold,
    '2–3 days' AS delivery_window, 'active' AS status,
    JSON_OBJECT(
      'image_url', 'https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/seed/feed-finisher.png',
      'features', JSON_ARRAY('40 kg sack', '৳50/kg', 'Finisher formula'),
      'mrp_per_kg', 50,
      'purpose_en', 'For good finishing and market readiness before sale',
      'purpose_bn', 'বিক্রির আগে গরুর ভালো ফিনিশিং ও Market Readiness-এর জন্য',
      'nutrition', JSON_ARRAY(
        JSON_OBJECT('label_en', 'DM', 'label_bn', 'ডিএম', 'value', '85%'),
        JSON_OBJECT('label_en', 'TDN', 'label_bn', 'টিডিএন', 'value', '73.2%'),
        JSON_OBJECT('label_en', 'DCP', 'label_bn', 'ডিসিপি', 'value', '15%'),
        JSON_OBJECT('label_en', 'TDN (dry matter basis)', 'label_bn', 'টিডিএন (শুষ্ক পদার্থ ভিত্তিতে)', 'value', '86.1%'),
        JSON_OBJECT('label_en', 'DCP (dry matter basis)', 'label_bn', 'ডিসিপি (শুষ্ক পদার্থ ভিত্তিতে)', 'value', '17.2%')
      ),
      'ingredients_en', 'Maize powder, crushed wheat, wheat bran, DORB, rice polish, molasses/chitagur, soybean meal, khesari bran, mustard oil cake and lentil bran.',
      'ingredients_bn', 'ভুট্টা গুঁড়া, গম ভাঙা, গমের ভুষি, ডিওআরবি, রাইস পলিশিং, মোলাসেস/চিটাগুড়, সয়াবিন মিল, খেসারি ভুষি, সরিষার খৈল এবং মসুরের ভুষি।',
      'benefits_en', 'Finisher feed supports growth, body finishing, meat condition and market readiness in the final stage. Maize, wheat, rice polish and molasses meet the energy demand; soybean meal, mustard cake, khesari and lentil bran carry the protein.',
      'benefits_bn', 'ফিনিশার ফিড গরুর শেষ ধাপের গ্রোথ, বডি ফিনিশিং, meat condition এবং market readiness ভালো রাখতে সহায়ক। ভুট্টা, গম, রাইস পলিশিং ও মোলাসেস শক্তির চাহিদা পূরণ করে; সয়াবিন মিল, সরিষার খৈল, খেসারি ভুষি ও মসুরের ভুষি প্রোটিন সাপোর্ট দেয়।'
    ) AS metadata
) s WHERE NOT EXISTS (SELECT 1 FROM (SELECT sku FROM products) t WHERE t.sku = 'DG-FEED-FINISHER');

INSERT INTO products
  (buy_category_id, sku, name_en, name_bn, short_description_en, short_description_bn,
   unit, package_size, price, stock_qty, low_stock_threshold, delivery_window, status, metadata)
SELECT * FROM (
  SELECT
    @cat_inputs AS buy_category_id, 'DG-FEED-GROWER' AS sku,
    'DigiGram Cattle Feed Grower' AS name_en, 'ডিজিগ্রাম ক্যাটল ফিড গ্রোয়ার' AS name_bn,
    'For steady growth and body development in growing cattle.' AS short_description_en,
    'বর্ধনশীল গরুর নিয়মিত গ্রোথ ও শারীরিক গঠনের জন্য।' AS short_description_bn,
    'kg' AS unit, '40 kg sack' AS package_size,
    40.00 AS price, 4000 AS stock_qty, 400 AS low_stock_threshold,
    '2–3 days' AS delivery_window, 'active' AS status,
    JSON_OBJECT(
      'image_url', 'https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/seed/feed-grower.png',
      'features', JSON_ARRAY('40 kg sack', '৳40/kg', 'Grower formula'),
      'mrp_per_kg', 40,
      'purpose_en', 'For regular growth and body development of growing cattle',
      'purpose_bn', 'বর্ধনশীল গরুর নিয়মিত গ্রোথ ও Body Development-এর জন্য',
      'nutrition', JSON_ARRAY(
        JSON_OBJECT('label_en', 'DM', 'label_bn', 'ডিএম', 'value', '100%'),
        JSON_OBJECT('label_en', 'TDN', 'label_bn', 'টিডিএন', 'value', '79%'),
        JSON_OBJECT('label_en', 'DCP', 'label_bn', 'ডিসিপি', 'value', '14%')
      ),
      'ingredients_en', 'Maize powder, maize bran, DORB, rice polish, wheat bran, molasses/chitagur, local rice bran, soybean meal, mustard oil cake and lentil bran.',
      'ingredients_bn', 'ভুট্টা গুঁড়া, মেইজ ব্রান, ডিওআরবি, রাইস পলিশিং, গমের ভুষি, মোলাসেস/চিটাগুড়, দেশি রাইস কুঁড়া, সয়াবিন মিল, সরিষার খৈল এবং মসুরের ভুষি।',
      'benefits_en', 'Grower feed meets the daily energy and protein needs of growing cattle. Regular use helps keep body condition, digestion, health and natural growth on track, and its affordable price keeps farm feed cost under control.',
      'benefits_bn', 'গ্রোয়ার ফিড গরুর দৈনন্দিন শক্তি ও প্রোটিনের চাহিদা পূরণে সহায়ক। নিয়মিত ব্যবহারে গরুর body condition, হজম, স্বাস্থ্য এবং স্বাভাবিক গ্রোথ ভালো রাখতে সাহায্য করে; সাশ্রয়ী মূল্য হওয়ায় খামারি feed cost নিয়ন্ত্রণে রেখে ভালো পুষ্টি দিতে পারেন।'
    ) AS metadata
) s WHERE NOT EXISTS (SELECT 1 FROM (SELECT sku FROM products) t WHERE t.sku = 'DG-FEED-GROWER');
