/** Render the real competitions page with both actual manifest formats. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {SearchParamsContext, PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import CompetitionsPage from '../frontend/src/views/CompetitionsPage.jsx';
import {FootballContext} from '../frontend/src/hooks/FootballContext.jsx';
const report={setup:'Bun, real React/Next contexts and Compétitions component, canonical and compact manifests. No network or provider key.',command:'cd dashboard && bun scripts/verify_competitions_render.jsx',expected:'Directory and fixture-season selector render for both manifest formats, preserving native calendar-year season query values; World Cup exposes only its actual source season.',status:'failed',checks:[]};
try {
 const packed=await Bun.file('../data/computed/dashboard/index.json').json();const raw=await Bun.file('../data/raw/index.json').json();
 for(const manifest of [packed,raw]){
  const season=manifest.seasons.find(s=>s.id===manifest.defaultSeason);const chunks=packed.seasons.find(s=>s.id===season.id).chunks;
  const catalog=chunks.flatMap(c=>c.competitions).sort((a,b)=>a.name.localeCompare(b.name));
  function render(id=''){
   const f={catalog,manifest,season:season.id,configured:false,statusKnown:true,client:{id:'fixture'},focus:'all',data:{meta:{},matches:[],fixtures:[]},href:(p,params={})=>p+'?'+new URLSearchParams(params),byAppearance:new Map(),comparison:[],player:null};
   return renderToStaticMarkup(<SearchParamsContext.Provider value={new URLSearchParams(id?{id}:{})}><PathnameContext.Provider value='/competitions'><FootballContext.Provider value={f}><CompetitionsPage/></FootballContext.Provider></PathnameContext.Provider></SearchParamsContext.Provider>);
  }
  const directory=render();assert.match(directory,/competition-card/);assert.doesNotMatch(directory,/Chargement impossible/);
  for(const [id,values] of [['l_3FJFUl',['2024/2025','2025/2026','2026/2027']],['l_0uqFK8',['2024','2025','2026']],['l_1XLtP0',['2026']]]){
   const html=render(id);for(const value of values)assert.ok(html.includes(`value="${value}"`),id+':'+value);
   if(id==='l_1XLtP0')assert.ok(!html.includes('value="2026/2027"'),'World Cup query must preserve calendar season');
   report.checks.push({storage:manifest.storage,id,seasons:values});
  }
 }
 report.status='passed';
}catch(error){report.error=error.stack;process.exitCode=1}finally{await fs.writeFile('outputs/competitions-fix/render-evidence.json',JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify(report,null,2));
