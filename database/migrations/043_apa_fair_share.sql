-- 043_apa_fair_share.sql
--
-- Two settings that only exist because of a property of the free tier: the
-- daily cap is on the *project*, not on the farmer.
--
-- 1. apa_fair_share_pct
--
--    Without it, one enthusiastic user — or one retry loop in a build nobody
--    has updated yet — can spend the whole day's allowance before most farmers
--    have woken up, and everybody else is told the assistant is busy. Past this
--    percentage of the day's own headroom, the per-farmer daily limit tightens
--    so the tail of the day is spread rather than taken.
--
--    Deliberately not a queue. Holding a question about a dying animal until
--    midnight Pacific is worse than an honest "come back tomorrow", because the
--    honest answer names the field officer and the queue does not.
--
--    100 switches it off.
--
-- 2. apa_prewarm_enabled
--
--    The daily allowance resets at midnight Pacific — two in the afternoon in
--    Dhaka — and almost nothing is asked between then and the next morning.
--    scripts/apa-prewarm.cjs spends a few dozen of those idle requests on the
--    questions farmers demonstrably ask every morning, so those mornings are
--    served from the cache at a cost of zero requests.
--
--    This is the free-tier substitute for the analysis document's fourth lever.
--    Gemini's Batch API — half price for work that can wait — is measured as
--    unavailable here: models/*:batchGenerateContent returns
--    400 FAILED_PRECONDITION on this project's key, which is what Google
--    returns when a feature needs billing enabled. On a tier where the limit is
--    requests rather than money, a request not made beats a discount anyway.

INSERT INTO app_settings (setting_key, value_text, description, updated_at)
SELECT 'apa_fair_share_pct', '75',
       'Percentage of the day''s model allowance at which Shathi Apa starts rationing the per-farmer daily limit, so one heavy user cannot take the tail of the day. 100 disables it.',
       NOW()
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key = 'apa_fair_share_pct');

INSERT INTO app_settings (setting_key, value_text, description, updated_at)
SELECT 'apa_prewarm_enabled', '1',
       'Whether scripts/apa-prewarm.cjs may spend idle overnight requests filling the answer cache with the questions farmers ask every morning. 0 switches it off.',
       NOW()
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE setting_key = 'apa_prewarm_enabled');
