import { createClient } from "@supabase/supabase-js";

// Server-only client using the service-role key — bypasses RLS so these
// functions can read/write guest rows. SUPABASE_SERVICE_ROLE_KEY must never
// get a VITE_ prefix (that would ship it to the browser bundle).
export function supabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
