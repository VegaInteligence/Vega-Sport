import test from "node:test";
import assert from "node:assert/strict";
import { playerCompetitionHistory } from "../dashboard/frontend/src/services/player-competition-history.js";
const id = "p_123456",
  league = "l_000001";
const appearance = (matchId, teamId, date, extra = {}) => ({
  playerId: id,
  matchId,
  teamId,
  date,
  leagueId: league,
  minutes: 90,
  ...extra,
});
const match = (id, date, teamId, extra = {}) => ({
  id,
  date,
  leagueId: league,
  home: { id: teamId },
  away: { id: "opponent" },
  ...extra,
});
const entry = (rows, matches = []) => ({
  season: "2025/2026",
  data: { appearances: rows, matches },
});

test("date windows preserve full-history affiliation anchors before narrowing calendar and totals", () => {
  const history = entry([
    appearance("first", "A", "2025-01-01"),
    appearance("last", "A", "2025-01-31"),
    appearance("bench", "A", "2025-01-16", { minutes: 0, starter: false }),
  ]);
  const evidence = [
    {
      match: match("middle", "2025-01-15", "A"),
      season: "2025/2026",
      teamId: "A",
      lineup: {
        confirmed: true,
        complete: true,
        starters: Array.from({ length: 11 }, (_, i) => "s" + i),
        subs: [],
      },
    },
  ];
  const filtered = playerCompetitionHistory([history], id, league, evidence, {
    from: "2025-01-10",
    to: "2025-01-20",
  });
  assert.deepEqual(
    filtered.rows.map((row) => row.match.id),
    ["bench", "middle"],
  );
  assert.equal(filtered.profile.matches, 0);
  assert.equal(filtered.rows[1].status, "absent");
  assert.deepEqual(filtered.groups[0].cardMatchIds, ["bench"]);
});
test("exact competition and played aggregate; unknown and unused bench are distinct", () => {
  const rows = [
    appearance("1", "A", "2025-01-01", { goals: 1 }),
    appearance("2", "A", "2025-01-03", { minutes: null }),
    appearance("3", "A", "2025-01-04", { minutes: 0, starter: false }),
    appearance("4", "A", "2025-01-05", { leagueId: "other", goals: 9 }),
  ];
  const result = playerCompetitionHistory([entry(rows)], id, league);
  assert.deepEqual(
    result.rows.map((r) => r.status),
    ["bench", "minutes_unknown", "played"],
  );
  assert.equal(result.profile.matches, 1);
  assert.equal(result.profile.stats.goals.sum, 1);
});
test("fixtures confined to observed team spells, confirmed lineups, no inferred absence", () => {
  const rows = [
    appearance("1", "A", "2025-01-01"),
    appearance("2", "A", "2025-01-10"),
    appearance("3", "B", "2025-01-11"),
    appearance("4", "B", "2025-02-01"),
  ];
  const evidence = [
    {
      match: match("x", "2025-01-05", "A"),
      teamId: "A",
      season: "2025/2026",
      lineup: {
        confirmed: true,
        complete: true,
        starters: Array.from({ length: 11 }, (_, i) => "s" + i),
        subs: [],
      },
    },
    {
      match: match("y", "2025-01-06", "A"),
      teamId: "A",
      season: "2025/2026",
      lineup: null,
    },
    {
      match: match("z", "2025-01-07", "A"),
      teamId: "A",
      season: "2025/2026",
      lineup: { confirmed: true, starters: [], subs: [id] },
    },
    {
      match: match("bad", "2025-01-20", "A"),
      teamId: "A",
      season: "2025/2026",
    },
    {
      match: match("future", "2025-03-01", "B", { status: "not_started" }),
      teamId: "B",
      season: "2025/2026",
    },
  ];
  const result = playerCompetitionHistory([entry(rows)], id, league, evidence);
  const states = Object.fromEntries(
    result.rows.map((r) => [r.match.id, r.status]),
  );
  assert.equal(states.x, "absent");
  assert.equal(states.y, "participation_unknown");
  assert.equal(states.z, "substitute_unknown");
  assert.equal(states.bad, undefined);
  assert.equal(states.future, undefined);
});
test("upcoming needs membership evidence; foreign league and wrong team excluded", () => {
  const evidence = [
    {
      match: match("next", "2026-01-01", "A", { status: "not_started" }),
      teamId: "A",
      season: "2025/2026",
      membershipConfirmed: true,
    },
    {
      match: match("other", "2026-01-01", "A", { leagueId: "other" }),
      teamId: "A",
      membershipConfirmed: true,
    },
    {
      match: match("wrong", "2026-01-01", "B"),
      teamId: "A",
      membershipConfirmed: true,
    },
  ];
  const result = playerCompetitionHistory([], id, league, evidence);
  assert.deepEqual(
    result.rows.map((r) => r.status),
    ["upcoming"],
  );
});
test("sections expose exact season/team rows and the same played totals", () => {
  const rows = [
    appearance("1", "A", "2025-01-01", { goals: 2 }),
    appearance("2", "B", "2025-01-02", { goals: 1 }),
  ];
  const result = playerCompetitionHistory(
    [
      entry(rows, [
        match("1", "2025-01-01", "A"),
        match("2", "2025-01-02", "B"),
      ]),
    ],
    id,
    league,
  );
  assert.equal(result.sections.length, 2);
  assert.equal(result.groups.length, 2);
  assert.equal(result.profile.matches, 2);
  assert.equal(
    result.sections[0].rows[0].row.matchId,
    result.sections[0].rows[0].match.id,
  );
  assert.equal(result.sections[0].rows[0].statusLabel, "A joué");
  assert.equal(result.sections[0].entry.key, league);
});

test("outside observed spell explicit lineup admits substitute without inventing minutes", () => {
  const base = entry([appearance("a", "A", "2025-01-10")]);
  const list = {
    match: match("before", "2025-01-01", "A"),
    season: "2025/2026",
    teamId: "A",
    lineup: { confirmed: true, complete: false, starters: [], subs: [id] },
  };
  const result = playerCompetitionHistory([base], id, league, [list]);
  const row = result.rows.find((x) => x.match.id === "before");
  assert.equal(row.statusLabel, "Remplaçant, temps inconnu");
  assert.ok(result.groups[0].cardMatchIds.includes("before"));
  assert.equal(result.profile.matches, 1);
});
test("empty or incomplete lineup does not prove non-presence; zero unknown starter is present", () => {
  const base = entry([
    appearance("a", "A", "2025-01-01"),
    appearance("b", "A", "2025-01-10"),
    appearance("zero", "A", "2025-01-06", { minutes: 0, starter: null }),
  ]);
  const evidence = [
    {
      match: match("empty", "2025-01-05", "A"),
      teamId: "A",
      season: "2025/2026",
      lineup: { confirmed: true, complete: true, starters: [], subs: [] },
    },
    {
      match: match("incomplete", "2025-01-07", "A"),
      teamId: "A",
      season: "2025/2026",
      lineup: {
        confirmed: true,
        complete: false,
        starters: Array.from({ length: 11 }, (_, i) => "s" + i),
        subs: [],
      },
    },
  ];
  const result = playerCompetitionHistory([base], id, league, evidence);
  const byId = Object.fromEntries(result.rows.map((x) => [x.match.id, x]));
  assert.equal(byId.empty.status, "participation_unknown");
  assert.equal(byId.incomplete.status, "participation_unknown");
  assert.equal(byId.zero.statusLabel, "Présent, 0 min");
  assert.equal(result.profile.matches, 2);
  assert.ok(result.groups[0].cardMatchIds.includes("zero"));
});
