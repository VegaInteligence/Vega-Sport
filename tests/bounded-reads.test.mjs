import test from "node:test";
import assert from "node:assert/strict";
import {
  searchIdentities,
  hasBoundedSearch,
} from "../dashboard/frontend/src/services/global-search-client.js";
import {
  matchPageFilters,
  readFixturePage,
} from "../dashboard/frontend/src/services/match-pages.js";
import {
  pagedMatchList,
  seasonVersion,
  selectSeasonSnapshot,
} from "../dashboard/frontend/src/services/season-version.js";
import {
  loadSeason,
  readPages,
} from "../dashboard/frontend/src/season_data.js";

const manifest = {
  storage: "aws-relational",
  capabilities: { boundedSearch: true, fixturePaginationOrder: true },
  publicationVersion: "42",
  competitions: [{ id: "l_3FJFUl", name: "Ligue 1", country: "FRA" }],
  seasons: [
    {
      id: "2026/2027",
      chunks: [
        { leagueId: "l_3FJFUl", sourceDigest: "fr1" },
        { leagueId: "l_4WFCIZ", sourceDigest: "eng1" },
      ],
    },
  ],
};
const fixtureFilters = {
  season: "2026/2027",
  limit: "30",
  status: "played",
  order: "desc",
};
const page = (overrides = {}) => ({
  data: { matches: [{ id: "m_first1" }] },
  pagination: { generation: "42", nextCursor: "next-cursor" },
  ...overrides,
});

test("match listing activates only when the backend advertises ordered pagination", () => {
  assert.equal(pagedMatchList(manifest, "/matchs/", null), true);
  assert.equal(pagedMatchList(manifest, "/matchs", "m_first1"), false);
  assert.equal(pagedMatchList(manifest, "/joueurs/", null), false);
  assert.equal(
    pagedMatchList({ ...manifest, capabilities: {} }, "/matchs/", null),
    false,
  );
  assert.equal(
    pagedMatchList({ ...manifest, storage: "aws-pro" }, "/matchs/", null),
    false,
  );
  assert.equal(hasBoundedSearch(manifest), true);
  assert.equal(hasBoundedSearch({ ...manifest, capabilities: {} }), false);
  assert.equal(hasBoundedSearch(null), false);
});

test("data versions follow selected source chunks, not unrelated asset publications", () => {
  const scope = new Set(["l_3FJFUl"]);
  const original = seasonVersion(manifest, "2026/2027", scope);
  const assetUpdate = structuredClone(manifest);
  assetUpdate.publicationVersion = "43";
  assetUpdate.retrievedAt = "2026-11-07T00:00:00Z";
  assetUpdate.competitions[0].imageUrl = "new-image";
  assert.equal(seasonVersion(assetUpdate, "2026/2027", scope), original);
  assetUpdate.seasons[0].chunks[1].sourceDigest = "eng2";
  assert.equal(seasonVersion(assetUpdate, "2026/2027", scope), original);
  assert.notEqual(
    seasonVersion(assetUpdate, "2026/2027"),
    seasonVersion(manifest, "2026/2027"),
  );
  assetUpdate.seasons[0].chunks[0].sourceDigest = "fr2";
  assert.notEqual(seasonVersion(assetUpdate, "2026/2027", scope), original);
  const reordered = structuredClone(manifest);
  reordered.seasons[0].chunks.reverse();
  assert.equal(
    seasonVersion(reordered, "2026/2027"),
    seasonVersion(manifest, "2026/2027"),
  );
  assert.notEqual(seasonVersion(manifest, "2025/2026"), original);
});

test("a digest renewal retains its coherent data/manifest pair only for the same intent and scope", () => {
  const previous = {
    key: "digest-1",
    intent: "season-and-filters",
    scope: "europe",
    data: { matches: ["old-match"] },
    manifest: { publicationVersion: "1" },
  };
  const pending = {
    ...previous,
    key: "digest-2",
    data: undefined,
    manifest: { publicationVersion: "2" },
  };
  const retained = selectSeasonSnapshot(previous, pending);
  assert.equal(retained.retained, true);
  assert.equal(retained.data, previous.data);
  assert.equal(retained.manifest, previous.manifest);
  assert.equal(retained.key, "digest-1");
  assert.equal(
    selectSeasonSnapshot(previous, {
      ...pending,
      intent: "new-season-or-filter",
    }).data,
    undefined,
  );
  assert.equal(
    selectSeasonSnapshot(previous, { ...pending, scope: "all" }).data,
    undefined,
  );
  assert.equal(selectSeasonSnapshot(previous, pending, false).data, undefined);
  const next = { ...pending, data: { matches: ["new-match"] } };
  const ready = selectSeasonSnapshot(previous, next);
  assert.equal(ready.retained, false);
  assert.equal(ready.data, next.data);
  assert.equal(ready.manifest, next.manifest);
});

test("a season cannot cache a newly published partition under an older source digest", async () => {
  const value = {
    ...manifest,
    seasons: [
      {
        id: "2026/2027",
        chunks: [{ leagueId: "l_3FJFUl", sourceDigest: "fr1" }],
      },
    ],
  };
  let generation = "fr2";
  const calls = [];
  const fetcher = async (path) => {
    calls.push(new URL(path, "https://site.test"));
    return Response.json({
      data: {
        meta: {},
        matches: [],
        fixtures: [],
        appearances: [],
        teams: [],
        competitions: [],
        metrics: [],
      },
      pagination: { generation, nextCursor: null },
    });
  };
  await assert.rejects(
    loadSeason(value, "2026/2027", fetcher),
    /publiées ont changé/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.has("v"), false);
  generation = "fr1";
  const result = await loadSeason(value, "2026/2027", fetcher);
  assert.deepEqual(result.matches, []);
  assert.equal(calls.length, 2, "the mismatched generation was not cached");
  const versioned = structuredClone(value);
  versioned.capabilities.versionedPartitions = true;
  await loadSeason(versioned, "2026/2027", fetcher);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].searchParams.get("v"), "fr1");
});

test("an expected partition digest stops at its first divergent page", async () => {
  let calls = 0;
  await assert.rejects(
    readPages(
      "/api/seasons/partition",
      {},
      async () => {
        calls++;
        return Response.json({
          data: {},
          pagination: { generation: "new", nextCursor: "next" },
        });
      },
      { expectedGeneration: "old" },
    ),
    /publiées ont changé/,
  );
  assert.equal(calls, 1);
});

test("result filters request one compact descending page within the exact scope", () => {
  const all = matchPageFilters({
    manifest,
    season: "2026/2027",
    focus: "all",
    query: " Paris ",
  });
  assert.deepEqual(all, { ...fixtureFilters, q: "Paris" });
  const europe = matchPageFilters({
    manifest,
    season: "2026/2027",
    focus: "europe",
  });
  assert.ok(europe.leagues.includes("l_3FJFUl"));
  assert.equal(europe.league, undefined);
  const selected = matchPageFilters({
    manifest,
    season: "2026/2027",
    focus: "europe",
    league: "l_3FJFUl",
  });
  assert.equal(selected.league, "l_3FJFUl");
  assert.equal(selected.leagues, undefined);
  assert.equal(
    matchPageFilters({
      manifest,
      season: "2026/2027",
      focus: "europe",
      league: "l_other1",
    }),
    null,
  );
});

test("upcoming pages follow the Paris week, including the UTC day boundary", () => {
  const filters = matchPageFilters({
    manifest,
    season: "2026/2027",
    focus: "all",
    upcoming: true,
    now: Date.parse("2026-11-08T23:30:00Z"),
  });
  assert.equal(filters.status, "upcoming");
  assert.equal(filters.order, "asc");
  assert.equal(filters.from, "2026-11-08");
  assert.equal(filters.to, "2026-11-15");
  assert.equal(
    matchPageFilters({
      manifest,
      season: "2026/2027",
      focus: "all",
      upcoming: true,
      week: "2026-10-01",
      now: Date.parse("2026-11-08T23:30:00Z"),
    }),
    null,
  );
});

test("a next cursor does not trigger another fetch until explicitly requested", async () => {
  const calls = [],
    signal = new AbortController().signal;
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return Response.json(page());
  };
  const first = await readFixturePage(fixtureFilters, { fetcher, signal });
  assert.equal(calls.length, 1);
  assert.equal(first.pagination.nextCursor, "next-cursor");
  const firstUrl = new URL(calls[0].url, "https://site.test");
  assert.equal(firstUrl.pathname, "/api/fixtures");
  assert.equal(firstUrl.searchParams.get("limit"), "30");
  assert.equal(firstUrl.searchParams.has("cursor"), false);
  assert.equal(calls[0].options.signal, signal);
  await readFixturePage(fixtureFilters, {
    fetcher,
    cursor: first.pagination.nextCursor,
    generation: "42",
  });
  assert.equal(calls.length, 2);
  assert.equal(
    new URL(calls[1].url, "https://site.test").searchParams.get("cursor"),
    "next-cursor",
  );
});

test("409 and generation mismatches require reset without loops or mixed data", async () => {
  let calls = 0;
  const changed = await readFixturePage(fixtureFilters, {
    cursor: "old-cursor",
    generation: "41",
    fetcher: async () => {
      calls++;
      return new Response(null, { status: 409 });
    },
  });
  assert.deepEqual(changed, { publicationChanged: true });
  assert.equal(calls, 1);
  const mixed = await readFixturePage(fixtureFilters, {
    cursor: "old-cursor",
    generation: "41",
    fetcher: async () => Response.json(page()),
  });
  assert.deepEqual(mixed, { publicationChanged: true });
  assert.equal(mixed.data, undefined);
});

test("empty scopes do not fetch and malformed or failed pages do not look complete", async () => {
  const empty = await readFixturePage(null, {
    fetcher: async () => {
      throw new Error("unexpected fetch");
    },
  });
  assert.deepEqual(empty.data.matches, []);
  assert.equal(empty.pagination.nextCursor, null);
  await assert.rejects(
    readFixturePage(fixtureFilters, {
      fetcher: async () => new Response(null, { status: 500 }),
    }),
    /HTTP 500/,
  );
  await assert.rejects(
    readFixturePage(fixtureFilters, {
      fetcher: async () =>
        Response.json(
          page({ data: { matches: Array.from({ length: 31 }, () => ({})) } }),
        ),
    }),
    /invalide/,
  );
  await assert.rejects(
    readFixturePage(fixtureFilters, {
      fetcher: async () =>
        Response.json(page({ pagination: { generation: "42" } })),
    }),
    /invalide/,
  );
});

test("identity searches start at two characters, encode the query and forward cancellation", async () => {
  const calls = [],
    signal = new AbortController().signal;
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ players: [], clubs: [] });
  };
  await searchIdentities(" ", "2026/2027", { fetcher });
  await searchIdentities("m", "2026/2027", { fetcher });
  await searchIdentities("mbappe", null, { fetcher });
  assert.equal(calls.length, 0);
  await searchIdentities(" Mbappé & PSG ", "2026/2027", { fetcher, signal });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url, "https://site.test");
  assert.equal(url.pathname, "/api/search");
  assert.equal(url.searchParams.get("q"), "Mbappé & PSG");
  assert.equal(url.searchParams.get("season"), "2026/2027");
  assert.equal(calls[0].options.signal, signal);
  await assert.rejects(
    searchIdentities("Paris", "2026", {
      fetcher: async () =>
        Response.json({
          players: Array.from({ length: 7 }, () => ({})),
          clubs: [],
        }),
    }),
    /invalides/,
  );
  await assert.rejects(
    searchIdentities("Paris", "2026", {
      fetcher: async () => new Response(null, { status: 503 }),
    }),
    /indisponible/,
  );
});

test("navbar focus/typing selects the advertised read path and cancels its debounced request", async () => {
  const { createRequire } = await import("node:module");
  const { readFileSync } = await import("node:fs");
  const { runInNewContext } = await import("node:vm");
  const globalSearch =
    await import("../dashboard/frontend/src/services/global-search.js");
  const requireLocal = createRequire(
    new URL("../dashboard/package.json", import.meta.url),
  );
  const React = requireLocal("react");
  const { renderToStaticMarkup } = requireLocal("react-dom/server");
  const babel = requireLocal("next/dist/compiled/babel/core");
  const preset = requireLocal("next/dist/compiled/babel/preset-react");
  const commonjs = requireLocal(
    "next/dist/compiled/babel/plugin-transform-modules-commonjs",
  );
  const code = babel.transformSync(
    readFileSync(
      new URL(
        "../dashboard/frontend/src/components/GlobalSearch.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      presets: [[preset, { runtime: "classic" }]],
      plugins: [commonjs],
      babelrc: false,
      configFile: false,
    },
  ).code;
  const cases = [
    { query: "", advertised: true },
    { query: "m", advertised: true },
    { query: "mb", advertised: true },
    { query: "", advertised: false },
    { query: "m", advertised: false },
    { query: "mb", advertised: false },
  ];
  for (const scenario of cases) {
    const effects = [],
      timers = new Map(),
      calls = [],
      pending = [];
    let stateIndex = 0,
      legacyLoads = 0;
    const context = {
      manifest: {
        ...manifest,
        capabilities: scenario.advertised ? manifest.capabilities : {},
      },
      season: "2026/2027",
      allCatalog: manifest.competitions,
      data: {
        appearances: [{ name: "Partial data must not be used" }],
        matches: [],
      },
      searchDataKey: "full-season-version",
      searchData: async () => {
        legacyLoads++;
        return { appearances: [], matches: [] };
      },
    };
    // Effects are exercised after the server render with controlled timers.
    // The first three states represent a focused, armed input with typed text.
    const react = {
      ...React,
      useContext: () => context,
      useState: (initial) => [
        [scenario.query, true, true, 0, null][stateIndex++] ?? initial,
        () => {},
      ],
      useEffect: (effect) => effects.push(effect),
    };
    const stubs = {
      react,
      "next/link": {
        __esModule: true,
        default: ({ children, ...props }) =>
          React.createElement("a", props, children),
      },
      "./Icon.jsx": { __esModule: true, default: () => null },
      "./UI.jsx": { Media: () => null },
      "../hooks/FootballContext.jsx": { FootballContext: {} },
      "../services/format.js": { number: String },
      "../services/global-search.js": globalSearch,
      "../services/resources.js": {
        useResource: (key, loader, enabled) => {
          if (enabled) pending.push(Promise.resolve(loader()).catch(() => {}));
          return { loading: Boolean(enabled) };
        },
      },
      "../services/catalog-client.js": {
        cupIndex: async () => ({ competitions: [] }),
      },
      "../services/global-search-client.js": {
        hasBoundedSearch,
        searchIdentities: async (query, season, options) => {
          calls.push({ query, season, signal: options.signal });
          // An advertised endpoint error must not download the legacy season.
          throw new Error("Unavailable");
        },
      },
    };
    const mod = { exports: {} };
    runInNewContext("(function(require,module,exports){" + code + "\n})", {
      AbortController,
      setTimeout: (callback, delay) => {
        assert.equal(delay, 180);
        timers.set(1, callback);
        return 1;
      },
      clearTimeout: (id) => timers.delete(id),
      window: { addEventListener() {}, removeEventListener() {} },
      document: { addEventListener() {}, removeEventListener() {} },
    })(
      (name) => {
        assert.ok(name in stubs, "Unexpected import: " + name);
        return stubs[name];
      },
      mod,
      mod.exports,
    );
    renderToStaticMarkup(React.createElement(mod.exports.default));
    const cleanups = effects.map((effect) => effect());
    assert.equal(calls.length, 0, "the remote request waits for the debounce");
    for (const timer of timers.values()) timer();
    await Promise.all(pending);
    await new Promise((resolve) => setImmediate(resolve));
    const hasQuery = scenario.query.length >= 2;
    assert.equal(calls.length, scenario.advertised && hasQuery ? 1 : 0);
    assert.equal(legacyLoads, !scenario.advertised && hasQuery ? 1 : 0);
    for (const cleanup of cleanups)
      if (typeof cleanup === "function") cleanup();
    if (calls[0]) assert.equal(calls[0].signal.aborted, true);
    assert.equal(timers.size, 0);
  }
});
