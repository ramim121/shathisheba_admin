import { NextRequest, NextResponse } from "next/server";
import { presignKycGet, s3Enabled } from "@/lib/s3";
import { queryRows } from "@/lib/db";
import { resolveCaller, unauthorized, forbidden } from "@/lib/app-auth";

// GET /api/files/kyc/<name>
// KYC documents are stored PRIVATE in S3; their permanent URL (saved in the DB)
// points here. Each request redirects to a 5-minute presigned S3 URL, so the
// underlying object never needs to be public.
//
// The filename alone used to be the only thing standing between an anonymous
// caller and someone's NID scan — the names are timestamp+random, but that is
// obscurity, not access control, and the URLs travel through API responses and
// logs. Callers are now identified: admins may fetch any document, a farmer only
// the ones recorded against their own user_id.

// Does this KYC object belong to this app user? Matched on the stored
// document_url's trailing filename, which is what this route receives.
async function ownsDocument(userId: number, fileName: string): Promise<boolean> {
  const rows = await queryRows<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM app_user_kyc_documents
      WHERE user_id = ?
        AND SUBSTRING_INDEX(document_url, '/', -1) = ?`,
    [userId, fileName]
  );
  return (rows[0]?.n ?? 0) > 0;
}

export async function GET(request: NextRequest, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!clean || !s3Enabled()) {
    return NextResponse.json({ ok: false, message: "File unavailable." }, { status: 404 });
  }

  const caller = await resolveCaller(request);
  if (caller.kind === "anon") return unauthorized();
  if (caller.kind === "app" && !(await ownsDocument(caller.user.id, clean))) {
    return forbidden("This document does not belong to your account.");
  }

  try {
    const url = await presignKycGet(clean);
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.json({ ok: false, message: "Could not generate file link." }, { status: 500 });
  }
}
