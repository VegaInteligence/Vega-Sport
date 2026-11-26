// The time the edge may keep each answer, read from what the code really says (FAILURE_MODES_OPTIMISATIONS.md GH145-d
// to f): the read API's cache helpers (http.mjs), real answers of the handler on the seed (test/seed.py) and of the live
// handler over fake live tables, each through the Lambda transport (infra/aws/transport.mjs) as CloudFront receives it,
// against the cache policy of the behaviour its path takes in infra/aws/api.yaml. A comparison of the header with the
// template's ceilings, not a model of CloudFront: no source scan, no claim to list every value the code can say.
//
// Failure modes, and what is expected:
// - the longest freshness a helper can say (cacheHeaders with immutable: a year) above the default policy's MaxTTL,
//   so silently cut -> at most Cache's MaxTTL (GH145-d);
// - an error, an answer without freshness or a personal answer kept by the edge -> no-store / private, whatever the
//   ceilings (GH145-d);
// - an answer the section names (status 3600, a profile 300, the archives' details 3600, an asset redirection 86400,
//   a ranking 60, the home 60 with its stale windows, a match family 60 once finished and 15 before) cut by the ceiling
//   of its behaviour -> its s-maxage, and for the API its stale windows too, within its behaviour's MaxTTL (GH145-e);
// - /live/config's minute cut to 2 s -> within its behaviour's MaxTTL; a live match state's ceiling raised, so that the
//   edge could answer from an expired score for longer than before while the live function fails -> the live match
//   behaviour keeps MaxTTL 2, its s-maxage, and /live/config takes another behaviour (GH145-f).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { context, skip } from "./context.mjs";
import { cacheHeaders, send, staleHeaders } from "../src/http.mjs";
import { HOME_STALE } from "../src/routes/home.mjs";
import { createLiveHandler } from "../src/live.mjs";
import { adapt, edgeCacheControl } from "../../../infra/aws/transport.mjs";

const TEMPLATE = readFileSync(new URL("../../../infra/aws/api.yaml", import.meta.url), "utf8");
// AWS's managed policies on the image copies (CachingOptimized) and the status page (CachingDisabled).
const MANAGED = { "658327ea-f89d-4fab-a63d-7e88639e58f6": [1, 86400, 31536000], "4135ea2d-6df8-44a3-9df3-4b5a84be39ad": [0, 0, 0] };

/** A cache policy of the template by its resource name: [MinTTL, DefaultTTL, MaxTTL]. */
function policy(ref) {
  if (MANAGED[ref]) return MANAGED[ref];
  const name = ref.replace(/^!Ref /, "");
  const block = new RegExp(`\\n  ${name}:\\n    Type: AWS::CloudFront::CachePolicy\\n((?:    .*\\n)+)`).exec(TEMPLATE);
  assert.ok(block, `cache policy ${name}`);
  return ["MinTTL", "DefaultTTL", "MaxTTL"].map((k) => Number(new RegExp(`\\n        ${k}: (\\d+)\\n`).exec("\n" + block[1])[1]));
}

/** The behaviour a path takes: the first pattern that matches, in the template's order, else the default. */
function behaviourOf(path) {
  const distribution = TEMPLATE.slice(TEMPLATE.indexOf("\n  Distribution:\n"));
  const listed = distribution.slice(distribution.indexOf("        CacheBehaviors:\n"), distribution.indexOf("        DefaultCacheBehavior:\n"));
  const items = listed.split("\n          - PathPattern: ").slice(1).map((item) => ({
    pattern: item.split("\n", 1)[0].trim(),
    cache: /CachePolicyId: ([^\n]+)/.exec(item)[1].trim(),
  }));
  const glob = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  const found = items.find((b) => glob(b.pattern).test(path.replace(/^\//, "")));
  if (found) return { ...found, ttls: policy(found.cache) };
  const cache = /DefaultCacheBehavior:\n(?:          .*\n)*?          CachePolicyId: (.+)\n/.exec(distribution)[1].trim();
  return { pattern: "default", cache, ttls: policy(cache) };
}

/** The directives of a Cache-Control value. */
function directives(value) {
  const out = { value };
  for (const part of String(value || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const [k, v] = part.split("=");
    out[k] = v === undefined ? true : Number(v);
  }
  return out;
}
const edge = (headers) => directives(edgeCacheControl(headers["Cache-Control"] ?? headers.get?.("cache-control")));

const event = (method, path, query = "", headers = {}) => ({
  version: "2.0", rawPath: path, rawQueryString: query, headers: { "accept-encoding": "identity", ...headers }, requestContext: { http: { method } },
});

test("GH145-d: the longest freshness the read API's helpers can say fits the default policy", () => {
  const said = [cacheHeaders(2, 0), cacheHeaders(60, 0), cacheHeaders(300, 0), cacheHeaders(3600, 0), cacheHeaders(5, 0, { immutable: true }), staleHeaders(60, HOME_STALE)].map(edge);
  const longest = Math.max(...said.map((d) => d["s-maxage"]));
  assert.equal(longest, 31536000, "the immutable answer: a year");
  const [, , max] = behaviourOf("/api/anything").ttls;
  assert.ok(longest <= max, `a year said, the default policy keeps ${max} s at most`);
  // The home's windows (stale-while-revalidate, stale-if-error) beyond its freshness fit as well.
  const home = said.at(-1);
  assert.deepEqual([home["s-maxage"], home["stale-while-revalidate"], home["stale-if-error"]], [60, 300, 86400]);
  assert.ok(home["s-maxage"] + home["stale-if-error"] <= max, "the home's day of stale-if-error within the ceiling");
});

test("GH145-d: errors, answers without freshness and personal answers are kept by no one", async () => {
  const req = new Request("https://api.test/api/x");
  const cases = [send(req, { error: 1 }, 404), send(req, { error: 1 }, 503), send(req, { a: 1 }, 200, { ttl: 0 }), send(req, { a: 1 }, 200, { ttl: 60, personal: true })];
  const seen = cases.map((res) => edgeCacheControl(res.headers.get("cache-control")));
  assert.deepEqual(seen, ["no-store", "no-store", "no-store", "private, max-age=0, must-revalidate"]);
  assert.equal(edgeCacheControl(undefined), "no-store", "an answer that says nothing");
  const [min, def] = behaviourOf("/api/anything").ttls;
  assert.deepEqual([min, def], [0, 0], "no minimum forces them in, no default keeps the silent ones");
});

test("GH145-e: the answers the section names fit the ceiling of their behaviour", { skip }, async () => {
  const api = adapt(context.handle);
  const cases = [
    ["/api/status", "", 3600],
    ["/api/players/p_aaaab1", "", 300],
    ["/api/archives/details", "", 3600],
    ["/api/assets", "url=" + encodeURIComponent("https://img.example/t1.png"), 86400],
    ["/api/rankings/index", "", 60],
    ["/api/read/home", "season=2025/2026&leagues=all", 60],
    ["/api/matches/m_aaaaa1", "", 60],
    ["/api/matches/m_aaaaa6", "", 15],
  ];
  for (const [path, query, says] of cases) {
    const res = await api(event("GET", path, query));
    assert.ok([200, 307].includes(res.statusCode), `${path}: ${res.statusCode}`);
    const d = directives(res.headers["cache-control"]);
    assert.equal(d["s-maxage"], says, `${path} says ${says} s`);
    const { pattern, ttls } = behaviourOf(path);
    assert.ok(d["s-maxage"] <= ttls[2], `${path} (${pattern}): s-maxage ${d["s-maxage"]} > MaxTTL ${ttls[2]}`);
    const stale = Math.max(d["stale-while-revalidate"] || 0, d["stale-if-error"] || 0);
    assert.ok(d["s-maxage"] + stale <= ttls[2], `${path} (${pattern}): its stale windows cut by MaxTTL ${ttls[2]}`);
  }
});

test("GH145-f: /live/config keeps its minute; a live match state keeps the bound it had", async () => {
  const NOW = Date.parse("2025-09-20T21:00:00Z");
  const state = { match: "m_live01", revision: 1, status: "in_play", minute: 10, home_score: 1, away_score: 0, kickoff_at: "2025-09-20T20:50:00Z", expires_at: NOW / 1000 + 3600 };
  const live = adapt(createLiveHandler(
    { state: async (id) => (id === "m_live01" ? state : null), events: async () => [], stats: async () => [] },
    { clock: () => NOW, config: { provider: "replay", http: "https://live.test/", realtime: "wss://live.test/", key: "k" } },
  ));
  const config = await live(event("GET", "/live/config"));
  const match = await live(event("GET", "/live/matches/m_live01"));
  assert.deepEqual([config.statusCode, match.statusCode], [200, 200]);
  const c = directives(config.headers["cache-control"]), m = directives(match.headers["cache-control"]);
  assert.deepEqual([c["s-maxage"], m["s-maxage"]], [60, 2]);
  const ofConfig = behaviourOf("/live/config"), ofMatch = behaviourOf("/live/matches/m_live01");
  assert.ok(c["s-maxage"] <= ofConfig.ttls[2], `/live/config (${ofConfig.pattern}): 60 s said, MaxTTL ${ofConfig.ttls[2]}`);
  // The transport lets every public answer be served stale on an error for a day; the live match's own ceiling, as
  // before, leaves no room past its 2 s.
  assert.equal(m["stale-if-error"], 86400);
  assert.deepEqual([ofMatch.pattern, ofMatch.ttls], ["live/*", [0, 2, 2]], "the live match states' policy as before");
  assert.notEqual(ofConfig.cache, ofMatch.cache, "/live/config on a policy of its own");
});
