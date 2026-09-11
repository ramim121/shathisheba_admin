-- 034: how much location a farmer's profile needs before any operational
-- offering (loan, order, listing, project). Separate from each feature's geo
-- scope: orders are covered and filtered by district, but the requirement is
-- that no operational service starts without the farmer's upazila on file.

USE shathi_sheba;

INSERT INTO app_settings (setting_key, value_text, description)
SELECT 'operational_profile_level', 'upazila',
       'Location a farmer must have on their profile before loans, orders, listings or projects: upazila or district.'
WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'operational_profile_level');
