import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { s3Enabled, uploadToS3 } from "@/lib/s3";
import { resolveCaller, unauthorized } from "@/lib/app-auth";

// POST /api/upload  (multipart/form-data, field "file")
// Used by the admin panel AND the mobile app for every upload (profile pictures,
// KYC documents, listing photos, post/market images). With S3_* env configured,
// files go to the S3 bucket: general media public-read, the kyc folder private
// (served via /api/files/kyc presigned redirects). Without S3 config it falls
// back to local public/uploads, so old environments keep working.
//
// Requires an identified caller (mobile bearer token or admin cookie). While this
// was open, anyone on the internet could push 8MB objects into the production
// bucket for as long as they cared to, at the bucket owner's expense.
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const caller = await resolveCaller(request);
  if (caller.kind === "anon") return unauthorized();

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "No file provided (field 'file')." }, { status: 400 });
    }
    if (file.type && !ALLOWED.has(file.type)) {
      return NextResponse.json({ ok: false, message: `Unsupported type: ${file.type}` }, { status: 415 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return NextResponse.json({ ok: false, message: "File too large (max 8MB)." }, { status: 413 });
    }

    const folder = (form.get("folder") || "misc").toString().replace(/[^a-z0-9_-]/gi, "") || "misc";
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const name = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
    // Build the origin from the request's Host header so the stored URL is
    // reachable by the caller (phone on LAN, prod domain), not the bind address.
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
    const proto = request.headers.get("x-forwarded-proto") || (request.nextUrl.protocol === "https:" ? "https" : "http");
    const origin = `${proto}://${host}`;

    if (s3Enabled()) {
      const result = await uploadToS3({ buffer, folder, name, contentType: file.type || "image/jpeg", origin });
      return NextResponse.json({ ok: true, path: `/${result.key}`, url: result.url, storage: result.storage }, { status: 201 });
    }

    // Local-disk fallback (no S3 configured).
    const dir = path.join(process.cwd(), "public", "uploads", folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), buffer);
    const relPath = `/uploads/${folder}/${name}`;
    return NextResponse.json({ ok: true, path: relPath, url: `${origin}${relPath}`, storage: "local" }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
