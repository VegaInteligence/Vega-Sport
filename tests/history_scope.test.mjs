import test from 'node:test';
import assert from 'node:assert/strict';
import {historyYears,inHistoryScope} from '../scripts/history_scope.mjs';

test('a 2024 scope includes the 2024/2025 and calendar-year 2024 seasons only',()=>{
  const years=historyYears(['--history','--years=2024']);
  assert.equal(inHistoryScope({season:'2024/2025'},years),true);
  assert.equal(inHistoryScope({season:'2024'},years),true);
  assert.equal(inHistoryScope({season:'2023/2024'},years),false);
  assert.equal(inHistoryScope({season:'2025/2026'},years),false);
  assert.equal(inHistoryScope({season:'2021/2022'},null),true);
  assert.throws(()=>historyYears(['--years=2026']),/2021 through 2025/);
});
