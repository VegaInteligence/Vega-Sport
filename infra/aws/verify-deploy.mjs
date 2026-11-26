// The checks at the end of a Deploy (deploy.sh step 11b; FAILURE_MODES_OPTIMISATIONS.md GH202), each run whatever the
// other answers, one line each; never a body, a name or an id.
//
//   node infra/aws/verify-deploy.mjs https://<the read API's distribution> --release <sha256> \
//     --services vega-v2-worker=<count>@<task definition>,vega-v2-backfill=<count>@<task definition> \
//     [--tries 24 --interval 5] [--service-tries 30 --service-interval 10]
//
// - release: /api/health through the distribution (never kept there) until it answers 200, status ok and the release
//   uploaded (the package's SHA-256), within the tries.
// - services: `aws ecs describe-services` until each service has the desired count given, as many running, one
//   deployment, primary, COMPLETED, on the task definition given (the stack's, with its revision).
// Nothing else is asked: the home's personal read is step 12's (infra/aws/smoke-favourites.mjs, GH220.3; a visitor's
// list of several clubs and players is its own, GH #220).
// Exit 0: all passed; 1: one failed; 2: the arguments.
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const SHA = /^[a-f0-9]{64}$/;
const SERVICE = /^(vega-v2-[a-z-]+)=([01])@(arn:aws:ecs:[a-z0-9-]+:\d{12}:task-definition\/[A-Za-z0-9_-]+:\d+)$/;
const say = (line) => console.log(line);
const sleep = (seconds) => new Promise((done) => setTimeout(done, seconds * 1000));
const short = (release) => (typeof release === "string" ? release.slice(0, 12) : "null");

export function parse(argv) {
  const [origin, ...rest] = argv;
  if (!/^https?:\/\/[^/?#\s]+\/?$/.test(origin || "")) return null;
  const o = { base: origin.replace(/\/$/, ""), tries: 24, interval: 5, serviceTries: 30, serviceInterval: 10 };
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (value === undefined) return null;
    if (flag === "--release" && SHA.test(value)) o.release = value;
    else if (flag === "--services") {
      o.services = value.split(",").map((item) => SERVICE.exec(item));
      if (!o.services.length || o.services.some((m) => !m)) return null;
      o.services = o.services.map(([, name, count, taskDefinition]) => ({ name, count: Number(count), taskDefinition }));
    } else if (["--tries", "--service-tries"].includes(flag) && /^[1-9]\d{0,2}$/.test(value)) o[flag === "--tries" ? "tries" : "serviceTries"] = Number(value);
    else if (["--interval", "--service-interval"].includes(flag) && /^\d{1,3}$/.test(value)) o[flag === "--interval" ? "interval" : "serviceInterval"] = Number(value);
    else return null;
  }
  if (!o.release || !o.services) return null;
  return o;
}

// One GET, the network tried once more (20 s each): its status and JSON, or the network's code.
async function get(base, path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(base + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      const text = await response.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { status: response.status, json };
    } catch (error) {
      if (attempt >= 2) return { network: String(error?.cause?.code || error?.name || "error").slice(0, 40) };
    }
  }
}

export async function checkRelease({ base, release, tries, interval }) {
  let last = "no answer";
  for (let i = 1; i <= tries; i++) {
    const r = await get(base, "/api/health");
    if (r.network) last = `network (${r.network})`;
    else if (r.status !== 200) last = `/api/health status ${r.status}`;
    else if (r.json?.status !== "ok") last = `/api/health says ${String(r.json?.status).slice(0, 20)}`;
    else if (r.json.release !== release) last = `the distribution serves ${short(r.json.release)}, not ${short(release)}`;
    else {
      say(`release: 200 ok, ${short(release)} served (try ${i} of ${tries})`);
      return true;
    }
    if (i < tries) await sleep(interval);
  }
  say(`release: FAILED after ${tries} tries: ${last}`);
  return false;
}

const family = (taskDefinition) => String(taskDefinition || "").split("/").pop();

export async function checkServices({ services, serviceTries: tries, serviceInterval: interval }) {
  let last = "";
  for (let i = 1; i <= tries; i++) {
    let problems = [];
    try {
      const { stdout } = await promisify(execFile)("aws", ["ecs", "describe-services", "--cluster", "vega-v2", "--services", ...services.map((s) => s.name), "--output", "json"],
        { maxBuffer: 16 << 20 });
      const found = JSON.parse(stdout).services || [];
      for (const want of services) {
        const s = found.find((x) => x.serviceName === want.name);
        if (!s) {
          problems.push(`${want.name}: not found`);
          continue;
        }
        if (s.desiredCount !== want.count) problems.push(`${want.name}: desired ${s.desiredCount}, not ${want.count}`);
        if (s.runningCount !== s.desiredCount) problems.push(`${want.name}: ${s.runningCount} running of ${s.desiredCount}`);
        const deployments = s.deployments || [];
        if (deployments.length !== 1) problems.push(`${want.name}: ${deployments.length} deployments`);
        const primary = deployments.find((d) => d.status === "PRIMARY");
        if (!primary) problems.push(`${want.name}: no primary deployment`);
        else {
          if (primary.taskDefinition !== want.taskDefinition) problems.push(`${want.name}: on ${family(primary.taskDefinition)}, not ${family(want.taskDefinition)}`);
          if (primary.rolloutState && primary.rolloutState !== "COMPLETED") problems.push(`${want.name}: rollout ${primary.rolloutState}`);
        }
      }
    } catch (error) {
      const code = /An error occurred \(([A-Za-z0-9]+)\)/.exec(error.stderr || "")?.[1] || "failed";
      problems = [`describe-services ${code}`];
    }
    if (!problems.length) {
      say(`services: ${services.map((w) => `${w.name} ${w.count}/${w.count} on ${family(w.taskDefinition)}`).join(", ")} (try ${i} of ${tries})`);
      return true;
    }
    last = problems.join("; ");
    if (i < tries) await sleep(interval);
  }
  say(`services: FAILED after ${tries} tries: ${last}`);
  return false;
}

export async function main(argv) {
  const options = parse(argv);
  if (!options) {
    console.error("usage: node infra/aws/verify-deploy.mjs https://<distribution> --release <sha256> --services <name>=<count>@<task definition>,… " +
      "[--tries N --interval S] [--service-tries N --service-interval S]");
    return 2;
  }
  const results = [await checkRelease(options), await checkServices(options)];
  return results.every(Boolean) ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const code = await main(process.argv.slice(2));
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise((done) => stream.write("", done))));
  process.exit(code);
}
