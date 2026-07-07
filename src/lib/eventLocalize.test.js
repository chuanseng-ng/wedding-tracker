import { describe, it, expect } from 'vitest';
import { localizeEvent, localizeEvents } from './eventLocalize.js';

const base = {
  id: 'tea',
  name: 'Tea Ceremony',
  location: 'Family Home',
  content_translations: {
    'zh-TW': { name: '奉茶儀式', location: '老家' },
  },
};

describe('localizeEvent', () => {
  it('returns the event unchanged for the English source locale', () => {
    expect(localizeEvent(base, 'en')).toBe(base);
  });

  it('returns the event unchanged when locale is missing', () => {
    expect(localizeEvent(base, undefined)).toBe(base);
  });

  it('overrides translatable fields for a matching locale', () => {
    const out = localizeEvent(base, 'zh-TW');
    expect(out.name).toBe('奉茶儀式');
    expect(out.location).toBe('老家');
    expect(out.id).toBe('tea'); // non-translatable fields preserved
  });

  it('falls back per-field to English when a translation is blank/missing', () => {
    const ev = { ...base, content_translations: { 'zh-TW': { name: '奉茶儀式', location: '' } } };
    const out = localizeEvent(ev, 'zh-TW');
    expect(out.name).toBe('奉茶儀式');
    expect(out.location).toBe('Family Home'); // blank translation → English
  });

  it('returns the event unchanged when the locale has no translation object', () => {
    const out = localizeEvent(base, 'ja');
    expect(out.name).toBe('Tea Ceremony');
  });

  it('does not mutate the source event', () => {
    const snapshot = JSON.stringify(base);
    localizeEvent(base, 'zh-TW');
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

describe('localizeEvents', () => {
  it('localizes each event in an array', () => {
    const out = localizeEvents([base], 'zh-TW');
    expect(out[0].name).toBe('奉茶儀式');
  });

  it('returns the same array reference-safely for a non-array input', () => {
    expect(localizeEvents(null, 'zh-TW')).toEqual([]);
  });
});
