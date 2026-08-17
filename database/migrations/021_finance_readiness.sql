-- Shathi Sheba Admin — migration 021: Finance Readiness Self-Assessment (Feature 1).
--
-- Implements SRS §21.1 / KB §8.1. Five tables plus the seeded 20-question
-- instrument and the corroboration-signal catalogue.
--
-- Design notes that matter:
--   * weight is DECIMAL(5,4) and the active set MUST sum to 1.0000 — the admin
--     editor blocks publishing otherwise (ADM-RDY-02). Part 1 = 0.59, Part 2 = 0.41.
--   * branch_parent_id / branch_show_when make branching server-declared, so the
--     mobile client evaluates a rule rather than hard-coding it (MOB-RDY-11A).
--   * question sets are versioned; an assessment stores the version it used so a
--     historical score stays reproducible (ADM-RDY-03, P8).
--   * answers are stored per question with presented / branch_suppressed flags so
--     the score can be recomputed exactly from the row set.
--
-- Idempotent. MySQL 8+.

USE shathi_sheba;

-- ---------------------------------------------------------------------------
-- Versioned question sets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS readiness_question_sets (
  id             BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  version        VARCHAR(30) NOT NULL,
  status         ENUM('draft','active','retired') NOT NULL DEFAULT 'draft',
  notes          VARCHAR(255) NULL,
  effective_from DATETIME NULL,
  created_by     BIGINT UNSIGNED NULL,
  approved_by    BIGINT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_version (version),
  INDEX idx_status (status, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- The instrument itself, plus the action-linkage matrix (SRS §8.1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS readiness_questions (
  id                   BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  set_id               BIGINT UNSIGNED NOT NULL,
  part                 ENUM('core','deep') NOT NULL DEFAULT 'core',
  sort_order           SMALLINT UNSIGNED NOT NULL,
  category             ENUM('kyc','enterprise','financial') NOT NULL,
  weight               DECIMAL(5,4) NOT NULL,
  flag                 ENUM('gate','risk') NULL,
  flag_code            VARCHAR(40) NULL,
  branch_parent_order  SMALLINT UNSIGNED NULL,   -- resolved to an id by the API
  branch_show_when     ENUM('yes','no') NULL,
  question_bn          VARCHAR(400) NOT NULL,
  question_en          VARCHAR(400) NOT NULL,
  helper_bn            VARCHAR(400) NULL,
  helper_en            VARCHAR(400) NULL,
  strength_bn          VARCHAR(300) NULL,
  strength_en          VARCHAR(300) NULL,
  gap_bn               VARCHAR(300) NULL,
  gap_en               VARCHAR(300) NULL,
  action_title_bn      VARCHAR(300) NULL,
  action_title_en      VARCHAR(300) NULL,
  action_rationale_bn  VARCHAR(300) NULL,
  action_rationale_en  VARCHAR(300) NULL,
  action_deeplink      VARCHAR(120) NULL,
  is_active            TINYINT(1) NOT NULL DEFAULT 1,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_set_order (set_id, sort_order),
  INDEX idx_set_part (set_id, part, sort_order),
  CONSTRAINT fk_rq_set FOREIGN KEY (set_id) REFERENCES readiness_question_sets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- One row per completed check. Immutable; a later check supersedes an earlier one.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS readiness_assessments (
  id                   BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id              BIGINT UNSIGNED NOT NULL,
  question_set_version VARCHAR(30) NOT NULL,
  depth                ENUM('core','full') NOT NULL DEFAULT 'core',
  score                DECIMAL(5,2) NOT NULL,
  grade                ENUM('A','B','C','D') NOT NULL,
  readiness_status     ENUM('bank_ready_indicative','conditionally_ready','project_ready',
                            'development_required','currently_ineligible') NOT NULL,
  data_confidence      ENUM('low','medium') NOT NULL DEFAULT 'low',
  signals_present      JSON NULL,
  signal_count         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  kyc_pct              DECIMAL(5,2) NOT NULL DEFAULT 0,
  enterprise_pct       DECIMAL(5,2) NOT NULL DEFAULT 0,
  financial_pct        DECIMAL(5,2) NOT NULL DEFAULT 0,
  gate_triggered       TINYINT(1) NOT NULL DEFAULT 0,
  gate_reason          VARCHAR(40) NULL,
  risk_flag            VARCHAR(40) NULL,
  in_scope_weight      DECIMAL(6,4) NOT NULL DEFAULT 0,
  branch_weight        DECIMAL(6,4) NOT NULL DEFAULT 0,
  supersedes_id        BIGINT UNSIGNED NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_created (user_id, created_at),
  INDEX idx_grade (grade, readiness_status),
  CONSTRAINT fk_ra_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS readiness_answers (
  id                BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  assessment_id     BIGINT UNSIGNED NOT NULL,
  question_id       BIGINT UNSIGNED NOT NULL,
  part              ENUM('core','deep') NOT NULL,
  answer            TINYINT(1) NULL,               -- NULL when branch-suppressed
  presented         TINYINT(1) NOT NULL DEFAULT 1,
  branch_suppressed TINYINT(1) NOT NULL DEFAULT 0,
  rating            TINYINT UNSIGNED NOT NULL DEFAULT 0,   -- 0 or 5 (LRG §14 binary extremes)
  weighted_value    DECIMAL(6,4) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_assessment_question (assessment_id, question_id),
  CONSTRAINT fk_rans_assessment FOREIGN KEY (assessment_id) REFERENCES readiness_assessments(id) ON DELETE CASCADE,
  CONSTRAINT fk_rans_question   FOREIGN KEY (question_id)   REFERENCES readiness_questions(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Corroboration catalogue. Confidence is computed from these, never from the
-- answers — that is the anti-gaming defence (P5 / ENG-08B).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS readiness_confidence_signals (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code         VARCHAR(10) NOT NULL,
  label_bn     VARCHAR(200) NOT NULL,
  label_en     VARCHAR(200) NOT NULL,
  source_check VARCHAR(80) NOT NULL,
  fix_deeplink VARCHAR(120) NULL,
  sort_order   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed — question set v1 (only when absent, so re-running never duplicates)
-- ---------------------------------------------------------------------------
INSERT INTO readiness_question_sets (version, status, notes, effective_from)
SELECT 'v1', 'active', 'SRS v1.2 twenty-question instrument, two parts', NOW()
WHERE NOT EXISTS (SELECT 1 FROM readiness_question_sets WHERE version = 'v1');

SET @set := (SELECT id FROM readiness_question_sets WHERE version = 'v1' LIMIT 1);
SET @have := (SELECT COUNT(*) FROM readiness_questions WHERE set_id = @set);

-- Part 1 — Core (Σ 0.59). Every question is phrased so "Yes" is favourable.
INSERT IGNORE INTO readiness_questions
 (set_id, part, sort_order, category, weight, flag, flag_code, branch_parent_order, branch_show_when,
  question_bn, question_en, helper_bn, helper_en, strength_bn, strength_en, gap_bn, gap_en,
  action_title_bn, action_title_en, action_rationale_bn, action_rationale_en, action_deeplink)
VALUES (@set,'core',1,'kyc',0.0700,'gate','NO_NID',NULL,NULL,
  'আপনার কি বৈধ জাতীয় পরিচয়পত্র (NID) আছে?','Do you have a valid National ID (NID)?',
  'ঋণের জন্য NID বাধ্যতামূলক।','A NID is mandatory for any regulated finance.',
  'আপনার বৈধ NID আছে','You have a valid NID','বৈধ NID নেই','No valid NID',
  'আপনার এনআইডি যোগ করুন','Add your National ID','ঋণের জন্য এটি বাধ্যতামূলক','This is mandatory for finance','screen:menuKyc'),
 (@set,'core',2,'financial',0.0600,NULL,NULL,NULL,NULL,
  'আপনার কি নিজস্ব ব্যাংক অথবা মোবাইল ব্যাংকিং (MFS) অ্যাকাউন্ট আছে?','Do you have your own bank or mobile banking (MFS) account?',
  'ঋণ বিতরণ ও কিস্তি এই অ্যাকাউন্টে হবে।','Disbursement and instalments move through this account.',
  'আপনার নিজস্ব অ্যাকাউন্ট আছে','You have your own account','নিজস্ব ব্যাংক/MFS অ্যাকাউন্ট নেই','No bank or MFS account',
  'ব্যাংক বা মোবাইল ব্যাংকিং তথ্য যোগ করুন','Add bank or mobile banking details','টাকা লেনদেনের জন্য প্রয়োজন','Needed to move money','screen:menuBanking'),
 (@set,'core',3,'enterprise',0.1300,NULL,NULL,NULL,NULL,
  'আপনার কি চাষযোগ্য জমি অথবা উৎপাদনশীল সম্পদ (গবাদি পশু/যন্ত্রপাতি) আছে?','Do you have cultivable land or productive assets (livestock/machinery)?',
  'সম্পদ আপনার আয়ের ক্ষমতা দেখায়।','Assets demonstrate your earning capacity.',
  'আপনার উৎপাদনশীল সম্পদ আছে','You hold productive assets','উৎপাদনশীল সম্পদ নেই','No productive assets',
  'শাথী প্রকল্পে যোগ দিন — উপকরণ ও সম্পদ সহায়তা','Join a Shathi project — input & asset support','সম্পদ গড়ার সবচেয়ে দ্রুত পথ','The fastest route to building assets','screen:projects?tab=my_area'),
 (@set,'core',4,'financial',0.0700,NULL,NULL,NULL,NULL,
  'আপনার কি কৃষি বা ব্যবসা থেকে নিয়মিত আয় আছে?','Do you have regular income from farming or business?',
  'নিয়মিত আয় কিস্তি পরিশোধের ভিত্তি।','Regular income is the basis for repaying instalments.',
  'আপনার নিয়মিত আয় আছে','You have regular income','নিয়মিত আয় নেই','No regular income',
  'আয় বাড়ানোর প্রশিক্ষণ নিন','Take training to grow your income','আয় বাড়লে ঋণের সামর্থ্য বাড়ে','More income means more capacity','screen:training'),
 (@set,'core',5,'financial',0.0400,NULL,NULL,NULL,NULL,
  'আপনার মাসিক আয় কি ২৫,০০০ টাকার বেশি?','Is your monthly income above BDT 25,000?',
  NULL,NULL,'আপনার আয়ের মাত্রা ভালো','Your income level is good','মাসিক আয় ২৫,০০০ টাকার কম','Monthly income below BDT 25,000',
  'উৎপাদন বাড়ানোর প্রশিক্ষণ নিন','Take training to increase production','উৎপাদন বাড়লে আয় বাড়ে','More production means more income','screen:training'),
 (@set,'core',6,'enterprise',0.0500,NULL,NULL,NULL,NULL,
  'আপনি কি কোনো সমবায় বা অংশীদার সংগঠনের সদস্য?','Are you a member of a cooperative or partner organisation?',
  NULL,NULL,'আপনি সমবায়ের সদস্য','You are a cooperative member','কোনো সমবায়ের সদস্য নন','Not a member of any cooperative',
  'স্থানীয় সমবায়ে যুক্ত হন — কর্মকর্তার সাথে কথা বলুন','Join a local cooperative — talk to your officer','সমবায় যাচাইয়ে সাহায্য করে','Cooperatives help with verification','screen:officers'),
 (@set,'core',7,'enterprise',0.0600,NULL,NULL,NULL,NULL,
  'আপনার কি পণ্য বিক্রির নিশ্চিত বাজার বা ক্রেতা আছে?','Do you have a confirmed market or buyer for your produce?',
  NULL,NULL,'আপনার নিশ্চিত ক্রেতা আছে','You have a confirmed buyer','নিশ্চিত ক্রেতা বা বাজার নেই','No confirmed buyer or market',
  'বিক্রির তালিকা করুন — ক্রেতার সাথে সংযোগ পান','List for sale — get connected to buyers','নিশ্চিত ক্রেতা ঝুঁকি কমায়','A confirmed buyer lowers risk','screen:saleCategories'),
 (@set,'core',8,'enterprise',0.0500,NULL,NULL,NULL,NULL,
  'আপনি কি এই কাজে ২ বছরের বেশি সময় ধরে যুক্ত আছেন?','Have you been in this work for more than 2 years?',
  NULL,NULL,'আপনার ২ বছরের বেশি অভিজ্ঞতা আছে','You have 2+ years of experience','২ বছরের কম অভিজ্ঞতা','Less than 2 years of experience',
  'আপনার খাতের প্রশিক্ষণ সম্পন্ন করুন','Complete training in your sector','প্রশিক্ষণ অভিজ্ঞতার ঘাটতি পূরণ করে','Training offsets limited experience','screen:training'),
 (@set,'core',9,'financial',0.0100,NULL,NULL,NULL,NULL,
  'আপনি কি আগে কখনো ব্যাংক, এমএফআই বা সমবায় থেকে ঋণ নিয়েছেন?','Have you ever borrowed from a bank, MFI or cooperative?',
  'আগে ঋণ না নিলে কোনো সমস্যা নেই।','Never having borrowed is not a problem.',
  'আপনার ঋণের অভিজ্ঞতা আছে','You have borrowing experience','আগে কখনো ঋণ নেননি','You have never borrowed before',
  'ছোট প্রকল্প দিয়ে লেনদেনের ইতিহাস গড়ুন','Build transaction history with a small project','রেকর্ড থাকলে পরে সুবিধা হয়','A record helps you later','screen:projects'),
 (@set,'core',10,'financial',0.0500,NULL,NULL,NULL,NULL,
  'প্রয়োজনে আপনি কি জামানত বা একজন গ্যারান্টর দিতে পারবেন?','If needed, can you provide collateral or a guarantor?',
  NULL,NULL,'আপনি জামানত/গ্যারান্টর দিতে পারবেন','You can provide collateral or a guarantor','জামানত বা গ্যারান্টর নেই','No collateral or guarantor',
  'জামানতবিহীন প্রকল্পভিত্তিক অর্থায়ন দেখুন','Explore collateral-free project financing','প্রকল্পে জামানত ছাড়াই অর্থায়ন হয়','Projects finance without collateral','screen:projects?filter=collateral_free'
);

-- Part 2 — Deeper (Σ 0.41). Q11/12/13 branch on Q9 = Yes.
INSERT IGNORE INTO readiness_questions
 (set_id, part, sort_order, category, weight, flag, flag_code, branch_parent_order, branch_show_when,
  question_bn, question_en, helper_bn, helper_en, strength_bn, strength_en, gap_bn, gap_en,
  action_title_bn, action_title_en, action_rationale_bn, action_rationale_en, action_deeplink)
VALUES (@set,'deep',11,'financial',0.0800,NULL,NULL,9,'yes',
  'আগে নেওয়া ঋণ কি আপনি সময়মতো পরিশোধ করেছেন?','Did you repay your past loans on time?',
  NULL,NULL,'আপনার পরিশোধের রেকর্ড ভালো','Your repayment record is good','সময়মতো পরিশোধের রেকর্ড নেই','No on-time repayment record',
  'ছোট প্রকল্প দিয়ে পরিশোধের রেকর্ড গড়ুন','Build a repayment record with a small project','ভালো রেকর্ড গ্রেড বাড়ায়','A good record raises your grade','screen:projects'),
 (@set,'deep',12,'financial',0.0600,'risk','ARREARS',9,'yes',
  'বর্তমানে আপনার সব ঋণের কিস্তি কি নিয়মিত পরিশোধ হচ্ছে?','Are all your current loan instalments being paid on time?',
  'বকেয়া থাকলে আগে সেটি ঠিক করতে হবে।','Arrears must be cleared first.',
  'আপনার সব কিস্তি নিয়মিত','All your instalments are current','কিছু কিস্তি বকেয়া আছে','Some instalments are in arrears',
  'বকেয়া কিস্তি পরিশোধ করুন — এটি সবচেয়ে জরুরি','Clear your overdue instalments — this matters most','এটি সবচেয়ে বড় বাধা','This is the single biggest blocker','sheet:clear_arrears'),
 (@set,'deep',13,'financial',0.0200,NULL,NULL,9,'yes',
  'আপনার সব কিস্তি মিলিয়ে কি আপনার মাসিক আয়ের অর্ধেকের কম?','Are all your instalments together less than half your monthly income?',
  NULL,NULL,'আপনার ঋণের বোঝা সহনীয়','Your debt burden is manageable','ঋণের বোঝা আয়ের তুলনায় বেশি','Debt burden is high relative to income',
  'বিদ্যমান ঋণ কমান','Reduce your existing debt','বোঝা কমলে নতুন ঋণের সামর্থ্য বাড়ে','Lower burden means more capacity','sheet:reduce_debt'),
 (@set,'deep',14,'financial',0.0500,NULL,NULL,NULL,NULL,
  'আপনি কি নিয়মিত কিছু টাকা সঞ্চয় করতে পারেন?','Are you able to save some money regularly?',
  NULL,NULL,'আপনি নিয়মিত সঞ্চয় করেন','You save regularly','নিয়মিত সঞ্চয় নেই','No regular savings',
  'সঞ্চয়ের অভ্যাস গড়ুন — আর্থিক শিক্ষা মডিউল','Build a savings habit — financial literacy module','সঞ্চয় পরিশোধের ক্ষমতা দেখায়','Savings demonstrate repayment capacity','screen:training?category=financial-literacy'),
 (@set,'deep',15,'financial',0.0400,NULL,NULL,NULL,NULL,
  'সব খরচ মেটানোর পর কি আপনার হাতে কিছু টাকা থাকে?','After all expenses, is there money left over?',
  NULL,NULL,'খরচের পর আপনার উদ্বৃত্ত থাকে','You have a surplus after expenses','খরচের পর কিছু থাকে না','Nothing left after expenses',
  'আয়-ব্যয় পরিকল্পনা শিখুন','Learn cash-flow planning','উদ্বৃত্তই কিস্তির উৎস','Surplus is what pays the instalment','screen:training?category=financial-literacy'),
 (@set,'deep',16,'financial',0.0400,NULL,NULL,NULL,NULL,
  'আপনার কি একাধিক উৎস থেকে আয় আছে?','Do you have income from more than one source?',
  NULL,NULL,'আপনার একাধিক আয়ের উৎস আছে','You have multiple income sources','আয়ের উৎস একটিই','Only one income source',
  'বাড়তি আয়ের সুযোগ দেখুন','Explore additional income options','একাধিক উৎস ঝুঁকি কমায়','Multiple sources reduce risk','screen:projects'),
 (@set,'deep',17,'enterprise',0.0400,NULL,NULL,NULL,NULL,
  'আপনি যে জমি বা দোকানে কাজ করেন তা কি আপনার নিজের (ভাড়া নয়)?','Is the land or premises you work on your own (not rented)?',
  NULL,NULL,'আপনার নিজের জমি/দোকান','You own your land or premises','জমি বা দোকান ভাড়া নেওয়া','Land or premises are rented',
  'ভাড়ার চুক্তিপত্র সংগ্রহ করুন','Get a written tenancy agreement','লিখিত চুক্তি স্থিতিশীলতা প্রমাণ করে','A written agreement proves stability','sheet:tenancy_agreement'),
 (@set,'deep',18,'enterprise',0.0300,NULL,NULL,NULL,NULL,
  'আপনি কি আয়-ব্যয়ের লিখিত হিসাব রাখেন?','Do you keep written income and expense records?',
  NULL,NULL,'আপনি লিখিত হিসাব রাখেন','You keep written records','লিখিত হিসাব রাখা হয় না','No written records kept',
  'আয়-ব্যয়ের হিসাব রাখা শিখুন','Learn to keep income & expense records','হিসাব থাকলে ঋণদাতা আস্থা পায়','Records build lender confidence','screen:training?category=financial-literacy'),
 (@set,'deep',19,'kyc',0.0200,NULL,NULL,NULL,NULL,
  'আপনার কি TIN (কর সনাক্তকরণ নম্বর) আছে?','Do you have a TIN (Tax Identification Number)?',
  NULL,NULL,'আপনার TIN আছে','You have a TIN','TIN নেই','No TIN',
  'টিআইএন নিবন্ধন সম্পর্কে জানুন','Learn about TIN registration','বড় ঋণে TIN লাগে','Larger loans require a TIN','sheet:tin_registration'),
 (@set,'deep',20,'kyc',0.0300,NULL,NULL,NULL,NULL,
  'আপনার নামে কি ঠিকানার প্রমাণপত্র (বিদ্যুৎ বিল/জমির দলিল) আছে?','Do you have address proof in your name (utility bill/land deed)?',
  NULL,NULL,'আপনার ঠিকানার প্রমাণ আছে','You have address proof','ঠিকানার প্রমাণপত্র নেই','No address proof document',
  'ঠিকানার প্রমাণপত্র সংগ্রহ করুন','Obtain an address proof document','ঋণদাতার বাধ্যতামূলক কাগজ','A mandatory lender document','sheet:address_proof'
);

-- Corroboration signals (ENG-08). source_check is interpreted by the engine.
INSERT IGNORE INTO readiness_confidence_signals (code, label_bn, label_en, source_check, fix_deeplink, sort_order)
VALUES ('S1','এনআইডি যাচাই হয়েছে','National ID verified','nid_verified','screen:menuKyc',1),
 ('S2','ব্যাংক/মোবাইল ব্যাংকিং তথ্য দেওয়া আছে','Banking or MFS details saved','banking_saved','screen:menuBanking',2),
 ('S3','খামারের তথ্য দেওয়া আছে','Farm information recorded','farm_recorded','screen:menuFarm',3),
 ('S4','প্ল্যাটফর্মে লেনদেন হয়েছে','Completed a transaction on the platform','transaction_done','screen:saleCategories',4),
 ('S5','প্রকল্পে যুক্ত হয়েছেন','Enrolled in a partner project','project_enrolled','screen:projects',5),
 ('S6','প্রশিক্ষণ সম্পন্ন করেছেন','Completed a training item','training_done','screen:training',6),
 ('S7','ব্যক্তিগত তথ্য সম্পূর্ণ','Personal information complete','personal_complete','screen:personalInfo',7
);
