import { queryRows } from "@/lib/db";
import type { Row } from "@/lib/endpoints/shared";
import { isoDay } from "@/lib/endpoints/loan-servicing";

/**
 * Farmer-facing progress trails.
 *
 * A listing and a project application are different objects with different
 * admin workflows, but from the farmer's side they are the same question:
 * "where has my thing got to, and what happens next?" Both therefore return
 * the same step shape, so one screen renders either.
 *
 * A step is `done`, `current` or `upcoming`. There is deliberately no
 * "failed" state inside the step list — a rejection ends the trail and is
 * reported on the envelope, because a farmer reading a red step three rows
 * down would not know whether the ones after it still apply.
 */

export type ProgressState = "done" | "current" | "upcoming";

export type ProgressStep = {
  key: string;
  index: number;
  title_en: string;
  title_bn: string;
  desc_en: string;
  desc_bn: string;
  state: ProgressState;
  /** The date this step happened, or is scheduled for. `null` while upcoming. */
  date: string | null;
  note: string | null;
};

function buildSteps(
  defs: Array<Omit<ProgressStep, "index" | "state">>,
  reachedIndex: number,
  terminal: boolean
): ProgressStep[] {
  return defs.map((def, i) => ({
    ...def,
    index: i + 1,
    // On a completed trail every step is done — there is no "current" left to
    // stand on.
    state: i < reachedIndex ? "done" : i === reachedIndex && !terminal ? "current" : "upcoming"
  }));
}

// ---------------------------------------------------------------------------
// Sale listing
// ---------------------------------------------------------------------------

// The four milestones a farmer is told about when they submit a listing. The
// database has more statuses than this (draft, cancelled); those never reach
// the progress screen because they are not stages of the same journey.
const LISTING_STAGE_BY_STATUS: Record<string, number> = {
  draft: 0,
  submitted: 1,
  field_verification: 2,
  active: 3,
  sold: 3,
  paid: 4,
  rejected: 1,
  cancelled: 1
};

// GET /api/v1/app/sale/listing-progress?listing_id=&user_id=
export async function getListingProgress(listingId?: string | null, userId?: string | null) {
  if (!listingId) return null;
  const rows = await queryRows<Row>(
    `
      SELECT CAST(l.id AS CHAR) AS id, l.listing_code, l.title_en, l.title_bn,
             l.status, l.weight_kg, l.meat_weight_kg, l.dressing_pct,
             l.quantity, l.unit, l.farmer_expected_price, l.estimated_earning,
             l.created_at, l.approved_at, l.field_visit_date, l.field_visit_note,
             l.verified_weight_kg, l.paid_at, l.paid_amount, l.payment_method,
             l.payment_reference, l.media_json,
             CAST(l.user_id AS CHAR) AS user_id,
             si.name_en AS item_name, si.name_bn AS item_name_bn,
             b.name_en AS breed_name, b.name_bn AS breed_name_bn,
             a.name_en AS animal_name, a.name_bn AS animal_name_bn,
             o.name AS officer_name, o.phone AS officer_phone, o.upazila AS officer_area
      FROM sale_listings l
      LEFT JOIN sale_items si ON si.id = l.sale_item_id
      LEFT JOIN animal_breeds b ON b.id = l.breed_id
      LEFT JOIN animals a ON a.id = l.animal_id
      LEFT JOIN zone_officers o
             ON o.district = l.district AND o.officer_role = 'field_officer' AND o.is_active = 1
      WHERE l.id = ? AND (? IS NULL OR l.user_id = ?)
      LIMIT 1
    `,
    [listingId, userId ?? null, userId ?? null]
  );
  const listing = rows[0];
  if (!listing) return null;

  const status = String(listing.status ?? "submitted");
  const rejected = status === "rejected" || status === "cancelled";
  const reached = LISTING_STAGE_BY_STATUS[status] ?? 1;
  const terminal = status === "paid" || rejected;

  const visitDate = isoDay(listing.field_visit_date);
  const steps = buildSteps(
    [
      {
        key: "submitted",
        title_en: "Submitted",
        title_bn: "জমা",
        desc_en: "Sent from the app",
        desc_bn: "অ্যাপ থেকে পাঠানো হয়েছে",
        date: isoDay(listing.created_at),
        note: null
      },
      {
        key: "field_visit",
        title_en: "Field verification",
        title_bn: "মাঠ যাচাই",
        // Once a date is set the farmer is told the date instead of the
        // three-day promise — a specific date is the more useful answer.
        desc_en: visitDate ? `Officer visiting on ${visitDate}` : "Officer within 3 working days",
        desc_bn: visitDate ? `কর্মকর্তা আসবেন ${visitDate}` : "কর্মকর্তা ৩ কর্মদিনে",
        date: visitDate,
        note: (listing.field_visit_note as string) ?? null
      },
      {
        key: "approved",
        title_en: "Approved",
        title_bn: "অনুমোদিত",
        desc_en: "Weight confirmed",
        desc_bn: "ওজন নিশ্চিত",
        date: isoDay(listing.approved_at),
        note: listing.verified_weight_kg ? `Verified ${listing.verified_weight_kg} kg` : null
      },
      {
        key: "paid",
        title_en: "Payment",
        title_bn: "পেমেন্ট",
        desc_en: "Cash or cheque",
        desc_bn: "নগদ বা চেক",
        date: isoDay(listing.paid_at),
        note: (listing.payment_reference as string) ?? null
      }
    ],
    reached,
    terminal
  );

  return {
    kind: "sale_listing" as const,
    listing,
    reference: listing.listing_code,
    status,
    rejected,
    steps,
    officer: listing.officer_name
      ? { name: listing.officer_name, phone: listing.officer_phone, area: listing.officer_area }
      : null
  };
}

// ---------------------------------------------------------------------------
// Project application
// ---------------------------------------------------------------------------

const APPLICATION_STAGE_BY_STATUS: Record<string, number> = {
  draft: 0,
  submitted: 1,
  needs_document: 1,
  officer_verification: 2,
  ready_to_approve: 3,
  approved: 4,
  rejected: 1
};

// GET /api/v1/app/projects/application-progress?application_id=&user_id=
export async function getProjectApplicationProgress(
  applicationId?: string | null,
  userId?: string | null
) {
  if (!applicationId) return null;
  const rows = await queryRows<Row>(
    `
      SELECT CAST(a.id AS CHAR) AS id, a.application_code, a.status, a.current_step,
             a.created_at, a.approved_at, a.field_visit_date, a.field_visit_note,
             a.docs_verified_at, a.contract_started_at, a.progress_note,
             CAST(a.user_id AS CHAR) AS user_id,
             CAST(a.partner_project_id AS CHAR) AS partner_project_id,
             p.name_en AS project_name, p.name_bn AS project_name_bn,
             p.project_code, p.steps_json, p.image_url,
             p.model_en, p.model_bn, p.duration_label,
             p.income_amount, p.income_label_en, p.income_label_bn,
             p.loan_partners_en, p.loan_partners_bn,
             o.name AS officer_name, o.phone AS officer_phone, o.upazila AS officer_area
      FROM partner_applications a
      JOIN partner_projects p ON p.id = a.partner_project_id
      LEFT JOIN app_users u ON u.id = a.user_id
      LEFT JOIN zone_officers o
             ON o.id = a.assigned_officer_id
             OR (a.assigned_officer_id IS NULL
                 AND o.officer_role = 'field_officer' AND o.is_active = 1
                 AND o.district = u.district)
      WHERE a.id = ? AND (? IS NULL OR a.user_id = ?)
      -- Without the ordering the unassigned-officer branch can match several
      -- officers in the district and LIMIT 1 would pick an arbitrary one over
      -- the one actually assigned.
      ORDER BY (o.id = a.assigned_officer_id) DESC, o.id
      LIMIT 1
    `,
    [applicationId, userId ?? null, userId ?? null]
  );
  const application = rows[0];
  if (!application) return null;

  const status = String(application.status ?? "submitted");
  const rejected = status === "rejected";
  const reached = APPLICATION_STAGE_BY_STATUS[status] ?? 1;
  const terminal = status === "approved" || rejected;

  // The project may carry its own wording (steps_json). Fall back to the
  // standard four so a project seeded without them still renders.
  const configured = Array.isArray(application.steps_json)
    ? (application.steps_json as Array<Record<string, string>>)
    : [];
  const visitDate = isoDay(application.field_visit_date);
  const dates = [
    isoDay(application.created_at),
    visitDate,
    isoDay(application.docs_verified_at),
    isoDay(application.contract_started_at) ?? isoDay(application.approved_at)
  ];
  const defaults = [
    {
      key: "submitted",
      title_en: "Submitted",
      title_bn: "জমা হয়েছে",
      desc_en: "NID and payment details verification",
      desc_bn: "এনআইডি ও পেমেন্ট তথ্য যাচাই"
    },
    {
      key: "field_visit",
      title_en: "Field officer visit",
      title_bn: "মাঠ কর্মকর্তার পরিদর্শন",
      desc_en: "A field officer visits your farm",
      desc_bn: "একজন মাঠ কর্মকর্তা আপনার খামারে আসবেন"
    },
    {
      key: "documents",
      title_en: "Document verification",
      title_bn: "কাগজপত্র যাচাই",
      desc_en: "Documents checked and the file submitted",
      desc_bn: "কাগজপত্র যাচাই করে ফাইল জমা দেওয়া হয়"
    },
    {
      key: "approved",
      title_en: "Approved — project begins",
      title_bn: "অনুমোদিত — প্রকল্প শুরু",
      desc_en: "Contract signed and input supply starts",
      desc_bn: "চুক্তি স্বাক্ষর ও উপকরণ সরবরাহ শুরু"
    }
  ];

  const steps = buildSteps(
    defaults.map((fallback, i) => {
      const cfg = configured[i] ?? {};
      return {
        key: cfg.key || fallback.key,
        title_en: cfg.title_en || fallback.title_en,
        title_bn: cfg.title_bn || fallback.title_bn,
        desc_en: cfg.desc_en || fallback.desc_en,
        desc_bn: cfg.desc_bn || fallback.desc_bn,
        date: dates[i] ?? null,
        note: i === 1 ? ((application.field_visit_note as string) ?? null) : null
      };
    }),
    reached,
    terminal
  );

  return {
    kind: "project_application" as const,
    application,
    reference: application.application_code,
    status,
    rejected,
    steps,
    note: (application.progress_note as string) ?? null,
    officer: application.officer_name
      ? { name: application.officer_name, phone: application.officer_phone, area: application.officer_area }
      : null
  };
}

// GET /api/v1/app/projects/mine?user_id=
// The farmer's own applications, newest first, with just enough of the project
// attached for a card.
export async function getMyProjectApplications(userId?: string | null) {
  if (!userId) return [];
  return queryRows<Row>(
    `
      SELECT CAST(a.id AS CHAR) AS id, a.application_code, a.status, a.current_step,
             a.created_at, a.approved_at, a.field_visit_date,
             CAST(a.partner_project_id AS CHAR) AS partner_project_id,
             p.name_en AS project_name, p.name_bn AS project_name_bn,
             p.project_code, p.image_url, p.duration_label,
             p.model_en, p.model_bn,
             p.income_amount, p.income_label_en, p.income_label_bn,
             p.is_active AS project_is_active, p.status AS project_status
      FROM partner_applications a
      JOIN partner_projects p ON p.id = a.partner_project_id
      WHERE a.user_id = ?
      ORDER BY a.created_at DESC
      LIMIT 100
    `,
    [userId]
  );
}
