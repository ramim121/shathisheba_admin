-- Shathi Sheba Admin — migration 008: AI moderation flags on community posts
-- Stores the Gemini moderation verdict so the admin can review/scan posts.
-- ai_flag: 'safe' | 'review' | 'remove' | NULL (not yet scanned). Idempotent. MySQL 8+.

USE shathi_sheba;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='community_posts' AND COLUMN_NAME='ai_flag');
SET @s := IF(@c=0, 'ALTER TABLE community_posts ADD COLUMN ai_flag VARCHAR(16) NULL AFTER status', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='community_posts' AND COLUMN_NAME='ai_reason');
SET @s := IF(@c=0, 'ALTER TABLE community_posts ADD COLUMN ai_reason VARCHAR(500) NULL AFTER ai_flag', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='community_posts' AND COLUMN_NAME='ai_checked_at');
SET @s := IF(@c=0, 'ALTER TABLE community_posts ADD COLUMN ai_checked_at DATETIME NULL AFTER ai_reason', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
