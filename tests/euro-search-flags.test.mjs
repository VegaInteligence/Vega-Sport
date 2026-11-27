import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { nationalFlagCode } from "../dashboard/frontend/src/services/national-flags.js";
import {
  buildSearchIndex,
  globalCompetitionCatalog,
  searchIndex,
  searchedEdition,
} from "../dashboard/frontend/src/services/global-search.js";
import * as cupMatches from "../dashboard/frontend/src/services/cup-matches.js";
import * as cupArchives from "../dashboard/frontend/src/services/cup-archives.js";
const { normalizeOpenCup } = cupMatches;
import * as bracket from "../dashboard/frontend/src/services/knockout-bracket.js";
import { normalizeText } from "../dashboard/frontend/src/model.js";
import { editionHeaderStub } from "./edition-stubs.mjs";
import * as nationalFlags from "../dashboard/frontend/src/services/national-flags.js";
import * as trophies from "../dashboard/frontend/src/services/trophy-art.js";

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
  vm.runInThisContext("(function(require,module,exports){" + code + "\n})", {
    filename,
  })(
    (name) => {
      if (!(name in stubs)) throw new Error("Unexpected import: " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

test("the navbar catalogue finds Euro and its editions independently of the active season", () => {
  const catalog = globalCompetitionCatalog([
    { id: "l_abc123", name: "Europa League", country: "UEFA" },
  ]);
  const index = buildSearchIndex({ appearances: [], matches: [] }, catalog);
  const euro = searchIndex(index, "Euro").competitions[0];
  assert.equal(euro.id, "open-cup:euro");
  assert.equal(searchIndex(index, "Euro 2024").competitions[0].id, euro.id);
  assert.equal(searchIndex(index, "Euro2024").competitions[0].id, euro.id);
  assert.equal(searchedEdition(euro, "Euro 2024"), "2024");
  assert.equal(searchedEdition(euro, "Euro2024"), "2024");
  assert.equal(searchedEdition(euro, "Euro 2020"), "2020");
  assert.equal(
    searchIndex(index, "Championnat d'Europe").competitions[0].id,
    euro.id,
  );
  assert.equal(
    searchIndex(index, "European Championship").competitions[0].id,
    euro.id,
  );
  assert.equal(catalog.filter((item) => item.id === euro.id).length, 1);
});

test("all 24 Euro 2024 countries resolve to locally available flags", async () => {
  const countries = [
    "Albania",
    "Austria",
    "Belgium",
    "Croatia",
    "Czech Republic",
    "Denmark",
    "England",
    "France",
    "Georgia",
    "Germany",
    "Hungary",
    "Italy",
    "Netherlands",
    "Poland",
    "Portugal",
    "Romania",
    "Scotland",
    "Serbia",
    "Slovakia",
    "Slovenia",
    "Spain",
    "Switzerland",
    "Turkey",
    "Ukraine",
  ];
  for (const name of countries) {
    const code = nationalFlagCode(name, "2024");
    assert.ok(code, name);
    await fs.access(
      path.join(
        root,
        "dashboard/node_modules/flag-icons/flags/4x3",
        code + ".svg",
      ),
    );
  }
  assert.equal(nationalFlagCode("Espagne", "2024"), "es");
  assert.equal(nationalFlagCode("Géorgie", "2024"), "ge");
  assert.equal(nationalFlagCode("Yugoslavia", "1998"), "yu-1992");
  assert.equal(nationalFlagCode("Serbia and Montenegro", "2006"), "yu-1992");
  // The old editions have their flags too (18 Nov 2026): the star of 1946–1991 here.
  assert.equal(nationalFlagCode("Yugoslavia", "1990"), "yu-1946");
  assert.equal(nationalFlagCode("Yugoslavia", "2018"), null);
  assert.equal(nationalFlagCode("Winner Match 45", "2028"), null);
  assert.equal(nationalFlagCode("Unknown", "2028"), null);
  assert.equal(nationalFlagCode("Spain", "1950"), "es");
});

test("Spain–Georgia displays both flags in the national bracket, never in a club bracket", async () => {
  const flag = await load(
    "dashboard/frontend/src/components/NationalFlag.jsx",
    {
      react: React,
      "flag-icons/css/flag-icons.min.css": {},
      "../services/national-flags.js": { nationalFlagCode },
    },
  );
  const mod = await load(
    "dashboard/frontend/src/components/KnockoutBracket.jsx",
    {
      react: React,
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) => h("a", props, children),
      },
      "./UI.jsx": {
        Empty: ({ children }) => h("p", null, children),
        Media: () => null,
      },
      "../services/format.js": { date: String },
      "../model.js": { normalizeText },
      "../services/knockout-bracket.js": bracket,
      "../services/cup-matches.js": cupMatches,
      "../services/national-flags.js": nationalFlags,
      "./NationalFlag.jsx": { __esModule: true, default: flag.default },
    },
  );
  const matches = normalizeOpenCup([
    {
      date: "2024-06-30",
      round: "Round of 16",
      team1: "Spain",
      team2: "Georgia",
      score: { ft: [4, 1] },
    },
  ]);
  const national = renderToStaticMarkup(
    h(mod.default, { matches, nationalTeams: true, season: "2024" }),
  );
  assert.match(national, /fi-es/);
  assert.match(national, /fi-ge/);
  // A national team is named in French, as on its own page (mock-up of 18 Nov 2026).
  assert.match(national, /Espagne/);
  assert.match(national, /Géorgie/);
  const club = renderToStaticMarkup(h(mod.default, { matches }));
  assert.doesNotMatch(club, /fi-es|fi-ge/);
});

test("the Euro results list also displays flags for both national teams", async () => {
  const flag = await load(
    "dashboard/frontend/src/components/NationalFlag.jsx",
    {
      react: React,
      "flag-icons/css/flag-icons.min.css": {},
      "../services/national-flags.js": { nationalFlagCode },
    },
  );
  const mod = await load(
    "dashboard/frontend/src/components/CupCompetition.jsx",
    {
      react: React,
      "./UI.jsx": {
        Card: () => null,
        Media: () => null,
        Pager: () => null,
        Segments: () => null,
        AsyncState: () => null,
        Empty: ({ children }) => h("p", null, children),
      },
      "../services/format.js": { date: String, seasonLabel: String },
      "../services/fixtures.js": { parisDay: () => "2026-01-01" },
      "./KnockoutBracket.jsx": { __esModule: true, default: () => null },
      "./NationalFlag.jsx": { __esModule: true, default: flag.default },
      "./EditionHeader.jsx": editionHeaderStub(React),
      "next/link": { __esModule: true, default: ({ children, href, prefetch, ...rest }) => React.createElement("a", { href, ...rest }, children) },
      "../hooks/FootballContext.jsx": { useFootball: () => ({ href: (page, params = {}) => page + "?" + new URLSearchParams(params) }) },
      "../services/worldcup-matches.js": { useWorldCupIndex: () => ({}), withWorldCupKeys: (matches) => matches },
      "../services/national-flags.js": nationalFlags,
      "../services/trophy-art.js": trophies,
      "../services/resources.js": { useResource: () => ({}), json: () => {} },
      "../services/competition-artwork.js": await import("../dashboard/frontend/src/services/competition-artwork.js"),
      "../services/catalog-client.js": { cupTable: () => {} },
      "../services/competition-selector.js": {
        competitionCountryLabel: String,
      },
      "../services/cup-matches.js": cupMatches,
      "../services/knockout-bracket.js": bracket,
      "../services/cup-worker-client.js": { cupWorkerSnapshot: () => {} },
      // The domestic cups' projection (124): none in these cups.
      "./SeasonProjection.jsx": { __esModule: true, default: () => null },
      "../services/cup-projection.js": { useCupProjection: () => null, useCupProjectionState: () => ({ value: null, settled: true }) },
      "./Hint.jsx": { Term: ({ children }) => children },
    "../services/forecasts.js": { share: (v) => `${Math.round(v * 100)} %` },
    "./MatchForecastBar.jsx": { __esModule: true, default: () => null },
      "../services/cup-archives.js": cupArchives,
    },
  );
  const matches = normalizeOpenCup([
    {
      date: "2024-06-30",
      round: "Round of 16",
      team1: "Spain",
      team2: "Georgia",
      score: { ft: [4, 1] },
    },
  ]);
  const html = renderToStaticMarkup(
    h(mod.CupMatchList, {
      matches,
      status: "finished",
      query: "",
      page: 1,
      onPage: () => {},
      nationalTeams: true,
      season: "2024",
    }),
  );
  assert.match(html, /fi-es/);
  assert.match(html, /fi-ge/);
  assert.match(html, /4 – 1/);
});
