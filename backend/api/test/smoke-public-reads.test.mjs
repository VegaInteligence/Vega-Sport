// GH257: run the Deploy probe's CLI with the AWS CLI wire contract; no network or AWS account.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../../../infra/aws/smoke-public-reads.mjs", import.meta.url));
const release = "a".repeat(64);
const options = ["--release", release];
const health = "/api/health";
const team = "/api/teams/t_0tnX1I";
const substitutions = [team + "/substitutions?season=2026%2F2027", "/api/teams/t_2ihyjC/substitutions?season=2026%2F2027"];
const FAKE_AWS = String.raw`#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const args = process.argv.slice(2);
const option = (s) => args[args.indexOf(s) + 1];
assert.deepEqual(args.slice(0, 2), ["lambda", "invoke"]);
assert.equal(option("--function-name"), "vega-v2-api");
assert.equal(option("--invocation-type"), "RequestResponse");
assert.equal(option("--cli-binary-format"), "raw-in-base64-out");
assert.equal(process.env.AWS_MAX_ATTEMPTS, "1");
const event = JSON.parse(option("--payload"));
assert.equal(event.version, "2.0");
assert.equal(event.requestContext.http.method, "GET");
for (const h of Object.keys(event.headers ?? {})) assert.notEqual(h.toLowerCase(), "if-none-match");
const path = event.rawPath + (event.rawQueryString ? "?" + event.rawQueryString : "");
fs.appendFileSync(process.env.FAKE_CALLS, JSON.stringify(path) + "\n");
const mode = process.env.FAKE_MODE;
const digest = process.env.FAKE_RELEASE;
const id = event.rawPath.split("/")[3];
const impact = {
  id, season: new URLSearchParams(event.rawQueryString).get("season"),
  matches: 2, minute: 61, pointsThen: 2, points: 4, gained: 2,
  leading: { matches: 0, pointsThen: 0, points: 0 },
  level: { matches: 2, pointsThen: 2, points: 4 },
  behind: { matches: 0, pointsThen: 0, points: 0 },
  substitutes: [{ id: "p_aaaab1", name: "Joueur", entries: 2, minutes: 30, goals: 1, assists: 0 }],
};
let statusCode = 200;
const headers = { "content-type": "application/json", "server-timing": 'total;dur=27.0, db;dur=25.0;desc="3 queries"' };
let body = { data: event.rawPath.endsWith("/substitutions") ? impact : { id, name: "Club" } };
const meta = { StatusCode: 200, ExecutedVersion: "$LATEST" };
if (path === "/api/health") {
  const pending = mode === "pending" || mode === "partial";
  statusCode = pending ? 503 : 200;
  body = { status: pending ? "pending" : "ok", revision: pending && mode !== "partial" ? "0" : "7", release: mode === "wrong-release" ? "b".repeat(64) : digest };
  if (mode === "invoke-error") meta.FunctionError = "Unhandled";
} else if (event.rawPath.endsWith("/substitutions") && id === "t_0tnX1I") {
  if (mode === "unavailable") statusCode = 503;
  if (mode === "no-population") statusCode = 404;
  if (mode === "conditional") statusCode = 304;
  if (mode === "empty") body.data.substitutes = [];
  if (mode === "wrong-team") body.data.id = "t_2ihyjC";
  if (mode === "slow") headers["server-timing"] = 'total;dur=3010.0, db;dur=3001.0;desc="3 queries"';
  if (mode === "unmeasured") delete headers["server-timing"];
  if (mode === "cached") headers["x-cache"] = "Hit from cloudfront";
}
fs.writeFileSync(args.at(-1), JSON.stringify({ statusCode, headers, body: JSON.stringify(body), isBase64Encoded: false }));
process.stdout.write(JSON.stringify(meta));
`;

function run(t, mode, { flags = [], population = {} } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "vega-origin-probe-test-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  writeFileSync(join(tmp, "aws"), FAKE_AWS, { mode: 0o700 });
  const log = join(tmp, "calls.jsonl");
  writeFileSync(log, "");
  const result = spawnSync(process.execPath, [script, ...options, ...flags], {
    encoding: "utf8", timeout: 10000,
    env: {
      ...process.env, PATH: [tmp, dirname(process.execPath), process.env.PATH].join(":"),
      FAKE_MODE: mode, FAKE_RELEASE: release, FAKE_CALLS: log,
      SMOKE_PUBLIC_SEASON: "", SMOKE_PUBLIC_TEAMS: "", ...population,
    },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const output = result.stdout + result.stderr;
  t.diagnostic(JSON.stringify({ mode, flags, exit: result.status, calls, output }));
  return { status: result.status, output, calls };
}

test("the release and public bodies are measured by direct unconditional invocations", (t) => {
  const got = run(t, "ready");
  assert.equal(got.status, 0, got.output);
  assert.deepEqual(got.calls, [health, ...substitutions, team]);
  assert.match(got.output, /substitutions.*200.*db=25/);
  assert.match(got.output, /team profile.*200.*db=25/);
});

test("an installation can use two explicitly selected populations from a known season", (t) => {
  const got = run(t, "ready", { population: { SMOKE_PUBLIC_SEASON: "2025/2026", SMOKE_PUBLIC_TEAMS: "t_aaaaa1,t_aaaaa2" } });
  assert.equal(got.status, 0, got.output);
  assert.deepEqual(got.calls, [health, "/api/teams/t_aaaaa1/substitutions?season=2025%2F2026",
    "/api/teams/t_aaaaa2/substitutions?season=2025%2F2026", "/api/teams/t_aaaaa1"]);
});

test("an invalid override fails before invoking Lambda", (t) => {
  const got = run(t, "ready", { population: { SMOKE_PUBLIC_SEASON: "2025/2026" } });
  assert.equal(got.status, 2, got.output);
  assert.deepEqual(got.calls, []);
});

test("only the empty first install is an explicit skip", (t) => {
  const empty = run(t, "pending", { flags: ["--allow-empty"] });
  assert.equal(empty.status, 0, empty.output);
  assert.deepEqual(empty.calls, [health]);
  assert.match(empty.output, /skipped.*no published season/);
  for (const [mode, flags] of [["pending", []], ["partial", ["--allow-empty"]]]) {
    const got = run(t, mode, { flags });
    assert.equal(got.status, 1, got.output);
    assert.deepEqual(got.calls, [health]);
  }
});

test("each failed origin scenario produces a failed Deploy gate", async (t) => {
  for (const [mode, message, healthOnly] of [
    ["wrong-release", /wrong release/, true], ["invoke-error", /FunctionError/, true],
    ["no-population", /status 404/], ["unavailable", /status 503/],
    ["conditional", /status 304/], ["empty", /missing substitution data/], ["wrong-team", /missing substitution data/],
    ["slow", /SQL budget/], ["unmeasured", /Server-Timing/], ["cached", /cache/],
  ]) {
    await t.test(mode, (subtest) => {
      const got = run(subtest, mode);
      assert.equal(got.status, 1, got.output);
      assert.match(got.output, message);
      assert.deepEqual(got.calls, healthOnly ? [health] : [health, ...substitutions, team]);
    });
  }
});
