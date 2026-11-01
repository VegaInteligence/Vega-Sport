/** E2E: real HTTP league schedule -> data client -> scoped fixture identities. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {FootballDataClient} from '../frontend/src/services/football-client.js';
const report={setup:'Node.js, real FootballDataClient and local HTTP provider fixture matching PitchAPI league/matches response (league held at envelope level). No credentials.',command:'cd dashboard && node scripts/verify_competition_fixtures.mjs',expected:'Every match from a league schedule carries its league identity and exact source season for filtering and links; date responses retain per-match identities and null future scores.',status:'failed'};
const league={id:'l_3FJFUl',name:'Ligue 1'};
const fixture={id:'m_000001',date:'2026-11-07',status:'not_started',score_home:null,score_away:null,home_team:{id:'t_000001',name:'Home'},away_team:{id:'t_000002',name:'Away'}};
const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.startsWith('/date/')?{data:{matches:[{...fixture,league:{id:'l_000002',name:'Other'},season:'2026'}]}}:{data:{league:{...league,season:'2026'},matches:[fixture]}}))});
server.listen(0,'127.0.0.1');await once(server,'listening');
try{
 const client=new FootballDataClient({data:{meta:{},competitions:[league],matches:[],fixtures:[]}});client.configured=true;client.statusPromise=Promise.resolve();client.request=async p=>(await fetch(`http://127.0.0.1:${server.address().port}/`+p)).json();
 Object.assign(client,{competitionId:league.id,season:'2026',browseMode:'catalog'});await client.loadFixtures();const match=client.fixtures.get(league.id+':2026').matches[0];assert.deepEqual(match.league,{...league,season:"2026"});assert.equal(match.season,'2026');assert.equal(match.score_home,null);
 Object.assign(client,{day:'2026-11-07',browseMode:'day'});await client.loadFixtures();const day=client.fixtures.get('date:2026-11-07').matches[0];assert.equal(day.league.id,'l_000002');assert.equal(day.season,'2026');
 report.status='passed';report.actual={league:match.league,season:match.season,upcoming_score:match.score_home,date_league:day.league};
}catch(error){report.error=error.stack;process.exitCode=1}finally{await new Promise(resolve=>server.close(resolve));await fs.writeFile('outputs/competitions-fix/fixtures-evidence.json',JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify(report,null,2));
