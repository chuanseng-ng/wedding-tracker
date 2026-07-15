// Shared auth gate for endpoints that spend real money/quota (generate-theme,
// translate). Verifies the caller's Supabase JWT server-side and matches the
// email against the configured couple/helper accounts. Fails closed everywhere.
import { supabaseAdmin } from "./supabaseAdmin.js";

// Require not just a valid Supabase JWT but that it belongs to a configured
// account (couple or helper). If neither email is configured, fall back to
// "any authenticated user" (back-compat).
export function isAllowedHelperEmail(email) {
  const coupleEmail = (process.env.COUPLE_EMAIL || process.env.VITE_COUPLE_EMAIL || "").trim().toLowerCase();
  const helperEmail = (process.env.HELPER_EMAIL || process.env.VITE_HELPER_EMAIL || "").trim().toLowerCase();
  const allowed = [coupleEmail, helperEmail].filter(Boolean);
  if (!allowed.length) return true;
  return typeof email === "string" && allowed.includes(email.trim().toLowerCase());
}

// Returns the authenticated caller's email, or null if the caller isn't an
// authorized couple/helper account. Fails closed on any error.
export async function authorizedHelperEmail(req) {
  const auth = req.headers?.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const { data, error } = await supabaseAdmin().auth.getUser(token);
    const email = data?.user?.email;
    if (error || !email || !isAllowedHelperEmail(email)) return null;
    return email;
  } catch {
    return null;
  }
}

// Couple-only match for actions the helper must not perform (e.g. photowall
// photo deletion). When no couple email is configured anywhere it falls open
// to any authorized account (same back-compat stance as isAllowedHelperEmail —
// the couple is never locked out of their own deployment).
export function isCoupleEmail(email) {
  const coupleEmail = (process.env.COUPLE_EMAIL || process.env.VITE_COUPLE_EMAIL || "").trim().toLowerCase();
  if (!coupleEmail) return true;
  return typeof email === "string" && email.trim().toLowerCase() === coupleEmail;
}

// Returns the authenticated caller's email only when it is the couple's
// account; null otherwise. Fails closed on any token error.
export async function authorizedCoupleEmail(req) {
  const email = await authorizedHelperEmail(req);
  if (!email || !isCoupleEmail(email)) return null;
  return email;
}

// Best-effort in-memory rate limit (per warm instance). Not a durable quota,
// but it caps runaway client retry loops / replayed tokens against metered APIs.
export function makeRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return function rateLimited(key) {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > max;
  };
}
