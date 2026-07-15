// Unified guest-photo storage. Set PHOTO_STORAGE_PROVIDER to one of:
//   "r2"          — Cloudflare R2 (S3 presigned PUT); R2_* vars + public base URL
//   "vercel-blob" — Vercel Blob (client-token direct upload); BLOB_READ_WRITE_TOKEN
//
// Switching providers = change PHOTO_STORAGE_PROVIDER in Vercel env vars, no
// code change — same contract as api/_lib/emailProvider.js. Leave it unset to
// disable guest uploads server-side.
//
// Provider modules are lazy-imported inside each operation so this index (and
// its tests) never load the AWS/Blob SDKs, and a broken/unused provider can't
// take down the other.

export function photoStorageProvider(env = process.env) {
  const value = (env.PHOTO_STORAGE_PROVIDER || "").trim().toLowerCase();
  if (value === "r2" || value === "vercel-blob") return value;
  return null;
}

// Returns a list of missing required env var names for the configured
// provider. Call at the top of the API handler to catch misconfiguration
// early (same contract as missingEmailEnvVars).
export function missingPhotoStorageEnvVars(env = process.env) {
  const missing = [];
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  const provider = photoStorageProvider(env);
  if (!provider) {
    missing.push("PHOTO_STORAGE_PROVIDER");
    return missing;
  }

  if (provider === "r2") {
    for (const name of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
      "R2_PUBLIC_BASE_URL",
    ]) {
      if (!env[name]) missing.push(name);
    }
  } else if (!env.BLOB_READ_WRITE_TOKEN) {
    missing.push("BLOB_READ_WRITE_TOKEN");
  }

  return missing;
}

async function providerModule() {
  const provider = photoStorageProvider();
  if (provider === "r2") return import("./r2.js");
  if (provider === "vercel-blob") return import("./vercelBlob.js");
  throw new Error("PHOTO_STORAGE_PROVIDER is not configured");
}

// -> { mode: "put", url, headers } (r2)
//  | { mode: "vercel-blob", clientToken } (blob)
export async function createUploadGrant({ key, contentType, sizeBytes }) {
  const mod = await providerModule();
  return mod.createUploadGrant({ key, contentType, sizeBytes });
}

// -> { exists, size, contentType } — authoritative post-upload check.
export async function headObject({ key, url }) {
  const mod = await providerModule();
  return mod.headObject({ key, url });
}

// -> public https URL for the stored object, or null if it can't be derived
// (blob: requires the client-reported URL to validate against the key).
export async function publicUrlFor({ key, clientUrl }) {
  const mod = await providerModule();
  return mod.publicUrlFor({ key, clientUrl });
}

// Best-effort: swallows not-found so moderation delete stays idempotent.
export async function deleteObject({ key, url }) {
  const mod = await providerModule();
  return mod.deleteObject({ key, url });
}
