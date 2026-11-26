// A few unconditional public reads at the deployed origin. The existing release and
// favourites checks through the distribution run separately.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export const DB_BUDGET_MS = 3000;
const HANDLER_BUDGET_MS = 5000;
const INVOKE_TIMEOUT_MS = 15000;
const TEAM = /^t_(?:[A-Za-z0-9]{6}|v\d{7})$/;
const PLAYER = /^p_(?:[A-Za-z0-9]{6}|v\d{7})$/;
const SHA = /^[a-f0-9]{64}$/;
const run = promisify(execFile);
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const named = (s) => typeof s === "string" && s.trim().length > 0;

export function readTiming(value) {
  const timing = /^total;dur=(\d+(?:\.\d+)?), db;dur=(\d+(?:\.\d+)?);desc="(\d+) quer(?:y|ies)"$/.exec(value ?? "");
  if (!timing) return null;
  const [totalMs, dbMs, queries] = timing.slice(1).map(Number);
  return Number.isFinite(totalMs) && Number.isFinite(dbMs) && integer(queries) ? { totalMs, dbMs, queries } : null;
}

function settings([flag, release, ...rest], env) {
  if (flag !== "--release" || !SHA.test(release ?? "") || !(rest.length === 0 || rest.length === 1 && rest[0] === "--allow-empty"))
    return null;
  const { SMOKE_PUBLIC_TEAMS, SMOKE_PUBLIC_SEASON } = env;
  if (Boolean(SMOKE_PUBLIC_TEAMS) !== Boolean(SMOKE_PUBLIC_SEASON)) return null;
  const teams = (SMOKE_PUBLIC_TEAMS || "t_0tnX1I,t_2ihyjC").split(",");
  const season = SMOKE_PUBLIC_SEASON || "2026/2027";
  if (teams.length !== 2 || teams[0] === teams[1] || !teams.every((team) => TEAM.test(team))) return null;
  const [start, end] = season.split("/");
  if (!/^\d{4}\/\d{4}$/.test(season) || Number(end) !== Number(start) + 1) return null;
  return { release, teams, season, allowEmpty: rest.length === 1 };
}

async function invoke(path, outfile) {
  const url = new URL(path, "https://api.invalid");
  const event = {
    version: "2.0", rawPath: url.pathname, rawQueryString: url.search.slice(1),
    headers: { accept: "application/json" }, requestContext: { http: { method: "GET" } },
  };
  let stdout;
  try {
    ({ stdout } = await run("aws", ["lambda", "invoke", "--function-name", "vega-v2-api", "--invocation-type", "RequestResponse",
      "--cli-binary-format", "raw-in-base64-out", "--payload", JSON.stringify(event), "--output", "json", "--no-cli-pager", outfile],
    { timeout: INVOKE_TIMEOUT_MS, env: { ...process.env, AWS_MAX_ATTEMPTS: "1" } }));
  } catch (error) {
    const code = /An error occurred \(([A-Za-z0-9]+)\)/.exec(error.stderr ?? "")?.[1] ?? (error.killed ? "timeout" : "failed");
    throw new Error("Lambda Invoke " + code, { cause: error });
  }
  const meta = JSON.parse(stdout);
  if (meta.FunctionError) throw new Error("Lambda Invoke FunctionError");
  if (meta.StatusCode !== 200 || meta.ExecutedVersion !== "$LATEST") throw new Error("unexpected Lambda Invoke metadata");
  const response = JSON.parse(await readFile(outfile, "utf8"));
  if (!Number.isInteger(response.statusCode) || typeof response.body !== "string" || response.isBase64Encoded !== false)
    throw new Error("invalid Function URL response");
  const headers = new Headers(response.headers);
  let json;
  try { json = JSON.parse(response.body); } catch { /* validated after status and timings */ }
  return { status: response.statusCode, headers, json, bytes: Buffer.byteLength(response.body) };
}

function hasSubstitutions(json, team, season) {
  const d = json?.data;
  if (d?.id !== team || d.season !== season || !integer(d.matches) || d.matches === 0 ||
      !integer(d.pointsThen) || !integer(d.points) || d.gained !== d.points - d.pointsThen ||
      !Array.isArray(d.substitutes) || d.substitutes.length < 1 || d.substitutes.length > 3) return false;
  const states = [d.leading, d.level, d.behind];
  if (!states.every((s) => s && integer(s.matches) && integer(s.pointsThen) && integer(s.points))) return false;
  return ["matches", "pointsThen", "points"].every((key) => d[key] === states.reduce((sum, s) => sum + s[key], 0)) &&
    d.substitutes.every((p) => p && PLAYER.test(p.id ?? "") && named(p.name) && integer(p.entries) && p.entries > 0 &&
      integer(p.minutes) && p.minutes > 0 && integer(p.goals) && integer(p.assists) && p.goals + p.assists > 0);
}

export async function main(argv, env = process.env) {
  const options = settings(argv, env);
  if (!options) {
    console.error("usage: node infra/aws/smoke-public-reads.mjs --release <sha256> [--allow-empty]; " +
      "SMOKE_PUBLIC_SEASON and SMOKE_PUBLIC_TEAMS (two comma-separated team ids) must be set together");
    return 2;
  }
  const { release, teams, season, allowEmpty } = options;
  const tmp = await mkdtemp(join(tmpdir(), "vega-public-reads-"));
  try {
    const check = async (name, path, verify, isEmpty = () => false) => {
      const started = performance.now();
      let result = "";
      try {
        const r = await invoke(path, join(tmp, "response.json"));
        const timing = readTiming(r.headers.get("server-timing"));
        result = ` ${r.status} wall=${Math.round(performance.now() - started)}ms` +
          (timing ? ` total=${timing.totalMs}ms db=${timing.dbMs}ms queries=${timing.queries}` : "") + ` bytes=${r.bytes}`;
        if (r.headers.has("x-cache") || r.headers.has("age")) throw new Error("cache metadata on an origin response");
        const empty = isEmpty(r);
        if (r.status !== 200 && !empty) throw new Error("status " + r.status);
        if (!timing || timing.queries === 0) throw new Error("missing or invalid Server-Timing");
        if (timing.dbMs > DB_BUDGET_MS) throw new Error("SQL budget of " + DB_BUDGET_MS + " ms exceeded");
        if (timing.totalMs > HANDLER_BUDGET_MS) throw new Error("handler budget of " + HANDLER_BUDGET_MS + " ms exceeded");
        if (!r.json || !/^application\/json\b/i.test(r.headers.get("content-type") ?? "")) throw new Error("missing JSON body");
        if (!empty) verify(r.json);
        console.log(`public origin ${name}${result}${empty ? " skipped (first install with no published season)" : ""}`);
        return { ok: true, empty };
      } catch (error) {
        const message = error instanceof SyntaxError ? "malformed Invoke metadata or response" : error.message;
        console.log(`public origin ${name}${result} FAILED: ${message}`);
        return { ok: false };
      }
    };
    const health = await check("health", "/api/health", (json) => {
      if (json.release !== release) throw new Error("wrong release");
      if (json.status !== "ok" || !/^\d+$/.test(json.revision ?? "")) throw new Error("unexpected health body");
    }, ({ status, json }) => allowEmpty && status === 503 && json?.status === "pending" && json.release === release && json.revision === "0");
    if (!health.ok || health.empty) return health.ok ? 0 : 1;

    const paths = [
      ...teams.map((team) => ({
        name: "substitutions " + team + " " + season,
        path: `/api/teams/${team}/substitutions?season=${encodeURIComponent(season)}`,
        verify: (json) => {
          if (!hasSubstitutions(json, team, season)) throw new Error("missing substitution data for the expected team and season");
        },
      })),
      { name: "team profile " + teams[0], path: "/api/teams/" + teams[0], verify: ({ data }) => {
        if (data?.id !== teams[0] || !named(data.name)) throw new Error("missing team profile");
      } },
    ];
    let ok = true;
    for (const { name, path, verify } of paths) {
      const checked = await check(name, path, verify);
      ok = checked.ok && ok;
    }
    return ok ? 0 : 1;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href)
  process.exitCode = await main(process.argv.slice(2));
