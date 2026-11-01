/** E2E through real HTTP: complete data, scoped loading, reuse and retry. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadSeason} from '../frontend/src/season_data.js';
const base=process.env.ORION_VERIFY_URL||'http://127.0.0.1:3000';
const report={setup:'Running production Next/Bun app and generated lossless serving views. One injected HTTP 503 verifies retry; all successful payloads use the real backend.',command:`cd dashboard && ORION_VERIFY_URL=${base} node --max-old-space-size=3072 scripts/verify_loading_http.mjs`,expected:'All season data equals canonical loading; one request for a league; repeat loads reuse chunks; a failed request remains retryable.',status:'failed'};
try {
 const [raw,views]=await Promise.all(['football-manifest.json','dashboard-manifest.json'].map(async p=>(await fetch(base+'/data/'+p)).json()));const season=views.defaultSeason;let calls=0;
 const fetcher=url=>{calls++;return fetch(new URL(url,base))};
 const scope=new Set(['l_3FJFUl']);const scoped=await loadSeason(views,season,fetcher,scope);assert.equal(calls,1);assert.equal(scoped.competitions.length,1);const firstCalls=calls;
 const full=await loadSeason(views,season,fetcher);assert.equal(calls,views.seasons[0].chunks.length);const allCalls=calls;
 assert.deepEqual(await loadSeason(views,season,fetcher,scope),scoped);assert.equal(calls,allCalls);
 const canonical=await loadSeason(raw,season,url=>fetch(new URL(url,base)));assert.deepEqual(full,canonical);
 let fail=true;const retryFetcher=url=>fail?Promise.resolve(new Response(null,{status:503})):fetch(new URL(url,base));await assert.rejects(loadSeason(views,season,retryFetcher,scope),/503/);fail=false;assert.deepEqual(await loadSeason(views,season,retryFetcher,scope),scoped);
 report.status='passed';report.actual={season,leagueRequests:firstCalls,seasonRequests:allCalls,repeatedLeagueRequests:0,matches:full.matches.length,appearances:full.appearances.length,fixtures:full.fixtures.length,canonicalEquality:true,retrySucceeded:true};
}catch(error){report.error=error.stack;throw error}finally{await fs.writeFile('outputs/loading-performance/http-e2e.json',JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify(report,null,2));
