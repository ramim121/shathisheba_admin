-- 033: operational zones, loan GPS check-in, and the Natore pilot data.
--
-- 1. Loan applications record a GPS check-in: where the phone was when the
--    farmer submitted, resolved to geo ids, and whether it matched the profile.
--    `loan_gps_checkin` decides what a mismatch does:
--      flag    — accepted, marked for manual review (default)
--      enforce — refused until the farmer checks in from their area
--      off     — no check-in asked for
--
-- 2. The pilot runs in Natore district. Every seeded geo feature — the open
--    project, field officers, market updates, weather alerts, community posts,
--    sale listings and local price rules — is moved there, along with two test
--    accounts. An "operational zone" is wherever an active field officer's area
--    covers; with Rana Hossain covering all of Natore, every Natore upazila is
--    live and everywhere else shows "not active in your zone yet".

USE shathi_sheba;

-- ---------------------------------------------------------------------------
-- 1. Loan check-in
-- ---------------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND COLUMN_NAME = 'checkin_lat');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications
  ADD COLUMN checkin_lat DECIMAL(10,7) NULL,
  ADD COLUMN checkin_lng DECIMAL(10,7) NULL,
  ADD COLUMN checkin_district_id BIGINT UNSIGNED NULL,
  ADD COLUMN checkin_upazila_id BIGINT UNSIGNED NULL,
  ADD COLUMN checkin_status ENUM(''matched'',''mismatch'',''no_fix'',''not_required'') NULL,
  ADD COLUMN checkin_at TIMESTAMP NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND CONSTRAINT_NAME = 'fk_loan_checkin_district');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications
  ADD CONSTRAINT fk_loan_checkin_district FOREIGN KEY (checkin_district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT fk_loan_checkin_upazila FOREIGN KEY (checkin_upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

INSERT INTO app_settings (setting_key, value_text, description)
SELECT 'loan_gps_checkin', 'flag',
       'GPS check-in on loan submission: flag = accept and mark mismatches for review; enforce = refuse until the phone is in the profile district; off = not asked.'
WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'loan_gps_checkin');

-- ---------------------------------------------------------------------------
-- 2. Natore pilot. Ids from the geo masters: division Rajshahi = 2,
--    district Natore = 16; upazilas Natore Sadar 143, Baraigram 145,
--    Bagatipara 146, Lalpur 147, Gurudaspur 148, Singra 144, Naldanga 149.
--    Text columns are written from the masters, as everywhere else.
-- ---------------------------------------------------------------------------

-- Test accounts: Ramim in Natore Sadar (the default place to test from);
-- Result Test in Lalpur — the same district, a different upazila, so an
-- upazila-locked listing in Natore Sadar must not reach them.
UPDATE app_users SET division_id = 2, district_id = 16, upazila_id = 143,
       village = COALESCE(NULLIF(village, ''), 'Kanaikhali'),
       latitude = 24.4102, longitude = 88.9869
 WHERE id = 5;
UPDATE app_users SET division_id = 2, district_id = 16, upazila_id = 147,
       village = COALESCE(NULLIF(village, ''), 'Lalpur Bazar'),
       latitude = 24.1797, longitude = 88.9897
 WHERE id = 98;
-- Neither account keeps a stale pending request pointing at the old area.
UPDATE profile_change_requests SET status = 'cancelled', reviewer_note = 'Superseded by the Natore pilot setup.'
 WHERE user_id IN (5, 98) AND status = 'pending';

-- Field officers. Rana Hossain covers the whole district, which is what makes
-- all seven Natore upazilas an operational zone.
UPDATE zone_officers SET division_id = 2, district_id = 16, upazila_id = NULL WHERE id = 1;
UPDATE zone_officers SET division_id = 2, district_id = 16, upazila_id = NULL WHERE id = 2;

-- The open project becomes the Natore district project.
UPDATE partner_projects SET region_based = 1, division_id = 2, district_id = 16, upazila_id = NULL
 WHERE project_code = 'PRJ-CTL-FAT-01';

UPDATE market_updates SET division_id = 2, district_id = 16, upazila_id = NULL;
UPDATE weather_alerts SET division_id = 2, district_id = 16, upazila_id = NULL;

-- Community posts spread over the district so the district feed has content
-- from more than one upazila.
UPDATE community_posts SET division_id = 2, district_id = 16,
       upazila_id = ELT(1 + MOD(id, 4), 143, 147, 144, 145);

-- Sale listings: Ramim's own, and one active listing from another farmer, in
-- Natore Sadar — so Ramim sees someone else's listing, and Result Test in
-- Lalpur sees neither. The sold listing goes to Lalpur.
UPDATE sale_listings SET division_id = 2, district_id = 16, upazila_id = 143 WHERE id IN (2, 16, 18, 19);
UPDATE sale_listings SET division_id = 2, district_id = 16, upazila_id = 147 WHERE id = 5;

-- Local price rules follow the district; the national cattle rule stays national.
UPDATE sale_pricing_rules SET division_id = 2, district_id = 16, upazila_id = NULL WHERE district_id IS NOT NULL;

-- Names for everything above, from the masters.
UPDATE app_users x LEFT JOIN geo_divisions v ON v.id = x.division_id LEFT JOIN geo_districts d ON d.id = x.district_id LEFT JOIN geo_upazilas u ON u.id = x.upazila_id
   SET x.division = v.name_en, x.district = d.name_en, x.upazila = u.name_en WHERE x.id IN (5, 98);
UPDATE zone_officers x LEFT JOIN geo_districts d ON d.id = x.district_id LEFT JOIN geo_upazilas u ON u.id = x.upazila_id
   SET x.district = d.name_en, x.upazila = u.name_en WHERE x.id IN (1, 2);
UPDATE partner_projects x LEFT JOIN geo_divisions v ON v.id = x.division_id LEFT JOIN geo_districts d ON d.id = x.district_id
   SET x.division = v.name_en, x.district = d.name_en, x.upazila = NULL WHERE x.project_code = 'PRJ-CTL-FAT-01';
UPDATE market_updates x LEFT JOIN geo_districts d ON d.id = x.district_id SET x.district = d.name_en, x.upazila = NULL;
UPDATE weather_alerts x JOIN geo_districts d ON d.id = x.district_id SET x.district = d.name_en, x.upazila = NULL;
UPDATE community_posts x LEFT JOIN geo_districts d ON d.id = x.district_id LEFT JOIN geo_upazilas u ON u.id = x.upazila_id
   SET x.district = d.name_en, x.upazila = u.name_en;
UPDATE sale_listings x LEFT JOIN geo_divisions v ON v.id = x.division_id LEFT JOIN geo_districts d ON d.id = x.district_id LEFT JOIN geo_upazilas u ON u.id = x.upazila_id
   SET x.division = v.name_en, x.district = d.name_en, x.upazila = u.name_en WHERE x.id IN (2, 5, 16, 18, 19);
UPDATE sale_pricing_rules x LEFT JOIN geo_divisions v ON v.id = x.division_id LEFT JOIN geo_districts d ON d.id = x.district_id
   SET x.division = v.name_en, x.district = d.name_en WHERE x.district_id IS NOT NULL;
