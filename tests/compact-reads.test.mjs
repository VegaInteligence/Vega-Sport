import test from "node:test";
import assert from "node:assert/strict";
import {
  compactCatalogue,
  compactScope,
  directoryScopeIds,
  playerReadParams,
  readCompact,
  readCompactPages,
  readPlayerDiscipline,
  mergeActorPages,
  supportsCompactRead,
} from "../dashboard/frontend/src/services/compact-reads.js";
import { readPages } from "../dashboard/frontend/src/season_data.js";
import { EMPTY_ADVANCED } from "../dashboard/frontend/src/services/advanced-filters.js";

const manifest = {
  storage: "aws-relational",
  publicationVersion: "g1",
  capabilities: { compactReads: { players: true, home: true } },
  seasons: [
    {
      id: "2026/2027",
      chunks: [
        { leagueId: "l_3FJFUl" },
        { leagueId: "l_4WFCIZ" },
        { leagueId: "l_other" },
      ],
    },
  ],
  competitions: [],
};
const response = (
  data,
  {
    page = 1,
    limit = 100,
    total = 1,
    generation = "g1",
    pages = Math.max(1, Math.ceil(total / limit)),
  } = {},
) => ({
  ok: true,
  status: 200,
  json: async () => ({
    data,
    pagination: { page, limit, total, pages, generation },
    meta: { generation },
  }),
});

test("compact capability is per route and a real empty selection is not all", () => {
  assert.equal(supportsCompactRead(manifest, "players"), true);
  assert.equal(supportsCompactRead(manifest, "club"), false);
  assert.equal(
    supportsCompactRead({ ...manifest, storage: "json-packed" }, "players"),
    false,
  );
  assert.equal(
    compactScope(
      directoryScopeIds(manifest, "2026/2027", "europe", { league: "l_other" }),
    ),
    "none",
  );
  assert.equal(
    compactScope(
      directoryScopeIds(manifest, "2026/2027", "all", {
        league: "l_3FJFUl",
        leagues: ["l_4WFCIZ"],
      }),
    ),
    "none",
  );
  assert.equal(
    compactScope(directoryScopeIds(manifest, "2026/2027", "all", {})),
    "all",
  );
});

test("compact catalogue keeps counts for the selected season instead of lifetime counts", () => {
  const catalogue = compactCatalogue(
    {
      competitions: [{ id: "league", name: "Ligue", sampleMatches: 8000 }],
      seasons: [
        {
          id: "season",
          chunks: [{ leagueId: "league", meta: { matchCount: 81 } }],
        },
      ],
    },
    "season",
  );
  assert.equal(catalogue[0].name, "Ligue");
  assert.equal(catalogue[0].sampleMatches, 81);
  assert.deepEqual(catalogue[0].sampleSeasons, ["season"]);
});

test("player requests preserve sample filters and apply numeric criteria only to directory results", () => {
  const f = {
    manifest,
    season: "2026/2027",
    focus: "all",
    filters: {
      league: "all",
      leagues: ["l_4WFCIZ", "l_3FJFUl"],
      query: "Achraf",
      minutes: 65,
      basis: "per90",
      ranking: "goals",
      match: "m_123456",
      advanced: {
        ...EMPTY_ADVANCED,
        positions: ["D"],
        role: "starter",
        venue: "away",
        result: "win",
        from: "2026-10-01",
        to: "2026-11-02",
        rating: 7,
        conditions: [{ key: "xg", min: 0.4 }],
      },
    },
  };
  const directory = playerReadParams(f, {
    page: 3,
    sort: { key: "rating", direction: "desc" },
  });
  assert.equal(directory.leagues, "l_3FJFUl,l_4WFCIZ");
  assert.equal(directory.page, 3);
  assert.equal(directory.minutes, 65);
  assert.equal(directory.stats, "xg:0.4");
  assert.equal(directory.basis, "per90");
  const cohort = playerReadParams(f, { cohort: true });
  for (const key of [
    "leagues",
    "match",
    "role",
    "venue",
    "result",
    "from",
    "to",
  ])
    assert.equal(cohort[key], directory[key], key);
  for (const key of ["q", "ranking", "pos", "stats", "rmin"])
    assert.equal(cohort[key], "", key);
  assert.equal(cohort.minutes, 0);
  assert.equal(
    cohort.basis,
    "total",
    "switching display basis does not redownload a cohort",
  );
});

test("opening one directory page makes one bounded request and forwards cancellation", async () => {
  const controller = new AbortController(),
    calls = [];
  await readCompact(
    "players",
    { season: "2026/2027", page: 4, limit: 20, generation: "g1" },
    {
      signal: controller.signal,
      fetcher: async (url, options) => {
        calls.push({ url, options });
        return response(
          { players: [{ playerId: "p_4" }] },
          { page: 4, total: 100, limit: 20 },
        );
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^\/api\/read\/players\?/);
  assert.equal(
    new URL(calls[0].url, "https://test").searchParams.get("page"),
    "4",
  );
  assert.equal(calls[0].options.signal, controller.signal);
});

test("explicit analysis traverses complete aggregates under one publication", async () => {
  const calls = [];
  const result = await readCompactPages(
    "players",
    { season: "2026/2027", limit: 2 },
    {
      fetcher: async (url) => {
        const query = new URL(url, "https://test").searchParams,
          page = Number(query.get("page"));
        calls.push(query);
        return response(
          {
            players: Array.from({ length: page === 1 ? 2 : 1 }, (_, i) => ({
              playerId: "p_" + ((page - 1) * 2 + i),
            })),
          },
          { page, limit: 2, total: 3 },
        );
      },
    },
  );
  assert.equal(result.pages.flatMap((data) => data.players).length, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].get("generation"), null);
  assert.equal(calls[1].get("generation"), "g1");
});

test("incomplete, duplicate or changed-generation pages cannot masquerade as a full cohort", async () => {
  for (const issue of ["short", "duplicate", "generation"]) {
    let calls = 0;
    await assert.rejects(
      readCompactPages(
        "players",
        { limit: 1 },
        {
          fetcher: async () => {
            const page = ++calls;
            return response(
              {
                players:
                  issue === "short"
                    ? []
                    : [
                        {
                          playerId:
                            issue === "duplicate" ? "same" : "p_" + page,
                        },
                      ],
              },
              {
                page,
                limit: 1,
                total: 2,
                generation: issue === "generation" && page === 2 ? "g2" : "g1",
              },
            );
          },
        },
      ),
      /incomplète|doublons|publication/,
    );
    assert.ok(calls <= 2);
  }
});

test("an advertised API failure never falls back to downloading partitions", async () => {
  const urls = [];
  await assert.rejects(
    readCompactPages(
      "players",
      { generation: "g1" },
      {
        fetcher: async (url) => {
          urls.push(url);
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: { message: "Service indisponible" } }),
          };
        },
      },
    ),
    /Service indisponible/,
  );
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^\/api\/read\/players/);
});

test("actor pages keep the 25-match detail budget and merge their own rows", async () => {
  const result = await readCompactPages(
    "player",
    { season: "2026/2027", player: "p_one", include: "shots" },
    {
      fetcher: async (url) => {
        assert.equal(
          new URL(url, "https://test").searchParams.get("limit"),
          "25",
        );
        return response(
          {
            matches: [{ id: "m_one" }],
            fixtures: [{ id: "m_one" }],
            appearances: [{ id: "m_one:p_one", playerId: "p_one" }],
            teams: [{ id: "t_one" }],
            competitions: [],
            metrics: [],
          },
          { limit: 25 },
        );
      },
    },
  );
  const data = mergeActorPages(result, manifest, "2026/2027");
  assert.equal(data.matches.length, 1);
  assert.deepEqual(
    data.appearances.map((row) => row.playerId),
    ["p_one"],
  );
  assert.equal(data.meta.storage, "aws-relational");
});

test("abandoning a cohort or a legacy cascade stops before its next page", async () => {
  for (const compact of [true, false]) {
    const controller = new AbortController();
    let calls = 0;
    const fetcher = async (_url, options) => {
      assert.equal(options.signal, controller.signal);
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () => {
          controller.abort();
          return compact
            ? {
                data: { players: [{ playerId: "p_one" }] },
                pagination: {
                  page: 1,
                  pages: 2,
                  total: 2,
                  limit: 1,
                  generation: "g1",
                },
                meta: { generation: "g1" },
              }
            : {
                data: { matches: [] },
                pagination: { generation: "g1", nextCursor: "page2" },
              };
        },
      };
    };
    await assert.rejects(
      compact
        ? readCompactPages(
            "players",
            { limit: 1 },
            { signal: controller.signal, fetcher },
          )
        : readPages("/api/seasons/partition", {}, fetcher, {
            signal: controller.signal,
          }),
      { name: "AbortError" },
    );
    assert.equal(calls, 1);
  }
});

test("compact discipline batches exact native matches under one generation", async () => {
  const ids = Array.from(
      { length: 201 },
      (_, i) => `m_${String(i + 1).padStart(6, "0")}`,
    ),
    calls = [],
    signal = new AbortController().signal;
  const result = await readPlayerDiscipline(
    manifest,
    "2026/2027",
    "p_000001",
    [...ids, ids[0], "uefa:historic"],
    {
      signal,
      fetcher: async (url, options) => {
        assert.equal(options.signal, signal);
        const query = new URL(url, "https://api.test").searchParams,
          matches = query.get("matches").split(",");
        calls.push(query);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              yellow: matches.length,
              directRed: 0,
              secondYellow: 0,
              covered: matches.length,
              total: matches.length,
            },
            meta: { generation: "g1" },
          }),
        };
      },
    },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((query) => query.get("matches").split(",").length),
    [200, 1],
  );
  assert.ok(
    calls.every(
      (query) =>
        query.get("generation") === "g1" && query.get("player") === "p_000001",
    ),
  );
  assert.deepEqual(result, {
    yellow: 201,
    directRed: 0,
    secondYellow: 0,
    covered: 201,
    total: 201,
  });
});

test("discipline cancellation and changed publication never return partial totals", async () => {
  const ids = Array.from(
    { length: 201 },
    (_, i) => `m_${String(i + 1).padStart(6, "0")}`,
  );
  for (const abort of [true, false]) {
    const controller = new AbortController();
    let calls = 0;
    await assert.rejects(
      readPlayerDiscipline(manifest, "2026/2027", "p_000001", ids, {
        signal: controller.signal,
        fetcher: async (url) => {
          calls++;
          const count = new URL(url, "https://api.test").searchParams
            .get("matches")
            .split(",").length;
          if (abort) controller.abort();
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                yellow: count,
                directRed: 0,
                secondYellow: 0,
                covered: count,
                total: count,
              },
              meta: { generation: calls === 1 ? "g1" : "g2" },
            }),
          };
        },
      }),
      abort ? { name: "AbortError" } : /publication reçue/,
    );
    assert.equal(calls, abort ? 1 : 2);
  }
});

test("parallel cohort pages are bounded, pinned and returned in page order", async () => {
  let active = 0,
    maximum = 0;
  const starts = [],
    notifications = [];
  const result = await readCompactPages(
    "players",
    { limit: 1 },
    {
      parallelPages: true,
      onPage: ({ page }) => notifications.push(page),
      fetcher: async (url) => {
        const q = new URL(url, "https://test").searchParams;
        const page = Number(q.get("page"));
        if (page > 1) assert.equal(q.get("generation"), "g1");
        starts.push(page);
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) =>
          setTimeout(resolve, page === 2 ? 30 : 5),
        );
        active--;
        return response(
          { players: [{ playerId: `p_${page}` }] },
          { page, limit: 1, total: 6 },
        );
      },
    },
  );
  assert.equal(maximum, 2);
  assert.deepEqual(starts, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(notifications, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    result.pages.map((p) => p.players[0].playerId),
    ["p_1", "p_2", "p_3", "p_4", "p_5", "p_6"],
  );
  await assert.rejects(
    readCompactPages(
      "players",
      { limit: 1 },
      {
        parallelPages: true,
        fetcher: async (url) => {
          const page = Number(
            new URL(url, "https://test").searchParams.get("page"),
          );
          return response(
            { players: [{ playerId: page === 3 ? "p_2" : `p_${page}` }] },
            { page, limit: 1, total: 4 },
          );
        },
      },
    ),
    /doublons/,
  );
});

test("parallel pages retry transient failures once after their batch, but never retry 409", async () => {
  for (const status of [429, 502, 503, 504, 409]) {
    const attempts = new Map(),
      active = new Set(),
      sequence = [];
    const promise = readCompactPages(
      "players",
      { limit: 1 },
      {
        parallelPages: true,
        fetcher: async (url) => {
          const page = Number(
            new URL(url, "https://test").searchParams.get("page"),
          );
          const attempt = (attempts.get(page) || 0) + 1;
          attempts.set(page, attempt);
          sequence.push(`start:${page}:${attempt}`);
          active.add(page);
          await new Promise((resolve) =>
            setTimeout(resolve, page === 3 ? 20 : 3),
          );
          active.delete(page);
          sequence.push(`end:${page}:${attempt}`);
          if (page === 2 && attempt === 1)
            return {
              ok: false,
              status,
              json: async () => ({ error: { message: "unavailable" } }),
            };
          return response(
            { players: [{ playerId: `p_${page}` }] },
            { page, limit: 1, total: 3 },
          );
        },
      },
    );
    if (status === 409) {
      await assert.rejects(promise, /unavailable/);
      assert.equal(attempts.get(2), 1);
    } else {
      const value = await promise;
      assert.equal(value.pages.length, 3);
      assert.equal(attempts.get(2), 2);
      assert.ok(sequence.indexOf("start:2:2") > sequence.indexOf("end:3:1"));
    }
  }
});
