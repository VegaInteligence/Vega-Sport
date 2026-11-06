import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../dashboard/scripts/rds-maintenance.mjs';

test('private maintenance has only the reviewed operations', async () => {
  assert.deepEqual(await handler({ operation: 'probe' }), { ok: true, operations: ['inspect', 'retire_empty_models'] });
  await assert.rejects(handler({ operation: 'sql', sql: 'SELECT 1' }), /Unsupported maintenance operation/);
});

test('maintenance refuses another host, database, or an unbundled execution', async () => {
  const previous = process.env.DATABASE_URL, root = process.env.LAMBDA_TASK_ROOT;
  try {
    delete process.env.LAMBDA_TASK_ROOT;
    for (const url of ['postgresql://test:synthetic@other.rds.amazonaws.com:5432/statarena_prod',
      'postgresql://test:synthetic@statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com:5432/other']) {
      process.env.DATABASE_URL = url;
      await assert.rejects(handler({ operation: 'inspect' }), /Unexpected maintenance database target/);
    }
    process.env.DATABASE_URL = 'postgresql://test:synthetic@statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com:5432/statarena_prod';
    await assert.rejects(handler({ operation: 'inspect' }), /reviewed temporary Lambda package/);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    if (root === undefined) delete process.env.LAMBDA_TASK_ROOT; else process.env.LAMBDA_TASK_ROOT = root;
  }
});
