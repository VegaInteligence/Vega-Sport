// The archived seasons of the five big leagues (2010/11–2020/21), as the competition page shows them: written before
// src/league-history.mjs. No database: the route's pure parts.
//
// Failure modes and expected outcomes:
// - Edition: a league's season is held by openfootball ("2015-16/fr.1") or by engsoccerdata
//   ("engsoccerdata/france/all/2012"); both keys are asked, the one holding matches answers. A season outside
//   2010/11–2020/21 or another league has no archived view.
// - Table: 3 points a win; an unplayed match (no score) counts for nobody. Ties: PL, Bundesliga, Ligue 1 by goal
//   difference then goals scored; LaLiga and Serie A by the head-to-head of the clubs level on points first. Ligue 1
//   2019/20, stopped after 28 rounds, ranks by points per match (the league's decision). A sourced deduction lowers
//   the club's points (Serie A 2011/12 Atalanta −6 …) and is shown as such.
// - Colours, facts not rules: a club is coloured with the European competition it played the next season (cl > el >
//   ecl). A club absent from the league the next season is relegated — when that set is not plausible (more clubs
//   than the league relegates plus one, or one far up the table: two source families spelling clubs differently),
//   the league's rule decides (its bottom N). A relegation play-off place that stayed up is "relegation-po".
// - Names across editions (live, 23 Nov 2026: no Champions League colour before 2019/20): openfootball's European
//   editions write « Olympique Lyonnais (FRA) », « FC Barcelona (ESP) », rows the identity pass has not merged; the
//   league files « Olympique Lyonnais », engsoccerdata « Barcelona ». A club is matched by its id, else by its
//   archived spellings with the country tag and the legal-form words (FC, AS, SSC…) dropped — equal, never contained.
// - Relegation by absence holds a club relegated from mid-table (Elche, 13th, LaLiga 2014/15, for its debts): the
//   absent clubs only need to be in the bottom half.
// - Matchdays: by the round's number ("Matchday 7", "7"); a season whose matches mostly carry none is grouped by month.
// - Players: a season whose players' goals fall short of the scores by more than own goals can explain (4.5 %: own
//   goals are 2–3.5 % of goals in these leagues) is incomplete in the file (Transfermarkt datasets, 2014/15) and says so.
// - Summary: champion and points, top scorer (goals), goals per played match, relegated clubs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_LEAGUES, editionKeys, historySeason, standings, zones, matchdays, summary, DEDUCTIONS, playersIncomplete, clubName,
} from "../src/league-history.mjs";

const club = (key, name = key) => ({ key, id: null, name, imageUrl: null });
const game = (h, a, hs, as, extra = {}) => ({ date: "2015-08-08", round: "Matchday 1", home: club(h), away: club(a), homeScore: hs, awayScore: as, ...extra });

test("the five leagues, their seasons and their archive keys", () => {
  assert.deepEqual(Object.keys(HISTORY_LEAGUES).sort(), ["l_0ALvwF", "l_0ErfuF", "l_1Isor4", "l_3FJFUl", "l_4WFCIZ"]);
  assert.deepEqual(historySeason("l_3FJFUl", "2015/2016"), 2015);
  assert.equal(historySeason("l_3FJFUl", "2021/2022"), null);
  assert.equal(historySeason("l_3FJFUl", "2009/2010"), null);
  assert.equal(historySeason("l_other", "2015/2016"), null);
  assert.equal(historySeason("l_3FJFUl", "2015/2017"), null);
  assert.deepEqual(editionKeys("l_3FJFUl", 2012), ["2012-13/fr.1", "engsoccerdata/france/all/2012"]);
  assert.deepEqual(editionKeys("l_4WFCIZ", 2019), ["2019-20/en.1"]);
  assert.deepEqual(editionKeys("l_0ErfuF", 2010), ["2010-11/es.1", "engsoccerdata/spain/all/2010"]);
});

test("the table: points, goal difference, unplayed matches", () => {
  const rows = standings([game("A", "B", 2, 0), game("B", "C", 1, 1), game("C", "A", 0, 3), game("A", "C", null, null)], { league: "l_3FJFUl", start: 2015 });
  assert.deepEqual(rows.map((r) => [r.rank, r.team.key, r.points, r.played, r.wins, r.draws, r.losses, r.goalsFor, r.goalsAgainst]), [
    [1, "A", 6, 2, 2, 0, 0, 5, 0], [2, "B", 1, 2, 0, 1, 1, 1, 3], [3, "C", 1, 2, 0, 1, 1, 1, 4],
  ]);
});

test("LaLiga and Serie A break a tie by head-to-head; the others by goal difference", () => {
  // A and B level on 3 points; B beat A, A has the better goal difference.
  const liga = standings([game("A", "C", 5, 0), game("B", "A", 1, 0)], { league: "l_0ErfuF", start: 2015 });
  const pl = standings([game("A", "C", 5, 0), game("B", "A", 1, 0)], { league: "l_4WFCIZ", start: 2015 });
  assert.deepEqual(liga.map((r) => r.team.key), ["B", "A", "C"]);
  assert.deepEqual(pl.map((r) => r.team.key), ["A", "B", "C"]);
});

test("a sourced deduction; Ligue 1 2019/20 by points per match", () => {
  assert.equal(DEDUCTIONS["l_0ALvwF:2014"]["Parma"], 7);
  const rows = standings([game("Atalanta", "B", 1, 0), game("B", "Atalanta", 1, 0), game("Atalanta", "C", 1, 0)],
    { league: "l_0ALvwF", start: 2011 });
  assert.deepEqual(rows.find((r) => r.team.key === "Atalanta").points, 0);
  assert.deepEqual(rows.find((r) => r.team.key === "Atalanta").deduction, 6);
  // 2019/20: A 7 pts in 3 (2.33), B 6 in 2 (3.00): B first.
  const covid = standings([game("A", "C", 1, 0), game("A", "D", 1, 0), game("A", "E", 0, 0), game("B", "C", 1, 0), game("B", "D", 1, 0)],
    { league: "l_3FJFUl", start: 2019 });
  assert.deepEqual(covid.slice(0, 2).map((r) => r.team.key), ["B", "A"]);
});

test("colours: Europe the next season, relegation by absence or by the league's rule", () => {
  const table = "ABCDEFGHIJKLMNOPQRST".split("").map((k, i) => ({ rank: i + 1, team: club(k) }));
  const stay = new Set("ABCDEFGHIJKLMNOP".split(""));
  const next = { league: new Set([...stay, "R"]), cl: new Set(["A", "B", "C"]), el: new Set(["C", "D", "E"]), ecl: new Set(["F"]) };
  // Ligue 1 2015/16: three down; Q (17th) and S, T absent next season… R stayed, Q went: the real set.
  const z = zones(table, { league: "l_3FJFUl", start: 2015, next });
  assert.deepEqual(z.slice(0, 7).map((r) => r.zone), ["cl", "cl", "cl", "el", "el", "ecl", null]);
  assert.deepEqual(z.slice(15).map((r) => [r.team.key, r.zone]), [["P", null], ["Q", "relegation"], ["R", null], ["S", "relegation"], ["T", "relegation"]]);
  // Two families spelling the clubs apart: half the table "absent" — the rule decides (bottom three).
  const unrelated = zones(table, { league: "l_3FJFUl", start: 2013, next: { league: new Set("ABCDEFGHIJ".split("")), cl: new Set(), el: new Set(), ecl: new Set() } });
  assert.deepEqual(unrelated.filter((r) => r.zone === "relegation").map((r) => r.team.key), ["R", "S", "T"]);
  // Bundesliga: 16th played the play-off and stayed up.
  const bl = zones(table.slice(0, 18), { league: "l_1Isor4", start: 2015, next: { league: new Set("ABCDEFGHIJKLMNOP".split("")), cl: new Set(), el: new Set(), ecl: new Set() } });
  assert.deepEqual(bl.slice(15).map((r) => r.zone), ["relegation-po", "relegation", "relegation"]);
  // Matched by the club's id when it has one, else by its name.
  const lyon = [{ rank: 1, team: { key: "x", id: "t_1", name: "Lyon" } }, ...table.slice(1)];
  const byId = zones(lyon, { league: "l_3FJFUl", start: 2015, next: { league: new Set(["t_1", ..."BCDEFGHIJKLMNOPQ".split("")]), cl: new Set(["t_1"]), el: new Set(), ecl: new Set() } });
  assert.equal(byId[0].zone, "cl");
});

test("matchdays by round number, else by month", () => {
  const byRound = matchdays([game("A", "B", 1, 0, { round: "Matchday 2", date: "2015-08-15" }), game("C", "D", 0, 0, { round: "Matchday 1", date: "2015-08-08" }),
    game("E", "F", 2, 2, { round: "1", date: "2015-08-09" })]);
  assert.deepEqual(byRound.map((d) => [d.key, d.number, d.matches.length]), [["1", 1, 2], ["2", 2, 1]]);
  const byMonth = matchdays([game("A", "B", 1, 0, { round: null, date: "2010-08-28" }), game("C", "D", 0, 0, { round: null, date: "2010-09-04" }),
    game("E", "F", 0, 0, { round: null, date: "2010-08-14" })]);
  assert.deepEqual(byMonth.map((d) => [d.key, d.month, d.matches.map((m) => m.date)]), [["2010-08", "2010-08", ["2010-08-14", "2010-08-28"]], ["2010-09", "2010-09", ["2010-09-04"]]]);
});

test("the season in four lines", () => {
  const table = [{ rank: 1, team: club("PSG", "Paris Saint-Germain"), points: 96, zone: "cl" }, { rank: 2, team: club("Q"), points: 10, zone: "relegation" }];
  const s = summary(table, [game("PSG", "Q", 3, 1), game("Q", "PSG", null, null)], [{ name: "Zlatan Ibrahimović", goals: 38 }, { name: "Cavani", goals: 19 }]);
  assert.deepEqual(s, { champion: { team: table[0].team, points: 96 }, topScorer: { name: "Zlatan Ibrahimović", goals: 38 }, goalsPerMatch: 4, relegated: [table[1].team] });
  assert.equal(summary([], [], []).champion, null);
});

test("a players' file short of the season's goals is incomplete", () => {
  assert.equal(playersIncomplete(1009 - 30, 1009), false); // own goals only
  assert.equal(playersIncomplete(837, 1009), true); // LaLiga 2014/15 in the file
  assert.equal(playersIncomplete(843 - 50, 843), true); // Bundesliga 2014/15: 50 short
  assert.equal(playersIncomplete(0, 0), false);
});

test("a club across editions: country tag and legal-form words dropped, equality only", () => {
  assert.equal(clubName("Olympique Lyonnais (FRA)"), clubName("Olympique Lyonnais"));
  assert.equal(clubName("FC Barcelona (ESP)"), clubName("Barcelona"));
  assert.equal(clubName("FC Bayern München"), clubName("Bayern München (GER)"));
  assert.equal(clubName("SSC Napoli (ITA)"), clubName("Napoli"));
  assert.notEqual(clubName("Sporting CP (POR)"), clubName("Sporting Gijón"));
  assert.notEqual(clubName("Inter"), clubName("Internacional"));
  // A league row matched through its archived spelling (its site name differs: « Lyon »).
  const table = "ABCDEFGHIJKLMNOPQRST".split("").map((k, i) => ({ rank: i + 1, team: { key: k, id: null, name: k, names: [k] } }));
  table[1] = { rank: 2, team: { key: "lyon", id: "t_lyon", name: "Lyon", names: ["Lyon", "Olympique Lyonnais"] } };
  const next = { league: new Set(["t_lyon", ..."ACDEFGHIJKLMNOPQ".split("").map(clubName)]), cl: new Set([clubName("Olympique Lyonnais (FRA)")]), el: new Set(), ecl: new Set() };
  assert.equal(zones(table, { league: "l_3FJFUl", start: 2016, next })[1].zone, "cl");
});

test("relegated from mid-table: Elche, 13th, LaLiga 2014/15", () => {
  const table = "ABCDEFGHIJKLMNOPQRST".split("").map((k, i) => ({ rank: i + 1, team: { key: k, id: null, name: k } }));
  // M (13th), S, T absent next season; R (18th) stayed.
  const next = { league: new Set("ABCDEFGHIJKLNOPQR".split("")), cl: new Set(), el: new Set(), ecl: new Set() };
  assert.deepEqual(zones(table, { league: "l_0ErfuF", start: 2014, next }).filter((r) => r.zone === "relegation").map((r) => r.team.key), ["M", "S", "T"]);
});
