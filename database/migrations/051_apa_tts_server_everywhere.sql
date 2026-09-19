-- 051_apa_tts_server_everywhere.sql
--
-- Apa reads everything in her own voice. The user's decision, made after being
-- shown the cost.
--
-- WHAT THIS REVERSES, AND WHY THAT IS RIGHT
--
-- Migration 047 moved apa_tts_mode to 'device_then_server' on cost grounds:
-- server speech is measured at $0.01008 per 40-second answer, about six times
-- the $0.0016 the answer itself costs, and at fifty farmers that is roughly $28
-- a month against a $10 ceiling.
--
-- That reasoning was sound and the conclusion was still wrong for this product.
-- 'device_then_server' means the handset's own engine reads the answers, and on
-- most Android phones in Bangladesh that engine is male, approximate at Bangla,
-- and nothing like the person the farmer thinks she is talking to. For a farmer
-- who cannot read, the voice IS the product; saving money by replacing it with
-- a worse voice saves money on the only part that matters.
--
-- So: 'server'. Apa's voice on every answer, every starter, every read-aloud.
-- Her own recordings still play back as recordings - those are her voice, not
-- Apa's, and they cost nothing either way.
--
-- WHAT KEEPS THIS FROM BECOMING A SURPRISE INVOICE
--
-- Nothing about the ceiling changes. lib/apa/budget.ts still drops read-aloud
-- to the phone's voice at 85% of apa_budget_usd and stops fresh calls at 100%,
-- so the worst case is the old behaviour late in an expensive month rather than
-- an overspend. Three things make that band far harder to reach than $28/month
-- suggests:
--
--   * the server caches synthesised audio by content hash, so an answer that
--     fifty farmers get from the answer cache is synthesised once
--   * the phone caches the clip on disk, so a replay costs nothing at all
--   * the intro is one clip for the entire platform, for ever
--
-- If the band does start biting, the lever to reach for is
-- apa_live_minutes_monthly - live is $0.0272/min and buys far less - before
-- touching the voice again.

UPDATE app_settings
   SET value_text = 'server',
       description = 'device | device_then_server | server. Server means Apa reads every answer in her own voice. Costs ~$0.010 per 40s answer (measured), which is deliberate: for a farmer who cannot read, the voice is the product. budget.ts still falls back to the phone at 85% of the ceiling.'
 WHERE setting_key = 'apa_tts_mode';
