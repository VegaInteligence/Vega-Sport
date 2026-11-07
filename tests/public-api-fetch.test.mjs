import test from "node:test";
import assert from "node:assert/strict";
import { createPublicApiTransport } from "../dashboard/frontend/src/services/public-api-fetch.js";
import { createResourceCache } from "../dashboard/frontend/src/services/resource-cache.js";
import { readCompactPages } from "../dashboard/frontend/src/services/compact-reads.js";
import { readPages } from "../dashboard/frontend/src/season_data.js";

const turn = () => new Promise((resolve) => setImmediate(resolve));
function pendingFetcher() {
  const started = [];
  const fetcher = (url, { signal } = {}) =>
    new Promise((resolve, reject) => {
      const item = { url, signal, finish: () => resolve(new Response("ok")) };
      signal?.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
      started.push(item);
    });
  return { fetcher, started };
}

test("one shared budget bounds API bursts and reserves capacity for interactive data", async () => {
  const transport = createPublicApiTransport(),
    { fetcher, started } = pendingFetcher();
  const jobs = ["i1", "i2", "i3", "i4", "d1", "d2", "d3"].map((name) =>
    transport.read(name, {}, fetcher, name.startsWith("i") ? "image" : "data"),
  );
  await turn();
  assert.deepEqual(
    started.map((x) => x.url),
    ["i1", "i2", "d1", "d2"],
  );
  assert.deepEqual(transport.pending(), { active: 4, images: 2, queued: 3 });
  started[0].finish();
  await turn();
  assert.equal(started[4].url, "d3", "data jumps ahead of queued crest reads");
  assert.equal(transport.pending().active, 4);
  for (let i = 1; i < jobs.length; i++) {
    started[i].finish();
    await turn();
    assert.ok(transport.pending().active <= 4);
    assert.ok(transport.pending().images <= 2);
  }
  await Promise.all(jobs);
  assert.deepEqual(transport.pending(), { active: 0, images: 0, queued: 0 });
});

test("abandoned queued reads never start and active abort returns the permit", async () => {
  const transport = createPublicApiTransport({
    concurrency: 1,
    imageConcurrency: 1,
  });
  const { fetcher, started } = pendingFetcher(),
    active = new AbortController(),
    queued = new AbortController();
  const first = transport.read("active", { signal: active.signal }, fetcher);
  const second = transport.read("queued", { signal: queued.signal }, fetcher);
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  const secondRejected = assert.rejects(second, { name: "AbortError" });
  await turn();
  queued.abort();
  active.abort();
  await Promise.all([firstRejected, secondRejected]);
  assert.deepEqual(
    started.map((x) => x.url),
    ["active"],
  );
  assert.deepEqual(transport.pending(), { active: 0, images: 0, queued: 0 });
  assert.equal(
    (await transport.read("retry", {}, async () => new Response("ok"))).status,
    200,
  );
});

test("a queued burst has a finite backlog and an overflow does not start fetch", async () => {
  const transport = createPublicApiTransport({
    concurrency: 1,
    imageConcurrency: 1,
    maxQueued: 1,
  });
  const { fetcher, started } = pendingFetcher();
  const one = transport.read("1", {}, fetcher),
    two = transport.read("2", {}, fetcher);
  await assert.rejects(transport.read("3", {}, fetcher), {
    code: "CLIENT_QUEUE_FULL",
  });
  await turn();
  started[0].finish();
  await turn();
  started[1].finish();
  await Promise.all([one, two]);
  assert.deepEqual(
    started.map((x) => x.url),
    ["1", "2"],
  );
});

test("429 retry is bounded, cancels rejected bodies and honors Retry-After", async () => {
  const waits = [],
    bodies = [],
    transport = createPublicApiTransport({
      random: () => 0,
      sleep: async (ms) => waits.push(ms),
    });
  let calls = 0;
  const response = await transport.read("/api/search", {}, async () => {
    calls++;
    return {
      status: 429,
      headers: new Headers({ "Retry-After": "1.5" }),
      body: { cancel: async () => bodies.push(calls) },
    };
  });
  assert.equal(response.status, 429);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1500, 1500]);
  assert.deepEqual(bodies, [1, 2]);
});

test("Retry-After HTTP dates are respected and longer waits are not shortened", async () => {
  const now = Date.UTC(2026, 10, 7, 8),
    waits = [];
  const transport = createPublicApiTransport({
    now: () => now,
    random: () => 0,
    sleep: async (ms) => waits.push(ms),
  });
  let calls = 0;
  await transport.read("/api/search", {}, async () =>
    ++calls === 1
      ? new Response(null, {
          status: 429,
          headers: { "Retry-After": new Date(now + 2000).toUTCString() },
        })
      : new Response("ok"),
  );
  assert.deepEqual(waits, [2000]);
  calls = 0;
  waits.length = 0;
  const response = await transport.read("/api/search", {}, async () => {
    calls++;
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  });
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test("503 retry requires a throttle signal; malformed sources and network errors are not retried", async () => {
  const waits = [],
    transport = createPublicApiTransport({
      random: () => 0,
      sleep: async (ms) => waits.push(ms),
    });
  for (const headers of [
    { "Retry-After": "1" },
    { "X-Amzn-ErrorType": "TooManyRequestsException" },
  ]) {
    let calls = 0;
    const result = await transport.read("/api/read/player", {}, async () =>
      ++calls === 1
        ? new Response(null, { status: 503, headers })
        : new Response("ok"),
    );
    assert.equal(result.status, 200);
    assert.equal(calls, 2);
  }
  for (const [status, headers] of [
    [503, {}],
    [503, { "Retry-After": "invalid" }],
    [500, { "Retry-After": "1" }],
    [404, {}],
    [409, {}],
  ]) {
    let calls = 0;
    const result = await transport.read("/api/read/player", {}, async () => {
      calls++;
      return new Response(null, { status, headers });
    });
    assert.equal(result.status, status);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(
    transport.read("/api/read/player", {}, async () => {
      calls++;
      throw new TypeError("Failed to fetch");
    }),
    /Failed to fetch/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(transport.pending(), { active: 0, images: 0, queued: 0 });
});

test("unsafe methods are not retried and HEAD retains the bounded safe retry", async () => {
  const transport = createPublicApiTransport({
    random: () => 0,
    sleep: async () => {},
  });
  for (const [method, expected] of [
    ["POST", 1],
    ["HEAD", 3],
  ]) {
    let calls = 0;
    await transport.read("/api/status", { method }, async () => {
      calls++;
      return new Response(null, { status: 429 });
    });
    assert.equal(calls, expected);
  }
});

test("abort during backoff stops retry and lets the next queued read proceed", async () => {
  const transport = createPublicApiTransport({
    concurrency: 1,
    imageConcurrency: 1,
  });
  const controller = new AbortController();
  let calls = 0;
  const first = transport.read(
    "/api/search",
    { signal: controller.signal },
    async () => {
      calls++;
      return new Response(null, {
        status: 429,
        headers: { "Retry-After": "1" },
      });
    },
  );
  const rejection = assert.rejects(first, { name: "AbortError" });
  const second = transport.read(
    "/api/status",
    {},
    async () => new Response("ok"),
  );
  await turn();
  controller.abort();
  await rejection;
  assert.equal((await second).status, 200);
  assert.equal(calls, 1);
});

test("shared resource subscribers retain their independent cancellation ownership", async () => {
  const transport = createPublicApiTransport(),
    cache = createResourceCache();
  const { fetcher, started } = pendingFetcher(),
    first = new AbortController();
  const loader = async ({ signal }) =>
    (await transport.read("/api/read/player", { signal }, fetcher)).text();
  const a = cache.read("publication:player", loader, { signal: first.signal });
  const b = cache.read("publication:player", loader);
  const rejected = assert.rejects(a, { name: "AbortError" });
  await turn();
  first.abort();
  await rejected;
  assert.equal(started.length, 1);
  assert.equal(started[0].signal.aborted, false);
  started[0].finish();
  assert.equal(await b, "ok");
  assert.equal(cache.value("publication:player"), "ok");
});

test("asset permits cover byte consumption, not only response headers", async () => {
  const transport = createPublicApiTransport({
    concurrency: 1,
    imageConcurrency: 1,
  });
  let finishBytes,
    secondStarted = false;
  const first = transport.read(
    "/api/assets?first",
    {},
    async () => new Response("bytes"),
    "image",
    () =>
      new Promise((resolve) => {
        finishBytes = resolve;
      }),
  );
  const second = transport.read("/api/status", {}, async () => {
    secondStarted = true;
    return new Response("ok");
  });
  await turn();
  assert.equal(secondStarted, false);
  finishBytes("blob");
  assert.equal(await first, "blob");
  await second;
  assert.equal(secondStarted, true);
});

test("higher-level page recovery cannot multiply a throttle or ignore a longer Retry-After", async () => {
  for (const status of [429, 503]) {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return Response.json(
        { error: { message: "Capacity unavailable" } },
        {
          status,
          headers: { "Retry-After": "60" },
        },
      );
    };
    await assert.rejects(
      readCompactPages(
        "players",
        { limit: 20 },
        { fetcher, parallelPages: true },
      ),
      /Capacity unavailable/,
    );
    assert.equal(
      calls,
      1,
      "compact cohort recovery preserves the transport stop",
    );
    calls = 0;
    await assert.rejects(
      readPages("/api/seasons/partition", {}, fetcher),
      /HTTP/,
    );
    assert.equal(
      calls,
      1,
      "legacy page-size reduction is not a throttle retry",
    );
  }
});
