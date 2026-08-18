-- Shathi Sheba Admin — migration 027: correct the development-plan action links.
--
-- The seed in 024 pointed at screens the app does not have:
--
--   screen:kycUpload  -> there is no kycUpload screen; the KYC documents screen
--                        is menuKyc
--   sheet:banking     -> banking is a screen (menuBanking), not a guidance sheet
--   sheet:farm        -> likewise menuFarm
--   screen:sell       -> the sell entry point is saleCategories
--   screen:learning   -> the training entry point is training
--
-- resolveActionLink() returns null for an unknown token and the row renders as
-- plain text, so the failure was silent: the task looked fine and simply did
-- nothing when tapped. Guidance sheets are a fixed set in the app
-- (GUIDANCE_TOPICS), so only those may appear behind `sheet:`.
--
-- Idempotent — each statement matches on the wrong value, so re-running finds
-- nothing to change.

USE shathi_sheba;

UPDATE development_plan_templates SET action_deeplink = 'screen:menuKyc'        WHERE action_deeplink = 'screen:kycUpload';
UPDATE development_plan_templates SET action_deeplink = 'screen:menuBanking'    WHERE action_deeplink = 'sheet:banking';
UPDATE development_plan_templates SET action_deeplink = 'screen:menuFarm'       WHERE action_deeplink = 'sheet:farm';
UPDATE development_plan_templates SET action_deeplink = 'screen:saleCategories' WHERE action_deeplink = 'screen:sell';
UPDATE development_plan_templates SET action_deeplink = 'screen:training'       WHERE action_deeplink = 'screen:learning';
UPDATE development_plan_templates SET action_deeplink = 'screen:projects'       WHERE action_deeplink = 'screen:project';
