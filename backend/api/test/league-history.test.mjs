// GET /api/league-history (164, src/routes/league-history.mjs): an archived season of the five big leagues for the
// competition page. Written before the route and the reads.
//
// Failure modes and expected outcomes:
//  1. A season outside 2010/11–2020/21, a league that is not one of the five, a season the base does not hold, an
//     unknown parameter: 404 (400 for the parameter).
//  2. A club the site holds comes with its public id and crest; an archived team merged into it (merged_into) reads as
//     that club; a club only the archive knows has its archived name, no id, no crest.
//  3. The table counts played matches only; each row's colour is what the club did the next season (Champions League
//     from the next season's archived edition, its club matched by id or by name without the country tag and legal-form
//     words, « FC Bayern Munich (GER) »; relegation from the next season's league).
//  4. From 2012/13 the players are the league season's rows (core.league_player_seasons, 163), best scorers first;
//     before, the scorers of the archived goals, own goals apart.
//  5. The summary: champion and points, top scorer, goals per played match, relegated clubs.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";
import { seedLeagueHistory } from "./league-history-fixture.mjs";

before(() => {
  if (!skip) seedLeagueHistory();
});

const path = (league, season) => `/api/league-history?competition=${league}&season=${encodeURIComponent(season)}`;

test("an archived Bundesliga season: table, colours, matchdays, players, summary", { skip }, async () => {
  const { response, body } = await get(path("l_1Isor4", "2015/2016"));
  assert.equal(response.status, 200);
  const d = body.data;
  assert.deepEqual([d.competition, d.name, d.season, d.edition], ["l_1Isor4", "Bundesliga", "2015/2016", "2015-16/de.1"]);
  assert.deepEqual(d.standings.map((r) => [r.rank, r.team.name, r.team.id, r.points, r.played, r.zone]), [
    [1, "Bayern Munich", "t_bayern1", 6, 2, "cl"],
    [2, "SV Darmstadt 98", null, 4, 2, null],
    [3, "Borussia Dortmund", "t_bvb0001", 1, 2, "relegation"],
    [4, "Hannover 96", null, 0, 2, "relegation"],
  ]);
  assert.equal(d.standings[0].team.imageUrl, "https://cdn.test/bayern.png");
  assert.deepEqual(d.matchdays.map((g) => [g.number, g.matches.length]), [[1, 2], [2, 2], [34, 1]]);
  assert.deepEqual(d.matchdays[0].matches[0], {
    date: "2015-08-14", home: { id: "t_bayern1", name: "Bayern Munich", imageUrl: "https://cdn.test/bayern.png" },
    away: { id: "t_bvb0001", name: "Borussia Dortmund", imageUrl: null }, score: [5, 1],
  });
  assert.equal(d.matchdays[2].matches[0].score, null);
  assert.equal(d.players.kind, "appearances");
  assert.equal(d.players.source.license, "CC0-1.0");
  assert.equal(d.players.incomplete, false);
  assert.deepEqual(d.players.rows.map((p) => [p.name, p.club.name, p.club.id, p.goals, p.minutes]), [
    ["Robert Lewandowski", "Bayern Munich", "t_bayern1", 30, 2747], ["Sandro Wagner", "SV Darmstadt 98", null, 14, 2700],
  ]);
  assert.deepEqual(d.summary, {
    champion: { team: { id: "t_bayern1", name: "Bayern Munich", imageUrl: "https://cdn.test/bayern.png" }, points: 6 },
    topScorer: { name: "Robert Lewandowski", goals: 30 }, goalsPerMatch: 3.5,
    relegated: [{ id: "t_bvb0001", name: "Borussia Dortmund", imageUrl: null }, { id: null, name: "Hannover 96", imageUrl: null }],
  });
});

test("before 2012/13 the players are the archived scorers, own goals apart", { skip }, async () => {
  const d = (await get(path("l_1Isor4", "2011/2012"))).body.data;
  assert.equal(d.players.kind, "scorers");
  assert.deepEqual(d.players.rows.map((p) => [p.name, p.club.name, p.goals]), [["Robert Lewandowski", "Borussia Dortmund", 2], ["Mario Gómez", "Bayern Munich", 1]]);
});

test("outside the archived seasons: 404; an unknown parameter: 400", { skip }, async () => {
  assert.equal((await get(path("l_1Isor4", "2021/2022"))).response.status, 404);
  assert.equal((await get(path("l_1Isor4", "2009/2010"))).response.status, 404);
  assert.equal((await get(path("l_9xxxxx", "2015/2016"))).response.status, 404);
  assert.equal((await get(path("l_1Isor4", "2014/2015"))).response.status, 404); // not held
  assert.equal((await get(path("l_1Isor4", "2015/2016") + "&x=1")).response.status, 400);
  const first = await get(path("l_1Isor4", "2015/2016"));
  assert.equal((await get(path("l_1Isor4", "2015/2016"), { "if-none-match": first.response.headers.get("etag") })).response.status, 304);
});
