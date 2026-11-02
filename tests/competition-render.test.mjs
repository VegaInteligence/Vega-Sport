import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const localRequire = createRequire(path.join(root, "dashboard/package.json"));
const React = localRequire("react");
const { renderToStaticMarkup } = localRequire("react-dom/server");
const babel = localRequire("next/dist/compiled/babel/core");
const preset = localRequire("next/dist/compiled/babel/preset-react");
const commonjs = localRequire("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const elem = React.createElement;

test("competition page renders a result-derived league table and its limits", async () => {
  const standings = await import("../dashboard/frontend/src/services/competition-standings.js");
  const selector = await import("../dashboard/frontend/src/services/competition-selector.js");
  const sportscore = await import("../dashboard/frontend/src/services/sportscore-standings.js");
  const ordering = await import("../dashboard/frontend/src/services/competition-matches.js");
  let forceMatchView = false;
  let forceDirectory = false, hookCount = 0;
  const reactStub = { ...React, useState: (initial) => { const [value, setValue] = React.useState(initial); hookCount++; if (forceDirectory && hookCount === 3) return [true, setValue]; return [forceMatchView && initial === "standings" ? "matches" : value, setValue]; } };
  let externalTable = null;
  const league = { id: "l_3FJFUl", name: "Ligue 1", country: "FRA", seasons: ["2026/2027", "2025/2026"] };
  const matches = [
    { id: "m_old", status: "finished", date: "2026-08-01", home_team: { id: "c", name: "Reims" }, away_team: { id: "d", name: "Nice" }, score_home: 1, score_away: 0 },
    { id: "m_1", status: "finished", date: "2026-11-01", home_team: { id: "a", name: "Paris" }, away_team: { id: "b", name: "Lille" }, score_home: 2, score_away: 0 },
    { id: "m_future", status: "not_started", date: "2026-11-08", home_team: { id: "a", name: "Paris" }, away_team: { id: "b", name: "Lille" } },
  ];
  const context = { catalog: [league], manifest: { seasons: [{ id: "2026/2027", chunks: [] }] }, season: "2026/2027", focus: "all", client: { id: 1 }, statusKnown: true, configured: false, href: (url) => url };
  const Link = ({ href, children, ...props }) => elem("a", { href, ...props }, children);
  const Card = ({ title, children }) => elem("section", null, elem("h2", null, title), children);
  const UI = { Card, Media: () => null, Pager: () => null, Segments: ({ items, value }) => elem("div", null, items.map(([id, text]) => elem("button", { key: id, "aria-pressed": value === id }, text))), Empty: ({ children }) => elem("div", null, children), AsyncState: ({ resource, children }) => children(resource.value) };
  const stubs = {
    "react": reactStub, "next/navigation": { useSearchParams: () => new URLSearchParams("id=l_3FJFUl") },
    "next/link": { __esModule: true, default: Link },
    "../components/Icon.jsx": { __esModule: true, default: () => null },
    "../components/OpenFootballArchive.jsx": { __esModule: true, default: () => null },
    "../components/Layout.jsx": { __esModule: true, default: ({ children }) => elem("main", null, children) },
    "../hooks/FootballContext.jsx": { useFootball: () => context }, "../components/UI.jsx": UI,
    "../components/MatchLink.jsx": { MatchLink: ({ match }) => elem("p", { "data-match": match.id }, match.id) },
    "../services/format.js": { normalizeText: String, seasonLabel: String, number: String, date: String },
    "../services/resources.js": { useResource: (key, _loader, enabled = true) => ({ value: key.startsWith("sportscore-standings:") && enabled && externalTable ? externalTable : { matches, source: "snapshot" } }), json: () => {}, download: () => {} },
    "../model.js": { csvString: () => "" }, "../data-url.js": { dataUrl: (x) => x },
    "../components/CompetitionScope.jsx": { __esModule: true, default: () => null },
    "../../../shared/competition-scope.js": { EUROPE_FOCUS_IDS: new Set() },
    "../services/competition-standings.js": standings,
    "../services/competition-selector.js": selector,
    "../services/sportscore-standings.js": sportscore,
    "../services/competition-matches.js": ordering,
  };
  const filename = path.join(root, "dashboard/frontend/src/views/CompetitionsPage.jsx");
  const source = await fs.readFile(filename, "utf8");
  const compiled = babel.transformSync(source, { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  const run = vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename });
  run((name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; }, mod, mod.exports);
  const html = renderToStaticMarkup(elem(mod.exports.default));
  assert.match(html, /Classement calculé à partir des résultats disponibles/);
  assert.match(html, /Championnats à la une/);
  assert.match(html, /Archives de résultats/);
  assert.match(html, /France/);
  assert.match(html, /Paris/);
  assert.match(html, /Lille/);
  assert.match(html, /sanctions/);
  assert.match(html, /<table/);

  externalTable = { tables: [
    { name: "Groupe A", rows: [{ name: "Paris", position: 1, points: 3, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0, difference: 2 }] },
    { name: "Groupe B", rows: [{ name: "Lille", position: 1, points: 3, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 1, goalsAgainst: 0, difference: 1 }] },
  ] };
  const sourced = renderToStaticMarkup(elem(mod.exports.default));
  assert.match(sourced, /Groupe A/);
  assert.match(sourced, /Groupe B/);
  assert.match(sourced, /saison non précisée/);
  context.season = "2025/2026";
  const historic = renderToStaticMarkup(elem(mod.exports.default));
  assert.doesNotMatch(historic, /Groupe A/);
  assert.match(historic, /Classement calculé à partir des résultats disponibles/);

  forceMatchView = true;
  context.season = "2026/2027";
  const resultView = renderToStaticMarkup(elem(mod.exports.default));
  assert.match(resultView, /aria-pressed="true">Résultats/);
  assert.ok(resultView.indexOf("m_1") < resultView.indexOf("m_old"));
  assert.doesNotMatch(resultView, /m_future/);

  context.catalog = [
    { id: "championship", name: "Championship", country: "ENG", seasons: [] },
    { id: "australia", name: "A-League", country: "AUS", seasons: [] },
    { id: "england", name: "Premier League", country: "ENG", seasons: [] },
    { id: "champions", name: "Champions League", country: "INT", seasons: [] },
    { id: "germany", name: "Bundesliga", country: "GER", seasons: [] },
    { id: "turkey2", name: "1. Lig", country: "INT", seasons: [] },
  ];
  context.manifest.seasons[0].chunks = [{ leagueId: "turkey2", competitions: [{ id: "turkey2", country: "TUR", seasons: [] }] }];
  forceMatchView = false;
  forceDirectory = true;
  hookCount = 0;
  const directory = renderToStaticMarkup(elem(mod.exports.default));
  assert.ok(directory.indexOf(">International</h2>") < directory.indexOf(">Allemagne</h2>"));
  assert.ok(directory.indexOf(">Allemagne</h2>") < directory.indexOf(">Angleterre</h2>"));
  assert.ok(directory.indexOf(">Premier League</h3>") < directory.indexOf(">Championship</h3>"));
  assert.ok(directory.indexOf(">Angleterre</h2>") < directory.indexOf(">Australie</h2>"));
  assert.ok(directory.indexOf(">Turquie</h2>") < directory.indexOf(">1. Lig</h3>"));


});
