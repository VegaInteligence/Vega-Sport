// The hint that a session may exist (docs/COMPTES_SITE.md, W6): a visitor who never signed in on this browser
// costs no request to /api/auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HINT_KEY, clearHint, hasHint, setHint, shouldReadSession } from '../dashboard/frontend/src/services/account-hint.js';

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
}
const broken = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); },
};

test('W6: no hint, no read at page load; a forced read always happens', () => {
  const s = storage();
  assert.equal(hasHint(s), false);
  assert.equal(shouldReadSession({ storage: s }), false);
  assert.equal(shouldReadSession({ storage: s, force: true }), true);
});

test('W6: the hint is one fixed value under one key and says nothing about the person', () => {
  const s = storage();
  setHint(s);
  assert.deepEqual([...s.map.entries()], [[HINT_KEY, '1']]);
  assert.equal(HINT_KEY, 'vega.account.hint.v1');
  assert.equal(hasHint(s), true);
  assert.equal(shouldReadSession({ storage: s }), true);
});

test('W6: any other stored value is not a hint', () => {
  for (const value of ['', '0', 'true', '{"id":"u1"}']) assert.equal(hasHint(storage({ [HINT_KEY]: value })), false, value);
});

test('W6: cleared, the next page load reads nothing', () => {
  const s = storage({ [HINT_KEY]: '1' });
  clearHint(s);
  assert.equal(s.map.size, 0);
  assert.equal(shouldReadSession({ storage: s }), false);
});

test('W6: storage out of reach or absent: no hint, no throw, a forced read still happens', () => {
  for (const s of [broken, null, undefined]) {
    assert.equal(hasHint(s), false);
    assert.doesNotThrow(() => setHint(s));
    assert.doesNotThrow(() => clearHint(s));
    assert.equal(shouldReadSession({ storage: s }), false);
    assert.equal(shouldReadSession({ storage: s, force: true }), true);
  }
});
