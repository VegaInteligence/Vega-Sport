import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultMatchday,
  matchdayGroups,
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
