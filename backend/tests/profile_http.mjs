// The read API's profile route on a local test base, as the site reads it (the production read
// role, the real handler): node backend/tests/profile_http.mjs <dsn> <public player id>...
// prints {"<id>": {"status": <HTTP status>, "data": <the response's data or null>}}.
// Used by test_transfermarkt_history.py (FAILURE_MODES.md §20); needs npm ci --prefix backend/api.
import { createReader } from "../api/src/db.mjs";
import { createHandler } from "../api/src/handler.mjs";

const [dsn, ...ids] = process.argv.slice(2);
const target = new URL(dsn);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/vega_v2_[a-z0-9_]+$/.test(target.pathname))
  throw new Error("a local vega_v2_* test base only");
const reader = createReader(dsn, { role: "vega_read" });
const handle = createHandler({ read: reader.read, mediaBase: "https://media.test/", clock: () => Date.now() });
const out = {};
try {
  for (const id of ids) {
    const response = await handle(new Request(`https://api.test/api/players/${encodeURIComponent(id)}`));
    const text = await response.text();
    out[id] = { status: response.status, data: response.status === 200 ? JSON.parse(text).data : null };
  }
} finally {
  await reader.end();
}
console.log(JSON.stringify(out));
