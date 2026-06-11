import { NextRequest, NextResponse } from "next/server";
import { presignKycGet, s3Enabled } from "@/lib/s3";

// GET /api/files/kyc/<name>
// KYC documents are stored PRIVATE in S3; their permanent URL (saved in the DB)
// points here. Each request redirects to a 5-minute presigned S3 URL, so the
// underlying object never needs to be public.
export async function GET(_request: NextRequest, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!clean || !s3Enabled()) {
    return NextResponse.json({ ok: false, message: "File unavailable." }, { status: 404 });
  }
  try {
    const url = await presignKycGet(clean);
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.json({ ok: false, message: "Could not generate file link." }, { status: 500 });
  }
}
