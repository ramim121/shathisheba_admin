import { queryRows } from "@/lib/db";
import { getAllGeoScopes } from "@/lib/geo-scope";

type Row = Record<string, unknown>;

/**
 * One farmer, everything the console needs to act for them.
 *
 * The staff job this exists for: a farmer phones the office, or a field officer
 * calls it in, and someone at a desk has to do what the app would have done —
 * put a cow up for sale, place an order, start a loan application. That used to
 * mean six screens and a lot of copying ids between them. This returns the
 * whole file in one read, including the reasons the platform would *refuse*
 * each of those actions, so the console can say so before the form is filled.
 */

export type FarmerBlock = {
  id: string;
  label: string;
  detail: string;
};

export async function searchFarmers(query?: string | null, limit = 20) {
  const q = String(query ?? "").trim();
  const like = `%${q}%`;
  const rows = await queryRows<Row>(
    `SELECT CAST(u.id AS CHAR) AS id,
            u.full_name,
            u.phone,
            u.status,
            u.is_kyc_verified,
            CONCAT_WS(' / ', NULLIF(u.district, ''), NULLIF(u.upazila, '')) AS area,
            (SELECT COUNT(*) FROM sale_listings l WHERE l.user_id = u.id) AS listings,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS orders,
            (SELECT COUNT(*) FROM loan_applications a
              WHERE a.user_id = u.id
                AND a.status NOT IN ('closed','withdrawn','cancelled','lender_declined','ineligible')) AS open_loans
       FROM app_users u
      WHERE (? = '' OR u.full_name LIKE ? OR u.phone LIKE ? OR CAST(u.id AS CHAR) = ?)
      ORDER BY (u.full_name LIKE ?) DESC, u.created_at DESC
      LIMIT ?`,
    [q, like, like, q, like, limit]
  );
  return { query: q, rows };
}

export async function getFarmerFile(userId?: string | null) {
  const id = String(userId ?? "").trim();
  if (!id) throw new Error("user_id is required.");

  const [profile] = await queryRows<Row>(
    `SELECT CAST(u.id AS CHAR) AS id, u.full_name, u.display_name, u.phone, u.email, u.gender,
            u.date_of_birth, u.nid_number, u.status, u.personal_info_completed, u.is_kyc_verified,
            u.learning_points, u.app_lang, u.village, u.union_name,
            u.division, u.district, u.upazila,
            CAST(u.division_id AS CHAR) AS division_id,
            CAST(u.district_id AS CHAR) AS district_id,
            CAST(u.upazila_id AS CHAR) AS upazila_id,
            u.created_at
       FROM app_users u WHERE u.id = ? LIMIT 1`,
    [id]
  );
  if (!profile) throw new Error("No farmer with that id.");

  const [banking] = await queryRows<Row>(
    `SELECT bank_name, branch_name, account_name, account_number, mobile_provider, mobile_account, notes
       FROM app_user_banking WHERE user_id = ? LIMIT 1`,
    [id]
  );
  const [farm] = await queryRows<Row>(
    `SELECT total_land_decimals, primary_focus, crop_types, livestock_count, pond_count, farm_address, notes
       FROM app_user_farm WHERE user_id = ? LIMIT 1`,
    [id]
  );
  const documents = await queryRows<Row>(
    `SELECT CAST(id AS CHAR) AS id, doc_type, status, note, document_url, created_at
       FROM app_user_kyc_documents WHERE user_id = ? ORDER BY id DESC`,
    [id]
  );
  const roles = await queryRows<Row>(
    `SELECT role FROM app_user_roles WHERE user_id = ? ORDER BY role`,
    [id]
  );
  const listings = await queryRows<Row>(
    `SELECT CAST(l.id AS CHAR) AS id, l.listing_code, l.title_en, l.status,
            l.weight_kg, l.farmer_expected_price, l.estimated_earning, l.created_at
       FROM sale_listings l WHERE l.user_id = ? ORDER BY l.id DESC LIMIT 8`,
    [id]
  );
  const orders = await queryRows<Row>(
    `SELECT CAST(o.id AS CHAR) AS id, o.order_code, o.payable_amount, o.payment_status,
            o.fulfillment_status, o.created_at
       FROM orders o WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 8`,
    [id]
  );
  const loans = await queryRows<Row>(
    `SELECT CAST(a.id AS CHAR) AS id, a.application_code, a.status, a.requested_amount,
            a.tenure_months, a.repayment_mode, p.name_en AS product, a.created_at
       FROM loan_applications a
       LEFT JOIN loan_products p ON p.id = a.loan_product_id
      WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 5`,
    [id]
  );
  const [readiness] = await queryRows<Row>(
    `SELECT score, grade, readiness_status, data_confidence, created_at
       FROM readiness_assessments WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [id]
  );
  const [posts] = await queryRows<Row>(
    `SELECT COUNT(*) AS n FROM community_posts WHERE user_id = ?`,
    [id]
  );

  // Officers covering this farmer, at whatever depth each feature is scoped to.
  const scopes = await getAllGeoScopes();
  const officers = await queryRows<Row>(
    `SELECT o.name, o.officer_role, o.phone
       FROM zone_officers o
      WHERE o.is_active = 1
        AND (o.upazila_id IS NULL OR o.upazila_id = ?)
        AND (o.district_id IS NULL OR o.district_id = ?)
        AND (o.division_id IS NULL OR o.division_id = ?)
        AND COALESCE(o.upazila_id, o.district_id, o.division_id) IS NOT NULL
      ORDER BY (o.upazila_id <=> ?) DESC LIMIT 4`,
    [profile.upazila_id, profile.district_id, profile.division_id, profile.upazila_id]
  );

  const activeLoan = loans.find(
    (l) => !["closed", "withdrawn", "cancelled", "lender_declined", "ineligible"].includes(String(l.status))
  );

  // What the platform would refuse, and why — checked here so the console can
  // grey the action out instead of letting an officer fill a form for two
  // minutes and then meet the error.
  const blockers: Record<"listing" | "order" | "loan", FarmerBlock[]> = { listing: [], order: [], loan: [] };
  const noArea = !profile.district_id;
  const noVillage = !String(profile.village ?? "").trim();

  if (noArea) {
    const b = { id: "no_area", label: "No district on the profile", detail: "Set the farmer's division, district and upazila before acting for them — every feature is scoped by area." };
    blockers.listing.push(b);
    blockers.order.push(b);
    blockers.loan.push(b);
  }
  if (String(profile.status) !== "active") {
    const b = { id: "not_active", label: `Profile status is "${String(profile.status)}"`, detail: "Only an active profile can transact." };
    blockers.listing.push(b);
    blockers.order.push(b);
    blockers.loan.push(b);
  }
  if (noVillage) {
    blockers.loan.push({ id: "no_village", label: "No village or address", detail: "A loan application needs the farmer's address on file." });
  }
  if (activeLoan) {
    blockers.loan.push({
      id: "active_loan",
      label: `Already has an open application (${String(activeLoan.application_code)})`,
      detail: "Close, withdraw or decide that one before starting another."
    });
  }
  if (!Number(profile.is_kyc_verified)) {
    blockers.loan.push({ id: "kyc", label: "KYC is not verified", detail: "The application can still be filed, but it will stop at the KYC step." });
  }

  return {
    profile,
    roles: roles.map((r) => String(r.role)),
    banking: banking ?? null,
    farm: farm ?? null,
    documents,
    listings,
    orders,
    loans,
    active_loan: activeLoan ?? null,
    readiness: readiness ?? null,
    community_posts: Number(posts?.n ?? 0),
    officers,
    scopes,
    blockers
  };
}
