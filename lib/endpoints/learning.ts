import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";

// Training modules: the category/module/content tree, quiz grading, progress
// marking and the points/level model behind the learner rankings.

// ── Learning / Training module (gamified: categories > modules(levels) > content) ─

type QuizQuestion = { q: string; options: string[]; answer: number };

function parseQuiz(raw: unknown): QuizQuestion[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && Array.isArray((x as { options?: unknown }).options))
    .map((x) => {
      const o = x as { q?: unknown; options: unknown[]; answer?: unknown };
      return { q: String(o.q ?? ""), options: o.options.map((op) => String(op)), answer: Number(o.answer ?? 0) };
    });
}

export function youtubeId(url?: string | null): string | null {
  if (!url) return null;
  const s = String(url);
  const m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/v\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
}

function levelFromPoints(points: number) {
  return Math.floor(points / 50) + 1;
}

async function preferredInterestSlugs(userId?: string | null): Promise<string[]> {
  if (!userId) return [];
  const rows = await queryRows<Row>(
    "SELECT ic.slug FROM user_interests ui JOIN interest_categories ic ON ic.id = ui.interest_category_id WHERE ui.user_id = ?",
    [userId]
  );
  return rows.map((r) => String(r.slug));
}

// GET /api/v1/app/learning/overview?user_id=1
// Training home: points, level, next content, and all categories with the
// user's preference flag + per-category completion counts.
export async function getAppLearningOverview(userId?: string | null) {
  const uid = userId ?? null;
  const cats = await queryRows<Row>(
    `
      SELECT CAST(c.id AS CHAR) AS id, c.slug, c.name_en, c.name_bn, c.emoji,
             c.description_en, c.description_bn, c.interest_slug, c.section,
             COUNT(DISTINCT m.id) AS module_count,
             COUNT(DISTINCT ct.id) AS content_count,
             COUNT(DISTINCT CASE WHEN p.status = 'completed' THEN ct.id END) AS completed_count
      FROM learning_categories c
      LEFT JOIN learning_modules m ON m.learning_category_id = c.id AND m.status = 'published'
      LEFT JOIN learning_contents ct ON ct.learning_module_id = m.id AND ct.status = 'published'
      LEFT JOIN user_learning_progress p ON p.learning_content_id = ct.id AND p.user_id = ?
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.sort_order, c.id
    `,
    [uid]
  );
  const preferred = new Set(await preferredInterestSlugs(uid));
  const categories = cats.map((c) => ({
    ...c,
    module_count: Number(c.module_count),
    content_count: Number(c.content_count),
    completed_count: Number(c.completed_count),
    preferred: preferred.has(String(c.interest_slug))
  }));
  // preference-first ordering
  categories.sort((a, b) => Number(b.preferred) - Number(a.preferred));

  let points = 0;
  if (uid) {
    const u = await queryRows<Row>("SELECT learning_points FROM app_users WHERE id = ?", [uid]);
    points = Number(u[0]?.learning_points ?? 0);
  }

  let next: Row | null = null;
  if (uid) {
    const nx = await queryRows<Row>(
      `
        SELECT CAST(ct.id AS CHAR) AS id, ct.title_en, ct.title_bn, ct.content_type,
               m.title_en AS module_title, CAST(m.id AS CHAR) AS module_id, m.level,
               c.name_en AS category_name, CAST(c.id AS CHAR) AS category_id, c.interest_slug
        FROM learning_contents ct
        JOIN learning_modules m ON m.id = ct.learning_module_id AND m.status = 'published'
        JOIN learning_categories c ON c.id = m.learning_category_id AND c.is_active = 1
        LEFT JOIN user_learning_progress p ON p.learning_content_id = ct.id AND p.user_id = ?
        WHERE ct.status = 'published' AND (p.status IS NULL OR p.status <> 'completed')
        ORDER BY m.level, ct.sort_order, ct.id
        LIMIT 20
      `,
      [uid]
    );
    next = nx.find((r) => preferred.has(String(r.interest_slug))) ?? nx[0] ?? null;
  }

  const totalContent = categories.reduce((s, c) => s + c.content_count, 0);
  const totalCompleted = categories.reduce((s, c) => s + c.completed_count, 0);
  return {
    points,
    level: levelFromPoints(points),
    total_content: totalContent,
    completed_content: totalCompleted,
    next,
    categories
  };
}

// GET /api/v1/app/learning/modules?category_id=1&user_id=1
// Subcategories (modules) within a category, with level + completion.
export async function getAppLearningCategoryModules(categoryId?: string | null, userId?: string | null) {
  if (!categoryId) return [];
  const rows = await queryRows<Row>(
    `
      SELECT CAST(m.id AS CHAR) AS id, m.title_en, m.title_bn, m.subtitle_en, m.subtitle_bn,
             m.level, m.emoji,
             COUNT(DISTINCT ct.id) AS content_count,
             COUNT(DISTINCT CASE WHEN p.status = 'completed' THEN ct.id END) AS completed_count,
             COALESCE(SUM(ct.points), 0) AS total_points
      FROM learning_modules m
      LEFT JOIN learning_contents ct ON ct.learning_module_id = m.id AND ct.status = 'published'
      LEFT JOIN user_learning_progress p ON p.learning_content_id = ct.id AND p.user_id = ?
      WHERE m.learning_category_id = ? AND m.status = 'published'
      GROUP BY m.id
      ORDER BY m.level, m.sort_order, m.id
    `,
    [userId ?? null, categoryId]
  );
  return rows.map((r) => ({
    ...r,
    level: Number(r.level),
    content_count: Number(r.content_count),
    completed_count: Number(r.completed_count),
    total_points: Number(r.total_points)
  }));
}

// GET /api/v1/app/learning/contents?module_id=1&user_id=1
// Article + video cards within a subcategory, with per-user progress.
export async function getAppLearningModuleContents(moduleId?: string | null, userId?: string | null) {
  if (!moduleId) return [];
  const rows = await queryRows<Row>(
    `
      SELECT CAST(ct.id AS CHAR) AS id, ct.content_type, ct.title_en, ct.title_bn,
             ct.points, ct.image_url, ct.duration_seconds,
             LEFT(COALESCE(ct.body_en, ''), 160) AS excerpt,
             ct.video_url IS NOT NULL AS has_video,
             ct.quiz_json IS NOT NULL AS has_quiz,
             ct.sort_order,
             COALESCE(p.status, 'not_started') AS status,
             COALESCE(p.progress_pct, 0) AS progress_pct,
             p.quiz_score, COALESCE(p.quiz_passed, 0) AS quiz_passed
      FROM learning_contents ct
      LEFT JOIN user_learning_progress p ON p.learning_content_id = ct.id AND p.user_id = ?
      WHERE ct.learning_module_id = ? AND ct.status = 'published'
      ORDER BY ct.sort_order, ct.id
    `,
    [userId ?? null, moduleId]
  );
  return rows.map((r) => ({
    ...r,
    points: Number(r.points),
    progress_pct: Number(r.progress_pct),
    has_quiz: Number(r.has_quiz) === 1,
    has_video: Number(r.has_video) === 1,
    completed: r.status === "completed"
  }));
}

// GET /api/v1/app/learning/content?id=1&user_id=1
// Full content for the reader/player. Quiz answers are NOT included (grading
// happens server-side via submit-quiz).
export async function getAppLearningContent(contentId?: string | null, userId?: string | null) {
  if (!contentId) return null;
  const rows = await queryRows<Row>(
    `
      SELECT CAST(ct.id AS CHAR) AS id, ct.content_type, ct.title_en, ct.title_bn,
             ct.body_en, ct.body_bn, ct.video_url, ct.duration_seconds, ct.points,
             ct.image_url, ct.summary_en, ct.summary_bn, ct.quiz_json,
             CAST(ct.learning_module_id AS CHAR) AS module_id,
             m.title_en AS module_title, m.level,
             c.name_en AS category_name, CAST(c.id AS CHAR) AS category_id,
             COALESCE(p.status, 'not_started') AS status,
             COALESCE(p.progress_pct, 0) AS progress_pct,
             p.quiz_score, COALESCE(p.quiz_passed, 0) AS quiz_passed
      FROM learning_contents ct
      JOIN learning_modules m ON m.id = ct.learning_module_id
      JOIN learning_categories c ON c.id = m.learning_category_id
      LEFT JOIN user_learning_progress p ON p.learning_content_id = ct.id AND p.user_id = ?
      WHERE ct.id = ?
      LIMIT 1
    `,
    [userId ?? null, contentId]
  );
  const row = rows[0];
  if (!row) return null;
  const quiz = parseQuiz(row.quiz_json);
  return {
    ...row,
    points: Number(row.points),
    progress_pct: Number(row.progress_pct),
    quiz_passed: Number(row.quiz_passed) === 1,
    youtube_id: youtubeId(row.video_url as string | null),
    has_quiz: quiz.length > 0,
    // strip answers — only questions + options reach the client
    quiz: quiz.map((q) => ({ q: q.q, options: q.options })),
    quiz_json: undefined
  };
}

async function completeContent(
  uid: string,
  contentId: string,
  points: number,
  fields: { progress_pct?: number; quiz_score?: number | null; quiz_passed?: number }
) {
  const existing = await queryRows<Row>(
    "SELECT status, points_awarded FROM user_learning_progress WHERE user_id = ? AND learning_content_id = ?",
    [uid, contentId]
  );
  const alreadyCompleted = existing[0]?.status === "completed";
  const newAward = alreadyCompleted ? 0 : points;
  await executeQuery(
    `
      INSERT INTO user_learning_progress
        (user_id, learning_content_id, status, completed_at, progress_pct, points_awarded, quiz_score, quiz_passed)
      VALUES (?, ?, 'completed', NOW(), ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = 'completed',
        completed_at = IFNULL(completed_at, NOW()),
        progress_pct = GREATEST(progress_pct, VALUES(progress_pct)),
        points_awarded = GREATEST(points_awarded, VALUES(points_awarded)),
        quiz_score = VALUES(quiz_score),
        quiz_passed = VALUES(quiz_passed)
    `,
    [uid, contentId, fields.progress_pct ?? 100, points, fields.quiz_score ?? null, fields.quiz_passed ?? 0]
  );
  if (newAward > 0) {
    await executeQuery("UPDATE app_users SET learning_points = learning_points + ? WHERE id = ?", [newAward, uid]);
  }
  const tp = await queryRows<Row>("SELECT learning_points FROM app_users WHERE id = ?", [uid]);
  const totalPoints = Number(tp[0]?.learning_points ?? 0);
  return { completed: true, points_awarded: newAward, total_points: totalPoints, level: levelFromPoints(totalPoints) };
}

// POST /api/v1/app/learning/progress { user_id, content_id, progress_pct }
// Video watch tracking. Completes (and awards points once) at >=90% for video,
// or at 100% for an article that has no quiz.
export async function markLearningProgress(payload: Row) {
  const uid = String(payload.user_id ?? "");
  const contentId = String(payload.content_id ?? "");
  if (!uid || !contentId) throw new Error("user_id and content_id are required.");
  const pct = Math.max(0, Math.min(100, Number(payload.progress_pct ?? 0)));
  const rows = await queryRows<Row>(
    "SELECT content_type, points, quiz_json FROM learning_contents WHERE id = ?",
    [contentId]
  );
  const content = rows[0];
  if (!content) throw new Error("Content not found.");
  const points = Number(content.points ?? 0);
  const hasQuiz = content.quiz_json != null;

  const completes =
    (content.content_type === "video" && pct >= 90) ||
    (content.content_type === "article" && !hasQuiz && pct >= 100);

  if (completes) {
    return completeContent(uid, contentId, points, { progress_pct: pct });
  }

  await executeQuery(
    `
      INSERT INTO user_learning_progress (user_id, learning_content_id, status, progress_pct)
      VALUES (?, ?, 'in_progress', ?)
      ON DUPLICATE KEY UPDATE
        status = IF(status = 'completed', 'completed', 'in_progress'),
        progress_pct = GREATEST(progress_pct, VALUES(progress_pct))
    `,
    [uid, contentId, pct]
  );
  return { completed: false, progress_pct: pct };
}

// POST /api/v1/app/learning/submit-quiz { user_id, content_id, answers: number[] }
// Grades against stored answers. >=80% marks the content completed + awards points.
export async function submitLearningQuiz(payload: Row) {
  const uid = String(payload.user_id ?? "");
  const contentId = String(payload.content_id ?? "");
  if (!uid || !contentId) throw new Error("user_id and content_id are required.");
  const answers = Array.isArray(payload.answers) ? (payload.answers as unknown[]).map((a) => Number(a)) : [];
  const rows = await queryRows<Row>("SELECT points, quiz_json FROM learning_contents WHERE id = ?", [contentId]);
  const content = rows[0];
  if (!content) throw new Error("Content not found.");
  const quiz = parseQuiz(content.quiz_json);
  if (quiz.length === 0) throw new Error("This content has no quiz.");

  let correct = 0;
  quiz.forEach((question, i) => {
    if (answers[i] === question.answer) correct += 1;
  });
  const total = quiz.length;
  const score = Math.round((correct / total) * 100);
  const passed = score >= 80;
  const points = Number(content.points ?? 0);

  if (passed) {
    const done = await completeContent(uid, contentId, points, { progress_pct: 100, quiz_score: score, quiz_passed: 1 });
    return { passed: true, score, correct, total, ...done };
  }

  await executeQuery(
    `
      INSERT INTO user_learning_progress (user_id, learning_content_id, status, progress_pct, quiz_score, quiz_passed)
      VALUES (?, ?, 'in_progress', 100, ?, 0)
      ON DUPLICATE KEY UPDATE
        status = IF(status = 'completed', 'completed', 'in_progress'),
        quiz_score = VALUES(quiz_score),
        quiz_passed = quiz_passed
    `,
    [uid, contentId, score]
  );
  const tp = await queryRows<Row>("SELECT learning_points FROM app_users WHERE id = ?", [uid]);
  return { passed: false, score, correct, total, points_awarded: 0, total_points: Number(tp[0]?.learning_points ?? 0) };
}

// GET /api/v1/app/learning/user-progress?user_id=1  (admin viewer + app history)
export async function getUserLearningProgress(userId?: string | null) {
  if (!userId) return [];
  return queryRows<Row>(
    `
      SELECT CAST(p.learning_content_id AS CHAR) AS content_id, ct.title_en, ct.content_type,
             m.title_en AS module_title, c.name_en AS category_name,
             p.status, p.progress_pct, p.quiz_score, p.quiz_passed, p.points_awarded, p.completed_at
      FROM user_learning_progress p
      JOIN learning_contents ct ON ct.id = p.learning_content_id
      JOIN learning_modules m ON m.id = ct.learning_module_id
      JOIN learning_categories c ON c.id = m.learning_category_id
      WHERE p.user_id = ?
      ORDER BY p.updated_at DESC, p.completed_at DESC
    `,
    [userId]
  );
}

// GET /api/v1/app/learning/progress-overview  (admin: all users' learning stats)
export async function getLearningProgressOverview() {
  return queryRows<Row>(
    `
      SELECT CAST(u.id AS CHAR) AS user_id, u.full_name, u.phone, u.learning_points,
             COUNT(CASE WHEN p.status = 'completed' THEN 1 END) AS completed,
             COUNT(p.learning_content_id) AS attempted,
             ROUND(AVG(p.quiz_score), 0) AS avg_quiz
      FROM app_users u
      LEFT JOIN user_learning_progress p ON p.user_id = u.id
      GROUP BY u.id
      HAVING attempted > 0 OR u.learning_points > 0
      ORDER BY u.learning_points DESC, completed DESC
      LIMIT 200
    `
  );
}

// GET /api/v1/app/sale/my-listings?user_id=
// A seller's own listings with approval status — shown in the app's My Listings
// screen (submitted/field_verification = pending; active = approved; etc).
