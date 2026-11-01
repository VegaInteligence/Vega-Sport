import test from 'node:test';
import assert from 'node:assert/strict';
import {filterAppearances, filterMatches, seasonLabel, sortRows, per90, sumKnown, csvString, escapeHtml} from '../dashboard/frontend/src/model.js';

const rows = [
  {id:'a', name:'Álex', team:'Liège', leagueId:'A', season:'2026', matchId:'m1', minutes:45, xg:0, rating:7},
  {id:'b', name:'Bob', team:'Lens', leagueId:'B', season:'2026/2027', matchId:'m2', minutes:90, xg:null, rating:null},
  {id:'c', name:'Clément', team:'Lille', leagueId:'B', season:'2026/2027', matchId:'m2', minutes:0, xg:null, rating:null},
  {id:'d', name:'Dan', team:'Lens', leagueId:'B', season:'2026/2027', matchId:'m2', minutes:20, xg:1, rating:8}
];
const filters = {query:'',league:'all',season:'all',minutes:1};

test('filters combine accent-insensitive search, season and minutes without inventing appearances', () => {
  assert.deepEqual(filterAppearances(rows,{...filters,query:'liege'}).map(x=>x.id),['a']);
  assert.deepEqual(filterAppearances(rows,{...filters,season:'2026/2027',minutes:30}).map(x=>x.id),['a','b']);
  assert.equal(filterAppearances(rows,{...filters,minutes:0}).length,4);
});
test('calendar-year seasons use a season label while preserving source values', () => {
  assert.equal(seasonLabel('2026'),'2026/2027');
  assert.equal(seasonLabel('2025/2026'),'2025/2026');
  assert.equal(rows[0].season,'2026');
});
test('missing values always sort last and observed zero remains a real value', () => {
  assert.deepEqual(sortRows(rows,'xg','asc').map(x=>x.id),['a','d','b','c']);
  assert.deepEqual(sortRows(rows,'xg','desc').map(x=>x.id),['d','a','b','c']);
});
test('per-90 transformations preserve missingness and never transform supplier ratings', () => {
  assert.equal(per90(null,45),null);
  assert.equal(per90(2,0),null);
  assert.equal(per90(0,45),0);
  assert.equal(per90(2,45),4);
  assert.equal(sortRows(rows,'rating','desc','per90')[0].id,'d');
  assert.equal(sumKnown([null,undefined]),null);
});
test('a player search resolves the correct match without depending on the minutes filter', () => {
  const matches=[{id:'m1',leagueId:'A',season:'2026',home:{name:'Liège'},away:{name:'Riga'}},{id:'m2',leagueId:'B',season:'2026/2027',home:{name:'Lille'},away:{name:'Lens'}}];
  assert.deepEqual(filterMatches(matches,rows,{...filters,query:'clement'}).map(x=>x.id),['m2']);
});
test('CSV keeps blanks for unknown values, real zeros, UTF-8 and protects formula-like text', () => {
  const csv=csvString(['Joueur','xG'],[['=HYPERLINK("x")',null],['Álex',0],['M\nN',1]]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")";'));
  assert.ok(csv.includes('"Álex";"0"'));
});
test('untrusted names are escaped in generated markup', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('a match filter remains exact when a competition contains several matches', () => {
  const moreRows=[...rows,{...rows[1],id:'e',name:'Eli',matchId:'m3'}];
  const scoped={...filters,league:'B',season:'2026/2027',match:'m2'};
  assert.deepEqual(filterAppearances(moreRows,scoped).map(row=>row.id),['b','d']);
  const matches=['m2','m3'].map(id=>({id,leagueId:'B',season:'2026/2027',home:{name:'Lille'},away:{name:'Lens'}}));
  assert.deepEqual(filterMatches(matches,moreRows,scoped).map(match=>match.id),['m2']);
});

import {reactFixtures} from './react-runtime.mjs';
const {scatterPlot, shotMap, xgTimeline}=await reactFixtures();

const chartMatch = (id, league, shots, homeScore=1, awayScore=0) => ({id, league, home:{id:'home',name:'Home',score:homeScore}, away:{id:'away',name:'Away',score:awayScore}, shots, coverage:{shots:shots.length>0}});
const normalShot = (i) => ({id:`s${i}`,playerId:'p',playerName:'Player',teamId:i%2?'home':'away',x:90,y:34,minute:i+1,xg:0.1,type:'AttemptSaved',isGoal:false,isOwnGoal:false});
const ownGoal = {...normalShot(26),xg:null,type:'OwnGoal',isOwnGoal:true};
const chartMatches = [chartMatch('m1','Example',[normalShot(0)]), chartMatch('m2','3. Liga',[],1,2), chartMatch('m3','Finland',[...Array.from({length:26},(_,i)=>normalShot(i)),ownGoal])];
const chartSnapshot = {matches:chartMatches, appearances:chartMatches.map(match=>({id:`${match.id}:p`}))};
const chartPointCount = (html) => [...html.matchAll(/<circle\b[^>]*class="chart-point(?:\s[^"]*)?"/g)].length;

test('synthetic matches render valid chart values and resolve every selectable shot to an appearance', () => {
  assert.equal(chartSnapshot.matches.length,3);
  const appearanceIds = new Set(chartSnapshot.appearances.map(row=>row.id));
  for(const match of chartSnapshot.matches) {
    const map = shotMap(match);
    const timeline = xgTimeline(match);
    for(const html of [map,timeline]) {
      assert.doesNotMatch(html,/\b(?:NaN|Infinity|undefined)\b/,match.league);
      if(match.shots.length) {
        assert.match(html,/<title>.+<\/title>/,match.league);
        assert.match(html,/<desc>.+<\/desc>/,match.league);
      }
    }
    const located = match.shots.filter(shot=>Number.isFinite(shot.x)&&Number.isFinite(shot.y));
    assert.equal(chartPointCount(map),located.length,`${match.league}: the map keeps all located events`);
    for(const shot of located) {
      if(!shot.playerId) continue;
      const appearanceId = `${match.id}:${shot.playerId}`;
      assert.ok(appearanceIds.has(appearanceId),`${appearanceId} must open an existing performance`);
      assert.ok(map.includes(`data-open-player="${appearanceId}"`));
    }
    if(match.shots.length) {
      const homeOnly = shotMap(match,{teamId:match.home.id});
      assert.equal(chartPointCount(homeOnly),located.filter(shot=>shot.teamId===match.home.id).length);
      for(const side of ['home','away']) {
        const known = match.shots.filter(shot=>shot.teamId===match[side].id&&Number.isFinite(shot.xg)&&Number.isFinite(shot.minute)&&!shot.isOwnGoal);
        if(!known.length) continue;
        const total = known.reduce((sum,shot)=>sum+shot.xg,0).toLocaleString('fr-FR',{maximumFractionDigits:2});
        assert.ok(timeline.includes(`<strong>${total} xG</strong>`),`${match.league}: cumulative ${side} xG match the known observations`);
      }
    }
  }
});

test('3. Liga missing shots produce explicit unavailable states instead of a zero-xG chart', () => {
  const match = chartSnapshot.matches.find(item=>item.league==='3. Liga');
  assert.ok(match);
  assert.equal(match.coverage.shots,false);
  assert.ok(match.home.score+match.away.score>0);
  for(const html of [shotMap(match),xgTimeline(match)]) {
    assert.match(html,/chart-empty/);
    assert.match(html,/indisponible/);
    assert.doesNotMatch(html,/<svg|0 xG/);
  }
});

test('an own goal remains on the shot map with unknown xG and is excluded from the cumulative curve', () => {
  const match = chartSnapshot.matches.find(item=>item.shots.some(shot=>shot.isOwnGoal));
  const ownGoal = match.shots.find(shot=>shot.isOwnGoal);
  assert.equal(ownGoal.xg,null);
  const map = shotMap(match), timeline = xgTimeline(match);
  assert.ok(map.includes(`data-open-player="${match.id}:${ownGoal.playerId}"`));
  assert.match(map,/But contre son camp · xG : Non renseigné/);
  assert.match(map,/1 xG absent/);
  assert.equal(chartPointCount(map),27);
  assert.equal(chartPointCount(timeline),26);
  assert.match(timeline,/1 événement exclu/);
});

test('scatter keeps an observed zero at the origin but excludes missing and nonfinite coordinate pairs', () => {
  const base = {name:'Joueur',team:'Club',minutes:90};
  const html = scatterPlot([
    {...base,id:'zero',xg:0,xa:0},
    {...base,id:'null-x',xg:null,xa:0},
    {...base,id:'null-y',xg:1,xa:null},
    {...base,id:'undefined',xg:undefined,xa:1},
    {...base,id:'nonfinite',xg:1,xa:Infinity}
  ]);
  assert.equal(chartPointCount(html),1);
  assert.ok(html.includes('data-open-player="zero"'));
  assert.match(html,/xG : 0 · xA : 0/);
  for(const id of ['null-x','null-y','undefined','nonfinite']) assert.ok(!html.includes(`data-open-player="${id}"`));
  assert.match(scatterPlot([{...base,xg:null,xa:0}]),/chart-empty/);
});

test('chart titles, team names, axis labels and selectable identifiers escape malicious markup', () => {
  const malicious = '<img src=x onerror="alert(1)">';
  const maliciousId = 'p" onclick="alert(2)';
  const match = {
    id:'m',home:{id:'home',name:malicious},away:{id:'away',name:'A&B'},
    shots:[{id:'s',playerId:maliciousId,playerName:malicious,teamId:'home',x:90,y:34,xg:0.1,minute:12,type:'Goal',isGoal:true,isOwnGoal:false}]
  };
  const scatter = scatterPlot([{id:maliciousId,name:malicious,team:'A&B',xg:0,xa:0}],{xLabel:malicious});
  for(const html of [scatter,shotMap(match),xgTimeline(match)]) {
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
    assert.doesNotMatch(html,/<img|<script|\s+onclick="alert/);
  }
  assert.ok(scatter.includes('data-open-player="p&quot; onclick=&quot;alert(2)"'));
  assert.ok(shotMap(match).includes('data-open-player="m:p&quot; onclick=&quot;alert(2)"'));
});
