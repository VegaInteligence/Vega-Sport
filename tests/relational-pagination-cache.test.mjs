import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  cacheHeaders,
  matchesEtag,
  noStoreHeaders,
} from "../dashboard/backend/services/cache-policy.js";

// Execute the actual endpoint code with a controlled database snapshot. No
// database credentials or production requests are needed for protocol tests.
function endpoints(query) {
  const source = readFileSync(
    new URL(
      "../dashboard/backend/services/relational-core.js",
      import.meta.url,
    ),
    "utf8",
  )
    .replace(/^import .*?;\n/gm, "")
    .replace(/^export /gm, "");
  return runInNewContext(
    source + "\n({ manifest, fixturePage, partitionPage })",
    {
      query,
      createHash,
      cacheHeaders,
      matchesEtag,
      noStoreHeaders,
      serializeJson: JSON.stringify,
      responseBytes: () => {},
      cache: () => ({}),
      packPartition: (value) => value,
      URL,
      Buffer,
      Response,
      Request,
    },
  );
}
const fixture = (id, day) => ({
  id,
  day,
  season: "2026/2027",
  league_id: "l_3FJFUl",
  status: "finished",
});
const request = (query, options) =>
  new Request("https://api.test/api/fixtures?" + query, options);

test("committed fixtures remain cacheable while later work is queued", async () => {
  const api = endpoints(async () => [
    {
      version: "42",
      dirty: true,
      rows: [
        fixture("m_000003", "2026-11-03"),
        fixture("m_000002", "2026-11-02"),
      ],
    },
  ]);
  const p = new URLSearchParams("season=2026/2027&order=desc&limit=1");
  const response = await api.fixturePage(request(p), p);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /s-maxage=30/);
  assert.doesNotMatch(
    response.headers.get("cache-control"),
    /immutable|no-store/,
  );
  const body = await response.json();
  assert.equal(body.data.matches.length, 1);
  assert.equal(body.pagination.generation, "42");
  assert.ok(body.pagination.nextCursor);
});

test("descending cursors preserve ordering, null dates and the publication fence", async () => {
  let state = {
      version: "42",
      rows: [
        fixture("m_000003", "2026-11-03"),
        fixture("m_000002", "2026-11-02"),
      ],
    },
    sql;
  const api = endpoints(async (statement) => {
    sql = statement;
    return [state];
  });
  const p = new URLSearchParams("order=desc&limit=1");
  const first = await (await api.fixturePage(request(p), p)).json();
  p.set("cursor", first.pagination.nextCursor);
  state = { version: "42", rows: [fixture("m_000002", "2026-11-02")] };
  const next = await (await api.fixturePage(request(p), p)).json();
  assert.equal(next.data.matches[0].id, "m_000002");
  assert.match(sql, /f\.day < \$\d+::date/);
  assert.match(sql, /f\.day IS NULL AND \$\d+::date IS NOT NULL/);
  assert.match(sql, /f\.id < \$\d+/);
  assert.match(sql, /ORDER BY day DESC NULLS LAST,id DESC/);
  state = { ...state, version: "43" };
  await assert.rejects(
    api.fixturePage(request(p), p),
    (error) => error.status === 409,
  );
  p.set("order", "asc");
  await assert.rejects(
    api.fixturePage(request(p), p),
    (error) => error.status === 400,
  );
});

test("conditional responses carry the same cache policy and reject old cursors", async () => {
  let version = "1";
  const api = endpoints(async () => [
    {
      version,
      dirty: true,
      rows: [fixture("m_000001", null), fixture("m_000002", null)],
    },
  ]);
  const p = new URLSearchParams("limit=1");
  const response = await api.fixturePage(request(p), p);
  const etag = response.headers.get("etag");
  const conditional = await api.fixturePage(
    request(p, { headers: { "if-none-match": etag } }),
    p,
  );
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
  assert.equal(
    conditional.headers.get("cache-control"),
    response.headers.get("cache-control"),
  );
  const body = await response.json();
  p.set("cursor", body.pagination.nextCursor);
  version = "2";
  await assert.rejects(
    api.fixturePage(request(p, { method: "HEAD" }), p),
    (error) => error.status === 409,
  );
});

test("partition pages cache one committed digest and reject another generation", async () => {
  let version = "digest-1";
  const api = endpoints(async () => [
    {
      version,
      dirty: true,
      counts: {},
      metrics: [],
      competitions: [],
      teams: [],
      fixtures: [],
      matches: [],
      appearances: [],
      shots: [],
      stats: [],
      cover: [],
      players: [],
      warnings: [],
      keys: [
        fixture("m_000001", "2026-11-01"),
        fixture("m_000002", "2026-11-02"),
      ],
    },
  ]);
  const p = new URLSearchParams("season=2026/2027&league=l_3FJFUl&limit=1");
  const response = await api.partitionPage(request(p), p);
  assert.match(response.headers.get("cache-control"), /s-maxage=30/);
  p.set("cursor", (await response.json()).pagination.nextCursor);
  version = "digest-2";
  await assert.rejects(
    api.partitionPage(request(p), p),
    (error) => error.status === 409,
  );
});

test("manifest separates source freshness from publication time", async () => {
  const api = endpoints(async () => [
    {
      version: "10",
      dirty: true,
      published_at: "2026-11-06T21:00:00Z",
      countries: {},
      competitions: [],
      partitions: [
        {
          season: "2026/2027",
          league_id: "l_3FJFUl",
          source_digest: "abc",
          retrieved_at: "2026-11-06T06:00:00Z",
          published_at: "2026-11-06T08:00:00Z",
          start_date: "2026-08-01",
          end_date: "2026-11-05",
          counts: { matchCount: 50 },
        },
      ],
    },
  ]);
  const response = await api.manifest(
    new Request("https://api.test/api/dashboard/manifest"),
  );
  assert.match(response.headers.get("cache-control"), /s-maxage=15/);
  const body = await response.json();
  assert.equal(body.publicationVersion, "10");
  assert.equal(body.publishedAt, "2026-11-06T21:00:00Z");
  assert.equal(
    body.seasons[0].chunks[0].meta.retrievedAt,
    "2026-11-06T06:00:00Z",
  );
  assert.equal(body.seasons[0].chunks[0].meta.endDate, "2026-11-05");
});

test("manifest capabilities refresh cached representations without a data publication", async () => {
  let calls = 0;
  const api = endpoints(async () => {
    calls++;
    return [
      {
        version: "199",
        published_at: "2026-11-06T21:13:42.971Z",
        countries: {},
        competitions: [],
        partitions: [],
      },
    ];
  });
  const url = "https://api.test/api/dashboard/manifest";
  // The deployed core-v3 manifest used this ETag for publication 199 before
  // playerRatingRanking was advertised. Its cached body must be replaced.
  const previous =
    'W/"core-v3-510207df25b4e0c761d49e9ca25e754cd9e1bbe71ceadf91af52ae9128a1f18b"';
  const response = await api.manifest(
    new Request(url, { headers: { "If-None-Match": previous } }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  const body = await response.json();
  assert.equal(body.publicationVersion, "199");
  assert.equal(body.capabilities.playerRatingRanking, true);
  const etag = response.headers.get("etag");
  assert.ok(etag);
  assert.notEqual(etag, previous);
  calls = 0;
  const conditional = await api.manifest(
    new Request(url, { headers: { "If-None-Match": etag } }),
  );
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
  assert.equal(calls, 1, "a current validator does not rebuild the catalogue");
  assert.equal(conditional.headers.get("etag"), etag);
  assert.equal(
    conditional.headers.get("cache-control"),
    response.headers.get("cache-control"),
  );
  calls = 0;
  const head = await api.manifest(new Request(url, { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("etag"), etag);
  assert.equal(calls, 1);
});

test("invalid order cannot alter the SQL query", async () => {
  let calls = 0;
  const api = endpoints(async () => {
    calls++;
    return [];
  });
  const p = new URLSearchParams("order=desc;drop table matches");
  await assert.rejects(
    api.fixturePage(request(p), p),
    (error) => error.status === 400,
  );
  assert.equal(calls, 0);
});

test("versioned partition URLs reject stale first pages before assembly or 304", async () => {
  const expected = "a".repeat(64);
  const api = endpoints(async () => [{ version: "b".repeat(64) }]);
  const p = new URLSearchParams({
    season: "2026/2027",
    league: "l_3FJFUl",
    v: expected,
  });
  for (const options of [
    undefined,
    { method: "HEAD" },
    { headers: { "if-none-match": "*" } },
  ]) {
    await assert.rejects(
      api.partitionPage(request(p, options), p),
      (error) => error.status === 409,
    );
  }
  p.set("v", "not-a-published-digest");
  await assert.rejects(
    api.partitionPage(request(p), p),
    (error) => error.status === 400,
  );
});

test(
  "fixture SQL pages tied and null dates without gaps on PostgreSQL",
  {
    skip: !process.env.VEGA_TEST_DATABASE_URL,
  },
  async () => {
    const url = new URL(process.env.VEGA_TEST_DATABASE_URL);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    const requireLocal = createRequire(
      new URL("../dashboard/package.json", import.meta.url),
    );
    const { Client } = requireLocal("pg");
    const client = new Client({ connectionString: url.href });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
      CREATE SCHEMA statarena_app;
      CREATE TABLE statarena_app.publications(singleton boolean PRIMARY KEY,generation bigint,published_at timestamptz);
      CREATE TABLE statarena_app.fixtures(id text PRIMARY KEY,day date,season text,native_season text,league_id text,status text,home_name text,away_name text,league_name text);
      INSERT INTO statarena_app.publications VALUES(true,42,now());
    `);
      const rows = [
        ["m_000001", "2026-11-06"],
        ["m_000002", "2026-11-06"],
        ["m_000003", "2026-11-05"],
        ["m_000004", null],
        ["m_000005", null],
      ];
      for (const row of rows)
        await client.query(
          "INSERT INTO statarena_app.fixtures VALUES($1,$2,'2026/2027','2026/2027','l_3FJFUl','finished','París','Lyon','Ligue 1')",
          row,
        );
      const api = endpoints(
        async (sql, params) => (await client.query(sql, params)).rows,
      );
      const p = new URLSearchParams(
        "season=2026/2027&league=l_3FJFUl&order=desc&limit=2&q=paris",
      );
      const seen = [];
      let firstCursor;
      for (let page = 0; page < 3; page++) {
        const response = await api.fixturePage(request(p), p);
        const body = await response.json();
        seen.push(...body.data.matches.map((row) => row.id));
        if (!page) firstCursor = body.pagination.nextCursor;
        if (page < 2) {
          assert.ok(body.pagination.nextCursor);
          p.set("cursor", body.pagination.nextCursor);
        } else assert.equal(body.pagination.nextCursor, null);
      }
      assert.deepEqual(seen, [
        "m_000002",
        "m_000001",
        "m_000003",
        "m_000005",
        "m_000004",
      ]);
      await client.query("UPDATE statarena_app.publications SET generation=43");
      p.set("cursor", firstCursor);
      await assert.rejects(
        api.fixturePage(request(p), p),
        (error) => error.status === 409,
      );
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  },
);
