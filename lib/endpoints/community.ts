import { executeQuery, queryRows, withTransaction } from "@/lib/db";
import type { Row } from "./shared";
import { moderatePostText } from "@/lib/gemini";

// Community feed: likes, the moderation queue, and the Gemini-assisted
// flagging the console uses. AI output is advisory — it never removes a post
// on its own.

export async function likePost(id: string) {
  const result = await executeQuery(
    "UPDATE community_posts SET like_count = like_count + 1 WHERE id = ?",
    [id]
  );
  const rows = await queryRows<Row>("SELECT like_count FROM community_posts WHERE id = ?", [id]);
  return { post_id: id, like_count: Number(rows[0]?.like_count ?? 0), affected: result.affectedRows };
}

// ── Community moderation (admin backend) ────────────────────────────────────

// GET /api/v1/app/community/moderation?filter=all|flagged|official|hidden
// Full post list for the admin moderation panel, including the Gemini verdict.
export async function getCommunityModeration(filter?: string | null) {
  let where = "1=1";
  if (filter === "flagged") where = "(p.ai_flag IN ('review','remove') OR p.report_count > 0)";
  else if (filter === "official") where = "p.is_official = 1";
  else if (filter === "hidden") where = "p.status IN ('hidden','removed','moderation')";
  return queryRows<Row>(
    `
      SELECT CAST(p.id AS CHAR) AS id, u.full_name AS author, CAST(p.user_id AS CHAR) AS user_id,
             p.post_type, p.scope, p.body, p.image_url, p.is_official,
             p.like_count, p.comment_count, p.report_count, p.status,
             p.ai_flag, p.ai_reason, p.ai_checked_at, p.district, p.upazila, p.created_at
      FROM community_posts p
      JOIN app_users u ON u.id = p.user_id
      WHERE ${where}
      ORDER BY p.is_official DESC,
               FIELD(p.ai_flag, 'remove', 'review') DESC,
               p.report_count DESC, p.created_at DESC
      LIMIT 200
    `
  );
}

// POST /api/v1/app/community/moderate  { id, status?, is_official? }
// Admin manual action: change visibility status or toggle the official flag.
export async function moderateCommunityPost(payload: Row) {
  const id = String(payload.id ?? "");
  if (!id) throw new Error("Post id is required.");
  const sets: string[] = [];
  const values: unknown[] = [];
  if (payload.status !== undefined) {
    sets.push("status = ?");
    values.push(String(payload.status));
  }
  if (payload.is_official !== undefined) {
    sets.push("is_official = ?");
    values.push(Number(payload.is_official) ? 1 : 0);
  }
  if (sets.length === 0) throw new Error("Nothing to update (status or is_official required).");
  sets.push("moderated_at = NOW()");
  await executeQuery(`UPDATE community_posts SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
  const rows = await queryRows<Row>(
    "SELECT CAST(id AS CHAR) AS id, status, is_official FROM community_posts WHERE id = ?",
    [id]
  );
  return rows[0] ?? { id };
}

// POST /api/v1/app/community/ai-flag  { id }
// Run Gemini moderation on a single post; store the verdict. A "remove" verdict
// moves the post to 'moderation' so it drops out of the app feed pending review.
export async function aiFlagCommunityPost(payload: Row) {
  const { moderatePostText } = await import("@/lib/gemini");
  const id = String(payload.id ?? "");
  if (!id) throw new Error("Post id is required.");
  const rows = await queryRows<Row>("SELECT CAST(id AS CHAR) AS id, body, status FROM community_posts WHERE id = ?", [id]);
  const post = rows[0];
  if (!post) throw new Error("Post not found.");

  const verdict = await moderatePostText(String(post.body ?? ""));
  const nextStatus = verdict.flag === "remove" && post.status === "visible" ? "moderation" : String(post.status);
  await executeQuery(
    "UPDATE community_posts SET ai_flag = ?, ai_reason = ?, ai_checked_at = NOW(), status = ? WHERE id = ?",
    [verdict.flag, verdict.reason, nextStatus, id]
  );
  return { id, ...verdict, status: nextStatus };
}

// POST /api/v1/app/community/ai-scan  { limit?, rescan? }
// Batch-moderate posts. By default only posts never scanned (ai_checked_at IS NULL);
// rescan=true re-checks everything. Returns a per-post summary + counts.
export async function aiScanCommunityPosts(payload: Row) {
  const { moderatePostText } = await import("@/lib/gemini");
  const limit = Math.min(Math.max(Number(payload.limit ?? 25) || 25, 1), 50);
  const rescan = Boolean(payload.rescan);
  const rows = await queryRows<Row>(
    `
      SELECT CAST(id AS CHAR) AS id, body, status
      FROM community_posts
      WHERE ${rescan ? "1=1" : "ai_checked_at IS NULL"}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
  );

  const results: Array<{ id: string; flag: string; reason: string }> = [];
  const counts = { safe: 0, review: 0, remove: 0 };
  for (const post of rows) {
    const id = String(post.id);
    try {
      const verdict = await moderatePostText(String(post.body ?? ""));
      const nextStatus = verdict.flag === "remove" && post.status === "visible" ? "moderation" : String(post.status);
      await executeQuery(
        "UPDATE community_posts SET ai_flag = ?, ai_reason = ?, ai_checked_at = NOW(), status = ? WHERE id = ?",
        [verdict.flag, verdict.reason, nextStatus, id]
      );
      counts[verdict.flag] += 1;
      results.push({ id, flag: verdict.flag, reason: verdict.reason });
    } catch (error) {
      results.push({ id, flag: "error", reason: error instanceof Error ? error.message : "AI error" });
    }
  }
  return { scanned: results.length, counts, results };
}
