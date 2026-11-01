import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdtemp, mkdir, rm, writeFile, readFile, realpath} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const waitFor=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Dashboard did not finish loading');};
const part=(id,season)=>({meta:{retrievedAt:'2026-11-01T00:00:00Z',collectedMatches:1,expectedFinishedMatches:1,shotCount:0,knownShotXgCount:0},
  competitions:[{id:'l_000001',name:'League',country:'FRA',seasons:[season],sampleMatches:1,sampleSeasons:[season]}],teams:[],fixtures:[],appearances:[],metrics:[],
  matches:[{id,leagueId:'l_000001',league:'League',season,date:'2026-01-01',timeUtc:'2026-01-01T12:00:00Z',home:{id:'t_000001',name:'Home',score:1},away:{id:'t_000002',name:'Away',score:0},coverage:{shots:false,players:false,xg:false,ratings:false},shots:[],stats:[],warnings:[]} ]});

test('dashboard switches between season snapshots and never shows a bare calendar year',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'orion-seasons-'));
  const old={document:globalThis.document,window:globalThis.window,location:globalThis.location,history:globalThis.history,fetch:globalThis.fetch};
  try{
    await writeFile(path.join(dir,'package.json'),'{"type":"module"}');
    for(const name of ['app.js','model.js','charts.js','explorer.js','season_data.js'])await copyFile(path.join(root,'dashboard',name),path.join(dir,name));
    await mkdir(path.join(dir,'data','seasons'),{recursive:true});
    const manifest={defaultSeason:'2026/2027',seasons:[{id:'2026/2027',chunks:[{path:'seasons/current.json.gz'}]},{id:'2025/2026',chunks:[{path:'seasons/previous.json.gz'}]}]};
    await writeFile(path.join(dir,'data/football-manifest.json'),JSON.stringify(manifest));
    await writeFile(path.join(dir,'data/seasons/current.json.gz'),gzipSync(Buffer.from(JSON.stringify(part('m_000001','2026')))));
    await writeFile(path.join(dir,'data/seasons/previous.json.gz'),gzipSync(Buffer.from(JSON.stringify(part('m_000002','2025/2026')))));
    const elements=new Map(),listeners={};
    function element(selector){if(!elements.has(selector))elements.set(selector,{id:selector.slice(1),dataset:{},value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,open:false,addEventListener(){},matches(){return false},setSelectionRange(){},focus(){},close(){this.open=false},showModal(){this.open=true}});return elements.get(selector)}
    globalThis.document={querySelector:element,querySelectorAll(){return []},addEventListener(type,fn){listeners[type]=fn},title:''};
    globalThis.window={addEventListener(){},scrollTo(){}};
    globalThis.location={search:'',hash:'#overview',pathname:'/'};
    globalThis.history={replaceState(){}};
    globalThis.fetch=async url=>{
      if(String(url)==='/api/status')return new Response(JSON.stringify({configured:false}),{status:200});
      try{return new Response(await readFile(fileURLToPath(url)),{status:200})}catch{return new Response('',{status:404})}
    };
    await import(pathToFileURL(path.join(dir,'app.js')).href);
    await waitFor(()=>element('#content').innerHTML.includes('Périmètre de la collecte'));
    const select=element('#season-filter');
    assert.match(select.innerHTML,/2026\/2027/);assert.match(select.innerHTML,/2025\/2026/);
    assert.doesNotMatch(select.innerHTML,/value="2026"/);
    select.value='2025/2026';listeners.change({target:select});
    await waitFor(()=>!select.disabled&&select.value==='2025/2026');
    assert.match(element('#content').innerHTML,/1 \/ 1 matchs terminés/);
    assert.equal(select.value,'2025/2026');
  }finally{
    Object.assign(globalThis,old);
    const resolved=await realpath(dir), temp=await realpath(os.tmpdir()), relative=path.relative(temp,resolved);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(resolved).startsWith('orion-seasons-'))throw new Error('Unexpected test directory');
    await rm(resolved,{recursive:true,force:true});
  }
});
