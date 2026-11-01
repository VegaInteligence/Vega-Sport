/** E2E check of daily-worker geographic scope with the World Cup exception. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
 if(new URL(request.url).pathname==='/v1/leagues')return Response.json({data:{leagues:[
  {id:'l_000001',name:'Ligue 1',country_code:'FRA',seasons:['2026/2027']},
  {id:'l_000002',name:'World Cup',country_code:'INT',seasons:['2026']},
  {id:'l_000003',name:'MLS',country_code:'USA',seasons:['2026']},
 ]}});return new Response(null,{status:404});
}});
const report={setup:'Bun worker with local mock PitchAPI catalogue; dummy key; no provider requests.',command:'cd dashboard && bun scripts/verify_world_cup_plan.mjs',expected:'Plan includes Ligue 1 and World Cup, excludes MLS.',status:'failed'};
try{
 const proc=Bun.spawn(['bun','scripts/daily_refresh.mjs','--plan','--now','2026-11-01T12:00:00Z'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PITCHAPI_BASE_URL:`http://127.0.0.1:${server.port}/v1`,PITCHAPI_API_KEY:'pk_test_000000000000000000000000'},stdout:'pipe',stderr:'pipe'});
 const [out,err,code]=await Promise.all([new Response(proc.stdout).text(),new Response(proc.stderr).text(),proc.exited]);assert.equal(code,0,err);const plan=JSON.parse(out);assert.deepEqual(plan.competitions.map(x=>x.name).sort(),['Ligue 1','World Cup']);report.actual={competitions:plan.competitions,exitCode:code};report.logs={stdout:out,stderr:err};report.status='passed';
}catch(e){report.error=String(e);throw e}finally{server.stop(true);await fs.writeFile(fileURLToPath(new URL('../outputs/pitchapi-coverage/world-cup-plan-e2e.json',import.meta.url)),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify(report,null,2));
