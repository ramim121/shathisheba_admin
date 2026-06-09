-- Shathi Sheba Admin — migration 011: livestock listing extra fields
-- The redesigned mobile "List for Sale" flow records the chosen animal, the
-- region (division/district/thana) and multiple photos. Idempotent. MySQL 8+.

USE shathi_sheba;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='animal_id');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN animal_id BIGINT UNSIGNED NULL AFTER sale_item_id', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='division');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN division VARCHAR(120) NULL AFTER address_text', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='district');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN district VARCHAR(120) NULL AFTER division', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='upazila');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN upazila VARCHAR(120) NULL AFTER district', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='media_json');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN media_json JSON NULL AFTER ai_analysis_json', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND INDEX_NAME='idx_listing_animal');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD KEY idx_listing_animal (animal_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
