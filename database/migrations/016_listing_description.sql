-- Shathi Sheba Admin — migration 016: listing description + contact person
-- All listing types (cattle, inputs, machinery) get a free-text description
-- field (often AI-generated from the uploaded media). The contact person can be
-- the seller ("me") or someone else; capture their name + NID. Idempotent. MySQL 8+.

USE shathi_sheba;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='description');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN description TEXT NULL AFTER title_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='contact_name');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN contact_name VARCHAR(190) NULL AFTER contact_phone', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='contact_nid');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN contact_nid VARCHAR(32) NULL AFTER contact_name', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sale_listings' AND COLUMN_NAME='contact_is_self');
SET @s := IF(@c=0, 'ALTER TABLE sale_listings ADD COLUMN contact_is_self TINYINT(1) NOT NULL DEFAULT 1 AFTER contact_nid', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
