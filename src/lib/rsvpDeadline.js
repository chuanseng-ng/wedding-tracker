// ─── RSVP DEADLINE LOCK (#179) ────────────────────────────────────────────────
// Pure helpers for the opt-in "close the RSVP form once the deadline is past"
// switch. The DATABASE is the authority (public.is_rsvp_locked() guards
// submit_rsvp / submit_rsvp_events / register_open_rsvp — see
// supabase/migrations/0011_rsvp_deadline_lock.sql); this module exists so the
// public form can render the closed notice without a second round trip, and so
// the email jobs in api/ can drop a link that would land on a shut form.
//
// `rsvp_deadline` is a bare `date`, so "past the deadline" is a CALENDAR
// question, not an instant one — the same string-compare-local-YYYY-MM-DD
// convention used by budgetUtils.localDateISO / checklistUtils. Which calendar
// is the couple's: weddings.wedding_timezone, so a deployment is never locked
// early (or late) by the server happening to run in UTC.

export const DEFAULT_TIMEZONE = "Asia/Singapore";

// Kept short and deliberately regional: the full IANA list (~400 entries) is
// available via Intl.supportedValuesOf, and this is only the fallback for
// runtimes that lack it. DEFAULT_TIMEZONE must appear here.
const FALLBACK_TIMEZONES = [
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Manila",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "America/Chicago",
  "America/Los_Angeles",
  "America/New_York",
  "Pacific/Auckland",
  "UTC",
];

/** Every IANA zone the runtime knows, or a curated regional subset. Sorted, unique. */
export const TIMEZONE_OPTIONS = (() => {
  let zones = FALLBACK_TIMEZONES;
  try {
    const supported = Intl.supportedValuesOf?.("timeZone");
    if (Array.isArray(supported) && supported.length) zones = supported;
  } catch {
    // Intl.supportedValuesOf is absent or refused the key — keep the fallback.
  }
  return [...new Set([...zones, DEFAULT_TIMEZONE])].sort();
})();

/**
 * The calendar date (YYYY-MM-DD) at `date` as seen in `timeZone`.
 * "en-CA" formats as YYYY-MM-DD natively, so no re-assembly is needed.
 * An unknown zone makes Intl throw RangeError — fall back rather than crash the
 * public form over a bad admin value.
 */
export function zonedDateISO(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const zone = String(timeZone || "").trim() || DEFAULT_TIMEZONE;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    if (zone === DEFAULT_TIMEZONE) throw new Error("default timezone unavailable");
    return zonedDateISO(date, DEFAULT_TIMEZONE);
  }
}

/**
 * Is the public RSVP form closed for new submissions?
 *
 * `wedding.rsvp_locked` — computed server-side by get_wedding_config — wins when
 * present, so the client can never disagree with the RPC that will accept or
 * refuse the write. The local computation is the fallback for demo mode and for
 * databases that have not run migration 0011 yet (where the column is absent,
 * and the RPCs have no guard either, so "open" is the correct answer).
 *
 * The deadline day itself is INCLUSIVE: locking starts at local midnight after it.
 */
export function isRsvpLocked(wedding, now = new Date()) {
  if (typeof wedding?.rsvp_locked === "boolean") return wedding.rsvp_locked;
  if (!wedding?.lock_rsvp_after_deadline) return false;

  const deadline = String(wedding.rsvp_deadline ?? "").slice(0, 10);
  if (!deadline) return false;

  return zonedDateISO(now, wedding.wedding_timezone) > deadline;
}
