-- 055_account_deletion.sql
--
-- Account deletion, for the first Google Play release.
--
-- Play requires that a user can delete their account both inside the app and
-- from a public web page. The owner's decision is that deletion erases the
-- person at once, while the records a business must keep - orders, sales,
-- payments, loans and repayments - are kept for five years with every
-- identifying field stripped (lib/account-deletion.ts does both, in one
-- transaction).
--
-- What this migration adds:
--
--   * app_users.status gains 'deleted', and app_users.deleted_at says when.
--     The row itself is kept, anonymised: orders, listings, loans and posts
--     reference it, and several of those foreign keys are NO ACTION, so the
--     row cannot go without taking the five-year records with it.
--
--   * account_deletions - one row per deletion: who (by id only), through
--     which door (app, web page, console), when, and until when the stripped
--     records are kept. summary_json holds per-table counts, never a name,
--     phone number or address.
--
--   * app_otps.purpose - a code sent to confirm a deletion is not a sign-in
--     code. Before this, any unconsumed code for a phone would have verified
--     either flow; now each flow only accepts its own. Both still share one
--     request budget per phone and per address (migration 020).
--
-- Re-runnable: apply-migration.cjs skips "already exists", and the MODIFY is
-- idempotent.

ALTER TABLE app_users MODIFY COLUMN status ENUM('active','suspended','pending','deleted') NOT NULL DEFAULT 'active';

ALTER TABLE app_users ADD COLUMN deleted_at DATETIME NULL AFTER status;

CREATE TABLE IF NOT EXISTS account_deletions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  via ENUM('app','web','admin') NOT NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retention_until DATE NOT NULL,
  summary_json JSON NULL,
  PRIMARY KEY (id),
  KEY idx_account_deletions_user (user_id),
  KEY idx_account_deletions_retention (retention_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE app_otps ADD COLUMN purpose ENUM('login','account_deletion') NOT NULL DEFAULT 'login' AFTER phone;
