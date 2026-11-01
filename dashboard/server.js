/** Local dashboard, protected source snapshots and the server-only PitchAPI gateway. */
import http from 'node:http';
import { open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dashboardRoot = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.resolve(dashboardRoot, '../data');
const rawFiles = new Set(['pitchapi_championnats.json', 'pitchapi_premiers_matchs.json']);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gz': 'application/gzip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const cli = process.argv.slice(2);
function argument(name) {
  const inline = cli.find(value => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = cli.indexOf(name);
  return index >= 0 ? cli[index + 1] : undefined;
}
const requestedPort = Number(argument('--port') ?? process.env.PORT);
const port = Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 65535 ? requestedPort : 8765;
// The managed preview explicitly supplies --host 0.0.0.0. Local use stays local.
const requestedHost = argument('--host');
const host = requestedHost === '0.0.0.0' ? requestedHost : '127.0.0.1';
let gateway;
let localEnvironment;

async function getLocalEnvironment() {
  if (!localEnvironment) {
    localEnvironment = (async () => {
      if (process.env.PITCHAPI_API_KEY) return { PITCHAPI_API_KEY: process.env.PITCHAPI_API_KEY };
      try {
        const file = await readFile(path.resolve(dashboardRoot, '../.env'), 'utf8');
        const match = file.match(/^\s*PITCHAPI_API_KEY\s*=\s*(.*?)\s*$/m);
        if (match) return { PITCHAPI_API_KEY: match[1].replace(/^(['"])(.*)\1$/, '$2') };
      } catch { /* Local credentials are optional; the snapshot remains usable. */ }
      return {};
    })();
  }
  return localEnvironment;
}

async function serveApi(request, response) {
  // Lazy loading keeps the standalone static server portable for existing tooling.
  gateway ||= import('../worker/pitchapi.js');
  const [{ handlePitchApi }, env] = await Promise.all([gateway, getLocalEnvironment()]);
  const result = await handlePitchApi(new Request(`http://127.0.0.1:${port}${request.url}`, { method: request.method }), env);
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(request.method === 'HEAD' ? undefined : Buffer.from(await result.arrayBuffer()));
}

function reply(response, status, message, head = false) {
  const body = Buffer.from(message);
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  response.end(head ? undefined : body);
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function serve(request, response) {
  const head = request.method === 'HEAD';
  let pathname;
  try {
    // Validate before URL/path normalization can silently remove traversal.
    const rawPath = (request.url || '/').split(/[?#]/, 1)[0];
    pathname = decodeURIComponent(rawPath);
  } catch {
    reply(response, 400, 'Invalid path', head);
    return;
  }
  if (!pathname.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(pathname)) {
    reply(response, 400, 'Invalid path', head);
    return;
  }
  if (pathname.split('/').some(segment => segment.startsWith('.'))) {
    reply(response, 403, 'Forbidden', head);
    return;
  }

  const archiveProfile = pathname.match(/^\/api\/archive\/profiles\/(leagues|teams|players)\/([ltp]_[A-Za-z0-9]{6})$/);
  if (archiveProfile && (request.method === 'GET' || head)) {
    const [, kind, id] = archiveProfile;
    if (id[0] !== {leagues:'l',teams:'t',players:'p'}[kind]) { reply(response, 404, 'Not found', head); return; }
    for(const archiveName of ['europe_2026_2027','europe_2021_2026']) try {
      const archiveRoot = path.join(dataRoot, archiveName);
      const directory = path.join(archiveRoot, 'profiles', kind);
      const encoded = path.join(directory, `${id}--${Buffer.from(id,'utf8').toString('hex')}.json`);
      let resolvedFile;try{resolvedFile=await realpath(encoded)}catch{resolvedFile=await realpath(path.join(directory,`${id}.json`))}
      const resolvedRoot = await realpath(archiveRoot);
      if (!contained(resolvedRoot, resolvedFile)) { reply(response, 403, 'Forbidden', head); return; }
      const profile = JSON.parse(await readFile(resolvedFile, 'utf8'));
      if (profile.status !== 200 || profile.data?.id !== id) continue;
      const body = Buffer.from(JSON.stringify(profile));
      response.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      response.end(head ? undefined : body);
      return;
    } catch { /* Try the next season archive. */ }
    reply(response, 404, 'Not found', head);
    return;
  }

  const archiveMatch = pathname.match(/^\/api\/archive\/matches\/(m_[A-Za-z0-9]{6})$/);
  if (archiveMatch && (request.method === 'GET' || head)) {
    for(const archiveName of ['europe_2026_2027','europe_2021_2026']) try {
      const archiveRoot = path.join(dataRoot, archiveName);
      let index;try{index=JSON.parse(await readFile(path.join(archiveRoot,'index.json'),'utf8'))}catch{}
      let entry = index?.matches?.find(item => item.match?.id === archiveMatch[1]);
      let folder = 'matches';
      if (!entry) {
        const inventory = JSON.parse(await readFile(path.join(archiveRoot, 'inventory.json'), 'utf8'));
        const competition = inventory.competitions.find(item => item.matches.some(match => match.id === archiveMatch[1]));
        const fixture=competition?.matches.find(match=>match.id===archiveMatch[1]);
        if (competition) { entry = {competition_id:competition.id}; folder = fixture.status==='finished'?'matches':'fixtures'; }
      }
      if (!entry || !/^l_[A-Za-z0-9]{6}$/.test(entry.competition_id)) continue;
      const id=archiveMatch[1],filename=archiveName==='europe_2021_2026'?`${id}--${Buffer.from(id,'utf8').toString('hex')}.json`:`${id}.json`;
      const archivePath = path.join(archiveRoot, folder, entry.competition_id, filename);
      const [resolvedRoot, resolvedFile] = await Promise.all([realpath(archiveRoot), realpath(archivePath)]);
      if (!contained(resolvedRoot, resolvedFile)) { reply(response, 403, 'Forbidden', head); return; }
      const record = JSON.parse(await readFile(resolvedFile, 'utf8'));
      if(record.fixture?.id && record.fixture.id!==id)continue;
      const mapping = {match:'match', shots:'shots', momentum:'momentum', events:'events', players:'players', 'players/halves':'player_halves', lineups:'lineups', h2h:'h2h', stats:'stats', advanced:'advanced_teams', 'advanced/players':'advanced_players', 'advanced/network':'pass_networks', heatmaps:'heatmaps'};
      const shard = {meta:{retrievedAt:record.retrieved_at_utc,source:'Archive PitchAPI locale'},availability:{}};
      for (const [name, key] of Object.entries(mapping)) {
        const item = record.endpoints?.[key];
        shard.availability[name] = {state:item?.status === 200 ? 'collected' : 'error',status:item?.status ?? null};
        if (item?.status === 200) shard[name] = {data:item.data,status:item.status};
      }
      const body = Buffer.from(JSON.stringify(shard));
      response.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      response.end(head ? undefined : body);
      return;
    } catch { /* Try the next season archive. */ }
    reply(response, 404, 'Not found', head);
    return;
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    await serveApi(request, response);
    return;
  }
  if (request.method !== 'GET' && !head) {
    response.setHeader('Allow', 'GET, HEAD');
    reply(response, 405, 'Method not allowed');
    return;
  }

  // Retain the former /dashboard/ entry points for existing bookmarks.
  if (pathname === '/dashboard') pathname = '/';
  else if (pathname.startsWith('/dashboard/')) pathname = pathname.slice('/dashboard'.length);
  if (pathname === '/') pathname = '/index.html';

  let root = dashboardRoot;
  let relativeFile = pathname.slice(1);
  if (pathname.startsWith('/data/') && rawFiles.has(pathname.slice('/data/'.length))) {
    root = dataRoot;
    relativeFile = pathname.slice('/data/'.length);
  }

  const extension = path.extname(relativeFile).toLowerCase();
  if (!mimeTypes[extension] || relativeFile === 'server.js') {
    reply(response, 403, 'Forbidden', head);
    return;
  }
  const candidate = path.resolve(root, relativeFile);
  if (!contained(root, candidate)) {
    reply(response, 403, 'Forbidden', head);
    return;
  }

  try {
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(root), realpath(candidate)]);
    // An asset symlink cannot expose files outside its allowed root.
    const resolvedRelative = path.relative(resolvedRoot, resolvedFile);
    if (!contained(resolvedRoot, resolvedFile) || resolvedRelative.split(path.sep).some(segment => segment.startsWith('.')) || resolvedRelative === 'server.js') {
      reply(response, 403, 'Forbidden', head);
      return;
    }
    // Keep the same file open for the stat and stream, even if a refresh
    // replaces the snapshot while a browser is reading it.
    const handle = await open(resolvedFile, 'r');
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) {
      await handle.close();
      reply(response, 404, 'Not found', head);
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[extension],
      'Content-Length': fileStat.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    if (head) { await handle.close(); response.end(); }
    else {
      const stream = handle.createReadStream();
      stream.once('error', () => response.destroy());
      response.once('close', () => { if (!response.writableFinished) stream.destroy(); });
      stream.pipe(response);
    }
  } catch (error) {
    const absent = error.code === 'ENOENT' || error.code === 'ENOTDIR';
    reply(response, absent ? 404 : 500, absent ? 'Not found' : 'Unable to read asset', head);
  }
}

const server = http.createServer((request, response) => {
  serve(request, response).catch(() => {
    if (!response.headersSent) reply(response, 500, 'Unable to serve request');
    else response.destroy();
  });
});

server.on('error', error => {
  console.error(`Dashboard server: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Dashboard: http://127.0.0.1:${port}`);
});
