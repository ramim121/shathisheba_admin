-- 042 — Shathi Apa pass two: caching, quota visibility, prompt history, and the
-- move of read-aloud onto the farmer's own phone.
-- Apply with: node scripts/apply-migration.cjs 042_apa_cache_quota_prompts.sql
--
-- Everything here follows from measurements taken against the live key, not
-- from guesses:
--
--   * Read-aloud cost $0.0220 per answer against $0.0016 to generate it —
--     fourteen times the cost of the intelligence. Android's own text-to-speech
--     engine does it for nothing, so `apa_tts_mode` moves it to the device and
--     keeps the server path only as a fallback for a phone with no Bangla voice
--     installed.
--   * `gemini-3.6-flash` reports a free-tier cap of twenty requests per day,
--     *per model per project*. So every model setting becomes a comma-separated
--     fallback chain: when the first model is out of quota the next one answers,
--     which multiplies usable headroom without touching a single project's terms.
--   * Implicit prompt caching did NOT fire on `gemini-3.1-flash-lite` — three
--     identical 4,895-token prefixes all came back `cachedContentTokenCount: 0`.
--     Google documents the discount for 2.5 Flash and the 3.x Flash line, not
--     for flash-lite. So the cached-token count is now recorded per turn and
--     shown in the console, because the only honest way to know whether caching
--     is paying for itself is to measure it.
--
-- Four tables, five altered columns, and the prompts rewritten.

-- ---------------------------------------------------------------------------
-- 1. The answer cache
--
-- Fifty farmers in one upazila asking "আজ কি বৃষ্টি হবে?" on the same morning is
-- one model call and forty-nine cache hits, because the grounding data is
-- identical for all of them that day. Keyed on the normalised question, the
-- district and the date — never across districts, never across days.
--
-- `personal` exists to keep this honest: an answer that used get_my_listings,
-- get_finance_status or get_my_profile is about one farmer and must never be
-- served to another, so it is never written here.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS apa_answer_cache (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cache_key CHAR(64) NOT NULL,
  question_norm VARCHAR(500) NOT NULL,
  district_id BIGINT UNSIGNED NULL,
  for_day DATE NOT NULL,
  lang CHAR(2) NOT NULL DEFAULT 'bn',
  answer_json JSON NOT NULL,
  model VARCHAR(80) NULL,
  tools_json JSON NULL,
  hits INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_hit_at DATETIME NULL,
  UNIQUE KEY uq_apa_cache_key (cache_key),
  KEY idx_apa_cache_day (for_day),
  KEY idx_apa_cache_hits (hits)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Read-aloud audio, cached by content
--
-- Speech is deterministic: the same text, voice and rate give the same audio.
-- Used only when a phone has no Bangla voice of its own and has to fall back to
-- the server, which should be the minority of cases once `apa_tts_mode` is
-- `device`. The audio itself goes to S3 or /uploads; this row is the index.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS apa_speech_cache (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cache_key CHAR(64) NOT NULL,
  text_len INT NOT NULL,
  voice VARCHAR(60) NOT NULL,
  speech_rate VARCHAR(20) NOT NULL DEFAULT 'normal',
  model VARCHAR(80) NULL,
  audio_url VARCHAR(500) NOT NULL,
  mime_type VARCHAR(60) NOT NULL DEFAULT 'audio/wav',
  sample_rate INT NOT NULL DEFAULT 24000,
  bytes INT NOT NULL DEFAULT 0,
  seconds DECIMAL(7,2) NULL,
  hits INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_hit_at DATETIME NULL,
  UNIQUE KEY uq_apa_speech_key (cache_key),
  KEY idx_apa_speech_hits (hits)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. The app's other AI helpers, kept out of the grounding-tool table
--
-- These were being written into apa_tool_calls with ok = 1 before the call was
-- even made, which meant the console's tool-failure column was structurally
-- blank for them and they inflated the grounding-tool counts. Their own table,
-- and `ok` updated after the fact.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS apa_app_ai_calls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  task VARCHAR(40) NOT NULL,
  model VARCHAR(80) NULL,
  ok TINYINT(1) NULL,
  error VARCHAR(255) NULL,
  chars_in INT NOT NULL DEFAULT 0,
  chars_out INT NOT NULL DEFAULT 0,
  est_cost_usd DECIMAL(12,5) NOT NULL DEFAULT 0,
  latency_ms INT NULL,
  from_cache TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_apa_appai_user (user_id, created_at),
  KEY idx_apa_appai_task (task, created_at),
  CONSTRAINT fk_apa_appai_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Prompt history
--
-- The scope instruction IS the safety control. Overwriting it destroyed the
-- previous text with nothing but the changed-key list in the audit log, so an
-- accidental paste was unrecoverable and the trail could not even say what was
-- lost. Every save now keeps the body it replaced.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS apa_prompt_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  prompt_key VARCHAR(60) NOT NULL,
  body TEXT NOT NULL,
  chars INT NOT NULL DEFAULT 0,
  changed_by BIGINT UNSIGNED NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_apa_promptver (prompt_key, id),
  CONSTRAINT fk_apa_promptver_admin FOREIGN KEY (changed_by) REFERENCES admin_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 5. Request accounting the console can show per model
--
-- The free tier caps requests per day PER MODEL, so "how many calls have we
-- made today" is only answerable per model. This is the table the new Quota
-- panel reads; one row per model per day, incremented on every attempt
-- including the ones that were refused.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS apa_model_calls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  model VARCHAR(80) NOT NULL,
  job VARCHAR(30) NOT NULL,
  for_day DATE NOT NULL,
  calls INT NOT NULL DEFAULT 0,
  ok_calls INT NOT NULL DEFAULT 0,
  quota_errors INT NOT NULL DEFAULT 0,
  other_errors INT NOT NULL DEFAULT 0,
  tokens_in BIGINT NOT NULL DEFAULT 0,
  tokens_out BIGINT NOT NULL DEFAULT 0,
  cached_tokens BIGINT NOT NULL DEFAULT 0,
  est_cost_usd DECIMAL(12,5) NOT NULL DEFAULT 0,
  last_error VARCHAR(255) NULL,
  last_quota_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_apa_model_day (model, job, for_day),
  KEY idx_apa_model_day (for_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 6. Columns added to what already exists
-- ---------------------------------------------------------------------------

ALTER TABLE apa_messages ADD COLUMN cached_tokens INT NOT NULL DEFAULT 0;
ALTER TABLE apa_messages ADD COLUMN tokens_in INT NOT NULL DEFAULT 0;
ALTER TABLE apa_messages ADD COLUMN tokens_out INT NOT NULL DEFAULT 0;
ALTER TABLE apa_messages ADD COLUMN from_cache TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE apa_messages ADD COLUMN asked_clarification TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE apa_usage ADD COLUMN cached_tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE apa_usage ADD COLUMN cache_hits INT NOT NULL DEFAULT 0;
ALTER TABLE apa_usage ADD COLUMN speech_device INT NOT NULL DEFAULT 0;
ALTER TABLE apa_usage ADD COLUMN speech_server INT NOT NULL DEFAULT 0;

ALTER TABLE apa_feedback ADD COLUMN answer_snapshot TEXT NULL;

-- ---------------------------------------------------------------------------
-- 7. New switches
-- ---------------------------------------------------------------------------

INSERT INTO app_settings (setting_key, value_text, description) SELECT 'apa_tts_mode', 'device', 'Where read-aloud happens: device (the phone''s own free TTS engine), server (Gemini, billed), or device_then_server (device when a Bangla voice is installed, server otherwise).' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'apa_tts_mode');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'apa_answer_cache_hours', '6', 'How long a non-personal answer may be reused within the same district and day. 0 disables the answer cache.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'apa_answer_cache_hours');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'apa_speech_cache_enabled', '1', 'Reuse synthesised audio for identical text. Only matters when read-aloud falls back to the server.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'apa_speech_cache_enabled');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'apa_prompt_examples', '1', 'Include the worked examples and crop calendar in the system instruction. On, the instruction is ~4,900 tokens and answers are measurably better; off, it is ~1,400 and cheaper per call on models where prompt caching does not apply.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'apa_prompt_examples');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'apa_retention_days', '180', 'Message bodies and transcripts older than this are pruned by the retention job. Scope verdicts and feedback are kept — they are the training-data asset.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'apa_retention_days');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'apa_image_max_px', '1024', 'Longest edge the app resizes a photo to before upload. A 12-megapixel camera photo is 1.5-4 MB of the farmer''s data for no diagnostic gain.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'apa_image_max_px');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'apa_live_client_ready', '0', 'Whether any shipped app build can actually stream PCM16 microphone audio. Separate from apa_live_mic_enabled so turning the platform switch on cannot produce a screen that claims to be listening with no socket behind it.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'apa_live_client_ready');

-- Model settings become fallback chains. First entry is tried first; on a
-- daily-quota refusal the next is used. Measured accuracy on the ten-case
-- scope set: 2.5-flash 10/10, 3.1-flash-lite 9/10, 3.5-flash 7/10.
-- Measured on the six-task capability battery with the new instruction:
-- 3.1-flash-lite 6/6.
UPDATE app_settings SET value_text = 'gemini-3.1-flash-lite,gemini-2.5-flash,gemini-3.5-flash',
  description = 'Answers and calls the grounding tools. Comma-separated fallback chain, tried in order when a model is out of its daily quota.'
 WHERE setting_key = 'apa_model_text';
UPDATE app_settings SET value_text = 'gemini-2.5-flash,gemini-3.1-flash-lite',
  description = 'The scope gate. Fallback chain. Runs with thinking disabled — with thinking on, the whole output budget was spent reasoning and the call returned no content at all.'
 WHERE setting_key = 'apa_model_classify';
UPDATE app_settings SET value_text = 'gemini-3.1-flash-lite,gemini-2.5-flash',
  description = 'Reads a photograph of a sick animal or crop. Fallback chain.'
 WHERE setting_key = 'apa_model_vision';
UPDATE app_settings SET value_text = 'gemini-2.5-flash-preview-tts,gemini-3.1-flash-tts-preview',
  description = 'Server-side speech, used only when the phone has no Bangla voice. Measured: 24.9 billed tokens per second of speech against 32.1 for the 3.1 preview, so the cheaper model is 61% cheaper rather than the 50% the price list implies.'
 WHERE setting_key = 'apa_model_tts';
UPDATE app_settings SET value_text = 'gemini-3.5-transcribe',
  description = 'Speech to text, with the farm vocabulary as bias. $0.003 a minute and the only option that keeps terms like গলাফুলা intact — do not substitute a general model here.'
 WHERE setting_key = 'apa_model_transcribe';
