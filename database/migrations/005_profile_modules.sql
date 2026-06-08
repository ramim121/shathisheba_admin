-- Shathi Sheba Admin — migration 005: app profile modules
-- Banking info, farm info, and KYC documents managed from the app Menu and admin.
-- Idempotent. MySQL 8+, utf8mb4.

USE shathi_sheba;

CREATE TABLE IF NOT EXISTS app_user_banking (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  bank_name VARCHAR(160) NULL,
  branch_name VARCHAR(160) NULL,
  account_name VARCHAR(160) NULL,
  account_number VARCHAR(64) NULL,
  mobile_provider ENUM('bkash','nagad','rocket','upay','other') NULL,
  mobile_account VARCHAR(32) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_banking_user (user_id),
  CONSTRAINT fk_banking_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_user_farm (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  total_land_decimals DECIMAL(10,2) NULL,
  primary_focus VARCHAR(120) NULL,
  crop_types VARCHAR(255) NULL,
  livestock_count INT NULL,
  pond_count INT NULL,
  farm_address TEXT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_farm_user (user_id),
  CONSTRAINT fk_farm_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_user_kyc_documents (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  doc_type ENUM('nid_front','nid_back','selfie','trade_license','passbook','other') NOT NULL DEFAULT 'other',
  document_url VARCHAR(500) NOT NULL,
  status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_kyc_user (user_id, doc_type),
  CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
