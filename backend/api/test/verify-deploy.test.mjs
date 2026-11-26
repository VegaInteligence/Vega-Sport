// The checks at the end of a Deploy (infra/aws/verify-deploy.mjs, step 11b of deploy.sh; FAILURE_MODES_OPTIMISATIONS.md
// GH202-a to GH202-d, written before this test): the read API's release as the distribution serves it (a local origin;
// GH202-a the real handler on the API seed) and the worker and the backfill as ECS runs them (a stand-in `aws`
// answering as `aws ecs describe-services --output json` does), each failure made by changing one answer; and nothing
// else asked: the home's personal read is step 12's probe's alone (smoke-favourites.mjs, GH220.3, PR #240).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, writeFile, readFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { context, skip } from "./context.mjs";
import { createHandler } from "../src/handler.mjs";

const SCRIPT = fileURLToPath(new URL("../../../infra/aws/verify-deploy.mjs", import.meta.url));
const RELEASE = "4".repeat(64);
const OLD = "3".repeat(64);
const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((done) => s.close(done)))));

const json = (status, value, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

// A local origin: `answer(url, real)` first (real: the seed's handler, its release VEGA_RELEASE; a 404 without the
// seed), else the handler. `seen`: every request, in order.
async function origin(answer = () => null) {
  const handle = context.reader ? createHandler({ read: context.reader.read, clock: () => context.now }) : null;
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    seen.push(url);
    const real = () => (handle ? handle(new Request(url, { method: req.method, headers: req.headers }))
      : json(404, { ok: false, error: { code: "RESOURCE_NOT_FOUND", retry: false } }));
    const response = (await answer(url, real)) || (await real());
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  servers.push(server);
  return Object.assign(`http://127.0.0.1:${server.address().port}`, { seen });
}

// The AWS CLI as `describe-services --output json` answers, from a JSON file the test writes; every call recorded.
async function fakeAws(services, { refuse = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "verify-aws-"));
  const state = join(dir, "services.json");
  await writeFile(state, JSON.stringify({ services, calls: 0 }));
  await writeFile(join(dir, "aws"), `#!${process.execPath}
const fs = require("node:fs"); const argv = process.argv.slice(2);
const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, "utf8")); s.calls++; fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(s));
if (${refuse}) { console.error("An error occurred (AccessDeniedException) when calling the DescribeServices operation: not authorized"); process.exit(254); }
if (argv.slice(0, 2).join(" ") !== "ecs describe-services") process.exit(99);
const names = argv.slice(argv.indexOf("--services") + 1).filter((a) => !a.startsWith("--"));
const step = Math.min(s.calls, s.services.length) - 1;
const now = s.services[step];
console.log(JSON.stringify({ services: names.map((name) => now[name]).filter(Boolean), failures: [] }));
`);
  await chmod(join(dir, "aws"), 0o755);
  return { dir, calls: async () => JSON.parse(await readFile(state, "utf8")).calls };
}
const TD = (family, revision) => `arn:aws:ecs:us-east-2:361769570630:task-definition/${family}:${revision}`;
const service = (name, desired, running, td, { deployments = 1, rollout = "COMPLETED" } = {}) => ({
  serviceName: name, desiredCount: desired, runningCount: running,
  deployments: Array.from({ length: deployments }, (_, i) => ({ status: i === 0 ? "PRIMARY" : "ACTIVE", taskDefinition: i === 0 ? td : TD(name, 1), rolloutState: rollout })),
});
const WANT = `vega-v2-worker=1@${TD("vega-v2-worker", 57)},vega-v2-backfill=0@${TD("vega-v2-backfill", 31)}`;
const healthy = { "vega-v2-worker": service("vega-v2-worker", 1, 1, TD("vega-v2-worker", 57)), "vega-v2-backfill": service("vega-v2-backfill", 0, 0, TD("vega-v2-backfill", 31)) };

async function verify(url, args, env = {}) {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [SCRIPT, String(url), ...args], { timeout: 120_000, env: { ...process.env, ...env } });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    return { code: error.code, out: (error.stdout || "") + (error.stderr || "") };
  }
}
const QUICK = ["--tries", "3", "--interval", "0", "--service-tries", "3", "--service-interval", "0"];

test("GH202-a /api/health names the package it runs, or null", { skip }, async () => {
  const handle = createHandler({ read: context.reader.read, clock: () => context.now });
  const before = process.env.VEGA_RELEASE;
  try {
    delete process.env.VEGA_RELEASE;
    assert.equal((await (await handle(new Request("https://api.test/api/health"))).json()).release, null);
    process.env.VEGA_RELEASE = `releases/v2-api/${RELEASE}.zip`;
    assert.equal((await (await handle(new Request("https://api.test/api/health"))).json()).release, RELEASE);
  } finally {
    if (before === undefined) delete process.env.VEGA_RELEASE;
    else process.env.VEGA_RELEASE = before;
  }
});

test("GH202-b the release served: retried until it is the new one, then a failure naming what was seen", async () => {
  const aws = await fakeAws([healthy]);
  const env = { PATH: `${aws.dir}:${process.env.PATH}` };
  let calls = 0;
  const flipping = await origin((url) => (url.pathname === "/api/health" ? json(200, { source: "AWS", status: "ok", revision: "7", release: ++calls < 3 ? OLD : RELEASE }) : null));
  const late = await verify(flipping, ["--release", RELEASE, "--services", WANT, ...QUICK], env);
  assert.equal(late.code, 0, late.out);
  assert.match(late.out, /^release: 200 ok, 444444444444 served \(try 3 of 3\)$/m);
  const never = await origin((url) => (url.pathname === "/api/health" ? json(200, { source: "AWS", status: "ok", revision: "7", release: OLD }) : null));
  const stale = await verify(never, ["--release", RELEASE, "--services", WANT, ...QUICK], env);
  assert.equal(stale.code, 1);
  assert.match(stale.out, /^release: FAILED after 3 tries: the distribution serves 333333333333, not 444444444444$/m);
  const down = await origin((url) => (url.pathname === "/api/health" ? json(503, { source: "AWS", status: "pending", revision: null, release: RELEASE }) : null));
  const unhealthy = await verify(down, ["--release", RELEASE, "--services", WANT, ...QUICK], env);
  assert.equal(unhealthy.code, 1);
  assert.match(unhealthy.out, /^release: FAILED after 3 tries: \/api\/health status 503$/m);
  // The other check still ran, and passed.
  assert.match(unhealthy.out, /^services: vega-v2-worker 1\/1 /m);
});

test("GH202-c the services: as deployed, else what differs, after the tries", async () => {
  const url = await origin((u) => (u.pathname === "/api/health" ? json(200, { source: "AWS", status: "ok", revision: "7", release: RELEASE }) : null));
  const run = async (sequence, options) => {
    const aws = await fakeAws(sequence, options);
    return { ...(await verify(url, ["--release", RELEASE, "--services", WANT, ...QUICK], { PATH: `${aws.dir}:${process.env.PATH}` })), calls: await aws.calls() };
  };
  const starting = { ...healthy, "vega-v2-worker": service("vega-v2-worker", 1, 0, TD("vega-v2-worker", 57), { rollout: "IN_PROGRESS" }) };
  const well = await run([starting, healthy]);
  assert.equal(well.code, 0, well.out);
  assert.match(well.out, /^services: vega-v2-worker 1\/1 on vega-v2-worker:57, vega-v2-backfill 0\/0 on vega-v2-backfill:31 \(try 2 of 3\)$/m);
  const cases = [
    [{ ...healthy, "vega-v2-worker": service("vega-v2-worker", 1, 0, TD("vega-v2-worker", 57)) }, /vega-v2-worker: 0 running of 1/],
    [{ ...healthy, "vega-v2-worker": service("vega-v2-worker", 1, 1, TD("vega-v2-worker", 57), { deployments: 2 }) }, /vega-v2-worker: 2 deployments/],
    [{ ...healthy, "vega-v2-worker": service("vega-v2-worker", 1, 1, TD("vega-v2-worker", 56)) }, /vega-v2-worker: on vega-v2-worker:56, not vega-v2-worker:57/],
    [{ ...healthy, "vega-v2-backfill": service("vega-v2-backfill", 1, 1, TD("vega-v2-backfill", 31)) }, /vega-v2-backfill: desired 1, not 0/],
    [{ ...healthy, "vega-v2-worker": service("vega-v2-worker", 1, 1, TD("vega-v2-worker", 57), { rollout: "IN_PROGRESS" }) }, /vega-v2-worker: rollout IN_PROGRESS/],
    [{ "vega-v2-worker": healthy["vega-v2-worker"] }, /vega-v2-backfill: not found/],
  ];
  for (const [state, reason] of cases) {
    const failed = await run([state]);
    assert.equal(failed.code, 1, failed.out);
    assert.match(failed.out, new RegExp(`^services: FAILED after 3 tries: .*${reason.source}`, "m"));
    assert.equal(failed.calls, 3);
  }
  const refused = await run([healthy], { refuse: true });
  assert.equal(refused.code, 1);
  assert.match(refused.out, /^services: FAILED after 3 tries: describe-services AccessDeniedException$/m);
});

test("GH202-d nothing but /api/health asked: no read of the home or of its favourites; the list's arguments refused", async () => {
  const aws = await fakeAws([healthy]);
  const env = { PATH: `${aws.dir}:${process.env.PATH}` };
  const health = (release) => (u) => (u.pathname === "/api/health" ? json(200, { source: "AWS", status: "ok", revision: "7", release }) : null);
  const args = ["--release", RELEASE, "--services", WANT, ...QUICK];
  const passing = await origin(health(RELEASE));
  const well = await verify(passing, args, env);
  assert.equal(well.code, 0, well.out);
  assert.deepEqual(passing.seen.map((u) => u.pathname + u.search), ["/api/health"]);
  assert.deepEqual(well.out.trim().split("\n").map((line) => line.split(":")[0]), ["release", "services"]);
  const failing = await origin(health(OLD));
  const stale = await verify(failing, args, env);
  assert.equal(stale.code, 1, stale.out);
  assert.deepEqual(failing.seen.map((u) => u.pathname), ["/api/health", "/api/health", "/api/health"]);
  // The realistic list is the probe's (PR #240): its arguments here are refused before anything is asked.
  for (const extra of [["--mix", "2x2"], ["--teams", "t_aaaaa2", "--players", "p_aaaab4"], ["--teams", "t_aaaaa2"]]) {
    const untouched = await origin(health(RELEASE));
    const refused = await verify(untouched, [...args, ...extra], env);
    assert.equal(refused.code, 2, `${extra.join(" ")}: ${refused.out}`);
    assert.match(refused.out, /^usage: node infra\/aws\/verify-deploy\.mjs /m);
    assert.equal(untouched.seen.length, 0, extra.join(" "));
  }
});
