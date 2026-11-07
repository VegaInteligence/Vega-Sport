import test from "node:test";
import assert from "node:assert/strict";
import {
  mediaSidecar,
  withResolvedMedia,
} from "../dashboard/backend/services/resolved-media.js";
const base = "https://d2clu0phovomb8.cloudfront.net";
const source = "https://cdn.pitchapi.dev/images/player.webp";
const hash = "a".repeat(64);
const row = {
  url: source,
  path: `raw/neon/assets/${hash}.webp`,
  content_type: "image/webp",
};
const payload = {
  data: {
    player: { imageUrl: source },
    arbitrary: "https://not-an-image.invalid",
  },
  meta: { generation: "4" },
};
const request = (method = "GET", tag = "") =>
  new Request("https://api.example/api/read/home?season=2026&media=1", {
    method,
    headers: tag ? { "if-none-match": tag } : {},
  });
test("sidecar uses one bounded lookup and accepts only matching immutable assets", async () => {
  let calls = 0;
  const map = await mediaSidecar(
    payload,
    async (sql, values) => {
      calls++;
      assert.deepEqual(values, [[source]]);
      return [
        row,
        { ...row, url: "unknown" },
        { ...row, path: "raw/nope.png" },
      ];
    },
    base,
  );
  assert.equal(calls, 1);
  assert.equal(map[source], `${base}/data/${row.path}`);
  assert.equal(Object.keys(map).length, 1);
});
test("representation ETag tracks media changes and HEAD and conditional GET match", async () => {
  let asset = row,
    requestMethod,
    clock = 0,
    originTag = 'W/"generation-minute-1"';
  const invoke = async (req) => {
    requestMethod = req.method;
    assert.equal(new URL(req.url).searchParams.has("media"), false);
    assert.equal(req.headers.has("if-none-match"), false);
    return Response.json(
      { ...payload, now: clock++ },
      {
        headers: {
          ETag: originTag,
          "Cache-Control": "public, max-age=0, s-maxage=30, must-revalidate",
        },
      },
    );
  };
  const read = async () => [asset];
  const first = await withResolvedMedia(request(), invoke, read, base),
    data = await first.json(),
    tag = first.headers.get("etag");
  assert.equal(data.data.player.imageUrl, source);
  assert.equal(data.media[source], `${base}/data/${row.path}`);
  assert.match(first.headers.get("cache-control"), /s-maxage=30/);
  const head = await withResolvedMedia(request("HEAD"), invoke, read, base);
  assert.equal(requestMethod, "GET");
  assert.equal(head.headers.get("etag"), tag);
  assert.equal(await head.text(), "");
  assert.equal(
    (await withResolvedMedia(request("GET", tag), invoke, read, base)).status,
    304,
  );
  originTag = 'W/"generation-minute-2"';
  assert.equal(
    (await withResolvedMedia(request("GET", tag), invoke, read, base)).status,
    200,
  );
  originTag = 'W/"generation-minute-1"';
  asset = { ...row, path: `raw/neon/assets/${"b".repeat(64)}.webp` };
  const changed = await withResolvedMedia(
    request("GET", tag),
    invoke,
    read,
    base,
  );
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("etag"), tag);
});
test("does not intercept mutation or unrelated routes", async () => {
  assert.equal(
    await withResolvedMedia(
      new Request("https://x/api/read/home?media=1", { method: "POST" }),
      () => {},
      () => {},
      base,
    ),
    null,
  );
  assert.equal(
    await withResolvedMedia(
      new Request("https://x/api/fixtures?media=1"),
      () => {},
      () => {},
      base,
    ),
    null,
  );
});
