-- 035: Buy from Shathi promotions, product geography and provenance, the
-- six-step sale listing workflow (field verification, contract, post-sale
-- handover to collection), pricing rule attachment, and loan partner logos.
--
-- MySQL 8.0 has no ADD COLUMN IF NOT EXISTS. Apply with
-- scripts/apply-035.cjs, which runs statement by statement and treats
-- "already exists" errors as already applied. Data statements are guarded.

-- ---------------------------------------------------------------------------
-- 1. Products: where each one is sold, and who makes it
-- ---------------------------------------------------------------------------
-- A product with no area is sold everywhere. A district makes it district-wide;
-- an upazila narrows it to that upazila. Visibility is containment: every level
-- the product sets must equal the buyer's.
ALTER TABLE products
  ADD COLUMN division_id BIGINT UNSIGNED NULL AFTER metadata,
  ADD COLUMN district_id BIGINT UNSIGNED NULL AFTER division_id,
  ADD COLUMN upazila_id BIGINT UNSIGNED NULL AFTER district_id,
  ADD COLUMN manufactured_by VARCHAR(190) NULL AFTER upazila_id,
  ADD COLUMN marketed_by VARCHAR(190) NULL AFTER manufactured_by,
  ADD COLUMN distributed_by VARCHAR(190) NULL AFTER marketed_by,
  ADD COLUMN factory_address TEXT NULL AFTER distributed_by,
  ADD KEY idx_products_geo (division_id, district_id, upazila_id),
  ADD CONSTRAINT fk_products_division FOREIGN KEY (division_id) REFERENCES geo_divisions (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_products_district FOREIGN KEY (district_id) REFERENCES geo_districts (id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_products_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas (id) ON DELETE SET NULL;

-- The factory address is left blank on purpose: it is not known yet, and an
-- invented address on a product label is worse than none.
UPDATE products
   SET manufactured_by = 'Digigram Ventures',
       marketed_by = 'Digigram Ventures',
       distributed_by = 'Amra Shadhin women cooperatives'
 WHERE manufactured_by IS NULL AND marketed_by IS NULL AND distributed_by IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Orders carry the discount; their geo ids are the delivery location
-- ---------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER delivery_fee;

-- ---------------------------------------------------------------------------
-- 3. Promotions
-- ---------------------------------------------------------------------------
-- One table for every rule. `first_purchase` has no code and applies itself;
-- `promo_code` is typed by the buyer. New kinds (seasonal, category-wide) add
-- an enum value and a branch in lib/promotions.ts, not a new table.
CREATE TABLE IF NOT EXISTS promotions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NULL,
  kind ENUM('first_purchase','promo_code') NOT NULL DEFAULT 'promo_code',
  name_en VARCHAR(190) NOT NULL,
  name_bn VARCHAR(190) NULL,
  description_en TEXT NULL,
  discount_type ENUM('flat','percent') NOT NULL DEFAULT 'flat',
  discount_value DECIMAL(12,2) NOT NULL,
  max_discount DECIMAL(12,2) NULL,
  -- The order subtotal must be strictly greater than this.
  min_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  division_id BIGINT UNSIGNED NULL,
  district_id BIGINT UNSIGNED NULL,
  upazila_id BIGINT UNSIGNED NULL,
  usage_limit_total INT NULL,
  usage_limit_per_user INT NOT NULL DEFAULT 1,
  -- First purchase only: when an approved order later fails, the buyer gets a
  -- voucher for the same amount on their next order.
  voucher_on_failure TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_promotions_code (code),
  KEY idx_promotions_kind (kind, is_active),
  CONSTRAINT fk_promotions_division FOREIGN KEY (division_id) REFERENCES geo_divisions (id) ON DELETE SET NULL,
  CONSTRAINT fk_promotions_district FOREIGN KEY (district_id) REFERENCES geo_districts (id) ON DELETE SET NULL,
  CONSTRAINT fk_promotions_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A voucher belongs to one buyer and is spent once.
CREATE TABLE IF NOT EXISTS user_vouchers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  promotion_id BIGINT UNSIGNED NULL,
  amount DECIMAL(12,2) NOT NULL,
  min_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  reason ENUM('first_purchase_failed','goodwill','manual') NOT NULL DEFAULT 'manual',
  source_order_id BIGINT UNSIGNED NULL,
  status ENUM('available','reserved','redeemed','expired','void') NOT NULL DEFAULT 'available',
  reserved_order_id BIGINT UNSIGNED NULL,
  expires_at DATETIME NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- One compensation voucher per failed order, however often it is re-synced.
  UNIQUE KEY uq_voucher_source (source_order_id, reason),
  KEY idx_voucher_user (user_id, status),
  CONSTRAINT fk_voucher_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE,
  CONSTRAINT fk_voucher_promotion FOREIGN KEY (promotion_id) REFERENCES promotions (id) ON DELETE SET NULL,
  CONSTRAINT fk_voucher_source FOREIGN KEY (source_order_id) REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT fk_voucher_reserved FOREIGN KEY (reserved_order_id) REFERENCES orders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every discount given, on which order, and where it stands. One per order.
--   applied  - order placed, awaiting approval
--   approved - order confirmed; the discount is spent
--   released - order rejected before confirmation; the offer is the buyer's again
--   failed   - order failed after confirmation (a first-purchase failure issues a voucher)
CREATE TABLE IF NOT EXISTS order_promotions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  promotion_id BIGINT UNSIGNED NULL,
  voucher_id BIGINT UNSIGNED NULL,
  source ENUM('first_purchase','promo_code','voucher') NOT NULL,
  code VARCHAR(40) NULL,
  discount_amount DECIMAL(12,2) NOT NULL,
  order_subtotal DECIMAL(12,2) NOT NULL,
  status ENUM('applied','approved','released','failed') NOT NULL DEFAULT 'applied',
  note VARCHAR(255) NULL,
  decided_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_promotion (order_id),
  KEY idx_order_promotions_user (user_id, source, status),
  KEY idx_order_promotions_promo (promotion_id, status),
  CONSTRAINT fk_op_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_op_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE,
  CONSTRAINT fk_op_promotion FOREIGN KEY (promotion_id) REFERENCES promotions (id) ON DELETE SET NULL,
  CONSTRAINT fk_op_voucher FOREIGN KEY (voucher_id) REFERENCES user_vouchers (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO promotions
  (code, kind, name_en, name_bn, description_en, discount_type, discount_value, min_order_amount,
   usage_limit_per_user, voucher_on_failure, is_active)
SELECT NULL, 'first_purchase', 'First purchase: flat 200 off', 'প্রথম কেনাকাটায় ফ্ল্যাট ৳২০০ ছাড়',
       'Applied automatically to a buyer''s first successful order over 500. If that order is rejected the offer stays for the next one; if it fails after approval, a 200 voucher is issued for the next order.',
       'flat', 200.00, 500.00, 1, 1, 1
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM promotions WHERE kind = 'first_purchase');

-- ---------------------------------------------------------------------------
-- 4. Sale listings: six farmer-facing steps and the attached price rule
-- ---------------------------------------------------------------------------
--   submitted -> field_verification -> verified -> active (profile approved)
--   -> contracted -> shipped -> paid
ALTER TABLE sale_listings
  MODIFY COLUMN status ENUM('draft','submitted','field_verification','verified','active','contracted','shipped','sold','paid','rejected','cancelled') NOT NULL DEFAULT 'draft';

ALTER TABLE sale_listings
  ADD COLUMN pricing_rule_id BIGINT UNSIGNED NULL AFTER estimated_earning,
  ADD COLUMN verified_at DATETIME NULL AFTER verified_weight_kg,
  ADD COLUMN contracted_at DATETIME NULL AFTER verified_at,
  ADD COLUMN shipped_at DATETIME NULL AFTER contracted_at,
  ADD CONSTRAINT fk_sale_listings_pricing_rule FOREIGN KEY (pricing_rule_id) REFERENCES sale_pricing_rules (id) ON DELETE SET NULL;

-- Field verification by the field officer: the six-part photo checklist.
-- photos_json keys: muzzle_front, muzzle_left, muzzle_right, body_left,
-- body_right, body_front, body_rear, teeth, legs_hooves, tag_mark.
-- checklist_json keys: muzzle_front, muzzle_angles, full_body, teeth_age,
-- legs_hooves, tag_mark -> { ok: bool, note: string }.
CREATE TABLE IF NOT EXISTS listing_field_verifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  listing_id BIGINT UNSIGNED NOT NULL,
  officer_id BIGINT UNSIGNED NULL,
  visit_date DATE NULL,
  photos_json JSON NULL,
  checklist_json JSON NULL,
  dentition VARCHAR(80) NULL,
  estimated_age_months INT NULL,
  legs_condition ENUM('good','minor_issue','lame','injured') NULL,
  body_condition_score DECIMAL(3,1) NULL,
  tag_number VARCHAR(60) NULL,
  unique_mark VARCHAR(255) NULL,
  verified_weight_kg DECIMAL(10,2) NULL,
  health_notes TEXT NULL,
  result ENUM('pending','passed','failed','recheck') NOT NULL DEFAULT 'pending',
  recorded_by BIGINT UNSIGNED NULL,
  verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lfv_listing (listing_id),
  CONSTRAINT fk_lfv_listing FOREIGN KEY (listing_id) REFERENCES sale_listings (id) ON DELETE CASCADE,
  CONSTRAINT fk_lfv_officer FOREIGN KEY (officer_id) REFERENCES zone_officers (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The purchase contract and the post-sale flow:
-- A handover -> B transport -> C receive -> D invoice -> E collection.
CREATE TABLE IF NOT EXISTS listing_contracts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  listing_id BIGINT UNSIGNED NOT NULL,
  contract_ref VARCHAR(60) NULL,
  buyer_name VARCHAR(190) NULL,
  buyer_phone VARCHAR(32) NULL,
  buyer_org VARCHAR(190) NULL,
  agreed_rate_per_kg DECIMAL(12,2) NULL,
  agreed_weight_kg DECIMAL(10,2) NULL,
  contract_amount DECIMAL(14,2) NULL,
  weight_tolerance_pct DECIMAL(5,2) NULL DEFAULT 3.00,
  advance_amount DECIMAL(14,2) NULL,
  payment_terms_days INT NULL,
  accepted_at DATETIME NULL,
  -- A. Handover: farmer signs custody transfer after receiving the advance
  advance_paid_at DATETIME NULL,
  handover_at DATETIME NULL,
  handover_signed_by VARCHAR(190) NULL,
  handover_note TEXT NULL,
  -- B. Transport: platform dispatches with the digital animal record
  dispatched_at DATETIME NULL,
  vehicle_ref VARCHAR(80) NULL,
  driver_phone VARCHAR(32) NULL,
  digital_record_ref VARCHAR(80) NULL,
  -- C. Receive: buyer checks identity, condition and weight tolerance
  received_at DATETIME NULL,
  received_weight_kg DECIMAL(10,2) NULL,
  identity_ok TINYINT(1) NULL,
  condition_ok TINYINT(1) NULL,
  weight_within_tolerance TINYINT(1) NULL,
  receive_note TEXT NULL,
  -- D. Invoice: acceptance starts the agreed payment clock
  invoice_no VARCHAR(60) NULL,
  invoice_amount DECIMAL(14,2) NULL,
  invoiced_at DATETIME NULL,
  payment_due_at DATE NULL,
  -- E. Collection: buyer pays the designated bank account
  collected_at DATETIME NULL,
  collected_amount DECIMAL(14,2) NULL,
  bank_account_ref VARCHAR(120) NULL,
  collection_reference VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_listing_contract (listing_id),
  CONSTRAINT fk_lc_listing FOREIGN KEY (listing_id) REFERENCES sale_listings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. Pricing: one national livestock rule, everything else retired
-- ---------------------------------------------------------------------------
ALTER TABLE sale_pricing_rules
  ADD COLUMN rule_name VARCHAR(190) NULL AFTER id;

-- 425/kg live (850/kg meat at 50% dressing); platform 2% of the live amount
-- (8.50/kg); logistics and transport 7/kg; warehousing and care 7/kg;
-- net to the farmer 425 - 8.5 - 7 - 7 = 402.50/kg live. No area = every
-- district, Natore included.
INSERT INTO sale_pricing_rules
  (rule_name, partner_project_id, sale_item_id, animal_id, breed_id, district, division,
   division_id, district_id, upazila_id, effective_from, effective_to,
   b2b_market_rate, b2b_meat_rate, dressing_pct, farmer_rate, platform_fee, platform_fee_pct,
   logistics_fee, warehouse_vet_fee, unit, is_active)
SELECT 'National livestock rate', NULL, 1, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, CURDATE(), NULL,
       425.00, 850.00, 50.00, 402.50, 8.50, 2.000,
       7.00, 7.00, 'kg', 1
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM sale_pricing_rules WHERE rule_name = 'National livestock rate');

-- Retired, not deleted: listings priced on them keep their history.
UPDATE sale_pricing_rules
   SET is_active = 0
 WHERE is_active = 1 AND (rule_name IS NULL OR rule_name <> 'National livestock rate');

-- Livestock listings with no rule on record are attached to the national one.
UPDATE sale_listings l
  JOIN sale_items si ON si.id = l.sale_item_id
  JOIN sale_categories sc ON sc.id = si.sale_category_id
   SET l.pricing_rule_id = (SELECT id FROM (SELECT id FROM sale_pricing_rules WHERE rule_name = 'National livestock rate' LIMIT 1) r)
 WHERE sc.slug = 'livestock' AND l.pricing_rule_id IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Projects: loan partner logos
-- ---------------------------------------------------------------------------
-- [{ "name": "BRAC Bank", "logo_url": "https://..." }, ...]
ALTER TABLE partner_projects
  ADD COLUMN loan_partner_logos JSON NULL AFTER loan_partners_bn;
