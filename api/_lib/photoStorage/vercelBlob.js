// Vercel Blob provider. The handler mints a single-use CLIENT TOKEN scoped to
// one pathname/content-type/size; the browser then uploads directly with
// @vercel/blob/client's put() (bypassing Vercel's 4.5 MB body cap). The
// explicit confirm step is used instead of onUploadCompleted — that callback
// needs a publicly reachable URL, which breaks `vercel dev` on localhost, and
// keeping one flow for both providers keeps the client simple.
import { head, del } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { isValidBlobUrl } from "../photowallCore.js";

export async function createUploadGrant({ key, contentType, sizeBytes }) {
  const clientToken = await generateClientTokenFromReadWriteToken({
    token: process.env.BLOB_READ_WRITE_TOKEN,
    pathname: key,
    allowedContentTypes: [contentType],
    // Exact cap: maximumSizeInBytes measures the blob itself (no wire
    // overhead), and the client uploads exactly the blob it declared.
    maximumSizeInBytes: sizeBytes,
    addRandomSuffix: false,
    validUntil: Date.now() + 5 * 60 * 1000,
  });
  return { mode: "vercel-blob", clientToken };
}

// Blob head() addresses objects by URL, so confirm passes the client-reported
// URL through — validated against the issued key before it is trusted.
export async function headObject({ key, url }) {
  if (!isValidBlobUrl(url, key)) return { exists: false, size: 0, contentType: "" };
  try {
    const meta = await head(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
    return { exists: true, size: meta.size ?? 0, contentType: meta.contentType || "" };
  } catch (e) {
    if (e?.name === "BlobNotFoundError") return { exists: false, size: 0, contentType: "" };
    throw e;
  }
}

export async function publicUrlFor({ key, clientUrl }) {
  return isValidBlobUrl(clientUrl, key) ? clientUrl : null;
}

export async function deleteObject({ key, url }) {
  // Prefer the validated stored URL; fall back to the pathname (del() accepts
  // both) — pending rows that never confirmed have no public_url, and skipping
  // them would orphan the uploaded blob forever.
  const target = isValidBlobUrl(url, key) ? url : key;
  try {
    await del(target, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch (e) {
    if (e?.name !== "BlobNotFoundError") throw e;
  }
}
