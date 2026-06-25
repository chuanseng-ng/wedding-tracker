import { describe, it, expect } from "vitest";
import { buildIcs } from "./ics.js";

const BASE = {
  coupleNames: "Wei Ming & Siew Yong",
  date: "2026-12-12",
  ceremonyTime: "14:00",
  dinnerTime: "18:30",
  venueName: "The Grand Ballroom",
  venueAddress: "123 Wedding Ave, Singapore",
};

describe("buildIcs", () => {
  it("produces a well-formed single-VEVENT calendar", () => {
    const ics = buildIcs(BASE);
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
  });

  it("sets DTSTART/DTEND from the ceremony and dinner times", () => {
    const ics = buildIcs(BASE);
    expect(ics).toContain("DTSTART:20261212T140000");
    expect(ics).toContain("DTEND:20261212T183000");
  });

  it("includes the venue in LOCATION and couple names in SUMMARY", () => {
    const ics = buildIcs(BASE);
    expect(ics).toContain("LOCATION:The Grand Ballroom\\, 123 Wedding Ave\\, Singapore");
    expect(ics).toContain("SUMMARY:Wei Ming & Siew Yong");
  });

  it("escapes commas and semicolons in free-text fields", () => {
    const ics = buildIcs({ ...BASE, venueAddress: "Blk 1; Unit 2, Singapore" });
    expect(ics).toContain("Blk 1\\; Unit 2\\, Singapore");
  });

  it("folds lines longer than 75 octets with a leading space continuation", () => {
    const ics = buildIcs({ ...BASE, venueAddress: "x".repeat(100) });
    const lines = ics.split("\r\n");
    const wrapped = lines.find((l) => l.startsWith(" "));
    expect(wrapped).toBeDefined();
    for (const line of lines) {
      if (!line.startsWith(" ")) expect(line.length).toBeLessThanOrEqual(75);
    }
  });
});
