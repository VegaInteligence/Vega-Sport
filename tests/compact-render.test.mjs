import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  frontend = path.join(root, "dashboard/frontend/src"),
  requireLocal = createRequire(path.join(root, "dashboard/package.json")),
  React = requireLocal("react"),
  { renderToStaticMarkup } = requireLocal("react-dom/server"),
  babel = requireLocal("next/dist/compiled/babel/core"),
  preset = requireLocal("next/dist/compiled/babel/preset-react"),
  commonjs = requireLocal(
    "next/dist/compiled/babel/plugin-transform-modules-commonjs",
  ),
  h = React.createElement,
  moduleDefault = (value) => ({ __esModule: true, default: value }),
  blank = () => null;

async function compile(file, overrides) {
  const filename = path.join(frontend, file),
    source = await fs.readFile(filename, "utf8"),
    stubs = {
      react: React,
      "next/link": moduleDefault(({ href, children }) =>
        h("a", { href }, children),
      ),
      ...overrides,
    };
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const name = match[1];
    if (!(name in stubs) && name.endsWith(".js"))
      stubs[name] = {
        __esModule: true,
        ...(await import(
          pathToFileURL(path.resolve(path.dirname(filename), name)).href
        )),
      };
  }
  const code = babel.transformSync(source, {
      presets: [[preset, { runtime: "classic" }]],
      plugins: [commonjs],
      babelrc: false,
      configFile: false,
      filename,
    }).code,
    mod = { exports: {} };
  vm.runInThisContext(
    "(function(require,module,exports,React){" + code + "\n})",
    {
      filename,
    },
  )(
    (name) => {
      if (!(name in stubs)) throw Error("Unexpected import " + name);
      return stubs[name];
    },
    mod,
    mod.exports,
    React,
  );
  return mod.exports;
}
const ui = {
  Card: ({ title, children, action }) =>
    h("section", null, h("h2", null, title), action, children),
  Empty: ({ children }) => h("p", null, children),
  Rating: ({ value }) => h("span", null, value),
  Media: blank,
  Segments: blank,
  Modal: ({ title, header, children }) =>
    h("section", null, h("h2", null, title), header, children),
  Pager: ({ page, total }) =>
    h("span", { "data-page": page, "data-pages": total }),
  AsyncState: ({ resource, children, loading }) =>
    resource.loading
      ? loading
      : resource.error
        ? h("p", { role: "alert" }, resource.error)
        : children(resource.value),
};
const season = "2026/2027",
  league = "l_3FJFUl",
  manifest = {
    storage: "aws-relational",
    publicationVersion: "g1",
    defaultSeason: season,
    capabilities: {
      playerRatingRanking: true,
      compactReads: {
        home: true,
        players: true,
        player: true,
        clubs: true,
        club: true,
        performance: true,
      },
    },
    seasons: [
      {
        id: season,
        chunks: [{ leagueId: league, sourceDigest: "partition-1" }],
      },
    ],
    competitions: [{ id: league, name: "Ligue 1", country: "FRA" }],
    clubCountries: {},
  },
  empty = {
    meta: { storage: "aws-relational" },
    matches: [],
    fixtures: [],
    appearances: [],
    teams: [],
    competitions: manifest.competitions,
    metrics: [],
  };
const profile = (id, name) => ({
  id,
  name,
  teams: ["Paris"],
  teamIds: ["t_paris"],
  leagueIds: [league],
  leagues: ["Ligue 1"],
  matches: 9,
  minutes: 810,
  role: { group: "D", label: "Défenseur" },
  stats: { goals: { sum: 2, count: 9, minutes: 810 } },
  ratios: {},
  rating: 8,
  ratingCount: 9,
});
const row = (id, name) => ({
  id,
  playerId: id,
  name,
  profile: profile(id, name),
  matches: 9,
  goals: 2,
  rating: 8,
  position: "Défenseur",
  team: "Paris",
  league: "Ligue 1",
});

test("Provider selects compact reads before season loading and only falls back without the capability", async () => {
  for (const route of ["/", "/joueurs/", "/clubs/"]) {
    for (const enabled of [true, false]) {
      const jobs = [],
        reads = [],
        selectedManifest = enabled
          ? manifest
          : { ...manifest, capabilities: {} };
      const mod = await compile("hooks/FootballContext.jsx", {
        "next/navigation": {
          usePathname: () => route,
          useSearchParams: () => new URLSearchParams({ season }),
        },
        "../season_data.js": {
          loadSeason: async () => {
            reads.push("bulk");
            return empty;
          },
        },
        "../services/resources.js": {
          useResource: (key, loader, active = true) => {
            if (active) jobs.push({ key, loader });
            return {
              loading: false,
              value:
                key === "manifest"
                  ? selectedManifest
                  : key.startsWith("status:")
                    ? false
                    : empty,
              revalidate: async () => {},
              retry() {},
            };
          },
          cachedResource: () => undefined,
          primeResource: async () => empty,
          json: async () => ({}),
          download() {},
        },
        "../components/UI.jsx": ui,
        "../components/LoadingPage.jsx": moduleDefault(blank),
      });
      const html = renderToStaticMarkup(
        h(mod.FootballProvider, null, h("p", null, "ready")),
      );
      assert.match(html, /ready/);
      const job = jobs.find(({ key }) =>
        /^(compact-catalogue|season:)/.test(key),
      );
      assert.ok(job, route);
      await job.loader({ signal: new AbortController().signal });
      assert.deepEqual(reads, enabled ? [] : ["bulk"], route);
    }
  }
});

test("the dedicated match catalogue cannot poison the actor profile cache", async () => {
  let pathname = "/joueurs/matchs/",
    loadData;
  const providers = await compile("../app/providers.jsx", {
    "next/navigation": {
      usePathname: () => pathname,
      useSearchParams: () =>
        new URLSearchParams({ id: "p_000001", season, playerView: "stats" }),
    },
    "../src/hooks/FootballContext.jsx": {
      FootballProvider: ({ loadData: enabled, children }) => {
        loadData = enabled;
        return children;
      },
    },
    "../src/hooks/ResearchContext.jsx": {
      ResearchProvider: ({ children }) => children,
    },
  });
  const jobs = [],
    reads = [],
    keys = [],
    service =
      await import("../dashboard/frontend/src/services/compact-reads.js");
  const provider = await compile("hooks/FootballContext.jsx", {
    "next/navigation": {
      usePathname: () => pathname,
      useSearchParams: () =>
        new URLSearchParams({ id: "p_000001", season, playerView: "stats" }),
    },
    "../services/compact-reads.js": {
      ...service,
      readCompactPages: async (kind, params) => {
        reads.push({ kind, params });
        return { pages: [empty], meta: { generation: "g1" } };
      },
    },
    "../season_data.js": {
      loadSeason: () => {
        throw Error("bulk season loaded");
      },
    },
    "../services/resources.js": {
      useResource: (key, loader, enabled = true) => {
        if (enabled) jobs.push({ key, loader });
        return {
          loading: false,
          value:
            key === "manifest"
              ? manifest
              : key.startsWith("status:")
                ? false
                : empty,
          revalidate: async () => {},
          retry() {},
        };
      },
      cachedResource: () => undefined,
      primeResource: async () => empty,
      json: async () => ({}),
      download() {},
    },
    "../components/UI.jsx": ui,
    "../components/LoadingPage.jsx": moduleDefault(blank),
  });
  for (pathname of ["/joueurs/matchs/", "/joueurs/"]) {
    renderToStaticMarkup(h(providers.default, null, h("p", null, "ready")));
    assert.equal(loadData, pathname === "/joueurs/");
    jobs.length = 0;
    renderToStaticMarkup(
      h(provider.FootballProvider, { loadData }, h("p", null, "ready")),
    );
    const resource = jobs.find(
      ({ key }) =>
        key.startsWith("compact-actor:") ||
        key.startsWith("compact-catalogue:"),
    );
    keys.push(resource.key);
    await resource.loader({ signal: new AbortController().signal });
    assert.equal(reads.length, loadData ? 1 : 0);
  }
  assert.notEqual(keys[0], keys[1]);
  assert.match(keys[0], /^compact-catalogue:/);
  assert.match(keys[1], /^compact-actor:/);
  assert.equal(reads[0].kind, "player");
  assert.equal(reads[0].params.player, "p_000001");
});

test("summary actor boot is unchanged when heavy detail tabs are selected", async () => {
  for (const kind of ["player", "club"]) {
    let view = "overview";
    const jobs = [],
      reads = [],
      keys = [];
    const service =
      await import("../dashboard/frontend/src/services/compact-reads.js");
    const summaryManifest = {
      ...manifest,
      capabilities: { ...manifest.capabilities, actorSummary: true },
    };
    const mod = await compile("hooks/FootballContext.jsx", {
      "next/navigation": {
        usePathname: () => (kind === "player" ? "/joueurs/" : "/clubs/"),
        useSearchParams: () =>
          new URLSearchParams({
            id: kind === "player" ? "p_000001" : "t_000001",
            season,
            focus: "all",
            [kind === "player" ? "playerView" : "clubView"]: view,
          }),
      },
      "../services/compact-reads.js": {
        ...service,
        readCompactPages: async (route, params) => {
          reads.push({ route, params });
          return { pages: [empty], meta: { generation: "g1" } };
        },
      },
      "../services/resources.js": {
        useResource: (key, loader, enabled = true) => {
          if (enabled) jobs.push({ key, loader });
          return {
            loading: false,
            value:
              key === "manifest"
                ? summaryManifest
                : key.startsWith("status:")
                  ? false
                  : empty,
            revalidate: async () => {},
            retry() {},
          };
        },
        cachedResource: () => undefined,
        primeResource: async () => empty,
        json: async () => ({}),
        download() {},
      },
      "../components/UI.jsx": ui,
      "../components/LoadingPage.jsx": moduleDefault(blank),
    });
    for (view of kind === "player"
      ? ["overview", "stats"]
      : ["overview", "squad", "matches"]) {
      jobs.length = 0;
      renderToStaticMarkup(
        h(mod.FootballProvider, null, h("p", null, "ready")),
      );
      const job = jobs.find(({ key }) => key.startsWith("compact-actor:"));
      keys.push(job.key);
      await job.loader({ signal: new AbortController().signal });
    }
    assert.equal(
      new Set(keys).size,
      1,
      "changing tabs reuses the exact base season resource",
    );
    for (const { params } of reads) {
      assert.equal(params.detail, "summary");
      assert.equal(params.limit, 100);
      assert.equal(params.include, "");
    }
  }
});

test("a paged player directory never slices its server page again", async () => {
  const f = {
      season,
      filters: { advanced: {}, league: "all", leagues: [] },
      href: (url, values) => url + "?" + new URLSearchParams(values),
    },
    entries = [row("p_second", "Page deux"), row("p_next", "Suivant")];
  const mod = await compile("components/PlayerDirectory.jsx", {
    "../hooks/FootballContext.jsx": {
      useFootball: () => f,
      FootballContext: React.createContext(null),
    },
    "../hooks/ResearchContext.jsx": {
      useResearch: () => ({
        data: { settings: { columns: ["goals", "rating"] } },
        isComparing: () => false,
      }),
    },
    "./UI.jsx": ui,
    "./PerformanceContext.jsx": moduleDefault(blank),
    "./ResearchUI.jsx": {
      BookmarkButton: blank,
      MetricInfo: blank,
      MetricPicker: blank,
      SavedViews: blank,
    },
  });
  const html = renderToStaticMarkup(
    h(mod.default, {
      rows: entries,
      sort: { key: "goals", direction: "desc" },
      mode: "total",
      pagination: { page: 2, pages: 3, total: 42, limit: 20 },
      onPage() {},
    }),
  );
  assert.match(html, /42 joueurs/);
  assert.match(html, /data-player-id="p_second"/);
  assert.match(html, /data-player-id="p_next"/);
  assert.match(html, /data-page="2" data-pages="3"/);
});

test("players table requests its page without activating the complete analysis cohort", async () => {
  const reads = [],
    f = {
      compactMode: true,
      manifest,
      season,
      focus: "all",
      data: empty,
      filters: {
        league: "all",
        leagues: [],
        query: "",
        minutes: 1,
        basis: "total",
        ranking: "goals",
        match: "all",
        advanced: {
          positions: [],
          role: "all",
          venue: "all",
          result: "all",
          rating: null,
          from: "",
          to: "",
          conditions: [],
        },
      },
    };
  const mod = await compile("views/PlayersPage.jsx", {
    "next/navigation": {
      useSearchParams: () => new URLSearchParams({ playersView: "table" }),
    },
    "../hooks/FootballContext.jsx": {
      useFootball: () => f,
      FootballContext: React.createContext(null),
    },
    "../hooks/ResearchContext.jsx": { useResearch: () => ({}) },
    "../hooks/useCompactRead.js": moduleDefault((kind, params, options) => {
      reads.push({ kind, params, options });
      return {
        loading: false,
        value: {
          data: { players: [row("p_one", "Serveur")] },
          pagination: { page: 1, pages: 5, total: 100 },
        },
      };
    }),
    "../components/Layout.jsx": moduleDefault(({ children }) =>
      h("main", null, children),
    ),
    "../components/PlayerWorkspace.jsx": moduleDefault(({ rows, pagination }) =>
      h("p", null, `${rows[0].name}:${pagination.total}`),
    ),
    "./PlayerMatchesPage.jsx": moduleDefault(blank),
    "../components/ResearchUI.jsx": {
      useHasSaved: () => false,
      ResearchComparisonTray: blank,
    },
    "../components/UI.jsx": ui,
  });
  const html = renderToStaticMarkup(h(mod.default));
  assert.match(html, /Serveur:100/);
  assert.equal(reads.filter((call) => call.options.enabled).length, 1);
  assert.equal(reads[0].params.ranking, "goals");
  assert.equal(reads[1].options.allPages, true);
  assert.equal(reads[1].options.enabled, false);
});

test("a player profile renders its rows before the comparison section requests its complete role cohort", async () => {
  const reads = [];
  let intent = "",
    requestComparisons,
    profileRows;
  const f = {
    compactMode: true,
    manifest,
    season,
    focus: "all",
    href: (url) => url,
    data: {
      ...empty,
      appearances: [
        {
          id: "a1",
          playerId: "p_000001",
          matchId: "m_000001",
          name: "Défenseur",
          season,
          leagueId: league,
          minutes: 450,
          positionId: 31,
          rating: 7,
          goals: 1,
        },
      ],
      matches: [{ id: "m_000001" }],
    },
    filters: {
      league: "all",
      leagues: [],
      query: "",
      minutes: 1,
      basis: "total",
      ranking: "",
      match: "all",
      advanced: {
        positions: [],
        role: "all",
        venue: "all",
        result: "all",
        rating: null,
        from: "",
        to: "",
        conditions: [],
      },
    },
  };
  const mod = await compile("views/PlayersPage.jsx", {
    react: {
      ...React,
      lazy: () => (props) => {
        requestComparisons = props.onNeedComparisons;
        profileRows = props.rows;
        return h("p", null, "profile ready");
      },
      useState: (initial) =>
        initial === ""
          ? [
              intent,
              (value) => {
                intent = value;
              },
            ]
          : React.useState(initial),
    },
    "next/navigation": {
      useSearchParams: () => new URLSearchParams({ id: "p_000001" }),
    },
    "../hooks/FootballContext.jsx": {
      useFootball: () => f,
      FootballContext: React.createContext(null),
    },
    "../hooks/useCompactRead.js": moduleDefault((kind, params, options) => {
      reads.push({ kind, params, options });
      return { loading: Boolean(options.enabled) };
    }),
    "../components/Layout.jsx": moduleDefault(({ children }) =>
      h("main", null, children),
    ),
    "../components/PlayerWorkspace.jsx": moduleDefault(blank),
    "./PlayerMatchesPage.jsx": moduleDefault(blank),
    "../components/ResearchUI.jsx": { ResearchComparisonTray: blank },
  });
  assert.match(renderToStaticMarkup(h(mod.default)), /profile ready/);
  assert.equal(
    profileRows.length,
    1,
    "the actor never waits for another player's data",
  );
  assert.equal(
    reads.some(({ options }) => options.enabled),
    false,
  );
  requestComparisons();
  reads.length = 0;
  renderToStaticMarkup(h(mod.default));
  const cohort = reads.find(({ options }) => options.enabled);
  assert.equal(
    cohort.options.allPages,
    true,
    "percentiles still use every eligible peer",
  );
  assert.equal(
    cohort.params.pos,
    "D",
    "only the player's complete comparison group is needed",
  );
  assert.equal(profileRows.length, 1);
});

test("player overview defers the complete matching peer lines without filtering out the actor", async () => {
  const id = "p_actor",
    reads = [],
    appearances = Array.from({ length: 6 }, (_, index) => ({
      playerId: id,
      name: "Joueur",
      matchId: `m_${index}`,
      season,
      leagueId: league,
      minutes: 90,
      positionId: 83,
      goals: 1,
    })),
    f = {
      compactMode: true,
      manifest,
      season,
      focus: "all",
      data: { ...empty, appearances },
      filters: {
        league: "all",
        leagues: [],
        query: "",
        minutes: 1,
        basis: "total",
        match: "all",
        advanced: {
          positions: ["D"],
          role: "all",
          venue: "all",
          result: "all",
          rating: null,
          from: "",
          to: "",
          conditions: [],
        },
      },
      href: (url) => url,
    };
  let view = "overview",
    intent = "",
    requestComparisons;
  const mod = await compile("views/PlayersPage.jsx", {
    react: {
      ...React,
      lazy:
        () =>
        ({ rows, radarComparison, onNeedComparisons }) => {
          requestComparisons = onNeedComparisons;
          return h(
            "p",
            null,
            `Aperçu ${rows.length} ${radarComparison?.loading}`,
          );
        },
      useState: (initial) =>
        initial === ""
          ? [
              intent,
              (value) => {
                intent = value;
              },
            ]
          : React.useState(initial),
    },
    "next/navigation": {
      useSearchParams: () => new URLSearchParams({ id, playerView: view }),
    },
    "../hooks/FootballContext.jsx": {
      useFootball: () => f,
      FootballContext: React.createContext(null),
    },
    "../hooks/useCompactRead.js": moduleDefault((kind, params, options) => {
      reads.push({ kind, params, options });
      return { loading: true };
    }),
    "../components/Layout.jsx": moduleDefault(({ children }) => children),
    "../components/PlayerWorkspace.jsx": moduleDefault(blank),
    "./PlayerMatchesPage.jsx": moduleDefault(blank),
    "../components/ResearchUI.jsx": { ResearchComparisonTray: blank },
  });
  assert.match(renderToStaticMarkup(h(mod.default)), /Aperçu 6 true/);
  assert.equal(
    reads.some(({ options }) => options.enabled),
    false,
  );
  requestComparisons();
  reads.length = 0;
  renderToStaticMarkup(h(mod.default));
  let request = reads.find(({ options }) => options.enabled);
  assert.equal(request.params.pos, "M,A");
  assert.equal(request.params.leagues, league);
  assert.equal(request.options.allPages, true);
  assert.equal(request.options.parallelPages, true);
  reads.length = 0;
  view = "stats";
  renderToStaticMarkup(h(mod.default));
  assert.equal(
    reads.some(({ options }) => options.enabled),
    false,
  );
  requestComparisons();
  reads.length = 0;
  renderToStaticMarkup(h(mod.default));
  request = reads.find(({ options }) => options.enabled);
  assert.equal(request.params.pos, "M,A");
  assert.equal(request.params.leagues, "all");
  assert.equal(request.options.parallelPages, false);
  reads.length = 0;
  view = "compare";
  renderToStaticMarkup(h(mod.default));
  request = reads.find(({ options }) => options.enabled);
  assert.equal(
    request.params.pos,
    "",
    "explicit player comparison keeps every position available",
  );
});

test("player career overview renders club, competition and national career with positions", async () => {
  const id = "p_123456";
  const appearances = [
    { playerId: id, matchId: "m_club", teamId: "club", team: "Club A", leagueId: "l_0ErfuF", minutes: 90 },
    { playerId: id, matchId: "m_nation", teamId: "spain", team: "Espagne", leagueId: "l_1XLtP0", minutes: 90 },
  ];
  const { aggregateSeason } = await import("../dashboard/frontend/src/services/season-player.js");
  const history = [{ season, data: {
    appearances,
    teams: [{ id: "club", name: "Club A" }, { id: "spain", name: "Espagne" }],
    competitions: [{ id: "l_0ErfuF", name: "Liga" }, { id: "l_1XLtP0", name: "Coupe du monde" }],
  }, profile: aggregateSeason(appearances, id) }];
  const component = await compile("components/PlayerCareerStats.jsx", {
    "next/navigation": { useSearchParams: () => new URLSearchParams({ id }) },
    "../hooks/FootballContext.jsx": { useFootball: () => ({ manifest }) },
    "../services/resources.js": {
      useResource: () => ({ loading: false, value: history }),
      cachedResource: () => undefined,
      primeResource: async () => history,
    },
    "./NationalFlag.jsx": moduleDefault(blank),
    "./PlayerObservedValue.jsx": moduleDefault(({ value }) => h("span", null, value)),
    "./PlayerPositionPitch.jsx": moduleDefault(() => h("div", { "data-position-pitch": "mounted" })),
    "./UI.jsx": ui,
  });
  const html = renderToStaticMarkup(h(component.default, { id, season, overview: true }));
  for (const title of ["Performance par club", "Performance par compétition", "Carrière en sélection"])
    assert.match(html, new RegExp(title));
  assert.match(html, /Club A/);
  assert.match(html, /Espagne/);
  assert.match(html, /data-position-pitch="mounted"/);
});

test("the merged actor match list keeps fixture links, date order and every actor row", async () => {
  const id = "p_000001",
    jobs = [],
    appearances = Array.from({ length: 25 }, (_, index) => {
      const matchId = `m_${String(index + 1).padStart(6, "0")}`;
      return {
        id: `${matchId}:${id}`,
        playerId: id,
        matchId,
        name: "Joueur suivi",
        season,
        leagueId: league,
        league: "Ligue 1",
        teamId: "t_000001",
        team: "Paris",
        date: `2026-11-${String(index + 1).padStart(2, "0")}`,
        minutes: 90,
        positionId: 31,
        rating: 7,
        goals: 0,
        assists: 0,
        statsReliable: true,
      };
    }),
    matches = appearances.map((row) => ({
      id: row.matchId,
      season,
      leagueId: league,
      date: row.date,
      status: "finished",
      home: { id: row.teamId, name: "Paris", score: 1 },
      away: { id: "t_000002", name: `Adversaire ${row.matchId}`, score: 0 },
    })),
    f = {
      compactMode: true,
      manifest,
      season,
      focus: "all",
      comparison: [],
      data: { ...empty, matches, appearances },
      filters: {
        league: "all",
        leagues: [],
        query: "",
        minutes: 1,
        basis: "total",
        ranking: "",
        match: "all",
        advanced: {
          positions: [],
          role: "all",
          venue: "all",
          result: "all",
          rating: null,
          from: "",
          to: "",
          conditions: [],
        },
      },
      href: (url, params) =>
        url + "?" + new URLSearchParams({ season, ...params }),
    };
  const fixture = await compile("components/MatchLink.jsx", {
    "../hooks/FootballContext.jsx": { useFootball: () => f },
    "next/link": moduleDefault(({ href, children, prefetch, ...props }) =>
      h("a", { href, ...props }, children),
    ),
    "./UI.jsx": ui,
    "./Icon.jsx": moduleDefault(blank),
    "./NationalFlag.jsx": moduleDefault(blank),
  });
  const { aggregateSeason } =
    await import("../dashboard/frontend/src/services/season-player.js");
  const { playerHistoryKey } =
    await import("../dashboard/frontend/src/services/scouting-history.js");
  const seasons = [
    { season, data: f.data, profile: aggregateSeason(appearances, id) },
  ];
  let historySignal;
  let matchParams = { id, season, playerView: "matches" };
  const matchPage = await compile("views/PlayerMatchesPage.jsx", {
    "next/navigation": {
      useSearchParams: () => new URLSearchParams(matchParams),
    },
    "../hooks/FootballContext.jsx": { useFootball: () => f },
    "../components/Layout.jsx": moduleDefault(({ children }) =>
      h("main", null, children),
    ),
    "../components/MatchLink.jsx": fixture,
    "../components/UI.jsx": ui,
    "../services/resources.js": {
      useResource: (key, loader, enabled) => {
        jobs.push({ key, loader, enabled });
        return { loading: false, value: seasons };
      },
    },
    "../services/scouting-history.js": {
      playerHistoryKey,
      loadPlayerHistory: async (
        source,
        player,
        { signal, season: selected },
      ) => {
        assert.equal(source, manifest);
        assert.equal(player, id);
        assert.equal(selected, matchParams.careerGroup ? undefined : season);
        historySignal = signal;
        return seasons;
      },
    },
  });
  const mod = await compile("views/PlayersPage.jsx", {
    react: { ...React, lazy: () => blank },
    "next/navigation": {
      useSearchParams: () => new URLSearchParams({ id, playerView: "matches" }),
    },
    "../hooks/FootballContext.jsx": {
      useFootball: () => f,
      FootballContext: React.createContext(null),
    },
    "../hooks/useCompactRead.js": moduleDefault((kind, params, options) => {
      jobs.push({ kind, options });
      return { loading: true };
    }),
    "../components/Layout.jsx": moduleDefault(({ children }) =>
      h("main", null, children),
    ),
    "../components/PlayerWorkspace.jsx": moduleDefault(blank),
    "./PlayerMatchesPage.jsx": matchPage,
    "../components/ResearchUI.jsx": {
      useHasSaved: () => false,
      ResearchComparisonTray: blank,
    },
  });
  const html = renderToStaticMarkup(h(mod.default));
  assert.equal(
    jobs.filter((job) => job.options?.enabled || job.enabled).length,
    0,
  );
  assert.equal((html.match(/class="match-row"/g) || []).length, 25);
  assert.ok(html.indexOf("id=m_000025") < html.indexOf("id=m_000001"));
  assert.match(html, /competition=l_3FJFUl/);
  assert.match(html, /sourceSeason=2026%2F2027/);
  assert.doesNotMatch(html, /data-page=|player-rating-detail/);
  // The dedicated route has an empty catalogue and loads only this actor's history.
  f.data = empty;
  jobs.length = 0;
  matchParams = {
    id,
    season: "2025/2026",
    matchGroup: JSON.stringify([season, "t_000001"]),
  };
  const dedicated = renderToStaticMarkup(h(matchPage.default));
  assert.equal((dedicated.match(/class="match-row"/g) || []).length, 25);
  assert.match(dedicated, /performanceSeason=2026%2F2027/);
  const history = jobs.find((job) => job.enabled);
  assert.equal(history.key, playerHistoryKey(manifest, id, season));
  const controller = new AbortController();
  await history.loader({ signal: controller.signal });
  assert.equal(historySignal, controller.signal);

  jobs.length = 0;
  matchParams = {
    id,
    performanceSeason: "2024/2025",
    careerGroup: "clubs",
    careerKey: "t_000001",
  };
  const career = renderToStaticMarkup(h(matchPage.default));
  assert.equal((career.match(/class="match-row"/g) || []).length, 25);
  assert.match(career, /Cumul des saisons disponibles/);
  assert.match(career, /performanceSeason=2024%2F2025/);
  assert.doesNotMatch(career, /careerGroup=|careerKey=/);
  assert.match(career, /playerView=stats/);
  matchParams.playerView = "overview";
  const overviewCareer = renderToStaticMarkup(h(matchPage.default));
  assert.match(overviewCareer, /playerView=overview/);
  assert.match(overviewCareer, /Vue d’ensemble du joueur/);
  assert.doesNotMatch(overviewCareer, /careerGroup=|careerKey=/);
  delete matchParams.playerView;
  const all = jobs.find((job) => job.enabled);
  assert.equal(all.key, playerHistoryKey(manifest, id));
  await all.loader({ signal: controller.signal });
  assert.equal(historySignal, controller.signal);

  jobs.length = 0;
  matchParams.careerGroup = "constructor";
  assert.match(renderToStaticMarkup(h(matchPage.default)), /indisponible/);
  assert.equal(
    jobs.some((job) => job.enabled),
    false,
  );
});

test("dynamic discipline uses the compact generation and preserves uncovered match counts", async () => {
  const requests = [],
    effects = [],
    refs = [],
    signal = new AbortController().signal;
  let refIndex = 0,
    refreshes = 0;
  const f = {
    season,
    manifest: {
      ...manifest,
      publicationVersion: "42",
      capabilities: { compactReads: { discipline: true } },
    },
    client: { id: 7 },
    statusKnown: false,
  };
  let state = {
      loading: false,
      value: { yellow: 2, directRed: 0, secondYellow: 1, covered: 1, total: 1 },
    },
    loader,
    resourceKey;
  const service =
    await import("../dashboard/frontend/src/services/compact-reads.js");
  const mod = await compile("components/PlayerDiscipline.jsx", {
    react: {
      ...React,
      useRef: (value) => (refs[refIndex++] ||= { current: value }),
      useEffect: (effect) => effects.push(effect),
    },
    "../hooks/FootballContext.jsx": { useFootball: () => f },
    "../services/resources.js": {
      useResource: (key, read, enabled) => {
        resourceKey = key;
        loader = read;
        assert.equal(enabled, true);
        return {
          ...state,
          revalidate: async () => {
            refreshes++;
          },
        };
      },
    },
    "../services/compact-reads.js": {
      ...service,
      readPlayerDiscipline: async (...args) => {
        requests.push(args);
        if (state.error) throw Error(state.error);
        return state.value;
      },
    },
    "../services/player-discipline.js": {
      loadDiscipline: () => {
        throw Error("native fan-out must not activate");
      },
    },
    "./PlayerDiscipline.module.css": moduleDefault({
      discipline: "discipline",
      counts: "counts",
    }),
  });
  const props = {
    id: "p_000001",
    rows: [{ matchId: "m_000001" }, { matchId: "uefa:historic" }],
    matches: [{ id: "m_000001" }, { id: "uefa:historic" }, { id: "m_000002" }],
  };
  const render = () => {
    refIndex = 0;
    effects.length = 0;
    const html = renderToStaticMarkup(h(mod.default, props));
    effects.forEach((effect) => effect());
    return html;
  };
  const html = render();
  assert.match(html, /sur 1 des 2 matchs/);
  assert.match(html, /rouge apparié à un deuxième jaune/);
  assert.match(resourceKey, /:42$/);
  await loader({ signal });
  assert.deepEqual(requests[0][3], ["m_000001"]);
  assert.equal(requests[0][4].signal, signal);
  assert.equal(refreshes, 0);
  const firstKey = resourceKey;
  f.manifest = { ...f.manifest };
  render();
  assert.equal(
    resourceKey,
    firstKey,
    "event freshness is independent of core generation",
  );
  assert.equal(refreshes, 1);
  render();
  assert.equal(
    refreshes,
    1,
    "ordinary rendering does not schedule another request",
  );
  state = { loading: false, error: "Publication indisponible" };
  assert.match(render(), /role="alert"/);
  assert.match(render(), /Publication indisponible/);
  await assert.rejects(loader({ signal }), /Publication indisponible/);
});

test("the new shot view consumes actor shot fields without changing their values", async () => {
  const { assembleMatches } =
    await import("../dashboard/backend/services/relational-core.js");
  const match = assembleMatches({
    matches: [
      { id: "m_000001", season, league_id: league, date: "2026-11-06" },
    ],
    shots: [
      {
        id: "shot-1",
        match_id: "m_000001",
        ordinal: 0,
        player_id: "p_000001",
        type: "Goal",
        x: 94,
        y: 34,
        xg: 0.4,
        minute: 21,
        is_goal: true,
        is_on_target: true,
      },
    ],
  })[0];
  const shots = match.shots.map((shot) => ({
      ...shot,
      matchId: match.id,
      date: match.date,
      leagueId: match.leagueId,
      season: match.season,
    })),
    before = structuredClone(shots);
  let selectedKey = null;
  const mod = await compile("components/SeasonShots.jsx", {
    react: {
      ...React,
      useState: (initial) =>
        initial === null ? [selectedKey, () => {}] : React.useState(initial),
    },
    "../hooks/FootballContext.jsx": {
      useFootball: () => ({
        data: { matches: [match] },
        href: (url, params) => url + "?" + new URLSearchParams(params),
      }),
    },
    "./SeasonShots.module.css": moduleDefault({
      shots: "shots",
      point: "point",
      goal: "goal",
    }),
    "./Icon.jsx": moduleDefault(blank),
    "./UI.jsx": ui,
  });
  const render = () =>
    renderToStaticMarkup(h(mod.default, { shots, legacyPitchApi: true }));
  const html = render();
  assert.match(html, /But attaqué/);
  assert.match(html, /11,0\s*m du but/);
  assert.match(html, /xG 0,40/);
  assert.doesNotMatch(html, /id=m_000001/);
  selectedKey = `${shots[0].matchId}:${shots[0].id}`;
  assert.match(render(), /id=m_000001/);
  assert.deepEqual(shots, before);
});

test("clubs directory preserves global totals and one server page size after layout measurement", async () => {
  const reads = [],
    states = [],
    effects = [],
    catalog = [
      ...manifest.competitions,
      { id: "l_1TB68P", name: "LaLiga", country: "ESP" },
    ],
    f = {
      compactMode: true,
      manifest,
      season,
      focus: "all",
      data: { ...empty, competitions: catalog },
      allCatalog: catalog,
      href: (url, values) => url + "?" + new URLSearchParams(values),
      changeSeason() {},
    };
  let stateCursor = 0;
  const mod = await compile("views/ClubsPage.jsx", {
    react: {
      ...React,
      useState(initial) {
        const index = stateCursor++;
        if (!(index in states))
          states[index] = initial?.capacity
            ? { capacity: 28, height: 510 }
            : typeof initial === "function"
              ? initial()
              : initial;
        return [
          states[index],
          (next) => {
            states[index] =
              typeof next === "function" ? next(states[index]) : next;
          },
        ];
      },
      useEffect: (effect) => effects.push(effect),
      useLayoutEffect() {},
    },
    "next/navigation": {
      useSearchParams: () => new URLSearchParams({ clubsView: "explore" }),
    },
    "../hooks/FootballContext.jsx": {
      useFootball: () => f,
      FootballContext: React.createContext(null),
    },
    "../hooks/useCompactRead.js": moduleDefault((kind, params, options) => {
      reads.push({ kind, params, options });
      return {
        loading: false,
        value: {
          data: {
            clubs: [
              {
                id: "t_paris",
                name: "Paris",
                country: "FRA",
                league: "Ligue 1",
                count: 9,
                competitionCounts: { [league]: 9 },
              },
            ],
            facets: {
              countries: ["FRA", "ESP"],
              competitionIds: [league, "l_1TB68P"],
            },
          },
          pagination: { page: 1, pages: 13, total: 300, limit: 24 },
        },
      };
    }),
    "../services/resources.js": {
      useResource: (_key, _loader, enabled) => {
        assert.equal(enabled, false);
        return { loading: false };
      },
    },
    "../components/Layout.jsx": moduleDefault(({ children }) =>
      h("main", null, children),
    ),
    "../components/Icon.jsx": moduleDefault(blank),
    "../components/CompetitionOptions.jsx": moduleDefault(({ competitions }) =>
      competitions.map((c) => h("option", { key: c.id, value: c.id }, c.name)),
    ),
    "../components/StandingsClubProfile.jsx": moduleDefault(blank),
    "../components/ResearchUI.jsx": {
      useHasSaved: () => false,
      ResearchLists: blank,
    },
    "../components/UI.jsx": ui,
  });
  const html = renderToStaticMarkup(h(mod.default));
  assert.match(html, /300 clubs/);
  assert.match(html, /Paris/);
  assert.match(html, /Espagne/);
  assert.match(html, /data-pages="13"/);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].params.limit, 24);
  assert.equal(reads[0].options.enabled, true);
  for (const effect of effects.splice(0)) effect();
  stateCursor = 0;
  renderToStaticMarkup(h(mod.default));
  assert.equal(reads.length, 2);
  assert.equal(
    new Set(reads.map(({ params }) => JSON.stringify(params))).size,
    1,
  );
});

test("compact actor errors cannot activate a bulk season fallback", async () => {
  const jobs = [],
    service = await import(
      pathToFileURL(path.join(frontend, "services/compact-reads.js")).href
    );
  const mod = await compile("hooks/FootballContext.jsx", {
    "next/navigation": {
      usePathname: () => "/joueurs/",
      useSearchParams: () =>
        new URLSearchParams({ season, id: "p_123456", playerView: "stats" }),
    },
    "../season_data.js": {
      loadSeason: () => {
        throw Error("bulk fallback activated");
      },
    },
    "../services/compact-reads.js": {
      ...service,
      readCompactPages: async (kind, params, { signal }) => {
        assert.equal(kind, "player");
        assert.equal(params.player, "p_123456");
        assert.equal(params.include, "shots");
        assert.ok(signal);
        throw Error("compact unavailable");
      },
    },
    "../services/resources.js": {
      useResource: (key, loader, enabled = true) => {
        if (enabled) jobs.push({ key, loader });
        return {
          loading: false,
          value:
            key === "manifest"
              ? manifest
              : key.startsWith("status:")
                ? false
                : empty,
          revalidate: async () => {},
          retry() {},
        };
      },
      cachedResource: () => undefined,
      primeResource: async () => empty,
      json: async () => ({}),
      download() {},
    },
    "../components/UI.jsx": ui,
    "../components/LoadingPage.jsx": moduleDefault(blank),
  });
  renderToStaticMarkup(h(mod.FootballProvider, null, h("p", null, "ready")));
  const actor = jobs.find((job) => job.key.startsWith("compact-actor:"));
  assert.ok(actor);
  await assert.rejects(
    actor.loader({ signal: new AbortController().signal }),
    /compact unavailable/,
  );
  assert.equal(
    jobs.some((job) => job.key.startsWith("season:")),
    false,
  );
});

test("compact revalidation preserves a coherent value only for the unchanged scope", async () => {
  const refs = [],
    effects = [];
  let index = 0,
    resource;
  const mod = await compile("hooks/useCompactRead.js", {
    react: {
      useRef: (value) => (refs[index++] ||= { current: value }),
      useEffect: (callback) => effects.push(callback),
    },
    "../services/resources.js": { useResource: () => resource },
  });
  const render = (params, clock = 0) => {
      index = 0;
      effects.length = 0;
      return mod.default("players", params, { clock });
    },
    commit = () => effects.forEach((effect) => effect());
  resource = {
    loading: false,
    value: { data: { players: [row("p_one", "Ancienne publication")] } },
  };
  const first = render({ season, generation: "g1", q: "Paris" });
  commit();
  resource = { loading: true };
  const renewing = render({ season, generation: "g2", q: "Paris" }, 1);
  assert.equal(renewing.value, first.value);
  assert.equal(renewing.refreshing, true);
  assert.equal(renewing.loading, false);
  const changed = render({ season, generation: "g2", q: "Lyon" });
  assert.equal(changed.value, undefined);
  assert.equal(changed.loading, true);
  resource = { loading: false, error: "offline" };
  const failed = render({ season, generation: "g2", q: "Paris" });
  assert.equal(failed.value, first.value);
  assert.equal(failed.error, undefined);
  assert.equal(failed.refreshError, "offline");
});

test("actor detail tabs do not retain a dataset missing the newly requested fields", async () => {
  const versionService = await import(
    pathToFileURL(path.join(frontend, "services/season-version.js")).href
  );
  for (const [route, id, field, views] of [
    ["/joueurs/", "p_123456", "playerView", ["overview", "stats"]],
    ["/clubs/", "t_123456", "clubView", ["overview", "squad", "matches"]],
  ]) {
    let view = views[0];
    const snapshots = [];
    const mod = await compile("hooks/FootballContext.jsx", {
      "next/navigation": {
        usePathname: () => route,
        useSearchParams: () =>
          new URLSearchParams({ season, id, [field]: view }),
      },
      "../services/season-version.js": {
        ...versionService,
        selectSeasonSnapshot: (previous, current, enabled) => {
          snapshots.push(current);
          return versionService.selectSeasonSnapshot(
            previous,
            current,
            enabled,
          );
        },
      },
      "../services/resources.js": {
        useResource: (key) => ({
          loading: false,
          value:
            key === "manifest"
              ? manifest
              : key.startsWith("status:")
                ? false
                : empty,
          revalidate: async () => {},
          retry() {},
        }),
        cachedResource: () => undefined,
        primeResource: async () => empty,
        json: async () => ({}),
        download() {},
      },
      "../components/UI.jsx": ui,
      "../components/LoadingPage.jsx": moduleDefault(blank),
    });
    for (view of views)
      renderToStaticMarkup(
        h(mod.FootballProvider, null, h("p", null, "ready")),
      );
    const previous = snapshots[0];
    for (const next of snapshots.slice(1)) {
      const selected = versionService.selectSeasonSnapshot(previous, {
        ...next,
        data: undefined,
      });
      assert.equal(selected.retained, false, `${route} ${next.key}`);
      assert.equal(selected.data, undefined);
    }
    const renewal = versionService.selectSeasonSnapshot(previous, {
      ...previous,
      key: previous.key + ":new-publication",
      data: undefined,
    });
    assert.equal(renewal.retained, true);
  }
});

test("a generation conflict remains visible when the manifest recovery also fails", async () => {
  let loader,
    recoveries = 0;
  const mod = await compile("hooks/useCompactRead.js", {
    react: { useRef: () => ({ current: null }), useEffect() {} },
    "../services/resources.js": {
      useResource: (key, read) => {
        loader = read;
        return { loading: true };
      },
    },
    "../services/compact-reads.js": {
      compactQuery: () => "scope",
      readCompact: async () => {
        throw Object.assign(Error("publication changed"), { status: 409 });
      },
    },
  });
  mod.default(
    "players",
    { season },
    {
      refreshManifest: async () => {
        recoveries++;
        throw Error("manifest offline");
      },
    },
  );
  await assert.rejects(
    loader({ signal: new AbortController().signal }),
    /publication changed/,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recoveries, 1);
});

test("comparison from a compact catalogue loads the complete aggregate cohort once per scope", async () => {
  const service = await import(
      pathToFileURL(path.join(frontend, "services/compact-reads.js")).href
    ),
    profiles = [
      profile("p_one", "Premier"),
      profile("p_two", "Deuxième"),
      profile("p_peer", "Pair"),
    ],
    requests = [],
    entries = profiles.slice(0, 2).map((p) => ({
      id: p.id,
      name: p.name,
      season,
      scope: {
        league: "all",
        leagues: [],
        focus: "all",
        role: "starter",
        venue: "all",
        result: "all",
        from: "",
        to: "",
      },
    }));
  const mod = await compile("components/PlayerComparison.jsx", {
    "../hooks/FootballContext.jsx": { useFootball: blank },
    "../hooks/ResearchContext.jsx": { useResearch: blank },
    "../services/scouting-history.js": {
      playerRoutes: async () => ({
        routes: {
          p_one: { [season]: [league] },
          p_two: { [season]: [league] },
        },
      }),
      loadPlayerSeason: () => {
        throw Error("bulk or actor read is unnecessary for season aggregates");
      },
    },
    "../services/compact-reads.js": {
      ...service,
      readCompactPages: async (kind, params) => {
        requests.push({ kind, params });
        return {
          pages: [{ players: profiles.map((profile) => ({ profile })) }],
        };
      },
    },
    "./UI.jsx": ui,
    "./ResearchUI.jsx": {
      MetricInfo: blank,
      MetricPicker: blank,
      ReportButton: blank,
    },
    "./ResearchCharts.jsx": { ResearchRadar: blank },
    "./CompetitionOptions.jsx": moduleDefault(blank),
  });
  const samples = await mod.comparisonSamples(
    {
      manifest,
      season,
      compactMode: true,
      data: {
        competitions: manifest.competitions,
        get appearances() {
          throw Error("empty catalogue is not a cohort");
        },
      },
    },
    entries,
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].params.role, "starter");
  assert.equal(requests[0].params.leagues, league);
  assert.equal(samples[0].profile.id, "p_one");
  assert.equal(samples[1].profile.id, "p_two");
  assert.equal(samples[0].profiles.length, 3);
});

test("explicit directory export includes all aggregate pages, never the empty catalogue", async () => {
  const service = await import(
      pathToFileURL(path.join(frontend, "services/compact-reads.js")).href
    ),
    requests = [],
    files = [];
  let context;
  const mod = await compile("hooks/FootballContext.jsx", {
    "next/navigation": {
      usePathname: () => "/joueurs/",
      useSearchParams: () => new URLSearchParams({ season, q: "Paris" }),
    },
    "../season_data.js": {
      loadSeason: () => {
        throw Error("export must not load a season");
      },
    },
    "../services/compact-reads.js": {
      ...service,
      readCompactPages: async (kind, params) => {
        requests.push({ kind, params });
        return {
          pages: [
            { players: [row("p_one", "Un"), row("p_two", "Deux")] },
            { players: [row("p_three", "Trois")] },
          ],
        };
      },
    },
    "../services/resources.js": {
      useResource: (key) => ({
        loading: false,
        value:
          key === "manifest"
            ? manifest
            : key.startsWith("status:")
              ? false
              : empty,
        revalidate: async () => {},
        retry() {},
      }),
      cachedResource: () => undefined,
      primeResource: async () => empty,
      json: async () => ({}),
      download: (...args) => files.push(args),
    },
    "../components/UI.jsx": ui,
    "../components/LoadingPage.jsx": moduleDefault(blank),
  });
  function Capture() {
    context = mod.useFootball();
    return null;
  }
  renderToStaticMarkup(h(mod.FootballProvider, null, h(Capture)));
  await context.exportRows("total");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].params.q, "Paris");
  assert.equal(files.length, 1);
  assert.equal(files[0][0], "statarena-joueurs.csv");
  for (const id of ["p_one", "p_two", "p_three"])
    assert.match(files[0][1], new RegExp(id));
});

test("a cup match linked from a championship filter opens its actual performance cohort", async () => {
  const cup = "l_0bfbkO",
    matchId = "m_000001",
    appearance = `${matchId}:p_000001`;
  for (const scenario of [
    { sourceSeason: season, partition: season, cached: true },
    { sourceSeason: "2025", partition: "2025/2026", cached: true },
    { sourceSeason: "2025", partition: "2025", cached: false },
  ]) {
    const selectedManifest = {
        ...manifest,
        publicationVersion: "42",
        competitions: [
          ...manifest.competitions,
          { id: cup, name: "Champions League" },
        ],
        seasons: [
          {
            id: season,
            chunks: [
              { leagueId: league },
              ...(scenario.partition === season ? [{ leagueId: cup }] : []),
            ],
          },
          ...(scenario.partition === season
            ? []
            : [{ id: scenario.partition, chunks: [{ leagueId: cup }] }]),
        ],
      },
      selectedMatch = {
        id: matchId,
        leagueId: cup,
        season: scenario.sourceSeason,
      },
      jobs = [],
      calls = [];
    let currentUrl = new URL(
        `https://vega.test/clubs/?season=${encodeURIComponent(season)}&league=${league}&focus=europe&id=t_000001`,
      ),
      opened = null,
      context;
    const service = await import(
      pathToFileURL(path.join(frontend, "services/compact-reads.js")).href
    );
    const mod = await compile("hooks/FootballContext.jsx", {
      react: {
        ...React,
        useState: (initial) =>
          React.useState(initial === null ? opened : initial),
      },
      "next/navigation": {
        usePathname: () => currentUrl.pathname,
        useSearchParams: () => currentUrl.searchParams,
      },
      "../season_data.js": {
        loadSeason: () => {
          throw Error("compact performance must not load a season");
        },
      },
      "../services/compact-reads.js": {
        ...service,
        readCompact: async (kind, params, { signal }) => {
          calls.push({ kind, params });
          assert.ok(signal);
          if (params.season !== scenario.partition || params.leagues !== cup)
            throw Object.assign(
              Error("Performance indisponible dans ce périmètre."),
              { status: 404 },
            );
          return {
            data: { row: { id: appearance } },
            meta: { generation: "42" },
          };
        },
      },
      "../services/resources.js": {
        useResource: (key, loader, enabled = true) => {
          if (enabled) jobs.push({ key, loader });
          return {
            loading: false,
            value:
              key === "manifest"
                ? selectedManifest
                : key.startsWith("status:")
                  ? false
                  : empty,
            revalidate: async () => {},
            retry() {},
          };
        },
        cachedResource: (key) =>
          key === `remote-match:${matchId}` && scenario.cached
            ? selectedMatch
            : undefined,
        primeResource: () => {
          throw Error("legacy cohort must not activate");
        },
        json: async () => ({}),
        download() {},
      },
      "../components/UI.jsx": ui,
      "../components/LoadingPage.jsx": moduleDefault(blank),
    });
    function Capture() {
      context = mod.useFootball();
      return h("p", null, "ready");
    }
    renderToStaticMarkup(h(mod.FootballProvider, null, h(Capture)));
    currentUrl = new URL(
      context.href("/matchs/", {
        id: matchId,
        competition: cup,
        sourceSeason: scenario.sourceSeason,
      }),
      currentUrl,
    );
    assert.equal(currentUrl.searchParams.get("league"), league);
    assert.equal(currentUrl.searchParams.get("competition"), cup);
    opened = appearance;
    jobs.length = 0;
    renderToStaticMarkup(h(mod.FootballProvider, null, h(Capture)));
    const job = jobs.find(({ key }) => key.startsWith("compact-performance:"));
    assert.ok(job);
    const result = await job.loader({ signal: new AbortController().signal });
    assert.equal(result.data.row.id, appearance);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "performance");
    assert.equal(calls[0].params.season, scenario.partition);
    assert.equal(calls[0].params.leagues, cup);
    assert.equal(
      jobs.some(({ key }) => key.startsWith("detail-cohort:")),
      false,
    );
  }
});

test("performance dialog uses server cohort centiles and the whole match rank", async () => {
  const appearance = {
      ...row("p_one", "Hakimi"),
      id: "m_one:p_one",
      playerId: "p_one",
      matchId: "m_one",
      minutes: 90,
      statsReliable: true,
      teamId: "t_paris",
      date: "2026-11-01",
    },
    match = {
      id: "m_one",
      home: { id: "t_paris", name: "Paris", score: 2 },
      away: { id: "t_other", name: "Autre", score: 0 },
    },
    remoteProfile = {
      line: { peers: "défenseurs" },
      peers: 340,
      missing: [],
      sections: [
        {
          id: "defence",
          title: "Défense",
          metrics: [
            {
              key: "tackles",
              label: "Tacles",
              value: 4,
              decimals: 0,
              unit: "",
              percentile: 88,
            },
          ],
        },
      ],
    },
    f = {
      compactMode: true,
      player: appearance.id,
      performanceData: {
        ...empty,
        appearances: [appearance],
        matches: [match],
      },
      byAppearance: new Map([[appearance.id, appearance]]),
      performanceSummary: {
        loading: false,
        value: {
          data: {
            row: appearance,
            match,
            competition: null,
            profile: remoteProfile,
            rank: { rank: 2, total: 27 },
          },
        },
      },
      comparison: [],
      href: (url) => url,
    };
  const service = await import(
    pathToFileURL(path.join(frontend, "services/player-profile.js")).href
  );
  const mod = await compile("components/PlayerDetails.jsx", {
    "../hooks/FootballContext.jsx": { useFootball: () => f },
    "./UI.jsx": ui,
    "./Icon.jsx": moduleDefault(blank),
    "./PlayerData.jsx": moduleDefault(blank),
    "./MessiGoats.jsx": moduleDefault(blank),
    "../services/player-profile.js": {
      ...service,
      performanceProfile() {
        throw Error("local subset centile");
      },
      matchRatingRank() {
        throw Error("local subset rank");
      },
      keyFigures: () => [],
    },
  });
  const html = renderToStaticMarkup(h(mod.PlayerDialog));
  assert.match(html, /340 performances de défenseurs/);
  assert.match(html, /88/);
  assert.match(html, /2e note sur 27/);
});
