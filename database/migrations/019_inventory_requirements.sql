-- Shathi Sheba Admin — migration 019: inventory movements, approval doc requirements,
-- buy-category ↔ preference interlink. Idempotent. MySQL 8+.

USE shathi_sheba;

-- Per-application required KYC docs (admin checkboxes on the approval drawer).
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='partner_applications' AND COLUMN_NAME='required_docs');
SET @s := IF(@c=0, 'ALTER TABLE partner_applications ADD COLUMN required_docs JSON NULL AFTER verification_notes', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Inventory ledger: every stock change with its reason, for decision-making history.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  change_qty DECIMAL(12,2) NOT NULL,
  reason ENUM('order','approval','adjustment','restock') NOT NULL DEFAULT 'adjustment',
  ref_code VARCHAR(60) NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inventory_product (product_id, created_at),
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Buy categories ↔ preference (interest) categories interlink.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='buy_categories' AND COLUMN_NAME='interest_slug');
SET @s := IF(@c=0, 'ALTER TABLE buy_categories ADD COLUMN interest_slug VARCHAR(120) NULL AFTER slug', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

UPDATE buy_categories SET interest_slug = 'livestock-poultry' WHERE slug = 'livestock' AND (interest_slug IS NULL OR interest_slug = '');
UPDATE buy_categories SET interest_slug = 'crops' WHERE slug = 'produce' AND (interest_slug IS NULL OR interest_slug = '');
UPDATE buy_categories SET interest_slug = 'inputs' WHERE slug IN ('seeds','fertilizer','shadhin-feed','agri-medicine') AND (interest_slug IS NULL OR interest_slug = '');
UPDATE buy_categories SET interest_slug = 'machinery' WHERE slug IN ('tools','machinery-rental') AND (interest_slug IS NULL OR interest_slug = '');
