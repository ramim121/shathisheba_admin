-- Shathi Sheba Admin — migration 024: the 100-point scorecard (Feature 2, P4 scope).
--
-- Implements SRS §19, §21.4 / LRG §12–§23: eight weighted criteria, configurable
-- rating rules, hard stops evaluated before the score, a pathway engine, reason
-- codes, and an immutable assessment record.
--
-- Invariants this schema is built to protect:
--
--   * Assessments are IMMUTABLE (ENG-32). A reassessment inserts a new row with
--     the next sequence_no and marks the previous one `superseded`. Nothing is
--     ever updated in place, because a credit decision that cannot be reproduced
--     is a credit decision that cannot be defended.
--
--   * Every assessment stores its own input snapshot and every model version it
--     used (ENG-33). Re-running the same snapshot through the same model version
--     must give the same score in a year's time, after the evidence has changed
--     and the model has been re-tuned.
--
--   * The criterion weights of an active model must total exactly 100. Enforced
--     on write by lib/finance/scorecard-guard.ts, for the same reason the
--     readiness weights are: the engine normalises, so a wrong total produces a
--     plausible score rather than an error.
--
--   * Hard stops are evaluated independently of and prior to the score (ENG-22),
--     so a hard stop is recorded even when the score is high — the reviewer needs
--     to see both.
--
-- Idempotent. MySQL 8+.

USE shathi_sheba;

-- ---------------------------------------------------------------------------
-- Model versions (ENG-32/33). A scored assessment always names its model.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scorecard_models (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  version           VARCHAR(30) NOT NULL,
  status            ENUM('draft','active','shadow','retired') NOT NULL DEFAULT 'draft',
  notes             VARCHAR(400) NULL,
  grade_a_min       DECIMAL(5,2) NOT NULL DEFAULT 80.00,
  grade_b_min       DECIMAL(5,2) NOT NULL DEFAULT 70.00,
  grade_c_min       DECIMAL(5,2) NOT NULL DEFAULT 60.00,
  confidence_high_pct DECIMAL(5,2) NOT NULL DEFAULT 80.00,  -- % material fields verified
  confidence_med_pct  DECIMAL(5,2) NOT NULL DEFAULT 50.00,
  created_by        BIGINT UNSIGNED NULL,
  approved_by       BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_version (version),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- The eight criteria (ENG-15). Weights total 100 for an active model.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scorecard_criteria (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  model_id          BIGINT UNSIGNED NOT NULL,
  code              VARCHAR(50) NOT NULL,
  sort_order        SMALLINT UNSIGNED NOT NULL,
  label_bn          VARCHAR(160) NOT NULL,
  label_en          VARCHAR(160) NOT NULL,
  weight            DECIMAL(6,2) NOT NULL,
  layer             ENUM('quantitative','qualitative') NOT NULL DEFAULT 'quantitative',
  evidence_source   VARCHAR(160) NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_model_code (model_id, code),
  INDEX idx_model (model_id, sort_order),
  CONSTRAINT fk_sc_model FOREIGN KEY (model_id) REFERENCES scorecard_models(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Rating rules (ENG-17). Each rule maps a computed metric to a 0–5 rating.
-- Evaluated in sort_order; the first whose band contains the metric wins.
-- `metric` names a value the engine derives (dscr, debt_ratio, ...); keeping the
-- bands in data rather than in code is what makes the model tunable without a
-- deploy, which is the difference between a scorecard and a hard-coded opinion.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scorecard_rating_rules (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  criterion_id      BIGINT UNSIGNED NOT NULL,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  metric            VARCHAR(60) NOT NULL,
  min_value         DECIMAL(16,4) NULL,   -- inclusive; NULL = unbounded below
  max_value         DECIMAL(16,4) NULL,   -- exclusive; NULL = unbounded above
  rating            TINYINT UNSIGNED NOT NULL,
  label_bn          VARCHAR(200) NULL,
  label_en          VARCHAR(200) NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_criterion (criterion_id, metric, sort_order),
  CONSTRAINT fk_srr_criterion FOREIGN KEY (criterion_id) REFERENCES scorecard_criteria(id) ON DELETE CASCADE,
  CONSTRAINT ck_rating CHECK (rating BETWEEN 0 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Hard stops (ENG-22/23). Independent of the score, evaluated first.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_hard_stop_rules (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code              VARCHAR(50) NOT NULL,
  label_bn          VARCHAR(200) NOT NULL,
  label_en          VARCHAR(200) NOT NULL,
  explanation_bn    VARCHAR(400) NULL,
  explanation_en    VARCHAR(400) NULL,
  required_action_bn VARCHAR(400) NULL,
  required_action_en VARCHAR(400) NULL,
  check_key         VARCHAR(60) NOT NULL,   -- which engine predicate implements it
  overridable       TINYINT(1) NOT NULL DEFAULT 0,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Reason codes (ENG-27/28), bilingual and admin-editable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_reason_codes (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code              VARCHAR(50) NOT NULL,
  polarity          ENUM('positive','negative') NOT NULL,
  label_bn          VARCHAR(300) NOT NULL,
  label_en          VARCHAR(300) NOT NULL,
  criterion_code    VARCHAR(50) NULL,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_code (code),
  INDEX idx_polarity (polarity, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Pathway rules (ENG-29/30). First match on the ordered set wins.
-- A NULL condition column means "any".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_pathway_rules (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sort_order        SMALLINT UNSIGNED NOT NULL,
  when_grade        VARCHAR(10) NULL,     -- 'A' | 'B' | 'C' | 'D'
  when_confidence   VARCHAR(10) NULL,     -- 'high' | 'medium' | 'low'
  when_hard_stop    TINYINT(1) NULL,
  when_safeguards   TINYINT(1) NULL,      -- 1 = at least one qualifying safeguard
  pathway_code      VARCHAR(60) NOT NULL,
  readiness_status  ENUM('bank_ready','conditionally_ready','project_ready',
                         'development_required','currently_ineligible') NOT NULL,
  amount_factor     DECIMAL(5,4) NULL,    -- ENG-31: recommended = requested × factor
  label_bn          VARCHAR(300) NOT NULL,
  label_en          VARCHAR(300) NOT NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_order (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Safeguards on an application (ENG-25). The structured recommendation is
-- computed with these; the inherent grade never sees them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_safeguards (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id    BIGINT UNSIGNED NOT NULL,
  safeguard_type    ENUM('b2b_buyer','forward_sales','minimum_price','input_package',
                         'cooperative_monitoring','digigram_monitoring','insurance',
                         'vet_agronomy_sop','repayment_at_source','guarantee',
                         'partial_credit_support','supplier_credit_control') NOT NULL,
  detail            VARCHAR(400) NULL,
  is_confirmed      TINYINT(1) NOT NULL DEFAULT 0,
  confirmed_by      BIGINT UNSIGNED NULL,
  confirmed_at      DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_app_type (application_id, safeguard_type),
  CONSTRAINT fk_ls_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- The assessment itself (SRS §21.4). Immutable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_assessments (
  id                      BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id          BIGINT UNSIGNED NOT NULL,
  user_id                 BIGINT UNSIGNED NOT NULL,
  sequence_no             SMALLINT UNSIGNED NOT NULL,
  scorecard_model_version VARCHAR(30) NOT NULL,
  mpoweru_model_version   VARCHAR(60) NULL,

  total_score             DECIMAL(5,2) NOT NULL,
  grade                   ENUM('A','B','C','D') NOT NULL,
  readiness_status        ENUM('bank_ready','conditionally_ready','project_ready',
                               'development_required','currently_ineligible') NOT NULL,
  data_confidence         ENUM('high','medium','low') NOT NULL,
  hard_stop               TINYINT(1) NOT NULL DEFAULT 0,
  hard_stop_codes_json    JSON NULL,
  primary_pathway         VARCHAR(60) NULL,
  secondary_pathways_json JSON NULL,
  reason_codes_json       JSON NULL,

  inherent_grade          ENUM('A','B','C','D') NULL,
  structured_readiness    VARCHAR(40) NULL,
  recommended_amount      DECIMAL(14,2) NULL,
  recommended_rationale   VARCHAR(400) NULL,

  verified_field_pct      DECIMAL(5,2) NOT NULL DEFAULT 0,
  input_snapshot_json     JSON NOT NULL,
  is_shadow               TINYINT(1) NOT NULL DEFAULT 0,   -- ENG-34 champion/challenger

  computed_by             BIGINT UNSIGNED NULL,
  reviewed_by             BIGINT UNSIGNED NULL,
  reviewed_at             DATETIME NULL,
  status                  ENUM('draft','computed','under_review','completed','superseded')
                          NOT NULL DEFAULT 'computed',
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_app_seq (application_id, sequence_no, is_shadow),
  INDEX idx_user_grade (user_id, grade, created_at),
  INDEX idx_app (application_id, status),
  CONSTRAINT fk_ca_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-criterion detail, so a reviewer can see where the score came from
-- and an override is recorded separately from the computed value (ENG-17).
CREATE TABLE IF NOT EXISTS credit_assessment_criteria (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  assessment_id     BIGINT UNSIGNED NOT NULL,
  criterion_code    VARCHAR(50) NOT NULL,
  weight            DECIMAL(6,2) NOT NULL,
  computed_rating   TINYINT UNSIGNED NOT NULL,
  override_rating   TINYINT UNSIGNED NULL,
  override_reason   VARCHAR(400) NULL,
  override_by       BIGINT UNSIGNED NULL,
  effective_rating  TINYINT UNSIGNED NOT NULL,
  weighted_score    DECIMAL(6,2) NOT NULL,
  metric_key        VARCHAR(60) NULL,
  metric_value      DECIMAL(16,4) NULL,
  had_data          TINYINT(1) NOT NULL DEFAULT 1,   -- ENG-18: no data rates 0 and is flagged
  note_bn           VARCHAR(300) NULL,
  note_en           VARCHAR(300) NULL,
  UNIQUE KEY uq_assessment_criterion (assessment_id, criterion_code),
  CONSTRAINT fk_cac_assessment FOREIGN KEY (assessment_id) REFERENCES credit_assessments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Development plans (SRS §18.3.15 / LRG §22)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS development_plan_templates (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code              VARCHAR(50) NOT NULL,
  title_bn          VARCHAR(200) NOT NULL,
  title_en          VARCHAR(200) NOT NULL,
  detail_bn         VARCHAR(600) NULL,
  detail_en         VARCHAR(600) NULL,
  criterion_code    VARCHAR(50) NULL,
  action_deeplink   VARCHAR(120) NULL,
  default_days      SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS development_plan_tasks (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id    BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  assessment_id     BIGINT UNSIGNED NULL,
  template_code     VARCHAR(50) NULL,
  title_bn          VARCHAR(200) NOT NULL,
  title_en          VARCHAR(200) NOT NULL,
  detail_bn         VARCHAR(600) NULL,
  detail_en         VARCHAR(600) NULL,
  action_deeplink   VARCHAR(120) NULL,
  due_on            DATE NULL,
  status            ENUM('assigned','in_progress','submitted','verified','waived')
                    NOT NULL DEFAULT 'assigned',
  evidence_url      VARCHAR(500) NULL,
  verified_by       BIGINT UNSIGNED NULL,
  verified_at       DATETIME NULL,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app (application_id, status),
  INDEX idx_user (user_id, status),
  CONSTRAINT fk_dpt_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed: model v1 and its eight criteria (ENG-15). Weights total exactly 100.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scorecard_models (version, status, notes) VALUES
 ('sc-v1', 'active', 'LRG §12–13 baseline: 60 quantitative + 40 qualitative points.');

SET @m := (SELECT id FROM scorecard_models WHERE version = 'sc-v1');

INSERT IGNORE INTO scorecard_criteria
  (model_id, code, sort_order, label_bn, label_en, weight, layer, evidence_source) VALUES
 (@m, 'cash_flow',      1, 'নগদ প্রবাহ ও পরিশোধ সক্ষমতা', 'Cash flow and repayment capacity', 25.00, 'quantitative', 'Financial profile'),
 (@m, 'existing_debt',  2, 'বিদ্যমান ঋণ ও পরিশোধের ইতিহাস', 'Existing debt and repayment history', 15.00, 'quantitative', 'Existing debt'),
 (@m, 'enterprise',     3, 'ব্যবসার অর্থনীতি',             'Enterprise economics',             10.00, 'quantitative', 'Enterprise profile and assets'),
 (@m, 'transactions',   4, 'লেনদেন ও বাজার প্রমাণ',        'Transaction and market evidence',  10.00, 'quantitative', 'Platform data'),
 (@m, 'mpoweru',        5, 'আচরণগত মূল্যায়ন',              'mPowerU behavioural intelligence', 20.00, 'qualitative',  'mPowerU'),
 (@m, 'management',     6, 'ব্যবস্থাপনা ও প্রশিক্ষণযোগ্যতা', 'Management and trainability',       8.00, 'qualitative',  'Enterprise and training records'),
 (@m, 'field_validation', 7, 'সমিতি ও মাঠ যাচাই',          'Cooperative and field validation',   7.00, 'qualitative',  'Field verification'),
 (@m, 'documentation',  8, 'কাগজপত্র ও সম্মতি',            'Documentation and compliance',       5.00, 'qualitative',  'Checklist and consent');

-- Rating bands (ENG-17). min inclusive, max exclusive; NULL = unbounded.
-- Cash flow — DSCR (net surplus ÷ proposed instalment).
SET @c := (SELECT id FROM scorecard_criteria WHERE model_id = @m AND code = 'cash_flow');
INSERT IGNORE INTO scorecard_rating_rules (criterion_id, sort_order, metric, min_value, max_value, rating, label_en) VALUES
 (@c, 1, 'dscr', 2.0000, NULL,   5, 'DSCR at or above 2.0'),
 (@c, 2, 'dscr', 1.5000, 2.0000, 4, 'DSCR 1.5 to 2.0'),
 (@c, 3, 'dscr', 1.2000, 1.5000, 3, 'DSCR 1.2 to 1.5'),
 (@c, 4, 'dscr', 1.0000, 1.2000, 2, 'DSCR 1.0 to 1.2'),
 (@c, 5, 'dscr', NULL,   1.0000, 1, 'DSCR below 1.0');

-- Existing debt — total existing instalments ÷ total income.
SET @c := (SELECT id FROM scorecard_criteria WHERE model_id = @m AND code = 'existing_debt');
INSERT IGNORE INTO scorecard_rating_rules (criterion_id, sort_order, metric, min_value, max_value, rating, label_en) VALUES
 (@c, 1, 'debt_burden_ratio', NULL,   0.1000, 5, 'Existing instalments under 10% of income'),
 (@c, 2, 'debt_burden_ratio', 0.1000, 0.2500, 4, '10% to 25%'),
 (@c, 3, 'debt_burden_ratio', 0.2500, 0.4000, 3, '25% to 40%'),
 (@c, 4, 'debt_burden_ratio', 0.4000, 0.6000, 2, '40% to 60%'),
 (@c, 5, 'debt_burden_ratio', 0.6000, NULL,   1, 'Over 60% of income');

-- Enterprise economics — years of experience.
SET @c := (SELECT id FROM scorecard_criteria WHERE model_id = @m AND code = 'enterprise');
INSERT IGNORE INTO scorecard_rating_rules (criterion_id, sort_order, metric, min_value, max_value, rating, label_en) VALUES
 (@c, 1, 'enterprise_years', 5.0000, NULL,   5, 'Five years or more'),
 (@c, 2, 'enterprise_years', 3.0000, 5.0000, 4, 'Three to five years'),
 (@c, 3, 'enterprise_years', 2.0000, 3.0000, 3, 'Two to three years'),
 (@c, 4, 'enterprise_years', 1.0000, 2.0000, 2, 'One to two years'),
 (@c, 5, 'enterprise_years', NULL,   1.0000, 1, 'Under one year');

-- Transaction evidence — completed platform transactions.
SET @c := (SELECT id FROM scorecard_criteria WHERE model_id = @m AND code = 'transactions');
INSERT IGNORE INTO scorecard_rating_rules (criterion_id, sort_order, metric, min_value, max_value, rating, label_en) VALUES
 (@c, 1, 'platform_transactions', 12.0000, NULL,    5, 'Twelve or more'),
 (@c, 2, 'platform_transactions',  6.0000, 12.0000, 4, 'Six to twelve'),
 (@c, 3, 'platform_transactions',  3.0000,  6.0000, 3, 'Three to six'),
 (@c, 4, 'platform_transactions',  1.0000,  3.0000, 2, 'One or two'),
 (@c, 5, 'platform_transactions',  NULL,    1.0000, 0, 'No transaction history');

-- mPowerU — normalised 0–100 band.
SET @c := (SELECT id FROM scorecard_criteria WHERE model_id = @m AND code = 'mpoweru');
INSERT IGNORE INTO scorecard_rating_rules (criterion_id, sort_order, metric, min_value, max_value, rating, label_en) VALUES
 (@c, 1, 'mpoweru_score', 80.0000, NULL,     5, 'Band 80 and above'),
 (@c, 2, 'mpoweru_score', 65.0000, 80.0000,  4, 'Band 65 to 80'),
 (@c, 3, 'mpoweru_score', 50.0000, 65.0000,  3, 'Band 50 to 65'),
 (@c, 4, 'mpoweru_score', 35.0000, 50.0000,  2, 'Band 35 to 50'),
 (@c, 5, 'mpoweru_score', NULL,    35.0000,  1, 'Below 35');

-- Management and trainability — completed training items.
SET @c := (SELECT id FROM scorecard_criteria WHERE model_id = @m AND code = 'management');
INSERT IGNORE INTO scorecard_rating_rules (criterion_id, sort_order, metric, min_value, max_value, rating, label_en) VALUES
 (@c, 1, 'training_completed', 8.0000, NULL,   5, 'Eight or more training items'),
 (@c, 2, 'training_completed', 5.0000, 8.0000, 4, 'Five to eight'),
 (@c, 3, 'training_completed', 3.0000, 5.0000, 3, 'Three to five'),
 (@c, 4, 'training_completed', 1.0000, 3.0000, 2, 'One or two'),
 (@c, 5, 'training_completed', NULL,   1.0000, 1, 'None completed');

-- Field validation — proportion of the eleven items verified.
SET @c := (SELECT id FROM scorecard_criteria WHERE model_id = @m AND code = 'field_validation');
INSERT IGNORE INTO scorecard_rating_rules (criterion_id, sort_order, metric, min_value, max_value, rating, label_en) VALUES
 (@c, 1, 'verification_ratio', 0.9000, NULL,   5, 'Ninety per cent or more verified'),
 (@c, 2, 'verification_ratio', 0.7000, 0.9000, 4, 'Seventy to ninety'),
 (@c, 3, 'verification_ratio', 0.5000, 0.7000, 3, 'Fifty to seventy'),
 (@c, 4, 'verification_ratio', 0.2500, 0.5000, 2, 'Twenty-five to fifty'),
 (@c, 5, 'verification_ratio', NULL,   0.2500, 1, 'Under a quarter verified');

-- Documentation — proportion of required documents verified.
SET @c := (SELECT id FROM scorecard_criteria WHERE model_id = @m AND code = 'documentation');
INSERT IGNORE INTO scorecard_rating_rules (criterion_id, sort_order, metric, min_value, max_value, rating, label_en) VALUES
 (@c, 1, 'document_ratio', 1.0000, NULL,   5, 'All required documents verified'),
 (@c, 2, 'document_ratio', 0.8000, 1.0000, 4, 'Eighty per cent or more'),
 (@c, 3, 'document_ratio', 0.6000, 0.8000, 3, 'Sixty to eighty'),
 (@c, 4, 'document_ratio', 0.3000, 0.6000, 2, 'Thirty to sixty'),
 (@c, 5, 'document_ratio', NULL,   0.3000, 1, 'Under thirty per cent');

-- ---------------------------------------------------------------------------
-- Seed: hard stops (ENG-22 default set)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO credit_hard_stop_rules (code, label_bn, label_en, check_key, overridable, sort_order) VALUES
 ('identity_unverified',   'পরিচয় যাচাই সম্পন্ন হয়নি',      'Identity verification failed',        'identity_unverified',   1, 1),
 ('critical_kyc_missing',  'জরুরি কেওয়াইসি তথ্য অনুপস্থিত',  'Critical KYC missing',                'critical_kyc_missing',  1, 2),
 ('consent_missing',       'প্রয়োজনীয় সম্মতি নেই',          'Required consent missing',            'consent_missing',       0, 3),
 ('active_default',        'চলমান গুরুতর খেলাপি',           'Active serious default',              'active_default',        0, 4),
 ('no_repayment_source',   'পরিশোধের উৎস চিহ্নিত নয়',       'No identifiable repayment source',    'no_repayment_source',   1, 5),
 ('contradictory_evidence','তথ্যে গুরুতর অসঙ্গতি',           'Material information contradiction',  'contradictory_evidence',1, 6),
 ('prohibited_purpose',    'নিষিদ্ধ উদ্দেশ্য',               'Prohibited purpose',                  'prohibited_purpose',    0, 7);

-- ---------------------------------------------------------------------------
-- Seed: pathway rules (ENG-29/30). Ordered; first match wins.
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO credit_pathway_rules
  (sort_order, when_grade, when_confidence, when_hard_stop, when_safeguards,
   pathway_code, readiness_status, amount_factor, label_bn, label_en) VALUES
 (1,  NULL, NULL,     1,    NULL, 'currently_decline',      'currently_ineligible', NULL,   'এখন এগোনো সম্ভব নয়',            'Cannot proceed at present'),
 (2,  'A',  'high',   0,    NULL, 'submit_to_bank',         'bank_ready',           1.0000, 'ব্যাংকে জমা দেওয়ার উপযুক্ত',      'Ready to submit to a bank'),
 (3,  'A',  NULL,     0,    NULL, 'additional_verification','conditionally_ready',  1.0000, 'আরও যাচাই প্রয়োজন',              'Additional verification required'),
 (4,  'B',  'high',   0,    NULL, 'submit_to_bank',         'bank_ready',           0.9000, 'ব্যাংকে জমা দেওয়ার উপযুক্ত',      'Ready to submit to a bank'),
 (5,  'B',  'medium', 0,    NULL, 'submit_to_mfi',          'conditionally_ready',  0.8000, 'এমএফআই-তে জমা দেওয়ার উপযুক্ত',   'Ready to submit to an MFI'),
 (6,  'B',  NULL,     0,    1,    'join_shathi_project',    'project_ready',        0.8000, 'শাথী প্রকল্পে যোগ দিন',          'Join a Shathi project'),
 (7,  'B',  NULL,     0,    NULL, 'additional_verification','development_required', NULL,   'আরও যাচাই প্রয়োজন',              'Additional verification required'),
 (8,  'C',  NULL,     0,    1,    'join_shathi_project',    'project_ready',        0.6000, 'শাথী প্রকল্পে যোগ দিন',          'Join a Shathi project'),
 (9,  'C',  NULL,     0,    NULL, 'reduced_loan_limit',     'development_required', 0.5000, 'কম পরিমাণে ঋণ বিবেচনা',          'Eligible for a reduced loan limit'),
 (10, 'D',  NULL,     0,    NULL, 'complete_development',   'development_required', NULL,   'উন্নয়ন পরিকল্পনা সম্পন্ন করুন',   'Complete a development plan');

-- ---------------------------------------------------------------------------
-- Seed: reason codes (ENG-27)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO credit_reason_codes (code, polarity, label_bn, label_en, criterion_code, sort_order) VALUES
 ('strong_cash_flow',      'positive', 'পরিশোধের সক্ষমতা ভালো',            'Strong repayment capacity',            'cash_flow',       1),
 ('low_existing_debt',     'positive', 'বিদ্যমান ঋণের চাপ কম',             'Low existing debt burden',             'existing_debt',   2),
 ('established_enterprise','positive', 'ব্যবসার অভিজ্ঞতা যথেষ্ট',           'Established enterprise experience',    'enterprise',      3),
 ('verified_buyer',        'positive', 'নিশ্চিত ক্রেতা রয়েছে',             'Confirmed buyer in place',             'transactions',    4),
 ('strong_transactions',   'positive', 'প্ল্যাটফর্মে লেনদেনের ইতিহাস ভালো',  'Strong platform transaction history',  'transactions',    5),
 ('high_behavioural',      'positive', 'আচরণগত মূল্যায়ন ভালো',             'High behavioural assessment result',   'mpoweru',         6),
 ('verified_assets',       'positive', 'যাচাইকৃত উৎপাদনশীল সম্পদ',          'Verified productive assets',           'field_validation',7),
 ('insufficient_surplus',  'negative', 'পরিশোধের উদ্বৃত্ত যথেষ্ট নয়',       'Insufficient repayment surplus',       'cash_flow',      20),
 ('high_debt_burden',      'negative', 'বিদ্যমান ঋণের চাপ বেশি',           'High existing debt burden',            'existing_debt',  21),
 ('limited_transactions',  'negative', 'লেনদেনের ইতিহাস সীমিত',            'Limited transaction history',          'transactions',   22),
 ('missing_document',      'negative', 'প্রয়োজনীয় কাগজ অনুপস্থিত',         'Required document missing',            'documentation',  23),
 ('weak_enterprise',       'negative', 'ব্যবসার ইতিহাস দুর্বল',             'Weak enterprise history',              'enterprise',     24),
 ('low_behavioural',       'negative', 'আচরণগত মূল্যায়ন দুর্বল',            'Low behavioural assessment result',    'mpoweru',        25),
 ('unverified_asset',      'negative', 'সম্পদ যাচাই করা হয়নি',             'Unverified assets',                    'field_validation',26),
 ('verification_incomplete','negative','মাঠ যাচাই সম্পূর্ণ হয়নি',           'Field verification incomplete',        'field_validation',27);

-- ---------------------------------------------------------------------------
-- Seed: development plan templates (LRG §22)
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO development_plan_templates
  (code, title_bn, title_en, criterion_code, action_deeplink, default_days, sort_order) VALUES
 ('verify_nid',       'জাতীয় পরিচয়পত্র যাচাই করান',   'Get your National ID verified',      'documentation',   'screen:kycUpload',      14, 1),
 ('add_banking',      'ব্যাংক বা মোবাইল হিসাব যোগ করুন','Add a bank or mobile money account', 'documentation',   'sheet:banking',         14, 2),
 ('record_farm',      'খামারের তথ্য দিন',              'Record your farm details',           'enterprise',      'sheet:farm',            14, 3),
 ('build_history',    'প্ল্যাটফর্মে লেনদেন করুন',       'Build transaction history',          'transactions',    'screen:sell',           90, 4),
 ('complete_training','প্রশিক্ষণ সম্পন্ন করুন',         'Complete training modules',          'management',      'screen:learning',       60, 5),
 ('reduce_debt',      'বিদ্যমান ঋণ কমান',              'Reduce existing debt',               'existing_debt',   NULL,                    180, 6),
 ('join_project',     'একটি প্রকল্পে যোগ দিন',          'Join a partner project',             'transactions',    'screen:projects',       60, 7),
 ('financial_literacy','আর্থিক শিক্ষা সম্পন্ন করুন',     'Complete financial literacy',        'management',      'screen:learning',       45, 8);
