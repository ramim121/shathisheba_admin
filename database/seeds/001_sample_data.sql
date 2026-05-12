USE shathi_sheba;

INSERT INTO admin_users
  (id, name, email, phone, password_hash, role, district, upazila, is_active)
VALUES
  (1, 'Ramim Admin', 'admin@shathisheba.local', '01700000001', '$2b$12$sample.hash.for.local.seed.only', 'super_admin', 'Dhaka', 'Dhaka', 1),
  (2, 'Rana Hossain', 'rana.field@shathisheba.local', '01700000002', '$2b$12$sample.hash.for.local.seed.only', 'field_officer', 'Mymensingh', 'Mymensingh Sadar', 1),
  (3, 'Sadia Khatun', 'sadia.content@shathisheba.local', '01700000003', '$2b$12$sample.hash.for.local.seed.only', 'content_editor', 'Dhaka', 'Dhaka', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  role = VALUES(role),
  district = VALUES(district),
  upazila = VALUES(upazila),
  is_active = VALUES(is_active);

INSERT INTO app_users
  (id, full_name, display_name, phone, email, gender, date_of_birth, district, upazila, union_name, village, latitude, longitude, status, profile_json)
VALUES
  (1, 'Md. Rahim', 'Rahim', '01712-345678', 'rahim@example.com', 'male', '1990-05-12', 'Mymensingh', 'Mymensingh Sadar', 'Char Nilakkhmiya', 'Char Para', 24.7471000, 90.4203000, 'active', JSON_OBJECT('primary_work', 'livestock', 'language', 'bn')),
  (2, 'Fatema Khatun', 'Fatema', '01812-222333', 'fatema@example.com', 'female', '1988-09-20', 'Mymensingh', 'Mymensingh Sadar', 'Aqua Union', 'Kazir Char', 24.7540000, 90.4180000, 'active', JSON_OBJECT('primary_work', 'rice', 'language', 'bn')),
  (3, 'Rasel Mia', 'Rasel', '01933-555888', 'rasel@example.com', 'male', '1995-01-11', 'Rangpur', 'Mithapukur', 'Boro Union', 'Uttar Para', 25.5480000, 89.2840000, 'active', JSON_OBJECT('primary_work', 'inputs', 'language', 'bn')),
  (4, 'Aklima Begum', 'Aklima', '01611-222444', 'aklima@example.com', 'female', '1992-03-02', 'Mymensingh', 'Trishal', 'Kanihari', 'Madhupur', 24.5780000, 90.3940000, 'active', JSON_OBJECT('primary_work', 'vegetables', 'language', 'bn'))
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  district = VALUES(district),
  upazila = VALUES(upazila),
  status = VALUES(status),
  profile_json = VALUES(profile_json);

INSERT INTO media_assets
  (id, owner_type, owner_id, asset_type, title, alt_text, url, mime_type, metadata)
VALUES
  (1, 'system', NULL, 'icon', 'Cow icon', 'Cow category icon', '/icons/cow.png', 'image/png', JSON_OBJECT('emoji', '🐄')),
  (2, 'system', NULL, 'icon', 'Rice icon', 'Rice category icon', '/icons/rice.png', 'image/png', JSON_OBJECT('emoji', '🌾')),
  (3, 'learning_module', 1, 'thumbnail', 'Cattle health thumbnail', 'Cattle health management', '/uploads/learning/cattle-health.png', 'image/png', JSON_OBJECT('color', 'rose')),
  (4, 'product', 1, 'image', 'Shadhin cattle feed pack', 'Feed pack image', '/uploads/products/shadhin-cattle-feed.png', 'image/png', JSON_OBJECT('pack_size', '50kg'))
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  url = VALUES(url),
  metadata = VALUES(metadata);

INSERT INTO interest_categories
  (id, parent_id, slug, name_en, name_bn, description_en, description_bn, icon_asset_id, emoji, sort_order, step_group, is_selectable, is_active)
VALUES
  (1, NULL, 'livestock-poultry', 'Cattle & Poultry', 'গবাদি পশু ও পোল্ট্রি', 'Livestock and poultry work areas', 'গবাদি পশু ও পোল্ট্রি সম্পর্কিত কাজ', 1, '🐄', 1, 'root', 1, 1),
  (2, NULL, 'crops', 'Crops', 'ফসল', 'Crop related work areas', 'ফসল সম্পর্কিত কাজ', 2, '🌾', 2, 'root', 1, 1),
  (3, NULL, 'fishery', 'Fishery', 'মৎস্য', 'Fish cultivation and support', 'মাছ চাষ ও সহায়তা', NULL, '🐟', 3, 'root', 1, 1),
  (4, NULL, 'vegetables', 'Vegetables', 'সবজি', 'Vegetable production and care', 'সবজি উৎপাদন ও পরিচর্যা', NULL, '🥬', 4, 'root', 1, 1),
  (5, NULL, 'fruits', 'Fruits', 'ফল', 'Fruit production and support', 'ফল উৎপাদন ও সহায়তা', NULL, '🥭', 5, 'root', 1, 1),
  (11, 1, 'cow', 'Cow', 'গরু', 'Cow, bull and calf', 'গরু, ষাঁড় ও বাছুর', 1, '🐄', 1, 'livestock', 1, 1),
  (12, 1, 'goat', 'Goat', 'ছাগল', 'Local and improved goat breeds', 'স্থানীয় ও উন্নত জাতের ছাগল', NULL, '🐐', 2, 'livestock', 1, 1),
  (13, 1, 'chicken', 'Chicken', 'মুরগি', 'Broiler, layer and native chicken', 'ব্রয়লার, লেয়ার ও দেশি মুরগি', NULL, '🐔', 3, 'poultry', 1, 1),
  (14, 1, 'duck', 'Duck', 'হাঁস', 'Duck farming', 'হাঁস পালন', NULL, '🦆', 4, 'poultry', 1, 1),
  (21, 2, 'rice', 'Rice', 'ধান', 'Boro and Aman rice', 'বোরো ও আমন ধান', 2, '🌾', 1, 'crops', 1, 1),
  (22, 2, 'corn', 'Corn', 'ভুট্টা', 'Corn production', 'ভুট্টা উৎপাদন', NULL, '🌽', 2, 'crops', 1, 1),
  (23, 2, 'onion', 'Onion', 'পেঁয়াজ', 'Onion farming', 'পেঁয়াজ চাষ', NULL, '🧅', 3, 'crops', 1, 1),
  (31, 3, 'rohu', 'Rohu', 'রুই', 'Rohu fish', 'রুই মাছ', NULL, '🐟', 1, 'fishery', 1, 1),
  (32, 3, 'catla', 'Catla', 'কাতলা', 'Catla fish', 'কাতলা মাছ', NULL, '🐟', 2, 'fishery', 1, 1),
  (41, 4, 'tomato', 'Tomato', 'টমেটো', 'Tomato production', 'টমেটো উৎপাদন', NULL, '🍅', 1, 'vegetables', 1, 1),
  (42, 4, 'potato', 'Potato', 'আলু', 'Potato farming', 'আলু চাষ', NULL, '🥔', 2, 'vegetables', 1, 1),
  (51, 5, 'mango', 'Mango', 'আম', 'Mango production', 'আম উৎপাদন', NULL, '🥭', 1, 'fruits', 1, 1),
  (52, 5, 'banana', 'Banana', 'কলা', 'Banana production', 'কলা উৎপাদন', NULL, '🍌', 2, 'fruits', 1, 1)
ON DUPLICATE KEY UPDATE
  parent_id = VALUES(parent_id),
  name_en = VALUES(name_en),
  name_bn = VALUES(name_bn),
  description_en = VALUES(description_en),
  description_bn = VALUES(description_bn),
  icon_asset_id = VALUES(icon_asset_id),
  emoji = VALUES(emoji),
  sort_order = VALUES(sort_order),
  step_group = VALUES(step_group),
  is_selectable = VALUES(is_selectable),
  is_active = VALUES(is_active);

INSERT INTO user_interests (user_id, interest_category_id)
VALUES
  (1, 1), (1, 11), (1, 21),
  (2, 2), (2, 21), (2, 41),
  (3, 2), (3, 22), (3, 5),
  (4, 4), (4, 41), (4, 42)
ON DUPLICATE KEY UPDATE user_id = VALUES(user_id);

INSERT INTO weather_alerts
  (id, district, upazila, alert_type, severity, title_en, title_bn, body_en, body_bn, weather_payload, source, starts_at, ends_at, send_push, is_active, created_by)
VALUES
  (1, 'Mymensingh', 'Mymensingh Sadar', 'heat', 'advisory', 'Warm today, humidity is high', 'আজ গরম, আর্দ্রতা বেশি', 'Be careful drying crops and storing livestock feed.', 'ফসল শুকানো এবং পশুখাদ্য সংরক্ষণে সতর্ক থাকুন।', JSON_OBJECT('temperature_c', 31, 'humidity', 40, 'wind_kmh', 12, 'rain_chance', 65), 'hybrid', NOW(), DATE_ADD(NOW(), INTERVAL 1 DAY), 1, 1, 1),
  (2, 'Mymensingh', NULL, 'rain', 'watch', 'Rain possible after evening', 'সন্ধ্যার পর বৃষ্টির সম্ভাবনা', 'Cover dry grass and stored feed.', 'শুকনো ঘাস ও সংরক্ষিত খাবার ঢেকে রাখুন।', JSON_OBJECT('temperature_c', 28, 'humidity', 74, 'rain_chance', 78), 'admin_local', NOW(), DATE_ADD(NOW(), INTERVAL 12 HOUR), 1, 1, 1),
  (3, 'Chattogram', NULL, 'maritime', 'info', 'Maritime port signal monitoring', 'সমুদ্রবন্দর সংকেত পর্যবেক্ষণ', 'No high local warning now, but monitor port signal updates.', 'এখন উচ্চ স্থানীয় সতর্কতা নেই, তবে বন্দর সংকেত দেখুন।', JSON_OBJECT('signal', '1-3'), 'admin_local', NOW(), DATE_ADD(NOW(), INTERVAL 2 DAY), 0, 1, 2)
ON DUPLICATE KEY UPDATE
  severity = VALUES(severity),
  title_en = VALUES(title_en),
  title_bn = VALUES(title_bn),
  body_en = VALUES(body_en),
  body_bn = VALUES(body_bn),
  weather_payload = VALUES(weather_payload),
  is_active = VALUES(is_active);

INSERT INTO market_updates
  (id, title_en, title_bn, body_en, body_bn, update_type, district, upazila, status, starts_at, ends_at, sort_order)
VALUES
  (1, 'Cattle rate: ৳670/kg', 'গরুর দাম: ৳৬৭০/কেজি', 'Updated today. Eid demand high.', 'আজকের আপডেট। ঈদের চাহিদা বেশি।', 'price', 'Mymensingh', 'Mymensingh Sadar', 'active', NOW(), DATE_ADD(NOW(), INTERVAL 7 DAY), 1),
  (2, 'Shadhin Feed back in stock', 'স্বাধীন ফিড আবার মজুদে', 'Fast delivery in Mymensingh.', 'ময়মনসিংহে দ্রুত ডেলিভারি।', 'stock', 'Mymensingh', NULL, 'active', NOW(), DATE_ADD(NOW(), INTERVAL 14 DAY), 2),
  (3, 'New video: Cattle disease prevention', 'নতুন ভিডিও: গবাদি পশুর রোগ প্রতিরোধ', 'Watch in Training Modules.', 'ট্রেনিং মডিউলে দেখুন।', 'training', NULL, NULL, 'active', NOW(), DATE_ADD(NOW(), INTERVAL 30 DAY), 3)
ON DUPLICATE KEY UPDATE
  title_en = VALUES(title_en),
  title_bn = VALUES(title_bn),
  body_en = VALUES(body_en),
  body_bn = VALUES(body_bn),
  status = VALUES(status),
  sort_order = VALUES(sort_order);

INSERT INTO sale_categories
  (id, slug, name_en, name_bn, description_en, description_bn, is_active, sort_order)
VALUES
  (1, 'crops', 'Crops', 'ফসল', 'Grains, vegetables and fruits', 'শস্য, সবজি ও ফল', 1, 1),
  (2, 'livestock', 'Livestock', 'গবাদি পশু', 'Cattle, goat, poultry and fish', 'গরু, ছাগল, পোল্ট্রি ও মাছ', 1, 2),
  (3, 'inputs', 'Inputs', 'ইনপুট', 'Seeds, feed and fertilizer', 'বীজ, ফিড ও সার', 1, 3),
  (4, 'machinery', 'Machinery', 'যন্ত্রপাতি', 'Rent and lease machinery', 'যন্ত্রপাতি ভাড়া ও লিজ', 1, 4)
ON DUPLICATE KEY UPDATE
  name_en = VALUES(name_en),
  name_bn = VALUES(name_bn),
  description_en = VALUES(description_en),
  description_bn = VALUES(description_bn),
  is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);

INSERT INTO sale_items
  (id, sale_category_id, slug, name_en, name_bn, description_en, description_bn, status, metadata)
VALUES
  (1, 2, 'cattle', 'Cattle', 'গরু', 'Cow, bull and calf', 'গরু, ষাঁড় ও বাছুর', 'active', JSON_OBJECT('unit', 'kg', 'requires_ai_photo', true)),
  (2, 2, 'goat', 'Goat', 'ছাগল', 'Local and improved breeds', 'স্থানীয় ও উন্নত জাত', 'soon', JSON_OBJECT('unit', 'piece')),
  (3, 1, 'rice', 'Rice', 'ধান', 'Rice grain sale', 'ধান বিক্রয়', 'active', JSON_OBJECT('unit', 'kg')),
  (4, 1, 'tomato', 'Tomato', 'টমেটো', 'Fresh tomato sale', 'তাজা টমেটো বিক্রয়', 'active', JSON_OBJECT('unit', 'kg')),
  (5, 4, 'tractor-lease', 'Tractor lease', 'ট্রাক্টর ভাড়া', 'Hourly tractor rental', 'ঘণ্টা ভিত্তিক ট্রাক্টর ভাড়া', 'active', JSON_OBJECT('unit', 'hour'))
ON DUPLICATE KEY UPDATE
  sale_category_id = VALUES(sale_category_id),
  name_en = VALUES(name_en),
  name_bn = VALUES(name_bn),
  status = VALUES(status),
  metadata = VALUES(metadata);

INSERT INTO animal_breeds
  (id, animal_type, name_en, name_bn, is_active)
VALUES
  (1, 'cattle', 'Cross Friesian', 'ক্রস ফ্রিজিয়ান', 1),
  (2, 'cattle', 'Local', 'দেশি', 1),
  (3, 'cattle', 'Sahiwal', 'সাহিওয়াল', 1),
  (4, 'goat', 'Black Bengal', 'ব্ল্যাক বেঙ্গল', 1),
  (5, 'poultry', 'Broiler', 'ব্রয়লার', 1)
ON DUPLICATE KEY UPDATE
  name_en = VALUES(name_en),
  name_bn = VALUES(name_bn),
  is_active = VALUES(is_active);

INSERT INTO sale_pricing_rules
  (id, sale_item_id, district, effective_from, effective_to, b2b_market_rate, farmer_rate, platform_fee, logistics_fee, warehouse_vet_fee, unit, is_active)
VALUES
  (1, 1, 'Mymensingh', CURDATE(), NULL, 750.00, 670.00, 50.00, 15.00, 15.00, 'kg', 1),
  (2, 3, 'Mymensingh', CURDATE(), NULL, 58.00, 52.00, 1.00, 2.00, 1.00, 'kg', 1),
  (3, 4, 'Mymensingh', CURDATE(), NULL, 42.00, 36.00, 1.00, 3.00, 0.00, 'kg', 1)
ON DUPLICATE KEY UPDATE
  b2b_market_rate = VALUES(b2b_market_rate),
  farmer_rate = VALUES(farmer_rate),
  platform_fee = VALUES(platform_fee),
  logistics_fee = VALUES(logistics_fee),
  warehouse_vet_fee = VALUES(warehouse_vet_fee),
  is_active = VALUES(is_active);

INSERT INTO sale_listings
  (id, listing_code, user_id, sale_item_id, breed_id, title_en, title_bn, age_months, weight_kg, quantity, unit, farmer_expected_price, estimated_earning, contact_phone, address_text, ai_analysis_json, status, approved_by, approved_at)
VALUES
  (1, 'SAL-24018', 1, 1, 1, 'Cross Friesian bull for sale', 'ক্রস ফ্রিজিয়ান ষাঁড় বিক্রয়', 26, 210.00, 1, 'piece', 670.00, 140700.00, '01712-345678', 'Char Nilakkhmiya, Mymensingh Sadar', JSON_OBJECT('condition', 'healthy', 'confidence', 0.88, 'field_verification', 'pending'), 'field_verification', 2, NULL),
  (2, 'SAL-24022', 2, 3, NULL, 'BRRI 87 rice for sale', 'ব্রি ৮৭ ধান বিক্রয়', NULL, 480.00, 480, 'kg', 52.00, 24960.00, '01812-222333', 'Kazir Char, Mymensingh', JSON_OBJECT('quality', 'dry', 'moisture', 'low'), 'active', 2, NOW()),
  (3, 'SAL-24031', 3, 5, NULL, 'Tractor rental available', 'ট্রাক্টর ভাড়া পাওয়া যায়', NULL, NULL, 1, 'hour', 1200.00, 1200.00, '01933-555888', 'Mithapukur, Rangpur', JSON_OBJECT('machine_condition', 'good'), 'submitted', NULL, NULL)
ON DUPLICATE KEY UPDATE
  title_en = VALUES(title_en),
  title_bn = VALUES(title_bn),
  estimated_earning = VALUES(estimated_earning),
  status = VALUES(status),
  ai_analysis_json = VALUES(ai_analysis_json);

INSERT INTO buy_categories
  (id, slug, name_en, name_bn, description_en, description_bn, sort_order, is_active)
VALUES
  (1, 'shadhin-feed', 'Shadhin Feed', 'স্বাধীন ফিড', 'Own brand feed', 'নিজস্ব ব্র্যান্ডের ফিড', 1, 1),
  (2, 'seeds', 'Seeds', 'বীজ', 'Certified varieties', 'সনদপ্রাপ্ত জাত', 2, 1),
  (3, 'fertilizer', 'Fertilizer', 'সার', 'Urea, DAP and organic fertilizer', 'ইউরিয়া, ডিএপি ও অর্গানিক সার', 3, 1),
  (4, 'agri-medicine', 'Agri-medicine', 'কৃষি ঔষধ', 'Pesticide and vet medicine', 'কীটনাশক ও ভেট ঔষধ', 4, 1),
  (5, 'tools', 'Tools', 'যন্ত্র', 'Hand and electric tools', 'হাত ও ইলেকট্রিক যন্ত্র', 5, 1),
  (6, 'machinery-rental', 'Machinery rental', 'যন্ত্র ভাড়া', 'Tractor and tiller rental', 'ট্রাক্টর ও টিলার ভাড়া', 6, 1)
ON DUPLICATE KEY UPDATE
  name_en = VALUES(name_en),
  name_bn = VALUES(name_bn),
  description_en = VALUES(description_en),
  description_bn = VALUES(description_bn),
  is_active = VALUES(is_active);

INSERT INTO products
  (id, buy_category_id, sku, name_en, name_bn, short_description_en, short_description_bn, unit, package_size, price, stock_qty, low_stock_threshold, delivery_window, status, metadata)
VALUES
  (1, 1, 'BUY-FEED-01', 'Shadhin Cattle Feed', 'স্বাধীন ক্যাটল ফিড', 'High protein, supports weight gain, local delivery', 'উচ্চ প্রোটিন, ওজন বাড়াতে সহায়ক, স্থানীয় ডেলিভারি', 'sack', '50kg', 1800.00, 240.00, 20.00, '2-3 days', 'active', JSON_OBJECT('features', JSON_ARRAY('50 kg', 'High protein', 'Local delivery'))),
  (2, 1, 'BUY-FEED-02', 'Shadhin Fish Feed', 'স্বাধীন ফিশ ফিড', 'Floating pellet for pond fish', 'পুকুরের মাছের জন্য ফ্লোটিং পেলেট', 'sack', '25kg', 1250.00, 118.00, 15.00, '2-3 days', 'active', JSON_OBJECT('features', JSON_ARRAY('25 kg', 'Floating pellet'))),
  (3, 1, 'BUY-FEED-03', 'Shadhin Poultry Feed', 'স্বাধীন পোল্ট্রি ফিড', 'Broiler feed', 'ব্রয়লার ফিড', 'sack', '50kg', 1600.00, 0.00, 10.00, '3-4 days', 'out_of_stock', JSON_OBJECT('features', JSON_ARRAY('50 kg', 'Broiler'))),
  (4, 2, 'BUY-SEED-87', 'BRRI Rice 87 seed', 'ব্রি ধান ৮৭ বীজ', 'Boro season certified seed', 'বোরো মৌসুমের সনদপ্রাপ্ত বীজ', 'sack', '5kg', 320.00, 460.00, 50.00, '1-3 days', 'active', JSON_OBJECT('season', 'Boro'))
ON DUPLICATE KEY UPDATE
  name_en = VALUES(name_en),
  name_bn = VALUES(name_bn),
  price = VALUES(price),
  stock_qty = VALUES(stock_qty),
  status = VALUES(status),
  metadata = VALUES(metadata);

INSERT INTO orders
  (id, order_code, user_id, total_amount, delivery_fee, payable_amount, payment_method, payment_status, fulfillment_status, delivery_address, district, upazila, notes)
VALUES
  (1, 'ORD-1039', 1, 9000.00, 0.00, 9000.00, 'bkash', 'pending', 'assigned', 'Char Nilakkhmiya, Mymensingh Sadar', 'Mymensingh', 'Mymensingh Sadar', 'Stock confirmed. Delivery in 2-3 working days.'),
  (2, 'ORD-1042', 4, 2560.00, 80.00, 2640.00, 'nagad', 'paid', 'confirmed', 'Madhupur, Trishal', 'Mymensingh', 'Trishal', 'Seed order for Boro season.'),
  (3, 'ORD-1048', 3, 1250.00, 100.00, 1350.00, 'cash', 'pending', 'placed', 'Mithapukur, Rangpur', 'Rangpur', 'Mithapukur', 'Confirm before dispatch.')
ON DUPLICATE KEY UPDATE
  total_amount = VALUES(total_amount),
  payable_amount = VALUES(payable_amount),
  payment_status = VALUES(payment_status),
  fulfillment_status = VALUES(fulfillment_status),
  notes = VALUES(notes);

INSERT INTO order_items
  (id, order_id, product_id, quantity, unit_price, line_total)
VALUES
  (1, 1, 1, 5.00, 1800.00, 9000.00),
  (2, 2, 4, 8.00, 320.00, 2560.00),
  (3, 3, 2, 1.00, 1250.00, 1250.00)
ON DUPLICATE KEY UPDATE
  quantity = VALUES(quantity),
  unit_price = VALUES(unit_price),
  line_total = VALUES(line_total);

INSERT INTO learning_categories
  (id, slug, name_en, name_bn, sort_order, is_active)
VALUES
  (1, 'livestock', 'Livestock', 'গবাদি পশু', 1, 1),
  (2, 'agriculture', 'Agriculture', 'কৃষি', 2, 1),
  (3, 'climate', 'Climate', 'জলবায়ু', 3, 1),
  (4, 'women', 'Women in agriculture', 'কৃষিতে নারী', 4, 1),
  (5, 'healthcare', 'Rural healthcare', 'গ্রামীণ স্বাস্থ্য', 5, 1)
ON DUPLICATE KEY UPDATE
  name_en = VALUES(name_en),
  name_bn = VALUES(name_bn),
  is_active = VALUES(is_active);

INSERT INTO learning_modules
  (id, learning_category_id, title_en, title_bn, subtitle_en, subtitle_bn, thumbnail_asset_id, sort_order, status)
VALUES
  (1, 1, 'Cattle health management', 'গবাদি পশুর স্বাস্থ্য ব্যবস্থাপনা', 'Vet care and disease prevention', 'ভেট কেয়ার ও রোগ প্রতিরোধ', 3, 1, 'published'),
  (2, 2, 'Modern rice farming', 'আধুনিক ধান চাষ', 'Boro and Aman season', 'বোরো ও আমন মৌসুম', NULL, 2, 'published'),
  (3, 3, 'Climate-resilient farming', 'জলবায়ু সহনশীল কৃষি', 'Flood and drought response', 'বন্যা ও খরা মোকাবিলা', NULL, 3, 'published'),
  (4, 4, 'Women in agriculture', 'কৃষিতে নারী', 'Economic rights and leadership', 'অর্থনৈতিক অধিকার ও নেতৃত্ব', NULL, 4, 'published')
ON DUPLICATE KEY UPDATE
  title_en = VALUES(title_en),
  title_bn = VALUES(title_bn),
  subtitle_en = VALUES(subtitle_en),
  subtitle_bn = VALUES(subtitle_bn),
  status = VALUES(status);

INSERT INTO learning_contents
  (id, learning_module_id, content_type, title_en, title_bn, body_en, body_bn, video_url, duration_seconds, quiz_json, sort_order, status)
VALUES
  (1, 1, 'article', 'Recognizing early disease signs', 'রোগের প্রাথমিক লক্ষণ চেনা', 'Observe every morning and evening. Contact the field officer when needed.', 'প্রতিদিন সকাল ও সন্ধ্যায় পর্যবেক্ষণ করুন। প্রয়োজন হলে ফিল্ড অফিসারের সাথে যোগাযোগ করুন।', NULL, 300, NULL, 1, 'published'),
  (2, 1, 'video', 'Vaccine and deworming calendar', 'টিকা ও কৃমিনাশক ক্যালেন্ডার', 'Complete watching to unlock the quiz.', 'কুইজ আনলক করতে ভিডিওটি সম্পূর্ণ দেখুন।', 'https://example.com/videos/cattle-vaccine.mp4', 480, NULL, 2, 'published'),
  (3, 1, 'quiz', '5-question health quiz', '৫ প্রশ্নের স্বাস্থ্য কুইজ', NULL, NULL, NULL, NULL, JSON_OBJECT('pass_score', 60, 'questions', JSON_ARRAY(JSON_OBJECT('q', 'How often should cattle be observed?', 'answer', 'Twice daily'))), 3, 'published'),
  (4, 2, 'article', 'Preparing land for Boro rice', 'বোরো ধানের জমি প্রস্তুতি', 'Level land and plan irrigation before seedling transfer.', 'চারা রোপণের আগে জমি সমান করুন এবং সেচ পরিকল্পনা করুন।', NULL, 240, NULL, 1, 'published')
ON DUPLICATE KEY UPDATE
  title_en = VALUES(title_en),
  title_bn = VALUES(title_bn),
  body_en = VALUES(body_en),
  body_bn = VALUES(body_bn),
  video_url = VALUES(video_url),
  quiz_json = VALUES(quiz_json),
  status = VALUES(status);

INSERT INTO user_learning_progress
  (user_id, learning_content_id, status, completed_at, score)
VALUES
  (1, 1, 'completed', NOW(), NULL),
  (1, 2, 'completed', NOW(), NULL),
  (1, 3, 'in_progress', NULL, 40.00),
  (2, 4, 'completed', NOW(), NULL)
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  completed_at = VALUES(completed_at),
  score = VALUES(score);

INSERT INTO partner_projects
  (id, project_code, name_en, name_bn, lender_name, district, upazila, start_date, end_date, capacity, max_credit_amount, status, steps_json)
VALUES
  (1, 'PRJ-2024-EID', 'Cattle Fattening - Eid Batch 2024', 'গরু মোটাতাজাকরণ - ঈদ ব্যাচ ২০২৪', 'BRAC Bank', 'Mymensingh', 'Mymensingh Sadar', '2024-03-01', '2024-08-31', 50, 50000.00, 'open', JSON_ARRAY('Project selection', 'Personal KYC', 'Banking info', 'Farm assessment')),
  (2, 'PRJ-2025-BORO', 'Boro Rice Contract - Winter 2025', 'বোরো ধান চুক্তি - শীত ২০২৫', 'Green Delta MFI', 'Rangpur', NULL, '2025-01-01', '2025-05-31', 80, 30000.00, 'opening_soon', JSON_ARRAY('Project selection', 'Personal KYC', 'Banking info', 'Farm assessment'))
ON DUPLICATE KEY UPDATE
  name_en = VALUES(name_en),
  name_bn = VALUES(name_bn),
  lender_name = VALUES(lender_name),
  capacity = VALUES(capacity),
  max_credit_amount = VALUES(max_credit_amount),
  status = VALUES(status),
  steps_json = VALUES(steps_json);

INSERT INTO partner_applications
  (id, application_code, user_id, partner_project_id, current_step, full_name_per_nid, nid_number, total_land_decimals, livestock_count, primary_income_source, annual_household_income, mobile_banking_provider, banking_json, farm_assessment_json, verification_notes, status, assigned_officer_id, approved_by, approved_at)
VALUES
  (1, 'KYC-8801', 1, 1, 'farm_assessment', 'Md. Rahim', '19901234567890123', 120.00, 5, 'Livestock', 120000.00, 'bKash', JSON_OBJECT('account_no', '01712-345678'), JSON_OBJECT('shed_condition', 'good', 'feed_storage', 'available'), 'Animal check ongoing.', 'officer_verification', 2, NULL, NULL),
  (2, 'KYC-8804', 2, 2, 'banking_info', 'Fatema Khatun', '19887654321098765', 90.00, 1, 'Rice farming', 95000.00, 'Nagad', JSON_OBJECT('account_no', '01812-222333'), JSON_OBJECT('land_ready', true), 'Banking document needed.', 'needs_document', 2, NULL, NULL),
  (3, 'KYC-8811', 4, 1, 'approval', 'Aklima Begum', '20001239876543210', 65.00, 2, 'Vegetables', 82000.00, 'bKash', JSON_OBJECT('account_no', '01611-222444'), JSON_OBJECT('farm_condition', 'verified'), 'Ready for final approval.', 'ready_to_approve', 2, 1, NULL)
ON DUPLICATE KEY UPDATE
  current_step = VALUES(current_step),
  verification_notes = VALUES(verification_notes),
  status = VALUES(status),
  assigned_officer_id = VALUES(assigned_officer_id);

INSERT INTO project_ledgers
  (id, partner_application_id, entry_type, title_en, title_bn, amount, entry_date, metadata)
VALUES
  (1, 1, 'input', 'Shadhin Cattle Feed x 4', 'স্বাধীন ক্যাটল ফিড x ৪', 7200.00, '2024-04-02', JSON_OBJECT('product_id', 1)),
  (2, 1, 'vet_care', 'Vet care (April)', 'ভেট কেয়ার (এপ্রিল)', 500.00, '2024-04-12', JSON_OBJECT('officer_id', 2)),
  (3, 1, 'payment', 'Partial payment (May 1)', 'আংশিক পেমেন্ট (১ মে)', -5000.00, '2024-05-01', JSON_OBJECT('method', 'cash'))
ON DUPLICATE KEY UPDATE
  title_en = VALUES(title_en),
  title_bn = VALUES(title_bn),
  amount = VALUES(amount),
  metadata = VALUES(metadata);

INSERT INTO community_posts
  (id, user_id, scope, post_type, body, district, upazila, status, like_count, comment_count, report_count, moderated_by, moderated_at)
VALUES
  (1, 1, 'upazila', 'livestock', 'My cattle reached 200kg, listed on Shathi Sheba. Very easy!', 'Mymensingh', 'Mymensingh Sadar', 'visible', 12, 3, 0, NULL, NULL),
  (2, 2, 'district', 'question', 'When should I apply fertilizer for rice? Advice please.', 'Mymensingh', 'Mymensingh Sadar', 'answered', 5, 7, 1, 2, NOW()),
  (3, 3, 'bangladesh', 'complaint', 'Delivery delayed for feed order. Need update.', 'Rangpur', 'Mithapukur', 'moderation', 1, 2, 3, NULL, NULL)
ON DUPLICATE KEY UPDATE
  body = VALUES(body),
  status = VALUES(status),
  like_count = VALUES(like_count),
  comment_count = VALUES(comment_count),
  report_count = VALUES(report_count);

INSERT INTO community_comments
  (id, community_post_id, user_id, body, status)
VALUES
  (1, 1, 2, 'Congratulations. How many days did it take?', 'visible'),
  (2, 2, 3, 'Apply after field moisture is checked.', 'visible'),
  (3, 2, 2, 'Thank you for the advice.', 'visible')
ON DUPLICATE KEY UPDATE
  body = VALUES(body),
  status = VALUES(status);

INSERT INTO notification_campaigns
  (id, title_en, title_bn, body_en, body_bn, target_json, campaign_type, status, scheduled_at, sent_at, created_by)
VALUES
  (1, 'Rain possible after evening', 'সন্ধ্যার পর বৃষ্টির সম্ভাবনা', 'Cover harvested crops and stored feed.', 'কাটা ফসল ও সংরক্ষিত খাবার ঢেকে রাখুন।', JSON_OBJECT('district', 'Mymensingh', 'interest', 'crops'), 'weather', 'scheduled', DATE_ADD(NOW(), INTERVAL 1 HOUR), NULL, 1),
  (2, 'Shadhin Feed back in stock', 'স্বাধীন ফিড আবার মজুদে', 'Order now from Buy from Shathi.', 'Buy from Shathi থেকে এখনই অর্ডার করুন।', JSON_OBJECT('district', 'Mymensingh', 'category', 'shadhin-feed'), 'market', 'draft', NULL, NULL, 1)
ON DUPLICATE KEY UPDATE
  title_en = VALUES(title_en),
  title_bn = VALUES(title_bn),
  status = VALUES(status),
  target_json = VALUES(target_json);

INSERT INTO audit_logs
  (id, actor_admin_id, action, entity_type, entity_id, before_json, after_json, ip_address, user_agent)
VALUES
  (1, 1, 'seed.insert', 'database', NULL, NULL, JSON_OBJECT('seed', '001_sample_data'), '127.0.0.1', 'seed-runner'),
  (2, 2, 'listing.review', 'sale_listings', 1, JSON_OBJECT('status', 'submitted'), JSON_OBJECT('status', 'field_verification'), '127.0.0.1', 'seed-runner')
ON DUPLICATE KEY UPDATE
  action = VALUES(action),
  after_json = VALUES(after_json);
