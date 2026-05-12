import { NextRequest, NextResponse } from "next/server";
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
  priceBreakdown,
  saleListings,
  weatherAlerts
} from "@/lib/data";
import {
  createResource,
  deleteResource,
  hasDbResource,
  listResource,
  updateResource
} from "@/lib/db-resources";

type Params = {
  params: Promise<{
    resource: string[];
  }>;
};

const saleCategories = [
  { slug: "crops", name_en: "Crops", name_bn: "ফসল", active: true, description: "Grains, vegetables, fruits" },
  { slug: "livestock", name_en: "Livestock", name_bn: "গবাদি পশু", active: true, description: "Cattle, goat, poultry, fish" },
  { slug: "inputs", name_en: "Inputs", name_bn: "ইনপুট", active: true, description: "Seeds, feed, fertilizer" },
  { slug: "machinery", name_en: "Machinery", name_bn: "যন্ত্রপাতি", active: true, description: "Rent and lease" }
];

const animalTypes = [
  { category: "cattle", type: "Bull", type_bn: "ষাঁড়", breeds: ["Cross Friesian", "Local", "Sahiwal", "Red Chittagong"] },
  { category: "goat", type: "Goat", type_bn: "ছাগল", breeds: ["Black Bengal", "Jamnapari", "Local"] },
  { category: "poultry", type: "Poultry", type_bn: "পোল্ট্রি", breeds: ["Broiler", "Layer", "Native"] }
];

const buyCategories = [
  { slug: "shadhin-feed", name_en: "Shadhin Feed", name_bn: "স্বাধীন ফিড", description: "Own brand" },
  { slug: "seeds", name_en: "Seeds", name_bn: "বীজ", description: "Certified varieties" },
  { slug: "fertilizer", name_en: "Fertilizer", name_bn: "সার", description: "Urea, DAP, organic" },
  { slug: "agri-medicine", name_en: "Agri-medicine", name_bn: "কৃষি ঔষধ", description: "Pesticide, vet" },
  { slug: "tools", name_en: "Tools", name_bn: "যন্ত্র", description: "Hand and electric" },
  { slug: "machinery-rental", name_en: "Machinery rental", name_bn: "যন্ত্র ভাড়া", description: "Tractor, tiller" }
];

function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    meta,
    data
  });
}

function accepted(method: string, payload: unknown, resource: string) {
  return NextResponse.json(
    {
      ok: true,
      message: `${method} accepted for ${resource}. Replace seed handler with DB service when MySQL is connected.`,
      received: payload
    },
    { status: method === "POST" ? 201 : 202 }
  );
}

function dbError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown database error";
  return NextResponse.json(
    {
      ok: false,
      message,
      source: "mysql"
    },
    { status: 500 }
  );
}

async function resolveResource(params: Params["params"]) {
  const { resource } = await params;
  return resource.join("/");
}

export async function GET(request: NextRequest, { params }: Params) {
  const resource = await resolveResource(params);
  const searchParams = request.nextUrl.searchParams;

  if (hasDbResource(resource)) {
    try {
      const rows = await listResource(resource);
      return envelope(rows ?? [], { source: "mysql", resource });
    } catch (error) {
      return dbError(error);
    }
  }

  switch (resource) {
    case "interests":
      return envelope(interestCategories, { purpose: "Splash onboarding category and child item setup" });
    case "weather":
      return envelope(weatherAlerts, {
        district: searchParams.get("district") ?? "all",
        source: "weather-server-plus-local-critical-alerts"
      });
    case "market-updates":
      return envelope(marketUpdates, { surface: "mobile-homepage" });
    case "sale/categories":
      return envelope({ categories: saleCategories, animal_types: animalTypes, price_breakdown: priceBreakdown });
    case "sale/listings":
      return envelope(saleListings, { status: searchParams.get("status") ?? "all" });
    case "buy/categories":
      return envelope(buyCategories);
    case "buy/products":
      return envelope(buyProducts, { category: searchParams.get("category") ?? "all" });
    case "buy/orders":
      return envelope(buyOrders, { status: searchParams.get("status") ?? "all" });
    case "learning/modules":
      return envelope(learningModules, { include: "categories,contents,completion_rules" });
    case "partners/projects":
      return envelope(partnerProjects);
    case "partners/applications":
      return envelope(partnerApplications, { queue: "kyc,due-diligence,field-verification,approval" });
    case "community/posts":
      return envelope(communityPosts, { scope: searchParams.get("scope") ?? "all" });
    case "users":
      return envelope([
        { id: "USR-1", full_name: "Md. Rahim", phone: "01712-345678", district: "Mymensingh", upazila: "Mymensingh Sadar", status: "active" },
        { id: "USR-2", full_name: "Fatema Khatun", phone: "01812-222333", district: "Mymensingh", upazila: "Mymensingh Sadar", status: "active" },
        { id: "USR-3", full_name: "Sadia Khatun", phone: "01933-555888", district: "Dhaka", upazila: "Dhaka", status: "active" }
      ]);
    case "reports":
      return envelope({
        marketplace: { sale_listings: saleListings.length, buy_orders: buyOrders.length },
        approvals: { partner_applications: partnerApplications.length },
        content: { learning_modules: learningModules.length },
        community: { posts: communityPosts.length }
      });
    case "settings":
      return envelope([
        { key: "weather_push_enabled", value: true },
        { key: "sale_ai_prefill", value: "enabled" },
        { key: "community_auto_moderation", value: "review" }
      ]);
    case "catalog":
      return envelope(apiCatalog);
    default:
      return NextResponse.json(
        {
          ok: false,
          message: "Unknown API resource",
          available: apiCatalog.map((endpoint) => endpoint.path)
        },
        { status: 404 }
      );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const resource = await resolveResource(params);
  const payload = await request.json().catch(() => ({}));
  if (hasDbResource(resource)) {
    try {
      const result = await createResource(resource, payload);
      return NextResponse.json({ ok: true, source: "mysql", action: "created", resource, result }, { status: 201 });
    } catch (error) {
      return dbError(error);
    }
  }
  return accepted("POST", payload, resource);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const resource = await resolveResource(params);
  const payload = await request.json().catch(() => ({}));
  const id = request.nextUrl.searchParams.get("id") ?? String((payload as Record<string, unknown>).id ?? "");
  if (hasDbResource(resource)) {
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing id for update." }, { status: 400 });
    }
    try {
      const result = await updateResource(resource, id, payload);
      return NextResponse.json({ ok: true, source: "mysql", action: "updated", resource, id, result });
    } catch (error) {
      return dbError(error);
    }
  }
  return accepted("PUT", payload, resource);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const resource = await resolveResource(params);
  const payload = await request.json().catch(() => ({}));
  const id = request.nextUrl.searchParams.get("id") ?? String((payload as Record<string, unknown>).id ?? "");
  if (hasDbResource(resource)) {
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing id for update." }, { status: 400 });
    }
    try {
      const result = await updateResource(resource, id, payload);
      return NextResponse.json({ ok: true, source: "mysql", action: "updated", resource, id, result });
    } catch (error) {
      return dbError(error);
    }
  }
  return accepted("PATCH", payload, resource);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const resource = await resolveResource(params);
  const payload = await request.json().catch(() => ({}));
  const id = request.nextUrl.searchParams.get("id") ?? String((payload as Record<string, unknown>).id ?? "");
  if (hasDbResource(resource)) {
    if (!id) {
      return NextResponse.json({ ok: false, message: "Missing id for delete." }, { status: 400 });
    }
    try {
      const result = await deleteResource(resource, id);
      return NextResponse.json({ ok: true, source: "mysql", action: "deleted", resource, id, result });
    } catch (error) {
      return dbError(error);
    }
  }
  return accepted("DELETE", payload, resource);
}
