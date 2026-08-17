// The scorecard equivalent of ADM-RDY-02, for the same reason.
//
// scorecard_criteria is editable through the generic CRUD engine. The engine
// computes weight × (rating ÷ 5) and sums, so a model whose weights total 96
// still produces a score, a grade, a readiness status and a pathway — all of them
// wrong, all of them plausible, and applied to every application assessed
// afterwards. Nothing errors and nothing marks the affected assessments.
//
// So the invariant is enforced on write: an active or shadow model's active
// criteria must total exactly 100.00, and its grade thresholds must descend.

import { executeQuery, queryRows, type Tx } from "@/lib/db";

// weight is DECIMAL(6,2); compare as integer hundredths rather than floats.
const SCALE = 100;
const REQUIRED_TOTAL = 100 * SCALE;

export type ModelIntegrity = {
  model_id: number;
  version: string;
  status: string;
  active_criteria: number;
  total_weight: number;
  quantitative_weight: number;
  qualitative_weight: number;
  balanced: boolean;
  problems: string[];
};

type Row = {
  model_id: number;
  version: string;
  status: string;
  active_criteria: number;
  scaled_total: string | number | null;
  scaled_quant: string | number | null;
  scaled_qual: string | number | null;
  grade_a_min: string | number;
  grade_b_min: string | number;
  grade_c_min: string | number;
};

const num = (v: string | number | null | undefined) => Number(v ?? 0);

const SQL = `
  SELECT
    m.id AS model_id, m.version, m.status,
    COUNT(c.id) AS active_criteria,
    COALESCE(ROUND(SUM(c.weight) * ${SCALE}), 0) AS scaled_total,
    COALESCE(ROUND(SUM(IF(c.layer = 'quantitative', c.weight, 0)) * ${SCALE}), 0) AS scaled_quant,
    COALESCE(ROUND(SUM(IF(c.layer = 'qualitative',  c.weight, 0)) * ${SCALE}), 0) AS scaled_qual,
    m.grade_a_min, m.grade_b_min, m.grade_c_min
  FROM scorecard_models m
  LEFT JOIN scorecard_criteria c ON c.model_id = m.id AND c.is_active = 1
  WHERE m.status IN ('active', 'shadow')
  GROUP BY m.id, m.version, m.status, m.grade_a_min, m.grade_b_min, m.grade_c_min
`;

export async function inspectScorecardModels(tx: Tx): Promise<ModelIntegrity[]> {
  const rows = await tx.query<Row>(SQL);

  return rows.map((row) => {
    const scaled = num(row.scaled_total);
    const problems: string[] = [];

    if (Number(row.active_criteria) === 0) {
      problems.push("the model has no active criteria");
    } else if (scaled !== REQUIRED_TOTAL) {
      const delta = (scaled - REQUIRED_TOTAL) / SCALE;
      problems.push(
        `criterion weights total ${(scaled / SCALE).toFixed(2)}, not 100.00 ` +
          `(${delta > 0 ? "over" : "under"} by ${Math.abs(delta).toFixed(2)} across ${row.active_criteria} active criteria)`
      );
    }

    const a = Number(row.grade_a_min);
    const b = Number(row.grade_b_min);
    const c = Number(row.grade_c_min);
    if (!(a > b && b > c)) {
      problems.push(`grade thresholds must descend; got A≥${a}, B≥${b}, C≥${c}`);
    }

    return {
      model_id: Number(row.model_id),
      version: row.version,
      status: row.status,
      active_criteria: Number(row.active_criteria),
      total_weight: scaled / SCALE,
      quantitative_weight: num(row.scaled_quant) / SCALE,
      qualitative_weight: num(row.scaled_qual) / SCALE,
      balanced: problems.length === 0,
      problems,
    };
  });
}

export async function assertScorecardIntegrity(tx: Tx): Promise<void> {
  const broken = (await inspectScorecardModels(tx)).filter((m) => !m.balanced);
  if (broken.length === 0) return;

  const detail = broken.map((m) => `model ${m.version}: ${m.problems.join("; ")}`).join(" | ");
  throw new Error(
    `Change rejected and rolled back — it would leave a live scorecard model inconsistent. ${detail}. ` +
      "Every active or shadow model must have criterion weights totalling exactly 100.00 and descending grade thresholds."
  );
}

const poolTx: Tx = {
  query: <T,>(sql: string, values: unknown[] = []) => queryRows<T>(sql, values),
  execute: (sql: string, values: unknown[] = []) => executeQuery(sql, values),
};

export async function getScorecardIntegrity() {
  const models = await inspectScorecardModels(poolTx);
  return { ok: models.every((m) => m.balanced), required_total: 100, models };
}
