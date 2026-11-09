import assert from "node:assert/strict";
import test from "node:test";
import { playerPlayingTime } from "../dashboard/frontend/src/services/player-playing-time.js";

const game = (id, date, overrides = {}) => ({
  id,
  date,
  status: "finished",
  leagueId: "league",
  league: "Liga",
  home: { id: "club", lineupConfirmed: true },
  away: { id: "opponent" },
  coverage: { players: true, playerStats: true, playedPlayers: 28 },
  ...overrides,
});
const row = (matchId, minutes, teamId = "club") => ({
  matchId,
  minutes,
  teamId,
});

test("uses finished fixtures even when the player did not appear", () => {
  const a = game("a", "2026-08-23");
  const b = game("b", "2026-08-30");
  const c = game("c", "2026-09-06");
  const upcoming = game("upcoming", "2026-09-13", { status: "not_started" });
  const result = playerPlayingTime(
    {
      matches: [a, b, c],
      fixtures: [a, b, c, upcoming],
    },
    [row("a", 90), row("a", 90), row("b", 90), row("c", 50, "other")],
    "club",
  );
  assert.equal(result.minutes, 180);
  assert.equal(result.totalMinutes, 270);
  assert.equal(result.percentage.toFixed(1), "66.7");
});

test("matches the team, competition and date filters", () => {
  const cup = game("cup", "2026-08-30", {
    leagueId: "cup",
    league: "Coupe",
  });
  const result = playerPlayingTime(
    {
      matches: [game("early", "2026-08-23"), cup, game("a", "2026-08-30")],
      fixtures: [],
    },
    [row("a", 45), row("a", 90, "selection")],
    "club",
    { from: "2026-08-30", to: "2026-08-30", competition: "Liga" },
  );
  assert.equal(result.percentage, 50);
  assert.equal(result.matches, 1);
});

test("keeps missing durations separate from observed zero minutes", () => {
  const a = game("a", "2026-08-23");
  const b = game("b", "2026-08-30", { coverage: {} });
  const matches = { matches: [a, b], fixtures: [] };
  const missing = playerPlayingTime(matches, [row("a", 0)], "club");
  assert.equal(missing.percentage, null);
  assert.equal(missing.covered, 1);
  assert.equal(playerPlayingTime(matches, [row("b", 0)], "club").percentage, 0);
  assert.equal(
    playerPlayingTime({ matches: [a] }, [row("a", null)], "club").percentage,
    null,
  );
});

test("does not show a percentage for ambiguous or longer durations", () => {
  const matches = { matches: [game("a", "2026-08-23")] };
  assert.equal(
    playerPlayingTime(matches, [row("a", 120)], "club").percentage,
    null,
  );
  assert.equal(
    playerPlayingTime(matches, [row("a", 45), row("a", 90)], "club").percentage,
    null,
  );
});

test("marks a calendar missing a recorded appearance as incomplete", () => {
  const result = playerPlayingTime(
    { matches: [game("a", "2026-08-23")] },
    [row("a", 90), row("missing", 30)],
    "club",
  );
  assert.equal(result.incompleteCalendar, true);
  assert.equal(result.percentage, null);
  assert.equal(playerPlayingTime({ matches: [] }, [], "club"), null);
});

test("uses verified halves only for an existing appearance with missing minutes", () => {
  const matches = {
    matches: [game("a", "2026-08-23"), game("b", "2026-08-30")],
  };
  const rows = [row("a", null)];
  const observed = playerPlayingTime(matches, rows, "club");
  assert.deepEqual(
    observed.missingMinutes.map((match) => match.id),
    ["a"],
  );
  assert.equal(observed.percentage, null);

  const result = playerPlayingTime(
    matches,
    rows,
    "club",
    {},
    new Map([
      ["a", 90],
      ["b", 90],
    ]),
  );
  assert.equal(result.percentage, 50);
  assert.equal(result.recovered, 1);
  assert.equal(rows[0].minutes, null);
});
