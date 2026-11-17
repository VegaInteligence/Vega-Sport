// Every competition has its predictions (VI-19, 17 Nov 2026; mockup validated): a match still to play in a cup or a
// complementary league's list carries the model's forecast (the API's `forecast`: home, draw, away), drawn as a bar of
// three parts and the three shares. A played match never shows one; a forecast that is not three shares is ignored.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { matchForecast, normalizeOpenCup, normalizeSupplementalCup } from "../dashboard/frontend/src/services/cup-matches.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "dashboard/package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const preset = require("next/dist/compiled/babel/preset-react");
const commonjs = require("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const elem = React.createElement;
const forecast = { home: 0.9112, draw: 0.0634, away: 0.0254 };

test("a forecast is three shares or nothing", () => {
  assert.deepEqual(matchForecast(forecast), forecast);
  assert.equal(matchForecast(null), null);
  assert.equal(matchForecast({ home: 0.5, draw: 0.5 }), null);
  assert.equal(matchForecast({ home: 0.9, draw: 0.9, away: 0.9 }), null); // not a law of three outcomes
  assert.equal(matchForecast({ home: "0.5", draw: 0.25, away: 0.25 }), null);
});

test("the normalised matches keep a fixture's forecast, never a result's", () => {
  const [result, fixture] = normalizeSupplementalCup(
    [{ home: "Aldershot", away: "Yeovil", date: "2026-11-14", ft_home: "1", ft_away: "0", forecast }],
    [{ home: "Yeovil", away: "Aldershot", date: "2026-11-21", gw: "16", forecast }],
  );
  assert.equal(result.forecast, undefined);
  assert.deepEqual(fixture.forecast, forecast);
  const [played, coming] = normalizeOpenCup([
    { date: "2026-08-12", team1: "A", team2: "B", score: { ft: [1, 0] }, forecast },
    { date: "2026-12-02", team1: "C", team2: "D", forecast },
  ]);
  assert.equal(played.forecast, undefined);
  assert.deepEqual(coming.forecast, forecast);
  assert.equal(normalizeOpenCup([{ date: "2026-12-02", team1: "C", team2: "D" }])[0].forecast, undefined);
});

test("an upcoming match shows its forecast in the list, a played one its score", async () => {
  const cupMatches = await import("../dashboard/frontend/src/services/cup-matches.js");
  const forecasts = await import("../dashboard/frontend/src/services/forecasts.js");
  const stubs = {
    react: React,
    "./UI.jsx": { Card: ({ children }) => elem("section", null, children), Media: () => null, Pager: () => null, Segments: () => null, AsyncState: () => null, Empty: ({ children }) => elem("p", null, children) },
    "./KnockoutBracket.jsx": { __esModule: true, default: () => null },
    "./NationalFlag.jsx": { __esModule: true, default: () => null },
    "../services/format.js": { date: String, seasonLabel: String },
    "../services/fixtures.js": { parisDay: () => "2026-11-17" },
    "../services/resources.js": { useResource: () => ({}) },
    "../services/catalog-client.js": { cupTable: async () => [] },
    "../services/competition-selector.js": { competitionCountryLabel: () => "" },
    "../services/cup-matches.js": cupMatches,
    "../services/knockout-bracket.js": { combineCupLegs: (m) => m, knockoutStage: () => null },
    "../services/cup-worker-client.js": { cupWorkerSnapshot: async () => ({ matches: [] }) },
    "../services/cup-archives.js": { NATIONAL_CUP_ARCHIVES: {}, GERMAN_CUP_FOLDER: "GER_CUP_dfb-pokal", isGermanCupSeason: () => false },
    "./SeasonProjection.jsx": { __esModule: true, default: () => null },
    "../services/cup-projection.js": { useCupProjection: () => null },
    "./Hint.jsx": { Term: ({ children }) => children },
    "../services/forecasts.js": forecasts,
  };
  const filename = path.join(root, "dashboard/frontend/src/components/CupCompetition.jsx");
  const compiled = babel.transformSync(await fs.readFile(filename, "utf8"), { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename })((name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; }, mod, mod.exports);
  const matches = [
    { key: "a", date: "2099-12-02", home: "Bayern München", away: "Hertha BSC", score: null, status: "scheduled", round: "8es", forecast },
    { key: "b", date: "2099-12-02", home: "Bochum", away: "Augsburg", score: null, status: "scheduled", round: "8es" },
    { key: "c", date: "2026-10-28", home: "Bochum", away: "Köln", score: [2, 1], status: "finished", round: "16es", forecast },
  ];
  const coming = renderToStaticMarkup(elem(mod.exports.CupMatchList, { matches, status: "scheduled", query: "", page: 1, onPage: () => {} }));
  assert.match(coming, /class="cup-match-forecast" role="img" aria-label="Bayern München 91 %, Nul 6 %, Hertha BSC 3 %"/);
  assert.equal((coming.match(/cup-match-forecast"/g) || []).length, 1); // the match without a forecast shows none
  const played = renderToStaticMarkup(elem(mod.exports.CupMatchList, { matches, status: "finished", query: "", page: 1, onPage: () => {} }));
  assert.doesNotMatch(played, /cup-match-forecast/);
  assert.match(played, /2 – 1/);
});

test("a complementary league's projection has its tab, as a league's", async () => {
  // open-matchday's leagues are replayed to their end like any league (VI-19): the « Projection » tab shows the
  // league projection, not only a knockout cup's.
  const cupMatches = await import("../dashboard/frontend/src/services/cup-matches.js");
  let projection = { competition: "l_v0000099", season: "2026/2027", teams: [{ id: "t_1", name: "York City", points: 30, played: 15, projectedPoints: 80, places: [0.4, 0.3] }] };
  const stubs = {
    react: React,
    "./UI.jsx": { Card: ({ children }) => elem("section", null, children), Media: () => null, Pager: () => null,
      Segments: ({ items }) => elem("div", null, items.map(([id, text]) => elem("button", { key: id }, text))), AsyncState: () => null, Empty: () => null },
    "./KnockoutBracket.jsx": { __esModule: true, default: () => null },
    "./NationalFlag.jsx": { __esModule: true, default: () => null },
    "../services/format.js": { date: String, seasonLabel: String },
    "../services/fixtures.js": { parisDay: () => "2026-11-17" },
    "../services/resources.js": { useResource: () => ({}) },
    "../services/catalog-client.js": { cupTable: async () => [] },
    "../services/competition-selector.js": { competitionCountryLabel: () => "" },
    "../services/cup-matches.js": cupMatches,
    "../services/knockout-bracket.js": { combineCupLegs: (m) => m, knockoutStage: () => null },
    "../services/cup-worker-client.js": { cupWorkerSnapshot: async () => ({ matches: [] }) },
    "../services/cup-archives.js": { NATIONAL_CUP_ARCHIVES: {}, GERMAN_CUP_FOLDER: "GER_CUP_dfb-pokal", isGermanCupSeason: () => false },
    "./SeasonProjection.jsx": { __esModule: true, default: () => null },
    "../services/cup-projection.js": { useCupProjection: () => projection },
    "./Hint.jsx": { Term: ({ children }) => children },
    "../services/forecasts.js": { share: String },
  };
  const filename = path.join(root, "dashboard/frontend/src/components/CupCompetition.jsx");
  const compiled = babel.transformSync(await fs.readFile(filename, "utf8"), { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename })((name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; }, mod, mod.exports);
  const league = { id: "open-matchday:ENG_5_national-league", name: "National League", source: "open-matchday", folder: "ENG_5_national-league", seasons: ["2026/2027"], defaultSeason: "2026/2027" };
  assert.match(renderToStaticMarkup(elem(mod.exports.default, { competition: league })), /<button>Projection<\/button>/);
  projection = null;
  assert.doesNotMatch(renderToStaticMarkup(elem(mod.exports.default, { competition: league })), /Projection/);
});
