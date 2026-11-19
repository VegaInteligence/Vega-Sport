// Read API routes on a local test base as the site reads them: the production read role (vega_read) and the real
// handler. node backend/tests/read_http.mjs <dsn> '<json [{"path": "/api/...", "etag": "W/\"…\""}]>'
// prints [{path, status, etag, body, conditional}]: `conditional` is the status of the same request sent again with
// If-None-Match (the given etag, else the response's own). Needs npm ci --prefix backend/api.
import { createReader } from "../api/src/db.mjs";
import { createHandler } from "../api/src/handler.mjs";

const [dsn, requests] = process.argv.slice(2);
const target = new URL(dsn);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/vega_v2_[a-z0-9_]+$/.test(target.pathname))
  throw new Error("a local vega_v2_* test base only");
const reader = createReader(dsn, { role: "vega_read" });
const handle = createHandler({ read: reader.read, mediaBase: "https://media.test/", clock: () => Date.now() });
const out = [];
try {
  for (const { path, etag } of JSON.parse(requests)) {
    const url = `https://api.test${path}`;
    const response = await handle(new Request(url));
    const text = await response.text();
    const own = response.headers.get("etag");
    const again = await handle(new Request(url, { headers: { "If-None-Match": etag || own || "" } }));
    await again.text();
    out.push({ path, status: response.status, etag: own, body: text ? JSON.parse(text) : null, conditional: again.status });
  }
} finally {
  await reader.end();
}
console.log(JSON.stringify(out));
