import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";

const partitionDigest = "a".repeat(64);

async function probe({
  compact = false,
  wrongGeneration = false,
  wrongPartitionGeneration = false,
  required = false,
} = {}) {
  const requests = [],
    generation = "7";
  const manifest = {
    storage: "aws-relational",
    publicationVersion: generation,
    defaultSeason: "2026/2027",
    seasons: [
      {
        id: "2026/2027",
        chunks: [
          {
            leagueId: "l_000001",
            sourceDigest: partitionDigest,
            meta: { matchCount: 4 },
          },
        ],
      },
    ],
    capabilities: compact
      ? {
          versionedPartitions: true,
          compactReads: Object.fromEntries(
            [
              "home",
              "players",
              "clubs",
              "player",
              "club",
              "performance",
              "discipline",
            ].map((kind) => [kind, true]),
          ),
        }
      : {},
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    requests.push({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    });
    const etag = 'W/"fixture-7"';
    res.setHeader("ETag", etag);
    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=30, must-revalidate",
    );
    res.setHeader("Content-Type", "application/json");
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    const page = {
      page: Number(url.searchParams.get("page") || 1),
      limit: 3,
      total: 1,
      pages: 1,
      generation,
    };
    let body;
    switch (url.pathname) {
      case "/api/health":
        body = { source: "AWS", status: "ok" };
        break;
      case "/api/dashboard/manifest":
        body = manifest;
        break;
      case "/api/seasons/partition":
        body = {
          data: {},
          pagination: {
            nextCursor: null,
            generation: wrongPartitionGeneration
              ? "b".repeat(64)
              : partitionDigest,
          },
        };
        break;
      case "/api/read/home":
        body = { data: { period: { startDay: "2026-11-02" }, results: [] } };
        break;
      case "/api/read/players":
        body = {
          data: {
            players: (page.page === 1 ? [1, 2, 3] : [4]).map((n) => ({
              id: "p_" + String(n).padStart(6, "0"),
            })),
          },
          pagination: { ...page, total: 4, pages: 2 },
        };
        break;
      case "/api/read/clubs":
        body = { data: { clubs: [{ id: "t_000001" }] }, pagination: page };
        break;
      case "/api/read/player":
        body = {
          data: {
            matches: [{ id: "m_000001" }],
            appearances: [{ id: "a1", playerId: "p_000001" }],
            meta: { shotsLoaded: false },
          },
          pagination: page,
        };
        break;
      case "/api/read/performance":
        body = { data: { row: { id: "a1" }, profile: {}, rank: null } };
        break;
      case "/api/read/discipline":
        body = {
          data: {
            yellow: 0,
            directRed: 0,
            secondYellow: 0,
            covered: 1,
            total: 1,
          },
        };
        break;
      case "/api/read/club":
        body = {
          data: {
            matches: [],
            fixtures: [],
            appearances: [],
            meta: { shotsLoaded: false, appearancesLoaded: false },
          },
          pagination: page,
        };
        break;
      default:
        res.writeHead(404);
        res.end("{}");
        return;
    }
    if (url.pathname.startsWith("/api/read/"))
      body.meta = { generation: wrongGeneration ? "8" : generation };
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const child = spawn(
      process.execPath,
      ["dashboard/scripts/verify_aws_runtime.mjs"],
      {
        cwd: new URL("..", import.meta.url),
        env: {
          ...process.env,
          STATARENA_TEST_ORIGIN: `http://127.0.0.1:${server.address().port}`,
          STATARENA_BASELINE_ORIGIN: "",
          STATARENA_TEST_EVIDENCE: "",
          STATARENA_REQUIRE_COMPACT: required ? "1" : "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(stderr, "");
    return { code, report: JSON.parse(stdout), requests };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("acceptance retains legacy compatibility without pretending compact reads were checked", async () => {
  const result = await probe();
  assert.equal(result.code, 0);
  assert.equal(result.report.passed, true);
  assert.deepEqual(result.report.compactReads.advertised, []);
  assert.equal(result.requests.length, 3);
});

test("acceptance checks bounded compact reads, actor details, ETags and a second generation-bound page", async () => {
  const result = await probe({ compact: true, required: true });
  assert.equal(result.code, 0, result.report.error);
  assert.deepEqual(result.report.compactReads.unexercised, []);
  assert.equal(
    result.requests.find((r) => r.path === "/api/seasons/partition").query.v,
    partitionDigest,
  );
  const compact = result.requests.filter((r) =>
    r.path.startsWith("/api/read/"),
  );
  assert.ok(
    compact.every(
      (r) => r.query.generation === "7" && r.query.leagues === "l_000001",
    ),
  );
  assert.ok(compact.every((r) => !r.query.include));
  assert.ok(compact.some((r) => r.query.page === "2"));
  assert.ok(
    result.report.checks.some((r) => r.status === 304 && r.bytes === 0),
  );
});

test("acceptance rejects a different partition digest before compact reads", async () => {
  const result = await probe({ compact: true, wrongPartitionGeneration: true });
  assert.equal(result.code, 1);
  assert.equal(result.report.passed, false);
  assert.match(result.report.error, /Partition generation differs/);
  assert.ok(result.requests.every((r) => !r.path.startsWith("/api/read/")));
});

test("acceptance rejects mixed publications and a partial capability rollout", async () => {
  const mixed = await probe({ compact: true, wrongGeneration: true });
  assert.equal(mixed.code, 1);
  assert.match(mixed.report.error, /Mixed publication/);
  const missing = await probe({ required: true });
  assert.equal(missing.code, 1);
  assert.match(missing.report.error, /Every compact capability/);
});
