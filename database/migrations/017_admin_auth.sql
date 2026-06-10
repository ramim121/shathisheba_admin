-- Shathi Sheba Admin — migration 017: admin authentication sessions
-- Cookie-based admin login. admin_users already exists (migration 001); this adds
-- the session store that backs the login cookie. Idempotent. MySQL 8+.

USE shathi_sheba;

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  token VARCHAR(128) NOT NULL UNIQUE,
  user_agent VARCHAR(255) NULL,
  ip VARCHAR(64) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_admin_session_user (admin_user_id),
  INDEX idx_admin_session_expiry (expires_at),
  CONSTRAINT fk_admin_session_user FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
