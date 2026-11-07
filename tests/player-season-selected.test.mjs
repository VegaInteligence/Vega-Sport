import test from "node:test";
import assert from "node:assert/strict";
import {
  loadPlayerHistory,
  playerHistorySeasons,
  playerHistoryKey,
} from "../dashboard/frontend/src/services/scouting-history.js";
import { aggregateSeason } from "../dashboard/frontend/src/services/season-player.js";
import { UEFA_NATIONS_ID } from "../dashboard/frontend/src/services/uefa-nations-snapshot.js";

test("selected history season loads only that season and never falls back", async () => {
  const calls = [];
  const fetcher = async (path) => {
    const url = new URL(path, "https://example.test");
    calls.push(url);
    if (url.pathname === "/api/scouting/routes")
      return Response.json({
        routes: {
          p_2e0FPo: { "2026/2027": ["l_000001"], "2025/2026": ["l_000002"] },
        },
      });
    assert.equal(url.searchParams.get("season"), "2026/2027");
    return Response.json({
      data: {
        meta: {},
        metrics: [],
        matches: [],
        fixtures: [],
        appearances: [],
        competitions: [],
        teams: [],
      },
      pagination: { generation: "one", nextCursor: null },
    });
  };
  const manifest = {
    storage: "aws-relational",
    seasons: [
      { id: "2026/2027", chunks: [{ leagueId: "l_000001" }] },
      { id: "2025/2026", chunks: [{ leagueId: "l_000002" }] },
    ],
  };
  const selected = await loadPlayerHistory(manifest, "p_2e0FPo", {
    fetcher,
    season: "2026/2027",
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].profile.matches, 4);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    await loadPlayerHistory(manifest, "p_2e0FPo", {
      fetcher,
      season: "2023/2024",
    }),
    [],
  );
});

test("all seasons of one competition do not request other editions or literal all", async () => {
  const id = "p_000001";
  const routing = {
    routes: {
      [id]: {
        "2026/2027": ["l_000001"],
        "2025/2026": ["l_000002"],
      },
    },
  };
  const calls = [];
  const manifest = {
    storage: "aws-relational",
    publicationVersion: "g1",
    capabilities: { compactReads: { player: true } },
  };
  const entries = await loadPlayerHistory(manifest, id, {
    routing,
    season: "all",
    competition: "l_000001",
    fetcher: async (url) => {
      const query = new URL(url, "https://test").searchParams;
      calls.push(query);
      return Response.json({
        data: {
          appearances: [],
          matches: [],
          fixtures: [],
          teams: [],
          competitions: [],
        },
        pagination: {
          page: 1,
          pages: 1,
          total: 0,
          limit: 25,
          generation: "g1",
        },
        meta: { generation: "g1" },
      });
    },
  });
  assert.deepEqual(
    entries.map((entry) => entry.season),
    ["2026/2027"],
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].get("season"), "2026/2027");
  assert.equal(calls[0].get("leagues"), "l_000001");
  assert.equal(
    playerHistoryKey(manifest, id, "all"),
    playerHistoryKey(manifest, id),
  );
  assert.notEqual(
    playerHistoryKey(manifest, id, "all", "l_000001"),
    playerHistoryKey(manifest, id),
  );
});

test("a cached complete season is filtered without changing the shared history", async () => {
  const id = "p_000001",
    season = "2026/2027";
  const rows = [
    {
      playerId: id,
      matchId: "one",
      leagueId: "l_000001",
      minutes: 90,
      goals: 1,
    },
    {
      playerId: id,
      matchId: "two",
      leagueId: "l_000002",
      minutes: 90,
      goals: 3,
    },
  ];
  const cached = {
    season,
    data: {
      appearances: rows,
      matches: rows.map((row) => ({ id: row.matchId, leagueId: row.leagueId })),
      competitions: [{ id: "l_000001" }, { id: "l_000002" }],
    },
    profile: aggregateSeason(rows, id),
  };
  const [entry] = await loadPlayerHistory({}, id, {
    season,
    competition: "l_000001",
    routing: { routes: { [id]: { [season]: ["l_000001", "l_000002"] } } },
    cachedSeason: () => cached,
    fetcher: () => assert.fail("Use the cached complete season"),
  });
  assert.equal(entry.profile.matches, 1);
  assert.equal(entry.profile.stats.goals.sum, 1);
  assert.deepEqual(
    entry.data.matches.map((match) => match.id),
    ["one"],
  );
  assert.equal(cached.data.appearances.length, 2);
  assert.equal(cached.profile.matches, 2);
});

test("stored national-team editions remain exact when selected across all seasons", async () => {
  const entries = await loadPlayerHistory({}, "p_2e0FPo", {
    competition: UEFA_NATIONS_ID,
    routing: { routes: {} },
    fetcher: () =>
      assert.fail("Stored national-team matches need no native scope request"),
  });
  assert.deepEqual(
    entries.map((entry) => entry.season),
    ["2026/2027", "2024/2025"],
  );
  assert.equal(
    entries.reduce((sum, entry) => sum + entry.profile.matches, 0),
    11,
  );
  assert.ok(
    entries.every((entry) =>
      entry.profile.rows.every((row) => row.leagueId === UEFA_NATIONS_ID),
    ),
  );
});

test("the season index includes the stored national-team supplement and is reusable", async () => {
  const id = "p_2e0FPo";
  const routing = {
    routes: { [id]: { "2026/2027": ["l_000001"], "2025/2026": ["l_000002"] } },
  };
  assert.deepEqual(playerHistorySeasons(routing, id), [
    "2026/2027",
    "2025/2026",
    "2024/2025",
  ]);
  const [entry] = await loadPlayerHistory({}, id, {
    routing,
    season: "2024/2025",
    fetcher: () =>
      assert.fail("A season with only stored matches needs no second read"),
  });
  assert.equal(entry.season, "2024/2025");
  assert.equal(entry.profile.matches, 7);
  const [cached] = await loadPlayerHistory({}, id, {
    routing,
    season: entry.season,
    cachedSeason: () => entry,
  });
  assert.equal(cached, entry);
});
