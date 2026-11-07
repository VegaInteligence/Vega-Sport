import test from "node:test";
import assert from "node:assert/strict";
import { loadPlayerHistory } from "../dashboard/frontend/src/services/scouting-history.js";

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
