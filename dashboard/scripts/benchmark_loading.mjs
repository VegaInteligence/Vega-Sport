/** Real HTTP loading E2E; run the same loader against deployed/local data. */
import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {loadSeason} from '../frontend/src/season_data.js';
const base=process.env.ORION_VERIFY_URL||'https://orion-football-ranking.vercel.app';
const output=process.argv[2]||'outputs/loading-performance/http-baseline.json';
const report={setup:'Fresh Node process without a browser HTTP cache; live HTTP application and actual season loader. No provider requests.',command:`cd dashboard && ORION_VERIFY_URL=${base} ${process.env.NEXT_PUBLIC_DATA_REVISION ? `NEXT_PUBLIC_DATA_REVISION=${process.env.NEXT_PUBLIC_DATA_REVISION} ` : ""}${process.env.ORION_DATA_MANIFEST ? `ORION_DATA_MANIFEST=${process.env.ORION_DATA_MANIFEST} ` : ""}node scripts/benchmark_loading.mjs ${output}`,expected:'Load the current season without losing fixtures, matches or appearances; record data requests, bytes and wall time.',status:'failed',scopes:[]};
try {
 const start=performance.now();const response=await fetch(base+'/data/'+(process.env.ORION_DATA_MANIFEST||'dashboard-manifest.json'));const manifest=await response.json();report.manifestMs=Math.round(performance.now()-start);
 for(const [name,scope] of [['league',new Set(['l_3FJFUl'])],['all',null]]){
  let requests=0,bytes=0;const begin=performance.now();
  const data=await loadSeason(manifest,manifest.defaultSeason,async(path)=>{requests++;const r=await fetch(new URL(path,base));return new Response(r.body.pipeThrough(new TransformStream({transform(chunk,c){bytes+=chunk.byteLength;c.enqueue(chunk)}})),{status:r.status,headers:r.headers});},scope);
  report.scopes.push({name,ms:Math.round(performance.now()-begin),requests,bytes,matches:data.matches.length,appearances:data.appearances.length,fixtures:data.fixtures.length,shots:data.matches.reduce((n,m)=>n+m.shots.length,0)});
  console.log(JSON.stringify(report.scopes.at(-1)));
 }
 report.status='passed';
}catch(error){report.error=error.stack;throw error}finally{await fs.writeFile(output,JSON.stringify(report,null,2)+'\n')}
