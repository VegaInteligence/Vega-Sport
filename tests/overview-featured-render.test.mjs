import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLocal = createRequire(path.join(root, "dashboard/package.json"));
const React = requireLocal("react");
const { renderToStaticMarkup } = requireLocal("react-dom/server");
const babel = requireLocal("next/dist/compiled/babel/core");
const preset = requireLocal("next/dist/compiled/babel/preset-react");
const commonjs = requireLocal(
  "next/dist/compiled/babel/plugin-transform-modules-commonjs",
);
const h = React.createElement;

test("home promotes a recent major-club match within the followed competitions", async () => {
  const home = await import("../dashboard/frontend/src/services/home.js");
  const braga = {
    id: "braga",
    leagueId: "por",
    league: "Liga Portugal",
    date: "2026-11-01",
    timeUtc: "2026-11-01T21:15:00Z",
    status: "finished",
    home: { id: "braga", name: "Braga", score: 3 },
    away: { id: "fama", name: "Famalicão", score: 0 },
  };
  const arsenal = {
    id: "arsenal-match",
    leagueId: "eng",
    league: "Premier League",
    date: "2026-11-01",
    timeUtc: "2026-11-01T16:30:00Z",
    status: "finished",
    home: { id: "t_0BrMnM", name: "Liverpool", score: 0 },
    away: { id: "t_1gkhxH", name: "Arsenal", score: 1 },
  };
  const context = {
    preferences: { favoriteLeagueIds: [] },
    matches: [braga, arsenal],
    rows: [],
    data: { meta: {} },
    season: "2026/2027",
    manifest: { defaultSeason: "2026/2027" },
    href: (url, params = {}) => url + "?" + new URLSearchParams(params),
    setPlayer: () => {},
  };
  const reactStub = {
    ...React,
    useState: (initial) =>
      React.useState(
        typeof initial === "function"
          ? () => Date.parse("2026-11-02T12:00:00Z")
          : initial,
      ),
  };
  const Link = ({ href, children, ...props }) =>
    h("a", { href, ...props }, children);
  const stubs = {
    react: reactStub,
    "next/link": { __esModule: true, default: Link },
    "../components/Layout.jsx": {
      __esModule: true,
      default: ({ children }) => h("main", null, children),
    },
    "../components/Icon.jsx": { __esModule: true, default: () => null },
    "../hooks/FootballContext.jsx": { useFootball: () => context },
    "../components/UI.jsx": {
      Card: ({ title, children }) =>
        h("section", null, h("h2", null, title), children),
      Segments: () => null,
      Rating: () => null,
      Media: () => null,
      Empty: ({ children }) => h("div", null, children),
    },
    "../components/Charts.jsx": { DeferredScatterPlot: () => null },
    "../services/format.js": { number: String, date: String },
    "../model.js": {
      isNumber: (x) => typeof x === "number",
      topRows: () => [],
    },
    "../components/MatchLink.jsx": { MatchLink: () => null },
    "../components/UpcomingMatches.jsx": {
      __esModule: true,
      default: () => null,
    },
    "../components/HomePreferences.jsx": {
      __esModule: true,
      default: () => null,
    },
    "../services/home.js": home,
  };
  const filename = path.join(
    root,
    "dashboard/frontend/src/views/OverviewPage.jsx",
  );
  const source = await fs.readFile(filename, "utf8");
  const compiled = babel.transformSync(source, {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  const run = vm.runInThisContext(
    "(function(require,module,exports){" + compiled + "\n})",
    { filename },
  );
  run(
    (name) => {
      if (!(name in stubs)) throw Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );

  const rendered = renderToStaticMarkup(h(mod.exports.default));
  const featured =
    rendered.match(
      /<section class="hero-strip featured-match"[\s\S]*?<\/section>/,
    )?.[0] || "";
  assert.match(featured, /Liverpool/);
  assert.match(featured, /Arsenal/);
  assert.match(featured, /arsenal-match/);
  assert.doesNotMatch(featured, /Braga/);

  context.preferences.favoriteLeagueIds = ["por"];
  const onlyPortugal = renderToStaticMarkup(h(mod.exports.default));
  const portugalFeatured =
    onlyPortugal.match(
      /<section class="hero-strip featured-match"[\s\S]*?<\/section>/,
    )?.[0] || "";
  assert.equal(portugalFeatured, "");

  context.matches = [
    braga,
    arsenal,
    {
      ...braga,
      id: "porto",
      date: "2026-10-31",
      timeUtc: "2026-10-31T20:00:00Z",
      home: { id: "t_0dVrhE", name: "FC Porto", score: 4 },
    },
  ];
  const withPorto = renderToStaticMarkup(h(mod.exports.default));
  const portoFeatured =
    withPorto.match(
      /<section class="hero-strip featured-match"[\s\S]*?<\/section>/,
    )?.[0] || "";
  assert.match(portoFeatured, /FC Porto/);
  assert.doesNotMatch(portoFeatured, /Braga/);
});
