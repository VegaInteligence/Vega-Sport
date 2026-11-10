// The site's switch to the v2 API (dashboard/frontend/src/services/v2-routes.js): every
// current read it rewrites must be served by v2, with the body the site reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cupId, cupPaths, editionYear, fixtureScope, v2Path } from "../../../dashboard/frontend/src/services/v2-routes.js";
import { get, skip } from "./context.mjs";

test("path renames", () => {
  assert.equal(v2Path("/api/pitchapi/matches/m_aaaaa1/players/halves"), "/api/matches/m_aaaaa1/players/halves");
  assert.equal(v2Path("/api/pitchapi/matches/m_aaaaa1/heatmaps?frame=home_ltr"), "/api/matches/m_aaaaa1/heatmaps?frame=home_ltr");
  assert.equal(v2Path("/api/pitchapi/players/p_aaaab1"), "/api/players/p_aaaab1");
  assert.equal(v2Path("/api/pitchapi/leagues"), "/api/competitions");
  assert.equal(v2Path("/api/rankings/edition?kind=uefa-clubs&edition=2026.uefa"), "/api/rankings/edition?kind=uefa-clubs&edition=2026");
  assert.equal(v2Path("/api/read/clubs?season=2025%2F2026"), "/api/read/clubs?season=2025%2F2026"); // unchanged
  assert.deepEqual(fixtureScope("leagues/l_3FJFUl/matches?season=2025%2F2026&status=all"), { league: "l_3FJFUl", season: "2025/2026" });
  assert.deepEqual(fixtureScope("date/2025-09-01?status=played"), { day: "2025-09-01" });
  assert.equal(fixtureScope("matches/m_aaaaa1"), null);
  assert.equal(editionYear("2026.uefa"), "2026");
});

test("every rewritten read is served by v2", { skip }, async () => {
  for (const path of ["/api/pitchapi/matches/m_aaaaa1", "/api/pitchapi/players/p_aaaab1", "/api/pitchapi/teams/t_aaaaa1", "/api/pitchapi/leagues",
    "/api/rankings/edition?kind=uefa-clubs&edition=2026.uefa", "/api/club-facts?club=t_aaaaa1", "/api/stadium?club=t_aaaaa1"]) {
    const { response, body } = await get(v2Path(path));
    assert.equal(response.status, 200, path);
    assert.ok(body, path);
  }
  const leagues = (await get(v2Path("/api/pitchapi/leagues"))).body.data.leagues;
  assert.ok(leagues.some((l) => l.id === "l_3FJFUl"));
});

test("cups by their Vega id", { skip }, async () => {
  const read = async (url) => (await get(url)).body;
  const euro = await cupId("open-cups", "euro", read);
  const nations = await cupId("nations-results", "ignored", read);
  assert.match(euro, /^l_v\d{7}$/);
  assert.match(nations, /^l_v\d{7}$/);
  assert.equal(await cupId("native", "l_3FJFUl", read), null);
  const { snapshot, edition } = cupPaths(euro, "2024");
  assert.equal((await get(snapshot)).response.status, 200);
  assert.equal((await get(edition)).body.season, "2024");
});
