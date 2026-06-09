-- Shathi Sheba Admin — migration 014: user KYC verified flag
-- Lets the app pre-fill + lock name/gender from the verified profile in the KYC
-- survey once a user's identity (NID/DOB) is verified. Idempotent.

USE shathi_sheba;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_users' AND COLUMN_NAME='is_kyc_verified');
SET @s := IF(@c=0, 'ALTER TABLE app_users ADD COLUMN is_kyc_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER personal_info_completed', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_users' AND COLUMN_NAME='nid_number');
SET @s := IF(@c=0, 'ALTER TABLE app_users ADD COLUMN nid_number VARCHAR(32) NULL AFTER is_kyc_verified', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
