import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultMatchday,
  matchdayGroups,
  matchdaySummary,
  nearestUntried,
  roundLabel,
} from "../dashboard/frontend/src/services/competition-matchdays.js";

test("a matchday combines played games and upcoming fixtures in kickoff order", () => {
  const matches = [
    {
      id: "late",
      date: "2026-11-02",
      time_utc: "2026-11-02T19:45:00Z",
      status: "not_started",
    },
    {
      id: "a",
      date: "2026-10-30",
      time_utc: "2026-10-30T19:45:00Z",
      status: "finished",
    },
    {
      id: "b",
      date: "2026-11-01",
      time_utc: "2026-11-01T19:45:00Z",
      status: "finished",
    },
    { id: "old", date: "2026-10-25", status: "finished" },
    { id: "unclassified", date: "2026-11-04", status: "not_started" },
  ];
  const groups = matchdayGroups(matches, {
    late: { name: "9" },
    a: { name: "9" },
    b: { name: "9" },
    old: { name: "8" },
  });
  assert.deepEqual(
    groups.map((g) => g.label),
    ["8ᵉ journée", "9ᵉ journée", "Journée non renseignée"],
  );
  assert.deepEqual(
    groups[1].matches.map((m) => m.id),
    ["a", "b", "late"],
  );
  assert.equal(defaultMatchday(groups), groups[1].key);
  assert.equal(
    defaultMatchday(groups, "not_started", Date.parse("2026-11-02")),
    groups[1].key,
  );
  assert.deepEqual(
    groups[2].matches.map((m) => m.id),
    ["unclassified"],
  );
});

test("source stage labels and playoff rounds remain distinct", () => {
  assert.equal(roundLabel("1/8"), "Huitièmes de finale");
  assert.equal(
    roundLabel("League Stage - Round 3"),
    "Phase de ligue · 3ᵉ journée",
  );
  const groups = matchdayGroups(
    [
      { id: "a", date: "2026-05-01" },
      { id: "b", date: "2026-05-02" },
    ],
    { a: { name: "1" }, b: { name: "1", playoff: true } },
  );
  assert.equal(groups.length, 2);
  assert.ok(groups.some((group) => group.label === "Play-offs · 1ʳᵉ journée"));
});

test("missing matchdays stay accessible and live lookup prioritizes nearby untried matches", () => {
  const matches = [
    { id: "old", date: "2025-01-01" },
    { id: "near", date: "2026-11-02" },
    { id: "next", date: "2026-11-03" },
  ];
  const groups = matchdayGroups(matches, {});
  assert.equal(defaultMatchday(groups), "unknown");
  assert.equal(groups[0].matches.length, 3);
  assert.deepEqual(
    nearestUntried(matches, new Set(["near"]), Date.parse("2026-11-02"), 1).map(
      (m) => m.id,
    ),
    ["next"],
  );
});

test("R22 a league phase round named « 3 » and « League Stage - Round 3 » is one round (FAILURE_MODES § 64)", () => {
  const groups = matchdayGroups(
    [
      { id: "a", date: "2026-10-21" },
      { id: "b", date: "2026-10-22" },
      { id: "c", date: "2026-11-04" },
      { id: "d", date: "2026-09-30" },
    ],
    {
      a: { name: "3" },
      b: { name: "League Stage - Round 3" },
      c: { name: "4" },
      d: { name: "League Stage - Round 2" },
    },
  );
  assert.deepEqual(
    groups.map((g) => [g.key, g.name, g.label, g.matches.map((m) => m.id)]),
    [
      ["regular:2", "2", "Phase de ligue · 2ᵉ journée", ["d"]],
      ["regular:3", "3", "Phase de ligue · 3ᵉ journée", ["a", "b"]],
      ["regular:4", "4", "4ᵉ journée", ["c"]],
    ],
  );
});

test("a matchday's line gives its days in Paris and its state (§ 83)", () => {
  const at = (date, status = "finished") => ({ date, status });
  assert.equal(matchdaySummary({ matches: [at("2026-11-20T19:45:00Z"), at("2026-11-22T19:45:00Z")] }), "20 – 22 nov. · 2 matchs joués");
  assert.equal(matchdaySummary({ matches: [at("2026-11-30T19:45:00Z"), at("2026-12-01T19:45:00Z", "not_started")] }), "30 nov. – 1 déc. · 1 joué sur 2");
  assert.equal(matchdaySummary({ matches: [at("2026-11-28T19:45:00Z", "not_started")] }), "28 nov. · 1 match à venir");
  // A kick-off at 23:30 UTC is the next day in Paris.
  assert.equal(matchdaySummary({ matches: [at("2026-11-28T23:30:00Z", "not_started"), at("2026-11-29T15:00:00Z", "not_started")] }), "29 nov. · 2 matchs à venir");
  assert.equal(matchdaySummary({ matches: [] }), "");
});
