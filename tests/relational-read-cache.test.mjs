import test from "node:test";
import assert from "node:assert/strict";
import { createReadCache } from "../dashboard/backend/services/relational-read-cache.js";

const scope = { season: "2026/2027", leagueIds: ["l_000001"] };
function input(extra = {}, options = {}) {
  const params = new URLSearchParams({ season: scope.season, ...extra });
  return [
    new Request(`https://api.test/api/read/players?${params}`, options),
    params,
  ];
}

test("retained expensive snapshots verify the live publication without repeating aggregation", async () => {
  let generation = "42",
    metadata = 0,
    payloads = 0;
  const cached = createReadCache(
    async (sql, values) => {
      metadata++;
      assert.match(sql, /statarena_app.publications/);
      assert.doesNotMatch(sql, /statarena_app.appearances/);
      assert.deepEqual(values, [scope.season, scope.leagueIds]);
      return [{ generation }];
    },
    { name: "test" },
  );
  const load = () => ({ generation, players: [++payloads] });
  const fetch = () => cached(...input(), scope, load);
  assert.deepEqual((await fetch()).players, [1]);
  assert.equal(metadata, 0, "the initial payload owns one SQL snapshot");
  assert.deepEqual((await fetch()).players, [1]);
  assert.equal(metadata, 1);
  assert.equal(payloads, 1);
  generation = "43";
  assert.deepEqual((await fetch()).players, [2]);
  assert.equal(metadata, 2);
  assert.equal(payloads, 2);
});

test("cached payloads cannot bypass client generation fences or a failed live check", async () => {
  let generation = "42",
    unavailable = false,
    payloads = 0;
  const cached = createReadCache(async () => {
    if (unavailable) throw Error("database unavailable");
    return [{ generation }];
  });
  const load = () => ({ generation, players: [++payloads] });
  const fetch = () => cached(...input({ generation: "42" }), scope, load);
  await fetch();
  unavailable = true;
  await assert.rejects(fetch(), /database unavailable/);
  unavailable = false;
  generation = "43";
  await assert.rejects(fetch(), (error) => error.status === 409);
  assert.equal(payloads, 1);
});

test("scope, page, filters and time periods keep distinct cached snapshots", async () => {
  let payloads = 0;
  const cached = createReadCache(async () => [{ generation: "42" }]);
  const load = () => ({ generation: "42", value: ++payloads });
  const fetch = (params, periodKey) =>
    cached(...input(params), scope, load, { periodKey });
  assert.equal((await fetch({ page: "1" }, 10)).value, 1);
  assert.equal((await fetch({ page: "1" }, 10)).value, 1);
  assert.equal((await fetch({ page: "2" }, 10)).value, 2);
  assert.equal((await fetch({ page: "1", leagues: "none" }, 10)).value, 3);
  assert.equal((await fetch({ page: "1", ranking: "rating" }, 10)).value, 4);
  assert.equal((await fetch({ page: "1" }, 11)).value, 5);
});

test("source watermarks and coverage invalidate a retained payload independently of its generation", async () => {
  let watermark = "2026-11-06T08:00:00Z",
    missing = 0,
    payloads = 0;
  const state = () => ({
    generation: "42",
    source_retrieved_at: watermark,
    missing_watermarks: missing,
  });
  const cached = createReadCache(async () => [state()]);
  const fetch = () =>
    cached(...input(), scope, () => ({ ...state(), value: ++payloads }));
  assert.equal((await fetch()).value, 1);
  assert.equal((await fetch()).value, 1);
  watermark = null;
  missing = 1;
  const refreshed = await fetch();
  assert.equal(refreshed.value, 2);
  assert.equal(refreshed.source_retrieved_at, null);
  assert.equal(refreshed.missing_watermarks, 1);
});

test("concurrent misses coalesce, rejected loads are retried and large entries are not retained", async () => {
  const cached = createReadCache(async () => [{ generation: "42" }], {
    maxBytes: 1024,
    maxEntryBytes: 128,
  });
  let payloads = 0,
    resolve;
  const load = () => {
    payloads++;
    return new Promise((done) => {
      resolve = done;
    });
  };
  const first = cached(...input(), scope, load);
  const second = cached(...input(), scope, load);
  resolve({ generation: "42", players: [] });
  await Promise.all([first, second]);
  assert.equal(payloads, 1);
  const failed = () =>
    cached(...input({ page: "2" }), scope, async () => {
      throw Error("timed out");
    });
  await assert.rejects(failed(), /timed out/);
  const retry = await cached(...input({ page: "2" }), scope, async () => ({
    generation: "42",
  }));
  assert.equal(retry.generation, "42");
  const large = () =>
    cached(...input({ page: "3" }), scope, async () => ({
      generation: "42",
      value: "x".repeat(1024),
      attempt: ++payloads,
    }));
  assert.equal((await large()).attempt, 2);
  assert.equal((await large()).attempt, 3);
});

test("a conditional miss keeps the payload's own fresh SQL publication", async () => {
  let generation = "42",
    payloads = 0;
  const cached = createReadCache(async () => [{ generation }]);
  const load = () => ({ generation, value: ++payloads });
  await cached(...input(), scope, load);
  generation = "43";
  const result = await cached(
    ...input(
      {},
      {
        headers: { "If-None-Match": 'W/"old-representation"' },
      },
    ),
    scope,
    load,
  );
  assert.equal(result.generation, "43");
  assert.equal(result.value, 2);
});
