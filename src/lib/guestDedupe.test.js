import { describe, it, expect } from "vitest";
import {
  DEDUPE_THRESHOLD,
  MERGE_FILL_FIELDS,
  normalizeGuestName,
  nameSimilarity,
  isNearDuplicate,
  mergePreview,
  eventMergePlan,
  childMergePlan,
} from "./guestDedupe.js";

// Tiny factories, matching the fixture style in src/admin/wishesWrapped.test.js.
const guest = (over = {}) => ({
  id: over.id ?? "g1",
  name: "Tan Wei Ming",
  rsvp_status: "pending",
  meal_choice: "",
  dietary_notes: "",
  phone: "",
  email: "",
  plus_one_name: "",
  rsvp_message: "",
  notes: "",
  relationship_group: "",
  friend_subgroup: "",
  wants_to_speak: "",
  party: "",
  ...over,
});

const rsvp = (event_id, status, responded_at, over = {}) => ({
  event_id,
  status,
  responded_at,
  meal_choice: "",
  dietary_notes: "",
  ...over,
});

describe("normalizeGuestName", () => {
  it("collapses case, punctuation and repeated whitespace", () => {
    expect(normalizeGuestName("Wei-Ming  TAN")).toBe("wei ming tan");
    expect(normalizeGuestName("  Tan, Wei Ming  ")).toBe("tan wei ming");
    expect(normalizeGuestName("O'Brien")).toBe("o brien");
  });

  it("makes the formatting-only duplicate that motivated this feature collide", () => {
    expect(normalizeGuestName("Wei-Ming Tan")).toBe(normalizeGuestName("wei ming tan"));
  });

  it("preserves CJK characters — a naive [^a-z0-9] strip would erase these names", () => {
    expect(normalizeGuestName("陳偉明")).toBe("陳偉明");
    expect(normalizeGuestName("陳偉明 (Wei Ming)")).toBe("陳偉明 wei ming");
  });

  it("preserves digits", () => {
    expect(normalizeGuestName("Guest 2")).toBe("guest 2");
  });

  it("returns an empty string for nullish or punctuation-only input", () => {
    expect(normalizeGuestName(null)).toBe("");
    expect(normalizeGuestName(undefined)).toBe("");
    expect(normalizeGuestName("   ")).toBe("");
    expect(normalizeGuestName("---")).toBe("");
  });
});

describe("nameSimilarity", () => {
  it("scores identical normalized names as 1", () => {
    expect(nameSimilarity("Wei-Ming Tan", "wei ming tan")).toBe(1);
  });

  it("scores unrelated names below the threshold", () => {
    expect(nameSimilarity("Sarah Tan", "Sarah Lim")).toBeLessThan(DEDUPE_THRESHOLD);
  });

  it("scores a single-letter typo above the threshold", () => {
    expect(nameSimilarity("Jonathan Lim", "Jonathon Lim")).toBeGreaterThanOrEqual(DEDUPE_THRESHOLD);
  });

  it("returns 0 when either name normalizes to empty", () => {
    expect(nameSimilarity("", "Tan Wei Ming")).toBe(0);
    expect(nameSimilarity("...", "Tan Wei Ming")).toBe(0);
  });
});

describe("isNearDuplicate", () => {
  it("flags names that differ only in punctuation, case or spacing", () => {
    expect(isNearDuplicate("Wei-Ming Tan", "Wei Ming Tan")).toBe(true);
    expect(isNearDuplicate("wei ming  tan", "Wei Ming Tan")).toBe(true);
  });

  it("flags a genuine typo", () => {
    expect(isNearDuplicate("Jonathan Lim", "Jonathon Lim")).toBe(true);
  });

  it("does not flag different people who share a given name", () => {
    expect(isNearDuplicate("Sarah Tan", "Sarah Lim")).toBe(false);
  });

  it("does not flag a short fragment against a full name — this is the harvesting guard", () => {
    expect(isNearDuplicate("Tan", "Tan Wei Ming")).toBe(false);
    expect(isNearDuplicate("Li", "Lim Siew Yong")).toBe(false);
  });

  it("never flags empty input", () => {
    expect(isNearDuplicate("", "Tan Wei Ming")).toBe(false);
    expect(isNearDuplicate("Tan Wei Ming", "")).toBe(false);
  });

  it("honours an explicit threshold override", () => {
    expect(isNearDuplicate("Sarah Tan", "Sarah Lim", 0.2)).toBe(true);
  });
});

describe("mergePreview", () => {
  it("fills a blank canonical field from the duplicate", () => {
    const canonical = guest({ id: "c", meal_choice: "" });
    const duplicate = guest({ id: "d", meal_choice: "vegetarian" });
    const { fills, conflicts } = mergePreview(canonical, duplicate);

    expect(fills).toEqual([{ field: "meal_choice", value: "vegetarian" }]);
    expect(conflicts).toEqual([]);
  });

  it("keeps the canonical value and reports the discarded one as a conflict", () => {
    const canonical = guest({ id: "c", phone: "91230000" });
    const duplicate = guest({ id: "d", phone: "98760000" });
    const { fills, conflicts } = mergePreview(canonical, duplicate);

    expect(fills).toEqual([]);
    expect(conflicts).toEqual([{ field: "phone", keep: "91230000", discard: "98760000" }]);
  });

  it("reports neither when both sides are blank or identical", () => {
    const canonical = guest({ id: "c", email: "a@b.com", notes: "" });
    const duplicate = guest({ id: "d", email: "a@b.com", notes: "" });
    const { fills, conflicts } = mergePreview(canonical, duplicate);

    expect(fills).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it("treats a pending canonical rsvp_status as blank so a real answer fills it", () => {
    const canonical = guest({ id: "c", rsvp_status: "pending" });
    const duplicate = guest({ id: "d", rsvp_status: "confirmed" });

    expect(mergePreview(canonical, duplicate).fills).toContainEqual({
      field: "rsvp_status",
      value: "confirmed",
    });
  });

  it("does not let a duplicate's pending status overwrite a confirmed canonical", () => {
    const canonical = guest({ id: "c", rsvp_status: "confirmed" });
    const duplicate = guest({ id: "d", rsvp_status: "pending" });
    const { fills, conflicts } = mergePreview(canonical, duplicate);

    expect(fills).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it("reports a genuine status disagreement as a conflict", () => {
    const canonical = guest({ id: "c", rsvp_status: "confirmed" });
    const duplicate = guest({ id: "d", rsvp_status: "declined" });

    expect(mergePreview(canonical, duplicate).conflicts).toEqual([
      { field: "rsvp_status", keep: "confirmed", discard: "declined" },
    ]);
  });

  it("ignores whitespace-only duplicate values", () => {
    const canonical = guest({ id: "c", notes: "" });
    const duplicate = guest({ id: "d", notes: "   " });

    expect(mergePreview(canonical, duplicate).fills).toEqual([]);
  });

  it("carries a set flag over so a merge cannot un-check-in a walk-in", () => {
    const canonical = guest({ id: "c", checked_in: false, angbao_given: false });
    const duplicate = guest({ id: "d", checked_in: true, angbao_given: true });
    const { carries, conflicts } = mergePreview(canonical, duplicate);

    expect(carries).toEqual([
      { field: "checked_in", value: true },
      { field: "angbao_given", value: true },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("does not report a carry when the canonical already has the flag", () => {
    const canonical = guest({ id: "c", is_vip: true });
    const duplicate = guest({ id: "d", is_vip: true });

    expect(mergePreview(canonical, duplicate).carries).toEqual([]);
  });

  it("does not let an unset duplicate flag clear the canonical's", () => {
    const canonical = guest({ id: "c", checked_in: true });
    const duplicate = guest({ id: "d", checked_in: false });
    const { carries, conflicts } = mergePreview(canonical, duplicate);

    expect(carries).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it("fills a zero ang-bao amount but flags two different amounts as a conflict", () => {
    expect(mergePreview(guest({ angbao_amount: 0 }), guest({ angbao_amount: 88 })).carries).toEqual([
      { field: "angbao_amount", value: 88 },
    ]);
    expect(
      mergePreview(guest({ angbao_amount: 88 }), guest({ angbao_amount: 168 })).conflicts
    ).toEqual([{ field: "angbao_amount", keep: 88, discard: 168 }]);
  });

  it("covers every mergeable field and nothing else", () => {
    const over = Object.fromEntries(MERGE_FILL_FIELDS.map((f) => [f, "x"]));
    const canonical = guest({ id: "c" });
    const duplicate = guest({ id: "d", ...over, rsvp_status: "confirmed" });
    const fields = mergePreview(canonical, duplicate).fills.map((f) => f.field);

    expect(fields.sort()).toEqual([...MERGE_FILL_FIELDS].sort());
  });
});

describe("eventMergePlan", () => {
  it("moves events the canonical was never enrolled in", () => {
    const plan = eventMergePlan([], [rsvp("e1", "confirmed", "2026-01-02T00:00:00Z")]);
    expect(plan).toEqual([
      expect.objectContaining({ event_id: "e1", action: "move", status: "confirmed" }),
    ]);
  });

  it("takes the duplicate's answer when it is newer", () => {
    const plan = eventMergePlan(
      [rsvp("e1", "confirmed", "2026-01-01T00:00:00Z")],
      [rsvp("e1", "declined", "2026-01-02T00:00:00Z")]
    );
    expect(plan).toEqual([
      expect.objectContaining({ event_id: "e1", action: "take", status: "declined" }),
    ]);
  });

  it("keeps the canonical's answer when it is newer", () => {
    const plan = eventMergePlan(
      [rsvp("e1", "confirmed", "2026-01-03T00:00:00Z")],
      [rsvp("e1", "declined", "2026-01-02T00:00:00Z")]
    );
    expect(plan).toEqual([
      expect.objectContaining({ event_id: "e1", action: "keep", status: "confirmed" }),
    ]);
  });

  it("treats a never-answered canonical row as older than any real answer", () => {
    const plan = eventMergePlan(
      [rsvp("e1", "pending", null)],
      [rsvp("e1", "confirmed", "2026-01-02T00:00:00Z")]
    );
    expect(plan[0].action).toBe("take");
  });

  it("keeps the canonical when neither side ever answered", () => {
    const plan = eventMergePlan([rsvp("e1", "pending", null)], [rsvp("e1", "pending", null)]);
    expect(plan[0].action).toBe("keep");
  });

  it("marks a changed answer as a conflict for the preview, and an unchanged one not", () => {
    const changed = eventMergePlan(
      [rsvp("e1", "confirmed", "2026-01-01T00:00:00Z")],
      [rsvp("e1", "declined", "2026-01-02T00:00:00Z")]
    );
    const same = eventMergePlan(
      [rsvp("e2", "confirmed", "2026-01-01T00:00:00Z")],
      [rsvp("e2", "confirmed", "2026-01-02T00:00:00Z")]
    );
    expect(changed[0].conflict).toBe(true);
    expect(same[0].conflict).toBe(false);
  });

  it("ignores canonical-only events entirely", () => {
    expect(eventMergePlan([rsvp("e1", "confirmed", "2026-01-01T00:00:00Z")], [])).toEqual([]);
  });

  it("handles a mixed set", () => {
    const plan = eventMergePlan(
      [rsvp("e1", "confirmed", "2026-01-03T00:00:00Z"), rsvp("e2", "pending", null)],
      [
        rsvp("e1", "declined", "2026-01-01T00:00:00Z"),
        rsvp("e2", "confirmed", "2026-01-02T00:00:00Z"),
        rsvp("e3", "confirmed", "2026-01-02T00:00:00Z"),
      ]
    );
    expect(plan.map((p) => [p.event_id, p.action])).toEqual([
      ["e1", "keep"],
      ["e2", "take"],
      ["e3", "move"],
    ]);
  });
});

describe("childMergePlan", () => {
  const child = (name) => ({ id: name, name });

  it("moves the duplicate's plus-ones to the canonical", () => {
    const { moved, dropped } = childMergePlan([], [child("Amy Tan")]);
    expect(moved.map((c) => c.name)).toEqual(["Amy Tan"]);
    expect(dropped).toEqual([]);
  });

  it("drops a plus-one the canonical already has, matching on the normalized name", () => {
    const { moved, dropped } = childMergePlan([child("Amy Tan")], [child("amy  tan")]);
    expect(moved).toEqual([]);
    expect(dropped).toEqual([
      expect.objectContaining({ name: "amy  tan", reason: "duplicate_name" }),
    ]);
  });

  it("drops duplicates within the incoming set too", () => {
    const { moved, dropped } = childMergePlan([], [child("Amy Tan"), child("AMY TAN")]);
    expect(moved).toHaveLength(1);
    expect(dropped).toHaveLength(1);
  });

  it("enforces the 6-child cap the public RSVP path silently applies", () => {
    const existing = ["a", "b", "c", "d"].map(child);
    const incoming = ["e", "f", "g"].map(child);
    const { moved, dropped } = childMergePlan(existing, incoming);

    expect(moved.map((c) => c.name)).toEqual(["e", "f"]);
    expect(dropped).toEqual([expect.objectContaining({ name: "g", reason: "cap_reached" })]);
  });

  it("drops everything when the canonical is already at the cap", () => {
    const existing = ["a", "b", "c", "d", "e", "f"].map(child);
    const { moved, dropped } = childMergePlan(existing, [child("g")]);

    expect(moved).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it("honours a cap override", () => {
    const { moved, dropped } = childMergePlan([], [child("a"), child("b")], 1);
    expect(moved).toHaveLength(1);
    expect(dropped).toHaveLength(1);
  });

  it("skips blank names rather than moving them", () => {
    const { moved, dropped } = childMergePlan([], [child("   ")]);
    expect(moved).toEqual([]);
    expect(dropped).toEqual([expect.objectContaining({ reason: "blank_name" })]);
  });
});
