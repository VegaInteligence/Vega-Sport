/** HTTP E2E: actual production Next.js app, native Bun API and canonical data. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import net from "node:net";
import assert from "node:assert/strict";
import { pages } from "../shared/pages.js";
import { loadSeason } from "../frontend/src/season_data.js";
const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.resolve(appRoot, "..");
const out = path.resolve(
  appRoot,
  process.env.ORION_EVIDENCE_DIR || "outputs/next-migration",
);
const report = {
  command: `cd dashboard && bun run build && ${process.env.ORION_EVIDENCE_DIR ? `ORION_EVIDENCE_DIR=${process.env.ORION_EVIDENCE_DIR} ` : ""}bun run verify`,
  setup:
    "Production Next.js build and local canonical JSON data; native Bun API on ephemeral port; no provider key required",
  expected: `${pages.length} Next routes, 404 unknown route, real data/archive proxy, no private files or exposed credentials`,
  status: "failed",
  checks: [],
};
const children = [];
const logs = [];
async function port() {
  const s = net.createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const n = s.address().port;
  await new Promise((r) => s.close(r));
  return n;
}
async function launch(args, env = {}) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: appRoot,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr])
    (async () => {
      for await (const chunk of stream)
        logs.push(new TextDecoder().decode(chunk));
    })();
  return child;
}
async function ready(base, child) {
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(base);
      if (r.status < 500) return;
    } catch {}
    if (child.exitCode !== null) throw new Error(logs.join(""));
    await Bun.sleep(200);
  }
  throw new Error("Server readiness timed out");
}
try {
  const apiPort = await port(),
    webPort = await port();
  const api = `http://127.0.0.1:${apiPort}`,
    web = `http://127.0.0.1:${webPort}`;
  const backend = await launch([
    "backend/server.js",
    "--port",
    String(apiPort),
  ]);
  await ready(api + "/api/health", backend);
  const frontend = await launch(
    [
      "node_modules/next/dist/bin/next",
      "start",
      "frontend",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    { ORION_API_ORIGIN: api },
  );
  await ready(web, frontend);
  async function get(url) {
    const r = await fetch(web + url);
    assert.equal(r.status, 200, url);
    return r;
  }
  for (const page of pages) {
    const html = await (await get(page.path + "?season=2025%2F2026")).text();
    assert.match(html, /_next\//);
    assert.match(html, /orion/i);
    report.checks.push({ route: page.path, status: 200, next: true });
  }
  assert.equal((await fetch(web + "/unknown-page")).status, 404);
  assert.deepEqual(await (await get("/api/health")).json(), {
    status: "ok",
    runtime: "bun",
  });
  assert.deepEqual(
    await (await get("/data/football-manifest.json")).arrayBuffer(),
    await Bun.file(path.join(root, "data/raw/index.json")).arrayBuffer(),
  );
  const manifest = await (await get("/data/football-manifest.json")).json();
  for (const season of ["2026/2027", "2025/2026"]) {
    const data = await loadSeason(manifest, season, (url) =>
      fetch(web + "/data/" + String(url).split("/data/")[1]),
    );
    assert.ok(data.matches.length > 0);
    assert.ok(data.appearances.length > 0);
    report.checks.push({
      season,
      matches: data.matches.length,
      appearances: data.appearances.length,
    });
  }
  for (const season of manifest.seasons) {
    const ref = season.chunks[0].tables.matches;
    assert.deepEqual(
      await (await get("/data/" + ref.path)).arrayBuffer(),
      await Bun.file(path.join(root, "data", ref.path)).arrayBuffer(),
    );
  }
  const matches = await Bun.file(
    path.join(root, "data/raw/match-observations.json"),
  ).json();
  assert.ok(
    (
      await (
        await get("/api/archive/matches/" + Object.keys(matches)[0])
      ).json()
    ).endpoints,
  );
  const profiles = await Bun.file(
    path.join(root, "data/raw/profile-index.json"),
  ).json();
  const [kind, id] = Object.keys(profiles.entities)
    .find((x) => x.startsWith("players:"))
    .split(":");
  assert.equal(
    (await (await get(`/api/archive/profiles/${kind}/${id}`)).json()).data.id,
    id,
  );
  for (const url of [
    "/.env",
    "/backend/server.js",
    "/frontend/src/main.jsx",
    "/data/sources/rankings/fifa/catalogue.html",
    "/data/../.env",
    "/node_modules/next/package.json",
  ]) {
    const r = await fetch(web + url);
    assert.ok([403, 404].includes(r.status), url);
  }
  const file = await Bun.file(path.join(appRoot, ".env"))
    .text()
    .catch(() => "");
  const keys = [
    ...file.matchAll(/^\s*\w*(?:KEY|TOKEN|SECRET)\w*\s*=\s*(.+)$/gm),
  ]
    .map((m) => m[1].trim().replace(/^["']|["']$/g, ""))
    .filter((x) => x.length > 10);
  for await (const name of new Bun.Glob("**/*.{js,html}").scan(
    path.join(appRoot, "frontend/.next/static"),
  )) {
    const text = await Bun.file(
      path.join(appRoot, "frontend/.next/static", name),
    ).text();
    for (const key of keys)
      assert.ok(!text.includes(key), "Credential in public build");
  }
  report.checks.push(
    "Real Bun health, two complete seasons, six raw partitions, archive/profile, private path isolation and public credential scan passed",
  );
  report.status = "passed";
} catch (e) {
  report.error = e.stack;
  throw e;
} finally {
  for (const child of children) child.kill();
  await Promise.all(children.map((c) => c.exited));
  await Bun.write(
    path.join(out, "http-evidence.json"),
    JSON.stringify(report, null, 2),
  );
  await Bun.write(path.join(out, "http-runtime.log"), logs.join(""));
  console.log(JSON.stringify(report, null, 2));
}
