import { describe, it, expect } from 'vitest';
import { reconcileEventResponses } from './eventReconcile.js';

const ev = (id, requires_meal = false) => ({ id, requires_meal });
const body = (name, is_primary = false) => ({ name, is_primary });

describe('reconcileEventResponses — materialization', () => {
  it('creates one row per body per invited event', () => {
    const { rows } = reconcileEventResponses({
      invitedEvents: [ev('tea'), ev('banquet', true)],
      bodies: [body('Alice', true), body('Bob')],
      submitted: [],
    });
    expect(rows).toHaveLength(4); // 2 bodies × 2 events
    expect(rows.every((r) => r.invited === true)).toBe(true);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('applies a submitted status to the matching body+event', () => {
    const { rows } = reconcileEventResponses({
      invitedEvents: [ev('tea')],
      bodies: [body('Alice', true)],
      submitted: [{ body_name: '', event_id: 'tea', status: 'confirmed' }],
    });
    expect(rows[0]).toMatchObject({ body_name: 'Alice', is_primary: true, event_id: 'tea', status: 'confirmed' });
    expect(rows[0].responded).toBe(true);
  });

  it('matches child bodies by name, case-insensitively and trimmed', () => {
    const { rows } = reconcileEventResponses({
      invitedEvents: [ev('banquet', true)],
      bodies: [body('Alice', true), body('Bob Tan')],
      submitted: [{ body_name: '  bob tan ', event_id: 'banquet', status: 'confirmed', meal_choice: 'Halal' }],
    });
    const bob = rows.find((r) => r.body_name === 'Bob Tan');
    expect(bob).toMatchObject({ status: 'confirmed', meal_choice: 'Halal' });
  });
});

describe('reconcileEventResponses — meal handling', () => {
  it('keeps meal only for confirmed responses on events that require a meal', () => {
    const { rows } = reconcileEventResponses({
      invitedEvents: [ev('banquet', true)],
      bodies: [body('Alice', true)],
      submitted: [{ body_name: '', event_id: 'banquet', status: 'confirmed', meal_choice: 'Vegetarian' }],
    });
    expect(rows[0].meal_choice).toBe('Vegetarian');
  });

  it('blanks meal for events that do not require a meal', () => {
    const { rows } = reconcileEventResponses({
      invitedEvents: [ev('tea', false)],
      bodies: [body('Alice', true)],
      submitted: [{ body_name: '', event_id: 'tea', status: 'confirmed', meal_choice: 'Vegetarian' }],
    });
    expect(rows[0].meal_choice).toBe('');
  });

  it('blanks meal when the response is declined', () => {
    const { rows } = reconcileEventResponses({
      invitedEvents: [ev('banquet', true)],
      bodies: [body('Alice', true)],
      submitted: [{ body_name: '', event_id: 'banquet', status: 'declined', meal_choice: 'Vegetarian' }],
    });
    expect(rows[0].meal_choice).toBe('');
  });
});

describe('reconcileEventResponses — guards', () => {
  it('rejects a response for an event the party is not invited to (self-elevation)', () => {
    const { rows, rejected } = reconcileEventResponses({
      invitedEvents: [ev('tea')],
      bodies: [body('Alice', true)],
      submitted: [{ body_name: '', event_id: 'secret-vip', status: 'confirmed' }],
    });
    expect(rows.find((r) => r.event_id === 'secret-vip')).toBeUndefined();
    expect(rejected).toContainEqual(expect.objectContaining({ event_id: 'secret-vip' }));
  });

  it('rejects a response for a body that is not part of this party', () => {
    const { rejected } = reconcileEventResponses({
      invitedEvents: [ev('tea')],
      bodies: [body('Alice', true)],
      submitted: [{ body_name: 'Stranger', event_id: 'tea', status: 'confirmed' }],
    });
    expect(rejected).toContainEqual(expect.objectContaining({ body_name: 'Stranger' }));
  });

  it('coerces an invalid status to pending', () => {
    const { rows } = reconcileEventResponses({
      invitedEvents: [ev('tea')],
      bodies: [body('Alice', true)],
      submitted: [{ body_name: '', event_id: 'tea', status: 'maybe' }],
    });
    expect(rows[0].status).toBe('pending');
    expect(rows[0].responded).toBe(false);
  });

  it('de-listed children get no rows (only current bodies are materialized)', () => {
    const { rows } = reconcileEventResponses({
      invitedEvents: [ev('tea')],
      bodies: [body('Alice', true)], // Bob was removed from the party
      submitted: [{ body_name: 'Bob', event_id: 'tea', status: 'confirmed' }],
    });
    expect(rows.every((r) => r.body_name === 'Alice')).toBe(true);
  });

  it('a non-blank body_name never resolves to the primary (children matched by name only)', () => {
    // "Alice" is the primary; a submitted response keyed by "Alice" is treated as
    // an unknown body (SQL matches non-blank names against children only).
    const { rows, rejected } = reconcileEventResponses({
      invitedEvents: [ev('tea')],
      bodies: [body('Alice', true)],
      submitted: [{ body_name: 'Alice', event_id: 'tea', status: 'confirmed' }],
    });
    expect(rows[0].status).toBe('pending'); // primary untouched
    expect(rejected).toContainEqual(expect.objectContaining({ body_name: 'Alice' }));
  });

  it('resolves the primary from a round-tripped response (name + is_primary=true)', () => {
    // get_guest_by_rsvp_token emits the primary with body_name = its own name and
    // is_primary=true; the flag must still resolve it to the primary.
    const { rows, rejected } = reconcileEventResponses({
      invitedEvents: [ev('tea')],
      bodies: [body('Alice', true)],
      submitted: [{ body_name: 'Alice', is_primary: true, event_id: 'tea', status: 'confirmed' }],
    });
    expect(rows[0].status).toBe('confirmed');
    expect(rejected).toHaveLength(0);
  });

  it('tolerates null inputs (Supabase data starts null)', () => {
    expect(() => reconcileEventResponses({ invitedEvents: null, bodies: null, submitted: null })).not.toThrow();
    expect(reconcileEventResponses()).toEqual({ rows: [], rejected: [] });
  });
});

describe('reconcileEventResponses — full-resubmission contract', () => {
  it('materializes pending for invited events absent from a partial submission', () => {
    // Documents the "callers must submit the complete answer set" contract: an
    // invited event not present in `submitted` becomes pending, not preserved.
    const { rows } = reconcileEventResponses({
      invitedEvents: [ev('tea'), ev('banquet', true)],
      bodies: [body('Alice', true)],
      submitted: [{ body_name: '', event_id: 'banquet', status: 'confirmed', meal_choice: 'Halal' }],
    });
    const tea = rows.find((r) => r.event_id === 'tea');
    expect(tea.status).toBe('pending');
    expect(tea.responded).toBe(false);
  });
});
