-- 047_apa_tts_mode_paid.sql
--
-- Moves read-aloud off the paid voice by default. Measured 2026-09-19, the day
-- billing was enabled.
--
-- WHAT THE MEASUREMENT SHOWED
--
-- Resources/apa-probes/tts-cost.cjs, run against the billed key:
--
--   gemini-2.5-flash-preview-tts   24.9 billed tokens per second of speech
--                                  $0.01008 for a 40-second answer
--   gemini-3.1-flash-tts-preview   32.1 tokens/second
--                                  $0.02589 for the same answer
--
-- A typed answer from the chain costs about $0.0017. So *speaking* an answer
-- costs roughly six times as much as working it out. Read-aloud is not a line
-- item in this product's bill, it is the bill.
--
-- At fifty farmers asking three questions a day, with the 38% answer-cache hit
-- rate already measured, a month of server-side speech is about $28 — against a
-- $10 ceiling, and against the $20-30 the board approved for the whole pilot.
-- apa_tts_mode was left at 'server' from the free tier, where synthesis cost
-- requests rather than money and this was the right setting.
--
-- WHY 'device_then_server' RATHER THAN 'device'
--
-- Because the fallback is not a downgrade, it is the only option on some
-- phones. needsServerSpeech() in the app returns true exactly when the handset
-- has no usable Bangla voice installed — a stripped-down Android build with no
-- TTS engine, which is a real configuration among the phones this product
-- targets. On those handsets 'device' means silence, and silence is the failure
-- the whole voice-first design exists to prevent.
--
-- So: the phone speaks when it can, Apa speaks when it cannot. The farmers who
-- get the paid voice are the ones who would otherwise get nothing.
--
-- The intro clip is unaffected and stays Apa's own voice. It is synthesised
-- once for the whole product and stored permanently, so it costs $0.003 in
-- total rather than $0.003 per listener.
--
-- Set back to 'server' if the budget is raised and the voice is judged worth
-- it — the machinery is unchanged, and lib/apa/budget.ts will still fall back
-- to the phone past 85% of the ceiling.

UPDATE app_settings
   SET value_text = 'device_then_server',
       description = 'device | device_then_server | server. Server-side speech costs ~$0.010 per 40s answer (measured), about 6x the answer itself, so the phone speaks by default and Apa speaks on handsets with no Bangla voice.'
 WHERE setting_key = 'apa_tts_mode';
