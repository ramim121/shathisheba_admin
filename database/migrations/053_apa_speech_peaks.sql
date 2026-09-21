-- 053_apa_speech_peaks.sql
--
-- The playbar draws the clip's real waveform, so the server has to send it.
--
-- WHY THE SERVER, AND WHY NOW
--
-- The playbar spec fixes the bar heights as the clip's actual amplitude
-- envelope, identical in every state: cold, loading, playing, finished. The
-- phone cannot measure that - it does not have the audio until she presses
-- play, so a real envelope could only appear after the press it is meant to
-- invite, and the shape would visibly change at the moment of loading. The
-- server holds the PCM at the instant it synthesises it, so it measures there
-- (lib/apa/pure.ts waveformPeaks) and ships 36 numbers alongside the URL.
--
-- Stored with the clip because the clip is cached by content: an answer
-- synthesised once is served to every later asker from this table, and each
-- of them should see the same shape without anyone decoding the WAV again.
--
-- Nullable because rows written before this migration have no envelope. The
-- player falls back to a stable generated shape for those, and
-- scripts/apa-backfill-peaks.cjs fills them in from the stored audio.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'apa_speech_cache'
              AND COLUMN_NAME = 'peaks_json');
SET @s := IF(@c = 0,
  'ALTER TABLE apa_speech_cache ADD COLUMN peaks_json VARCHAR(400) NULL AFTER seconds',
  'SELECT 1');
PREPARE st FROM @s;
EXECUTE st;
DEALLOCATE PREPARE st;
