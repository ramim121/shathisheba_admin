import {
  BadgeCheck,
  BellRing,
  BookOpen,
  Boxes,
  CloudSun,
  FileCheck2,
  GraduationCap,
  HandCoins,
  LayoutDashboard,
  LineChart,
  MessageSquareText,
  PackageCheck,
  PanelLeft,
  ScrollText,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Store,
  UsersRound,
  Wheat
} from "lucide-react";

export const navGroups = [
  {
    title: "MIS",
    items: [
      { label: "Dashboard", href: "#dashboard", icon: LayoutDashboard },
      { label: "Reports", href: "#reports", icon: LineChart },
      { label: "API Viewer", href: "#api", icon: ScrollText }
    ]
  },
  {
    title: "App Data",
    items: [
      { label: "Interest Setup", href: "#interests", icon: Settings2 },
      { label: "Weather & Alerts", href: "#weather", icon: CloudSun },
      { label: "Sale Listings", href: "#sale", icon: Store },
      { label: "Buy & Orders", href: "#buy", icon: ShoppingCart },
      { label: "Learning", href: "#learning", icon: GraduationCap },
      { label: "Partners", href: "#partners", icon: HandCoins },
      { label: "Community", href: "#community", icon: MessageSquareText }
    ]
  }
];

export const metrics = [
  { label: "Registered farmers", value: "18,420", trend: "+11.8% this month" },
  { label: "Active sale listings", value: "1,284", trend: "৳4.7Cr listed value" },
  { label: "Pending approvals", value: "73", trend: "KYC, listings, projects" },
  { label: "Buy orders", value: "2,948", trend: "92% delivered on time" }
];

export const interestCategories = [
  {
    id: "livestock-poultry",
    name_en: "Cattle & Poultry",
    name_bn: "গবাদি পশু ও পোল্ট্রি",
    icon: "🐄",
    children: ["Cow", "Goat", "Chicken", "Duck"]
  },
  {
    id: "crops",
    name_en: "Crops",
    name_bn: "ফসল",
    icon: "🌾",
    children: ["Rice", "Corn", "Wheat", "Garlic", "Onion", "Mustard", "Turmeric", "Chili"]
  },
  {
    id: "fishery",
    name_en: "Fishery",
    name_bn: "মৎস্য",
    icon: "🐟",
    children: ["Rohu", "Catla", "Hilsa", "Pangas", "Tilapia", "Prawn"]
  },
  {
    id: "vegetables",
    name_en: "Vegetables",
    name_bn: "সবজি",
    icon: "🥬",
    children: ["Bottle Gourd", "Tomato", "Potato", "Okra", "Eggplant", "Pumpkin", "Leafy Greens"]
  },
  {
    id: "fruits",
    name_en: "Fruits",
    name_bn: "ফল",
    icon: "🥭",
    children: ["Mango", "Banana", "Papaya", "Lychee", "Jackfruit", "Watermelon", "Guava", "Lemon"]
  }
];

export const marketUpdates = [
  { title: "Cattle rate: ৳670/kg", area: "Mymensingh Sadar", status: "Active" },
  { title: "Shadhin Feed back in stock", area: "Mymensingh", status: "New" },
  { title: "New video: Cattle disease prevention", area: "Training Modules", status: "Published" }
];

export const weatherAlerts = [
  {
    location: "Mymensingh Sadar",
    headline: "Warm today, humidity is high",
    severity: "advisory",
    humidity: 40,
    wind_kmh: 12,
    rain_chance: 65,
    advice_bn: "দুপুরে পরিষ্কার পানি দিন। ভেজা খাবার সংরক্ষণ করবেন না।"
  },
  {
    location: "Coastal belt",
    headline: "Maritime port signal monitoring",
    severity: "watch",
    humidity: 76,
    wind_kmh: 26,
    rain_chance: 70,
    advice_bn: "স্থানীয় সতর্কতা দেখুন এবং জলাশয়ের পাড় পরীক্ষা করুন।"
  }
];

export const saleListings = [
  {
    id: "SAL-24018",
    farmer: "Md. Rahim",
    category: "Livestock",
    item: "Cattle",
    breed: "Cross Friesian",
    weight_kg: 210,
    rate: 670,
    earning: 140700,
    status: "Field verification"
  },
  {
    id: "SAL-24022",
    farmer: "Fatema Khatun",
    category: "Crops",
    item: "Rice",
    breed: "BRRI 87",
    weight_kg: 480,
    rate: 52,
    earning: 24960,
    status: "Active"
  },
  {
    id: "SAL-24031",
    farmer: "Rana Hossain",
    category: "Machinery",
    item: "Tractor lease",
    breed: "Hourly rental",
    weight_kg: 0,
    rate: 1200,
    earning: 1200,
    status: "Needs review"
  }
];

export const priceBreakdown = [
  { item: "B2B market rate", per_kg: 750, total: 157500 },
  { item: "Nirdharito Bikroy Mullo", per_kg: 670, total: 140700 },
  { item: "Platform fee", per_kg: 50, total: 10500 },
  { item: "Logistics & transport", per_kg: 15, total: 3150 },
  { item: "Warehouse & vet care", per_kg: 15, total: 3150 }
];

export const buyProducts = [
  { sku: "BUY-FEED-01", name: "Shadhin Cattle Feed", category: "Shadhin Feed", price: 1800, unit: "sack", stock: 240 },
  { sku: "BUY-FEED-02", name: "Shadhin Fish Feed", category: "Shadhin Feed", price: 1250, unit: "sack", stock: 118 },
  { sku: "BUY-SEED-87", name: "BRRI Rice 87 seed", category: "Seeds", price: 320, unit: "sack", stock: 460 },
  { sku: "BUY-TOOL-03", name: "Hand sprayer", category: "Tools", price: 950, unit: "piece", stock: 34 }
];

export const buyOrders = [
  { id: "ORD-1039", customer: "Md. Rahim", product: "Shadhin Cattle Feed", qty: 5, amount: 9000, status: "Delivery assigned" },
  { id: "ORD-1042", customer: "Aklima Begum", product: "BRRI Rice 87 seed", qty: 8, amount: 2560, status: "Paid" },
  { id: "ORD-1048", customer: "Rasel Mia", product: "Hand sprayer", qty: 1, amount: 950, status: "Pending payment" }
];

export const learningModules = [
  { title: "Cattle health management", category: "Livestock", contents: 12, type: "Article + Video + Quiz", completion: 68 },
  { title: "Modern rice farming", category: "Agriculture", contents: 8, type: "Video series", completion: 51 },
  { title: "Climate-resilient farming", category: "Climate", contents: 6, type: "Article + Video", completion: 38 },
  { title: "Women in agriculture", category: "Women", contents: 5, type: "Article + Quiz", completion: 44 }
];

export const partnerProjects = [
  {
    id: "PRJ-2024-EID",
    name: "Cattle Fattening - Eid Batch 2024",
    lender: "BRAC Bank",
    district: "Mymensingh",
    enrolled: 38,
    capacity: 50,
    status: "Open",
    progress: 65
  },
  {
    id: "PRJ-2025-BORO",
    name: "Boro Rice Contract - Winter 2025",
    lender: "Green Delta MFI",
    district: "Rangpur",
    enrolled: 0,
    capacity: 80,
    status: "Opening soon",
    progress: 0
  }
];

export const partnerApplications = [
  { id: "KYC-8801", name: "Md. Rahim", nid: "19901234567890123", project: "Cattle Fattening", step: "Farm assessment", status: "Officer verification" },
  { id: "KYC-8804", name: "Fatema Khatun", nid: "19887654321098765", project: "Boro Rice Contract", step: "Banking info", status: "Needs document" },
  { id: "KYC-8811", name: "Sadia Khatun", nid: "20001239876543210", project: "Cattle Fattening", step: "Final approval", status: "Ready to approve" }
];

export const communityPosts = [
  { id: "COM-3001", author: "Md. Rahim", scope: "My Upazila", type: "Livestock", body: "My cattle reached 200kg, listed on Shathi Sheba. Very easy!", reports: 0, status: "Visible" },
  { id: "COM-3002", author: "Fatema Khatun", scope: "District", type: "Question", body: "When should I apply fertilizer for rice?", reports: 1, status: "Answered" },
  { id: "COM-3010", author: "Anonymous", scope: "Bangladesh", type: "Complaint", body: "Delivery delayed for feed order.", reports: 3, status: "Moderation" }
];

export const apiCatalog = [
  { method: "GET", path: "/api/v1/interests", desc: "Splash onboarding categories and nested items" },
  { method: "GET", path: "/api/v1/weather?district=Mymensingh", desc: "Weather server summary plus local critical alerts" },
  { method: "GET", path: "/api/v1/sale/categories", desc: "Sellable categories, active flags, animal types, breeds" },
  { method: "GET", path: "/api/v1/sale/listings", desc: "Active sale listings and verification statuses" },
  { method: "POST", path: "/api/v1/sale/listings", desc: "Create listing from mobile app photo/form payload" },
  { method: "GET", path: "/api/v1/buy/products", desc: "Buy from Shathi categories, products, stock, prices" },
  { method: "POST", path: "/api/v1/buy/orders", desc: "Place product order with payment and delivery data" },
  { method: "GET", path: "/api/v1/learning/modules", desc: "Learning categories, lessons, article/video metadata" },
  { method: "GET", path: "/api/v1/partners/projects", desc: "Partner projects, registration steps, capacity" },
  { method: "PATCH", path: "/api/v1/partners/applications", desc: "KYC approval, due diligence, officer verification" },
  { method: "GET", path: "/api/v1/community/posts", desc: "Community feed with scope, tags, moderation status" }
];

export const reportData = [
  { month: "Jan", listings: 220, orders: 410, partners: 42 },
  { month: "Feb", listings: 260, orders: 480, partners: 51 },
  { month: "Mar", listings: 315, orders: 560, partners: 64 },
  { month: "Apr", listings: 372, orders: 690, partners: 79 },
  { month: "May", listings: 448, orders: 760, partners: 93 }
];

export const setupCards = [
  { title: "Onboarding Interest Tree", icon: Boxes, copy: "Manage root categories, grouped child items, icons, sort order, step count, and Bangla/English labels." },
  { title: "Weather Alert Control", icon: BellRing, copy: "Pull live weather by location, override with critical local messages, and send push notifications." },
  { title: "Sale Pricing Engine", icon: Store, copy: "Configure B2B rates, platform fees, logistics, vet care, breeds, animal types, and active listing status." },
  { title: "Buy Catalogue", icon: PackageCheck, copy: "Create purchasable categories, products, stock, delivery windows, and order fulfillment stages." },
  { title: "Learning CMS", icon: BookOpen, copy: "Publish articles, videos, thumbnails, quizzes, categories, completion rules, and featured modules." },
  { title: "Partner Verification", icon: ShieldCheck, copy: "Review KYC, NID, land, banking, farm assessment, project enrollment, and approval workflow." },
  { title: "Community Moderation", icon: UsersRound, copy: "Manage posts, officer contacts, reports, scopes, comments, tags, and response states." },
  { title: "Audit & Roles", icon: BadgeCheck, copy: "Set admin roles for HQ, field officers, content editors, marketplace managers, and auditors." },
  { title: "API Contracts", icon: FileCheck2, copy: "Expose app-ready JSON endpoints and keep every mobile feature backed by database tables." },
  { title: "Market Updates", icon: Wheat, copy: "Publish prices, stock notices, training promotions, and location-targeted homepage updates." },
  { title: "App Shell", icon: PanelLeft, copy: "Control banners, service tiles, navigation labels, AI assistant prompts, and notification content." }
];
