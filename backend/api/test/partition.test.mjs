// Contract tests of the season loader (partitionPage of relational-core.js on main); the
// packed format is read back with the site's own decoder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePartition } from "../../../dashboard/frontend/src/season_data.js";
import { get, skip } from "./context.mjs";

const BASE = "/api/seasons/partition?season=2025%2F2026&league=l_3FJFUl";

test("a league season in pages, in the cursor order of the fixtures", { skip }, async () => {
  const { response, body } = await get(BASE);
  assert.equal(response.status, 200);
  const { data, pagination } = body;
  assert.equal(pagination.nextCursor, null);
  assert.deepEqual(data.fixtures.map((f) => f.id), ["m_aaaaa1", "m_aaaaa2", "m_aaaaa3", "m_aaaaa4", "m_aaaaa5", "m_aaaaa6"]);
  assert.deepEqual([data.meta.currentSeason, data.meta.matchCount, data.meta.teamCount], ["2025/2026", 6, 4]);
  assert.deepEqual(data.competitions.map((c) => c.id), ["l_3FJFUl"]);
  assert.deepEqual(data.teams.map((t) => t.id), ["t_aaaaa1", "t_aaaaa2", "t_aaaaa3", "t_aaaaa4"]);
  // Collected matches only, each with its appearances.
  assert.ok(data.matches.length > 0 && data.matches.every((m) => m.players.every((id) => data.appearances.some((a) => a.id === id))));
  const seen = [];
  let cursor = null;
  do {
    const page = (await get(BASE + "&limit=2" + (cursor ? "&cursor=" + cursor : ""))).body;
    seen.push(...page.data.fixtures.map((f) => f.id));
    cursor = page.pagination.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, data.fixtures.map((f) => f.id));
});

test("the packed columns decode to the same season", { skip }, async () => {
  const plain = (await get(BASE)).body.data;
  const packed = (await get(BASE + "&format=columns")).body.data;
  assert.equal(packed.format, "orion-packed-tables-v1");
  assert.deepEqual(JSON.parse(JSON.stringify(decodePartition(packed))), plain);
});

test("versions, validation and unknown partitions", { skip }, async () => {
  const manifest = (await get("/api/dashboard/manifest")).body;
  // The site turns its compact reads, its search, its ordered fixtures and its versioned
  // partitions on from these values (it loads whole seasons for any other storage).
  assert.equal(manifest.storage, "aws-relational");
  assert.deepEqual(
    Object.fromEntries(Object.entries(manifest.capabilities).filter(([, value]) => typeof value === "boolean")),
    { boundedSearch: true, fixturePaginationOrder: true, versionedPartitions: true, playerRatingRanking: true, actorSummary: true, wholeSelection: true, playedLeague: true, resolvedMedia: false, boundedArchive: true },
  );
  const chunk = manifest.seasons.find((s) => s.id === "2025/2026").chunks.find((c) => c.leagueId === "l_3FJFUl");
  assert.match(chunk.sourceDigest, /^[a-f0-9]{16}$/);
  assert.equal((await get(BASE + "&v=" + chunk.sourceDigest)).response.status, 200);
  assert.equal((await get(BASE + "&v=" + "0".repeat(16))).response.status, 409);
  // A manifest served before the digest was shortened carried the whole hash: its first
  // 16 characters are the digest.
  assert.equal((await get(BASE + "&v=" + chunk.sourceDigest + "0".repeat(48))).response.status, 200);
  assert.equal((await get(BASE + "&v=" + "0".repeat(64))).response.status, 409);
  assert.equal((await get(BASE + "&v=" + chunk.sourceDigest + "00")).response.status, 400);
  assert.equal((await get(BASE + "&format=rows")).response.status, 400);
  assert.equal((await get("/api/seasons/partition?season=2025%2F2026&league=l_zzzzzz")).response.status, 404);
  const first = await get(BASE);
  assert.equal((await get(BASE, { "if-none-match": first.response.headers.get("etag") })).response.status, 304);
});

test("the seasons and leagues of players and clubs", { skip }, async () => {
  const { body } = await get("/api/scouting/routes?player=p_aaaab1,p_aaaab4&team=t_aaaaa2");
  assert.deepEqual(body, {
    routes: { p_aaaab1: { "2025/2026": ["l_3FJFUl"] }, p_aaaab4: { "2025/2026": ["l_3FJFUl"] } },
    clubRoutes: { t_aaaaa2: { "2025/2026": ["l_3FJFUl"] } },
  });
  assert.equal((await get("/api/scouting/routes")).response.status, 400);
  assert.equal((await get("/api/scouting/routes?player=x")).response.status, 400);
});
