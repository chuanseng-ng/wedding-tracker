// Picks a timeline emoji for a couple-authored event name (smart-RSVP events have
// no icon field). Keyword-matched, with a neutral calendar fallback. Kept pure so
// the wedding-page timeline stays presentational and this stays unit-testable.

const RULES = [
  [/tea|茶/i, '🍵'],
  [/solemn|regist\b|registr|ceremony|church|vow|nikah|rom\b|婚礼|证婚/i, '💍'],
  [/cocktail|drinks|aperitif/i, '🥂'],
  [/banquet|dinner|lunch|brunch|reception|meal|dining|feast|宴/i, '🍽'],
  [/photo|gallery|shoot/i, '📸'],
  [/party|celebration|after ?party|dance/i, '🎉'],
];

/** @param {string} name  Event name. @returns {string} A single emoji. */
export function eventTimelineIcon(name) {
  const s = String(name ?? '');
  for (const [re, icon] of RULES) {
    if (re.test(s)) return icon;
  }
  return '📅';
}
