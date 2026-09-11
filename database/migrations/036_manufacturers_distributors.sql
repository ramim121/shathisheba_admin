-- 036: manufacturers and distributors for Buy from Shathi, order events,
-- per-fee % or flat pricing, Bangla columns for catalogue/project copy, and a
-- duplicate breed removed.
--
-- Where a product can be bought now comes from its distributors: each
-- distributor has a service area (division / district / upazila, blank =
-- nationwide), the order goes to the distributor whose area contains the
-- buyer, and the delivery address is locked to that area. A product with no
-- distributor is shipped by its manufacturer and sold everywhere. The
-- per-product "Sold in" area added in 035 is removed.
--
-- Apply with: node scripts/apply-migration.cjs 036_manufacturers_distributors.sql

-- ---------------------------------------------------------------------------
-- 1. Manufacturers and distributors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manufacturers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NULL,
  name_en VARCHAR(190) NOT NULL,
  name_bn VARCHAR(190) NULL,
  short_name_en VARCHAR(80) NULL,
  short_name_bn VARCHAR(80) NULL,
  logo_url VARCHAR(500) NULL,
  description_en TEXT NULL,
  description_bn TEXT NULL,
  address_en VARCHAR(255) NULL,
  address_bn VARCHAR(255) NULL,
  factory_address_en VARCHAR(255) NULL,
  factory_address_bn VARCHAR(255) NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(190) NULL,
  website VARCHAR(255) NULL,
  registration_no VARCHAR(80) NULL,
  contact_person VARCHAR(190) NULL,
  established_year SMALLINT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_manufacturers_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS distributors (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NULL,
  name_en VARCHAR(190) NOT NULL,
  name_bn VARCHAR(190) NULL,
  short_name_en VARCHAR(80) NULL,
  short_name_bn VARCHAR(80) NULL,
  logo_url VARCHAR(500) NULL,
  description_en TEXT NULL,
  description_bn TEXT NULL,
  services_en TEXT NULL,
  services_bn TEXT NULL,
  address_en VARCHAR(255) NULL,
  address_bn VARCHAR(255) NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(190) NULL,
  website VARCHAR(255) NULL,
  registration_no VARCHAR(80) NULL,
  contact_person VARCHAR(190) NULL,
  established_year SMALLINT NULL,
  -- Service area. All blank = nationwide; a division = that division; a
  -- district = that district; an upazila = that upazila only. The order's
  -- delivery address is locked to it.
  division_id BIGINT UNSIGNED NULL,
  district_id BIGINT UNSIGNED NULL,
  upazila_id BIGINT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_distributors_code (code),
  KEY idx_distributors_geo (division_id, district_id, upazila_id),
  CONSTRAINT fk_distributors_division FOREIGN KEY (division_id) REFERENCES geo_divisions (id) ON DELETE SET NULL,
  CONSTRAINT fk_distributors_district FOREIGN KEY (district_id) REFERENCES geo_districts (id) ON DELETE SET NULL,
  CONSTRAINT fk_distributors_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which distributors carry which products.
CREATE TABLE IF NOT EXISTS product_distributors (
  product_id BIGINT UNSIGNED NOT NULL,
  distributor_id BIGINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, distributor_id),
  KEY idx_pd_distributor (distributor_id),
  CONSTRAINT fk_pd_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT fk_pd_distributor FOREIGN KEY (distributor_id) REFERENCES distributors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Products: manufacturer link, Bangla copy; 035's area and text
--    provenance columns give way to the tables above
-- ---------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN manufacturer_id BIGINT UNSIGNED NULL AFTER buy_category_id,
  ADD COLUMN package_size_bn VARCHAR(80) NULL AFTER package_size,
  ADD COLUMN delivery_window_bn VARCHAR(120) NULL AFTER delivery_window,
  ADD CONSTRAINT fk_products_manufacturer FOREIGN KEY (manufacturer_id) REFERENCES manufacturers (id) ON DELETE SET NULL;

-- The 035 area / text-provenance columns are dropped by 037, once the code
-- that reads them is gone.

-- ---------------------------------------------------------------------------
-- 3. Orders: which distributor fulfils it, and a status timeline
-- ---------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN distributor_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD CONSTRAINT fk_orders_distributor FOREIGN KEY (distributor_id) REFERENCES distributors (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS order_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('fulfillment','payment') NOT NULL DEFAULT 'fulfillment',
  status VARCHAR(40) NOT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_order_events_order (order_id, id),
  CONSTRAINT fk_order_events_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing orders start their timeline at placement (and, where it has moved
-- on, at the status it is in now — the time it got there was never recorded).
INSERT INTO order_events (order_id, kind, status, note, created_at)
SELECT o.id, 'fulfillment', 'placed', 'Order placed', o.created_at FROM orders o
 WHERE NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id);
INSERT INTO order_events (order_id, kind, status, note, created_at)
SELECT o.id, 'fulfillment', o.fulfillment_status, NULL, o.updated_at FROM orders o
 WHERE o.fulfillment_status <> 'placed'
   AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.status = o.fulfillment_status);

-- ---------------------------------------------------------------------------
-- 4. Pricing: every fee is either a % of the live price or a flat ৳/kg
-- ---------------------------------------------------------------------------
-- A flat figure above zero wins; otherwise the percentage applies.
ALTER TABLE sale_pricing_rules
  ADD COLUMN logistics_fee_pct DECIMAL(6,3) NULL AFTER logistics_fee,
  ADD COLUMN warehouse_vet_fee_pct DECIMAL(6,3) NULL AFTER warehouse_vet_fee;

-- Rule 18 carried both a 2% and a ৳10 flat platform fee. The rule as agreed
-- is 2% of the live amount, so the stray flat figure is cleared and the
-- farmer rate restated: 425 − 8.5 − 8 − 7 = 401.50.
UPDATE sale_pricing_rules
   SET platform_fee = 0,
       farmer_rate = b2b_market_rate - (b2b_market_rate * platform_fee_pct / 100) - logistics_fee - warehouse_vet_fee
 WHERE id = 18 AND platform_fee_pct IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Bangla copy the app was showing in English
-- ---------------------------------------------------------------------------
ALTER TABLE partner_projects
  ADD COLUMN duration_label_bn VARCHAR(120) NULL AFTER duration_label;

UPDATE partner_projects SET duration_label_bn = CASE duration_label
  WHEN '3 months' THEN '৩ মাস' WHEN '4 months' THEN '৪ মাস' WHEN '5 months' THEN '৫ মাস'
  WHEN '6 months' THEN '৬ মাস' WHEN '12 months' THEN '১২ মাস' WHEN 'Year-round' THEN 'সারা বছর'
  ELSE duration_label_bn END
 WHERE duration_label IS NOT NULL AND duration_label_bn IS NULL;

UPDATE products SET package_size_bn = CASE package_size
  WHEN '50kg' THEN '৫০ কেজি' WHEN '25kg' THEN '২৫ কেজি' WHEN '5kg' THEN '৫ কেজি'
  WHEN '1.00 piece' THEN '১টি' WHEN '40 kg sack' THEN '৪০ কেজির বস্তা'
  WHEN '180–220 kg live' THEN 'জীবিত ওজন ১৮০–২২০ কেজি'
  WHEN '230–280 kg live' THEN 'জীবিত ওজন ২৩০–২৮০ কেজি'
  WHEN '300–360 kg live' THEN 'জীবিত ওজন ৩০০–৩৬০ কেজি'
  ELSE package_size_bn END
 WHERE package_size IS NOT NULL AND package_size_bn IS NULL;

UPDATE products SET delivery_window_bn = CASE delivery_window
  WHEN '2-3 days' THEN '২-৩ দিন' WHEN '3-4 days' THEN '৩-৪ দিন' WHEN '1-3 days' THEN '১-৩ দিন'
  WHEN '2–3 days' THEN '২–৩ দিন'
  WHEN '3–5 days after field verification' THEN 'মাঠ যাচাইয়ের পর ৩–৫ দিন'
  ELSE delivery_window_bn END
 WHERE delivery_window IS NOT NULL AND delivery_window_bn IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Duplicate breed: cattle had both "Local" and "Local / Deshi" (দেশি)
-- ---------------------------------------------------------------------------
UPDATE sale_listings SET breed_id = 6 WHERE breed_id = 2
   AND EXISTS (SELECT 1 FROM (SELECT id FROM animal_breeds WHERE id = 6) b);
DELETE FROM animal_breeds WHERE id = 2 AND name_en = 'Local' AND animal_type = 'cattle'
   AND EXISTS (SELECT 1 FROM (SELECT id FROM animal_breeds WHERE id = 6) b);

-- ---------------------------------------------------------------------------
-- 7. Seed: DigiGram (manufacturer) and two women's cooperatives (distributors)
-- ---------------------------------------------------------------------------
INSERT INTO manufacturers
  (code, name_en, name_bn, short_name_en, short_name_bn, description_en, description_bn,
   factory_address_en, factory_address_bn, is_active)
SELECT 'DGV', 'DigiGram Ventures Ltd.', 'ডিজিগ্রাম ভেঞ্চারস লিমিটেড', 'DigiGram Ventures', 'ডিজিগ্রাম ভেঞ্চারস',
       'Maker of DigiGram / Shadhin cattle feed, produced with rural women''s cooperatives.',
       'ডিজিগ্রাম / স্বাধীন গরুর খাদ্যের প্রস্তুতকারক, গ্রামীণ নারী সমবায়ের সাথে উৎপাদিত।',
       'Kalikapur, Bonpara Bypass, Baraigram, Natore', 'কালিকাপুর, বনপাড়া বাইপাস, বড়াইগ্রাম, নাটোর', 1
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM manufacturers WHERE code = 'DGV');

INSERT INTO distributors
  (code, name_en, name_bn, short_name_en, short_name_bn, description_en, description_bn,
   address_en, address_bn, contact_person, division_id, district_id, upazila_id, is_active)
SELECT 'ASMSSL', 'Amra Shadhin Mohila Samabay Samity Ltd.', 'আমরা স্বাধীন মহিলা সমবায় সমিতি লিমিটেড',
       'Amra Shadhin', 'আমরা স্বাধীন',
       'Women''s cooperative society distributing DigiGram feed in Baraigram.',
       'বড়াইগ্রামে ডিজিগ্রাম খাদ্য পরিবেশনকারী নারী সমবায় সমিতি।',
       'Kalikapur, Bonpara Bypass, Baraigram, Natore', 'কালিকাপুর, বনপাড়া বাইপাস, বড়াইগ্রাম, নাটোর',
       'Md. Masud Rana (Manager)', 2, 16, 145, 1
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM distributors WHERE code = 'ASMSSL');

INSERT INTO distributors
  (code, name_en, name_bn, short_name_en, short_name_bn, description_en, description_bn,
   services_en, services_bn, address_en, address_bn, phone, email, registration_no, established_year,
   division_id, district_id, upazila_id, is_active)
SELECT 'WSMSS', 'Walia Shimul Mohila Samabay Samity Ltd.', 'ওয়ালিয়া শিমুল মহিলা সমবায় সমিতি লিঃ',
       'Walia Shimul', 'ওয়ালিয়া শিমুল',
       'A multi-service financial and community-welfare organisation.',
       'একটি আর্থিক ও জনকল্যাণ মূলক বহুমুখী সেবাদানকারী প্রতিষ্ঠান।',
       'Ready feed (TMR), goat breeding, product services, cattle buying/selling, goats, cattle/goat vaccination, improved grass seed/cuttings, animal medicine, vermicompost, sanitation rings/slabs/pans, farm visits',
       'রেডি ফিড-মিট মোর/টিএমআর, ছাগল প্রজনন, পণ্য সেবা, গরু ক্রয়/বিক্রয়, ছাগল-খাসী/ছাগী/ছাগল ছানা, গরু/ছাগলের টিকা, উন্নত জাতের ঘাসের বীজ/কাটিং, প্রাণীর ঔষধ, ভার্মি কম্পোস্ট, স্যানিটেশন-রিং, স্লাব, প্যান, খামার পরিদর্শন',
       'Traffic Mor, Sipahipara, Walia, Lalpur, Natore', 'ট্রাফিক মোড়, সিপাহীপাড়া, ওয়ালিয়া, লালপুর, নাটোর',
       '01714-655492', 'wsmss0048@gmail.com', '0048', 2016, 2, 16, 147, 1
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM distributors WHERE code = 'WSMSS');

-- Every product is DigiGram's (confirmed for now); its feed is carried by
-- both cooperatives. Cattle and seed have no distributor yet, so they stay
-- sold everywhere.
UPDATE products SET manufacturer_id = (SELECT id FROM manufacturers WHERE code = 'DGV')
 WHERE manufacturer_id IS NULL;

INSERT IGNORE INTO product_distributors (product_id, distributor_id)
SELECT p.id, d.id
  FROM products p
  JOIN buy_categories c ON c.id = p.buy_category_id AND c.slug = 'shadhin-feed'
  JOIN distributors d ON d.code IN ('ASMSSL', 'WSMSS');
