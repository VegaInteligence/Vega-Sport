// A player's injuries as the career tab draws them, and the rail's availability over
// the last twelve months.
import test from "node:test";
import assert from "node:assert/strict";
import {
  availability,
  injuryRows,
  shortSeason,
} from "../dashboard/frontend/src/services/player-availability.js";

const today = new Date("2026-11-16T12:00:00Z");

test("a season reads as its two years", () => {
  assert.equal(shortSeason(2025), "2025/26");
  assert.equal(shortSeason(1999), "1999/00");
});

test("an injury still running ends today, a finished one on its own date", () => {
  const rows = injuryRows(
    [
      { kind: "injury", label: "Ankle sprain", start: "2026-11-01", end: null, matchesMissed: 3, season: 2026 },
      { kind: "suspension", label: null, start: "2026-03-10", end: "2026-03-20", matchesMissed: 2, season: null },
      { kind: "injury", label: "Contracture", start: "2026-11-10", end: "2026-12-01", matchesMissed: null, season: 2026 },
      { kind: "injury", label: "Sans date", start: null, end: null },
    ],
    today,
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    season: "2026/27", start: "2026-11-01", end: "2026-11-16", ongoing: true,
    label: "Entorse de la cheville", type: "injury", missed: 3, days: 16,
  });
  // A suspension in March belongs to the season that began the year before.
  assert.equal(rows[1].season, "2025/26");
  assert.equal(rows[1].type, "suspension");
  // Labels read in English show in French; one without a label is named by its kind.
  assert.equal(rows[1].label, "Suspension");
  assert.equal(rows[1].days, 11);
  assert.equal(rows[1].ongoing, false);
  // An expected return still to come is an absence running today.
  assert.equal(rows[2].ongoing, true);
  assert.equal(rows[2].end, "2026-11-16");
  assert.equal(rows[2].missed, 0);
});

test("availability counts the last twelve months only, and the absence running today", () => {
  const rows = injuryRows(
    [
      { kind: "injury", label: "Ischios", start: "2025-10-01", end: "2025-11-30", matchesMissed: 6 },
      { kind: "injury", label: "Genou", start: "2024-01-01", end: "2024-03-01", matchesMissed: 9 },
      { kind: "injury", label: "Cheville", start: "2026-11-03", end: null, matchesMissed: 1 },
    ],
    today,
  );
  const value = availability(rows, today);
  assert.equal(value.count, 2);
  // 15 days of the hamstring absence fall inside the window (16 to 30 Nov 2025), plus 14 days now.
  assert.equal(value.weeks, Math.round((15 + 14) / 7));
  assert.equal(value.current, 14);
  assert.equal(value.missed, 7);
});

test("a player never injured is available", () => {
  assert.deepEqual(availability(injuryRows([], today), today), { count: 0, weeks: 0, current: null, missed: 0 });
});
