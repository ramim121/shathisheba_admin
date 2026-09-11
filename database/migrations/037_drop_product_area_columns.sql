-- 037: remove the per-product area and text provenance added in 035. Where a
-- product is sold now comes from its distributors (036), and who made and
-- distributes it from the manufacturers / distributors tables.
-- Apply only after the code reading these columns is deployed.
-- Apply with: node scripts/apply-migration.cjs 037_drop_product_area_columns.sql

ALTER TABLE products DROP FOREIGN KEY fk_products_division;
ALTER TABLE products DROP FOREIGN KEY fk_products_district;
ALTER TABLE products DROP FOREIGN KEY fk_products_upazila;
ALTER TABLE products DROP INDEX idx_products_geo;
ALTER TABLE products DROP COLUMN division_id;
ALTER TABLE products DROP COLUMN district_id;
ALTER TABLE products DROP COLUMN upazila_id;
ALTER TABLE products DROP COLUMN manufactured_by;
ALTER TABLE products DROP COLUMN marketed_by;
ALTER TABLE products DROP COLUMN distributed_by;
ALTER TABLE products DROP COLUMN factory_address;
