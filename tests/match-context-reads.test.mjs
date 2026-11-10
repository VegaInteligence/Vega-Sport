// What the match preview ("Avant-match") reads: the two clubs' meetings in one filtered
// read of the fixtures, and each club's own season, never a league's whole history or
// whole season.
import test from "node:test";
import assert from "node:assert/strict";
import {
  headToHeadFixtures,
  loadClubSeasonDetail,
  mergeSeasonData,
} from "../dashboard/frontend/src/services/scouting-history.js";

const MANIFEST = {
  storage: "aws-relational",
  publicationVersion: "42",
  capabilities: { compactReads: { club: true }, actorSummary: true },
};

test("a head-to-head is one read of the two clubs' meetings in the shared competitions", async () => {
  const calls = [];
  const fetcher = async (path) => {
    const url = new URL(path, "https://example.test");
    calls.push(url);
    return Response.json({
      data: { matches: [{ id: "m_000002" }, { id: "m_000001" }, { id: "m_000002" }] },
      pagination: { generation: "42", nextCursor: null },
    });
  };
  const meetings = await headToHeadFixtures("t_bbbbbb", "t_aaaaaa", new Set(["l_000002", "l_000001"]), { fetcher });
  assert.deepEqual(meetings.map((m) => m.id), ["m_000002", "m_000001"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, "/api/fixtures");
  assert.equal(calls[0].searchParams.get("teams"), "t_aaaaaa,t_bbbbbb");
  assert.equal(calls[0].searchParams.get("leagues"), "l_000001,l_000002");
  assert.equal(calls[0].searchParams.get("status"), "all");
  assert.equal(calls[0].searchParams.has("league"), false);
  assert.equal(calls[0].searchParams.has("season"), false);
  // Without a competition, every meeting the base holds.
  await headToHeadFixtures("t_aaaaaa", "t_bbbbbb", [], { fetcher });
  assert.equal(calls[1].searchParams.has("leagues"), false);
  assert.equal(calls[1].searchParams.get("teams"), "t_aaaaaa,t_bbbbbb");
});

test("the pages of a long head-to-head are followed to the end", async () => {
  const calls = [];
  const fetcher = async (path) => {
    const url = new URL(path, "https://example.test");
    calls.push(url);
    const second = url.searchParams.has("cursor");
    return Response.json({
      data: { matches: [{ id: second ? "m_000002" : "m_000001" }] },
      pagination: { generation: "42", nextCursor: second ? null : "next" },
    });
  };
  const meetings = await headToHeadFixtures("t_aaaaaa", "t_bbbbbb", ["l_000001"], { fetcher });
  assert.deepEqual(meetings.map((m) => m.id), ["m_000001", "m_000002"]);
  assert.equal(calls.length, 2);
});

test("a club's season for the preview is its own read, with its players' appearances", async () => {
  const calls = [];
  const fetcher = async (path) => {
    const url = new URL(path, "https://example.test");
    calls.push(url);
    const page = Number(url.searchParams.get("page")),
      limit = Number(url.searchParams.get("limit"));
    // 26 matches: a full first page, one match on the second.
    const ids = Array.from({ length: page === 1 ? limit : 26 - limit }, (_, i) => "m_" + String((page - 1) * limit + i + 1).padStart(6, "0"));
    return Response.json({
      data: {
        meta: {},
        metrics: [],
        competitions: [{ id: "l_000001" }],
        teams: [{ id: "t_aaaaaa" }],
        fixtures: ids.map((id) => ({ id })),
        matches: ids.map((id) => ({ id })),
        appearances: ids.map((id) => ({ id: id + ":p_000001", matchId: id })),
      },
      pagination: { page, limit, total: 26, pages: 2, generation: "42" },
    });
  };
  const data = await loadClubSeasonDetail(MANIFEST, "t_aaaaaa", "2026/2027", { fetcher });
  assert.equal(data.matches.length, 26);
  assert.equal(data.appearances.length, 26);
  assert.equal(calls.length, 2);
  for (const url of calls) {
    assert.equal(url.pathname, "/api/read/club");
    assert.equal(url.searchParams.get("team"), "t_aaaaaa");
    assert.equal(url.searchParams.get("season"), "2026/2027");
    assert.equal(url.searchParams.get("include"), "appearances");
    assert.equal(url.searchParams.get("leagues"), "all");
  }
});

test("two clubs' seasons merge into one document, each row once", () => {
  const home = { meta: { currentSeason: "2026/2027" }, matches: [{ id: "m_1" }, { id: "m_2" }], fixtures: [{ id: "m_1" }], appearances: [{ id: "m_1:p_1" }], teams: [{ id: "t_a" }, { id: "t_b" }], competitions: [{ id: "l_1" }], metrics: [] };
  const away = { meta: { currentSeason: "2026/2027" }, matches: [{ id: "m_2" }, { id: "m_3" }], fixtures: [{ id: "m_3" }], appearances: [{ id: "m_2:p_9" }], teams: [{ id: "t_b" }], competitions: [{ id: "l_1" }, { id: "l_2" }], metrics: [] };
  const merged = mergeSeasonData([home, away]);
  assert.deepEqual(merged.matches.map((m) => m.id), ["m_1", "m_2", "m_3"]);
  assert.deepEqual(merged.fixtures.map((m) => m.id), ["m_1", "m_3"]);
  assert.deepEqual(merged.appearances.map((a) => a.id), ["m_1:p_1", "m_2:p_9"]);
  assert.deepEqual(merged.teams.map((t) => t.id), ["t_a", "t_b"]);
  assert.deepEqual(merged.competitions.map((c) => c.id), ["l_1", "l_2"]);
  assert.equal(merged.meta.currentSeason, "2026/2027");
});
