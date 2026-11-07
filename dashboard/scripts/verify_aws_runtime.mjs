/** Read-only acceptance for an AWS-backed site or API. No database credentials. */
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const origin = (
  process.env.STATARENA_TEST_ORIGIN || "https://d317dq37z1tacb.cloudfront.net"
).replace(/\/$/, "");
const baselineOrigin = process.env.STATARENA_BASELINE_ORIGIN?.replace(
  /\/$/,
  "",
);
const report = {
  origin,
  checkedAt: new Date().toISOString(),
  checks: [],
  passed: false,
};
async function json(
  base,
  route,
  { maxBytes = 2 * 1024 * 1024, headers = {}, status = 200 } = {},
) {
  const start = performance.now();
  const response = await fetch(base + route, {
    signal: AbortSignal.timeout(30000),
    headers: { Accept: "application/json", ...headers },
  });
  const text = await response.text(),
    bytes = Buffer.byteLength(text);
  const check = {
    route,
    origin: base,
    status: response.status,
    elapsedMs: Math.round(performance.now() - start),
    bytes,
    etag: response.headers.get("etag"),
    cacheControl: response.headers.get("cache-control"),
  };
  report.checks.push(check);
  assert.equal(response.status, status, `HTTP ${response.status}: ${route}`);
  assert.ok(bytes <= maxBytes, `Payload exceeds ${maxBytes} bytes: ${route}`);
  if (status === 304) {
    assert.equal(bytes, 0);
    return null;
  }
  const body = JSON.parse(text);
  assert.ok(!body.error, `API error: ${route}`);
  return body;
}
const scopes = (manifest) =>
  new Set(
    manifest.seasons.flatMap((season) =>
      season.chunks.map((chunk) => `${season.id}:${chunk.leagueId}`),
    ),
  );

async function compactChecks(manifest) {
  const capabilities = manifest.capabilities?.compactReads || {};
  const expected = [
    "home",
    "players",
    "clubs",
    "player",
    "club",
    "performance",
    "discipline",
  ];
  report.compactReads = {
    advertised: expected.filter((kind) => capabilities[kind] === true),
    checked: [],
  };
  if (process.env.STATARENA_REQUIRE_COMPACT === "1")
    assert.deepEqual(
      report.compactReads.advertised,
      expected,
      "Every compact capability must be deployed",
    );
  if (!report.compactReads.advertised.length) return;
  assert.equal(manifest.storage, "aws-relational");
  const generation =
    manifest.publicationVersion || manifest.scouting?.sourceDigest;
  assert.match(
    generation || "",
    /^\d+$/,
    "Missing compact publication generation",
  );
  const season =
    manifest.seasons.find((item) => item.id === manifest.defaultSeason) ||
    manifest.seasons[0];
  const chunk =
    season.chunks.find((item) => item.meta?.matchCount > 0) || season.chunks[0];
  const scope = { season: season.id, leagues: chunk.leagueId, generation };
  const route = (kind, extra = {}) =>
    "/api/read/" + kind + "?" + new URLSearchParams({ ...scope, ...extra });
  async function read(kind, extra = {}) {
    const body = await json(origin, route(kind, extra), {
      maxBytes: ["player", "club"].includes(kind)
        ? 2 * 1024 * 1024
        : kind === "performance"
          ? 256 * 1024
          : kind === "discipline"
            ? 64 * 1024
            : 1024 * 1024,
    });
    assert.equal(
      body.meta?.generation,
      generation,
      `Mixed publication: ${kind}`,
    );
    if (body.pagination) {
      assert.equal(body.pagination.generation, generation);
      assert.equal(body.pagination.limit, Number(extra.limit || 3));
      assert.ok(
        Number.isSafeInteger(body.pagination.total) &&
          body.pagination.total >= 0,
      );
    }
    report.compactReads.checked.push(kind);
    return body;
  }
  if (capabilities.home) {
    const home = await read("home");
    assert.ok(
      home.data &&
        Object.hasOwn(home.data, "period") &&
        Array.isArray(home.data.results),
    );
  }
  let players, clubs;
  if (capabilities.players) {
    players = await read("players", { limit: "3" });
    assert.ok(
      Array.isArray(players.data.players) && players.data.players.length <= 3,
    );
    const etag = report.checks.at(-1).etag;
    assert.ok(etag, "Compact reads must expose an ETag");
    await json(origin, route("players", { limit: "3" }), {
      headers: { "If-None-Match": etag },
      status: 304,
    });
    if (players.pagination.total > 3) {
      const next = await read("players", { limit: "3", page: "2" });
      const ids = new Set(players.data.players.map((player) => player.id));
      assert.ok(next.data.players.length > 0 && next.data.players.length <= 3);
      assert.ok(
        next.data.players.every((player) => !ids.has(player.id)),
        "Duplicate player across pages",
      );
    }
  }
  if (capabilities.clubs) {
    clubs = await read("clubs", { limit: "3" });
    assert.ok(Array.isArray(clubs.data.clubs) && clubs.data.clubs.length <= 3);
  }
  const player = players?.data.players[0];
  if (capabilities.player && player) {
    const page = await read("player", {
      player: player.playerId || player.id,
      limit: "3",
    });
    assert.ok(page.data.matches.length <= 3);
    assert.equal(page.data.meta.shotsLoaded, false, "Shots must remain lazy");
    assert.ok(
      page.data.appearances.every(
        (row) => row.playerId === (player.playerId || player.id),
      ),
      "Actor route leaked other players",
    );
    if (capabilities.performance && page.data.appearances[0]) {
      const appearance = page.data.appearances[0];
      const detail = await read("performance", { appearance: appearance.id });
      assert.equal(detail.data.row.id, appearance.id);
      assert.ok(
        Object.hasOwn(detail.data, "profile") &&
          Object.hasOwn(detail.data, "rank"),
      );
    }
    if (capabilities.discipline && page.data.matches.length) {
      const matches = [...new Set(page.data.matches.map((match) => match.id))];
      const detail = await read("discipline", {
        player: player.playerId || player.id,
        matches: matches.join(","),
      });
      assert.equal(detail.data.total, matches.length);
      assert.ok(
        Number.isSafeInteger(detail.data.covered) &&
          detail.data.covered >= 0 &&
          detail.data.covered <= detail.data.total,
        "Invalid event coverage",
      );
      for (const kind of ["yellow", "directRed", "secondYellow"])
        assert.ok(
          Number.isSafeInteger(detail.data[kind]) && detail.data[kind] >= 0,
        );
    }
  }
  const club = clubs?.data.clubs[0];
  if (capabilities.club && club) {
    const page = await read("club", { team: club.id, limit: "3" });
    assert.ok(page.data.matches.length <= 3 && page.data.fixtures.length <= 3);
    assert.equal(page.data.meta.shotsLoaded, false);
    assert.equal(page.data.meta.appearancesLoaded, false);
    assert.deepEqual(page.data.appearances, []);
  }
  report.compactReads.unexercised = report.compactReads.advertised.filter(
    (kind) => !report.compactReads.checked.includes(kind),
  );
}

try {
  const health = await json(origin, "/api/health");
  assert.equal(health.source, "AWS");
  assert.equal(health.status, "ok");
  const manifest = await json(origin, "/api/dashboard/manifest");
  assert.ok(
    ["aws-relational", "aws-orion-pro"].includes(manifest.storage),
    "An AWS SQL manifest is required",
  );
  const actual = scopes(manifest);
  assert.ok(actual.size, "The catalogue is empty");
  report.catalogue = {
    seasons: manifest.seasons.length,
    partitions: actual.size,
    competitions: new Set(
      manifest.seasons.flatMap((season) =>
        season.chunks.map((chunk) => chunk.leagueId),
      ),
    ).size,
  };
  if (baselineOrigin) {
    const before = await json(baselineOrigin, "/api/dashboard/manifest");
    report.missingPartitions = [...scopes(before)].filter(
      (scope) => !actual.has(scope),
    );
    assert.deepEqual(
      report.missingPartitions,
      [],
      "The AWS catalogue must retain every existing competition/season",
    );
  }
  // A bounded representative read from each season verifies more than health.
  for (const season of manifest.seasons) {
    const chunk = season.chunks[0];
    const params = new URLSearchParams({
      league: chunk.leagueId,
      season: season.id,
      limit: "3",
      format: "columns",
    });
    const token =
      chunk.representationToken ||
      (manifest.capabilities?.versionedPartitions ? chunk.sourceDigest : null);
    if (token) params.set("v", token);
    const page = await json(origin, "/api/seasons/partition?" + params);
    assert.ok(
      page.data &&
        page.pagination &&
        Object.hasOwn(page.pagination, "nextCursor"),
    );
    if (token)
      assert.equal(
        page.pagination.generation,
        token,
        "Partition generation differs from the requested version",
      );
  }
  await compactChecks(manifest);
  report.passed = true;
} catch (error) {
  report.error = error.message;
} finally {
  if (process.env.STATARENA_TEST_EVIDENCE) {
    const file = path.resolve(process.env.STATARENA_TEST_EVIDENCE);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(report, null, 2));
}
process.exitCode = report.passed ? 0 : 1;
