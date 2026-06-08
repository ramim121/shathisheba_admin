-- Shathi Sheba Admin — migration 003: app user authentication + preferences
-- Adds password storage to app_users and a session table for the mobile app
-- phone+password login (auto-register on first login). Idempotent.
-- MySQL 8+, utf8mb4.

USE shathi_sheba;

-- app_users.password_hash (scrypt hash written by lib/auth.ts).
-- MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so guard via information_schema.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND COLUMN_NAME = 'password_hash'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE app_users ADD COLUMN password_hash VARCHAR(255) NULL AFTER email',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Mobile app login sessions (opaque token kept by the app to stay signed in).
CREATE TABLE IF NOT EXISTS app_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token CHAR(64) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  CONSTRAINT fk_app_session_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  INDEX idx_app_session_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
