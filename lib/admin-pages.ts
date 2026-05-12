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
    formFields: defaultFields
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
      { label: "Sale category", name: "category", type: "select", options: ["Crops", "Livestock", "Inputs", "Machinery"] },
      { label: "Animal type / product item", name: "item", value: "Cattle" },
      { label: "Breed", name: "breed", value: "Cross Friesian" },
      { label: "Rate", name: "rate", value: "670" },
      ...defaultFields
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
      { label: "Category", name: "category", type: "select", options: ["Shadhin Feed", "Seeds", "Fertilizer", "Agri-medicine", "Tools", "Machinery rental"] },
      { label: "Product name", name: "name", value: "Shadhin Cattle Feed" },
      { label: "Price", name: "price", value: "1800" },
      { label: "Stock quantity", name: "stock", value: "240" }
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
      { label: "Payment status", name: "payment", type: "select", options: ["pending", "paid", "failed", "refunded"] },
      { label: "Fulfillment status", name: "fulfillment", type: "select", options: ["placed", "confirmed", "assigned", "in_transit", "delivered", "cancelled"] },
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
      { label: "Category", name: "category", type: "select", options: ["Livestock", "Agriculture", "Climate", "Women", "Healthcare"] },
      { label: "Content type", name: "type", type: "select", options: ["Article", "Video", "Quiz"] },
      ...defaultFields,
      { label: "Video URL / article body", name: "content", type: "textarea", value: "Content body or media URL" }
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
      { label: "Project name", name: "name", value: "Cattle Fattening - Eid Batch 2024" },
      { label: "Lender", name: "lender", value: "BRAC Bank" },
      { label: "Capacity", name: "capacity", value: "50" },
      { label: "Registration steps", name: "steps", type: "textarea", value: "Project selection, KYC, Banking info, Farm assessment" }
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
      { label: "Verification status", name: "status", type: "select", options: ["submitted", "needs_document", "officer_verification", "ready_to_approve", "approved", "rejected"] },
      { label: "Assigned officer", name: "officer", value: "Rana Hossain" },
      { label: "Verification notes", name: "notes", type: "textarea", value: "Check NID, land, banking, and farm assessment." }
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
      { label: "Scope", name: "scope", type: "select", options: ["My Upazila", "District", "Bangladesh"] },
      { label: "Post type", name: "type", type: "select", options: ["General", "Question", "Livestock", "Crop", "Complaint", "Notice"] },
      { label: "Moderation status", name: "status", type: "select", options: ["visible", "answered", "hidden", "moderation", "removed"] },
      { label: "Response / note", name: "note", type: "textarea", value: "Officer response or moderation note" }
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
      { key: "activity", label: "Activity" }
    ],
    rows: [
      { id: "USR-1", name: "Md. Rahim", phone: "01712-345678", location: "Mymensingh Sadar", activity: "12 listings, 3 orders", status: "Active" },
      { id: "USR-2", name: "Fatema Khatun", phone: "01812-222333", location: "Mymensingh", activity: "1 project, 2 posts", status: "Active" },
      { id: "USR-3", name: "Sadia Khatun", phone: "01933-555888", location: "Dhaka", activity: "Field officer", status: "Active" }
    ],
    formFields: [
      { label: "Full name", name: "name", value: "Md. Rahim" },
      { label: "Phone", name: "phone", value: "01712-345678" },
      { label: "District", name: "district", value: "Mymensingh" },
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
      { key: "slug", label: "Slug" },
      { key: "name_en", label: "Name" },
      { key: "name_bn", label: "Bangla" }
    ],
    rows: [],
    formFields: [
      { label: "Slug", name: "slug", value: "livestock" },
      { label: "English name", name: "name_en", value: "Livestock" },
      { label: "Bangla name", name: "name_bn", value: "গবাদি পশু" },
      { label: "Description", name: "description_en", type: "textarea", value: "Cattle, goat, poultry and fish" },
      { label: "Status", name: "is_active", type: "select", options: ["1", "0"] }
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
      { label: "Animal type", name: "animal_type", type: "select", options: ["cattle", "goat", "poultry", "fish"] },
      { label: "English name", name: "name_en", value: "Cross Friesian" },
      { label: "Bangla name", name: "name_bn", value: "ক্রস ফ্রিজিয়ান" },
      { label: "Active", name: "is_active", type: "select", options: ["1", "0"] }
    ]
  },
  "sale/pricing": {
    title: "Sale Pricing Rules",
    description: "Manage B2B rate, farmer rate, platform fee, logistics, warehouse, and vet-care breakdowns.",
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
      { label: "District", name: "district", value: "Mymensingh" },
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
