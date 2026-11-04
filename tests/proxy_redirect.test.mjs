import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const server = createServer((_request, response) => {
  response.writeHead(307, {
    Location: "https://d123.cloudfront.net/data/a",
    "Cache-Control": "private, no-store",
  });
  response.end();
});
let proxy;
before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.ORION_API_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  delete process.env.ORION_EMBEDDED_API;
  delete process.env.VERCEL;
  ({ proxy } = await import("../dashboard/frontend/src/server/bun-proxy.js"));
});
after(() => new Promise((resolve) => server.close(resolve)));
test("local transport preserves CloudFront redirects", async () => {
  const result = await proxy(new Request("http://localhost/data/file.json"));
  assert.equal(result.status, 307);
  assert.equal(
    result.headers.get("location"),
    "https://d123.cloudfront.net/data/a",
  );
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});
