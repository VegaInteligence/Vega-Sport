import test from "node:test";
import assert from "node:assert/strict";
import { competitionHighlights, highlightKickoff, recentResultCapacity } from "../dashboard/frontend/src/services/competition-highlights.js";

const team = (name) => ({ id: name, name });
const fixture = (id, status, date, time, home = "Paris", away = "Lille", scores = [null, null]) => ({
  id, status, date, time_utc: time, home_team: team(home), away_team: team(away), score_home: scores[0], score_away: scores[1],
});

test("highlights sort results and upcoming matches while excluding stale fixtures", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const matches = [
    fixture("r-old", "finished", "2026-10-25", "2026-10-25T18:00:00Z", "A", "B", [0, 0]),
    fixture("future", "not_started", "2026-11-05", "2026-11-05T20:00:00Z"),
    fixture("stale", "not_started", "2026-11-01", null),
    fixture("r-new", "finished", "2026-11-01", "2026-11-01T20:00:00Z", "C", "D", [2, 1]),
    fixture("already-kicked-off", "not_started", "2026-11-02", "2026-11-02T10:00:00Z"),
    fixture("today-no-time", "not_started", "2026-11-02", null),
    fixture("today-later", "not_started", "2026-11-02", "2026-11-02T18:00:00Z"),
    fixture("no-score", "finished", "2026-11-02", null),
    fixture("r-new", "finished", "2026-11-01", "2026-11-01T20:00:00Z", "C", "D", [2, 1]),
  ];
  const result = competitionHighlights(matches, now);
  assert.deepEqual(result.recent.map((m) => m.id), ["r-new", "r-old"]);
  assert.deepEqual(result.upcoming.map((m) => m.id), ["today-later", "today-no-time", "future"]);
  assert.equal(highlightKickoff(fixture("x", "not_started", "2026-11-03", "2026-11-03T19:00:00")), null);
});

test("historical seasons do not show old fixtures as upcoming and respect the limit", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const matches = Array.from({ length: 6 }, (_, i) => fixture("r" + i, "finished", "2025-05-" + String(20 + i), null, "A", "B", [1, 0]));
  matches.push(fixture("old-fixture", "not_started", "2025-05-28", null));
  const result = competitionHighlights(matches, now, 4);
  assert.deepEqual(result.recent.map((m) => m.id), ["r5", "r4", "r3", "r2"]);
  assert.deepEqual(result.upcoming, []);
});


test("result capacity adapts to the standings and available room", () => {
  assert.equal(recentResultCapacity({ standingsHeight: 1400, upcomingHeight: 400, headerHeight: 50, rowHeight: 100 }), 9);
  assert.equal(recentResultCapacity({ standingsHeight: 450, upcomingHeight: 350, headerHeight: 50, rowHeight: 100 }), 2);
  assert.equal(recentResultCapacity({ standingsHeight: 4000, upcomingHeight: 400, headerHeight: 50, rowHeight: 100 }), 20);
  assert.equal(recentResultCapacity({ standingsHeight: 1000, upcomingHeight: 400, headerHeight: 50, rowHeight: 0 }), 5);
});

test("expanded highlights retain their chronological order", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const matches = Array.from({ length: 10 }, (_, i) => fixture("r" + i, "finished", "2026-10-" + String(10 + i), null, "A", "B", [1, 0]));
  const result = competitionHighlights(matches, now, 7);
  assert.deepEqual(result.recent.map((m) => m.id), ["r9", "r8", "r7", "r6", "r5", "r4", "r3"]);
});

test("a short table shows fewer next matches before the column runs past it", async () => {
  const { nextUpcomingLimit, recentResultRoom } = await import("../dashboard/frontend/src/services/competition-highlights.js");
  const sizes = { standingsHeight: 900, upcomingHeight: 760, headerHeight: 50, rowHeight: 60 };
  assert.equal(recentResultRoom(sizes), 1);
  // One result only would fit: one next match fewer, down to one.
  assert.equal(nextUpcomingLimit({ limit: 4, room: 1, upcomingRow: 80, resultRow: 60 }), 3);
  assert.equal(nextUpcomingLimit({ limit: 1, room: 0, upcomingRow: 80, resultRow: 60 }), 1);
  // Room for two results and an upcoming row again: one more, up to four.
  assert.equal(nextUpcomingLimit({ limit: 3, room: 4, upcomingRow: 80, resultRow: 60 }), 4);
  assert.equal(nextUpcomingLimit({ limit: 3, room: 3, upcomingRow: 80, resultRow: 60 }), 3);
  assert.equal(nextUpcomingLimit({ limit: 4, room: 9, upcomingRow: 80, resultRow: 60 }), 4);
});

test("the next matches beside the table are worked out from the sizes, whatever was shown before", async () => {
  const { upcomingLimitFor, recentResultRoom } = await import("../dashboard/frontend/src/services/competition-highlights.js");
  // Ligue 1, 27 Nov 2026: table 874, level 252 + gap 12, next card 289 with two rows of 101.5, header 44, result 89.5.
  const sizes = { standingsHeight: 874, upcomingHeight: 289 + 264, headerHeight: 44, rowHeight: 89.5, gap: 12 };
  assert.equal(recentResultRoom(sizes), 2);
  // Two shown or one shown, the answer is the same: two next matches (one more would leave room for one result).
  assert.equal(upcomingLimitFor({ sizes, shown: 2, upcomingRow: 101.5 }), 2);
  const fromOne = { ...sizes, upcomingHeight: sizes.upcomingHeight - 101.5 };
  assert.equal(upcomingLimitFor({ sizes: fromOne, shown: 1, upcomingRow: 101.5 }), 2);
  const fromFour = { ...sizes, upcomingHeight: sizes.upcomingHeight + 2 * 101.5 };
  assert.equal(upcomingLimitFor({ sizes: fromFour, shown: 4, upcomingRow: 101.5 }), 2);
  // A tall table: four; a very short one: one; only one next match left in the season: four asked, one shown.
  assert.equal(upcomingLimitFor({ sizes: { ...sizes, standingsHeight: 1400 }, shown: 2, upcomingRow: 101.5 }), 4);
  assert.equal(upcomingLimitFor({ sizes: { ...sizes, standingsHeight: 500 }, shown: 2, upcomingRow: 101.5 }), 1);
  assert.equal(upcomingLimitFor({ sizes: { ...sizes, standingsHeight: 1400 }, shown: 1, upcomingRow: 101.5, available: 1 }), 4);
  // No next row to measure: nothing decided.
  assert.equal(upcomingLimitFor({ sizes, shown: 0, upcomingRow: 0 }), null);
});
