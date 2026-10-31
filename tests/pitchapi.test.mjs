import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryCache, createPitchApiHandler } from '../worker/pitchapi.js';
import worker from '../worker/index.js';

const fixtureKey = 'pk_test_fixture_only_not_a_real_credential';
const env = { PITCHAPI_API_KEY: fixtureKey };
const request = (resource, init) => new Request(`https://orion.example/api/pitchapi${resource}`, init);
const upstreamJson = (data, init = {}) => new Response(JSON.stringify(data), {
  ...init,
  headers: { 'Content-Type': 'application/json', ...init.headers },
});

test('configuration status never reveals secrets and missing configuration never calls the provider', async () => {
  let calls = 0;
  const handle = createPitchApiHandler({ fetcher: async () => { calls++; throw new Error('Unexpected request'); } });
  const unavailable = await handle(request('/leagues'));
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, 'PITCHAPI_NOT_CONFIGURED');
  for (const [configuration, expected] of [[{}, false], [env, true], [{ PITCHAPI_API_KEY: 'invalid' }, false]]) {
    const response = await handle(new Request('https://orion.example/api/status'), configuration);
    const body = await response.text();
    assert.equal(JSON.parse(body).configured, expected);
    assert.equal(JSON.parse(body).source, 'PitchAPI');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(body.includes(fixtureKey), false);
    assert.equal(body.includes('PITCHAPI_API_KEY'), false);
  }
  assert.equal(calls, 0);
});

test('all 24 documented resource forms are reachable without forwarding visitor credentials', async () => {
  const seen = [];
  const handle = createPitchApiHandler({
    cache: null,
    fetcher: async (url, options) => {
      seen.push({ url, options });
      return upstreamJson({ data: { value: 7 } }, { headers: { 'Set-Cookie': 'private=upstream', 'X-Provider-Secret': 'private' } });
    },
  });
  const match = '/matches/m_123AbC';
  const resources = [
    '/leagues', '/leagues/l_123AbC', '/leagues/l_123AbC/matches?status=all&season=2026%2F2027',
    '/date/2026-10-31?status=upcoming', '/teams/t_123AbC', '/players/p_123AbC', match,
    ...['shots', 'momentum', 'events', 'players', 'players/halves', 'stats', 'h2h', 'advanced', 'advanced/players', 'advanced/network', 'lineups', 'heatmaps?frame=home_ltr', 'shots/s_123AbC', 'players/p_123AbC', 'players/p_123AbC/halves', 'players/p_123AbC/shots', 'advanced/players/p_123AbC'].map(suffix => `${match}/${suffix}`),
  ];
  assert.equal(resources.length, 24);
  for (const resource of resources) {
    const response = await handle(request(resource, { headers: { Authorization: 'Bearer visitor-private', Cookie: 'session=visitor-private', 'X-API-KEY': 'visitor-key' } }), env);
    assert.equal(response.status, 200, resource);
    assert.deepEqual(await response.json(), { data: { value: 7 } });
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(response.headers.get('X-Provider-Secret'), null);
  }
  assert.equal(seen.length, 24);
  for (const { url, options } of seen) {
    assert.equal(new URL(url).origin, 'https://api.pitchapi.dev');
    assert.equal(new URL(url).pathname.startsWith('/v1/'), true);
    assert.equal(url.includes(fixtureKey), false);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { Accept: 'application/json', 'X-API-KEY': fixtureKey });
  }
});

test('route and query validation reject arbitrary hosts, traversal, unsupported methods and ambiguous parameters', async () => {
  let calls = 0;
  const handle = createPitchApiHandler({ fetcher: async () => { calls++; return upstreamJson({ data: [] }); } });
  const invalid = [
    ['/https://example.com/', 404], ['/leagues?url=https://example.com', 400],
    ['//api.pitchapi.dev/v1/leagues', 404], ['/v1/leagues', 404],
    ['/teams/t_invalid_long_id', 404], ['/matches/m_123AbC/../../.env', 404],
    ['/matches/m_123AbC%2Fshots', 404], ['/leagues?api_key=private', 400],
    ['/leagues/l_123AbC/matches?status=all&status=played', 400],
    ['/leagues/l_123AbC/matches?season=2026%2F%2F2027', 400],
    ['/leagues/l_123AbC/matches?season=', 400],
    ['/leagues/l_123AbC/matches?status=finished', 400],
    ['/matches/m_123AbC/heatmaps?frame=invalid', 400],
    ['/matches/m_123AbC/shots?frame=home_ltr', 400],
    ['/date/2026-02-30', 400], ['/date/2026-13-01', 400],
    ['/teams/t_123AbC?page=2', 400],
  ];
  for (const [resource, status] of invalid) {
    const response = await handle(request(resource), env);
    assert.equal(response.status, status, resource);
    assert.equal((await response.json()).ok, false);
  }
  const post = await handle(request('/leagues', { method: 'POST' }), env);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET');
  assert.equal(calls, 0);
});

test('upstream errors preserve useful availability codes without returning upstream messages or headers', async () => {
  const cases = [
    { status: 401, expected: 502, code: 'PITCHAPI_AUTH_FAILED', data: { error: { message: fixtureKey } } },
    { status: 403, expected: 502, code: 'PITCHAPI_AUTH_FAILED', data: { error: { message: 'provider-secret' } } },
    { status: 404, expected: 404, code: 'ANALYTICS_UNAVAILABLE', data: { error: { code: 'ANALYTICS_UNAVAILABLE', message: 'provider-secret' } } },
    { status: 404, expected: 404, code: 'HALVES_UNAVAILABLE', data: { error: { code: 'HALVES_UNAVAILABLE', message: 'provider-secret' } } },
    { status: 404, expected: 404, code: 'RESOURCE_NOT_FOUND', data: { error: { code: 'untrusted-code', message: 'provider-secret' } } },
    { status: 400, expected: 400, code: 'INVALID_PARAMETER', data: { error: { message: 'provider-secret' } } },
    { status: 500, expected: 502, code: 'PITCHAPI_UNAVAILABLE', data: { error: { message: fixtureKey } } },
    { status: 200, expected: 502, code: 'PITCHAPI_INVALID_RESPONSE', data: { data: { unexpected: fixtureKey } } },
    { status: 200, expected: 502, code: 'PITCHAPI_INVALID_RESPONSE', data: { error: { message: 'provider-secret' } } },
  ];
  for (const entry of cases) {
    const handle = createPitchApiHandler({ fetcher: async () => upstreamJson(entry.data, { status: entry.status }) });
    const result = await handle(request('/matches/m_123AbC/advanced'), env);
    const body = await result.text();
    assert.equal(result.status, entry.expected);
    assert.equal(JSON.parse(body).error.code, entry.code);
    assert.equal(body.includes(fixtureKey), false);
    assert.equal(body.includes('provider-secret'), false);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
  }
});

test('rate limits expose a safe Retry-After and are not cached', async () => {
  let calls = 0;
  const handle = createPitchApiHandler({ fetcher: async () => {
    calls++;
    return upstreamJson({ error: { message: fixtureKey } }, { status: 429, headers: { 'Retry-After': '17' } });
  } });
  for (let index = 0; index < 2; index++) {
    const result = await handle(request('/leagues'), env);
    assert.equal(result.status, 429);
    assert.equal(result.headers.get('Retry-After'), '17');
    assert.deepEqual((await result.json()).error.retryAfter, 17);
  }
  assert.equal(calls, 2);
});

test('successful public data is cached, expires, and cannot bypass missing server configuration', async () => {
  let clock = Date.parse('2026-10-31T12:00:00Z');
  let calls = 0;
  const handle = createPitchApiHandler({ now: () => clock, fetcher: async () => upstreamJson({ data: { revision: ++calls } }) });
  const first = await handle(request('/leagues/l_123AbC/matches?status=all&season=2026'), env);
  assert.equal(first.headers.get('X-PitchAPI-Cache'), 'MISS');
  assert.deepEqual(await first.json(), { data: { revision: 1 } });
  const cached = await handle(request('/leagues/l_123AbC/matches?season=2026&status=all'), env);
  assert.equal(cached.headers.get('X-PitchAPI-Cache'), 'HIT');
  assert.deepEqual(await cached.json(), { data: { revision: 1 } });
  const unconfigured = await handle(request('/leagues/l_123AbC/matches?season=2026&status=all'));
  assert.equal(unconfigured.status, 503);
  assert.equal(calls, 1);
  clock += 181000;
  const refreshed = await handle(request('/leagues/l_123AbC/matches?season=2026&status=all'), env);
  assert.deepEqual(await refreshed.json(), { data: { revision: 2 } });
});

test('the local cache evicts entries and declines responses beyond its byte budget', async () => {
  let calls = 0;
  const handle = createPitchApiHandler({ cache: createMemoryCache({ maxEntries: 2 }), fetcher: async () => upstreamJson({ data: { revision: ++calls } }) });
  for (const resource of ['/leagues', '/teams/t_123AbC', '/players/p_123AbC', '/leagues']) {
    assert.equal((await handle(request(resource), env)).status, 200);
  }
  assert.equal(calls, 4);
  const tinyCacheHandle = createPitchApiHandler({ cache: createMemoryCache({ maxBytes: 8 }), fetcher: async () => upstreamJson({ data: { revision: ++calls } }) });
  await tinyCacheHandle(request('/leagues'), env);
  await tinyCacheHandle(request('/leagues'), env);
  assert.equal(calls, 6);
});

test('concurrent requests for the same resource share one provider request', async () => {
  let calls = 0;
  let finish;
  const result = new Promise(resolve => { finish = resolve; });
  const handle = createPitchApiHandler({ fetcher: async () => { calls++; return result; } });
  const first = handle(request('/leagues'), env);
  const second = handle(request('/leagues'), env);
  await new Promise(resolve => setImmediate(resolve));
  finish(upstreamJson({ data: { leagues: [] } }));
  const responses = await Promise.all([first, second]);
  assert.equal(calls, 1);
  for (const response of responses) assert.deepEqual(await response.json(), { data: { leagues: [] } });
});

test('the gateway bounds concurrent provider calls and signals when clients should retry', async () => {
  const finish = [];
  const handle = createPitchApiHandler({ fetcher: () => new Promise(resolve => finish.push(resolve)) });
  const pending = Array.from({ length: 8 }, (_, index) => handle(request(`/teams/t_${String(index).padStart(6, '0')}`), env));
  await new Promise(resolve => setImmediate(resolve));
  const busy = await handle(request('/teams/t_999999'), env);
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get('Retry-After'), '1');
  assert.equal((await busy.json()).error.code, 'GATEWAY_BUSY');
  assert.equal(finish.length, 8);
  for (const resolve of finish) resolve(upstreamJson({ data: {} }));
  for (const response of await Promise.all(pending)) assert.equal(response.status, 200);
});

test('network failures and oversized provider bodies fail without leaking exception text', async () => {
  const failing = createPitchApiHandler({ fetcher: async () => { throw new Error(`Request included ${fixtureKey}`); } });
  const failure = await failing(request('/leagues'), env);
  assert.equal(failure.status, 502);
  assert.equal((await failure.text()).includes(fixtureKey), false);
  const oversized = createPitchApiHandler({ fetcher: async () => upstreamJson({ data: [] }, { headers: { 'Content-Length': String(5 * 1024 * 1024) } }) });
  const limited = await oversized(request('/leagues'), env);
  assert.equal(limited.status, 502);
  assert.equal((await limited.json()).error.code, 'PITCHAPI_INVALID_RESPONSE');
});

test('the Worker routes APIs before its static asset allowlist', async () => {
  const status = await worker.fetch(new Request('https://orion.example/api/status'), {});
  assert.equal(status.status, 200);
  assert.equal((await status.json()).configured, false);
  assert.equal((await worker.fetch(new Request('https://orion.example/api/pitchapi/leagues'), {})).status, 503);
  for (const pathname of ['/.env', '/worker/pitchapi.js', '/server/index.js', '/.openai/hosting.json', '/data/private.json']) {
    assert.equal((await worker.fetch(new Request(`https://orion.example${pathname}`), {})).status, 404);
  }
});

test('the local server serves the same API contract with managed-preview CLI arguments', { timeout: 15000 }, async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'orion-api-server-'));
  let child;
  try {
    await mkdir(path.join(directory, 'dashboard'));
    await mkdir(path.join(directory, 'worker'));
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(directory, 'dashboard/index.html'), '<!doctype html><title>Fixture</title>');
    await copyFile(path.join(root, 'dashboard/server.js'), path.join(directory, 'dashboard/server.js'));
    await copyFile(path.join(root, 'worker/pitchapi.js'), path.join(directory, 'worker/pitchapi.js'));
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    child = spawn(process.execPath, ['dashboard/server.js', '--host', '0.0.0.0', '--port', String(port)], {
      cwd: directory,
      env: { ...process.env, PORT: '8765', PITCHAPI_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local API fixture did not start')), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Local API fixture exited: ${code}`)); });
      child.stdout.on('data', chunk => {
        if (chunk.toString().includes(`http://127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
      });
    });
    const status = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).configured, false);
    const unavailable = await fetch(`http://127.0.0.1:${port}/api/pitchapi/leagues`);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, 'PITCHAPI_NOT_CONFIGURED');
    const post = await fetch(`http://127.0.0.1:${port}/api/pitchapi/leagues`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal((await post.json()).error.code, 'METHOD_NOT_ALLOWED');
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
