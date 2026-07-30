// Multi-select bookkeeping for the RSVP dashboard's guest list (#178).
//
// Deleting guests one at a time is slow on a long list, so the RSVP tab lets
// the couple tick several rows and delete them in one confirmed action. The
// fiddly part is plus-ones: `guests.primary_guest_id` is declared
// `on delete cascade` (0002_rsvp_seating.sql), so removing a primary silently
// removes the party they registered. resolveDeletion() splits that into the
// two different lists the UI needs — the rows to issue deletes for, and the
// rows that will actually disappear.

// Immutable add/remove — React state must not be mutated in place.
export function toggleId(selectedIds, id) {
  const next = new Set(selectedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// Drop ids whose guest is gone. The admin polls every 5s, so a row can vanish
// (another device deleted it, a merge folded it away) while a selection is
// live; without this the count would lie and the delete would no-op.
export function pruneSelection(selectedIds, guests) {
  const live = new Set(guests.map((g) => g.id));
  return new Set([...selectedIds].filter((id) => live.has(id)));
}

// Split a selection into:
//   roots      — the guest objects to call sb.delete() on. A selected guest
//                whose own primary is also selected is skipped: the cascade
//                takes it, and deleting it separately is a wasted round-trip.
//                Full objects (not ids) so the Undo toast can re-insert them.
//   removedIds — every id that will leave the list, roots plus their
//                descendants. Drives the optimistic local removal and the
//                count in the confirmation modal, so "Delete 3" never quietly
//                removes 5.
export function resolveDeletion(selectedIds, guests) {
  const byId = new Map(guests.map((g) => [g.id, g]));
  const selected = [...selectedIds].filter((id) => byId.has(id));

  const childrenOf = guests.reduce((acc, g) => {
    const parent = g.primary_guest_id;
    // Skip self-references: the DB shouldn't allow one, but a bad import
    // could, and it would otherwise spin the descendant walk below forever.
    if (!parent || parent === g.id) return acc;
    if (!acc.has(parent)) acc.set(parent, []);
    acc.get(parent).push(g.id);
    return acc;
  }, new Map());

  const selectedSet = new Set(selected);
  const roots = selected
    .filter((id) => {
      const parent = byId.get(id).primary_guest_id;
      // `parent === id` is the same bad-import guard as childrenOf above —
      // a self-referential row must still count as its own root.
      return !parent || parent === id || !selectedSet.has(parent);
    })
    .map((id) => byId.get(id));

  // Breadth-first over the cascade. `removedIds` doubles as the visited set,
  // so a cycle can't loop.
  const removedIds = [];
  const seen = new Set();
  const queue = roots.map((g) => g.id);
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    removedIds.push(id);
    queue.push(...(childrenOf.get(id) || []));
  }

  return { roots, removedIds };
}
