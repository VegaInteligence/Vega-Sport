import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { adapt } from "./transport.mjs";
const binary = gzipSync(Buffer.from("⚽ football data")),
  huge = Buffer.alloc(7 * 1024 * 1024, "x"),
  noise = randomBytes(5 * 1024 * 1024);
let calls = 0;
const serve = adapt(async (r) => {
  calls++;
  const u = new URL(r.url);
  if (u.pathname === "/query")
    return Response.json({ raw: u.search, pathname: u.pathname });
  if (u.pathname === "/redirect")
    return new Response(null, {
      status: 307,
      headers: { location: "/binary" },
    });
  if (u.pathname === "/throttle")
    return new Response("Too many requests", {
      status: 429,
      headers: { "retry-after": "2", "x-amzn-errortype": "TooManyRequestsException" },
    });
  if (r.headers.get("if-none-match") === '"123"')
    return new Response(null, { status: 304, headers: { etag: '"123"' } });
  const b =
    u.pathname === "/large" ? huge : u.pathname === "/noise" ? noise : binary;
  return new Response(r.method === "HEAD" ? null : b, {
    headers: {
      etag: '"123"',
      "content-type":
        u.pathname === "/large" ? "application/json" : "application/gzip",
      "content-length": String(b.length),
    },
  });
});
const http = createServer(async (req, res) => {
  const i = req.url.indexOf("?"),
    event = {
      version: "2.0",
      rawPath: i === -1 ? req.url : req.url.slice(0, i),
      rawQueryString: i === -1 ? "" : req.url.slice(i + 1),
      headers: req.headers,
      requestContext: { http: { method: req.method } },
    };
  const out = await serve(event);
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= 6 * 1024 * 1024);
  res.writeHead(out.statusCode, out.headers);
  res.end(Buffer.from(out.body ?? "", out.isBase64Encoded ? "base64" : "utf8"));
});
await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
const go = (path, method = "GET", headers = {}) =>
  new Promise((resolve, reject) => {
    const q = request(
      { port: http.address().port, host: "127.0.0.1", path, method, headers },
      (r) => {
        let chunks = [];
        r.on("data", (x) => chunks.push(x));
        r.on("end", () =>
          resolve({
            status: r.statusCode,
            headers: r.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    q.on("error", reject);
    q.end();
  });
const cases = [];
try {
  let r = await go("/query?x=%2F&x=a+b&name=%C3%A9");
  assert.equal(JSON.parse(r.body).raw, "?x=%2F&x=a+b&name=%C3%A9");
  cases.push("exact raw query");
  r = await go("/binary");
  assert.deepEqual(r.body, binary);
  assert.equal(r.headers["content-type"], "application/gzip");
  cases.push("gzip bytes");
  r = await go("/binary", "HEAD");
  assert.equal(r.body.length, 0);
  assert.equal(r.headers["content-length"], String(binary.length));
  cases.push("HEAD length");
  r = await go("/binary", "GET", { "if-none-match": '"123"' });
  assert.equal(r.status, 304);
  assert.equal(r.body.length, 0);
  assert.equal(r.headers.etag, '"123"');
  cases.push("conditional 304");
  r = await go("/redirect");
  assert.equal(r.status, 307);
  assert.equal(r.headers.location, "/binary");
  cases.push("307");
  r = await go("/throttle");
  assert.equal(r.status, 429);
  assert.equal(r.headers["retry-after"], "2");
  assert.equal(r.headers["cache-control"], "no-store");
  assert.match(r.headers["access-control-expose-headers"], /\bRetry-After\b/i);
  assert.match(r.headers["access-control-expose-headers"], /\bX-Amzn-ErrorType\b/i);
  cases.push("browser-readable throttle status and retry headers");
  const before = calls;
  r = await go("/query", "OPTIONS", {
    "access-control-request-method": "GET",
    origin: "https://example.test",
  });
  assert.equal(r.status, 204);
  assert.match(r.headers["access-control-allow-methods"], /GET/);
  cases.push("preflight without DB");
  for (const [path, method, status] of [
    ["/binary", "POST", 405],
    ["//other/path", "GET", 400],
    ["/%2e%2e/private", "GET", 400],
    ["/a%5cb", "GET", 400],
  ]) {
    assert.equal((await go(path, method)).status, status);
  }
  assert.equal(calls, before);
  assert.equal((await serve({})).statusCode, 400);
  cases.push("invalid requests rejected before application");
  r = await go("/large", "GET", { "accept-encoding": "gzip" });
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-encoding"], "gzip");
  assert.deepEqual(gunzipSync(r.body), huge);
  cases.push("7MiB negotiated JSON gzip");
  for (const [path, accept] of [
    ["/large", "gzip;q=0"],
    ["/noise", "gzip"],
  ]) {
    r = await go(path, "GET", { "accept-encoding": accept });
    assert.equal(r.status, 502);
    assert.equal(r.headers["cache-control"], "no-store");
  }
  cases.push("oversize denied, no truncation or forbidden compression");
  console.log(
    JSON.stringify(
      {
        result: "pass",
        command: "node infra/aws-backend/transport-e2e.mjs",
        node: process.version,
        cases,
        gzipSha256: createHash("sha256").update(binary).digest("hex"),
      },
      null,
      2,
    ),
  );
} finally {
  http.close();
}
