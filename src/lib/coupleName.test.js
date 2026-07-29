import { describe, it, expect } from "vitest";
import {
  NAME_ORDERS,
  DEFAULT_NAME_ORDER,
  cleanNameOrder,
  coupleParts,
  coupleName,
  partyOrder,
} from "./coupleName.js";

const BRIDE_FIRST = { bride_name: "Siew Yong", groom_name: "Wei Ming", name_order: "bride_first" };
const GROOM_FIRST = { ...BRIDE_FIRST, name_order: "groom_first" };
// Rows written before 0012 have no name_order column at all.
const LEGACY = { bride_name: "Siew Yong", groom_name: "Wei Ming" };

describe("cleanNameOrder", () => {
  it("passes through the two known orders", () => {
    expect(cleanNameOrder("bride_first")).toBe("bride_first");
    expect(cleanNameOrder("groom_first")).toBe("groom_first");
  });

  it("falls back to bride_first for anything else", () => {
    // Legacy rows, typos, and hostile input must never reach the DB CHECK.
    expect(cleanNameOrder(undefined)).toBe(DEFAULT_NAME_ORDER);
    expect(cleanNameOrder(null)).toBe(DEFAULT_NAME_ORDER);
    expect(cleanNameOrder("")).toBe(DEFAULT_NAME_ORDER);
    expect(cleanNameOrder("GROOM_FIRST")).toBe(DEFAULT_NAME_ORDER);
    expect(cleanNameOrder("drop table")).toBe(DEFAULT_NAME_ORDER);
    expect(cleanNameOrder(7)).toBe(DEFAULT_NAME_ORDER);
  });

  it("defaults to bride_first, preserving pre-0012 rendering", () => {
    expect(DEFAULT_NAME_ORDER).toBe("bride_first");
    expect(NAME_ORDERS).toEqual(["bride_first", "groom_first"]);
  });
});

describe("coupleParts", () => {
  it("orders bride first by default", () => {
    expect(coupleParts(BRIDE_FIRST)).toEqual(["Siew Yong", "Wei Ming"]);
    expect(coupleParts(LEGACY)).toEqual(["Siew Yong", "Wei Ming"]);
  });

  it("swaps when name_order is groom_first", () => {
    expect(coupleParts(GROOM_FIRST)).toEqual(["Wei Ming", "Siew Yong"]);
  });

  it("is safe on null/partial rows", () => {
    expect(coupleParts(null)).toEqual(["", ""]);
    expect(coupleParts(undefined)).toEqual(["", ""]);
    expect(coupleParts({})).toEqual(["", ""]);
    expect(coupleParts({ bride_name: "Siew Yong" })).toEqual(["Siew Yong", ""]);
    // A groom-first row missing the bride still puts the groom first.
    expect(coupleParts({ groom_name: "Wei Ming", name_order: "groom_first" })).toEqual(["Wei Ming", ""]);
  });

  it("trims surrounding whitespace", () => {
    expect(coupleParts({ bride_name: "  Siew Yong  ", groom_name: "Wei Ming" }))
      .toEqual(["Siew Yong", "Wei Ming"]);
  });
});

describe("coupleName", () => {
  it("joins with ' & ' in the configured order", () => {
    expect(coupleName(BRIDE_FIRST)).toBe("Siew Yong & Wei Ming");
    expect(coupleName(GROOM_FIRST)).toBe("Wei Ming & Siew Yong");
    expect(coupleName(LEGACY)).toBe("Siew Yong & Wei Ming");
  });

  it("honours a custom separator (CSV filenames, slugs)", () => {
    expect(coupleName(BRIDE_FIRST, { sep: "-" })).toBe("Siew Yong-Wei Ming");
    expect(coupleName(GROOM_FIRST, { sep: "-and-" })).toBe("Wei Ming-and-Siew Yong");
  });

  it("returns the fallback unless BOTH names are present", () => {
    // Matches the existing `bride_name && groom_name` guards at the call sites.
    expect(coupleName(null)).toBe("");
    expect(coupleName({}, { fallback: "Wedding" })).toBe("Wedding");
    expect(coupleName({ bride_name: "Siew Yong" }, { fallback: "Wedding" })).toBe("Wedding");
    expect(coupleName({ bride_name: "  ", groom_name: "Wei Ming" }, { fallback: "Wedding" })).toBe("Wedding");
  });

  it("defaults the fallback to an empty string", () => {
    expect(coupleName({ bride_name: "Siew Yong" })).toBe("");
  });
});

describe("partyOrder", () => {
  it("mirrors the name order for side-keyed UI", () => {
    expect(partyOrder(BRIDE_FIRST)).toEqual(["bride", "groom"]);
    expect(partyOrder(LEGACY)).toEqual(["bride", "groom"]);
    expect(partyOrder(GROOM_FIRST)).toEqual(["groom", "bride"]);
    expect(partyOrder(null)).toEqual(["bride", "groom"]);
  });

  it("returns a fresh array each call", () => {
    // Callers .map() over this; a shared array would be a mutation hazard.
    const a = partyOrder(GROOM_FIRST);
    a.push("x");
    expect(partyOrder(GROOM_FIRST)).toEqual(["groom", "bride"]);
  });
});
