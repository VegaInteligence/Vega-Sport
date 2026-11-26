// The read API as the site reads it, locally, for the browser tests (FAILURE_MODES_OPTIMISATIONS.md GH129): the real
// handler (backend/api) on a local vega_v2_* base under the production read role, over HTTP, with the distribution's
// CORS headers (api.yaml ViewerHeaders) and a delay before each answer: every read `--delay` ms, a path (with its query)
// matching one of `--slow <regex>=<ms>` that long (the « delayed identity » of the player page; a player's every read). Each request is logged as a JSON line:
// its path, query keys, start and end (ms since the server started), status.
//
//   node tests/e2e/support/read-api-server.mjs <dsn> <port> [--delay 120] [--slow '^/api/players/p_[^/]+$=600'] [--log <file>]
import http from "node:http";
import { appendFileSync } from "node:fs";
import { createReader } from "../../../backend/api/src/db.mjs";
import { createHandler } from "../../../backend/api/src/handler.mjs";

const [dsn, port, ...rest] = process.argv.slice(2);
const target = new URL(dsn);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/vega_v2_[a-z0-9_]+$/.test(target.pathname))
  throw new Error("a local vega_v2_* base only");
let delay = 0, log = null;
const slow = [];
for (let i = 0; i < rest.length; i += 2) {
  if (rest[i] === "--delay") delay = Number(rest[i + 1]);
  else if (rest[i] === "--slow") {
    const [pattern, ms] = rest[i + 1].split(/=(?=\d+$)/);
    slow.push([new RegExp(pattern), Number(ms)]);
  } else if (rest[i] === "--log") log = rest[i + 1];
}
const reader = createReader(dsn, { role: "vega_read" });
const handle = createHandler({ read: reader.read, mediaBase: null });
const started = performance.now();
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-expose-headers": "ETag, Content-Length, Cache-Control, Age, X-Cache, X-Data-Source, Server-Timing, Retry-After",
};
const server = http.createServer(async (req, res) => {
  const begin = performance.now() - started;
  const url = new URL(req.url, "http://local");
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  // A pattern meets the path and its query (a player named in either: GH129-j).
  const wait = slow.find(([pattern]) => pattern.test(url.pathname + url.search))?.[1] ?? delay;
  await new Promise((done) => setTimeout(done, wait));
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => ["if-none-match", "accept"].includes(name)));
  const response = await handle(new Request("https://api.local" + url.pathname + url.search, { method: req.method, headers }));
  const body = Buffer.from(await response.arrayBuffer());
  const out = Object.fromEntries([...response.headers].filter(([name]) => !["content-encoding", "content-length"].includes(name)));
  res.writeHead(response.status, { ...out, ...CORS, "content-length": body.length });
  res.end(body);
  if (log)
    appendFileSync(log, JSON.stringify({ path: url.pathname, query: [...url.searchParams.keys()], start: Math.round(begin), end: Math.round(performance.now() - started), status: response.status }) + "\n");
});
server.listen(Number(port), "127.0.0.1", () => console.log(`read API on http://127.0.0.1:${port}`));
const stop = async () => {
  server.close();
  await reader.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
