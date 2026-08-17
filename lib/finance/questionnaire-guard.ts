// ADM-RDY-02 — the readiness instrument must stay internally consistent.
//
// `readiness_questions` is edited through the generic CRUD engine, so a single
// mistyped weight used to be accepted silently. Nothing would error: the scoring
// engine normalises by the in-scope weight, so a set summing to 0.94 still
// produces a score, a grade and a status. It is simply the wrong score, and every
// assessment taken afterwards carries it. There is no signal, no failed request
// and no way to tell the affected rows apart later.
//
// So the invariant is enforced at write time instead. Every write to the
// questionnaire runs inside a transaction, this check runs after it, and a throw
// rolls the edit back — the editor gets a 400 explaining exactly what is wrong
// and the live instrument is never left in a state the engine would misread.

import { executeQuery, queryRows, type Tx } from "@/lib/db";

// weight is DECIMAL(5,4). Comparing the sum as an integer number of ten-thousandths
// avoids the float question entirely — 0.05 + 0.05 + ... is not reliably 1.0.
const SCALE = 10_000;

export type SetIntegrity = {
  set_id: number;
  version: string;
  status: string;
  active_questions: number;
  total_weight: number;
  core_weight: number;
  deep_weight: number;
  balanced: boolean;
  problems: string[];
};

type SetRow = {
  set_id: number;
  version: string;
  status: string;
  active_questions: number;
  scaled_total: string | number | null;
  scaled_core: string | number | null;
  scaled_deep: string | number | null;
};

type BranchRow = { version: string; sort_order: number; branch_parent_order: number };

const num = (value: string | number | null | undefined) => Number(value ?? 0);
const fmt = (scaled: number) => (scaled / SCALE).toFixed(4);

const SET_SQL = `
  SELECT
    s.id                                                AS set_id,
    s.version,
    s.status,
    COUNT(q.id)                                         AS active_questions,
    COALESCE(ROUND(SUM(q.weight) * ${SCALE}), 0)        AS scaled_total,
    COALESCE(ROUND(SUM(IF(q.part = 'core', q.weight, 0)) * ${SCALE}), 0) AS scaled_core,
    COALESCE(ROUND(SUM(IF(q.part = 'deep', q.weight, 0)) * ${SCALE}), 0) AS scaled_deep
  FROM readiness_question_sets s
  LEFT JOIN readiness_questions q ON q.set_id = s.id AND q.is_active = 1
  WHERE s.status = 'active'
  GROUP BY s.id, s.version, s.status
`;

// A branch question whose parent is missing (or inactive, or itself) can never be
// suppressed correctly: resolvePresentation looks the parent up by sort_order and
// silently presents the child unconditionally when it finds nothing.
const BRANCH_SQL = `
  SELECT s.version, q.sort_order, q.branch_parent_order
  FROM readiness_questions q
  JOIN readiness_question_sets s ON s.id = q.set_id AND s.status = 'active'
  WHERE q.is_active = 1
    AND q.branch_parent_order IS NOT NULL
    AND (
      q.branch_parent_order = q.sort_order
      OR NOT EXISTS (
        SELECT 1 FROM readiness_questions p
        WHERE p.set_id = q.set_id AND p.sort_order = q.branch_parent_order AND p.is_active = 1
      )
    )
`;

export async function inspectQuestionSets(tx: Tx): Promise<SetIntegrity[]> {
  const [sets, orphanBranches] = await Promise.all([
    tx.query<SetRow>(SET_SQL),
    tx.query<BranchRow>(BRANCH_SQL)
  ]);

  return sets.map((row) => {
    const scaledTotal = num(row.scaled_total);
    const problems: string[] = [];

    if (row.active_questions === 0) {
      problems.push("the active set has no active questions");
    } else if (scaledTotal !== SCALE) {
      const delta = (scaledTotal - SCALE) / SCALE;
      problems.push(
        `weights total ${fmt(scaledTotal)}, not 1.0000 ` +
          `(${delta > 0 ? "over" : "under"} by ${Math.abs(delta).toFixed(4)} across ${row.active_questions} active questions)`
      );
    }

    for (const branch of orphanBranches.filter((b) => b.version === row.version)) {
      problems.push(
        `question ${branch.sort_order} branches on question ${branch.branch_parent_order}, ` +
          "which is not an active question in this set"
      );
    }

    return {
      set_id: Number(row.set_id),
      version: row.version,
      status: row.status,
      active_questions: Number(row.active_questions),
      total_weight: scaledTotal / SCALE,
      core_weight: num(row.scaled_core) / SCALE,
      deep_weight: num(row.scaled_deep) / SCALE,
      balanced: problems.length === 0,
      problems
    };
  });
}

// Thrown as a plain Error on purpose: isDatabaseError() treats anything without
// mysql2's errno/sqlState as input validation, so the route answers 400 with this
// message rather than a generic 500.
export async function assertQuestionSetIntegrity(tx: Tx): Promise<void> {
  const broken = (await inspectQuestionSets(tx)).filter((set) => !set.balanced);
  if (broken.length === 0) return;

  const detail = broken
    .map((set) => `set ${set.version}: ${set.problems.join("; ")}`)
    .join(" | ");

  throw new Error(
    `Change rejected and rolled back — it would leave the live readiness instrument inconsistent. ${detail}. ` +
      "Every active question set must have weights totalling exactly 1.0000 and no branch pointing at a missing question."
  );
}

// The same inspection outside a transaction, so staff can see where the budget
// currently stands before they start editing rather than discovering it from a
// rejection. GET admin/loan/questionnaire/integrity.
const poolTx: Tx = {
  query: <T,>(sql: string, values: unknown[] = []) => queryRows<T>(sql, values),
  execute: (sql: string, values: unknown[] = []) => executeQuery(sql, values)
};

export async function getQuestionnaireIntegrity() {
  const sets = await inspectQuestionSets(poolTx);
  return {
    ok: sets.every((set) => set.balanced),
    required_total: 1,
    sets
  };
}
