-- 049_apa_client_errors.sql
--
-- Somewhere for the phone to say what actually went wrong.
--
-- WHY THIS EXISTS, AND WHAT IT COST NOT TO HAVE IT
--
-- Photo upload took four attempts and voice input took three, and the reason
-- was always the same: the failure happened on a handset and nothing about it
-- reached anyone who could read it. Each round produced "still broken" with no
-- information attached, so each fix was a guess about which React Native API
-- was at fault, shipped on the strength of a clean typecheck.
--
-- The server-side record made it worse by looking complete. apa_model_calls
-- showed ten transcription calls failing with a 500, which was true and was
-- last written at 03:26 -- and when the same farmer's voice messages failed
-- again at 03:53, there was no row at all, because the request never left the
-- phone. An empty table reads exactly like a working feature.
--
-- So the app posts its own failures here, with the technical detail it already
-- has and currently throws away. It is not analytics: nothing is recorded that
-- is not a failure, there is no session or device identity beyond the user who
-- was already authenticated, and `detail` is an error message rather than
-- anything she typed or said.
--
-- Retention rides on the existing apa_retention_days sweep.

CREATE TABLE IF NOT EXISTS apa_client_errors (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  -- Where in the flow it broke: 'upload', 'voice', 'photo', 'ask', 'speech',
  -- 'live'. Deliberately coarse; `stage` carries the precision.
  area            VARCHAR(24) NOT NULL,
  -- The step inside that area, e.g. 'read_file', 'post_multipart', 'transcribe'.
  stage           VARCHAR(48) NULL,
  -- Our own coded reason where there is one: upload_no_file, upload_failed.
  code            VARCHAR(48) NULL,
  http_status     SMALLINT UNSIGNED NULL,
  -- The real message, which is the whole point of the table.
  detail          TEXT NULL,
  -- Enough about the build to tell a stale install from a current one, which
  -- is a question that has already wasted a round of debugging.
  app_version     VARCHAR(24) NULL,
  platform        VARCHAR(16) NULL,
  os_version      VARCHAR(24) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_apa_client_errors_user (user_id, created_at),
  KEY idx_apa_client_errors_area (area, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
