import { describe, it, expect } from "vitest";
import {
  MAX_PIN,
  cleanPin,
  isOpenMode,
  openRsvpErrorKey,
  registerResultErrorKey,
  registerResultKind,
  registerCandidates,
} from "./openRsvp.js";

describe("cleanPin", () => {
  it("trims surrounding whitespace", () => {
    expect(cleanPin("  1234  ")).toBe("1234");
  });

  it("caps at MAX_PIN characters", () => {
    expect(MAX_PIN).toBe(20);
    expect(cleanPin("x".repeat(30))).toBe("x".repeat(20));
  });

  it("coerces null/undefined to empty string", () => {
    expect(cleanPin(null)).toBe("");
    expect(cleanPin(undefined)).toBe("");
  });

  it("accepts non-numeric pins", () => {
    expect(cleanPin("our-wedding")).toBe("our-wedding");
  });
});

describe("isOpenMode", () => {
  const wedding = { enable_open_rsvp: true };

  it("is on when the toggle is set and there is no token or demo", () => {
    expect(isOpenMode({ wedding, isDemoMode: false, activeToken: "" })).toBe(true);
  });

  it("is off when the wedding toggle is off or missing", () => {
    expect(isOpenMode({ wedding: { enable_open_rsvp: false }, isDemoMode: false, activeToken: "" })).toBe(false);
    expect(isOpenMode({ wedding: null, isDemoMode: false, activeToken: "" })).toBe(false);
  });

  it("demo mode wins over the toggle", () => {
    expect(isOpenMode({ wedding, isDemoMode: true, activeToken: "" })).toBe(false);
  });

  it("an active token (link or selected guest) wins over the toggle", () => {
    expect(isOpenMode({ wedding, isDemoMode: false, activeToken: "abc-123" })).toBe(false);
  });
});

describe("openRsvpErrorKey", () => {
  it("maps a wrong pin to the pin-invalid key", () => {
    expect(openRsvpErrorKey("invalid rsvp pin")).toBe("rsvp.err.pinInvalid");
  });

  it("maps missing-function/PostgREST errors to the not-setup key", () => {
    expect(openRsvpErrorKey('function public.register_open_rsvp does not exist')).toBe("rsvp.err.notSetup");
    expect(openRsvpErrorKey("PGRST202: not found")).toBe("rsvp.err.notSetup");
  });

  it("maps an invalid token to the link-expired key", () => {
    expect(openRsvpErrorKey("invalid rsvp token")).toBe("rsvp.err.linkExpired");
  });

  it("falls back to the generic key for anything else", () => {
    expect(openRsvpErrorKey("open rsvp disabled")).toBe("rsvp.err.generic");
    expect(openRsvpErrorKey("guest limit reached")).toBe("rsvp.err.generic");
    expect(openRsvpErrorKey("")).toBe("rsvp.err.generic");
    expect(openRsvpErrorKey(undefined)).toBe("rsvp.err.generic");
  });

  it("is case-insensitive like the existing submit catch", () => {
    expect(openRsvpErrorKey("Invalid RSVP PIN")).toBe("rsvp.err.pinInvalid");
  });
});

describe("registerResultErrorKey", () => {
  // register_open_rsvp returns {error} instead of raising for pin failures so
  // the failed-attempt record survives the transaction (rate limiting).
  it("maps the structured RPC error codes", () => {
    expect(registerResultErrorKey("invalid_pin")).toBe("rsvp.err.pinInvalid");
    expect(registerResultErrorKey("too_many_attempts")).toBe("rsvp.err.tooManyAttempts");
    expect(registerResultErrorKey("confirm_failed")).toBe("rsvp.err.confirmFailed");
  });

  it("falls back to the generic key for unknown codes", () => {
    expect(registerResultErrorKey("mystery")).toBe("rsvp.err.generic");
    expect(registerResultErrorKey(undefined)).toBe("rsvp.err.generic");
  });
});

describe("registerResultKind", () => {
  // Three outcomes, and the order matters: needs_confirm carries no token but
  // is NOT an error, so the page must branch on it before the token check.
  it("recognises a successful registration", () => {
    expect(registerResultKind({ token: "abc-123" })).toBe("token");
  });

  it("recognises the near-duplicate confirmation prompt", () => {
    expect(
      registerResultKind({ needs_confirm: true, candidates: [{ id: "g1", name: "Wei Ming Tan" }] })
    ).toBe("needs_confirm");
  });

  it("treats a confirmation prompt with no usable candidates as an error", () => {
    // Defensive: prompting "did you mean…?" with an empty list would strand the
    // guest with no way forward.
    expect(registerResultKind({ needs_confirm: true, candidates: [] })).toBe("error");
    expect(registerResultKind({ needs_confirm: true })).toBe("error");
  });

  it("treats a token alongside needs_confirm as a token", () => {
    expect(registerResultKind({ needs_confirm: true, token: "abc-123" })).toBe("token");
  });

  it("treats PIN failures, empty and malformed results as errors", () => {
    expect(registerResultKind({ error: "invalid_pin" })).toBe("error");
    expect(registerResultKind({})).toBe("error");
    expect(registerResultKind(null)).toBe("error");
    expect(registerResultKind(undefined)).toBe("error");
    expect(registerResultKind("nonsense")).toBe("error");
  });
});

describe("registerCandidates", () => {
  it("returns well-formed candidates unchanged", () => {
    expect(registerCandidates({ candidates: [{ id: "g1", name: "Wei Ming Tan" }] })).toEqual([
      { id: "g1", name: "Wei Ming Tan" },
    ]);
  });

  it("drops entries missing an id or a name", () => {
    expect(
      registerCandidates({
        candidates: [{ id: "g1", name: "Ok" }, { id: "g2" }, { name: "No id" }, null],
      })
    ).toEqual([{ id: "g1", name: "Ok" }]);
  });

  it("caps the list, matching the server's limit", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, name: `Guest ${i}` }));
    expect(registerCandidates({ candidates: many })).toHaveLength(3);
  });

  it("returns an empty array for anything unusable", () => {
    expect(registerCandidates({})).toEqual([]);
    expect(registerCandidates(null)).toEqual([]);
    expect(registerCandidates({ candidates: "nope" })).toEqual([]);
  });
});
