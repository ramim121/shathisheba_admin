-- Shathi Sheba Admin — migration 018: buy-side categories for approved seller listings
-- Approved "list for sale" items become Products. Existing buy_categories are all
-- input-type (feed/seeds/etc); add Livestock + Produce so farmer-origin listings have
-- a home in Buy-from-Shathi. Idempotent (INSERT IGNORE on the unique slug). MySQL 8+.

USE shathi_sheba;

INSERT IGNORE INTO buy_categories (slug, name_en, name_bn, description_en, sort_order, is_active) VALUES
  ('livestock', 'Livestock', 'পশুসম্পদ', 'Cattle, goats, poultry and other livestock from verified sellers.', 10, 1),
  ('produce', 'Farm Produce', 'কৃষি পণ্য', 'Crops, vegetables, fruits and other produce from verified sellers.', 11, 1);
