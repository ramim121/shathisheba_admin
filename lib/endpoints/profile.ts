import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";
import { safeJson } from "./shared";
import { buildAppUser } from "./auth";

// The farmer's own record: personal information, banking, farm details, KYC
// documents and onboarding preferences.

export async function savePersonalInfo(payload: Row) {
  const userId = payload.user_id;
  const fullName = (payload.full_name ?? payload.display_name ?? "").toString().trim();
  const gender = (payload.gender ?? "").toString().trim();
  if (!userId) throw new Error("user_id is required.");
  if (!fullName) throw new Error("Name is required.");
  if (!["male", "female", "other", "undisclosed"].includes(gender)) {
    throw new Error("A valid gender is required.");
  }

  await executeQuery(
    `UPDATE app_users
       SET full_name = ?, display_name = COALESCE(NULLIF(?, ''), display_name, ?),
           gender = ?, date_of_birth = ?, profile_image_url = COALESCE(NULLIF(?, ''), profile_image_url),
           division = COALESCE(NULLIF(?, ''), division),
           district = COALESCE(NULLIF(?, ''), district),
           upazila = COALESCE(NULLIF(?, ''), upazila),
           latitude = COALESCE(?, latitude),
           longitude = COALESCE(?, longitude),
           personal_info_completed = 1
     WHERE id = ?`,
    [
      fullName,
      (payload.display_name ?? "").toString(),
      fullName,
      gender,
      (payload.date_of_birth ?? null) as string | null,
      (payload.profile_image_url ?? "").toString(),
      (payload.division ?? "").toString(),
      (payload.district ?? "").toString(),
      (payload.upazila ?? "").toString(),
      payload.latitude != null ? Number(payload.latitude) : null,
      payload.longitude != null ? Number(payload.longitude) : null,
      userId
    ]
  );

  const rows = await queryRows<Row>(
    "SELECT id, full_name, display_name, phone, gender, date_of_birth, division, district, upazila, profile_image_url, status, personal_info_completed, is_kyc_verified, nid_number, profile_json FROM app_users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (rows.length === 0) throw new Error("User not found.");
  return { user: await buildAppUser(rows[0]) };
}

// GET /api/v1/app/me?user_id=  -> current user with roles + onboarding gates.
export async function getAppMe(userId?: string | null) {
  if (!userId) throw new Error("user_id is required.");
  const rows = await queryRows<Row>(
    "SELECT id, full_name, display_name, phone, gender, date_of_birth, division, district, upazila, profile_image_url, status, personal_info_completed, is_kyc_verified, nid_number, profile_json FROM app_users WHERE id = ? LIMIT 1",
    [userId]
  );
  if (rows.length === 0) throw new Error("User not found.");
  return buildAppUser(rows[0]);
}

// --- Menu modules: banking, farm, KYC documents (app + admin) ---

export async function getUserBanking(userId?: string | null) {
  if (!userId) throw new Error("user_id is required.");
  const rows = await queryRows<Row>("SELECT * FROM app_user_banking WHERE user_id = ? LIMIT 1", [userId]);
  return rows[0] ?? null;
}

export async function saveUserBanking(payload: Row) {
  const userId = payload.user_id;
  if (!userId) throw new Error("user_id is required.");
  await executeQuery(
    `INSERT INTO app_user_banking (user_id, bank_name, branch_name, account_name, account_number, mobile_provider, mobile_account, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE bank_name=VALUES(bank_name), branch_name=VALUES(branch_name),
       account_name=VALUES(account_name), account_number=VALUES(account_number),
       mobile_provider=VALUES(mobile_provider), mobile_account=VALUES(mobile_account), notes=VALUES(notes)`,
    [
      userId,
      (payload.bank_name ?? null) as string | null,
      (payload.branch_name ?? null) as string | null,
      (payload.account_name ?? null) as string | null,
      (payload.account_number ?? null) as string | null,
      (payload.mobile_provider ?? null) as string | null,
      (payload.mobile_account ?? null) as string | null,
      (payload.notes ?? null) as string | null
    ]
  );
  return getUserBanking(String(userId));
}

export async function getUserFarm(userId?: string | null) {
  if (!userId) throw new Error("user_id is required.");
  const rows = await queryRows<Row>("SELECT * FROM app_user_farm WHERE user_id = ? LIMIT 1", [userId]);
  return rows[0] ?? null;
}

export async function saveUserFarm(payload: Row) {
  const userId = payload.user_id;
  if (!userId) throw new Error("user_id is required.");
  await executeQuery(
    `INSERT INTO app_user_farm (user_id, total_land_decimals, primary_focus, crop_types, livestock_count, pond_count, farm_address, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE total_land_decimals=VALUES(total_land_decimals), primary_focus=VALUES(primary_focus),
       crop_types=VALUES(crop_types), livestock_count=VALUES(livestock_count), pond_count=VALUES(pond_count),
       farm_address=VALUES(farm_address), notes=VALUES(notes)`,
    [
      userId,
      payload.total_land_decimals != null ? Number(payload.total_land_decimals) : null,
      (payload.primary_focus ?? null) as string | null,
      (payload.crop_types ?? null) as string | null,
      payload.livestock_count != null ? Number(payload.livestock_count) : null,
      payload.pond_count != null ? Number(payload.pond_count) : null,
      (payload.farm_address ?? null) as string | null,
      (payload.notes ?? null) as string | null
    ]
  );
  return getUserFarm(String(userId));
}

export async function getUserKycDocuments(userId?: string | null) {
  if (!userId) throw new Error("user_id is required.");
  return queryRows<Row>(
    "SELECT CAST(id AS CHAR) AS id, doc_type, document_url, status, note, created_at FROM app_user_kyc_documents WHERE user_id = ? ORDER BY created_at DESC",
    [userId]
  );
}

export async function addUserKycDocument(payload: Row) {
  const userId = payload.user_id;
  const url = (payload.document_url ?? "").toString();
  if (!userId) throw new Error("user_id is required.");
  if (!url) throw new Error("document_url is required.");
  const docType = (payload.doc_type ?? "other").toString();
  const result = await executeQuery(
    "INSERT INTO app_user_kyc_documents (user_id, doc_type, document_url, note) VALUES (?, ?, ?, ?)",
    [userId, docType, url, (payload.note ?? null) as string | null]
  );
  return { id: result.insertId, doc_type: docType, document_url: url, status: "pending" };
}


// POST /api/v1/app/preferences
// Persists onboarding selections for a user: a full snapshot into
// app_users.profile_json.preferences, plus matched rows into user_interests
// (matched by interest_categories slug / name_en / name_bn).
export async function saveUserPreferences(payload: Row) {
  const userId = payload.user_id;
  if (!userId) {
    throw new Error("user_id is required.");
  }
  // selection: array of tokens (slugs / english / bangla labels) the user picked.
  const selection: string[] = Array.isArray(payload.selection)
    ? (payload.selection as unknown[]).map((s) => String(s))
    : [];
  const snapshot = payload.snapshot ?? { categories: payload.categories ?? null, selection };

  const users = await queryRows<Row>("SELECT id, profile_json FROM app_users WHERE id = ? LIMIT 1", [userId]);
  if (users.length === 0) {
    throw new Error("User not found.");
  }
  const existingProfile = (typeof users[0].profile_json === "string"
    ? safeJson(users[0].profile_json)
    : (users[0].profile_json as Row | null)) ?? {};
  const mergedProfile = { ...existingProfile, preferences: snapshot, preferences_updated_at: new Date().toISOString() };

  await executeQuery("UPDATE app_users SET profile_json = ? WHERE id = ?", [JSON.stringify(mergedProfile), userId]);

  // App preference keys -> interest_categories slugs where they differ.
  const slugAliases: Record<string, string> = {
    cattle: "livestock-poultry",
    livestock: "livestock-poultry"
  };
  const aliased = selection.map((s) => slugAliases[s.toLowerCase()] ?? s);

  let matchedIds: number[] = [];
  if (aliased.length > 0) {
    const lowered = aliased.map((s) => s.toLowerCase());
    const placeholders = lowered.map(() => "?").join(", ");
    const matches = await queryRows<Row>(
      `
        SELECT id FROM interest_categories
        WHERE is_active = 1 AND (
          LOWER(slug) IN (${placeholders})
          OR LOWER(name_en) IN (${placeholders})
          OR name_bn IN (${selection.map(() => "?").join(", ")})
        )
      `,
      [...lowered, ...lowered, ...selection]
    );
    matchedIds = matches.map((m) => Number(m.id));
  }

  // Replace this user's interests with the matched set.
  await executeQuery("DELETE FROM user_interests WHERE user_id = ?", [userId]);
  for (const interestId of matchedIds) {
    await executeQuery(
      "INSERT IGNORE INTO user_interests (user_id, interest_category_id) VALUES (?, ?)",
      [userId, interestId]
    );
  }

  return {
    user_id: String(userId),
    saved_interest_count: matchedIds.length,
    snapshot_saved: true
  };
}

// POST /api/v1/community/posts/{id}/like
