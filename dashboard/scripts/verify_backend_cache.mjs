/** HTTP E2E with real local PostgreSQL/TLS + AWS SDK. No production env used. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  chmod,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
if (process.argv.includes("--serve")) {
  // Test-only adapter: use the production handler and cache without patching them.
  let offset = 0;
  const realNow = Date.now;
  Date.now = () => realNow() + offset;
  const telemetry = [];
  const log = console.log;
  console.log = (...items) => {
    try {
      const value = JSON.parse(items[0]);
      if (value.event === "statarena.request") telemetry.push(value);
    } catch {}
    log(...items);
  };
  const { handleRequest } = await import("../backend/app.js");
  const { cache } = await import("../backend/services/neon.js");
  const { instrumentRequest } = await import("../backend/services/metrics.js");
  const small = cache(1024, { name: "fixture" });
  const loads = {};
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/_fixture/clock") {
        offset += Number(url.searchParams.get("ms"));
        return Response.json({ offset });
      }
      if (url.pathname === "/_fixture/telemetry") {
        const rows = telemetry.splice(0);
        return Response.json(rows);
      }
      if (url.pathname.startsWith("/_fixture/cache/")) {
        const key = url.pathname.split("/").at(-1);
        return instrumentRequest(request, async () => {
          try {
            const value = await small(key, async () => {
              loads[key] = (loads[key] || 0) + 1;
              await Bun.sleep(25);
              if (key === "retry" && loads[key] === 1)
                throw new Error("fixture failure");
              return Buffer.alloc(key === "huge" ? 2048 : 200, 65);
            });
            return Response.json({ length: value.length, loads });
          } catch {
            return new Response(null, { status: 503 });
          }
        });
      }
      return handleRequest(request);
    },
  });
  log(JSON.stringify({ ready: server.port }));
  process.on("SIGTERM", () => {
    server.stop(true);
    process.exit(0);
  });
} else {
  await run();
}

async function run() {
  const tools =
    process.env.STATARENA_TEST_TOOLS || "/tmp/statarena-cache-test-tools";
  const evidence = path.resolve(
    root,
    process.env.STATARENA_TEST_EVIDENCE ||
      "docs/verification/backend-cache-20261103/after",
  );
  const scratch = await mkdtemp(path.join(tmpdir(), "statarena-cache-pg-"));
  await mkdir(evidence, { recursive: true });
  const report = {
    setup:
      "Disposable PostgreSQL 18 over verified TLS; runtime schema; real Bun handler and S3 SDK against local object fixture; virtual cache clock only in fixture server.",
    command: `STATARENA_TEST_TOOLS=${tools} STATARENA_TEST_EVIDENCE=${path.relative(root, evidence)}${process.env.STATARENA_TEST_NEXT === "1" ? " STATARENA_TEST_NEXT=1" : ""} bun dashboard/scripts/verify_backend_cache.mjs`,
    versions: {
      bun: Bun.version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      postgresPackage: "18.6.0-beta.19",
    },
    expected:
      "PROTOCOL.md; same data/status contracts; no redundant source reads on retained-version/304/HEAD paths; effective route TTLs; oversized admission preserves small entries.",
    checks: [],
    requests: [],
    observations: [],
    status: "failed",
  };
  const sqlLog = [],
    appLog = [],
    objectReads = [];
  let postgres, admin, child, drain, origin, activeCheck;
  const body = Buffer.from(JSON.stringify({ fixture: "inline", version: 1 }));
  const object = Buffer.from(JSON.stringify({ fixture: "object", version: 1 }));
  const corruptExpected = Buffer.from(
    JSON.stringify({ fixture: "corrupt-retry", version: 1 }),
  );
  const profile = gzipSync(
    JSON.stringify({
      data: { id: "p_000001", name: "Fixture Player", missing: null },
    }),
  );
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const manifestPath = "computed/dashboard/index.json";
  const assetPath = "raw/neon/assets/" + "a".repeat(64) + ".png";
  const objectBodies = new Map([
    ["data/raw/fixture-object.json", object],
    ["data/raw/fixture-corrupt.json", Buffer.from("wrong")],
  ]);
  const storage = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const key = decodeURIComponent(new URL(request.url).pathname).replace(
        /^\/fixture\//,
        "",
      );
      objectReads.push({ method: request.method, key });
      const value = objectBodies.get(key);
      return value
        ? new Response(value)
        : new Response("<Error><Code>NoSuchKey</Code></Error>", {
            status: 404,
          });
    },
  });
  async function check(name, expected, fn) {
    activeCheck = name;
    const start = performance.now(),
      from = sqlLog.length,
      objectFrom = objectReads.length;
    try {
      const details = await fn();
      report.checks.push({
        name,
        expected,
        status: "passed",
        ms: performance.now() - start,
        details,
        sql: sqlLog.slice(from),
        objects: objectReads.slice(objectFrom),
      });
    } catch (error) {
      report.checks.push({
        name,
        expected,
        status: "failed",
        error: error.stack,
        ms: performance.now() - start,
        sql: sqlLog.slice(from),
        objects: objectReads.slice(objectFrom),
      });
    }
  }
  async function get(route, init = {}) {
    const start = performance.now();
    const response = await fetch(origin + route, {
      redirect: "error",
      ...init,
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    report.requests.push({
      scenario: activeCheck,
      path: route,
      method: init.method || "GET",
      status: response.status,
      bytes: bytes.length,
      sha256: hash(bytes),
      headers: Object.fromEntries(response.headers),
      ms: performance.now() - start,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      bytes,
      ms: performance.now() - start,
      json: () => JSON.parse(bytes),
    };
  }
  async function advance() {
    await get("/_fixture/clock?ms=31000");
  }
  async function telemetry() {
    const rows = (await get("/_fixture/telemetry")).json();
    report.observations.push({ scenario: activeCheck, rows });
    return rows;
  }
  const total = (rows, key) =>
    rows.reduce((sum, row) => sum + (row.metrics?.[key] || 0), 0);
  function noBodies(rows) {
    assert.ok(rows.length, "sampled request telemetry required");
    for (const key of [
      "sql_body_bytes",
      "sql_json_rows",
      "object_bytes",
      "gzip_bytes",
      "parse_bytes",
    ])
      assert.equal(total(rows, key), 0, key);
  }
  try {
    const { default: EmbeddedPostgres } = await import(
      pathToFileURL(
        path.join(tools, "node_modules/embedded-postgres/dist/index.js"),
      ).href
    );
    const cert = path.join(scratch, "server.crt"),
      key = path.join(scratch, "server.key");
    const result = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    await chmod(key, 0o600);
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    const port = listener.port;
    listener.stop(true);
    postgres = new EmbeddedPostgres({
      databaseDir: path.join(scratch, "pg"),
      user: "fixture",
      password: "local-fixture-only",
      port,
      persistent: false,
      autoRehydrateSymlinks: true,
      postgresFlags: [
        "-c",
        "listen_addresses=127.0.0.1",
        "-c",
        "ssl=on",
        "-c",
        `ssl_cert_file=${cert}`,
        "-c",
        `ssl_key_file=${key}`,
        "-c",
        "log_statement=all",
      ],
      onLog: (v) => sqlLog.push(String(v)),
      onError: (v) => sqlLog.push(String(v)),
    });
    await postgres.initialise();
    await postgres.start();
    const dbUrl = new URL(
      `postgresql://fixture:local-fixture-only@127.0.0.1:${port}/postgres`,
    );
    dbUrl.searchParams.set("sslmode", "verify-full");
    dbUrl.searchParams.set("sslrootcert", cert);
    admin = new pg.Client({ connectionString: dbUrl.href });
    await admin.connect();
    await admin.query(
      await readFile(
        path.join(root, "dashboard/backend/migrations/001_neon.sql"),
        "utf8",
      ),
    );
    async function put(p, bytes, inline = true, type = "application/json") {
      await admin.query(
        "INSERT INTO statarena.objects(path,size,sha256,etag,body,content_type) VALUES($1,$2,decode($3,'hex'),$3,$4,$5) ON CONFLICT(path) DO UPDATE SET size=excluded.size,sha256=excluded.sha256,body=excluded.body",
        [p, bytes.length, hash(bytes), inline ? bytes : null, type],
      );
    }
    await put(manifestPath, body);
    await put("raw/fixture-object.json", object, false);
    await put("raw/fixture-corrupt.json", corruptExpected, false);
    await put("raw/fixture-profile.json.gz", profile);
    await put(assetPath, Buffer.from("fixture image"), true, "image/png");
    await put(
      "raw/fixture-leagues.json",
      Buffer.from('{"data":{"leagues":[{"id":"l_000001"}]}}'),
    );
    await put(
      "raw/fixture-match.json",
      Buffer.from(
        '{"data":{"id":"m_000001","status":"finished","score":{"home":1,"away":0}}}',
      ),
    );
    await put(
      "raw/fixture-detail.json",
      Buffer.from('{"data":{"unavailable":null,"value":0}}'),
    );
    for (const [endpoint, ref, status, error] of [
      ["/players/p_000001", { path: "raw/fixture-profile.json.gz" }, 200, null],
      ["/players/p_000002", null, 404, { code: "RESOURCE_NOT_FOUND" }],
      ["/players/p_000003", { path: "raw/not-present.json" }, 200, null],
      ["/teams/t_000001", { path: "raw/fixture-detail.json" }, 200, null],
      ["/leagues", { path: "raw/fixture-leagues.json" }, 200, null],
      ["/leagues/l_000001", { path: "raw/fixture-detail.json" }, 200, null],
      ["/matches/m_000001", { path: "raw/fixture-match.json" }, 200, null],
      ...[
        "stats",
        "lineups",
        "heatmaps",
        "players",
        "shots",
        "momentum",
        "events",
        "h2h",
        "advanced",
        "advanced/players",
        "advanced/network",
        "players/halves",
      ].map((x) => [
        "/matches/m_000001/" + x,
        { path: "raw/fixture-detail.json" },
        200,
        null,
      ]),
      ...[403, 429, 503].map((s) => [
        `/players/p_000${s}`,
        null,
        s,
        { code: "FIXTURE_ERROR" },
      ]),
    ])
      await admin.query(
        "INSERT INTO statarena.resources(endpoint,ref,status,error) VALUES($1,$2,$3,$4)",
        [endpoint, ref, status, error],
      );
    await admin.query(
      "INSERT INTO statarena.resources(endpoint,params,ref,status) VALUES('/matches/m_000001/heatmaps',$1,$2,200)",
      ['{"frame":"acting_ltr"}', { path: "raw/fixture-detail.json" }],
    );
    await put(
      "raw/archive-documents.json",
      Buffer.from(
        JSON.stringify([
          {
            id: "archive-two",
            metadata: { season: "2026/2027" },
            endpoints: ["match", "stats"],
          },
        ]),
      ),
    );
    await put(
      "raw/archive-match.json",
      Buffer.from(
        JSON.stringify([
          {
            documentId: "archive-two",
            response: {
              status: 200,
              data: { id: "m_000002", status: "finished" },
            },
          },
        ]),
      ),
    );
    await put(
      "raw/archive-stats.json",
      Buffer.from(
        JSON.stringify([
          {
            documentId: "archive-two",
            response: { status: 404, error: { code: "ANALYTICS_UNAVAILABLE" } },
          },
        ]),
      ),
    );
    const shard = {
      document: { path: "raw/archive-documents.json" },
      tables: {
        match: { path: "raw/archive-match.json" },
        stats: { path: "raw/archive-stats.json" },
      },
    };
    await admin.query(
      "INSERT INTO statarena.shards(id,ref) VALUES('archive-two',$1)",
      [shard],
    );
    await admin.query(
      "INSERT INTO statarena.observations(id,shard,ordinal) VALUES('m_000002','archive-two',0)",
    );
    await admin.query(
      "INSERT INTO statarena.assets VALUES($1,$2,'image/png')",
      ["https://fixture.invalid/asset.png", assetPath],
    );
    await admin.query(
      "INSERT INTO statarena.projections(name,body) VALUES('standings','{\"available\":true}'::jsonb)",
    );
    await admin.query(
      "INSERT INTO statarena.fixtures(id,league_id,season,day,status,body) VALUES('m_000001','l_000001','2026/2027','2026-11-03','finished','{\"id\":\"m_000001\",\"score\":null}'::jsonb)",
    );
    report.inputs = {
      inline: { path: manifestPath, bytes: body.length, sha256: hash(body) },
      object: {
        path: "raw/fixture-object.json",
        bytes: object.length,
        sha256: hash(object),
      },
      profile: { bytes: profile.length, sha256: hash(profile) },
      virtualMetadataExpiryMs: 31000,
      concurrency: [1, 5, 20],
    };
    async function start(sample = "1") {
      if (child) {
        child.kill("SIGTERM");
        await child.exited;
        await drain;
      }
      let ready;
      const readyPromise = new Promise((resolve) => {
        ready = resolve;
      });
      child = Bun.spawn(
        [process.execPath, fileURLToPath(import.meta.url), "--serve"],
        {
          cwd: root,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NEON_DATABASE_URL: dbUrl.href,
            NEON_STORAGE_ENDPOINT: storage.url.href,
            NEON_STORAGE_BUCKET: "fixture",
            NEON_STORAGE_REGION: "us-east-2",
            NEON_STORAGE_ACCESS_KEY_ID: "fixture",
            NEON_STORAGE_SECRET_ACCESS_KEY: "fixture",
            STATARENA_METRICS_SAMPLE_RATE: sample,
            STATARENA_SERVER_TIMING: "1",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      drain = Promise.all(
        [child.stdout, child.stderr].map(async (stream) => {
          let pending = "";
          for await (const data of stream) {
            const chunk = new TextDecoder().decode(data);
            appLog.push(chunk);
            pending += chunk;
            let n;
            while ((n = pending.indexOf("\n")) >= 0) {
              const line = pending.slice(0, n);
              pending = pending.slice(n + 1);
              try {
                const parsed = JSON.parse(line);
                if (parsed.ready) {
                  origin = `http://127.0.0.1:${parsed.ready}`;
                  ready();
                }
              } catch {}
            }
          }
        }),
      );
      await Promise.race([
        readyPromise,
        Bun.sleep(15000).then(() => {
          throw new Error("Fixture app did not start");
        }),
      ]);
    }
    await start();
    await check(
      "cold inline bytes",
      "200 with original bytes; record cold query count and durations",
      async () => {
        const r = await get("/data/dashboard-manifest.json");
        assert.equal(r.status, 200);
        assert.deepEqual(r.bytes, body);
        return {
          digest: hash(r.bytes),
          ms: r.ms,
          telemetry: await telemetry(),
        };
      },
    );
    await check(
      "304 after metadata expiry",
      "strong, weak, list, wildcard: zero source bodies or parsing",
      async () => {
        await advance();
        const r = await get("/data/dashboard-manifest.json", {
          headers: { "If-None-Match": `"${hash(body)}"` },
        });
        const rows = await telemetry();
        const responses = [r];
        for (const tag of [
          `W/"${hash(body)}"`,
          `"other", W/"${hash(body)}"`,
          "*",
        ]) {
          const c = await get("/data/dashboard-manifest.json", {
            headers: { "If-None-Match": tag },
          });
          responses.push(c);
        }
        const rest = await telemetry();
        for (const result of responses) {
          assert.equal(result.status, 304);
          assert.equal(result.bytes.length, 0);
        }
        noBodies(rows);
        noBodies(rest);
        return { telemetry: rows };
      },
    );
    await check(
      "retained body after metadata expiry",
      "200 identical bytes, refreshed metadata only",
      async () => {
        await advance();
        const r = await get("/data/dashboard-manifest.json");
        assert.equal(r.status, 200);
        assert.deepEqual(r.bytes, body);
        const rows = await telemetry();
        noBodies(rows);
        return { telemetry: rows };
      },
    );
    await check(
      "HEAD file and missing wildcard",
      "size/ETag from metadata; missing stays 404",
      async () => {
        await advance();
        const r = await get("/data/dashboard-manifest.json", {
          method: "HEAD",
        });
        assert.equal(r.status, 200);
        assert.equal(r.bytes.length, 0);
        assert.equal(Number(r.headers["content-length"]), body.length);
        assert.equal(r.headers.etag, `"${hash(body)}"`);
        noBodies(await telemetry());
        assert.equal(
          (
            await get("/data/raw/missing.json", {
              headers: { "If-None-Match": "*" },
            })
          ).status,
          404,
        );
        await telemetry();
      },
    );
    await check(
      "S3 HEAD then cold GET",
      "HEAD no object GET; cold GET exactly one metadata query, one object fetch",
      async () => {
        const from = objectReads.length;
        const head = await get("/data/raw/fixture-object.json", {
          method: "HEAD",
        });
        assert.equal(head.status, 200);
        assert.equal(objectReads.length, from);
        noBodies(await telemetry());
        await start();
        const r = await get("/data/raw/fixture-object.json");
        const rows = await telemetry();
        assert.equal(r.status, 200);
        assert.deepEqual(r.bytes, object);
        assert.equal(objectReads.length, from + 1);
        assert.equal(total(rows, "sql_count"), 1);
        return { telemetry: rows };
      },
    );
    await check(
      "integrity and retry",
      "corrupt S3 bytes => 503 no-store; valid retry => 200",
      async () => {
        const bad = await get("/data/raw/fixture-corrupt.json");
        assert.equal(bad.status, 503);
        assert.equal(bad.headers["cache-control"], "no-store");
        objectBodies.set("data/raw/fixture-corrupt.json", corruptExpected);
        assert.equal((await get("/data/raw/fixture-corrupt.json")).status, 200);
        await telemetry();
        await put(
          "raw/fixture-missing-storage.json",
          Buffer.from("missing storage"),
          false,
        );
        assert.equal(
          (await get("/data/raw/fixture-missing-storage.json")).status,
          503,
        );
        const failedRead = await telemetry();
        assert.equal(total(failedRead, "object_errors"), 1);
        assert.ok(total(failedRead, "object_ms") > 0);
      },
    );
    await check(
      "version changed between HEAD and GET",
      "completed publication returns current bytes/ETag after one metadata retry",
      async () => {
        const p = "raw/fixture-race.json",
          old = Buffer.from('{"version":1}');
        await put(p, old);
        await get("/data/" + p, { method: "HEAD" });
        await put(p, Buffer.from('{"version":2}'));
        const r = await get("/data/" + p);
        assert.equal(r.status, 200);
        assert.deepEqual(r.json(), { version: 2 });
        assert.equal(r.headers.etag, `"${hash(r.bytes)}"`);
        await advance();
        const current = await get("/data/" + p);
        assert.equal(current.status, 200);
        assert.deepEqual(current.json(), { version: 2 });
        await telemetry();
      },
    );
    await check(
      "parsed version publication race",
      "JSON path refreshes stale metadata once and returns current data",
      async () => {
        const p = "raw/fixture-new-profile.json.gz";
        await put(
          p,
          gzipSync(JSON.stringify({ data: { name: "before publication" } })),
        );
        await admin.query(
          "INSERT INTO statarena.resources(endpoint,ref,status) VALUES('/players/p_000004',$1,200)",
          [{ path: p }],
        );
        await get("/data/" + p, { method: "HEAD" });
        await put(
          p,
          gzipSync(JSON.stringify({ data: { name: "after publication" } })),
        );
        const r = await get("/api/pitchapi/players/p_000004");
        assert.equal(r.status, 200);
        assert.equal(r.json().data.name, "after publication");
        await telemetry();
      },
    );
    await check(
      "parsed version retained after expiry",
      "profile remains identical with zero SQL bodies/gzip/parse on warm version",
      async () => {
        const route = "/api/pitchapi/players/p_000001";
        const a = await get(route);
        assert.equal(a.status, 200);
        assert.equal(a.json().data.name, "Fixture Player");
        await telemetry();
        await advance();
        const b = await get(route);
        assert.deepEqual(b.json(), a.json());
        const rows = await telemetry();
        noBodies(rows);
        return { telemetry: rows };
      },
    );
    await check(
      "TTL by successful route family",
      "declared s-maxage used on GET and HEAD, browser max-age=0",
      async () => {
        const pairs = [
          ["/leagues", 900],
          ["/leagues/l_000001", 900],
          ["/teams/t_000001", 3600],
          ["/players/p_000001", 3600],
          ["/matches/m_000001", 120],
          ["/matches/m_000001/stats", 300],
          ["/matches/m_000001/lineups", 60],
          ["/matches/m_000001/heatmaps?frame=acting_ltr", 300],
          ["/leagues/l_000001/matches?season=2026%2F2027&status=all", 180],
          ["/date/2026-11-03?status=all", 120],
        ];
        const outcomes = [];
        for (const [p, ttl] of pairs)
          for (const method of ["GET", "HEAD"]) {
            const r = await get("/api/pitchapi" + p, { method });
            outcomes.push({
              p,
              ttl,
              method,
              status: r.status,
              headers: r.headers,
              bytes: r.bytes.length,
            });
          }
        await telemetry();
        for (const r of outcomes) {
          const { ttl, method } = r;
          assert.equal(r.status, 200);
          assert.match(
            r.headers["cache-control"],
            new RegExp(`(?:^|, )s-maxage=${ttl}(?:,|$)`),
          );
          assert.match(r.headers["cache-control"], /(?:^|, )max-age=0(?:,|$)/);
          assert.equal(
            r.headers["vercel-cdn-cache-control"],
            `public, s-maxage=${ttl}, stale-while-revalidate=30`,
          );
          assert.doesNotMatch(
            r.headers["cache-control"],
            /stale-while-revalidate/,
          );
          if (method === "HEAD") assert.equal(r.bytes, 0);
        }
        return outcomes;
      },
    );
    await check(
      "dynamic HEAD statuses and unavailable values",
      "GET status preserved for envelopes, missing, failure, fallback, empty list and validations",
      async () => {
        const paths = [
          "/api/health",
          "/api/settings",
          "/api/status",
          "/api/standings",
          "/api/stadium",
          "/api/archive/matches/m_000001",
          "/api/archive/matches/m_000002",
          "/api/archive/matches/m_999999",
          "/api/archive/profiles/players/p_000001",
          "/api/archive/profiles/players/p_000002",
          "/api/archive/profiles/players/p_000003",
          "/api/pitchapi/players/p_000002",
          "/api/pitchapi/players/p_999999",
          "/api/pitchapi/matches/m_000002",
          "/api/pitchapi/matches/m_000002/stats",
          ...[403, 429, 503].map((s) => `/api/pitchapi/players/p_000${s}`),
          "/api/pitchapi/date/2026-11-04?status=all",
          "/api/pitchapi/date/2026-02-30",
          "/api/pitchapi/leagues?url=secret",
          "/data/raw/%2eenv",
        ];
        const outcomes = [];
        for (const p of paths) {
          const getResult = await get(p),
            head = await get(p, { method: "HEAD" });
          assert.equal(head.status, getResult.status, p);
          assert.equal(head.bytes.length, 0, p);
          if (
            getResult.status !== 200 ||
            ["/api/health", "/api/settings", "/api/status"].includes(p)
          )
            assert.equal(head.headers["cache-control"], "no-store", p);
          outcomes.push({ p, status: getResult.status });
        }
        const detail = (
          await get("/api/pitchapi/matches/m_000001/stats")
        ).json();
        assert.equal(detail.data.unavailable, null);
        assert.equal(detail.data.value, 0);
        assert.equal(
          (await get("/api/health", { method: "POST" })).status,
          405,
        );
        await telemetry();
        return outcomes;
      },
    );
    await check(
      "projection HEAD avoids JSON bodies",
      "existence query only, no row.body transfer",
      async () => {
        const r = await get("/api/standings", { method: "HEAD" });
        assert.equal(r.status, 200);
        const rows = await telemetry();
        noBodies(rows);
        return { telemetry: rows };
      },
    );
    await check(
      "mutable alias versus versioned path",
      "asset alias mutable; direct content-versioned path immutable; manifest mutable",
      async () => {
        const alias = await get(
          "/api/assets?url=" +
            encodeURIComponent("https://fixture.invalid/asset.png"),
        );
        assert.equal(alias.status, 200);
        const direct = await get("/data/" + assetPath);
        assert.equal(direct.status, 200);
        assert.match(direct.headers["cache-control"], /immutable/);
        assert.doesNotMatch(
          (await get("/data/dashboard-manifest.json")).headers["cache-control"],
          /immutable/,
        );
        await telemetry();
        const changedPath = "raw/neon/assets/" + "b".repeat(64) + ".png",
          changed = Buffer.from("updated fixture image");
        await put(changedPath, changed, true, "image/png");
        await admin.query("UPDATE statarena.assets SET path=$1 WHERE url=$2", [
          changedPath,
          "https://fixture.invalid/asset.png",
        ]);
        await advance();
        await advance();
        const updated = await get(
          "/api/assets?url=" +
            encodeURIComponent("https://fixture.invalid/asset.png"),
        );
        assert.equal(updated.status, 200);
        assert.deepEqual(updated.bytes, changed);
        await telemetry();
        assert.doesNotMatch(alias.headers["cache-control"], /immutable/);
        assert.doesNotMatch(updated.headers["cache-control"], /immutable/);
        assert.match(alias.headers["cache-control"], /s-maxage=60/);
      },
    );
    await check(
      "oversized entry preserves small entries",
      "A/B load once, huge not retained",
      async () => {
        await telemetry();
        for (const key of ["a", "b", "huge", "a", "b", "huge"])
          assert.equal((await get("/_fixture/cache/" + key)).status, 200);
        const r = (await get("/_fixture/cache/a")).json();
        const rows = await telemetry();
        assert.equal(r.loads.a, 1);
        assert.equal(r.loads.b, 1);
        assert.equal(r.loads.huge, 2);
        assert.equal(total(rows, "cache_fixture_rejected"), 2);
        return r;
      },
    );
    await check(
      "cache concurrency, expiry and failed retry",
      "one load for 20 same-key requests; failures never retained; expiry reloads",
      async () => {
        const all = await Promise.all(
          Array.from({ length: 20 }, () => get("/_fixture/cache/concurrent")),
        );
        assert.ok(
          all.every((r) => r.status === 200 && r.json().loads.concurrent === 1),
        );
        assert.equal((await get("/_fixture/cache/retry")).status, 503);
        assert.equal((await get("/_fixture/cache/retry")).status, 200);
        await advance();
        assert.equal(
          (await get("/_fixture/cache/concurrent")).json().loads.concurrent,
          2,
        );
      },
    );
    await check(
      "league manifest fallback",
      "saved row absent: valid manifest 200; malformed/missing manifest 503 on GET and HEAD",
      async () => {
        await admin.query(
          "DELETE FROM statarena.resources WHERE endpoint='/leagues'",
        );
        const results = [];
        try {
          await put(
            manifestPath,
            Buffer.from(
              JSON.stringify({
                seasons: [
                  {
                    chunks: [
                      {
                        competitions: [
                          { id: "l_000001", name: "Fixture League" },
                        ],
                      },
                    ],
                  },
                ],
              }),
            ),
          );
          await start();
          for (const method of ["GET", "HEAD"]) {
            const r = await get("/api/pitchapi/leagues", { method });
            results.push({ expected: 200, status: r.status });
            if (method === "GET" && r.status === 200)
              assert.equal(r.json().data.leagues[0].name, "Fixture League");
          }
          await put(manifestPath, Buffer.from("{"));
          await advance();
          for (const method of ["GET", "HEAD"])
            results.push({
              expected: 503,
              status: (await get("/api/pitchapi/leagues", { method })).status,
            });
          await admin.query("DELETE FROM statarena.objects WHERE path=$1", [
            manifestPath,
          ]);
          await advance();
          for (const method of ["GET", "HEAD"])
            results.push({
              expected: 503,
              status: (await get("/api/pitchapi/leagues", { method })).status,
            });
          for (const result of results)
            assert.equal(result.status, result.expected);
        } finally {
          await put(manifestPath, body);
          await admin.query(
            "INSERT INTO statarena.resources(endpoint,ref,status) VALUES('/leagues',$1,200)",
            [{ path: "raw/fixture-leagues.json" }],
          );
          await start();
        }
        return results;
      },
    );
    await check(
      "repeated publication race is bounded",
      "two metadata/body attempts, then 503; no indefinite retries",
      async () => {
        await put("raw/fixture-racing.json", Buffer.from('{"version":1}'));
        await telemetry();
        await admin.query(
          "ALTER TABLE statarena.objects RENAME TO fixture_objects",
        );
        try {
          await admin.query(
            `CREATE FUNCTION statarena.fixture_race(p text, incoming bytea) RETURNS bytea LANGUAGE plpgsql VOLATILE AS $$ BEGIN IF p='raw/fixture-racing.json' THEN UPDATE statarena.fixture_objects SET body=body||' '::bytea, size=size+1, sha256=sha256(body||' '::bytea) WHERE path=p; END IF; RETURN incoming; END $$`,
          );
          await admin.query(
            "CREATE VIEW statarena.objects AS SELECT path,size,sha256,etag,statarena.fixture_race(path,body) AS body,content_type,updated_at FROM statarena.fixture_objects",
          );
          const r = await get("/data/raw/fixture-racing.json");
          const rows = await telemetry();
          assert.equal(r.status, 503);
          assert.equal(r.headers["cache-control"], "no-store");
          assert.equal(total(rows, "sql_count"), 4);
          return { telemetry: rows };
        } finally {
          await admin.query("DROP VIEW IF EXISTS statarena.objects");
          await admin.query(
            "ALTER TABLE statarena.fixture_objects RENAME TO objects",
          );
          await admin.query(
            "DROP FUNCTION IF EXISTS statarena.fixture_race(text,bytea)",
          );
        }
      },
    );
    await check(
      "1/5/20 concurrent public reads",
      "no cross-request metric contamination, all exact bytes",
      async () => {
        await get("/data/dashboard-manifest.json");
        await telemetry();
        const levels = [];
        for (const count of [1, 5, 20]) {
          await advance();
          const group = await Promise.all(
            Array.from({ length: count }, () =>
              get("/data/dashboard-manifest.json"),
            ),
          );
          assert.ok(
            group.every((r) => r.status === 200 && r.bytes.equals(body)),
          );
          const rows = await telemetry();
          levels.push({
            count,
            timings: group.map((r) => r.ms),
            telemetry: rows,
          });
        }
        for (const level of levels) {
          assert.equal(level.telemetry.length, level.count);
          noBodies(level.telemetry);
          assert.equal(total(level.telemetry, "sql_count"), 1);
        }
        return levels;
      },
    );
    await check(
      "metrics sampling and redaction",
      "sample=0 emits no event; sample=1 no identifiers or fixture URL/password",
      async () => {
        const events = appLog
          .join("")
          .split("\n")
          .flatMap((line) => {
            try {
              const row = JSON.parse(line);
              return row.event === "statarena.request" ? [row] : [];
            } catch {
              return [];
            }
          });
        assert.ok(events.length);
        for (const event of events) {
          const text = JSON.stringify(event);
          assert.doesNotMatch(
            text,
            /p_000001|m_000001|l_000001|fixture\.invalid|local-fixture-only|postgresql:\/\//,
          );
          assert.ok(Number.isFinite(event.duration_ms));
        }
        await start("0");
        await get("/api/health");
        assert.deepEqual(await telemetry(), []);
        return { sampledEvents: events.length };
      },
    );
    if (process.env.STATARENA_TEST_NEXT === "1") {
      for (const embedded of [true, false])
        await check(
          `Next production ${embedded ? "embedded" : "HTTP proxy"}`,
          "built Next forwards policy, source, ETag and conditional/HEAD semantics",
          async () => {
            const listener = Bun.listen({
              hostname: "127.0.0.1",
              port: 0,
              socket: { data() {} },
            });
            const nextPort = listener.port;
            listener.stop(true);
            const nextOrigin = `http://127.0.0.1:${nextPort}`;
            const next = Bun.spawn(
              [
                "node",
                path.join(root, "dashboard/node_modules/next/dist/bin/next"),
                "start",
                path.join(root, "dashboard/frontend"),
                "--hostname",
                "127.0.0.1",
                "--port",
                String(nextPort),
              ],
              {
                cwd: path.join(root, "dashboard"),
                env: {
                  PATH: process.env.PATH,
                  HOME: process.env.HOME,
                  NEXT_TELEMETRY_DISABLED: "1",
                  ORION_EMBEDDED_API: embedded ? "1" : "0",
                  ORION_API_ORIGIN: origin,
                  NEON_DATABASE_URL: dbUrl.href,
                  NEON_STORAGE_ENDPOINT: storage.url.href,
                  NEON_STORAGE_BUCKET: "fixture",
                  NEON_STORAGE_REGION: "us-east-2",
                  NEON_STORAGE_ACCESS_KEY_ID: "fixture",
                  NEON_STORAGE_SECRET_ACCESS_KEY: "fixture",
                  STATARENA_METRICS_SAMPLE_RATE: "1",
                  STATARENA_SERVER_TIMING: "1",
                },
                stdout: "pipe",
                stderr: "pipe",
              },
            );
            const nextLog = Promise.all(
              [next.stdout, next.stderr].map(async (stream) => {
                for await (const data of stream)
                  appLog.push(new TextDecoder().decode(data));
              }),
            );
            try {
              let ready = false;
              for (let n = 0; n < 120; n++) {
                try {
                  if (
                    (await fetch(nextOrigin + "/api/health")).status === 200
                  ) {
                    ready = true;
                    break;
                  }
                } catch {}
                if (next.exitCode !== null) break;
                await Bun.sleep(100);
              }
              assert.ok(ready, "Next production ready");
              const before = origin;
              origin = nextOrigin;
              try {
                const file = await get("/data/dashboard-manifest.json");
                assert.equal(file.status, 200);
                assert.deepEqual(file.bytes, body);
                assert.equal(
                  (
                    await get("/data/dashboard-manifest.json", {
                      headers: { "If-None-Match": `W/"${hash(body)}"` },
                    })
                  ).status,
                  304,
                );
                const head = await get("/data/dashboard-manifest.json", {
                  method: "HEAD",
                });
                assert.equal(head.status, 200);
                assert.equal(head.bytes.length, 0);
                assert.equal(head.headers.etag, file.headers.etag);
                const player = await get("/api/pitchapi/players/p_000001");
                assert.equal(player.status, 200);
                assert.match(player.headers["cache-control"], /s-maxage=3600/);
                assert.equal(
                  player.headers["vercel-cdn-cache-control"],
                  "public, s-maxage=3600, stale-while-revalidate=30",
                );
                assert.equal(player.headers["x-data-source"], "Neon");
                assert.equal(
                  (await get("/api/pitchapi/players/p_000003")).headers[
                    "cache-control"
                  ],
                  "no-store",
                );
                assert.equal(
                  (await get("/api/health", { method: "HEAD" })).bytes.length,
                  0,
                );
              } finally {
                origin = before;
              }
            } finally {
              next.kill("SIGTERM");
              await next.exited;
              await nextLog;
            }
          },
        );
    }
    report.status = report.checks.every((c) => c.status === "passed")
      ? "passed"
      : "failed";
  } catch (error) {
    report.error = error.stack;
  } finally {
    if (child) {
      child.kill("SIGTERM");
      await child.exited;
      await drain;
    }
    if (admin) await admin.end();
    if (postgres) {
      try {
        await postgres.stop();
      } catch (e) {
        sqlLog.push(String(e));
      }
    }
    storage.stop(true);
    await writeFile(
      path.join(evidence, "results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    await writeFile(path.join(evidence, "postgres.log"), sqlLog.join(""));
    await writeFile(path.join(evidence, "application.log"), appLog.join(""));
    await writeFile(
      path.join(evidence, "object-requests.json"),
      JSON.stringify(objectReads, null, 2) + "\n",
    );
    await rm(scratch, { recursive: true, force: true });
    console.log(
      JSON.stringify({
        status: report.status,
        error: report.error,
        checks: report.checks.length,
        failures: report.checks
          .filter((c) => c.status === "failed")
          .map((c) => ({ name: c.name, error: c.error.split("\n")[0] })),
        evidence,
      }),
    );
    if (report.status !== "passed") process.exitCode = 1;
  }
}
