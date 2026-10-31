/** Local, dependency-free server for the dashboard and two source snapshots. */
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
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
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const requestedPort = Number(process.env.PORT);
const port = Number.isInteger(requestedPort) && requestedPort >= 1 && requestedPort <= 65535 ? requestedPort : 8765;

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
  if (request.method !== 'GET' && !head) {
    response.setHeader('Allow', 'GET, HEAD');
    reply(response, 405, 'Method not allowed');
    return;
  }

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
    const fileStat = await stat(resolvedFile);
    if (!fileStat.isFile()) {
      reply(response, 404, 'Not found', head);
      return;
    }
    const content = await readFile(resolvedFile);
    response.writeHead(200, {
      'Content-Type': mimeTypes[extension],
      'Content-Length': content.length,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    response.end(head ? undefined : content);
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

server.listen(port, '127.0.0.1', () => {
  console.log(`Dashboard: http://127.0.0.1:${port}`);
});
