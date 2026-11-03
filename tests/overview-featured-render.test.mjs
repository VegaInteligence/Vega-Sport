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
const src = (file) => import(path.join(root, "dashboard/frontend/src", file));

const PORTUGAL = "l_4QexZg",
  PREMIER = "l_4WFCIZ",
  UCL = "l_0bfbkO";
const match = (id, leagueId, date, home, away, hs, as) => ({
  id,
  leagueId,
  league: leagueId,
  date,
  timeUtc: date + "T19:00:00Z",
  status: "finished",
  home: { id: home.id, name: home.name, score: hs },
  away: { id: away.id, name: away.name, score: as },
});
const braga = match(
  "braga",
  PORTUGAL,
  "2026-11-01",
  { id: "braga", name: "Braga" },
  { id: "fama", name: "Famalicão" },
  3,
  0,
);
const arsenal = match(
  "arsenal-match",
  PREMIER,
  "2026-11-01",
  { id: "t_0BrMnM", name: "Liverpool" },
  { id: "t_1gkhxH", name: "Arsenal" },
  0,
  1,
);
const quarterLegs = Array.from({ length: 8 }, (_, i) => ({
  id: "q" + i,
  date: "2027-04-1" + (i % 2 ? 4 : 7),
  time_utc: "2027-04-14T19:00:00Z",
  status: "finished",
  league: { id: UCL },
  home_team: { id: "a" + i, name: "A" + i },
  away_team: { id: "b" + i, name: "B" + i },
  score_home: 1,
  score_away: 0,
}));

async function overview({ context, params = "", rounds = {} }) {
  const stubs = {
    react: {
      ...React,
      useState: (initial) =>
        React.useState(
          typeof initial === "function"
            ? () => Date.parse("2026-11-02T12:00:00Z")
            : initial,
        ),
    },
    "next/link": {
      __esModule: true,
      default: ({ href, children, ...props }) =>
        h("a", { href, ...props }, children),
    },
    "next/navigation": { useSearchParams: () => new URLSearchParams(params) },
    "../components/Layout.jsx": {
      __esModule: true,
      default: ({ children }) => h("main", null, children),
    },
    "../hooks/FootballContext.jsx": { useFootball: () => context },
    "../components/UI.jsx": {
      Empty: ({ children }) => h("div", { "data-empty": "" }, children),
    },
    "../components/HomePreferences.jsx": {
      __esModule: true,
      default: () => null,
    },
    "../components/HomeMatchday.jsx": {
      HomeTicker: ({ results }) =>
        h("nav", { "data-ticker": results.map((m) => m.id).join(",") }),
      MatchOfTheWeek: ({ match }) =>
        h(
          "section",
          { "data-motw": match.id },
          match.home.name + " – " + match.away.name,
        ),
      NumberOfTheWeek: () => null,
    },
    "../components/HomePlayers.jsx": {
      AlsoShone: () => null,
      Finishing: () => null,
      PlayerOfTheWeek: () => null,
      SeasonScorers: () => null,
    },
    "../components/HomeSeason.jsx": {
      BallonDorRace: () => h("div", { "data-race": "" }),
      BallonDorTeaser: () => h("div", { "data-teaser": "" }),
      NextMatches: () => null,
      TitleRace: () => null,
      WinStreak: () => null,
    },
    "../services/format.js": { number: String },
    "../services/resources.js": {
      json: async () => ({}),
      useResource: () => ({ loading: false, value: rounds }),
    },
    "../services/competition-identity.js": await src(
      "services/competition-identity.js",
    ),
    "../services/fixtures.js": await src("services/fixtures.js"),
    "../services/home-insights.js": await src("services/home-insights.js"),
    "../../../shared/competition-scope.js": await import(
      path.join(root, "dashboard/shared/competition-scope.js")
    ),
  };
  const filename = path.join(
    root,
    "dashboard/frontend/src/views/OverviewPage.jsx",
  );
  const compiled = babel.transformSync(await fs.readFile(filename, "utf8"), {
    presets: [[preset, { runtime: "classic" }]],
    plugins: [commonjs],
    babelrc: false,
    configFile: false,
    filename,
  }).code;
  const mod = { exports: {} };
  vm.runInThisContext(
    "(function(require,module,exports){" + compiled + "\n})",
    { filename },
  )(
    (name) => {
      if (!(name in stubs)) throw Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
  );
  return renderToStaticMarkup(h(mod.exports.default));
}

function context(overrides = {}) {
  return {
    filters: { league: "all", query: "" },
    preferences: { favoriteLeagueIds: [], onboardingComplete: false },
    focus: "all",
    matches: [braga, arsenal],
    rows: [],
    data: { fixtures: [], matches: [braga, arsenal], competitions: [] },
    competitions: [],
    catalog: [],
    allCompetitions: [],
    manifest: { defaultSeason: "2026/2027", seasons: [] },
    season: "2026/2027",
    href: (url, params = {}) => url + "?" + new URLSearchParams(params),
    setPlayer: () => {},
    ...overrides,
  };
}

test("the home features the big match of the week within the followed competitions", async () => {
  const rendered = await overview({ context: context() });
  assert.match(rendered, /data-motw="arsenal-match"/);
  assert.match(rendered, /Liverpool – Arsenal/);
  assert.match(
    rendered,
    /data-ticker="(braga,arsenal-match|arsenal-match,braga)"/,
  );

  const portugal = await overview({
    context: context({
      preferences: { favoriteLeagueIds: [PORTUGAL], onboardingComplete: true },
    }),
  });
  assert.match(portugal, /data-motw="braga"/);
  assert.doesNotMatch(portugal, /Arsenal/);
});

test("the default home leaves out leagues outside the Top 7 Europe and the European cups", async () => {
  const swedish = match(
    "swede",
    "l_1XsMdH",
    "2026-11-01",
    { id: "x", name: "Mjällby" },
    { id: "y", name: "Kalmar" },
    2,
    0,
  );
  const rendered = await overview({
    context: context({ matches: [swedish, arsenal] }),
  });
  assert.doesNotMatch(rendered, /swede/);
  const everything = await overview({
    context: context({
      matches: [swedish, arsenal],
      preferences: { favoriteLeagueIds: [], onboardingComplete: true },
    }),
  });
  assert.match(everything, /swede/);
});

test("the Ballon d'Or race replaces the teaser after the Champions League quarter-finals", async () => {
  const before = await overview({ context: context() });
  assert.match(before, /data-teaser/);
  assert.doesNotMatch(before, /data-race/);

  const rounds = Object.fromEntries(
    quarterLegs.map((f) => [f.id, { name: "1/4" }]),
  );
  const after = await overview({
    context: context({
      data: {
        fixtures: quarterLegs,
        matches: [braga, arsenal],
        competitions: [],
      },
    }),
    rounds,
  });
  assert.match(after, /data-race/);
  assert.doesNotMatch(after, /data-teaser/);

  const forced = await overview({
    context: context(),
    params: "ballondor=ouvert",
  });
  assert.match(forced, /data-race/);
});

test("a selection without finished matches shows an empty state", async () => {
  const rendered = await overview({ context: context({ matches: [] }) });
  assert.match(rendered, /data-empty/);
});
