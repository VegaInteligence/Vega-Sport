// The distribution's access logs by family (FAILURE_MODES_OPTIMISATIONS.md GH149, written before this test): the
// viewer-request function of infra/aws/api.yaml run as CloudFront runs it (cloudfront-js-2.0, the `cloudfront` module's
// logCustomData), the records the delivery of infra/aws/edge-logs.yaml writes, and the report
// (infra/aws/edge-cache-report.mjs) that folds them. GH149-a also asks the read API's real handler whether it serves
// each family's route. Rerun: node --test test/edge-logs.test.mjs (from backend/api).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";
import { createHandler } from "../src/handler.mjs";

const ROOT = new URL("../../../", import.meta.url).pathname;
const run = promisify(execFile);
const API_YAML = await readFile(join(ROOT, "infra/aws/api.yaml"), "utf8");
const REPORT = join(ROOT, "infra/aws/edge-cache-report.mjs");

/** The function's source as the template gives it to CloudFront (EdgeFamily, FunctionCode). */
function functionSource() {
  const at = API_YAML.indexOf("\n  EdgeFamily:\n");
  assert.ok(at >= 0, "api.yaml has no EdgeFamily function");
  const block = API_YAML.slice(at).split("\n");
  const start = block.findIndex((line) => /^ {6}FunctionCode: \|/.test(line));
  assert.ok(start > 0, "EdgeFamily has no inline FunctionCode");
  const lines = [];
  for (const line of block.slice(start + 1)) {
    if (line.trim() && !line.startsWith("        ")) break;
    lines.push(line.slice(8));
  }
  return lines.join("\n");
}

/** CloudFront's runtime for one request: the module `cloudfront` with logCustomData; the last call kept. */
function load() {
  const source = functionSource();
  assert.match(source, /^import cf from 'cloudfront';$/m);
  const context = vm.createContext({ cf: null, logged: [] });
  vm.runInContext(source.replace(/^import cf from 'cloudfront';$/m, "") + "\n;globalThis.handler = handler; globalThis.families = Object.keys(FAMILIES);", context);
  load.families = [...context.families];
  return (event) => {
    const calls = [];
    context.cf = { logCustomData: (value) => calls.push(value) };
    const result = context.handler(event);
    return { result, logged: calls.length ? calls.at(-1) : "-", calls };
  };
}

function event(uri, { query = {}, cookies = {}, method = "GET" } = {}) {
  return {
    version: "1.0",
    context: { distributionDomainName: "d111111abcdef8.cloudfront.net", eventType: "viewer-request", requestId: "r-1" },
    viewer: { ip: "198.51.100.7" },
    request: {
      method,
      uri,
      querystring: Object.fromEntries(Object.entries(query).map(([k, v]) => [k, { value: v }])),
      headers: { host: { value: "d111111abcdef8.cloudfront.net" }, "user-agent": { value: "Mozilla/5.0" } },
      cookies: Object.fromEntries(Object.entries(cookies).map(([k, v]) => [k, { value: v }])),
    },
  };
}

const ID = { m: "m_2FVfvL", p: "p_4NUmpH", t: "t_1LpqZD", l: "l_3FJFUl" };
// The read API's routes whose path carries an id (backend/api/src: match-details.mjs, matches.mjs, profiles.mjs,
// nations.mjs, worldcup.mjs) and the live function's.
const PATTERNS = [
  ...["", "/summary", "/absences", "/lineups/probable", "/lineups", "/events", "/shots", "/stats", "/players", "/players/halves", "/players/display",
    "/momentum", "/advanced", "/advanced/players", "/advanced/network", "/heatmaps", "/h2h"].map((s) => `/api/matches/${ID.m}${s}`),
  ...["", "/actions", "/faced", "/halves", "/injuries", "/partners", "/physical", "/return", "/similar", "/style", "/transfers"].map((s) => `/api/players/${ID.p}${s}`),
  ...["", "/absences", "/age-profile", "/passing", "/similar", "/squad", "/substitutions"].map((s) => `/api/teams/${ID.t}${s}`),
  `/api/nations/${ID.t}`, "/api/worldcup/matches/wc-2022-final",
];
const LIVE = ["/live/config", `/live/matches/${ID.m}`];

/** Every exact route of the read API: the paths its route modules compare `path` to. */
async function exactRoutes() {
  const dir = join(ROOT, "backend/api/src/routes");
  const found = new Set();
  for (const name of await readdir(dir)) {
    const text = await readFile(join(dir, name), "utf8");
    for (const m of text.matchAll(/path [!=]== "(\/api\/[a-z0-9/_-]+)"/g)) found.add(m[1]);
    // A module that maps its paths to a kind (actors.mjs: { "/api/read/player": "player", … }[path]).
    for (const m of text.matchAll(/"(\/api\/[a-z0-9/_-]+)": "[a-z-]+"/g)) found.add(m[1]);
  }
  assert.ok(found.size > 60, `only ${found.size} routes found`);
  return [...found].sort();
}

const family = load();

test("GH149-a: every route has its own family, and the read API serves each family's route", async () => {
  const exact = await exactRoutes();
  const paths = [...exact, ...PATTERNS, ...LIVE];
  const named = new Map();
  for (const path of paths) {
    const { logged } = family(event(path));
    assert.notEqual(logged, "other", path);
    assert.match(logged, /^[a-z0-9.-]{1,40}$/, path);
    assert.ok(!named.has(logged) || named.get(logged) === path, `${path} and ${named.get(logged)} share ${logged}`);
    named.set(logged, path);
  }
  // The handler claims each of them (a route reads, validates or answers; an unclaimed path is a 404 without a read).
  // Three routes answer 404 before any read without what they need: the parameters, or the status page's key.
  const NEEDS = { "/api/cup-index": "?kind=supplemental", "/api/league-history": "?league=l_3FJFUl&season=2019/2020" };
  for (const path of [...exact, ...PATTERNS]) {
    let reads = 0;
    const handle = createHandler({ read: async () => { reads++; return []; }, opsKey: "k".repeat(40) });
    const response = await handle(new Request("https://api.test" + path + (NEEDS[path] || ""), { headers: { "X-Vega-Ops-Key": "k".repeat(40) } }));
    assert.ok(reads > 0 || response.status !== 404, `${path}: no route of the read API claims it`);
  }
  // Each family the function knows is one of them: no family without its route.
  const known = new Set(paths.map((path) => family(event(path)).logged));
  assert.deepEqual(load.families.filter((name) => !known.has(name)), [], "families of the function with no route");
  // A path no route claims is a 404 without a read: the check above tells them apart.
  let reads = 0;
  const handle = createHandler({ read: async () => { reads++; return []; } });
  assert.equal((await handle(new Request("https://api.test/api/read/nothing-here"))).status, 404);
  assert.equal(reads, 0);
});

test("GH149-b: a family never holds an identifier, a query value or a segment outside the list", () => {
  const cases = {
    [`/api/matches/${ID.m}/summary`]: "matches.id.summary",
    [`/api/players/${ID.p}/injuries`]: "players.id.injuries",
    [`/api/matches/m_v1234567/players/display`]: "matches.id.players.display",
    "/api/read/player": "read.player",
    "/api/fixtures": "fixtures",
    "/api/health": "health",
    "/api/ops/status": "ops.status",
    "/api/league-history": "league-history",
    [`/live/matches/${ID.m}`]: "live.matches.id",
    "/api/read/johndoe@example.org": "other",
    "/api/read/../../etc/passwd": "other",
    [`/api/matches/${ID.m}/unknown`]: "other",
    [`/api/players/${ID.p}/${ID.p}`]: "other",
    "/api/players/p_notanid99/injuries": "other",
    "/data/sources/v2/images/ab/abcdef.png": "other",
    "/": "other",
    "/robots.txt": "other",
    ["/api/" + "a".repeat(5000)]: "other",
  };
  for (const [uri, expected] of Object.entries(cases)) {
    const { logged, calls } = family(event(uri, { query: { season: "2026/2027", personalPlayers: ID.p }, cookies: { session: "secret" } }));
    assert.equal(logged, expected, uri);
    assert.equal(calls.length, 1, uri);
    assert.ok(Buffer.byteLength(logged) <= 40, uri);
    for (const leak of [ID.m, ID.p, "2026", "secret", "198.51.100.7", "johndoe", "passwd"]) assert.ok(!logged.includes(leak), `${uri}: ${leak}`);
  }
});

test("GH149-c: the request goes on as it came", () => {
  for (const uri of ["/api/read/player", `/api/matches/${ID.m}/summary`, "/nothing"]) {
    const given = event(uri, { query: { season: "2026/2027", v: "abc" }, cookies: { a: "b" }, method: "HEAD" });
    const copy = structuredClone(given.request);
    const { result } = family(given);
    assert.equal(result, given.request, "the same object");
    assert.deepEqual(result, copy, "unchanged");
  }
});

// What the delivery writes for one request (edge-logs.yaml's fields, JSON; values as strings, as CloudFront writes them).
const AT = Date.parse("2026-11-26T00:10:00Z");
const record = (logged, behaviour, result, { status = 200, method = "GET", bytes = 1000, taken = 0.02, at = AT } = {}) => ({
  "timestamp(ms)": String(at), "cache-behavior-path-pattern": behaviour, "viewer-request-log-data": encodeURIComponent(logged),
  "cs-method": method, "sc-status": String(status), "x-edge-result-type": result, "x-edge-response-result-type": result,
  "x-edge-detailed-result-type": result, "time-taken": String(taken), "time-to-first-byte": String(taken / 2),
  "origin-fbl": result === "Hit" ? "-" : "0.010", "origin-lbl": result === "Hit" ? "-" : "0.012", "sc-bytes": String(bytes),
});

test("GH149-d: representative requests, through the function and the delivery, to the report", async () => {
  const { FIELDS, fold } = await import(REPORT);
  const templateFields = (await readFile(join(ROOT, "infra/aws/edge-logs.yaml"), "utf8")).match(/RecordFields:\n((?: {8}- .*\n)+)/)[1]
    .split("\n").filter(Boolean).map((line) => line.replace(/^ {8}- /, "").replace(/^'|'$/g, ""));
  assert.deepEqual(FIELDS, templateFields, "the report reads the fields the delivery writes");
  // The reference session (match page of Brentford–Everton, player page of Christos Tzolis), the probe, the status
  // page, an image copy and an unknown path; outcomes as an edge could give them.
  const session = [
    ["/api/read/player", "*", ["Hit", "Hit", "Miss", "RefreshHit"]],
    [`/api/matches/${ID.m}/summary`, "*", ["Hit", "Miss"]],
    ["/api/fixtures", "*", ["Hit", "Hit", "Hit", "Miss", "Error"]],
    ["/api/league-history", "api/league-history", ["Hit", "RefreshHit"]],
    ["/api/health", "*", ["Miss", "Miss", "Miss"]],
    ["/api/ops/status", "api/ops/*", ["Miss"]],
    ["/api/nowhere", "*", ["Error"]],
  ];
  const records = [];
  for (const [uri, behaviour, outcomes] of session) {
    const { logged } = family(event(uri));
    outcomes.forEach((result, i) => records.push(record(logged, behaviour, result, { status: result === "Error" ? (uri === "/api/nowhere" ? 404 : 503) : 200, bytes: 100 * (i + 1), taken: 0.01 * (i + 1) })));
  }
  records.push(record("-", "data/*", "Hit", { bytes: 5000 }));
  records.push(record("-", "data/*", "Miss", { bytes: 5000 }));
  for (const r of records) assert.deepEqual(Object.keys(r), FIELDS);
  const table = fold(records, { from: AT - 60_000, to: AT + 60_000 });
  const row = (name) => table.families.find((f) => f.family === name);
  assert.deepEqual(row("read.player"), { family: "read.player", requests: 4, hit: 2, refresh: 1, miss: 1, error: 0, other: 0, hitShare: 0.5, refreshShare: 0.25, bytes: 1000, p50: 0.02, p95: 0.04, apart: false });
  assert.deepEqual(row("fixtures"), { family: "fixtures", requests: 5, hit: 3, refresh: 0, miss: 1, error: 1, other: 0, hitShare: 0.75, refreshShare: 0, bytes: 1500, p50: 0.03, p95: 0.05, apart: false });
  assert.equal(row("matches.id.summary").hitShare, 0.5);
  assert.equal(row("league-history").refreshShare, 0.5);
  for (const name of ["health", "ops.status", "media", "other"]) assert.equal(row(name).apart, true, name);
  assert.equal(row("health").hitShare, null, "the probe has no share");
  assert.equal(row("media").requests, 2);
  assert.equal(row("other").error, 1);
  assert.deepEqual(table.window, { from: AT - 60_000, to: AT + 60_000, records: records.length, malformed: 0 });
});

/** The saved queries of edge-logs.yaml (name, query string as its folded scalar reads, log group). */
async function savedQueries() {
  const text = await readFile(join(ROOT, "infra/aws/edge-logs.yaml"), "utf8");
  return [...text.matchAll(/\n {6}Name: (vega-v2\/[\w-]+)\n {6}LogGroupNames: \[!Ref AccessLog\]\n {6}QueryString: >-\n((?: {8}.*\n)+)/g)]
    .map((m) => ({ name: m[1], queryString: m[2].split("\n").map((line) => line.trim()).filter(Boolean).join(" "), logGroupNames: ["vega-v2-api-access"] }));
}

/** What Logs Insights answers a query on records (the subset the report's queries use: fields `f` as a and
 * coalesce(`f`, "text") as a; filter with =, !=, like, not like and toMillis(@timestamp) >= / <, joined by and / or,
 * parentheses — a condition on a field the record lacks is false, as Logs Insights takes it; stats count, sum and pct
 * (nearest rank) by fields), rows as objects. Each record's @timestamp is its timestamp(ms). */
function insights(queryString, records) {
  let rows = records.map((r) => ({ ...r, "@timestamp": Number(r["timestamp(ms)"]) }));
  for (const part of queryString.split("|").map((p) => p.trim())) {
    if (part.startsWith("fields ")) {
      const alias = [...part.slice(7).matchAll(/(?:coalesce\(`([^`]+)`,\s*"([^"]*)"\)|`([^`]+)`)\s+as\s+(\w+)/g)]
        .map((m) => [m[4], m[1] ?? m[3], m[1] ? m[2] : undefined]);
      rows = rows.map((r) => ({ ...r, ...Object.fromEntries(alias.map(([name, field, otherwise]) => [name, r[field] ?? otherwise])) }));
    } else if (part.startsWith("filter ")) {
      // Terms joined by `and`, then `or`, outside parentheses; a term: field = / != "text", field (not) like /regex/.
      const split = (text, word) => {
        const parts = [];
        let depth = 0, start = 0;
        for (let i = 0; i < text.length; i++) {
          if (text[i] === "(") depth++;
          else if (text[i] === ")") depth--;
          else if (depth === 0 && text.startsWith(` ${word} `, i)) {
            parts.push(text.slice(start, i));
            start = i + word.length + 2;
          }
        }
        return [...parts, text.slice(start)].map((x) => x.trim());
      };
      const condition = (text) => {
        const ands = split(text, "and");
        if (ands.length > 1) { const all = ands.map(condition); return (r) => all.every((t) => t(r)); }
        const ors = split(text, "or");
        if (ors.length > 1) { const any = ors.map(condition); return (r) => any.some((t) => t(r)); }
        if (text.startsWith("(") && text.endsWith(")")) return condition(text.slice(1, -1).trim());
        let m = text.match(/^(\w+)\s*(!=|=)\s*"([^"]*)"$/);
        if (m) return (r) => r[m[1]] != null && (m[2] === "=") === (r[m[1]] === m[3]);
        m = text.match(/^(\w+)\s+(not\s+)?like\s+\/(.*)\/$/);
        if (m) return (r) => r[m[1]] != null && Boolean(m[2]) !== new RegExp(m[3]).test(r[m[1]]);
        m = text.match(/^toMillis\(@timestamp\)\s*(>=|<)\s*(\d+)$/);
        if (m) return (r) => (m[1] === ">=" ? r["@timestamp"] >= Number(m[2]) : r["@timestamp"] < Number(m[2]));
        throw new Error(`a filter the stand-in does not read: ${text}`);
      };
      const keep = condition(part.slice(7));
      rows = rows.filter((r) => keep(r));
    } else if (part.startsWith("stats ")) {
      const [aggregates, by] = part.slice(6).split(/\s+by\s+/);
      const keys = by ? by.split(",").map((k) => k.trim()) : [];
      const groups = new Map();
      for (const r of rows) {
        const key = JSON.stringify(keys.map((k) => r[k]));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      return [...groups].map(([key, members]) => {
        const row = Object.fromEntries(keys.map((k, i) => [k, JSON.parse(key)[i]]));
        for (const a of aggregates.split(/,(?![^(]*\))/).map((x) => x.trim())) {
          let m = a.match(/^count\(\*\)\s+as\s+(\w+)$/);
          if (m) { row[m[1]] = members.length; continue; }
          m = a.match(/^sum\((\w+)\)\s+as\s+(\w+)$/);
          if (m) { row[m[2]] = members.reduce((sum, x) => sum + Number(x[m[1]]), 0); continue; }
          m = a.match(/^pct\((\w+),\s*(\d+)\)\s+as\s+(\w+)$/);
          if (m) {
            const values = members.map((x) => Number(x[m[1]])).sort((p, q) => p - q);
            row[m[3]] = values[Math.max(0, Math.ceil((Number(m[2]) / 100) * values.length) - 1)];
            continue;
          }
          throw new Error(`an aggregate the stand-in does not read: ${a}`);
        }
        return row;
      });
    } else throw new Error(`a command the stand-in does not read: ${part}`);
  }
  return rows;
}

async function report(args, input) {
  const dir = await mkdtemp(join(tmpdir(), "edge-report-"));
  const file = join(dir, "records.jsonl");
  await writeFile(file, input ?? "");
  try {
    const { stdout } = await run(process.execPath, [REPORT, ...args.map((a) => (a === "<file>" ? file : a))]);
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("GH149-e: the report's window, unknown fields and malformed lines", async () => {
  const ok = [record("read.player", "*", "Hit", { at: AT }), record("read.player", "*", "Miss", { at: Date.parse("2026-11-26T01:20:00Z") })];
  const text = ok.map((r) => JSON.stringify(r)).join("\n") + "\n";
  assert.equal((await report(["--records", "<file>"], text)).code, 2, "no window");
  assert.equal((await report(["--records", "<file>", "--from", "2026-11-26T00:00:00Z"], text)).code, 2, "half a window");
  assert.equal((await report(["--records", "<file>", "--from", "2026-11-27T00:00:00Z", "--to", "2026-11-26T00:00:00Z"], text)).code, 2, "inverted");
  const inside = await report(["--records", "<file>", "--from", "2026-11-26T00:00:00Z", "--to", "2026-11-26T00:30:00Z", "--json"], text);
  assert.equal(inside.code, 0, inside.stderr);
  const out = JSON.parse(inside.stdout);
  assert.equal(out.families.find((f) => f.family === "read.player").requests, 1, "the record outside the window left out");
  const leaked = JSON.stringify({ ...ok[0], "c-ip": "198.51.100.7" }) + "\n";
  const refused = await report(["--records", "<file>", "--from", "2026-11-26T00:00:00Z", "--to", "2026-11-27T00:00:00Z"], leaked);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /c-ip/);
  const broken = await report(["--records", "<file>", "--from", "2026-11-26T00:00:00Z", "--to", "2026-11-27T00:00:00Z", "--json"], text + "{not json\n");
  assert.equal(broken.code, 0);
  assert.equal(JSON.parse(broken.stdout).window.malformed, 1);
});

test("GH149-e: --live runs the saved queries in us-east-1 and folds their rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "edge-live-"));
  const calls = join(dir, "calls.log");
  // The AWS CLI as `aws logs start-query` / `get-query-results` answer (JSON); records every call.
  await writeFile(join(dir, "aws"), `#!${process.execPath}
const fs = require("node:fs"); const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(argv) + "\\n");
const value = (k) => argv[argv.indexOf("--" + k) + 1];
if (argv[1] === "describe-query-definitions") { console.log(JSON.stringify({ queryDefinitions: ${JSON.stringify(await savedQueries())} })); process.exit(0); }
if (argv[1] === "start-query") { console.log(JSON.stringify({ queryId: value("query-string").includes("pct(") ? (value("query-string").includes(" by ") ? "q-latency" : "q-pooled") : "q-cache" })); process.exit(0); }
if (argv[1] === "get-query-results") {
  const f = (o) => Object.entries(o).map(([field, v]) => ({ field, value: String(v) }));
  const rows = value("query-id") === "q-cache"
    ? [f({ family: "read.player", behaviour: "*", result: "Hit", method: "GET", status: 200, n: 8, bytes: 8000 }),
       f({ family: "read.player", behaviour: "*", result: "Miss", method: "GET", status: 200, n: 2, bytes: 2000 }),
       f({ family: "health", behaviour: "*", result: "Miss", method: "GET", status: 200, n: 30, bytes: 3000 })]
    : value("query-id") === "q-latency" ? [f({ family: "read.player", p50: 0.01, p95: 0.2 }), f({ family: "health", p50: 0.1, p95: 0.3 })] : [];
  console.log(JSON.stringify({ status: "Complete", results: rows })); process.exit(0); }
process.exit(99);
`);
  await chmod(join(dir, "aws"), 0o755);
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
  const { stdout } = await run(process.execPath, [REPORT, "--live", "--from", "2026-11-26T00:00:00Z", "--to", "2026-11-26T01:00:00Z", "--json"], { env });
  const out = JSON.parse(stdout);
  const player = out.families.find((f) => f.family === "read.player");
  assert.deepEqual([player.requests, player.hit, player.miss, player.hitShare, player.bytes, player.p95], [10, 8, 2, 0.8, 10000, 0.2]);
  assert.equal(out.families.find((f) => f.family === "health").apart, true);
  const argv = (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(argv.every((a) => a.includes("--region") && a[a.indexOf("--region") + 1] === "us-east-1"), "every call in us-east-1");
  const starts = argv.filter((a) => a[1] === "start-query");
  assert.equal(starts.length, 4, "the four saved queries");
  for (const a of starts) {
    assert.equal(a[a.indexOf("--log-group-names") + 1], "vega-v2-api-access");
    assert.equal(a[a.indexOf("--start-time") + 1], String(Date.parse("2026-11-26T00:00:00Z") / 1000));
    assert.equal(a[a.indexOf("--end-time") + 1], String(Date.parse("2026-11-26T01:00:00Z") / 1000));
  }
});

/** A stand-in `aws` answering the template's saved queries on `records` as Logs Insights would (insights above). */
async function insightsAws(records) {
  const dir = await mkdtemp(join(tmpdir(), "edge-insights-"));
  const definitions = await savedQueries();
  await writeFile(join(dir, "aws"), `#!${process.execPath}
const argv = process.argv.slice(2);
const value = (k) => argv[argv.indexOf("--" + k) + 1];
const definitions = ${JSON.stringify(definitions)};
const records = ${JSON.stringify(records)};
${insights.toString()}
if (argv[1] === "describe-query-definitions") { console.log(JSON.stringify({ queryDefinitions: definitions })); process.exit(0); }
if (argv[1] === "start-query") {
  const asked = { q: value("query-string"), s: Number(value("start-time")), e: Number(value("end-time")) };
  if (!definitions.some((d) => asked.q === d.queryString || asked.q.endsWith(" | " + d.queryString))) process.exit(98);
  console.log(JSON.stringify({ queryId: Buffer.from(JSON.stringify(asked)).toString("base64url") })); process.exit(0); }
if (argv[1] === "get-query-results") {
  const asked = JSON.parse(Buffer.from(value("query-id"), "base64url").toString());
  const inRange = records.filter((r) => Number(r["timestamp(ms)"]) >= asked.s * 1000 && Number(r["timestamp(ms)"]) <= asked.e * 1000 + 999);
  // A group without a value comes without that field, as Logs Insights answers it.
  const results = insights(asked.q, inRange).map((row) => [...Object.entries(row).filter(([, v]) => v != null).map(([field, v]) => ({ field, value: String(v) })), { field: "@ptr", value: "p" }]);
  console.log(JSON.stringify({ status: "Complete", results })); process.exit(0); }
process.exit(99);
`);
  await chmod(join(dir, "aws"), 0o755);
  return { ...process.env, PATH: `${dir}:${process.env.PATH}` };
}

// GH149-i (review of 26 Nov 2026): --live and --records give one table for the same records. The delivery writes `-` for
// a value the function did not set (data/* among them); the saved queries are the template's, answered as Logs Insights
// would by `insights` above.
test("GH149-i: the same records folded locally and through the saved queries give one table", async () => {
  const { fold } = await import(REPORT);
  const records = [];
  const add = (logged, behaviour, results, extra = {}) =>
    results.forEach((result, i) => records.push({ ...record("x", behaviour, result, { taken: 0.01 * (i + 1) + (extra.slow || 0), bytes: 100 * (i + 1), ...extra }),
      "viewer-request-log-data": logged }));
  add("read.player", "*", ["Hit", "Hit", "RefreshHit", "Miss", "Hit"]);
  add("read.player", "*", ["Error"], { status: 503 });
  add("ops.status", "api/ops/*", ["Miss", "Miss"]);
  add("health", "*", ["Miss", "Miss", "Miss"]);
  add("other", "*", ["Error"], { status: 404 });
  add("%ZZ", "*", ["Miss"], { slow: 0.5 });
  add("READ.PLAYER", "*", ["Miss", "Hit"], { slow: 0.3 });
  add("-", "data/*", ["Hit", "Hit", "Miss"], { slow: 0.05 });
  add("-", "*", ["Error", "Hit"], { status: 200, slow: 0.2 });
  // A record without the field at all (05 h 21): unlogged in both ways, its time in unlogged's percentiles.
  const bare = record("x", "*", "Miss", { taken: 0.9, bytes: 50 });
  delete bare["viewer-request-log-data"];
  records.push(bare);
  const window = { from: AT - 60_000, to: AT + 60_000 };
  const local = fold(records, window);

  const definitions = await savedQueries();
  assert.deepEqual(definitions.map((d) => d.name).sort(),
    ["vega-v2/api-cache-by-family", "vega-v2/api-latency-by-family", "vega-v2/api-latency-media", "vega-v2/api-latency-other"]);
  const env = await insightsAws(records);
  const { stdout } = await run(process.execPath, [REPORT, "--live", "--from", new Date(window.from).toISOString(), "--to", new Date(window.to).toISOString(), "--json"], { env });
  const live = JSON.parse(stdout);
  assert.deepEqual(live.families, local.families, "one table both ways");
  assert.equal(live.window.records, local.window.records);
  const names = local.families.map((f) => f.family);
  assert.ok(!names.includes("-"), "no family named -");
  const row = (name) => local.families.find((f) => f.family === name);
  for (const name of ["media", "unlogged", "other", "health", "ops.status"]) assert.equal(row(name)?.apart, true, name);
  assert.deepEqual([row("media").requests, row("media").bytes, row("media").p50 != null, row("media").p95 != null], [3, 600, true, true]);
  assert.deepEqual([row("unlogged").requests, row("unlogged").error, row("unlogged").p95], [3, 1, 0.9], "the record without the field among them");
  assert.equal(row("other").requests, 4, "the unknown route and the two values outside the form, pooled");
  // other's times: 0.01 (the unknown route), 0.31 and 0.32 (READ.PLAYER), 0.51 (%ZZ): the 95th by nearest rank is 0.51.
  assert.deepEqual([row("other").p50, row("other").p95], [0.31, 0.51], "other's percentiles over its pooled records");
  assert.deepEqual([row("read.player").hit, row("read.player").refresh, row("read.player").miss, row("read.player").error, row("read.player").hitShare],
    [3, 1, 1, 1, 0.6]);
});

// GH149-j (counter-review of 26 Nov 2026 at 05:23): one window both ways, [from, to) in milliseconds.
test("GH149-j: two adjacent windows, a bound inside a second: the same records both ways, each once", async () => {
  const { fold } = await import(REPORT);
  const t0 = Date.parse("2026-11-26T00:10:00Z"), t1 = t0 + 30_500, t2 = t0 + 61_000;
  const at = [t0, t0 + 30_000, t1 - 1, t1, t1 + 1, t2 - 1, t2, t2 + 400];
  const records = at.map((ms, i) => record("read.player", "*", i % 2 ? "Miss" : "Hit", { at: ms, taken: 0.01 * (i + 1) }));
  const env = await insightsAws(records);
  const both = async (from, to) => {
    const local = fold(records, { from, to });
    const { stdout } = await run(process.execPath, [REPORT, "--live", "--from", new Date(from).toISOString(), "--to", new Date(to).toISOString(), "--json"], { env });
    const live = JSON.parse(stdout);
    assert.deepEqual(live.families, local.families, `[${new Date(from).toISOString()}, ${new Date(to).toISOString()})`);
    return local.window.records;
  };
  const first = await both(t0, t1), second = await both(t1, t2), whole = await both(t0, t2);
  assert.equal(first, 3, "t0, t0 + 30 s and t1 − 1 ms: the end excluded");
  assert.equal(second, 3, "t1, t1 + 1 ms and t2 − 1 ms: the record at t1 here only");
  assert.equal(first + second, whole);
});

test("GH204-b: the read API's request line names the route as the edge function does", async () => {
  const exact = await exactRoutes();
  const NEEDS = { "/api/cup-index": "?kind=supplemental", "/api/league-history": "?league=l_3FJFUl&season=2019/2020" };
  const lines = [];
  const handle = createHandler({ read: async () => [], log: (line) => lines.push(JSON.parse(line)), opsKey: "k".repeat(40) });
  for (const path of [...exact, ...PATTERNS, "/api/read/nothing-here", "/api/x/../../etc"]) {
    lines.length = 0;
    await handle(new Request("https://api.test" + path + (NEEDS[path] || ""), { headers: { "X-Vega-Ops-Key": "k".repeat(40) } }));
    assert.equal(lines.length, 1, path);
    assert.equal(lines[0].route, family(event(path)).logged, path);
  }
});
