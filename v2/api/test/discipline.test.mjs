// Contract tests of /api/read/discipline (relational-discipline.js on main).
import { test } from "node:test";
import assert from "node:assert/strict";
import { get, skip } from "./context.mjs";

const base = "/api/read/discipline?season=2025/2026&leagues=all&player=p_aaaab1";

test("cards over the requested matches", { skip }, async () => {
  const { response, body } = await get(base + "&matches=m_aaaaa5,m_aaaaa1,m_aaaaa3,m_aaaaa6,m_zzzzzz");
  assert.equal(response.status, 200);
  // m6 (not played by him) and an unknown id count in the total, not in the coverage.
  assert.deepEqual(body.data, { yellow: 1, directRed: 1, secondYellow: 1, covered: 3, total: 5 });
  assert.equal(body.meta.generation, "7");
  const none = await get(base + "&matches=");
  assert.deepEqual(none.body.data, { yellow: 0, directRed: 0, secondYellow: 0, covered: 0, total: 0 });
  const again = await get(base + "&matches=m_aaaaa1", { "if-none-match": (await get(base + "&matches=m_aaaaa1")).response.headers.get("etag") });
  assert.equal(again.response.status, 304);
});

test("discipline errors", { skip }, async () => {
  assert.equal((await get(base)).response.status, 400); // matches required
  assert.equal((await get(base.replace("p_aaaab1", "bad") + "&matches=")).response.status, 400);
  assert.equal((await get(base + "&matches=" + Array.from({ length: 201 }, (_, i) => "m_a" + String(i).padStart(5, "0")).join(","))).response.status, 400);
  assert.equal((await get(base + "&matches=m_aaaaa1&generation=6")).response.status, 409);
});
