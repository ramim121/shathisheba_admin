-- Shathi Sheba Admin — migration 023: the evidence workspace (Feature 2, P3 scope).
--
-- Implements SRS §18.3–18.4 / LRG §3, §5–§10: the material an officer captures
-- about an applicant, and the verification state of every piece of it.
--
-- The central design decision is `loan_evidence`. ADM-LON-13 requires that EVERY
-- material field carry the same nine pieces of evidence metadata — source type,
-- source reference, verification status, verifier, collected date, verified date,
-- confidence, discrepancy note. Seventeen bespoke tables would mean writing that
-- metadata seventeen times and getting it subtly different each time; worse, a
-- field added later would quietly arrive without it. One key/value table with the
-- metadata in the row makes the requirement structural: there is nowhere to put a
-- value that does not also have somewhere to put its provenance.
--
-- Only the genuinely repeating collections get their own tables (assets, debts,
-- verification items, documents), because those are rows, not fields.
--
-- Invariants:
--   * Nothing here is ever silently overwritten by a scoring run. This schema is
--     input; credit_assessments (024) snapshots what it read.
--   * A `contradictory` field-verification verdict raises mandatory manual review
--     (ADM-LON-19) — enforced in the endpoint, surfaced by the flag column here.
--   * Money is DECIMAL. No float in the money path.
--
-- Idempotent. MySQL 8+.

USE shathi_sheba;

-- ---------------------------------------------------------------------------
-- Evidence-bearing field values (SRS §18.3.3–18.3.10, ADM-LON-13)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_evidence (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id      BIGINT UNSIGNED NOT NULL,
  section             VARCHAR(40) NOT NULL,   -- kyc | address | enterprise | financial | market | request
  field_key           VARCHAR(80) NOT NULL,   -- e.g. monthly_household_income
  value_text          TEXT NULL,
  value_number        DECIMAL(16,2) NULL,     -- populated when the field is numeric, so
                                              -- the engine can aggregate without parsing
  value_json          JSON NULL,              -- for structured values (geo point, option set)

  -- Evidence metadata. Every row carries it; that is the point of this table.
  source_type         ENUM('self_reported','field_observed','document',
                           'cooperative','transaction') NOT NULL DEFAULT 'self_reported',
  source_reference    VARCHAR(200) NULL,
  verification_status ENUM('unverified','verified','partially_verified',
                           'unable_to_verify','contradictory') NOT NULL DEFAULT 'unverified',
  verified_by         BIGINT UNSIGNED NULL,
  collected_at        DATETIME NULL,
  verified_at         DATETIME NULL,
  confidence          ENUM('low','medium','high') NOT NULL DEFAULT 'low',
  discrepancy_note    VARCHAR(400) NULL,

  is_material         TINYINT(1) NOT NULL DEFAULT 1,  -- counts toward the data-confidence ratio (ENG-20)
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_app_field (application_id, section, field_key),
  INDEX idx_section (application_id, section),
  INDEX idx_verification (application_id, verification_status),
  CONSTRAINT fk_le_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Productive assets (SRS §18.3.7 / LRG §5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_assets (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id      BIGINT UNSIGNED NOT NULL,
  asset_type          ENUM('land','cattle','shed','machinery','equipment',
                           'inventory','premises','other') NOT NULL,
  description         VARCHAR(200) NULL,
  quantity            DECIMAL(14,2) NOT NULL DEFAULT 0,
  unit                VARCHAR(40) NULL,
  estimated_value     DECIMAL(14,2) NOT NULL DEFAULT 0,
  ownership_status    ENUM('owned','leased','shared','mortgaged','disputed','unknown')
                      NOT NULL DEFAULT 'owned',
  verification_status ENUM('unverified','verified','partially_verified',
                           'unable_to_verify','contradictory') NOT NULL DEFAULT 'unverified',
  evidence_url        VARCHAR(500) NULL,
  photo_url           VARCHAR(500) NULL,
  gps_lat             DECIMAL(10,7) NULL,
  gps_lng             DECIMAL(10,7) NULL,
  verified_by         BIGINT UNSIGNED NULL,
  verified_at         DATETIME NULL,
  note                VARCHAR(400) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app (application_id, asset_type),
  CONSTRAINT fk_la_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Existing debt (SRS §18.3.9 / LRG §7)
--
-- Informal and supplier credit belong here as much as bank debt. A borrower whose
-- only recorded obligations are formal looks far safer than they are, and that is
-- exactly the applicant the scorecard must not over-rate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_existing_debts (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id      BIGINT UNSIGNED NOT NULL,
  lender_name         VARCHAR(160) NOT NULL,
  lender_type         ENUM('bank','mfi','cooperative','supplier','informal','family','other')
                      NOT NULL DEFAULT 'other',
  loan_type           VARCHAR(80) NULL,
  original_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  outstanding_amount  DECIMAL(14,2) NOT NULL DEFAULT 0,
  installment_amount  DECIMAL(14,2) NOT NULL DEFAULT 0,
  installment_freq    ENUM('weekly','biweekly','monthly','quarterly','seasonal','one_time')
                      NOT NULL DEFAULT 'monthly',
  remaining_tenure_months SMALLINT UNSIGNED NULL,
  payment_status      ENUM('current','1_30_late','31_60_late','61_90_late',
                           'over_90_late','rescheduled','defaulted') NOT NULL DEFAULT 'current',
  late_payments_12m   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  was_rescheduled     TINYINT(1) NOT NULL DEFAULT 0,
  had_default         TINYINT(1) NOT NULL DEFAULT 0,
  verification_status ENUM('unverified','verified','partially_verified',
                           'unable_to_verify','contradictory') NOT NULL DEFAULT 'unverified',
  note                VARCHAR(400) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app (application_id, payment_status),
  CONSTRAINT fk_led_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Field verification — eleven items, five verdicts (SRS §18.4 / LRG §10)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_verification_items (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code                VARCHAR(40) NOT NULL,
  label_bn            VARCHAR(160) NOT NULL,
  label_en            VARCHAR(160) NOT NULL,
  guidance_bn         VARCHAR(400) NULL,
  guidance_en         VARCHAR(400) NULL,
  sort_order          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loan_field_verifications (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id      BIGINT UNSIGNED NOT NULL,
  item_code           VARCHAR(40) NOT NULL,
  verdict             ENUM('verified','partially_verified','self_reported_only',
                           'unable_to_verify','contradictory') NOT NULL DEFAULT 'self_reported_only',
  comment             VARCHAR(600) NULL,
  photo_url           VARCHAR(500) NULL,
  document_url        VARCHAR(500) NULL,
  gps_lat             DECIMAL(10,7) NULL,
  gps_lng             DECIMAL(10,7) NULL,
  verified_by         BIGINT UNSIGNED NULL,
  verified_at         DATETIME NULL,
  reverify_requested  TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_app_item (application_id, item_code),
  INDEX idx_verdict (application_id, verdict),
  CONSTRAINT fk_lfv_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Visit scheduling (ADM-LON-20)
CREATE TABLE IF NOT EXISTS loan_field_visits (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id      BIGINT UNSIGNED NOT NULL,
  officer_id          BIGINT UNSIGNED NULL,
  proposed_at         DATETIME NOT NULL,
  status              ENUM('proposed','confirmed','declined','completed','cancelled')
                      NOT NULL DEFAULT 'proposed',
  confirmed_at        DATETIME NULL,
  completed_at        DATETIME NULL,
  gps_lat             DECIMAL(10,7) NULL,
  gps_lng             DECIMAL(10,7) NULL,
  note                VARCHAR(400) NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app (application_id, status),
  CONSTRAINT fk_lfvis_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Loan documents (SRS §18.3.5 / LRG §3.3, §11)
-- Files live in the private S3 kyc/ folder and are served through the existing
-- ownership-checked presign route; only the key is stored here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_documents (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id      BIGINT UNSIGNED NOT NULL,
  doc_type            VARCHAR(60) NOT NULL,   -- nid_front | nid_back | photograph | signature | ...
  file_key            VARCHAR(500) NOT NULL,
  status              ENUM('uploaded','verified','rejected','expired','re_requested')
                      NOT NULL DEFAULT 'uploaded',
  rejection_reason    VARCHAR(400) NULL,
  expires_on          DATE NULL,
  is_required         TINYINT(1) NOT NULL DEFAULT 0,
  uploaded_by         BIGINT UNSIGNED NULL,
  verified_by         BIGINT UNSIGNED NULL,
  verified_at         DATETIME NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app (application_id, doc_type),
  INDEX idx_status (application_id, status),
  CONSTRAINT fk_ld_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Application-level flags the engine and the queue both read
-- ---------------------------------------------------------------------------
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications'
      AND COLUMN_NAME = 'manual_review_required') = 0,
  'ALTER TABLE loan_applications ADD COLUMN manual_review_required TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications'
      AND COLUMN_NAME = 'manual_review_reason') = 0,
  'ALTER TABLE loan_applications ADD COLUMN manual_review_reason VARCHAR(400) NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- Seed: the eleven verification items (ADM-LON-16)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO loan_verification_items (code, label_bn, label_en, sort_order) VALUES
 ('identity',            'পরিচয় যাচাই',                 'Identity',                          1),
 ('residence',           'বসবাসের ঠিকানা',              'Residence',                         2),
 ('enterprise_exists',   'খামার/ব্যবসার অস্তিত্ব',        'Farm or business exists',           3),
 ('assets',              'উৎপাদনশীল সম্পদ',              'Productive assets',                 4),
 ('production_capacity', 'উৎপাদন সক্ষমতা',               'Production capacity',               5),
 ('enterprise_activity', 'ব্যবসায়িক কার্যক্রম',           'Enterprise activity',               6),
 ('cooperative',         'সমিতির সদস্যপদ',               'Cooperative membership',            7),
 ('reputation',          'স্থানীয় সুনাম ও তথ্যসূত্র',      'Local reputation and references',   8),
 ('digigram_history',    'ডিজিগ্রাম অংশগ্রহণ',            'Existing DigiGram participation',   9),
 ('project_compliance',  'প্রকল্পের শর্ত পালন',           'Project compliance',               10),
 ('consistency',         'তথ্যের সঙ্গতি',                 'Information consistency',          11);
