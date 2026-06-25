// Builds a minimal RFC 5545 .ics file with a single VEVENT spanning the
// ceremony start to the dinner end. No external dependency needed for one
// event — revisit with a library only if multiple VEVENTs/recurrence show up.

function escapeText(v) {
  return String(v ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// Folds long lines per RFC 5545 (75 octets, continuation lines start with a space).
function foldLine(line) {
  if (line.length <= 75) return line;
  const chunks = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

// `date` is "YYYY-MM-DD"; `ceremonyTime`/`dinnerTime` are "HH:MM" (24h, local venue time).
export function buildIcs({ coupleNames, date, ceremonyTime, dinnerTime, venueName, venueAddress }) {
  const dtStart = `${date.replace(/-/g, "")}T${ceremonyTime.replace(":", "")}00`;
  const dtEnd = `${date.replace(/-/g, "")}T${dinnerTime.replace(":", "")}00`;
  const uid = `${date}-${ceremonyTime}-wedding@wedding-tracker`;
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wedding Tracker//RSVP//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeText(`${coupleNames} — Wedding`)}`,
    `LOCATION:${escapeText(`${venueName}, ${venueAddress}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}
