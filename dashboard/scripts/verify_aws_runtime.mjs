/** Read-only acceptance for an AWS-backed site or API. No database credentials. */
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const origin = (process.env.STATARENA_TEST_ORIGIN || "https://d317dq37z1tacb.cloudfront.net").replace(/\/$/, "");
const baselineOrigin = process.env.STATARENA_BASELINE_ORIGIN?.replace(/\/$/, "");
const report = { origin, checkedAt: new Date().toISOString(), checks: [], passed: false };
async function json(base, route) {
  const start = performance.now();
  const response = await fetch(base + route, { signal: AbortSignal.timeout(30000), headers: { Accept: "application/json" } });
  report.checks.push({ route, origin: base, status: response.status, elapsedMs: Math.round(performance.now() - start) });
  assert.equal(response.status, 200, `HTTP ${response.status}: ${route}`);
  const body = await response.json();
  assert.ok(!body.error, `API error: ${route}`);
  return body;
}
const scopes = (manifest) => new Set(manifest.seasons.flatMap((season) => season.chunks.map((chunk) => `${season.id}:${chunk.leagueId}`)));
try {
  const health = await json(origin, "/api/health");
  assert.equal(health.source, "AWS"); assert.equal(health.status, "ok");
  const manifest = await json(origin, "/api/dashboard/manifest");
  assert.ok(["aws-relational", "aws-orion-pro"].includes(manifest.storage), "An AWS SQL manifest is required");
  const actual = scopes(manifest); assert.ok(actual.size, "The catalogue is empty");
  report.catalogue = { seasons: manifest.seasons.length, partitions: actual.size,
    competitions: new Set(manifest.seasons.flatMap((season) => season.chunks.map((chunk) => chunk.leagueId))).size };
  if (baselineOrigin) {
    const before = await json(baselineOrigin, "/api/dashboard/manifest");
    report.missingPartitions = [...scopes(before)].filter((scope) => !actual.has(scope));
    assert.deepEqual(report.missingPartitions, [], "The AWS catalogue must retain every existing competition/season");
  }
  // A bounded representative read from each season verifies more than health.
  for (const season of manifest.seasons) {
    const chunk = season.chunks[0];
    const params = new URLSearchParams({ league: chunk.leagueId, season: season.id, limit: "3", format: "columns" });
    if (chunk.representationToken) params.set("v", chunk.representationToken);
    const page = await json(origin, "/api/seasons/partition?" + params);
    assert.ok(page.data && page.pagination && Object.hasOwn(page.pagination, "nextCursor"));
    if (chunk.representationToken) assert.equal(page.pagination.generation, chunk.representationToken);
  }
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
