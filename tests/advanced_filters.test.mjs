import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAdvanced, advancedQuery, advancedTest, countAdvanced, advancedChips, EMPTY_ADVANCED,
} from '../dashboard/frontend/src/services/advanced-filters.js';

const query = (advanced) => new URLSearchParams(Object.entries(advancedQuery(advanced)).filter(([, v]) => v));

test('advanced filters survive a URL round trip and ignore invalid parameters', () => {
  const advanced = {
    positions: ['D', 'M'], role: 'starter', venue: 'home', result: 'win', rating: 7.2,
    from: '2026-10-01', to: '2026-10-31', conditions: [{ key: 'goals', min: 1 }, { key: 'xg', min: 0.5 }],
  };
  assert.deepEqual(parseAdvanced(query(advanced)), advanced);
  // One chip per criterion (both dates share one) and one per statistic.
  assert.equal(advancedChips(advanced).length, 8);
  assert.equal(countAdvanced(advanced), 8);
  const junk = parseAdvanced(new URLSearchParams('pos=X,D&role=bench&venue=moon&rmin=abc&from=10/01/2026&stats=goals:x,unknown:2,assists:1'));
  assert.deepEqual(junk, { ...EMPTY_ADVANCED, positions: ['D'], conditions: [{ key: 'assists', min: 1 }] });
  assert.equal(advancedTest(EMPTY_ADVANCED, new Map()), null);
});

test('advanced filters test position, role, rating, dates, venue, result and match statistics', () => {
  const matches = new Map([
    ['m1', { id: 'm1', home: { id: 'h', score: 2 }, away: { id: 'a', score: 1 } }],
    ['m2', { id: 'm2', home: { id: 'h', score: 0 }, away: { id: 'a', score: 0 } }],
  ]);
  const base = { matchId: 'm1', teamId: 'h', positionId: 34, starter: true, rating: 7.5, date: '2026-10-10', goals: 1, shots: 2, xg: 0.6 };
  const keep = (advanced, row) => advancedTest({ ...EMPTY_ADVANCED, ...advanced }, matches)(row);
  assert.equal(keep({ positions: ['D'] }, base), true);
  assert.equal(keep({ positions: ['A'] }, base), false);
  assert.equal(keep({ positions: ['M'] }, { ...base, positionId: 85 }), true);
  assert.equal(keep({ positions: ['G'] }, { ...base, positionId: null }), false);
  assert.equal(keep({ role: 'sub' }, base), false);
  assert.equal(keep({ rating: 7.5 }, base), true);
  assert.equal(keep({ rating: 8 }, { ...base, rating: null }), false);
  assert.equal(keep({ from: '2026-10-11' }, base), false);
  assert.equal(keep({ to: '2026-10-10' }, base), true);
  assert.equal(keep({ venue: 'home', result: 'win' }, base), true);
  assert.equal(keep({ venue: 'away' }, base), false);
  assert.equal(keep({ result: 'loss' }, { ...base, teamId: 'a' }), true);
  assert.equal(keep({ result: 'draw' }, { ...base, matchId: 'm2' }), true);
  assert.equal(keep({ conditions: [{ key: 'goals', min: 1 }, { key: 'xg', min: 0.5 }] }, base), true);
  assert.equal(keep({ conditions: [{ key: 'assists', min: 1 }] }, base), false);
  // No shot means zero xG; an unreported statistic never passes a threshold.
  assert.equal(keep({ conditions: [{ key: 'xg', min: 0 }] }, { ...base, shots: 0, xg: null }), true);
  assert.equal(keep({ conditions: [{ key: 'xa', min: 0 }] }, base), false);
});
