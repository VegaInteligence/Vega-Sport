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
  assert.equal(recentResultCapacity({ standingsHeight: 450, upcomingHeight: 350, headerHeight: 50, rowHeight: 100 }), 5);
  assert.equal(recentResultCapacity({ standingsHeight: 4000, upcomingHeight: 400, headerHeight: 50, rowHeight: 100 }), 20);
  assert.equal(recentResultCapacity({ standingsHeight: 1000, upcomingHeight: 400, headerHeight: 50, rowHeight: 0 }), 5);
});

test("expanded highlights retain their chronological order", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const matches = Array.from({ length: 10 }, (_, i) => fixture("r" + i, "finished", "2026-10-" + String(10 + i), null, "A", "B", [1, 0]));
  const result = competitionHighlights(matches, now, 7);
  assert.deepEqual(result.recent.map((m) => m.id), ["r9", "r8", "r7", "r6", "r5", "r4", "r3"]);
});
