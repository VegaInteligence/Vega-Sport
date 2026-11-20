// GET /api/players/{id}/injuries: a player's injuries, most recent first, only once they
// were read (a player never read is not « never injured »).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

let owner, id;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  id = (await owner.query("SELECT api.public_id('player', 102) AS id")).rows[0].id;
});
after(() => owner?.end());

test("a player never read has no list, not an empty one", { skip }, async () => {
  assert.equal((await get(`/api/players/${id}/injuries`)).response.status, 404);
  assert.equal((await get("/api/players/p_zzzzz9/injuries")).response.status, 404);
  assert.equal((await get(`/api/players/${id}/injuries?season=2025/2026`)).response.status, 400);
});

test("once read: his injuries, most recent first, and none when he had none", { skip }, async () => {
  await owner.query(`INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
                     VALUES ('player', 'transfermarkt', '987654', 102) ON CONFLICT DO NOTHING`);
  await owner.query(`INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at, read_at)
                     VALUES ('injuries', '987654', 3, now() + interval '7 days', now())`);
  assert.deepEqual((await get(`/api/players/${id}/injuries`)).body.data, { id, injuries: [] });
  await owner.query(`INSERT INTO core.player_injuries(player_id, kind, label, start_date, end_date, matches_missed, source, as_of, days, season_year)
                     VALUES (102, 'injury', 'Entorse de la cheville', '2025-10-02', '2025-10-30', 4, 'transfermarkt', '2026-11-16', 29, 2025),
                            (102, 'injury', 'Contracture', '2026-11-01', NULL, NULL, 'transfermarkt', '2026-11-16', NULL, 2026)`);
  const body = (await get(`/api/players/${id}/injuries`)).body.data;
  assert.deepEqual(body.injuries, [
    { kind: "injury", label: "Contracture", start: "2026-11-01", end: null, days: null, matchesMissed: null, season: 2026 },
    { kind: "injury", label: "Entorse de la cheville", start: "2025-10-02", end: "2025-10-30", days: 29, matchesMissed: 4, season: 2025 },
  ]);
  // A refresh that failed after an accepted read keeps the accepted list served (160, FAILURE_MODES.md §44, 40h):
  // it no longer turns it into a 404. An episode the provider stopped listing carries the day it was first missed.
  await owner.query("UPDATE ops.transfermarkt_reads SET error_code = 'HTTP_500' WHERE kind = 'injuries' AND provider_key = '987654'");
  const refused = await get(`/api/players/${id}/injuries`);
  assert.equal(refused.response.status, 200);
  assert.deepEqual(refused.body.data, { id, injuries: body.injuries });
  await owner.query("UPDATE core.player_injuries SET absent_since = '2026-11-18' WHERE player_id = 102 AND label = 'Contracture'");
  assert.deepEqual((await get(`/api/players/${id}/injuries`)).body.data.injuries[0],
    { ...body.injuries[0], absentSince: "2026-11-18" });
  // A first read refused stays unknown.
  await owner.query("UPDATE ops.transfermarkt_reads SET read_at = NULL WHERE kind = 'injuries' AND provider_key = '987654'");
  assert.equal((await get(`/api/players/${id}/injuries`)).response.status, 404);
});
