import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { loadSeason, readPages } from '../dashboard/frontend/src/season_data.js';
import { ProFootballDataClient } from '../dashboard/frontend/src/services/pro-football-client.js';
import { proxy } from '../dashboard/frontend/src/server/bun-proxy.js';
import { clubDataTeam, loadClubSeason } from '../dashboard/frontend/src/services/scouting-history.js';

const token = (n) => `pro1.${n}.${String(n).repeat(64)}`;
const manifest = (n = 1) => ({
  storage: 'aws-orion-pro', schemaVersion: 4, capabilities: { frozenRepresentations: true },
  editions: [{ leagueId: 'l_000001', season: '2026/2027', representationToken: token(n) }],
  seasons: [{ id: '2026/2027', chunks: [{ leagueId: 'l_000001', sourceDigest: 'same-source', representationToken: token(n) }] }],
  competitions: [{ id: 'l_000001', name: 'Example' }],
});
const part = (id) => ({ meta: {}, metrics: [], matches: [{ id, date: '2026-10-01', players: [], shots: [], stats: [] }],
  appearances: [], fixtures: [], competitions: [{ id: 'l_000001', seasons: ['2026/2027'] }], teams: [] });

test('club overview loads every owning competition without downloading the worldwide season', async () => {
  const value = { storage: 'aws-relational', seasons: [{ id: '2026/2027', chunks:
    ['l_000001', 'l_000002', 'l_000003'].map(leagueId => ({ leagueId, sourceDigest: leagueId })) }] };
  const calls = [];
  const fetcher = async (path) => {
    const url = new URL(path, 'https://example.test'); calls.push(url);
    if (url.pathname === '/api/scouting/routes') {
      assert.equal(url.searchParams.get('team'), 't_000001');
      return Response.json({ clubRoutes: { t_000001: {
        '2026/2027': ['l_000001', 'l_000002', 'l_000002'], '2025/2026': ['l_000003'],
      } } });
    }
    const league = url.searchParams.get('league');
    assert.equal(url.searchParams.get('season'), '2026/2027');
    assert.notEqual(league, 'l_000003');
    const data = { ...part(league.replace('l_', 'm_')), competitions: [{ id: league, seasons: ['2026/2027'] }] };
    return Response.json({ data, pagination: { generation: league, nextCursor: null } });
  };
  const data = await loadClubSeason(value, 't_000001', '2026/2027', fetcher);
  assert.deepEqual(data.competitions.map(c => c.id).sort(), ['l_000001', 'l_000002']);
  assert.equal(data.matches.length, 2);
  assert.equal(calls.length, 3);
  await loadClubSeason(value, 't_000001', '2026/2027', fetcher);
  assert.equal(calls.length, 3, 'Repeated navigation reuses the same committed partitions');
});

test('club comparisons and style retain the complete statistical cohort', () => {
  for (const view of ['overview', 'matches', 'players', ''])
    assert.equal(clubDataTeam(new URLSearchParams({ id: 't_000001', clubView: view })), 't_000001');
  for (const view of ['style', 'compare'])
    assert.equal(clubDataTeam(new URLSearchParams({ id: 't_000001', clubView: view })), null);
  const params = new URLSearchParams({ id: 't_000001' });
  assert.equal(clubDataTeam(params, { playerOpen: true }), null);
  assert.equal(clubDataTeam(params, { comparing: true }), null);
  assert.equal(clubDataTeam(new URLSearchParams({ id: 'invalid' })), null);
});

test('missing club routing never silently falls back to a worldwide download', async () => {
  const value = { storage: 'aws-relational', seasons: [{ id: '2026/2027', chunks: [{ leagueId: 'l_000001' }] }] };
  let calls = 0;
  const empty = await loadClubSeason(value, 't_000001', '2026/2027', async () => {
    calls++; return Response.json({ clubRoutes: {} });
  });
  assert.equal(calls, 1); assert.equal(empty.matches.length, 0);
  calls = 0;
  await assert.rejects(loadClubSeason(value, 't_000001', '2026/2027', async () => {
    calls++; return new Response(null, { status: 503 });
  }), /index des saisons est indisponible/);
  assert.equal(calls, 1);
});

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

test('a slow season read restarts with smaller pages and discards the earlier generation', async () => {
  const calls = [];
  const fetcher = async (path) => {
    const url = new URL(path, 'https://example.test');
    const limit = Number(url.searchParams.get('limit'));
    const cursor = url.searchParams.get('cursor');
    calls.push({ limit, cursor });
    if (limit === 50 && cursor) return new Response(null, { status: 503 });
    return Response.json({ data: { id: limit === 50 ? 'old' : cursor ? 'new-second' : 'new-first' },
      pagination: { generation: limit === 50 ? 'old-generation' : 'new-generation', nextCursor: cursor ? null : 'next' } });
  };
  const pages = await readPages('/api/seasons/partition', { season: '2026/2027', league: 'l_000001' }, fetcher);
  assert.deepEqual(calls, [{ limit: 50, cursor: null }, { limit: 50, cursor: 'next' },
    { limit: 25, cursor: null }, { limit: 25, cursor: 'next' }]);
  assert.deepEqual(pages, [{ id: 'new-first' }, { id: 'new-second' }]);
});

test('a persistent unavailable season stops after one smaller-page attempt', async () => {
  const limits = [];
  await assert.rejects(readPages('/api/seasons/partition', {}, async (path) => {
    limits.push(Number(new URL(path, 'https://example.test').searchParams.get('limit')));
    return new Response(null, { status: 503 });
  }), /HTTP 503/);
  assert.deepEqual(limits, [50, 25]);
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

test('Vercel bounds simultaneous AWS reads including image redirects', async () => {
  const original = globalThis.fetch;
  const previous = process.env.NEXT_PUBLIC_API_ORIGIN;
  delete process.env.NEXT_PUBLIC_API_ORIGIN;
  const releases = [];
  let running = 0, peak = 0, started = 0;
  try {
    globalThis.fetch = async () => {
      running++; started++; peak = Math.max(peak, running);
      await new Promise(resolve => releases.push(resolve));
      running--;
      return Response.json({ ok: true });
    };
    const pending = Array.from({ length: 9 }, (_, i) =>
      proxy(new Request(`https://site.test/api/assets?url=image-${i}`)));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, 4);
    while (started < 9 || running) {
      releases.splice(0).forEach(resolve => resolve());
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.ok((await Promise.all(pending)).every(r => r.status === 200));
    assert.equal(peak, 4);
  } finally {
    releases.splice(0).forEach(resolve => resolve());
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.NEXT_PUBLIC_API_ORIGIN;
    else process.env.NEXT_PUBLIC_API_ORIGIN = previous;
  }
});

test('an aborted queued read exits promptly without consuming an upstream permit', async () => {
  const original = globalThis.fetch;
  const previous = process.env.NEXT_PUBLIC_API_ORIGIN;
  delete process.env.NEXT_PUBLIC_API_ORIGIN;
  const releases = [];
  let started = 0;
  try {
    globalThis.fetch = async () => {
      started++;
      await new Promise(resolve => releases.push(resolve));
      return Response.json({ ok: true });
    };
    const pending = Array.from({ length: 4 }, () => proxy(new Request('https://site.test/api/health')));
    await new Promise(resolve => setImmediate(resolve));
    const controller = new AbortController();
    const cancelled = proxy(new Request('https://site.test/api/health', { signal: controller.signal }));
    controller.abort();
    assert.equal((await cancelled).status, 499);
    assert.equal(started, 4);
    releases.splice(0).forEach(resolve => resolve());
    assert.ok((await Promise.all(pending)).every(r => r.status === 200));
    globalThis.fetch = async () => { started++; return Response.json({ ok: true }); };
    assert.equal((await proxy(new Request('https://site.test/api/health'))).status, 200);
    assert.equal(started, 5, 'The cancelled queued request never reaches AWS');
  } finally {
    releases.splice(0).forEach(resolve => resolve());
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.NEXT_PUBLIC_API_ORIGIN;
    else process.env.NEXT_PUBLIC_API_ORIGIN = previous;
  }
});

test('Vercel retries transient read throttles and preserves persistent or long backoffs', async () => {
  const original = globalThis.fetch;
  const previous = process.env.NEXT_PUBLIC_API_ORIGIN;
  delete process.env.NEXT_PUBLIC_API_ORIGIN;
  try {
    let calls = 0;
    globalThis.fetch = async () => ++calls < 3
      ? new Response('busy', { status: 429, headers: { 'retry-after': '0' } })
      : Response.json({ ok: true });
    assert.equal((await proxy(new Request('https://site.test/api/health'))).status, 200);
    assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('busy', { status: 429, headers: { 'retry-after': '0' } }); };
    const busy = await proxy(new Request('https://site.test/api/health'));
    assert.equal(busy.status, 429); assert.equal(await busy.text(), 'busy'); assert.equal(calls, 3);
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('later', { status: 429, headers: { 'retry-after': '60' } }); };
    const later = await proxy(new Request('https://site.test/api/health'));
    assert.equal(later.status, 429); assert.equal(later.headers.get('retry-after'), '60'); assert.equal(calls, 1);
    calls = 0;
    assert.equal((await proxy(new Request('https://site.test/api/health', { method: 'POST' }))).status, 429);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.NEXT_PUBLIC_API_ORIGIN;
    else process.env.NEXT_PUBLIC_API_ORIGIN = previous;
  }
});
