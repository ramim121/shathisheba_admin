-- 028_sale_progress_pricing_projects.sql
--
-- Four related changes, all idempotent:
--   1. Meat weight on a listing, and a live/meat pricing basis on the rules.
--      Traders quote live weight; farmers and beparis quote meat weight. The
--      listing now carries both so neither side has to convert in their head.
--   2. A progress trail on a listing (submitted -> field visit -> approved ->
--      paid) so the farmer can see where their listing stands, and the admin
--      can move it along with a field-visit date.
--   3. Projects gain an income figure (what the farmer earns) rather than only
--      an investment figure (what they must put in), plus the model terms and
--      loan partners the project card has to show.
--   4. Marketplace scope: only cattle, poultry and inputs are live for buying;
--      inputs are withdrawn from the sell side until the buy-back terms exist.

USE shathi_sheba;

-- ---------------------------------------------------------------------------
-- 1. Live weight / meat weight
-- ---------------------------------------------------------------------------

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='meat_weight_kg');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN meat_weight_kg DECIMAL(10,2) NULL AFTER weight_kg', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- The dressing percentage actually used for this listing, stored so a later
-- rule change never silently rewrites history on an existing listing.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='dressing_pct');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN dressing_pct DECIMAL(5,2) NULL AFTER meat_weight_kg', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Platform fee moves from a flat per-kg figure to a percentage of the live
-- amount. The flat column stays for rules that still want one (crops, inputs);
-- a non-null percentage wins.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_pricing_rules' AND COLUMN_NAME='platform_fee_pct');
SET @s := IF(@c=0, 'ALTER TABLE sale_pricing_rules ADD COLUMN platform_fee_pct DECIMAL(6,3) NULL AFTER platform_fee', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_pricing_rules' AND COLUMN_NAME='b2b_meat_rate');
SET @s := IF(@c=0, 'ALTER TABLE sale_pricing_rules ADD COLUMN b2b_meat_rate DECIMAL(12,2) NULL AFTER b2b_market_rate', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_pricing_rules' AND COLUMN_NAME='dressing_pct');
SET @s := IF(@c=0, 'ALTER TABLE sale_pricing_rules ADD COLUMN dressing_pct DECIMAL(5,2) NOT NULL DEFAULT 50.00 AFTER b2b_meat_rate', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2. Listing progress trail
-- ---------------------------------------------------------------------------

-- `paid` closes the loop after `sold`: money reaching the farmer is the event
-- the progress screen ends on, and it is not the same as the animal changing
-- hands.
ALTER TABLE sale_listings
  MODIFY COLUMN status ENUM('draft','submitted','field_verification','active','sold','paid','rejected','cancelled')
  NOT NULL DEFAULT 'draft';

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='field_visit_date');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN field_visit_date DATE NULL AFTER approved_at', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='field_visit_note');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN field_visit_note TEXT NULL AFTER field_visit_date', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='verified_weight_kg');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN verified_weight_kg DECIMAL(10,2) NULL AFTER field_visit_note', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='paid_at');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN paid_at DATETIME NULL AFTER verified_weight_kg', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='paid_amount');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN paid_amount DECIMAL(12,2) NULL AFTER paid_at', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='payment_method');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN payment_method VARCHAR(40) NULL AFTER paid_amount', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='payment_reference');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN payment_reference VARCHAR(80) NULL AFTER payment_method', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 3. Project economics: income, model terms, loan partners, progress steps
-- ---------------------------------------------------------------------------

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='income_amount');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN income_amount DECIMAL(14,2) NULL AFTER investment_amount', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='income_label_en');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN income_label_en VARCHAR(190) NULL AFTER income_amount', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='income_label_bn');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN income_label_bn VARCHAR(190) NULL AFTER income_label_en', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- The one-line model shown under the project name ("Buy back offer + profit
-- share model"). Copy is configurable because the commercial terms are not
-- settled yet; the policy detail rides in terms_json.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='model_en');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN model_en VARCHAR(190) NULL AFTER income_label_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='model_bn');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN model_bn VARCHAR(190) NULL AFTER model_en', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='loan_partners_en');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN loan_partners_en VARCHAR(255) NULL AFTER model_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='loan_partners_bn');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN loan_partners_bn VARCHAR(255) NULL AFTER loan_partners_en', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='capacity_label_en');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN capacity_label_en VARCHAR(190) NULL AFTER loan_partners_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='capacity_label_bn');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN capacity_label_bn VARCHAR(190) NULL AFTER capacity_label_en', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Buy-back price, profit-share split, guarantees. Shape stays open because the
-- commercial policy is not finalised; the app reads only the keys it knows.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='terms_json');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN terms_json JSON NULL AFTER capacity_label_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Application progress. The existing `current_step` enum drives the KYC wizard;
-- these four columns drive the farmer-facing progress screen, which is a
-- different (shorter) sequence.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_applications' AND COLUMN_NAME='field_visit_date');
SET @s := IF(@c=0, 'ALTER TABLE partner_applications ADD COLUMN field_visit_date DATE NULL AFTER assigned_officer_id', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_applications' AND COLUMN_NAME='field_visit_note');
SET @s := IF(@c=0, 'ALTER TABLE partner_applications ADD COLUMN field_visit_note TEXT NULL AFTER field_visit_date', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_applications' AND COLUMN_NAME='docs_verified_at');
SET @s := IF(@c=0, 'ALTER TABLE partner_applications ADD COLUMN docs_verified_at DATETIME NULL AFTER field_visit_note', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_applications' AND COLUMN_NAME='contract_started_at');
SET @s := IF(@c=0, 'ALTER TABLE partner_applications ADD COLUMN contract_started_at DATETIME NULL AFTER docs_verified_at', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_applications' AND COLUMN_NAME='progress_note');
SET @s := IF(@c=0, 'ALTER TABLE partner_applications ADD COLUMN progress_note TEXT NULL AFTER contract_started_at', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 4. Cattle pricing on a live-weight basis
-- ---------------------------------------------------------------------------

-- Every regional cattle preset is retired in favour of one national rule. The
-- old rows priced ~750/kg, which is a meat-weight figure being applied to a
-- live weight — a 200 kg live bull came out at 134,000, roughly double the
-- market. Rates are now explicitly live (400) and meat (800).
UPDATE sale_pricing_rules SET is_active = 0 WHERE sale_item_id = 1;

INSERT INTO sale_pricing_rules
  (sale_item_id, animal_id, breed_id, district, division, effective_from,
   b2b_market_rate, b2b_meat_rate, dressing_pct, farmer_rate,
   platform_fee, platform_fee_pct, logistics_fee, warehouse_vet_fee, unit, is_active)
SELECT 1, NULL, NULL, NULL, NULL, CURDATE(),
       400.00, 800.00, 50.00, 378.00,
       0.00, 2.000, 7.00, 7.00, 'kg', 1
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT * FROM sale_pricing_rules) x
  WHERE x.sale_item_id = 1 AND x.is_active = 1 AND x.b2b_market_rate = 400.00
);

-- ---------------------------------------------------------------------------
-- 5. Marketplace scope
-- ---------------------------------------------------------------------------

-- Selling inputs back to the platform needs buy-back terms that do not exist
-- yet, so the whole sell-side inputs branch is withdrawn rather than left as a
-- form that produces listings nobody can action.
UPDATE sale_categories SET is_active = 0 WHERE slug = 'inputs';
UPDATE sale_items SET status = 'inactive' WHERE sale_category_id = (SELECT id FROM (SELECT id FROM sale_categories WHERE slug = 'inputs') t);

-- Buying: cattle, poultry and inputs only.
INSERT INTO buy_categories (slug, interest_slug, name_en, name_bn, description_en, description_bn, sort_order, is_active)
SELECT 'poultry', 'poultry', 'Poultry', 'পোল্ট্রি',
       'Verified broiler and layer birds from Shathi farmers.',
       'শাথী কৃষকদের যাচাইকৃত ব্রয়লার ও লেয়ার মুরগি।', 2, 1
WHERE NOT EXISTS (SELECT 1 FROM (SELECT slug FROM buy_categories) t WHERE t.slug = 'poultry');

UPDATE buy_categories
   SET name_en = 'Cattle', name_bn = 'গরু',
       description_en = 'Health-checked cattle with vaccination records and digital ID.',
       description_bn = 'স্বাস্থ্য পরীক্ষিত গরু — টিকার রেকর্ড ও ডিজিটাল পরিচয়সহ।',
       sort_order = 1, is_active = 1
 WHERE slug = 'livestock';

UPDATE buy_categories
   SET name_en = 'Inputs', name_bn = 'উপকরণ',
       description_en = 'Feed, seed and fertilizer at a verified rate.',
       description_bn = 'যাচাইকৃত দরে ফিড, বীজ ও সার।',
       sort_order = 3, is_active = 1
 WHERE slug = 'shadhin-feed';

UPDATE buy_categories SET is_active = 0
 WHERE slug IN ('seeds', 'fertilizer', 'agri-medicine', 'tools', 'machinery-rental', 'produce');
