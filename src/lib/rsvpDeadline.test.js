import { describe, it, expect } from "vitest";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS, zonedDateISO, isRsvpLocked } from "./rsvpDeadline.js";

// 2026-11-01T00:30:00Z — already 1 Nov 08:30 in Singapore, still 31 Oct 20:30 in New York.
const CROSS_MIDNIGHT = new Date("2026-11-01T00:30:00Z");

const wedding = (over = {}) => ({
  rsvp_deadline: "2026-10-31",
  lock_rsvp_after_deadline: true,
  wedding_timezone: "Asia/Singapore",
  ...over,
});

describe("zonedDateISO", () => {
  it("returns the calendar date in the requested zone, not UTC", () => {
    expect(zonedDateISO(CROSS_MIDNIGHT, "Asia/Singapore")).toBe("2026-11-01");
    expect(zonedDateISO(CROSS_MIDNIGHT, "America/New_York")).toBe("2026-10-31");
    expect(zonedDateISO(CROSS_MIDNIGHT, "UTC")).toBe("2026-11-01");
  });

  it("pads single-digit months and days", () => {
    expect(zonedDateISO(new Date("2026-01-05T12:00:00Z"), "UTC")).toBe("2026-01-05");
  });

  it("assembles from parts rather than trusting the locale's date shape", () => {
    // ECMA-402 does not pin a locale's output format, so the value must not come
    // from .format(). Simulate a build whose en-CA renders day-first: the result
    // must still be ISO, because it is built from formatToParts.
    const RealDTF = Intl.DateTimeFormat;
    const spy = function (locale, opts) {
      const inner = new RealDTF(locale, opts);
      return {
        format: () => "05/01/2026",
        formatToParts: (d) => inner.formatToParts(d),
        resolvedOptions: () => inner.resolvedOptions(),
      };
    };
    Intl.DateTimeFormat = spy;
    try {
      expect(zonedDateISO(new Date("2026-01-05T12:00:00Z"), "UTC")).toBe("2026-01-05");
    } finally {
      Intl.DateTimeFormat = RealDTF;
    }
  });

  it("falls back to the default zone when the timezone is unknown or blank", () => {
    const expected = zonedDateISO(CROSS_MIDNIGHT, DEFAULT_TIMEZONE);
    expect(zonedDateISO(CROSS_MIDNIGHT, "Not/AZone")).toBe(expected);
    expect(zonedDateISO(CROSS_MIDNIGHT, "")).toBe(expected);
    expect(zonedDateISO(CROSS_MIDNIGHT, null)).toBe(expected);
  });
});

describe("isRsvpLocked", () => {
  it("is never locked while the feature is off", () => {
    expect(isRsvpLocked(wedding({ lock_rsvp_after_deadline: false }), CROSS_MIDNIGHT)).toBe(false);
  });

  it("is never locked without a deadline set", () => {
    expect(isRsvpLocked(wedding({ rsvp_deadline: null }), CROSS_MIDNIGHT)).toBe(false);
    expect(isRsvpLocked(wedding({ rsvp_deadline: "" }), CROSS_MIDNIGHT)).toBe(false);
  });

  it("handles a missing or malformed wedding record", () => {
    expect(isRsvpLocked(null, CROSS_MIDNIGHT)).toBe(false);
    expect(isRsvpLocked(undefined, CROSS_MIDNIGHT)).toBe(false);
    expect(isRsvpLocked({}, CROSS_MIDNIGHT)).toBe(false);
  });

  it("stays open the day before the deadline", () => {
    expect(isRsvpLocked(wedding(), new Date("2026-10-30T12:00:00Z"))).toBe(false);
  });

  it("stays open ON the deadline day — the deadline is inclusive", () => {
    // 2026-10-31 23:00 SGT is still the deadline day locally.
    expect(isRsvpLocked(wedding(), new Date("2026-10-31T15:00:00Z"))).toBe(false);
  });

  it("locks once the local calendar has rolled past the deadline day", () => {
    expect(isRsvpLocked(wedding(), new Date("2026-11-01T00:30:00Z"))).toBe(true);
    expect(isRsvpLocked(wedding(), new Date("2026-12-25T00:00:00Z"))).toBe(true);
  });

  it("resolves the cutoff in the wedding's timezone, not the runner's", () => {
    // Same instant: past midnight in Singapore, still the deadline day in New York.
    expect(isRsvpLocked(wedding({ wedding_timezone: "Asia/Singapore" }), CROSS_MIDNIGHT)).toBe(true);
    expect(isRsvpLocked(wedding({ wedding_timezone: "America/New_York" }), CROSS_MIDNIGHT)).toBe(false);
  });

  it("falls back to the default timezone rather than throwing on a bad zone", () => {
    expect(isRsvpLocked(wedding({ wedding_timezone: "Nope/Nope" }), CROSS_MIDNIGHT)).toBe(true);
    expect(isRsvpLocked(wedding({ wedding_timezone: "" }), CROSS_MIDNIGHT)).toBe(true);
  });

  it("prefers the server-computed rsvp_locked flag when present", () => {
    // The DB is authoritative: an un-locked-looking record still reports locked,
    // and vice versa, so client and server can never disagree.
    expect(isRsvpLocked(wedding({ rsvp_locked: true }), new Date("2026-01-01T00:00:00Z"))).toBe(true);
    expect(isRsvpLocked(wedding({ rsvp_locked: false }), CROSS_MIDNIGHT)).toBe(false);
  });
});

describe("TIMEZONE_OPTIONS", () => {
  it("is a non-empty list of IANA zone names including the default", () => {
    expect(Array.isArray(TIMEZONE_OPTIONS)).toBe(true);
    expect(TIMEZONE_OPTIONS.length).toBeGreaterThan(0);
    expect(TIMEZONE_OPTIONS).toContain(DEFAULT_TIMEZONE);
  });

  it("has no duplicates and is sorted", () => {
    expect(new Set(TIMEZONE_OPTIONS).size).toBe(TIMEZONE_OPTIONS.length);
    expect([...TIMEZONE_OPTIONS].sort()).toEqual(TIMEZONE_OPTIONS);
  });
});
