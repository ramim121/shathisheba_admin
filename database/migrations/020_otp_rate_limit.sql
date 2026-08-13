-- Shathi Sheba Admin — migration 020: OTP request throttling.
-- Records the requesting IP on each OTP so request-otp can be rate limited per
-- phone AND per source address. Without this, request-otp was unbounded: an
-- attacker could spend the SMS balance at will, and could reset the 5-attempt
-- verify counter indefinitely by asking for a fresh code between guesses.
-- Idempotent. MySQL 8+.

USE shathi_sheba;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_otps' AND COLUMN_NAME='request_ip');
SET @s := IF(@c=0, 'ALTER TABLE app_otps ADD COLUMN request_ip VARCHAR(45) NULL AFTER phone', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Supports the "how many codes has this address asked for lately" count.
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_otps' AND INDEX_NAME='idx_app_otps_ip_created');
SET @s := IF(@c=0, 'ALTER TABLE app_otps ADD INDEX idx_app_otps_ip_created (request_ip, created_at)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Supports the per-phone window count and the resend-interval check.
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_otps' AND INDEX_NAME='idx_app_otps_phone_created');
SET @s := IF(@c=0, 'ALTER TABLE app_otps ADD INDEX idx_app_otps_phone_created (phone, created_at)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
