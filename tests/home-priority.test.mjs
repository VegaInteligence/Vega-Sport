// The visitor's country inside the existing cards (VI-48, #69; doc "Accueil", « Le pays du visiteur »). The « Chez
// vous » strip was rejected on 24 Nov 2026 (« il faut intégrer la localisation dans les cards actuelles, pas rajouter
// des cards »): the country changes what « À l'affiche » and the results strip show, under a priority that will be a
// user setting (« Privilégier : localisation ou importance du match ») and is fixed in code until then
// (src/services/home-priority.js). Written before home-priority.js and before the changes to chooseBillboard and
// weekTicker.
//
// Failure modes and expected outcomes:
//  P1 The priority is read from somewhere the visitor can change (preferences, cookie, URL) before the setting exists
//     → it is one constant, HOME_PRIORITY = "location", among exactly two values ("location", "importance"); its
//     numbers are named data (localPlaces 2, bigPlacesKept 1), not literals in the functions.
//  P2 A match is taken for local because of its teams, or a European cup for its host's → local = its competition's
//     country is the visitor's (base code), the competitions known to the page plus home-local's own `competitions`;
//     INT / INT-2 / UEFA never local; no country → nothing local.
//  P3 home-local's matches enter « À l'affiche » outside its window (home-local runs to today + 7, the billboard to
//     today + 3) → only those whose Paris `day` is inside the billboard's window as the API states it
//     (`billboardWindow`); no stated window → none of them (never a window made up by the site); the billboard's own
//     local matches still count.
//  P4 The visitor's chosen leagues are ignored → a home-local match of a league outside a chosen scope stays out; no
//     chosen scope (null) lets every league in.
//  P5 A match served by both reads appears twice → one card, the billboard's record kept.
//  P6 No home-local answer (no country, « Aucun pays », not loaded yet, older API) changes the choice → exactly the
//     billboard's choice of before, whatever the priority.
//  K1 (24 Nov, the owner: « je vois un match fini dans une card qui affiche les futurs matchs ») A finished or in-play
//     match, or one whose kick-off has passed, enters « À l'affiche » as a big match, a local one or a favourite's →
//     never, in both priorities: the card is the matches to come, as before VI-48.
//  L1 "location": the favourites keep their places (up to 3) and the card rule; then up to two places go to the
//     country's most important matches to come (weight ↓, kick-off ↑, id ↑); at least one place stays to the big
//     matches when there are any; the rest to the big matches by importance; a short side is completed by the other.
//  L2 "location", a country whose only local match in the window is finished → no local place: five big ones, as
//     without a country.
//  L3 "location", a country without match in the window → the billboard's choice of before.
//  L4 "location", local matches finished or in play beside one to come → only the one to come takes a place; the
//     other reserved place goes to the big matches.
//  I1 "importance": no reserved place; importance only, and at equal importance a local match goes before a non-local
//     one; a light local match never displaces a heavier one.
//  T1 Results strip, "location": within a day the country's results first (then the editorial weight), before the
//     cut at 8; the national teams first as before; the days unchanged.
//  T2 Results strip, "importance": the editorial weight first, local only as the tie-break; no country → as before.
import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_PRIORITIES,
  HOME_PRIORITY,
  PRIORITY_RULES,
  isLocal,
  localLeagues,
  localMatches,
} from "../dashboard/frontend/src/services/home-priority.js";
import { chooseUpcoming } from "../dashboard/frontend/src/services/home-upcoming.js";
import { weekTicker } from "../dashboard/frontend/src/services/home-insights.js";

const at = (iso) => Date.parse(iso);
const ids = (list) => list.map((m) => m.fixture.id);
const NOW = at("2026-11-24T07:00:00Z"); // Tuesday, 08:00 in Paris
const WINDOW = { start: "2026-11-23", end: "2026-11-27" };
const UCL = "l_0bfbkO", L1 = "l_3FJFUl", L2 = "l_0275VP", PL = "l_4WFCIZ", BRA = "l_1D8Xrl";
const COMPETITIONS = new Map([
  [UCL, { id: UCL, country: "INT-2" }],
  [L1, { id: L1, country: "FRA" }],
  [PL, { id: PL, country: "ENG" }],
]);
// A window record (windowRecord of routes/home.mjs).
const entry = (id, league, iso, weight, status = "not_started", day = iso.slice(0, 10)) => ({
  fixture: { id, status, league: { id: league } }, time: at(iso), day, weight,
});
// The scope's billboard on Tuesday: Champions League nights, one Ligue 1 match on Friday.
const BILLBOARD = [
  entry("bre-eve", PL, "2026-11-23T20:00:00Z", 5.03, "finished"),
  entry("ars-bvb", UCL, "2026-11-24T20:00:00Z", 6.93),
  entry("rma-psv", UCL, "2026-11-24T20:00:00Z", 5.84),
  entry("psg-rom", UCL, "2026-11-25T20:00:00Z", 6.39),
  entry("bru-liv", UCL, "2026-11-25T20:00:00Z", 6.3),
  entry("bre-pfc", L1, "2026-11-27T19:45:00Z", 3.89),
];
// France's home-local: Ligue 2 on Monday, the same Friday match, the weekend beyond the billboard's window.
const FRA = {
  country: "FRA",
  window: { start: "2026-11-23", end: "2026-12-01" },
  competitions: [{ id: L1, country: "FRA" }, { id: L2, country: "FRA" }],
  matches: [
    entry("nan-gre", L2, "2026-11-23T19:45:00Z", 0.5, "finished"),
    entry("soc-dun", L2, "2026-11-23T19:45:00Z", 0.5, "finished"),
    entry("bre-pfc", L1, "2026-11-27T19:45:00Z", 3.89),
    entry("psg-lor", L1, "2026-11-28T20:00:00Z", 4.32),
  ],
};
const leaguesOf = (data) => localLeagues(data?.country, COMPETITIONS.values(), data?.competitions);
const localOf = (data, extra = {}) =>
  localMatches({ billboard: BILLBOARD, local: data, window: WINDOW, scopeIds: null, leagues: leaguesOf(data), ...extra });

test("P1 the priority: one constant, two values, named numbers", () => {
  assert.deepEqual(Object.values(HOME_PRIORITIES).sort(), ["importance", "location"]);
  assert.equal(HOME_PRIORITY, "location");
  assert.deepEqual({ ...PRIORITY_RULES }, { localPlaces: 2, bigPlacesKept: 1 });
  assert.ok(Object.isFrozen(PRIORITY_RULES) && Object.isFrozen(HOME_PRIORITIES));
});

test("P2 local: the competition's country, never a European cup, nothing without a country", () => {
  const leagues = leaguesOf(FRA);
  assert.deepEqual([...leagues].sort(), [L2, L1].sort());
  assert.equal(isLocal(BILLBOARD.find((m) => m.fixture.id === "bre-pfc"), leagues), true);
  assert.equal(isLocal(BILLBOARD.find((m) => m.fixture.id === "psg-rom"), leagues), false); // PSG, but the Champions League
  assert.equal(isLocal({ leagueId: L1 }, leagues), true); // a result's shape
  assert.equal(localLeagues(null, COMPETITIONS.values(), FRA.competitions), null);
  assert.equal(isLocal({ leagueId: L1 }, null), false);
  // Without home-local's answer, the page's own competitions name the country's leagues.
  assert.deepEqual([...localLeagues("ENG", COMPETITIONS.values())], [PL]);
});

test("P3–P5 the local candidates: the billboard's window, the chosen scope, once each", () => {
  // nan-gre, soc-dun (Monday) and bre-pfc once; psg-lor (Saturday 28) is past the billboard's window.
  assert.deepEqual(ids(localOf(FRA)).sort(), ["bre-pfc", "nan-gre", "soc-dun"]);
  assert.equal(localOf(FRA).filter((m) => m.fixture.id === "bre-pfc").length, 1);
  assert.equal(localOf(FRA).find((m) => m.fixture.id === "bre-pfc"), BILLBOARD.find((m) => m.fixture.id === "bre-pfc"));
  // No window stated by the API: home-local's own matches stay out, the billboard's local one counts.
  assert.deepEqual(ids(localOf(FRA, { window: null })), ["bre-pfc"]);
  // A chosen scope without Ligue 2: its matches stay out.
  assert.deepEqual(ids(localOf(FRA, { scopeIds: new Set([L1, UCL]) })), ["bre-pfc"]);
  // P6: no answer, no list (the caller keeps the choice of before).
  assert.equal(localOf(null), null);
});

test("L1 location: two places for the country, one at least for the big matches", () => {
  // France: Monday's Ligue 2 results are finished; Brest – Paris FC is the only local match to come.
  const five = chooseUpcoming({ billboard: BILLBOARD, local: localOf(FRA), priority: "location", now: NOW });
  assert.deepEqual(ids(five), ["ars-bvb", "bre-pfc", "psg-rom", "bru-liv", "rma-psv"]);
  assert.ok(five.every((m) => m.billboard === true && m.fixture.status === "not_started" && m.time >= NOW));
  // Two local matches to come: both take the reserved places, the big matches keep three.
  const lyon = entry("lyo-mon", L1, "2026-11-26T20:00:00Z", 1.1);
  assert.deepEqual(ids(chooseUpcoming({ billboard: BILLBOARD, local: [...localOf(FRA), lyon], priority: "location", now: NOW })),
    ["ars-bvb", "bre-pfc", "lyo-mon", "psg-rom", "bru-liv"]);
  // Favourites keep their places: three of them, then one local, then one big match.
  const favourites = ["a", "b", "c"].map((teamId) => ({ teamId, strength: 1 }));
  const matches = ["a", "b", "c"].map((t, i) => ({ fixture: { id: `fav-${t}`, status: "not_started" }, time: at(`2026-12-0${i + 3}T20:00:00Z`), favourites: [t] }));
  const withFavourites = chooseUpcoming({ billboard: BILLBOARD, local: localOf(FRA), favourites, matches, priority: "location", now: NOW });
  assert.deepEqual(ids(withFavourites), ["ars-bvb", "fav-a", "fav-b", "fav-c", "bre-pfc"]);
  // A favourite's match that is also local counts once, as the favourite's.
  const shared = chooseUpcoming({
    billboard: BILLBOARD, local: localOf(FRA), priority: "location", now: NOW,
    favourites: [{ teamId: "t_brest", strength: 1 }],
    matches: [{ fixture: { id: "bre-pfc", status: "not_started" }, time: at("2026-11-27T19:45:00Z"), favourites: ["t_brest"] }],
  });
  assert.equal(ids(shared).filter((id) => id === "bre-pfc").length, 1);
  assert.equal(shared.find((m) => m.fixture.id === "bre-pfc").favourite, true);
  assert.equal(shared.find((m) => m.fixture.id === "bre-pfc").weight, 3.89);
  // Only local matches and nothing big: the country's matches to come complete; its results never.
  const onlyLocal = chooseUpcoming({ billboard: [], local: [...FRA.matches.slice(0, 3), lyon], priority: "location", now: NOW });
  assert.deepEqual(ids(onlyLocal), ["bre-pfc", "lyo-mon"]);
});

test("L2 location, the country's only local match is finished: five big ones", () => {
  const billboard = [...BILLBOARD.filter((m) => m.fixture.id !== "bre-pfc"), entry("mci-nap", UCL, "2026-11-24T20:00:00Z", 5.77)];
  const without = chooseUpcoming({ billboard, now: NOW });
  assert.deepEqual(ids(without), ["ars-bvb", "psg-rom", "bru-liv", "rma-psv", "mci-nap"]);
  assert.deepEqual(ids(chooseUpcoming({ billboard, local: [FRA.matches[0]], priority: "location", now: NOW })), ids(without));
});

test("L3 location, a country without match in the window: the choice of before", () => {
  const before = chooseUpcoming({ billboard: BILLBOARD, now: NOW });
  assert.deepEqual(ids(before), ["ars-bvb", "psg-rom", "bru-liv", "rma-psv", "bre-pfc"]);
  const empty = { country: "BRA", window: FRA.window, competitions: [{ id: BRA, country: "BRA" }], matches: [] };
  assert.deepEqual(ids(chooseUpcoming({ billboard: BILLBOARD, local: localOf(empty), priority: "location", now: NOW })), ids(before));
  // P6: no answer at all, either priority.
  for (const priority of ["location", "importance"])
    assert.deepEqual(ids(chooseUpcoming({ billboard: BILLBOARD, local: null, priority, now: NOW })), ids(before));
});

test("L4 location: only the country's matches to come take its places", () => {
  const billboard = BILLBOARD.filter((m) => m.fixture.id !== "bre-pfc");
  const result = entry("ren-lyo", L1, "2026-11-23T20:00:00Z", 4.5, "finished");
  const live = entry("mon-nan", L1, "2026-11-24T06:30:00Z", 3.9, "in_play");
  const soon = entry("nic-tou", L1, "2026-11-26T20:00:00Z", 1.2);
  const five = chooseUpcoming({ billboard, local: [result, live, soon], priority: "location", now: NOW });
  assert.deepEqual(ids(five), ["ars-bvb", "nic-tou", "psg-rom", "bru-liv", "rma-psv"]);
});

test("I1 importance: no reserved place, local only at equal importance", () => {
  const five = chooseUpcoming({ billboard: BILLBOARD, local: localOf(FRA), priority: "importance", now: NOW });
  assert.deepEqual(ids(five), ["ars-bvb", "psg-rom", "bru-liv", "rma-psv", "bre-pfc"]);
  // An English match as heavy as Brest – Paris FC and earlier: it goes first without the country, after it with France.
  const tie = entry("eng-tie", PL, "2026-11-26T20:00:00Z", 3.89);
  assert.deepEqual(ids(chooseUpcoming({ billboard: [...BILLBOARD, tie], priority: "importance", now: NOW })).at(-1), "eng-tie");
  assert.deepEqual(ids(chooseUpcoming({ billboard: [...BILLBOARD, tie], local: localOf(FRA), priority: "importance", now: NOW })).at(-1), "bre-pfc");
  // Finished and in-play matches never, in this priority either.
  const live = entry("live", UCL, "2026-11-24T06:30:00Z", 9, "in_play");
  assert.ok(!ids(chooseUpcoming({ billboard: [...BILLBOARD, live], local: localOf(FRA), priority: "importance", now: NOW })).includes("live"));
});

test("T1–T2 the results strip: the country's results first in location, a tie-break in importance", () => {
  const club = (id, leagueId, date = "2026-11-23") => ({ id, date, leagueId, home: { id: `t_${id}h`, score: 1 }, away: { id: `t_${id}a`, score: 0 } });
  // Monday: eight Champions League results (weight 3 each), then two Ligue 1 ones (weight 1: Top 5).
  const results = [...Array.from({ length: 8 }, (_, i) => club(`ucl${i}`, UCL)), club("l1a", L1), club("l1b", L1), club("sun", PL, "2026-11-22")];
  const nations = [{ id: "n1", date: "2026-11-23", tournament: "Friendly", home: { id: null, name: "Chile", score: 0 }, away: { id: null, name: "Peru", score: 0 } }];
  const leagues = localLeagues("FRA", COMPETITIONS.values());
  const location = weekTicker(results, nations, new Map(), { leagues, priority: "location" });
  assert.deepEqual(location.map((d) => d.day), ["2026-11-23", "2026-11-22"]);
  assert.deepEqual(location[0].matches.map((m) => m.id), ["n1", "l1a", "l1b", "ucl0", "ucl1", "ucl2", "ucl3", "ucl4"]);
  const importance = weekTicker(results, nations, new Map(), { leagues, priority: "importance" });
  assert.deepEqual(importance[0].matches.map((m) => m.id), ["n1", "ucl0", "ucl1", "ucl2", "ucl3", "ucl4", "ucl5", "ucl6"]);
  // At equal weight, the local result first.
  const even = [club("eng", PL), club("fra", L1)];
  assert.deepEqual(weekTicker(even, [], new Map(), { leagues, priority: "importance" })[0].matches.map((m) => m.id), ["fra", "eng"]);
  // No country: exactly as before, whatever the priority.
  const before = weekTicker(results, nations, new Map());
  for (const priority of ["location", "importance"])
    assert.deepEqual(weekTicker(results, nations, new Map(), { leagues: null, priority }), before);
  assert.deepEqual(before[0].matches.map((m) => m.id), importance[0].matches.map((m) => m.id));
});
