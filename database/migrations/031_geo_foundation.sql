-- 031: the geographic foundation.
--
-- Until now every location in the database was a free-text English name. The
-- three geo master tables existed but nothing referenced them, so a single
-- spelling ("Dhaka District" for "Dhaka") silently dropped a farmer out of every
-- project, officer and price rule in their area. This migration makes the ids
-- the source of truth:
--
--   1. The masters are reconciled against the canonical Bangla/English lists
--      (8 divisions, 64 districts, 499 upazilas). Existing ids are kept wherever
--      a row could be matched; the five genuinely new upazilas are added.
--   2. The hierarchy is enforced with foreign keys.
--   3. geo_aliases records every old spelling and every "X District"/"X
--      Division" form a phone's reverse geocoder returns, so free text coming in
--      from GPS or from legacy rows can still be resolved to an id.
--   4. Every table that holds a location gains division_id / district_id /
--      upazila_id with foreign keys, backfilled from the old text. The old text
--      columns stay, but from now on they are written by the server from the
--      ids — a display cache, never an input.
--   5. Per-feature geo-filter scopes go into app_settings, and profile changes
--      after first save go through profile_change_requests for approval.
--
-- Non-destructive: the original text values are copied to
-- geo_backfill_backup_031 before anything is rewritten.

USE shathi_sheba;

-- 1a. Divisions
UPDATE geo_divisions SET name_en = 'Dhaka', name_bn = 'ঢাকা', sort_order = 1 WHERE id = 6;
UPDATE geo_divisions SET name_en = 'Khulna', name_bn = 'খুলনা', sort_order = 2 WHERE id = 3;
UPDATE geo_divisions SET name_en = 'Chattogram', name_bn = 'চট্টগ্রাম', sort_order = 3 WHERE id = 1;
UPDATE geo_divisions SET name_en = 'Rajshahi', name_bn = 'রাজশাহী', sort_order = 4 WHERE id = 2;
UPDATE geo_divisions SET name_en = 'Sylhet', name_bn = 'সিলেট', sort_order = 5 WHERE id = 5;
UPDATE geo_divisions SET name_en = 'Rangpur', name_bn = 'রংপুর', sort_order = 6 WHERE id = 7;
UPDATE geo_divisions SET name_en = 'Mymensingh', name_bn = 'ময়মনসিংহ', sort_order = 7 WHERE id = 8;
UPDATE geo_divisions SET name_en = 'Barishal', name_bn = 'বরিশাল', sort_order = 8 WHERE id = 4;

-- 1b. Districts
UPDATE geo_districts SET name_en = 'Dhaka', name_bn = 'ঢাকা', division_id = 6 WHERE id = 47;
UPDATE geo_districts SET name_en = 'Faridpur', name_bn = 'ফরিদপুর', division_id = 6 WHERE id = 52;
UPDATE geo_districts SET name_en = 'Gazipur', name_bn = 'গাজীপুর', division_id = 6 WHERE id = 41;
UPDATE geo_districts SET name_en = 'Gopalganj', name_bn = 'গোপালগঞ্জ', division_id = 6 WHERE id = 51;
UPDATE geo_districts SET name_en = 'Kishoreganj', name_bn = 'কিশোরগঞ্জ', division_id = 6 WHERE id = 45;
UPDATE geo_districts SET name_en = 'Madaripur', name_bn = 'মাদারীপুর', division_id = 6 WHERE id = 50;
UPDATE geo_districts SET name_en = 'Manikganj', name_bn = 'মানিকগঞ্জ', division_id = 6 WHERE id = 46;
UPDATE geo_districts SET name_en = 'Munshiganj', name_bn = 'মুন্সীগঞ্জ', division_id = 6 WHERE id = 48;
UPDATE geo_districts SET name_en = 'Narayanganj', name_bn = 'নারায়ণগঞ্জ', division_id = 6 WHERE id = 43;
UPDATE geo_districts SET name_en = 'Narsingdi', name_bn = 'নরসিংদী', division_id = 6 WHERE id = 40;
UPDATE geo_districts SET name_en = 'Rajbari', name_bn = 'রাজবাড়ী', division_id = 6 WHERE id = 49;
UPDATE geo_districts SET name_en = 'Shariatpur', name_bn = 'শরীয়তপুর', division_id = 6 WHERE id = 42;
UPDATE geo_districts SET name_en = 'Tangail', name_bn = 'টাঙ্গাইল', division_id = 6 WHERE id = 44;
UPDATE geo_districts SET name_en = 'Bagerhat', name_bn = 'বাগেরহাট', division_id = 3 WHERE id = 28;
UPDATE geo_districts SET name_en = 'Chuadanga', name_bn = 'চুয়াডাঙ্গা', division_id = 3 WHERE id = 24;
UPDATE geo_districts SET name_en = 'Jashore', name_bn = 'যশোর', division_id = 3 WHERE id = 20;
UPDATE geo_districts SET name_en = 'Jhenaidah', name_bn = 'ঝিনাইদহ', division_id = 3 WHERE id = 29;
UPDATE geo_districts SET name_en = 'Khulna', name_bn = 'খুলনা', division_id = 3 WHERE id = 27;
UPDATE geo_districts SET name_en = 'Kushtia', name_bn = 'কুষ্টিয়া', division_id = 3 WHERE id = 25;
UPDATE geo_districts SET name_en = 'Magura', name_bn = 'মাগুরা', division_id = 3 WHERE id = 26;
UPDATE geo_districts SET name_en = 'Meherpur', name_bn = 'মেহেরপুর', division_id = 3 WHERE id = 22;
UPDATE geo_districts SET name_en = 'Narail', name_bn = 'নড়াইল', division_id = 3 WHERE id = 23;
UPDATE geo_districts SET name_en = 'Satkhira', name_bn = 'সাতক্ষীরা', division_id = 3 WHERE id = 21;
UPDATE geo_districts SET name_en = 'Bandarban', name_bn = 'বান্দরবান', division_id = 1 WHERE id = 11;
UPDATE geo_districts SET name_en = 'Brahmanbaria', name_bn = 'ব্রাহ্মণবাড়িয়া', division_id = 1 WHERE id = 3;
UPDATE geo_districts SET name_en = 'Chandpur', name_bn = 'চাঁদপুর', division_id = 1 WHERE id = 6;
UPDATE geo_districts SET name_en = 'Chattogram', name_bn = 'চট্টগ্রাম', division_id = 1 WHERE id = 8;
UPDATE geo_districts SET name_en = 'Cumilla', name_bn = 'কুমিল্লা', division_id = 1 WHERE id = 1;
UPDATE geo_districts SET name_en = 'Cox''s Bazar', name_bn = 'কক্সবাজার', division_id = 1 WHERE id = 9;
UPDATE geo_districts SET name_en = 'Feni', name_bn = 'ফেনী', division_id = 1 WHERE id = 2;
UPDATE geo_districts SET name_en = 'Khagrachhari', name_bn = 'খাগড়াছড়ি', division_id = 1 WHERE id = 10;
UPDATE geo_districts SET name_en = 'Lakshmipur', name_bn = 'লক্ষ্মীপুর', division_id = 1 WHERE id = 7;
UPDATE geo_districts SET name_en = 'Noakhali', name_bn = 'নোয়াখালী', division_id = 1 WHERE id = 5;
UPDATE geo_districts SET name_en = 'Rangamati Hill', name_bn = 'রাঙ্গামাটি পার্বত্য', division_id = 1 WHERE id = 4;
UPDATE geo_districts SET name_en = 'Bogura', name_bn = 'বগুড়া', division_id = 2 WHERE id = 14;
UPDATE geo_districts SET name_en = 'Joypurhat', name_bn = 'জয়পুরহাট', division_id = 2 WHERE id = 17;
UPDATE geo_districts SET name_en = 'Naogaon', name_bn = 'নওগাঁ', division_id = 2 WHERE id = 19;
UPDATE geo_districts SET name_en = 'Natore', name_bn = 'নাটোর', division_id = 2 WHERE id = 16;
UPDATE geo_districts SET name_en = 'Chapainawabganj', name_bn = 'চাঁপাইনবাবগঞ্জ', division_id = 2 WHERE id = 18;
UPDATE geo_districts SET name_en = 'Pabna', name_bn = 'পাবনা', division_id = 2 WHERE id = 13;
UPDATE geo_districts SET name_en = 'Rajshahi', name_bn = 'রাজশাহী', division_id = 2 WHERE id = 15;
UPDATE geo_districts SET name_en = 'Sirajganj', name_bn = 'সিরাজগঞ্জ', division_id = 2 WHERE id = 12;
UPDATE geo_districts SET name_en = 'Habiganj', name_bn = 'হবিগঞ্জ', division_id = 5 WHERE id = 38;
UPDATE geo_districts SET name_en = 'Moulvibazar', name_bn = 'মৌলভীবাজার', division_id = 5 WHERE id = 37;
UPDATE geo_districts SET name_en = 'Sunamganj', name_bn = 'সুনামগঞ্জ', division_id = 5 WHERE id = 39;
UPDATE geo_districts SET name_en = 'Sylhet', name_bn = 'সিলেট', division_id = 5 WHERE id = 36;
UPDATE geo_districts SET name_en = 'Dinajpur', name_bn = 'দিনাজপুর', division_id = 7 WHERE id = 54;
UPDATE geo_districts SET name_en = 'Gaibandha', name_bn = 'গাইবান্ধা', division_id = 7 WHERE id = 57;
UPDATE geo_districts SET name_en = 'Kurigram', name_bn = 'কুড়িগ্রাম', division_id = 7 WHERE id = 60;
UPDATE geo_districts SET name_en = 'Lalmonirhat', name_bn = 'লালমনিরহাট', division_id = 7 WHERE id = 55;
UPDATE geo_districts SET name_en = 'Nilphamari', name_bn = 'নীলফামারী', division_id = 7 WHERE id = 56;
UPDATE geo_districts SET name_en = 'Panchagarh', name_bn = 'পঞ্চগড়', division_id = 7 WHERE id = 53;
UPDATE geo_districts SET name_en = 'Rangpur', name_bn = 'রংপুর', division_id = 7 WHERE id = 59;
UPDATE geo_districts SET name_en = 'Thakurgaon', name_bn = 'ঠাকুরগাঁও', division_id = 7 WHERE id = 58;
UPDATE geo_districts SET name_en = 'Jamalpur', name_bn = 'জামালপুর', division_id = 8 WHERE id = 63;
UPDATE geo_districts SET name_en = 'Mymensingh', name_bn = 'ময়মনসিংহ', division_id = 8 WHERE id = 62;
UPDATE geo_districts SET name_en = 'Netrokona', name_bn = 'নেত্রকোণা', division_id = 8 WHERE id = 64;
UPDATE geo_districts SET name_en = 'Sherpur', name_bn = 'শেরপুর', division_id = 8 WHERE id = 61;
UPDATE geo_districts SET name_en = 'Barguna', name_bn = 'বরগুনা', division_id = 4 WHERE id = 35;
UPDATE geo_districts SET name_en = 'Barishal', name_bn = 'বরিশাল', division_id = 4 WHERE id = 33;
UPDATE geo_districts SET name_en = 'Bhola', name_bn = 'ভোলা', division_id = 4 WHERE id = 34;
UPDATE geo_districts SET name_en = 'Jhalakathi', name_bn = 'ঝালকাঠি', division_id = 4 WHERE id = 30;
UPDATE geo_districts SET name_en = 'Patuakhali', name_bn = 'পটুয়াখালী', division_id = 4 WHERE id = 31;
UPDATE geo_districts SET name_en = 'Pirojpur', name_bn = 'পিরোজপুর', division_id = 4 WHERE id = 32;

-- 1c. Upazilas: renames and corrections on existing ids
UPDATE geo_upazilas SET name_en = 'Dhamrai', name_bn = 'ধামরাই', district_id = 47 WHERE id = 366;
UPDATE geo_upazilas SET name_en = 'Dohar', name_bn = 'দোহার', district_id = 47 WHERE id = 369;
UPDATE geo_upazilas SET name_en = 'Keraniganj', name_bn = 'কেরাণীগঞ্জ', district_id = 47 WHERE id = 367;
UPDATE geo_upazilas SET name_en = 'Nawabganj', name_bn = 'নবাবগঞ্জ', district_id = 47 WHERE id = 368;
UPDATE geo_upazilas SET name_en = 'Savar', name_bn = 'সাভার', district_id = 47 WHERE id = 365;
UPDATE geo_upazilas SET name_en = 'Alfadanga', name_bn = 'আলফাডাঙ্গা', district_id = 52 WHERE id = 391;
UPDATE geo_upazilas SET name_en = 'Bhanga', name_bn = 'ভাঙ্গা', district_id = 52 WHERE id = 395;
UPDATE geo_upazilas SET name_en = 'Boalmari', name_bn = 'বোয়ালমারী', district_id = 52 WHERE id = 392;
UPDATE geo_upazilas SET name_en = 'Charbhadrasan', name_bn = 'চরভদ্রাসন', district_id = 52 WHERE id = 396;
UPDATE geo_upazilas SET name_en = 'Faridpur Sadar', name_bn = 'ফরিদপুর সদর', district_id = 52 WHERE id = 390;
UPDATE geo_upazilas SET name_en = 'Madhukhali', name_bn = 'মধুখালী', district_id = 52 WHERE id = 397;
UPDATE geo_upazilas SET name_en = 'Nagarkanda', name_bn = 'নগরকান্দা', district_id = 52 WHERE id = 394;
UPDATE geo_upazilas SET name_en = 'Sadarpur', name_bn = 'সদরপুর', district_id = 52 WHERE id = 393;
UPDATE geo_upazilas SET name_en = 'Saltha', name_bn = 'সালথা', district_id = 52 WHERE id = 398;
UPDATE geo_upazilas SET name_en = 'Gazipur Sadar', name_bn = 'গাজীপুর সদর', district_id = 41 WHERE id = 320;
UPDATE geo_upazilas SET name_en = 'Kaliakair', name_bn = 'কালিয়াকৈর', district_id = 41 WHERE id = 318;
UPDATE geo_upazilas SET name_en = 'Kaliganj', name_bn = 'কালীগঞ্জ', district_id = 41 WHERE id = 317;
UPDATE geo_upazilas SET name_en = 'Kapasia', name_bn = 'কাপাসিয়া', district_id = 41 WHERE id = 319;
UPDATE geo_upazilas SET name_en = 'Sreepur', name_bn = 'শ্রীপুর', district_id = 41 WHERE id = 321;
UPDATE geo_upazilas SET name_en = 'Gopalganj Sadar', name_bn = 'গোপালগঞ্জ সদর', district_id = 51 WHERE id = 385;
UPDATE geo_upazilas SET name_en = 'Kashiani', name_bn = 'কাশিয়ানী', district_id = 51 WHERE id = 386;
UPDATE geo_upazilas SET name_en = 'Kotalipara', name_bn = 'কোটালীপাড়া', district_id = 51 WHERE id = 388;
UPDATE geo_upazilas SET name_en = 'Muksudpur', name_bn = 'মুকসুদপুর', district_id = 51 WHERE id = 389;
UPDATE geo_upazilas SET name_en = 'Tungipara', name_bn = 'টুঙ্গিপাড়া', district_id = 51 WHERE id = 387;
UPDATE geo_upazilas SET name_en = 'Austagram', name_bn = 'অষ্টগ্রাম', district_id = 45 WHERE id = 355;
UPDATE geo_upazilas SET name_en = 'Bajitpur', name_bn = 'বাজিতপুর', district_id = 45 WHERE id = 354;
UPDATE geo_upazilas SET name_en = 'Bhairab', name_bn = 'ভৈরব', district_id = 45 WHERE id = 347;
UPDATE geo_upazilas SET name_en = 'Hossainpur', name_bn = 'হোসেনপুর', district_id = 45 WHERE id = 349;
UPDATE geo_upazilas SET name_en = 'Itna', name_bn = 'ইটনা', district_id = 45 WHERE id = 345;
UPDATE geo_upazilas SET name_en = 'Karimganj', name_bn = 'করিমগঞ্জ', district_id = 45 WHERE id = 353;
UPDATE geo_upazilas SET name_en = 'Katiadi', name_bn = 'কটিয়াদী', district_id = 45 WHERE id = 346;
UPDATE geo_upazilas SET name_en = 'Kishoreganj Sadar', name_bn = 'কিশোরগঞ্জ সদর', district_id = 45 WHERE id = 352;
UPDATE geo_upazilas SET name_en = 'Kuliarchar', name_bn = 'কুলিয়ারচর', district_id = 45 WHERE id = 351;
UPDATE geo_upazilas SET name_en = 'Mithamain', name_bn = 'মিঠামইন', district_id = 45 WHERE id = 356;
UPDATE geo_upazilas SET name_en = 'Nikli', name_bn = 'নিকলী', district_id = 45 WHERE id = 357;
UPDATE geo_upazilas SET name_en = 'Pakundia', name_bn = 'পাকুন্দিয়া', district_id = 45 WHERE id = 350;
UPDATE geo_upazilas SET name_en = 'Tarail', name_bn = 'তাড়াইল', district_id = 45 WHERE id = 348;
UPDATE geo_upazilas SET name_en = 'Kalkini', name_bn = 'কালকিনি', district_id = 50 WHERE id = 383;
UPDATE geo_upazilas SET name_en = 'Madaripur Sadar', name_bn = 'মাদারীপুর সদর', district_id = 50 WHERE id = 381;
UPDATE geo_upazilas SET name_en = 'Rajoir', name_bn = 'রাজৈর', district_id = 50 WHERE id = 384;
UPDATE geo_upazilas SET name_en = 'Shibchar', name_bn = 'শিবচর', district_id = 50 WHERE id = 382;
UPDATE geo_upazilas SET name_en = 'Dasar', name_bn = 'ডাসার', district_id = 50 WHERE id = 494;
UPDATE geo_upazilas SET name_en = 'Daulatpur', name_bn = 'দৌলতপুর', district_id = 46 WHERE id = 363;
UPDATE geo_upazilas SET name_en = 'Ghior', name_bn = 'ঘিওর', district_id = 46 WHERE id = 361;
UPDATE geo_upazilas SET name_en = 'Harirampur', name_bn = 'হরিরামপুর', district_id = 46 WHERE id = 358;
UPDATE geo_upazilas SET name_en = 'Manikganj Sadar', name_bn = 'মানিকগঞ্জ সদর', district_id = 46 WHERE id = 360;
UPDATE geo_upazilas SET name_en = 'Saturia', name_bn = 'সাটুরিয়া', district_id = 46 WHERE id = 359;
UPDATE geo_upazilas SET name_en = 'Shivalaya', name_bn = 'শিবালয়', district_id = 46 WHERE id = 362;
UPDATE geo_upazilas SET name_en = 'Singair', name_bn = 'সিংগাইর', district_id = 46 WHERE id = 364;
UPDATE geo_upazilas SET name_en = 'Gazaria', name_bn = 'গজারিয়া', district_id = 48 WHERE id = 374;
UPDATE geo_upazilas SET name_en = 'Lohajang', name_bn = 'লৌহজং', district_id = 48 WHERE id = 373;
UPDATE geo_upazilas SET name_en = 'Munshiganj Sadar', name_bn = 'মুন্সীগঞ্জ সদর', district_id = 48 WHERE id = 370;
UPDATE geo_upazilas SET name_en = 'Sirajdikhan', name_bn = 'সিরাজদিখান', district_id = 48 WHERE id = 372;
UPDATE geo_upazilas SET name_en = 'Sreenagar', name_bn = 'শ্রীনগর', district_id = 48 WHERE id = 371;
UPDATE geo_upazilas SET name_en = 'Tongibari', name_bn = 'টংগিবাড়ী', district_id = 48 WHERE id = 375;
UPDATE geo_upazilas SET name_en = 'Araihazar', name_bn = 'আড়াইহাজার', district_id = 43 WHERE id = 328;
UPDATE geo_upazilas SET name_en = 'Sonargaon', name_bn = 'সোনারগাঁ', district_id = 43 WHERE id = 332;
UPDATE geo_upazilas SET name_en = 'Narayanganj Sadar', name_bn = 'নারায়নগঞ্জ সদর', district_id = 43 WHERE id = 330;
UPDATE geo_upazilas SET name_en = 'Rupganj', name_bn = 'রূপগঞ্জ', district_id = 43 WHERE id = 331;
UPDATE geo_upazilas SET name_en = 'Bandar', name_bn = 'বন্দর', district_id = 43 WHERE id = 329;
UPDATE geo_upazilas SET name_en = 'Belabo', name_bn = 'বেলাবো', district_id = 40 WHERE id = 311;
UPDATE geo_upazilas SET name_en = 'Monohardi', name_bn = 'মনোহরদী', district_id = 40 WHERE id = 312;
UPDATE geo_upazilas SET name_en = 'Narsingdi Sadar', name_bn = 'নরসিংদী সদর', district_id = 40 WHERE id = 313;
UPDATE geo_upazilas SET name_en = 'Palash', name_bn = 'পলাশ', district_id = 40 WHERE id = 314;
UPDATE geo_upazilas SET name_en = 'Raipura', name_bn = 'রায়পুরা', district_id = 40 WHERE id = 315;
UPDATE geo_upazilas SET name_en = 'Shibpur', name_bn = 'শিবপুর', district_id = 40 WHERE id = 316;
UPDATE geo_upazilas SET name_en = 'Baliakandi', name_bn = 'বালিয়াকান্দি', district_id = 49 WHERE id = 379;
UPDATE geo_upazilas SET name_en = 'Goalanda', name_bn = 'গোয়ালন্দ', district_id = 49 WHERE id = 377;
UPDATE geo_upazilas SET name_en = 'Kalukhali', name_bn = 'কালুখালী', district_id = 49 WHERE id = 380;
UPDATE geo_upazilas SET name_en = 'Pangsha', name_bn = 'পাংশা', district_id = 49 WHERE id = 378;
UPDATE geo_upazilas SET name_en = 'Rajbari Sadar', name_bn = 'রাজবাড়ী সদর', district_id = 49 WHERE id = 376;
UPDATE geo_upazilas SET name_en = 'Bhedarganj', name_bn = 'ভেদরগঞ্জ', district_id = 42 WHERE id = 326;
UPDATE geo_upazilas SET name_en = 'Damudya', name_bn = 'ডামুড্যা', district_id = 42 WHERE id = 327;
UPDATE geo_upazilas SET name_en = 'Gosairhat', name_bn = 'গোসাইরহাট', district_id = 42 WHERE id = 325;
UPDATE geo_upazilas SET name_en = 'Naria', name_bn = 'নড়িয়া', district_id = 42 WHERE id = 323;
UPDATE geo_upazilas SET name_en = 'Shariatpur Sadar', name_bn = 'শরিয়তপুর সদর', district_id = 42 WHERE id = 322;
UPDATE geo_upazilas SET name_en = 'Zajira', name_bn = 'জাজিরা', district_id = 42 WHERE id = 324;
UPDATE geo_upazilas SET name_en = 'Basail', name_bn = 'বাসাইল', district_id = 44 WHERE id = 333;
UPDATE geo_upazilas SET name_en = 'Bhuapur', name_bn = 'ভূঞাপুর', district_id = 44 WHERE id = 334;
UPDATE geo_upazilas SET name_en = 'Delduar', name_bn = 'দেলদুয়ার', district_id = 44 WHERE id = 335;
UPDATE geo_upazilas SET name_en = 'Dhanbari', name_bn = 'ধনবাড়ী', district_id = 44 WHERE id = 344;
UPDATE geo_upazilas SET name_en = 'Ghatail', name_bn = 'ঘাটাইল', district_id = 44 WHERE id = 336;
UPDATE geo_upazilas SET name_en = 'Gopalpur', name_bn = 'গোপালপুর', district_id = 44 WHERE id = 337;
UPDATE geo_upazilas SET name_en = 'Kalihati', name_bn = 'কালিহাতী', district_id = 44 WHERE id = 343;
UPDATE geo_upazilas SET name_en = 'Madhupur', name_bn = 'মধুপুর', district_id = 44 WHERE id = 338;
UPDATE geo_upazilas SET name_en = 'Mirzapur', name_bn = 'মির্জাপুর', district_id = 44 WHERE id = 339;
UPDATE geo_upazilas SET name_en = 'Nagarpur', name_bn = 'নাগরপুর', district_id = 44 WHERE id = 340;
UPDATE geo_upazilas SET name_en = 'Sakhipur', name_bn = 'সখিপুর', district_id = 44 WHERE id = 341;
UPDATE geo_upazilas SET name_en = 'Tangail Sadar', name_bn = 'টাঙ্গাইল সদর', district_id = 44 WHERE id = 342;
UPDATE geo_upazilas SET name_en = 'Chitalmari', name_bn = 'চিতলমারী', district_id = 28 WHERE id = 223;
UPDATE geo_upazilas SET name_en = 'Fakirhat', name_bn = 'ফকিরহাট', district_id = 28 WHERE id = 215;
UPDATE geo_upazilas SET name_en = 'Kachua', name_bn = 'কচুয়া', district_id = 28 WHERE id = 221;
UPDATE geo_upazilas SET name_en = 'Mollahat', name_bn = 'মোল্লাহাট', district_id = 28 WHERE id = 217;
UPDATE geo_upazilas SET name_en = 'Mongla', name_bn = 'মোংলা', district_id = 28 WHERE id = 222;
UPDATE geo_upazilas SET name_en = 'Morrelganj', name_bn = 'মোরেলগঞ্জ', district_id = 28 WHERE id = 220;
UPDATE geo_upazilas SET name_en = 'Rampal', name_bn = 'রামপাল', district_id = 28 WHERE id = 219;
UPDATE geo_upazilas SET name_en = 'Sarankhola', name_bn = 'শরণখোলা', district_id = 28 WHERE id = 218;
UPDATE geo_upazilas SET name_en = 'Bagerhat Sadar', name_bn = 'বাগেরহাট সদর', district_id = 28 WHERE id = 216;
UPDATE geo_upazilas SET name_en = 'Alamdanga', name_bn = 'আলমডাঙ্গা', district_id = 24 WHERE id = 193;
UPDATE geo_upazilas SET name_en = 'Chuadanga Sadar', name_bn = 'চুয়াডাঙ্গা সদর', district_id = 24 WHERE id = 192;
UPDATE geo_upazilas SET name_en = 'Damurhuda', name_bn = 'দামুড়হুদা', district_id = 24 WHERE id = 194;
UPDATE geo_upazilas SET name_en = 'Jibannagar', name_bn = 'জীবননগর', district_id = 24 WHERE id = 195;
UPDATE geo_upazilas SET name_en = 'Abhaynagar', name_bn = 'অভয়নগর', district_id = 20 WHERE id = 172;
UPDATE geo_upazilas SET name_en = 'Bagherpara', name_bn = 'বাঘারপাড়া', district_id = 20 WHERE id = 173;
UPDATE geo_upazilas SET name_en = 'Chaugachha', name_bn = 'চৌগাছা', district_id = 20 WHERE id = 174;
UPDATE geo_upazilas SET name_en = 'Jhikargachha', name_bn = 'ঝিকরগাছা', district_id = 20 WHERE id = 175;
UPDATE geo_upazilas SET name_en = 'Keshabpur', name_bn = 'কেশবপুর', district_id = 20 WHERE id = 176;
UPDATE geo_upazilas SET name_en = 'Jashore Sadar', name_bn = 'যশোর সদর', district_id = 20 WHERE id = 177;
UPDATE geo_upazilas SET name_en = 'Manirampur', name_bn = 'মণিরামপুর', district_id = 20 WHERE id = 171;
UPDATE geo_upazilas SET name_en = 'Sharsha', name_bn = 'শার্শা', district_id = 20 WHERE id = 178;
UPDATE geo_upazilas SET name_en = 'Harinakunda', name_bn = 'হরিণাকুন্ডু', district_id = 29 WHERE id = 226;
UPDATE geo_upazilas SET name_en = 'Jhenaidah Sadar', name_bn = 'ঝিনাইদহ সদর', district_id = 29 WHERE id = 224;
UPDATE geo_upazilas SET name_en = 'Kaliganj', name_bn = 'কালীগঞ্জ', district_id = 29 WHERE id = 227;
UPDATE geo_upazilas SET name_en = 'Kotchandpur', name_bn = 'কোটচাঁদপুর', district_id = 29 WHERE id = 228;
UPDATE geo_upazilas SET name_en = 'Maheshpur', name_bn = 'মহেশপুর', district_id = 29 WHERE id = 229;
UPDATE geo_upazilas SET name_en = 'Shailkupa', name_bn = 'শৈলকুপা', district_id = 29 WHERE id = 225;
UPDATE geo_upazilas SET name_en = 'Batiaghata', name_bn = 'বটিয়াঘাটা', district_id = 27 WHERE id = 212;
UPDATE geo_upazilas SET name_en = 'Dacope', name_bn = 'দাকোপ', district_id = 27 WHERE id = 213;
UPDATE geo_upazilas SET name_en = 'Dumuria', name_bn = 'ডুমুরিয়া', district_id = 27 WHERE id = 211;
UPDATE geo_upazilas SET name_en = 'Koyra', name_bn = 'কয়রা', district_id = 27 WHERE id = 214;
UPDATE geo_upazilas SET name_en = 'Paikgachha', name_bn = 'পাইকগাছা', district_id = 27 WHERE id = 206;
UPDATE geo_upazilas SET name_en = 'Phultala', name_bn = 'ফুলতলা', district_id = 27 WHERE id = 207;
UPDATE geo_upazilas SET name_en = 'Rupsa', name_bn = 'রূপসা', district_id = 27 WHERE id = 209;
UPDATE geo_upazilas SET name_en = 'Terokhada', name_bn = 'তেরখাদা', district_id = 27 WHERE id = 210;
UPDATE geo_upazilas SET name_en = 'Dighalia', name_bn = 'দিঘলিয়া', district_id = 27 WHERE id = 208;
UPDATE geo_upazilas SET name_en = 'Bheramara', name_bn = 'ভেড়ামারা', district_id = 25 WHERE id = 201;
UPDATE geo_upazilas SET name_en = 'Daulatpur', name_bn = 'দৌলতপুর', district_id = 25 WHERE id = 200;
UPDATE geo_upazilas SET name_en = 'Khoksa', name_bn = 'খোকসা', district_id = 25 WHERE id = 198;
UPDATE geo_upazilas SET name_en = 'Kumarkhali', name_bn = 'কুমারখালী', district_id = 25 WHERE id = 197;
UPDATE geo_upazilas SET name_en = 'Kushtia Sadar', name_bn = 'কুষ্টিয়া সদর', district_id = 25 WHERE id = 196;
UPDATE geo_upazilas SET name_en = 'Mirpur', name_bn = 'মিরপুর', district_id = 25 WHERE id = 199;
UPDATE geo_upazilas SET name_en = 'Magura Sadar', name_bn = 'মাগুরা সদর', district_id = 26 WHERE id = 204;
UPDATE geo_upazilas SET name_en = 'Mohammadpur', name_bn = 'মহম্মদপুর', district_id = 26 WHERE id = 205;
UPDATE geo_upazilas SET name_en = 'Shalikha', name_bn = 'শালিখা', district_id = 26 WHERE id = 202;
UPDATE geo_upazilas SET name_en = 'Sreepur', name_bn = 'শ্রীপুর', district_id = 26 WHERE id = 203;
UPDATE geo_upazilas SET name_en = 'Gangni', name_bn = 'গাংনী', district_id = 22 WHERE id = 188;
UPDATE geo_upazilas SET name_en = 'Mujibnagar', name_bn = 'মুজিবনগর', district_id = 22 WHERE id = 186;
UPDATE geo_upazilas SET name_en = 'Meherpur Sadar', name_bn = 'মেহেরপুর সদর', district_id = 22 WHERE id = 187;
UPDATE geo_upazilas SET name_en = 'Kalia', name_bn = 'কালিয়া', district_id = 23 WHERE id = 191;
UPDATE geo_upazilas SET name_en = 'Lohagara', name_bn = 'লোহাগড়া', district_id = 23 WHERE id = 190;
UPDATE geo_upazilas SET name_en = 'Narail Sadar', name_bn = 'নড়াইল সদর', district_id = 23 WHERE id = 189;
UPDATE geo_upazilas SET name_en = 'Assasuni', name_bn = 'আশাশুনি', district_id = 21 WHERE id = 179;
UPDATE geo_upazilas SET name_en = 'Debhata', name_bn = 'দেবহাটা', district_id = 21 WHERE id = 180;
UPDATE geo_upazilas SET name_en = 'Kalaroa', name_bn = 'কলারোয়া', district_id = 21 WHERE id = 181;
UPDATE geo_upazilas SET name_en = 'Kaliganj', name_bn = 'কালিগঞ্জ', district_id = 21 WHERE id = 185;
UPDATE geo_upazilas SET name_en = 'Satkhira Sadar', name_bn = 'সাতক্ষীরা সদর', district_id = 21 WHERE id = 182;
UPDATE geo_upazilas SET name_en = 'Shyamnagar', name_bn = 'শ্যামনগর', district_id = 21 WHERE id = 183;
UPDATE geo_upazilas SET name_en = 'Tala', name_bn = 'তালা', district_id = 21 WHERE id = 184;
UPDATE geo_upazilas SET name_en = 'Alikadam', name_bn = 'আলীকদম', district_id = 11 WHERE id = 98;
UPDATE geo_upazilas SET name_en = 'Bandarban Sadar', name_bn = 'বান্দরবান সদর', district_id = 11 WHERE id = 97;
UPDATE geo_upazilas SET name_en = 'Lama', name_bn = 'লামা', district_id = 11 WHERE id = 101;
UPDATE geo_upazilas SET name_en = 'Naikhongchhari', name_bn = 'নাইক্ষ্যংছড়ি', district_id = 11 WHERE id = 99;
UPDATE geo_upazilas SET name_en = 'Rowangchhari', name_bn = 'রোয়াংছড়ি', district_id = 11 WHERE id = 100;
UPDATE geo_upazilas SET name_en = 'Ruma', name_bn = 'রুমা', district_id = 11 WHERE id = 102;
UPDATE geo_upazilas SET name_en = 'Thanchi', name_bn = 'থানচি', district_id = 11 WHERE id = 103;
UPDATE geo_upazilas SET name_en = 'Akhaura', name_bn = 'আখাউড়া', district_id = 3 WHERE id = 29;
UPDATE geo_upazilas SET name_en = 'Bancharampur', name_bn = 'বাঞ্ছারামপুর', district_id = 3 WHERE id = 31;
UPDATE geo_upazilas SET name_en = 'Bijoynagar', name_bn = 'বিজয়নগর', district_id = 3 WHERE id = 32;
UPDATE geo_upazilas SET name_en = 'Brahmanbaria Sadar', name_bn = 'ব্রাহ্মণবাড়িয়া সদর', district_id = 3 WHERE id = 24;
UPDATE geo_upazilas SET name_en = 'Ashuganj', name_bn = 'আশুগঞ্জ', district_id = 3 WHERE id = 28;
UPDATE geo_upazilas SET name_en = 'Kasba', name_bn = 'কসবা', district_id = 3 WHERE id = 25;
UPDATE geo_upazilas SET name_en = 'Nabinagar', name_bn = 'নবীনগর', district_id = 3 WHERE id = 30;
UPDATE geo_upazilas SET name_en = 'Nasirnagar', name_bn = 'নাসিরনগর', district_id = 3 WHERE id = 26;
UPDATE geo_upazilas SET name_en = 'Sarail', name_bn = 'সরাইল', district_id = 3 WHERE id = 27;
UPDATE geo_upazilas SET name_en = 'Chandpur Sadar', name_bn = 'চাঁদপুর সদর', district_id = 6 WHERE id = 55;
UPDATE geo_upazilas SET name_en = 'Faridganj', name_bn = 'ফরিদগঞ্জ', district_id = 6 WHERE id = 59;
UPDATE geo_upazilas SET name_en = 'Haimchar', name_bn = 'হাইমচর', district_id = 6 WHERE id = 52;
UPDATE geo_upazilas SET name_en = 'Hajiganj', name_bn = 'হাজীগঞ্জ', district_id = 6 WHERE id = 57;
UPDATE geo_upazilas SET name_en = 'Kachua', name_bn = 'কচুয়া', district_id = 6 WHERE id = 53;
UPDATE geo_upazilas SET name_en = 'Matlab South', name_bn = 'মতলব দক্ষিণ', district_id = 6 WHERE id = 56;
UPDATE geo_upazilas SET name_en = 'Matlab North', name_bn = 'মতলব উত্তর', district_id = 6 WHERE id = 58;
UPDATE geo_upazilas SET name_en = 'Shahrasti', name_bn = 'শাহরাস্তি', district_id = 6 WHERE id = 54;
UPDATE geo_upazilas SET name_en = 'Anwara', name_bn = 'আনোয়ারা', district_id = 8 WHERE id = 72;
UPDATE geo_upazilas SET name_en = 'Banshkhali', name_bn = 'বাঁশখালী', district_id = 8 WHERE id = 70;
UPDATE geo_upazilas SET name_en = 'Boalkhali', name_bn = 'বোয়ালখালী', district_id = 8 WHERE id = 71;
UPDATE geo_upazilas SET name_en = 'Chandanaish', name_bn = 'চন্দনাইশ', district_id = 8 WHERE id = 73;
UPDATE geo_upazilas SET name_en = 'Fatikchhari', name_bn = 'ফটিকছড়ি', district_id = 8 WHERE id = 77;
UPDATE geo_upazilas SET name_en = 'Hathazari', name_bn = 'হাটহাজারী', district_id = 8 WHERE id = 76;
UPDATE geo_upazilas SET name_en = 'Lohagara', name_bn = 'লোহাগাড়া', district_id = 8 WHERE id = 75;
UPDATE geo_upazilas SET name_en = 'Mirsharai', name_bn = 'মীরসরাই', district_id = 8 WHERE id = 67;
UPDATE geo_upazilas SET name_en = 'Patiya', name_bn = 'পটিয়া', district_id = 8 WHERE id = 68;
UPDATE geo_upazilas SET name_en = 'Rangunia', name_bn = 'রাঙ্গুনিয়া', district_id = 8 WHERE id = 65;
UPDATE geo_upazilas SET name_en = 'Raozan', name_bn = 'রাউজান', district_id = 8 WHERE id = 78;
UPDATE geo_upazilas SET name_en = 'Sandwip', name_bn = 'সন্দ্বীপ', district_id = 8 WHERE id = 69;
UPDATE geo_upazilas SET name_en = 'Satkania', name_bn = 'সাতকানিয়া', district_id = 8 WHERE id = 74;
UPDATE geo_upazilas SET name_en = 'Sitakunda', name_bn = 'সীতাকুন্ড', district_id = 8 WHERE id = 66;
UPDATE geo_upazilas SET name_en = 'Karnafuli', name_bn = 'কর্ণফুলী', district_id = 8 WHERE id = 79;
UPDATE geo_upazilas SET name_en = 'Barura', name_bn = 'বরুড়া', district_id = 1 WHERE id = 2;
UPDATE geo_upazilas SET name_en = 'Brahmanpara', name_bn = 'ব্রাহ্মণপাড়া', district_id = 1 WHERE id = 3;
UPDATE geo_upazilas SET name_en = 'Burichang', name_bn = 'বুড়িচং', district_id = 1 WHERE id = 16;
UPDATE geo_upazilas SET name_en = 'Chandina', name_bn = 'চান্দিনা', district_id = 1 WHERE id = 4;
UPDATE geo_upazilas SET name_en = 'Chauddagram', name_bn = 'চৌদ্দগ্রাম', district_id = 1 WHERE id = 5;
UPDATE geo_upazilas SET name_en = 'Cumilla Sadar Dakshin', name_bn = 'সদর দক্ষিণ', district_id = 1 WHERE id = 14;
UPDATE geo_upazilas SET name_en = 'Cumilla Adarsha Sadar', name_bn = 'আদর্শ সদর', district_id = 1 WHERE id = 11;
UPDATE geo_upazilas SET name_en = 'Daudkandi', name_bn = 'দাউদকান্দি', district_id = 1 WHERE id = 6;
UPDATE geo_upazilas SET name_en = 'Debidwar', name_bn = 'দেবিদ্বার', district_id = 1 WHERE id = 1;
UPDATE geo_upazilas SET name_en = 'Homna', name_bn = 'হোমনা', district_id = 1 WHERE id = 7;
UPDATE geo_upazilas SET name_en = 'Laksam', name_bn = 'লাকসাম', district_id = 1 WHERE id = 8;
UPDATE geo_upazilas SET name_en = 'Monoharganj', name_bn = 'মনোহরগঞ্জ', district_id = 1 WHERE id = 13;
UPDATE geo_upazilas SET name_en = 'Meghna', name_bn = 'মেঘনা', district_id = 1 WHERE id = 12;
UPDATE geo_upazilas SET name_en = 'Muradnagar', name_bn = 'মুরাদনগর', district_id = 1 WHERE id = 9;
UPDATE geo_upazilas SET name_en = 'Nangalkot', name_bn = 'নাঙ্গলকোট', district_id = 1 WHERE id = 10;
UPDATE geo_upazilas SET name_en = 'Titas', name_bn = 'তিতাস', district_id = 1 WHERE id = 15;
UPDATE geo_upazilas SET name_en = 'Lalmai', name_bn = 'লালমাই', district_id = 1 WHERE id = 17;
UPDATE geo_upazilas SET name_en = 'Chakaria', name_bn = 'চকরিয়া', district_id = 9 WHERE id = 81;
UPDATE geo_upazilas SET name_en = 'Cox''s Bazar Sadar', name_bn = 'কক্সবাজার সদর', district_id = 9 WHERE id = 80;
UPDATE geo_upazilas SET name_en = 'Kutubdia', name_bn = 'কুতুবদিয়া', district_id = 9 WHERE id = 82;
UPDATE geo_upazilas SET name_en = 'Maheshkhali', name_bn = 'মহেশখালী', district_id = 9 WHERE id = 84;
UPDATE geo_upazilas SET name_en = 'Pekua', name_bn = 'পেকুয়া', district_id = 9 WHERE id = 85;
UPDATE geo_upazilas SET name_en = 'Ramu', name_bn = 'রামু', district_id = 9 WHERE id = 86;
UPDATE geo_upazilas SET name_en = 'Teknaf', name_bn = 'টেকনাফ', district_id = 9 WHERE id = 87;
UPDATE geo_upazilas SET name_en = 'Ukhia', name_bn = 'উখিয়া', district_id = 9 WHERE id = 83;
UPDATE geo_upazilas SET name_en = 'Eidgaon', name_bn = 'ঈদগাঁও', district_id = 9 WHERE id = 492;
UPDATE geo_upazilas SET name_en = 'Chhagalnaiya', name_bn = 'ছাগলনাইয়া', district_id = 2 WHERE id = 18;
UPDATE geo_upazilas SET name_en = 'Daganbhuiyan', name_bn = 'দাগনভূঞা', district_id = 2 WHERE id = 23;
UPDATE geo_upazilas SET name_en = 'Feni Sadar', name_bn = 'ফেনী সদর', district_id = 2 WHERE id = 19;
UPDATE geo_upazilas SET name_en = 'Fulgazi', name_bn = 'ফুলগাজী', district_id = 2 WHERE id = 21;
UPDATE geo_upazilas SET name_en = 'Parshuram', name_bn = 'পরশুরাম', district_id = 2 WHERE id = 22;
UPDATE geo_upazilas SET name_en = 'Sonagazi', name_bn = 'সোনাগাজী', district_id = 2 WHERE id = 20;
UPDATE geo_upazilas SET name_en = 'Dighinala', name_bn = 'দীঘিনালা', district_id = 10 WHERE id = 89;
UPDATE geo_upazilas SET name_en = 'Manikchhari', name_bn = 'মানিকছড়ি', district_id = 10 WHERE id = 93;
UPDATE geo_upazilas SET name_en = 'Khagrachhari Sadar', name_bn = 'খাগড়াছড়ি সদর', district_id = 10 WHERE id = 88;
UPDATE geo_upazilas SET name_en = 'Lakshmichhari', name_bn = 'লক্ষীছড়ি', district_id = 10 WHERE id = 91;
UPDATE geo_upazilas SET name_en = 'Mahalchhari', name_bn = 'মহালছড়ি', district_id = 10 WHERE id = 92;
UPDATE geo_upazilas SET name_en = 'Matiranga', name_bn = 'মাটিরাঙ্গা', district_id = 10 WHERE id = 95;
UPDATE geo_upazilas SET name_en = 'Panchhari', name_bn = 'পানছড়ি', district_id = 10 WHERE id = 90;
UPDATE geo_upazilas SET name_en = 'Ramgarh', name_bn = 'রামগড়', district_id = 10 WHERE id = 94;
UPDATE geo_upazilas SET name_en = 'Guimara', name_bn = 'গুইমারা', district_id = 10 WHERE id = 96;
UPDATE geo_upazilas SET name_en = 'Kamalnagar', name_bn = 'কমলনগর', district_id = 7 WHERE id = 61;
UPDATE geo_upazilas SET name_en = 'Lakshmipur Sadar', name_bn = 'লক্ষ্মীপুর সদর', district_id = 7 WHERE id = 60;
UPDATE geo_upazilas SET name_en = 'Raipur', name_bn = 'রায়পুর', district_id = 7 WHERE id = 62;
UPDATE geo_upazilas SET name_en = 'Ramganj', name_bn = 'রামগঞ্জ', district_id = 7 WHERE id = 64;
UPDATE geo_upazilas SET name_en = 'Ramgati', name_bn = 'রামগতি', district_id = 7 WHERE id = 63;
UPDATE geo_upazilas SET name_en = 'Begumganj', name_bn = 'বেগমগঞ্জ', district_id = 5 WHERE id = 45;
UPDATE geo_upazilas SET name_en = 'Chatkhil', name_bn = 'চাটখিল', district_id = 5 WHERE id = 50;
UPDATE geo_upazilas SET name_en = 'Companiganj', name_bn = 'কোম্পানীগঞ্জ', district_id = 5 WHERE id = 44;
UPDATE geo_upazilas SET name_en = 'Hatiya', name_bn = 'হাতিয়া', district_id = 5 WHERE id = 46;
UPDATE geo_upazilas SET name_en = 'Senbagh', name_bn = 'সেনবাগ', district_id = 5 WHERE id = 49;
UPDATE geo_upazilas SET name_en = 'Sonaimuri', name_bn = 'সোনাইমুড়ী', district_id = 5 WHERE id = 51;
UPDATE geo_upazilas SET name_en = 'Subarnachar', name_bn = 'সুবর্ণচর', district_id = 5 WHERE id = 47;
UPDATE geo_upazilas SET name_en = 'Noakhali Sadar', name_bn = 'নোয়াখালী সদর', district_id = 5 WHERE id = 43;
UPDATE geo_upazilas SET name_en = 'Kabirhat', name_bn = 'কবিরহাট', district_id = 5 WHERE id = 48;
UPDATE geo_upazilas SET name_en = 'Baghaichhari', name_bn = 'বাঘাইছড়ি', district_id = 4 WHERE id = 36;
UPDATE geo_upazilas SET name_en = 'Barkal', name_bn = 'বরকল', district_id = 4 WHERE id = 37;
UPDATE geo_upazilas SET name_en = 'Kawkhali', name_bn = 'কাউখালী', district_id = 4 WHERE id = 35;
UPDATE geo_upazilas SET name_en = 'Kaptai', name_bn = 'কাপ্তাই', district_id = 4 WHERE id = 34;
UPDATE geo_upazilas SET name_en = 'Juraichhari', name_bn = 'জুরাছড়ি', district_id = 4 WHERE id = 41;
UPDATE geo_upazilas SET name_en = 'Langadu', name_bn = 'লংগদু', district_id = 4 WHERE id = 38;
UPDATE geo_upazilas SET name_en = 'Naniarchar', name_bn = 'নানিয়ারচর', district_id = 4 WHERE id = 42;
UPDATE geo_upazilas SET name_en = 'Rangamati Sadar', name_bn = 'রাঙ্গামাটি সদর', district_id = 4 WHERE id = 33;
UPDATE geo_upazilas SET name_en = 'Rajasthali', name_bn = 'রাজস্থলী', district_id = 4 WHERE id = 39;
UPDATE geo_upazilas SET name_en = 'Belaichhari', name_bn = 'বিলাইছড়ি', district_id = 4 WHERE id = 40;
UPDATE geo_upazilas SET name_en = 'Adamdighi', name_bn = 'আদমদিঘি', district_id = 14 WHERE id = 127;
UPDATE geo_upazilas SET name_en = 'Bogura Sadar', name_bn = 'বগুড়া সদর', district_id = 14 WHERE id = 123;
UPDATE geo_upazilas SET name_en = 'Dhunat', name_bn = 'ধুনট', district_id = 14 WHERE id = 130;
UPDATE geo_upazilas SET name_en = 'Dupchanchia', name_bn = 'দুপচাচিঁয়া', district_id = 14 WHERE id = 126;
UPDATE geo_upazilas SET name_en = 'Gabtali', name_bn = 'গাবতলী', district_id = 14 WHERE id = 131;
UPDATE geo_upazilas SET name_en = 'Kahalu', name_bn = 'কাহালু', district_id = 14 WHERE id = 122;
UPDATE geo_upazilas SET name_en = 'Nandigram', name_bn = 'নন্দিগ্রাম', district_id = 14 WHERE id = 128;
UPDATE geo_upazilas SET name_en = 'Sariakandi', name_bn = 'সারিয়াকান্দি', district_id = 14 WHERE id = 124;
UPDATE geo_upazilas SET name_en = 'Shajahanpur', name_bn = 'শাজাহানপুর', district_id = 14 WHERE id = 125;
UPDATE geo_upazilas SET name_en = 'Sherpur', name_bn = 'শেরপুর', district_id = 14 WHERE id = 132;
UPDATE geo_upazilas SET name_en = 'Shibganj', name_bn = 'শিবগঞ্জ', district_id = 14 WHERE id = 133;
UPDATE geo_upazilas SET name_en = 'Sonatala', name_bn = 'সোনাতলা', district_id = 14 WHERE id = 129;
UPDATE geo_upazilas SET name_en = 'Akkelpur', name_bn = 'আক্কেলপুর', district_id = 17 WHERE id = 150;
UPDATE geo_upazilas SET name_en = 'Joypurhat Sadar', name_bn = 'জয়পুরহাট সদর', district_id = 17 WHERE id = 154;
UPDATE geo_upazilas SET name_en = 'Kalai', name_bn = 'কালাই', district_id = 17 WHERE id = 151;
UPDATE geo_upazilas SET name_en = 'Panchbibi', name_bn = 'পাঁচবিবি', district_id = 17 WHERE id = 153;
UPDATE geo_upazilas SET name_en = 'Khetlal', name_bn = 'ক্ষেতলাল', district_id = 17 WHERE id = 152;
UPDATE geo_upazilas SET name_en = 'Atrai', name_bn = 'আত্রাই', district_id = 19 WHERE id = 166;
UPDATE geo_upazilas SET name_en = 'Dhamoirhat', name_bn = 'ধামইরহাট', district_id = 19 WHERE id = 163;
UPDATE geo_upazilas SET name_en = 'Manda', name_bn = 'মান্দা', district_id = 19 WHERE id = 165;
UPDATE geo_upazilas SET name_en = 'Mahadebpur', name_bn = 'মহাদেবপুর', district_id = 19 WHERE id = 160;
UPDATE geo_upazilas SET name_en = 'Naogaon Sadar', name_bn = 'নওগাঁ সদর', district_id = 19 WHERE id = 168;
UPDATE geo_upazilas SET name_en = 'Niamatpur', name_bn = 'নিয়ামতপুর', district_id = 19 WHERE id = 164;
UPDATE geo_upazilas SET name_en = 'Patnitala', name_bn = 'পত্নীতলা', district_id = 19 WHERE id = 162;
UPDATE geo_upazilas SET name_en = 'Raninagar', name_bn = 'রাণীনগর', district_id = 19 WHERE id = 167;
UPDATE geo_upazilas SET name_en = 'Sapahar', name_bn = 'সাপাহার', district_id = 19 WHERE id = 170;
UPDATE geo_upazilas SET name_en = 'Badalgachhi', name_bn = 'বদলগাছী', district_id = 19 WHERE id = 161;
UPDATE geo_upazilas SET name_en = 'Porsha', name_bn = 'পোরশা', district_id = 19 WHERE id = 169;
UPDATE geo_upazilas SET name_en = 'Bagatipara', name_bn = 'বাগাতিপাড়া', district_id = 16 WHERE id = 146;
UPDATE geo_upazilas SET name_en = 'Baraigram', name_bn = 'বড়াইগ্রাম', district_id = 16 WHERE id = 145;
UPDATE geo_upazilas SET name_en = 'Gurudaspur', name_bn = 'গুরুদাসপুর', district_id = 16 WHERE id = 148;
UPDATE geo_upazilas SET name_en = 'Lalpur', name_bn = 'লালপুর', district_id = 16 WHERE id = 147;
UPDATE geo_upazilas SET name_en = 'Natore Sadar', name_bn = 'নাটোর সদর', district_id = 16 WHERE id = 143;
UPDATE geo_upazilas SET name_en = 'Singra', name_bn = 'সিংড়া', district_id = 16 WHERE id = 144;
UPDATE geo_upazilas SET name_en = 'Naldanga', name_bn = 'নলডাঙ্গা', district_id = 16 WHERE id = 149;
UPDATE geo_upazilas SET name_en = 'Shibganj', name_bn = 'শিবগঞ্জ', district_id = 18 WHERE id = 159;
UPDATE geo_upazilas SET name_en = 'Bholahat', name_bn = 'ভোলাহাট', district_id = 18 WHERE id = 158;
UPDATE geo_upazilas SET name_en = 'Gomastapur', name_bn = 'গোমস্তাপুর', district_id = 18 WHERE id = 156;
UPDATE geo_upazilas SET name_en = 'Nachole', name_bn = 'নাচোল', district_id = 18 WHERE id = 157;
UPDATE geo_upazilas SET name_en = 'Chapainawabganj Sadar', name_bn = 'চাঁপাইনবাবগঞ্জ সদর', district_id = 18 WHERE id = 155;
UPDATE geo_upazilas SET name_en = 'Atgharia', name_bn = 'আটঘরিয়া', district_id = 13 WHERE id = 118;
UPDATE geo_upazilas SET name_en = 'Bera', name_bn = 'বেড়া', district_id = 13 WHERE id = 117;
UPDATE geo_upazilas SET name_en = 'Bhangura', name_bn = 'ভাঙ্গুড়া', district_id = 13 WHERE id = 115;
UPDATE geo_upazilas SET name_en = 'Chatmohar', name_bn = 'চাটমোহর', district_id = 13 WHERE id = 119;
UPDATE geo_upazilas SET name_en = 'Faridpur', name_bn = 'ফরিদপুর', district_id = 13 WHERE id = 121;
UPDATE geo_upazilas SET name_en = 'Ishwardi', name_bn = 'ঈশ্বরদী', district_id = 13 WHERE id = 114;
UPDATE geo_upazilas SET name_en = 'Pabna Sadar', name_bn = 'পাবনা সদর', district_id = 13 WHERE id = 116;
UPDATE geo_upazilas SET name_en = 'Santhia', name_bn = 'সাঁথিয়া', district_id = 13 WHERE id = 120;
UPDATE geo_upazilas SET name_en = 'Sujanagar', name_bn = 'সুজানগর', district_id = 13 WHERE id = 113;
UPDATE geo_upazilas SET name_en = 'Bagha', name_bn = 'বাঘা', district_id = 15 WHERE id = 139;
UPDATE geo_upazilas SET name_en = 'Bagmara', name_bn = 'বাগমারা', district_id = 15 WHERE id = 142;
UPDATE geo_upazilas SET name_en = 'Charghat', name_bn = 'চারঘাট', district_id = 15 WHERE id = 137;
UPDATE geo_upazilas SET name_en = 'Durgapur', name_bn = 'দুর্গাপুর', district_id = 15 WHERE id = 135;
UPDATE geo_upazilas SET name_en = 'Godagari', name_bn = 'গোদাগাড়ী', district_id = 15 WHERE id = 140;
UPDATE geo_upazilas SET name_en = 'Mohanpur', name_bn = 'মোহনপুর', district_id = 15 WHERE id = 136;
UPDATE geo_upazilas SET name_en = 'Paba', name_bn = 'পবা', district_id = 15 WHERE id = 134;
UPDATE geo_upazilas SET name_en = 'Puthia', name_bn = 'পুঠিয়া', district_id = 15 WHERE id = 138;
UPDATE geo_upazilas SET name_en = 'Tanore', name_bn = 'তানোর', district_id = 15 WHERE id = 141;
UPDATE geo_upazilas SET name_en = 'Belkuchi', name_bn = 'বেলকুচি', district_id = 12 WHERE id = 104;
UPDATE geo_upazilas SET name_en = 'Chauhali', name_bn = 'চৌহালি', district_id = 12 WHERE id = 105;
UPDATE geo_upazilas SET name_en = 'Kamarkhanda', name_bn = 'কামারখন্দ', district_id = 12 WHERE id = 106;
UPDATE geo_upazilas SET name_en = 'Kazipur', name_bn = 'কাজীপুর', district_id = 12 WHERE id = 107;
UPDATE geo_upazilas SET name_en = 'Raiganj', name_bn = 'রায়গঞ্জ', district_id = 12 WHERE id = 108;
UPDATE geo_upazilas SET name_en = 'Shahjadpur', name_bn = 'শাহজাদপুর', district_id = 12 WHERE id = 109;
UPDATE geo_upazilas SET name_en = 'Sirajganj Sadar', name_bn = 'সিরাজগঞ্জ সদর', district_id = 12 WHERE id = 110;
UPDATE geo_upazilas SET name_en = 'Tarash', name_bn = 'তাড়াশ', district_id = 12 WHERE id = 111;
UPDATE geo_upazilas SET name_en = 'Ullapara', name_bn = 'উল্লাপাড়া', district_id = 12 WHERE id = 112;
UPDATE geo_upazilas SET name_en = 'Ajmiriganj', name_bn = 'আজমিরীগঞ্জ', district_id = 38 WHERE id = 294;
UPDATE geo_upazilas SET name_en = 'Bahubal', name_bn = 'বাহুবল', district_id = 38 WHERE id = 293;
UPDATE geo_upazilas SET name_en = 'Baniachong', name_bn = 'বানিয়াচং', district_id = 38 WHERE id = 295;
UPDATE geo_upazilas SET name_en = 'Chunarughat', name_bn = 'চুনারুঘাট', district_id = 38 WHERE id = 297;
UPDATE geo_upazilas SET name_en = 'Habiganj Sadar', name_bn = 'হবিগঞ্জ সদর', district_id = 38 WHERE id = 298;
UPDATE geo_upazilas SET name_en = 'Lakhai', name_bn = 'লাখাই', district_id = 38 WHERE id = 296;
UPDATE geo_upazilas SET name_en = 'Madhabpur', name_bn = 'মাধবপুর', district_id = 38 WHERE id = 299;
UPDATE geo_upazilas SET name_en = 'Nabiganj', name_bn = 'নবীগঞ্জ', district_id = 38 WHERE id = 292;
UPDATE geo_upazilas SET name_en = 'Barlekha', name_bn = 'বড়লেখা', district_id = 37 WHERE id = 285;
UPDATE geo_upazilas SET name_en = 'Juri', name_bn = 'জুড়ী', district_id = 37 WHERE id = 291;
UPDATE geo_upazilas SET name_en = 'Kamalganj', name_bn = 'কমলগঞ্জ', district_id = 37 WHERE id = 286;
UPDATE geo_upazilas SET name_en = 'Kulaura', name_bn = 'কুলাউড়া', district_id = 37 WHERE id = 287;
UPDATE geo_upazilas SET name_en = 'Moulvibazar Sadar', name_bn = 'মৌলভীবাজার সদর', district_id = 37 WHERE id = 288;
UPDATE geo_upazilas SET name_en = 'Rajnagar', name_bn = 'রাজনগর', district_id = 37 WHERE id = 289;
UPDATE geo_upazilas SET name_en = 'Sreemangal', name_bn = 'শ্রীমঙ্গল', district_id = 37 WHERE id = 290;
UPDATE geo_upazilas SET name_en = 'Bishwambharpur', name_bn = 'বিশ্বম্ভরপুর', district_id = 39 WHERE id = 302;
UPDATE geo_upazilas SET name_en = 'Chhatak', name_bn = 'ছাতক', district_id = 39 WHERE id = 303;
UPDATE geo_upazilas SET name_en = 'Derai', name_bn = 'দিরাই', district_id = 39 WHERE id = 310;
UPDATE geo_upazilas SET name_en = 'Dharmapasha', name_bn = 'ধর্মপাশা', district_id = 39 WHERE id = 307;
UPDATE geo_upazilas SET name_en = 'Dowarabazar', name_bn = 'দোয়ারাবাজার', district_id = 39 WHERE id = 305;
UPDATE geo_upazilas SET name_en = 'Jagannathpur', name_bn = 'জগন্নাথপুর', district_id = 39 WHERE id = 304;
UPDATE geo_upazilas SET name_en = 'Jamalganj', name_bn = 'জামালগঞ্জ', district_id = 39 WHERE id = 308;
UPDATE geo_upazilas SET name_en = 'Shalla', name_bn = 'শাল্লা', district_id = 39 WHERE id = 309;
UPDATE geo_upazilas SET name_en = 'Sunamganj Sadar', name_bn = 'সুনামগঞ্জ সদর', district_id = 39 WHERE id = 300;
UPDATE geo_upazilas SET name_en = 'Tahirpur', name_bn = 'তাহিরপুর', district_id = 39 WHERE id = 306;
UPDATE geo_upazilas SET name_en = 'Shantiganj', name_bn = 'শান্তিগঞ্জ', district_id = 39 WHERE id = 301;
UPDATE geo_upazilas SET name_en = 'Madhyanagar', name_bn = 'মধ্যনগর', district_id = 39 WHERE id = 493;
UPDATE geo_upazilas SET name_en = 'Balaganj', name_bn = 'বালাগঞ্জ', district_id = 36 WHERE id = 272;
UPDATE geo_upazilas SET name_en = 'Beanibazar', name_bn = 'বিয়ানীবাজার', district_id = 36 WHERE id = 273;
UPDATE geo_upazilas SET name_en = 'Bishwanath', name_bn = 'বিশ্বনাথ', district_id = 36 WHERE id = 274;
UPDATE geo_upazilas SET name_en = 'Companiganj', name_bn = 'কোম্পানীগঞ্জ', district_id = 36 WHERE id = 275;
UPDATE geo_upazilas SET name_en = 'Dakshin Surma', name_bn = 'দক্ষিণ সুরমা', district_id = 36 WHERE id = 283;
UPDATE geo_upazilas SET name_en = 'Fenchuganj', name_bn = 'ফেঞ্চুগঞ্জ', district_id = 36 WHERE id = 276;
UPDATE geo_upazilas SET name_en = 'Golapganj', name_bn = 'গোলাপগঞ্জ', district_id = 36 WHERE id = 277;
UPDATE geo_upazilas SET name_en = 'Gowainghat', name_bn = 'গোয়াইনঘাট', district_id = 36 WHERE id = 278;
UPDATE geo_upazilas SET name_en = 'Jaintiapur', name_bn = 'জৈন্তাপুর', district_id = 36 WHERE id = 279;
UPDATE geo_upazilas SET name_en = 'Kanaighat', name_bn = 'কানাইঘাট', district_id = 36 WHERE id = 280;
UPDATE geo_upazilas SET name_en = 'Sylhet Sadar', name_bn = 'সিলেট সদর', district_id = 36 WHERE id = 281;
UPDATE geo_upazilas SET name_en = 'Zakiganj', name_bn = 'জকিগঞ্জ', district_id = 36 WHERE id = 282;
UPDATE geo_upazilas SET name_en = 'Osmani Nagar', name_bn = 'ওসমানী নগর', district_id = 36 WHERE id = 284;
UPDATE geo_upazilas SET name_en = 'Birampur', name_bn = 'বিরামপুর', district_id = 54 WHERE id = 407;
UPDATE geo_upazilas SET name_en = 'Birganj', name_bn = 'বীরগঞ্জ', district_id = 54 WHERE id = 405;
UPDATE geo_upazilas SET name_en = 'Birol', name_bn = 'বিরল', district_id = 54 WHERE id = 415;
UPDATE geo_upazilas SET name_en = 'Bochaganj', name_bn = 'বোচাগঞ্জ', district_id = 54 WHERE id = 409;
UPDATE geo_upazilas SET name_en = 'Chirirbandar', name_bn = 'চিরিরবন্দর', district_id = 54 WHERE id = 416;
UPDATE geo_upazilas SET name_en = 'Fulbari', name_bn = 'ফুলবাড়ী', district_id = 54 WHERE id = 411;
UPDATE geo_upazilas SET name_en = 'Ghoraghat', name_bn = 'ঘোড়াঘাট', district_id = 54 WHERE id = 406;
UPDATE geo_upazilas SET name_en = 'Hakimpur', name_bn = 'হাকিমপুর', district_id = 54 WHERE id = 413;
UPDATE geo_upazilas SET name_en = 'Kaharole', name_bn = 'কাহারোল', district_id = 54 WHERE id = 410;
UPDATE geo_upazilas SET name_en = 'Khansama', name_bn = 'খানসামা', district_id = 54 WHERE id = 414;
UPDATE geo_upazilas SET name_en = 'Nawabganj', name_bn = 'নবাবগঞ্জ', district_id = 54 WHERE id = 404;
UPDATE geo_upazilas SET name_en = 'Parbatipur', name_bn = 'পার্বতীপুর', district_id = 54 WHERE id = 408;
UPDATE geo_upazilas SET name_en = 'Dinajpur Sadar', name_bn = 'দিনাজপুর সদর', district_id = 54 WHERE id = 412;
UPDATE geo_upazilas SET name_en = 'Phulchhari', name_bn = 'ফুলছড়ি', district_id = 57 WHERE id = 434;
UPDATE geo_upazilas SET name_en = 'Gaibandha Sadar', name_bn = 'গাইবান্ধা সদর', district_id = 57 WHERE id = 429;
UPDATE geo_upazilas SET name_en = 'Gobindaganj', name_bn = 'গোবিন্দগঞ্জ', district_id = 57 WHERE id = 432;
UPDATE geo_upazilas SET name_en = 'Palashbari', name_bn = 'পলাশবাড়ী', district_id = 57 WHERE id = 430;
UPDATE geo_upazilas SET name_en = 'Sadullapur', name_bn = 'সাদুল্লাপুর', district_id = 57 WHERE id = 428;
UPDATE geo_upazilas SET name_en = 'Saghata', name_bn = 'সাঘাটা', district_id = 57 WHERE id = 431;
UPDATE geo_upazilas SET name_en = 'Sundarganj', name_bn = 'সুন্দরগঞ্জ', district_id = 57 WHERE id = 433;
UPDATE geo_upazilas SET name_en = 'Phulbari', name_bn = 'ফুলবাড়ী', district_id = 60 WHERE id = 451;
UPDATE geo_upazilas SET name_en = 'Bhurungamari', name_bn = 'ভূরুঙ্গামারী', district_id = 60 WHERE id = 450;
UPDATE geo_upazilas SET name_en = 'Char Rajibpur', name_bn = 'চর রাজিবপুর', district_id = 60 WHERE id = 456;
UPDATE geo_upazilas SET name_en = 'Chilmari', name_bn = 'চিলমারী', district_id = 60 WHERE id = 454;
UPDATE geo_upazilas SET name_en = 'Kurigram Sadar', name_bn = 'কুড়িগ্রাম সদর', district_id = 60 WHERE id = 448;
UPDATE geo_upazilas SET name_en = 'Nageshwari', name_bn = 'নাগেশ্বরী', district_id = 60 WHERE id = 449;
UPDATE geo_upazilas SET name_en = 'Rajarhat', name_bn = 'রাজারহাট', district_id = 60 WHERE id = 452;
UPDATE geo_upazilas SET name_en = 'Roumari', name_bn = 'রৌমারী', district_id = 60 WHERE id = 455;
UPDATE geo_upazilas SET name_en = 'Ulipur', name_bn = 'উলিপুর', district_id = 60 WHERE id = 453;
UPDATE geo_upazilas SET name_en = 'Aditmari', name_bn = 'আদিতমারী', district_id = 55 WHERE id = 421;
UPDATE geo_upazilas SET name_en = 'Hatibandha', name_bn = 'হাতীবান্ধা', district_id = 55 WHERE id = 419;
UPDATE geo_upazilas SET name_en = 'Kaliganj', name_bn = 'কালীগঞ্জ', district_id = 55 WHERE id = 418;
UPDATE geo_upazilas SET name_en = 'Lalmonirhat Sadar', name_bn = 'লালমনিরহাট সদর', district_id = 55 WHERE id = 417;
UPDATE geo_upazilas SET name_en = 'Patgram', name_bn = 'পাটগ্রাম', district_id = 55 WHERE id = 420;
UPDATE geo_upazilas SET name_en = 'Domar', name_bn = 'ডোমার', district_id = 56 WHERE id = 423;
UPDATE geo_upazilas SET name_en = 'Jaldhaka', name_bn = 'জলঢাকা', district_id = 56 WHERE id = 425;
UPDATE geo_upazilas SET name_en = 'Kishoreganj', name_bn = 'কিশোরগঞ্জ', district_id = 56 WHERE id = 426;
UPDATE geo_upazilas SET name_en = 'Nilphamari Sadar', name_bn = 'নীলফামারী সদর', district_id = 56 WHERE id = 427;
UPDATE geo_upazilas SET name_en = 'Saidpur', name_bn = 'সৈয়দপুর', district_id = 56 WHERE id = 422;
UPDATE geo_upazilas SET name_en = 'Dimla', name_bn = 'ডিমলা', district_id = 56 WHERE id = 424;
UPDATE geo_upazilas SET name_en = 'Atwari', name_bn = 'আটোয়ারী', district_id = 53 WHERE id = 402;
UPDATE geo_upazilas SET name_en = 'Boda', name_bn = 'বোদা', district_id = 53 WHERE id = 401;
UPDATE geo_upazilas SET name_en = 'Debiganj', name_bn = 'দেবীগঞ্জ', district_id = 53 WHERE id = 400;
UPDATE geo_upazilas SET name_en = 'Panchagarh Sadar', name_bn = 'পঞ্চগড় সদর', district_id = 53 WHERE id = 399;
UPDATE geo_upazilas SET name_en = 'Tetulia', name_bn = 'তেঁতুলিয়া', district_id = 53 WHERE id = 403;
UPDATE geo_upazilas SET name_en = 'Badarganj', name_bn = 'বদরগঞ্জ', district_id = 59 WHERE id = 443;
UPDATE geo_upazilas SET name_en = 'Kaunia', name_bn = 'কাউনিয়া', district_id = 59 WHERE id = 446;
UPDATE geo_upazilas SET name_en = 'Rangpur Sadar', name_bn = 'রংপুর সদর', district_id = 59 WHERE id = 440;
UPDATE geo_upazilas SET name_en = 'Mithapukur', name_bn = 'মিঠাপুকুর', district_id = 59 WHERE id = 444;
UPDATE geo_upazilas SET name_en = 'Pirgachha', name_bn = 'পীরগাছা', district_id = 59 WHERE id = 447;
UPDATE geo_upazilas SET name_en = 'Pirganj', name_bn = 'পীরগঞ্জ', district_id = 59 WHERE id = 445;
UPDATE geo_upazilas SET name_en = 'Taraganj', name_bn = 'তারাগঞ্জ', district_id = 59 WHERE id = 442;
UPDATE geo_upazilas SET name_en = 'Gangachara', name_bn = 'গংগাচড়া', district_id = 59 WHERE id = 441;
UPDATE geo_upazilas SET name_en = 'Pirganj', name_bn = 'পীরগঞ্জ', district_id = 58 WHERE id = 436;
UPDATE geo_upazilas SET name_en = 'Baliadangi', name_bn = 'বালিয়াডাঙ্গী', district_id = 58 WHERE id = 439;
UPDATE geo_upazilas SET name_en = 'Haripur', name_bn = 'হরিপুর', district_id = 58 WHERE id = 438;
UPDATE geo_upazilas SET name_en = 'Ranisankail', name_bn = 'রাণীশংকৈল', district_id = 58 WHERE id = 437;
UPDATE geo_upazilas SET name_en = 'Thakurgaon Sadar', name_bn = 'ঠাকুরগাঁও সদর', district_id = 58 WHERE id = 435;
UPDATE geo_upazilas SET name_en = 'Bakshiganj', name_bn = 'বকশীগঞ্জ', district_id = 63 WHERE id = 481;
UPDATE geo_upazilas SET name_en = 'Dewanganj', name_bn = 'দেওয়ানগঞ্জ', district_id = 63 WHERE id = 478;
UPDATE geo_upazilas SET name_en = 'Islampur', name_bn = 'ইসলামপুর', district_id = 63 WHERE id = 477;
UPDATE geo_upazilas SET name_en = 'Jamalpur Sadar', name_bn = 'জামালপুর সদর', district_id = 63 WHERE id = 475;
UPDATE geo_upazilas SET name_en = 'Madarganj', name_bn = 'মাদারগঞ্জ', district_id = 63 WHERE id = 480;
UPDATE geo_upazilas SET name_en = 'Melandaha', name_bn = 'মেলান্দহ', district_id = 63 WHERE id = 476;
UPDATE geo_upazilas SET name_en = 'Sarishabari', name_bn = 'সরিষাবাড়ী', district_id = 63 WHERE id = 479;
UPDATE geo_upazilas SET name_en = 'Bhaluka', name_bn = 'ভালুকা', district_id = 62 WHERE id = 464;
UPDATE geo_upazilas SET name_en = 'Dhobaura', name_bn = 'ধোবাউড়া', district_id = 62 WHERE id = 467;
UPDATE geo_upazilas SET name_en = 'Fulbaria', name_bn = 'ফুলবাড়ীয়া', district_id = 62 WHERE id = 462;
UPDATE geo_upazilas SET name_en = 'Gafargaon', name_bn = 'গফরগাঁও', district_id = 62 WHERE id = 471;
UPDATE geo_upazilas SET name_en = 'Gauripur', name_bn = 'গৌরীপুর', district_id = 62 WHERE id = 470;
UPDATE geo_upazilas SET name_en = 'Haluaghat', name_bn = 'হালুয়াঘাট', district_id = 62 WHERE id = 469;
UPDATE geo_upazilas SET name_en = 'Ishwarganj', name_bn = 'ঈশ্বরগঞ্জ', district_id = 62 WHERE id = 472;
UPDATE geo_upazilas SET name_en = 'Mymensingh Sadar', name_bn = 'ময়মনসিংহ সদর', district_id = 62 WHERE id = 466;
UPDATE geo_upazilas SET name_en = 'Muktagachha', name_bn = 'মুক্তাগাছা', district_id = 62 WHERE id = 465;
UPDATE geo_upazilas SET name_en = 'Nandail', name_bn = 'নান্দাইল', district_id = 62 WHERE id = 473;
UPDATE geo_upazilas SET name_en = 'Phulpur', name_bn = 'ফুলপুর', district_id = 62 WHERE id = 468;
UPDATE geo_upazilas SET name_en = 'Tarakanda', name_bn = 'তারাকান্দা', district_id = 62 WHERE id = 474;
UPDATE geo_upazilas SET name_en = 'Trishal', name_bn = 'ত্রিশাল', district_id = 62 WHERE id = 463;
UPDATE geo_upazilas SET name_en = 'Atpara', name_bn = 'আটপাড়া', district_id = 64 WHERE id = 485;
UPDATE geo_upazilas SET name_en = 'Barhatta', name_bn = 'বারহাট্টা', district_id = 64 WHERE id = 482;
UPDATE geo_upazilas SET name_en = 'Durgapur', name_bn = 'দুর্গাপুর', district_id = 64 WHERE id = 483;
UPDATE geo_upazilas SET name_en = 'Khaliajuri', name_bn = 'খালিয়াজুরী', district_id = 64 WHERE id = 487;
UPDATE geo_upazilas SET name_en = 'Kalmakanda', name_bn = 'কলমাকান্দা', district_id = 64 WHERE id = 488;
UPDATE geo_upazilas SET name_en = 'Kendua', name_bn = 'কেন্দুয়া', district_id = 64 WHERE id = 484;
UPDATE geo_upazilas SET name_en = 'Madan', name_bn = 'মদন', district_id = 64 WHERE id = 486;
UPDATE geo_upazilas SET name_en = 'Mohanganj', name_bn = 'মোহনগঞ্জ', district_id = 64 WHERE id = 489;
UPDATE geo_upazilas SET name_en = 'Netrokona Sadar', name_bn = 'নেত্রকোণা সদর', district_id = 64 WHERE id = 491;
UPDATE geo_upazilas SET name_en = 'Purbadhala', name_bn = 'পূর্বধলা', district_id = 64 WHERE id = 490;
UPDATE geo_upazilas SET name_en = 'Jhenaigati', name_bn = 'ঝিনাইগাতী', district_id = 61 WHERE id = 461;
UPDATE geo_upazilas SET name_en = 'Nakla', name_bn = 'নকলা', district_id = 61 WHERE id = 460;
UPDATE geo_upazilas SET name_en = 'Nalitabari', name_bn = 'নালিতাবাড়ী', district_id = 61 WHERE id = 458;
UPDATE geo_upazilas SET name_en = 'Sherpur Sadar', name_bn = 'শেরপুর সদর', district_id = 61 WHERE id = 457;
UPDATE geo_upazilas SET name_en = 'Sreebardi', name_bn = 'শ্রীবরদী', district_id = 61 WHERE id = 459;
UPDATE geo_upazilas SET name_en = 'Amtali', name_bn = 'আমতলী', district_id = 35 WHERE id = 266;
UPDATE geo_upazilas SET name_en = 'Bamna', name_bn = 'বামনা', district_id = 35 WHERE id = 269;
UPDATE geo_upazilas SET name_en = 'Barguna Sadar', name_bn = 'বরগুনা সদর', district_id = 35 WHERE id = 267;
UPDATE geo_upazilas SET name_en = 'Betagi', name_bn = 'বেতাগী', district_id = 35 WHERE id = 268;
UPDATE geo_upazilas SET name_en = 'Patharghata', name_bn = 'পাথরঘাটা', district_id = 35 WHERE id = 270;
UPDATE geo_upazilas SET name_en = 'Taltali', name_bn = 'তালতলী', district_id = 35 WHERE id = 271;
UPDATE geo_upazilas SET name_en = 'Agailjhara', name_bn = 'আগৈলঝাড়া', district_id = 33 WHERE id = 255;
UPDATE geo_upazilas SET name_en = 'Babuganj', name_bn = 'বাবুগঞ্জ', district_id = 33 WHERE id = 251;
UPDATE geo_upazilas SET name_en = 'Bakerganj', name_bn = 'বাকেরগঞ্জ', district_id = 33 WHERE id = 250;
UPDATE geo_upazilas SET name_en = 'Banaripara', name_bn = 'বানারীপাড়া', district_id = 33 WHERE id = 253;
UPDATE geo_upazilas SET name_en = 'Gournadi', name_bn = 'গৌরনদী', district_id = 33 WHERE id = 254;
UPDATE geo_upazilas SET name_en = 'Hizla', name_bn = 'হিজলা', district_id = 33 WHERE id = 258;
UPDATE geo_upazilas SET name_en = 'Barishal Sadar', name_bn = 'বরিশাল সদর', district_id = 33 WHERE id = 249;
UPDATE geo_upazilas SET name_en = 'Mehendiganj', name_bn = 'মেহেন্দিগঞ্জ', district_id = 33 WHERE id = 256;
UPDATE geo_upazilas SET name_en = 'Muladi', name_bn = 'মুলাদী', district_id = 33 WHERE id = 257;
UPDATE geo_upazilas SET name_en = 'Wazirpur', name_bn = 'উজিরপুর', district_id = 33 WHERE id = 252;
UPDATE geo_upazilas SET name_en = 'Bhola Sadar', name_bn = 'ভোলা সদর', district_id = 34 WHERE id = 259;
UPDATE geo_upazilas SET name_en = 'Borhanuddin', name_bn = 'বোরহানউদ্দিন', district_id = 34 WHERE id = 260;
UPDATE geo_upazilas SET name_en = 'Daulatkhan', name_bn = 'দৌলতখান', district_id = 34 WHERE id = 262;
UPDATE geo_upazilas SET name_en = 'Lalmohan', name_bn = 'লালমোহন', district_id = 34 WHERE id = 265;
UPDATE geo_upazilas SET name_en = 'Manpura', name_bn = 'মনপুরা', district_id = 34 WHERE id = 263;
UPDATE geo_upazilas SET name_en = 'Tazumuddin', name_bn = 'তজুমদ্দিন', district_id = 34 WHERE id = 264;
UPDATE geo_upazilas SET name_en = 'Char Fasson', name_bn = 'চরফ্যাশন', district_id = 34 WHERE id = 261;
UPDATE geo_upazilas SET name_en = 'Jhalakathi Sadar', name_bn = 'ঝালকাঠি সদর', district_id = 30 WHERE id = 230;
UPDATE geo_upazilas SET name_en = 'Nalchity', name_bn = 'নলছিটি', district_id = 30 WHERE id = 232;
UPDATE geo_upazilas SET name_en = 'Kathalia', name_bn = 'কাঠালিয়া', district_id = 30 WHERE id = 231;
UPDATE geo_upazilas SET name_en = 'Rajapur', name_bn = 'রাজাপুর', district_id = 30 WHERE id = 233;
UPDATE geo_upazilas SET name_en = 'Bauphal', name_bn = 'বাউফল', district_id = 31 WHERE id = 234;
UPDATE geo_upazilas SET name_en = 'Dashmina', name_bn = 'দশমিনা', district_id = 31 WHERE id = 237;
UPDATE geo_upazilas SET name_en = 'Dumki', name_bn = 'দুমকী', district_id = 31 WHERE id = 236;
UPDATE geo_upazilas SET name_en = 'Kalapara', name_bn = 'কলাপাড়া', district_id = 31 WHERE id = 238;
UPDATE geo_upazilas SET name_en = 'Mirzaganj', name_bn = 'মির্জাগঞ্জ', district_id = 31 WHERE id = 239;
UPDATE geo_upazilas SET name_en = 'Patuakhali Sadar', name_bn = 'পটুয়াখালী সদর', district_id = 31 WHERE id = 235;
UPDATE geo_upazilas SET name_en = 'Rangabali', name_bn = 'রাঙ্গাবালী', district_id = 31 WHERE id = 241;
UPDATE geo_upazilas SET name_en = 'Galachipa', name_bn = 'গলাচিপা', district_id = 31 WHERE id = 240;
UPDATE geo_upazilas SET name_en = 'Bhandaria', name_bn = 'ভান্ডারিয়া', district_id = 32 WHERE id = 246;
UPDATE geo_upazilas SET name_en = 'Kawkhali', name_bn = 'কাউখালী', district_id = 32 WHERE id = 244;
UPDATE geo_upazilas SET name_en = 'Mathbaria', name_bn = 'মঠবাড়ীয়া', district_id = 32 WHERE id = 247;
UPDATE geo_upazilas SET name_en = 'Nazirpur', name_bn = 'নাজিরপুর', district_id = 32 WHERE id = 243;
UPDATE geo_upazilas SET name_en = 'Pirojpur Sadar', name_bn = 'পিরোজপুর সদর', district_id = 32 WHERE id = 242;
UPDATE geo_upazilas SET name_en = 'Nesarabad', name_bn = 'নেছারাবাদ', district_id = 32 WHERE id = 248;
UPDATE geo_upazilas SET name_en = 'Zianagar', name_bn = 'জিয়ানগর', district_id = 32 WHERE id = 245;

-- 1d. Upazilas created since the original seed
INSERT INTO geo_upazilas (id, district_id, name_en, name_bn) SELECT 495, 7, 'Chandraganj', 'চন্দ্রগঞ্জ' WHERE NOT EXISTS (SELECT 1 FROM (SELECT id FROM geo_upazilas) t WHERE t.id = 495);
INSERT INTO geo_upazilas (id, district_id, name_en, name_bn) SELECT 496, 14, 'Mokamtala', 'মোকামতলা' WHERE NOT EXISTS (SELECT 1 FROM (SELECT id FROM geo_upazilas) t WHERE t.id = 496);
INSERT INTO geo_upazilas (id, district_id, name_en, name_bn) SELECT 497, 38, 'Shayestaganj', 'শায়েস্তাগঞ্জ' WHERE NOT EXISTS (SELECT 1 FROM (SELECT id FROM geo_upazilas) t WHERE t.id = 497);
INSERT INTO geo_upazilas (id, district_id, name_en, name_bn) SELECT 498, 58, 'Bhulli', 'ভূল্লী' WHERE NOT EXISTS (SELECT 1 FROM (SELECT id FROM geo_upazilas) t WHERE t.id = 498);
INSERT INTO geo_upazilas (id, district_id, name_en, name_bn) SELECT 499, 58, 'Ruhia', 'রুহিয়া' WHERE NOT EXISTS (SELECT 1 FROM (SELECT id FROM geo_upazilas) t WHERE t.id = 499);

-- 2. Enforce the hierarchy, and one name per parent.
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'geo_districts' AND CONSTRAINT_NAME = 'fk_geo_districts_division');
SET @s := IF(@c = 0, 'ALTER TABLE geo_districts ADD CONSTRAINT fk_geo_districts_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE RESTRICT', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'geo_upazilas' AND CONSTRAINT_NAME = 'fk_geo_upazilas_district');
SET @s := IF(@c = 0, 'ALTER TABLE geo_upazilas ADD CONSTRAINT fk_geo_upazilas_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE RESTRICT', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'geo_districts' AND INDEX_NAME = 'uq_geo_districts_name');
SET @s := IF(@c = 0, 'ALTER TABLE geo_districts ADD UNIQUE KEY uq_geo_districts_name (division_id, name_en)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'geo_upazilas' AND INDEX_NAME = 'uq_geo_upazilas_name');
SET @s := IF(@c = 0, 'ALTER TABLE geo_upazilas ADD UNIQUE KEY uq_geo_upazilas_name (district_id, name_en)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 3. Other names each place is known by. Resolution of free text (GPS reverse
--    geocoding, legacy rows) checks name_en, name_bn and these, in that order.
CREATE TABLE IF NOT EXISTS geo_aliases (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  level     ENUM('division','district','upazila') NOT NULL,
  geo_id    BIGINT UNSIGNED NOT NULL,
  alias     VARCHAR(160) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_geo_alias (level, alias, geo_id),
  KEY idx_geo_alias_geo (level, geo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO geo_aliases (level, geo_id, alias) VALUES
  ('district', 1, 'Comilla'),
  ('district', 1, 'Cumilla District'),
  ('district', 2, 'Feni District'),
  ('district', 3, 'Brahmanbaria District'),
  ('district', 4, 'Rangamati'),
  ('district', 4, 'Rangamati Hill District'),
  ('district', 5, 'Noakhali District'),
  ('district', 6, 'Chandpur District'),
  ('district', 7, 'Lakshmipur District'),
  ('district', 8, 'Chattogram District'),
  ('district', 8, 'Chittagong'),
  ('district', 9, 'Cox Bazar'),
  ('district', 9, 'Cox''s Bazar District'),
  ('district', 9, 'Coxs Bazar'),
  ('district', 9, 'Coxsbazar'),
  ('district', 10, 'Khagrachhari District'),
  ('district', 11, 'Bandarban District'),
  ('district', 12, 'Sirajganj District'),
  ('district', 13, 'Pabna District'),
  ('district', 14, 'Bogra'),
  ('district', 14, 'Bogura District'),
  ('district', 15, 'Rajshahi District'),
  ('district', 16, 'Natore District'),
  ('district', 17, 'Joypurhat District'),
  ('district', 18, 'Chapai Nawabganj'),
  ('district', 18, 'Chapainawabganj District'),
  ('district', 18, 'Nawabganj'),
  ('district', 19, 'Naogaon District'),
  ('district', 20, 'Jashore District'),
  ('district', 20, 'Jessore'),
  ('district', 21, 'Satkhira District'),
  ('district', 22, 'Meherpur District'),
  ('district', 23, 'Narail District'),
  ('district', 24, 'Chuadanga District'),
  ('district', 25, 'Kushtia District'),
  ('district', 26, 'Magura District'),
  ('district', 27, 'Khulna District'),
  ('district', 28, 'Bagerhat District'),
  ('district', 29, 'Jhenaidah District'),
  ('district', 30, 'Jhalakathi District'),
  ('district', 30, 'Jhalokathi'),
  ('district', 30, 'Jhalokati'),
  ('district', 31, 'Patuakhali District'),
  ('district', 32, 'Pirojpur District'),
  ('district', 33, 'Barisal'),
  ('district', 33, 'Barishal District'),
  ('district', 34, 'Bhola District'),
  ('district', 35, 'Barguna District'),
  ('district', 36, 'Sylhet District'),
  ('district', 37, 'Maulvibazar'),
  ('district', 37, 'Moulvibazar District'),
  ('district', 38, 'Habiganj District'),
  ('district', 39, 'Sunamganj District'),
  ('district', 40, 'Narsingdi District'),
  ('district', 40, 'Narsinghdi'),
  ('district', 41, 'Gazipur District'),
  ('district', 42, 'Shariatpur District'),
  ('district', 43, 'Narayanganj District'),
  ('district', 44, 'Tangail District'),
  ('district', 45, 'Kishoreganj District'),
  ('district', 46, 'Manikganj District'),
  ('district', 47, 'Dhaka District'),
  ('district', 48, 'Munshiganj District'),
  ('district', 49, 'Rajbari District'),
  ('district', 50, 'Madaripur District'),
  ('district', 51, 'Gopalganj District'),
  ('district', 52, 'Faridpur District'),
  ('district', 53, 'Panchagarh District'),
  ('district', 54, 'Dinajpur District'),
  ('district', 55, 'Lalmonirhat District'),
  ('district', 56, 'Nilphamari District'),
  ('district', 57, 'Gaibandha District'),
  ('district', 58, 'Thakurgaon District'),
  ('district', 59, 'Rangpur District'),
  ('district', 60, 'Kurigram District'),
  ('district', 61, 'Sherpur District'),
  ('district', 62, 'Mymensingh District'),
  ('district', 63, 'Jamalpur District'),
  ('district', 64, 'Netrakona'),
  ('district', 64, 'Netrokona District'),
  ('division', 1, 'Chattagram'),
  ('division', 1, 'Chattogram Division'),
  ('division', 1, 'Chittagong'),
  ('division', 1, 'Chittagong Division'),
  ('division', 2, 'Rajshahi Division'),
  ('division', 3, 'Khulna Division'),
  ('division', 4, 'Barisal'),
  ('division', 4, 'Barisal Division'),
  ('division', 4, 'Barishal Division'),
  ('division', 5, 'Sylhet Division'),
  ('division', 6, 'Dhaka Division'),
  ('division', 7, 'Rangpur Division'),
  ('division', 8, 'Mymensingh Division'),
  ('upazila', 11, 'Comilla Sadar'),
  ('upazila', 13, 'Monohargonj'),
  ('upazila', 14, 'Sadarsouth'),
  ('upazila', 36, 'Baghaichari'),
  ('upazila', 40, 'Belaichari'),
  ('upazila', 41, 'Juraichari'),
  ('upazila', 46, 'Hatia'),
  ('upazila', 49, 'Senbug'),
  ('upazila', 51, 'Sonaimori'),
  ('upazila', 59, 'Faridgonj'),
  ('upazila', 80, 'Coxsbazar Sadar'),
  ('upazila', 83, 'Ukhiya'),
  ('upazila', 84, 'Moheshkhali'),
  ('upazila', 90, 'Panchari'),
  ('upazila', 91, 'Laxmichhari'),
  ('upazila', 92, 'Mohalchari'),
  ('upazila', 93, 'Manikchari'),
  ('upazila', 106, 'Kamarkhand'),
  ('upazila', 108, 'Raigonj'),
  ('upazila', 114, 'Ishurdi'),
  ('upazila', 118, 'Atghoria'),
  ('upazila', 122, 'Kahaloo'),
  ('upazila', 123, 'Bogra Sadar'),
  ('upazila', 124, 'Shariakandi'),
  ('upazila', 128, 'Nondigram'),
  ('upazila', 130, 'Dhunot'),
  ('upazila', 136, 'Mohonpur'),
  ('upazila', 156, 'Gomostapur'),
  ('upazila', 157, 'Nachol'),
  ('upazila', 160, 'Mohadevpur'),
  ('upazila', 161, 'Badalgachi'),
  ('upazila', 174, 'Chougachha'),
  ('upazila', 175, 'Jhikargacha'),
  ('upazila', 177, 'Jessore Sadar'),
  ('upazila', 206, 'Paikgasa'),
  ('upazila', 207, 'Fultola'),
  ('upazila', 208, 'Digholia'),
  ('upazila', 209, 'Rupsha'),
  ('upazila', 212, 'Botiaghata'),
  ('upazila', 213, 'Dakop'),
  ('upazila', 226, 'Harinakundu'),
  ('upazila', 229, 'Moheshpur'),
  ('upazila', 249, 'Barisal Sadar'),
  ('upazila', 260, 'Borhan Sddin'),
  ('upazila', 261, 'Charfesson'),
  ('upazila', 262, 'Doulatkhan'),
  ('upazila', 263, 'Monpura'),
  ('upazila', 270, 'Pathorghata'),
  ('upazila', 283, 'Dakshinsurma'),
  ('upazila', 284, 'Osmaninagar'),
  ('upazila', 286, 'Kamolganj'),
  ('upazila', 301, 'South Sunamganj'),
  ('upazila', 302, 'Bishwambarpur'),
  ('upazila', 353, 'Karimgonj'),
  ('upazila', 356, 'Mithamoin'),
  ('upazila', 361, 'Gior'),
  ('upazila', 362, 'Shibaloy'),
  ('upazila', 363, 'Doulatpur'),
  ('upazila', 364, 'Singiar'),
  ('upazila', 373, 'Louhajanj'),
  ('upazila', 374, 'Gajaria'),
  ('upazila', 378, 'Pangsa'),
  ('upazila', 410, 'Kaharol'),
  ('upazila', 422, 'Syedpur'),
  ('upazila', 426, 'Kishorganj'),
  ('upazila', 434, 'Phulchari'),
  ('upazila', 442, 'Taragonj'),
  ('upazila', 443, 'Badargonj'),
  ('upazila', 445, 'Pirgonj'),
  ('upazila', 447, 'Pirgacha'),
  ('upazila', 455, 'Rowmari'),
  ('upazila', 456, 'Charrajibpur'),
  ('upazila', 459, 'Sreebordi'),
  ('upazila', 460, 'Nokla'),
  ('upazila', 465, 'Muktagacha'),
  ('upazila', 470, 'Gouripur'),
  ('upazila', 472, 'Iswarganj'),
  ('upazila', 476, 'Melandah'),
  ('upazila', 478, 'Dewangonj'),
  ('upazila', 481, 'Bokshiganj'),
  ('upazila', 489, 'Mohongonj');

-- 4a. Snapshot every legacy text value before it is rewritten.
CREATE TABLE IF NOT EXISTS geo_backfill_backup_031 (
  tbl        VARCHAR(64)  NOT NULL,
  row_id     BIGINT UNSIGNED NOT NULL,
  division   VARCHAR(160) NULL,
  district   VARCHAR(160) NULL,
  upazila    VARCHAR(160) NULL,
  backed_up_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tbl, row_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'app_users', id, division, district, upazila FROM app_users;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'partner_projects', id, division, district, upazila FROM partner_projects;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'sale_listings', id, division, district, upazila FROM sale_listings;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'loan_applications', id, division, district, upazila FROM loan_applications;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'sale_pricing_rules', id, division, district, NULL FROM sale_pricing_rules;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'zone_officers', id, NULL, district, upazila FROM zone_officers;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'orders', id, NULL, district, upazila FROM orders;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'community_posts', id, NULL, district, upazila FROM community_posts;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'market_updates', id, NULL, district, upazila FROM market_updates;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'weather_alerts', id, NULL, district, upazila FROM weather_alerts;
INSERT IGNORE INTO geo_backfill_backup_031 (tbl, row_id, division, district, upazila) SELECT 'admin_users', id, NULL, district, upazila FROM admin_users;

-- 4b. The id columns, indexed and foreign-keyed. ON DELETE SET NULL: removing a
--     place from the masters must never delete the farmer or listing behind it.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE app_users ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND INDEX_NAME = 'idx_usr_division');
SET @s := IF(@c = 0, 'ALTER TABLE app_users ADD KEY idx_usr_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND CONSTRAINT_NAME = 'fk_usr_division');
SET @s := IF(@c = 0, 'ALTER TABLE app_users ADD CONSTRAINT fk_usr_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE app_users ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND INDEX_NAME = 'idx_usr_district');
SET @s := IF(@c = 0, 'ALTER TABLE app_users ADD KEY idx_usr_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND CONSTRAINT_NAME = 'fk_usr_district');
SET @s := IF(@c = 0, 'ALTER TABLE app_users ADD CONSTRAINT fk_usr_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE app_users ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND INDEX_NAME = 'idx_usr_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE app_users ADD KEY idx_usr_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'app_users' AND CONSTRAINT_NAME = 'fk_usr_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE app_users ADD CONSTRAINT fk_usr_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_projects' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE partner_projects ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_projects' AND INDEX_NAME = 'idx_prj_division');
SET @s := IF(@c = 0, 'ALTER TABLE partner_projects ADD KEY idx_prj_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_projects' AND CONSTRAINT_NAME = 'fk_prj_division');
SET @s := IF(@c = 0, 'ALTER TABLE partner_projects ADD CONSTRAINT fk_prj_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_projects' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE partner_projects ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_projects' AND INDEX_NAME = 'idx_prj_district');
SET @s := IF(@c = 0, 'ALTER TABLE partner_projects ADD KEY idx_prj_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_projects' AND CONSTRAINT_NAME = 'fk_prj_district');
SET @s := IF(@c = 0, 'ALTER TABLE partner_projects ADD CONSTRAINT fk_prj_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_projects' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE partner_projects ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_projects' AND INDEX_NAME = 'idx_prj_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE partner_projects ADD KEY idx_prj_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_projects' AND CONSTRAINT_NAME = 'fk_prj_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE partner_projects ADD CONSTRAINT fk_prj_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_listings' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE sale_listings ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_listings' AND INDEX_NAME = 'idx_sal_division');
SET @s := IF(@c = 0, 'ALTER TABLE sale_listings ADD KEY idx_sal_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_listings' AND CONSTRAINT_NAME = 'fk_sal_division');
SET @s := IF(@c = 0, 'ALTER TABLE sale_listings ADD CONSTRAINT fk_sal_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_listings' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE sale_listings ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_listings' AND INDEX_NAME = 'idx_sal_district');
SET @s := IF(@c = 0, 'ALTER TABLE sale_listings ADD KEY idx_sal_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_listings' AND CONSTRAINT_NAME = 'fk_sal_district');
SET @s := IF(@c = 0, 'ALTER TABLE sale_listings ADD CONSTRAINT fk_sal_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_listings' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE sale_listings ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_listings' AND INDEX_NAME = 'idx_sal_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE sale_listings ADD KEY idx_sal_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_listings' AND CONSTRAINT_NAME = 'fk_sal_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE sale_listings ADD CONSTRAINT fk_sal_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND INDEX_NAME = 'idx_loan_division');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications ADD KEY idx_loan_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND CONSTRAINT_NAME = 'fk_loan_division');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications ADD CONSTRAINT fk_loan_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND INDEX_NAME = 'idx_loan_district');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications ADD KEY idx_loan_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND CONSTRAINT_NAME = 'fk_loan_district');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications ADD CONSTRAINT fk_loan_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND INDEX_NAME = 'idx_loan_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications ADD KEY idx_loan_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'loan_applications' AND CONSTRAINT_NAME = 'fk_loan_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE loan_applications ADD CONSTRAINT fk_loan_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_pricing_rules' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE sale_pricing_rules ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_pricing_rules' AND INDEX_NAME = 'idx_price_division');
SET @s := IF(@c = 0, 'ALTER TABLE sale_pricing_rules ADD KEY idx_price_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_pricing_rules' AND CONSTRAINT_NAME = 'fk_price_division');
SET @s := IF(@c = 0, 'ALTER TABLE sale_pricing_rules ADD CONSTRAINT fk_price_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_pricing_rules' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE sale_pricing_rules ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_pricing_rules' AND INDEX_NAME = 'idx_price_district');
SET @s := IF(@c = 0, 'ALTER TABLE sale_pricing_rules ADD KEY idx_price_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_pricing_rules' AND CONSTRAINT_NAME = 'fk_price_district');
SET @s := IF(@c = 0, 'ALTER TABLE sale_pricing_rules ADD CONSTRAINT fk_price_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_pricing_rules' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE sale_pricing_rules ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_pricing_rules' AND INDEX_NAME = 'idx_price_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE sale_pricing_rules ADD KEY idx_price_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'sale_pricing_rules' AND CONSTRAINT_NAME = 'fk_price_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE sale_pricing_rules ADD CONSTRAINT fk_price_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zone_officers' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE zone_officers ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zone_officers' AND INDEX_NAME = 'idx_zo_division');
SET @s := IF(@c = 0, 'ALTER TABLE zone_officers ADD KEY idx_zo_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'zone_officers' AND CONSTRAINT_NAME = 'fk_zo_division');
SET @s := IF(@c = 0, 'ALTER TABLE zone_officers ADD CONSTRAINT fk_zo_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zone_officers' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE zone_officers ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zone_officers' AND INDEX_NAME = 'idx_zo_district');
SET @s := IF(@c = 0, 'ALTER TABLE zone_officers ADD KEY idx_zo_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'zone_officers' AND CONSTRAINT_NAME = 'fk_zo_district');
SET @s := IF(@c = 0, 'ALTER TABLE zone_officers ADD CONSTRAINT fk_zo_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zone_officers' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE zone_officers ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zone_officers' AND INDEX_NAME = 'idx_zo_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE zone_officers ADD KEY idx_zo_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'zone_officers' AND CONSTRAINT_NAME = 'fk_zo_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE zone_officers ADD CONSTRAINT fk_zo_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE orders ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_ord_division');
SET @s := IF(@c = 0, 'ALTER TABLE orders ADD KEY idx_ord_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_ord_division');
SET @s := IF(@c = 0, 'ALTER TABLE orders ADD CONSTRAINT fk_ord_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE orders ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_ord_district');
SET @s := IF(@c = 0, 'ALTER TABLE orders ADD KEY idx_ord_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_ord_district');
SET @s := IF(@c = 0, 'ALTER TABLE orders ADD CONSTRAINT fk_ord_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE orders ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND INDEX_NAME = 'idx_ord_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE orders ADD KEY idx_ord_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND CONSTRAINT_NAME = 'fk_ord_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE orders ADD CONSTRAINT fk_ord_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE community_posts ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND INDEX_NAME = 'idx_post_division');
SET @s := IF(@c = 0, 'ALTER TABLE community_posts ADD KEY idx_post_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND CONSTRAINT_NAME = 'fk_post_division');
SET @s := IF(@c = 0, 'ALTER TABLE community_posts ADD CONSTRAINT fk_post_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE community_posts ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND INDEX_NAME = 'idx_post_district');
SET @s := IF(@c = 0, 'ALTER TABLE community_posts ADD KEY idx_post_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND CONSTRAINT_NAME = 'fk_post_district');
SET @s := IF(@c = 0, 'ALTER TABLE community_posts ADD CONSTRAINT fk_post_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE community_posts ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND INDEX_NAME = 'idx_post_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE community_posts ADD KEY idx_post_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'community_posts' AND CONSTRAINT_NAME = 'fk_post_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE community_posts ADD CONSTRAINT fk_post_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'market_updates' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE market_updates ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'market_updates' AND INDEX_NAME = 'idx_mkt_division');
SET @s := IF(@c = 0, 'ALTER TABLE market_updates ADD KEY idx_mkt_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'market_updates' AND CONSTRAINT_NAME = 'fk_mkt_division');
SET @s := IF(@c = 0, 'ALTER TABLE market_updates ADD CONSTRAINT fk_mkt_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'market_updates' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE market_updates ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'market_updates' AND INDEX_NAME = 'idx_mkt_district');
SET @s := IF(@c = 0, 'ALTER TABLE market_updates ADD KEY idx_mkt_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'market_updates' AND CONSTRAINT_NAME = 'fk_mkt_district');
SET @s := IF(@c = 0, 'ALTER TABLE market_updates ADD CONSTRAINT fk_mkt_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'market_updates' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE market_updates ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'market_updates' AND INDEX_NAME = 'idx_mkt_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE market_updates ADD KEY idx_mkt_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'market_updates' AND CONSTRAINT_NAME = 'fk_mkt_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE market_updates ADD CONSTRAINT fk_mkt_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_alerts' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE weather_alerts ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_alerts' AND INDEX_NAME = 'idx_wx_division');
SET @s := IF(@c = 0, 'ALTER TABLE weather_alerts ADD KEY idx_wx_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_alerts' AND CONSTRAINT_NAME = 'fk_wx_division');
SET @s := IF(@c = 0, 'ALTER TABLE weather_alerts ADD CONSTRAINT fk_wx_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_alerts' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE weather_alerts ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_alerts' AND INDEX_NAME = 'idx_wx_district');
SET @s := IF(@c = 0, 'ALTER TABLE weather_alerts ADD KEY idx_wx_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_alerts' AND CONSTRAINT_NAME = 'fk_wx_district');
SET @s := IF(@c = 0, 'ALTER TABLE weather_alerts ADD CONSTRAINT fk_wx_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_alerts' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE weather_alerts ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_alerts' AND INDEX_NAME = 'idx_wx_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE weather_alerts ADD KEY idx_wx_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'weather_alerts' AND CONSTRAINT_NAME = 'fk_wx_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE weather_alerts ADD CONSTRAINT fk_wx_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'division_id');
SET @s := IF(@c = 0, 'ALTER TABLE admin_users ADD COLUMN division_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND INDEX_NAME = 'idx_adm_division');
SET @s := IF(@c = 0, 'ALTER TABLE admin_users ADD KEY idx_adm_division (division_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND CONSTRAINT_NAME = 'fk_adm_division');
SET @s := IF(@c = 0, 'ALTER TABLE admin_users ADD CONSTRAINT fk_adm_division FOREIGN KEY (division_id) REFERENCES geo_divisions(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'district_id');
SET @s := IF(@c = 0, 'ALTER TABLE admin_users ADD COLUMN district_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND INDEX_NAME = 'idx_adm_district');
SET @s := IF(@c = 0, 'ALTER TABLE admin_users ADD KEY idx_adm_district (district_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND CONSTRAINT_NAME = 'fk_adm_district');
SET @s := IF(@c = 0, 'ALTER TABLE admin_users ADD CONSTRAINT fk_adm_district FOREIGN KEY (district_id) REFERENCES geo_districts(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'upazila_id');
SET @s := IF(@c = 0, 'ALTER TABLE admin_users ADD COLUMN upazila_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND INDEX_NAME = 'idx_adm_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE admin_users ADD KEY idx_adm_upazila (upazila_id)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'admin_users' AND CONSTRAINT_NAME = 'fk_adm_upazila');
SET @s := IF(@c = 0, 'ALTER TABLE admin_users ADD CONSTRAINT fk_adm_upazila FOREIGN KEY (upazila_id) REFERENCES geo_upazilas(id) ON UPDATE CASCADE ON DELETE SET NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 4c. Backfill. Resolution order: exact English name, Bangla name, then alias.
--     Upazilas are resolved only within their district — nine upazila names
--     repeat across districts (Kaliganj x4), so a name alone is ambiguous.

-- app_users
UPDATE app_users x JOIN (SELECT id, name_en AS nm FROM geo_divisions UNION SELECT id, name_bn FROM geo_divisions UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'division') m ON m.nm = TRIM(x.division) SET x.division_id = m.id WHERE x.division_id IS NULL AND x.division IS NOT NULL AND TRIM(x.division) <> '';
UPDATE app_users x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE app_users x JOIN (SELECT id, district_id, name_en AS nm FROM geo_upazilas UNION SELECT id, district_id, name_bn FROM geo_upazilas UNION SELECT a.geo_id, u.district_id, a.alias FROM geo_aliases a JOIN geo_upazilas u ON u.id = a.geo_id WHERE a.level = 'upazila') m ON m.nm = TRIM(x.upazila) AND m.district_id = x.district_id SET x.upazila_id = m.id WHERE x.upazila_id IS NULL AND x.district_id IS NOT NULL AND x.upazila IS NOT NULL AND TRIM(x.upazila) <> '';
UPDATE app_users x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE app_users x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE app_users x LEFT JOIN geo_divisions g ON g.id = x.division_id SET x.division = g.name_en WHERE NOT (x.division <=> g.name_en);
UPDATE app_users x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en);
UPDATE app_users x LEFT JOIN geo_upazilas g ON g.id = x.upazila_id SET x.upazila = g.name_en WHERE NOT (x.upazila <=> g.name_en);

-- partner_projects
UPDATE partner_projects x JOIN (SELECT id, name_en AS nm FROM geo_divisions UNION SELECT id, name_bn FROM geo_divisions UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'division') m ON m.nm = TRIM(x.division) SET x.division_id = m.id WHERE x.division_id IS NULL AND x.division IS NOT NULL AND TRIM(x.division) <> '';
UPDATE partner_projects x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE partner_projects x JOIN (SELECT id, district_id, name_en AS nm FROM geo_upazilas UNION SELECT id, district_id, name_bn FROM geo_upazilas UNION SELECT a.geo_id, u.district_id, a.alias FROM geo_aliases a JOIN geo_upazilas u ON u.id = a.geo_id WHERE a.level = 'upazila') m ON m.nm = TRIM(x.upazila) AND m.district_id = x.district_id SET x.upazila_id = m.id WHERE x.upazila_id IS NULL AND x.district_id IS NOT NULL AND x.upazila IS NOT NULL AND TRIM(x.upazila) <> '';
UPDATE partner_projects x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE partner_projects x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE partner_projects x LEFT JOIN geo_divisions g ON g.id = x.division_id SET x.division = g.name_en WHERE NOT (x.division <=> g.name_en);
UPDATE partner_projects x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en);
UPDATE partner_projects x LEFT JOIN geo_upazilas g ON g.id = x.upazila_id SET x.upazila = g.name_en WHERE NOT (x.upazila <=> g.name_en);

-- sale_listings
UPDATE sale_listings x JOIN (SELECT id, name_en AS nm FROM geo_divisions UNION SELECT id, name_bn FROM geo_divisions UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'division') m ON m.nm = TRIM(x.division) SET x.division_id = m.id WHERE x.division_id IS NULL AND x.division IS NOT NULL AND TRIM(x.division) <> '';
UPDATE sale_listings x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE sale_listings x JOIN (SELECT id, district_id, name_en AS nm FROM geo_upazilas UNION SELECT id, district_id, name_bn FROM geo_upazilas UNION SELECT a.geo_id, u.district_id, a.alias FROM geo_aliases a JOIN geo_upazilas u ON u.id = a.geo_id WHERE a.level = 'upazila') m ON m.nm = TRIM(x.upazila) AND m.district_id = x.district_id SET x.upazila_id = m.id WHERE x.upazila_id IS NULL AND x.district_id IS NOT NULL AND x.upazila IS NOT NULL AND TRIM(x.upazila) <> '';
UPDATE sale_listings x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE sale_listings x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE sale_listings x LEFT JOIN geo_divisions g ON g.id = x.division_id SET x.division = g.name_en WHERE NOT (x.division <=> g.name_en);
UPDATE sale_listings x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en);
UPDATE sale_listings x LEFT JOIN geo_upazilas g ON g.id = x.upazila_id SET x.upazila = g.name_en WHERE NOT (x.upazila <=> g.name_en);

-- loan_applications
UPDATE loan_applications x JOIN (SELECT id, name_en AS nm FROM geo_divisions UNION SELECT id, name_bn FROM geo_divisions UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'division') m ON m.nm = TRIM(x.division) SET x.division_id = m.id WHERE x.division_id IS NULL AND x.division IS NOT NULL AND TRIM(x.division) <> '';
UPDATE loan_applications x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE loan_applications x JOIN (SELECT id, district_id, name_en AS nm FROM geo_upazilas UNION SELECT id, district_id, name_bn FROM geo_upazilas UNION SELECT a.geo_id, u.district_id, a.alias FROM geo_aliases a JOIN geo_upazilas u ON u.id = a.geo_id WHERE a.level = 'upazila') m ON m.nm = TRIM(x.upazila) AND m.district_id = x.district_id SET x.upazila_id = m.id WHERE x.upazila_id IS NULL AND x.district_id IS NOT NULL AND x.upazila IS NOT NULL AND TRIM(x.upazila) <> '';
UPDATE loan_applications x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE loan_applications x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE loan_applications x LEFT JOIN geo_divisions g ON g.id = x.division_id SET x.division = g.name_en WHERE NOT (x.division <=> g.name_en);
UPDATE loan_applications x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en);
UPDATE loan_applications x LEFT JOIN geo_upazilas g ON g.id = x.upazila_id SET x.upazila = g.name_en WHERE NOT (x.upazila <=> g.name_en);

-- sale_pricing_rules
UPDATE sale_pricing_rules x JOIN (SELECT id, name_en AS nm FROM geo_divisions UNION SELECT id, name_bn FROM geo_divisions UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'division') m ON m.nm = TRIM(x.division) SET x.division_id = m.id WHERE x.division_id IS NULL AND x.division IS NOT NULL AND TRIM(x.division) <> '';
UPDATE sale_pricing_rules x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE sale_pricing_rules x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE sale_pricing_rules x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE sale_pricing_rules x LEFT JOIN geo_divisions g ON g.id = x.division_id SET x.division = g.name_en WHERE NOT (x.division <=> g.name_en);
UPDATE sale_pricing_rules x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en);

-- zone_officers
UPDATE zone_officers x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE zone_officers x JOIN (SELECT id, district_id, name_en AS nm FROM geo_upazilas UNION SELECT id, district_id, name_bn FROM geo_upazilas UNION SELECT a.geo_id, u.district_id, a.alias FROM geo_aliases a JOIN geo_upazilas u ON u.id = a.geo_id WHERE a.level = 'upazila') m ON m.nm = TRIM(x.upazila) AND m.district_id = x.district_id SET x.upazila_id = m.id WHERE x.upazila_id IS NULL AND x.district_id IS NOT NULL AND x.upazila IS NOT NULL AND TRIM(x.upazila) <> '';
UPDATE zone_officers x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE zone_officers x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE zone_officers x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en);
UPDATE zone_officers x LEFT JOIN geo_upazilas g ON g.id = x.upazila_id SET x.upazila = g.name_en WHERE NOT (x.upazila <=> g.name_en);

-- orders
UPDATE orders x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE orders x JOIN (SELECT id, district_id, name_en AS nm FROM geo_upazilas UNION SELECT id, district_id, name_bn FROM geo_upazilas UNION SELECT a.geo_id, u.district_id, a.alias FROM geo_aliases a JOIN geo_upazilas u ON u.id = a.geo_id WHERE a.level = 'upazila') m ON m.nm = TRIM(x.upazila) AND m.district_id = x.district_id SET x.upazila_id = m.id WHERE x.upazila_id IS NULL AND x.district_id IS NOT NULL AND x.upazila IS NOT NULL AND TRIM(x.upazila) <> '';
UPDATE orders x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE orders x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE orders x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en);
UPDATE orders x LEFT JOIN geo_upazilas g ON g.id = x.upazila_id SET x.upazila = g.name_en WHERE NOT (x.upazila <=> g.name_en);

-- community_posts
UPDATE community_posts x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE community_posts x JOIN (SELECT id, district_id, name_en AS nm FROM geo_upazilas UNION SELECT id, district_id, name_bn FROM geo_upazilas UNION SELECT a.geo_id, u.district_id, a.alias FROM geo_aliases a JOIN geo_upazilas u ON u.id = a.geo_id WHERE a.level = 'upazila') m ON m.nm = TRIM(x.upazila) AND m.district_id = x.district_id SET x.upazila_id = m.id WHERE x.upazila_id IS NULL AND x.district_id IS NOT NULL AND x.upazila IS NOT NULL AND TRIM(x.upazila) <> '';
UPDATE community_posts x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE community_posts x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE community_posts x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en);
UPDATE community_posts x LEFT JOIN geo_upazilas g ON g.id = x.upazila_id SET x.upazila = g.name_en WHERE NOT (x.upazila <=> g.name_en);

-- market_updates
UPDATE market_updates x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE market_updates x JOIN (SELECT id, district_id, name_en AS nm FROM geo_upazilas UNION SELECT id, district_id, name_bn FROM geo_upazilas UNION SELECT a.geo_id, u.district_id, a.alias FROM geo_aliases a JOIN geo_upazilas u ON u.id = a.geo_id WHERE a.level = 'upazila') m ON m.nm = TRIM(x.upazila) AND m.district_id = x.district_id SET x.upazila_id = m.id WHERE x.upazila_id IS NULL AND x.district_id IS NOT NULL AND x.upazila IS NOT NULL AND TRIM(x.upazila) <> '';
UPDATE market_updates x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE market_updates x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE market_updates x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en);
UPDATE market_updates x LEFT JOIN geo_upazilas g ON g.id = x.upazila_id SET x.upazila = g.name_en WHERE NOT (x.upazila <=> g.name_en);

-- weather_alerts
UPDATE weather_alerts x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE weather_alerts x JOIN (SELECT id, district_id, name_en AS nm FROM geo_upazilas UNION SELECT id, district_id, name_bn FROM geo_upazilas UNION SELECT a.geo_id, u.district_id, a.alias FROM geo_aliases a JOIN geo_upazilas u ON u.id = a.geo_id WHERE a.level = 'upazila') m ON m.nm = TRIM(x.upazila) AND m.district_id = x.district_id SET x.upazila_id = m.id WHERE x.upazila_id IS NULL AND x.district_id IS NOT NULL AND x.upazila IS NOT NULL AND TRIM(x.upazila) <> '';
UPDATE weather_alerts x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE weather_alerts x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE weather_alerts x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en) AND g.id IS NOT NULL;
UPDATE weather_alerts x LEFT JOIN geo_upazilas g ON g.id = x.upazila_id SET x.upazila = g.name_en WHERE NOT (x.upazila <=> g.name_en);

-- admin_users
UPDATE admin_users x JOIN (SELECT id, name_en AS nm FROM geo_districts UNION SELECT id, name_bn FROM geo_districts UNION SELECT geo_id, alias FROM geo_aliases WHERE level = 'district') m ON m.nm = TRIM(x.district) SET x.district_id = m.id WHERE x.district_id IS NULL AND x.district IS NOT NULL AND TRIM(x.district) <> '';
UPDATE admin_users x JOIN (SELECT id, district_id, name_en AS nm FROM geo_upazilas UNION SELECT id, district_id, name_bn FROM geo_upazilas UNION SELECT a.geo_id, u.district_id, a.alias FROM geo_aliases a JOIN geo_upazilas u ON u.id = a.geo_id WHERE a.level = 'upazila') m ON m.nm = TRIM(x.upazila) AND m.district_id = x.district_id SET x.upazila_id = m.id WHERE x.upazila_id IS NULL AND x.district_id IS NOT NULL AND x.upazila IS NOT NULL AND TRIM(x.upazila) <> '';
UPDATE admin_users x JOIN geo_upazilas u ON u.id = x.upazila_id SET x.district_id = u.district_id WHERE x.upazila_id IS NOT NULL;
UPDATE admin_users x JOIN geo_districts d ON d.id = x.district_id SET x.division_id = d.division_id WHERE x.district_id IS NOT NULL;
UPDATE admin_users x LEFT JOIN geo_districts g ON g.id = x.district_id SET x.district = g.name_en WHERE NOT (x.district <=> g.name_en);
UPDATE admin_users x LEFT JOIN geo_upazilas g ON g.id = x.upazila_id SET x.upazila = g.name_en WHERE NOT (x.upazila <=> g.name_en);

-- 5a. Which geographic level each feature is filtered at. Read live by the API,
--     so a change in the admin applies on the next request.
--       upazila | district | division | none | gps (weather: the device's position)
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'geo_scope.sale_listings', 'upazila', 'Sale listings are shown only to farmers in the same area as the seller.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'geo_scope.sale_listings');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'geo_scope.partner_projects', 'upazila', 'Projects appear only to farmers inside the project area (national projects show everywhere).' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'geo_scope.partner_projects');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'geo_scope.loan_applications', 'upazila', 'Loan applications are routed to officers at this level.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'geo_scope.loan_applications');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'geo_scope.zone_officers', 'upazila', 'Farmers are shown field officers covering this level of their area.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'geo_scope.zone_officers');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'geo_scope.orders', 'district', 'Orders are fulfilled and reported at this level.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'geo_scope.orders');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'geo_scope.community_posts', 'district', 'Community feed shows posts from this level of the farmer''s area.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'geo_scope.community_posts');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'geo_scope.market_updates', 'district', 'Market updates are targeted at this level.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'geo_scope.market_updates');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'geo_scope.weather_alerts', 'gps', 'Weather alerts follow the phone''s current position (falls back to the profile district).' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'geo_scope.weather_alerts');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'geo_scope.sale_pricing', 'district', 'Price rules are matched at this level.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'geo_scope.sale_pricing');
INSERT INTO app_settings (setting_key, value_text, description) SELECT 'geo_scope.default', 'district', 'Level used by any location-aware feature without its own setting.' WHERE NOT EXISTS (SELECT 1 FROM (SELECT setting_key FROM app_settings) t WHERE t.setting_key = 'geo_scope.default');

-- 5b. After a farmer's first save, profile edits are requests an admin approves.
--     The farmer's geo only changes on approval — and with it, everything their
--     location unlocks.
CREATE TABLE IF NOT EXISTS profile_change_requests (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  status          ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  requested_json  JSON NOT NULL,
  current_json    JSON NULL,
  reviewer_admin_id BIGINT UNSIGNED NULL,
  reviewer_note   VARCHAR(500) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at     TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_pcr_user_status (user_id, status),
  KEY idx_pcr_status (status, created_at),
  CONSTRAINT fk_pcr_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

