-- Shathi Sheba Admin initial MySQL schema
-- MySQL 8+, utf8mb4 for Bangla content, JSON columns for flexible app payloads.

CREATE DATABASE IF NOT EXISTS shathi_sheba
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE shathi_sheba;

CREATE TABLE admin_users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(32) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('super_admin','hq_admin','marketplace_manager','content_editor','field_officer','auditor') NOT NULL DEFAULT 'hq_admin',
  district VARCHAR(120) NULL,
  upazila VARCHAR(120) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE app_users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  full_name VARCHAR(180) NOT NULL,
  display_name VARCHAR(120) NULL,
  phone VARCHAR(32) NOT NULL UNIQUE,
  email VARCHAR(190) NULL,
  gender ENUM('male','female','other','undisclosed') NULL,
  date_of_birth DATE NULL,
  district VARCHAR(120) NULL,
  upazila VARCHAR(120) NULL,
  union_name VARCHAR(120) NULL,
  village VARCHAR(160) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  status ENUM('active','suspended','pending') NOT NULL DEFAULT 'active',
  profile_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app_users_location (district, upazila)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE media_assets (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  owner_type VARCHAR(80) NOT NULL,
  owner_id BIGINT UNSIGNED NULL,
  asset_type ENUM('image','video','document','icon','thumbnail') NOT NULL,
  title VARCHAR(190) NULL,
  alt_text VARCHAR(255) NULL,
  url TEXT NOT NULL,
  mime_type VARCHAR(120) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  metadata JSON NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_media_owner (owner_type, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE interest_categories (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  parent_id BIGINT UNSIGNED NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  name_en VARCHAR(160) NOT NULL,
  name_bn VARCHAR(160) NULL,
  description_en TEXT NULL,
  description_bn TEXT NULL,
  icon_asset_id BIGINT UNSIGNED NULL,
  emoji VARCHAR(16) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  step_group VARCHAR(80) NULL,
  is_selectable TINYINT(1) NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_interest_parent FOREIGN KEY (parent_id) REFERENCES interest_categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_interest_icon FOREIGN KEY (icon_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL,
  INDEX idx_interest_parent (parent_id),
  INDEX idx_interest_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_interests (
  user_id BIGINT UNSIGNED NOT NULL,
  interest_category_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, interest_category_id),
  CONSTRAINT fk_user_interests_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_interests_category FOREIGN KEY (interest_category_id) REFERENCES interest_categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE weather_alerts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  district VARCHAR(120) NOT NULL,
  upazila VARCHAR(120) NULL,
  alert_type ENUM('forecast','rain','wind','flood','heat','cold','maritime','field_advice','custom') NOT NULL DEFAULT 'custom',
  severity ENUM('info','advisory','watch','warning','critical') NOT NULL DEFAULT 'info',
  title_en VARCHAR(190) NOT NULL,
  title_bn VARCHAR(190) NULL,
  body_en TEXT NOT NULL,
  body_bn TEXT NULL,
  weather_payload JSON NULL,
  source ENUM('weather_server','admin_local','hybrid') NOT NULL DEFAULT 'admin_local',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NULL,
  send_push TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_weather_location_time (district, upazila, starts_at),
  INDEX idx_weather_active (is_active, severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE market_updates (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  title_en VARCHAR(190) NOT NULL,
  title_bn VARCHAR(190) NULL,
  body_en TEXT NULL,
  body_bn TEXT NULL,
  update_type ENUM('price','stock','training','weather','project','notice') NOT NULL,
  district VARCHAR(120) NULL,
  upazila VARCHAR(120) NULL,
  status ENUM('draft','active','expired') NOT NULL DEFAULT 'draft',
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_market_status_location (status, district, upazila)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sale_categories (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  slug VARCHAR(120) NOT NULL UNIQUE,
  name_en VARCHAR(160) NOT NULL,
  name_bn VARCHAR(160) NULL,
  description_en TEXT NULL,
  description_bn TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sale_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sale_category_id BIGINT UNSIGNED NOT NULL,
  slug VARCHAR(120) NOT NULL,
  name_en VARCHAR(160) NOT NULL,
  name_bn VARCHAR(160) NULL,
  description_en TEXT NULL,
  description_bn TEXT NULL,
  status ENUM('active','soon','inactive') NOT NULL DEFAULT 'active',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sale_item_slug (sale_category_id, slug),
  CONSTRAINT fk_sale_items_category FOREIGN KEY (sale_category_id) REFERENCES sale_categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE animal_breeds (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  animal_type VARCHAR(80) NOT NULL,
  name_en VARCHAR(160) NOT NULL,
  name_bn VARCHAR(160) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_animal_type (animal_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sale_pricing_rules (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sale_item_id BIGINT UNSIGNED NOT NULL,
  district VARCHAR(120) NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  b2b_market_rate DECIMAL(12,2) NOT NULL,
  farmer_rate DECIMAL(12,2) NOT NULL,
  platform_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  logistics_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  warehouse_vet_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit VARCHAR(40) NOT NULL DEFAULT 'kg',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sale_pricing_item FOREIGN KEY (sale_item_id) REFERENCES sale_items(id),
  INDEX idx_sale_pricing_lookup (sale_item_id, district, is_active, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sale_listings (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  listing_code VARCHAR(40) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  sale_item_id BIGINT UNSIGNED NOT NULL,
  breed_id BIGINT UNSIGNED NULL,
  title_en VARCHAR(190) NULL,
  title_bn VARCHAR(190) NULL,
  age_months INT NULL,
  weight_kg DECIMAL(10,2) NULL,
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit VARCHAR(40) NOT NULL DEFAULT 'piece',
  farmer_expected_price DECIMAL(12,2) NULL,
  estimated_earning DECIMAL(12,2) NULL,
  contact_phone VARCHAR(32) NULL,
  address_text TEXT NULL,
  ai_analysis_json JSON NULL,
  status ENUM('draft','submitted','field_verification','active','sold','rejected','cancelled') NOT NULL DEFAULT 'submitted',
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sale_listing_user FOREIGN KEY (user_id) REFERENCES app_users(id),
  CONSTRAINT fk_sale_listing_item FOREIGN KEY (sale_item_id) REFERENCES sale_items(id),
  CONSTRAINT fk_sale_listing_breed FOREIGN KEY (breed_id) REFERENCES animal_breeds(id) ON DELETE SET NULL,
  INDEX idx_sale_listing_status (status, created_at),
  INDEX idx_sale_listing_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE buy_categories (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  slug VARCHAR(120) NOT NULL UNIQUE,
  name_en VARCHAR(160) NOT NULL,
  name_bn VARCHAR(160) NULL,
  description_en TEXT NULL,
  description_bn TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE products (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  buy_category_id BIGINT UNSIGNED NOT NULL,
  sku VARCHAR(80) NOT NULL UNIQUE,
  name_en VARCHAR(190) NOT NULL,
  name_bn VARCHAR(190) NULL,
  short_description_en TEXT NULL,
  short_description_bn TEXT NULL,
  unit VARCHAR(40) NOT NULL,
  package_size VARCHAR(80) NULL,
  price DECIMAL(12,2) NOT NULL,
  stock_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
  low_stock_threshold DECIMAL(12,2) NOT NULL DEFAULT 10,
  delivery_window VARCHAR(120) NULL,
  status ENUM('draft','active','out_of_stock','inactive') NOT NULL DEFAULT 'draft',
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_buy_category FOREIGN KEY (buy_category_id) REFERENCES buy_categories(id),
  INDEX idx_products_status_category (status, buy_category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE orders (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_code VARCHAR(40) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  payable_amount DECIMAL(12,2) NOT NULL,
  payment_method ENUM('cash','bkash','nagad','bank','credit','other') NOT NULL DEFAULT 'cash',
  payment_status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  fulfillment_status ENUM('placed','confirmed','assigned','in_transit','delivered','cancelled') NOT NULL DEFAULT 'placed',
  delivery_address TEXT NOT NULL,
  district VARCHAR(120) NULL,
  upazila VARCHAR(120) NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES app_users(id),
  INDEX idx_orders_status (payment_status, fulfillment_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE order_items (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE learning_categories (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  slug VARCHAR(120) NOT NULL UNIQUE,
  name_en VARCHAR(160) NOT NULL,
  name_bn VARCHAR(160) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE learning_modules (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  learning_category_id BIGINT UNSIGNED NOT NULL,
  title_en VARCHAR(190) NOT NULL,
  title_bn VARCHAR(190) NULL,
  subtitle_en VARCHAR(255) NULL,
  subtitle_bn VARCHAR(255) NULL,
  thumbnail_asset_id BIGINT UNSIGNED NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_learning_modules_category FOREIGN KEY (learning_category_id) REFERENCES learning_categories(id),
  CONSTRAINT fk_learning_modules_thumb FOREIGN KEY (thumbnail_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL,
  INDEX idx_learning_status (status, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE learning_contents (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  learning_module_id BIGINT UNSIGNED NOT NULL,
  content_type ENUM('article','video','quiz') NOT NULL,
  title_en VARCHAR(190) NOT NULL,
  title_bn VARCHAR(190) NULL,
  body_en LONGTEXT NULL,
  body_bn LONGTEXT NULL,
  video_url TEXT NULL,
  duration_seconds INT NULL,
  quiz_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_learning_contents_module FOREIGN KEY (learning_module_id) REFERENCES learning_modules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_learning_progress (
  user_id BIGINT UNSIGNED NOT NULL,
  learning_content_id BIGINT UNSIGNED NOT NULL,
  status ENUM('not_started','in_progress','completed') NOT NULL DEFAULT 'not_started',
  completed_at DATETIME NULL,
  score DECIMAL(5,2) NULL,
  PRIMARY KEY (user_id, learning_content_id),
  CONSTRAINT fk_learning_progress_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_learning_progress_content FOREIGN KEY (learning_content_id) REFERENCES learning_contents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE partner_projects (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  project_code VARCHAR(60) NOT NULL UNIQUE,
  name_en VARCHAR(190) NOT NULL,
  name_bn VARCHAR(190) NULL,
  lender_name VARCHAR(190) NULL,
  district VARCHAR(120) NULL,
  upazila VARCHAR(120) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  capacity INT NOT NULL DEFAULT 0,
  max_credit_amount DECIMAL(12,2) NULL,
  status ENUM('draft','open','opening_soon','closed','completed') NOT NULL DEFAULT 'draft',
  steps_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_partner_projects_status (status, district, upazila)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE partner_applications (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_code VARCHAR(60) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  partner_project_id BIGINT UNSIGNED NOT NULL,
  current_step ENUM('project_selection','personal_kyc','banking_info','farm_assessment','field_verification','approval','rejected') NOT NULL DEFAULT 'project_selection',
  full_name_per_nid VARCHAR(190) NULL,
  nid_number VARCHAR(32) NULL,
  total_land_decimals DECIMAL(10,2) NULL,
  livestock_count INT NULL,
  primary_income_source VARCHAR(120) NULL,
  annual_household_income DECIMAL(12,2) NULL,
  mobile_banking_provider VARCHAR(80) NULL,
  banking_json JSON NULL,
  farm_assessment_json JSON NULL,
  verification_notes TEXT NULL,
  status ENUM('draft','submitted','needs_document','officer_verification','ready_to_approve','approved','rejected') NOT NULL DEFAULT 'draft',
  assigned_officer_id BIGINT UNSIGNED NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_partner_app_user FOREIGN KEY (user_id) REFERENCES app_users(id),
  CONSTRAINT fk_partner_app_project FOREIGN KEY (partner_project_id) REFERENCES partner_projects(id),
  INDEX idx_partner_app_status (status, current_step)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_ledgers (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  partner_application_id BIGINT UNSIGNED NOT NULL,
  entry_type ENUM('input','vet_care','payment','profit_share','settlement','adjustment') NOT NULL,
  title_en VARCHAR(190) NOT NULL,
  title_bn VARCHAR(190) NULL,
  amount DECIMAL(12,2) NOT NULL,
  entry_date DATE NOT NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_project_ledger_application FOREIGN KEY (partner_application_id) REFERENCES partner_applications(id) ON DELETE CASCADE,
  INDEX idx_project_ledger_date (entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE community_posts (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  scope ENUM('upazila','district','bangladesh') NOT NULL DEFAULT 'upazila',
  post_type ENUM('general','question','livestock','crop','complaint','notice') NOT NULL DEFAULT 'general',
  body TEXT NOT NULL,
  district VARCHAR(120) NULL,
  upazila VARCHAR(120) NULL,
  status ENUM('visible','answered','hidden','moderation','removed') NOT NULL DEFAULT 'visible',
  like_count INT NOT NULL DEFAULT 0,
  comment_count INT NOT NULL DEFAULT 0,
  report_count INT NOT NULL DEFAULT 0,
  moderated_by BIGINT UNSIGNED NULL,
  moderated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_community_posts_user FOREIGN KEY (user_id) REFERENCES app_users(id),
  INDEX idx_community_feed (scope, district, upazila, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE community_comments (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  community_post_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  status ENUM('visible','hidden','removed') NOT NULL DEFAULT 'visible',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_community_comments_post FOREIGN KEY (community_post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_community_comments_user FOREIGN KEY (user_id) REFERENCES app_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_campaigns (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  title_en VARCHAR(190) NOT NULL,
  title_bn VARCHAR(190) NULL,
  body_en TEXT NOT NULL,
  body_bn TEXT NULL,
  target_json JSON NOT NULL,
  campaign_type ENUM('weather','market','learning','order','project','community','custom') NOT NULL DEFAULT 'custom',
  status ENUM('draft','scheduled','sent','cancelled') NOT NULL DEFAULT 'draft',
  scheduled_at DATETIME NULL,
  sent_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  actor_admin_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  ip_address VARCHAR(64) NULL,
  user_agent TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_actor_time (actor_admin_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
