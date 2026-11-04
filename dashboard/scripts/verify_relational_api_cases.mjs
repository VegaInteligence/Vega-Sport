import assert from "node:assert/strict";
export async function verify(origin) {
  const report = {
    setup:
      "Real typed relational publication in temporary PostgreSQL, actual Bun WebRequest API, SELECT-only startup options. No external data source or files.",
    command:
      "STATARENA_CORE_API=1 STATARENA_CORE_EVIDENCE=docs/verification/aws-relational-core-20261104/api-replayed bun dashboard/scripts/verify_relational_core.mjs",
    expected:
      "Health, SQL-generated manifest, complete bounded season traversal, fixtures and small match summaries with metadata-only validators.",
    checks: [],
    requests: [],
    status: "failed",
  };
  async function get(path, options) {
    const response = await fetch(origin + path, options);
    const text = await response.text();
    report.requests.push({
      path,
      method: options?.method || "GET",
      status: response.status,
      bytes: Buffer.byteLength(text),
      headers: Object.fromEntries(response.headers),
      body: text,
    });
    let value;
    try {
      value = JSON.parse(text);
    } catch {}
    return { response, text, value };
  }
  async function check(name, fn) {
    try {
      await fn();
      report.checks.push({ name, passed: true });
    } catch (error) {
      report.checks.push({ name, passed: false, error: error.message });
    }
  }
  await check("AWS health uses the serving database", async () => {
    const { response, value } = await get("/api/health");
    assert.equal(response.status, 200);
    assert.equal(value.source, "AWS");
  });
  await check(
    "manifest names relational storage and committed partitions",
    async () => {
      const { response, value } = await get("/api/dashboard/manifest");
      assert.equal(response.status, 200);
      assert.equal(value.storage, "aws-relational");
      assert.equal(value.seasons[0].chunks.length, 2);
    },
  );
  await check(
    "season pages preserve full records and complete traversal",
    async () => {
      let cursor,
        ids = [],
        attempts = 0;
      do {
        const { response, value } = await get(
          "/api/seasons/partition?season=2026%2F2027&league=l_000001&limit=1" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
        );
        assert.equal(response.status, 200);
        assert.ok(value.data.meta);
        assert.equal(value.data.matches.length, 1);
        ids.push(value.data.matches[0].id);
        const appearance = value.data.appearances[0];
        assert.equal(appearance.positionId, value.data.matches[0].id === "m_000001" ? 11 : "11");
        assert.ok(!Object.hasOwn(appearance,"positionIdType"));
        if (value.data.matches[0].id === "m_000001") {
          assert.equal(value.data.appearances[0].passesAttempted, 5);
          assert.equal(value.data.matches[0].shots[0].goalCrossedZ, 1.4);
        }
        cursor = value.pagination.nextCursor;
        assert.ok(++attempts < 5);
      } while (cursor);
      assert.deepEqual(ids.sort(), ["m_000001", "m_000002"]);
    },
  );
  await check(
    "invalid season/cursor and page sizes reject before reads",
    async () => {
      for (const query of [
        "season=oops&league=l_000001",
        "season=2026%2F2027&league=l_000001&limit=101",
        "season=2026%2F2027&league=l_000001&cursor=%7Bbad%7D",
      ])
        assert.equal(
          (await get("/api/seasons/partition?" + query)).response.status,
          400,
        );
    },
  );
  await check("fixtures have stable bounded public shape", async () => {
    const { response, value } = await get(
      "/api/fixtures?league=l_000001&season=2026%2F2027&limit=1",
    );
    assert.equal(response.status, 200);
    assert.equal(value.data.matches.length, 1);
    assert.ok(value.data.matches[0].home_team.id);
    assert.ok(value.pagination.nextCursor);
  });
  await check(
    "overview is small and preserves observed zeros/null",
    async () => {
      const { response, value, text } = await get(
        "/api/matches/m_000001/summary",
      );
      assert.equal(response.status, 200);
      assert.equal(value.data.match.home.score, 1);
      assert.equal(value.data.match.away.score, 0);
      assert.ok(Buffer.byteLength(text) < 16384);
      assert.equal(value.data.match.summaryVersion, 1);
      assert.ok(!Object.hasOwn(value.data.match, "appearances"));
    },
  );
  await check(
    "summary conditional and HEAD validators have no bodies",
    async () => {
      const first = await get("/api/matches/m_000001/summary");
      const etag = first.response.headers.get("etag");
      assert.ok(etag);
      const unchanged = await get("/api/matches/m_000001/summary", {
        headers: { "If-None-Match": etag },
      });
      assert.equal(unchanged.response.status, 304);
      assert.equal(unchanged.text, "");
      const head = await get("/api/matches/m_000001/summary", {
        method: "HEAD",
      });
      assert.equal(head.response.status, 200);
      assert.equal(head.text, "");
      assert.equal(head.response.headers.get("etag"), etag);
    },
  );
  await check(
    "missing match and obsolete file routes never fall back",
    async () => {
      assert.equal(
        (await get("/api/matches/m_ZZZZZZ/summary")).response.status,
        404,
      );
      assert.ok(
        [404, 410].includes(
          (await get("/data/dashboard-manifest.json")).response.status,
        ),
      );
    },
  );
  await check(
    "path and method checks are independent of database data",
    async () => {
      assert.equal((await get("/api/%00")).response.status, 400);
      assert.equal(
        (await get("/api/health", { method: "POST" })).response.status,
        405,
      );
    },
  );
  await check(
    "AWS mode never falls back to a legacy database URL",
    async () => {
      const { closeDatabase } = await import("../backend/services/postgres.js");
      await closeDatabase();
      const current = process.env.DATABASE_URL,
        legacy = process.env.NEON_DATABASE_URL;
      process.env.NEON_DATABASE_URL = current;
      delete process.env.DATABASE_URL;
      try {
        assert.equal((await get("/api/health")).response.status, 503);
      } finally {
        process.env.DATABASE_URL = current;
        if (legacy === undefined) delete process.env.NEON_DATABASE_URL;
        else process.env.NEON_DATABASE_URL = legacy;
        await closeDatabase();
      }
    },
  );
  report.status = report.checks.every((x) => x.passed) ? "passed" : "failed";
  return report;
}
