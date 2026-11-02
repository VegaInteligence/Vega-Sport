import test from "node:test";
import assert from "node:assert/strict";
import {
  followedRecords,
  recentFinishedMatches,
  selectFeaturedMatch,
} from "../dashboard/frontend/src/services/home.js";

const now = Date.parse("2026-11-02T12:00:00Z");
const match = (id, leagueId, date, time, homeId, awayId, extra = {}) => ({
  id,
  leagueId,
  date,
  timeUtc: time ? date + "T" + time + ":00Z" : null,
  home: { id: homeId, name: homeId, score: 2 },
  away: { id: awayId, name: awayId, score: 1 },
  status: "finished",
  ...extra,
});

test("a recent major-club match is featured ahead of a later ordinary match", () => {
  const braga = match(
    "braga",
    "por",
    "2026-11-01",
    "21:15",
    "braga",
    "famalicao",
  );
  const real = match("real", "esp", "2026-11-01", "15:15", "other", "t_4NZcri");
  const arsenal = match(
    "arsenal",
    "eng",
    "2026-11-01",
    "16:30",
    "t_0BrMnM",
    "t_1gkhxH",
  );
  const input = [braga, real, arsenal];
  assert.equal(selectFeaturedMatch(input, now).id, "arsenal");
  assert.deepEqual(
    input.map((m) => m.id),
    ["braga", "real", "arsenal"],
  );
});

test("equally recent games prefer a meeting between two featured clubs", () => {
  const marseille = match(
    "marseille",
    "fra",
    "2026-11-01",
    "19:45",
    "t_2s2eyG",
    "toulouse",
  );
  const juventus = match(
    "juve-napoli",
    "ita",
    "2026-11-01",
    "19:45",
    "t_4ZwKDn",
    "t_2toJRF",
  );
  assert.equal(
    selectFeaturedMatch([marseille, juventus], now).id,
    "juve-napoli",
  );
});

test("selection respects the followed competitions and falls back to their latest match", () => {
  const portugal = match(
    "braga",
    "por",
    "2026-11-01",
    "21:15",
    "braga",
    "famalicao",
  );
  const arsenal = match(
    "arsenal",
    "eng",
    "2026-11-01",
    "16:30",
    "t_0BrMnM",
    "t_1gkhxH",
  );
  const filtered = followedRecords([arsenal, portugal], ["por"]);
  assert.equal(selectFeaturedMatch(filtered, now).id, "braga");
  const porto = match(
    "porto",
    "por",
    "2026-10-31",
    "20:00",
    "t_0dVrhE",
    "estoril",
  );
  assert.equal(
    selectFeaturedMatch(
      followedRecords([arsenal, portugal, porto], ["por"]),
      now,
    ).id,
    "porto",
  );
});

test("old, future, unfinished and unscored matches cannot be promoted as current", () => {
  const ordinary = match(
    "ordinary",
    "por",
    "2026-11-01",
    "12:00",
    "braga",
    "famalicao",
  );
  const olderReal = match(
    "older",
    "esp",
    "2026-10-25",
    "12:00",
    "t_4NZcri",
    "other",
  );
  const future = match(
    "future",
    "eng",
    "2026-11-03",
    "12:00",
    "t_1gkhxH",
    "other",
  );
  const live = match(
    "live",
    "fra",
    "2026-11-02",
    "11:00",
    "t_41iFW3",
    "other",
    { status: "in_progress" },
  );
  const noScore = match(
    "missing",
    "esp",
    "2026-11-02",
    "11:00",
    "t_32jSEF",
    "other",
    { away: { id: "other", score: null } },
  );
  assert.equal(
    selectFeaturedMatch([future, live, noScore, olderReal, ordinary], now).id,
    "ordinary",
  );
  assert.equal(selectFeaturedMatch([future, live, noScore], now), null);
  assert.equal(recentFinishedMatches([future], now).length, 0);
});

test("club identity uses the source ID rather than a potentially ambiguous name", () => {
  const misleading = match(
    "other-club",
    "and",
    "2026-11-02",
    "10:00",
    "different-id",
    "other",
    {
      home: { id: "different-id", name: "Inter Club d'Escaldes", score: 2 },
    },
  );
  const real = match("real", "esp", "2026-11-01", "15:00", "other", "t_4NZcri");
  assert.equal(selectFeaturedMatch([misleading, real], now).id, "real");
});
