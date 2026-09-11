import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";
import { buildAppUser } from "./auth";
import { EMPTY_GEO, resolveGeoIds, resolveGeoNames, toGeoId, type GeoResolved } from "@/lib/geo";

/**
 * The farmer's own profile, and the approval gate on changing it.
 *
 * The first save is applied immediately — it is onboarding, and nothing hangs
 * off the profile yet. Every save after that becomes a change request an admin
 * approves, because by then the profile's location decides what the farmer can
 * see and sell: moving yourself into another upazila would otherwise be a
 * one-tap way round every geographic lock in the platform. Until approval the
 * farmer's live profile, and therefore their area, is unchanged, and they
 * cannot stack a second request on top of a pending one.
 */

export class ChangePendingError extends Error {
  code = "change_pending";
}

const USER_COLS =
  "id, full_name, display_name, phone, gender, date_of_birth, division, district, upazila, profile_image_url, status, personal_info_completed, is_kyc_verified, nid_number, profile_json";

type RequestedProfile = {
  full_name: string;
  gender: string;
  date_of_birth: string | null;
  profile_image_url: string | null;
  village: string | null;
  latitude: number | null;
  longitude: number | null;
  geo: GeoResolved;
};

/** The comparable, storable face of a profile: everything a reviewer judges. */
type ProfileSnapshot = {
  full_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  profile_image_url: string | null;
  village: string | null;
  division_id: number | null;
  district_id: number | null;
  upazila_id: number | null;
  division: string | null;
  district: string | null;
  upazila: string | null;
  division_bn: string | null;
  district_bn: string | null;
  upazila_bn: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

function isoDay(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

async function readRequested(payload: Row): Promise<RequestedProfile> {
  const fullName = String(payload.full_name ?? payload.display_name ?? "").trim();
  const gender = String(payload.gender ?? "").trim();
  if (!fullName) throw new Error("Name is required.");
  if (!["male", "female", "other", "undisclosed"].includes(gender)) {
    throw new Error("A valid gender is required.");
  }

  const hasIds = Boolean(toGeoId(payload.division_id) || toGeoId(payload.district_id) || toGeoId(payload.upazila_id));
  const hasText = Boolean(payload.division || payload.district || payload.upazila);
  // Ids from the picker are the normal path. Names are accepted only so that
  // an older app build can still save; they are resolved, never stored as sent.
  const geo = hasIds ? await resolveGeoIds(payload) : hasText ? await resolveGeoNames(payload) : { ...EMPTY_GEO };
  if (!geo.division_id) throw new Error("Choose your area — at least your division.");

  const lat = payload.latitude != null && payload.latitude !== "" ? Number(payload.latitude) : null;
  const lng = payload.longitude != null && payload.longitude !== "" ? Number(payload.longitude) : null;
  return {
    full_name: fullName,
    gender,
    date_of_birth: isoDay(payload.date_of_birth),
    profile_image_url: String(payload.profile_image_url ?? "").trim() || null,
    village: payload.village == null ? null : String(payload.village).trim().slice(0, 160) || null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    geo
  };
}

function snapshotRequested(r: RequestedProfile, current: ProfileSnapshot): ProfileSnapshot {
  return {
    full_name: r.full_name,
    gender: r.gender,
    date_of_birth: r.date_of_birth,
    // An upload is optional on every save; no new image means "keep the old one".
    profile_image_url: r.profile_image_url ?? current.profile_image_url,
    // Older app builds never send a village; not sending one keeps the current.
    village: r.village ?? current.village,
    division_id: r.geo.division_id,
    district_id: r.geo.district_id,
    upazila_id: r.geo.upazila_id,
    division: r.geo.division,
    district: r.geo.district,
    upazila: r.geo.upazila,
    division_bn: r.geo.division_bn,
    district_bn: r.geo.district_bn,
    upazila_bn: r.geo.upazila_bn,
    latitude: r.latitude,
    longitude: r.longitude
  };
}

async function currentSnapshot(userId: unknown): Promise<(ProfileSnapshot & { completed: boolean }) | null> {
  const rows = await queryRows<Row>(
    `SELECT u.full_name, u.gender, u.date_of_birth, u.profile_image_url, u.personal_info_completed, u.village,
            u.division_id, u.district_id, u.upazila_id,
            v.name_en AS division, d.name_en AS district, z.name_en AS upazila,
            v.name_bn AS division_bn, d.name_bn AS district_bn, z.name_bn AS upazila_bn
       FROM app_users u
       LEFT JOIN geo_divisions v ON v.id = u.division_id
       LEFT JOIN geo_districts d ON d.id = u.district_id
       LEFT JOIN geo_upazilas z ON z.id = u.upazila_id
      WHERE u.id = ? LIMIT 1`,
    [userId]
  );
  const u = rows[0];
  if (!u) return null;
  const id = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    completed: Number(u.personal_info_completed ?? 0) === 1,
    full_name: (u.full_name as string) ?? null,
    gender: (u.gender as string) ?? null,
    date_of_birth: isoDay(u.date_of_birth),
    profile_image_url: (u.profile_image_url as string) ?? null,
    village: (u.village as string) ?? null,
    division_id: id(u.division_id),
    district_id: id(u.district_id),
    upazila_id: id(u.upazila_id),
    division: (u.division as string) ?? null,
    district: (u.district as string) ?? null,
    upazila: (u.upazila as string) ?? null,
    division_bn: (u.division_bn as string) ?? null,
    district_bn: (u.district_bn as string) ?? null,
    upazila_bn: (u.upazila_bn as string) ?? null
  };
}

const COMPARED: Array<keyof ProfileSnapshot> = [
  "full_name", "gender", "date_of_birth", "profile_image_url", "village", "division_id", "district_id", "upazila_id"
];

function changedFields(a: ProfileSnapshot, b: ProfileSnapshot): string[] {
  // Coordinates are deliberately not compared: the phone reports a slightly
  // different position on every save, and a request that exists only because
  // GPS drifted three metres is noise in a reviewer's queue.
  return COMPARED.filter((k) => String(a[k] ?? "") !== String(b[k] ?? ""));
}

type Exec = (sql: string, values: unknown[]) => Promise<unknown>;

async function applyToUser(exec: Exec, userId: unknown, p: ProfileSnapshot) {
  await exec(
    `UPDATE app_users
        SET full_name = ?, display_name = COALESCE(NULLIF(display_name, ''), ?),
            gender = ?, date_of_birth = ?,
            profile_image_url = COALESCE(?, profile_image_url),
            division_id = ?, district_id = ?, upazila_id = ?,
            division = ?, district = ?, upazila = ?, village = ?,
            latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude),
            personal_info_completed = 1
      WHERE id = ?`,
    [
      p.full_name, p.full_name, p.gender, p.date_of_birth, p.profile_image_url,
      p.division_id, p.district_id, p.upazila_id,
      p.division, p.district, p.upazila, p.village ?? null,
      p.latitude ?? null, p.longitude ?? null,
      userId
    ]
  );
}

async function loadAppUser(userId: unknown) {
  const rows = await queryRows<Row>(`SELECT ${USER_COLS} FROM app_users WHERE id = ? LIMIT 1`, [userId]);
  if (!rows[0]) throw new Error("User not found.");
  return buildAppUser(rows[0]);
}

// POST /api/v1/app/profile
export async function savePersonalInfo(payload: Row) {
  const userId = payload.user_id;
  if (!userId) throw new Error("user_id is required.");

  const requested = await readRequested(payload);
  const current = await currentSnapshot(userId);
  if (!current) throw new Error("User not found.");
  const next = snapshotRequested(requested, current);

  if (!current.completed) {
    await applyToUser((sql, v) => executeQuery(sql, v), userId, next);
    return { status: "saved", user: await loadAppUser(userId) };
  }

  const pending = await queryRows<Row>(
    "SELECT id FROM profile_change_requests WHERE user_id = ? AND status = 'pending' LIMIT 1",
    [userId]
  );
  if (pending[0]) {
    throw new ChangePendingError(
      "Your previous change is still being reviewed. You can send another once it has been approved or rejected."
    );
  }

  const diff = changedFields(current, next);
  if (diff.length === 0) {
    return { status: "unchanged", user: await loadAppUser(userId) };
  }

  const { completed: _completed, ...currentOnly } = current;
  await executeQuery(
    `INSERT INTO profile_change_requests (user_id, status, requested_json, current_json)
     VALUES (?, 'pending', ?, ?)`,
    [userId, JSON.stringify({ ...next, changed: diff }), JSON.stringify(currentOnly)]
  );
  return {
    status: "pending_review",
    request: await getMyChangeRequest(String(userId)),
    user: await loadAppUser(userId)
  };
}

function parse(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// GET /api/v1/app/profile/change-request
// The farmer's latest request, whatever its outcome. A rejection is shown with
// the reviewer's note until the farmer sends a new request.
export async function getMyChangeRequest(userId?: string | null) {
  if (!userId) return null;
  const rows = await queryRows<Row>(
    `SELECT id, status, requested_json, current_json, reviewer_note, created_at, reviewed_at
       FROM profile_change_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    status: String(r.status),
    requested: parse(r.requested_json),
    current: parse(r.current_json),
    reviewer_note: (r.reviewer_note as string) ?? null,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at ?? null
  };
}

// GET /api/v1/admin/profile-requests?status=pending
export async function listProfileChangeRequests(status?: string | null) {
  const wanted = ["pending", "approved", "rejected", "cancelled"].includes(String(status)) ? String(status) : null;
  const rows = await queryRows<Row>(
    `SELECT r.id, r.user_id, r.status, r.requested_json, r.current_json, r.reviewer_note,
            r.created_at, r.reviewed_at, u.full_name AS user_name, u.phone AS user_phone,
            a.name AS reviewer_name
       FROM profile_change_requests r
       JOIN app_users u ON u.id = r.user_id
       LEFT JOIN admin_users a ON a.id = r.reviewer_admin_id
      WHERE (? IS NULL OR r.status = ?)
      ORDER BY (r.status = 'pending') DESC, r.created_at DESC
      LIMIT 300`,
    [wanted, wanted]
  );
  return rows.map((r) => ({
    id: String(r.id),
    user_id: String(r.user_id),
    user_name: r.user_name,
    user_phone: r.user_phone,
    status: String(r.status),
    requested: parse(r.requested_json),
    current: parse(r.current_json),
    reviewer_note: r.reviewer_note ?? null,
    reviewer_name: r.reviewer_name ?? null,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at ?? null
  }));
}

// POST /api/v1/admin/profile-requests/review  { id, decision: approve|reject, note }
export async function reviewProfileChangeRequest(
  id: unknown,
  decision: unknown,
  note: unknown,
  adminId: unknown
) {
  const requestId = toGeoId(id);
  if (!requestId) throw new Error("A request id is required.");
  const verdict = String(decision);
  if (verdict !== "approve" && verdict !== "reject") throw new Error("Decision must be approve or reject.");
  const reviewerNote = String(note ?? "").trim().slice(0, 500) || null;
  if (verdict === "reject" && !reviewerNote) {
    throw new Error("Say why the change is rejected — the farmer is shown this note.");
  }

  const rows = await queryRows<Row>(
    "SELECT id, user_id, status, requested_json FROM profile_change_requests WHERE id = ? LIMIT 1",
    [requestId]
  );
  const request = rows[0];
  if (!request) throw new Error("That request does not exist.");
  if (request.status !== "pending") throw new Error(`That request has already been ${request.status}.`);

  const requested = parse(request.requested_json) as unknown as ProfileSnapshot;
  // Re-validated at approval time: the masters may have changed since the
  // request was made, and approval is when the change actually lands.
  const geo = verdict === "approve" ? await resolveGeoIds(requested) : null;

  await withTransaction(async (tx) => {
    // The claim and the apply are one unit. Claiming by a conditional UPDATE
    // means two reviewers acting at once cannot both apply the same request.
    const claim = await tx.execute(
      `UPDATE profile_change_requests
          SET status = ?, reviewer_admin_id = ?, reviewer_note = ?, reviewed_at = NOW()
        WHERE id = ? AND status = 'pending'`,
      [verdict === "approve" ? "approved" : "rejected", adminId ?? null, reviewerNote, requestId]
    );
    if (!claim.affectedRows) throw new Error("That request was reviewed by someone else a moment ago.");
    if (verdict === "approve" && geo) {
      await applyToUser((sql, v) => tx.execute(sql, v), request.user_id, {
        ...requested,
        division_id: geo.division_id,
        district_id: geo.district_id,
        upazila_id: geo.upazila_id,
        division: geo.division,
        district: geo.district,
        upazila: geo.upazila,
        division_bn: geo.division_bn,
        district_bn: geo.district_bn,
        upazila_bn: geo.upazila_bn
      });
    }
  });

  return { id: String(requestId), status: verdict === "approve" ? "approved" : "rejected", user_id: String(request.user_id) };
}
