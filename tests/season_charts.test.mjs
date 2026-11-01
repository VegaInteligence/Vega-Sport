import test from 'node:test';
import assert from 'node:assert/strict';
import {scatterPlot} from '../dashboard/charts.js';

test('large season scatter plots remain bounded and report how many points are shown', () => {
  const rows = Array.from({length:150000}, (_, i) => ({id:`p${i}`,name:`Player ${i}`,team:'Team',xg:i/10000,xa:i/100000,minutes:90}));
  const html = scatterPlot(rows);
  assert.equal((html.match(/class="chart-point"/g)||[]).length,1200);
  assert.match(html,/points affichés/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});
