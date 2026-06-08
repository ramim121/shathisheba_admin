import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

// POST /api/upload  (multipart/form-data, field "file")
// Saves the uploaded image under public/uploads and returns its served URL.
// Used by the app for profile pictures, KYC documents, and post/market images.
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
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
    const dir = path.join(process.cwd(), "public", "uploads", folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), buffer);

    const relPath = `/uploads/${folder}/${name}`;
    const origin = request.nextUrl.origin;
    return NextResponse.json({ ok: true, path: relPath, url: `${origin}${relPath}` }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
