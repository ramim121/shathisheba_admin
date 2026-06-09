-- Shathi Sheba Admin — migration 010: livestock "List for Sale" foundation
-- Adds:
--   * animals master (Cow, Bull, Buffalo, Poultry, Goat, Sheep) + species link
--   * animal_breeds: animal-species linkage, sort_order, idempotency key, more breeds
--   * geo_divisions / geo_districts / geo_upazilas (official BD geocode; seeded by 003 seed)
--   * sale_categories: emoji / interest_slug / pref_selectable + the 7 sale categories
--   * interest_categories: Inputs + Machinery hidden-from-preference roots
--   * sale_pricing_rules: animal_id / breed_id / division so B2B presets resolve by
--     animal type + breed + region
-- Idempotent. MySQL 8+.

USE shathi_sheba;

-- ── animals master ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS animals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(80) NOT NULL,
  name_en VARCHAR(120) NOT NULL,
  name_bn VARCHAR(120) NULL,
  species VARCHAR(40) NOT NULL,
  emoji VARCHAR(16) NULL,
  sale_category_id BIGINT UNSIGNED NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_animals_slug (slug),
  KEY idx_animals_species (species)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO animals (slug, name_en, name_bn, species, emoji, sale_category_id, sort_order, is_active) VALUES
  ('cow',     'Cow',     'গাভী',   'cattle',  '🐄', 2, 1, 1),
  ('bull',    'Bull',    'ষাঁড়',   'cattle',  '🐂', 2, 2, 1),
  ('buffalo', 'Buffalo', 'মহিষ',   'buffalo', '🐃', 2, 3, 1),
  ('goat',    'Goat',    'ছাগল',   'goat',    '🐐', 2, 4, 1),
  ('sheep',   'Sheep',   'ভেড়া',   'sheep',   '🐑', 2, 5, 1),
  ('poultry', 'Poultry', 'পোল্ট্রি', 'poultry', '🐔', 2, 6, 1)
ON DUPLICATE KEY UPDATE
  name_en=VALUES(name_en), name_bn=VALUES(name_bn), species=VALUES(species),
  emoji=VALUES(emoji), sale_category_id=VALUES(sale_category_id),
  sort_order=VALUES(sort_order), is_active=VALUES(is_active);

-- ── animal_breeds: sort_order + idempotency key + species linkage ────────────
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='animal_breeds' AND COLUMN_NAME='sort_order');
SET @s := IF(@c=0, 'ALTER TABLE animal_breeds ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER name_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='animal_breeds' AND INDEX_NAME='uq_breed_type_name');
SET @s := IF(@c=0, 'ALTER TABLE animal_breeds ADD UNIQUE KEY uq_breed_type_name (animal_type, name_en)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Breed master under each animal species. animal_type = animals.species.
INSERT INTO animal_breeds (animal_type, name_en, name_bn, sort_order, is_active) VALUES
  ('cattle','Local / Deshi','দেশি',1,1),
  ('cattle','Cross Friesian','ক্রস ফ্রিজিয়ান',2,1),
  ('cattle','Red Chittagong','চট্টগ্রামের লাল গরু',3,1),
  ('cattle','Sahiwal','সাহিওয়াল',4,1),
  ('cattle','Sindhi','সিন্ধি',5,1),
  ('cattle','North Bengal Grey','উত্তরবঙ্গের ধূসর',6,1),
  ('cattle','Pabna','পাবনা',7,1),
  ('cattle','Munshiganj','মুন্সিগঞ্জ',8,1),
  ('cattle','Brahman Cross','ব্রাহমান ক্রস',9,1),
  ('cattle','Hariana','হরিয়ানা',10,1),
  ('cattle','Other local / cross','অন্যান্য দেশি / ক্রস',99,1),
  ('buffalo','Local / Deshi','দেশি',1,1),
  ('buffalo','Murrah','মুররা',2,1),
  ('buffalo','Nili-Ravi','নিলি-রাভি',3,1),
  ('buffalo','Other','অন্যান্য',99,1),
  ('goat','Black Bengal','ব্ল্যাক বেঙ্গল',1,1),
  ('goat','Jamnapari','যমুনাপাড়ি',2,1),
  ('goat','Local / Deshi','দেশি',3,1),
  ('goat','Cross','ক্রস',4,1),
  ('goat','Other','অন্যান্য',99,1),
  ('sheep','Local / Deshi','দেশি',1,1),
  ('sheep','Garole','গাড়ল',2,1),
  ('sheep','Other','অন্যান্য',99,1),
  ('poultry','Broiler','ব্রয়লার',1,1),
  ('poultry','Layer','লেয়ার',2,1),
  ('poultry','Sonali','সোনালি',3,1),
  ('poultry','Native / Deshi','দেশি',4,1),
  ('poultry','Cockerel','ককরেল',5,1),
  ('poultry','Other','অন্যান্য',99,1)
ON DUPLICATE KEY UPDATE
  name_bn=VALUES(name_bn), sort_order=VALUES(sort_order), is_active=VALUES(is_active);

-- ── Geo tables (official BD geocode; rows seeded by seeds/003_bd_geo.sql) ─────
CREATE TABLE IF NOT EXISTS geo_divisions (
  id BIGINT UNSIGNED NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  name_bn VARCHAR(120) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_geo_div_name (name_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS geo_districts (
  id BIGINT UNSIGNED NOT NULL,
  division_id BIGINT UNSIGNED NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  name_bn VARCHAR(120) NULL,
  PRIMARY KEY (id),
  KEY idx_geo_dist_div (division_id),
  KEY idx_geo_dist_name (name_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS geo_upazilas (
  id BIGINT UNSIGNED NOT NULL,
  district_id BIGINT UNSIGNED NOT NULL,
  name_en VARCHAR(120) NOT NULL,
  name_bn VARCHAR(160) NULL,
  PRIMARY KEY (id),
  KEY idx_geo_upa_dist (district_id),
  KEY idx_geo_upa_name (name_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sale_categories: emoji / interest link / preference-selectable flag ──────
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_categories' AND COLUMN_NAME='emoji');
SET @s := IF(@c=0, 'ALTER TABLE sale_categories ADD COLUMN emoji VARCHAR(16) NULL AFTER name_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_categories' AND COLUMN_NAME='interest_slug');
SET @s := IF(@c=0, 'ALTER TABLE sale_categories ADD COLUMN interest_slug VARCHAR(120) NULL AFTER emoji', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_categories' AND COLUMN_NAME='pref_selectable');
SET @s := IF(@c=0, 'ALTER TABLE sale_categories ADD COLUMN pref_selectable TINYINT(1) NOT NULL DEFAULT 1 AFTER interest_slug', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- The 7 List-for-Sale categories. First 5 mirror the login preference roots;
-- Inputs + Machinery are sale-only (pref_selectable = 0).
INSERT INTO sale_categories (slug, name_en, name_bn, emoji, interest_slug, pref_selectable, is_active, sort_order) VALUES
  ('livestock',  'Cattle & Poultry', 'গবাদি পশু ও পোল্ট্রি', '🐄', 'livestock-poultry', 1, 1, 1),
  ('crops',      'Crops',            'ফসল',                  '🌾', 'crops',             1, 1, 2),
  ('fishery',    'Fishery',          'মৎস্য',                 '🐟', 'fishery',           1, 1, 3),
  ('vegetables', 'Vegetables',       'সবজি',                 '🥬', 'vegetables',        1, 1, 4),
  ('fruits',     'Fruits',           'ফল',                   '🥭', 'fruits',            1, 1, 5),
  ('inputs',     'Inputs',           'কৃষি উপকরণ',           '🌱', NULL,                0, 1, 6),
  ('machinery',  'Machinery',        'যন্ত্রপাতি',            '🚜', NULL,                0, 1, 7)
ON DUPLICATE KEY UPDATE
  name_en=VALUES(name_en), name_bn=VALUES(name_bn), emoji=VALUES(emoji),
  interest_slug=VALUES(interest_slug), pref_selectable=VALUES(pref_selectable),
  is_active=VALUES(is_active), sort_order=VALUES(sort_order);

-- ── interest_categories: Inputs + Machinery hidden-from-preference roots ──────
INSERT INTO interest_categories (parent_id, slug, name_en, name_bn, emoji, sort_order, step_group, is_selectable, is_active) VALUES
  (NULL, 'inputs',    'Inputs',    'কৃষি উপকরণ', '🌱', 6, 'root', 0, 1),
  (NULL, 'machinery', 'Machinery', 'যন্ত্রপাতি',  '🚜', 7, 'root', 0, 1)
ON DUPLICATE KEY UPDATE
  name_en=VALUES(name_en), name_bn=VALUES(name_bn), emoji=VALUES(emoji),
  sort_order=VALUES(sort_order), is_selectable=VALUES(is_selectable), is_active=VALUES(is_active);

-- ── sale_pricing_rules: resolve B2B preset by animal + breed + region ────────
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_pricing_rules' AND COLUMN_NAME='animal_id');
SET @s := IF(@c=0, 'ALTER TABLE sale_pricing_rules ADD COLUMN animal_id BIGINT UNSIGNED NULL AFTER sale_item_id', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_pricing_rules' AND COLUMN_NAME='breed_id');
SET @s := IF(@c=0, 'ALTER TABLE sale_pricing_rules ADD COLUMN breed_id BIGINT UNSIGNED NULL AFTER animal_id', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_pricing_rules' AND COLUMN_NAME='division');
SET @s := IF(@c=0, 'ALTER TABLE sale_pricing_rules ADD COLUMN division VARCHAR(120) NULL AFTER district', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_pricing_rules' AND INDEX_NAME='idx_pricing_animal');
SET @s := IF(@c=0, 'ALTER TABLE sale_pricing_rules ADD KEY idx_pricing_animal (animal_id, breed_id, district)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Seed cattle B2B preset matching the spec worked example (750 B2B / 670 farmer,
-- 50/15/15 fees per kg) for the Cattle item (id 1), Cow + Local breed, Mymensingh.
INSERT INTO sale_pricing_rules
  (sale_item_id, animal_id, breed_id, district, division, effective_from, b2b_market_rate, farmer_rate, platform_fee, logistics_fee, warehouse_vet_fee, unit, is_active)
SELECT 1,
       (SELECT id FROM animals WHERE slug='cow'),
       (SELECT id FROM animal_breeds WHERE animal_type='cattle' AND name_en='Local / Deshi' LIMIT 1),
       'Mymensingh', 'Mymensingh', CURDATE(), 750, 670, 50, 15, 15, 'kg', 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM sale_pricing_rules
  WHERE sale_item_id=1 AND district='Mymensingh' AND animal_id=(SELECT id FROM animals WHERE slug='cow')
);
