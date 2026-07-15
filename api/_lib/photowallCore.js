// Pure helpers for the guest photowall endpoint (api/photowall.js) — no SDK
// or network imports so the whole module is unit-testable. Caps here must stay
// in sync with the check constraints in supabase/migrations/0011_photowall.sql.

export const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
// A downscaled 2560px JPEG is ~1 MB; 4 MB is generous headroom while keeping
// the worst-case storage fill (cap × max size) inside R2's free tier.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // photowall_photos.size_bytes check
export const MAX_UPLOADER_NAME = 80; // photowall_photos.uploader_name check
export const MAX_CAPTION = 280; // photowall_photos.caption check

const EXT_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function extForContentType(contentType) {
  return EXT_BY_TYPE[contentType] || null;
}

// Object keys are always server-generated (uuid + extension derived from the
// validated content type) — client filenames never reach storage.
export function makeObjectKey(uuid, contentType) {
  const ext = extForContentType(contentType);
  if (!ext) return null;
  return `photowall/${uuid}.${ext}`;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

function clampText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function clampUploaderName(value) {
  return clampText(value, MAX_UPLOADER_NAME);
}

export function clampCaption(value) {
  return clampText(value, MAX_CAPTION);
}

// Shape-level validation of an upload-grant request. The PIN VALUE is verified
// by the begin_photowall_upload RPC (with the durable attempt log); here we
// only reject requests that could never succeed.
export function validateGrantRequest({ pin, contentType, sizeBytes } = {}) {
  if (typeof pin !== "string" || pin.trim() === "") return { error: "invalid_pin" };
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) return { error: "bad_type" };
  // Integer: p_size_bytes is a bigint RPC param — a fractional number would
  // bounce off PostgREST as a 22P02 and surface as a 500 instead of a 400.
  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_UPLOAD_BYTES) {
    return { error: "too_large" };
  }
  return { ok: true };
}

// Client IP for the best-effort in-memory limiter. The FIRST x-forwarded-for
// entry is client-controlled (a caller can prepend arbitrary values), so
// prefer x-real-ip (set by Vercel's proxy) and otherwise take the LAST
// forwarded entry — the one the trusted proxy appended. The durable gate is
// the photowall_pin_attempts table either way.
export function clientIp(req) {
  const realIp = req.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const parts = forwarded.split(",");
    return parts[parts.length - 1].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

export function r2PublicUrl(baseUrl, key) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return null;
  return `${baseUrl.replace(/\/+$/, "")}/${key}`;
}

// The Vercel Blob client reports the final URL after upload; never trust it
// blindly — accept only https URLs on a *.public.blob.vercel-storage.com host
// whose path is exactly the object key we issued.
export function isValidBlobUrl(url, key) {
  if (typeof url !== "string") return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname.endsWith(".public.blob.vercel-storage.com") &&
    parsed.pathname === `/${key}`
  );
}
