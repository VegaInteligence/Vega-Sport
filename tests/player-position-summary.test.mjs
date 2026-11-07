import test from "node:test";
import assert from "node:assert/strict";
import { aggregateSeason } from "../dashboard/frontend/src/services/season-player.js";
import { playerPositionSummary } from "../dashboard/frontend/src/services/player-position-summary.js";
const id = "p_a";
const row = (matchId, positionId, fields = {}) => ({
  playerId: id,
  matchId,
  positionId,
  minutes: 90,
  ...fields,
});
const entry = (season, rows) => ({
  season,
  data: { appearances: rows },
  profile: aggregateSeason(rows, id),
});
test("groups recorded lines and preserves missing and partial statistics", () => {
  const rows = [
    row("1", 93, { goals: 0, assists: 1 }),
    row("2", 3, { goals: 2 }),
    row("3", 82, { assists: 0 }),
    row("4", null),
    row("5", 31, { minutes: 0 }),
    row("6", 2, { minutes: null }),
  ];
  const result = playerPositionSummary([entry("2025/2026", rows)], id);
  assert.deepEqual(
    result.map((x) => x.key),
    ["AM", "A", "unknown"],
  );
  assert.deepEqual(result[1], {
    key: "A",
    label: "Attaquant",
    shortLabel: "ATT",
    x: 50,
    y: 14,
    matches: 2,
    goals: { value: 2, count: 2 },
    assists: { value: 1, count: 1 },
  });
  assert.deepEqual(result[0].goals, { value: null, count: 0 });
  assert.deepEqual(result[0].assists, { value: 0, count: 1 });
  assert.equal(result[2].x, null);
  assert.equal(result[2].y, null);
});
test("deduplicates across editions and prefers a known played appearance", () => {
  const unknown = row("1", 31, { minutes: null });
  const played = row("1", 82, { goals: 1 });
  const result = playerPositionSummary(
    [
      entry("2024", [unknown]),
      entry("2024/2025", [played, row("2", 0, { goals: 0 })]),
      entry("2025", [played]),
    ],
    id,
  );
  assert.deepEqual(
    result.map((x) => x.key),
    ["G", "AM"],
  );
  assert.equal(result[1].matches, 1);
  assert.deepEqual(result[0].goals, { value: 0, count: 1 });
  assert.equal(result[1].goals.value, 1);
});
