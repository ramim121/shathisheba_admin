-- Shathi Sheba Admin — migration 002: app alignment
-- Adds FAQ/Help, per-zone officer directory, Ask Shathi Apa prompts,
-- and OTP-based field payment confirmation tables.
-- MySQL 8+, utf8mb4. Idempotent via CREATE TABLE IF NOT EXISTS.

USE shathi_sheba;

-- SRS FR-PROF-04: Help & FAQ screen
CREATE TABLE IF NOT EXISTS faq_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  category VARCHAR(120) NOT NULL DEFAULT 'general',
  question_en VARCHAR(255) NOT NULL,
  question_bn VARCHAR(255) NULL,
  answer_en TEXT NOT NULL,
  answer_bn TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_faq_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SRS FR-COM-03 / FR-COM-04: per-zone Community officer cards
-- Independent of admin_users login so HO Query Officers can be listed without app accounts.
CREATE TABLE IF NOT EXISTS zone_officers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  officer_role ENUM('field_officer','ho_query_officer') NOT NULL DEFAULT 'field_officer',
  name VARCHAR(180) NOT NULL,
  phone VARCHAR(32) NULL,
  district VARCHAR(120) NULL,
  upazila VARCHAR(120) NULL,
  photo_asset_id BIGINT UNSIGNED NULL,
  admin_user_id BIGINT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_zone_officer_photo FOREIGN KEY (photo_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL,
  CONSTRAINT fk_zone_officer_admin FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  INDEX idx_zone_officer_zone (district, upazila, officer_role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "Ask Shathi Apa" home card config + quick-prompt chips
CREATE TABLE IF NOT EXISTS ai_assistant_prompts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  prompt_type ENUM('config','quick_prompt') NOT NULL DEFAULT 'quick_prompt',
  title_en VARCHAR(190) NOT NULL,
  title_bn VARCHAR(190) NULL,
  body_en TEXT NULL,
  body_bn TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_assistant_type_sort (prompt_type, is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SRS FR-LIST-12 / NFR-SEC-04 / field-ops steps 8-10:
-- OTP-based field payment confirmation for sale listings.
CREATE TABLE IF NOT EXISTS payment_confirmations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sale_listing_id BIGINT UNSIGNED NOT NULL,
  actual_weight_kg DECIMAL(10,2) NULL,
  final_amount DECIMAL(12,2) NULL,
  otp_code VARCHAR(8) NULL,
  otp_expires_at DATETIME NULL,
  status ENUM('pending','confirmed','expired','cancelled') NOT NULL DEFAULT 'pending',
  confirmed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_confirmation_listing FOREIGN KEY (sale_listing_id) REFERENCES sale_listings(id) ON DELETE CASCADE,
  INDEX idx_payment_confirmation_status (status, otp_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
