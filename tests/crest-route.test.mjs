// The crest route (FAILURE_MODES § 64, R25): an image copy's address only, kept a year.
import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../dashboard/frontend/app/api/crest/[...path]/route.js";

const HASH = "a".repeat(64);
const call = (file) =>
  GET(new Request("http://site/api/crest/" + file), { params: Promise.resolve({ path: file.split("/") }) });
const COPY = "data/sources/v2/images/";

test("R25 the crest route serves an image copy's address only, immutable", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    asked.push(String(url));
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  });
  for (const bad of [
    "../secret",
    `${COPY}${HASH}.svg`,
    `${COPY}${HASH.slice(41)}.png`,
    `${COPY}${HASH}.png?x=1`,
    "",
    `${COPY}${HASH.toUpperCase()}.png`,
    `api/read/home`,
    `data/sources/../${HASH}.png`,
    `${HASH}.png`,
  ]) {
    const response = await call(bad);
    assert.equal(response.status, 404, bad);
  }
  assert.deepEqual(asked, []);
  const response = await call(`${COPY}${HASH}.webp`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.match(response.headers.get("cache-control"), /immutable/);
  assert.deepEqual(asked, [`https://dngp6kh9jx2bl.cloudfront.net/data/sources/v2/images/${HASH}.webp`]);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
});
