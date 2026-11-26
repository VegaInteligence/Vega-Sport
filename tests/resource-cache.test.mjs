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

test("seed reuses server data but cannot overwrite fresher or in-flight client work", async () => {
  let now = 1000,
    reads = 0,
    resolve;
  const cache = createResourceCache({ now: () => now, maxAge: 100 });
  cache.seed("home", { value: "server" }, { updatedAt: 950 });
  assert.deepEqual(await cache.load("home", () => ++reads), {
    value: "server",
  });
  assert.equal(reads, 0);
  cache.seed("home", { value: "older" }, { updatedAt: 900 });
  assert.equal(cache.peek("home").value.value, "server");
  const pending = cache.load(
    "home",
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    { force: true },
  );
  await Promise.resolve();
  cache.seed("home", { value: "late server" }, { updatedAt: 1100 });
  resolve({ value: "network" });
  await pending;
  assert.equal(cache.peek("home").value.value, "network");
  now = 1100;
  assert.equal(cache.value("home"), undefined);
});

// FAILURE_MODES_OPTIMISATIONS.md GH129-h (written before `keepError`): a read the player page starts early (its market
// values, which a player without them answers 404) can fail before the blocks that show it mount. Their first reads
// take that failure as their own read's, without a second request; for a bounded time only.
test("GH129-h a failure of a read started early stands for its first readers, then is read again", async () => {
  let now = 0,
    reads = 0;
  const cache = createResourceCache({ now: () => now });
  const failing = () => {
    reads++;
    throw new Error("Données indisponibles (HTTP 404)");
  };
  await assert.rejects(cache.load("market", failing, { retain: true, keepError: 10_000 }), /HTTP 404/);
  assert.equal(reads, 1);
  // The page's two blocks mount once it has failed: each subscribes, then asks (useResource's first load).
  const seen = [];
  const stops = [cache.subscribe("market", (state) => seen.push(state)), cache.subscribe("market", () => {})];
  assert.equal(seen[0].error, "Données indisponibles (HTTP 404)");
  now = 9_999;
  await assert.rejects(cache.load("market", failing), /HTTP 404/);
  await assert.rejects(cache.load("market", failing), /HTTP 404/);
  assert.equal(reads, 1, "never read twice by the page's first readers");
  assert.equal(cache.peek("market").error, "Données indisponibles (HTTP 404)");
  // « Réessayer »: a forced read reads again; its own failure is not kept.
  await assert.rejects(cache.load("market", failing, { force: true }), /HTTP 404/);
  assert.equal(reads, 2);
  await assert.rejects(cache.load("market", failing), /HTTP 404/);
  assert.equal(reads, 3, "a block's own failure is read again by the next one, as before");
  stops.forEach((stop) => stop());

  // A block asking once the time has passed reads again.
  await assert.rejects(cache.load("late", failing, { retain: true, keepError: 10_000 }), /HTTP 404/);
  now += 10_000;
  await assert.rejects(cache.load("late", failing), /HTTP 404/);
  assert.equal(reads, 5);

  // A success afterwards is the value; nothing of the failure stays.
  await assert.rejects(cache.load("then", failing, { retain: true, keepError: 10_000 }), /HTTP 404/);
  assert.equal(await cache.load("then", () => "values", { force: true }), "values");
  assert.equal(cache.peek("then").error, undefined);
  assert.equal(await cache.load("then", failing), "values");

  // An abort is no failure to keep.
  const aborted = cache.load("abort", ({ signal }) => new Promise((_, fail) => signal.addEventListener("abort", () => fail(new DOMException("Aborted", "AbortError")))), { retain: true, keepError: 10_000 });
  await Promise.resolve();
  cache.forget("abort");
  await assert.rejects(aborted, { name: "AbortError" });
  assert.equal(await cache.load("abort", () => "read"), "read");
});
