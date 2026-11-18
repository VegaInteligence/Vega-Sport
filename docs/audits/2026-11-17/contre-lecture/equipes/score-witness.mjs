import assert from "node:assert/strict";
import fs from "node:fs";
import {pathToFileURL} from "node:url";
import path from "node:path";
const W=process.argv[2], D=path.dirname(new URL(import.meta.url).pathname);
const {outOf100,powerOf,createRankingRoute}=await import(pathToFileURL(path.join(W,"backend/api/src/routes/rankings.mjs")).href);
const calls=[], examples=[];
for(const [elo,reference,expected] of [[1500,1500,50],[1700,1500,76],[1900,1500,90.9],[1500,1700,24],[null,1500,null],[1500,null,null]]) {
  const actual=outOf100(elo,reference);assert.equal(actual,expected);examples.push({elo,reference,expected,actual});
}
const row={team_id:"t_v0000001",rank:1,name:"Controlled fixture",elo:1500,elo_change:20,matches:30,
  method_version:"power-ranking-v8",computed_at:"2026-11-18T00:00:00Z",last_match_at:"2025-06-01T00:00:00Z"};
function reader(reference) {return async(sql,args)=>{calls.push({sql,args:args??null,reference});if(sql.includes("api.power_clubs"))return [row];if(sql.includes("avg(level)"))return [{level:reference}];throw Error("Unexpected read: "+sql);};}
async function route(kind,reference) {
  const params=new URLSearchParams({kind,season:"2024/2025"});
  const response=await createRankingRoute(reader(reference))(new Request("http://offline.invalid/api/rankings/power?"+params),"/api/rankings/power",params);
  assert.equal(response.status,200);return await response.json();
}
const clubs1500=await route("clubs",1500),clubs1700=await route("clubs",1700),nations=await route("nations",1500);
assert.equal(clubs1500.rows[0].score,50);assert.equal(clubs1700.rows[0].score,24);
assert.equal(clubs1500.rows[0].elo,clubs1700.rows[0].elo);assert.equal(clubs1500.season,clubs1700.season);
assert.equal(Object.hasOwn(nations.rows[0],"score"),false);assert.equal(Object.hasOwn(nations,"reference"),false);
const profile=Object.fromEntries(await powerOf(reader(1500),"clubs","2024/2025",[row.team_id]));
assert.equal(profile[row.team_id].score,50);
const references=calls.filter(c=>c.sql.includes("avg(level)"));assert(references.every(c=>c.args===null&&!c.sql.includes("season")));
fs.writeFileSync(path.join(D,"score-witness.json"),JSON.stringify({node:process.version,mode:"real module + injected deterministic read function; no database and no network",checks:17,examples,clubs1500,clubs1700,nations,profile,calls},null,2)+"\n");
console.log("PASS 17 assertions: real club season route and profile, nations route, moving reference, six numerical examples.");
