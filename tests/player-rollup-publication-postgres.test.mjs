import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const databaseUrl = process.env.VEGA_TEST_DATABASE_URL;
const migration = (file) => readFile(new URL(`../dashboard/backend/migrations/${file}`, import.meta.url), "utf8");

test("bounded rollup publication preserves native rows, duplicates, permissions and rollback", { skip: !databaseUrl }, async () => {
  const target = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname), "disposable loopback database required");
  const require = createRequire(new URL("../dashboard/package.json", import.meta.url));
  const { Client } = require("pg");
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const rows = async (sql, values = []) => (await db.query(sql, values)).rows;
  const capture = () => rows("SELECT season,league_id,player_id,encode(record_send(r),'hex') AS native_bytes FROM statarena_app.player_season_rollups r ORDER BY season,league_id,player_id");
  const flags = () => rows("SELECT season,league_id,source_digest,player_rollup_digest,player_rollup_ambiguous FROM statarena_app.partitions ORDER BY season,league_id");
  try {
    await db.query("BEGIN");
    for (const file of ["003_relational_core.sql", "020_publication_foreign_key_indexes.sql", "025_player_season_rollups.sql", "030_player_directory_index.sql"])
      await db.query(await migration(file));
    await db.query(`
      INSERT INTO statarena_app.partitions(season,league_id,source_digest) VALUES
       ('2023/2024','league_one','digest_one'),('2023/2024','league_two','digest_two'),
       ('2022/2023','league_one','previous'),('2023/2024','empty','empty_digest');
      INSERT INTO statarena_app.players(id,player_id,name) VALUES
       ('ref_old','player_one','Old identity'),('ref_new','player_one','New identity'),
       ('ref_two','player_two','Player two'),('ref_bench','bench','Bench'),
       ('ref_unknown','unknown','Unknown'),('ref_absent','absent','Absent identity');
      INSERT INTO statarena_app.matches(id,season,league_id) SELECT 'm_'||n,'2023/2024','league_one' FROM generate_series(1,12) n;
      INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,season,league_id,league,date,ordinal,team,team_id,minutes,rating,goals,assists,xg,xa,starter,position_id,position_id_type,passes_accurate,passes_attempted,duels_won,duels_lost)
      VALUES
       ('one_a','ref_old','player_one','m_1','2023/2024','league_one','League one','2023-10-01',0,'A','team_a',90,7,1,0,0.25,0.125,true,'31','int',30,40,4,2),
       ('one_duplicate','ref_old','player_one','m_1','2023/2024','league_one','League one','2023-10-01',1,'A','team_a',45,9,9,9,9,9,false,'91','int',0,0,0,0),
       ('one_unknown_duplicate','ref_old','player_one','m_1','2023/2024','league_one','League one','2023-10-01',2,'A','team_a',null,8,8,8,8,8,null,'31','int',null,null,null,null),
       ('one_b','ref_new','player_one','m_2','2023/2024','league_one','League one','2023-10-02',0,'B','team_b',45,8,0,1,0.5,0.25,false,'91','int',0,0,0,0),
       ('one_c','ref_new','player_one','m_3','2023/2024','league_one','League one',null,0,'B','team_b',30,0,0,0,0,0,null,'False','bool',null,null,null,null),
       ('two_a','ref_two','player_two','m_1','2023/2024','league_one','League one','2023-10-01',3,'B','team_b',90,null,null,0,null,0,true,'NaN','float',null,0,null,null),
       ('two_b','ref_two','player_two','m_2','2023/2024','league_one','League one','2023-10-02',3,'B','team_b',90,'NaN','Infinity','-Infinity','NaN',0,false,' ','str',20,30,3,2),
       ('bench','ref_bench','bench','m_3','2023/2024','league_one','League one','2023-10-03',4,'B','team_b',0,8,5,1,1,1,false,'31','int',0,0,0,0),
       ('unknown_null','ref_unknown','unknown','m_4','2023/2024','league_one','League one','2023-10-04',0,'B','team_b',null,7,1,1,1,1,null,'31','int',null,null,null,null),
       ('unknown_nan','ref_unknown','unknown','m_5','2023/2024','league_one','League one','2023-10-05',0,'B','team_b','NaN',7,1,1,1,1,null,'31','int',null,null,null,null),
       ('unknown_infinity','ref_unknown','unknown','m_6','2023/2024','league_one','League one','2023-10-06',0,'B','team_b','Infinity',7,1,1,1,1,null,'31','int',null,null,null,null),
       ('unknown_minus_infinity','ref_unknown','unknown','m_7','2023/2024','league_one','League one','2023-10-07',0,'B','team_b','-Infinity',7,1,1,1,1,null,'31','int',null,null,null,null),
       ('unknown_negative','ref_unknown','unknown','m_8','2023/2024','league_one','League one','2023-10-08',0,'B','team_b',-1,7,1,1,1,1,null,'31','int',null,null,null,null),
       ('absent_actor','ref_absent',null,'m_1','2023/2024','league_one',null,'2023-10-01',5,null,null,90,null,0,0,0,0,null,null,null,null,null,null,null),
       ('empty_actor','ref_absent','','m_9','2023/2024','league_one',null,'2023-10-01',0,null,null,90,null,0,0,0,0,null,null,null,null,null,null,null),
       ('null_match','ref_two','player_two',null,'2023/2024','league_one','League one','2023-10-09',0,'B','team_b',90,7,0,0,0,0,null,'31','int',null,null,null,null),
       ('prior_season','ref_two','player_two','m_1','2022/2023','league_one','League one','2022-10-01',0,'B','team_b',90,7,1,0,0.5,0.25,true,'31','int',30,40,4,2);
      SET LOCAL enable_nestloop=on;
      SELECT statarena_app.refresh_player_season_rollups(season,league_id,true) FROM statarena_app.partitions ORDER BY season,league_id;
    `);
    const baseline = await capture(), baselineFlags = await flags();
    const authority = await rows("SELECT oid,proowner,proacl::text,prosecdef,provolatile,proparallel FROM pg_proc WHERE oid='statarena_app.refresh_player_season_rollups(text,text,boolean)'::regprocedure");
    const physicalBefore = await rows("SELECT oid,relowner,relacl::text FROM pg_class WHERE oid='statarena_app.player_season_rollups'::regclass");
    const replacement = await migration("037_bounded_player_rollup_publication.sql");
    await db.query(replacement);
    assert.deepEqual(await capture(), baseline, "installation does not rewrite saved data");
    assert.deepEqual(await rows("SELECT oid,proowner,proacl::text,prosecdef,provolatile,proparallel FROM pg_proc WHERE oid='statarena_app.refresh_player_season_rollups(text,text,boolean)'::regprocedure"), authority, "function identity, owner and rights are unchanged");
    assert.deepEqual(await rows("SELECT oid,relowner,relacl::text FROM pg_class WHERE oid='statarena_app.player_season_rollups'::regclass"), physicalBefore, "table identity and rights are unchanged");
    await db.query("SELECT statarena_app.refresh_player_season_rollups(season,league_id,true) FROM statarena_app.partitions ORDER BY season,league_id");
    assert.deepEqual(await capture(), baseline, "every typed and JSON value is binary-identical after refresh");
    assert.deepEqual(await flags(), baselineFlags, "freshness, empty scopes and ambiguity agree");
    assert.equal((await rows("SHOW enable_nestloop"))[0].enable_nestloop, "on", "function planner setting is restored");
    assert.deepEqual(await rows("SELECT statarena_app.refresh_player_season_rollups('missing','missing') count"), [{count:0}]);
    assert.deepEqual(await rows("SELECT statarena_app.refresh_player_season_rollups('2023/2024','league_one') count"), [{count:0}], "fresh digest is still a no-op");

    // Compare the old equality predicate and the new whole-function result on
    // keys that distinguish null, empty strings, source seasons and league IDs.
    const expectedAmbiguity = async (season, league) => (await rows(`SELECT EXISTS(SELECT 1 FROM statarena_app.appearances a JOIN statarena_app.appearances other ON other.player_id=a.player_id AND other.match_id=a.match_id AND other.season=a.season WHERE a.season=$1 AND a.league_id=$2 AND other.league_id<>$2) value`, [season,league]))[0].value;
    const checkAmbiguity = async () => {
      for (const [season,league] of [["2023/2024","league_one"],["2023/2024","league_two"],["2022/2023","league_one"],["2023/2024","empty"]]) {
        const expected = await expectedAmbiguity(season,league);
        await db.query("SELECT statarena_app.refresh_player_season_rollups($1,$2,true)",[season,league]);
        assert.equal((await rows("SELECT player_rollup_ambiguous value FROM statarena_app.partitions WHERE season=$1 AND league_id=$2",[season,league]))[0].value,expected);
      }
    };
    await checkAmbiguity();
    for (const [id,actor,match,league] of [
      ["null_actor_elsewhere",null,"m_1","league_two"],
      ["null_match_elsewhere","player_two",null,"league_two"],
      ["null_league","player_one","m_1",null],
      ["empty_actor_elsewhere","","m_9","league_two"],
      ["real_collision","player_one","m_1","league_two"],
    ]) {
      await db.query("INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,season,league_id,minutes) VALUES($1,'ref_absent',$2,$3,'2023/2024',$4,0)",[id,actor,match,league]);
      await checkAmbiguity();
    }
    await db.query("DELETE FROM statarena_app.appearances WHERE id IN('empty_actor_elsewhere','real_collision')");
    await checkAmbiguity();
    assert.equal((await rows("SELECT player_rollup_ambiguous value FROM statarena_app.partitions WHERE season='2023/2024' AND league_id='league_one'"))[0].value,false);

    await db.query("SET LOCAL enable_nestloop=off");
    await db.query("SELECT statarena_app.refresh_player_season_rollups('2023/2024','league_one',true)");
    assert.equal((await rows("SHOW enable_nestloop"))[0].enable_nestloop,"off","caller off survives internal on for match probes");
    const beforeFailedProbe = await capture(), beforeFailedProbeFlags = await flags();
    await db.query(`CREATE FUNCTION statarena_app.test_partition_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic after-ambiguity rollback'; END$$;
      CREATE TRIGGER test_partition_fail BEFORE UPDATE ON statarena_app.partitions FOR EACH STATEMENT EXECUTE FUNCTION statarena_app.test_partition_fail();
      SAVEPOINT failed_after_probe;`);
    await assert.rejects(db.query("SELECT statarena_app.refresh_player_season_rollups('2023/2024','league_one',true)"), error=>error.code==="P0001");
    await db.query("ROLLBACK TO SAVEPOINT failed_after_probe");
    assert.deepEqual(await capture(),beforeFailedProbe,"failure after the ambiguity probe rolls back replacement rows");
    assert.deepEqual(await flags(),beforeFailedProbeFlags,"failure after the ambiguity probe retains freshness flags");
    assert.equal((await rows("SHOW enable_nestloop"))[0].enable_nestloop,"off","error after internal on restores caller off");
    await db.query("DROP TRIGGER test_partition_fail ON statarena_app.partitions; SET LOCAL enable_nestloop=on");

    const stable = await capture(), stableFlags = await flags();
    await db.query(`CREATE FUNCTION statarena_app.test_rollup_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic rollback'; END$$;
      CREATE TRIGGER test_rollup_fail BEFORE INSERT ON statarena_app.player_season_rollups FOR EACH STATEMENT EXECUTE FUNCTION statarena_app.test_rollup_fail();
      SAVEPOINT failed_refresh;`);
    await assert.rejects(db.query("SELECT statarena_app.refresh_player_season_rollups('2023/2024','league_one',true)"), error=>error.code==="P0001");
    await db.query("ROLLBACK TO SAVEPOINT failed_refresh");
    assert.deepEqual(await capture(),stable,"failed refresh cannot publish a partial replacement");
    assert.deepEqual(await flags(),stableFlags,"failed refresh cannot advance the digest");
    assert.equal((await rows("SHOW enable_nestloop"))[0].enable_nestloop,"on","error restores the caller's planner setting");
    await db.query("DROP TRIGGER test_rollup_fail ON statarena_app.player_season_rollups");
    await db.query(replacement);
    assert.deepEqual(await capture(),stable,"reinstallation is data-preserving");
    assert.deepEqual(await flags(),stableFlags);
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
});
