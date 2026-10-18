import { unlink } from "node:fs/promises";
import path from "node:path";
import { queryRows } from "@/lib/db";
import { bucketUrl, deleteS3Object, publicBase, s3Enabled } from "@/lib/s3";

/**
 * The files behind the URLs a record stored, so that deleting an account
 * removes the person's photos and documents and not only the links to them.
 *
 * Four shapes of reference exist in this database:
 *
 *   https://<bucket>.s3.<region>.amazonaws.com/<folder>/<name>   public media, S3
 *   <origin>/api/files/kyc/<name>                               private KYC, S3 kyc/ folder
 *   <origin>/uploads/<folder>/<name>                            older uploads, the server's own disk
 *   <folder>/<name>                                             a bare key (loan_documents.file_key)
 *
 * Removal is deliberately narrow, because a URL in a farmer's own record is
 * whatever the phone sent and could point at anything:
 *
 *   * only folders that hold one person's uploads — what the app uploads
 *     (profile, KYC, listing, community and Shathi Apa photos) and the
 *     paperwork staff attach to that person's listing. Shared folders (the
 *     catalogue's `misc`, `media`, `partners`, cached speech) are never touched;
 *   * only a name the upload route generates (`<ms>-<12 hex>.<ext>`, or a
 *     UUID), so a seeded or hand-named asset is never matched;
 *   * never a file that some other record still references, so pointing a
 *     post at someone else's photo and then deleting the account cannot take
 *     their photo with it.
 *
 * Everything here is best-effort: a file that cannot be removed is counted and
 * logged, and never fails the deletion that asked for it.
 */

const PERSONAL_FOLDERS = new Set([
  "profiles", "kyc", "sale-listings", "community", "apa",
  "verification", "vaccination", "contracts", "shipping"
]);

const GENERATED_NAME =
  /^(?:\d{12,14}-[0-9a-f]{12}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z0-9]{1,8}$/i;

export type StoredFile =
  | { kind: "s3"; key: string; name: string }
  | { kind: "local"; folder: string; name: string };

function fromFolderAndName(folder: string, name: string, kind: "s3" | "local"): StoredFile | null {
  if (!PERSONAL_FOLDERS.has(folder) || !GENERATED_NAME.test(name)) return null;
  return kind === "s3" ? { kind, key: `${folder}/${name}`, name } : { kind, folder, name };
}

// "/<folder>/<name>" with exactly two segments, or null.
function twoSegments(p: string): [string, string] | null {
  const parts = p.replace(/^\/+/, "").split("/");
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

/** The file behind one stored reference, or null when it is not one this app may remove. */
export function storedFileFromRef(ref: unknown): StoredFile | null {
  if (typeof ref !== "string") return null;
  const raw = ref.trim();
  if (!raw || raw.length > 600 || raw.includes("..")) return null;

  let pathname: string;
  let origin = "";
  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    origin = url.origin.toLowerCase();
    pathname = decodeURIComponent(url.pathname);
    // Public S3 media, under either the configured public base or the bucket's own host.
    for (const base of [publicBase(), bucketUrl()]) {
      const b = base.replace(/\/$/, "").toLowerCase();
      const here = `${origin}${pathname}`;
      if (here.toLowerCase().startsWith(`${b}/`)) {
        const seg = twoSegments(here.slice(b.length));
        return seg ? fromFolderAndName(seg[0], seg[1], "s3") : null;
      }
    }
  } else if (raw.startsWith("/")) {
    pathname = raw;
  } else {
    // A bare key.
    const seg = twoSegments(raw);
    return seg ? fromFolderAndName(seg[0], seg[1], "s3") : null;
  }

  const kyc = pathname.match(/^\/api\/files\/kyc\/([^/]+)$/);
  if (kyc) return fromFolderAndName("kyc", kyc[1], "s3");
  const local = pathname.match(/^\/uploads\/([^/]+)\/([^/]+)$/);
  if (local) return fromFolderAndName(local[1], local[2], "local");
  return null;
}

/** Every string inside a value — a column, a JSON array of URLs, an array of {url, name}. */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectStrings(v, out));
  } else if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    Object.values(value as Record<string, unknown>).forEach((v) => collectStrings(v, out));
  }
  return out;
}

// Does any record still point at this file? Called after the deleting
// transaction has committed, when every reference the account itself held has
// been erased or cleared, so a hit belongs to someone else.
//
// Matched on the file name, not the whole URL: a generated name is unique, and
// the same file is reachable under several origins (the S3 host, the public
// base, the server's own domain), so comparing URLs would miss the very case
// this guards against. The name has passed GENERATED_NAME, so it carries no
// LIKE wildcard.
async function stillReferenced(name: string): Promise<boolean> {
  const tail = `%/${name}`;
  const [row] = await queryRows<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM app_users WHERE profile_image_url LIKE ?)
          + (SELECT COUNT(*) FROM app_user_kyc_documents WHERE document_url LIKE ?)
          + (SELECT COUNT(*) FROM community_posts WHERE image_url LIKE ?)
          + (SELECT COUNT(*) FROM apa_messages WHERE image_url LIKE ?)
          + (SELECT COUNT(*) FROM sale_listings WHERE JSON_SEARCH(media_json, 'one', ?) IS NOT NULL)
          + (SELECT COUNT(*) FROM listing_contracts
              WHERE contract_file_url LIKE ? OR JSON_SEARCH(documents_json, 'one', ?) IS NOT NULL)
          + (SELECT COUNT(*) FROM listing_shipments WHERE JSON_SEARCH(documents_json, 'one', ?) IS NOT NULL)
          + (SELECT COUNT(*) FROM listing_vaccinations WHERE document_url LIKE ?)
          + (SELECT COUNT(*) FROM listing_field_verifications WHERE JSON_SEARCH(photos_json, 'one', ?) IS NOT NULL)
          + (SELECT COUNT(*) FROM loan_documents WHERE file_key LIKE ? OR file_key = ?)
          + (SELECT COUNT(*) FROM loan_field_verifications WHERE photo_url LIKE ? OR document_url LIKE ?)
          + (SELECT COUNT(*) FROM loan_assets WHERE photo_url LIKE ? OR evidence_url LIKE ?)
          + (SELECT COUNT(*) FROM development_plan_tasks WHERE evidence_url LIKE ?) AS n`,
    [tail, tail, tail, tail, tail, tail, tail, tail, tail, tail, tail, name, tail, tail, tail, tail, tail]
  );
  return Number(row?.n ?? 0) > 0;
}

export type FileRemovalSummary = {
  /** Distinct files eligible for removal. */
  candidates: number;
  /** Removed, or already gone. */
  removed: number;
  /** Eligible, but another record still points at the file. */
  kept_in_use: number;
  /** Strings that are not one person's upload (a shared asset, another host, plain text). */
  skipped: number;
  failed: number;
  /** S3 is not configured in this environment. */
  storage_off: number;
};

/**
 * Remove the files behind a set of references. Never throws.
 */
export async function removeStoredFiles(refs: unknown[]): Promise<FileRemovalSummary> {
  const summary: FileRemovalSummary = { candidates: 0, removed: 0, kept_in_use: 0, skipped: 0, failed: 0, storage_off: 0 };
  const strings = [...new Set(collectStrings(refs).map((s) => s.trim()).filter(Boolean))];
  const files = new Map<string, StoredFile>();
  for (const s of strings) {
    const file = storedFileFromRef(s);
    if (!file) {
      summary.skipped += 1;
      continue;
    }
    const id = file.kind === "s3" ? `s3:${file.key}` : `local:${file.folder}/${file.name}`;
    if (!files.has(id)) files.set(id, file);
  }
  summary.candidates = files.size;

  for (const file of files.values()) {
    try {
      if (await stillReferenced(file.name)) {
        summary.kept_in_use += 1;
        continue;
      }
      if (file.kind === "s3") {
        if (!s3Enabled()) {
          summary.storage_off += 1;
          continue;
        }
        await deleteS3Object(file.key);
        summary.removed += 1;
      } else {
        await unlink(path.join(process.cwd(), "public", "uploads", file.folder, file.name));
        summary.removed += 1;
      }
    } catch (error) {
      // A local file that is already gone is the outcome we wanted.
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        summary.removed += 1;
        continue;
      }
      summary.failed += 1;
      console.error("stored file removal failed", file.kind, error instanceof Error ? error.message : error);
    }
  }
  return summary;
}
