-- Shathi Sheba Admin — migration 012: project redesign
-- partner_projects gains: category (interest_slug, incl hidden inputs/machinery),
-- region (division + thana via existing upazila), media/timeframe/market/investment,
-- region-based-vs-open flag, lifecycle is_active, and operational charges (opex).
-- sale_pricing_rules gains partner_project_id so a project carries its B2B presets.
-- Idempotent. MySQL 8+.

USE shathi_sheba;

-- ── partner_projects columns ────────────────────────────────────────────────
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='interest_slug');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN interest_slug VARCHAR(120) NULL AFTER name_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='division');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN division VARCHAR(120) NULL AFTER interest_slug', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='image_url');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN image_url VARCHAR(500) NULL AFTER upazila', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='summary_en');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN summary_en TEXT NULL AFTER image_url', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='summary_bn');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN summary_bn TEXT NULL AFTER summary_en', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='market_overview_en');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN market_overview_en TEXT NULL AFTER summary_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='market_overview_bn');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN market_overview_bn TEXT NULL AFTER market_overview_en', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='investment_amount');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN investment_amount DECIMAL(14,2) NULL AFTER market_overview_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='duration_label');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN duration_label VARCHAR(120) NULL AFTER investment_amount', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='region_based');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN region_based TINYINT(1) NOT NULL DEFAULT 1 AFTER duration_label', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='is_active');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER region_based', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='platform_fee');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN platform_fee DECIMAL(12,2) NULL AFTER is_active', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='logistics_fee');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN logistics_fee DECIMAL(12,2) NULL AFTER platform_fee', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND COLUMN_NAME='warehouse_vet_fee');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD COLUMN warehouse_vet_fee DECIMAL(12,2) NULL AFTER logistics_fee', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_projects' AND INDEX_NAME='idx_project_region');
SET @s := IF(@c=0, 'ALTER TABLE partner_projects ADD KEY idx_project_region (division, district, interest_slug)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── sale_pricing_rules: optional link to a partner project ───────────────────
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_pricing_rules' AND COLUMN_NAME='partner_project_id');
SET @s := IF(@c=0, 'ALTER TABLE sale_pricing_rules ADD COLUMN partner_project_id BIGINT UNSIGNED NULL AFTER id', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_pricing_rules' AND INDEX_NAME='idx_pricing_project');
SET @s := IF(@c=0, 'ALTER TABLE sale_pricing_rules ADD KEY idx_pricing_project (partner_project_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Backfill category + region on the two seeded projects so the app filters work.
UPDATE partner_projects SET interest_slug = 'livestock-poultry', division = 'Mymensingh'
  WHERE project_code = 'PRJ-2024-EID' AND interest_slug IS NULL;
UPDATE partner_projects SET interest_slug = 'crops', division = 'Rangpur'
  WHERE project_code = 'PRJ-2025-BORO' AND interest_slug IS NULL;
