import { queryRows } from "@/lib/db";
import { getUserGeo } from "@/lib/geo-scope";
import { logToolCall } from "@/lib/apa/log";
import { PERSONAL_TOOLS } from "@/lib/apa/pure";
import {
  getAppActiveProjects,
  getAppLearningOverview,
  getAppMarketUpdates,
  getAppMe,
  getAppOfficers,
  getAppProducts,
  getAppWeatherAlerts,
  getFinanceSummary,
  getMyListings,
  getMyOrders,
  getSalePriceQuote
} from "@/lib/app-endpoints";

/**
 * The ten things Shathi Apa is allowed to look up.
 *
 * This is the part that turns her from a chatbot into the app talking. Before
 * it, "আজ কি বৃষ্টি হবে" got a plausible-sounding invention, and the answer to
 * "আজকের গরুর দাম" had no relationship to the ৳৪২৫ printed on the home screen
 * two taps away. A farmer who is told two different numbers by the same app
 * stops believing either.
 *
 * Three rules hold for every tool here and must keep holding:
 *
 *   1. **Read only.** Nothing in this file writes. An assistant that can be
 *      talked into placing an order is a different risk class entirely, and
 *      `navigate_to` exists precisely so that acting stays a tap the farmer
 *      makes herself.
 *   2. **Identity comes from the session, never from an argument.** No tool
 *      takes a user_id. The model cannot ask for someone else's loan because
 *      there is no parameter in which to ask.
 *   3. **Area comes from her approved profile.** Every one of these reads
 *      through the same geo scope the screens use, so the assistant and the
 *      home card cannot disagree.
 *
 * `navigate_to` is the one tool not executed here: it is returned to the app as
 * a suggestion, and the farmer taps it. Never a redirect she did not ask for.
 */

type Row = Record<string, unknown>;

/** A chip under the answer, naming where a figure came from (SRS V9). */
export type ApaSource = {
  kind: string;
  label_bn: string;
  action: string | null;
};

export type ToolOutcome = {
  tool: string;
  /** Compact JSON handed back to the model. */
  data: unknown;
  sources: ApaSource[];
  /** The lookup ran. False only means we could not ask, never "nothing found". */
  ok: boolean;
  /** The lookup ran and there was nothing there. Not a failure. */
  empty: boolean;
  /** This result is about one farmer, so an answer using it may never be cached. */
  personal: boolean;
  /** The apa_tool_calls row, so the answer can attribute exactly its own calls. */
  toolCallId: number | null;
  error?: string;
};

export type ToolContext = {
  userId: string;
  districtName?: string | null;
  upazilaName?: string | null;
};

/* ---------------------------------------------------------------------------
   Declarations handed to the model
   --------------------------------------------------------------------------- */

/**
 * Note what is absent: no code execution, no web search, no file access, on any
 * path including live. That is not an oversight to be corrected later — a tool
 * list is the assistant's entire capability surface, and this one is ten
 * read-only queries against our own database.
 */
/**
 * Screens `navigate_to` may offer. Declared once: it used to be written into
 * the tool schema and then read back out of it through a cast at runtime, so
 * the two could drift and nothing would notice.
 */
export const NAVIGABLE_SCREENS = [
  "weather", "marketUpdates", "myListings", "saleCategories", "buyCategories",
  "buyProducts", "training", "financeHub", "menuKyc", "officers", "notifications", "menuFarm"
] as const;

/** Tools whose result is about one farmer and must never be cached across them. */
// Aliased, not redeclared. A second copy of this list is how an answer about
// one farmer's loan ends up in a cache that another farmer is served from —
// see the note on PERSONAL_TOOLS in pure.ts, which owns it.
export const PERSONAL_TOOL_NAMES = PERSONAL_TOOLS;

export const TOOL_DECLARATIONS = [
  {
    name: "get_weather",
    description:
      "Today's weather and any active weather alert for the farmer's own upazila or district. Use for any question about rain, heat, storms, fog or whether to do field work today.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "get_market_price",
    description:
      "The current Shathi Sheba B2B rate for live cattle or another sale item in the farmer's district, and what the farmer receives per kg. Optionally values a specific weight.",
    parameters: {
      type: "object",
      properties: {
        animal: { type: "string", description: "Animal name in Bangla or English, e.g. গরু, ছাগল, cattle, goat." },
        weight_kg: { type: "number", description: "Live weight in kg, if the farmer gave one." }
      }
    }
  },
  {
    name: "get_my_profile",
    description:
      "The farmer's own name, district, upazila, village, farm size, what she farms, and whether her identity is verified. Use before giving advice that depends on where she is or what she keeps.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "get_my_listings",
    description:
      "The animals this farmer currently has listed for sale, with weight, asking price, estimated earning and where each one is in the six-step sale workflow.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "get_my_orders",
    description:
      "Input orders this farmer has placed through the app — feed, medicine, seed — with payment and delivery state.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "get_finance_status",
    description:
      "The farmer's readiness grade, loan application stage and next instalment, if any. Use for any question about a loan, a grade, an instalment or money owed.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "get_training",
    description:
      "Shathi Sheba training modules, optionally about one topic. Use when the farmer would be better served by a lesson than by a paragraph.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "A subject in Bangla or English, e.g. গরু মোটাতাজাকরণ, silage, ধান চাষ." }
      }
    }
  },
  {
    name: "find_products",
    description:
      "Inputs the farmer can buy through Shathi Sheba — feed, veterinary medicine, fertiliser, seed — with price and availability in her area.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What she needs, in Bangla or English." }
      }
    }
  },
  {
    name: "find_officer",
    description:
      "The Shathi Sheba field officer covering this farmer's area, with name and phone. Use whenever the answer should end with a person — medicine dosing, disease confirmation, money owed.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "navigate_to",
    description:
      "Offer the farmer a button that opens a screen in the app. This does NOT open anything by itself — she has to tap it. Use it to end an answer with the place she can act on it.",
    parameters: {
      type: "object",
      properties: {
        screen: {
          type: "string",
          description:
            "One of: weather, marketUpdates, myListings, saleCategories, buyCategories, buyProducts, training, financeHub, menuKyc, officers, notifications, menuFarm.",
          enum: NAVIGABLE_SCREENS
        },
        label_bn: { type: "string", description: "What the button should say, in Bangla, at most five words." }
      },
      required: ["screen", "label_bn"]
    }
  }
] as const;

export type ToolName = (typeof TOOL_DECLARATIONS)[number]["name"];

const KNOWN = new Set<string>(TOOL_DECLARATIONS.map((t) => t.name));

/* ---------------------------------------------------------------------------
   Execution
   --------------------------------------------------------------------------- */

/** Trim a row set to the handful of fields worth spending tokens on. */
function pick<T extends Row>(rows: T[], keys: string[], limit: number): Row[] {
  return rows.slice(0, limit).map((row) => {
    const out: Row = {};
    for (const key of keys) if (row[key] !== null && row[key] !== undefined && row[key] !== "") out[key] = row[key];
    return out;
  });
}

const area = (ctx: ToolContext) => ctx.upazilaName || ctx.districtName || "আপনার এলাকা";

export async function runTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolOutcome> {
  const started = Date.now();
  if (!KNOWN.has(name)) {
    // A model asking for a tool that does not exist is the shape a prompt
    // injection takes when it works, so it is logged rather than ignored.
    const id = await logToolCall({ userId: ctx.userId, tool: name, args: rawArgs, ok: false, error: "unknown tool" });
    return { tool: name, data: null, sources: [], ok: false, empty: true, personal: false, toolCallId: id, error: "unknown tool" };
  }

  try {
    const outcome = await execute(name as ToolName, rawArgs, ctx);
    const id = await logToolCall({
      userId: ctx.userId,
      tool: name,
      args: rawArgs,
      ok: outcome.ok,
      error: outcome.error ?? null,
      rows: Array.isArray(outcome.data) ? outcome.data.length : outcome.data ? 1 : 0,
      latencyMs: Date.now() - started
    });
    return { ...outcome, personal: PERSONAL_TOOL_NAMES.has(name), toolCallId: id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "tool failed";
    const id = await logToolCall({
      userId: ctx.userId,
      tool: name,
      args: rawArgs,
      ok: false,
      error: message,
      latencyMs: Date.now() - started
    });
    // The model is told plainly that the lookup failed, so it can say so rather
    // than filling the gap with a plausible number (SRS G5: no source chip,
    // because there is no source to cite).
    return {
      tool: name, data: { error: "unavailable" }, sources: [], ok: false, empty: true,
      personal: PERSONAL_TOOL_NAMES.has(name), toolCallId: id, error: message
    };
  }
}

type ToolResult = Omit<ToolOutcome, "personal" | "toolCallId">;

async function execute(
  name: ToolName,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (name) {
    case "get_weather": {
      const alerts = await getAppWeatherAlerts(ctx.userId);
      const updates = alerts.length ? [] : await getAppMarketUpdates(ctx.userId);
      return {
        tool: name,
        ok: true,
        empty: alerts.length === 0,
        data: {
          area: area(ctx),
          alerts: pick(alerts, ["title_bn", "body_bn", "alert_type", "severity", "district", "upazila"], 3),
          note: alerts.length ? null : "No active alert for this area right now.",
          related: pick(updates.filter((u) => String(u.update_type ?? "") === "weather"), ["title_bn", "body_bn"], 1)
        },
        sources: alerts.length
          ? [{ kind: "weather", label_bn: `আবহাওয়া · ${area(ctx)}`, action: "screen:weather" }]
          : []
      };
    }

    case "get_market_price": {
      const wanted = String(args.animal ?? "").trim();
      const weight = Number(args.weight_kg ?? 0);
      const geo = await getUserGeo(ctx.userId);
      // Resolve the spoken animal name to an id rather than passing text into
      // the pricing query, which matches on ids.
      //
      // The table is `sale_items`. This queried `sale_animals`, which has never
      // existed in this schema, so every market-price question threw
      // "Table 'shathi_sheba.sale_animals' doesn't exist", was reported to the
      // model as a failed lookup, and came back as "I cannot fetch today's
      // rate" — a sentence that reads like an upstream outage and was a typo in
      // a table name. Sixteen active pricing rules were sitting there the whole
      // time.
      const animals = await queryRows<Row>(
        `SELECT CAST(id AS CHAR) AS id, name_en, name_bn
           FROM sale_items
          WHERE status = 'active'
          ORDER BY sale_category_id, id`
      );
      const match =
        animals.find((a) => wanted && (String(a.name_bn ?? "").includes(wanted) || wanted.includes(String(a.name_bn ?? "")))) ??
        animals.find((a) => wanted && String(a.name_en ?? "").toLowerCase().includes(wanted.toLowerCase())) ??
        animals[0];

      // `sale_item_id`, because that is the column the pricing rules key on.
      // `animal_id` is a different, mostly unused dimension on the same table,
      // and passing an item id as an animal id matched nothing.
      const quote = await getSalePriceQuote({
        sale_item_id: match ? String(match.id) : null,
        user_id: ctx.userId,
        weight: weight > 0 ? String(weight) : null
      });
      // The quote is `{ rule, breakdown }`; there was no `rate_per_kg` on it,
      // so this was false even when a rule had been found.
      const ok = Boolean((quote as Row | null)?.rule);
      return {
        tool: name,
        ok: true,
        empty: !ok,
        data: {
          area: area(ctx),
          animal: match?.name_bn ?? match?.name_en ?? wanted,
          district_id: geo.district_id,
          quote
        },
        // The route to the market page is offered whether or not a rate was
        // found. Measured on a real account: no active price rule for the
        // district, so `ok` was false, so there was no chip - and the farmer
        // was told "I cannot fetch today's rate" with nowhere to go. The
        // platform *has* a market updates screen; not offering it because this
        // one lookup came back empty is the app withholding the answer it does
        // have.
        //
        // The "শাথী সেবার তথ্য" provenance chip is still conditional, because
        // that one claims a figure came from our data and must not appear when
        // no figure did.
        sources: ok
          ? [
              { kind: "market", label_bn: `বাজারদর · ${ctx.districtName ?? area(ctx)}`, action: "screen:marketUpdates" },
              { kind: "platform", label_bn: "শাথী সেবার তথ্য", action: null }
            ]
          : [{ kind: "market", label_bn: "বাজারদর দেখুন", action: "screen:marketUpdates" }]
      };
    }

    case "get_my_profile": {
      const me = (await getAppMe(ctx.userId)) as Row | null;
      const [farm] = await queryRows<Row>(
        `SELECT total_land_decimals, primary_focus, crop_types, livestock_count, pond_count
           FROM app_user_farm WHERE user_id = ? LIMIT 1`,
        [ctx.userId]
      );
      const user = (me?.user ?? me) as Row | null;
      return {
        tool: name,
        ok: true,
        empty: !user,
        data: {
          name: user?.display_name ?? user?.full_name ?? null,
          district: user?.district ?? null,
          upazila: user?.upazila ?? null,
          village: user?.village ?? null,
          is_kyc_verified: user?.is_kyc_verified ?? false,
          farm: farm ?? null
        },
        sources: []
      };
    }

    case "get_my_listings": {
      const listings = (await getMyListings(ctx.userId)) as Row[];
      return {
        tool: name,
        ok: true,
        empty: listings.length === 0,
        data: pick(
          listings,
          ["listing_code", "title_bn", "title_en", "status", "weight_kg", "farmer_expected_price", "estimated_earning"],
          6
        ),
        sources: listings.length
          ? [{ kind: "listing", label_bn: "আপনার বিক্রির তালিকা", action: "screen:myListings" }]
          : []
      };
    }

    case "get_my_orders": {
      const orders = (await getMyOrders(ctx.userId)) as Row[];
      return {
        tool: name,
        ok: true,
        empty: orders.length === 0,
        data: pick(orders, ["order_code", "payable_amount", "payment_status", "fulfillment_status", "created_at"], 6),
        sources: orders.length ? [{ kind: "order", label_bn: "আপনার অর্ডার", action: "screen:buyCategories" }] : []
      };
    }

    case "get_finance_status": {
      const finance = (await getFinanceSummary(ctx.userId)) as Row;
      return {
        tool: name,
        ok: true,
        empty: !finance?.state || finance.state === "not_assessed",
        data: {
          state: finance?.state,
          grade: finance?.grade,
          score: finance?.score,
          stage: finance?.stage,
          stage_total: finance?.stage_total,
          application_code: finance?.application_code,
          pending_user_action: finance?.pending_user_action,
          next_payment: finance?.next_payment ?? null
        },
        sources:
          finance?.state && finance.state !== "not_assessed"
            ? [{ kind: "finance", label_bn: "ফিন্যান্স পাসপোর্ট", action: "screen:financeHub" }]
            : []
      };
    }

    case "get_training": {
      const topic = String(args.topic ?? "").trim();
      const overview = (await getAppLearningOverview(ctx.userId)) as Row;
      const modules = (Array.isArray(overview?.modules) ? overview.modules : []) as Row[];
      const matched = topic
        ? modules.filter((m) =>
            [m.title_bn, m.title_en, m.summary_bn, m.summary_en]
              .map((v) => String(v ?? "").toLowerCase())
              .some((v) => v.includes(topic.toLowerCase()))
          )
        : modules;
      const rows = (matched.length ? matched : modules) as Row[];
      return {
        tool: name,
        ok: true,
        empty: rows.length === 0,
        data: pick(rows, ["id", "title_bn", "title_en", "summary_bn", "duration_minutes"], 4),
        sources: rows.length ? [{ kind: "training", label_bn: "প্রশিক্ষণ", action: "screen:training" }] : []
      };
    }

    case "find_products": {
      const query = String(args.query ?? "").trim().toLowerCase();
      const products = (await getAppProducts(null, null, ctx.userId)) as Row[];
      // Matched against the columns the query actually returns.
      //
      // This used to look at `description_bn`, `description_en` and `category`,
      // and none of the three exist on a product row — the real names are
      // `short_description_bn/en` and `category_name_bn`/`category_slug`. Three
      // of the five fields were `undefined`, so the search only ever matched a
      // product's own name. Asked for "গরুর ফিড" it found nothing, because the
      // product is called "Cattle Feed Premium" and only its *category* is
      // named in Bangla.
      //
      // The category and the manufacturer are included deliberately: a farmer
      // asks for a kind of thing ("feed", "seed", "vaccine") far more often
      // than for a product by name.
      const matched = query
        ? products.filter((p) =>
            [
              p.name_bn, p.name_en,
              p.short_description_bn, p.short_description_en,
              p.category_name_bn, p.category_name, p.category_slug,
              p.manufacturer_name_bn, p.manufacturer_name,
              p.sku
            ]
              .map((v) => String(v ?? "").toLowerCase())
              .some((v) => v && v.includes(query))
          )
        : products;
      return {
        tool: name,
        ok: true,
        empty: matched.length === 0,
        // Same correction on the way out: `category` and `stock_status` were
        // never columns, so the model was handed two undefined fields and could
        // not tell an in-stock item from one that is out.
        data: pick(
          matched,
          ["id", "name_bn", "name_en", "price", "unit", "package_size_bn", "category_name_bn", "status"],
          5
        ),
        // Same reasoning as get_market_price: the shop exists even when this
        // search found nothing. "No cattle feed is listed in your area right
        // now" is a useful answer; it is more useful with a way to go and look,
        // because stock changes and her area is not the only thing on the
        // shelf.
        sources: matched.length
          ? [{ kind: "shop", label_bn: "শাথী থেকে কিনুন", action: "screen:buyCategories" }]
          : [{ kind: "shop", label_bn: "দোকান দেখুন", action: "screen:buyCategories" }]
      };
    }

    case "find_officer": {
      const officers = (await getAppOfficers(ctx.userId)) as Row[];
      return {
        tool: name,
        ok: true,
        empty: officers.length === 0,
        data: pick(officers, ["name", "officer_role", "phone", "district", "upazila"], 2),
        sources: officers.length
          ? [{ kind: "officer", label_bn: "মাঠ কর্মকর্তা", action: "screen:officers" }]
          : []
      };
    }

    case "navigate_to": {
      // Not executed. Returned to the app as a button; the farmer taps it.
      const screen = String(args.screen ?? "").trim();
      const label = String(args.label_bn ?? "").trim().slice(0, 40);
      const ok = Boolean(screen && label && (NAVIGABLE_SCREENS as readonly string[]).includes(screen));
      return {
        tool: name,
        ok,
        empty: false,
        data: ok ? { offered: screen } : { error: "unknown screen" },
        sources: ok ? [{ kind: "action", label_bn: label, action: `screen:${screen}` }] : []
      };
    }

    default: {
      // TypeScript exhaustiveness: every declared tool has a branch above.
      const never: never = name;
      throw new Error(`unhandled tool ${String(never)}`);
    }
  }
}

/** Projects the farmer is enrolled in, used to colour advice — not a tool. */
export async function activeProjectContext(userId: string): Promise<string | null> {
  try {
    const projects = (await getAppActiveProjects(userId)) as Row[];
    if (!Array.isArray(projects) || !projects.length) return null;
    return projects
      .slice(0, 2)
      .map((p) => String(p.title_bn ?? p.title_en ?? "").trim())
      .filter(Boolean)
      .join(", ");
  } catch {
    return null;
  }
}
