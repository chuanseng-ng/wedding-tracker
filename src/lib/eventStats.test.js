import { describe, it, expect } from 'vitest';
import { aggregateEventStats } from './eventStats.js';

const ev = (id, name) => ({ id, name });
const row = (event_id, status, meal_choice = '', invited = true) => ({ event_id, status, meal_choice, invited });

describe('aggregateEventStats', () => {
  it('counts confirmed/declined/pending per event, in event order', () => {
    const events = [ev('tea', 'Tea Ceremony'), ev('banquet', 'Banquet')];
    const rows = [
      row('tea', 'confirmed'), row('tea', 'declined'),
      row('banquet', 'confirmed'), row('banquet', 'confirmed'), row('banquet', 'pending'),
    ];
    const stats = aggregateEventStats(events, rows);
    expect(stats.map((s) => s.eventId)).toEqual(['tea', 'banquet']);
    expect(stats[0]).toMatchObject({ name: 'Tea Ceremony', confirmed: 1, declined: 1, pending: 0 });
    expect(stats[1]).toMatchObject({ name: 'Banquet', confirmed: 2, declined: 0, pending: 1 });
  });

  it('headcount equals the confirmed body count', () => {
    const events = [ev('banquet', 'Banquet')];
    const rows = [row('banquet', 'confirmed'), row('banquet', 'confirmed'), row('banquet', 'declined')];
    expect(aggregateEventStats(events, rows)[0].confirmed).toBe(2);
  });

  it('tallies meal choices among confirmed rows only', () => {
    const events = [ev('banquet', 'Banquet')];
    const rows = [
      row('banquet', 'confirmed', 'Halal'),
      row('banquet', 'confirmed', 'Halal'),
      row('banquet', 'confirmed', 'Vegetarian'),
      row('banquet', 'declined', 'Halal'), // declined meals are not tallied
      row('banquet', 'confirmed', ''),      // blank meals are skipped
    ];
    expect(aggregateEventStats(events, rows)[0].mealCounts).toEqual({ Halal: 2, Vegetarian: 1 });
  });

  it('excludes non-invited rows from all counts', () => {
    const events = [ev('tea', 'Tea')];
    const rows = [row('tea', 'confirmed'), row('tea', 'confirmed', '', false)];
    expect(aggregateEventStats(events, rows)[0].confirmed).toBe(1);
    expect(aggregateEventStats(events, rows)[0].invited).toBe(1);
  });

  it('returns zeroed stats for an event with no rows', () => {
    const stats = aggregateEventStats([ev('x', 'X')], []);
    expect(stats[0]).toMatchObject({ confirmed: 0, declined: 0, pending: 0, invited: 0, mealCounts: {} });
  });
});
