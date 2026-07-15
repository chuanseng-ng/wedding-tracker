import { describe, it, expect, vi, afterEach } from "vitest";
import {
  authorizedHelperEmail,
  authorizedCoupleEmail,
  isCoupleEmail,
  makeRateLimiter,
} from "./requireCoupleAuth.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("authorizedHelperEmail", () => {
  it("returns null when there is no Authorization header", async () => {
    expect(await authorizedHelperEmail({ headers: {} })).toBe(null);
  });

  it("returns null for a non-Bearer Authorization header", async () => {
    expect(await authorizedHelperEmail({ headers: { authorization: "Basic abc" } })).toBe(null);
  });

  it("fails closed (null) when token verification throws", async () => {
    // No SUPABASE_SERVICE_ROLE_KEY in the test env → supabaseAdmin() throws.
    expect(await authorizedHelperEmail({ headers: { authorization: "Bearer sometoken" } })).toBe(null);
  });
});

describe("isCoupleEmail", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    for (const key of ["COUPLE_EMAIL", "VITE_COUPLE_EMAIL", "HELPER_EMAIL", "VITE_HELPER_EMAIL"]) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("matches only the configured couple email (case/space-insensitive)", () => {
    process.env.COUPLE_EMAIL = "Couple@Wedding.local";
    process.env.HELPER_EMAIL = "helper@wedding.local";
    expect(isCoupleEmail(" couple@wedding.local ")).toBe(true);
    expect(isCoupleEmail("helper@wedding.local")).toBe(false);
    expect(isCoupleEmail("other@x.com")).toBe(false);
    expect(isCoupleEmail(null)).toBe(false);
  });

  it("falls back to VITE_COUPLE_EMAIL", () => {
    delete process.env.COUPLE_EMAIL;
    process.env.VITE_COUPLE_EMAIL = "couple@wedding.local";
    expect(isCoupleEmail("couple@wedding.local")).toBe(true);
  });

  it("falls open to any authorized account when no couple email is configured (back-compat)", () => {
    delete process.env.COUPLE_EMAIL;
    delete process.env.VITE_COUPLE_EMAIL;
    expect(isCoupleEmail("anyone@x.com")).toBe(true);
  });
});

describe("authorizedCoupleEmail", () => {
  it("fails closed (null) without a valid token", async () => {
    expect(await authorizedCoupleEmail({ headers: {} })).toBe(null);
    expect(await authorizedCoupleEmail({ headers: { authorization: "Bearer tok" } })).toBe(null);
  });
});

describe("makeRateLimiter", () => {
  it("allows up to max hits per window, then limits", () => {
    const limited = makeRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limited("a@b.com")).toBe(false);
    expect(limited("a@b.com")).toBe(false);
    expect(limited("a@b.com")).toBe(false);
    expect(limited("a@b.com")).toBe(true);
  });

  it("tracks keys independently", () => {
    const limited = makeRateLimiter({ windowMs: 60_000, max: 1 });
    expect(limited("a@b.com")).toBe(false);
    expect(limited("c@d.com")).toBe(false);
    expect(limited("a@b.com")).toBe(true);
  });

  it("forgets hits after the window passes", () => {
    vi.useFakeTimers();
    const limited = makeRateLimiter({ windowMs: 1000, max: 1 });
    expect(limited("a@b.com")).toBe(false);
    expect(limited("a@b.com")).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(limited("a@b.com")).toBe(false);
  });
});
