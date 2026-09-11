-- 032: let admins add places.
--
-- The geo masters were seeded with explicit ids and never given AUTO_INCREMENT,
-- so adding a new upazila from the admin (they are still being created — Dasar
-- and Eidgaon in 2021) failed with "Field 'id' doesn't have a default value".
-- The existing ids are unchanged; only new rows get generated ones.
--
-- The ids are referenced by foreign keys (migration 031), and MySQL refuses to
-- modify a referenced column while those checks are on. The column type is
-- identical before and after, so switching the checks off for the ALTER changes
-- nothing about the data — it only lets the definition gain AUTO_INCREMENT.

USE shathi_sheba;

SET @prev_fk := @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'geo_divisions' AND COLUMN_NAME = 'id' AND EXTRA LIKE '%auto_increment%');
SET @s := IF(@c = 0, 'ALTER TABLE geo_divisions MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'geo_districts' AND COLUMN_NAME = 'id' AND EXTRA LIKE '%auto_increment%');
SET @s := IF(@c = 0, 'ALTER TABLE geo_districts MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'geo_upazilas' AND COLUMN_NAME = 'id' AND EXTRA LIKE '%auto_increment%');
SET @s := IF(@c = 0, 'ALTER TABLE geo_upazilas MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET FOREIGN_KEY_CHECKS = @prev_fk;
