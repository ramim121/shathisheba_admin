-- Shathi Sheba Admin — seed 002: app alignment
-- Completes the onboarding interest taxonomy to match the app screenshots,
-- and seeds officer directory, FAQ, and Ask Shathi Apa dummy data.
-- Idempotent via ON DUPLICATE KEY UPDATE. Run after migration 002.

USE shathi_sheba;

-- Complete interest_categories children (reuse existing parents 1-5 and step_group values).
-- Existing: livestock 11-14, crops 21/22/23, fishery 31/32, vegetables 41/42, fruits 51/52.
INSERT INTO interest_categories
  (id, parent_id, slug, name_en, name_bn, emoji, sort_order, step_group, is_selectable, is_active)
VALUES
  -- Crops (parent 2)
  (24, 2, 'wheat', 'Wheat', 'গম', '🌾', 4, 'crops', 1, 1),
  (25, 2, 'garlic', 'Garlic', 'রসুন', '🧄', 5, 'crops', 1, 1),
  (26, 2, 'mustard', 'Mustard', 'সরিষা', '🌼', 6, 'crops', 1, 1),
  (27, 2, 'turmeric', 'Turmeric', 'হলুদ', '🫚', 7, 'crops', 1, 1),
  (28, 2, 'chili', 'Chili', 'মরিচ', '🌶️', 8, 'crops', 1, 1),
  -- Fishery (parent 3)
  (33, 3, 'hilsa', 'Hilsa', 'ইলিশ', '🐟', 3, 'fishery', 1, 1),
  (34, 3, 'pangas', 'Pangas', 'পাঙ্গাস', '🐟', 4, 'fishery', 1, 1),
  (35, 3, 'tilapia', 'Tilapia', 'তেলাপিয়া', '🐟', 5, 'fishery', 1, 1),
  (36, 3, 'prawn', 'Prawn', 'চিংড়ি', '🦐', 6, 'fishery', 1, 1),
  -- Vegetables (parent 4)
  (60, 4, 'bottle-gourd', 'Bottle Gourd', 'লাউ', '🥒', 3, 'vegetables', 1, 1),
  (61, 4, 'pointed-gourd', 'Pointed Gourd', 'পটল', '🥒', 4, 'vegetables', 1, 1),
  (62, 4, 'okra', 'Okra', 'ঢেঁড়স', '🌿', 5, 'vegetables', 1, 1),
  (63, 4, 'green-beans', 'Green Beans', 'শিম', '🫛', 6, 'vegetables', 1, 1),
  (64, 4, 'eggplant', 'Eggplant', 'বেগুন', '🍆', 7, 'vegetables', 1, 1),
  (65, 4, 'cucumber', 'Cucumber', 'শসা', '🥒', 8, 'vegetables', 1, 1),
  (66, 4, 'spiny-gourd', 'Spiny Gourd', 'কাঁকরোল', '🥒', 9, 'vegetables', 1, 1),
  (67, 4, 'lettuce', 'Lettuce', 'লেটুস', '🥬', 10, 'vegetables', 1, 1),
  (68, 4, 'beans', 'Beans', 'বরবটি', '🫘', 11, 'vegetables', 1, 1),
  (69, 4, 'pumpkin', 'Pumpkin', 'কুমড়া', '🎃', 12, 'vegetables', 1, 1),
  (70, 4, 'leafy-greens', 'Leafy Greens', 'শাক', '🥬', 13, 'vegetables', 1, 1),
  -- Fruits (parent 5)
  (71, 5, 'papaya', 'Papaya', 'পেঁপে', '🫒', 3, 'fruits', 1, 1),
  (72, 5, 'lychee', 'Lychee', 'লিচু', '🍒', 4, 'fruits', 1, 1),
  (73, 5, 'jackfruit', 'Jackfruit', 'কাঁঠাল', '🫒', 5, 'fruits', 1, 1),
  (74, 5, 'watermelon', 'Watermelon', 'তরমুজ', '🍉', 6, 'fruits', 1, 1),
  (75, 5, 'guava', 'Guava', 'পেয়ারা', '🍐', 7, 'fruits', 1, 1),
  (76, 5, 'lemon', 'Lemon', 'লেবু', '🍋', 8, 'fruits', 1, 1)
ON DUPLICATE KEY UPDATE
  parent_id = VALUES(parent_id),
  name_en = VALUES(name_en),
  name_bn = VALUES(name_bn),
  emoji = VALUES(emoji),
  sort_order = VALUES(sort_order),
  step_group = VALUES(step_group),
  is_selectable = VALUES(is_selectable),
  is_active = VALUES(is_active);

-- Per-zone Community officer cards (matches Community screenshot).
INSERT INTO zone_officers
  (id, officer_role, name, phone, district, upazila, admin_user_id, is_active)
VALUES
  (1, 'field_officer', 'Rana Hossain', '01700000002', 'Mymensingh', 'Mymensingh Sadar', 2, 1),
  (2, 'ho_query_officer', 'Sadia Khatun', '01700000003', 'Dhaka', 'Dhaka', 3, 1)
ON DUPLICATE KEY UPDATE
  officer_role = VALUES(officer_role),
  name = VALUES(name),
  phone = VALUES(phone),
  district = VALUES(district),
  upazila = VALUES(upazila),
  is_active = VALUES(is_active);

-- FAQ / Help content (SRS FR-PROF-04).
INSERT INTO faq_items
  (id, category, question_en, question_bn, answer_en, answer_bn, sort_order, is_active)
VALUES
  (1, 'pricing', 'What is Nirdharito Bikroy Mullo?', 'নির্ধারিত বিক্রয় মূল্য কী?', 'It is the price you receive per kg for your product, shown clearly before sale.', 'এটি আপনার পণ্যের প্রতি কেজি যে দাম আপনি পাবেন, বিক্রির আগে স্পষ্টভাবে দেখানো হয়।', 1, 1),
  (2, 'sale', 'When does the field officer visit after I list cattle?', 'গরু তালিকাভুক্ত করার পর ফিল্ড অফিসার কখন আসবেন?', 'Within 3 working days the assigned field officer visits with a portable weighing scale.', '৩ কর্মদিবসের মধ্যে নির্ধারিত ফিল্ড অফিসার পোর্টেবল ওজন মেশিন নিয়ে আসবেন।', 2, 1),
  (3, 'payment', 'How is the OTP payment confirmation used?', 'ওটিপি পেমেন্ট নিশ্চিতকরণ কীভাবে কাজ করে?', 'After weight is verified, an OTP is sent to your phone. Share it with the officer to confirm payment. It expires in 10 minutes.', 'ওজন যাচাইয়ের পর আপনার ফোনে একটি ওটিপি যাবে। পেমেন্ট নিশ্চিত করতে অফিসারের সাথে শেয়ার করুন। ১০ মিনিটে মেয়াদ শেষ হবে।', 3, 1),
  (4, 'buy', 'How long does delivery take for Buy from Shathi orders?', 'Buy from Shathi অর্ডারের ডেলিভারিতে কত সময় লাগে?', 'Delivery usually takes 1-3 working days. Orders above 500 taka get free delivery.', 'ডেলিভারিতে সাধারণত ১-৩ কর্মদিবস লাগে। ৫০০ টাকার বেশি অর্ডারে ফ্রি ডেলিভারি।', 4, 1),
  (5, 'partner', 'What are the Shathi Partner registration steps?', 'শাথী পার্টনার নিবন্ধনের ধাপগুলো কী?', 'Project selection, Personal KYC, Banking info, Farm assessment, and final approval after a field visit.', 'প্রকল্প নির্বাচন, ব্যক্তিগত কেওয়াইসি, ব্যাংকিং তথ্য, খামার মূল্যায়ন এবং মাঠ পরিদর্শনের পর চূড়ান্ত অনুমোদন।', 5, 1)
ON DUPLICATE KEY UPDATE
  category = VALUES(category),
  question_en = VALUES(question_en),
  question_bn = VALUES(question_bn),
  answer_en = VALUES(answer_en),
  answer_bn = VALUES(answer_bn),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active);

-- Ask Shathi Apa config + quick prompts (home-screen card).
INSERT INTO ai_assistant_prompts
  (id, prompt_type, title_en, title_bn, body_en, body_bn, sort_order, is_active)
VALUES
  (1, 'config', 'Ask Shathi Apa', 'শাথী আপাকে জিজ্ঞাসা করুন', 'Get fast answers on price, weather, disease, or projects.', 'দাম, আবহাওয়া, রোগ বা প্রকল্প সম্পর্কে দ্রুত উত্তর পান।', 0, 1),
  (2, 'quick_prompt', 'Today''s cattle price?', 'আজকের গরুর দাম?', 'price', 'price', 1, 1),
  (3, 'quick_prompt', 'Weather for my area', 'আমার এলাকার আবহাওয়া', 'weather', 'weather', 2, 1),
  (4, 'quick_prompt', 'My cattle looks sick', 'আমার গরু অসুস্থ মনে হচ্ছে', 'disease', 'disease', 3, 1),
  (5, 'quick_prompt', 'Available partner projects', 'চলমান পার্টনার প্রকল্প', 'projects', 'projects', 4, 1)
ON DUPLICATE KEY UPDATE
  prompt_type = VALUES(prompt_type),
  title_en = VALUES(title_en),
  title_bn = VALUES(title_bn),
  body_en = VALUES(body_en),
  body_bn = VALUES(body_bn),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active);
