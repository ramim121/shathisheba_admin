-- Shathi Sheba Admin — migration 009: learning levels, points, progress detail
-- Extends the existing learning_* tables for the gamified training module:
--   categories (cattle/crops) -> modules (subcategory + level) -> contents
--   (article markdown / youtube video / quiz) -> per-user progress + points.
-- Idempotent. MySQL 8+.

USE shathi_sheba;

-- learning_categories: emoji, descriptions, interest mapping (preferences)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_categories' AND COLUMN_NAME='emoji');
SET @s := IF(@c=0, 'ALTER TABLE learning_categories ADD COLUMN emoji VARCHAR(16) NULL AFTER name_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_categories' AND COLUMN_NAME='description_en');
SET @s := IF(@c=0, 'ALTER TABLE learning_categories ADD COLUMN description_en VARCHAR(400) NULL AFTER emoji', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_categories' AND COLUMN_NAME='description_bn');
SET @s := IF(@c=0, 'ALTER TABLE learning_categories ADD COLUMN description_bn VARCHAR(400) NULL AFTER description_en', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_categories' AND COLUMN_NAME='interest_slug');
SET @s := IF(@c=0, 'ALTER TABLE learning_categories ADD COLUMN interest_slug VARCHAR(120) NULL AFTER description_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- learning_modules: subcategory level, emoji
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_modules' AND COLUMN_NAME='level');
SET @s := IF(@c=0, 'ALTER TABLE learning_modules ADD COLUMN level INT NOT NULL DEFAULT 1 AFTER subtitle_bn', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_modules' AND COLUMN_NAME='emoji');
SET @s := IF(@c=0, 'ALTER TABLE learning_modules ADD COLUMN emoji VARCHAR(16) NULL AFTER level', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- learning_contents: points, image, cached AI summary
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_contents' AND COLUMN_NAME='points');
SET @s := IF(@c=0, 'ALTER TABLE learning_contents ADD COLUMN points INT NOT NULL DEFAULT 10 AFTER duration_seconds', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_contents' AND COLUMN_NAME='image_url');
SET @s := IF(@c=0, 'ALTER TABLE learning_contents ADD COLUMN image_url VARCHAR(500) NULL AFTER points', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_contents' AND COLUMN_NAME='summary_en');
SET @s := IF(@c=0, 'ALTER TABLE learning_contents ADD COLUMN summary_en LONGTEXT NULL AFTER image_url', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_contents' AND COLUMN_NAME='summary_bn');
SET @s := IF(@c=0, 'ALTER TABLE learning_contents ADD COLUMN summary_bn LONGTEXT NULL AFTER summary_en', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- user_learning_progress: points awarded, watch %, quiz score/pass, updated_at
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_learning_progress' AND COLUMN_NAME='points_awarded');
SET @s := IF(@c=0, 'ALTER TABLE user_learning_progress ADD COLUMN points_awarded INT NOT NULL DEFAULT 0 AFTER score', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_learning_progress' AND COLUMN_NAME='progress_pct');
SET @s := IF(@c=0, 'ALTER TABLE user_learning_progress ADD COLUMN progress_pct INT NOT NULL DEFAULT 0 AFTER points_awarded', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_learning_progress' AND COLUMN_NAME='quiz_score');
SET @s := IF(@c=0, 'ALTER TABLE user_learning_progress ADD COLUMN quiz_score DECIMAL(5,2) NULL AFTER progress_pct', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_learning_progress' AND COLUMN_NAME='quiz_passed');
SET @s := IF(@c=0, 'ALTER TABLE user_learning_progress ADD COLUMN quiz_passed TINYINT(1) NOT NULL DEFAULT 0 AFTER quiz_score', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_learning_progress' AND COLUMN_NAME='updated_at');
SET @s := IF(@c=0, 'ALTER TABLE user_learning_progress ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- app_users: cached total learning points (fast display on training home)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_users' AND COLUMN_NAME='learning_points');
SET @s := IF(@c=0, 'ALTER TABLE app_users ADD COLUMN learning_points INT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
