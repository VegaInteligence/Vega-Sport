// Run only against a fresh disposable local PostgreSQL database.
// VEGA_TEST_DATABASE_URL is required. Optional VEGA_ROLLUP_BENCHMARK_EVIDENCE
// receives full query plans; ordinary stdout prints only bounded summaries.
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = new URL(process.env.VEGA_TEST_DATABASE_URL);
assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname));
assert.ok(['/vega_refactor_test','/vega_rollup_publication_test'].includes(target.pathname));
const require = createRequire(new URL('../dashboard/package.json', import.meta.url));
const { Client } = require('pg');
const db = new Client({connectionString:target.href});
await db.connect();
db.exec = sql => db.query(sql);
assert.equal((await db.query("SELECT to_regnamespace('statarena_app') AS schema")).rows[0].schema,null,'fresh disposable database required');
const now = () => performance.now();
const oldMigration = await readFile(`${root}/dashboard/backend/migrations/025_player_season_rollups.sql`, 'utf8');
let oldQuery = oldMigration.split(' INSERT INTO statarena_app.player_season_rollups\n')[1].split(';\n GET DIAGNOSTICS')[0];
oldQuery = oldQuery.replaceAll('target_season', '$1').replaceAll('target_league', '$2');
const candidateMigration = await readFile(`${root}/dashboard/backend/migrations/037_bounded_player_rollup_publication.sql`, 'utf8');
const candidateQuery = candidateMigration.split(' INSERT INTO statarena_app.player_season_rollups\n')[1].split(';\n GET DIAGNOSTICS')[0].replaceAll('target_season','$1').replaceAll('target_league','$2');
const oldAmbiguity = `SELECT EXISTS(SELECT 1 FROM statarena_app.appearances a JOIN statarena_app.appearances other ON other.player_id=a.player_id AND other.match_id=a.match_id AND other.season=a.season WHERE a.season=$1 AND a.league_id=$2 AND other.league_id<>$2)`;
const newAmbiguity = 'WITH scope_matches AS MATERIALIZED ('+candidateMigration.split(' WITH scope_matches AS MATERIALIZED (')[1].split(' UPDATE statarena_app.partitions')[0].replace(' INTO ambiguous','').replaceAll('target_season','$1').replaceAll('target_league','$2');
const report = {format:'vega.rollup-publication.synthetic-benchmark.v1', engine: (await db.query('SELECT version()')).rows[0], fixture:{analyzedBackgroundAppearances:110000,newUnanalyzedScopeAppearances:22000,expectedPlayers:880,expectedMatches:500}, note:'Synthetic disposable PostgreSQL; not production or browser latency. Original queries are planned only. The candidate executes with a15-second statement budget.', samples: []};
try {
 await db.query('BEGIN');
 await db.exec(await readFile(`${root}/dashboard/backend/migrations/003_relational_core.sql`, 'utf8'));
 await db.exec(oldMigration);
 await db.exec(await readFile(`${root}/dashboard/backend/migrations/020_publication_foreign_key_indexes.sql`, 'utf8'));
 await db.exec(`INSERT INTO statarena_app.players(id,player_id) SELECT 'ref_'||n,'player_'||n FROM generate_series(0,999) n;
 INSERT INTO statarena_app.matches(id,season,league_id) SELECT 'match_'||n,'2025/2026','l_'||(n%25) FROM generate_series(1,2500) n;
 INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,season,league_id,date,ordinal,team,team_id,league,minutes,rating,goals,assists,xg,xa,starter,position_id,position_id_type,passes_accurate,passes_attempted)
 SELECT 'app_'||m.id||'_'||n,'ref_'||((right(m.id,-6)::int%20)*44+n)%1000,'player_'||((right(m.id,-6)::int%20)*44+n)%1000,m.id,m.season,m.league_id,
 to_char(date '2025-08-01'+(right(m.id,-6)::int%250),'YYYY-MM-DD'),n,'team_'||(right(m.id,-6)::int%20),'team_'||(right(m.id,-6)::int%20),'League',90,7,n%4,0,0.5,0.25,n<22,'31','int',30,40 FROM statarena_app.matches m CROSS JOIN generate_series(0,43) n;
 ANALYZE statarena_app.appearances;
 INSERT INTO statarena_app.matches(id,season,league_id) SELECT 'new_'||n,'2023/2024','target' FROM generate_series(1,500) n;
 INSERT INTO statarena_app.appearances(id,player_ref,player_id,match_id,season,league_id,date,ordinal,team,team_id,league,minutes,rating,goals,assists,xg,xa,starter,position_id,position_id_type,passes_accurate,passes_attempted)
 SELECT 'app_'||m.id||'_'||n,'ref_'||((right(m.id,-4)::int%20)*44+n)%1000,'player_'||((right(m.id,-4)::int%20)*44+n)%1000,m.id,m.season,m.league_id,
 to_char(date '2023-08-01'+(right(m.id,-4)::int%250),'YYYY-MM-DD'),n,'team_'||(right(m.id,-4)::int%20),'team_'||(right(m.id,-4)::int%20),'League',90,7,n%4,0,0.5,0.25,n<22,'31','int',30,40 FROM statarena_app.matches m CROSS JOIN generate_series(0,43) n WHERE m.season='2023/2024';`);
 await db.query("INSERT INTO statarena_app.partitions(season,league_id,source_digest) VALUES('2023/2024','target','synthetic')");
 await db.exec(await readFile(`${root}/dashboard/backend/migrations/030_player_directory_index.sql`, 'utf8'));
 await db.exec("SET LOCAL statement_timeout='15s'");
 console.log('Fixture seeded: 110,000 analyzed background rows + 22,000 new unanalysed scope rows');
 const walk = p => [p,...(p.Plans||[]).flatMap(walk)];
 for (const [name, query, settings] of [
  ['old_ambiguity',oldAmbiguity,''],
  ['bounded_ambiguity',newAmbiguity,'SET LOCAL enable_nestloop=on'],
  ['old_rollup',oldQuery,''],
  ['bounded_rollup',candidateQuery,'SET LOCAL enable_nestloop=off'],
 ]) {
  console.log('Starting',name);
  if (settings) await db.exec(settings);
  const before = now();
  const analyze = !name.startsWith('old_') && !name.endsWith('_plan');
  const r=await db.query((analyze?'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ':'EXPLAIN (FORMAT JSON) ')+query,['2023/2024','target']);
  const plan=r.rows[0]['QUERY PLAN'][0];
  const sample={name,analyze,elapsedMs:now()-before,executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],tempReadBlocks:plan.Plan['Temp Read Blocks'],tempWrittenBlocks:plan.Plan['Temp Written Blocks'],joins:walk(plan.Plan).filter(x=>/Join|Loop/.test(x['Node Type'])).map(x=>({type:x['Node Type'],planRows:x['Plan Rows'],actualRows:x['Actual Rows'],loops:x['Actual Loops'],removed:x['Rows Removed by Join Filter']})),plan};
  report.samples.push(sample);
  console.log(JSON.stringify({...sample,plan:undefined}));
  if(process.env.VEGA_ROLLUP_BENCHMARK_EVIDENCE) await writeFile(process.env.VEGA_ROLLUP_BENCHMARK_EVIDENCE,JSON.stringify(report,null,2));
 }
 await db.exec('SET LOCAL enable_nestloop=on');
 await db.exec(candidateMigration);
 const beforeRefresh=now();
 const refreshed=await db.query("SELECT statarena_app.refresh_player_season_rollups('2023/2024','target',true) AS players");
 report.functionRefresh={elapsedMs:now()-beforeRefresh,players:refreshed.rows[0].players,callerSetting:(await db.query('SHOW enable_nestloop')).rows[0].enable_nestloop};
 assert.equal(report.functionRefresh.players,880);
 assert.equal(report.functionRefresh.callerSetting,'on');
 const bounded=report.samples.find(x=>x.name==='bounded_rollup');
 assert.equal(bounded.plan.Plan['Actual Rows'],880);
 assert.equal(bounded.joins.some(x=>x.type==='Nested Loop'),false);
 const ambiguity=report.samples.find(x=>x.name==='bounded_ambiguity');
 const matchProbe=walk(ambiguity.plan.Plan).find(x=>x['Index Name']==='app_appearances_match');
 assert.ok(matchProbe,'ambiguity uses the existing match index');
 assert.equal(matchProbe['Actual Loops'],500,'one lookup per match, not per appearance');
 assert.equal(matchProbe['Actual Rows']*matchProbe['Actual Loops'],22000,'no whole-season scan for each match');
 assert.equal(ambiguity.tempWrittenBlocks,0);
 console.log(JSON.stringify({functionRefresh:report.functionRefresh}));
 if(process.env.VEGA_ROLLUP_BENCHMARK_EVIDENCE) await writeFile(process.env.VEGA_ROLLUP_BENCHMARK_EVIDENCE,JSON.stringify(report,null,2));
} finally {await db.query('ROLLBACK');await db.end();}
