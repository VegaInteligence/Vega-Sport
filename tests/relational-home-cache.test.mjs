import test from "node:test";
import assert from "node:assert/strict";
import { createHomeReadRoute } from "../dashboard/backend/services/relational-home.js";

test("home cache shares concurrent work, fences publication and exact temporal boundaries", async () => {
  let now = Date.parse("2026-11-06T12:00:00Z"),
    boundary = now + 5000,
    generation = "1",
    watermark = "A",
    calls = 0;
  let fail = false;
  const sqlCalls = [];
  const route = createHomeReadRoute(
    async (sql) => {
      sqlCalls.push(sql);
      const meta = {
        generation,
        published_at: "2026-11-01",
        source_retrieved_at: watermark,
        partition_count: 1,
      };
      if (sql.includes("to_regclass")) return [{ available: true }];
      if (sql.includes("statarena_app.home_projection")) return [];
      if (sql.includes("/*vega:compact:home*/")) {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (fail) throw Error("unavailable");
        return [
          {
            ...meta,
            next_change: new Date(boundary).toISOString(),
            period: { asOf: now },
            leaders: {},
            result_count: 3,
          },
        ];
      }
      return [meta];
    },
    () => now,
  );
  const request = async (query = "season=2025") => {
    const req = new Request(`https://api.test/api/read/home?${query}`);
    return route(req, "/api/read/home", new URL(req.url).searchParams);
  };
  const [a, b] = await Promise.all([request(), request()]);
  assert.equal(calls, 1);
  assert.ok(!sqlCalls.some(sql => sql.includes("/*vega:home:cache-fence*/")), "cold fill must not issue a separate fact-table scan");
  assert.deepEqual((await a.json()).data, (await b.json()).data);
  now += 2000;
  assert.equal((await (await request()).json()).data.period.asOf, now);
  assert.equal(calls, 1);
  watermark = "B";
  await request();
  assert.equal(calls, 2);
  generation = "2";
  await request();
  assert.equal(calls, 3);
  now = boundary;
  boundary += 5000;
  await request();
  assert.equal(calls, 4);
  await request("season=2025&personalTeams=t_41iFW3");
  assert.equal(calls, 5);
  generation = "3";
  fail = true;
  await assert.rejects(request(), /unavailable/);
  fail = false;
  await request();
  assert.equal(calls, 7);
  await assert.rejects(
    request("season=2025&generation=2"),
    (error) => error.status === 409,
  );
});

test("persistent home projection is used only with matching publication and unexpired boundary", async () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  let queries = 0;
  const meta = {
    generation: "9",
    published_at: "2026-11-01",
    partition_count: 1,
  };
  const { homeStamp } =
    await import("../dashboard/backend/services/relational-home.js");
  let stamp = homeStamp(meta),
    until = new Date(now + 1000).toISOString();
  const route = createHomeReadRoute(
    async (sql) => {
      if (sql.includes("to_regclass")) return [{ available: true }];
      if (sql.includes("statarena_app.home_projection"))
        return [
          {
            stamp,
            computed_at: new Date(now - 1000),
            valid_until: until,
            snapshot: {
              ...meta,
              period: { asOf: now - 1000 },
              result_count: 7,
            },
          },
        ];
      if (sql.includes("/*vega:compact:home*/")) {
        queries++;
        return [
          { ...meta, next_change: new Date(now + 5000), result_count: 8 },
        ];
      }
      return [meta];
    },
    () => now,
  );
  const get = async (query) => {
    const req = new Request(
      `https://api.test/api/read/home?season=2025${query}`,
    );
    return route(req, "/api/read/home", new URL(req.url).searchParams);
  };
  assert.equal((await (await get("")).json()).data.resultCount, 7);
  assert.equal(queries, 0);
  stamp = "wrong";
  assert.equal((await (await get("&archive=1")).json()).data.resultCount, 8);
  assert.equal(queries, 1);
});

test("unsupported methods return the correct French error text", async () => {
  const route = createHomeReadRoute(async () => []);
  const request = new Request("https://api.test/api/read/home?season=2025", {
    method: "POST",
  });
  await assert.rejects(
    route(request, "/api/read/home", new URL(request.url).searchParams),
    (error) =>
      error.status === 405 &&
      error.message === "M\u00e9thode non autoris\u00e9e.",
  );
});
