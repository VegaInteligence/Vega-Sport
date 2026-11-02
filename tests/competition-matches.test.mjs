import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultCompetitionMatchStatus,
  orderCompetitionMatches,
} from "../dashboard/frontend/src/services/competition-matches.js";

const match = (id, date, status, time_utc) => ({ id, date, status, time_utc });

test("competition matches open on finished results, while the day calendar keeps every status", () => {
  assert.equal(defaultCompetitionMatchStatus(null), "finished");
  assert.equal(defaultCompetitionMatchStatus("2026-11-02"), "all");
});

test("finished results appear newest first, with known times and missing dates handled safely", () => {
  const matches = [
    match("old", "2026-08-15", "finished", "2026-08-15T20:00:00Z"),
    match("early", "2026-11-01", "finished", "2026-11-01T13:00:00Z"),
    match("future", "2026-11-03", "not_started", "2026-11-03T20:00:00Z"),
    match("unknown", "", "finished"),
    match("late", "2026-11-01", "finished", "2026-11-01T21:00:00+01:00"),
    match("date-only", "2026-11-01", "finished"),
  ];
  const original = matches.slice();
  assert.deepEqual(
    orderCompetitionMatches(matches, { status: "finished" }).map(
      (item) => item.id,
    ),
    ["late", "early", "date-only", "old", "unknown"],
  );
  assert.deepEqual(matches, original);
});

test("upcoming fixtures appear nearest first", () => {
  const matches = [
    match("far", "2027-01-05", "not_started"),
    match("near", "2026-11-03", "not_started"),
    match("result", "2026-11-01", "finished"),
  ];
  assert.deepEqual(
    orderCompetitionMatches(matches, { status: "not_started" }).map(
      (item) => item.id,
    ),
    ["near", "far"],
  );
});

test("all competitions show recent results before upcoming fixtures, without discarding other statuses", () => {
  const matches = [
    match("future-2", "2026-12-01", "not_started"),
    match("old", "2026-09-01", "finished"),
    match("postponed", "2026-11-04", "postponed"),
    match("future-1", "2026-11-03", "not_started"),
    match("recent", "2026-11-01", "finished"),
    { id: "legacy", date: "2026-10-15", finished: true },
  ];
  assert.deepEqual(
    orderCompetitionMatches(matches).map((item) => item.id),
    ["recent", "legacy", "old", "future-1", "future-2", "postponed"],
  );
});

test("the day calendar stays chronological and does not filter scheduled matches", () => {
  const matches = [
    match("late", "2026-11-02", "not_started", "2026-11-02T20:00:00Z"),
    match("early", "2026-11-02", "finished", "2026-11-02T13:00:00Z"),
  ];
  assert.deepEqual(
    orderCompetitionMatches(matches, { status: "all", day: true }).map(
      (item) => item.id,
    ),
    ["early", "late"],
  );
});
