-- 044_apa_starters.sql
--
-- The opening chips on an empty Shathi Apa chat, personalised per farmer.
--
-- They were four hard-coded strings, the same for everyone: "will it rain
-- today", "I want to show a sick cow", "what is the cattle price", "what should
-- I plant this season". Reasonable defaults, and wrong for most people — a
-- fish farmer with no cattle was offered a cattle price, and a farmer in
-- আশ্বিন was asked what to plant in a month when the answer is "nothing, the
-- aman is already standing".
--
-- WHY THEY ARE CACHED RATHER THAN GENERATED ON OPEN
--
-- Generating four questions with a model costs one request from the daily
-- allowance. Doing that on every app launch, for every farmer, would spend the
-- whole day's allowance on questions nobody asked — the app opens far more
-- often than it is used. So a generated set is kept for a week per farmer, and
-- until one exists she gets a set derived from her own interests with no model
-- call at all.
--
-- The week is stored rather than a timestamp so that "is this stale" is an
-- index lookup rather than date arithmetic, and so a whole cohort refreshes
-- together and the generation can be batched later if it is ever worth it.

CREATE TABLE IF NOT EXISTS apa_starters (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  -- ISO week the set was generated for, e.g. '2026-W38'.
  for_week VARCHAR(8) NOT NULL,
  -- [{ "text": "...", "icon": "weather" }, ...]
  starters_json JSON NOT NULL,
  -- Which model wrote them, or 'derived' when no model was used. The console's
  -- quota page counts the model calls; this says which rows cost one.
  model VARCHAR(80) NOT NULL DEFAULT 'derived',
  -- The interests and farm facts the set was built from, so a staff member
  -- reading a bad suggestion can see what it was working from.
  basis VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_apa_starters (user_id, for_week),
  INDEX idx_apa_starters_week (for_week),
  CONSTRAINT fk_apa_starters_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Off by default is the wrong default here: the derived set costs nothing and
-- is strictly better than four fixed strings, so the switch only governs
-- whether a *model* is ever asked to improve on it.
INSERT INTO app_settings (setting_key, value_text, description, updated_at)
SELECT 'apa_starters_ai', '1',
       'Whether Shathi Apa may spend one model request a week per farmer generating her opening questions. Off still gives her a set derived from her own interests, with no model call.',
       NOW()
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key = 'apa_starters_ai');
