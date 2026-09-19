-- 045_apa_paid_budget.sql
--
-- Billing was enabled on the Gemini project on 2026-09-19, with $10 credited
-- for the build-and-test window. This sets the ceiling the backend enforces
-- against, and it is one of the few settings whose default was actively
-- dangerous the moment it stopped being decorative.
--
-- WHY THE NUMBER CHANGES, AND WHY IT NOW BITES
--
-- apa_budget_usd was seeded at 200 in 041, where it did nothing but scale a
-- progress bar on the Usage and Cost page — the real brake was the free tier's
-- request quota, which simply refused once the day's allowance was gone. The
-- worst case was an assistant that stopped answering.
--
-- Enabling billing removed that brake and replaced it with an invoice. There is
-- now no upstream limit at all: a retry loop, a stuck cron or a key that leaked
-- into a shipped APK is not refused, it is billed. Against a $10 balance, a
-- ceiling of 200 is not a ceiling.
--
-- A Google Cloud budget does not close the gap either. It is an *alert* — it
-- emails a threshold crossing and carries on serving. The stop has to be on our
-- side of the API call, which is lib/apa/budget.ts, and this is the number it
-- reads.
--
-- WHAT HAPPENS AS IT FILLS (lib/apa/budget.ts)
--
--   under 70%   everything on
--   70%         the overnight pre-warm stops — speculative spend, so it is the
--               only thing here whose absence no farmer can notice that day
--   85%         live conversation stops (~$0.023/min against $0.0002 for a
--               typed answer, so one live call costs what a hundred questions
--               cost) and read-aloud falls back to the phone's own voice
--   100%        no new model calls — but answer-cache hits are still served,
--               because they cost nothing, and the phone still speaks them
--
-- So at the ceiling she still gets today's common questions answered aloud in
-- Bangla, with the field officer's number on anything else. That is a different
-- product from "Shathi Apa is unavailable", for the same money.
--
-- Raise this to 20-30 when the 50-farmer pilot starts; it is editable from the
-- Voice Config page, and saving it drops the cached spend figure immediately.

UPDATE app_settings
   SET value_text = '10',
       description = 'Hard monthly spend ceiling, enforced in lib/apa/budget.ts. Pre-warm stops at 70%, live at 85%, fresh model calls at 100% (cache hits still served).'
 WHERE setting_key = 'apa_budget_usd';

INSERT INTO app_settings (setting_key, value_text, description)
SELECT 'apa_budget_usd', '10',
       'Hard monthly spend ceiling, enforced in lib/apa/budget.ts. Pre-warm stops at 70%, live at 85%, fresh model calls at 100% (cache hits still served).'
 WHERE NOT EXISTS (
   SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'apa_budget_usd'
 );
