import test from "node:test";
import assert from "node:assert/strict";
import { createResourceCache } from "../dashboard/frontend/src/services/resource-cache.js";

test("navigation reuses a fresh response and refreshes it after its lifetime", async () => {
  let now = 0,
    reads = 0;
  const cache = createResourceCache({ now: () => now, maxAge: 100 });
  const loader = () => ++reads;
  assert.equal(await cache.load("season:1", loader), 1);
  now = 99;
  assert.equal(await cache.load("season:1", loader), 1);
  now = 100;
  assert.equal(cache.value("season:1"), undefined);
  assert.equal(await cache.load("season:1", loader), 2);
});

test("concurrent forced refreshes share one request and update every observer", async () => {
  const cache = createResourceCache();
  await cache.load("manifest", () => "before");
  const seen = [[], []];
  const stop = seen.map((list) =>
    cache.subscribe("manifest", (state) => list.push(state)),
  );
  let resolve,
    reads = 0;
  const loader = () => {
    reads++;
    return new Promise((done) => {
      resolve = done;
    });
  };
  const first = cache.load("manifest", loader, { force: true });
  const second = cache.load("manifest", loader, { force: true });
  assert.equal(first, second);
  assert.equal(cache.peek("manifest").value, "before");
  assert.equal(cache.peek("manifest").loading, false);
  assert.equal(cache.peek("manifest").refreshing, true);
  await Promise.resolve();
  resolve("after");
  await first;
  assert.equal(reads, 1);
  for (const list of seen) assert.equal(list.at(-1).value, "after");
  stop.forEach((fn) => fn());
});

test("a failed refresh retains the published value and can be retried", async () => {
  const cache = createResourceCache();
  await cache.load("manifest", () => ({ version: 1 }));
  await assert.rejects(
    cache.load(
      "manifest",
      () => {
        throw Error("offline");
      },
      { force: true },
    ),
    /offline/,
  );
  assert.deepEqual(cache.peek("manifest").value, { version: 1 });
  assert.equal(cache.peek("manifest").error, undefined);
  assert.equal(cache.peek("manifest").refreshError, "offline");
  await cache.load("manifest", () => ({ version: 2 }), { force: true });
  assert.equal(cache.peek("manifest").value.version, 2);
  assert.equal(cache.peek("manifest").refreshError, undefined);
});

test("an evicted request cannot overwrite a newer response under the same key", async () => {
  const cache = createResourceCache();
  let resolve;
  const old = cache.load(
    "match",
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await Promise.resolve();
  cache.forget("match");
  await cache.load("match", () => "new");
  resolve("old");
  await old;
  assert.equal(cache.peek("match").value, "new");
});

test("unsubscribing one consumer does not abort another consumer's request", async () => {
  const cache = createResourceCache();
  const first = cache.subscribe("search", () => {});
  const second = cache.subscribe("search", () => {});
  let signal, resolve;
  const request = cache.load("search", (options) => {
    signal = options.signal;
    return new Promise((done) => {
      resolve = done;
    });
  });
  await Promise.resolve();
  first();
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  second();
  await Promise.resolve();
  assert.equal(signal.aborted, true);
  resolve("discarded");
  await request;
  assert.equal(cache.value("search"), undefined);
});

test("a rapid remount and an intentional background load survive unsubscribe", async () => {
  const cache = createResourceCache();
  let resolve, signal;
  const stop = cache.subscribe("match", () => {});
  const promise = cache.load("match", (options) => {
    signal = options.signal;
    return new Promise((done) => {
      resolve = done;
    });
  });
  await Promise.resolve();
  stop();
  const stopAgain = cache.subscribe("match", () => {});
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  cache.load(
    "match",
    () => {
      throw Error("must share");
    },
    { retain: true },
  );
  stopAgain();
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  resolve(null);
  assert.equal(await promise, null);
  assert.equal(cache.value("match"), null);
});

test("the cache bounds unobserved entries while retaining subscribed values", async () => {
  const cache = createResourceCache({ maxEntries: 2 });
  const unsubscribe = cache.subscribe("visible", () => {});
  await cache.load("visible", () => 0);
  for (let i = 0; i < 5; i++) await cache.load(String(i), () => i);
  assert.equal(cache.size(), 2);
  assert.equal(cache.value("visible"), 0);
  assert.equal(cache.forget("visible"), false);
  unsubscribe();
});
