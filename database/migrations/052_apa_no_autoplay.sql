-- 052_apa_no_autoplay.sql
--
-- Nothing reads itself aloud. She presses play.
--
-- WHY THIS IS ALSO THE CHEAPEST SETTING ON THE PAGE
--
-- apa_autoplay_voice made the server synthesise an answer whenever the question
-- arrived by voice or photo, on the assumption that someone who asked by
-- speaking wants to be answered by speaking. That was defensible, and it is
-- expensive in a way that compounds: server speech is $0.010 per 40-second
-- answer, and autoplay spends it on every single voice turn whether or not she
-- listens to the end - or at all, if she is reading over someone's shoulder.
--
-- With it off, the synthesis happens on the press. Every answer she does not
-- listen to costs nothing, and the ones she does are cached twice over: by
-- content hash on the server, so the same answer is never synthesised again for
-- anyone, and on her own phone, so a replay costs neither a request nor data.
--
-- It is also better manners. SRS V1 said it first: reading aloud to someone
-- sitting with other people is not a kindness. An answer that starts talking
-- by itself in a shared room is the app making a decision that was hers.
--
-- The voice is unchanged - apa_tts_mode stays 'server', so when she does press
-- play it is Apa reading, not the handset.

UPDATE app_settings
   SET value_text = '0',
       description = 'Off: nothing is read aloud until she presses play. Saves the ~$0.010 synthesis on every answer nobody listens to, and does not read aloud in a shared room uninvited.'
 WHERE setting_key = 'apa_autoplay_voice';
