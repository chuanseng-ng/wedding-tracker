// Per-event content localization. Follows the same convention as
// localizeWedding (src/i18n/content.js): the couple authors events in English;
// per-locale overrides live in each event's `content_translations` JSONB
// ({ "<locale>": { name, location } }), with per-field fallback to English.

// Translatable text fields on a wedding_events row.
export const EVENT_TRANSLATABLE_FIELDS = ['name', 'location'];

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * @param {object} event  A wedding_events row.
 * @param {string} locale Active locale (e.g. 'en', 'zh-TW').
 * @returns {object} The event, or a shallow copy with translated fields applied.
 */
export function localizeEvent(event, locale) {
  if (!event || !locale || locale === 'en') return event;
  const tr = event.content_translations?.[locale];
  if (!tr || typeof tr !== 'object') return event;

  const out = { ...event };
  for (const field of EVENT_TRANSLATABLE_FIELDS) {
    if (nonEmpty(tr[field])) out[field] = tr[field];
  }
  return out;
}

/**
 * Localize an array of events. Non-array input yields an empty array.
 */
export function localizeEvents(events, locale) {
  if (!Array.isArray(events)) return [];
  return events.map((e) => localizeEvent(e, locale));
}
