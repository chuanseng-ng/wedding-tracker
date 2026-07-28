// ─── GUEST DEDUPE (open-RSVP near-duplicates + admin merge) ───────────────────
// Pure helpers backing the "Possible duplicates" panel. Every rule here mirrors
// a rule in supabase/migrations/0011_guest_dedupe.sql — the database is the
// authority (the merge itself is one security-definer transaction), these
// functions exist so the admin can be shown exactly what a merge will do before
// confirming it, and so the rules are unit-testable without a live DB.
//
// Keep the two in sync: normalizeGuestName mirrors public.normalize_guest_name,
// eventMergePlan mirrors the newest-wins guest_event_rsvps reconciliation, and
// childMergePlan mirrors the plus-one reparent + 6-child cap.
import { trigramSimilarity } from "./nameMatch.js";

// Threshold for "these might be the same person". Deliberately higher than the
// 0.4 used by the legacy submit_rsvp_by_name (0002_rsvp_seating.sql:315), which
// is loose enough to collide unrelated guests. It is also a security control on
// the public path: at 0.55 a short probe like "Tan" matches nobody, so a guest
// holding the RSVP PIN cannot enumerate the guest list one fragment at a time.
export const DEDUPE_THRESHOLD = 0.55;

// Plus-ones per primary guest. The public RSVP path silently truncates to this
// (0002_rsvp_seating.sql:254, 0004_smart_rsvp.sql:427); a merge applies it
// deliberately instead, and records what it dropped.
export const MAX_CHILDREN = 6;

// D-Day state. Carried over separately from the text fields below because
// "blank" means something different per type (false / 0 rather than ''), and
// because losing it is the one silent data loss that would bite on the day
// itself: a walk-in who was checked in and handed over an ang-bao must not be
// un-checked-in by an administrative merge.
export const MERGE_CARRY_FIELDS = ["checked_in", "angbao_given", "is_vip", "angbao_amount"];

// Fields the duplicate may contribute when the canonical's own value is blank.
// The canonical always wins a genuine disagreement — see mergePreview.
export const MERGE_FILL_FIELDS = [
  "rsvp_status",
  "meal_choice",
  "dietary_notes",
  "phone",
  "email",
  "plus_one_name",
  "rsvp_message",
  "notes",
  "relationship_group",
  "friend_subgroup",
  "wants_to_speak",
  "party",
];

// Mirror of public.normalize_guest_name: lowercase, then collapse every run of
// non-alphanumeric characters to a single space and trim.
//
// \p{L}\p{N} is the JS equivalent of Postgres's [[:alnum:]] — both are Unicode
// aware, so Chinese names survive. A naive [^a-z0-9] would erase them entirely.
export const normalizeGuestName = (v) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// Trigram similarity over normalized names, so formatting differences score 1
// rather than merely scoring high. 0 when either side has no name content —
// an empty string is similar to everything, which would flag the whole list.
export function nameSimilarity(a, b) {
  const na = normalizeGuestName(a);
  const nb = normalizeGuestName(b);
  if (!na || !nb) return 0;
  return trigramSimilarity(na, nb);
}

export const isNearDuplicate = (a, b, threshold = DEDUPE_THRESHOLD) =>
  nameSimilarity(a, b) >= threshold;

// 'pending' is the rsvp_status default (0002_rsvp_seating.sql:40) — treat it as
// "no answer yet" so a duplicate's real answer can fill it, and so a duplicate
// that never answered can't overwrite a confirmed canonical.
const isBlankValue = (field, value) => {
  const s = String(value ?? "").trim();
  if (!s) return true;
  return field === "rsvp_status" && s === "pending";
};

// Ang-bao is a numeric amount, the rest are booleans; both are "blank" at their
// zero value rather than at ''.
const carryValue = (field, row) =>
  field === "angbao_amount" ? Number(row?.[field] ?? 0) || 0 : !!row?.[field];

/**
 * What merging `duplicate` into `canonical` does to the canonical's own columns.
 *
 * @returns {{ fills: {field: string, value: string}[],
 *             conflicts: {field: string, keep: string, discard: string}[],
 *             carries: {field: string, value: boolean|number}[] }}
 *   fills — blank canonical fields the duplicate will populate.
 *   conflicts — fields where both sides have a value and they disagree. The
 *   canonical's value survives; these are surfaced so the admin sees what the
 *   merge throws away before confirming.
 *   carries — D-Day state the duplicate contributes (a set flag, or an ang-bao
 *   amount where the canonical has none).
 */
export function mergePreview(canonical, duplicate) {
  const fills = [];
  const conflicts = [];
  const carries = [];

  for (const field of MERGE_FILL_FIELDS) {
    const dv = String(duplicate?.[field] ?? "").trim();
    const cv = String(canonical?.[field] ?? "").trim();

    if (isBlankValue(field, dv)) continue;
    if (isBlankValue(field, cv)) {
      fills.push({ field, value: dv });
      continue;
    }
    if (cv === dv) continue;
    conflicts.push({ field, keep: cv, discard: dv });
  }

  for (const field of MERGE_CARRY_FIELDS) {
    const dv = carryValue(field, duplicate);
    const cv = carryValue(field, canonical);

    if (!dv) continue;
    if (!cv) {
      carries.push({ field, value: dv });
      continue;
    }
    // Two different ang-bao amounts is a real disagreement; two true flags is not.
    if (field === "angbao_amount" && cv !== dv) {
      conflicts.push({ field, keep: cv, discard: dv });
    }
  }

  return { fills, conflicts, carries };
}

const respondedAtMs = (row) => {
  const t = Date.parse(row?.responded_at ?? "");
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * Per-event reconciliation, newest answer wins.
 *
 * Only the duplicate's rows can change anything, so the plan is keyed off them;
 * events only the canonical answered are untouched and absent from the result.
 *
 * @returns {{ event_id: string, action: 'move'|'take'|'keep', status: string,
 *             meal_choice: string, dietary_notes: string, conflict: boolean }[]}
 *   move — the canonical has no row for this event; the duplicate's row moves over.
 *   take — both answered; the duplicate answered more recently, so it wins.
 *   keep — both answered; the canonical's answer is at least as recent.
 *   conflict — this event's status actually changes (drives the ⚠ in the preview).
 */
export function eventMergePlan(canonicalRsvps, duplicateRsvps) {
  const byEvent = new Map((canonicalRsvps ?? []).map((r) => [r.event_id, r]));

  return (duplicateRsvps ?? []).map((dup) => {
    const own = byEvent.get(dup.event_id);
    const winner = !own || respondedAtMs(dup) > respondedAtMs(own) ? dup : own;
    const action = !own ? "move" : winner === dup ? "take" : "keep";

    return {
      event_id: dup.event_id,
      action,
      status: winner.status,
      meal_choice: winner.meal_choice ?? "",
      dietary_notes: winner.dietary_notes ?? "",
      conflict: !!own && own.status !== winner.status,
    };
  });
}

/**
 * Which of the duplicate's plus-ones can be reparented onto the canonical.
 *
 * Drops a plus-one the canonical already has (matched on the normalized name,
 * the same way the public RSVP path reconciles children by name), and enforces
 * the per-primary cap. Dropped rows are returned so merge_guests can record
 * them in guest_merges.dropped_children rather than losing them silently.
 *
 * @returns {{ moved: object[], dropped: (object & {reason: string})[] }}
 */
export function childMergePlan(canonicalChildren, duplicateChildren, cap = MAX_CHILDREN) {
  const seen = new Set((canonicalChildren ?? []).map((c) => normalizeGuestName(c.name)));
  const capacity = Math.max(0, cap - (canonicalChildren ?? []).length);
  const moved = [];
  const dropped = [];

  for (const child of duplicateChildren ?? []) {
    const norm = normalizeGuestName(child.name);
    if (!norm) {
      dropped.push({ ...child, reason: "blank_name" });
    } else if (seen.has(norm)) {
      dropped.push({ ...child, reason: "duplicate_name" });
    } else if (moved.length >= capacity) {
      dropped.push({ ...child, reason: "cap_reached" });
    } else {
      seen.add(norm);
      moved.push(child);
    }
  }

  return { moved, dropped };
}
