-- Shathi Sheba Admin — migration 007: community post image + official highlight
-- Lets app users attach an image to posts, and lets Shathi Sheba mark official
-- posts that are highlighted in the community feed. Idempotent. MySQL 8+.

USE shathi_sheba;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='community_posts' AND COLUMN_NAME='image_url');
SET @s := IF(@c=0, 'ALTER TABLE community_posts ADD COLUMN image_url VARCHAR(500) NULL AFTER body', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='community_posts' AND COLUMN_NAME='is_official');
SET @s := IF(@c=0, 'ALTER TABLE community_posts ADD COLUMN is_official TINYINT(1) NOT NULL DEFAULT 0 AFTER image_url', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
