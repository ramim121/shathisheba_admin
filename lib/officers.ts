import { queryRows } from "@/lib/db";
import type { GeoIds } from "@/lib/geo";
import { geoFilter } from "@/lib/geo-scope";

export type FieldOfficer = { id: string; name: string; phone: string; area: string };

/**
 * The field officer covering a place, at the zone_officers geo scope.
 *
 * Replaces three separate `o.district = u.district` string joins (listing
 * progress, project progress, loan account), each of which picked an arbitrary
 * officer when a district had several and none at all when a name was spelled
 * differently. An officer must have an area to be anyone's officer — one with
 * no location set is not everyone's. The most specific cover wins: an officer
 * for the farmer's own upazila before one for the whole district.
 */
export async function findFieldOfficer(geo: GeoIds): Promise<FieldOfficer | null> {
  const f = await geoFilter("zone_officers", "o", geo);
  const rows = await queryRows<{ id: number; name: string; phone: string | null; upazila: string | null; district: string | null }>(
    `SELECT o.id, o.name, o.phone, o.upazila, o.district
       FROM zone_officers o
      WHERE o.is_active = 1 AND o.officer_role = 'field_officer'
        AND COALESCE(o.upazila_id, o.district_id, o.division_id) IS NOT NULL
        AND ${f.sql}
      ORDER BY (o.upazila_id <=> ?) DESC, (o.district_id <=> ?) DESC, o.id
      LIMIT 1`,
    [...f.params, geo.upazila_id, geo.district_id]
  );
  const o = rows[0];
  if (!o) return null;
  return {
    id: String(o.id),
    name: String(o.name),
    phone: String(o.phone ?? ""),
    area: String(o.upazila ?? o.district ?? "")
  };
}
