-- 046_apa_billing_flag.sql
--
-- Tells the server which Gemini tier it is on. Enabled 2026-09-19.
--
-- WHY THIS IS A SETTING AND NOT A PROBE
--
-- Every per-day number in lib/apa/models.ts describes the free tier, and on a
-- billed key they are not merely stale — they cause harm. FREE_LIMITS records
-- gemini-2.5-flash at 20 requests a *day*, observed. On the billed key it
-- served 45 in 59 seconds. Left unconditional, dayHeadroom() would find the
-- answering chain exhausted after 20 questions, fairShareCap() would ration
-- every farmer to three a day, and the assistant would spend the afternoon
-- apologising for a limit that no longer exists.
--
-- The tier could in principle be inferred — fire sixteen requests in a minute
-- and see whether the free cap bites. It is not, for two reasons. Inferring a
-- limit from the *absence* of a 429 is the exact reasoning that produced the
-- "15 requests a day" error this project already had to unpick. And the person
-- who enabled billing knows the answer, so asking the API is answering a
-- question nobody needed to guess at.
--
-- WHAT IT SWITCHES
--
--   off  FREE_LIMITS in force; dayHeadroom divides the day's request cap;
--        fairShareCap tightens the per-farmer limit as that cap fills.
--   on   no daily request cap modelled; fairShareCap stands down; rationing
--        moves to money, in lib/apa/budget.ts, against apa_budget_usd.
--
-- Per-minute handling is unaffected either way. The cooling map in models.ts
-- reacts to a 429 when one arrives rather than predicting it, which is correct
-- on both tiers — paid RPM is high but finite.
--
-- Turn this OFF if billing ever lapses or the card is declined, and the
-- free-tier guards come back exactly as they were.

INSERT INTO app_settings (setting_key, value_text, description)
SELECT 'apa_billing_enabled', '1',
       'On when the Gemini project is billed. Off restores the free-tier request caps and fair-share rationing.'
 WHERE NOT EXISTS (
   SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'apa_billing_enabled'
 );

UPDATE app_settings SET value_text = '1' WHERE setting_key = 'apa_billing_enabled';
