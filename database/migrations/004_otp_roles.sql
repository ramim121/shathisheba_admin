-- Shathi Sheba Admin — migration 004: phone+OTP auth, app roles, profile fields
-- - app_otps: one-time codes for phone login (BulkSMSBD).
-- - app_users: profile_image_url + personal_info_completed.
-- - app_user_roles: per-user roles (field_officer / shathisheba_seller / shathisheba_buyer).
-- Idempotent. MySQL 8+, utf8mb4.

USE shathi_sheba;

CREATE TABLE IF NOT EXISTS app_otps (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  phone VARCHAR(32) NOT NULL,
  code VARCHAR(8) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_app_otps_phone (phone, consumed, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- app_users.profile_image_url
SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND COLUMN_NAME = 'profile_image_url');
SET @s1 := IF(@c1 = 0, 'ALTER TABLE app_users ADD COLUMN profile_image_url VARCHAR(500) NULL AFTER display_name', 'SELECT 1');
PREPARE st1 FROM @s1; EXECUTE st1; DEALLOCATE PREPARE st1;

-- app_users.personal_info_completed
SET @c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND COLUMN_NAME = 'personal_info_completed');
SET @s2 := IF(@c2 = 0, 'ALTER TABLE app_users ADD COLUMN personal_info_completed TINYINT(1) NOT NULL DEFAULT 0 AFTER status', 'SELECT 1');
PREPARE st2 FROM @s2; EXECUTE st2; DEALLOCATE PREPARE st2;

CREATE TABLE IF NOT EXISTS app_user_roles (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('field_officer','shathisheba_seller','shathisheba_buyer') NOT NULL,
  assigned_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_role (user_id, role),
  CONSTRAINT fk_app_user_role_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Give every existing app user the default buyer role.
INSERT IGNORE INTO app_user_roles (user_id, role)
SELECT id, 'shathisheba_buyer' FROM app_users;
