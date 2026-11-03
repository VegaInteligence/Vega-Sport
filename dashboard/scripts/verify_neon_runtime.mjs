/** HTTP E2E against running Next and Neon. No local data or provider key. */
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.STATARENA_TEST_ORIGIN || "http://127.0.0.1:3001";
const out =
  process.env.STATARENA_TEST_EVIDENCE ||
  "docs/verification/neon-runtime-20261103/http-e2e.json";
const report = {
  command: `STATARENA_TEST_ORIGIN=${base} bun dashboard/scripts/verify_neon_runtime.mjs`,
  setup:
    "Running Next.js with Neon-only runtime, pooled read-only PostgreSQL and private read-only S3; no data/ directory or Pitch key.",
  expected:
    "All pages 200, real verified chunks and archives, backend-only data, 304/HEAD semantics, invalid paths rejected, warm request coalescing.",
  checks: [],
  status: "failed",
};
async function get(path, options = {}) {
  const start = performance.now();
  const r = await fetch(base + path, { redirect: "error", ...options });
  const body = Buffer.from(await r.arrayBuffer());
  report.checks.push({
    path,
    status: r.status,
    bytes: body.length,
    ms: Math.round(performance.now() - start),
    source: r.headers.get("x-data-source"),
  });
  return { r, body };
}
const unpack = (t) =>
  t.rows.map((r, i) =>
    Object.fromEntries(
      t.keys.flatMap((k, j) =>
        (t.missing?.[i] || []).includes(j)
          ? []
          : [
              [
                k,
                t.dictionaries?.[j] && r[j] != null
                  ? t.dictionaries[j][r[j]]
                  : r[j],
              ],
            ],
      ),
    ),
  );
try {
  const health = await get("/api/health");
  assert.equal(health.r.status, 200);
  assert.equal(JSON.parse(health.body).source, "Neon");
  for (const p of [
    "/",
    "/matchs",
    "/calendrier",
    "/joueurs",
    "/clubs",
    "/competitions",
    "/archives",
    "/classement-joueurs",
    "/methode",
  ])
    assert.equal((await get(p)).r.status, 200, p);
  const { r, body } = await get("/data/dashboard-manifest.json");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-data-source"), "Neon");
  const manifest = JSON.parse(body);
  assert.equal(
    (
      await get("/data/dashboard-manifest.json", {
        headers: { "If-None-Match": r.headers.get("etag") },
      })
    ).r.status,
    304,
  );
  const head = await get("/data/dashboard-manifest.json", { method: "HEAD" });
  assert.equal(head.body.length, 0);
  // The hosting proxy may omit Content-Length on HEAD; the ETag remains required.
  const length = head.r.headers.get("content-length");
  if (length !== null) assert.equal(Number(length), body.length);
  assert.ok(head.r.headers.get("etag"));
  let sample;
  for (const season of manifest.seasons) {
    const chunk = season.chunks[0];
    if (!chunk) continue;
    const { r, body } = await get("/data/" + chunk.path);
    assert.equal(r.status, 200);
    assert.equal(createHash("sha256").update(body).digest("hex"), chunk.sha256);
    const doc = JSON.parse(gunzipSync(body));
    assert.equal(doc.format, "orion-packed-tables-v1");
    if (!sample)
      sample = {
        season: season.id,
        league: chunk.leagueId,
        fixtures: unpack(doc.tables.fixtures),
        players: unpack(doc.tables.players),
        matches: unpack(doc.tables.matches),
        teams: unpack(doc.tables.teams),
      };
  }
  const match = sample.matches[0],
    player = sample.players[0],
    team = sample.teams[0];
  for (const path of [
    `/api/archive/matches/${match.id}`,
    `/api/pitchapi/matches/${match.id}`,
    `/api/archive/profiles/players/${player.playerId}`,
    `/api/pitchapi/teams/${team.id}`,
    `/api/pitchapi/leagues/${sample.league}/matches?season=${encodeURIComponent(sample.season)}&status=all`,
    `/api/pitchapi/date/${sample.fixtures[0].date}?status=all`,
  ]) {
    const { r, body } = await get(path);
    assert.equal(r.status, 200, path + " " + body.toString().slice(0, 200));
    assert.equal(r.headers.get("x-data-source"), "Neon");
    assert.ok(JSON.parse(body));
  }
  for (const path of [
    "/data/raw/not-present.json",
    "/api/pitchapi/players/p_zzzzzz",
  ])
    assert.equal((await get(path)).r.status, 404);
  assert.equal(
    (await get("/api/pitchapi/leagues?url=https://api.pitchapi.dev")).r.status,
    400,
  );
  assert.equal(
    (await get("/data/dashboard-manifest.json", { method: "POST" })).r.status,
    405,
  );
  assert.equal((await get("/data/raw/%2eenv")).r.status, 403);
  const concurrent = await Promise.all(
    Array.from({ length: 20 }, () => get("/data/dashboard-manifest.json")),
  );
  assert.ok(concurrent.every((x) => x.r.status === 200));
  report.warmMs = report.checks
    .slice(-20)
    .map((c) => c.ms)
    .sort((a, b) => a - b);
  report.sample = {
    match: match.id,
    player: player.playerId,
    team: team.id,
    season: sample.season,
  };
  report.status = "passed";
} catch (e) {
  report.error = e.message;
  process.exitCode = 1;
} finally {
  await mkdir(out.slice(0, out.lastIndexOf("/")), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      status: report.status,
      error: report.error,
      checks: report.checks.length,
      report: out,
    }),
  );
}
