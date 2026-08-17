// Seeds demo finance data so the admin screens and the mobile states render like
// the design instead of empty.
//
// Everything written here is marked with a DEMO tag in purpose_text / notes so it
// can be removed cleanly:  node scripts/seed-finance-demo.cjs --remove
//
// Scores are produced by the real engine rather than hard-coded, so the demo rows
// are internally consistent with the instrument.

const path = require("path");
const mysql = require("mysql2/promise");
const cfg = require("./_dbconfig.cjs");

const DEMO_TAG = "[demo seed]";
const remove = process.argv.includes("--remove");

// Mirrors the engine's scoring so the demo rows are consistent with the live
// instrument without importing TypeScript into a CommonJS script.
function score(questions, yesOrders, depth) {
  const inScope = questions.filter((q) => (depth === "full" ? true : q.part === "core"));
  const answered = new Map(questions.map((q) => [q.sort_order, yesOrders.includes(q.sort_order)]));
  const presented = [];
  const suppressed = [];
  for (const q of inScope) {
    if (q.branch_parent_order == null) { presented.push(q); continue; }
    const want = q.branch_show_when === "yes";
    if (answered.get(q.branch_parent_order) === want) presented.push(q);
    else suppressed.push(q);
  }
  const inScopeWeight = presented.reduce((s, q) => s + Number(q.weight), 0);
  const branchWeight = suppressed.reduce((s, q) => s + Number(q.weight), 0);
  const earned = presented.reduce((s, q) => s + (answered.get(q.sort_order) ? Number(q.weight) : 0), 0);
  const denom = inScopeWeight + branchWeight;
  const total = denom > 0 ? Math.round(((earned + 0.5 * branchWeight) / denom) * 10000) / 100 : 0;
  const pct = (cat) => {
    const inCat = presented.filter((q) => q.category === cat);
    const max = inCat.reduce((s, q) => s + Number(q.weight), 0);
    if (!max) return 0;
    const got = inCat.reduce((s, q) => s + (answered.get(q.sort_order) ? Number(q.weight) : 0), 0);
    return Math.round((got / max) * 10000) / 100;
  };
  const grade = total >= 80 ? "A" : total >= 70 ? "B" : total >= 60 ? "C" : "D";
  const gate = presented.some((q) => q.flag === "gate" && !answered.get(q.sort_order));
  const risk = presented.some((q) => q.flag === "risk" && !answered.get(q.sort_order));
  return {
    total, grade, gate, risk, presented, suppressed, answered,
    kyc: pct("kyc"), enterprise: pct("enterprise"), financial: pct("financial"),
    inScopeWeight, branchWeight,
  };
}

function statusFor(s, depth, confidence) {
  if (s.gate) return "currently_ineligible";
  if (s.risk) return "development_required";
  if (s.total >= 80 && confidence === "medium" && depth === "full") return "bank_ready_indicative";
  if (s.total >= 70) return "conditionally_ready";
  if (s.total >= 60 && s.enterprise >= 70) return "project_ready";
  return "development_required";
}

// Deliberately varied so every dashboard panel and grade colour has something in it.
const PROFILES = [
  { yes: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20], depth: "full",  signals: ["S1","S2","S3","S7"] },
  { yes: [1,2,3,4,7,8,10,14,15,16,17,18],                      depth: "full",  signals: ["S1","S2","S7"] },
  { yes: [1,2,3,4,7,9,11,14],                                  depth: "full",  signals: ["S2","S7"] },
  { yes: [1,2,3,4,7],                                          depth: "core",  signals: ["S2"] },
  { yes: [2,3,4,5,6,7,8,10,14,15,16,17,18,19,20],              depth: "full",  signals: ["S2","S3","S7"] }, // no NID -> gate
  { yes: [1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18,19,20],    depth: "full",  signals: ["S1","S2","S3","S4","S7"] }, // arrears
  { yes: [1,3,6,7,8,17],                                       depth: "full",  signals: ["S3"] },
];

const APPLICATIONS = [
  { product: "livestock",   amount: 120000, tenure: 12, mode: "monthly", purpose: "livestock_purchase", status: "field_verification",   days: 4 },
  { product: "general",     amount:  80000, tenure: 12, mode: "weekly",  purpose: "working_capital",    status: "kyc_in_progress",      days: 9 },
  { product: "cooperative", amount:  45000, tenure:  6, mode: "weekly",  purpose: "inputs",             status: "behavioral_pending",   days: 6 },
  { product: "general",     amount: 150000, tenure: 24, mode: "monthly", purpose: "expansion",          status: "under_assessment",     days: 3 },
  { product: "livestock",   amount:  60000, tenure:  6, mode: "monthly", purpose: "livestock_purchase", status: "submitted_to_lender",  days: 12 },
  { product: "general",     amount: 250000, tenure: 24, mode: "monthly", purpose: "equipment",          status: "submitted",            days: 1 },
];

(async () => {
  const conn = await mysql.createConnection(cfg);

  if (remove) {
    const [ev] = await conn.execute(
      `DELETE FROM loan_application_events WHERE application_id IN
        (SELECT id FROM loan_applications WHERE purpose_text LIKE ?)`, [`%${DEMO_TAG}%`]);
    const [co] = await conn.execute(
      `DELETE FROM loan_consents WHERE application_id IN
        (SELECT id FROM loan_applications WHERE purpose_text LIKE ?)`, [`%${DEMO_TAG}%`]);
    const [ap] = await conn.execute("DELETE FROM loan_applications WHERE purpose_text LIKE ?", [`%${DEMO_TAG}%`]);
    // Seeded checks carry a "-demo" suffix on the question-set version, which is
    // the only discriminator that survives without polluting the schema.
    const [rd] = await conn.execute(
      "DELETE FROM readiness_assessments WHERE question_set_version LIKE '%-demo'");
    console.log(`removed: ${ap.affectedRows} applications, ${co.affectedRows} consents, ${ev.affectedRows} events, ${rd.affectedRows} readiness rows`);
    await conn.end();
    return;
  }

  const [users] = await conn.query(
    "SELECT id, full_name, district, division, upazila FROM app_users ORDER BY id LIMIT 8");
  if (!users.length) throw new Error("No app_users to attach demo data to.");

  const [questions] = await conn.query(
    `SELECT q.id, q.sort_order, q.part, q.category, q.weight, q.flag, q.flag_code,
            q.branch_parent_order, q.branch_show_when
       FROM readiness_questions q
       JOIN readiness_question_sets s ON s.id = q.set_id AND s.status='active'
      ORDER BY q.sort_order`);
  const [[set]] = await conn.query("SELECT version FROM readiness_question_sets WHERE status='active' LIMIT 1");

  // ---- readiness checks -----------------------------------------------------
  let made = 0;
  for (let i = 0; i < PROFILES.length && i < users.length; i++) {
    const user = users[i];
    const p = PROFILES[i];
    const [[existing]] = await conn.query(
      "SELECT COUNT(*) n FROM readiness_assessments WHERE user_id = ?", [user.id]);
    if (Number(existing.n) > 0) continue;

    const s = score(questions, p.yes, p.depth);
    const confidence = p.depth === "full" && p.signals.length >= 3 && p.signals.includes("S1") ? "medium" : "low";
    const status = statusFor(s, p.depth, confidence);

    const [ins] = await conn.execute(
      `INSERT INTO readiness_assessments
        (user_id, question_set_version, depth, score, grade, readiness_status, data_confidence,
         signals_present, signal_count, kyc_pct, enterprise_pct, financial_pct,
         gate_triggered, gate_reason, risk_flag, in_scope_weight, branch_weight, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [user.id, `${set.version}-demo`, p.depth, s.total, s.grade, status, confidence,
       JSON.stringify(p.signals), p.signals.length, s.kyc, s.enterprise, s.financial,
       s.gate ? 1 : 0, s.gate ? "NO_NID" : null, s.risk ? "ARREARS" : null,
       s.inScopeWeight.toFixed(4), s.branchWeight.toFixed(4), i + 2]
    );
    for (const q of s.presented) {
      const yes = s.answered.get(q.sort_order) === true;
      await conn.execute(
        `INSERT INTO readiness_answers (assessment_id, question_id, part, answer, presented, branch_suppressed, rating, weighted_value)
         VALUES (?,?,?,?,1,0,?,?)`,
        [ins.insertId, q.id, q.part, yes ? 1 : 0, yes ? 5 : 0, yes ? Number(q.weight).toFixed(4) : "0.0000"]);
    }
    for (const q of s.suppressed) {
      await conn.execute(
        `INSERT INTO readiness_answers (assessment_id, question_id, part, answer, presented, branch_suppressed, rating, weighted_value)
         VALUES (?,?,?,NULL,0,1,0,?)`,
        [ins.insertId, q.id, q.part, (Number(q.weight) * 0.5).toFixed(4)]);
    }
    made++;
    console.log(`  readiness: ${user.full_name} -> ${s.total} ${s.grade} ${status} (${confidence})`);
  }

  // ---- loan applications ----------------------------------------------------
  const [products] = await conn.query("SELECT id, code FROM loan_products");
  const byCode = new Map(products.map((p) => [p.code, p.id]));
  const [consentTypes] = await conn.query(
    "SELECT consent_key, version FROM loan_consent_types WHERE is_required=1 AND collected_at_stage='apply'");

  let apps = 0;
  for (let i = 0; i < APPLICATIONS.length; i++) {
    const a = APPLICATIONS[i];
    const user = users[i % users.length];
    const code = `LON-APP-DEMO-${1786900 + i}`;
    const [[dupe]] = await conn.query(
      "SELECT COUNT(*) n FROM loan_applications WHERE application_code = ?", [code]);
    if (Number(dupe.n) > 0) continue;

    const [ins] = await conn.execute(
      `INSERT INTO loan_applications
        (application_code, user_id, loan_product_id, requested_amount, purpose_code, purpose_text,
         tenure_months, repayment_mode, status, division, district, upazila,
         submitted_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, DATE_SUB(NOW(), INTERVAL ? DAY), DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [code, user.id, byCode.get(a.product), a.amount, a.purpose, DEMO_TAG,
       a.tenure, a.mode, a.status, user.division, user.district, user.upazila, a.days, a.days]
    );
    for (const c of consentTypes) {
      await conn.execute(
        `INSERT INTO loan_consents (application_id, user_id, consent_key, consent_version, status, channel, acting_user_id, granted_at)
         VALUES (?,?,?,?, 'granted','app',?, DATE_SUB(NOW(), INTERVAL ? DAY))`,
        [ins.insertId, user.id, c.consent_key, c.version, user.id, a.days]);
    }
    // A short event trail so the mobile timeline has something to render.
    const trail = [
      ["submitted", "আবেদন জমা হয়েছে", "Application submitted", a.days],
      ["kyc_in_progress", "কাগজপত্র সংগ্রহ শুরু", "Document collection started", Math.max(0, a.days - 1)],
      ["field_verification", "মাঠ যাচাই নির্ধারিত", "Field verification scheduled", Math.max(0, a.days - 2)],
      ["behavioral_pending", "আচরণগত মূল্যায়ন প্রস্তুত", "Behavioural assessment ready", Math.max(0, a.days - 3)],
      ["under_assessment", "ঝুঁকি মূল্যায়ন চলছে", "Risk assessment in progress", Math.max(0, a.days - 4)],
      ["submitted_to_lender", "ব্যাংকে পাঠানো হয়েছে", "Sent to partner lender", Math.max(0, a.days - 5)],
    ];
    const upTo = trail.findIndex(([s]) => s === a.status);
    let prev = null;
    for (let k = 0; k <= (upTo < 0 ? 0 : upTo); k++) {
      const [to, bn, en, ago] = trail[k];
      await conn.execute(
        `INSERT INTO loan_application_events (application_id, from_status, to_status, actor_type, note_bn, note_en, created_at)
         VALUES (?,?,?, 'system', ?,?, DATE_SUB(NOW(), INTERVAL ? DAY))`,
        [ins.insertId, prev, to, bn, en, ago]);
      prev = to;
    }
    if (a.status === "behavioral_pending") {
      await conn.execute("UPDATE loan_applications SET pending_user_action='take_mpoweru' WHERE id = ?", [ins.insertId]);
    }
    apps++;
    console.log(`  application: ${code} ${a.product} ৳${a.amount.toLocaleString("en-IN")} -> ${a.status}`);
  }

  console.log(`\nseeded ${made} readiness checks and ${apps} loan applications`);
  console.log(`remove with: node ${path.basename(__filename)} --remove`);
  await conn.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
