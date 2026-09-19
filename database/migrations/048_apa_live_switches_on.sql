-- 048_apa_live_switches_on.sql
--
-- Turns on both halves of the live gate, at the user's request, now that a
-- build containing react-native-audio-api exists and is installed.
--
-- Both are required since 868e13a. Until then only apa_live_mic_enabled was
-- consulted while the code claimed both were, so apa_live_client_ready sat in
-- the console as a switch that gated nothing.
--
--   apa_live_mic_enabled    the platform is willing to pay for live
--   apa_live_client_ready   builds in the field contain the PCM recorder
--
-- The second is the one to turn OFF in a hurry if a bad build goes out: it
-- closes live for every farmer without touching anything else, and without
-- needing an app release to do it.
--
-- Cost note, so this is not switched on blind: live is measured at $0.0272 a
-- minute. apa_live_minutes_monthly is 20, so fifty farmers at full use is $27 a
-- month against a $10 ceiling. lib/apa/budget.ts closes live at 85% of the
-- ceiling, so the ceiling holds regardless -- but live can consume most of it
-- before the text path gets any, which is why the allowance is worth lowering
-- for the test window.

UPDATE app_settings SET value_text = '1' WHERE setting_key = 'apa_live_mic_enabled';

INSERT INTO app_settings (setting_key, value_text, description)
SELECT 'apa_live_client_ready', '1',
       'On when builds in the field contain the native PCM recorder. Turn OFF to close live for everyone without an app release.'
 WHERE NOT EXISTS (
   SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'apa_live_client_ready'
 );

UPDATE app_settings SET value_text = '1' WHERE setting_key = 'apa_live_client_ready';
