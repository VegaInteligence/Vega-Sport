// Transfermarkt contracts kept as history (VI-31, FAILURE_MODES.md §20), on the seed of
// test/seed.py: a doubted link confirms nothing, even when its quarantine row names the player the
// link had before; a superseded spell leaves the current contract published. Written before 139.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

const DSN = process.env.VEGA_V2_API_NODE_TEST_DSN;
let admin;

before(async () => {
  if (skip) return;
  admin = new pg.Client({ connectionString: DSN });
  await admin.connect();
  // Player 101: his Transfermarkt contract was written, then his link was doubted. The quarantine
  // row still names 999, the player the key had before a merge.
  await admin.query(`INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', '900101', 101)`);
  await admin.query(`INSERT INTO core.player_contracts(player_id, team_id, start_date, end_date, source, as_of)
                     VALUES (101, 3, current_date - 10, current_date + 300, 'transfermarkt', current_date - 10)`);
  await admin.query(`INSERT INTO core.provider_players(provider, provider_key, provider_club, joined_on, contract_until, read_on)
                     VALUES ('transfermarkt', '900101', '3', current_date - 10, current_date + 300, current_date)`);
  await admin.query(`INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason)
                     VALUES ('player', 'transfermarkt', '900101', 999, 'snapshot', now(), 'birth_date_differs')`);
});
after(() => admin?.end());

test("a doubted link's Transfermarkt contract is confirmed nowhere, whoever its quarantine row names", { skip }, async () => {
  const { response, body } = await get("/api/players/p_aaaab1");
  assert.equal(response.status, 200);
  for (const key of ["contract_until", "contract_team", "observed_contract_until", "observed_contract_team", "observed_contract_on"])
    assert.equal(key in body.data, false, key);
  const { data: coverage } = (await get("/api/players/facts-coverage")).body;
  assert.equal(coverage.confirmed_expiries, 2);
});

test("a superseded Transfermarkt spell leaves the current contract published", { skip }, async () => {
  // Player 102 left club 4 for club 1: the provider's spell there is kept, set aside 30 days ago.
  await admin.query(`INSERT INTO core.player_contracts(player_id, team_id, start_date, end_date, source, as_of, superseded_on)
                     VALUES (102, 4, current_date - 400, current_date + 400, 'transfermarkt', current_date - 400, current_date - 30)`);
  const { rows: [{ until }] } = await admin.query("SELECT (current_date + 365)::text AS until");
  const { data } = (await get("/api/players/p_aaaab2")).body;
  assert.deepEqual([data.contract_team, data.contract_until], ["Olympique Été", until]);
  const { data: coverage } = (await get("/api/players/facts-coverage")).body;
  assert.equal(coverage.confirmed_expiries, 2);
});
