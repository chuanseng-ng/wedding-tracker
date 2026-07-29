// Single source of truth for how the couple's two names are ordered and joined.
//
// The names live in two fixed columns (`weddings.bride_name` / `groom_name`), but
// which one reads FIRST is the couple's choice, stored in `weddings.name_order`
// (migration 0012). Before that column existed the order was hardcoded — and not
// even consistently (the public slug was groom-first). Every display now routes
// through here so one setting moves them all.
//
// Pure, dependency-free and browser/Node-safe: `api/send-rsvp-email.js` and
// `api/send-reminders.js` import it for the email templates.

export const NAME_ORDERS = ["bride_first", "groom_first"];
export const DEFAULT_NAME_ORDER = "bride_first";

/**
 * Clamp any stored/user value to a known order. Rows written before 0012 have no
 * `name_order` at all, so an unknown value must degrade to the historical
 * bride-first rendering rather than throw or reach the DB CHECK.
 */
export function cleanNameOrder(value) {
  return NAME_ORDERS.includes(value) ? value : DEFAULT_NAME_ORDER;
}

/**
 * The two names in display order: `[first, second]`. Never throws — missing names
 * come back as empty strings so callers can guard with a single falsy check.
 */
export function coupleParts(wedding) {
  const bride = String(wedding?.bride_name ?? "").trim();
  const groom = String(wedding?.groom_name ?? "").trim();
  return cleanNameOrder(wedding?.name_order) === "groom_first"
    ? [groom, bride]
    : [bride, groom];
}

/**
 * The joined couple string, e.g. "Siew Yong & Wei Ming".
 *
 * Returns `fallback` unless BOTH names are set, preserving the
 * `bride_name && groom_name` guards this replaced — a half-filled setup should
 * show the localized placeholder, not a dangling separator.
 *
 * @param {object|null} wedding  a wedding row (localized, where one is in scope)
 * @param {{sep?: string, fallback?: string}} [opts]  `sep` for CSV filenames ("-")
 *   and slugs ("-and-"); `fallback` for a localized placeholder.
 */
export function coupleName(wedding, { sep = " & ", fallback = "" } = {}) {
  const [first, second] = coupleParts(wedding);
  if (!first || !second) return fallback;
  return `${first}${sep}${second}`;
}

/**
 * The two `party` keys in the same order, for side-keyed UI (the RSVP "closer to"
 * buttons, the Wishes Wrapped bride-vs-groom slide). A fresh array each call —
 * callers map over it.
 */
export function partyOrder(wedding) {
  return cleanNameOrder(wedding?.name_order) === "groom_first"
    ? ["groom", "bride"]
    : ["bride", "groom"];
}
