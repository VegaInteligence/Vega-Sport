import { pathToFileURL } from "node:url";

const [backend, target, path, baseline] = process.argv.slice(2);
const dsn = new URL(target);
if (dsn.hostname !== "127.0.0.1" || !/^\/vega_v2_tm_[0-9a-f]+$/.test(dsn.pathname))
  throw new Error("dedicated loopback vega_v2_tm database required");
const { createReader } = await import(pathToFileURL(backend + "/api/src/db.mjs"));
const { createHandler } = await import(pathToFileURL(backend + "/api/src/handler.mjs"));
const reader = createReader(target, { role: "vega_read" });
const handle = createHandler({ read: reader.read, mediaBase: "https://audit.invalid/" });
const outgoing = {};
try {
  for (const [label, headers] of [["get", {}], ["conditional", {"if-none-match": baseline} ]]) {
    if (label === "conditional" && !baseline) continue;
    const response = await handle(new Request("https://audit.invalid" + path, { headers }));
    const text = await response.text();
    outgoing[label] = {status: response.status, etag: response.headers.get("etag"),
      body: text ? JSON.parse(text) : null};
  }
} finally {
  await reader.end();
}
console.log(JSON.stringify(outgoing));
