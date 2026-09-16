-- Listings v2 (2026-09-16)
-- The admin approval step is gone: a listing is never "approved" and never
-- becomes a Buy-from-Shathi product. What the admin does now is record the
-- animal's profile section by section, and each saved section moves the status
-- on by itself. Cancelled and rejected listings stay in the database, stay
-- visible to the farmer, and are excluded from every count.

-- 1. Section tables -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS listing_vaccinations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  listing_id BIGINT UNSIGNED NOT NULL,
  vaccine_name VARCHAR(160) NOT NULL,
  dose_no VARCHAR(40) NULL,
  given_on DATE NULL,
  next_due_on DATE NULL,
  vet_name VARCHAR(160) NULL,
  batch_no VARCHAR(80) NULL,
  notes VARCHAR(500) NULL,
  document_url VARCHAR(500) NULL,
  recorded_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_listing_vaccinations (listing_id, given_on),
  CONSTRAINT fk_listing_vaccinations FOREIGN KEY (listing_id) REFERENCES sale_listings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listing_animal_profile (
  listing_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  deworming_on DATE NULL,
  last_treatment_on DATE NULL,
  last_treatment_note VARCHAR(400) NULL,
  feed_type VARCHAR(160) NULL,
  feeding_note VARCHAR(400) NULL,
  housing_type VARCHAR(160) NULL,
  horn_status ENUM('intact','dehorned','polled') NULL,
  is_castrated TINYINT(1) NULL,
  temperament ENUM('calm','normal','aggressive') NULL,
  colour VARCHAR(120) NULL,
  distinguishing_marks VARCHAR(400) NULL,
  insurance_ref VARCHAR(120) NULL,
  vet_name VARCHAR(160) NULL,
  vet_phone VARCHAR(32) NULL,
  health_notes TEXT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_listing_animal_profile FOREIGN KEY (listing_id) REFERENCES sale_listings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listing_shipments (
  listing_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  dispatched_at DATETIME NULL,
  vehicle_type VARCHAR(80) NULL,
  vehicle_ref VARCHAR(80) NULL,
  driver_name VARCHAR(160) NULL,
  driver_phone VARCHAR(32) NULL,
  transporter VARCHAR(190) NULL,
  from_address VARCHAR(400) NULL,
  to_address VARCHAR(400) NULL,
  expected_arrival_at DATETIME NULL,
  arrived_at DATETIME NULL,
  loading_weight_kg DECIMAL(10,2) NULL,
  condition_note TEXT NULL,
  documents_json JSON NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_listing_shipments FOREIGN KEY (listing_id) REFERENCES sale_listings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Cancellation / rejection, kept but counted nowhere ------------------------

ALTER TABLE sale_listings ADD COLUMN cancelled_at DATETIME NULL AFTER paid_at;
ALTER TABLE sale_listings ADD COLUMN cancel_reason VARCHAR(400) NULL AFTER cancelled_at;
ALTER TABLE sale_listings ADD COLUMN rejected_at DATETIME NULL AFTER cancel_reason;
ALTER TABLE sale_listings ADD COLUMN reject_reason VARCHAR(400) NULL AFTER rejected_at;

-- 3. Contract paperwork --------------------------------------------------------

ALTER TABLE listing_contracts ADD COLUMN contract_file_url VARCHAR(500) NULL;
ALTER TABLE listing_contracts ADD COLUMN documents_json JSON NULL;
ALTER TABLE listing_contracts ADD COLUMN signed_by VARCHAR(190) NULL;
ALTER TABLE listing_contracts ADD COLUMN signed_at DATETIME NULL;
ALTER TABLE listing_contracts ADD COLUMN notes TEXT NULL;

-- 4. Community: system posts are exempt from the per-user daily cap ------------

ALTER TABLE community_posts ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE community_posts ADD COLUMN source_type VARCHAR(24) NULL;
ALTER TABLE community_posts ADD COLUMN source_id BIGINT UNSIGNED NULL;
ALTER TABLE community_posts ADD KEY idx_community_author_day (user_id, is_system, created_at);
ALTER TABLE community_posts ADD KEY idx_community_source (source_type, source_id);

-- 5. Retire the approval-only statuses ----------------------------------------

UPDATE sale_listings SET status = 'verified' WHERE status = 'active';
UPDATE sale_listings SET status = 'contracted' WHERE status = 'sold';
ALTER TABLE sale_listings MODIFY COLUMN status
  ENUM('draft','submitted','field_verification','verified','contracted','shipped','paid','cancelled','rejected')
  NOT NULL DEFAULT 'submitted';

-- 6. Listings that had been published into Buy-from-Shathi are withdrawn.
--    Kept as inactive rows so existing test orders still resolve their product.

UPDATE products SET status = 'inactive'
 WHERE JSON_EXTRACT(metadata, '$.source_listing_id') IS NOT NULL;

-- 7. Notification template for a cancelled listing -----------------------------

INSERT INTO notification_templates
  (event_key, name, category, send_push, send_inapp, send_email,
   title_en, title_bn, body_en, body_bn, email_subject_en, email_subject_bn,
   email_body_en, email_body_bn, cta_label_en, cta_label_bn, is_active)
VALUES
  ('listing_cancelled', 'Listing cancelled', 'listing', 1, 1, 1,
   'Listing cancelled · {{listing_code}}', 'তালিকা বাতিল · {{listing_code}}',
   'Your {{animal}} listing has been cancelled. {{reason}}',
   'আপনার {{animal}} তালিকাটি বাতিল করা হয়েছে। {{reason}}',
   'Your Shathi Sheba listing was cancelled',
   'আপনার শাথী সেবা তালিকা বাতিল হয়েছে',
   'Your **{{animal}}** listing ({{listing_code}}) has been cancelled. {{reason}}\n\nYou can list the animal again at any time from the app.',
   'আপনার **{{animal}}** তালিকাটি ({{listing_code}}) বাতিল করা হয়েছে। {{reason}}\n\nআপনি যেকোনো সময় অ্যাপ থেকে আবার তালিকা দিতে পারেন।',
   'View listing', 'তালিকা দেখুন', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);
