// Which preference acts where (#69, the owner's twelve effects of 24 Nov 2026: « ne peux-tu pas tout faire et
// intégrer ? »). One rule wherever two preferences meet: the visitor's favourites first, then their country, then the
// importance of the match; a URL parameter or a filter the visitor chose on the page beats every preference.
// Written before dashboard/frontend/src/services/preference-effects.js.
//
// Failure modes and expected outcomes, per effect (numbers are the owner's):
//  E1 Ticker: a favourite club's result is cut at 8 or left behind the country's → a result involving a favourite
//     club leads its day, before the country's, then the existing order, in both priorities; no favourite → the
//     order of before; a favourite absent from the results → the order of before.
//  E2 « Course au titre »: opens on the country's league although a favourite club plays elsewhere → the first
//     favourite club (favourites order) whose league is among the tables wins, before the country; a favourite in no
//     table → the next one, then the country, then the default; the league is the table holding the club, else a
//     result / fixture of it in a table's league, else its country's table.
//  E3 Matches: a favourite club's match is lost in its day → first within its day, the days and the rest unchanged.
//  E4 Competitions: a favourite club does not change the opening → with no saved competition, its league (its
//     country's first division: the page has no club → league map) opens; a saved one still wins.
//  E5/E6 Season cards, Ballon d'Or: favourite players not marked → isFavouritePlayer true for them only.
//  E7 Search: a favourite pushed above a better match → only within equal relevance; unequal order kept.
//  E8 Nations: « Mes sélections » not opened → "saved" when a nation is saved, else "ranked".
//  E9 Matches league filter: preselected over a URL value, after the visitor cleared it, or on a league not offered
//     → only with no URL value, not cleared this visit, a followed league among the options: the first followed.
//  E10 Players league filter: preselected with several followed leagues → only with exactly one.
//  E11 Competitions: the visitor's country ignored, or « Aucun pays » used as a country → after a saved competition
//     and a favourite club, homeCountry (not "none") before the detected country / browser language.
//  E12 Clubs: the country filter not preselected, or "none" preselected → homeCountry when it is a country code;
//     Power Ranking: the first club of the country is the scroll target, none without a country.
//  M  Preselection memory: a cleared filter comes back → once the visitor changes a preselected value, it is
//     never preselected again this visit.
import test from "node:test";
import assert from "node:assert/strict";
import {
  clubsCountry,
  countryLeague,
  favouriteClubLeague,
  favouritesFirstWithinDay,
  favouriteSets,
  liftFavourites,
  matchesLeague,
  nationsOpeningScope,
  openingCompetition,
  playersLeague,
  powerRankingTarget,
  preferenceOrder,
  preselect,
  preselectMemory,
  titleRaceOpening,
} from "../dashboard/frontend/src/services/preference-effects.js";
import { weekTicker } from "../dashboard/frontend/src/services/home-insights.js";
import { HOME_PRIORITIES } from "../dashboard/frontend/src/services/home-priority.js";

const result = (id, leagueId, home, away, date = "2026-11-22") => ({
  id, leagueId, date, kickoff: `${date}T15:00:00Z`, home: { id: home, name: home, score: 1 }, away: { id: away, name: away, score: 0 },
});

test("favourite sets come from every list (the contract's favouritesOf)", () => {
  const sets = favouriteSets([
    { id: "a", entries: [{ kind: "clubs", id: "t_b" }, { kind: "players", id: "p_a" }] },
    { id: "b", entries: [{ kind: "clubs", id: "t_a" }, { kind: "nations", id: "t_n" }] },
  ]);
  assert.deepEqual([...sets.clubs], ["t_a", "t_b"]);
  assert.deepEqual([...sets.players], ["p_a"]);
  assert.deepEqual(favouriteSets(null), { clubs: new Set(), players: new Set(), order: { clubs: [], players: [] } });
});

test("E1 the ticker: favourites, then the country, then the weight, in both priorities", () => {
  // l_fr is the country's league; l_big a heavier one (Champions League weighs 3).
  const big = result("big", "l_0bfbkO", "t_x1", "t_x2"),
    local = result("local", "l_fr", "t_y1", "t_y2"),
    fav = result("fav", "l_other", "t_fav", "t_z2"),
    plain = result("plain", "l_other", "t_z3", "t_z4");
  const leagues = new Set(["l_fr"]);
  const ids = (days) => days[0].matches.map((m) => m.id);
  for (const priority of Object.values(HOME_PRIORITIES)) {
    const order = ids(weekTicker([plain, big, local, fav], [], new Map(), { leagues, priority, favourites: new Set(["t_fav"]) }));
    assert.equal(order[0], "fav", priority);
    const before = ids(weekTicker([plain, big, local, fav], [], new Map(), { leagues, priority }));
    assert.deepEqual(order.slice(1), before.filter((id) => id !== "fav"), priority);
  }
  // No favourite / a favourite absent: the order of before.
  const none = ids(weekTicker([plain, big, local, fav], [], new Map(), { leagues }));
  assert.deepEqual(ids(weekTicker([plain, big, local, fav], [], new Map(), { leagues, favourites: new Set(["t_absent"]) })), none);
  // Before the cut at 8: a ninth favourite result enters.
  const many = Array.from({ length: 9 }, (_, i) => result(`r${i}`, "l_0bfbkO", `t_a${i}`, `t_b${i}`));
  many.push(result("late", "l_other", "t_fav", "t_q"));
  const cut = ids(weekTicker(many, [], new Map(), { favourites: new Set(["t_fav"]) }));
  assert.equal(cut.length, 8);
  assert.equal(cut[0], "late");
  // The national teams still open the day.
  const day = weekTicker([fav], [{ date: "2026-11-22", home: {}, away: {} }], new Map(), { favourites: new Set(["t_fav"]) })[0].matches;
  assert.deepEqual(day.map((m) => m.national || m.id), [true, "fav"]);
});

test("preferenceOrder: favourite, then the priority's order", () => {
  const weight = (a, b) => b.w - a.w;
  const items = [{ id: "a", w: 3 }, { id: "b", w: 1, local: true }, { id: "c", w: 0, fav: true }];
  const sort = (priority) =>
    [...items].sort(preferenceOrder({ favourite: (m) => m.fav, local: (m) => m.local, weight, priority })).map((m) => m.id);
  assert.deepEqual(sort("location"), ["c", "b", "a"]);
  assert.deepEqual(sort("importance"), ["c", "a", "b"]);
});

test("E2 the title race: favourite club's league, then the country, then the default", () => {
  const tables = [
    { leagueId: "l_3FJFUl", rows: [{ id: "t_psg" }, { id: "t_om" }] },
    { leagueId: "l_4WFCIZ", rows: [{ id: "t_ars" }] },
    { leagueId: "l_0ErfuF", rows: [{ id: "t_rma" }] },
  ];
  const competitions = new Map([["l_3FJFUl", { country: "FRA" }], ["l_4WFCIZ", { country: "ENG" }], ["l_0ErfuF", { country: "ESP" }]]);
  // No favourite: as before (the country, else Ligue 1).
  assert.equal(titleRaceOpening(tables, competitions, { country: "ESP" }), "l_0ErfuF");
  assert.equal(titleRaceOpening(tables, competitions, {}), "l_3FJFUl");
  // Both a favourite and a country: the favourite wins.
  assert.equal(titleRaceOpening(tables, competitions, { favouriteClubs: ["t_ars"], country: "ESP" }), "l_4WFCIZ");
  // A favourite in no table, nor in any match, nor with a country: the next favourite, then the country.
  assert.equal(titleRaceOpening(tables, competitions, { favouriteClubs: ["t_gone", "t_rma"], country: "FRA" }), "l_0ErfuF");
  assert.equal(titleRaceOpening(tables, competitions, { favouriteClubs: ["t_gone"], country: "ENG" }), "l_4WFCIZ");
  // A club beyond the served rows: found by a result in a table's league (a cup match does not count).
  const matches = [result("cup", "l_0bfbkO", "t_lens", "t_ars"), result("lg", "l_3FJFUl", "t_lens", "t_om")];
  assert.equal(titleRaceOpening(tables, competitions, { favouriteClubs: ["t_lens"], matches, country: "ENG" }), "l_3FJFUl");
  // …else by its country (manifest clubCountries).
  assert.equal(titleRaceOpening(tables, competitions, { favouriteClubs: ["t_brest"], clubCountries: { t_brest: "FRA" }, country: "ENG" }), "l_3FJFUl");
  assert.equal(favouriteClubLeague([], { tables }), null);
});

test("E3 matches: favourites first within their day", () => {
  const items = [
    { id: "a", day: "d1" }, { id: "b", day: "d1", fav: true }, { id: "c", day: "d2" }, { id: "d", day: "d2" }, { id: "e", day: "d2", fav: true },
  ];
  const out = favouritesFirstWithinDay(items, (x) => x.day, (x) => x.fav).map((x) => x.id);
  assert.deepEqual(out, ["b", "a", "e", "c", "d"]);
  assert.deepEqual(favouritesFirstWithinDay(items, (x) => x.day, () => false).map((x) => x.id), ["a", "b", "c", "d", "e"]);
});

const CATALOG = [
  { id: "l_3FJFUl", name: "Ligue 1", country: "FRA" },
  { id: "l_2ligue", name: "Ligue 2", country: "FRA" },
  { id: "l_4WFCIZ", name: "Premier League", country: "ENG" },
  { id: "l_champ", name: "Championship", country: "ENG" },
  { id: "l_0ErfuF", name: "LaLiga", country: "ESP" },
  { id: "l_bra", name: "Série A", country: "BRA" },
];
test("countryLeague: the country's first division", () => {
  assert.equal(countryLeague(CATALOG, "ENG"), "l_4WFCIZ");
  assert.equal(countryLeague(CATALOG, "FRA"), "l_3FJFUl");
  assert.equal(countryLeague(CATALOG, "BRA"), "l_bra");
  assert.equal(countryLeague(CATALOG, "none"), null);
  assert.equal(countryLeague(CATALOG, "XYZ"), null);
});

test("E4/E11 competitions: saved, then favourite club, then homeCountry, then the detected country", () => {
  const clubCountries = { t_ars: "ENG", t_rma: "ESP", t_x: "ITA" };
  const open = (o) => openingCompetition(CATALOG, { clubCountries, ...o });
  assert.equal(open({ saved: "l_bra", favouriteClubs: ["t_ars"], homeCountry: "ESP", detected: "FR" }), "l_bra");
  assert.equal(open({ favouriteClubs: ["t_ars"], homeCountry: "ESP", detected: "FR" }), "l_4WFCIZ");
  // A favourite whose country has no league here: the next, then the country.
  assert.equal(open({ favouriteClubs: ["t_x", "t_rma"], detected: "FR" }), "l_0ErfuF");
  assert.equal(open({ favouriteClubs: ["t_x"], homeCountry: "ESP", detected: "FR" }), "l_0ErfuF");
  // « Aucun pays » is no country: the detected one decides; no favourite, no country: as before.
  assert.equal(open({ homeCountry: "none", detected: "GB" }), "l_4WFCIZ");
  assert.equal(open({ detected: "FR" }), "l_3FJFUl");
  // A saved competition no longer offered is ignored.
  assert.equal(open({ saved: "l_gone", homeCountry: "BRA" }), "l_bra");
});

test("E7 search: favourites lifted only within equal relevance", () => {
  const items = [{ id: "a", k: 0 }, { id: "b", k: 1 }, { id: "c", k: 1 }, { id: "d", k: 1, fav: true }, { id: "e", k: 2, fav: true }];
  const out = liftFavourites(items, (x) => x.k, (x) => x.fav).map((x) => x.id);
  assert.deepEqual(out, ["a", "d", "b", "c", "e"]);
});

test("E8 nations open on « Mes sélections » when one is saved", () => {
  assert.equal(nationsOpeningScope(2), "saved");
  assert.equal(nationsOpeningScope(0), "ranked");
});

test("E9/E10/E12 the candidates of the preselected filters", () => {
  assert.equal(matchesLeague(["l_a", "l_b"]), "l_a");
  assert.equal(matchesLeague([]), null);
  assert.equal(playersLeague(["l_a"]), "l_a");
  assert.equal(playersLeague(["l_a", "l_b"]), null);
  assert.equal(clubsCountry("FRA"), "FRA");
  assert.equal(clubsCountry("none"), null);
  assert.equal(clubsCountry(""), null);
});

test("preselect: URL beats it, a cleared filter stays cleared, only offered values", () => {
  const options = new Set(["l_a", "l_b"]);
  assert.equal(preselect({ inUrl: false, cleared: false, candidate: "l_a", options }), "l_a");
  assert.equal(preselect({ inUrl: true, cleared: false, candidate: "l_a", options }), null);
  assert.equal(preselect({ inUrl: false, cleared: true, candidate: "l_a", options }), null);
  assert.equal(preselect({ inUrl: false, cleared: false, candidate: "l_z", options }), null);
  assert.equal(preselect({ inUrl: false, cleared: false, candidate: null, options }), null);
});

test("M preselection memory: changing a preselected value marks it cleared for the visit", () => {
  let memory = {};
  memory = preselectMemory(memory, { key: "matches", applied: "l_a" });
  assert.deepEqual(memory, { matches: { applied: "l_a" } });
  memory = preselectMemory(memory, { key: "matches", current: "l_a" });
  assert.equal(memory.matches.cleared, undefined);
  memory = preselectMemory(memory, { key: "matches", current: "all" });
  assert.equal(memory.matches.cleared, true);
  // Other keys untouched; a key never applied is not marked.
  assert.deepEqual(preselectMemory(memory, { key: "players", current: "all" }).players, undefined);
});

test("E12 the Power Ranking's scroll target: the first club of the country", () => {
  const rows = [{ teamId: "t_1", country: "ENG" }, { teamId: "t_2", country: "FRA" }, { teamId: "t_3", country: "FRA" }];
  assert.equal(powerRankingTarget(rows, "FRA"), "t_2");
  assert.equal(powerRankingTarget(rows, "none"), null);
  assert.equal(powerRankingTarget(rows, "ITA"), null);
  assert.equal(powerRankingTarget(null, "FRA"), null);
});
