// Cloudflare R2 provider — S3-compatible API. The browser PUTs directly to a
// short-lived presigned URL (bypassing Vercel's 4.5 MB body cap); this module
// only ever handles metadata operations and signatures, never file bytes.
//
// ⚠ Deployer setup: the bucket needs a CORS rule allowing PUT from the site
// origin with the "content-type" header, and a public read surface (the
// r2.dev dev URL or a custom domain) matching R2_PUBLIC_BASE_URL. See
// SECURITY.md / .env.example.
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2PublicUrl } from "../photowallCore.js";

let cachedClient = null;

function client() {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return cachedClient;
}

// ContentType is signed so the grant can only upload the validated type.
// ContentLength is deliberately NOT signed — browsers set it themselves and a
// mismatch fails the whole PUT opaquely; the authoritative size check happens
// at confirm time via headObject.
export async function createUploadGrant({ key, contentType }) {
  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 300 }
  );
  return { mode: "put", url, headers: { "Content-Type": contentType } };
}

export async function headObject({ key }) {
  try {
    const out = await client().send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key })
    );
    return { exists: true, size: out.ContentLength ?? 0, contentType: out.ContentType || "" };
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") {
      return { exists: false, size: 0, contentType: "" };
    }
    throw e;
  }
}

export async function publicUrlFor({ key }) {
  return r2PublicUrl(process.env.R2_PUBLIC_BASE_URL, key);
}

export async function deleteObject({ key }) {
  try {
    await client().send(
      new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key })
    );
  } catch (e) {
    // Best-effort: a missing object must not block metadata deletion.
    if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== "NotFound") throw e;
  }
}
