import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const o=fileURLToPath(new URL('.',import.meta.url));
const read=f=>JSON.parse(readFileSync(join(o,f)));
const sha='8018e0836ca0f32e8b2eb51fc2847154abff7f13';
const moduleUrl=new URL('match-tabs.mjs',import.meta.url);
assert.equal(createHash('sha256').update(readFileSync(moduleUrl)).digest('hex'),'d437fa28def9d71bad523014ad5cd7162e1d97c348c7deb08317b412f385d600');
const {boardRows}=await import(moduleUrl);
const o1=read('origin-observations.json'), o2=read('actor-ranking.json');
const receipts=new Map([...o1.receipts,...o2.receipts].map(r=>[r.path,r]));
function get(path){
 const receipt=receipts.get(path), b=readFileSync(join(o,'origin-bodies',receipt.body_sha256+'.json'));
 assert.equal(createHash('sha256').update(b).digest('hex'),receipt.body_sha256);
 const res=JSON.parse(b);return res.data??res;
}
for(const key of o1.summary.match_only){
 const [m,p]=key.split(':');
 const players=get('api/matches/'+m+'/players');
 const rankings=get('api/rankings/match?match='+m).grades;
 // The hook's gradesOf drops all entries with a null grade.
 const grades=new Map(rankings.filter(r=>r.grade!=null).map(r=>[r.playerId,r]));
 assert(!grades.has(p));
 const rows=boardRows(players,[],grades), row=rows.find(r=>r.id===p);
 assert(row && row.grade!=null);
 const per=o1.observations.find(r=>r.key===key);
 assert.equal(per.appearance,null);assert.equal(row.grade,per.match);
 console.log(JSON.stringify({key,rankings:rankings.find(r=>r.playerId===p).grade,appearance:per.appearance,board:row.grade,minutes:row.minutes,source:sha}));
}

