// The standings tab of a match page: the table is the one the API serves for the match's
// season, read in one request; the season's fixtures are only loaded when there is none.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "dashboard/package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const babel = require("next/dist/compiled/babel/core");
const preset = require("next/dist/compiled/babel/preset-react");
const commonjs = require("next/dist/compiled/babel/plugin-transform-modules-commonjs");
const e = React.createElement;

async function load(file, stubs) {
  const filename = path.join(root, file);
  const code = babel.transformSync(await fs.readFile(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", { filename })(
    (name) => {
      if (!(name in stubs)) throw new Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const football = () => ({
  season: "2026/2027",
  statusKnown: true,
  catalog: [],
  data: { competitions: [] },
  manifest: { seasons: [{ id: "2025/2026", chunks: [] }, { id: "2026/2027", chunks: [] }], publicationVersion: "42" },
  client: { fixtures: new Map(), catalog: [] },
  href: (url, params) => url + "?" + new URLSearchParams(Object.entries(params).filter(([, value]) => value !== "")),
});

/** CompetitionStandings with its real services; reads are recorded, never sent. */
async function standings(table, reads) {
  const stubs = {
    react: React,
    "next/link": { __esModule: true, default: ({ href, children, ...props }) => e("a", { href, ...props }, children) },
    "../hooks/FootballContext.jsx": { useFootball: football },
    "./UI.jsx": { Empty: ({ children }) => e("div", { "data-empty": "" }, children), Media: () => null },
    "./NationalFlag.jsx": { __esModule: true, default: () => null },
    "../services/national-flags.js": { nationalFlagCode: () => null },
    "../services/format.js": { normalizeText: (value) => String(value).toLowerCase(), number: String, date: String, seasonLabel: String },
    "../services/resources.js": {
      useResource: (key, loader, enabled = true) => {
        if (!key.startsWith("sportscore-")) return {};
        reads.push({ key, enabled });
        if (!enabled) return { loading: true };
        loader();
        return table ? { value: { tables: [table] } } : { value: { tables: [] } };
      },
      json: (url) => reads.push({ url }),
    },
    "../services/sportscore-standings.js": await import("../dashboard/frontend/src/services/sportscore-standings.js"),
    "../services/uefa-standings.js": await import("../dashboard/frontend/src/services/uefa-standings.js"),
    "../services/standings-clubs.js": await import("../dashboard/frontend/src/services/standings-clubs.js"),
    "../services/cup-worker-client.js": { cupWorkerSnapshot: async (...args) => reads.push({ cup: args }) },
    "../services/cup-catalog.js": { WORLD_CUP_ID: "l_1XLtP0" },
    "../services/catalog-client.js": { associationRanking: async () => [] },
    "../services/competition-selector.js": { FEATURED_EUROPE_IDS: ["l_0bfbkO"], competitionCountry: () => "", isTopFlight: () => false },
    "../data-url.js": { dataUrl: (value) => value },
    "../hooks/ResearchContext.jsx": { useResearch: () => null },
    "../services/standings-zones.js": await import("../dashboard/frontend/src/services/standings-zones.js"),
    "../services/competition-standings.js": await import("../dashboard/frontend/src/services/competition-standings.js"),
  };
  return (await load("dashboard/frontend/src/components/CompetitionStandings.jsx", stubs)).default;
}

const ROWS = [
  { id: "t_aaaaaa", name: "Alpha", imageUrl: null, position: 1, points: 89, played: 34, wins: 28, draws: 5, losses: 1, goalsFor: 122, goalsAgainst: 36, difference: 86 },
  { id: "t_bbbbbb", name: "Bravo", imageUrl: null, position: 2, points: 73, played: 34, wins: 22, draws: 7, losses: 5, goalsFor: 70, goalsAgainst: 34, difference: 36 },
];
const BUNDESLIGA = { id: "l_1Isor4", name: "Bundesliga", seasons: ["2026/2027", "2025/2026"] };

test("a past season's table is read from the API, and its rows link to their club without any fixture", async () => {
  const reads = [];
  const Standings = await standings({ name: null, rows: ROWS }, reads);
  const html = renderToStaticMarkup(
    e(Standings, { competition: BUNDESLIGA, season: "2025/2026", matches: [], served: true, highlightTeams: [{ id: "t_bbbbbb", name: "Bravo" }] }),
  );
  assert.deepEqual(reads.filter((r) => r.url).map((r) => r.url), ["/api/standings?competition=l_1Isor4&season=2025%2F2026"]);
  assert.equal(reads.find((r) => r.key).enabled, true);
  assert.match(html, /<a[^>]*id=t_aaaaaa[^>]*>[^<]*<span>Alpha<\/span><\/a>/);
  assert.match(html, /<tr[^>]*data-match-team="true"[^>]*>(?:(?!<\/tr>).)*Bravo/s);
  assert.doesNotMatch(html, /<tr[^>]*data-match-team="true"[^>]*>(?:(?!<\/tr>).)*Alpha/s);
  assert.match(html, />89</);
});

test("the current season keeps its read without a season; a cup is not read this way", async () => {
  const reads = [];
  const Standings = await standings({ name: null, rows: ROWS }, reads);
  renderToStaticMarkup(e(Standings, { competition: BUNDESLIGA, season: "2026/2027", matches: [], served: true }));
  assert.deepEqual(reads.filter((r) => r.url).map((r) => r.url), ["/api/standings?competition=l_1Isor4"]);
  reads.length = 0;
  // A European cup of a past season: not the served league table.
  renderToStaticMarkup(
    e(Standings, { competition: { id: "l_0bfbkO", name: "Champions League", seasons: ["2026/2027", "2019/2020"] }, season: "2019/2020", matches: [], served: true }),
  );
  assert.equal(reads.some((r) => r.url), false);
});

test("without the option nothing changes: a past league season is not read from the API", async () => {
  const reads = [];
  const Standings = await standings({ name: null, rows: ROWS }, reads);
  renderToStaticMarkup(e(Standings, { competition: BUNDESLIGA, season: "2025/2026", matches: [] }));
  assert.equal(reads.find((r) => r.key).enabled, false);
  assert.equal(reads.some((r) => r.url), false);
});

test("a match page asks for the served table and does not load the season's fixtures first", async () => {
  const resources = [];
  let props;
  const MatchStandings = (
    await load("dashboard/frontend/src/components/MatchStandings.jsx", {
      react: React,
      "../hooks/FootballContext.jsx": { useFootball: football },
      "../services/resources.js": {
        useResource: (key, loader, enabled = true) => {
          resources.push({ key, enabled });
          return { loading: true };
        },
      },
      "../services/match-resources.js": {
        matchReadSource: () => "native",
        matchResourceKey: (_manifest, kind, subject, ...rest) => [kind, subject.id, ...rest].join(":"),
        validateMatchPublication: () => {},
      },
      "../season_data.js": { loadSeason: async () => ({}) },
      "../services/format.js": { seasonLabel: String },
      "../services/competition-selector.js": { competitionLabel: (c) => c.name },
      "./CompetitionStandings.jsx": {
        __esModule: true,
        default: (received) => {
          props = received;
          return e("div", { "data-standings": "" });
        },
      },
      "./UI.jsx": { Card: ({ children }) => e("section", null, children), Empty: ({ children }) => e("div", null, children) },
    })
  ).default;
  const html = renderToStaticMarkup(
    e(MatchStandings, {
      match: { id: "m_000001", leagueId: "l_1Isor4", league: "Bundesliga", season: "2025/2026", home: { id: "t_aaaaaa", name: "Alpha" }, away: { id: "t_bbbbbb", name: "Bravo" } },
    }),
  );
  assert.match(html, /data-standings/);
  assert.equal(resources.length, 1);
  assert.equal(resources[0].enabled, false, "the fixtures wait until the table asks for them");
  assert.equal(props.served, true);
  assert.equal(typeof props.onNeedFixtures, "function");
  assert.equal(props.fixturesLoading, false);
  assert.deepEqual(props.matches, []);
  assert.deepEqual(props.highlightTeams.map((t) => t.id), ["t_aaaaaa", "t_bbbbbb"]);
});
