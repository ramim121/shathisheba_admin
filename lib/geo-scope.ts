import { queryRows } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { EMPTY_GEO, resolveGeoIds, toGeoId, type GeoIds } from "@/lib/geo";

/**
 * Per-feature geographic filtering.
 *
 * Each feature is filtered at a level chosen in the admin (Settings > Geo
 * filters) and stored in app_settings as geo_scope.<feature>. Read live — a
 * change applies on the next request.
 *
 * The rule, everywhere: a row is visible to a farmer when the row's area
 * contains the farmer, down to the configured level. Concretely, for every
 * level from division down to the scope level, the row either leaves that level
 * blank (it covers the whole of the level above) or names the farmer's own.
 *
 *   A listing in Savar (upazila scope)    -> only farmers whose upazila is Savar
 *   A project covering Dhaka district     -> every farmer in Dhaka district
 *   A post at district scope              -> every farmer in the post's district
 *
 * A farmer missing a level (no upazila on the profile) matches nothing that is
 * locked at that level — they see the wider rows and nothing narrower, which is
 * what "locked" means. All matching is by id.
 */

export type GeoScope = "upazila" | "district" | "division" | "none" | "gps";

export type GeoFeature =
  | "sale_listings"
  | "partner_projects"
  | "loan_applications"
  | "zone_officers"
  | "orders"
  | "community_posts"
  | "market_updates"
  | "weather_alerts"
  | "sale_pricing"
  | "default";

export const GEO_FEATURES: Array<{
  key: GeoFeature;
  label: string;
  description: string;
  fallback: GeoScope;
  allowed: GeoScope[];
}> = [
  { key: "sale_listings", label: "Sale listings", description: "Who can see a farmer's listing. The listing inherits the seller's profile location.", fallback: "upazila", allowed: ["upazila", "district", "division", "none"] },
  { key: "partner_projects", label: "Partner projects", description: "Who can see and apply to a region-based project. National projects show everywhere.", fallback: "upazila", allowed: ["upazila", "district", "division", "none"] },
  { key: "loan_applications", label: "Loan applications", description: "The level an application is routed to officers at.", fallback: "upazila", allowed: ["upazila", "district", "division", "none"] },
  { key: "zone_officers", label: "Field officers", description: "Which officers a farmer is shown as their contact.", fallback: "upazila", allowed: ["upazila", "district", "division", "none"] },
  { key: "orders", label: "Orders", description: "The level orders are fulfilled and reported at.", fallback: "district", allowed: ["upazila", "district", "division", "none"] },
  { key: "community_posts", label: "Community feed", description: "Whose posts appear in a farmer's regional feed. Posts marked Bangladesh-wide show everywhere.", fallback: "district", allowed: ["upazila", "district", "division", "none"] },
  { key: "market_updates", label: "Market updates", description: "Who receives a targeted market update. Untargeted updates show everywhere.", fallback: "district", allowed: ["upazila", "district", "division", "none"] },
  { key: "weather_alerts", label: "Weather alerts", description: "GPS uses the phone's current position, falling back to the profile district.", fallback: "gps", allowed: ["gps", "upazila", "district", "division", "none"] },
  { key: "sale_pricing", label: "Price rules", description: "The level a sale price rule is matched at.", fallback: "district", allowed: ["upazila", "district", "division", "none"] },
  { key: "default", label: "Everything else", description: "Any location-aware feature without its own setting.", fallback: "district", allowed: ["upazila", "district", "division", "none"] }
];

const VALID: GeoScope[] = ["upazila", "district", "division", "none", "gps"];

export async function getGeoScope(feature: GeoFeature): Promise<GeoScope> {
  const def = GEO_FEATURES.find((f) => f.key === feature);
  const fromDefault = feature === "default" ? null : ((await getSetting("geo_scope.default", "district")) as GeoScope);
  const raw = (await getSetting(`geo_scope.${feature}`, def?.fallback ?? fromDefault ?? "district")).trim().toLowerCase();
  return (VALID.includes(raw as GeoScope) ? raw : def?.fallback ?? "district") as GeoScope;
}

export async function getAllGeoScopes(): Promise<Record<GeoFeature, GeoScope>> {
  const entries = await Promise.all(GEO_FEATURES.map(async (f) => [f.key, await getGeoScope(f.key)] as const));
  return Object.fromEntries(entries) as Record<GeoFeature, GeoScope>;
}

/** The farmer's approved location, as ids. Pending profile changes never count. */
export async function getUserGeo(userId: unknown): Promise<GeoIds> {
  if (!userId) return { ...EMPTY_GEO };
  const rows = await queryRows<GeoIds>(
    "SELECT division_id, district_id, upazila_id FROM app_users WHERE id = ? LIMIT 1",
    [userId]
  );
  const row = rows[0];
  if (!row) return { ...EMPTY_GEO };
  return {
    division_id: row.division_id === null ? null : Number(row.division_id),
    district_id: row.district_id === null ? null : Number(row.district_id),
    upazila_id: row.upazila_id === null ? null : Number(row.upazila_id)
  };
}

const ORDER: Array<"division" | "district" | "upazila"> = ["division", "district", "upazila"];

/**
 * The containment clause for `alias` at `scope`, for a viewer at `geo`.
 * `gps` is treated as district — the caller is expected to have passed the
 * device-derived location as `geo` instead of the profile's.
 */
export function geoContains(scope: GeoScope, alias: string, geo: GeoIds): { sql: string; params: unknown[] } {
  if (scope === "none") return { sql: "1 = 1", params: [] };
  const depth = scope === "gps" ? "district" : scope;
  const levels = ORDER.slice(0, ORDER.indexOf(depth) + 1);
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const level of levels) {
    const col = `${alias}.${level}_id`;
    parts.push(`(${col} IS NULL OR ${col} = ?)`);
    params.push(geo[`${level}_id` as keyof GeoIds]);
  }
  return { sql: `(${parts.join(" AND ")})`, params };
}

/** Convenience: scope lookup + clause in one call. */
export async function geoFilter(feature: GeoFeature, alias: string, geo: GeoIds) {
  const scope = await getGeoScope(feature);
  return { scope, ...geoContains(scope, alias, geo) };
}

/**
 * Whether a single row is visible to a viewer — for detail endpoints, where a
 * refusal should say so (code "geo_locked") rather than 404.
 */
export function geoRowVisible(scope: GeoScope, row: Partial<GeoIds>, geo: GeoIds): boolean {
  if (scope === "none") return true;
  const depth = scope === "gps" ? "district" : scope;
  const levels = ORDER.slice(0, ORDER.indexOf(depth) + 1);
  return levels.every((level) => {
    const own = row[`${level}_id` as keyof GeoIds];
    if (own === null || own === undefined) return true;
    return Number(own) === Number(geo[`${level}_id` as keyof GeoIds]);
  });
}

/** Thrown when a farmer asks for something outside their area. */
export class GeoLockedError extends Error {
  code = "geo_locked";
  constructor(message = "This is only available to farmers in its area.") {
    super(message);
  }
}

/** Thrown when an action needs a location the farmer's profile does not have yet. */
export class LocationRequiredError extends Error {
  code = "location_required";
}

const LEVEL_LABEL: Record<"division" | "district" | "upazila", string> = {
  division: "division",
  district: "district",
  upazila: "upazila"
};

/**
 * What a farmer creates inherits the farmer's approved location — a listing,
 * a post — rather than whatever the client sent. That is what makes the lock
 * mean anything: a seller cannot list into an upazila they do not live in.
 * The action is refused if the profile does not reach the feature's level.
 */
export async function inheritUserGeo(
  feature: GeoFeature,
  payload: Record<string, unknown>,
  userId: unknown
): Promise<Record<string, unknown>> {
  const geo = await getUserGeo(userId);
  const scope = await getGeoScope(feature);
  const need = scope === "upazila" || scope === "district" || scope === "division" ? scope : null;
  if (need && !geo[`${need}_id` as keyof GeoIds]) {
    throw new LocationRequiredError(
      `Add your ${LEVEL_LABEL[need]} to your profile first — this is shown only to farmers in your ${LEVEL_LABEL[need]}.`
    );
  }
  const next = { ...payload };
  for (const key of ["division", "district", "upazila", "division_id", "district_id", "upazila_id"]) delete next[key];
  return { ...next, division_id: geo.division_id, district_id: geo.district_id, upazila_id: geo.upazila_id };
}

/**
 * The location weather is judged at. With the `gps` scope the phone's current
 * position wins — a farmer away from home wants the storm where they are — and
 * the profile is the fallback when there is no fix.
 */
export async function weatherGeo(userId: unknown, gpsDistrictId: unknown, gpsUpazilaId: unknown): Promise<GeoIds> {
  const scope = await getGeoScope("weather_alerts");
  const upazila = toGeoId(gpsUpazilaId);
  const district = toGeoId(gpsDistrictId);
  if (scope === "gps" && (upazila || district)) {
    try {
      const r = await resolveGeoIds(upazila ? { upazila_id: upazila } : { district_id: district });
      return { division_id: r.division_id, district_id: r.district_id, upazila_id: r.upazila_id };
    } catch {
      // An id the masters do not know is ignored, not fatal.
    }
  }
  return getUserGeo(userId);
}
