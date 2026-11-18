// The complementary leagues on the site (VI-19/VI-21, the user on 17 Nov 2026: « by pass the mockup and do for all of
// them directly »): every league of open-matchday the base holds (the 19 PitchAPI has not: National League, Scottish
// and Welsh divisions, Ukraine, Cyprus…) has its page, as the cups do: its standings from the results, its matches
// (each one to come with its forecast) and its projection. A league the main source holds is never listed twice.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mergeCupCatalog, supplementalLeagueCatalog } from "../dashboard/frontend/src/services/cup-catalog.js";
import { leagueTable } from "../dashboard/frontend/src/services/cup-matches.js";

const index = { meta: { source_generated_at_utc: "2026-11-17T00:00:00Z" }, competitions: [
  { folder: "ENG_5_national-league", name: "National League", country_code: "ENG", season: "2026/2027", tables: { results: { rows: 200 }, fixtures: { rows: 352 } } },
  { folder: "IRE_3_national-league", name: "League of Ireland National League", country_code: "IRE", season: "2026/2027", tables: { results: { rows: 60 }, fixtures: { rows: 2 } } },
  { folder: "KAZ_1_premier-league", name: "Kazakhstan Premier League", country_code: "KAZ", season: "2026/2027", tables: { results: { rows: 107 }, fixtures: { rows: 0 } } },
  { folder: "ENG_1_premier-league", name: "Premier League", country_code: "ENG", season: "2026/2027", tables: { results: { rows: 10 } } },
  { folder: "WAL_9_empty", name: "Empty", country_code: "WAL", season: "2026/2027", tables: { results: { rows: 0 }, fixtures: { rows: 0 } } },
  { folder: "ESP_CUP_copa-del-rey", name: "Copa del Rey", country_code: "ESP", season: "2026/2027", tables: { results: { rows: 2 } } },
] };

test("every complementary league is listed once, a league the main source holds never twice", () => {
  const native = [{ id: "l_aaaaaa", name: "Premier League", country: "ENG", seasons: ["2026/2027"] }];
  const leagues = supplementalLeagueCatalog(index, native);
  assert.deepEqual(leagues.map((l) => [l.id, l.name, l.country, l.kind, l.defaultSeason]), [
    ["open-matchday:ENG_5_national-league", "National League", "ENG", "league", "2026/2027"],
    ["open-matchday:IRE_3_national-league", "National League irlandaise", "IRL", "league", "2026/2027"],
    ["open-matchday:KAZ_1_premier-league", "Premier League du Kazakhstan", "KAZ", "league", "2026/2027"],
  ]);
  assert.ok(leagues[1].aliases.includes("League of Ireland National League"));
  const merged = mergeCupCatalog(native, index);
  assert.equal(merged.filter((c) => /Premier League$/.test(c.name) && c.country === "ENG").length, 1);
  assert.ok(merged.some((c) => c.id === "open-matchday:ENG_5_national-league"));
  assert.ok(merged.some((c) => c.id === "open-matchday:ESP_CUP_copa-del-rey" && c.kind !== "league"));
});

test("a league's standings from its results: points, goal difference, goals, then the name", () => {
  const m = (home, away, score) => ({ key: home + away, home, away, score, status: score ? "finished" : "scheduled" });
  const rows = leagueTable([m("York", "Woking", [2, 0]), m("Woking", "Barnet", [1, 1]), m("Barnet", "York", [3, 1]), m("Halifax", "York", null), m("Barnet", "Woking", [0, 0])]);
  assert.deepEqual(rows.map((r) => [r.position, r.name, r.played, r.wins, r.draws, r.losses, r.goalsFor, r.goalsAgainst, r.difference, r.points]), [
    [1, "Barnet", 3, 1, 2, 0, 4, 2, 2, 5],
    [2, "York", 2, 1, 0, 1, 3, 3, 0, 3],
    [3, "Woking", 3, 0, 2, 1, 1, 3, -2, 2],
    [4, "Halifax", 0, 0, 0, 0, 0, 0, 0, 0], // no match played yet, in the table all the same
  ]);
  assert.deepEqual(leagueTable([]), []);
});

test("a league's page: its standings, its matches, its projection, no bracket", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const require = createRequire(path.join(root, "dashboard/package.json"));
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const babel = require("next/dist/compiled/babel/core");
  const preset = require("next/dist/compiled/babel/preset-react");
  const commonjs = require("next/dist/compiled/babel/plugin-transform-modules-commonjs");
  const elem = React.createElement;
  const cupMatches = await import("../dashboard/frontend/src/services/cup-matches.js");
  const matches = [
    { key: "1", date: "2026-11-01", home: "York City", away: "Woking", score: [2, 0], status: "finished", round: "J14" },
    { key: "2", date: "2099-11-21", home: "Woking", away: "York City", score: null, status: "scheduled", round: "J16", forecast: { home: 0.3, draw: 0.3, away: 0.4 } },
  ];
  let projection = { teams: [{ id: "t_1", name: "York City", points: 3, played: 1, projectedPoints: 80, places: [0.6, 0.4] }] };
  const stubs = {
    react: React,
    "./UI.jsx": { Card: ({ children }) => elem("section", null, children), Media: () => null, Pager: () => null,
      Segments: ({ items, value }) => elem("div", { "data-value": value }, items.map(([id, text]) => elem("button", { key: id }, text))),
      AsyncState: ({ resource, children }) => children(resource.value), Empty: ({ children }) => elem("p", null, children) },
    "./KnockoutBracket.jsx": { __esModule: true, default: () => elem("div", null, "Tableau éliminatoire") },
    "./NationalFlag.jsx": { __esModule: true, default: () => null },
    "./Hint.jsx": { Term: ({ children }) => children },
    "../services/format.js": { date: String, seasonLabel: String },
    "../services/fixtures.js": { parisDay: () => "2026-11-17" },
    "../services/resources.js": { useResource: () => ({ value: { matches } }) },
    "../services/competition-artwork.js": await import("../dashboard/frontend/src/services/competition-artwork.js"),
    "../services/catalog-client.js": { cupTable: async () => [] },
    "../services/competition-selector.js": { competitionCountryLabel: () => "Angleterre" },
    "../services/cup-matches.js": cupMatches,
    "../services/knockout-bracket.js": { combineCupLegs: (m) => m, knockoutStage: () => null },
    "../services/cup-worker-client.js": { cupWorkerSnapshot: async () => ({ matches: [] }) },
    "../services/cup-archives.js": { NATIONAL_CUP_ARCHIVES: {}, GERMAN_CUP_FOLDER: "GER_CUP_dfb-pokal", isGermanCupSeason: () => false },
    "./SeasonProjection.jsx": { __esModule: true, default: () => elem("div", null, "projection") },
    "../services/cup-projection.js": { useCupProjection: () => projection },
    "../services/forecasts.js": { share: (v) => `${Math.round(v * 100)} %` },
    "./MatchForecastBar.jsx": { __esModule: true, default: () => null },
  };
  const filename = path.join(root, "dashboard/frontend/src/components/CupCompetition.jsx");
  const compiled = babel.transformSync(await fs.readFile(filename, "utf8"), { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename })((name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; }, mod, mod.exports);
  const league = { id: "open-matchday:ENG_5_national-league", name: "National League", country: "ENG", source: "open-matchday", kind: "league", folder: "ENG_5_national-league",
    seasons: ["2026/2027"], defaultSeason: "2026/2027", tables: { results: { rows: 1 }, fixtures: { rows: 1 } } };
  const html = renderToStaticMarkup(elem(mod.exports.default, { competition: league }));
  assert.match(html, /<button>Classement<\/button><button>Matchs<\/button><button>Projection<\/button>/);
  assert.doesNotMatch(html, /Tableau/);
  assert.match(html, /data-value="standings"/); // the standings first
  assert.match(html, /aria-label="Classement de la National League"/);
  assert.match(html, /York City<\/span><\/th><td>1<\/td><td>1<\/td><td>0<\/td><td>0<\/td><td>2<\/td><td>0<\/td><td>\+2<\/td><td><strong>3<\/strong>/);
  projection = null;
  assert.doesNotMatch(renderToStaticMarkup(elem(mod.exports.default, { competition: league })), /Projection/);
});
