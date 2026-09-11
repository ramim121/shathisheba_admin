import { queryRows } from "@/lib/db";

/**
 * Geography: division -> district -> upazila.
 *
 * Ids are the source of truth. Every table that holds a location stores
 * division_id / district_id / upazila_id with foreign keys to the geo masters;
 * the old division / district / upazila text columns are a display cache the
 * server writes from those ids, never an input.
 *
 * Two ways in:
 *   - resolveGeoIds: ids from a picker. The deepest one given decides the rest,
 *     so choosing an upazila fills its district and division, and a mismatched
 *     parent is an error rather than a silent correction.
 *   - resolveGeoNames: free text from a phone's reverse geocoder or a legacy
 *     row, matched against English, Bangla and every alias on file.
 */

export type GeoLevel = "division" | "district" | "upazila";
export const GEO_LEVELS: GeoLevel[] = ["division", "district", "upazila"];

export type GeoIds = {
  division_id: number | null;
  district_id: number | null;
  upazila_id: number | null;
};

export type GeoResolved = GeoIds & {
  division: string | null;
  district: string | null;
  upazila: string | null;
  division_bn: string | null;
  district_bn: string | null;
  upazila_bn: string | null;
};

type GeoRow = {
  division_id: number | null;
  district_id: number | null;
  upazila_id: number | null;
  division: string | null;
  district: string | null;
  upazila: string | null;
  division_bn: string | null;
  district_bn: string | null;
  upazila_bn: string | null;
};

export const EMPTY_GEO: GeoResolved = {
  division_id: null, district_id: null, upazila_id: null,
  division: null, district: null, upazila: null,
  division_bn: null, district_bn: null, upazila_bn: null
};

/** A positive integer id, or null for anything blank, zero or malformed. */
export function toGeoId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fromRow(row: GeoRow | undefined): GeoResolved {
  if (!row) return { ...EMPTY_GEO };
  return {
    division_id: row.division_id === null ? null : Number(row.division_id),
    district_id: row.district_id === null ? null : Number(row.district_id),
    upazila_id: row.upazila_id === null ? null : Number(row.upazila_id),
    division: row.division ?? null,
    district: row.district ?? null,
    upazila: row.upazila ?? null,
    division_bn: row.division_bn ?? null,
    district_bn: row.district_bn ?? null,
    upazila_bn: row.upazila_bn ?? null
  };
}

export class GeoError extends Error {
  code = "invalid_geo";
}

/**
 * Validates a set of ids and fills in the parents. The deepest id supplied is
 * authoritative: if a caller sends an upazila and a district it does not belong
 * to, that is a mistake worth reporting, not one to paper over.
 */
export async function resolveGeoIds(input: {
  division_id?: unknown;
  district_id?: unknown;
  upazila_id?: unknown;
}): Promise<GeoResolved> {
  const upazilaId = toGeoId(input.upazila_id);
  const districtId = toGeoId(input.district_id);
  const divisionId = toGeoId(input.division_id);

  let resolved: GeoResolved = { ...EMPTY_GEO };

  if (upazilaId) {
    const rows = await queryRows<GeoRow>(
      `SELECT u.id AS upazila_id, u.name_en AS upazila, u.name_bn AS upazila_bn,
              d.id AS district_id, d.name_en AS district, d.name_bn AS district_bn,
              v.id AS division_id, v.name_en AS division, v.name_bn AS division_bn
         FROM geo_upazilas u
         JOIN geo_districts d ON d.id = u.district_id
         JOIN geo_divisions v ON v.id = d.division_id
        WHERE u.id = ? LIMIT 1`,
      [upazilaId]
    );
    if (!rows[0]) throw new GeoError("That upazila does not exist.");
    resolved = fromRow(rows[0]);
  } else if (districtId) {
    const rows = await queryRows<GeoRow>(
      `SELECT NULL AS upazila_id, NULL AS upazila, NULL AS upazila_bn,
              d.id AS district_id, d.name_en AS district, d.name_bn AS district_bn,
              v.id AS division_id, v.name_en AS division, v.name_bn AS division_bn
         FROM geo_districts d
         JOIN geo_divisions v ON v.id = d.division_id
        WHERE d.id = ? LIMIT 1`,
      [districtId]
    );
    if (!rows[0]) throw new GeoError("That district does not exist.");
    resolved = fromRow(rows[0]);
  } else if (divisionId) {
    const rows = await queryRows<GeoRow>(
      `SELECT NULL AS upazila_id, NULL AS upazila, NULL AS upazila_bn,
              NULL AS district_id, NULL AS district, NULL AS district_bn,
              v.id AS division_id, v.name_en AS division, v.name_bn AS division_bn
         FROM geo_divisions v WHERE v.id = ? LIMIT 1`,
      [divisionId]
    );
    if (!rows[0]) throw new GeoError("That division does not exist.");
    resolved = fromRow(rows[0]);
  }

  if (districtId && resolved.district_id && districtId !== resolved.district_id) {
    throw new GeoError(`${resolved.upazila} is in ${resolved.district}, not the district that was selected.`);
  }
  if (divisionId && resolved.division_id && divisionId !== resolved.division_id) {
    throw new GeoError(`${resolved.district} is in ${resolved.division} division, not the division that was selected.`);
  }
  return resolved;
}

/** Strips the suffixes reverse geocoders and people add: "Dhaka Division", "Savar Upazila". */
function stripSuffix(text: string): string {
  return text
    .replace(/\s+(division|district|zila|zilla|upazila|upazilla|thana|city corporation|sadar upazila)$/i, "")
    .replace(/\s+(বিভাগ|জেলা|উপজেলা|থানা)$/u, "")
    .trim();
}

async function matchOne(level: GeoLevel, text: string, parentId: number | null): Promise<number | null> {
  const table = level === "division" ? "geo_divisions" : level === "district" ? "geo_districts" : "geo_upazilas";
  const parentCol = level === "district" ? "division_id" : level === "upazila" ? "district_id" : null;
  const candidates = Array.from(new Set([text.trim(), stripSuffix(text)])).filter(Boolean);
  for (const candidate of candidates) {
    const parentSql = parentCol && parentId ? ` AND g.${parentCol} = ?` : "";
    const params: unknown[] = [candidate, candidate, level, candidate];
    if (parentCol && parentId) params.push(parentId);
    const rows = await queryRows<{ id: number }>(
      `SELECT g.id FROM ${table} g
        WHERE (g.name_en = ? OR g.name_bn = ?
               OR g.id IN (SELECT geo_id FROM geo_aliases WHERE level = ? AND alias = ?))${parentSql}
        LIMIT 2`,
      params
    );
    // Ambiguous (an upazila name that exists in two districts, with no district
    // to disambiguate) resolves to nothing rather than to a guess.
    if (rows.length === 1) return Number(rows[0].id);
  }
  return null;
}

/**
 * Best-effort resolution of free text, deepest level first found. Returns as
 * far down the hierarchy as it can honestly get: an upazila only inside a
 * known district, since nine upazila names repeat across districts.
 */
export async function resolveGeoNames(input: {
  division?: unknown;
  district?: unknown;
  upazila?: unknown;
}): Promise<GeoResolved> {
  const division = String(input.division ?? "").trim();
  const district = String(input.district ?? "").trim();
  const upazila = String(input.upazila ?? "").trim();

  const divisionId = division ? await matchOne("division", division, null) : null;
  // A district name is unique nationally, so it can be matched without a
  // division — and a wrong division from the geocoder should not block it.
  let districtId = district ? await matchOne("district", district, divisionId) : null;
  if (!districtId && district && divisionId) districtId = await matchOne("district", district, null);
  const upazilaId = upazila && districtId ? await matchOne("upazila", upazila, districtId) : null;

  if (upazilaId) return resolveGeoIds({ upazila_id: upazilaId });
  if (districtId) return resolveGeoIds({ district_id: districtId });
  if (divisionId) return resolveGeoIds({ division_id: divisionId });
  return { ...EMPTY_GEO };
}

export type UpazilaSearchHit = {
  upazila_id: string;
  district_id: string;
  division_id: string;
  upazila: string;
  upazila_bn: string | null;
  district: string;
  district_bn: string | null;
  division: string;
  division_bn: string | null;
};

/** Upazila search across English, Bangla and aliases, with its whole hierarchy. */
export async function searchUpazilas(query: string, limit = 20): Promise<UpazilaSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const prefix = `${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return queryRows<UpazilaSearchHit>(
    `SELECT CAST(u.id AS CHAR) AS upazila_id, CAST(d.id AS CHAR) AS district_id, CAST(v.id AS CHAR) AS division_id,
            u.name_en AS upazila, u.name_bn AS upazila_bn,
            d.name_en AS district, d.name_bn AS district_bn,
            v.name_en AS division, v.name_bn AS division_bn
       FROM geo_upazilas u
       JOIN geo_districts d ON d.id = u.district_id
       JOIN geo_divisions v ON v.id = d.division_id
      WHERE u.name_en LIKE ? OR u.name_bn LIKE ?
         OR u.id IN (SELECT geo_id FROM geo_aliases WHERE level = 'upazila' AND alias LIKE ?)
      ORDER BY (u.name_en LIKE ? OR u.name_bn LIKE ?) DESC, u.name_en
      LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}`,
    [like, like, like, prefix, prefix]
  );
}

/**
 * The write-side shape for a table: the ids, plus the text cache for whichever
 * legacy text columns that table has. Text always comes from the masters.
 */
export function geoWriteFields(resolved: GeoResolved, textColumns: GeoLevel[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    division_id: resolved.division_id,
    district_id: resolved.district_id,
    upazila_id: resolved.upazila_id
  };
  for (const level of textColumns) out[level] = resolved[level];
  return out;
}

/**
 * Normalises any incoming location on a write. Ids win; legacy text is only
 * consulted when no id at all was sent (older app builds, admin imports), and
 * then only as input to resolution — never stored as typed.
 *
 * Returns the payload unchanged when it carries no location at all, so a PATCH
 * that edits a title does not wipe the row's area.
 */
export async function normaliseGeoPayload(
  payload: Record<string, unknown>,
  textColumns: GeoLevel[]
): Promise<Record<string, unknown>> {
  const hasIdKey = ["division_id", "district_id", "upazila_id"].some((k) => k in payload);
  const hasTextKey = textColumns.some((k) => k in payload);
  if (!hasIdKey && !hasTextKey) return payload;

  const next = { ...payload };
  for (const level of GEO_LEVELS) delete next[level];

  let resolved: GeoResolved;
  if (hasIdKey && (toGeoId(payload.division_id) || toGeoId(payload.district_id) || toGeoId(payload.upazila_id))) {
    resolved = await resolveGeoIds(payload);
  } else if (hasTextKey) {
    resolved = await resolveGeoNames(payload);
  } else {
    // Ids present but all blank: an explicit "no location".
    resolved = { ...EMPTY_GEO };
  }
  return { ...next, ...geoWriteFields(resolved, textColumns) };
}
