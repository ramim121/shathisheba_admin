import {
  apiCatalog,
  buyOrders,
  buyProducts,
  communityPosts,
  interestCategories,
  learningModules,
  marketUpdates,
  partnerApplications,
  partnerProjects,
  saleListings,
  weatherAlerts
} from "@/lib/data";
import type { ManagementPageProps } from "@/components/ManagementPage";

const defaultFields = [
  { label: "English title", name: "title_en", value: "New app data" },
  { label: "Bangla title", name: "title_bn", value: "নতুন অ্যাপ ডাটা" },
  { label: "Status", name: "status", type: "select" as const, options: ["Active", "Draft", "Pending review", "Inactive"] },
  { label: "Description", name: "description", type: "textarea" as const, value: "Write app-facing description here." }
];

export const pages: Record<string, ManagementPageProps> = {
  interests: {
    title: "Interest, Category & Item Management",
    description: "Create, edit, delete, sort, and localize splash-screen categories and child items such as cattle, crops, fishery, vegetables, and fruits.",
    entityName: "Interest",
    endpoint: "/api/v1/interests",
    columns: [
      { key: "name", label: "Category" },
      { key: "bangla", label: "Bangla" },
      { key: "items", label: "Items" },
      { key: "slug", label: "Slug" }
    ],
    rows: interestCategories.map((item) => ({
      id: item.id,
      name: `${item.icon} ${item.name_en}`,
      bangla: item.name_bn,
      items: item.children.join(", "),
      slug: item.id,
      status: "Active"
    })),
    formFields: [
      { label: "Parent category", name: "parent", type: "select", options: ["None", "Cattle & Poultry", "Crops", "Fishery", "Vegetables", "Fruits"] },
      ...defaultFields,
      { label: "Icon / emoji", name: "emoji", value: "🌾" }
    ]
  },
  weather: {
    title: "Weather & Critical Alert Management",
    description: "Manage local critical weather updates, field advice, push notification eligibility, and location targeting while server weather feeds remain API-driven.",
    entityName: "Weather Alert",
    endpoint: "/api/v1/weather",
    columns: [
      { key: "location", label: "Location" },
      { key: "headline", label: "Headline" },
      { key: "metrics", label: "Metrics" },
      { key: "advice", label: "Bangla Advice" }
    ],
    rows: weatherAlerts.map((item) => ({
      id: item.location,
      location: item.location,
      headline: item.headline,
      metrics: `${item.humidity}% humidity, ${item.wind_kmh} km/h wind, ${item.rain_chance}% rain`,
      advice: item.advice_bn,
      status: item.severity
    })),
    formFields: [
      { label: "District", name: "district", value: "Mymensingh" },
      { label: "Severity", name: "severity", type: "select", options: ["info", "advisory", "watch", "warning", "critical"] },
      { label: "Push notification", name: "push", type: "select", options: ["No", "Yes"] },
      ...defaultFields
    ]
  },
  "market-updates": {
    title: "Homepage Market Updates",
    description: "Create and manage the home-screen update cards for market prices, stock notices, training announcements, and project messages.",
    entityName: "Market Update",
    endpoint: "/api/v1/market-updates",
    columns: [
      { key: "title", label: "Title" },
      { key: "area", label: "Area" },
      { key: "type", label: "Type" }
    ],
    rows: marketUpdates.map((item) => ({
      id: item.title,
      title: item.title,
      area: item.area,
      type: "Homepage card",
      status: item.status
    })),
    formFields: [
      { label: "English title", name: "title_en", value: "New market update" },
      { label: "Bangla title", name: "title_bn", value: "নতুন বাজার আপডেট" },
      { label: "Short summary (English)", name: "body_en", type: "textarea", value: "One-line summary shown on the card." },
      { label: "Short summary (Bangla)", name: "body_bn", type: "textarea", value: "কার্ডে দেখানো এক লাইনের সারাংশ।" },
      { label: "Detail / blog (English)", name: "detail_en", type: "textarea", value: "Full detail content shown when the user opens the update." },
      { label: "Detail / blog (Bangla)", name: "detail_bn", type: "textarea", value: "ব্যবহারকারী আপডেট খুললে যে বিস্তারিত দেখানো হবে।" },
      { label: "Image URL", name: "image_url", value: "" },
      { label: "Category", name: "category", value: "price" },
      { label: "Update type", name: "update_type", type: "select", options: ["price", "stock", "training", "notice", "weather"] },
      { label: "District (blank = all)", name: "district", value: "" },
      { label: "Upazila", name: "upazila", value: "" },
      { label: "Status", name: "status", type: "select", options: ["active", "draft", "archived"] },
      { label: "Sort order", name: "sort_order", value: "0" }
    ]
  },
  sale: {
    title: "Sale Category, Listing & Pricing Management",
    description: "Manage sellable categories, active listings, cattle types, breeds, AI analysis review, field verification, and price breakdown values.",
    entityName: "Sale Listing",
    endpoint: "/api/v1/sale/listings",
    columns: [
      { key: "code", label: "Listing" },
      { key: "farmer", label: "Farmer" },
      { key: "item", label: "Item" },
      { key: "price", label: "Price/Earning" }
    ],
    rows: saleListings.map((item) => ({
      id: item.id,
      code: item.id,
      farmer: item.farmer,
      item: `${item.category} / ${item.item} / ${item.breed}`,
      price: `৳${item.rate}/kg · ৳${item.earning.toLocaleString("en-BD")}`,
      status: item.status
    })),
    formFields: [
      { label: "Listing code", name: "listing_code", value: "SAL-1001" },
      { label: "User id", name: "user_id", value: "1" },
      { label: "Sale item id", name: "sale_item_id", value: "1" },
      { label: "Breed id", name: "breed_id", value: "1" },
      { label: "English title", name: "title_en", value: "Healthy cattle for sale" },
      { label: "Bangla title", name: "title_bn", value: "গরু বিক্রয়" },
      { label: "Age months", name: "age_months", value: "24" },
      { label: "Weight kg", name: "weight_kg", value: "320" },
      { label: "Quantity", name: "quantity", value: "1" },
      { label: "Unit", name: "unit", value: "piece" },
      { label: "Farmer expected price", name: "farmer_expected_price", value: "75000" },
      { label: "Estimated earning", name: "estimated_earning", value: "72000" },
      { label: "Contact phone", name: "contact_phone", value: "01700000000" },
      { label: "Address", name: "address_text", type: "textarea", value: "Village, Upazila, District" },
      { label: "Status", name: "status", type: "select", options: ["draft", "submitted", "field_verification", "active", "sold", "rejected", "cancelled"] }
    ]
  },
  buy: {
    title: "Buy from Shathi Catalogue",
    description: "Create, edit, delete, price, and stock buyable products such as Shadhin Feed, seeds, fertilizer, agri-medicine, tools, and machinery rental.",
    entityName: "Product",
    endpoint: "/api/v1/buy/products",
    columns: [
      { key: "sku", label: "SKU" },
      { key: "name", label: "Product" },
      { key: "category", label: "Category" },
      { key: "stock", label: "Stock & Price" }
    ],
    rows: buyProducts.map((item) => ({
      id: item.sku,
      sku: item.sku,
      name: item.name,
      category: item.category,
      stock: `${item.stock} ${item.unit} · ৳${item.price}`,
      status: item.stock > 50 ? "In stock" : "Low stock"
    })),
    formFields: [
      { label: "Buy category id", name: "buy_category_id", value: "1" },
      { label: "SKU", name: "sku", value: "BUY-FEED-01" },
      { label: "English name", name: "name_en", value: "Shadhin Cattle Feed" },
      { label: "Bangla name", name: "name_bn", value: "স্বাধীন ক্যাটল ফিড" },
      { label: "Unit", name: "unit", value: "sack" },
      { label: "Package size", name: "package_size", value: "25 kg" },
      { label: "Price", name: "price", value: "1800" },
      { label: "Stock quantity", name: "stock_qty", value: "240" },
      { label: "Low stock threshold", name: "low_stock_threshold", value: "10" },
      { label: "Delivery window", name: "delivery_window", value: "2-3 days" },
      { label: "Status", name: "status", type: "select", options: ["draft", "active", "out_of_stock", "inactive"] }
    ]
  },
  orders: {
    title: "Placed Order Management",
    description: "View and update placed orders, payment states, delivery assignment, cancellation, support notes, and fulfillment status.",
    entityName: "Order",
    endpoint: "/api/v1/buy/orders",
    columns: [
      { key: "code", label: "Order" },
      { key: "customer", label: "Customer" },
      { key: "product", label: "Product" },
      { key: "amount", label: "Amount" }
    ],
    rows: buyOrders.map((item) => ({
      id: item.id,
      code: item.id,
      customer: item.customer,
      product: `${item.product} × ${item.qty}`,
      amount: `৳${item.amount.toLocaleString("en-BD")}`,
      status: item.status
    })),
    formFields: [
      { label: "Order code", name: "order_code", value: "ORD-1001" },
      { label: "User id", name: "user_id", value: "1" },
      { label: "Total amount", name: "total_amount", value: "1800" },
      { label: "Delivery fee", name: "delivery_fee", value: "80" },
      { label: "Payable amount", name: "payable_amount", value: "1880" },
      { label: "Payment method", name: "payment_method", type: "select", options: ["cash", "bkash", "nagad", "bank", "credit", "other"] },
      { label: "Payment status", name: "payment_status", type: "select", options: ["pending", "paid", "failed", "refunded"] },
      { label: "Fulfillment status", name: "fulfillment_status", type: "select", options: ["placed", "confirmed", "assigned", "in_transit", "delivered", "cancelled"] },
      { label: "Delivery address", name: "delivery_address", type: "textarea", value: "House, road, village" },
      { label: "Delivery notes", name: "notes", type: "textarea", value: "Field delivery notes" }
    ]
  },
  learning: {
    title: "Learning CMS",
    description: "Create, view, edit, delete, publish, and reorder learning categories, videos, articles, images, descriptions, quizzes, and completion rules.",
    entityName: "Learning Module",
    endpoint: "/api/v1/learning/modules",
    columns: [
      { key: "title", label: "Module" },
      { key: "category", label: "Category" },
      { key: "contents", label: "Contents" },
      { key: "completion", label: "Completion" }
    ],
    rows: learningModules.map((item) => ({
      id: item.title,
      title: item.title,
      category: item.category,
      contents: `${item.contents} · ${item.type}`,
      completion: `${item.completion}%`,
      status: "Published"
    })),
    formFields: [
      { label: "Learning category id", name: "learning_category_id", value: "1" },
      { label: "English title", name: "title_en", value: "Cattle care basics" },
      { label: "Bangla title", name: "title_bn", value: "গরু পালনের মৌলিক বিষয়" },
      { label: "English subtitle", name: "subtitle_en", value: "Short practical module" },
      { label: "Bangla subtitle", name: "subtitle_bn", value: "সংক্ষিপ্ত ব্যবহারিক মডিউল" },
      { label: "Sort order", name: "sort_order", value: "1" },
      { label: "Status", name: "status", type: "select", options: ["draft", "published", "archived"] }
    ]
  },
  partners: {
    title: "Partner Project Management",
    description: "Create and manage contract farming projects, capacity, lender settings, timelines, registration steps, input ledgers, and settlement workflow.",
    entityName: "Project",
    endpoint: "/api/v1/partners/projects",
    columns: [
      { key: "name", label: "Project" },
      { key: "lender", label: "Lender" },
      { key: "enrollment", label: "Enrollment" },
      { key: "progress", label: "Progress" }
    ],
    rows: partnerProjects.map((item) => ({
      id: item.id,
      name: item.name,
      lender: item.lender,
      enrollment: `${item.enrolled}/${item.capacity}`,
      progress: `${item.progress}%`,
      status: item.status
    })),
    formFields: [
      { label: "Project code", name: "project_code", value: "PRJ-1001" },
      { label: "English name", name: "name_en", value: "Cattle Fattening - Eid Batch 2024" },
      { label: "Bangla name", name: "name_bn", value: "গরু মোটাতাজাকরণ প্রকল্প" },
      { label: "Category (interest slug)", name: "interest_slug", type: "select", options: ["livestock-poultry", "crops", "fishery", "vegetables", "fruits", "inputs", "machinery"] },
      { label: "Lender", name: "lender_name", value: "BRAC Bank" },
      { label: "Region based (1) or open to all (0)", name: "region_based", type: "select", options: ["1", "0"] },
      { label: "Division", name: "division", value: "Mymensingh" },
      { label: "District", name: "district", value: "Mymensingh" },
      { label: "Upazila / Thana", name: "upazila", value: "Mymensingh Sadar" },
      { label: "Cover image URL", name: "image_url", value: "" },
      { label: "Short summary (English)", name: "summary_en", type: "textarea", value: "One-line project summary." },
      { label: "Short summary (Bangla)", name: "summary_bn", type: "textarea", value: "প্রকল্পের সংক্ষিপ্ত বিবরণ।" },
      { label: "Market overview (English)", name: "market_overview_en", type: "textarea", value: "Market demand, rate trend, buyer linkage." },
      { label: "Market overview (Bangla)", name: "market_overview_bn", type: "textarea", value: "বাজার চাহিদা, দরের প্রবণতা।" },
      { label: "Investment amount", name: "investment_amount", value: "150000" },
      { label: "Duration / timeframe label", name: "duration_label", value: "6 months" },
      { label: "Start date", name: "start_date", value: "2026-06-01" },
      { label: "End date (auto-inactive after)", name: "end_date", value: "2026-12-31" },
      { label: "Capacity", name: "capacity", value: "50" },
      { label: "Maximum credit amount", name: "max_credit_amount", value: "100000" },
      { label: "Opex — platform fee /kg", name: "platform_fee", value: "50" },
      { label: "Opex — logistics fee /kg", name: "logistics_fee", value: "15" },
      { label: "Opex — warehouse & vet fee /kg", name: "warehouse_vet_fee", value: "15" },
      { label: "Active", name: "is_active", type: "select", options: ["1", "0"] },
      { label: "Status", name: "status", type: "select", options: ["draft", "open", "opening_soon", "closed", "completed"] },
      { label: "Registration steps JSON", name: "steps_json", type: "textarea", value: "{\"steps\":[\"Project selection\",\"KYC\",\"Banking info\",\"Field verification\",\"Approval\"]}" }
    ]
  },
  kyc: {
    title: "KYC, Verification & Approval Queue",
    description: "Review registered users, project enrollment, NID data, land, livestock count, banking info, due diligence, and final approval steps.",
    entityName: "KYC Application",
    endpoint: "/api/v1/partners/applications",
    columns: [
      { key: "code", label: "Application" },
      { key: "name", label: "Applicant" },
      { key: "project", label: "Project" },
      { key: "step", label: "Step" }
    ],
    rows: partnerApplications.map((item) => ({
      id: item.id,
      code: item.id,
      name: `${item.name} · ${item.nid}`,
      project: item.project,
      step: item.step,
      status: item.status
    })),
    formFields: [
      { label: "Application code", name: "application_code", value: "KYC-1001" },
      { label: "User id", name: "user_id", value: "1" },
      { label: "Partner project id", name: "partner_project_id", value: "1" },
      { label: "Current step", name: "current_step", type: "select", options: ["project_selection", "personal_kyc", "banking_info", "farm_assessment", "field_verification", "approval", "rejected"] },
      { label: "Full name per NID", name: "full_name_per_nid", value: "Md. Rahim" },
      { label: "NID number", name: "nid_number", value: "1234567890" },
      { label: "Total land decimals", name: "total_land_decimals", value: "120" },
      { label: "Livestock count", name: "livestock_count", value: "4" },
      { label: "Income source", name: "primary_income_source", value: "Livestock" },
      { label: "Annual household income", name: "annual_household_income", value: "360000" },
      { label: "Mobile banking provider", name: "mobile_banking_provider", value: "bkash" },
      { label: "Verification status", name: "status", type: "select", options: ["draft", "submitted", "needs_document", "officer_verification", "ready_to_approve", "approved", "rejected"] },
      { label: "Assigned officer id", name: "assigned_officer_id", value: "1" },
      { label: "Verification notes", name: "verification_notes", type: "textarea", value: "Check NID, land, banking, and farm assessment." }
    ]
  },
  community: {
    title: "Community Moderation",
    description: "Manage community posts, comments, reports, officer contacts, scopes, tags, user visibility, and response state.",
    entityName: "Community Post",
    endpoint: "/api/v1/community/posts",
    columns: [
      { key: "author", label: "Author" },
      { key: "scope", label: "Scope" },
      { key: "type", label: "Type" },
      { key: "body", label: "Post" }
    ],
    rows: communityPosts.map((item) => ({
      id: item.id,
      author: item.author,
      scope: item.scope,
      type: `${item.type} · ${item.reports} reports`,
      body: item.body,
      status: item.status
    })),
    formFields: [
      { label: "User id", name: "user_id", value: "1" },
      { label: "Scope", name: "scope", type: "select", options: ["upazila", "district", "bangladesh"] },
      { label: "Post type", name: "post_type", type: "select", options: ["general", "question", "livestock", "crop", "complaint", "notice"] },
      { label: "Post body", name: "body", type: "textarea", value: "Write community post" },
      { label: "Image URL", name: "image_url", value: "" },
      { label: "Official Shathi Sheba post (highlighted)", name: "is_official", type: "select", options: ["0", "1"] },
      { label: "District", name: "district", value: "Mymensingh" },
      { label: "Upazila", name: "upazila", value: "Mymensingh Sadar" },
      { label: "Moderation status", name: "status", type: "select", options: ["visible", "answered", "hidden", "moderation", "removed"] },
      { label: "Report count", name: "report_count", value: "0" }
    ]
  },
  users: {
    title: "Registered User Management",
    description: "View, search, edit, deactivate, and inspect farmers/users who consume app data and submit listings, orders, KYC, and community posts.",
    entityName: "User",
    endpoint: "/api/v1/users",
    columns: [
      { key: "name", label: "User" },
      { key: "phone", label: "Phone" },
      { key: "location", label: "Location" },
      { key: "roles", label: "Roles" }
    ],
    rows: [
      { id: "USR-1", name: "Md. Rahim", phone: "01712-345678", location: "Mymensingh Sadar", roles: "shathisheba_buyer", status: "Active" },
      { id: "USR-2", name: "Fatema Khatun", phone: "01812-222333", location: "Mymensingh", roles: "shathisheba_buyer, shathisheba_seller", status: "Active" },
      { id: "USR-3", name: "Sadia Khatun", phone: "01933-555888", location: "Dhaka", roles: "field_officer", status: "Active" }
    ],
    formFields: [
      { label: "Full name", name: "full_name", value: "Md. Rahim" },
      { label: "Display name", name: "display_name", value: "Rahim" },
      { label: "Phone", name: "phone", value: "01712-345678" },
      { label: "Email", name: "email", value: "rahim@example.com" },
      { label: "District", name: "district", value: "Mymensingh" },
      { label: "Upazila", name: "upazila", value: "Mymensingh Sadar" },
      { label: "Status", name: "status", type: "select", options: ["active", "pending", "suspended"] }
    ]
  },
  reports: {
    title: "Reports & Exports",
    description: "Operational reporting for MIS: listing value, order fulfillment, learning completion, partner progress, approvals, and community moderation.",
    entityName: "Report",
    endpoint: "/api/v1/reports",
    columns: [
      { key: "name", label: "Report" },
      { key: "scope", label: "Scope" },
      { key: "frequency", label: "Frequency" },
      { key: "owner", label: "Owner" }
    ],
    rows: [
      { id: "REP-1", name: "Marketplace performance", scope: "All districts", frequency: "Daily", owner: "Marketplace manager", status: "Active" },
      { id: "REP-2", name: "KYC approval queue", scope: "Project wise", frequency: "Hourly", owner: "HQ admin", status: "Active" },
      { id: "REP-3", name: "Learning completion", scope: "Module wise", frequency: "Weekly", owner: "Content editor", status: "Draft" }
    ],
    formFields: defaultFields
  },
  faq: {
    title: "FAQ & Help Management",
    description: "Create, edit, and order the Help & FAQ entries shown in the app Profile > Help section (SRS FR-PROF-04), in Bangla and English.",
    entityName: "FAQ",
    endpoint: "/api/v1/faq",
    columns: [
      { key: "category", label: "Category" },
      { key: "question", label: "Question" },
      { key: "bangla", label: "Bangla" }
    ],
    rows: [],
    formFields: [
      { label: "Category", name: "category", value: "general" },
      { label: "Question (English)", name: "question_en", value: "How does it work?" },
      { label: "Question (Bangla)", name: "question_bn", value: "এটি কীভাবে কাজ করে?" },
      { label: "Answer (English)", name: "answer_en", type: "textarea", value: "Write the answer here." },
      { label: "Answer (Bangla)", name: "answer_bn", type: "textarea", value: "এখানে উত্তর লিখুন।" },
      { label: "Sort order", name: "sort_order", value: "0" },
      { label: "Active", name: "is_active", type: "select", options: ["1", "0"] }
    ]
  },
  assistant: {
    title: "Ask Shathi Apa (AI Assistant)",
    description: "Manage the home-screen AI assistant card text and the quick-prompt chips farmers can tap to ask about price, weather, disease, or projects.",
    entityName: "Assistant Prompt",
    endpoint: "/api/v1/assistant/prompts",
    columns: [
      { key: "type", label: "Type" },
      { key: "title", label: "Title" },
      { key: "bangla", label: "Bangla" }
    ],
    rows: [],
    formFields: [
      { label: "Prompt type", name: "prompt_type", type: "select", options: ["config", "quick_prompt"] },
      { label: "Title (English)", name: "title_en", value: "Ask Shathi Apa" },
      { label: "Title (Bangla)", name: "title_bn", value: "শাথী আপাকে জিজ্ঞাসা করুন" },
      { label: "Body (English)", name: "body_en", type: "textarea", value: "Get fast answers on price, weather, disease, or projects." },
      { label: "Body (Bangla)", name: "body_bn", type: "textarea", value: "দাম, আবহাওয়া, রোগ বা প্রকল্প সম্পর্কে দ্রুত উত্তর পান।" },
      { label: "Sort order", name: "sort_order", value: "0" },
      { label: "Active", name: "is_active", type: "select", options: ["1", "0"] }
    ]
  },
  settings: {
    title: "App Settings & Admin Roles",
    description: "Configure admin roles, app shell labels, notification defaults, API visibility, audit rules, and system-level feature flags.",
    entityName: "Setting",
    endpoint: "/api/v1/settings",
    columns: [
      { key: "key", label: "Key" },
      { key: "value", label: "Value" },
      { key: "owner", label: "Owner" }
    ],
    rows: [
      { id: "SET-1", key: "weather_push_enabled", value: "true", owner: "HQ admin", status: "Active" },
      { id: "SET-2", key: "sale_ai_prefill", value: "enabled", owner: "Marketplace manager", status: "Active" },
      { id: "SET-3", key: "community_auto_moderation", value: "review", owner: "Auditor", status: "Draft" }
    ],
    formFields: defaultFields
  }
};

export const nestedPages: Record<string, ManagementPageProps> = {
  "sale/categories": {
    title: "Sale Category Setup",
    description: "Manage the sellable category cards shown before users list products for sale.",
    entityName: "Sale Category",
    endpoint: "/api/v1/sale/categories",
    columns: [
      { key: "name_en", label: "Category" },
      { key: "slug", label: "Slug" },
      { key: "name_bn", label: "Bangla" },
      { key: "preference", label: "In preferences?" }
    ],
    rows: [],
    formFields: [
      { label: "Slug", name: "slug", value: "livestock" },
      { label: "English name", name: "name_en", value: "Cattle & Poultry" },
      { label: "Bangla name", name: "name_bn", value: "গবাদি পশু ও পোল্ট্রি" },
      { label: "Emoji / icon", name: "emoji", value: "🐄" },
      { label: "Interest slug (links to login preference root)", name: "interest_slug", value: "livestock-poultry" },
      { label: "Show in login preference selection", name: "pref_selectable", type: "select", options: ["1", "0"] },
      { label: "Description", name: "description_en", type: "textarea", value: "Cattle, buffalo, goat, sheep and poultry" },
      { label: "Sort order", name: "sort_order", value: "1" },
      { label: "Status", name: "is_active", type: "select", options: ["1", "0"] }
    ]
  },
  "sale/animals": {
    title: "Animal Master",
    description: "Manage the Animal Type dropdown for the livestock listing form (Cow, Bull, Buffalo, Poultry, Goat, Sheep). Species links each animal to its breed set.",
    entityName: "Animal",
    endpoint: "/api/v1/sale/animals",
    columns: [
      { key: "name", label: "Animal" },
      { key: "slug", label: "Slug" },
      { key: "species", label: "Species (breed group)" },
      { key: "bangla", label: "Bangla" }
    ],
    rows: [],
    formFields: [
      { label: "Slug", name: "slug", value: "cow" },
      { label: "English name", name: "name_en", value: "Cow" },
      { label: "Bangla name", name: "name_bn", value: "গাভী" },
      { label: "Species (matches breed animal_type)", name: "species", type: "select", options: ["cattle", "buffalo", "goat", "sheep", "poultry"] },
      { label: "Emoji", name: "emoji", value: "🐄" },
      { label: "Sale category id", name: "sale_category_id", value: "2" },
      { label: "Sort order", name: "sort_order", value: "1" },
      { label: "Active", name: "is_active", type: "select", options: ["1", "0"] }
    ]
  },
  "geo/divisions": {
    title: "Geo — Divisions",
    description: "Official Bangladesh divisions used by the address Division dropdown and project/pricing region targeting.",
    entityName: "Division",
    endpoint: "/api/v1/geo/divisions",
    columns: [
      { key: "name", label: "Division" },
      { key: "bangla", label: "Bangla" },
      { key: "sort_order", label: "Order" }
    ],
    rows: [],
    formFields: [
      { label: "English name", name: "name_en", value: "Mymensingh" },
      { label: "Bangla name", name: "name_bn", value: "ময়মনসিংহ" },
      { label: "Sort order", name: "sort_order", value: "0" }
    ]
  },
  "geo/districts": {
    title: "Geo — Districts",
    description: "Official Bangladesh districts used by the address District dropdown and region targeting.",
    entityName: "District",
    endpoint: "/api/v1/geo/districts",
    columns: [
      { key: "name", label: "District" },
      { key: "bangla", label: "Bangla" },
      { key: "division", label: "Division" }
    ],
    rows: [],
    formFields: [
      { label: "Division id", name: "division_id", value: "1" },
      { label: "English name", name: "name_en", value: "Mymensingh" },
      { label: "Bangla name", name: "name_bn", value: "ময়মনসিংহ" }
    ]
  },
  "geo/upazilas": {
    title: "Geo — Upazilas / Thanas",
    description: "Official Bangladesh upazilas (thanas) used by the address Thana dropdown and region targeting.",
    entityName: "Upazila",
    endpoint: "/api/v1/geo/upazilas",
    columns: [
      { key: "name", label: "Upazila / Thana" },
      { key: "bangla", label: "Bangla" },
      { key: "district", label: "District" }
    ],
    rows: [],
    formFields: [
      { label: "District id", name: "district_id", value: "1" },
      { label: "English name", name: "name_en", value: "Mymensingh Sadar" },
      { label: "Bangla name", name: "name_bn", value: "ময়মনসিংহ সদর" }
    ]
  },
  "sale/items": {
    title: "Sale Item Setup",
    description: "Manage item types under sale categories such as cattle, rice, tomato, inputs, and machinery rental.",
    entityName: "Sale Item",
    endpoint: "/api/v1/sale/items",
    columns: [
      { key: "slug", label: "Slug" },
      { key: "name", label: "Item" },
      { key: "category", label: "Category" },
      { key: "bangla", label: "Bangla" }
    ],
    rows: [],
    formFields: [
      { label: "Sale category id", name: "sale_category_id", value: "2" },
      { label: "Slug", name: "slug", value: "cattle" },
      { label: "English name", name: "name_en", value: "Cattle" },
      { label: "Bangla name", name: "name_bn", value: "গরু" },
      { label: "Status", name: "status", type: "select", options: ["active", "soon", "inactive"] }
    ]
  },
  "sale/breeds": {
    title: "Animal Breed Setup",
    description: "Manage animal types and breeds used by the cattle sale flow and AI-filled listing form.",
    entityName: "Breed",
    endpoint: "/api/v1/sale/breeds",
    columns: [
      { key: "animal_type", label: "Animal Type" },
      { key: "name", label: "Breed" },
      { key: "bangla", label: "Bangla" }
    ],
    rows: [],
    formFields: [
      { label: "Animal type (species)", name: "animal_type", type: "select", options: ["cattle", "buffalo", "goat", "sheep", "poultry"] },
      { label: "English name", name: "name_en", value: "Cross Friesian" },
      { label: "Bangla name", name: "name_bn", value: "ক্রস ফ্রিজিয়ান" },
      { label: "Active", name: "is_active", type: "select", options: ["1", "0"] }
    ]
  },
  "sale/pricing": {
    title: "Sale Pricing Rules (B2B presets)",
    description: "Manage the forward-linkage B2B preset by animal, breed and region: B2B rate, farmer rate, platform fee, logistics, and warehouse/vet care (DigiGram Opex & Margin).",
    entityName: "Pricing Rule",
    endpoint: "/api/v1/sale/pricing",
    columns: [
      { key: "item", label: "Item" },
      { key: "district", label: "District" },
      { key: "rates", label: "Rates" },
      { key: "fees", label: "Fees" }
    ],
    rows: [],
    formFields: [
      { label: "Sale item id", name: "sale_item_id", value: "1" },
      { label: "Partner project id (optional)", name: "partner_project_id", value: "" },
      { label: "Animal id (blank = any)", name: "animal_id", value: "1" },
      { label: "Breed id (blank = any)", name: "breed_id", value: "" },
      { label: "Division (blank = any)", name: "division", value: "Mymensingh" },
      { label: "District (blank = any)", name: "district", value: "Mymensingh" },
      { label: "Effective from", name: "effective_from", value: "2026-06-01" },
      { label: "B2B market rate", name: "b2b_market_rate", value: "750" },
      { label: "Farmer rate", name: "farmer_rate", value: "670" },
      { label: "Platform fee", name: "platform_fee", value: "50" },
      { label: "Logistics fee", name: "logistics_fee", value: "15" },
      { label: "Warehouse and vet fee", name: "warehouse_vet_fee", value: "15" },
      { label: "Unit", name: "unit", value: "kg" }
    ]
  },
  "buy/categories": {
    title: "Buy Category Setup",
    description: "Manage Buy from Shathi category cards such as Shadhin Feed, seeds, fertilizer, tools, and machinery rental.",
    entityName: "Buy Category",
    endpoint: "/api/v1/buy/categories",
    columns: [
      { key: "slug", label: "Slug" },
      { key: "name_en", label: "Name" },
      { key: "name_bn", label: "Bangla" }
    ],
    rows: [],
    formFields: [
      { label: "Slug", name: "slug", value: "seeds" },
      { label: "English name", name: "name_en", value: "Seeds" },
      { label: "Bangla name", name: "name_bn", value: "বীজ" },
      { label: "Description", name: "description_en", type: "textarea", value: "Certified varieties" },
      { label: "Active", name: "is_active", type: "select", options: ["1", "0"] }
    ]
  },
  "buy/products": {
    title: "Product Setup",
    description: "Manage buyable product records, inventory, unit price, package size, and delivery window.",
    entityName: "Product",
    endpoint: "/api/v1/buy/products",
    columns: [
      { key: "sku", label: "SKU" },
      { key: "name", label: "Product" },
      { key: "category", label: "Category" },
      { key: "stock", label: "Stock & Price" }
    ],
    rows: [],
    formFields: [
      { label: "Buy category id", name: "buy_category_id", value: "1" },
      { label: "SKU", name: "sku", value: "BUY-FEED-01" },
      { label: "English name", name: "name_en", value: "Shadhin Cattle Feed" },
      { label: "Unit", name: "unit", value: "sack" },
      { label: "Price", name: "price", value: "1800" },
      { label: "Stock quantity", name: "stock_qty", value: "240" },
      { label: "Status", name: "status", type: "select", options: ["draft", "active", "out_of_stock", "inactive"] }
    ]
  },
  "orders/payments": {
    title: "Payment Management",
    description: "Review and update payment method, payment status, and payment notes for placed orders.",
    entityName: "Payment",
    endpoint: "/api/v1/orders/payments",
    columns: [
      { key: "code", label: "Order" },
      { key: "customer", label: "Customer" },
      { key: "method", label: "Method" },
      { key: "amount", label: "Amount" }
    ],
    rows: [],
    formFields: [
      { label: "Payment method", name: "payment_method", type: "select", options: ["cash", "bkash", "nagad", "bank", "credit", "other"] },
      { label: "Payment status", name: "payment_status", type: "select", options: ["pending", "paid", "failed", "refunded"] },
      { label: "Notes", name: "notes", type: "textarea", value: "Payment verification note" }
    ]
  },
  "sale/confirmations": {
    title: "Payment Confirmations (OTP)",
    description: "Audit OTP-based field payment confirmations for cattle/produce sales (SRS FR-LIST-12, NFR-SEC-04). Read-mostly; statuses update from the app field-ops flow.",
    entityName: "Confirmation",
    endpoint: "/api/v1/sale/confirmations",
    columns: [
      { key: "listing", label: "Listing" },
      { key: "weight", label: "Actual Weight" },
      { key: "amount", label: "Final Amount" }
    ],
    rows: [],
    formFields: [
      { label: "Sale listing id", name: "sale_listing_id", value: "1" },
      { label: "Actual weight (kg)", name: "actual_weight_kg", value: "210" },
      { label: "Final amount", name: "final_amount", value: "140700" },
      { label: "Status", name: "status", type: "select", options: ["pending", "confirmed", "expired", "cancelled"] }
    ]
  },
  "community/officers": {
    title: "Zone Officer Directory",
    description: "Manage the Field Officer and HO Query Officer cards shown per zone on the Community screen (SRS FR-COM-03/04).",
    entityName: "Officer",
    endpoint: "/api/v1/community/officers",
    columns: [
      { key: "name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "zone", label: "Zone" },
      { key: "phone", label: "Phone" }
    ],
    rows: [],
    formFields: [
      { label: "Officer role", name: "officer_role", type: "select", options: ["field_officer", "ho_query_officer"] },
      { label: "Name", name: "name", value: "Rana Hossain" },
      { label: "Phone", name: "phone", value: "01700000002" },
      { label: "District", name: "district", value: "Mymensingh" },
      { label: "Upazila", name: "upazila", value: "Mymensingh Sadar" },
      { label: "Active", name: "is_active", type: "select", options: ["1", "0"] }
    ]
  },
  "app/user-roles": {
    title: "App User Roles",
    description: "Assign or remove app roles for registered users. Default is buyer. Add shathisheba_seller to let a partner list items for sale, or field_officer for full access.",
    entityName: "User Role",
    endpoint: "/api/v1/app/user-roles",
    columns: [
      { key: "user", label: "User" },
      { key: "phone", label: "Phone" },
      { key: "role", label: "Role" }
    ],
    rows: [],
    formFields: [
      { label: "App user id", name: "user_id", value: "1" },
      { label: "Role", name: "role", type: "select", options: ["shathisheba_buyer", "shathisheba_seller", "field_officer"] }
    ]
  },
  "app/user-banking": {
    title: "User Banking Information",
    description: "Banking and mobile-money details submitted by app users from the Menu > Banking Details screen.",
    entityName: "Banking Record",
    endpoint: "/api/v1/app/user-banking",
    columns: [
      { key: "user", label: "User" },
      { key: "bank_name", label: "Bank" },
      { key: "account_number", label: "Account" },
      { key: "mobile_provider", label: "MFS" }
    ],
    rows: [],
    formFields: [
      { label: "App user id", name: "user_id", value: "1" },
      { label: "Bank name", name: "bank_name", value: "" },
      { label: "Branch", name: "branch_name", value: "" },
      { label: "Account name", name: "account_name", value: "" },
      { label: "Account number", name: "account_number", value: "" },
      { label: "Mobile provider", name: "mobile_provider", type: "select", options: ["", "bkash", "nagad", "rocket", "upay", "other"] },
      { label: "Mobile account", name: "mobile_account", value: "" }
    ]
  },
  "app/user-farm": {
    title: "User Farm Information",
    description: "Farm/production details submitted by app users from the Menu > Farm Info screen.",
    entityName: "Farm Record",
    endpoint: "/api/v1/app/user-farm",
    columns: [
      { key: "user", label: "User" },
      { key: "total_land_decimals", label: "Land (dec)" },
      { key: "primary_focus", label: "Focus" },
      { key: "livestock_count", label: "Livestock" }
    ],
    rows: [],
    formFields: [
      { label: "App user id", name: "user_id", value: "1" },
      { label: "Total land (decimals)", name: "total_land_decimals", value: "0" },
      { label: "Primary focus", name: "primary_focus", value: "" },
      { label: "Crop types", name: "crop_types", value: "" },
      { label: "Livestock count", name: "livestock_count", value: "0" },
      { label: "Pond count", name: "pond_count", value: "0" },
      { label: "Farm address", name: "farm_address", type: "textarea", value: "" }
    ]
  },
  "app/user-kyc": {
    title: "User KYC Documents",
    description: "KYC document images uploaded by app users from the Menu > KYC Documents screen. Verify or reject here.",
    entityName: "KYC Document",
    endpoint: "/api/v1/app/user-kyc",
    columns: [
      { key: "user", label: "User" },
      { key: "doc_type", label: "Type" },
      { key: "document_url", label: "Document" },
      { key: "status", label: "Status" }
    ],
    rows: [],
    formFields: [
      { label: "App user id", name: "user_id", value: "1" },
      { label: "Document type", name: "doc_type", type: "select", options: ["nid_front", "nid_back", "selfie", "trade_license", "passbook", "other"] },
      { label: "Document URL", name: "document_url", value: "" },
      { label: "Status", name: "status", type: "select", options: ["pending", "verified", "rejected"] },
      { label: "Note", name: "note", value: "" }
    ]
  },
  "community/reports": {
    title: "Community Reports",
    description: "Moderate reported community posts and update their visibility or review status.",
    entityName: "Reported Post",
    endpoint: "/api/v1/community/reports",
    columns: [
      { key: "author", label: "Author" },
      { key: "scope", label: "Scope" },
      { key: "type", label: "Type" },
      { key: "reports", label: "Reports" }
    ],
    rows: [],
    formFields: [
      { label: "Status", name: "status", type: "select", options: ["visible", "answered", "hidden", "moderation", "removed"] },
      { label: "Moderated by admin id", name: "moderated_by", value: "1" },
      { label: "Report count", name: "report_count", value: "0" }
    ]
  }
};

export const allManagementPages: Record<string, ManagementPageProps> = {
  ...pages,
  ...nestedPages,
  "sale/listings": pages.sale,
  "buy/orders": pages.orders,
  "learning/modules": pages.learning,
  "partners/projects": pages.partners,
  "partners/applications": pages.kyc,
  "community/posts": pages.community,
  "assistant/prompts": pages.assistant
};
