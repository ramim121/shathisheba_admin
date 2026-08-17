-- Shathi Sheba Admin — migration 026: lenders, submissions and notifications.
--
-- Implements SRS §20.1 (ADM-LON-26…30) and §23. Closes the last of P6 apart from
-- the pack renderer itself, which is code rather than schema.
--
-- Two things this schema exists to make impossible:
--
--   * **Cross-tenant leakage** (ADM-LON-28). A lender sees their own pipeline and
--     nothing else. Every submission belongs to exactly one lender, and every
--     view or export of a pack is logged — `lender_pack_access` is an audit
--     table, not a cache, which is why it has no unique key and is never updated.
--
--   * **Sharing without consent** (ADM-LON-30). `share_with_lender` must be
--     granted and current at the moment of submission. The check is in the
--     endpoint because it has to read `loan_consents`, but `consent_verified_at`
--     records that it happened, so a submission with a null there is visibly
--     wrong rather than quietly unchecked.
--
-- Idempotent. MySQL 8+.

USE shathi_sheba;

CREATE TABLE IF NOT EXISTS lenders (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code              VARCHAR(40) NOT NULL,
  name_bn           VARCHAR(160) NOT NULL,
  name_en           VARCHAR(160) NOT NULL,
  lender_type       ENUM('bank','mfi','ngo','development_partner','cooperative','other')
                    NOT NULL DEFAULT 'bank',
  contact_name      VARCHAR(160) NULL,
  contact_email     VARCHAR(200) NULL,
  contact_phone     VARCHAR(40) NULL,
  -- Lender-specific requirements (ADM-LON-38): minimum grade, maximum amount,
  -- required confidence. Kept as configuration so onboarding a lender is data.
  min_grade         ENUM('A','B','C','D') NULL,
  min_confidence    ENUM('high','medium','low') NULL,
  max_amount        DECIMAL(14,2) NULL,
  notes             VARCHAR(400) NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lender_submissions (
  id                    BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id        BIGINT UNSIGNED NOT NULL,
  lender_id             BIGINT UNSIGNED NOT NULL,
  assessment_id         BIGINT UNSIGNED NULL,

  status                ENUM('prepared','submitted','under_review','info_requested',
                             'approved','declined','withdrawn') NOT NULL DEFAULT 'prepared',
  submitted_amount      DECIMAL(14,2) NULL,
  approved_amount       DECIMAL(14,2) NULL,
  conditions            VARCHAR(600) NULL,

  -- ADM-LON-29. A free-text reason cannot be learned from; the structured code
  -- can. Both are kept — the code for the model, the text for the human.
  decline_reason_code   VARCHAR(60) NULL,
  decline_reason_text   VARCHAR(600) NULL,
  info_requested_text   VARCHAR(600) NULL,

  -- ADM-LON-30. Null here means nobody checked, which is different from "checked
  -- and consent was present". A submission must never be able to look compliant
  -- because the field was simply left alone.
  consent_verified_at   DATETIME NULL,
  consent_version       VARCHAR(30) NULL,

  submitted_by          BIGINT UNSIGNED NULL,
  submitted_at          DATETIME NULL,
  decided_at            DATETIME NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_app_lender (application_id, lender_id),
  INDEX idx_lender_status (lender_id, status),
  INDEX idx_application (application_id, status),
  -- Foreign-key names are schema-global in MySQL, and `fk_ls_*` is already taken
  -- by loan_safeguards in migration 024. Prefixed `lsub` to keep them distinct.
  CONSTRAINT fk_lsub_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE,
  CONSTRAINT fk_lsub_lender FOREIGN KEY (lender_id) REFERENCES lenders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lender_submission_events (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  submission_id     BIGINT UNSIGNED NOT NULL,
  from_status       VARCHAR(30) NULL,
  to_status         VARCHAR(30) NOT NULL,
  note              VARCHAR(600) NULL,
  actor_admin_id    BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_submission (submission_id, created_at),
  CONSTRAINT fk_lse_sub FOREIGN KEY (submission_id) REFERENCES lender_submissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ADM-LON-28. Every pack view and export, appended never updated.
CREATE TABLE IF NOT EXISTS lender_pack_access (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id    BIGINT UNSIGNED NOT NULL,
  lender_id         BIGINT UNSIGNED NULL,
  admin_user_id     BIGINT UNSIGNED NULL,
  action            ENUM('view','export_csv','export_pdf') NOT NULL,
  ip_address        VARCHAR(64) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_application (application_id, created_at),
  INDEX idx_lender (lender_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Notifications (SRS §23). A queue rather than a fire-and-forget send: an SMS
-- that failed silently is indistinguishable from one nobody read, and repayment
-- reminders are the ones where that difference costs money.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance_notifications (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  application_id    BIGINT UNSIGNED NULL,
  loan_account_id   BIGINT UNSIGNED NULL,
  kind              VARCHAR(60) NOT NULL,   -- due_soon | due_today | overdue | assessed | disbursed | ...
  channel           ENUM('sms','push','in_app') NOT NULL DEFAULT 'sms',
  title_bn          VARCHAR(200) NULL,
  title_en          VARCHAR(200) NULL,
  body_bn           VARCHAR(600) NOT NULL,
  body_en           VARCHAR(600) NOT NULL,
  -- One notification per user, kind and subject per day. Without this a retry or
  -- a second cron run sends a farmer the same reminder twice, which trains people
  -- to ignore them.
  dedupe_key        VARCHAR(160) NOT NULL,
  status            ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  attempts          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error        VARCHAR(400) NULL,
  scheduled_for     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at           DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dedupe (dedupe_key),
  INDEX idx_queue (status, scheduled_for),
  INDEX idx_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed: a small set of pilot lenders, inactive until someone configures them.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO lenders (code, name_bn, name_en, lender_type, min_grade, min_confidence, is_active) VALUES
 ('pilot_bank',    'অংশীদার ব্যাংক',        'Partner Bank',              'bank',                'B', 'medium', 0),
 ('pilot_mfi',     'অংশীদার এমএফআই',        'Partner MFI',               'mfi',                 'C', 'low',    0),
 ('pilot_devfin',  'উন্নয়ন অর্থায়ন অংশীদার', 'Development Finance Partner','development_partner', 'C', 'low',    0);
