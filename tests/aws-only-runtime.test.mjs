import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { loadSeason } from '../dashboard/frontend/src/season_data.js';
import { ProFootballDataClient } from '../dashboard/frontend/src/services/pro-football-client.js';
import { proxy } from '../dashboard/frontend/src/server/bun-proxy.js';

const token = (n) => `pro1.${n}.${String(n).repeat(64)}`;
const manifest = (n = 1) => ({
  storage: 'aws-orion-pro', schemaVersion: 4, capabilities: { frozenRepresentations: true },
  editions: [{ leagueId: 'l_000001', season: '2026/2027', representationToken: token(n) }],
  seasons: [{ id: '2026/2027', chunks: [{ leagueId: 'l_000001', sourceDigest: 'same-source', representationToken: token(n) }] }],
  competitions: [{ id: 'l_000001', name: 'Example' }],
});
const part = (id) => ({ meta: {}, metrics: [], matches: [{ id, date: '2026-10-01', players: [], shots: [], stats: [] }],
  appearances: [], fixtures: [], competitions: [{ id: 'l_000001', seasons: ['2026/2027'] }], teams: [] });

test('season pages retain the published version, follow cursors and isolate a new build from cache', async () => {
  const calls = [];
  const fetcher = async (path) => {
    const url = new URL(path, 'https://example.test'); calls.push(url);
    const second = url.searchParams.has('cursor');
    return Response.json({ data: part(second ? 'm_000002' : 'm_000001'), pagination: {
      generation: url.searchParams.get('v'), nextCursor: second ? null : 'next' } });
  };
  const first = await loadSeason(manifest(), '2026/2027', fetcher);
  assert.equal(first.matches.length, 2);
  assert.equal(first.meta.source, 'PitchAPI · AWS');
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.searchParams.get('v') === token(1)));
  await loadSeason(manifest(), '2026/2027', fetcher);
  assert.equal(calls.length, 2);
  await loadSeason(manifest(2), '2026/2027', fetcher);
  assert.equal(calls.length, 4);
  assert.ok(calls.slice(2).every((url) => url.searchParams.get('v') === token(2)));
});

test('an inconsistent edition token is rejected before requesting data', async () => {
  const value = manifest(); value.seasons[0].chunks[0].representationToken = token(2);
  await assert.rejects(loadSeason(value, '2026/2027', () => { throw Error('network must not run'); }), /Version de saison/);
});

test('match details use their owning edition and retain native empty/null values', async () => {
  const calls = [], data = { meta: {}, competitions: [], matches: [{ id: 'm_000001', leagueId: 'l_000001', season: '2026/2027' }] };
  const client = new ProFootballDataClient({ data, manifest: manifest(), leagueId: 'all', season: '2026/2027',
    fetcher: async (path) => { calls.push(new URL(path, 'https://example.test')); return Response.json({ data: { periods: [], value: null } }); } });
  await client.ensureEndpoint(data.matches[0], 'shots');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, '/api/pitchapi/matches/m_000001/shots');
  assert.equal(calls[0].searchParams.get('v'), token(1));
  assert.deepEqual(client.payloads.get('m_000001:shots').data, { periods: [], value: null });
  await client.ensureEndpoint(data.matches[0], 'shots');
  assert.equal(calls.length, 1);
});

test('missing AWS detail exposes the API error without reading an object archive', async () => {
  const client = new ProFootballDataClient({ data: { meta: {}, competitions: [], matches: [] }, manifest: manifest(), season: '2026/2027',
    fetcher: async () => Response.json({ error: { code: 'NOT_COLLECTED', message: 'Not collected' } }, { status: 404 }) });
  await client.ensureEndpoint({ id: 'm_000001', leagueId: 'l_000001', season: '2026/2027' }, 'lineups');
  assert.equal(client.payloads.get('m_000001:lineups').code, 'NOT_COLLECTED');
  assert.equal(await client.loadShard('m_000001'), null);
});

test('Vercel proxies to AWS with no database credentials and preserves conditional responses', async () => {
  const original = globalThis.fetch;
  const keys = ['VERCEL', 'NODE_ENV', 'ORION_API_ORIGIN', 'NEXT_PUBLIC_API_ORIGIN', 'DATABASE_URL', 'NEON_DATABASE_URL'];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.VERCEL = '1'; process.env.NODE_ENV = 'production';
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://d317dq37z1tacb.cloudfront.net/api/health');
      assert.equal(options.headers['If-None-Match'], '"version"');
      return new Response(null, { status: 304, headers: { etag: '"version"', 'x-data-source': 'AWS' } });
    };
    const response = await proxy(new Request('https://site.test/api/health', { headers: { 'if-none-match': '"version"' } }));
    assert.equal(response.status, 304); assert.equal(response.headers.get('x-data-source'), 'AWS');
    assert.equal((await proxy(new Request('https://site.test/data/raw/index.json'))).status, 410);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('Vercel forwards a complete decoded AWS response without its compressed wire length', async () => {
  const body = JSON.stringify({ editions: Array.from({ length: 200 }, (_, id) => ({ id, name: 'Competition' })) });
  const compressed = gzipSync(body);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': compressed.length });
    res.end(compressed);
  });
  const keys = ['ORION_API_ORIGIN', 'NEXT_PUBLIC_API_ORIGIN'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.ORION_API_ORIGIN = `http://127.0.0.1:${server.address().port}`;
    delete process.env.NEXT_PUBLIC_API_ORIGIN;
    const response = await proxy(new Request('https://site.test/api/dashboard/manifest'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-length'), null);
    assert.equal(response.headers.get('content-encoding'), null);
    assert.equal(await response.text(), body);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
