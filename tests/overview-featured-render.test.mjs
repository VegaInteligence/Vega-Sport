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

async function overview({
  context,
  params = "",
  rounds = {},
  ranking = null,
  now = "2026-11-01T21:00:00Z",
  summary,
  onRead = () => {},
}) {
  const stubs = {
    react: {
      ...React,
      useState: (initial) =>
        React.useState(
          typeof initial === "function" ? () => Date.parse(now) : initial,
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
    "../hooks/ResearchContext.jsx": {
      useResearch: () => ({ data: { lists: [] } }),
    },
    "../services/resource-bootstrap.js": { useResourceBootstrap: () => null },
    "../services/home-bootstrap-preferences.js": { mirrorHomeState: () => {} },
    "../components/UI.jsx": {
      Empty: ({ children }) => h("div", { "data-empty": "" }, children),
      AsyncState: ({ resource, children, loading }) =>
        resource.loading
          ? loading
          : resource.error
            ? h("div", { role: "alert" }, resource.error)
            : children(resource.value),
    },
    "../hooks/useCompactRead.js": {
      __esModule: true,
      default: (kind, values) => {
        onRead(kind, values);
        if (!summary)
          throw new Error("Legacy home must not request compact data");
        return summary;
      },
    },
    "../services/compact-reads.js": await src("services/compact-reads.js"),
    "../services/fixtures.js": await src("services/fixtures.js"),
    "../components/HomePreferences.jsx": {
      __esModule: true,
      default: () => null,
    },
    "../components/SeasonFilter.jsx": {
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
      BestDefence: () => null,
      NextMatches: () => null,
      TitleRace: () => null,
      WinStreak: ({ next }) =>
        h("span", { "data-streak-next": next?.fixture?.id || "" }),
    },
    "../services/format.js": { number: String },
    "../services/resources.js": {
      json: async () => ({}),
      useResource: () => ({ loading: false, value: rounds }),
    },
    "../services/competition-identity.js": await src(
      "services/competition-identity.js",
    ),
    "../services/ballon-dor.js": { ballonDorRanking: () => ranking },
    "../data-url.js": { dataUrl: (file) => "/data/" + file },
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

test("the Ballon d'Or race needs both the end of the quarter-finals and the STATARENA ranking", async () => {
  const ranking = [1, 2, 3].map((rank) => ({
    rank,
    name: "Joueur " + rank,
    team: "Club",
    score: 90 - rank,
  }));
  const rounds = Object.fromEntries(
    quarterLegs.map((f) => [f.id, { name: "1/4" }]),
  );
  const played = context({
    data: {
      fixtures: quarterLegs,
      matches: [braga, arsenal],
      competitions: [],
    },
  });

  const before = await overview({ context: context(), ranking });
  assert.match(before, /data-teaser/);
  assert.doesNotMatch(before, /data-race/);

  // The ranking is empty: the banner stays, no stand-in list replaces it.
  const empty = await overview({ context: played, rounds });
  assert.match(empty, /data-teaser/);
  assert.doesNotMatch(empty, /data-race/);

  const after = await overview({ context: played, rounds, ranking });
  assert.match(after, /data-race/);
  assert.doesNotMatch(after, /data-teaser/);

  const forced = await overview({
    context: context(),
    params: "ballondor=ouvert",
    ranking,
  });
  assert.match(forced, /data-race/);
});

test("a selection without finished matches shows an empty state", async () => {
  const rendered = await overview({ context: context({ matches: [] }) });
  assert.match(rendered, /data-empty/);
});

test("a new week does not keep the preceding week's featured results", async () => {
  const rendered = await overview({
    context: context(),
    now: "2026-11-02T12:00:00Z",
  });
  assert.match(rendered, /data-empty/);
  assert.match(rendered, /cette semaine/);
  assert.doesNotMatch(rendered, /data-motw/);
});

test("an archive selection displays the historical week and season explicitly", async () => {
  const archived = {
    ...arsenal,
    date: "2026-05-24",
    timeUtc: "2026-05-24T19:00:00Z",
    season: "2025/2026",
  };
  const rendered = await overview({
    context: context({ season: "2025/2026", matches: [archived] }),
    now: "2026-11-06T12:00:00Z",
  });
  assert.match(rendered, /Archives · 2025\/2026/);
  assert.match(rendered, /18.*24.*mai.*2026/);
  assert.match(rendered, /data-motw="arsenal-match"/);
  assert.doesNotMatch(rendered, /résultats provisoires/);
});

const homeSummary = () => ({
  loading: false,
  value: {
    data: {
      period: { start: "2026-10-26", end: "2026-11-01", current: true },
      results: [arsenal],
      featured: arsenal,
      ranks: [],
      tables: [],
      highlights: [],
      leaders: { goals: [], assists: [], clinical: [], wasteful: [] },
      others: [],
      defences: [],
      hasSeasonPlayers: false,
    },
  },
});

test("compact home renders every supplied summary without loading a season", async () => {
  // Define the guarded getters after context() spreads its overrides.
  const f = context({
    compactMode: true,
    manifest: {
      defaultSeason: "2026/2027",
      publicationVersion: "g1",
      seasons: [],
      competitions: [],
    },
    preferences: { favoriteLeagueIds: [PREMIER], onboardingComplete: true },
  });
  Object.defineProperties(f, {
    matches: {
      get() {
        throw Error("bulk matches accessed");
      },
    },
    rows: {
      get() {
        throw Error("bulk appearances accessed");
      },
    },
  });
  const requests = [];
  const html = await overview({
    context: f,
    summary: homeSummary(),
    onRead: (...args) => requests.push(args),
  });
  assert.match(html, /data-motw="arsenal-match"/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], "home");
  assert.equal(requests[0][1].leagues, PREMIER);
  assert.equal(requests[0][1].generation, "g1");
});

test("compact home expires a cached preceding week and keeps API failures visible", async () => {
  const f = context({ compactMode: true });
  const expired = await overview({
    context: f,
    summary: homeSummary(),
    now: "2026-11-02T00:01:00Z",
  });
  assert.doesNotMatch(expired, /data-motw/);
  assert.match(expired, /cette semaine/);
  const failed = await overview({
    context: f,
    summary: { loading: false, error: "Publication indisponible" },
  });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Publication indisponible/);
});

test("compact home hides a past next fixture even while the summary is retained", async () => {
  const summary = homeSummary();
  summary.value.data.streak = { id: "club", streak: 3 };
  summary.value.data.streakNext = {
    time: Date.parse("2026-11-01T20:00:00Z"),
    fixture: { id: "past-next-fixture" },
  };
  const expired = await overview({
    context: context({ compactMode: true }),
    summary,
  });
  assert.match(expired, /data-streak-next=""/);
  assert.doesNotMatch(expired, /past-next-fixture/);
  summary.value.data.streakNext.time = Date.parse("2026-11-02T20:00:00Z");
  const future = await overview({
    context: context({ compactMode: true }),
    summary,
  });
  assert.match(future, /data-streak-next="past-next-fixture"/);
});
