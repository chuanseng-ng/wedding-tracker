// ─── OPEN RSVP (self-registration, #126) ──────────────────────────────────────
// Pure helpers for the open-RSVP mode where guests are not cross-checked
// against the guest list. The PIN is a shared invitation secret verified
// server-side (register_open_rsvp RPC); client-side hygiene only, the database
// is the authoritative enforcement (see supabase/migrations/0008_open_rsvp.sql).
export const MAX_PIN = 20;

export const cleanPin = (v) => String(v ?? "").trim().slice(0, MAX_PIN);

// Open mode never applies in demo mode (which already fakes a free-text flow)
// and never overrides a real token (?token= link or a selected guest).
export const isOpenMode = ({ wedding, isDemoMode, activeToken }) =>
  !isDemoMode && !activeToken && !!wedding?.enable_open_rsvp;

// register_open_rsvp returns {token} on success or {error: code} for pin
// failures — returned (not raised) so the server's failed-attempt record
// commits and the brute-force rate limit actually accumulates.
export const registerResultErrorKey = (error) => {
  if (error === "invalid_pin") return "rsvp.err.pinInvalid";
  if (error === "too_many_attempts") return "rsvp.err.tooManyAttempts";
  // The confirmed guest no longer matches the typed name server-side — merged
  // away, renamed, or a forged id. Refused rather than silently inserting the
  // duplicate this feature exists to prevent, so the guest needs telling.
  if (error === "confirm_failed") return "rsvp.err.confirmFailed";
  return "rsvp.err.generic";
};

// Most near-match candidates register_open_rsvp will ever return. Mirrors the
// server's own limit; also a cap on how much of the guest list one PIN-holding
// caller can see per submission.
export const MAX_CANDIDATES = 3;

// Which of the three outcomes register_open_rsvp returned:
//   'token'         — registered (or matched an existing guest); carry on.
//   'needs_confirm' — the typed name looks like someone already invited; ask
//                     before creating a duplicate. Carries NO token, but is not
//                     an error — the page must test for this before !res.token.
//   'error'         — a PIN failure, or anything unusable.
//
// A confirmation prompt with nothing to offer is treated as an error: showing
// "did you mean…?" above an empty list would strand the guest.
export const registerResultKind = (res) => {
  if (res?.token) return "token";
  if (res?.needs_confirm && registerCandidates(res).length > 0) return "needs_confirm";
  return "error";
};

// The near-matches to offer, defensively filtered — a candidate without both an
// id and a name cannot be rendered or confirmed.
export const registerCandidates = (res) =>
  (Array.isArray(res?.candidates) ? res.candidates : [])
    .filter((c) => c?.id && c?.name)
    .slice(0, MAX_CANDIDATES);

// Maps a submit/register RPC error message to an i18n key — the same matching
// the RSVP submit catch used inline before open mode added the pin case.
export const openRsvpErrorKey = (message) => {
  const msg = String(message ?? "").toLowerCase();
  if (msg.includes("function") || msg.includes("does not exist") || msg.includes("pgrst")) {
    return "rsvp.err.notSetup";
  }
  if (msg.includes("invalid rsvp token")) return "rsvp.err.linkExpired";
  if (msg.includes("invalid rsvp pin")) return "rsvp.err.pinInvalid";
  return "rsvp.err.generic";
};
