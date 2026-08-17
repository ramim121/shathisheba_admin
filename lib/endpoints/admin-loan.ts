import { queryRows } from "@/lib/db";
import type { Row } from "./shared";

// Admin-side finance aggregates (/api/v1/admin/loan/*).
//
// ADM-LON-34 is explicit that every figure on a credit surface is queried from
// the database. The existing dashboard's static seed arrays (GAP-08) must not be
// repeated here: a plausible-looking fake number on a credit screen is worse
// than an empty state, because nobody can tell it is fake.

export async function getCreditDashboard() {
  const one = async (sql: string, params: unknown[] = []) => {
    const r = await queryRows<Row>(sql, params);
    return Number(r[0]?.n ?? 0);
  };

  // Pipeline — where every application currently sits.
  const byStatus = await queryRows<Row>(
    "SELECT status, COUNT(*) AS n FROM loan_applications GROUP BY status"
  );
  const statusMap: Record<string, number> = {};
  byStatus.forEach((r) => { statusMap[String(r.status)] = Number(r.n); });
  const sum = (...keys: string[]) => keys.reduce((s, k) => s + (statusMap[k] ?? 0), 0);

  const pipeline = {
    total: Object.values(statusMap).reduce((s, n) => s + n, 0),
    submitted: sum("submitted"),
    collecting: sum("kyc_in_progress", "field_verification"),
    assessing: sum("behavioral_pending", "under_assessment", "assessed"),
    with_lender: sum("pending_submission", "submitted_to_lender", "lender_review", "info_requested"),
    approved: sum("approved"),
    disbursed: sum("disbursed", "repaying"),
    declined: sum("lender_declined", "ineligible", "hard_stopped"),
    in_development: sum("development_required"),
  };

  // Risk — grade and confidence distribution across readiness checks. Once
  // Feature 2 assessments exist these come from credit_assessments instead.
  const grades = await queryRows<Row>(
    "SELECT grade, COUNT(*) AS n FROM readiness_assessments GROUP BY grade ORDER BY grade"
  );
  const confidence = await queryRows<Row>(
    "SELECT data_confidence AS level, COUNT(*) AS n FROM readiness_assessments GROUP BY data_confidence"
  );
  const readinessStatuses = await queryRows<Row>(
    "SELECT readiness_status AS status, COUNT(*) AS n FROM readiness_assessments GROUP BY readiness_status"
  );

  // Finance — requested against what has actually moved.
  const [money] = await queryRows<Row>(
    `SELECT
       COALESCE(SUM(requested_amount),0)   AS requested,
       COALESCE(SUM(recommended_amount),0) AS recommended,
       COALESCE(SUM(approved_amount),0)    AS approved
     FROM loan_applications`
  );
  const [portfolio] = await queryRows<Row>(
    `SELECT
       COALESCE(SUM(principal),0)          AS disbursed,
       COALESCE(SUM(outstanding_total),0)  AS outstanding,
       COALESCE(SUM(overdue_amount),0)     AS overdue,
       COUNT(*)                            AS accounts
     FROM loan_accounts WHERE status = 'active'`
  );

  // Performance — driven by real schedule rows (ADM-LON-50).
  const [repayment] = await queryRows<Row>(
    `SELECT
       COUNT(*)                                              AS due_rows,
       SUM(status = 'paid')                                  AS paid_rows,
       SUM(status = 'overdue')                               AS overdue_rows,
       COALESCE(AVG(NULLIF(days_overdue,0)),0)               AS avg_days_late
     FROM loan_repayment_schedule
     WHERE due_date <= CURDATE()`
  );
  const dueRows = Number(repayment?.due_rows ?? 0);
  const paidRows = Number(repayment?.paid_rows ?? 0);

  const par30 = await one(
    "SELECT COUNT(*) AS n FROM loan_accounts WHERE days_past_due BETWEEN 1 AND 30 AND status='active'");
  const par90 = await one(
    "SELECT COUNT(*) AS n FROM loan_accounts WHERE days_past_due > 90 AND status='active'");

  // Collections ticker (ADM-LON-49).
  const [collections] = await queryRows<Row>(
    `SELECT
       COALESCE(SUM(CASE WHEN due_date = CURDATE() AND status IN ('pending','due') THEN amount_due END),0) AS due_today,
       COALESCE(SUM(CASE WHEN due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
                          AND status IN ('pending','due') THEN amount_due END),0) AS due_this_week,
       COALESCE(SUM(CASE WHEN due_date < CURDATE() AND status IN ('pending','due','overdue','partial')
                         THEN amount_due - amount_paid END),0) AS overdue_amount
     FROM loan_repayment_schedule`
  );

  // Readiness funnel — the conversion story, and the warm-lead count.
  const readinessTotal = await one("SELECT COUNT(*) AS n FROM readiness_assessments");
  const readinessUsers = await one("SELECT COUNT(DISTINCT user_id) AS n FROM readiness_assessments");
  const converted = await one(
    `SELECT COUNT(DISTINCT r.user_id) AS n FROM readiness_assessments r
      WHERE EXISTS (SELECT 1 FROM loan_applications a WHERE a.user_id = r.user_id)`);
  const warmLeads = await one(
    `SELECT COUNT(*) AS n FROM (
       SELECT r.user_id FROM readiness_assessments r
        WHERE r.readiness_status IN ('bank_ready_indicative','conditionally_ready')
          AND NOT EXISTS (SELECT 1 FROM loan_applications a WHERE a.user_id = r.user_id)
        GROUP BY r.user_id
     ) AS w`);

  // The most common gaps — what the field team should be fixing at scale.
  const topGaps = await queryRows<Row>(
    `SELECT q.question_en AS gap, q.gap_en AS label, COUNT(*) AS n
       FROM readiness_answers a
       JOIN readiness_questions q ON q.id = a.question_id
      WHERE a.presented = 1 AND a.answer = 0
      GROUP BY q.id ORDER BY n DESC LIMIT 5`
  );

  return {
    pipeline,
    risk: {
      grades: grades.map((g) => ({ grade: g.grade, count: Number(g.n) })),
      confidence: confidence.map((c) => ({ level: c.level, count: Number(c.n) })),
      readiness_statuses: readinessStatuses.map((s) => ({ status: s.status, count: Number(s.n) })),
    },
    finance: {
      requested: Number(money?.requested ?? 0),
      recommended: Number(money?.recommended ?? 0),
      approved: Number(money?.approved ?? 0),
      disbursed: Number(portfolio?.disbursed ?? 0),
      outstanding: Number(portfolio?.outstanding ?? 0),
      overdue: Number(portfolio?.overdue ?? 0),
      active_accounts: Number(portfolio?.accounts ?? 0),
    },
    performance: {
      on_time_rate: dueRows ? Math.round((paidRows / dueRows) * 1000) / 10 : null,
      overdue_installments: Number(repayment?.overdue_rows ?? 0),
      avg_days_late: Math.round(Number(repayment?.avg_days_late ?? 0) * 10) / 10,
      par30,
      par90,
    },
    collections: {
      due_today: Number(collections?.due_today ?? 0),
      due_this_week: Number(collections?.due_this_week ?? 0),
      overdue_amount: Number(collections?.overdue_amount ?? 0),
    },
    readiness: {
      checks_taken: readinessTotal,
      distinct_users: readinessUsers,
      converted_to_application: converted,
      conversion_rate: readinessUsers ? Math.round((converted / readinessUsers) * 1000) / 10 : 0,
      warm_leads: warmLeads,
      top_gaps: topGaps.map((g) => ({ label: g.label ?? g.gap, count: Number(g.n) })),
    },
  };
}

// The applications queue with its KPI band. Paginated server-side (API-06).
export async function getLoanQueue(params: URLSearchParams) {
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const size = Math.min(200, Math.max(1, Number(params.get("page_size") ?? 25)));
  const offset = (page - 1) * size;

  const where: string[] = [];
  const args: unknown[] = [];
  const status = params.get("status");
  if (status) { where.push("a.status = ?"); args.push(status); }
  const district = params.get("district");
  if (district) { where.push("a.district = ?"); args.push(district); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await queryRows<Row>(
    `SELECT CAST(a.id AS CHAR) AS id, a.application_code, a.status, a.requested_amount,
            a.tenure_months, a.repayment_mode, a.district, a.created_at,
            u.full_name AS farmer, u.phone,
            p.name_en AS product, p.name_bn AS product_bn,
            DATEDIFF(NOW(), a.created_at) AS days_open
       FROM loan_applications a
       JOIN app_users u ON u.id = a.user_id
       JOIN loan_products p ON p.id = a.loan_product_id
       ${clause}
      ORDER BY a.created_at DESC
      LIMIT ${size} OFFSET ${offset}`,
    args
  );
  const [total] = await queryRows<Row>(
    `SELECT COUNT(*) AS n FROM loan_applications a ${clause}`, args
  );
  const [kpi] = await queryRows<Row>(
    `SELECT
       SUM(status IN ('submitted'))                                   AS awaiting_screening,
       SUM(status IN ('kyc_in_progress','field_verification'))         AS in_collection,
       SUM(status IN ('behavioral_pending','under_assessment'))        AS in_assessment,
       SUM(DATEDIFF(NOW(), created_at) > 5
           AND status NOT IN ('closed','withdrawn','cancelled','disbursed','repaying')) AS past_sla
     FROM loan_applications`
  );

  return {
    rows,
    kpi: {
      awaiting_screening: Number(kpi?.awaiting_screening ?? 0),
      in_collection: Number(kpi?.in_collection ?? 0),
      in_assessment: Number(kpi?.in_assessment ?? 0),
      past_sla: Number(kpi?.past_sla ?? 0),
    },
    page,
    page_size: size,
    total: Number(total?.n ?? 0),
  };
}
