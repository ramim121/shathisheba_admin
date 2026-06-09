-- Shathi Sheba Admin — migration 013: user division
-- app_users already has district + upazila; add division so the app can capture
-- and save the full Division / District / Thana region (GPS + manual). Idempotent.

USE shathi_sheba;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_users' AND COLUMN_NAME='division');
SET @s := IF(@c=0, 'ALTER TABLE app_users ADD COLUMN division VARCHAR(120) NULL AFTER district', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
