-- 038: home partner strip, notifications (templates, in-app inbox, outbox,
-- push devices, admin broadcasts), approval snapshots, and each user's app
-- language so notifications arrive in the language the app is set to.
-- Apply with: node scripts/apply-migration.cjs 038_partners_notifications.sql

-- ---------------------------------------------------------------------------
-- 1. Buyers and partners shown on the app home screen
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_partners (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name_en VARCHAR(190) NOT NULL,
  name_bn VARCHAR(190) NULL,
  kind ENUM('buyer','partner','sponsor') NOT NULL DEFAULT 'buyer',
  badge_en VARCHAR(60) NULL,
  badge_bn VARCHAR(60) NULL,
  tagline_en VARCHAR(255) NULL,
  tagline_bn VARCHAR(255) NULL,
  description_en TEXT NULL,
  description_bn TEXT NULL,
  logo_url VARCHAR(500) NULL,
  website VARCHAR(255) NULL,
  phone VARCHAR(40) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_partners_order (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO business_partners (name_en, name_bn, kind, badge_en, badge_bn, tagline_en, tagline_bn, description_en, description_bn, logo_url, website, sort_order)
SELECT 'Bengal Meat', 'বেঙ্গল মিট', 'buyer', 'Primary buyer', 'প্রধান ক্রেতা',
       'Bangladesh''s first international-standard abattoir', 'বাংলাদেশের প্রথম আন্তর্জাতিক মানের কসাইখানা',
       'Buys fattened cattle from Shathi Sheba farmers at the agreed B2B rate.', 'শাথী সেবার কৃষকদের কাছ থেকে নির্ধারিত B2B দরে মোটাতাজা গরু কেনে।',
       'https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/partners/bengal-meat.png', 'https://bengalmeat.com', 1
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM business_partners WHERE name_en = 'Bengal Meat');
INSERT INTO business_partners (name_en, name_bn, kind, badge_en, badge_bn, tagline_en, tagline_bn, description_en, description_bn, logo_url, sort_order)
SELECT 'Khan Agro Farm', 'খান এগ্রো ফার্ম', 'buyer', 'Primary buyer', 'প্রধান ক্রেতা',
       'Cattle buyer and fattening farm', 'গরু ক্রেতা ও মোটাতাজাকরণ খামার',
       'Buys cattle from Shathi Sheba farmers at the agreed B2B rate.', 'শাথী সেবার কৃষকদের কাছ থেকে নির্ধারিত B2B দরে গরু কেনে।',
       'https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/partners/khan-agro.png', 2
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM business_partners WHERE name_en = 'Khan Agro Farm');
INSERT INTO business_partners (name_en, name_bn, kind, badge_en, badge_bn, tagline_en, tagline_bn, description_en, description_bn, logo_url, sort_order)
SELECT 'Angus Agro', 'অ্যাঙ্গাস এগ্রো', 'buyer', 'Primary buyer', 'প্রধান ক্রেতা',
       'Be natural', 'প্রাকৃতিক থাকুন',
       'Buys cattle from Shathi Sheba farmers at the agreed B2B rate.', 'শাথী সেবার কৃষকদের কাছ থেকে নির্ধারিত B2B দরে গরু কেনে।',
       'https://shathi-sheba.s3.ap-southeast-1.amazonaws.com/partners/angus-agro.png', 3
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM business_partners WHERE name_en = 'Angus Agro');

-- ---------------------------------------------------------------------------
-- 2. Notifications
-- ---------------------------------------------------------------------------
ALTER TABLE app_users ADD COLUMN app_lang ENUM('bn','en') NOT NULL DEFAULT 'bn';

-- One row per event. Text uses {{placeholders}}; the email layout (logo,
-- colours, footer) lives in code so every template looks the same.
CREATE TABLE IF NOT EXISTS notification_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_key VARCHAR(80) NOT NULL,
  name VARCHAR(190) NOT NULL,
  category ENUM('order','listing','enrollment','promotion','account','general') NOT NULL DEFAULT 'general',
  send_push TINYINT(1) NOT NULL DEFAULT 1,
  send_inapp TINYINT(1) NOT NULL DEFAULT 1,
  send_email TINYINT(1) NOT NULL DEFAULT 1,
  title_en VARCHAR(190) NOT NULL,
  title_bn VARCHAR(190) NOT NULL,
  body_en VARCHAR(500) NOT NULL,
  body_bn VARCHAR(500) NOT NULL,
  email_subject_en VARCHAR(190) NULL,
  email_subject_bn VARCHAR(190) NULL,
  email_body_en TEXT NULL,
  email_body_bn TEXT NULL,
  cta_label_en VARCHAR(60) NULL,
  cta_label_bn VARCHAR(60) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_template_event (event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The in-app inbox (the bell).
CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  event_key VARCHAR(80) NULL,
  broadcast_id BIGINT UNSIGNED NULL,
  title VARCHAR(190) NOT NULL,
  body VARCHAR(600) NOT NULL,
  data_json JSON NULL,
  lang ENUM('bn','en') NOT NULL DEFAULT 'bn',
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_un_user (user_id, id),
  KEY idx_un_unread (user_id, read_at),
  CONSTRAINT fk_un_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phones that can receive push. provider: expo (ExponentPushToken) or fcm
-- (native token, sent through Firebase directly).
CREATE TABLE IF NOT EXISTS push_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token VARCHAR(255) NOT NULL,
  provider ENUM('expo','fcm') NOT NULL,
  platform VARCHAR(20) NULL,
  app_version VARCHAR(40) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_token (token),
  KEY idx_push_user (user_id, is_active),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Messages sent by the admin to everyone, a role, or picked users.
CREATE TABLE IF NOT EXISTS broadcasts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title_en VARCHAR(190) NOT NULL,
  title_bn VARCHAR(190) NOT NULL,
  body_en VARCHAR(600) NOT NULL,
  body_bn VARCHAR(600) NOT NULL,
  target ENUM('all','roles','users') NOT NULL DEFAULT 'all',
  target_roles JSON NULL,
  target_user_ids JSON NULL,
  send_push TINYINT(1) NOT NULL DEFAULT 1,
  send_inapp TINYINT(1) NOT NULL DEFAULT 1,
  send_email TINYINT(1) NOT NULL DEFAULT 0,
  recipients INT NOT NULL DEFAULT 0,
  push_sent INT NOT NULL DEFAULT 0,
  push_skipped INT NOT NULL DEFAULT 0,
  emails_queued INT NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every email and push attempt, with its outcome. 'skipped' = no provider
-- configured yet (or no device); nothing is silently dropped.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  channel ENUM('email','push') NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  event_key VARCHAR(80) NULL,
  broadcast_id BIGINT UNSIGNED NULL,
  recipient VARCHAR(255) NULL,
  subject VARCHAR(255) NULL,
  body MEDIUMTEXT NULL,
  payload_json JSON NULL,
  status ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  error VARCHAR(500) NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  KEY idx_outbox_status (status, id),
  KEY idx_outbox_user (user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Approval snapshots: what an item looked like when it was last decided,
--    so a re-submission shows exactly what changed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approval_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_type VARCHAR(30) NOT NULL,
  item_id BIGINT UNSIGNED NOT NULL,
  decision VARCHAR(20) NOT NULL,
  data_json JSON NOT NULL,
  admin_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_snap_item (item_type, item_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Seeded templates
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO notification_templates
  (event_key, name, category, title_en, title_bn, body_en, body_bn, email_subject_en, email_subject_bn, email_body_en, email_body_bn, cta_label_en, cta_label_bn)
VALUES
('order_placed', 'Order placed', 'order',
 'Order received · {{order_code}}', 'অর্ডার পেয়েছি · {{order_code}}',
 'We received your order for {{items}}. To pay: ৳{{payable}}. We will confirm it after a stock check.',
 'আপনার {{items}} অর্ডার পেয়েছি। পরিশোধযোগ্য: ৳{{payable}}। স্টক যাচাইয়ের পর নিশ্চিত করা হবে।',
 'We received your order {{order_code}}', 'আপনার অর্ডার {{order_code}} পেয়েছি',
 'Hello {{name}},\n\nThank you for ordering from Buy from Shathi. We have received your order for **{{items}}**.\n\nAmount to pay: **৳{{payable}}**{{discount_line}}\nDelivery to: {{delivery_area}}\n\nOur team checks the stock first; you will hear from us as soon as the order is confirmed.',
 'প্রিয় {{name}},\n\nশাথী থেকে কেনার জন্য ধন্যবাদ। আপনার **{{items}}** অর্ডারটি আমরা পেয়েছি।\n\nপরিশোধযোগ্য: **৳{{payable}}**{{discount_line}}\nডেলিভারি: {{delivery_area}}\n\nআগে মজুদ যাচাই করা হবে; অর্ডার নিশ্চিত হলেই আপনাকে জানানো হবে।',
 'View my order', 'অর্ডার দেখুন'),
('order_confirmed', 'Order confirmed', 'order',
 'Order confirmed · {{order_code}}', 'অর্ডার নিশ্চিত · {{order_code}}',
 'Good news — {{order_code}} is confirmed and is being prepared{{by_distributor}}.',
 'সুখবর — {{order_code}} নিশ্চিত হয়েছে এবং প্রস্তুত করা হচ্ছে{{by_distributor}}।',
 'Your order {{order_code}} is confirmed', 'আপনার অর্ডার {{order_code}} নিশ্চিত হয়েছে',
 'Hello {{name}},\n\nYour order **{{order_code}}** passed the stock check and is confirmed.\n\nIt is being prepared for delivery{{by_distributor}}. Amount to pay: **৳{{payable}}**.',
 'প্রিয় {{name}},\n\nআপনার অর্ডার **{{order_code}}** মজুদ যাচাইয়ে উত্তীর্ণ হয়ে নিশ্চিত হয়েছে।\n\nডেলিভারির জন্য প্রস্তুত করা হচ্ছে{{by_distributor}}। পরিশোধযোগ্য: **৳{{payable}}**।',
 'Track my order', 'অর্ডার ট্র্যাক করুন'),
('order_on_the_way', 'Order on the way', 'order',
 'Your order is on the way', 'আপনার অর্ডার পথে আছে',
 '{{order_code}} has been dispatched{{by_distributor}}. Please keep ৳{{payable}} ready.',
 '{{order_code}} পাঠানো হয়েছে{{by_distributor}}। অনুগ্রহ করে ৳{{payable}} প্রস্তুত রাখুন।',
 'Your order {{order_code}} is on the way', 'আপনার অর্ডার {{order_code}} পথে আছে',
 'Hello {{name}},\n\nYour order **{{order_code}}** has left the warehouse{{by_distributor}} and is on its way to {{delivery_area}}.\n\nPlease keep **৳{{payable}}** ready if you are paying on delivery.',
 'প্রিয় {{name}},\n\nআপনার অর্ডার **{{order_code}}** গুদাম থেকে রওনা হয়েছে{{by_distributor}} এবং {{delivery_area}}-এ আসছে।\n\nডেলিভারির সময় পরিশোধ করলে **৳{{payable}}** প্রস্তুত রাখুন।',
 'Track my order', 'অর্ডার ট্র্যাক করুন'),
('order_delivered', 'Order delivered', 'order',
 'Order delivered · {{order_code}}', 'অর্ডার পৌঁছেছে · {{order_code}}',
 '{{order_code}} has been delivered. Thank you for buying from Shathi!',
 '{{order_code}} পৌঁছে গেছে। শাথী থেকে কেনার জন্য ধন্যবাদ!',
 'Your order {{order_code}} was delivered', 'আপনার অর্ডার {{order_code}} পৌঁছে গেছে',
 'Hello {{name}},\n\nYour order **{{order_code}}** has been delivered. We hope it serves you well.\n\nIf anything is wrong with it, reply to this email or call your field officer.',
 'প্রিয় {{name}},\n\nআপনার অর্ডার **{{order_code}}** পৌঁছে গেছে। আশা করি এটি আপনার কাজে আসবে।\n\nকোনো সমস্যা হলে এই ইমেইলের উত্তর দিন বা আপনার মাঠ কর্মকর্তাকে ফোন করুন।',
 'View my order', 'অর্ডার দেখুন'),
('order_cancelled', 'Order cancelled', 'order',
 'Order not accepted · {{order_code}}', 'অর্ডার গ্রহণ করা যায়নি · {{order_code}}',
 '{{order_code}} could not be accepted. Any discount on it has been kept for your next order.',
 '{{order_code}} গ্রহণ করা যায়নি। এতে কোনো ছাড় থাকলে তা আপনার পরের অর্ডারের জন্য রাখা হয়েছে।',
 'Your order {{order_code}} could not be accepted', 'আপনার অর্ডার {{order_code}} গ্রহণ করা যায়নি',
 'Hello {{name}},\n\nWe are sorry — your order **{{order_code}}** could not be accepted this time.{{reason_line}}\n\nNo money has been taken for it, and any discount it carried is kept for your next order.',
 'প্রিয় {{name}},\n\nদুঃখিত — এবার আপনার অর্ডার **{{order_code}}** গ্রহণ করা যায়নি।{{reason_line}}\n\nএর জন্য কোনো টাকা নেওয়া হয়নি, এবং এতে থাকা ছাড় আপনার পরের অর্ডারের জন্য রাখা হয়েছে।',
 'Shop again', 'আবার কিনুন'),
('voucher_issued', 'Voucher issued', 'promotion',
 'You have a ৳{{amount}} voucher', 'আপনি ৳{{amount}} ভাউচার পেয়েছেন',
 'Your first order did not go through, so ৳{{amount}} comes off your next order over ৳{{min}} automatically.',
 'আপনার প্রথম অর্ডারটি সম্পন্ন হয়নি, তাই ৳{{min}}-এর বেশি পরের অর্ডারে ৳{{amount}} নিজে থেকেই কমবে।',
 'A ৳{{amount}} voucher for your next order', 'পরের অর্ডারের জন্য ৳{{amount}} ভাউচার',
 'Hello {{name}},\n\nYour first order did not go through, and we do not want you to lose your first-purchase discount.\n\nA **৳{{amount}} voucher** is now on your account. It is applied automatically to your next order over ৳{{min}}.',
 'প্রিয় {{name}},\n\nআপনার প্রথম অর্ডারটি সম্পন্ন হয়নি, আর আমরা চাই না আপনি প্রথম কেনাকাটার ছাড় হারান।\n\nআপনার অ্যাকাউন্টে এখন একটি **৳{{amount}} ভাউচার** আছে। ৳{{min}}-এর বেশি পরের অর্ডারে এটি নিজে থেকেই যোগ হবে।',
 'Shop now', 'এখনই কিনুন'),
('listing_submitted', 'Listing submitted', 'listing',
 'Listing received · {{listing_code}}', 'তালিকা পেয়েছি · {{listing_code}}',
 'Your {{animal}} listing is in. A field officer will visit within 3 working days to verify it.',
 'আপনার {{animal}} তালিকা জমা হয়েছে। যাচাইয়ের জন্য ৩ কর্মদিনের মধ্যে মাঠ কর্মকর্তা আসবেন।',
 'Your listing {{listing_code}} is received', 'আপনার তালিকা {{listing_code}} জমা হয়েছে',
 'Hello {{name}},\n\nThank you for listing your **{{animal}}** with Shathi Sheba.\n\nEstimated earning: **৳{{estimate}}** (final payment uses the weight the field officer verifies).\n\nA field officer will visit within 3 working days to photograph, identify and weigh the animal.',
 'প্রিয় {{name}},\n\nশাথী সেবায় আপনার **{{animal}}** তালিকাভুক্ত করার জন্য ধন্যবাদ।\n\nআনুমানিক আয়: **৳{{estimate}}** (চূড়ান্ত পেমেন্ট মাঠ কর্মকর্তার যাচাইকৃত ওজনে)।\n\n৩ কর্মদিনের মধ্যে মাঠ কর্মকর্তা এসে পশুর ছবি, পরিচয় ও ওজন যাচাই করবেন।',
 'See my listing', 'তালিকা দেখুন'),
('listing_visit_scheduled', 'Field visit scheduled', 'listing',
 'Field visit on {{visit_date}}', 'মাঠ পরিদর্শন {{visit_date}}',
 'A field officer will visit on {{visit_date}} to verify your {{animal}} ({{listing_code}}).',
 '{{visit_date}} তারিখে মাঠ কর্মকর্তা আপনার {{animal}} ({{listing_code}}) যাচাই করতে আসবেন।',
 'Field visit on {{visit_date}}', 'মাঠ পরিদর্শন {{visit_date}}',
 'Hello {{name}},\n\nA field officer will visit on **{{visit_date}}** to verify your {{animal}} ({{listing_code}}).\n\nPlease keep the animal at home that day so it can be photographed and weighed.',
 'প্রিয় {{name}},\n\n**{{visit_date}}** তারিখে মাঠ কর্মকর্তা আপনার {{animal}} ({{listing_code}}) যাচাই করতে আসবেন।\n\nছবি তোলা ও ওজন নেওয়ার জন্য সেদিন পশুটি বাড়িতে রাখুন।',
 'See my listing', 'তালিকা দেখুন'),
('listing_verified', 'Field verification passed', 'listing',
 'Verification passed · {{listing_code}}', 'যাচাই সম্পন্ন · {{listing_code}}',
 'Your {{animal}} passed field verification at {{weight}} kg. Approval comes next.',
 'আপনার {{animal}} {{weight}} কেজি ওজনে মাঠ যাচাইয়ে উত্তীর্ণ। এরপর অনুমোদন।',
 'Your listing {{listing_code}} passed verification', 'আপনার তালিকা {{listing_code}} যাচাইয়ে উত্তীর্ণ',
 'Hello {{name}},\n\nYour **{{animal}}** passed field verification.\n\nVerified live weight: **{{weight}} kg**. The listing now goes for approval.',
 'প্রিয় {{name}},\n\nআপনার **{{animal}}** মাঠ যাচাইয়ে উত্তীর্ণ হয়েছে।\n\nযাচাইকৃত জীবিত ওজন: **{{weight}} কেজি**। এখন তালিকাটি অনুমোদনের জন্য যাবে।',
 'See my listing', 'তালিকা দেখুন'),
('listing_approved', 'Listing approved', 'listing',
 'Listing approved · {{listing_code}}', 'তালিকা অনুমোদিত · {{listing_code}}',
 'Your {{animal}} is approved and offered to buyers.',
 'আপনার {{animal}} অনুমোদিত হয়েছে এবং ক্রেতাদের কাছে দেওয়া হয়েছে।',
 'Your listing {{listing_code}} is approved', 'আপনার তালিকা {{listing_code}} অনুমোদিত',
 'Hello {{name}},\n\nYour **{{animal}}** listing is approved and is now offered to our buyers.\n\nWe will let you know as soon as a buyer accepts the contract.',
 'প্রিয় {{name}},\n\nআপনার **{{animal}}** তালিকা অনুমোদিত হয়েছে এবং আমাদের ক্রেতাদের কাছে দেওয়া হয়েছে।\n\nকোনো ক্রেতা চুক্তি গ্রহণ করলেই জানানো হবে।',
 'See my listing', 'তালিকা দেখুন'),
('listing_rejected', 'Listing not approved', 'listing',
 'Listing not approved · {{listing_code}}', 'তালিকা অনুমোদিত হয়নি · {{listing_code}}',
 'Your {{animal}} listing could not be approved.{{reason}} Please talk to your field officer.',
 'আপনার {{animal}} তালিকা অনুমোদন করা যায়নি।{{reason}} অনুগ্রহ করে মাঠ কর্মকর্তার সাথে কথা বলুন।',
 'Your listing {{listing_code}} was not approved', 'আপনার তালিকা {{listing_code}} অনুমোদিত হয়নি',
 'Hello {{name}},\n\nWe are sorry — your **{{animal}}** listing ({{listing_code}}) could not be approved.{{reason_line}}\n\nYour field officer can explain and help you list again.',
 'প্রিয় {{name}},\n\nদুঃখিত — আপনার **{{animal}}** তালিকা ({{listing_code}}) অনুমোদন করা যায়নি।{{reason_line}}\n\nআপনার মাঠ কর্মকর্তা কারণ জানাবেন এবং আবার তালিকা দিতে সাহায্য করবেন।',
 'See my listing', 'তালিকা দেখুন'),
('listing_contracted', 'Purchase contract accepted', 'listing',
 'Buyer found for your {{animal}}', 'আপনার {{animal}}-এর ক্রেতা পাওয়া গেছে',
 '{{buyer}} accepted the contract at ৳{{rate}}/kg live.{{advance}}',
 '{{buyer}} প্রতি কেজি জীবিত ৳{{rate}} দরে চুক্তি গ্রহণ করেছেন।{{advance}}',
 'A buyer accepted your {{animal}}', 'একজন ক্রেতা আপনার {{animal}} নিয়েছেন',
 'Hello {{name}},\n\nGreat news — **{{buyer}}** accepted the purchase contract for your {{animal}} ({{listing_code}}) at **৳{{rate}}/kg live**.{{advance}}\n\nThe handover and transport will be arranged by the platform.',
 'প্রিয় {{name}},\n\nসুখবর — **{{buyer}}** আপনার {{animal}} ({{listing_code}})-এর ক্রয় চুক্তি **প্রতি কেজি জীবিত ৳{{rate}}** দরে গ্রহণ করেছেন।{{advance}}\n\nহস্তান্তর ও পরিবহনের ব্যবস্থা প্ল্যাটফর্ম করবে।',
 'See my listing', 'তালিকা দেখুন'),
('listing_shipped', 'Animal dispatched', 'listing',
 'Your {{animal}} is on its way to the buyer', 'আপনার {{animal}} ক্রেতার কাছে যাচ্ছে',
 '{{listing_code}} was handed over and dispatched. Payment follows the buyer''s check.',
 '{{listing_code}} হস্তান্তর করে পাঠানো হয়েছে। ক্রেতার যাচাইয়ের পর পেমেন্ট।',
 'Your {{animal}} has been dispatched', 'আপনার {{animal}} পাঠানো হয়েছে',
 'Hello {{name}},\n\nYour **{{animal}}** ({{listing_code}}) has been handed over and is on its way to the buyer with its digital animal record.\n\nYour payment follows once the buyer confirms receipt.',
 'প্রিয় {{name}},\n\nআপনার **{{animal}}** ({{listing_code}}) হস্তান্তর করা হয়েছে এবং ডিজিটাল পশু রেকর্ডসহ ক্রেতার কাছে যাচ্ছে।\n\nক্রেতা গ্রহণ নিশ্চিত করলেই আপনার পেমেন্ট।',
 'See my listing', 'তালিকা দেখুন'),
('listing_paid', 'Farmer paid', 'listing',
 'Payment sent · ৳{{amount}}', 'পেমেন্ট পাঠানো হয়েছে · ৳{{amount}}',
 '৳{{amount}} for your {{animal}} ({{listing_code}}) was paid by {{method}}.',
 'আপনার {{animal}} ({{listing_code}})-এর জন্য ৳{{amount}} {{method}}-এ পরিশোধ করা হয়েছে।',
 'You were paid ৳{{amount}}', 'আপনাকে ৳{{amount}} পরিশোধ করা হয়েছে',
 'Hello {{name}},\n\nWe have paid **৳{{amount}}** for your {{animal}} ({{listing_code}}) by {{method}}.\n\nReference: {{reference}}\n\nThank you for selling with Shathi Sheba.',
 'প্রিয় {{name}},\n\nআপনার {{animal}} ({{listing_code}})-এর জন্য **৳{{amount}}** {{method}}-এ পরিশোধ করা হয়েছে।\n\nরেফারেন্স: {{reference}}\n\nশাথী সেবার সাথে বিক্রির জন্য ধন্যবাদ।',
 'See my listing', 'তালিকা দেখুন'),
('enrollment_submitted', 'Project application submitted', 'enrollment',
 'Application received · {{project}}', 'আবেদন পেয়েছি · {{project}}',
 'Your application to {{project}} is in. We will review your documents and let you know.',
 '{{project}}-এ আপনার আবেদন জমা হয়েছে। কাগজপত্র যাচাই করে জানানো হবে।',
 'Your application to {{project}} is received', '{{project}}-এ আপনার আবেদন জমা হয়েছে',
 'Hello {{name}},\n\nThank you for applying to **{{project}}**.\n\nOur team will check your documents and visit if needed. You will hear from us as soon as there is a decision.',
 'প্রিয় {{name}},\n\n**{{project}}**-এ আবেদনের জন্য ধন্যবাদ।\n\nআমাদের দল আপনার কাগজপত্র যাচাই করবে এবং প্রয়োজনে পরিদর্শন করবে। সিদ্ধান্ত হলেই জানানো হবে।',
 'See my application', 'আবেদন দেখুন'),
('enrollment_approved', 'Project application approved', 'enrollment',
 'Welcome to {{project}}!', '{{project}}-এ স্বাগতম!',
 'Your application is approved. Your field officer will contact you about the next steps.',
 'আপনার আবেদন অনুমোদিত হয়েছে। পরবর্তী ধাপ নিয়ে মাঠ কর্মকর্তা যোগাযোগ করবেন।',
 'You are enrolled in {{project}}', 'আপনি {{project}}-এ যুক্ত হয়েছেন',
 'Hello {{name}},\n\nCongratulations — your application to **{{project}}** is approved.\n\nYour field officer will contact you about inputs, training and the next steps.',
 'প্রিয় {{name}},\n\nঅভিনন্দন — **{{project}}**-এ আপনার আবেদন অনুমোদিত হয়েছে।\n\nউপকরণ, প্রশিক্ষণ ও পরবর্তী ধাপ নিয়ে মাঠ কর্মকর্তা আপনার সাথে যোগাযোগ করবেন।',
 'See my project', 'প্রকল্প দেখুন'),
('enrollment_rejected', 'Project application not approved', 'enrollment',
 'Application not approved · {{project}}', 'আবেদন অনুমোদিত হয়নি · {{project}}',
 'Your application to {{project}} could not be approved this time.{{reason}}',
 'এবার {{project}}-এ আপনার আবেদন অনুমোদন করা যায়নি।{{reason}}',
 'Your application to {{project}}', '{{project}}-এ আপনার আবেদন',
 'Hello {{name}},\n\nWe are sorry — your application to **{{project}}** could not be approved this time.{{reason_line}}\n\nYou can apply to other open projects, or talk to your field officer about what to improve.',
 'প্রিয় {{name}},\n\nদুঃখিত — এবার **{{project}}**-এ আপনার আবেদন অনুমোদন করা যায়নি।{{reason_line}}\n\nআপনি অন্য চলমান প্রকল্পে আবেদন করতে পারেন, অথবা কী উন্নতি করতে হবে তা জানতে মাঠ কর্মকর্তার সাথে কথা বলুন।',
 'See projects', 'প্রকল্প দেখুন');
