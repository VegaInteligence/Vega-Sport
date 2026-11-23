// GET /api/nations and /api/nations/{id} (119): the national teams and one nation's page.
//
// Written before the route (AGENTS.md). What the two pure reads must do:
// - tournamentRuns: one entry per edition of a major tournament (World Cup, Euro, Africa Cup of
//   Nations…) the nation played, its stage reached read from its last match of the edition:
//   - a final won → « Vainqueur », lost → « Finaliste », a final with no score → « Finale » (the
//     base does not know who won; never claim a title it does not hold);
//   - a level score settled on penalties is won or lost on the penalties;
//   - a third-place match won → « 3e », lost → « 4e », no score → « Match 3e place »;
//   - otherwise the round of the last match: « Demi », « Quarts », « 8es », « 16es », else « 1er tour »;
//   - round names come in English, French or as fractions (« Semi-final », « 1/2 », « bronze »);
//   - an edition held twice (a collected World Cup and the same edition in the history archive)
//     counts once; competitions that are not major tournaments (Nations League) are left out.
// - seasonRecord: the nation's played matches of a season (finished, with a score): wins, draws,
//   losses, goals for and against; a match without a score is not played for the record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";
import { placeholderTeam, seasonRecord, tournamentRuns } from "../src/routes/nations.mjs";

const FR = "t_fr", m = (over) => ({
  date: "2026-06-16", competition: "World Cup", edition: null, round: "1", season: "2025/2026", status: "finished",
  home: { id: FR, name: "France" }, away: { id: "t_x", name: "X" }, homeScore: 1, awayScore: 0,
  homePenalties: null, awayPenalties: null, ...over,
});

test("a tournament's stage is read from the nation's last match of the edition", () => {
  const runs = tournamentRuns([
    // World Cup 2026, collected and archived: one edition, ended on a lost third-place match.
    m({ date: "2026-07-14", round: "1/2", homeScore: 0, awayScore: 2 }),
    m({ date: "2026-07-18", round: "bronze", homeScore: 4, awayScore: 6 }),
    m({ date: "2026-07-18", competition: "World Cup 1930", edition: "open-cups:world-cup-history:2026", round: "Match for third place", homeScore: 4, awayScore: 6 }),
    // 2018: a final won; 1998: a final with no score; 2006: a final lost on penalties.
    m({ date: "2018-07-15", competition: "World Cup 1930", edition: "open-cups:world-cup-history:2018", round: "Final", homeScore: 4, awayScore: 2 }),
    m({ date: "1998-07-12", competition: "World Cup 1930", edition: "open-cups:world-cup-history:1998", round: "Final",
      home: { id: "t_br", name: "Brazil" }, away: { id: FR, name: "France" }, homeScore: null, awayScore: null }),
    m({ date: "2006-07-09", competition: "World Cup 1930", edition: "open-cups:world-cup-history:2006", round: "Final",
      home: { id: "t_it", name: "Italy" }, away: { id: FR, name: "France" }, homeScore: 1, awayScore: 1, homePenalties: 5, awayPenalties: 3 }),
    // 1986: a third-place match won; 1958: one with no score; 2014: out in the quarter-finals.
    m({ date: "1986-06-28", competition: "World Cup 1930", edition: "open-cups:world-cup-history:1986", round: "Third place match", homeScore: 4, awayScore: 2 }),
    m({ date: "1958-06-28", competition: "World Cup 1930", edition: "open-cups:world-cup-history:1958", round: "Match for third place",
      home: { id: "t_de", name: "West Germany" }, away: { id: FR, name: "France" }, homeScore: null, awayScore: null }),
    m({ date: "2014-07-04", competition: "World Cup 1930", edition: "open-cups:world-cup-history:2014", round: "Quarter-finals", homeScore: 0, awayScore: 1 }),
    // Euro 2020 (played in 2021): out in the round of 16 on penalties, after a won group match.
    m({ date: "2021-06-15", competition: "Euro 2021", edition: "open-cups:euro:2020", round: "Matchday 1", homeScore: 1, awayScore: 0 }),
    m({ date: "2021-06-28", competition: "Euro 2021", edition: "open-cups:euro:2020", round: "Round of 16", homeScore: 3, awayScore: 3, homePenalties: 4, awayPenalties: 5 }),
    // 2010: out in the group; the Nations League is no major tournament.
    m({ date: "2010-06-22", competition: "World Cup 1930", edition: "open-cups:world-cup-history:2010", round: "Matchday 12", homeScore: 1, awayScore: 2 }),
    m({ date: "2026-11-15", competition: "nations-league", edition: "openligadb:nations-league:2026/2027", round: "Groupe 1" }),
  ], FR);
  assert.deepEqual(
    runs.map((r) => [r.tournament, r.year, r.stage, r.tone ?? null]),
    [
      ["world-cup", 1958, "Match 3e place", null],
      ["world-cup", 1986, "3e", "bronze"],
      ["world-cup", 1998, "Finale", null],
      ["world-cup", 2006, "Finaliste", "silver"],
      ["world-cup", 2010, "1er tour", null],
      ["world-cup", 2014, "Quarts", null],
      ["world-cup", 2018, "Vainqueur", "gold"],
      ["euro", 2020, "8es", null],
      ["world-cup", 2026, "4e", null],
    ],
  );
  assert.equal(runs.find((r) => r.year === 2026).matches, 2);
  assert.equal(runs.find((r) => r.year === 2020).label, "Euro 2020");
  assert.equal(runs.find((r) => r.year === 2018).label, "Coupe du monde 2018");
});

// VI-27 B (docs/calculs/09-audit-2026-11/FAILURE_MODES.md §34, written before the code):
// - 34q, 34r: a last match without a round (International Results' tournaments) or with a round the reader does not
//   know is « Phase non renseignée », with no tone: never « 1er tour », never a title from the last win;
// - the group rounds stay « 1er tour »: the collected source's day numbers, « Matchday N », « Group 2 Play-off »,
//   « First round » (1950's groups, 1938's first round), « Preliminary round » (1934);
// - 34s: a 1950 final-pool run takes its placing from the attested table only when the nation's three matches are
//   the table's (each opponent once, each score as attested): « Vainqueur » gold, « 2e » silver, « 3e » bronze, « 4e »;
// - 34t–34v: Sweden twice and no Brazil, or other results to the same five points, or a match without its score:
//   « Poule finale », no tone.
const pool = (date, home, away, homeScore, awayScore) => m({
  date, competition: "World Cup 1930", edition: "open-cups:world-cup-history:1950", round: "Final Round", season: "1949/1950",
  home: { id: `t_${home.slice(0, 2).toLowerCase()}`, name: home }, away: { id: `t_${away.slice(0, 2).toLowerCase()}`, name: away },
  homeScore, awayScore,
});
const POOL = [
  pool("1950-07-09", "Uruguay", "Spain", 2, 2), pool("1950-07-09", "Brazil", "Sweden", 7, 1), pool("1950-07-13", "Brazil", "Spain", 6, 1),
  pool("1950-07-13", "Uruguay", "Sweden", 3, 2), pool("1950-07-16", "Sweden", "Spain", 3, 1), pool("1950-07-16", "Uruguay", "Brazil", 2, 1),
];
const own = (id) => POOL.filter((x) => x.home.id === id || x.away.id === id);
const stageOf = (matches, id) => tournamentRuns(matches, id).map((r) => [r.tournament, r.year, r.stage, r.tone ?? null, r.matches]);

test("34q, 34r. a last match without a round, or with one the reader does not know, has no phase", () => {
  const copa = (date, round) => m({ date, competition: "Copa América 2024", edition: "nations-results:copa-america:2024", round, season: "2023/2024",
    home: { id: "t_ar", name: "Argentina" }, away: { id: "t_co", name: "Colombia" }, homeScore: 1, awayScore: 0 });
  assert.deepEqual(stageOf([copa("2024-06-20", null), copa("2024-07-14", null)], "t_ar"), [["copa-america", 2024, "Phase non renseignée", null, 2]]);
  assert.deepEqual(stageOf([copa("2024-07-14", "")], "t_ar"), [["copa-america", 2024, "Phase non renseignée", null, 1]]);
  assert.deepEqual(stageOf([copa("2024-07-14", "Knockout stage")], "t_ar"), [["copa-america", 2024, "Phase non renseignée", null, 1]]);
  const group = (edition, round) => m({ date: "1954-06-23", competition: "World Cup 1930", edition, round, homeScore: 2, awayScore: 7 });
  for (const [edition, round] of [["open-cups:world-cup-history:1954", "Group 2 Play-off"], ["open-cups:world-cup-history:1950", "First round"],
    ["open-cups:world-cup-history:1934", "Preliminary round"], ["open-cups:world-cup-history:2010", "Matchday 12"], [null, "2"]])
    assert.equal(tournamentRuns([group(edition, round)], FR)[0].stage, "1er tour", round);
});

test("34s–34v. 1950's final pool: the attested placing, only on the nation's three attested matches", () => {
  assert.deepEqual(stageOf(own("t_ur"), "t_ur"), [["world-cup", 1950, "Vainqueur", "gold", 3]]);
  assert.deepEqual(stageOf(own("t_br"), "t_br"), [["world-cup", 1950, "2e", "silver", 3]]);
  assert.deepEqual(stageOf(own("t_sw"), "t_sw"), [["world-cup", 1950, "3e", "bronze", 3]]);
  assert.deepEqual(stageOf(own("t_sp"), "t_sp"), [["world-cup", 1950, "4e", null, 3]]);
  // Sweden twice and no Brazil: still five points, not the table's matches.
  const twice = [pool("1950-07-09", "Uruguay", "Spain", 2, 2), pool("1950-07-13", "Uruguay", "Sweden", 3, 2), pool("1950-07-16", "Uruguay", "Sweden", 3, 2)];
  assert.deepEqual(stageOf(twice, "t_ur"), [["world-cup", 1950, "Poule finale", null, 3]]);
  // Other results to the same five points.
  const other = [pool("1950-07-09", "Uruguay", "Spain", 3, 2), pool("1950-07-13", "Uruguay", "Sweden", 3, 2), pool("1950-07-16", "Uruguay", "Brazil", 1, 1)];
  assert.deepEqual(stageOf(other, "t_ur"), [["world-cup", 1950, "Poule finale", null, 3]]);
  // The last day without its score (an older base).
  const unscored = own("t_ur").map((x) => (x.away.name === "Brazil" ? { ...x, homeScore: null, awayScore: null } : x));
  assert.deepEqual(stageOf(unscored, "t_ur"), [["world-cup", 1950, "Poule finale", null, 3]]);
  // A team the table does not name.
  const renamed = own("t_ur").map((x) => (x.home.id === "t_ur" ? { ...x, home: { id: "t_ur", name: "Uruguay U23" } } : x));
  assert.deepEqual(stageOf(renamed, "t_ur"), [["world-cup", 1950, "Poule finale", null, 3]]);
});

test("a season's record counts the played matches with a score", () => {
  const record = seasonRecord([
    m({ season: "2026/2027", date: "2026-11-15", homeScore: 2, awayScore: 1 }),
    m({ season: "2026/2027", date: "2026-11-12", home: { id: "t_it", name: "Italie" }, away: { id: FR, name: "France" }, homeScore: 3, awayScore: 1 }),
    m({ season: "2026/2027", date: "2026-10-02", homeScore: 1, awayScore: 1 }),
    m({ season: "2026/2027", date: "2027-03-20", status: "not_started", homeScore: null, awayScore: null }),
    m({ season: "2025/2026", date: "2026-07-18", homeScore: 4, awayScore: 6 }),
  ], FR, "2026/2027");
  assert.deepEqual(record, { played: 3, wins: 1, draws: 1, losses: 1, goalsFor: 4, goalsAgainst: 5 });
  assert.deepEqual(seasonRecord([], FR, "2026/2027"), { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 });
});

test("a fixture's placeholder is no national team", () => {
  // The Euro 2028 fixtures name the teams still to qualify: none is a nation.
  for (const name of ["A1", "F4", "Winner Group A", "Runner-up Group F", "3rd Group A/B/C", "3rd Group A/D/E/F", "Winner Match 37", "Loser Match 49"])
    assert.equal(placeholderTeam(name), true, name);
  for (const name of ["France", "Italy", "Wales", "Winners FC", "Iceland", "West Germany", "Bosnia and Herzegovina"])
    assert.equal(placeholderTeam(name), false, name);
});

test("the nations and a nation are served", { skip }, async () => {
  const list = await get("/api/nations?season=2025%2F2026");
  assert.equal(list.response.status, 200);
  assert.ok(Array.isArray(list.body.data.nations));
  assert.equal((await get("/api/nations?season=2025")).response.status, 400);
  assert.equal((await get("/api/nations/t_zzzzzz?season=2025%2F2026")).response.status, 404);
});

// FAILURE_MODES.md §49 (49l), written before the code: a match of « the season's other internationals » (the
// edition `nations-results:internationals:<season>`, International Results) comes with its tournament as its
// competition and no round (the file has no stage), so the nation page's carousel labels it by its competition and
// season (mock-up B: « Matchs amicaux 2025/26 »), never « Matchs internationaux 2024/2025 2024/25 » nor « Phase de
// groupes ». Another edition's match is served as before.
test("a match of the season's other internationals is served under its tournament", async () => {
  const route = await import("../src/routes/nations.mjs");
  const { matchCarousel } = await import("../../../dashboard/frontend/src/services/nation-carousel.js");
  assert.equal(typeof route.matchOf, "function");
  const row = (over) => ({
    match_id: "m_x", match_date: "2024-09-07", season: "2024/2025", competition: "Matchs internationaux 2024/2025",
    edition: "nations-results:internationals:2024/2025", round: "Friendly", status: "finished", collected: false,
    home_id: FR, home_name: "France", home_image: null, away_id: "t_it", away_name: "Italy", away_image: null,
    home_score: 1, away_score: 3, home_penalties: null, away_penalties: null, ...over,
  });
  const served = [
    row({ match_date: "2025-11-13", season: "2025/2026", competition: "Matchs internationaux 2025/2026",
      edition: "nations-results:internationals:2025/2026", round: "FIFA World Cup qualification" }),
    row({ match_date: "2025-06-09", round: "Friendly" }),
    row({ match_date: "2024-09-07", round: "UEFA Nations League" }),
  ].map(route.matchOf);
  assert.deepEqual(served.map((s) => [s.competition, s.round, s.edition]), [
    ["FIFA World Cup qualification", null, "nations-results:internationals:2025/2026"],
    ["Friendly", null, "nations-results:internationals:2024/2025"],
    ["UEFA Nations League", null, "nations-results:internationals:2024/2025"],
  ]);
  assert.deepEqual(matchCarousel({ id: FR, matches: served, tournaments: [] }).map((g) => g.label),
    ["Qualifications 2025/26", "Matchs amicaux 2024/25", "Ligue des nations 2024/25"]);
  // Another edition's match: its competition and round as stored.
  const league = route.matchOf(row({ competition: "nations-league", edition: "openligadb:nations-league:2026/2027", round: "Groupe 3" }));
  assert.deepEqual([league.competition, league.round], ["nations-league", "Groupe 3"]);
});
