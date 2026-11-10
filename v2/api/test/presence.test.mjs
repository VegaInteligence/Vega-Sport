// Contract tests of /api/read/presence (relational-player-presence.js on main).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

const base = "/api/read/presence?season=2025/2026&leagues=all&player=p_aaaab1";

test("activity maps added up over the requested matches", { skip }, async () => {
  const { response, body } = await get(base + "&matches=m_aaaaa5,m_aaaaa1,m_aaaaa3,m_aaaaa6,m_zzzzzz");
  assert.equal(response.status, 200);
  // m5's map is not whole (its cells do not add up to its actions); m6 is not played; an unknown id only counts as requested.
  assert.deepEqual(body.data, { requested: 5, covered: 2, actions: 10, length: 16, width: 12, cells: [[0, 0, 3], [2, 3, 6], [15, 11, 1]] });
  assert.equal(body.meta.generation, "7");
  const one = await get(base + "&matches=m_aaaaa1");
  assert.deepEqual(one.body.data, { requested: 1, covered: 1, actions: 5, length: 16, width: 12, cells: [[2, 3, 4], [15, 11, 1]] });
  const none = await get(base + "&matches=");
  assert.deepEqual(none.body.data, { requested: 0, covered: 0, actions: 0, length: 16, width: 12, cells: [] });
  const again = await get(base + "&matches=m_aaaaa1", { "if-none-match": one.response.headers.get("etag") });
  assert.equal(again.response.status, 304);
});

test("a map counts only for a player who took part", { skip }, async () => {
  const other = base.replace("p_aaaab1", "p_aaaab2");
  // On the bench in m3 (no minute); minutes unknown in m5: taken as played, as on main.
  const { body } = await get(other + "&matches=m_aaaaa3,m_aaaaa5");
  assert.deepEqual(body.data, { requested: 2, covered: 1, actions: 3, length: 16, width: 12, cells: [[4, 4, 3]] });
});

test("presence errors and the manifest capability", { skip }, async () => {
  assert.equal((await get(base)).response.status, 400); // matches required
  assert.equal((await get(base.replace("p_aaaab1", "bad") + "&matches=")).response.status, 400);
  assert.equal((await get(base + "&matches=" + Array.from({ length: 201 }, (_, i) => "m_a" + String(i).padStart(5, "0")).join(","))).response.status, 400);
  assert.equal((await get(base + "&matches=m_aaaaa1&generation=6")).response.status, 409);
  assert.equal((await get(base + "&matches=m_aaaaa1&media=1")).response.status, 400);
  assert.equal((await get("/api/dashboard/manifest")).body.capabilities.compactReads.presence, true);
});
