import { describe, it, expect } from 'vitest';
import { deriveLegacyRsvp } from './rsvpMirror.js';

// A body's per-event responses. `invited` defaults to true when omitted.
const r = (event_id, status, meal_choice = '', extra = {}) => ({
  event_id, status, meal_choice, invited: true, ...extra,
});

describe('deriveLegacyRsvp — rsvp_status aggregation', () => {
  it('confirmed when at least one invited event is confirmed', () => {
    const out = deriveLegacyRsvp([r('a', 'declined'), r('b', 'confirmed')], 'a');
    expect(out.rsvp_status).toBe('confirmed');
  });

  it('confirmed wins even if other events are pending', () => {
    const out = deriveLegacyRsvp([r('a', 'confirmed'), r('b', 'pending')], 'a');
    expect(out.rsvp_status).toBe('confirmed');
  });

  it('declined when there is >=1 invited event and all invited responses are declined', () => {
    const out = deriveLegacyRsvp([r('a', 'declined'), r('b', 'declined')], 'a');
    expect(out.rsvp_status).toBe('declined');
  });

  it('pending when a mix of declined and pending (not all declined, none confirmed)', () => {
    const out = deriveLegacyRsvp([r('a', 'declined'), r('b', 'pending')], 'a');
    expect(out.rsvp_status).toBe('pending');
  });

  it('returns null (no-op) when there are no invited events at all', () => {
    // Mirrors the SQL trigger, which leaves the legacy columns untouched.
    expect(deriveLegacyRsvp([], 'a')).toBeNull();
  });

  it('returns null (no-op) when every response is non-invited', () => {
    const out = deriveLegacyRsvp([r('a', 'confirmed', '', { invited: false })], 'a');
    expect(out).toBeNull();
  });

  it('ignores non-invited events when aggregating status', () => {
    const out = deriveLegacyRsvp(
      [r('a', 'declined'), r('b', 'confirmed', '', { invited: false })],
      'a',
    );
    // 'b' is not invited, so the only counted response is 'a' declined.
    expect(out.rsvp_status).toBe('declined');
  });
});

describe('deriveLegacyRsvp — meal_choice mirror', () => {
  it('mirrors the meal for the designated primary meal event', () => {
    const out = deriveLegacyRsvp(
      [r('tea', 'confirmed', ''), r('banquet', 'confirmed', 'Vegetarian')],
      'banquet',
    );
    expect(out.meal_choice).toBe('Vegetarian');
  });

  it('is empty when the designated meal event has no meal set', () => {
    const out = deriveLegacyRsvp([r('banquet', 'confirmed', '')], 'banquet');
    expect(out.meal_choice).toBe('');
  });

  it('is empty when the designated meal event is missing / not invited', () => {
    const out = deriveLegacyRsvp([r('tea', 'confirmed', 'Halal')], 'banquet');
    expect(out.meal_choice).toBe('');
  });

  it('is empty when primaryMealEventId is null', () => {
    const out = deriveLegacyRsvp([r('banquet', 'confirmed', 'Halal')], null);
    expect(out.meal_choice).toBe('');
  });

  it('mirrors dietary_notes from the designated meal event', () => {
    const out = deriveLegacyRsvp(
      [r('banquet', 'confirmed', 'Vegetarian', { dietary_notes: 'No nuts' })],
      'banquet',
    );
    expect(out.dietary_notes).toBe('No nuts');
  });
});

describe('deriveLegacyRsvp — rsvp_at', () => {
  it('is the latest responded_at across invited responses', () => {
    const out = deriveLegacyRsvp(
      [
        r('a', 'confirmed', '', { responded_at: '2026-01-01T10:00:00.000Z' }),
        r('b', 'declined', '', { responded_at: '2026-02-01T10:00:00.000Z' }),
      ],
      'a',
    );
    expect(out.rsvp_at).toBe('2026-02-01T10:00:00.000Z');
  });

  it('is null when no response has responded_at', () => {
    const out = deriveLegacyRsvp([r('a', 'pending')], 'a');
    expect(out.rsvp_at).toBeNull();
  });
});
