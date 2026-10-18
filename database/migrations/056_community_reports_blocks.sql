-- 056_community_reports_blocks.sql
--
-- Reporting and blocking in the community feed.
--
-- Google Play's User Generated Content policy requires an in-app way to report
-- objectionable posts and users, and for the developer to act on reports. The
-- feed already had community_posts.report_count and a "flagged" filter in the
-- console's moderation panel, but nothing in the app wrote to it.
--
--   * community_post_reports - one row per person per post: who reported it,
--     why, and whether staff have dealt with it. The first report on an
--     ordinary post moves it to status 'moderation' (out of the feed) until
--     staff restore or remove it. Staff notices are never hidden by a report;
--     they are only counted and queued.
--
--   * community_user_blocks - a farmer may block another person. Blocked
--     people's posts drop out of her feed. Blocking is private: the blocked
--     person is not told and sees no difference.
--
-- Account deletion (lib/account-deletion.ts) removes a person's blocks, both
-- ways, and the reports they made.

CREATE TABLE IF NOT EXISTS community_post_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  post_id BIGINT UNSIGNED NOT NULL,
  reporter_user_id BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(32) NOT NULL,
  note VARCHAR(500) NULL,
  status ENUM('open','actioned','dismissed') NOT NULL DEFAULT 'open',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_community_report (post_id, reporter_user_id),
  KEY idx_community_report_status (status, created_at),
  KEY idx_community_report_reporter (reporter_user_id)
);

CREATE TABLE IF NOT EXISTS community_user_blocks (
  blocker_user_id BIGINT UNSIGNED NOT NULL,
  blocked_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  KEY idx_community_block_blocked (blocked_user_id)
);
