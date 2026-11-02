import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalRows,historicalScore} from '../dashboard/frontend/src/services/openfootball-history.js';
import {reactFixtures} from './react-runtime.mjs';

const season={season:'2020/2021',competitions:[
  {id:'2020-21/en.1',name:'Premier League',country:'Angleterre',matches:[
    {date:'2020-09-12',team1:'Fulham',team2:'Arsenal',score:{ft:[0,3]}},
    {date:'2020-09-13',team1:'City',team2:'United'},
  ]},
  {id:'2020-21/fr.1',name:'Ligue 1',country:'France',matches:[
    {date:'2020-09-10',team1:'Paris',team2:'Marseille',score:{ft:[0,0]}},
  ]},
]};

test('historical results preserve zero and do not invent missing scores',()=>{
  assert.deepEqual(historicalScore(season.competitions[0].matches[0]),[0,3]);
  assert.deepEqual(historicalScore(season.competitions[0].matches[1]),[null,null]);
  assert.deepEqual(historicalScore(season.competitions[1].matches[0]),[0,0]);
  assert.equal(historicalRows(season,'all','arsenal').length,1);
  assert.equal(historicalRows(season,'2020-21/fr.1','').length,1);
  assert.equal(historicalRows(season).length,3);
});

test('historical result table shows scores and missing scores separately',async()=>{
  const {renderHistoricalResults}=await reactFixtures();
  const html=renderHistoricalResults(season);
  assert.match(html,/Fulham/);
  assert.match(html,/0 – 3/);
  assert.match(html,/0 – 0/);
  assert.match(html,/—/);
  assert.match(html,/Exporter CSV/);
});
