import { describe, it, expect } from 'vitest';
import { eventTimelineIcon } from './eventTimelineIcon.js';

describe('eventTimelineIcon', () => {
  it('maps tea ceremonies to 🍵', () => {
    expect(eventTimelineIcon('Tea Ceremony')).toBe('🍵');
    expect(eventTimelineIcon('敬茶')).toBe('🍵');
  });

  it('maps solemnisation / registry / ceremony to 💍', () => {
    expect(eventTimelineIcon('Solemnisation')).toBe('💍');
    expect(eventTimelineIcon('ROM Registration')).toBe('💍');
    expect(eventTimelineIcon('Church Ceremony')).toBe('💍');
  });

  it('maps meals (banquet/dinner/lunch/reception) to 🍽', () => {
    expect(eventTimelineIcon('Wedding Banquet')).toBe('🍽');
    expect(eventTimelineIcon('Lunch Reception')).toBe('🍽');
    expect(eventTimelineIcon('Dinner')).toBe('🍽');
  });

  it('maps cocktails / drinks to 🥂', () => {
    expect(eventTimelineIcon('Cocktail Hour')).toBe('🥂');
  });

  it('falls back to a calendar icon for unknown names', () => {
    expect(eventTimelineIcon('Mystery Event')).toBe('📅');
    expect(eventTimelineIcon('')).toBe('📅');
    expect(eventTimelineIcon(null)).toBe('📅');
    expect(eventTimelineIcon(undefined)).toBe('📅');
  });

  it('is case-insensitive', () => {
    expect(eventTimelineIcon('WEDDING BANQUET')).toBe('🍽');
  });
});
