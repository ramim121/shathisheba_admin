-- 054_apa_listened.sql
--
-- The answer's spoken length, recorded once someone has heard all of it.
--
-- WHY "ONCE HEARD IN FULL", AND NOT AT SYNTHESIS
--
-- The field-test instruction was explicit: show the seconds counting up while
-- an answer plays, and keep its length only after the whole of it has been
-- played. A length recorded at synthesis would be accurate but would say
-- nothing about the listener; recorded on a full play, the same column is
-- also the listen-through signal - which answers are heard to the end and
-- which are abandoned halfway, the one number that says whether the spoken
-- answer is the right length.
--
-- listened_full_at is the first time it was heard in full, kept so a later
-- replay does not move it.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'apa_messages'
              AND COLUMN_NAME = 'speech_seconds');
SET @s := IF(@c = 0,
  'ALTER TABLE apa_messages ADD COLUMN speech_seconds DECIMAL(7,2) NULL, ADD COLUMN listened_full_at DATETIME NULL',
  'SELECT 1');
PREPARE st FROM @s;
EXECUTE st;
DEALLOCATE PREPARE st;
