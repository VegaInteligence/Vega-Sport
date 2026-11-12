// Contract tests of the ranking catalogue (relational-catalog.js on main).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";
import { comingMatches } from "../src/routes/rankings.mjs";

test("club links and a club's UEFA ranking history", { skip }, async () => {
  const links = (await get("/api/club-links?club=t_aaaaa1")).body;
  assert.deepEqual(links, { links: { t_aaaaa1: { clubName: "Olympique Été", countryCode: "FRA", entityId: "uefa:52747", method: "reviewed-alias-and-country", rankingName: "Olympique Ete" } } });
  assert.deepEqual((await get("/api/club-links?club=t_aaaaa2")).body, { links: {} });
  const history = (await get("/api/rankings/club?club=t_aaaaa1")).body;
  assert.equal(history.rows.length, 1);
  assert.deepEqual(history.rows[0].edition, {
    edition: "2026", kind: "uefa-clubs", officialEdition: true, period: "2025/2026", provider: "UEFA",
    retrievedAt: "2025-09-02T00:00:00.000Z", rows: 1, sourceUpdatedAt: "2025-09-01T08:00:00.000Z", sourceUrl: "https://comp.uefa.com/v2/coefficients?c",
  });
  assert.deepEqual([history.rows[0].row.position, history.rows[0].row.points, history.rows[0].row.entityId], [40, 30.5, "uefa:52747"]);
  assert.deepEqual((await get("/api/rankings/club?club=t_aaaaa2")).body, { rows: null });
});

test("UEFA associations of a year, with their season points", { skip }, async () => {
  const { body } = await get("/api/rankings/associations?year=2026");
  assert.deepEqual([body.kind, body.edition, body.provider, body.period, body.officialEdition], ["uefa-associations", "2026", "UEFA", "2025/2026", true]);
  assert.deepEqual(body.rows, [{
    entityId: "uefa:1", entityName: "France", countryCode: "FRA", position: 5, points: 72.3, earnedPoints: 72.3, previousPosition: null, imageUrl: null,
    sourceRow: {
      overallRanking: { numberOfTeamsStillInPlaying: 7 },
      seasonRankings: [
        { seasonYear: 2026, totalPoints: 15.5, nationalAssociationPoints: 15.5, numberOfTeamsStillInPlaying: 7 },
        { seasonYear: 2025, totalPoints: 17, nationalAssociationPoints: 17, numberOfTeamsStillInPlaying: 0 },
      ],
    },
  }]);
  assert.equal((await get("/api/rankings/associations?year=2020")).response.status, 404);
  assert.equal((await get("/api/rankings/associations")).response.status, 400);
});

test("ranking index and editions", { skip }, async () => {
  const index = (await get("/api/rankings/index")).body;
  assert.deepEqual(index.editions.map((e) => [e.kind, e.edition]), [["uefa-clubs", "2026"], ["uefa-associations", "2026"], ["fifa-men", "2025-09-18"]]);
  assert.deepEqual(index.clubMapping, { linked: 1 });
  const fifa = (await get("/api/rankings/edition?kind=fifa-men&edition=2025-09-18")).body;
  assert.deepEqual(fifa.rows, [{ entityId: "fifa:43946", entityName: "France", countryCode: "FRA", position: 2, points: 1870, previousPosition: 1, imageUrl: null, confederation: "UEFA" }]);
  assert.equal((await get("/api/rankings/edition?kind=fifa-men&edition=bad")).response.status, 400);
  assert.equal((await get("/api/rankings/edition?kind=fifa-men&edition=2025-09-18.fifa")).response.status, 400); // no source in a key
});

test("power rankings of players and clubs for a season", { skip }, async () => {
  const { response, body } = await get("/api/rankings/power?kind=players&season=2025/2026");
  assert.equal(response.status, 200);
  assert.deepEqual([body.season, body.kind, body.method.version], ["2025/2026", "players", "power-ranking-v3"]);
  assert.deepEqual(body.rows.map((r) => [r.rank, r.playerId, r.position, r.score]), [[1, "p_aaaab1", "Avant-centre", 87.5], [2, "p_aaaab4", "Ailier / milieu offensif", 50]]);
  // The race numbers its players; each keeps his rank among every ranked player, his index and the two parts of his total.
  assert.deepEqual(body.rows.map((r) => [r.powerRank, r.index, r.contribution, r.ownContribution, r.clubLevel]), [[1, 1.4, 4.2, 3, 1.2], [2, 0, 1.1, 1.3, -0.2]]);
  assert.deepEqual(Object.keys(body.rows[0]).slice(0, 8), ["rank", "playerId", "name", "imageUrl", "teamId", "team", "teamImageUrl", "position"]);
  // More than one score: the season by block and by role.
  assert.deepEqual(body.rows[0].blocks.finishing, { contribution: 3.1, percentile: 95 });
  assert.deepEqual(body.rows[0].roles.map((r) => [r.role, r.minutes]), [["centre_forward", 200], ["winger", 60]]);
  assert.deepEqual([body.rows[1].blocks, body.rows[1].roles], [{}, []]);
  const clubs = (await get("/api/rankings/power?kind=clubs&season=2025/2026")).body;
  assert.equal(clubs.rows.length, 4);
  assert.deepEqual(clubs.rows.map((r) => r.rank), [1, 2, 3, 4]);
  assert.ok(clubs.rows.every((r, i) => !i || clubs.rows[i - 1].elo >= r.elo));
  assert.equal(Math.round(clubs.rows.reduce((s, r) => s + r.elo, 0)), 6000); // Elo moves points between clubs only
  for (const r of clubs.rows) {
    assert.equal(r.wins + r.draws + r.losses, r.matches);
    assert.equal(Math.round(r.eloStart + r.eloChange), Math.round(r.elo));
  }
  assert.equal(Math.round(clubs.rows.reduce((s, r) => s + r.results, 0) * 2), 10); // five matches, one point shared each
  // The league strength index: the levels the Elo run keeps, a rank on the common scale only, the level of each season.
  const levels = (await get("/api/rankings/leagues")).body;
  assert.equal(levels.method.version, "power-ranking-v3");
  assert.ok(levels.leagues.length >= 1);
  for (const league of levels.leagues) {
    assert.match(league.id, /^l_/);
    assert.equal(league.rank === null, !league.onScale);
    assert.ok(league.seasons.every((s) => /^\d{4}\/\d{4}$/.test(s.season) && Number.isFinite(s.level) && s.teams > 0));
  }
  assert.deepEqual(levels.leagues.filter((l) => l.onScale).map((l) => l.rank), levels.leagues.filter((l) => l.onScale).map((_, i) => i + 1));
  assert.equal(levels.onScale, levels.leagues.filter((l) => l.onScale).length);
  assert.ok(levels.leagues.some((l) => l.seasons.length > 0));
  assert.equal((await get("/api/rankings/leagues?season=2025/2026")).response.status, 400);
  // One player's ranking, for his page: the object of the player reads and the ranked players of his role.
  const own = (await get("/api/rankings/power/player?season=2025/2026&player=p_aaaab1")).body;
  assert.deepEqual([own.season, own.player.id, own.player.score, own.player.role, own.player.position, own.player.roleRank, own.player.roleCount],
    ["2025/2026", "p_aaaab1", 87.5, "centre_forward", "Avant-centre", 1, 1]);
  assert.deepEqual(own.player.blocks.finishing, { contribution: 3.1, percentile: 95 });
  assert.equal((await get("/api/rankings/power/player?season=2025/2026&player=p_zzzzz9")).response.status, 404);
  assert.equal((await get("/api/rankings/power/player?season=2024/2025&player=p_aaaab1")).response.status, 404);
  assert.equal((await get("/api/rankings/power/player?season=2025/2026&player=aaaab1")).response.status, 400);
  assert.equal((await get("/api/rankings/power/player?season=2025/2026")).response.status, 400);
  assert.equal((await get("/api/rankings/power?kind=players&season=2025/2026&limit=1")).body.rows.length, 1);
  assert.equal((await get("/api/rankings/power?kind=nations&season=2025/2026")).response.status, 404);
  assert.equal((await get("/api/rankings/power?kind=players&season=2025")).response.status, 400);
  assert.equal((await get("/api/rankings/power?kind=ballon&season=2025/2026")).response.status, 400);
});

test("the forecast of a match still to play and a league replayed to its end", { skip }, async () => {
  const season = (await get("/api/forecasts/season?competition=l_3FJFUl&season=2025/2026")).body;
  assert.deepEqual([season.competition, season.season, season.model.version, season.model.replays], ["l_3FJFUl", "2025/2026", "forecast-v1", 1000]);
  // The clubs by projected points; one share per place, 0 where a club never finished.
  assert.deepEqual(season.teams.map((t) => [t.id, t.played, t.points, t.projectedPoints, t.places]),
    [["t_aaaaa1", 3, 7, 71.4, [0.6, 0.4]], ["t_aaaaa2", 3, 4, 55.3, [0.4, 0.6]]]);
  assert.equal(season.teams[0].imageUrl !== undefined, true);
  // The one match still to play of the edition: its sides' coming opponent and the points the
  // forecast gives them; a club with no match ahead has none.
  const coming = season.teams.map((t) => t.next).filter(Boolean);
  const sides = [
    { matches: 1, home: 1, opponentLevel: 1490, expectedPoints: 1.8, rank: null },
    { matches: 1, home: 0, opponentLevel: 1540, expectedPoints: 1, rank: null },
  ];
  assert.ok(coming.length >= 1 && coming.every((next) => sides.some((side) => JSON.stringify(side) === JSON.stringify(next))), JSON.stringify(coming));
  assert.ok(season.teams.every((t) => "next" in t));
  assert.equal((await get("/api/forecasts/season?competition=l_3FJFUl&season=2024/2025")).response.status, 404);
  assert.equal((await get("/api/forecasts/season?competition=l_3FJFUl")).response.status, 400);
  assert.equal((await get("/api/forecasts/season?competition=ligue1&season=2025/2026")).response.status, 400);
  // The seed's first match still to play.
  const matches = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => "m_aaaaa" + n);
  const answers = await Promise.all(matches.map((id) => get("/api/forecasts/match?match=" + id)));
  const found = answers.filter((a) => a.response.status === 200);
  assert.equal(found.length, 1);
  const { forecast, model } = found[0].body;
  assert.deepEqual(forecast, { home: 0.5123, draw: 0.2501, away: 0.2376, homeGoals: 1.62, awayGoals: 1.04, score: [1, 0] });
  assert.deepEqual([model.version, model.matches], ["forecast-v1", 60000]);
  assert.ok(answers.filter((a) => a.response.status !== 200).every((a) => a.response.status === 404));
  assert.equal((await get("/api/forecasts/match?match=12")).response.status, 400);
});

test("a club's coming matches: five at most, ranked by the opponents' strength", () => {
  const elo = { A: 1700, B: 1600, C: 1500 };
  const fixture = ([home, away]) => ({ home_key: home, away_key: away, home_elo: elo[home], away_elo: elo[away], home_win: 0.5, draw: 0.25, away_win: 0.25 });
  const round = ["AB", "CA", "BC", "BA", "AC", "CB"];
  const next = comingMatches([...round, ...round].map(fixture));
  // The weakest club meets the two strongest: the hardest run. Home matches are worth 1.75 points here, away ones 1.
  assert.deepEqual(next.get("C"), { matches: 5, home: 3, opponentLevel: 1660, expectedPoints: 7.3, rank: 1 });
  assert.deepEqual(next.get("B"), { matches: 5, home: 2, opponentLevel: 1620, expectedPoints: 6.5, rank: 2 });
  assert.deepEqual(next.get("A"), { matches: 5, home: 3, opponentLevel: 1560, expectedPoints: 7.3, rank: 3 });
  // A club with fewer matches ahead than the others is not ranked against them.
  assert.deepEqual(comingMatches(["AB", "CA", "BC"].map(fixture)).get("A"), { matches: 2, home: 1, opponentLevel: 1550, expectedPoints: 2.8, rank: null });
  assert.equal(comingMatches([]).size, 0);
});
