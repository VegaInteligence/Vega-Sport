import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSeason, mergeSeason} from '../dashboard/frontend/src/season_data.js';

const manifest={defaultSeason:'2025/2026',seasons:[{id:'2025/2026',chunks:[{leagueId:'l_000001',sourceDigest:'fixture'}]}]};
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

// Complete season traversal is exercised through the real browser and HTTP API
// in docs/verification/aws-frontend-20261104.
test('unpublished seasons are rejected',async()=>{
  await assert.rejects(()=>loadSeason(manifest,'2024/2025',async()=>new Response()),/Saison indisponible/);
});
