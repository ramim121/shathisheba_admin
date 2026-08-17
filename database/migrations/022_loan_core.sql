-- Shathi Sheba Admin — migration 022: Loan Application, Pricing & Repayment (Feature 2, P2 scope).
--
-- Implements SRS §16A, §21.2–21.5 / KB §7, §8.2 for the intake-and-pricing phase:
-- product catalogue with full pricing configuration, the application core and its
-- event log, consents, quotes, and the disbursement/repayment tables.
--
-- Invariants this schema is built to protect:
--   * loan_accounts SNAPSHOTS the terms at disbursement. A later product-rate
--     change must never reach a live loan (DAT-04 / ADM-LON-44).
--   * SUM(loan_repayment_schedule.amount_due) == loan_accounts.total_payable,
--     exactly. The final instalment absorbs the rounding residue (ENG-45 / DAT-05).
--   * Money is DECIMAL everywhere. No float in the money path (ENG-41).
--   * Every quote a farmer is shown is persisted, so a later dispute is
--     answerable from the record (ENG-48).
--
-- Idempotent. MySQL 8+.

USE shathi_sheba;

-- ---------------------------------------------------------------------------
-- Product catalogue + pricing configuration (SRS §16A.3)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_products (
  id                        BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code                      VARCHAR(40) NOT NULL,
  name_bn                   VARCHAR(120) NOT NULL,
  name_en                   VARCHAR(120) NOT NULL,
  description_bn            VARCHAR(400) NULL,
  description_en            VARCHAR(400) NULL,
  icon                      VARCHAR(20) NULL,
  interest_rate_annual      DECIMAL(5,2) NOT NULL DEFAULT 0,
  interest_method           ENUM('flat','reducing_balance') NOT NULL DEFAULT 'flat',
  allowed_tenures_json      JSON NULL,
  allowed_repayment_modes_json JSON NULL,
  min_amount                DECIMAL(14,2) NOT NULL DEFAULT 0,
  max_amount                DECIMAL(14,2) NOT NULL DEFAULT 0,
  amount_step               DECIMAL(14,2) NOT NULL DEFAULT 1000,
  weeks_per_month           TINYINT UNSIGNED NOT NULL DEFAULT 4,
  first_payment_offset_days SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  grace_period_months       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  processing_fee_pct        DECIMAL(5,2) NOT NULL DEFAULT 0,
  processing_fee_flat       DECIMAL(14,2) NOT NULL DEFAULT 0,
  late_penalty_pct          DECIMAL(5,2) NOT NULL DEFAULT 0,
  late_penalty_grace_days   SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  collateral_required       TINYINT(1) NOT NULL DEFAULT 0,
  stage_sla_json            JSON NULL,
  version                   VARCHAR(30) NOT NULL DEFAULT 'v1',
  is_active                 TINYINT(1) NOT NULL DEFAULT 0,
  coming_soon               TINYINT(1) NOT NULL DEFAULT 0,
  sort_order                SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_code (code),
  INDEX idx_catalogue (is_active, coming_soon, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Application core (SRS §21.3)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_applications (
  id                    BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_code      VARCHAR(40) NOT NULL,
  user_id               BIGINT UNSIGNED NOT NULL,
  loan_product_id       BIGINT UNSIGNED NOT NULL,
  linked_project_id     BIGINT UNSIGNED NULL,
  requested_amount      DECIMAL(14,2) NOT NULL,
  recommended_amount    DECIMAL(14,2) NULL,
  approved_amount       DECIMAL(14,2) NULL,
  purpose_code          VARCHAR(60) NOT NULL,
  purpose_text          TEXT NULL,
  tenure_months         SMALLINT UNSIGNED NOT NULL,
  repayment_mode        ENUM('weekly','monthly','one_time') NOT NULL DEFAULT 'monthly',
  quote_id              BIGINT UNSIGNED NULL,
  status                ENUM('draft','submitted','ineligible','kyc_in_progress',
                             'field_verification','behavioral_pending','under_assessment',
                             'assessed','development_required','project_matched',
                             'pending_submission','hard_stopped','submitted_to_lender',
                             'lender_review','info_requested','lender_declined','approved',
                             'disbursed','repaying','overdue','closed','withdrawn','cancelled')
                        NOT NULL DEFAULT 'draft',
  pending_user_action   VARCHAR(60) NULL,
  assigned_officer_id   BIGINT UNSIGNED NULL,
  division              VARCHAR(80) NULL,
  district              VARCHAR(80) NULL,
  upazila               VARCHAR(80) NULL,
  cooperative_id        BIGINT UNSIGNED NULL,
  current_assessment_id BIGINT UNSIGNED NULL,
  needs_correction_note VARCHAR(400) NULL,
  submitted_at          DATETIME NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_application_code (application_code),
  INDEX idx_user (user_id, status),
  INDEX idx_queue (status, district, assigned_officer_id),
  INDEX idx_officer (assigned_officer_id, status),
  CONSTRAINT fk_la_user    FOREIGN KEY (user_id)         REFERENCES app_users(id)     ON DELETE CASCADE,
  CONSTRAINT fk_la_product FOREIGN KEY (loan_product_id) REFERENCES loan_products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The single source of truth for the mobile timeline (ENG-13).
CREATE TABLE IF NOT EXISTS loan_application_events (
  id             BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  from_status    VARCHAR(40) NULL,
  to_status      VARCHAR(40) NOT NULL,
  actor_type     ENUM('user','officer','admin','system') NOT NULL DEFAULT 'system',
  actor_id       BIGINT UNSIGNED NULL,
  actor_name     VARCHAR(120) NULL,
  note_bn        VARCHAR(400) NULL,
  note_en        VARCHAR(400) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_app_time (application_id, created_at),
  CONSTRAINT fk_lae_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Six required consents, each stored as its own versioned row (MOB-LON-10A).
CREATE TABLE IF NOT EXISTS loan_consent_types (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  consent_key   VARCHAR(60) NOT NULL,
  title_bn      VARCHAR(200) NOT NULL,
  title_en      VARCHAR(200) NOT NULL,
  description_bn VARCHAR(400) NULL,
  description_en VARCHAR(400) NULL,
  version       VARCHAR(20) NOT NULL DEFAULT 'v1',
  is_required   TINYINT(1) NOT NULL DEFAULT 1,
  is_revocable  TINYINT(1) NOT NULL DEFAULT 1,
  collected_at_stage ENUM('apply','just_in_time') NOT NULL DEFAULT 'apply',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  sort_order    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_consent_key (consent_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loan_consents (
  id             BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id BIGINT UNSIGNED NOT NULL,
  user_id        BIGINT UNSIGNED NOT NULL,
  consent_key    VARCHAR(60) NOT NULL,
  consent_version VARCHAR(20) NOT NULL DEFAULT 'v1',
  status         ENUM('granted','revoked') NOT NULL DEFAULT 'granted',
  channel        ENUM('app','assisted') NOT NULL DEFAULT 'app',
  acting_user_id BIGINT UNSIGNED NULL,
  acting_admin_id BIGINT UNSIGNED NULL,
  granted_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at     DATETIME NULL,
  UNIQUE KEY uq_app_consent (application_id, consent_key),
  INDEX idx_user (user_id, consent_key),
  CONSTRAINT fk_lc_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Quotes — what the farmer was actually shown (ENG-48)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_quotes (
  id                   BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id              BIGINT UNSIGNED NOT NULL,
  application_id       BIGINT UNSIGNED NULL,
  loan_product_id      BIGINT UNSIGNED NOT NULL,
  product_version      VARCHAR(30) NOT NULL DEFAULT 'v1',
  principal            DECIMAL(14,2) NOT NULL,
  tenure_months        SMALLINT UNSIGNED NOT NULL,
  repayment_mode       ENUM('weekly','monthly','one_time') NOT NULL,
  interest_rate_annual DECIMAL(5,2) NOT NULL,
  interest_method      ENUM('flat','reducing_balance') NOT NULL DEFAULT 'flat',
  total_interest       DECIMAL(14,2) NOT NULL,
  processing_fee       DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_payable        DECIMAL(14,2) NOT NULL,
  installment_count    SMALLINT UNSIGNED NOT NULL,
  emi_amount           DECIMAL(14,2) NOT NULL,
  final_emi_amount     DECIMAL(14,2) NOT NULL,
  effective_annual_rate DECIMAL(6,2) NULL,
  shown_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id, shown_at),
  CONSTRAINT fk_lq_product FOREIGN KEY (loan_product_id) REFERENCES loan_products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Disbursement and repayment (SRS §21.5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_accounts (
  id                    BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id        BIGINT UNSIGNED NOT NULL,
  user_id               BIGINT UNSIGNED NOT NULL,
  loan_product_id       BIGINT UNSIGNED NOT NULL,
  principal             DECIMAL(14,2) NOT NULL,
  interest_rate_annual  DECIMAL(5,2) NOT NULL,
  interest_method       ENUM('flat','reducing_balance') NOT NULL DEFAULT 'flat',
  tenure_months         SMALLINT UNSIGNED NOT NULL,
  repayment_mode        ENUM('weekly','monthly','one_time') NOT NULL,
  weeks_per_month       TINYINT UNSIGNED NOT NULL DEFAULT 4,
  total_interest        DECIMAL(14,2) NOT NULL,
  processing_fee        DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_payable         DECIMAL(14,2) NOT NULL,
  installment_count     SMALLINT UNSIGNED NOT NULL,
  emi_amount            DECIMAL(14,2) NOT NULL,
  final_emi_amount      DECIMAL(14,2) NOT NULL,
  effective_annual_rate DECIMAL(6,2) NULL,
  disbursed_at          DATETIME NOT NULL,
  first_due_date        DATE NOT NULL,
  maturity_date         DATE NOT NULL,
  amount_paid           DECIMAL(14,2) NOT NULL DEFAULT 0,
  outstanding_total     DECIMAL(14,2) NOT NULL,
  next_due_date         DATE NULL,
  next_due_amount       DECIMAL(14,2) NULL,
  overdue_amount        DECIMAL(14,2) NOT NULL DEFAULT 0,
  days_past_due         SMALLINT NOT NULL DEFAULT 0,
  status                ENUM('active','closed','written_off','restructured') NOT NULL DEFAULT 'active',
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_application (application_id),
  INDEX idx_due (next_due_date, status),
  INDEX idx_arrears (days_past_due, status),
  CONSTRAINT fk_lacc_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loan_repayment_schedule (
  id                  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  loan_account_id     BIGINT UNSIGNED NOT NULL,
  installment_no      SMALLINT UNSIGNED NOT NULL,
  due_date            DATE NOT NULL,
  principal_component DECIMAL(14,2) NOT NULL,
  interest_component  DECIMAL(14,2) NOT NULL,
  fee_component       DECIMAL(14,2) NOT NULL DEFAULT 0,
  penalty_accrued     DECIMAL(14,2) NOT NULL DEFAULT 0,
  amount_due          DECIMAL(14,2) NOT NULL,
  amount_paid         DECIMAL(14,2) NOT NULL DEFAULT 0,
  paid_at             DATETIME NULL,
  status              ENUM('pending','due','paid','partial','overdue','waived') NOT NULL DEFAULT 'pending',
  days_overdue        SMALLINT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_acct_inst (loan_account_id, installment_no),
  INDEX idx_due (due_date, status),
  CONSTRAINT fk_lrs_acct FOREIGN KEY (loan_account_id) REFERENCES loan_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loan_repayments (
  id              BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  loan_account_id BIGINT UNSIGNED NOT NULL,
  schedule_id     BIGINT UNSIGNED NULL,
  amount          DECIMAL(14,2) NOT NULL,
  paid_at         DATETIME NOT NULL,
  method          VARCHAR(40) NULL,
  reference       VARCHAR(80) NULL,
  kind            ENUM('payment','waiver','penalty') NOT NULL DEFAULT 'payment',
  recorded_by     BIGINT UNSIGNED NULL,
  note            VARCHAR(255) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_acct (loan_account_id, paid_at),
  CONSTRAINT fk_lrp_acct FOREIGN KEY (loan_account_id) REFERENCES loan_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Loan purposes, admin-editable rather than a hard-coded picker.
CREATE TABLE IF NOT EXISTS loan_purposes (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code       VARCHAR(60) NOT NULL,
  label_bn   VARCHAR(160) NOT NULL,
  label_en   VARCHAR(160) NOT NULL,
  icon       VARCHAR(20) NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed — product catalogue (SRS §16A.1–2, KB §7.7)
-- Three active, six coming-soon. Amount bounds are the spec placeholders and are
-- admin-editable; activating a product later is a config change, not a release.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO loan_products
 (code,name_bn,name_en,description_bn,description_en,icon,interest_rate_annual,interest_method,
  allowed_tenures_json,allowed_repayment_modes_json,min_amount,max_amount,amount_step,
  weeks_per_month,first_payment_offset_days,collateral_required,is_active,coming_soon,sort_order)
VALUES ('livestock','গবাদি পশু ঋণ','Livestock loan',
   'গরু, ছাগল বা হাঁস-মুরগি পালনের জন্য','For cattle, goat or poultry rearing','🐄',
   7.00,'flat','[4,6,12]','["weekly","monthly","one_time"]',10000,200000,1000,4,30,0,1,0,1),
 ('general','সাধারণ ঋণ','General loan',
   'যেকোনো কৃষি বা ব্যবসায়িক প্রয়োজনে','For any farming or business need','💼',
   13.00,'flat','[6,12,24]','["weekly","monthly","one_time"]',10000,300000,1000,4,30,0,1,0,2),
 ('cooperative','সমবায় ঋণ','Cooperative loan',
   'সমবায় সদস্যদের জন্য বিশেষ ঋণ','A dedicated facility for cooperative members','🤝',
   15.00,'flat','[6,12,24]','["weekly","monthly","one_time"]',5000,200000,1000,4,30,0,1,0,3),
 ('agricultural','কৃষি ঋণ','Agricultural loan',NULL,NULL,'🌾',0,'flat','[]','[]',0,0,1000,4,30,0,0,1,4),
 ('working_capital','চলতি মূলধন','Working capital',NULL,NULL,'💰',0,'flat','[]','[]',0,0,1000,4,30,0,0,1,5),
 ('input_finance','উপকরণ অর্থায়ন','Input financing',NULL,NULL,'🌱',0,'flat','[]','[]',0,0,1000,4,30,0,0,1,6),
 ('project_linked','প্রকল্পভিত্তিক অর্থায়ন','Project-linked finance',NULL,NULL,'📋',0,'flat','[]','[]',0,0,1000,4,30,0,0,1,7),
 ('shathi_project','শাথী প্রকল্প','Shathi project',NULL,NULL,'🏅',0,'flat','[]','[]',0,0,1000,4,30,0,0,1,8),
 ('microenterprise','ক্ষুদ্র উদ্যোগ ঋণ','Microenterprise loan',NULL,NULL,'🏪',0,'flat','[]','[]',0,0,1000,4,30,0,0,1,9
);

-- Consent types — exactly six, all required (MOB-LON-10). field_verification
-- carries the cooperative-validation basis, hence the widened wording (MOB-LON-10B).
INSERT IGNORE INTO loan_consent_types (consent_key,title_bn,title_en,description_bn,description_en,is_required,is_revocable,collected_at_stage,sort_order)
VALUES ('profile_creation','শাথী সেবা প্রোফাইল তৈরি','Create a Shathi Sheba finance profile',
   'আপনার জন্য একটি ফাইন্যান্স প্রোফাইল তৈরি করা হবে','A finance profile will be created for you',1,1,'apply',1),
 ('kyc_verification','পরিচয় যাচাই','Verify my identity',
   'আপনার এনআইডি ও পরিচয় যাচাই করা হবে','Your NID and identity will be verified',1,1,'apply',2),
 ('field_verification','মাঠ ও সমবায় পর্যায়ে যাচাই','Field and cooperative verification',
   'মাঠ কর্মকর্তা আপনার খামার ও সমবায় তথ্য যাচাই করবেন','A field officer will verify your farm and cooperative details',1,1,'apply',3),
 ('financial_assessment','আর্থিক মূল্যায়ন','Assess my financial position',
   'আপনার আয়, ব্যয় ও ঋণের তথ্য মূল্যায়ন করা হবে','Your income, expenses and debt will be assessed',1,1,'apply',4),
 ('mpoweru_assessment','আচরণগত মূল্যায়ন (mPowerU)','Behavioural assessment',
   'একটি সংক্ষিপ্ত আচরণগত মূল্যায়ন নিতে হবে','You will take a short behavioural assessment',1,1,'apply',5),
 ('share_with_lender','ব্যাংক/এমএফআই-এর সাথে তথ্য শেয়ার','Share my application with a partner lender',
   'আপনার আবেদন অংশীদার ব্যাংক বা এমএফআই-কে পাঠানো হবে','Your application will be shared with a partner bank or MFI',1,1,'apply',6),
 ('share_with_project_partner','প্রকল্প অংশীদারের সাথে তথ্য শেয়ার','Share with a project partner',
   'প্রকল্পে যুক্ত করার সময় অনুমতি চাওয়া হবে','Requested at the moment a project match is proposed',0,1,'just_in_time',7
);

INSERT IGNORE INTO loan_purposes (code,label_bn,label_en,icon,sort_order)
VALUES ('livestock_purchase','গবাদি পশু কেনা','Buy livestock','🐄',1),
 ('inputs','বীজ, সার ও উপকরণ','Seeds, fertiliser & inputs','🌱',2),
 ('equipment','যন্ত্রপাতি বা সরঞ্জাম','Equipment or machinery','🚜',3),
 ('working_capital','ব্যবসার চলতি খরচ','Business working capital','💰',4),
 ('expansion','খামার বা ব্যবসা বড় করা','Expand farm or business','📈',5),
 ('other','অন্যান্য','Other','📝',6
);

-- ---------------------------------------------------------------------------
-- Credit roles (SEC-04). Extends the existing role enum; nothing is removed.
-- ---------------------------------------------------------------------------
SET @c := (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_users' AND COLUMN_NAME='role');
SET @s := IF(@c NOT LIKE '%credit_analyst%',
  "ALTER TABLE admin_users MODIFY COLUMN role ENUM('super_admin','hq_admin','marketplace_manager','content_editor','field_officer','auditor','credit_analyst','credit_approver') NOT NULL DEFAULT 'hq_admin'",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- District scoping for field officers (SEC-06).
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_users' AND COLUMN_NAME='assigned_districts_json');
SET @s := IF(@c=0, 'ALTER TABLE admin_users ADD COLUMN assigned_districts_json JSON NULL AFTER upazila', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
