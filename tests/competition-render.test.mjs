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
  const cups = await import("../dashboard/frontend/src/services/cup-catalog.js");
  let requestedId = "l_3FJFUl";
  let forceMatchView = false, forceBracketView = false;
  let forceDirectory = false, hookCount = 0;
  const reactStub = { ...React, useState: (initial) => { const [value, setValue] = React.useState(initial); hookCount++; if (forceDirectory && hookCount === 3) return [true, setValue]; return [forceBracketView && initial === "standings" ? "bracket" : forceMatchView && initial === "standings" ? "matches" : value, setValue]; } };
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
    "react": reactStub, "next/navigation": { useSearchParams: () => new URLSearchParams({ id: requestedId }) },
    "next/link": { __esModule: true, default: Link },
    "../components/Icon.jsx": { __esModule: true, default: () => null },
    "../components/CupCompetition.jsx": { __esModule: true, default: ({ competition }) => elem("section", { "data-cup-id": competition.id }, competition.name) },
    "../components/NativeKnockoutBracket.jsx": { __esModule: true, default: ({ competition }) => elem("section", { "data-native-bracket": competition.id }, "Tableau éliminatoire") },
    "../components/CompetitionHighlights.jsx": { __esModule: true, default: ({ season }) => elem("aside", { "data-highlights-season": season }, "Prochains matchs et derniers résultats") },
    "../components/Layout.jsx": { __esModule: true, default: ({ children, showSeasonContext = true, showDataContext = true }) => elem("main", { "data-season-context": String(showSeasonContext), "data-data-context": String(showDataContext) }, children) },
    "../hooks/FootballContext.jsx": { useFootball: () => context }, "../components/UI.jsx": UI,
    "../components/MatchLink.jsx": { MatchLink: ({ match }) => elem("p", { "data-match": match.id }, match.id) },
    "../components/MatchdaySchedule.jsx": { __esModule: true, default: ({ matches, initialStatus }) => elem("section", { "data-matchday-status": initialStatus }, matches.map((match) => elem("p", { key: match.id, "data-match": match.id }, match.id))) },
    "../services/format.js": { normalizeText: String, seasonLabel: String, number: String, date: String },
    "../services/resources.js": { useResource: (key, _loader, enabled = true) => ({ value: key === "supplemental-cup-index" ? { competitions: [{ folder: "ESP_CUP_copa-del-rey", name: "Copa del Rey", country_code: "ESP", tables: { results: { path: "raw/seasons/2026-2027/x.gz", rows: 1 } } }, { folder: "SUI_CUP_swiss-cup", name: "Swiss Cup", country_code: "SUI", tables: { results: { path: "raw/seasons/2026-2027/y.gz", rows: 1 } } }] } : key.startsWith("sportscore-standings:") && enabled && externalTable ? externalTable : { matches, source: "snapshot" } }), json: () => {}, download: () => {} },
    "../model.js": { csvString: () => "" }, "../data-url.js": { dataUrl: (x) => x },
    "../components/CompetitionScope.jsx": { __esModule: true, default: () => null },
    "../../../shared/competition-scope.js": { EUROPE_FOCUS_IDS: new Set() },
    "../services/competition-standings.js": standings,
    "../services/competition-selector.js": selector,
    "../services/cup-catalog.js": cups,
    "../services/sportscore-standings.js": sportscore,
    "../services/competition-matches.js": ordering,
  };
  stubs["./UI.jsx"] = UI;
  const standingsFile = path.join(root, "dashboard/frontend/src/components/CompetitionStandings.jsx");
  const standingsSource = await fs.readFile(standingsFile, "utf8");
  const standingsCode = babel.transformSync(standingsSource, { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename: standingsFile }).code;
  const standingsModule = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + standingsCode + "\n})", { filename: standingsFile })(
    (name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; },
    standingsModule, standingsModule.exports,
  );
  stubs["../components/CompetitionStandings.jsx"] = { __esModule: true, default: standingsModule.exports.default };
  const filename = path.join(root, "dashboard/frontend/src/views/CompetitionsPage.jsx");
  const source = await fs.readFile(filename, "utf8");
  const compiled = babel.transformSync(source, { presets: [[preset, { runtime: "classic" }]], plugins: [commonjs], babelrc: false, configFile: false, filename }).code;
  const mod = { exports: {} };
  const run = vm.runInThisContext("(function(require,module,exports){" + compiled + "\n})", { filename });
  run((name) => { if (!(name in stubs)) throw Error("Unexpected import " + name); return stubs[name]; }, mod, mod.exports);
  const html = renderToStaticMarkup(elem(mod.exports.default));
  assert.match(html, /Classement calculé à partir des résultats disponibles/);
  assert.match(html, /Championnats à la une/);
  assert.match(html, /Coupes internationales/);
  assert.match(html, /Coupe du monde/);
  assert.match(html, /Euro/);
  assert.match(html, /Coupe du Roi/);
  assert.match(html, /Coupe de France/);
  const nationalPicker = html.match(/<select aria-labelledby="national-cups-label"[\s\S]*?<\/select>/)?.[0];
  assert.ok(nationalPicker, "national cups have a labelled selector");
  assert.match(nationalPicker, /<optgroup label="Espagne">[\s\S]*Coupe du Roi/);
  assert.match(nationalPicker, /<optgroup label="France">[\s\S]*Coupe de France · Archive 2024\/2025/);
  assert.match(nationalPicker, /<optgroup label="Suisse">[\s\S]*Coupe de Suisse/);
  assert.ok(nationalPicker.indexOf("Espagne") < nationalPicker.indexOf("France"));
  assert.ok(nationalPicker.indexOf("France") < nationalPicker.indexOf("Suisse"));
  assert.match(html, /<a[^>]*href="\/archives\/"[^>]*>Archives<\/a>/);
  assert.doesNotMatch(html, /Archives de buts/);
  assert.ok(html.indexOf(">Archives</a>") < html.indexOf("Toutes les compétitions"));
  assert.match(html, /France/);
  assert.match(html, /Paris/);
  assert.match(html, /Lille/);
  assert.match(html, /sanctions/);
  assert.match(html, /<table/);
  assert.match(html, /data-highlights-season="2026\/2027"/);

  externalTable = { tables: [
    { name: "Groupe A", rows: [{ name: "Paris", position: 1, points: 3, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0, difference: 2 }] },
    { name: "Groupe B", rows: [{ name: "Lille", position: 1, points: 3, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 1, goalsAgainst: 0, difference: 1 }] },
  ] };
  const sourced = renderToStaticMarkup(elem(mod.exports.default));
  assert.match(sourced, /Groupe A/);
  assert.match(sourced, /Groupe B/);
  assert.doesNotMatch(sourced, /Les classements SportScore et les matchs PitchAPI/);
  context.season = "2025/2026";
  const historic = renderToStaticMarkup(elem(mod.exports.default));
  assert.doesNotMatch(historic, /Groupe A/);
  assert.match(historic, /Classement calculé à partir des résultats disponibles/);

  requestedId = "open-cup:euro";
  context.focus = "europe";
  const euro = renderToStaticMarkup(elem(mod.exports.default));
  assert.match(euro, /data-cup-id="open-cup:euro"/);
  assert.match(euro, /data-season-context="false"/);
  assert.match(euro, /data-data-context="false"/);
  requestedId = "open-matchday:ESP_CUP_copa-del-rey";
  context.focus = "all";
  const spanishCup = renderToStaticMarkup(elem(mod.exports.default));
  assert.match(spanishCup, /data-cup-id="open-matchday:ESP_CUP_copa-del-rey"/);
  assert.match(spanishCup, /<option value="open-matchday:ESP_CUP_copa-del-rey" selected=""/);
  requestedId = "l_1XLtP0";
  forceBracketView = true;
  const worldBracket = renderToStaticMarkup(elem(mod.exports.default));
  assert.match(worldBracket, /data-native-bracket="l_1XLtP0"/);
  assert.match(worldBracket, /Tableau éliminatoire/);
  forceBracketView = false;
  requestedId = "l_3FJFUl";

  forceMatchView = true;
  context.season = "2026/2027";
  const resultView = renderToStaticMarkup(elem(mod.exports.default));
  assert.match(resultView, /data-matchday-status="finished"/);
  assert.match(resultView, /data-match="m_1"/);
  assert.match(resultView, /data-match="m_old"/);
  assert.match(resultView, /data-match="m_future"/);
  assert.doesNotMatch(resultView, /data-highlights-season/);

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
  assert.ok(directory.indexOf(">Australie</h2>") < directory.indexOf(">International</h2>"));
  assert.ok(directory.indexOf(">Allemagne</h2>") < directory.indexOf(">Angleterre</h2>"));
  assert.ok(directory.indexOf(">Premier League</h3>") < directory.indexOf(">Championship</h3>"));
  assert.ok(directory.indexOf(">Angleterre</h2>") < directory.indexOf(">Australie</h2>"));
  assert.ok(directory.indexOf(">Turquie</h2>") < directory.indexOf(">1. Lig</h3>"));


});
