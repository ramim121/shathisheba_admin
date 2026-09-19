-- 050_apa_transcribe_chain.sql
--
-- Gives voice input a fallback chain. It had one model and no second chance.
--
-- WHAT HAPPENED
--
-- apa_model_calls for 19 September: gemini-3.5-transcribe, 10 calls, 0
-- successes, every one a 500 "Internal error encountered". Every voice message
-- a farmer sent that day failed, and because transcription runs before the
-- turn is logged, apa_messages recorded nothing at all under input_mode='voice'
-- -- so the server-side record of a completely broken feature was an empty
-- table, which reads exactly like a feature nobody used.
--
-- The model itself is fine: probed directly the same day it transcribed Bangla
-- correctly in 2.4s, on the server's exact request shape, with the real
-- 141-term vocabulary. So those 500s were upstream flakiness, and the reason
-- they took the whole feature down is that a chain of one is not a chain.
--
-- ORDER, AND WHY
--
--   gemini-3.5-transcribe    purpose-built, and the only one that honours
--                            audioTranscriptionConfig's customVocabulary -
--                            which is why "খোলপচা" comes back as one word
--                            instead of "খোলা পচা"
--   gemini-3.1-flash-lite    fastest general model, 1.6-1.9s measured
--   gemini-3.5-flash-lite    the answering primary, so it is warm anyway
--
-- A WARNING THAT COMES WITH THIS
--
-- The general models only transcribe when the request carries an explicit
-- instruction. Measured: with audio alone they **answer the question** instead.
-- Asked "my rice leaves are going yellow" gemini-3.1-flash-lite returned "the
-- reasons rice leaves turn yellow are...", which would have been stored as what
-- the farmer said, and then answered. lib/apa/transcribe.ts now always sends
-- that instruction. Do not remove it while this chain has more than one entry.

UPDATE app_settings
   SET value_text = 'gemini-3.5-transcribe,gemini-3.1-flash-lite,gemini-3.5-flash-lite',
       description = 'Transcription fallback chain. The first entry is the only one honouring customVocabulary; the others need the explicit instruction in lib/apa/transcribe.ts or they answer the question instead of transcribing it.'
 WHERE setting_key = 'apa_model_transcribe';
