import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {loadSeason, mergeSeason} from '../dashboard/frontend/src/season_data.js';

const manifest={defaultSeason:'2025/2026',seasons:[{id:'2025/2026',chunks:[{path:'seasons/example.json.gz'}]}]};
const part={meta:{retrievedAt:'2026-10-31T00:00:00Z',collectedMatches:1,expectedFinishedMatches:2,shotCount:1,knownShotXgCount:1,ratedAppearanceCount:1},
  competitions:[{id:'l_000001',name:'League',sampleMatches:2,seasons:['2025'],sampleSeasons:['2025']}],
  teams:[{id:'t_000001',name:'Team',sampleMatches:1,leagueIds:['l_000001'],seasons:['2025']}],
  fixtures:[],matches:[{id:'m_000001',date:'2025-08-01',timeUtc:'2025-08-01T12:00:00Z'}],
  appearances:[{id:'m_000001:p_000001',playerId:'p_000001',minutes:90}],metrics:[]};

test('season snapshots preserve progress and distinct player counts',()=>{
  const value=mergeSeason(manifest,'2025/2026',[part]);
  assert.equal(value.meta.matchCount,1);
  assert.equal(value.meta.collectedMatches,1);
  assert.equal(value.meta.expectedFinishedMatches,2);
  assert.equal(value.meta.playerCount,1);
  assert.deepEqual(value.meta.seasons,['2025/2026']);
  assert.equal(value.competitions[0].seasons[0],'2025');
});

test('compressed competition snapshots load as one selected season',async()=>{
  const compressed=gzipSync(Buffer.from(JSON.stringify(part)));
  const value=await loadSeason(manifest,'2025/2026',async url=>{
    assert.match(String(url),/seasons\/example\.json\.gz$/);
    return new Response(compressed,{status:200});
  });
  assert.equal(value.matches[0].id,'m_000001');
  await assert.rejects(()=>loadSeason(manifest,'2024/2025',async()=>new Response()),/Saison indisponible/);
});
