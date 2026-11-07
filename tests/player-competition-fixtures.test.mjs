import test from "node:test";
import assert from "node:assert/strict";
import { loadPlayerCompetitionFixtures } from "../dashboard/frontend/src/services/player-competition-fixtures.js";

test("loads exact team competition, deduplicates fixtures, and reads only missing finished lineups", async () => {
  const manifest = {
    storage: "aws-relational",
    publicationVersion: "g1",
    capabilities: { compactReads: { club: true } },
  };
  const entries = [
    {
      season: "2026/2027",
      data: {
        appearances: [
          { playerId: "p_000001", teamId: "t_000001", leagueId: "l_000001" },
        ],
      },
    },
  ];
  const calls = [];
  const fetcher = async (url) => {
    const q = new URL(url, "https://test").searchParams;
    assert.equal(q.get("leagues"), "l_000001");
    assert.equal(q.get("include"), "appearances");
    assert.equal(q.get("generation"), "g1");
    return Response.json({
      data: {
        meta: {},
        metrics: [],
        teams: [],
        competitions: [],
        fixtures: [
          { id: "m_000001", league: { id: "l_000001" }, status: "finished" },
          { id: "m_000002", league: { id: "l_000001" }, status: "finished" },
          { id: "m_000003", league: { id: "l_000001" }, status: "not_started" },
        ],
        matches: [{ id: "m_000001", leagueId: "l_000001", status: "finished" }],
        appearances: [
          {
            playerId: "p_000001",
            teamId: "t_000001",
            leagueId: "l_000001",
            matchId: "m_000001",
            minutes: 90,
          },
        ],
      },
      pagination: { page: 1, pages: 1, total: 3, limit: 25, generation: "g1" },
      meta: { generation: "g1" },
    });
  };
  const client = {
    async ensureEndpoint(match) {
      calls.push(match.id);
      return {
        data: {
          home_team: { id: "t_000001" },
          home: {
            confirmed: true,
            starters: [{ player_id: "p_000002" }],
            subs: [{ player_id: "p_000001" }],
          },
        },
      };
    },
  };
  const rows = await loadPlayerCompetitionFixtures(
    manifest,
    entries,
    "p_000001",
    "l_000001",
    { client, fetcher },
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(calls, ["m_000002"]);
  assert.deepEqual(rows.find((x) => x.match.id === "m_000002").lineup, {
    confirmed: true,
    complete: false,
    starters: ["p_000002"],
    subs: ["p_000001"],
  });
  assert.equal(rows.find((x) => x.match.id === "m_000003").lineup, null);
});

test("unsupported UEFA scope makes no request and raw unknown-minute appearances establish scope", async () => {
  const manifest = {
    storage: "aws-relational",
    capabilities: { compactReads: { club: true } },
  };
  let called = 0;
  const entries = [
    {
      season: "2026/2027",
      data: {
        appearances: [
          {
            playerId: "p_000001",
            teamId: "t_000001",
            leagueId: "uefa:2014",
            minutes: null,
          },
        ],
      },
    },
  ];
  assert.deepEqual(
    await loadPlayerCompetitionFixtures(
      manifest,
      entries,
      "p_000001",
      "uefa:2014",
      {
        fetcher: async () => {
          called++;
        },
      },
    ),
    [],
  );
  assert.equal(called, 0);
});
