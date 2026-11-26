// The read API's cache by family, from the distribution's access logs (FAILURE_MODES_OPTIMISATIONS.md GH149;
// edge-logs.yaml). Per family over a window: requests, Hit / RefreshHit / Miss, errors, the hit and refresh shares
// (GET and HEAD answers below 400 only), bytes sent, median and 95th percentile of time-taken. The probe (health), the
// status page (ops.status), the image copies (media), the records without a family (unlogged) and other are on their own
// lines, never in a share.
//
//   node infra/aws/edge-cache-report.mjs --records <file of JSON records> --from <ISO time> --to <ISO time> [--json]
//   node infra/aws/edge-cache-report.mjs --live --from <ISO time> --to <ISO time> [--json]
//
// --records reads the records as the delivery writes them (one JSON object per line, edge-logs.yaml's fields); a
// field outside them stops the report (exit 1): the records must not hold more than the delivery gives. --live runs
// the four saved queries (vega-v2/api-cache-by-family, vega-v2/api-latency-by-family, vega-v2/api-latency-other,
// vega-v2/api-latency-media) in us-east-1 with the AWS CLI. Both ways name each record's family alike (familyOf) and take
// each family's percentiles from its own records (GH149.1, review of 26 Nov 2026).
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export const FIELDS = ["timestamp(ms)", "cache-behavior-path-pattern", "viewer-request-log-data", "cs-method", "sc-status", "x-edge-result-type",
  "x-edge-response-result-type", "x-edge-detailed-result-type", "time-taken", "time-to-first-byte", "origin-fbl", "origin-lbl", "sc-bytes"];
const APART = new Set(["health", "ops.status", "media", "unlogged", "other"]);
const CACHE_QUERY = "vega-v2/api-cache-by-family";
const LATENCY_QUERY = "vega-v2/api-latency-by-family";
const OTHER_QUERY = "vega-v2/api-latency-other";
const MEDIA_QUERY = "vega-v2/api-latency-media";
const REGION = "us-east-1";
const round = (value, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

/** The family a record belongs to, the same in both ways: the image copies by their behaviour; `-` (the delivery's mark
 * of a value the function did not set; a field absent is read so) unlogged; a value of the function's form as written
 * (never decoded: the saved queries match it so); anything else other. */
export function familyOf(logged, behaviour) {
  if (behaviour === "data/*") return "media";
  const value = logged ?? "-";
  if (value === "-") return "unlogged";
  return /^[a-z0-9.-]{1,40}$/.test(value) ? value : "other";
}

function nearest(values, share) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)]);
}

function accumulate(families, name, { result, method, status, n = 1, bytes = 0 }) {
  const row = families.get(name) || { family: name, requests: 0, hit: 0, refresh: 0, miss: 0, error: 0, other: 0, bytes: 0, times: [] };
  families.set(name, row);
  row.requests += n;
  row.bytes += bytes;
  if (result === "Error" || status >= 400) row.error += n;
  else if (["GET", "HEAD"].includes(method) && result === "Hit") row.hit += n;
  else if (["GET", "HEAD"].includes(method) && result === "RefreshHit") row.refresh += n;
  else if (["GET", "HEAD"].includes(method) && result === "Miss") row.miss += n;
  else row.other += n;
  return row;
}

function finish(families, latency = new Map()) {
  return [...families.values()]
    .map(({ times, ...row }) => {
      const apart = APART.has(row.family);
      const cached = row.hit + row.refresh + row.miss;
      const timing = latency.get(row.family);
      return {
        family: row.family, requests: row.requests, hit: row.hit, refresh: row.refresh, miss: row.miss, error: row.error, other: row.other,
        hitShare: apart || !cached ? null : round(row.hit / cached), refreshShare: apart || !cached ? null : round(row.refresh / cached),
        bytes: row.bytes, p50: timing ? timing.p50 : nearest(times, 0.5), p95: timing ? timing.p95 : nearest(times, 0.95), apart,
      };
    })
    .sort((a, b) => Number(a.apart) - Number(b.apart) || b.requests - a.requests || a.family.localeCompare(b.family));
}

/** Records as the delivery writes them, within [from, to) in milliseconds (the end excluded, as --live's filter): the
 * table. A field outside FIELDS throws. */
export function fold(records, { from, to, malformed = 0 }) {
  const families = new Map();
  let inside = 0;
  for (const record of records) {
    const extra = Object.keys(record).filter((key) => !FIELDS.includes(key));
    if (extra.length) throw new Error(`a record holds fields the delivery does not give: ${extra.join(", ")}`);
    const at = Number(record["timestamp(ms)"]);
    if (!(at >= from && at < to)) continue;
    inside++;
    const row = accumulate(families, familyOf(record["viewer-request-log-data"], record["cache-behavior-path-pattern"]), {
      result: record["x-edge-result-type"], method: record["cs-method"], status: Number(record["sc-status"]), bytes: Number(record["sc-bytes"]) || 0,
    });
    const taken = Number(record["time-taken"]);
    if (Number.isFinite(taken)) row.times.push(taken);
  }
  return { window: { from, to, records: inside, malformed }, families: finish(families) };
}

/** The saved queries' rows (Logs Insights results as objects): the same table. Each latency row is one family's: the
 * by-family query's by its value, the other and media queries' one row each. */
export function foldRows({ cache = [], latency = [], other = [], media = [] }, { from, to }) {
  const families = new Map();
  let total = 0;
  for (const r of cache) {
    const n = Number(r.n) || 0;
    total += n;
    accumulate(families, familyOf(r.family, r.behaviour), { result: r.result, method: r.method, status: Number(r.status), n, bytes: Number(r.bytes) || 0 });
  }
  const times = (r) => ({ p50: round(Number(r.p50)), p95: round(Number(r.p95)) });
  const percentiles = new Map(latency.map((r) => [familyOf(r.family, null), times(r)]));
  if (other[0]) percentiles.set("other", times(other[0]));
  if (media[0]) percentiles.set("media", times(media[0]));
  return { window: { from, to, records: total, malformed: 0 }, families: finish(families, percentiles) };
}

export function render(table) {
  const share = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);
  const lines = [`window ${new Date(table.window.from).toISOString()} → ${new Date(table.window.to).toISOString()}: ${table.window.records} requests` +
    (table.window.malformed ? `, ${table.window.malformed} malformed lines` : "")];
  lines.push(["family", "requests", "hit", "refresh", "miss", "error", "other", "hit share", "refresh share", "bytes", "p50 s", "p95 s"].join("\t"));
  for (const f of table.families)
    lines.push([f.apart ? `(${f.family})` : f.family, f.requests, f.hit, f.refresh, f.miss, f.error, f.other, share(f.hitShare),
      share(f.refreshShare), f.bytes, f.p50 ?? "—", f.p95 ?? "—"].join("\t"));
  return lines.join("\n");
}

const run = promisify(execFile);
const aws = async (...args) => JSON.parse((await run("aws", [...args, "--region", REGION, "--output", "json"], { maxBuffer: 64 << 20 })).stdout);
const rowsOf = (results) => results.map((fields) => Object.fromEntries(fields.filter((f) => f.field !== "@ptr").map((f) => [f.field, f.value])));

async function live({ from, to }) {
  const { queryDefinitions = [] } = await aws("logs", "describe-query-definitions", "--query-definition-name-prefix", "vega-v2/api-");
  const named = (name) => {
    const found = queryDefinitions.find((q) => q.name === name);
    if (!found) throw new Error(`no saved query ${name} in ${REGION} (stack vega-v2-edge-logs)`);
    return found;
  };
  // Logs Insights takes whole seconds (both included): the seconds that cover [from, to), then every query filtered to
  // the window itself, in milliseconds, as --records takes it (GH149.1, one window both ways).
  const window = `filter toMillis(@timestamp) >= ${from} and toMillis(@timestamp) < ${to}`;
  const query = async (definition) => {
    const { queryId } = await aws("logs", "start-query", "--log-group-names", definition.logGroupNames[0], "--start-time", String(Math.floor(from / 1000)),
      "--end-time", String(Math.ceil(to / 1000)), "--query-string", `${window} | ${definition.queryString}`);
    for (let attempt = 0; attempt < 120; attempt++) {
      const answer = await aws("logs", "get-query-results", "--query-id", queryId);
      if (answer.status === "Complete") return rowsOf(answer.results || []);
      if (["Failed", "Cancelled", "Timeout"].includes(answer.status)) throw new Error(`query ${definition.name}: ${answer.status}`);
      await new Promise((done) => setTimeout(done, 1000));
    }
    throw new Error(`query ${definition.name}: not complete after 120 s`);
  };
  const [cache, latency, other, media] = await Promise.all([CACHE_QUERY, LATENCY_QUERY, OTHER_QUERY, MEDIA_QUERY].map((name) => query(named(name))));
  return foldRows({ cache, latency, other, media }, { from, to });
}

export async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--json" || flag === "--live") options[flag.slice(2)] = true;
    else if (["--records", "--from", "--to"].includes(flag) && argv[i + 1] !== undefined) options[flag.slice(2)] = argv[++i];
    else return usage(`unknown argument ${flag}`);
  }
  const from = Date.parse(options.from ?? ""), to = Date.parse(options.to ?? "");
  if (!Number.isFinite(from) || !Number.isFinite(to)) return usage("--from and --to are required (ISO times)");
  if (to <= from) return usage("--to must come after --from");
  if (Boolean(options.records) === Boolean(options.live)) return usage("one of --records <file> or --live");
  let table;
  try {
    if (options.live) table = await live({ from, to });
    else {
      const records = [];
      let malformed = 0;
      for (const line of (await readFile(options.records, "utf8")).split("\n")) {
        if (!line.trim()) continue;
        try {
          records.push(JSON.parse(line));
        } catch {
          malformed++;
        }
      }
      table = fold(records, { from, to, malformed });
    }
  } catch (error) {
    console.error(`edge-cache-report: ${error.message}`);
    return 1;
  }
  console.log(options.json ? JSON.stringify(table) : render(table));
  return 0;
}

function usage(why) {
  console.error(`edge-cache-report: ${why}\nusage: node infra/aws/edge-cache-report.mjs (--records <file> | --live) --from <ISO> --to <ISO> [--json]`);
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) process.exitCode = await main(process.argv.slice(2));
