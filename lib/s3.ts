import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// All uploads (admin panel + mobile app, via /api/upload) land in one S3 bucket.
// General media (listings, community, market, profile) is uploaded public-read —
// the app stores and renders permanent URLs, matching the previous hosting model.
// KYC documents stay PRIVATE in the bucket and are served through
// /api/files/kyc/<name>, which redirects to a short-lived presigned URL.

const globalForS3 = globalThis as unknown as { s3Client?: S3Client };

export function s3Enabled(): boolean {
  return Boolean(process.env.S3_BUCKET_NAME && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

function getClient(): S3Client {
  if (!globalForS3.s3Client) {
    globalForS3.s3Client = new S3Client({
      region: process.env.S3_BUCKET_REGION || "ap-southeast-1",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string
      }
    });
  }
  return globalForS3.s3Client;
}

function bucket(): string {
  return process.env.S3_BUCKET_NAME as string;
}

function publicBase(): string {
  const base = process.env.S3_PUBLIC_URL || `https://${bucket()}.s3.${process.env.S3_BUCKET_REGION || "ap-southeast-1"}.amazonaws.com`;
  return base.replace(/\/$/, "");
}

// Returns the permanent URL the caller should store. KYC objects are private,
// so their stored URL points at our presigning redirect route instead of S3.
export async function uploadToS3(opts: {
  buffer: Buffer;
  folder: string;
  name: string;
  contentType: string;
  origin: string;
}): Promise<{ key: string; url: string; storage: "s3" }> {
  const isKyc = opts.folder === "kyc";
  const key = `${opts.folder}/${opts.name}`;
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: opts.buffer,
      ContentType: opts.contentType,
      ...(isKyc ? {} : { ACL: "public-read" as const })
    })
  );
  const url = isKyc ? `${opts.origin}/api/files/kyc/${opts.name}` : `${publicBase()}/${key}`;
  return { key, url, storage: "s3" };
}

// Short-lived presigned GET for a private KYC object.
export async function presignKycGet(name: string, expiresInSeconds = 300): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket(), Key: `kyc/${name}` });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}
