import test from "node:test";
import assert from "node:assert/strict";
import {
  routeNeedsSeason,
  seasonCoverage,
} from "../dashboard/frontend/src/services/route-data.js";
import {
  actorReadParams,
  currentPlayerSeason,
} from "../dashboard/frontend/src/services/actor-reads.js";
import {
  loadPlayerHistory,
  playerRoutes,
} from "../dashboard/frontend/src/services/scouting-history.js";
import { createResourceCache } from "../dashboard/frontend/src/services/resource-cache.js";
import { competitionFixturePreview } from "../dashboard/frontend/src/services/fixture-pages.js";

const season = "2026/2027";
const manifest = {
  storage: "aws-relational",
  publicationVersion: "42",
  capabilities: {
    compactReads: { player: true, club: true },
    actorSummary: true,
  },
  seasons: [
    {
      id: season,
      chunks: [
        {
          leagueId: "l_000001",
          meta: { matchCount: 30, appearanceCount: 840 },
        },
      ],
    },
  ],
};
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("independent-reader routes mount without downloading a football season", () => {
  for (const path of [
    "competitions",
    "archives",
    "methode",
    "classement-joueurs",
    "calendrier",
    "joueurs/matchs",
  ])
    for (const suffix of ["", "/"])
      assert.equal(
        routeNeedsSeason(`/${path}${suffix}`, new URLSearchParams()),
        false,
        path,
      );
  for (const path of ["/", "/joueurs/", "/clubs/", "/matchs/"])
    assert.equal(routeNeedsSeason(path, new URLSearchParams()), true, path);
  assert.equal(
    routeNeedsSeason(
      "/clubs/",
      new URLSearchParams({ clubLeague: "l_000001", clubTeam: "Paris" }),
    ),
    false,
  );
  assert.deepEqual(seasonCoverage(manifest, season), {
    matches: 30,
    appearances: 840,
  });
  const missing = structuredClone(manifest);
  missing.seasons[0].chunks.push({
    leagueId: "l_000002",
    meta: { matchCount: 20 },
  });
  assert.deepEqual(
    seasonCoverage(missing, season),
    { matches: 50, appearances: null },
    "missing published counts never become a false complete total",
  );
});

test("summary actor boot is capability-gated and heavy details keep a separate identity", () => {
  const input = { id: "p_000001", season };
  assert.deepEqual(actorReadParams(manifest, "player", input), {
    season,
    player: input.id,
    leagues: "all",
    include: "",
    detail: "summary",
    limit: 100,
    generation: "42",
  });
  assert.equal(
    actorReadParams(manifest, "player", { ...input, include: "shots" }).detail,
    undefined,
  );
  assert.equal(
    actorReadParams({ ...manifest, capabilities: {} }, "player", input).detail,
    undefined,
  );
});

test("a known compact season reads the actor directly without a routing-index waterfall", async () => {
  const calls = [];
  const result = await loadPlayerHistory(manifest, "p_000001", {
    season,
    fetcher: async (path) => {
      const url = new URL(path, "https://site.test");
      calls.push(url);
      assert.equal(url.pathname, "/api/read/player");
      assert.equal(url.searchParams.get("detail"), "summary");
      assert.equal(url.searchParams.get("limit"), "100");
      return Response.json({
        data: {
          meta: {
            actor: { kind: "player", id: "p_000001" },
            detail: "summary",
          },
          appearances: [
            {
              id: "a1",
              playerId: "p_000001",
              matchId: "m_000001",
              minutes: 90,
              goals: 2,
            },
          ],
          matches: [{ id: "m_000001" }],
          fixtures: [],
          teams: [],
          competitions: [],
          metrics: [],
        },
        meta: { generation: "42" },
        pagination: {
          generation: "42",
          page: 1,
          limit: 100,
          total: 1,
          pages: 1,
        },
      });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result[0].profile.minutes, 90);
  assert.equal(result[0].profile.stats.goals.sum, 2);
  assert.equal(result[0].data.meta.complete, true);
  const f = { manifest, season, data: result[0].data };
  assert.equal(currentPlayerSeason(f, "p_000001", season).profile.minutes, 90);
  assert.equal(
    currentPlayerSeason(
      { ...f, manifest: { ...manifest, publicationVersion: "43" } },
      "p_000001",
      season,
    ),
    undefined,
  );
  assert.equal(
    currentPlayerSeason(
      {
        ...f,
        data: { ...f.data, meta: { ...f.data.meta, actorScope: "l_000001" } },
      },
      "p_000001",
      season,
    ),
    undefined,
  );
  assert.equal(
    currentPlayerSeason(
      { ...f, data: { ...f.data, meta: { ...f.data.meta, complete: false } } },
      "p_000001",
      season,
    ),
    undefined,
  );
});

test("route indexes reuse completed reads even with cancellation and a new manifest object", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({ routes: {}, clubRoutes: {} });
  };
  await playerRoutes(manifest, { players: ["p_000001"] }, fetcher, {
    signal: new AbortController().signal,
  });
  await playerRoutes({ ...manifest }, { players: ["p_000001"] }, fetcher, {
    signal: new AbortController().signal,
  });
  assert.equal(calls, 1);
  await playerRoutes(
    { ...manifest, publicationVersion: "43" },
    { players: ["p_000001"] },
    fetcher,
  );
  assert.equal(calls, 2, "publication updates invalidate the routing cache");
});

test("abandoning one shared read cannot cancel another consumer", async () => {
  const cache = createResourceCache();
  const first = new AbortController(),
    second = new AbortController();
  let finish,
    underlying,
    calls = 0;
  const loader = ({ signal }) => {
    underlying = signal;
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const a = cache.read("query", loader, { signal: first.signal });
  const rejected = assert.rejects(a, { name: "AbortError" });
  const b = cache.read("query", loader, { signal: second.signal });
  await nextTurn();
  first.abort();
  await rejected;
  assert.equal(underlying.aborted, false);
  finish("ready");
  assert.equal(await b, "ready");
  assert.equal(await cache.read("query", loader), "ready");
  assert.equal(calls, 1);
});

test("the last cancelled shared read stops its underlying fetch", async () => {
  const cache = createResourceCache();
  const controller = new AbortController();
  let underlying;
  const result = cache.read(
    "query",
    ({ signal }) => {
      underlying = signal;
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    },
    { signal: controller.signal },
  );
  const rejected = assert.rejects(result, { name: "AbortError" });
  await nextTurn();
  controller.abort();
  await rejected;
  await nextTurn();
  assert.equal(underlying.aborted, true);
  assert.equal(cache.peek("query").value, undefined);
});

test("a competition overview reads two bounded pages and never drains their cursors", async () => {
  const calls = [];
  const preview = await competitionFixturePreview(
    { league: "l_000001", season, generation: "42" },
    {
      fetcher: async (path) => {
        const url = new URL(path, "https://site.test");
        calls.push(url);
        assert.equal(url.searchParams.has("cursor"), false);
        return Response.json({
          data: { matches: [{ id: url.searchParams.get("status") }] },
          pagination: { generation: "42", nextCursor: "many-more-matches" },
        });
      },
    },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((url) => [
      url.searchParams.get("status"),
      url.searchParams.get("order"),
    ]),
    [
      ["played", "desc"],
      ["upcoming", "asc"],
    ],
  );
  assert.deepEqual(
    preview.matches.map(({ id }) => id),
    ["played", "upcoming"],
  );
  await assert.rejects(
    competitionFixturePreview(
      { league: "l_000001", season, generation: "42" },
      {
        fetcher: async () =>
          Response.json({
            data: { matches: [] },
            pagination: { generation: "43", nextCursor: null },
          }),
      },
    ),
    (error) => error.status === 409,
  );
});
