import test from "node:test";
import assert from "node:assert/strict";
import { elevenWord, knockoutRows, matchForecastReading, probabilityLines, projectionRows, share } from "../dashboard/frontend/src/services/forecasts.js";

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

test("a UEFA cup's rows: its league phase and each stage of its bracket, as the API gives them", () => {
  // A cup of the league-phase format (122): top 8, play-offs (9th–24th), out (25th–36th), then
  // each knockout round reached; the title and first four of a league do not apply.
  const stages = { top8: 0.95, playoff: 0.05, out: 0, r16: 0.99, qf: 0.76, sf: 0.47, final: 0.26, win: 0.13 };
  const [row] = projectionRows({ format: "league-phase", teams: [{ id: "t_a", places: [0.5, 0.5], stages }] });
  assert.deepEqual(row.stages, stages);
  // A league has none, a cup row missing a stage reads it as none.
  assert.equal(projectionRows({ teams: [{ id: "t_a", places: [1] }] })[0].stages, null);
  assert.equal(projectionRows({ format: "league-phase", teams: [{ id: "t_a", places: [1], stages: { top8: 0.2 } }] })[0].stages.win, 0);
});

test("a domestic cup's rows: the round in play with each club's opponent, then each later round, the likeliest winner first", () => {
  // A knockout cup's answer (124): its stages from the round in play to the winner, each club's Elo and drawn opponent.
  const team = (id, win, qf, opponent) => ({ id, name: id, imageUrl: null, elo: 1500, opponent: { id: opponent, name: opponent, imageUrl: null, home: id < opponent },
    stages: { top8: 0, playoff: 0, out: 0, r64: 0, r32: 0, r16: 1, qf, sf: qf / 2, final: qf / 4, win } });
  const { rows, current, rounds } = knockoutRows({ format: "knockout", teams: [team("a", 0.1, 0.6, "b"), team("b", 0.05, 0.4, "a"), team("c", 0.5, 0.9, "d"), team("d", 0.35, 0.1, "c")] });
  assert.deepEqual(rows.map((r) => r.id), ["c", "d", "a", "b"]);
  assert.deepEqual([current, rounds], [{ key: "r16", label: "8es" }, [{ key: "qf", label: "Quarts" }, { key: "sf", label: "Demies" }, { key: "final", label: "Finale" }, { key: "win", label: "Vainqueur" }]]);
  assert.deepEqual(rows[0].opponent, { id: "d", name: "d", imageUrl: null, home: true });
  assert.equal(rows[0].elo, 1500);
  // A final in play: the round is the final, the winner its only later column; no answer, no rows.
  const final = knockoutRows({ format: "knockout", teams: [{ id: "x", stages: { final: 1, win: 0.76 } }, { id: "y", stages: { final: 1, win: 0.24 } }] });
  assert.deepEqual([final.current.key, final.rounds.map((r) => r.key)], ["final", ["win"]]);
  assert.deepEqual(knockoutRows(null), { rows: [], current: null, rounds: [] });
});

test("a projection's rows carry the club's coming matches when the answer has them", () => {
  const next = { matches: 5, home: 3, opponentLevel: 1648, expectedPoints: 7.9, rank: 2 };
  const rows = projectionRows({ teams: [{ id: "t_a", places: [1], next }, { id: "t_b", places: [1], next: { matches: 0 } }, { id: "t_c", places: [1] }] });
  assert.deepEqual(rows.map((row) => row.next), [next, null, null]);
});

test("a match's probabilities are three lines that jump at each goal", () => {
  const points = Array.from({ length: 91 }, (_, minute) => ({ minute, home: minute < 30 ? 0.5 : 0.8, draw: minute < 30 ? 0.25 : 0.15, away: minute < 30 ? 0.25 : 0.05, score: [minute < 30 ? 0 : 1, 0] }));
  const chart = probabilityLines({ status: "finished", points, events: [{ minute: 30, added: 0, kind: "goal", side: "home" }, { minute: 70, added: 0, kind: "red", side: "away" }] });
  // The minute before the goal stands until the goal: two points at the 30th, before and after.
  assert.deepEqual(chart.lines.filter((p) => p.minute === 30).map((p) => p.home), [0.5, 0.8]);
  assert.equal(chart.lines.length, 92);
  // The pointer reads the real minutes only.
  assert.equal(chart.series.length, 91);
  // Each goal with the score it made and what it did to the scoring side's chances.
  assert.deepEqual(chart.goals, [{ minute: 30, side: "home", label: "1–0", from: 0.5, to: 0.8 }]);
  assert.deepEqual(chart.reds, [{ minute: 70, side: "away" }]);
  assert.deepEqual([chart.span, chart.start.home, chart.end.minute, chart.live], [90, 0.5, 90, null]);
  // A match in play ends on its present state.
  const live = probabilityLines({ status: "in_play", points: points.slice(0, 41), events: [] });
  assert.deepEqual([live.live.minute, live.end.minute, live.span], [40, 40, 90]);
  // Added time widens the frame.
  assert.equal(probabilityLines({ points: [...points, { ...points[90], minute: 94 }], events: [] }).span, 94);
  // A goal whose minute has no point keeps its marker, without a swing.
  assert.deepEqual(probabilityLines({ points: points.slice(0, 20), events: [{ minute: 50, kind: "goal", side: "away" }] }).goals, [{ minute: 50, side: "away", label: "0–1", from: null, to: null }]);
  assert.equal(probabilityLines({ points: points.slice(0, 1) }), null);
  assert.equal(probabilityLines(null), null);
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
  assert.equal(probabilityLines({ status: "finished", points, events: [], lineups: true }).lineups, true);
  assert.equal(probabilityLines({ status: "finished", points, events: [] }).lineups, false);
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
  assert.equal(probabilityLines(drawn).live.minute, 63);
  assert.deepEqual(probabilityLines(drawn).reds.map((r) => [r.minute, r.side]), [[58, "home"]]);
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

// Extra time on the site (#68). Failure modes and expected outcomes:
//  X1 The feed says the match is in extra time: the chart runs past the 90th, to the feed's minute, by the
//     read API's own calculation (timeline(..., extra)); the answer says `extraTime`.
//  X2 Added time is not extra time: a second half at the 95th stops at the 90th, without `extraTime`.
//  X3 Extra time's own break (half_time during extra_time) stops at the 105th, not at the 45th.
//  X4 Extra time just started, no minute given: the 90 minutes played are drawn, nothing is invented after.
//  X5 A result after extra time ends at the 120th on the result.
//  X6 A shoot-out's kicks are not goals: the chart ends level at the 120th and says the kicks scored (`penalties`).
//  X7 Extra time whose goals do not give the feed's score: the answer is left as it is.
test("a feed in extra time carries the chart to the 120th minute", async () => {
  const { withLive } = await import("../dashboard/frontend/src/services/forecasts.js");
  const { timeline } = await import("../dashboard/shared/inplay.js");
  const inplay = { profile: [0.13, 0.14, 0.18, 0.16, 0.16, 0.16, 0.07], down: 0.6, up: 1.7, ahead: 0.9, behind: 1.1 };
  const answer = { status: "not_started", rates: { home: 1.6, away: 1.1 }, inplay, rho: -0.03, points: timeline(1.6, 1.1, [], inplay, -0.03, 0), events: [] };
  const match = { home: { id: "t_aaaaa1" }, away: { id: "t_aaaaa2" } };
  const event = (type, minute, teamId, period, extra = {}) => ({ type, minute, minuteAdded: null, teamId, period, cancelled: false, ...extra });
  const regulation = [event("goal", 23, "t_aaaaa1", "first_half"), event("goal", 60, "t_aaaaa2", "second_half")];
  const core = [{ minute: 23, added: 0, kind: "goal", side: "home" }, { minute: 60, added: 0, kind: "goal", side: "away" }];
  const families = { score: "live", events: "live", stats: "live" };
  // X1
  const extra = { status: "in_play", period: "extra_time", minute: 104, score: { home: 2, away: 1 }, families, events: [...regulation, event("goal", 104, "t_aaaaa1", "extra_time")] };
  const drawn = withLive(answer, extra, match);
  const decided = [...core, { minute: 104, added: 0, kind: "goal", side: "home" }];
  assert.deepEqual(drawn.points, timeline(1.6, 1.1, decided, inplay, -0.03, 104, true));
  assert.deepEqual([drawn.extraTime, drawn.status, drawn.points.length, drawn.points.at(-1).score], [true, "in_play", 105, [2, 1]]);
  // X2
  const added = withLive(answer, { status: "in_play", period: "second_half", minute: 95, score: { home: 1, away: 1 }, families, events: regulation }, match);
  assert.deepEqual([added.points.length, added.extraTime], [91, undefined]);
  assert.deepEqual(added.points, timeline(1.6, 1.1, core, inplay, -0.03, 90));
  // X3
  const pause = withLive(answer, { status: "half_time", period: "extra_time", minute: 105, score: { home: 1, away: 1 }, families, events: regulation }, match);
  assert.deepEqual([pause.points.length, pause.extraTime], [106, true]);
  // X4
  const started = withLive(answer, { status: "in_play", period: "extra_time", minute: null, score: { home: 1, away: 1 }, families, events: regulation }, match);
  assert.deepEqual([started.points.length, started.extraTime], [91, true]);
  // X5
  const over = withLive(answer, { ...extra, status: "finished", minute: 120 }, match);
  assert.deepEqual([over.points.length, over.status, over.extraTime, over.penalties], [121, "finished", true, null]);
  const end = over.points.at(-1);
  assert.deepEqual([end.minute, end.home, end.draw, end.away, end.score], [120, 1, 0, 0, [2, 1]]);
  // X6
  const kick = (seq, type, teamId) => ({ seq, ...event(type, 120, teamId, "penalties") });
  const kicks = [kick(1, "penalty_goal", "t_aaaaa1"), kick(2, "missed_penalty", "t_aaaaa2"), kick(3, "penalty_goal", "t_aaaaa1"), kick(4, "penalty_goal", "t_aaaaa2")];
  const shootout = withLive(answer, { status: "in_play", period: "penalties", minute: 120, score: { home: 1, away: 1 }, families, events: [...regulation, ...kicks] }, match);
  assert.deepEqual([shootout.points.length, shootout.extraTime, shootout.penalties], [121, true, [2, 1]]);
  const level = shootout.points.at(-1);
  assert.deepEqual([level.home, level.draw, level.away, level.score], [0, 1, 0, [1, 1]]);
  assert.deepEqual(shootout.events, core);
  // X7
  assert.equal(withLive(answer, { ...extra, score: { home: 3, away: 1 } }, match), answer);
});

//  L1 An extra-time answer is drawn over 120 minutes and says so (`extra`), with its shoot-out's score.
//  L2 After the 90th the middle line changes meaning (level at the 90th → level at the 120th): the three
//     lines step at the 90th, as they do at a goal, instead of sliding over a minute.
//  L3 A match without extra time keeps its 90 minutes and has no such step.
test("the chart's lines of an extra-time match", async () => {
  const { timeline } = await import("../dashboard/shared/inplay.js");
  const inplay = { profile: [0.13, 0.14, 0.18, 0.16, 0.16, 0.16, 0.07], down: 0.6, up: 1.7, ahead: 0.9, behind: 1.1 };
  const events = [{ minute: 23, added: 0, kind: "goal", side: "home" }, { minute: 60, added: 0, kind: "goal", side: "away" }];
  const points = timeline(1.6, 1.1, events, inplay, -0.03, 120, true);
  const chart = probabilityLines({ status: "finished", extraTime: true, penalties: [4, 3], points, events });
  assert.deepEqual([chart.span, chart.extra, chart.penalties, chart.series.length], [120, true, [4, 3], 121]);
  const at90 = chart.lines.filter((p) => p.minute === 90);
  assert.equal(at90.length, 2);
  assert.deepEqual([at90[0].draw, at90[1].draw], [points[90].draw, points[91].draw]);
  assert.ok(at90[1].draw < at90[0].draw);
  // An extra-time match still in its 90 minutes (extra time about to start) has nothing to step to.
  assert.equal(probabilityLines({ status: "in_play", extraTime: true, points: points.slice(0, 91), events }).lines.filter((p) => p.minute === 90).length, 1);
  const plain = probabilityLines({ status: "finished", points: timeline(1.6, 1.1, events, inplay, -0.03, 90), events });
  assert.deepEqual([plain.span, plain.extra, plain.penalties, plain.lines.filter((p) => p.minute === 90).length], [90, false, null, 1]);
});

test("R33 the reading carries its inputs, each eleven's words and tone, and the forecast without the line-ups (§ 69)", () => {
  const forecast = { home: 0.45, draw: 0.27, away: 0.28, homeGoals: 1.4, awayGoals: 1.1, score: [1, 1] };
  const read = { home: 0.52, draw: 0.25, away: 0.23, homeGoals: 1.6, awayGoals: 1.0, score: [1, 0] };
  const alone = matchForecastReading({ forecast }, "Lille", "Lens");
  assert.deepEqual(alone.sources, ["Force des deux équipes"]);
  assert.deepEqual(alone.elevens, []);
  assert.equal(alone.without, null);
  assert.deepEqual(matchForecastReading({ forecast, form: { home: 1, away: 2 } }, "Lille", "Lens").sources,
    ["Force des deux équipes", "10 derniers matchs (xG)"]);
  const both = matchForecastReading({ forecast, form: { home: 1, away: 2 }, lineups: { forecast: read, home: { deviation: 0.05 }, away: { deviation: -0.72 } } }, "Lille", "Lens");
  assert.deepEqual(both.sources, ["Force des deux équipes", "10 derniers matchs (xG)", "Compositions confirmées"]);
  assert.deepEqual(both.elevens, [
    { side: "home", name: "Lille", words: "proche de l'habituel", tone: "same" },
    { side: "away", name: "Lens", words: "nettement moins fort que l'habituel", tone: "down" },
  ]);
  assert.equal(both.without, forecast);
  assert.equal(matchForecastReading({ forecast, lineups: { forecast: read, home: { deviation: 0.3 }, away: { deviation: 0 } } }, "A", "B").elevens[0].tone, "up");
});
