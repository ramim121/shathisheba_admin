-- 030: platform settings, and the two fixes that need them.
--
-- 1. `app_settings` — a small key/value store for platform switches. The
--    `settings` API resource has been returning a hard-coded stub, so there was
--    nowhere to put a decision like "is List for Sale gated on a project?".
--
-- 2. `sale_require_project` — that gate, made switchable. List for Sale used to
--    be hidden in any area with no partner project, which reads to the farmer as
--    a broken app rather than as a coverage decision. Default off: the
--    categories the app has actually built are open everywhere.
--
-- 3. PRJ-CTL-FAT-01 carried interest_slug 'livestock', but the root interest
--    category and every other cattle project use 'livestock-poultry'. The
--    mismatch meant the cattle tile never matched its own project and showed
--    "No project in your area" even where the project was national.

USE shathi_sheba;

-- `id` exists because the generic admin CRUD addresses every row by it; the
-- key is what the code looks the setting up by, so it carries the unique index.
CREATE TABLE IF NOT EXISTS app_settings (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_key   VARCHAR(64)  NOT NULL,
  value_text    VARCHAR(255)      NULL,
  description   VARCHAR(255)      NULL,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_settings (setting_key, value_text, description)
SELECT 'sale_require_project', '0',
       'When 1, a sale category only appears where a partner project covers the farmer''s area. When 0, every built category is open everywhere.'
WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'sale_require_project');

-- The cattle project must carry the same interest slug as the category it
-- belongs to, or the availability lookup can never match it.
UPDATE partner_projects
   SET interest_slug = 'livestock-poultry'
 WHERE project_code = 'PRJ-CTL-FAT-01'
   AND interest_slug <> 'livestock-poultry';
