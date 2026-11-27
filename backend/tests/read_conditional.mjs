// Read API requests as a fresh process sends them, for the end-to-end tests of the five content-tagged reads
// (test_read_receipts_retired.py, FAILURE_MODES_OPTIMISATIONS.md GH137R.3): the production read role (vega_read) and the
// real handler, a handler of its own for each request, nothing kept between them.
//   node backend/tests/read_conditional.mjs <dsn> '<json [{"path": "/api/...", "etag": "W/\"…\"", "method": "HEAD"}]>'
// prints [{path, status, etag, cache, body, statements: [{sql, params, rows}]}]: `body` the parsed JSON of a GET's 200,
// `statements` every statement the request ran, its parameters and how many rows it returned. Needs
// npm ci --prefix backend/api.
import { createReader } from "../api/src/db.mjs";
import { createHandler } from "../api/src/handler.mjs";

const [dsn, requests] = process.argv.slice(2);
const target = new URL(dsn);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/vega_v2_[a-z0-9_]+$/.test(target.pathname))
  throw new Error("a local vega_v2_* test base only");
const reader = createReader(dsn, { role: "vega_read" });
const out = [];
try {
  for (const { path, etag, method = "GET" } of JSON.parse(requests)) {
    const statements = [];
    const read = async (sql, params) => {
      const rows = await reader.read(sql, params);
      statements.push({ sql, params: params ?? [], rows: rows.length });
      return rows;
    };
    const handle = createHandler({ read, mediaBase: "https://media.test/", clock: () => Date.parse("2025-09-06T12:00:00Z") });
    const response = await handle(new Request("https://api.test" + path, { method, headers: etag ? { "if-none-match": etag } : {} }));
    const text = await response.text();
    out.push({
      path, status: response.status, etag: response.headers.get("etag"), cache: response.headers.get("cache-control"),
      body: response.status === 200 && method === "GET" && text ? JSON.parse(text) : null, statements,
    });
  }
} finally {
  await reader.end();
}
console.log(JSON.stringify(out));
