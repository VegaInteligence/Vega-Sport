// Contract tests of the ranking catalogue (relational-catalog.js on main).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";
import { comingMatches, cupFormat, cupStages, groupsByTeam, levelsByTeam, provisionalReason, roundOpponents, roundRace, RACE_CARD } from "../src/routes/rankings.mjs";

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

test("the players' level of a season (Score Vega v9), read beside the power ranking", { skip }, async () => {
  // FAILURE_MODES §49, 49t: the level's rows, under the read role; the power ranking's answer (next test) is unchanged.
  const { response, body } = await get("/api/rankings/level?season=2025/2026");
  assert.equal(response.status, 200);
  assert.deepEqual([body.season, body.universe, body.position, body.page, body.limit, body.total], ["2025/2026", "men", null, 1, 50, 3]);
  assert.deepEqual(body.method, { version: "score-vega-v9", computedAt: "2025-09-06T03:05:00.000Z" });
  assert.deepEqual(body.rows.map((r) => [r.rank, r.positionRank, r.playerId, r.position, r.positionKey, r.score, r.level]), [
    [1, 1, "p_aaaab1", "Avant-centre", "centre_forward", 79.7, 21.4], [2, 1, "p_aaaab4", "Milieu offensif", "attacking_midfielder", 50, 0],
    [3, 1, "p_aaaab3", "Gardien", "goalkeeper", 40.5, -6],
  ]);
  assert.deepEqual(Object.keys(body.rows[0]), ["rank", "positionRank", "playerId", "name", "imageUrl", "teamId", "team", "teamImageUrl", "position", "positionKey",
    "score", "level", "own", "club", "minutes", "provisional", "provisionalReason"]);
  // The level is what he does (his blocks and his starts) and his club: the parts are served with it.
  assert.deepEqual([body.rows[0].own, body.rows[0].club, body.rows[0].minutes, body.rows[0].provisionalReason], [14.2, 7.2, 260, null]);
  assert.deepEqual([body.rows[2].provisional, body.rows[2].provisionalReason], [true, "minutes"]);
  // One position, a page at a time.
  const tens = (await get("/api/rankings/level?season=2025/2026&position=attacking_midfielder")).body;
  assert.deepEqual([tens.position, tens.total, tens.rows.map((r) => r.playerId)], ["attacking_midfielder", 1, ["p_aaaab4"]]);
  const second = (await get("/api/rankings/level?season=2025/2026&limit=2&page=2")).body;
  assert.deepEqual([second.page, second.limit, second.total, second.rows.map((r) => r.rank)], [2, 2, 3, [3]]);
  assert.equal((await get("/api/rankings/level?season=2025/2026&universe=women")).response.status, 404);
  assert.equal((await get("/api/rankings/level?season=2024/2025")).response.status, 404);
  for (const bad of ["", "?season=2025", "?season=2025/2026&position=striker", "?season=2025/2026&universe=all", "?season=2025/2026&limit=0",
    "?season=2025/2026&page=0", "?season=2025/2026&kind=players"])
    assert.equal((await get("/api/rankings/level" + bad)).response.status, 400, bad);
  // One player's level, for his page: its parts, and each position he played, judged or not.
  const own = (await get("/api/rankings/level/player?season=2025/2026&player=p_aaaab1")).body;
  assert.deepEqual([own.season, own.method.version], ["2025/2026", "score-vega-v9"]);
  assert.deepEqual(own.player, {
    id: "p_aaaab1", rank: 1, positionRank: 1, position: "Avant-centre", positionKey: "centre_forward", score: 79.7, level: 21.4, own: 14.2, blocks: 11,
    starts: 3.2, club: 7.2, startShare: 0.9, minutes: 260, universe: "men", eligible: true, linked: true, provisional: false, provisionalReason: null,
    positions: [
      { position: "Avant-centre", positionKey: "centre_forward", judged: true, minutes: 200, minutesTwoSeasons: 2600, share: 1, value: 13.5, level: 21.4,
        talents: { finishing: 1.25, creation: 0.4, progression: 0.1, defence: -0.3, retention: 0.2 } },
      { position: "Ailier", positionKey: "winger", judged: false, minutes: 60, minutesTwoSeasons: 60, share: null, value: null, level: null, talents: null },
    ],
  });
  const keeper = (await get("/api/rankings/level/player?season=2025/2026&player=p_aaaab3")).body.player;
  assert.deepEqual([keeper.position, keeper.provisionalReason, keeper.positions[0].talents], ["Gardien", "minutes", null]);
  assert.equal((await get("/api/rankings/level/player?season=2025/2026&player=p_aaaab2")).response.status, 404);
  assert.equal((await get("/api/rankings/level/player?season=2025/2026&player=aaaab1")).response.status, 400);
  assert.equal((await get("/api/rankings/level/player?season=2025/2026")).response.status, 400);
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
  // The four Ligue 1 clubs, and the four clubs of the German cup's sample (one Elo for every match,
  // VI-21): a club no PitchAPI league holds is ranked too, from its country's cup clubs' level.
  assert.equal(clubs.rows.length, 8);
  assert.deepEqual(clubs.rows.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(clubs.rows.every((r, i) => !i || clubs.rows[i - 1].elo >= r.elo));
  const league = clubs.rows.filter((r) => /^t_aaaaa\d$/.test(r.teamId));
  assert.equal(league.length, 4);
  assert.equal(Math.round(league.reduce((s, r) => s + r.elo, 0)), 6000); // Elo moves points between clubs only: the cup clubs met each other
  for (const r of clubs.rows) {
    assert.equal(r.wins + r.draws + r.losses, r.matches);
    assert.equal(Math.round(r.eloStart + r.eloChange), Math.round(r.elo));
  }
  assert.equal(Math.round(league.reduce((s, r) => s + r.results, 0) * 2), 10); // five matches, one point shared each
  assert.equal(Math.round(clubs.rows.filter((r) => !league.includes(r)).reduce((s, r) => s + r.results, 0) * 2), 4); // the cup's two matches
  // A club's score out of 100: its expected score against the scale's reference, in the Elo's order.
  assert.ok(Number.isFinite(clubs.reference));
  for (const r of clubs.rows) assert.ok(Math.abs(r.score - 100 / (1 + 10 ** (-(r.elo - clubs.reference) / 400))) <= 0.11);
  assert.ok(clubs.rows.every((r, i) => !i || clubs.rows[i - 1].score >= r.score));
  // The league strength index: every men's league ranked by its level, a provisional one with its margin, the level of each season.
  const levels = (await get("/api/rankings/leagues")).body;
  assert.equal(levels.method.version, "power-ranking-v8");
  assert.ok(levels.leagues.length >= 1);
  for (const league of levels.leagues) {
    assert.match(league.id, /^l_/);
    assert.equal(league.rank === null, league.universe !== "men");
    assert.equal(league.provisional, league.universe === "men" && !league.onScale);
    assert.ok(league.universe !== "men" || Number.isInteger(league.margin));
    assert.ok(league.seasons.every((s) => /^\d{4}\/\d{4}$/.test(s.season) && Number.isFinite(s.level) && s.teams > 0));
    // Out of 100 against the reference (men only), and what the level rests on.
    if (league.universe === "men") assert.ok(Math.abs(league.score - 100 / (1 + 10 ** (-(league.level - levels.reference) / 400))) <= 0.11);
    else assert.equal(league.score, null);
    assert.equal(league.evidence.matches, league.links);
  }
  const men = levels.leagues.filter((l) => l.universe === "men");
  assert.deepEqual(men.map((l) => l.rank), men.map((_, i) => i + 1));
  assert.equal(levels.ranked, men.length);
  assert.equal(levels.onScale, levels.leagues.filter((l) => l.onScale).length);
  assert.ok(levels.leagues.some((l) => l.seasons.length > 0));
  assert.equal((await get("/api/rankings/leagues?season=2025/2026")).response.status, 400);
  // One player's ranking, for his page: the object of the player reads and the ranked players of his role.
  const own = (await get("/api/rankings/power/player?season=2025/2026&player=p_aaaab1")).body;
  assert.deepEqual([own.season, own.player.id, own.player.score, own.player.role, own.player.position, own.player.roleRank, own.player.roleCount],
    ["2025/2026", "p_aaaab1", 87.5, "centre_forward", "Avant-centre", 1, 1]);
  assert.deepEqual(own.player.blocks.finishing, { contribution: 3.1, percentile: 95 });
  assert.deepEqual([own.player.universe, own.player.provisionalReason], ["men", null]);
  assert.equal((await get("/api/rankings/power/player?season=2025/2026&player=p_zzzzz9")).response.status, 404);
  // A season the player is not ranked in (the seed ranks only p_aaaab1 in 2024/2025, for his rate over two seasons).
  assert.equal((await get("/api/rankings/power/player?season=2024/2025&player=p_aaaab4")).response.status, 404);
  assert.equal((await get("/api/rankings/power/player?season=2025/2026&player=aaaab1")).response.status, 400);
  // His Vega score season by season, oldest first (the player page's index history).
  const history = (await get("/api/rankings/power/history?player=p_aaaab1")).body;
  assert.equal(history.id, "p_aaaab1");
  assert.deepEqual(history.seasons.map((r) => r.season), [...history.seasons.map((r) => r.season)].sort());
  assert.deepEqual(Object.keys(history.seasons.at(-1)), ["season", "score", "rank", "roleRank", "position", "team", "minutes", "matches", "provisional"]);
  assert.deepEqual([history.seasons.at(-1).season, history.seasons.at(-1).score, history.seasons.at(-1).position], ["2025/2026", 87.5, "Avant-centre"]);
  assert.equal((await get("/api/rankings/power/history?player=p_zzzzz9")).response.status, 404);
  assert.equal((await get("/api/rankings/power/history?player=aaaab1")).response.status, 400);
  assert.equal((await get("/api/rankings/power/history")).response.status, 400);
  assert.equal((await get("/api/rankings/power/history?player=p_aaaab1&season=2025/2026")).response.status, 400);
  // A match's grades: how exceptional for his role, whatever his season; ranked among those shown.
  const graded = (await get("/api/rankings/match?match=m_aaaaa1")).body;
  assert.deepEqual(graded.grades.map((g) => [g.playerId, g.minutes, g.grade, g.rank]), [
    ["p_aaaab1", 90, 80.8, 1], ["p_aaaab4", 70, 50, 2], ["p_aaaab2", 90, 29.7, 3], ["p_aaaab3", 10, null, null],
  ]);
  // Each grade carries the player's appearance, for a match the source rated no one in.
  const best = graded.grades[0];
  assert.deepEqual([best.name, best.imageUrl, best.team, best.goals], ["Élie Durand", "https://img.example/p1.png", "Olympique Été", 2]);
  assert.equal((await get("/api/rankings/match?match=m_aaaaa6")).response.status, 404);
  assert.equal((await get("/api/rankings/match?match=aaaaa1")).response.status, 400);
  assert.equal((await get("/api/rankings/match?match=m_aaaaa1&x=1")).response.status, 400);
  assert.equal((await get("/api/rankings/power/player?season=2025/2026")).response.status, 400);
  assert.equal((await get("/api/rankings/power?kind=players&season=2025/2026&limit=1")).body.rows.length, 1);
  // A league's matchweeks: in order, the latest closed one; a closed round's Team of the Round and the race after it.
  const weeks = (await get("/api/rankings/rounds?competition=l_3FJFUl&season=2025/2026")).body;
  assert.deepEqual([weeks.latest, weeks.rounds.map((r) => [r.key, r.status, r.played])], ["r1", [["r1", "closed", 2], ["w2025-09-02", "open", 1]]]);
  const latest = (await get("/api/rankings/round?competition=l_3FJFUl&season=2025/2026")).body;
  assert.deepEqual([latest.round.key, latest.team.formation, latest.team.players.map((p) => [p.slot, p.slotRole, p.playerId, p.grade])],
    ["r1", "4-3-3", [[0, "GK", "p_aaaab3", 58.5], [10, "CF", "p_aaaab1", 80.8]]]);
  assert.deepEqual(latest.race.map((r) => [r.rank, r.playerId, r.name, r.grade]), [[1, "p_aaaab1", "Élie Durand", 62.7], [2, "p_aaaab4", "Cristiano Test", 57.1]]);
  // The card's race (the first ten) and how many the whole race holds; race=all serves it whole (VI-44).
  assert.equal(latest.raceTotal, 2);
  const wholeRace = (await get("/api/rankings/round?competition=l_3FJFUl&season=2025/2026&round=r1&race=all")).body;
  assert.deepEqual([wholeRace.raceTotal, wholeRace.race.map((r) => [r.rank, r.playerId, r.grade, r.minutes])], [2, [[1, "p_aaaab1", 62.7, 260], [2, "p_aaaab4", 57.1, 160]]]);
  assert.deepEqual(wholeRace.team, latest.team);
  assert.equal((await get("/api/rankings/round?competition=l_3FJFUl&season=2025/2026&race=10")).response.status, 400);
  assert.equal((await get("/api/rankings/round?competition=l_3FJFUl&season=2025/2026&race=")).response.status, 400);
  assert.equal((await get("/api/rankings/round?competition=l_3FJFUl&season=2025/2026&round=w2025-09-02")).response.status, 404); // still open
  assert.equal((await get("/api/rankings/round?competition=l_3FJFUl&season=2025/2026&round=x1")).response.status, 400);
  assert.equal((await get("/api/rankings/rounds?competition=l_3FJFUl&season=2024/2025")).response.status, 404);
  // A coming match's odds: each bookmaker (its opening line, its margin), the market's consensus, the best prices, Vega's forecast and fair odds.
  const odds = (await get("/api/forecasts/odds?match=m_aaaaa6")).body;
  assert.deepEqual(odds.bookmakers.map((b) => [b.name, b.home, b.draw, b.away, b.opening.home]), [["Betclic", 2, 3.4, 3.5, 2.1], ["Winamax", 1.95, 3.35, 3.6, 1.95]]);
  const chances = (h, d, a) => [1 / h, 1 / d, 1 / a].map((x, _, all) => x / all.reduce((s, y) => s + y, 0));
  const [bh] = chances(2, 3.4, 3.5), [wh] = chances(1.95, 3.35, 3.6);
  assert.ok(Math.abs(odds.market.home - (bh + wh) / 2) < 1e-4);
  assert.deepEqual(odds.best, { home: 2, draw: 3.4, away: 3.6 });
  assert.ok(Math.abs(odds.bookmakers[0].margin - (1 / 2 + 1 / 3.4 + 1 / 3.5 - 1)) < 1e-4);
  assert.deepEqual([odds.vega.home, odds.vega.fair.home], [0.5123, 1.95]);
  assert.equal((await get("/api/forecasts/odds?match=m_aaaaa1")).response.status, 404);
  assert.equal((await get("/api/forecasts/odds?match=x")).response.status, 400);
  // What became of a league's clubs: none for an edition the base holds no next season of.
  assert.deepEqual((await get("/api/rankings/fates?competition=l_3FJFUl&season=2025/2026")).body.teams, {});
  assert.equal((await get("/api/rankings/fates?competition=l_3FJFUl&season=1999/2000")).response.status, 404);
  // The whole ranking (the Power Ranking page): every ranked player of the universe, a page at a time, by role if asked.
  const whole = (await get("/api/rankings/power?kind=players&season=2025/2026&scope=all&limit=1")).body;
  assert.deepEqual([whole.total, whole.page, whole.universe, whole.rows.map((r) => [r.rank, r.playerId, r.provisionalReason])], [2, 1, "men", [[1, "p_aaaab1", null]]]);
  assert.deepEqual((await get("/api/rankings/power?kind=players&season=2025/2026&scope=all&limit=1&page=2")).body.rows.map((r) => r.playerId), ["p_aaaab4"]);
  const wingers = (await get("/api/rankings/power?kind=players&season=2025/2026&scope=all&role=winger")).body;
  assert.deepEqual([wingers.total, wingers.rows.map((r) => [r.playerId, r.roleRank])], [1, [["p_aaaab4", 1]]]);
  assert.equal((await get("/api/rankings/power?kind=players&season=2025/2026&scope=all&universe=women")).response.status, 404);
  assert.equal((await get("/api/rankings/power?kind=players&season=2025/2026&scope=all&role=striker")).response.status, 400);
  assert.equal((await get("/api/rankings/power?kind=players&season=2025/2026&page=2")).response.status, 400);
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
  const { forecast, model, lineups } = found[0].body;
  assert.deepEqual(forecast, { home: 0.5123, draw: 0.2501, away: 0.2376, homeGoals: 1.62, awayGoals: 1.04, score: [1, 0] });
  // Both elevens confirmed: the forecast that read them, and what each eleven is against its club's usual one
  // (a deviation in rate units, and the Elo points it moves the side by).
  assert.deepEqual(lineups, {
    forecast: { home: 0.5642, draw: 0.2389, away: 0.1969, homeGoals: 1.74, awayGoals: 0.97, score: [2, 0] },
    home: { deviation: 0.31, elo: 13.9 }, away: { deviation: -0.72, elo: -32.3 }, computedAt: "2025-09-06T11:10:00.000Z",
  });
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

test("a finished match minute by minute", { skip }, async () => {
  const { body } = await get("/api/forecasts/live?match=m_aaaaa1");
  assert.deepEqual([body.match, body.status, body.model.version, body.model.matches], ["m_aaaaa1", "finished", "inplay-v1", 16000]);
  assert.equal(body.points.length, 91);
  const at = (minute) => body.points[minute];
  // Kick-off: the three shares add up to 1; the home side's rises with each of its goals (11', 21').
  assert.ok(Math.abs(at(0).home + at(0).draw + at(0).away - 1) < 2e-4);
  assert.deepEqual([at(10).score, at(11).score, at(21).score], [[0, 0], [1, 0], [2, 0]]);
  assert.ok(at(11).home > at(10).home && at(21).home > at(20).home);
  // The 90th minute is the result.
  assert.deepEqual([at(90).home, at(90).draw, at(90).away, at(90).score], [1, 0, 0, [2, 0]]);
  assert.deepEqual(body.events.filter((e) => e.kind === "goal").map((e) => [e.minute, e.side]), [[11, "home"], [21, "home"]]);
  assert.ok(body.rates.home > 0 && body.rates.away > 0);
  // Its two line-ups were read before it: the timeline starts from the forecast that read them.
  assert.equal(body.lineups, true);
  // The model the points were drawn with, for the site to carry on with a live feed.
  assert.deepEqual(Object.keys(body.inplay), ["profile", "down", "up", "ahead", "behind"]);
  assert.equal(body.inplay.profile.length, 7);
  assert.equal(typeof body.rho, "number");
  // A match the base has not read yet: its kick-off point only, and the same model.
  const ahead = (await get("/api/forecasts/live?match=m_aaaaa6")).body;
  assert.deepEqual([ahead.status, ahead.points.length, ahead.points[0].minute, ahead.points[0].score], ["not_started", 1, 0, [0, 0]]);
  assert.ok(Math.abs(ahead.points[0].home + ahead.points[0].draw + ahead.points[0].away - 1) < 2e-4);
  assert.deepEqual(ahead.inplay, body.inplay);
  // An unknown match, a malformed id.
  assert.equal((await get("/api/forecasts/live?match=m_zzzzzz")).response.status, 404);
  assert.equal((await get("/api/forecasts/live?match=1")).response.status, 400);
});

// Extra time (issue #68). Failure modes and expected outcomes, written before the code:
// - a finished match level at the 90th and decided in extra time (m_xtime1, 0-0 then 1-0 at 112'): `extraTime`, points to
//   the 120th, the extra-time goal counted at its minute, the 120th point the result (1, 0, 0), `penalties` null;
// - decided on penalties (m_shoot1, 1-1, 4-3): points to the 120th, the 120th point a draw (0, 1, 0), `penalties` [4, 3];
// - penalties stated without an extra-time score (m_shoot2, 2-2 with a goal at 90+3 and one at 101', 5-4): extra time all
//   the same; the 90+3 goal stays in regulation (score 2-1 at the 90th), the 101st's counts at the 101st;
// - goal events that do not add up to the final score (extra time included): no timeline (404), the route's check as
//   before (not seeded here);
// - a match without extra time (m_aaaaa1): unchanged, no `extraTime` or `penalties` key;
// - in play with a clock past the 90th and nothing in the base saying extra time (m_live91, clock 100): it stops at the
//   90th as before; extra time in play is the live feed's to say (its period), the site carrying the model on.
test("a match that went to extra time, minute by minute", { skip }, async () => {
  const live = async (id) => (await get(`/api/forecasts/live?match=${id}`)).body;
  const three = (p) => [p.home, p.draw, p.away];
  const decided = await live("m_xtime1");
  assert.deepEqual([decided.status, decided.extraTime, decided.penalties, decided.points.length, decided.points.at(-1).minute], ["finished", true, null, 121, 120]);
  assert.deepEqual([decided.points[90].score, decided.points[111].score, decided.points[112].score], [[0, 0], [0, 0], [1, 0]]);
  assert.ok(decided.points[112].home > decided.points[111].home);
  assert.deepEqual(three(decided.points[120]), [1, 0, 0]);
  // The first 91 points are the regulation timeline's: the 90th is not forced to a result.
  assert.ok(decided.points[90].draw > 0 && decided.points[90].draw < 1);
  const shoot = await live("m_shoot1");
  assert.deepEqual([shoot.extraTime, shoot.penalties, shoot.points.length, shoot.points[120].score], [true, [4, 3], 121, [1, 1]]);
  assert.deepEqual(three(shoot.points[120]), [0, 1, 0]);
  const stated = await live("m_shoot2");
  assert.deepEqual([stated.extraTime, stated.penalties, stated.points.length], [true, [5, 4], 121]);
  assert.deepEqual([stated.points[89].score, stated.points[90].score, stated.points[100].score, stated.points[101].score], [[1, 1], [1, 2], [1, 2], [2, 2]]);
  assert.deepEqual(three(stated.points[120]), [0, 1, 0]);
  const plain = await live("m_aaaaa1");
  assert.deepEqual([plain.points.length, "extraTime" in plain, "penalties" in plain], [91, false, false]);
  const inPlay = await live("m_live91");
  assert.deepEqual([inPlay.status, inPlay.points.length, "extraTime" in inPlay, inPlay.points[90].score], ["in_play", 91, false, [1, 1]]);
});

test("the season's breakouts, and a player's own flag", { skip }, async () => {
  const { body } = await get("/api/rankings/breakouts?season=2025/2026");
  assert.deepEqual([body.season, body.candidates, body.flagged, body.rows.length], ["2025/2026", 12, 1, 1]);
  const [row] = body.rows;
  assert.deepEqual([row.rank, row.playerId, row.name, row.teamId, row.minutes, row.percentile, row.regulars, row.role], [1, "p_aaaab3", "Hugo Sud", "t_aaaaa4", 180, 91.3, 40, "goalkeeper"]);
  assert.equal(typeof row.position, "string");
  // The flagged player has no ranking of his own (below its minutes): his page still learns he is flagged.
  const flagged = (await get("/api/rankings/power/player?season=2025/2026&player=p_aaaab3")).body.player;
  assert.deepEqual([flagged.id, flagged.breakout.percentile, flagged.breakout.minutes, flagged.score], ["p_aaaab3", 91.3, 180, undefined]);
  // A ranked player is not a breakout.
  assert.equal((await get("/api/rankings/power/player?season=2025/2026&player=p_aaaab1")).body.player.breakout, null);
  assert.equal((await get("/api/rankings/breakouts?season=2024/2025")).response.status, 404);
  assert.equal((await get("/api/rankings/breakouts")).response.status, 400);
});

test("why a rank is provisional: the minutes first, then a team the base knows in no league", () => {
  assert.equal(provisionalReason({ eligible: false, linked: false }), "minutes");
  assert.equal(provisionalReason({ eligible: true, linked: true }), null);
  assert.equal(provisionalReason({ eligible: true, linked: false, team_is_national: true, in_league: false }), "national");
  assert.equal(provisionalReason({ eligible: true, linked: false, team_is_national: false, in_league: false }), "no_league");
  assert.equal(provisionalReason({ eligible: true, linked: false, in_league: true }), "league");
  // The women are ranked among themselves: no league of theirs is on the men's scale.
  assert.equal(provisionalReason({ eligible: true, linked: false, universe: "women", in_league: true }), null);
  assert.equal(provisionalReason({ eligible: false, linked: false, universe: "women" }), "minutes");
});

// A UEFA cup's projection (122): each club's share of every stage, 0 for a stage it never
// reaches; a league has none.
test("a cup's stages per club, every stage given", () => {
  const stages = cupStages([
    { team_key: 1, stage: "top8", probability: 0.9512 }, { team_key: 1, stage: "win", probability: 0.12 },
    { team_key: 2, stage: "out", probability: 1 },
  ]);
  // The Nations League's transitional season (126): stay, play-off, down, up, and its league in 2028–29.
  const none = { first: 0, second: 0, third: 0, fourth: 0, stay: 0, barrage: 0, relegated: 0, promoted: 0, next_a: 0, next_b: 0, next_c: 0 };
  assert.deepEqual(stages.get(1), { top8: 0.9512, playoff: 0, out: 0, ...none, r64: 0, r32: 0, r16: 0, qf: 0, sf: 0, final: 0, win: 0.12 });
  assert.deepEqual(stages.get(2), { top8: 0, playoff: 0, out: 1, ...none, r64: 0, r32: 0, r16: 0, qf: 0, sf: 0, final: 0, win: 0 });
  assert.equal(cupStages([]).size, 0);
});

test("a cup's format, and each club's opponent of the round in play", () => {
  // A UEFA cup's league phase has its three outcomes; a domestic knockout cup only its rounds (VI-19, 124).
  assert.equal(cupFormat(cupStages([{ team_key: 1, stage: "top8", probability: 0.9 }])), "league-phase");
  assert.equal(cupFormat(cupStages([{ team_key: 1, stage: "r16", probability: 1 }, { team_key: 1, stage: "win", probability: 0.5 }])), "knockout");
  assert.equal(cupFormat(new Map()), null);
  // The Nations League (125): each nation's places in its group, League A's knockout after.
  assert.equal(cupFormat(cupStages([{ team_key: 1, stage: "first", probability: 0.8 }, { team_key: 1, stage: "win", probability: 0.2 }])), "nations");
  const nation = cupStages([{ team_key: 3, stage: "second", probability: 1 }, { team_key: 3, stage: "barrage", probability: 1 }, { team_key: 3, stage: "next_a", probability: 0.4 }, { team_key: 3, stage: "next_b", probability: 0.6 }]);
  assert.equal(cupFormat(nation), "nations");
  assert.deepEqual([nation.get(3).barrage, nation.get(3).next_a, nation.get(3).next_b, nation.get(3).playoff], [1, 0.4, 0.6, 0]);
  assert.deepEqual([...groupsByTeam([{ team_key: 1, group_name: "1" }, { team_key: 7, group_name: "B2" }])], [[1, "1"], [7, "B2"]]);
  // The opponent of the round's first match still to play (a two-legged tie has two rows); at home or away.
  const rows = [
    { team_key: 1, day: "2026-12-21", opponent_id: "t_aaaaa2", opponent_name: "B", opponent_image: null, home: false },
    { team_key: 1, day: "2026-12-01", opponent_id: "t_aaaaa2", opponent_name: "B", opponent_image: "b.png", home: true },
    { team_key: 3, day: "2026-12-02", opponent_id: "t_aaaaa4", opponent_name: "D", opponent_image: null, home: false },
  ];
  const opponents = roundOpponents(rows);
  assert.deepEqual(opponents.get(1), { id: "t_aaaaa2", name: "B", imageUrl: "b.png", home: true });
  assert.deepEqual(opponents.get(3), { id: "t_aaaaa4", name: "D", imageUrl: null, home: false });
  assert.equal(roundOpponents([]).size, 0);
  // Each club's Elo, its latest season's (the read gives one row per club, newest first), rounded.
  assert.deepEqual([...levelsByTeam([{ team_key: 1, elo: 2011.4 }, { team_key: 3, elo: 1497.6 }])], [[1, 2011], [3, 1498]]);
});

test("a round's race: the card's first ten by default, the whole race when asked, nothing else (VI-44)", () => {
  assert.equal(RACE_CARD, 10);
  const rows = Array.from({ length: 23 }, (_, i) => ({ rank: i + 1 }));
  assert.deepEqual([roundRace(rows, null).rows.length, roundRace(rows, null).total, roundRace(rows, null).rows.at(-1).rank], [10, 23, 10]);
  assert.deepEqual([roundRace(rows, "all").rows.length, roundRace(rows, "all").total], [23, 23]);
  assert.deepEqual(roundRace([], null), { rows: [], total: 0 });
  for (const bad of ["", "ALL", "20", "all "]) assert.throws(() => roundRace(rows, bad), (error) => error.status === 400);
});
