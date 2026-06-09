-- Shathi Sheba Admin — migration 015: learning sections
-- Groups learning categories into segmented sections so the app can show
-- Farming, Climate, Skills/Livelihood and Community/Wellbeing separately.
-- Idempotent. MySQL 8+.

USE shathi_sheba;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='learning_categories' AND COLUMN_NAME='section');
SET @s := IF(@c=0, "ALTER TABLE learning_categories ADD COLUMN section VARCHAR(60) NOT NULL DEFAULT 'agriculture' AFTER interest_slug", 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Backfill the existing categories into sections.
UPDATE learning_categories SET section = 'agriculture' WHERE slug IN ('cattle','crops','fishery','livestock','agriculture');
UPDATE learning_categories SET section = 'climate' WHERE slug IN ('climate');
UPDATE learning_categories SET section = 'livelihood' WHERE slug IN ('women');
UPDATE learning_categories SET section = 'social' WHERE slug IN ('healthcare');
