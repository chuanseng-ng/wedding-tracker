import { describe, it, expect } from "vitest";
import { toggleId, pruneSelection, resolveDeletion, selectedGuests } from "./guestSelection.js";

// Primary + two plus-ones, plus an unrelated primary.
const GUESTS = [
  { id: "p1", name: "Alice", primary_guest_id: null },
  { id: "c1", name: "Alice +1", primary_guest_id: "p1" },
  { id: "c2", name: "Alice +2", primary_guest_id: "p1" },
  { id: "p2", name: "Bob", primary_guest_id: null },
];

describe("toggleId", () => {
  it("adds an id that is not selected", () => {
    expect([...toggleId(new Set(), "p1")]).toEqual(["p1"]);
  });

  it("removes an id that is already selected", () => {
    expect([...toggleId(new Set(["p1", "p2"]), "p1")]).toEqual(["p2"]);
  });

  it("does not mutate the input set", () => {
    const before = new Set(["p1"]);
    toggleId(before, "p2");
    expect([...before]).toEqual(["p1"]);
  });
});

describe("pruneSelection", () => {
  it("drops ids whose guest no longer exists", () => {
    // The admin polls every 5s — a row can vanish under a live selection.
    const pruned = pruneSelection(new Set(["p1", "gone"]), GUESTS);
    expect([...pruned]).toEqual(["p1"]);
  });

  it("keeps every id when all still exist", () => {
    expect([...pruneSelection(new Set(["p1", "p2"]), GUESTS)].sort()).toEqual(["p1", "p2"]);
  });

  it("returns an empty set for an empty selection", () => {
    expect(pruneSelection(new Set(), GUESTS).size).toBe(0);
  });
});

describe("selectedGuests", () => {
  it("returns the ticked guests in list order", () => {
    expect(selectedGuests(new Set(["p2", "p1"]), GUESTS).map((g) => g.id)).toEqual(["p1", "p2"]);
  });

  it("keeps a plus-one whose primary is also ticked", () => {
    // The confirmation modal counts what the admin *ticked*. resolveDeletion
    // collapses this pair to one root (the cascade takes the child), and
    // keying the modal off that count let a 2-row bulk delete render as a
    // single-guest delete and skip the mandatory typed DELETE.
    expect(selectedGuests(new Set(["p1", "c1"]), GUESTS).map((g) => g.id)).toEqual(["p1", "c1"]);
  });

  it("ignores ids with no matching guest", () => {
    expect(selectedGuests(new Set(["gone"]), GUESTS)).toEqual([]);
  });
});

describe("resolveDeletion", () => {
  it("returns nothing for an empty selection", () => {
    const { roots, removedIds } = resolveDeletion(new Set(), GUESTS);
    expect(roots).toEqual([]);
    expect(removedIds).toEqual([]);
  });

  it("expands a selected primary to its plus-ones without extra delete calls", () => {
    // The DB cascades on guests.primary_guest_id, so only the primary is
    // deleted — but the UI must account for the children it takes with it.
    const { roots, removedIds } = resolveDeletion(new Set(["p1"]), GUESTS);
    expect(roots.map((g) => g.id)).toEqual(["p1"]);
    expect([...removedIds].sort()).toEqual(["c1", "c2", "p1"]);
  });

  it("deletes a plus-one on its own without touching its primary", () => {
    const { roots, removedIds } = resolveDeletion(new Set(["c1"]), GUESTS);
    expect(roots.map((g) => g.id)).toEqual(["c1"]);
    expect(removedIds).toEqual(["c1"]);
  });

  it("does not double-delete a child selected alongside its primary", () => {
    const { roots, removedIds } = resolveDeletion(new Set(["p1", "c1"]), GUESTS);
    expect(roots.map((g) => g.id)).toEqual(["p1"]);
    expect([...removedIds].sort()).toEqual(["c1", "c2", "p1"]);
  });

  it("handles several independent primaries", () => {
    const { roots, removedIds } = resolveDeletion(new Set(["p1", "p2"]), GUESTS);
    expect(roots.map((g) => g.id).sort()).toEqual(["p1", "p2"]);
    expect([...removedIds].sort()).toEqual(["c1", "c2", "p1", "p2"]);
  });

  it("ignores selected ids with no matching guest", () => {
    const { roots, removedIds } = resolveDeletion(new Set(["gone"]), GUESTS);
    expect(roots).toEqual([]);
    expect(removedIds).toEqual([]);
  });

  it("returns the full guest objects as roots so Undo can restore them", () => {
    const { roots } = resolveDeletion(new Set(["p2"]), GUESTS);
    expect(roots[0]).toEqual(GUESTS[3]);
  });

  it("survives a self-referential row without looping forever", () => {
    // Defensive: the DB shouldn't allow it, but a bad import could.
    const cyclic = [{ id: "x", name: "X", primary_guest_id: "x" }];
    const { removedIds } = resolveDeletion(new Set(["x"]), cyclic);
    expect(removedIds).toEqual(["x"]);
  });

  it("collects grandchildren of a selected primary", () => {
    const deep = [
      { id: "a", primary_guest_id: null },
      { id: "b", primary_guest_id: "a" },
      { id: "c", primary_guest_id: "b" },
    ];
    const { roots, removedIds } = resolveDeletion(new Set(["a"]), deep);
    expect(roots.map((g) => g.id)).toEqual(["a"]);
    expect([...removedIds].sort()).toEqual(["a", "b", "c"]);
  });
});
