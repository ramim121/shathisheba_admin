-- Shathi Sheba Admin — migration 025: mPowerU sessions (Feature 2, P5 scope).
--
-- Implements SRS §18.5 / BLU §7. EcoDev have not supplied a sandbox, so this
-- stores what the documented contract describes; the driver behind it is a stub
-- until they do.
--
-- Two things this schema is shaped by:
--
--   * `respondent_id` is a salted hash, never the user id (ADM-LON-22). The
--     mapping is resolvable only with MPOWERU_RESPONDENT_SALT, so a breach at the
--     provider cannot be joined back to a named farmer.
--
--   * `factors_json` is role-restricted (ADM-LON-24). It is written here and read
--     by credit analysts and above — never returned to a field officer, never
--     exported to a lender, and never copied into loan_evidence. Only the
--     normalised band reaches the scorecard.
--
-- Idempotent. MySQL 8+.

USE shathi_sheba;

CREATE TABLE IF NOT EXISTS mpoweru_sessions (
  id                    BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  application_id        BIGINT UNSIGNED NOT NULL,
  user_id               BIGINT UNSIGNED NOT NULL,

  driver                VARCHAR(40) NOT NULL DEFAULT 'stub',
  provider_session_id   VARCHAR(120) NOT NULL,
  respondent_id         VARCHAR(64) NOT NULL,
  -- ADM-LON-23. A retry from a patchy connection must return the same session
  -- rather than sitting the farmer a second assessment.
  idempotency_key       VARCHAR(120) NOT NULL,

  status                ENUM('created','in_progress','submitted','processing',
                             'completed','failed','expired') NOT NULL DEFAULT 'created',
  assessment_url        VARCHAR(500) NULL,
  expires_at            DATETIME NULL,

  normalised_score      DECIMAL(5,2) NULL,   -- the only value the scorecard reads
  band                  VARCHAR(30) NULL,
  factors_json          JSON NULL,           -- role-restricted, never exported
  risk_flags_json       JSON NULL,
  development_areas_json JSON NULL,

  questionnaire_version VARCHAR(60) NULL,
  model_version         VARCHAR(60) NULL,
  failure_reason        VARCHAR(400) NULL,
  is_stub               TINYINT(1) NOT NULL DEFAULT 0,

  requested_by          BIGINT UNSIGNED NULL,
  completed_at          DATETIME NULL,
  last_polled_at        DATETIME NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_idempotency (idempotency_key),
  UNIQUE KEY uq_provider_session (driver, provider_session_id),
  INDEX idx_application (application_id, status),
  INDEX idx_user (user_id, status),
  CONSTRAINT fk_mps_app FOREIGN KEY (application_id) REFERENCES loan_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
