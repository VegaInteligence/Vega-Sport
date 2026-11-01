import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function availablePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

function request(port, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    // Send the literal path; fetch/URL normalize dot segments themselves.
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('local server preserves dashboard routes while isolating source snapshots and secrets', { timeout: 15000 }, async t => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'orion-dashboard-server-'));
  let child;
  try {
    await mkdir(path.join(fixture, 'data/staging/dashboard'), { recursive: true });
    await mkdir(path.join(fixture, 'dashboard'), { recursive: true });
    await mkdir(path.join(fixture, 'data/sources/pitchapi/samples'), {recursive:true});
    await writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
    await copyFile(path.join(repositoryRoot, 'dashboard/server.js'), path.join(fixture, 'dashboard/server.js'));
    await writeFile(path.join(fixture, 'dashboard/index.html'), '<!doctype html><title>Orion test</title>');
    await writeFile(path.join(fixture, 'dashboard/app.js'), 'export const fixture = "dashboard-app";');
    await writeFile(path.join(fixture, 'dashboard/styles.css'), ':root { color: green; }');
    await writeFile(path.join(fixture, 'dashboard/favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(path.join(fixture, 'data/staging/dashboard/football.json'), '{"generated":true}');
    await writeFile(path.join(fixture, 'data/sources/pitchapi/samples/pitchapi_championnats.json'), '{"catalog":true}');
    await writeFile(path.join(fixture, 'data/sources/pitchapi/samples/pitchapi_premiers_matchs.json'), '{"matches":true}');
    await writeFile(path.join(fixture, 'data/private.json'), '{"private":"must-not-leak"}');
    const archive = path.join(fixture, 'data/sources/pitchapi/archives/europe_2026_2027');
    await mkdir(path.join(archive, 'matches/l_000001'), {recursive:true});
    await mkdir(path.join(archive, 'fixtures/l_000001'), {recursive:true});
    await mkdir(path.join(archive, 'profiles/players'), {recursive:true});
    await writeFile(path.join(archive, 'index.json'), JSON.stringify({matches:[{competition_id:'l_000001',match:{id:'m_000001'}}]}));
    await writeFile(path.join(archive, 'inventory.json'), JSON.stringify({competitions:[{id:'l_000001',matches:[{id:'m_000003',status:'not_started'}]}]}));
    await writeFile(path.join(archive, 'matches/l_000001/m_000001.json'), JSON.stringify({retrieved_at_utc:'2026-11-01T00:00:00Z',endpoints:{players:{status:200,data:[{player:{id:'p_000001'}}]},shots:{status:404,data:null}}}));
    await writeFile(path.join(archive, 'fixtures/l_000001/m_000003.json'), JSON.stringify({retrieved_at_utc:'2026-11-01T00:00:00Z',endpoints:{lineups:{status:200,data:{home:{confirmed:false}}}}}));
    const history = path.join(fixture, 'data/sources/pitchapi/archives/europe_2021_2026');
    await mkdir(path.join(history, 'matches/l_000001'), {recursive:true});
    await mkdir(path.join(history, 'profiles/players'), {recursive:true});
    await writeFile(path.join(history, 'index.json'), JSON.stringify({matches:[{competition_id:'l_000001',match:{id:'m_10VVHs'}},{competition_id:'l_000001',match:{id:'m_10vvHS'}}]}));
    for(const id of ['m_10VVHs','m_10vvHS']) await writeFile(path.join(history,'matches/l_000001',`${id}--${Buffer.from(id).toString('hex')}.json`), JSON.stringify({fixture:{id},endpoints:{match:{status:200,data:{id}}}}));
    const profileFile = id => `${id}--${Buffer.from(id,'utf8').toString('hex')}.json`;
    await writeFile(path.join(archive, 'profiles/players', profileFile('p_000001')), JSON.stringify({status:200,data:{id:'p_000001',name:'Player'}}));
    await writeFile(path.join(archive, 'profiles/players', profileFile('p_10VVHs')), JSON.stringify({status:200,data:{id:'p_10VVHs',name:'First'}}));
    await writeFile(path.join(archive, 'profiles/players', profileFile('p_10vvHS')), JSON.stringify({status:200,data:{id:'p_10vvHS',name:'Second'}}));
    await writeFile(path.join(history, 'profiles/players', profileFile('p_000002')), JSON.stringify({status:200,data:{id:'p_000002',name:'Historical'}}));
    await writeFile(path.join(fixture, '.env'), 'SECRET=must-not-leak');
    await writeFile(path.join(fixture, 'dashboard/.env'), 'SECRET=must-not-leak');
    let symlinksAvailable = true;
    try {
      await symlink(path.join(fixture, '.env'), path.join(fixture, 'data/staging/dashboard/escape.json'));
      await symlink(path.join(fixture, 'dashboard/.env'), path.join(fixture, 'data/staging/dashboard/hidden-alias.json'));
    } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP'].includes(error.code)) throw error;
      symlinksAvailable = false;
      t.diagnostic(`Symlink cases unavailable on this platform (${error.code}); all other route checks remain active.`);
    }

    const port = await availablePort();
    child = spawn(process.execPath, [path.join(fixture, 'dashboard/server.js')], {
      cwd: fixture,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stderr.on('data', chunk => { output += chunk; });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 5000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited (${code}): ${output}`)); });
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes(`http://127.0.0.1:${port}`)) { clearTimeout(timeout); resolve(); }
      });
    });

    await t.test('root and legacy entry points serve the dashboard HTML', async () => {
      for (const route of ['/', '/index.html', '/dashboard', '/dashboard/', '/dashboard/index.html']) {
        const result = await request(port, route);
        assert.equal(result.status, 200, route);
        assert.match(result.headers['content-type'], /^text\/html/);
        assert.match(result.body, /<title>Orion test<\/title>/);
      }
    });

    await t.test('root and legacy assets have browser-compatible MIME types', async () => {
      for (const route of ['/app.js', '/dashboard/app.js', '/app.js?v=1']) {
        const result = await request(port, route);
        assert.equal(result.status, 200, route);
        assert.match(result.headers['content-type'], /^text\/javascript/);
        assert.match(result.body, /dashboard-app/);
      }
      assert.match((await request(port, '/styles.css')).headers['content-type'], /^text\/css/);
      assert.match((await request(port, '/favicon.svg')).headers['content-type'], /^image\/svg\+xml/);
      const head = await request(port, '/app.js', 'HEAD');
      assert.equal(head.status, 200);
      assert.equal(head.body, '');
      assert.ok(Number(head.headers['content-length']) > 0);
    });

    await t.test('generated data and exact raw aliases remain distinct', async () => {
      for (const route of ['/data/football.json', '/dashboard/data/football.json']) {
        const result = await request(port, route);
        assert.equal(result.status, 200);
        assert.match(result.headers['content-type'], /^application\/json/);
        assert.deepEqual(JSON.parse(result.body), { generated: true });
      }
      assert.deepEqual(JSON.parse((await request(port, '/data/pitchapi_championnats.json')).body), { catalog: true });
      assert.deepEqual(JSON.parse((await request(port, '/data/pitchapi_premiers_matchs.json')).body), { matches: true });
      const extraRaw = await request(port, '/data/private.json');
      assert.equal(extraRaw.status, 404);
      assert.doesNotMatch(extraRaw.body, /must-not-leak/);
    });

    await t.test('season archive returns collected fields and preserves unavailable endpoints', async () => {
      const result = await request(port, '/api/archive/matches/m_000001');
      assert.equal(result.status, 200);
      const shard = JSON.parse(result.body);
      assert.equal(shard.players.data[0].player.id, 'p_000001');
      assert.equal(shard.availability.shots.status, 404);
      assert.equal(shard.availability.shots.state, 'error');
      const future = JSON.parse((await request(port, '/api/archive/matches/m_000003')).body);
      assert.equal(future.lineups.data.home.confirmed, false);
      assert.equal(JSON.parse((await request(port, '/api/archive/profiles/players/p_000001')).body).data.name, 'Player');
      assert.equal(JSON.parse((await request(port, '/api/archive/profiles/players/p_10VVHs')).body).data.name, 'First');
      assert.equal(JSON.parse((await request(port, '/api/archive/profiles/players/p_10vvHS')).body).data.name, 'Second');
      assert.equal(JSON.parse((await request(port, '/api/archive/profiles/players/p_000002')).body).data.name, 'Historical');
      for(const id of ['m_10VVHs','m_10vvHS']) assert.equal(JSON.parse((await request(port, `/api/archive/matches/${id}`)).body).match.data.id,id);
      assert.equal((await request(port, '/api/archive/profiles/teams/p_000001')).status, 404);
      assert.equal((await request(port, '/api/archive/matches/m_000002')).status, 404);
      assert.equal((await request(port, '/api/archive/matches/../../.env')).status, 403);
    });

    await t.test('literal and encoded traversal, dotfiles and symlink escapes are denied', async () => {
      const routes = ['/../.env', '/dashboard/../.env', '/%2e%2e/.env', '/dashboard/%2e%2e%2f.env', '/.env', '/dashboard/.env', '/server.js'];
      if (symlinksAvailable) routes.push('/data/escape.json', '/data/hidden-alias.json');
      for (const route of routes) {
        const result = await request(port, route);
        assert.equal(result.status, 403, route);
        assert.doesNotMatch(result.body, /must-not-leak/);
      }
      assert.equal((await request(port, '/dashboard/%5c..%5c.env')).status, 400);
      assert.equal((await request(port, '/%')).status, 400);
      assert.equal((await request(port, '/%00')).status, 400);
    });

    await t.test('unsupported methods and absent public assets fail cleanly', async () => {
      const post = await request(port, '/app.js', 'POST');
      assert.equal(post.status, 405);
      assert.equal(post.headers.allow, 'GET, HEAD');
      assert.equal((await request(port, '/missing.js')).status, 404);
      assert.equal((await request(port, '/app.js')).headers['x-content-type-options'], 'nosniff');
    });
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(fixture, { recursive: true, force: true });
  }
});
