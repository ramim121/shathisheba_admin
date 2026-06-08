-- Shathi Sheba Admin — migration 006: market update detail/blog + image + category
-- Enriches market_updates so the app can show a detail (blog) view with image and
-- long-form content, plus optional location targeting (district/upazila already exist).
-- Idempotent. MySQL 8+.

USE shathi_sheba;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='market_updates' AND COLUMN_NAME='image_url');
SET @s := IF(@c=0, 'ALTER TABLE market_updates ADD COLUMN image_url VARCHAR(500) NULL AFTER body_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='market_updates' AND COLUMN_NAME='detail_en');
SET @s := IF(@c=0, 'ALTER TABLE market_updates ADD COLUMN detail_en LONGTEXT NULL AFTER image_url', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='market_updates' AND COLUMN_NAME='detail_bn');
SET @s := IF(@c=0, 'ALTER TABLE market_updates ADD COLUMN detail_bn LONGTEXT NULL AFTER detail_en', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='market_updates' AND COLUMN_NAME='category');
SET @s := IF(@c=0, 'ALTER TABLE market_updates ADD COLUMN category VARCHAR(80) NULL AFTER update_type', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
