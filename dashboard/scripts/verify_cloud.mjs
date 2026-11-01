/** HTTP E2E of the embedded Bun backend and immutable GitHub data transport. */
import assert from "node:assert/strict";
import { pages } from "../shared/pages.js";
const base = process.env.ORION_VERIFY_URL || "http://127.0.0.1:3001";
const report = {
  command: `cd dashboard && ORION_VERIFY_URL=${base} bun scripts/verify_cloud.mjs`,
  setup: "Running production Next.js/Bun app with GitHub-backed canonical data",
  status: "failed",
  checks: [],
};
async function json(path) {
  const r = await fetch(base + path);
  assert.equal(r.status, 200, path);
  const value = await r.json();
  assert.ok(
    !/pk_(?:test|live)_[A-Za-z0-9_-]+/.test(JSON.stringify(value)),
    "Credential in response",
  );
  report.checks.push({ path, httpStatus: r.status, redirected: r.redirected });
  return value;
}
try {
  for (const page of pages) {
    const r = await fetch(base + page.path);
    assert.equal(r.status, 200, page.path);
    assert.match(await r.text(), /_next\//);
  }
  assert.deepEqual(await json("/api/health"), { status: "ok", runtime: "bun" });
  const settings = await json("/api/settings");
  assert.equal(settings.schedule.timezone, "Europe/Paris");
  assert.equal(settings.schedule.cron, "0 0 * * *");
  const manifest = await json("/data/football-manifest.json");
  assert.equal(manifest.storage, "json-relational");
  assert.ok(manifest.seasons.length >= 6);
  const raw = await fetch(base + "/data/football-manifest.json", {
    redirect: "manual",
  });
  assert.equal(raw.status, 307);
  assert.match(
    raw.headers.get("location"),
    /^https:\/\/raw\.githubusercontent\.com\/OrionQuantPlatform\/Football_Ranking\/[a-f0-9]{40}\/data\/raw\/index.json$/,
  );
  report.dataLocation = raw.headers.get("location");
  const archive = await json("/api/archive/matches/m_4XOc3a");
  assert.equal(archive.fixture.id, "m_4XOc3a");
  assert.equal(Object.keys(archive.endpoints).length, 13);
  assert.equal(
    (await json("/api/archive/profiles/players/p_0M05q3")).data.id,
    "p_0M05q3",
  );
  for (const p of [
    "/.env",
    "/backend/server.js",
    "/data/sources/pitchapi/bundles/europe_2026_2027/manifest.json",
    "/data/raw/%2e%2e/%2e%2e/.env",
  ]) {
    assert.ok([403, 404].includes((await fetch(base + p)).status), p);
  }
  report.actual = {
    routes: pages.length,
    archivedFamilies: 13,
    seasons: manifest.seasons.length,
    runtime: "bun",
    configured: settings.configured,
  };
  report.status = "passed";
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
}
await Bun.write(
  new URL(
    "../outputs/vercel-daily/" +
      (process.env.ORION_VERIFY_URL ? "live-http.json" : "cloud-http.json"),
    import.meta.url,
  ),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
