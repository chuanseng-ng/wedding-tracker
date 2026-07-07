// Picks a timeline emoji for a couple-authored event name (smart-RSVP events have
// no icon field). Keyword-matched, with a neutral calendar fallback. Kept pure so
// the wedding-page timeline stays presentational and this stays unit-testable.

// Latin keywords are word-anchored so common words don't false-match (e.g. the
// "tea" in "steak", the "rom" in "from"/"Groom"). CJK terms match as substrings
// (word boundaries don't apply to CJK).
const RULES = [
  [/\btea\b|茶/i, '🍵'],
  [/solemn|\bregist(?:er|ry|ration)?\b|ceremony|church|vow|nikah|\brom\b|婚礼|证婚/i, '💍'],
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
