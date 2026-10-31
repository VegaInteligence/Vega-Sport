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
    await mkdir(path.join(fixture, 'dashboard/data'), { recursive: true });
    await mkdir(path.join(fixture, 'data'));
    await writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
    await copyFile(path.join(repositoryRoot, 'dashboard/server.js'), path.join(fixture, 'dashboard/server.js'));
    await writeFile(path.join(fixture, 'dashboard/index.html'), '<!doctype html><title>Orion test</title>');
    await writeFile(path.join(fixture, 'dashboard/app.js'), 'export const fixture = "dashboard-app";');
    await writeFile(path.join(fixture, 'dashboard/styles.css'), ':root { color: green; }');
    await writeFile(path.join(fixture, 'dashboard/favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await writeFile(path.join(fixture, 'dashboard/data/football.json'), '{"generated":true}');
    await writeFile(path.join(fixture, 'data/pitchapi_championnats.json'), '{"catalog":true}');
    await writeFile(path.join(fixture, 'data/pitchapi_premiers_matchs.json'), '{"matches":true}');
    await writeFile(path.join(fixture, 'data/private.json'), '{"private":"must-not-leak"}');
    await writeFile(path.join(fixture, '.env'), 'SECRET=must-not-leak');
    await writeFile(path.join(fixture, 'dashboard/.env'), 'SECRET=must-not-leak');
    let symlinksAvailable = true;
    try {
      await symlink(path.join(fixture, '.env'), path.join(fixture, 'dashboard/data/escape.json'));
      await symlink(path.join(fixture, 'dashboard/.env'), path.join(fixture, 'dashboard/data/hidden-alias.json'));
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
