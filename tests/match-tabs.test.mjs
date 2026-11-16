// The match page's header, line-ups, players and analyses read from the match's families.
import test from "node:test";
import assert from "node:assert/strict";
import {
  boardRows, cardCount, cardsOf, leaders, lineupView, playerRows, shootersOf, sortRows, styleGroups, teamStatsByPeriod,
} from "../dashboard/frontend/src/services/match-tabs.js";

const match = { home: { id: "t_h" }, away: { id: "t_a" } };
const stat = (key, value, total) => ({ key, stat: { type: "integer", value, ...(total != null ? { total } : {}) } });
const player = (id, team, stats) => ({ player: { id, name: id.toUpperCase(), image_url: `https://img/${id}.webp` }, team_id: team,
  stats: [{ key: "top_stats", stats: Object.fromEntries(stats.map((s, i) => [`k${i}`, s])) }] });
const players = [
  player("p_a", "t_h", [stat("minutes_played", 90), stat("goals", 1), stat("expected_goals", 0.7), stat("expected_assists", 0.1), stat("accurate_passes", 30, 40), stat("duel_won", 9), stat("matchstats.headers.tackles", 2), stat("interceptions", 1)]),
  player("p_b", "t_a", [stat("minutes_played", 60), stat("goals", 0), stat("expected_goals", 0.1), stat("accurate_passes", 80, 85), stat("duel_won", 3)]),
  player("p_c", "t_a", [stat("minutes_played", 30), stat("assists", 1), stat("expected_assists", 0.9)]),
  player("p_d", "t_a", [stat("minutes_played", 0)]),
  player("p_k", "t_h", [stat("minutes_played", 90), stat("saves", 4)]),
];
const events = [
  { minute: 10, event_type: "goal", team_id: "t_h", player: { id: "p_a", name: "A" } },
  { minute: 43, event_type: "yellowcard", team_id: "t_h", player: { id: "p_a", name: "A" } },
  { minute: 60, event_type: "substitution", team_id: "t_a", player: { id: "p_b", name: "B" }, sub_in_player: { id: "p_c", name: "C" } },
  { minute: 80, event_type: "secondyellow", team_id: "t_a", player: { id: "p_c", name: "C" } },
];

test("team statistics by period, and the cards with their minute, player and side", () => {
  const periods = teamStatsByPeriod({ periods: [
    { period: "All", groups: [{ items: [{ key: "fouls", home: "14", away: "12" }, { key: "accurate_passes", home: "317 (81%)", away: "615 (91%)" }] }] },
    { period: "FirstHalf", groups: [{ items: [{ key: "BallPossesion", home: "42", away: "58" }] }] },
  ] });
  assert.deepEqual(periods.All.fouls, { home: 14, away: 12 });
  assert.deepEqual(periods.All.accurate_passes, { home: 317, away: 615 });
  assert.deepEqual(periods.FirstHalf.BallPossesion, { home: 42, away: 58 });
  const cards = cardsOf(events, match);
  assert.deepEqual(cards.map((c) => [c.minute, c.kind, c.side, c.player.name]), [[43, "yellow", "home", "A"], [80, "second", "away", "C"]]);
  assert.deepEqual(cardCount(cards), { home: { yellow: 1, red: 0 }, away: { yellow: 0, red: 1 } });
});

test("the shooters of a side, the most dangerous first, own goals left out", () => {
  const shots = [
    { teamId: "t_h", playerId: "p_a", playerName: "A", xg: 0.4, isGoal: true },
    { teamId: "t_h", playerId: "p_a", playerName: "A", xg: 0.3 },
    { teamId: "t_h", playerId: "p_e", playerName: "E", xg: 0.5 },
    { teamId: "t_h", playerId: "p_f", playerName: "F", xg: 0.9, isOwnGoal: true },
    { teamId: "t_a", playerId: "p_b", playerName: "B", xg: 2 },
  ];
  assert.deepEqual(shootersOf(shots, "t_h").map((r) => [r.name, r.shots, Math.round(r.xg * 10) / 10, r.goals]), [["A", 2, 0.7, 1], ["E", 1, 0.5, 0]]);
});

test("each starter's match on the line-up, and the substitutes in the order they came on", () => {
  const rows = playerRows(players);
  assert.deepEqual([rows[0].passes, rows[0].passesTotal, rows[4].keeper], [30, 40, true]);
  const grades = new Map([["p_a", { grade: 71, imageUrl: null }]]);
  const view = lineupView({
    home: { formation: "4-4-2", starters: [{ player_id: "p_a", name: "A", pitch_x: 0.8, pitch_y: 0.2, shirt_number: "9", is_captain: true }], subs: [], coach: { name: "Coach" } },
    away: { starters: [{ player_id: "p_b", name: "B", pitch_x: 0.5, pitch_y: 0.5 }], subs: [{ player_id: "p_c", name: "C" }, { player_id: "p_d", name: "D" }] },
    home_team: { name: "Home" },
  }, events, rows, grades);
  const a = view.home.starters[0];
  assert.deepEqual([a.grade, a.goals, a.cards.map((c) => c.kind), a.captain, a.imageUrl], [71, [10], ["yellow"], true, "https://img/p_a.webp"]);
  assert.deepEqual(view.away.starters[0].off, { minute: 60, by: { id: "p_c", name: "C" } });
  assert.deepEqual(view.away.entered.map((p) => [p.name, p.on.minute, p.on.for.name]), [["C", 60, "B"]]);
  assert.deepEqual(view.away.bench.map((p) => p.name), ["D"]);
  assert.equal(view.home.coach, "Coach");
});

test("the players board: who came on, sorted by any column, and the match's leaders", () => {
  const rows = boardRows(players, events, new Map([["p_a", { grade: 71 }], ["p_b", { grade: 55 }]]));
  assert.deepEqual(rows.map((r) => r.id), ["p_a", "p_b", "p_c", "p_k"]);
  assert.deepEqual([rows[1].off, rows[2].on, rows[0].recovered, rows[1].recovered], [60, 60, 3, null]);
  assert.deepEqual(sortRows(rows, { key: "grade", direction: "desc" }).map((r) => r.id), ["p_a", "p_b", "p_c", "p_k"]);
  // A missing value goes last whatever the direction.
  assert.deepEqual(sortRows(rows, { key: "passes", direction: "asc" }).map((r) => r.id).slice(0, 2), ["p_a", "p_b"]);
  assert.equal(sortRows(rows, { key: "passes", direction: "asc" }).at(-1).passes, null);
  const top = leaders(rows);
  assert.deepEqual([top.grade.id, top.threat.id, top.passes.id, top.duels.id], ["p_a", "p_c", "p_b", "p_a"]);
});

test("the two teams' play by phase, a row only where both have a value", () => {
  const team = (id, possession, ppda, sca) => ({ team: { id }, territory: { possession_pct: possession }, defending: { ppda }, creation: { sca } });
  const groups = styleGroups([team("t_a", 63, 8.1, 36), team("t_h", 37, 16.7, null)], match);
  assert.deepEqual(groups.map((g) => g.title), ["Construction", "Pressing et territoire"]);
  assert.deepEqual(groups[0].rows[0], { label: "Possession", home: 37, away: 63, unit: " %" });
  assert.equal(groups[1].rows[0].lower, true);
  assert.equal(styleGroups([], match), null);
});
