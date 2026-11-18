// VI-30 (docs/calculs/09-audit-2026-11/FAILURE_MODES_VI30.md, written before the code): an open-matchday table row
// names its two sides by its own foreign keys, the team after one merged_into hop and that team's crest; a name never
// chooses a crest. The edition's competition answers to its canonical id in the supplemental index.
//
// The cases are written after the seed, before the tests (the next test file seeds again): a crest for Arsenal, none
// for Coventry, Man Utd merged into the seed's first club (which has a crest), the fixture's Sunderland a different
// club with its own crest than the result's Sunderland, and two Austrian cup rows without one or both FKs.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { get, skip } from "./context.mjs";

const REF_ARSENAL = `https://media.vega.invalid/sha256/${"1a".repeat(32)}.png`;
const REF_SUNDERLAND_TWIN = `https://media.vega.invalid/sha256/${"2b".repeat(32)}.png`;
const table = (folder, kind) => get(`/api/cup-table?competition=${folder}&season=2026%2F2027&kind=${kind}`);
const row = (rows, home, away) => rows.find((r) => r.home === home && r.away === away);

let owner;
const ids = {};
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const x = (sql, values) => owner.query(sql, values);
  for (const name of ["Arsenal", "Coventry", "Man Utd", "Hull", "Sunderland", "Ipswich", "A. Klagenfurt"]) {
    const { rows } = await x("SELECT entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='open_matchday' AND provider_key=$1", [`name:${name}`]);
    assert.equal(rows.length, 1, name);
    ids[name] = rows[0].entity_id;
  }
  const publicId = async (id) => (await x("SELECT api.public_id('team', $1) AS id", [id])).rows[0].id;
  for (const name of Object.keys(ids)) ids[`public:${name}`] = await publicId(ids[name]);
  ids["public:seed1"] = await publicId(1);
  await x(
    `INSERT INTO core.assets(id,kind,source_url,s3_key,content_type) VALUES
       (9401,'crest',$1,$2,'image/png'),(9402,'crest',$3,$4,'image/png')`,
    [REF_ARSENAL, `sources/v2/images/${"1a".repeat(32)}.png`, REF_SUNDERLAND_TWIN, `sources/v2/images/${"2b".repeat(32)}.png`],
  );
  await x("UPDATE core.teams SET crest_asset_id=9401 WHERE id=$1", [ids.Arsenal]);
  // V5: a pointer the identity pass left (merges move the matches; this FK still names the merged row).
  await x("UPDATE core.teams SET merged_into=1 WHERE id=$1", [ids["Man Utd"]]);
  // V4: another club spelled « Sunderland », with its own crest, on the fixture's row only.
  await x("INSERT INTO core.teams(id,name,crest_asset_id) VALUES (9402,'Sunderland',9402)");
  const { rowCount } = await x("UPDATE core.matches SET away_team_id=9402 WHERE home_team_name='Aston Villa' AND away_team_name='Sunderland'");
  assert.equal(rowCount, 1);
  // V3: one side without an FK, then both.
  assert.equal((await x("UPDATE core.matches SET home_team_id=NULL WHERE home_team_name='Atus Velden' AND away_team_name='A. Klagenfurt'")).rowCount, 1);
  assert.equal((await x("UPDATE core.matches SET home_team_id=NULL, away_team_id=NULL WHERE home_team_name='Deutschlandsberger'")).rowCount, 1);
  // V9: a fixture with its forecast (the seed's model).
  await x(
    `INSERT INTO agg.match_forecasts(match_id,season_id,home_win,draw,away_win,home_goals,away_goals,likely_home,likely_away,home_elo,away_elo,model_id)
     SELECT m.id, m.season_id, 0.6, 0.25, 0.15, 1.8, 0.9, 2, 0, 1700, 1500, (SELECT max(id) FROM agg.forecast_models)
     FROM core.matches m WHERE m.home_team_name='Man City' AND m.away_team_name='Fulham'`,
  );
});
after(() => owner?.end());

test("V1/V2/V5: each side is the row's own FK, after one merged_into hop, with that team's crest or null", { skip }, async () => {
  const { response, body } = await table("ENG_1_premier-league", "results");
  assert.equal(response.status, 200);
  assert.deepEqual(row(body, "Arsenal", "Coventry").sides, {
    home: { id: ids["public:Arsenal"], image_url: REF_ARSENAL },
    away: { id: ids["public:Coventry"], image_url: null },
  });
  // Man Utd's row names the merged team: the kept club's id and crest, the source's spelling kept.
  const merged = row(body, "Hull", "Man Utd");
  assert.equal(merged.away, "Man Utd");
  assert.deepEqual(merged.sides.away, { id: ids["public:seed1"], image_url: "https://img.example/t1.png" });
  assert.deepEqual(merged.sides.home, { id: ids["public:Hull"], image_url: null });
  // Every row of this edition has both FKs.
  for (const r of body) assert.ok(r.sides?.home?.id && r.sides?.away?.id, `${r.home} – ${r.away}`);
});

test("V4: two clubs spelled alike keep their own rows' crests", { skip }, async () => {
  const results = (await table("ENG_1_premier-league", "results")).body;
  const fixtures = (await table("ENG_1_premier-league", "fixtures")).body;
  assert.deepEqual(row(results, "Ipswich", "Sunderland").sides.away, { id: ids["public:Sunderland"], image_url: null });
  assert.deepEqual(row(fixtures, "Aston Villa", "Sunderland").sides.away, { id: "t_v0009402", image_url: REF_SUNDERLAND_TWIN });
});

test("V3: a side without its FK is omitted, and `sides` when both are", { skip }, async () => {
  const body = (await table("AUT_CUP_ofb-cup", "results")).body;
  const one = row(body, "Atus Velden", "A. Klagenfurt");
  assert.equal(one.home, "Atus Velden");
  assert.deepEqual(one.sides, { away: { id: ids["public:A. Klagenfurt"], image_url: null } });
  const none = row(body, "Deutschlandsberger", "Amstetten");
  assert.equal("sides" in none, false);
  assert.equal(none.home, "Deutschlandsberger");
});

test("V9: a fixture carries its sides beside its forecast", { skip }, async () => {
  const fixtures = (await table("ENG_1_premier-league", "fixtures")).body;
  const f = row(fixtures, "Man City", "Fulham");
  assert.deepEqual(f.forecast, { home: 0.6, draw: 0.25, away: 0.15 });
  assert.ok(f.sides.home.id && f.sides.away.id);
  assert.equal("ft_home" in f, false);
});

test("the edition body (table-v1) carries the same sides as /api/cup-table", { skip }, async () => {
  const { cups } = (await get("/api/cups/index")).body;
  const id = cups.find((c) => c.key === "ENG_1_premier-league" && c.format === "table-v1").id;
  const body = (await get(`/api/cups/edition?competition=${id}&season=2026%2F2027`)).body;
  const results = (await table("ENG_1_premier-league", "results")).body;
  assert.equal(body.results.length, results.length);
  assert.ok(body.results.every((r) => r.sides?.home?.id && r.sides?.away?.id));
  assert.deepEqual(body.results.map((r) => r.sides), results.map((r) => r.sides));
  const fixtures = (await table("ENG_1_premier-league", "fixtures")).body;
  assert.deepEqual(body.fixtures.map((r) => r.sides), fixtures.map((r) => r.sides));
});

test("V12: the supplemental index names each edition's canonical competition, as the cups index does", { skip }, async () => {
  const { cups } = (await get("/api/cups/index")).body;
  const index = (await get("/api/cup-index?kind=supplemental")).body;
  assert.ok(index.competitions.length > 0);
  for (const c of index.competitions) {
    const cup = cups.find((x) => x.key === c.folder && x.format === "table-v1");
    assert.ok(cup, c.folder);
    assert.equal(c.competition_id, cup.id, c.folder);
  }
});
