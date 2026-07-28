import { useMemo, useState } from "react";
import { mergePreview, eventMergePlan, childMergePlan } from "../lib/guestDedupe.js";

// Couple-only by construction: the whole RSVP tab is gated `role !== "helper"`
// in AdminApp, and merge_guests / dismiss_duplicate_pair enforce it again
// server-side. This component holds no `sb` access — every write goes back up
// through a callback, matching the rest of RsvpTab.

const styles = `
  .dup-panel { background: #fff8e6; border: 1px solid rgba(201,168,76,0.4); border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
  .dup-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px 16px; background: none; border: none; font-family: inherit; font-size: 13px; color: var(--gold-dark); cursor: pointer; text-align: left; }
  .dup-head-count { margin-left: auto; opacity: 0.7; font-size: 12px; }
  .dup-body { padding: 0 16px 12px; display: flex; flex-direction: column; gap: 8px; }
  .dup-pair { background: white; border: 1px solid rgba(201,168,76,0.25); border-radius: 8px; padding: 10px 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .dup-names { flex: 1; min-width: 200px; font-size: 13px; color: var(--charcoal); }
  .dup-arrow { opacity: 0.5; margin: 0 6px; }
  .dup-meta { font-size: 11px; color: var(--brown); opacity: 0.7; margin-top: 2px; }
  .dup-actions { display: flex; gap: 6px; }
  .dup-modal { max-width: 520px; }
  .dup-preview { font-size: 13px; color: var(--charcoal); line-height: 1.6; }
  .dup-preview-group { margin-bottom: 14px; }
  .dup-preview-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--brown); font-weight: 500; margin-bottom: 4px; }
  .dup-preview ul { margin: 0; padding-left: 18px; }
  .dup-preview li { margin-bottom: 2px; }
  .dup-warn { color: var(--gold-dark); }
  .dup-none { opacity: 0.6; font-style: italic; }
`;

const FIELD_LABELS = {
  rsvp_status: "RSVP status",
  meal_choice: "Meal choice",
  dietary_notes: "Dietary notes",
  phone: "Phone",
  email: "Email",
  plus_one_name: "Plus-one name",
  rsvp_message: "Message",
  notes: "Notes",
  relationship_group: "Relationship",
  friend_subgroup: "Friend group",
  wants_to_speak: "Wants to speak",
  party: "Side",
  checked_in: "Checked in",
  angbao_given: "Ang-bao received",
  angbao_amount: "Ang-bao amount",
  is_vip: "VIP",
};

const label = (field) => FIELD_LABELS[field] || field;

export default function DuplicatesPanel({
  candidates = [],
  guests = [],
  events = [],
  eventRsvps = [],
  onMerge,
  onDismiss,
}) {
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState(null); // { duplicate, canonical }
  const [busy, setBusy] = useState(false);

  const guestById = useMemo(() => Object.fromEntries(guests.map((g) => [g.id, g])), [guests]);
  const eventName = useMemo(
    () => Object.fromEntries(events.map((e) => [e.id, e.name || "Untitled"])),
    [events]
  );
  const childrenOf = useMemo(() => {
    const map = {};
    for (const g of guests) {
      if (!g.primary_guest_id) continue;
      (map[g.primary_guest_id] ||= []).push(g);
    }
    return map;
  }, [guests]);
  const rsvpsOf = useMemo(() => {
    const map = {};
    for (const r of eventRsvps) (map[r.guest_id] ||= []).push(r);
    return map;
  }, [eventRsvps]);

  // The RPC returns up to 3 canonicals per duplicate; show them under one heading.
  const groups = useMemo(() => {
    const byDuplicate = new Map();
    for (const c of candidates) {
      if (!byDuplicate.has(c.duplicate_id)) {
        byDuplicate.set(c.duplicate_id, { id: c.duplicate_id, name: c.duplicate_name, matches: [] });
      }
      byDuplicate.get(c.duplicate_id).matches.push(c);
    }
    return [...byDuplicate.values()];
  }, [candidates]);

  const preview = useMemo(() => {
    if (!pending) return null;
    const canonical = guestById[pending.canonicalId];
    const duplicate = guestById[pending.duplicateId];
    if (!canonical || !duplicate) return null;

    const { fills, conflicts, carries } = mergePreview(canonical, duplicate);
    const eventPlan = eventMergePlan(rsvpsOf[canonical.id] || [], rsvpsOf[duplicate.id] || []).filter(
      (p) => p.action !== "keep"
    );
    const { moved, dropped } = childMergePlan(
      childrenOf[canonical.id] || [],
      childrenOf[duplicate.id] || []
    );
    return { canonical, duplicate, fills, conflicts, carries, eventPlan, moved, dropped };
  }, [pending, guestById, rsvpsOf, childrenOf]);

  if (!groups.length) return null;

  const confirmMerge = async () => {
    setBusy(true);
    try {
      await onMerge(pending.canonicalId, pending.duplicateId);
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <style>{styles}</style>
      <div className="dup-panel">
        <button
          type="button"
          className="dup-head"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span>{open ? "▼" : "▶"}</span>
          <span>⚠️ Possible duplicate guests</span>
          <span className="dup-head-count">
            {groups.length} self-registered {groups.length === 1 ? "name looks" : "names look"} like
            someone already on your list
          </span>
        </button>

        {open && (
          <div className="dup-body">
            {groups.map((group) =>
              group.matches.map((m) => (
                <div key={`${m.duplicate_id}:${m.canonical_id}`} className="dup-pair">
                  <div className="dup-names">
                    <strong>{m.duplicate_name}</strong>
                    <span className="dup-arrow">→</span>
                    <strong>{m.canonical_name}</strong>
                    <div className="dup-meta">
                      {m.match_kind === "normalized"
                        ? "same name apart from spacing or punctuation"
                        : `${Math.round((m.similarity || 0) * 100)}% similar`}
                    </div>
                  </div>
                  <div className="dup-actions">
                    <button
                      className="rsvp-btn rsvp-btn-cancel"
                      onClick={() => onDismiss(m.duplicate_id, m.canonical_id)}
                    >
                      Not a duplicate
                    </button>
                    <button
                      className="rsvp-btn rsvp-btn-save"
                      onClick={() =>
                        setPending({ duplicateId: m.duplicate_id, canonicalId: m.canonical_id })
                      }
                    >
                      Merge…
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {pending && preview && (
        <div className="modal-overlay" onClick={() => !busy && setPending(null)}>
          <div className="modal dup-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">
              Merge “{preview.duplicate.name}” into “{preview.canonical.name}”?
            </div>

            <div className="dup-preview">
              <div className="dup-preview-group">
                <div className="dup-preview-label">Result</div>
                <div>
                  “{preview.canonical.name}” is kept. “{preview.duplicate.name}” is deleted, and a
                  full copy of it is saved to the merge log so this can be undone by hand.
                </div>
              </div>

              <Group title="Filled in from the duplicate" empty="Nothing to fill in.">
                {[
                  ...preview.fills.map((f) => (
                    <li key={f.field}>
                      {label(f.field)}: <strong>{f.value}</strong>
                    </li>
                  )),
                  ...preview.carries.map((c) => (
                    <li key={c.field}>
                      {label(c.field)}:{" "}
                      <strong>{typeof c.value === "boolean" ? "yes" : c.value}</strong>
                    </li>
                  )),
                ]}
              </Group>

              {preview.conflicts.length > 0 && (
                <Group title="Discarded — the kept guest's value wins">
                  {preview.conflicts.map((c) => (
                    <li key={c.field} className="dup-warn">
                      {label(c.field)}: keeping <strong>{String(c.keep)}</strong>, discarding{" "}
                      {String(c.discard)}
                    </li>
                  ))}
                </Group>
              )}

              {preview.eventPlan.length > 0 && (
                <Group title="Event answers updated (most recent answer wins)">
                  {preview.eventPlan.map((p) => (
                    <li key={p.event_id} className={p.conflict ? "dup-warn" : undefined}>
                      {eventName[p.event_id] || "Event"}: <strong>{p.status}</strong>
                      {p.conflict ? " ⚠ changes the kept guest's answer" : ""}
                    </li>
                  ))}
                </Group>
              )}

              {preview.moved.length > 0 && (
                <Group title="Additional guests moved over">
                  {preview.moved.map((c) => (
                    <li key={c.id}>{c.name}</li>
                  ))}
                </Group>
              )}

              {preview.dropped.length > 0 && (
                <Group title="Additional guests NOT moved">
                  {preview.dropped.map((c) => (
                    <li key={c.id} className="dup-warn">
                      {c.name}
                      {c.reason === "cap_reached" ? " — 6 additional guests already" : " — same name already there"}
                    </li>
                  ))}
                </Group>
              )}
            </div>

            <div className="modal-actions">
              <button className="btn btn-outline" disabled={busy} onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: "#c0392b", color: "white", opacity: busy ? 0.5 : 1 }}
                disabled={busy}
                onClick={confirmMerge}
              >
                {busy ? "Merging…" : "Merge and delete duplicate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Group({ title, children, empty }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : children;
  if (!items || (Array.isArray(items) && items.length === 0)) {
    return empty ? (
      <div className="dup-preview-group">
        <div className="dup-preview-label">{title}</div>
        <div className="dup-none">{empty}</div>
      </div>
    ) : null;
  }
  return (
    <div className="dup-preview-group">
      <div className="dup-preview-label">{title}</div>
      <ul>{items}</ul>
    </div>
  );
}
