// E2E — the read API's distribution limits one address that goes over its limit, and only
// for a while (VI-35, infra/aws/waf.yaml). Run only once the web ACL is attached and in
// Mode=Block: in Count mode nothing is ever limited and the run fails at L1.
//
// Failure modes and expected outcomes:
//  L0 The API answers this address before the run (200): the run starts from a clean state.
//  L1 Going over the limit: from this one address, a cached and cheap read (/api/status by
//     default, served from the distribution's cache: the web ACL counts cache hits too) sent
//     at a steady pace is answered 429 before 3 × the limit is reached.
//  L2 The 429 is the web ACL's: a JSON body with error.code RATE_LIMITED, a numeric
//     Retry-After above 2 (the site's clients then wait instead of retrying into the block),
//     Access-Control-Allow-Origin exactly "*" (a browser hides a response without it, or with
//     the value twice), Cache-Control no-store.
//  L3 A forged edge key does not lift it (429); the real key, when given, does (200).
//  L4 Back to normal: once the address stops, a read is answered 200 again within 12 minutes
//     (5-minute window, plus the web ACL's delay, usually under 30 s).
//
// Run (from a workstation, never from CI; it sends a few thousand requests to the API):
//   CONFIRM_RATE_LIMIT_E2E=1 [RATE_LIMIT=1500] [VEGA_API_EDGE_KEY=<SSM /vega/v2/edge-key>] \
//     node tests/e2e/rate-limit.e2e.mjs https://dngp6kh9jx2bl.cloudfront.net <evidence dir>
// Optional: RATE (requests per second, 25), READ_PATH (/api/status), RECOVERY_MINUTES (12).
// It writes evidence.json and EVIDENCE.md (command, expected, actual, every status seen) in
// the evidence directory; exit code 1 when any check fails. Keep the evidence out of git.
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [origin, out = path.join(os.tmpdir(), "rate-limit-e2e")] = process.argv.slice(2);
if (!origin || !/^https:\/\/d[a-z0-9]+\.cloudfront\.net$|^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
  console.error("usage: node tests/e2e/rate-limit.e2e.mjs https://<distribution>.cloudfront.net <evidence dir>");
  process.exit(2);
}
if (process.env.CONFIRM_RATE_LIMIT_E2E !== "1") {
  console.error("This run sends thousands of requests and gets this address limited: set CONFIRM_RATE_LIMIT_E2E=1.");
  process.exit(2);
}
const limit = Number(process.env.RATE_LIMIT || 1500);
const rate = Number(process.env.RATE || 25);
const readPath = process.env.READ_PATH || "/api/status";
const recoveryMs = Number(process.env.RECOVERY_MINUTES || 12) * 60_000;
const key = process.env.VEGA_API_EDGE_KEY || "";
const url = origin + readPath;
const started = new Date();
const checks = [];
const log = [];
const statuses = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (id, expected, actual, pass) => {
  checks.push({ id, expected, actual, pass: Boolean(pass) });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}: ${actual}`);
};

async function get(headers = {}) {
  const at = Date.now();
  try {
    const response = await fetch(url, { headers: { "Accept-Encoding": "gzip", ...headers } });
    const body = await response.text();
    statuses[response.status] = (statuses[response.status] || 0) + 1;
    return { status: response.status, headers: Object.fromEntries(response.headers), body, ms: Date.now() - at };
  } catch (error) {
    statuses.error = (statuses.error || 0) + 1;
    return { status: 0, error: String(error?.message || error), ms: Date.now() - at };
  }
}

await mkdir(out, { recursive: true });

// L0
const before = await get();
check("L0", "200 before the run", before.status, before.status === 200);

// L1: a steady pace, until the first 429 or 3 × the limit.
let first = null, sent = 0;
const t0 = Date.now();
while (!first && sent < 3 * limit) {
  const batch = await Promise.all(Array.from({ length: rate }, () => get()));
  sent += batch.length;
  first = batch.find((r) => r.status === 429) || null;
  if (sent % (rate * 20) === 0) log.push({ sent, seconds: (Date.now() - t0) / 1000, statuses: { ...statuses } });
  await sleep(Math.max(0, 1000 - (Date.now() - t0) % 1000));
}
const limitedAfter = (Date.now() - t0) / 1000;
check("L1", `429 before ${3 * limit} requests`, first ? `429 after ${sent} requests, ${limitedAfter.toFixed(0)} s` : `no 429 after ${sent} requests`, first);

// L2
if (first) {
  let code = null;
  try { code = JSON.parse(first.body).error?.code; } catch {}
  const retry = Number(first.headers["retry-after"]);
  const ok = code === "RATE_LIMITED" && Number.isFinite(retry) && retry > 2 &&
    first.headers["access-control-allow-origin"] === "*" && first.headers["cache-control"] === "no-store" &&
    /json/.test(first.headers["content-type"] || "");
  check("L2", "RATE_LIMITED JSON, Retry-After > 2, ACAO '*', no-store",
    JSON.stringify({ code, retryAfter: first.headers["retry-after"], acao: first.headers["access-control-allow-origin"], cacheControl: first.headers["cache-control"], type: first.headers["content-type"] }), ok);
} else check("L2", "a 429 to inspect", "none", false);

// L3
const forged = await get({ "X-Vega-Edge-Key": "f".repeat(64) });
check("L3 forged", "429 with a forged key", forged.status, forged.status === 429);
if (key) {
  const keyed = await get({ "X-Vega-Edge-Key": key });
  check("L3 key", "200 with the site's key", keyed.status, keyed.status === 200);
} else checks.push({ id: "L3 key", expected: "200 with the site's key", actual: "not run (VEGA_API_EDGE_KEY unset)", pass: null });

// L4: one read every 15 s until a 200.
const stop = Date.now();
let back = null;
while (Date.now() - stop < recoveryMs) {
  await sleep(15_000);
  const r = await get();
  log.push({ recovery: (Date.now() - stop) / 1000, status: r.status });
  if (r.status === 200) { back = (Date.now() - stop) / 1000; break; }
}
check("L4", `200 again within ${recoveryMs / 60_000} min`, back === null ? "still limited" : `200 after ${back.toFixed(0)} s`, back !== null);

const failed = checks.some((c) => c.pass === false);
const command = `CONFIRM_RATE_LIMIT_E2E=1 RATE_LIMIT=${limit} RATE=${rate} READ_PATH=${readPath}${key ? " VEGA_API_EDGE_KEY=<SSM /vega/v2/edge-key>" : ""} node tests/e2e/rate-limit.e2e.mjs ${origin} ${out}`;
const evidence = { started: started.toISOString(), ended: new Date().toISOString(), command, origin, readPath, limit, rate,
  node: process.version, host: os.hostname(), checks, statuses, log, result: failed ? "FAIL" : "PASS" };
await writeFile(path.join(out, "evidence.json"), JSON.stringify(evidence, null, 2));
await writeFile(path.join(out, "EVIDENCE.md"), [
  `# Rate limit E2E — ${evidence.result}`, "",
  `- Started ${evidence.started}, ended ${evidence.ended}`,
  `- Command: \`${command}\``,
  `- Statuses seen: \`${JSON.stringify(statuses)}\``, "",
  "| Check | Expected | Actual | Result |", "|---|---|---|---|",
  ...checks.map((c) => `| ${c.id} | ${c.expected} | ${c.actual} | ${c.pass === null ? "not run" : c.pass ? "pass" : "FAIL"} |`), "",
].join("\n"));
console.log(`evidence: ${out}`);
process.exit(failed ? 1 : 0);
