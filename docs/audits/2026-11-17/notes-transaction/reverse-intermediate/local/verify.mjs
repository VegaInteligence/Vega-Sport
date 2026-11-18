import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const {PGlite} = await import(pathToFileURL(process.argv[2]));
const db = new PGlite();
const query = await readFile(new URL('select.sql', import.meta.url), 'utf8');
const schema = `
  CREATE SCHEMA core;
  CREATE SCHEMA agg;
  CREATE TABLE core.matches (id int PRIMARY KEY, season_id int NOT NULL, competition_season_id int, status text, match_date date);
  CREATE TABLE core.competition_seasons (id int PRIMARY KEY, cup_key text, archive_key text);
  CREATE TABLE core.player_match_stats (season_id int, match_id int, player_id int, team_id int, minutes_played int,
                                       PRIMARY KEY (season_id, match_id, player_id));
  CREATE TABLE agg.player_power_matches (season_id int, match_id int, player_id int, PRIMARY KEY (season_id, match_id, player_id));`;
const inputs = `
  INSERT INTO core.competition_seasons VALUES (1,NULL,NULL),(2,'cup',NULL);
  INSERT INTO core.matches VALUES (11,2021,1,'finished','2021-11-01'),(12,2022,1,'finished','2022-07-03'),
                                  (13,2021,1,'finished','2021-11-01'),(14,2021,1,'cancelled','2021-11-01'),
                                  (15,2021,2,'finished','2021-11-01');
  INSERT INTO core.player_match_stats VALUES (2021,11,10,1,90),(2022,12,20,1,7),(2021,14,40,1,90),(2021,15,50,1,90);
  INSERT INTO agg.player_power_matches VALUES (2021,11,10),(2022,11,10),(2021,12,20),(2021,13,30),
                                               (2021,14,40),(2021,15,50),(2021,16,60);`;
const populated = {
    stored_rows:7, distinct_match_player_pairs:6, admitted_source_rows:2, missing_source_rows:2,
    ineligible_source_rows:2, wrong_award_rows:1, multiple_award_pairs:1, excess_award_rows:1,
    example_missing:'13/30', example_ineligible:'14/40', example_wrong_award:'11/10', example_multiple_awards:'11/10 [2021,2022]'
};
const empty = Object.fromEntries(Object.entries(populated).map(([key,value]) => [key, typeof value === 'number' ? 0 : null]));
async function inspect(expected) {
    await db.exec('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    try {
        const result = await db.query(query);
        assert.equal(result.rows.length, 1);
        const row = result.rows[0];
        assert.deepEqual(row,expected);
        assert.equal(row.stored_rows, row.admitted_source_rows + row.missing_source_rows + row.ineligible_source_rows + row.wrong_award_rows);
        assert.equal(row.stored_rows, row.distinct_match_player_pairs + row.excess_award_rows);
        return row;
    } finally {
        await db.exec('ROLLBACK');
    }
}
try {
    const engine = (await db.query('SELECT version() AS version')).rows[0].version;
    await db.exec(schema);
    const emptyResult = await inspect(empty);
    await db.exec(inputs);
    const populatedResult = await inspect(populated);
    console.log(JSON.stringify({engine, query_sha256:createHash('sha256').update(query).digest('hex'),
                                read_only: true, empty:emptyResult, populated:populatedResult}, null, 2));
} finally {
    await db.close();
}
