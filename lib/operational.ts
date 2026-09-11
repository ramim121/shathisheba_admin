import { queryRows } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { GeoIds } from "@/lib/geo";
import { GeoLockedError, LocationRequiredError, getGeoScope, getUserGeo, geoRowVisible, type GeoScope } from "@/lib/geo-scope";

/**
 * Operational zones — where Shathi Sheba can actually deliver a service.
 *
 * A zone is wherever an active field officer's area covers. Offerings that
 * need people on the ground (a loan, an order, a listing, a project place) are
 * available only inside one, at the geographic level that feature is set to.
 * Weather, training and loan readiness are never gated.
 *
 * Adding a field officer for an upazila turns that upazila on; nothing else
 * has to be configured.
 */

export type OperationalFeature = "loan_applications" | "orders" | "sale_listings" | "partner_projects";
export const OPERATIONAL_FEATURES: OperationalFeature[] = ["loan_applications", "orders", "sale_listings", "partner_projects"];

export type OperationalState = "ok" | "needs_location" | "zone_inactive";

export type OperationalStatus = {
  feature: OperationalFeature;
  state: OperationalState;
  /** The geographic level this feature needs on the farmer's profile. */
  level: GeoScope;
  officer: { id: string; name: string; phone: string; area: string } | null;
};

/** Thrown when the farmer's area has no field coverage for this offering yet. */
export class ZoneInactiveError extends Error {
  code = "zone_inactive";
}

type OfficerRow = GeoIds & { id: number; name: string; phone: string | null; district: string | null; upazila: string | null };

/** Every active field officer with an area, fetched once per request. */
async function activeFieldOfficers(): Promise<OfficerRow[]> {
  const rows = await queryRows<OfficerRow>(
    `SELECT id, name, phone, district, upazila, division_id, district_id, upazila_id
       FROM zone_officers
      WHERE is_active = 1 AND officer_role = 'field_officer'
        AND COALESCE(upazila_id, district_id, division_id) IS NOT NULL`
  );
  return rows.map((o) => ({
    ...o,
    division_id: o.division_id === null ? null : Number(o.division_id),
    district_id: o.district_id === null ? null : Number(o.district_id),
    upazila_id: o.upazila_id === null ? null : Number(o.upazila_id)
  }));
}

function levelId(geo: GeoIds, level: GeoScope): number | null {
  if (level === "upazila") return geo.upazila_id;
  if (level === "district" || level === "gps") return geo.district_id;
  if (level === "division") return geo.division_id;
  return 1; // "none": no location needed
}

const DEPTH: Record<string, number> = { none: 0, division: 1, district: 2, gps: 2, upazila: 3 };

/** The profile level every operational offering needs, whatever its own scope. */
async function profileLevel(): Promise<GeoScope> {
  const v = (await getSetting("operational_profile_level", "upazila")).trim().toLowerCase();
  return (v === "district" || v === "division" ? v : "upazila") as GeoScope;
}

function evaluate(feature: OperationalFeature, scope: GeoScope, geo: GeoIds, officers: OfficerRow[], required: GeoScope): OperationalStatus {
  if (scope === "none") return { feature, state: "ok", level: scope, officer: null };
  // The profile must reach the deeper of the two: the feature's own level and
  // the platform-wide minimum. Orders are covered by district, but no order
  // starts without the farmer's upazila on file.
  const need = DEPTH[required] > DEPTH[scope] ? required : scope;
  if (!levelId(geo, need)) return { feature, state: "needs_location", level: need, officer: null };
  // The officer whose area contains the farmer at this feature's level; the
  // most specific cover (their own upazila) before a district-wide one.
  const covering = officers
    .filter((o) => geoRowVisible(scope, o, geo))
    .sort((a, b) => Number(b.upazila_id === geo.upazila_id) - Number(a.upazila_id === geo.upazila_id));
  const o = covering[0];
  if (!o) return { feature, state: "zone_inactive", level: scope, officer: null };
  return {
    feature,
    state: "ok",
    level: scope,
    officer: { id: String(o.id), name: String(o.name), phone: String(o.phone ?? ""), area: String(o.upazila ?? o.district ?? "") }
  };
}

/** Status of every gated offering for one farmer — one geo read, one officer read. */
export async function getOperationalStatus(userId: unknown): Promise<Record<OperationalFeature, OperationalStatus>> {
  const [geo, officers, scopes, required] = await Promise.all([
    getUserGeo(userId),
    activeFieldOfficers(),
    Promise.all(OPERATIONAL_FEATURES.map((f) => getGeoScope(f))),
    profileLevel()
  ]);
  const out = {} as Record<OperationalFeature, OperationalStatus>;
  OPERATIONAL_FEATURES.forEach((feature, i) => { out[feature] = evaluate(feature, scopes[i], geo, officers, required); });
  return out;
}

const LEVEL_WORD: Record<string, string> = { upazila: "upazila", district: "district", division: "division", gps: "district" };

/**
 * The server-side gate behind every operational offering. The app shows the
 * same states before the farmer gets this far; this is what holds when it
 * does not.
 */
export async function assertOperational(userId: unknown, feature: OperationalFeature): Promise<OperationalStatus> {
  const [geo, officers, scope, required] = await Promise.all([
    getUserGeo(userId), activeFieldOfficers(), getGeoScope(feature), profileLevel()
  ]);
  const status = evaluate(feature, scope, geo, officers, required);
  if (status.state === "needs_location") {
    throw new LocationRequiredError(
      `Add your ${LEVEL_WORD[status.level] ?? "area"} to your profile first, or ask a field officer to help — this service needs it.`
    );
  }
  if (status.state === "zone_inactive") {
    throw new ZoneInactiveError(
      "Shathi Sheba is not active in your zone yet. Weather, training and loan readiness are still open to you."
    );
  }
  return status;
}

/**
 * The same gate for a place rather than a person — a delivery address. The
 * buyer's own profile is checked by `assertOperational`; this checks that the
 * address they chose is somewhere Shathi Sheba can actually deliver.
 */
export async function getAreaStatus(feature: OperationalFeature, geo: GeoIds): Promise<OperationalStatus> {
  const [officers, scope, required] = await Promise.all([activeFieldOfficers(), getGeoScope(feature), profileLevel()]);
  return evaluate(feature, scope, geo, officers, required);
}

export async function assertAreaCovered(feature: OperationalFeature, geo: GeoIds): Promise<OperationalStatus> {
  const status = await getAreaStatus(feature, geo);
  if (status.state === "needs_location") {
    throw new LocationRequiredError(`Choose the delivery ${LEVEL_WORD[status.level] ?? "area"}.`);
  }
  if (status.state === "zone_inactive") {
    throw new ZoneInactiveError("Shathi Sheba does not deliver to that area yet. Choose an address inside an active zone.");
  }
  return status;
}

/** Admin overview: every covered area and who covers it. */
export async function getOperationalZones() {
  return queryRows(
    `SELECT CAST(o.id AS CHAR) AS officer_id, o.name AS officer, o.phone,
            v.name_en AS division, d.name_en AS district, u.name_en AS upazila,
            CASE WHEN o.upazila_id IS NOT NULL THEN 'upazila'
                 WHEN o.district_id IS NOT NULL THEN 'district' ELSE 'division' END AS covers,
            (SELECT COUNT(*) FROM geo_upazilas gu
              WHERE (o.upazila_id IS NOT NULL AND gu.id = o.upazila_id)
                 OR (o.upazila_id IS NULL AND o.district_id IS NOT NULL AND gu.district_id = o.district_id)
                 OR (o.upazila_id IS NULL AND o.district_id IS NULL AND gu.district_id IN
                       (SELECT id FROM geo_districts WHERE division_id = o.division_id))) AS upazilas_covered
       FROM zone_officers o
       LEFT JOIN geo_divisions v ON v.id = o.division_id
       LEFT JOIN geo_districts d ON d.id = o.district_id
       LEFT JOIN geo_upazilas u ON u.id = o.upazila_id
      WHERE o.is_active = 1 AND o.officer_role = 'field_officer'
        AND COALESCE(o.upazila_id, o.district_id, o.division_id) IS NOT NULL
      ORDER BY v.name_en, d.name_en, u.name_en`
  );
}

// Re-exported so callers import the whole gate from one place.
export { GeoLockedError, LocationRequiredError };
