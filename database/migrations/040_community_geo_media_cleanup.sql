-- 040 — community post geography, and the two tables that were dead weight.
--
-- Three things, all of them cleanup of state the console exposed:
--
-- 1. community_posts was the one table the 031 geo backfill left unfinished:
--    17 of 25 rows carried district/upazila as text with no *_id. The feed
--    filter matches on ids and treats NULL as "everywhere", so those posts were
--    shown to every farmer in the country regardless of the district written on
--    them. This resolves the ids from the text through geo_aliases, the same
--    way 031 did for the other tables.
--
-- 2. notification_campaigns held two demo rows and is superseded by
--    `broadcasts` (which the console writes and the outbox reads). Nothing in
--    the codebase referenced it.
--
-- 3. geo_backfill_backup_031 is deliberately kept: it is the only copy of the
--    pre-backfill location text for 136 rows across eleven tables, it costs
--    almost nothing, and step 1 above is exactly the kind of correction it
--    exists to make reversible.

-- --- 1. finish the geo backfill for community posts ------------------------

UPDATE community_posts p
   JOIN geo_districts d
     ON LOWER(TRIM(p.district)) = LOWER(d.name_en)
    SET p.district_id = d.id,
        p.division_id = d.division_id
 WHERE p.district IS NOT NULL AND p.district <> '' AND p.district_id IS NULL;

-- Aliases catch the spellings that do not match name_en ("Chittagong").
UPDATE community_posts p
   JOIN geo_aliases a
     ON a.level = 'district' AND LOWER(TRIM(p.district)) = LOWER(a.alias)
   JOIN geo_districts d ON d.id = a.geo_id
    SET p.district_id = d.id,
        p.division_id = d.division_id
 WHERE p.district IS NOT NULL AND p.district <> '' AND p.district_id IS NULL;

UPDATE community_posts p
   JOIN geo_upazilas z
     ON LOWER(TRIM(p.upazila)) = LOWER(z.name_en)
    AND z.district_id = p.district_id
    SET p.upazila_id = z.id
 WHERE p.upazila IS NOT NULL AND p.upazila <> '' AND p.upazila_id IS NULL
   AND p.district_id IS NOT NULL;

UPDATE community_posts p
   JOIN geo_aliases a
     ON a.level = 'upazila' AND LOWER(TRIM(p.upazila)) = LOWER(a.alias)
   JOIN geo_upazilas z ON z.id = a.geo_id AND z.district_id = p.district_id
    SET p.upazila_id = z.id
 WHERE p.upazila IS NOT NULL AND p.upazila <> '' AND p.upazila_id IS NULL
   AND p.district_id IS NOT NULL;

-- A post whose scope says "bangladesh" must carry no area at all, or the area
-- filter would narrow a national post to one district.
UPDATE community_posts
   SET division_id = NULL, district_id = NULL, upazila_id = NULL,
       district = NULL, upazila = NULL
 WHERE scope = 'bangladesh';

-- --- 2. image URLs that can never load ------------------------------------
--
-- Some posts carry a device-local path written by an older app build
-- (file:///data/user/0/...). It is unreachable from anywhere, so it renders as
-- a broken image in the app and in the console. The post text is kept.

UPDATE community_posts
   SET image_url = NULL
 WHERE image_url IS NOT NULL
   AND image_url NOT LIKE 'http://%'
   AND image_url NOT LIKE 'https://%'
   AND image_url NOT LIKE '/uploads/%';

-- --- 3. drop the superseded campaign table --------------------------------

DROP TABLE IF EXISTS notification_campaigns;
