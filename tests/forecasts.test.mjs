import test from "node:test";
import assert from "node:assert/strict";
import { elevenWord, matchForecastReading, probabilityChart, projectionRows, share } from "../dashboard/frontend/src/services/forecasts.js";

test("shares read as the site writes them", () => {
  assert.deepEqual([0, null, 0.004, 0.005, 0.5, 0.994, 0.999, 1].map(share), ["—", "—", "< 1 %", "1 %", "50 %", "99 %", "> 99 %", "100 %"]);
});

test("a projection's rows: the title, the first four places, the last three", () => {
  const places = (values) => values.concat(Array(8 - values.length).fill(0));
  const rows = projectionRows({ teams: [
    { id: "t_a", name: "A", imageUrl: null, played: 10, points: 24, projectedPoints: 80.4, places: places([0.7, 0.2, 0.1]) },
    { id: "t_b", name: "B", imageUrl: null, played: 10, points: 9, projectedPoints: 31.2, places: [0, 0, 0, 0.1, 0.1, 0.3, 0.3, 0.2] },
  ] });
  assert.deepEqual(rows.map((row) => [row.id, row.title, Math.round(row.topFour * 100), Math.round(row.bottomThree * 100)]), [["t_a", 0.7, 100, 0], ["t_b", 0, 10, 80]]);
  // A league too small for the last three to mean relegation has no such column.
  assert.equal(projectionRows({ teams: [{ id: "t_a", places: [0.6, 0.4] }] })[0].bottomThree, null);
  assert.deepEqual(projectionRows(null), []);
});

test("a projection's rows carry the club's coming matches when the answer has them", () => {
  const next = { matches: 5, home: 3, opponentLevel: 1648, expectedPoints: 7.9, rank: 2 };
  const rows = projectionRows({ teams: [{ id: "t_a", places: [1], next }, { id: "t_b", places: [1], next: { matches: 0 } }, { id: "t_c", places: [1] }] });
  assert.deepEqual(rows.map((row) => row.next), [next, null, null]);
});

test("a match's probabilities are drawn as three stacked areas with a marker at each goal", () => {
  const points = Array.from({ length: 91 }, (_, minute) => ({ minute, home: minute < 30 ? 0.5 : 0.8, draw: minute < 30 ? 0.25 : 0.15, away: minute < 30 ? 0.25 : 0.05, score: [minute < 30 ? 0 : 1, 0] }));
  const chart = probabilityChart({ status: "finished", points, events: [{ minute: 30, added: 0, kind: "goal", side: "home" }, { minute: 70, added: 0, kind: "red", side: "away" }] });
  // Kick-off at the left edge, the 90th minute at the right; the home area starts at the bottom.
  assert.ok(chart.paths.home.startsWith("M30,112L"));
  assert.ok(chart.paths.home.includes("L700,59.2L700,200"));
  assert.ok(chart.paths.away.includes("30,24") && chart.paths.away.endsWith("Z"));
  assert.deepEqual(chart.goals, [{ x: 253.3, side: "home", minute: 30, label: "1–0" }]);
  // What the goal changed for the side that scored: its chances the minute before, and at the goal.
  assert.deepEqual(chart.swings, [{ minute: 30, label: "1–0", side: "home", from: 0.5, to: 0.8 }]);
  assert.deepEqual(chart.reds, [{ x: 551.1, side: "away", minute: 70 }]);
  assert.deepEqual([chart.start.home, chart.live, chart.ticks.length], [0.5, null, 7]);
  // A match in play ends on its present state.
  assert.equal(probabilityChart({ status: "in_play", points: points.slice(0, 41), events: [] }).live.minute, 40);
  assert.equal(probabilityChart({ points: points.slice(0, 1) }), null);
  assert.equal(probabilityChart(null), null);
});

test("a match's card shows the forecast that read the two confirmed line-ups, when there is one", () => {
  const forecast = { home: 0.45, draw: 0.27, away: 0.28, homeGoals: 1.4, awayGoals: 1.1, score: [1, 1] };
  const alone = matchForecastReading({ match: "m_aaaaa1", forecast }, "Lille", "Lens");
  assert.deepEqual([alone.forecast, alone.lineups, alone.before], [forecast, false, undefined]);
  assert.match(alone.basis, /ne connaît ni les compositions ni les absents/);
  const read = { home: 0.52, draw: 0.25, away: 0.23, homeGoals: 1.6, awayGoals: 1.0, score: [1, 0] };
  const both = matchForecastReading({ match: "m_aaaaa1", forecast, lineups: { forecast: read, home: { deviation: 0.31, elo: 14.1 }, away: { deviation: -0.72, elo: -32.7 }, computedAt: "2026-11-14T16:12:00.000Z" } }, "Lille", "Lens");
  assert.deepEqual([both.forecast, both.lineups], [read, true]);
  assert.equal(both.basis, "D’après la force des deux équipes et leurs compositions confirmées : le onze de Lille est plus fort que son onze habituel, celui de Lens nettement moins fort que son onze habituel.");
  assert.equal(both.before, "Sans les compositions : Lille 45\u00a0% · nul 27\u00a0% · Lens 28\u00a0%.");
  // A match about to be played also read each club's recent matches: the card says so, with or without line-ups.
  assert.equal(matchForecastReading({ forecast, form: { home: 12.3, away: -8 } }, "Lille", "Lens").basis,
    "D’après la force des deux équipes avant le match et leurs dix derniers matchs (xG) ; le modèle ne connaît ni les compositions ni les absents.");
  assert.match(matchForecastReading({ forecast, form: { home: 12.3, away: -8 }, lineups: { forecast: read, home: { deviation: 0 }, away: { deviation: 0 } } }, "Lille", "Lens").basis,
    /^D’après la force des deux équipes, leurs dix derniers matchs \(xG\) et leurs compositions confirmées : /);
  // An answer whose line-ups lack a side is read as one without them; no answer gives nothing.
  assert.equal(matchForecastReading({ forecast, lineups: { forecast: read, home: { deviation: 0.3 } } }, "A", "B").lineups, false);
  assert.equal(matchForecastReading(null, "A", "B"), null);
});

test("an eleven reads as its usual one, stronger or weaker, clearly so beyond a threshold", () => {
  assert.deepEqual([0, 0.14, -0.14, 0.15, -0.2, 0.6, -0.9].map(elevenWord), [
    "proche de son onze habituel", "proche de son onze habituel", "proche de son onze habituel", "plus fort que son onze habituel",
    "moins fort que son onze habituel", "nettement plus fort que son onze habituel", "nettement moins fort que son onze habituel",
  ]);
});

test("the chart says when its kick-off comes from the forecast that read the line-ups", () => {
  const points = Array.from({ length: 91 }, (_, minute) => ({ minute, home: 0.5, draw: 0.3, away: 0.2, score: [0, 0] }));
  assert.equal(probabilityChart({ status: "finished", points, events: [], lineups: true }).lineups, true);
  assert.equal(probabilityChart({ status: "finished", points, events: [] }).lineups, false);
});

test("a match the base has not read yet is drawn from the live feed, by the read API's own calculation", async () => {
  const { withLive } = await import("../dashboard/frontend/src/services/forecasts.js");
  const { timeline } = await import("../dashboard/shared/inplay.js");
  const inplay = { profile: [0.13, 0.14, 0.18, 0.16, 0.16, 0.16, 0.07], down: 0.6, up: 1.7, ahead: 0.9, behind: 1.1 };
  const answer = { status: "not_started", rates: { home: 1.6, away: 1.1 }, inplay, rho: -0.03, points: timeline(1.6, 1.1, [], inplay, -0.03, 0), events: [] };
  const match = { home: { id: "t_aaaaa1" }, away: { id: "t_aaaaa2" } };
  const event = (type, minute, teamId, extra = {}) => ({ type, minute, minuteAdded: null, teamId, cancelled: false, ...extra });
  const live = {
    status: "in_play", minute: 63, score: { home: 1, away: 1 }, families: { score: "live", events: "live", stats: "live" },
    events: [event("goal", 12, "t_aaaaa1"), event("yellow_card", 30, "t_aaaaa2"), event("goal", 40, "t_aaaaa1", { cancelled: true }),
      event("own_goal", 55, "t_aaaaa2"), event("red_card", 58, "t_aaaaa1")],
  };
  const drawn = withLive(answer, live, match);
  // The same points as the API would draw from the base's events: a cancelled goal and a yellow card do not count.
  const core = [{ minute: 12, added: 0, kind: "goal", side: "home" }, { minute: 55, added: 0, kind: "goal", side: "away" }, { minute: 58, added: 0, kind: "red", side: "home" }];
  assert.deepEqual(drawn.points, timeline(1.6, 1.1, core, inplay, -0.03, 63));
  assert.deepEqual([drawn.status, drawn.live, drawn.points.length, drawn.points.at(-1).score], ["in_play", true, 64, [1, 1]]);
  assert.equal(probabilityChart(drawn).live.minute, 63);
  assert.deepEqual(probabilityChart(drawn).reds.map((r) => [r.minute, r.side]), [[58, "home"]]);
  // Half-time stops at the 45th minute; a provisional result ends on the result, as a finished match does.
  assert.equal(withLive(answer, { ...live, status: "half_time", minute: 45, score: { home: 1, away: 0 }, events: live.events.slice(0, 1) }, match).points.length, 46);
  const over = withLive(answer, { ...live, status: "finished", minute: 94 }, match).points.at(-1);
  assert.deepEqual([over.minute, over.home, over.draw, over.away], [90, 0, 1, 0]);
  // Left as it is: the base already has the events, the feed has not started, its goals do not give its score, a goal without a side.
  assert.equal(withLive(answer, { ...live, families: { ...live.families, events: "core" } }, match), answer);
  assert.equal(withLive(answer, { ...live, status: "scheduled" }, match), answer);
  assert.equal(withLive(answer, { ...live, score: { home: 2, away: 1 } }, match), answer);
  assert.equal(withLive(answer, { ...live, events: [...live.events, event("goal", 70, null)], score: { home: 2, away: 1 } }, match), answer);
  assert.equal(withLive(null, live, match), null);
  assert.equal(withLive(answer, null, match), answer);
});

test("the live read route's state is what the chart reads", async () => {
  const { withLive } = await import("../dashboard/frontend/src/services/forecasts.js");
  const { liveBody } = await import("../backend/api/src/live.mjs");
  const { timeline } = await import("../dashboard/shared/inplay.js");
  const inplay = { profile: [0.13, 0.14, 0.18, 0.16, 0.16, 0.16, 0.07], down: 0.6, up: 1.7, ahead: 0.9, behind: 1.1 };
  const answer = { status: "not_started", rates: { home: 1.4, away: 1.2 }, inplay, rho: -0.03, points: timeline(1.4, 1.2, [], inplay, -0.03, 0), events: [] };
  // The items the ingestor writes (backend/vega/live/ingestor.py), as GET /live/matches/{id} serves them.
  const state = { match: "m_aaaaa1", revision: 3, provider: "replay", status: "in_play", minute: 71, home_score: 0, away_score: 1,
    kickoff_at: "2026-11-14T15:00:00Z", core_families: [], expires_at: 1_900_000_000 };
  const events = [{ seq: 1, revision: 2, event_type: "penalty_goal", minute: 33, team_id: "t_aaaaa2", is_cancelled: false }];
  const body = liveBody(state, events, []);
  const drawn = withLive(answer, body, { home: { id: "t_aaaaa1" }, away: { id: "t_aaaaa2" } });
  assert.deepEqual(drawn.points, timeline(1.4, 1.2, [{ minute: 33, added: 0, kind: "goal", side: "away" }], inplay, -0.03, 71));
});
