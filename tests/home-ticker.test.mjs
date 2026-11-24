// The home's strip (« le bandeau en haut ») with the matches to come (#69). The owner, 24 Nov 2026, on the home in
// production: « sur le bandeau en haut [je vois] que les matchs finis ; je veux aussi les futurs matchs ». Design
// decided by the coordinating session: a scoreboard strip, time flowing left to right, opened on "now"
// (doc docs/calculs/06-accueil-et-matchs/01-accueil.md, « Le bandeau »). Written before the code
// (scoreboardTicker in home-insights.js, HomeTicker and anchorTicker in HomeMatchday.jsx).
//
// Failure modes and expected outcomes:
//  B1 Nothing to come or in play (archived season: the page passes nothing; an older API without `billboard`; a
//     billboard whose matches are all over) changes the strip → exactly weekTicker's days (newest first, 4 latest
//     result days, 8 a day, nations first, then favourites / country / weight), no anchor; the rendered markup is
//     byte for byte the one of before (no anchor attribute, no script, « Résultats … »).
//  C1 With matches to come the days stay newest first, or today's matches are mixed → days in chronological order,
//     oldest on the left: the past result days as before (same 4-day rule, same 8, same order inside the day); today
//     = its finished results (same order), then the matches in play (kick-off, then weight), then the matches to come
//     by kick-off; then the following days.
//  C2 A following day shows its 8 heaviest only, or its favourites / country are ignored, or the 8 are displayed in
//     choice order → up to 8 a day chosen by the one rule (preferenceOrder: favourite clubs, then the country under
//     HOME_PRIORITY, then the served `weight`), then displayed by kick-off, then weight; "importance" makes the
//     country a tie-break only.
//  W1 A favourite's match far ahead stretches the strip → nothing after `billboardWindow.end`; nothing before today
//     among the matches to come.
//  D1 A match served by several reads appears twice, or a result loses its xG to a billboard record → one record per
//     fixture id (billboard first, then the favourites', then the country's); a match in the week's results keeps
//     its results record and its place among the results.
//  K1 A match stays "to come" after its kick-off, or vanishes at kick-off → to come while kick-off ≥ now (the « À
//     l'affiche » convention, home-upcoming.js); then in play when the feed says in_play, or when its kick-off has
//     passed less than 3 h ago and the feed still says not started (the site's live window, live-client.js
//     isLiveWindow); a match over by the feed, or past the live window, that is not among the results is dropped.
//  A1 The anchor is wrong → the first tick that is not finished, in strip order (an in-play match before one to come);
//     null without any.
//  S1 The strip opens at the wrong place → it starts two ticks before the anchor (or at their day's label when the
//     first of them opens its day), fewer when the anchor would not fit in the strip's width; at 0 when the anchor is
//     first; the value set is recorded on the element (not an attribute: no hydration mismatch).
//  R1 A match to come is drawn as a result (« Terminé », a score, is-lost) or links elsewhere than « À l'affiche »
//     → its top line = short competition + kick-off (Paris, kickoffFormatter, as NextMatches) and opens the match as
//     NextMatches does (fixtureHref); each team opens its club; no score, never is-lost; an empty foot link to the
//     match; the anchored tick carries data-ticker-anchor; one inline script right after the nav; the nav says
//     « Résultats et matchs à venir … ».
//  R2 A match in play → « En direct » (the site's live label) in place of the time; never a score (the owner,
//     24 Nov 2026: « ne met pas les scores »), even when the record carries fixture.score_home / score_away; never
//     is-lost.
// The pre-match forecast in the foot (the owner, 24 Nov 2026: « dans le bandeau du haut il me faut les prédictions de
// victoire etc mais ne met pas les scores »):
//  F1 A tick to come or in play whose record has a forecast (the billboard's and the country's records: `forecast`
//     {home, draw, away}; else the fixture's own `forecast`) shows nothing, or percentages that do not add up, or
//     colours of its own → a three-part bar (home, draw, away; data-side as MatchForecastBar, the list forecast's
//     colours) and a caption of three whole percentages that sum to 100 (largest remainder), in the place of a
//     result's xG bar and caption; the foot's accessible name « Pronostic d’avant-match : <home> N %, nul N %,
//     <away> N % ».
//  F2 A record without a forecast (the favourites' read carries none), or a malformed one (a share missing, out of
//     [0, 1], a sum far from 1) → the empty foot of before, « Voir <home> – <away> »; no placeholder, no invented value.
//  F3 A score slips in → no score of any kind on a tick not finished: no team score (<b>), no predicted score, no
//     expected goals, even when the forecast object carries them.
//  F4 The results move → a result tick's markup is the one of before, in a strip with matches to come too; the
//     results-only strip stays byte for byte (B1).
import test from "node:test";
import assert from "node:assert/strict";
import { React, compile, renderToStaticMarkup, src } from "./support/render-component.mjs";
import { weekTicker, scoreboardTicker, tickForecast } from "../dashboard/frontend/src/services/home-insights.js";

const h = React.createElement;
const at = (iso) => Date.parse(iso);
const NOW = at("2026-11-24T07:00:00Z"); // Tuesday 24, 08:00 in Paris
const WINDOW = { start: "2026-11-23", end: "2026-11-27" };
const UCL = "l_0bfbkO", L1 = "l_3FJFUl", PL = "l_4WFCIZ";
const parisDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(ms));

const result = (id, timeUtc, leagueId = PL, extra = {}) => ({
  id, season: "2026/2027", leagueId, league: "League", date: timeUtc.slice(0, 10), timeUtc,
  home: { id: `t_${id}h`, name: `${id} H`, imageUrl: null, score: 2, xg: 1.5 },
  away: { id: `t_${id}a`, name: `${id} A`, imageUrl: null, score: 1, xg: 0.5 },
  ...extra,
});
const entry = (id, timeUtc, { league = UCL, weight = 1, status = "not_started", home, away, score, forecast = null } = {}) => ({
  fixture: {
    id, season: "2026/2027", date: timeUtc.slice(0, 10), time_utc: timeUtc, status, round_name: "5",
    home_team: { id: home || `t_${id}h`, name: `${id} H`, image_url: null },
    away_team: { id: away || `t_${id}a`, name: `${id} A`, image_url: null },
    league: { id: league, name: league === UCL ? "UEFA Champions League" : "League" },
    score_home: score ? score[0] : null, score_away: score ? score[1] : null,
  },
  time: at(timeUtc), day: parisDay(at(timeUtc)), weight, forecast,
});
const ids = (days) => days.map((d) => [d.day, d.matches.map((m) => m.id)]);

// The week so far: Sunday 22 and Monday 23.
const RESULTS = [
  result("sun1", "2026-11-22T16:00:00Z"), result("sun2", "2026-11-22T20:00:00Z", L1),
  result("mon1", "2026-11-23T19:45:00Z"), result("mon2", "2026-11-23T20:00:00Z", UCL),
];
const NATIONS = [{ id: "n1", date: "2026-11-22", tournament: "Friendly", home: { id: null, name: "Chile", score: 0 }, away: { id: null, name: "Peru", score: 0 } }];

test("B1 nothing to come or in play: the strip of before, no anchor", () => {
  const before = weekTicker(RESULTS, NATIONS, new Map());
  const over = [entry("mon1", "2026-11-23T19:45:00Z", { status: "finished", score: [2, 1] }), entry("late", "2026-11-23T20:00:00Z", { status: "finished" })];
  for (const upcoming of [null, undefined, { billboard: undefined, window: WINDOW }, { billboard: [], window: WINDOW }, { billboard: over, window: WINDOW },
    // Kicked off yesterday, the feed still says not started: past the live window, nothing to show.
    { billboard: [entry("stale", "2026-11-23T12:00:00Z")], window: WINDOW }]) {
    const strip = scoreboardTicker(RESULTS, NATIONS, new Map(), { upcoming, now: NOW });
    assert.deepEqual(strip.days, before);
    assert.equal(strip.anchor, null);
    assert.equal(strip.ahead, false);
  }
});

test("C1 chronological days; today = finished, in play, to come", () => {
  const now = at("2026-11-24T19:30:00Z"); // Tuesday 20:30 in Paris
  const results = [...RESULTS, result("tue1", "2026-11-24T15:00:00Z"), result("tue2", "2026-11-24T15:00:00Z", UCL)];
  const billboard = [
    entry("tue2", "2026-11-24T15:00:00Z", { status: "finished", score: [2, 1], weight: 9 }),
    entry("tueL", "2026-11-24T17:45:00Z", { status: "in_play", weight: 2 }),
    entry("tueK", "2026-11-24T19:00:00Z", { weight: 5 }), // kicked off, feed not updated: in play
    entry("tueE", "2026-11-24T20:00:00Z", { weight: 1 }),
    entry("tueD", "2026-11-24T19:45:00Z", { weight: 3 }),
    entry("wed1", "2026-11-25T20:00:00Z", { weight: 4 }),
  ];
  const strip = scoreboardTicker(results, NATIONS, new Map(), { upcoming: { billboard, window: WINDOW }, now });
  const past = weekTicker(results, NATIONS, new Map());
  assert.deepEqual(strip.days.map((d) => d.day), ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"]);
  // The result days keep their content and order.
  assert.deepEqual(strip.days[0], past.find((d) => d.day === "2026-11-22"));
  assert.deepEqual(strip.days[1], past.find((d) => d.day === "2026-11-23"));
  const todayResults = past.find((d) => d.day === "2026-11-24").matches.map((m) => m.id);
  assert.deepEqual(strip.days[2].matches.map((m) => m.id), [...todayResults, "tueL", "tueK", "tueD", "tueE"]);
  assert.deepEqual(strip.days[2].matches.map((m) => m.tick ?? "result"), ["result", "result", "live", "live", "upcoming", "upcoming"]);
  assert.deepEqual(strip.days[3].matches.map((m) => m.id), ["wed1"]);
  assert.equal(strip.ahead, true);
  // The 4 latest result days rule still holds for the past.
  const many = ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"].map((d, i) => result(`d${i}`, `${d}T18:00:00Z`));
  const long = scoreboardTicker([...many, ...RESULTS], [], new Map(), { upcoming: { billboard, window: WINDOW }, now: NOW });
  assert.deepEqual(long.days.map((d) => d.day), ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"]);
});

test("C2 a following day: 8 chosen by favourite, country, weight; displayed by kick-off then weight", () => {
  const heavy = Array.from({ length: 8 }, (_, i) => entry(`h${i}`, `2026-11-25T${String(12 + i).padStart(2, "0")}:00:00Z`, { weight: 10 + i }));
  const fav = entry("fav", "2026-11-25T21:00:00Z", { weight: 0.5, home: "t_fav", league: PL });
  const local = entry("loc", "2026-11-25T10:00:00Z", { weight: 1, league: L1 });
  const same = entry("h7b", "2026-11-25T19:00:00Z", { weight: 30 }); // same kick-off as h7, heavier
  const leagues = new Set([L1]), favourites = new Set(["t_fav"]);
  const strip = scoreboardTicker([], [], new Map(), {
    upcoming: { billboard: [...heavy, local, same], matches: [fav], window: WINDOW }, now: NOW, leagues, favourites,
  });
  const wed = strip.days.find((d) => d.day === "2026-11-25");
  // Chosen: the favourite, the local one, then the six heaviest (h7b 30, h7..h3); h2, h1, h0 out.
  assert.deepEqual(wed.matches.map((m) => m.id), ["loc", "h3", "h4", "h5", "h6", "h7b", "h7", "fav"]);
  // "importance": the country only breaks ties: the favourite, then the seven heaviest.
  const importance = scoreboardTicker([], [], new Map(), {
    upcoming: { billboard: [...heavy, local, same], matches: [fav], window: WINDOW }, now: NOW, leagues, favourites, priority: "importance",
  });
  assert.deepEqual(importance.days.find((d) => d.day === "2026-11-25").matches.map((m) => m.id), ["h2", "h3", "h4", "h5", "h6", "h7b", "h7", "fav"]);
});

test("W1 the window: nothing after billboardWindow.end, nothing to come before today", () => {
  const far = entry("far", "2026-12-09T20:00:00Z", { home: "t_fav" });
  const fri = entry("fri", "2026-11-27T20:00:00Z");
  const sat = entry("sat", "2026-11-28T15:00:00Z");
  const strip = scoreboardTicker(RESULTS, [], new Map(), {
    upcoming: { billboard: [fri], matches: [far], local: [sat], window: WINDOW }, now: NOW, favourites: new Set(["t_fav"]),
  });
  assert.deepEqual(strip.days.map((d) => d.day), ["2026-11-22", "2026-11-23", "2026-11-27"]);
  assert.deepEqual(strip.days.at(-1).matches.map((m) => m.id), ["fri"]);
});

test("D1 one record per fixture; a result keeps its results record", () => {
  const billboard = [entry("mon2", "2026-11-23T20:00:00Z", { status: "finished", score: [2, 1] }), entry("wed", "2026-11-25T20:00:00Z", { weight: 7 })];
  const mine = [{ ...entry("wed", "2026-11-25T20:00:00Z"), weight: undefined, favourites: ["t_x"] }, entry("mon1", "2026-11-23T19:45:00Z")];
  const local = [entry("wed", "2026-11-25T20:00:00Z", { weight: 1 })];
  const strip = scoreboardTicker(RESULTS, [], new Map(), { upcoming: { billboard, matches: mine, local, window: WINDOW }, now: NOW });
  const all = strip.days.flatMap((d) => d.matches);
  assert.equal(all.filter((m) => m.id === "wed").length, 1);
  assert.equal(all.find((m) => m.id === "wed").weight, 7); // the billboard's record
  assert.equal(all.filter((m) => m.id === "mon2").length, 1);
  assert.equal(all.find((m) => m.id === "mon2").home.xg, 1.5); // the results record
  assert.equal(all.filter((m) => m.id === "mon1").length, 1);
  assert.equal(all.find((m) => m.id === "mon1").tick, undefined);
});

test("K1 a match leaves « to come » at kick-off, then in play for the live window", () => {
  const kick = "2026-11-24T19:00:00Z";
  const state = (now, status = "not_started") => {
    const strip = scoreboardTicker([], [], new Map(), { upcoming: { billboard: [entry("m", kick, { status })], window: WINDOW }, now: at(now) });
    return strip.days.flatMap((d) => d.matches).find((m) => m.id === "m")?.tick ?? null;
  };
  assert.equal(state("2026-11-24T18:59:00Z"), "upcoming");
  assert.equal(state(kick), "upcoming"); // kick-off ≥ now, as « À l'affiche »
  assert.equal(state("2026-11-24T19:01:00Z"), "live");
  assert.equal(state("2026-11-24T21:59:00Z"), "live");
  assert.equal(state("2026-11-24T22:01:00Z"), null); // past the live window, not among the results
  assert.equal(state("2026-11-24T18:00:00Z", "in_play"), "live"); // the feed says so
  assert.equal(state("2026-11-25T03:00:00Z", "in_play"), "live");
  assert.equal(state("2026-11-24T20:00:00Z", "finished"), null);
});

test("A1 the anchor: the first tick that is not finished", () => {
  const morning = scoreboardTicker(RESULTS, [], new Map(), { upcoming: { billboard: [entry("b", "2026-11-24T20:00:00Z"), entry("a", "2026-11-24T17:45:00Z")], window: WINDOW }, now: NOW });
  assert.equal(morning.anchor, "a");
  const evening = scoreboardTicker(RESULTS, [], new Map(), {
    upcoming: { billboard: [entry("b", "2026-11-24T20:00:00Z"), entry("a", "2026-11-24T17:45:00Z", { status: "in_play" })], window: WINDOW }, now: at("2026-11-24T19:00:00Z"),
  });
  assert.equal(evening.anchor, "a");
  assert.equal(scoreboardTicker(RESULTS, [], new Map(), { now: NOW }).anchor, null);
});

// ---------- The component ----------
const link = { __esModule: true, default: ({ href, children, prefetch, ...props }) => h("a", { href, ...props }, children) };
const fixtures = await src("services/fixtures.js");
const homeCommon = await compile("components/HomeCommon.jsx", { "../services/fixtures.js": fixtures });
const hrefOf = (path, params = {}) => path + "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();
const matchday = await compile("components/HomeMatchday.jsx", {
  "next/link": link,
  "./Icon.jsx": { __esModule: true, default: () => null },
  "./PhoneFold.jsx": { PhoneFoldToggle: () => null, usePhoneFold: () => ({}) },
  "./UI.jsx": { Media: ({ name }) => h("span", { className: "crest", "data-media": name }) },
  "./NationalFlag.jsx": { __esModule: true, default: ({ name }) => h("span", { className: "national-flag" }, name) },
  "../services/national-flags.js": { nationalTeamLabel: (name) => name },
  "./Hint.jsx": { Term: ({ children }) => children },
  "../hooks/FootballContext.jsx": { useFootball: () => ({ href: hrefOf }) },
  "../services/format.js": await src("services/format.js"),
  "../services/fixtures.js": fixtures,
  "../services/home-insights.js": await src("services/home-insights.js"),
  "./HomeCommon.jsx": homeCommon,
});
const { HomeTicker, anchorTicker } = matchday;
const COMPETITIONS = new Map([[UCL, { id: UCL, name: "UEFA Champions League" }], [PL, { id: PL, name: "Premier League" }]]);
const period = { start: "2026-11-23", end: "2026-11-29", current: true };
const render = (props) => renderToStaticMarkup(h(HomeTicker, { results: RESULTS, internationals: NATIONS, ranks: new Map(), competitions: COMPETITIONS, period, ...props }));

// The strip's markup on origin/main 3a9c7c5 for these inputs (HomeTicker of before), kept as the reference.
const BEFORE =
  '<nav class="home-ticker" aria-label="Résultats 23–29 nov. 2026"><span class="home-ticker-day">lun. 23 nov.</span><div class="home-tick"><a href="/matchs/?tab=results&amp;id=mon2&amp;competition=l_0bfbkO&amp;sourceSeason=2026%2F2027" class="home-tick-top"><span>LDC</span><span>Terminé</span></a><a href="/clubs/?id=t_mon2h" class="home-tick-team"><span class="crest" data-media="mon2 H"></span><span>mon2 H</span><b>2</b></a><a href="/clubs/?id=t_mon2a" class="home-tick-team is-lost"><span class="crest" data-media="mon2 A"></span><span>mon2 A</span><b>1</b></a><a href="/matchs/?tab=results&amp;id=mon2&amp;competition=l_0bfbkO&amp;sourceSeason=2026%2F2027" class="home-tick-foot" aria-label="Voir mon2 H – mon2 A"><span class="home-tick-xg" aria-hidden="true"><i style="width:75%"></i><i style="width:25%"></i></span><span class="home-tick-cap"><span>1,50 xG</span><span>0,50</span></span></a></div><div class="home-tick"><a href="/matchs/?tab=results&amp;id=mon1&amp;competition=l_4WFCIZ&amp;sourceSeason=2026%2F2027" class="home-tick-top"><span>PL</span><span>Terminé</span></a><a href="/clubs/?id=t_mon1h" class="home-tick-team"><span class="crest" data-media="mon1 H"></span><span>mon1 H</span><b>2</b></a><a href="/clubs/?id=t_mon1a" class="home-tick-team is-lost"><span class="crest" data-media="mon1 A"></span><span>mon1 A</span><b>1</b></a><a href="/matchs/?tab=results&amp;id=mon1&amp;competition=l_4WFCIZ&amp;sourceSeason=2026%2F2027" class="home-tick-foot" aria-label="Voir mon1 H – mon1 A"><span class="home-tick-xg" aria-hidden="true"><i style="width:75%"></i><i style="width:25%"></i></span><span class="home-tick-cap"><span>1,50 xG</span><span>0,50</span></span></a></div><span class="home-ticker-day">dim. 22 nov.</span><div class="home-tick"><div class="home-tick-top"><span title="Amical">Amical</span><span>Terminé</span></div><div class="home-tick-team"><span class="national-flag">Chile</span><span>Chile</span><b>0</b></div><div class="home-tick-team"><span class="national-flag">Peru</span><span>Peru</span><b>0</b></div><div class="home-tick-foot"></div></div><div class="home-tick"><a href="/matchs/?tab=results&amp;id=sun1&amp;competition=l_4WFCIZ&amp;sourceSeason=2026%2F2027" class="home-tick-top"><span>PL</span><span>Terminé</span></a><a href="/clubs/?id=t_sun1h" class="home-tick-team"><span class="crest" data-media="sun1 H"></span><span>sun1 H</span><b>2</b></a><a href="/clubs/?id=t_sun1a" class="home-tick-team is-lost"><span class="crest" data-media="sun1 A"></span><span>sun1 A</span><b>1</b></a><a href="/matchs/?tab=results&amp;id=sun1&amp;competition=l_4WFCIZ&amp;sourceSeason=2026%2F2027" class="home-tick-foot" aria-label="Voir sun1 H – sun1 A"><span class="home-tick-xg" aria-hidden="true"><i style="width:75%"></i><i style="width:25%"></i></span><span class="home-tick-cap"><span>1,50 xG</span><span>0,50</span></span></a></div><div class="home-tick"><a href="/matchs/?tab=results&amp;id=sun2&amp;competition=l_3FJFUl&amp;sourceSeason=2026%2F2027" class="home-tick-top"><span>L1</span><span>Terminé</span></a><a href="/clubs/?id=t_sun2h" class="home-tick-team"><span class="crest" data-media="sun2 H"></span><span>sun2 H</span><b>2</b></a><a href="/clubs/?id=t_sun2a" class="home-tick-team is-lost"><span class="crest" data-media="sun2 A"></span><span>sun2 A</span><b>1</b></a><a href="/matchs/?tab=results&amp;id=sun2&amp;competition=l_3FJFUl&amp;sourceSeason=2026%2F2027" class="home-tick-foot" aria-label="Voir sun2 H – sun2 A"><span class="home-tick-xg" aria-hidden="true"><i style="width:75%"></i><i style="width:25%"></i></span><span class="home-tick-cap"><span>1,50 xG</span><span>0,50</span></span></a></div></nav>';

test("B1 the rendered strip without anything to come is the one of before", () => {
  assert.equal(render({}), BEFORE);
  assert.equal(render({ now: NOW, upcoming: { billboard: [entry("mon1", "2026-11-23T19:45:00Z", { status: "finished", score: [2, 1] })], window: WINDOW } }), BEFORE);
  assert.equal(render({ now: NOW, upcoming: null }), BEFORE);
});

test("R1 a match to come: kick-off time, the « À l'affiche » link, no score; the anchor and its script", () => {
  const billboard = [entry("ars", "2026-11-24T20:00:00Z", { weight: 6, league: UCL }), entry("gal", "2026-11-24T17:45:00Z", { weight: 5, league: UCL })];
  const html = render({ now: NOW, upcoming: { billboard, window: WINDOW } });
  assert.match(html, /^<nav class="home-ticker" aria-label="Résultats et matchs à venir 23–29 nov\. 2026">/);
  // Chronological: Sunday, Monday, then Tuesday.
  const days = [...html.matchAll(/<span class="home-ticker-day">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(days, ["dim. 22 nov.", "lun. 23 nov.", "mar. 24 nov."]);
  const ticks = html.slice(0, html.indexOf("</nav>")).split('<div class="home-tick"').slice(1);
  const gal = ticks.find((t) => t.includes("id=gal"));
  const upcomingHref = "/matchs/?id=gal&amp;competition=l_0bfbkO&amp;sourceSeason=2026%2F2027&amp;from=upcoming&amp;tab=upcoming";
  assert.ok(gal.startsWith(' data-ticker-anchor="">'), "the first match to come is the anchor");
  assert.ok(gal.includes(`<a href="${upcomingHref}" class="home-tick-top"><span>LDC</span><span>18:45</span></a>`));
  assert.ok(gal.includes('<a href="/clubs/?id=t_galh" class="home-tick-team"><span class="crest" data-media="gal H"></span><span>gal H</span></a>'));
  assert.ok(!/<b>|is-lost|Terminé/.test(gal));
  assert.ok(gal.includes(`<a href="${upcomingHref}" class="home-tick-foot" aria-label="Voir gal H – gal A"></a>`));
  const ars = ticks.find((t) => t.includes("id=ars"));
  assert.ok(ars.includes("<span>21:00</span>") && !ars.includes("data-ticker-anchor"));
  assert.equal((html.slice(0, html.indexOf("</nav>")).match(/data-ticker-anchor/g) || []).length, 1);
  // One inline script, right after the nav, in a holder React leaves alone.
  const after = html.slice(html.indexOf("</nav>") + 6);
  assert.match(after, /^<div hidden=""><script>(?:(?!<\/script)[\s\S])+<\/script><\/div>$/);
});

test("R2 a match in play: « En direct », never a score", () => {
  const now = at("2026-11-24T19:30:00Z");
  const billboard = [entry("liv", "2026-11-24T17:45:00Z", { status: "in_play", score: [1, 2] }), entry("raw", "2026-11-24T19:00:00Z")];
  const html = render({ now, upcoming: { billboard, window: WINDOW } });
  const ticks = html.split('<div class="home-tick"').slice(1);
  const liv = ticks.find((t) => t.includes("id=liv")), raw = ticks.find((t) => t.includes("id=raw"));
  assert.ok(liv.includes("<span>En direct</span>") && raw.includes("<span>En direct</span>"));
  assert.ok(!liv.includes("<b>") && !raw.includes("<b>"), "no live score");
  assert.ok(!liv.includes("is-lost"));
});

// ---------- The pre-match forecast ----------
const ARS = { home: 0.7445, draw: 0.1633, away: 0.0922 }; // Real Madrid – PSV in the replay: 74,45 / 16,33 / 9,22
const tickOf = (html, id) => html.slice(0, html.indexOf("</nav>")).split('<div class="home-tick"').slice(1).find((t) => t.includes(`id=${id}`));
const capOf = (tick) => [...(tick.match(/<span class="home-tick-cap">(.*?)<\/span><\/a>/)?.[1] || "").matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]);

test("F1 shares: whole percentages that sum to 100 (largest remainder)", () => {
  assert.deepEqual(tickForecast({ forecast: ARS }), { home: 75, draw: 16, away: 9 });
  assert.deepEqual(tickForecast({ forecast: { home: 0.6743, draw: 0.1955, away: 0.1302 } }), { home: 67, draw: 20, away: 13 });
  assert.deepEqual(tickForecast({ forecast: { home: 1 / 3, draw: 1 / 3, away: 1 / 3 } }), { home: 34, draw: 33, away: 33 });
  assert.deepEqual(tickForecast({ forecast: { home: 0.505, draw: 0.25, away: 0.245 } }), { home: 51, draw: 25, away: 24 });
  assert.deepEqual(tickForecast({ forecast: { home: 0, draw: 0, away: 1 } }), { home: 0, draw: 0, away: 100 });
  // The record's own forecast first (it holds the pre-match one while the match is played), else the fixture's.
  assert.deepEqual(tickForecast({ forecast: null, fixture: { forecast: ARS } }), { home: 75, draw: 16, away: 9 });
  assert.deepEqual(tickForecast({ forecast: { home: 0.2, draw: 0.3, away: 0.5 }, fixture: { forecast: ARS } }), { home: 20, draw: 30, away: 50 });
  for (let i = 0; i < 500; i++) {
    const a = ((i * 37) % 101) / 100, b = (1 - a) * (((i * 53) % 97) / 96);
    const s = tickForecast({ forecast: { home: a, draw: b, away: 1 - a - b } });
    assert.equal(s.home + s.draw + s.away, 100, JSON.stringify([a, b]));
    assert.ok([s.home, s.draw, s.away].every((v) => Number.isInteger(v) && v >= 0));
  }
});

test("F1 a tick to come with a forecast: the bar and the three shares in its foot", () => {
  const billboard = [entry("gal", "2026-11-24T17:45:00Z", { forecast: ARS })];
  const gal = tickOf(render({ now: NOW, upcoming: { billboard, window: WINDOW } }), "gal");
  const href = "/matchs/?id=gal&amp;competition=l_0bfbkO&amp;sourceSeason=2026%2F2027&amp;from=upcoming&amp;tab=upcoming";
  const foot = gal.slice(gal.indexOf('class="home-tick-foot"') - `<a href="${href}" `.length);
  assert.equal(
    foot,
    `<a href="${href}" class="home-tick-foot" aria-label="Pronostic d’avant-match : gal H 75 %, nul 16 %, gal A 9 %">` +
      '<span class="home-tick-odds" aria-hidden="true"><i data-side="home" style="flex-grow:75"></i><i data-side="draw" style="flex-grow:16"></i><i data-side="away" style="flex-grow:9"></i></span>' +
      '<span class="home-tick-cap"><span>75 %</span><span>16 %</span><span>9 %</span></span></a></div>',
  );
  assert.deepEqual(capOf(gal).map((v) => parseInt(v, 10)).reduce((a, b) => a + b, 0), 100);
});

test("F1 a match in play shows its pre-match forecast, « En direct » on top", () => {
  const now = at("2026-11-24T19:30:00Z");
  const billboard = [entry("liv", "2026-11-24T17:45:00Z", { status: "in_play", score: [1, 2], forecast: ARS })];
  const liv = tickOf(render({ now, upcoming: { billboard, window: WINDOW } }), "liv");
  assert.ok(liv.includes("<span>En direct</span>"));
  assert.deepEqual(capOf(liv), ["75 %", "16 %", "9 %"]);
  assert.ok(liv.includes('aria-label="Pronostic d’avant-match : liv H 75 %, nul 16 %, liv A 9 %"'));
});

test("F2 no forecast, or a malformed one: the empty foot", () => {
  const malformed = [null, undefined, { home: 0.5, draw: 0.5 }, { home: 0.5, draw: 0.3, away: 0.4 }, { home: -0.1, draw: 0.6, away: 0.5 }, { home: "0.5", draw: 0.25, away: 0.25 }, { home: NaN, draw: 0.5, away: 0.5 }];
  for (const forecast of malformed) {
    assert.equal(tickForecast({ forecast, fixture: {} }), null, JSON.stringify(forecast));
    const gal = tickOf(render({ now: NOW, upcoming: { billboard: [entry("gal", "2026-11-24T17:45:00Z", { forecast })], window: WINDOW } }), "gal");
    assert.ok(gal.endsWith('class="home-tick-foot" aria-label="Voir gal H – gal A"></a></div>'), JSON.stringify(forecast));
    assert.ok(!/home-tick-odds|home-tick-cap|\d %/.test(gal));
  }
  // A favourite's match (the personal read carries no forecast).
  const mine = [{ ...entry("fav", "2026-11-25T20:00:00Z"), forecast: undefined, favourites: ["t_favh"] }];
  delete mine[0].forecast;
  const fav = tickOf(render({ now: NOW, upcoming: { billboard: [], matches: mine, window: WINDOW } }), "fav");
  assert.ok(fav.endsWith('class="home-tick-foot" aria-label="Voir fav H – fav A"></a></div>'));
});

test("F3 no score of any kind on a tick not finished", () => {
  const rich = { ...ARS, score: [2, 1], predicted_score: { home: 2, away: 1 }, home_goals: 1.84, away_goals: 0.71, xg: { home: 1.84, away: 0.71 } };
  const now = at("2026-11-24T18:30:00Z");
  const billboard = [
    entry("liv", "2026-11-24T17:45:00Z", { status: "in_play", score: [3, 0], forecast: rich }),
    entry("ars", "2026-11-24T20:00:00Z", { score: [1, 1], forecast: rich }),
  ];
  const html = render({ now, upcoming: { billboard, window: WINDOW } });
  for (const id of ["liv", "ars"]) {
    const tick = tickOf(html, id);
    assert.ok(!tick.includes("<b>"), `${id}: no team score`);
    assert.ok(!/xG|1,84|0,71|2 – 1|2-1|3 – 0/.test(tick), `${id}: no predicted score nor expected goals`);
    assert.deepEqual(capOf(tick), ["75 %", "16 %", "9 %"]);
    // Only the kick-off (or « En direct ») and the shares carry digits besides the links' ids.
    const text = tick.replace(/<[^>]+>/g, "|").replace(/aria-label="[^"]*"/g, "");
    assert.deepEqual(text.match(/\d+/g).filter((d) => !["75", "16", "9"].includes(d)), id === "ars" ? ["21", "00"] : []);
  }
});

test("F4 result ticks keep their markup beside the matches to come", () => {
  const billboard = [entry("gal", "2026-11-24T17:45:00Z", { forecast: ARS }), entry("mon2", "2026-11-23T20:00:00Z", { status: "finished", score: [2, 1], forecast: ARS })];
  const html = render({ now: NOW, upcoming: { billboard, window: WINDOW } });
  const resultTicks = BEFORE.slice(0, BEFORE.indexOf("</nav>")).split('<div class="home-tick">').slice(1).map((t) => '<div class="home-tick">' + t.replace(/<span class="home-ticker-day">[^<]*<\/span>$/, ""));
  assert.equal(resultTicks.length, 5);
  for (const t of resultTicks) assert.ok(html.includes(t), t.slice(0, 120));
  assert.equal(render({}), BEFORE);
});

test("S1 where the strip opens", () => {
  // A fake strip: day labels 20 px wide, ticks 182 px, laid out from 0.
  const strip = (kinds, width, anchorAt) => {
    let x = 0;
    const children = kinds.map((kind, i) => {
      const w = kind === "day" ? 20 : 182;
      const el = { offsetLeft: x, offsetWidth: w, classList: { contains: (c) => c === (kind === "day" ? "home-ticker-day" : "home-tick") }, hasAttribute: (a) => a === "data-ticker-anchor" && i === anchorAt };
      x += w;
      return el;
    });
    children.forEach((el, i) => (el.previousElementSibling = children[i - 1] || null));
    let left = 0;
    return {
      children, clientWidth: width, scrollWidth: x,
      get scrollLeft() { return left; },
      set scrollLeft(v) { left = Math.max(0, Math.min(v, x - width)); },
    };
  };
  // day r r r day [u] u u u day u u u u
  const kinds = ["day", "tick", "tick", "tick", "day", "tick", "tick", "tick", "tick", "day", "tick", "tick", "tick", "tick"];
  const wide = strip(kinds, 1300, 5);
  // Two ticks before the anchor: the 2nd and 3rd results (the 2nd does not open its day).
  assert.equal(anchorTicker(wide), 20 + 182);
  assert.equal(wide.scrollLeft, 202);
  assert.equal(wide.__vegaTickerLeft, 202);
  // Their day's label when the first of the two opens the day.
  assert.equal(anchorTicker(strip(["day", "tick", "tick", "day", "tick", "tick", "tick", "tick", "tick", "tick", "tick", "tick"], 1300, 4)), 0);
  assert.equal(anchorTicker(strip(["day", "tick", "tick", "tick", "day", "tick", "tick", "day", "tick", "tick", "tick", "tick", "tick", "tick"], 1300, 6)), 20 + 2 * 182);
  // A phone (358 px of strip): one tick before would push the anchor out; the anchor itself, with its day's label.
  assert.equal(anchorTicker(strip(kinds, 358, 5)), 20 + 3 * 182);
  // A 400 px strip: one result and the label before the anchor fit.
  assert.equal(anchorTicker(strip(kinds, 400, 5)), 20 + 2 * 182);
  // The anchor first: 0.
  assert.equal(anchorTicker(strip(kinds, 1300, 1)), 0);
  // No anchor: nothing moves.
  const none = strip(kinds, 1300, -1);
  none.scrollLeft = 50;
  assert.equal(anchorTicker(none), null);
  assert.equal(none.scrollLeft, 50);
});
