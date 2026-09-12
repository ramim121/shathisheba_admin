// What "Clear Records" can wipe, shared by the API and the console page.
//
// This file holds no database import on purpose: the client page and the server
// endpoint both read it, so the checkbox list, the per-table labels and the wipe
// plan can never drift apart (they used to be copied by hand in two places).

export type DatasetKey =
  | "loan"
  | "readiness"
  | "orders"
  | "listings"
  | "projects"
  | "community"
  | "learning"
  | "notifications"
  | "profile_modules"
  | "preferences"
  | "sessions";

/** What the console offers, in the order it shows them. */
export const DATASETS: { key: DatasetKey; label: string; hint: string; defaultOn: boolean }[] = [
  { key: "loan", label: "Loan applications & accounts", hint: "Applications, evidence, assessments, development tasks, lender submissions, accounts and repayments", defaultOn: true },
  { key: "readiness", label: "Readiness checks", hint: "Self-declared assessments and their answers", defaultOn: true },
  { key: "sessions", label: "Sessions & one-time codes", hint: "Logs the phone out and clears pending OTPs", defaultOn: true },
  { key: "notifications", label: "Notifications & devices", hint: "Inbox messages, delivery log and registered phones for push", defaultOn: true },
  { key: "orders", label: "Buy orders", hint: "Orders, line items, status history, discounts and vouchers", defaultOn: false },
  { key: "listings", label: "Sale listings", hint: "Listings, field verification, contracts and payment confirmations", defaultOn: false },
  { key: "projects", label: "Partner projects", hint: "Project applications and ledgers", defaultOn: false },
  { key: "community", label: "Community activity", hint: "Posts and comments", defaultOn: false },
  { key: "learning", label: "Training progress", hint: "Completed content, points and quiz scores", defaultOn: false },
  { key: "profile_modules", label: "Banking, farm & KYC documents", hint: "Profile modules and pending profile-change requests — not the basic profile", defaultOn: false },
  { key: "preferences", label: "Category preferences", hint: "Selected interests", defaultOn: false },
];

/**
 * Every table a wipe touches, ordered so children go before their parents, with
 * the dataset that owns it. Each statement takes the user id as its only
 * parameter — either a direct `user_id` match or a subquery through the owning
 * record.
 */
export const WIPE_PLAN: { dataset: DatasetKey; table: string; sql: string }[] = [
  // --- Finance: loan ---------------------------------------------------------
  { dataset: "loan", table: "loan_repayment_schedule", sql:
    `DELETE FROM loan_repayment_schedule WHERE loan_account_id IN
       (SELECT id FROM loan_accounts WHERE user_id = ?)` },
  { dataset: "loan", table: "loan_repayments", sql:
    `DELETE FROM loan_repayments WHERE loan_account_id IN
       (SELECT id FROM loan_accounts WHERE user_id = ?)` },
  { dataset: "loan", table: "finance_notifications", sql: `DELETE FROM finance_notifications WHERE user_id = ?` },
  { dataset: "loan", table: "loan_accounts", sql: `DELETE FROM loan_accounts WHERE user_id = ?` },
  { dataset: "loan", table: "credit_assessment_criteria", sql:
    `DELETE FROM credit_assessment_criteria WHERE assessment_id IN
       (SELECT id FROM credit_assessments WHERE user_id = ?)` },
  { dataset: "loan", table: "development_plan_tasks", sql: `DELETE FROM development_plan_tasks WHERE user_id = ?` },
  { dataset: "loan", table: "lender_submissions", sql:
    `DELETE FROM lender_submissions WHERE application_id IN
       (SELECT id FROM loan_applications WHERE user_id = ?)` },
  { dataset: "loan", table: "lender_pack_access", sql:
    `DELETE FROM lender_pack_access WHERE application_id IN
       (SELECT id FROM loan_applications WHERE user_id = ?)` },
  { dataset: "loan", table: "credit_assessments", sql: `DELETE FROM credit_assessments WHERE user_id = ?` },
  { dataset: "loan", table: "mpoweru_sessions", sql: `DELETE FROM mpoweru_sessions WHERE user_id = ?` },
  { dataset: "loan", table: "loan_application_events", sql:
    `DELETE FROM loan_application_events WHERE application_id IN
       (SELECT id FROM loan_applications WHERE user_id = ?)` },
  { dataset: "loan", table: "loan_field_verifications", sql:
    `DELETE FROM loan_field_verifications WHERE application_id IN
       (SELECT id FROM loan_applications WHERE user_id = ?)` },
  { dataset: "loan", table: "loan_field_visits", sql:
    `DELETE FROM loan_field_visits WHERE application_id IN
       (SELECT id FROM loan_applications WHERE user_id = ?)` },
  { dataset: "loan", table: "loan_evidence", sql:
    `DELETE FROM loan_evidence WHERE application_id IN
       (SELECT id FROM loan_applications WHERE user_id = ?)` },
  { dataset: "loan", table: "loan_documents", sql:
    `DELETE FROM loan_documents WHERE application_id IN
       (SELECT id FROM loan_applications WHERE user_id = ?)` },
  { dataset: "loan", table: "loan_assets", sql:
    `DELETE FROM loan_assets WHERE application_id IN
       (SELECT id FROM loan_applications WHERE user_id = ?)` },
  { dataset: "loan", table: "loan_existing_debts", sql:
    `DELETE FROM loan_existing_debts WHERE application_id IN
       (SELECT id FROM loan_applications WHERE user_id = ?)` },
  { dataset: "loan", table: "loan_safeguards", sql:
    `DELETE FROM loan_safeguards WHERE application_id IN
       (SELECT id FROM loan_applications WHERE user_id = ?)` },
  { dataset: "loan", table: "loan_consents", sql: `DELETE FROM loan_consents WHERE user_id = ?` },
  { dataset: "loan", table: "loan_quotes", sql: `DELETE FROM loan_quotes WHERE user_id = ?` },
  { dataset: "loan", table: "loan_applications", sql: `DELETE FROM loan_applications WHERE user_id = ?` },

  // --- Finance: readiness ----------------------------------------------------
  { dataset: "readiness", table: "readiness_answers", sql:
    `DELETE FROM readiness_answers WHERE assessment_id IN
       (SELECT id FROM readiness_assessments WHERE user_id = ?)` },
  { dataset: "readiness", table: "readiness_assessments", sql: `DELETE FROM readiness_assessments WHERE user_id = ?` },

  // --- Marketplace: buying ---------------------------------------------------
  { dataset: "orders", table: "order_events", sql:
    `DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)` },
  { dataset: "orders", table: "order_promotions", sql: `DELETE FROM order_promotions WHERE user_id = ?` },
  { dataset: "orders", table: "user_vouchers", sql: `DELETE FROM user_vouchers WHERE user_id = ?` },
  { dataset: "orders", table: "order_items", sql:
    `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id = ?)` },
  // Decision snapshots are keyed by item, so they are cleared with the item
  // itself — otherwise the approvals diff compares against a deleted order.
  { dataset: "orders", table: "approval_snapshots", sql:
    `DELETE FROM approval_snapshots WHERE item_type = 'order'
       AND item_id IN (SELECT id FROM orders WHERE user_id = ?)` },
  { dataset: "orders", table: "orders", sql: `DELETE FROM orders WHERE user_id = ?` },

  // --- Marketplace: selling --------------------------------------------------
  { dataset: "listings", table: "payment_confirmations", sql:
    `DELETE FROM payment_confirmations WHERE sale_listing_id IN
       (SELECT id FROM sale_listings WHERE user_id = ?)` },
  { dataset: "listings", table: "listing_field_verifications", sql:
    `DELETE FROM listing_field_verifications WHERE listing_id IN
       (SELECT id FROM sale_listings WHERE user_id = ?)` },
  { dataset: "listings", table: "listing_contracts", sql:
    `DELETE FROM listing_contracts WHERE listing_id IN
       (SELECT id FROM sale_listings WHERE user_id = ?)` },
  { dataset: "listings", table: "approval_snapshots_listing", sql:
    `DELETE FROM approval_snapshots WHERE item_type = 'listing'
       AND item_id IN (SELECT id FROM sale_listings WHERE user_id = ?)` },
  { dataset: "listings", table: "sale_listings", sql: `DELETE FROM sale_listings WHERE user_id = ?` },

  // --- Partner projects ------------------------------------------------------
  { dataset: "projects", table: "project_ledgers", sql:
    `DELETE FROM project_ledgers WHERE partner_application_id IN
       (SELECT id FROM partner_applications WHERE user_id = ?)` },
  { dataset: "projects", table: "approval_snapshots_enrollment", sql:
    `DELETE FROM approval_snapshots WHERE item_type IN ('enrollment', 'kyc')
       AND item_id IN (SELECT id FROM partner_applications WHERE user_id = ?)` },
  { dataset: "projects", table: "partner_applications", sql: `DELETE FROM partner_applications WHERE user_id = ?` },

  // --- Community -------------------------------------------------------------
  { dataset: "community", table: "community_comments", sql: `DELETE FROM community_comments WHERE user_id = ?` },
  { dataset: "community", table: "community_posts", sql: `DELETE FROM community_posts WHERE user_id = ?` },

  // --- Learning --------------------------------------------------------------
  { dataset: "learning", table: "user_learning_progress", sql: `DELETE FROM user_learning_progress WHERE user_id = ?` },

  // --- Notifications ---------------------------------------------------------
  { dataset: "notifications", table: "user_notifications", sql: `DELETE FROM user_notifications WHERE user_id = ?` },
  { dataset: "notifications", table: "notification_outbox", sql: `DELETE FROM notification_outbox WHERE user_id = ?` },
  { dataset: "notifications", table: "push_devices", sql: `DELETE FROM push_devices WHERE user_id = ?` },

  // --- Profile modules and preferences ---------------------------------------
  { dataset: "profile_modules", table: "app_user_kyc_documents", sql: `DELETE FROM app_user_kyc_documents WHERE user_id = ?` },
  { dataset: "profile_modules", table: "app_user_banking", sql: `DELETE FROM app_user_banking WHERE user_id = ?` },
  { dataset: "profile_modules", table: "app_user_farm", sql: `DELETE FROM app_user_farm WHERE user_id = ?` },
  { dataset: "profile_modules", table: "profile_change_requests", sql: `DELETE FROM profile_change_requests WHERE user_id = ?` },
  { dataset: "preferences", table: "user_interests", sql: `DELETE FROM user_interests WHERE user_id = ?` },
];

/** Which dataset owns each table, derived from the plan. */
export const TABLE_DATASET: Record<string, DatasetKey> = {
  ...Object.fromEntries(WIPE_PLAN.map((s) => [s.table, s.dataset])),
  // Cleared outside the plan, in the same transaction.
  app_sessions: "sessions",
  app_otps: "sessions",
};

export const TABLE_LABEL: Record<string, string> = {
  loan_repayment_schedule: "Repayment schedule",
  loan_repayments: "Repayments",
  finance_notifications: "Loan reminders",
  loan_accounts: "Loan accounts",
  credit_assessment_criteria: "Assessment criteria scores",
  development_plan_tasks: "Development plan tasks",
  lender_submissions: "Lender submissions",
  lender_pack_access: "Lender pack access",
  credit_assessments: "Credit assessments",
  mpoweru_sessions: "mPowerU sessions",
  loan_application_events: "Loan timeline events",
  loan_field_verifications: "Loan field verification",
  loan_field_visits: "Loan field visits",
  loan_evidence: "Loan evidence",
  loan_documents: "Loan documents",
  loan_assets: "Declared assets",
  loan_existing_debts: "Declared debts",
  loan_safeguards: "Project safeguards",
  loan_consents: "Loan consents",
  loan_quotes: "Loan quotes",
  loan_applications: "Loan applications",
  readiness_answers: "Readiness answers",
  readiness_assessments: "Readiness checks",
  order_events: "Order status history",
  order_promotions: "Order discounts",
  user_vouchers: "Vouchers",
  order_items: "Order line items",
  approval_snapshots: "Order decision snapshots",
  orders: "Buy orders",
  payment_confirmations: "Payment confirmations",
  listing_field_verifications: "Listing field verification",
  listing_contracts: "Purchase contracts",
  approval_snapshots_listing: "Listing decision snapshots",
  sale_listings: "Sale listings",
  project_ledgers: "Project ledgers",
  approval_snapshots_enrollment: "Enrolment decision snapshots",
  partner_applications: "Project enrolments",
  community_comments: "Community comments",
  community_posts: "Community posts",
  user_learning_progress: "Training progress",
  user_notifications: "Notification inbox",
  notification_outbox: "Delivery log entries",
  push_devices: "Registered phones",
  app_user_kyc_documents: "KYC documents",
  app_user_banking: "Banking details",
  app_user_farm: "Farm information",
  profile_change_requests: "Profile change requests",
  user_interests: "Saved preferences",
  app_sessions: "Active sessions",
  app_otps: "One-time codes",
};
