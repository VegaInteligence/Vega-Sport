// Validators read before the answer, from versions the writers keep (FAILURE_MODES_OPTIMISATIONS.md GH137A), on the
// seed of test/seed.py read as vega_read; writes made as the base's owner (the DSN's user).
//
// Failure modes, and what is expected (GH137A-a to p; m and q are test_data_versions.py's and the evidence's):
// - a revalidation that builds the answer -> with the current tag, a 304 after one statement, the version, on a fresh
//   handler (b), HEAD likewise (c); every 200 of the strict suite is re-asked so by context.mjs as well;
// - a 304 for an answer that changed -> a committed change to a table of the closure builds again: a 200 with the
//   current tag, then 304s for it in one statement; a rollback, a savepoint rolled back, an upsert of unchanged values
//   (jsonb included), a conflicting INSERT … DO NOTHING, a DELETE of nothing leave the check (f, g, h);
// - a 304 carrying a tag the request did not hold (RFC 9110 § 13.1.2, RFC 9111 § 4.3.4; second review of 26 Nov 2026)
//   -> a former, stale or other tag of the same bytes is a 200 with the current tag; every 304 here and in the strict
//   suite carries a tag the request held, '*' aside (d, v);
// - a 304 for an error -> 400 / 404 whatever the held tag, '*' included (e);
// - a check that survives a release, a migration or the base's day (i, j);
// - an undeclared read validated by versions -> strict: an error naming it; otherwise the former tag (k);
// - a base without the versions -> the former tags and outcomes (l);
// - a table PostgreSQL reads for a route outside its declared closure, or without triggers (n);
// - a 304 of a match's display with another freshness than its answer's (p).
// Added after the review of 26 Nov 2026 (GH137A-s to w):
// - a leaf partition truncated directly (the review's nine rows of api.player_form_minutes) leaving the version (s);
// - a fast 304 for a tag of another route of the family, of other parameters, or with a right check and another
//   content; a fresh process of the same release refusing a tag of another (t);
// - a 304 or a tag for an answer over its size limit (u);
// - a write that leaves the bytes making every later revalidation build (v);
// - a day passing without any write unseen by a route reading current_date (w);
// - a statement, or a 503, for a request its parameters already refuse (y); a leaf detached, updated and attached again
//   leaving a held tag valid at its route (s).
// Added after the third review (findings 12, 13): the version read with the build's first statement, once per request
// (validation runs once, never against a reader that refuses on purpose); parallel statements and a build that catches a
// statement's rejection neither run a statement of the answer after a verified tag nor turn a failed version into a 200
// (y, probe); two processes of one tree, no release named, agree (i).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { context, heldTag, skip } from "./context.mjs";
import { createHandler } from "../src/handler.mjs";
import { createDataVersions, VERSION_SQL } from "../src/data-versions.mjs";

const DSN = process.env.VEGA_V2_API_NODE_TEST_DSN;
const NOW = Date.parse("2025-09-06T12:00:00Z");
const V2 = /^W\/"([a-z][a-z-]*)-v2-([a-f0-9]{16})-([a-f0-9]{64})"$/;
const sha = (value) => createHash("sha256").update(value).digest("hex");
let owner;
before(async () => {
  if (skip) return;
  owner = new pg.Client({ connectionString: DSN });
  await owner.connect();
});
after(() => owner?.end());

/** A handler of its own (nothing kept from another request), its statements counted; `served` the declared reads. */
function fresh(read = context.reader.read) {
  const statements = [], served = [];
  const handle = createHandler({
    read: async (sql, ...rest) => (statements.push(sql), read(sql, ...rest)), mediaBase: "https://media.test/", clock: () => NOW,
    versions: { strict: true, observe: (event) => served.push(event) },
  });
  const ask = async (path, headers = {}, method = "GET") => {
    statements.length = 0;
    const response = await handle(new Request("https://api.test" + path, { headers, method }));
    heldTag(headers, response);
    const text = response.status === 304 || method === "HEAD" ? "" : await response.text();
    return { status: response.status, etag: response.headers.get("etag"), cache: response.headers.get("cache-control"), text, statements: [...statements] };
  };
  return { ask, served };
}
const versionOnly = (r) => r.statements.length === 1 && /api\.data_version\(/.test(r.statements[0]);

// Answers of the seed, one or more per family of the manifest (the others: the route test files, strict).
const ANSWERS = [
  "/api/rankings/power?kind=players&season=2025/2026", "/api/rankings/power?kind=clubs&season=2025/2026",
  "/api/rankings/power/player?season=2025/2026&player=p_aaaab1", "/api/rankings/power/history?player=p_aaaab1",
  "/api/rankings/level?season=2025/2026", "/api/rankings/level/player?season=2025/2026&player=p_aaaab1",
  "/api/rankings/award?season=2025/2026", "/api/rankings/award/player?season=2025/2026&player=p_aaaab1",
  "/api/rankings/leagues", "/api/rankings/breakouts?season=2025/2026", "/api/rankings/match?match=m_aaaaa1",
  "/api/rankings/rounds?competition=l_3FJFUl&season=2025/2026", "/api/rankings/round?competition=l_3FJFUl&season=2025/2026",
  "/api/rankings/fates?competition=l_3FJFUl&season=2025/2026", "/api/rankings/index", "/api/rankings/edition?kind=uefa-clubs&edition=2026",
  "/api/rankings/associations?year=2026", "/api/rankings/club?club=t_aaaaa1", "/api/club-links?club=t_aaaaa1",
  "/api/forecasts/live?match=m_aaaaa1", "/api/forecasts/odds?match=m_aaaaa6", "/api/forecasts/season?competition=l_3FJFUl&season=2025/2026",
  "/api/forecasts/swap?season=2025/2026&out=p_aaaab1&in=p_aaaab2",
  "/api/archives/index?kind=results", "/api/archives/index?kind=goals", "/api/archives/details",
  "/api/cups/index", "/api/cup-index?kind=supplemental", "/api/cup-snapshot?kind=native&competition=l_3FJFUl&season=2025/2026",
  "/api/cup-snapshot?kind=standings&competition=l_3FJFUl&season=2025/2026",
  "/api/player-honours?id=p_aaaab1", "/api/club-facts?club=t_aaaaa1", "/api/coach-portrait?name=coach%20un", "/api/stadium?club=t_aaaaa1",
  "/api/players/p_aaaab1", "/api/teams/t_aaaaa1", "/api/competitions", "/api/players/facts-coverage", "/api/player-market-values?id=p_aaaab2",
  "/api/players/p_aaaab1/partners?season=2025/2026", "/api/players/p_aaaab1/similar?season=2025/2026", "/api/players/p_aaaab2/return",
  "/api/players/p_aaaab1/halves?season=2025/2026", "/api/players/p_aaaab1/actions?season=2025/2026", "/api/players/p_aaaab1/style?season=2025/2026",
  "/api/teams/t_aaaaa1/age-profile?season=2025/2026", "/api/teams/t_aaaaa1/passing?season=2025/2026", "/api/teams/t_aaaaa1/substitutions?season=2025/2026",
  "/api/nations?season=2025%2F2026", "/api/player-form?season=2025/2026", "/api/matches/m_aaaaa1/players/display",
];
const ERRORS = [
  ["/api/rankings/power?kind=players&season=bad", 400], ["/api/rankings/power?season=2030/2031", 404], ["/api/players/p_zzzzzz", 404],
  ["/api/standings?competition=l_zzzzzz", 404], ["/api/matchdays?competition=l_3FJFUl", 400], ["/api/worldcup/matches?edition=1974", 404],
  ["/api/archives/details?match=r:nowhere:1", 404], ["/api/nations/t_zzzzzz?season=2025/2026", 404], ["/api/rankings/index?x=1", 400],
  ["/api/league-history?competition=l_3FJFUl&season=2015/2016", 404], ["/api/matches/m_aaaaa6/players/display", 404],
];

test("GH137A-a, b: every answer of the manifest, then its tag: 304 in one statement, the version, on a fresh handler", { skip }, async () => {
  for (const path of ANSWERS) {
    const first = await fresh().ask(path);
    assert.equal(first.status, 200, `${path}: ${first.status} ${first.text.slice(0, 120)}`);
    assert.match(first.etag, V2, `${path}: ${first.etag}`);
    const again = await fresh().ask(path, { "if-none-match": first.etag });
    assert.equal(again.status, 304, path);
    assert.equal(again.etag, first.etag, path);
    assert.equal(again.cache, first.cache, `${path}: the 304 says the answer's freshness`);
    assert.ok(versionOnly(again), `${path}: ${again.statements.length} statements on a 304: ${again.statements.map((s) => s.slice(0, 60)).join(" | ")}`);
  }
});

test("GH137A-c: HEAD builds; HEAD with the tag is a 304 in one statement", { skip }, async () => {
  const path = "/api/rankings/power?kind=players&season=2025/2026";
  const get = await fresh().ask(path);
  const head = await fresh().ask(path, {}, "HEAD");
  assert.deepEqual([head.status, head.etag, head.text], [200, get.etag, ""]);
  assert.ok(head.statements.length > 1, "a HEAD without tag builds: its status says whether the answer exists");
  const held = await fresh().ask(path, { "if-none-match": get.etag }, "HEAD");
  assert.equal(held.status, 304);
  assert.ok(versionOnly(held));
});

test("GH137A-d: former, other, forged and listed tags", { skip }, async () => {
  const path = "/api/rankings/index";
  const first = await fresh().ask(path);
  const [, family, check, content] = V2.exec(first.etag);
  assert.equal(family, "catalog");
  // The base commit's tag: the SHA-256 of the same JSON (rankings.mjs respond of 6c753375).
  assert.equal(content, sha(first.text));
  // The base commit's tag of the same bytes is not the tag a 200 carries now: one 200 with the current tag.
  const former = `W/"catalog-v1-${content}"`;
  const byFormer = await fresh().ask(path, { "if-none-match": former });
  assert.deepEqual([byFormer.status, byFormer.etag, byFormer.text], [200, first.etag, first.text], "the base commit's tag: 200 once");
  assert.ok(byFormer.statements.length > 1, "built: a former tag holds no check");
  for (const held of [`W/"catalog-v1-${"0".repeat(64)}"`, `W/"catalog-v2-${check}-${"0".repeat(64)}"`, `W/"catalog-v2-${"0".repeat(16)}-${"1".repeat(64)}"`,
    `W/"support-v2-${check}-${content}"`, "garbage", 'W/"catalog-v2-0"'])
    assert.equal((await fresh().ask(path, { "if-none-match": held })).status, 200, held);
  // A tag of these bytes under another check (another version's, or forged): not the current tag, a 200.
  const otherCheck = await fresh().ask(path, { "if-none-match": `W/"catalog-v2-${"0".repeat(16)}-${content}"` });
  assert.deepEqual([otherCheck.status, otherCheck.etag], [200, first.etag]);
  assert.ok(otherCheck.statements.length > 1);
  const star = await fresh().ask(path, { "if-none-match": "*" });
  assert.deepEqual([star.status, star.etag], [304, first.etag]);
  assert.ok(star.statements.length > 1, "'*' builds: it needs to know the answer exists");
  const listed = await fresh().ask(path, { "if-none-match": `W/"x", ${first.etag}` });
  assert.equal(listed.status, 304);
  assert.ok(versionOnly(listed));
});

test("GH137A-e: errors are never a 304, whatever is held", { skip }, async () => {
  const tag = (await fresh().ask("/api/rankings/index")).etag;
  for (const [path, status] of ERRORS)
    for (const held of [null, "*", tag]) {
      const r = await fresh().ask(path, held ? { "if-none-match": held } : {});
      assert.equal(r.status, status, `${path} with ${held}`);
      assert.equal(r.cache, "no-store", path);
    }
});

/** The tag of a path now, and what a holder of `tag` gets. */
async function held(path, tag) {
  const r = await fresh().ask(path, { "if-none-match": tag });
  return { status: r.status, fast: versionOnly(r), etag: r.etag };
}

test("GH137A-f, g, h: committed changes build again; rollbacks and changes that are none do not", { skip }, async () => {
  const path = "/api/rankings/index";
  const base = await fresh().ask(path);
  // A rollback, a savepoint rolled back: no mark.
  await owner.query("BEGIN");
  await owner.query("UPDATE core.ranking_editions SET source_url = coalesce(source_url, '') || '#x'");
  await owner.query("ROLLBACK");
  assert.deepEqual(await held(path, base.etag), { status: 304, fast: true, etag: base.etag }, "rolled back");
  await owner.query("BEGIN");
  await owner.query("SAVEPOINT s");
  await owner.query("UPDATE core.ranking_editions SET source_url = coalesce(source_url, '') || '#x'");
  await owner.query("ROLLBACK TO SAVEPOINT s");
  await owner.query("COMMIT");
  assert.deepEqual(await held(path, base.etag), { status: 304, fast: true, etag: base.etag }, "savepoint rolled back");
  // Changes that are none: unchanged values, a conflicting insert, a delete of nothing.
  await owner.query("UPDATE core.ranking_editions SET source_url = source_url, label = label");
  await owner.query("INSERT INTO core.ranking_editions SELECT * FROM core.ranking_editions ON CONFLICT (id) DO NOTHING");
  await owner.query("DELETE FROM core.ranking_editions WHERE false");
  assert.deepEqual(await held(path, base.etag), { status: 304, fast: true, etag: base.etag }, "no change");
  // jsonb: an award run upserted with the same settings (the award's closure).
  const award = "/api/rankings/award?season=2025/2026";
  const awardTag = (await fresh().ask(award)).etag;
  await owner.query("UPDATE agg.award_runs SET settings = settings::text::jsonb, spreads = spreads");
  assert.deepEqual(await held(award, awardTag), { status: 304, fast: true, etag: awardTag }, "jsonb unchanged");
  // A committed change that leaves the answer as it was: built again, 304 by content, a new check.
  await owner.query("BEGIN");
  await owner.query("UPDATE core.ranking_editions SET checked_at = coalesce(checked_at, now()) + interval '1 second'");
  await owner.query("UPDATE core.ranking_editions SET checked_at = checked_at - interval '1 second'");
  await owner.query("COMMIT");
  const same = await fresh().ask(path, { "if-none-match": base.etag });
  assert.deepEqual([same.status, same.text], [200, base.text], "a change and its reversal: a 200 once, the same bytes");
  assert.ok(!versionOnly(same));
  assert.notEqual(same.etag, base.etag, "another check");
  assert.equal(V2.exec(same.etag)[3], V2.exec(base.etag)[3], "the same content");
  // GH137A-v: the 304 gave the current tag; its holder's next revalidation is a 304 in one statement.
  assert.deepEqual(await held(path, same.etag), { status: 304, fast: true, etag: same.etag }, "the next revalidation");
  // A committed change of the answer: 200 with it, for whoever holds the former tag.
  await owner.query("UPDATE core.ranking_editions SET source_url = 'https://example.test/changed' WHERE id = (SELECT min(id) FROM core.ranking_editions)");
  const changed = await fresh().ask(path, { "if-none-match": base.etag });
  assert.equal(changed.status, 200);
  assert.match(changed.text, /example\.test\/changed/);
  assert.notEqual(V2.exec(changed.etag)[3], V2.exec(base.etag)[3]);
  // Whoever holds the new tag: 304 in one statement again.
  assert.deepEqual(await held(path, changed.etag), { status: 304, fast: true, etag: changed.etag }, "usable again");
});

test("GH137A-i, z: another migration recorded: unknown until it is tracked, then another check; the same base, the same", { skip }, async () => {
  const path = "/api/competitions";
  const before = await fresh().ask(path);
  assert.equal((await fresh().ask(path)).etag, before.etag, "the same base and release: the same tag");
  await owner.query("INSERT INTO ops.schema_migrations(version, checksum) VALUES ('999_gh137a_test.sql', '\\x00')");
  try {
    // Recorded, not tracked yet (store.migrate tracks after its run): no version, the former tag, a 200 once.
    const window = await held(path, before.etag);
    assert.deepEqual([window.status, window.fast], [200, false]);
    assert.match(window.etag, /^W\/"profile-v1-[a-f0-9]{64}"$/);
    assert.deepEqual(await held(path, window.etag), { status: 304, fast: false, etag: window.etag }, "its own tag: built, a 304");
    await owner.query("SELECT ops.track_data_changes()");
    const r = await held(path, window.etag);
    assert.deepEqual([r.status, r.fast], [200, false], "tracked: another tag, a 200 once");
    assert.notEqual(r.etag, before.etag);
    assert.deepEqual(await held(path, r.etag), { status: 304, fast: true, etag: r.etag });
  } finally {
    await owner.query("DELETE FROM ops.schema_migrations WHERE version = '999_gh137a_test.sql'");
    await owner.query("SELECT ops.track_data_changes()");
  }
});

test("GH137A-i: another release, another check; a tag of another release is answered by its content", { skip }, () => {
  const script = `
    const { createReader } = await import(${JSON.stringify(new URL("../src/db.mjs", import.meta.url).href)});
    const { createHandler } = await import(${JSON.stringify(new URL("../src/handler.mjs", import.meta.url).href)});
    const reader = createReader(process.env.VEGA_V2_API_NODE_TEST_DSN, { role: "vega_read" });
    const handle = createHandler({ read: reader.read, mediaBase: "https://media.test/" });
    const r = await handle(new Request("https://api.test/api/competitions", { headers: process.env.HELD ? { "if-none-match": process.env.HELD } : {} }));
    console.log(JSON.stringify({ status: r.status, etag: r.headers.get("etag"), timing: r.headers.get("server-timing") }));
    await reader.end();`;
  const run = (release, held = "") => {
    const env = { ...process.env, VEGA_RELEASE: release, HELD: held };
    if (release === null) delete env.VEGA_RELEASE;
    const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8", cwd: fileURLToPath(new URL("..", import.meta.url)), env,
    });
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout.trim().split("\n").at(-1));
  };
  const a = run("releases/v2-api/" + "a".repeat(64) + ".zip"), a2 = run("releases/v2-api/" + "a".repeat(64) + ".zip");
  const b = run("releases/v2-api/" + "b".repeat(64) + ".zip");
  assert.equal(a.etag, a2.etag, "the same release, the same tag");
  assert.notEqual(a.etag, b.etag, "another release, another check");
  assert.equal(V2.exec(a.etag)[3], V2.exec(b.etag)[3], "the same content");
  const crossed = run("releases/v2-api/" + "b".repeat(64) + ".zip", a.etag);
  assert.deepEqual([crossed.status, crossed.etag], [200, b.etag], "another release's tag: a 200 with the current tag, once");
  assert.match(crossed.timing, /desc="([2-9]|\d{2,}) quer/, "built: never a 304 by a check across releases");
  // GH137A-t: a fresh process of the same release answers the tag of another in one statement.
  const same = run("releases/v2-api/" + "a".repeat(64) + ".zip", a.etag);
  assert.deepEqual([same.status, same.etag], [304, a.etag]);
  assert.match(same.timing, /desc="1 query"/, "one statement: the version");
  // No release named (a local run, the end-to-end suites that start one process per request): the code itself is the
  // release, so every process of this tree agrees, and none of them takes a named release's tag for its own.
  const local = run(null), local2 = run(null, local.etag);
  assert.deepEqual([local2.status, local2.etag], [304, local.etag], "two processes of one tree, no release named: one tag");
  assert.match(local2.timing, /desc="1 query"/);
  assert.notEqual(local.etag, a.etag);
});

test("GH137A-j: the base's day is part of a version for a read of current_date, not for the others", { skip }, async () => {
  const version = async (zone, relations) => {
    await owner.query("BEGIN");
    try {
      await owner.query(`SET LOCAL TimeZone = '${zone}'`);
      return (await owner.query("SELECT api.data_version($1::text[]) AS v", [relations])).rows[0].v;
    } finally {
      await owner.query("ROLLBACK");
    }
  };
  // Twelve hours behind and fourteen ahead of UTC: always two different days.
  const day = ["api.player_profiles"], timeless = ["api.ranking_editions", "api.club_links"];
  assert.notEqual(await version("Etc/GMT+12", day), await version("Etc/GMT-14", day));
  assert.equal(await version("Etc/GMT+12", timeless), await version("Etc/GMT-14", timeless));
  assert.equal(await version("UTC", ["api.ranking_editions", "api.nothing_of_the_kind"]), null, "an unknown relation: no version");
});

test("GH137A-k: an undeclared read is an error in strict mode, the former tag otherwise", { skip }, async () => {
  const spec = { family: "catalog", reads: ["api.ranking_editions"], ttl: 60 };
  const build = async (read) => (await read("SELECT count(*)::int AS n FROM api.club_links"))[0];
  const req = () => new Request("https://api.test/api/rankings/index");
  const strict = createDataVersions(context.reader.read, { strict: true, warn: () => {} });
  await assert.rejects(strict(req(), new URLSearchParams(), spec, build), /undeclared.*api\.club_links/);
  const lines = [];
  const lax = createDataVersions(context.reader.read, { warn: (line) => lines.push(line) });
  const response = await lax(req(), new URLSearchParams(), spec, build);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("etag"), /^W\/"catalog-v1-[a-f0-9]{64}"$/);
  assert.match(lines.join("\n"), /undeclared read.*api\.club_links/);
});

test("GH137A-l: a base without the versions keeps the former tags and outcomes", { skip }, async () => {
  const missing = async (sql, ...rest) => {
    if (/api\.data_version\(/.test(sql)) throw Object.assign(new Error("function api.data_version(text[]) does not exist"), { code: "42883" });
    return context.reader.read(sql, ...rest);
  };
  const path = "/api/rankings/index";
  const first = await fresh(missing).ask(path);
  assert.equal(first.status, 200);
  assert.match(first.etag, /^W\/"catalog-v1-[a-f0-9]{64}"$/);
  assert.equal(first.etag, `W/"catalog-v1-${sha(first.text)}"`, "the base commit's tag");
  assert.equal((await fresh(missing).ask(path, { "if-none-match": first.etag })).status, 304);
  assert.equal((await fresh(missing).ask(path, { "if-none-match": "*" })).status, 304);
  const head = await fresh(missing).ask(path, {}, "HEAD");
  assert.deepEqual([head.status, head.etag], [200, first.etag]);
});

test("GH137A-n: every base table PostgreSQL reads for a route is in its declared closure, which has the triggers", { skip }, async () => {
  const sources = new Map();
  for (const r of (await owner.query("SELECT relation, source FROM ops.data_sources")).rows) {
    if (!sources.has(r.relation)) sources.set(r.relation, new Set());
    if (r.source) sources.get(r.relation).add(r.source);
  }
  const triggers = new Set((await owner.query(
    `SELECT n.nspname||'.'||c.relname AS t FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE g.tgname IN ('vega_change_insert','vega_change_update','vega_change_delete','vega_change_truncate') AND NOT g.tgisinternal AND NOT c.relispartition
     GROUP BY 1 HAVING count(DISTINCT g.tgname) = 4`)).rows.map((r) => r.t));
  for (const set of sources.values()) for (const table of set) assert.ok(triggers.has(table), `${table}: the four triggers`);
  for (const path of [...ANSWERS, ...ERRORS.map(([p]) => p)]) {
    const client = new pg.Client({ connectionString: DSN });
    await client.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL ROLE vega_read");
      await client.query("SET LOCAL search_path = api");
      const read = async (sql, values = []) => (await client.query(sql, values)).rows;
      const { ask, served } = fresh(read);
      await ask(path);
      await client.query("RESET ROLE");
      const seen = (await client.query(
        `SELECT DISTINCT n.nspname||'.'||c.relname AS t FROM pg_stat_xact_user_tables s
         JOIN pg_class c ON c.oid = coalesce(pg_partition_root(s.relid), s.relid) JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE s.seq_scan + coalesce(s.idx_scan, 0) > 0`)).rows.map((r) => r.t);
      if (!served.length) continue; // a 400 before any read
      const declared = new Set(served.flatMap((s) => s.reads).flatMap((relation) => [...(sources.get(relation) || [])]));
      const outside = seen.filter((t) => !declared.has(t) && !t.startsWith("ops.data_") && t !== "ops.schema_migrations");
      assert.deepEqual(outside, [], `${path}: read outside its declared closure`);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end();
    }
  }
});

test("GH137A-p: a match's display, 304 with its answer's freshness", { skip }, async () => {
  const path = "/api/matches/m_aaaaa1/players/display";
  const finished = await fresh().ask(path);
  assert.match(finished.cache, /s-maxage=60\b/);
  const fast = await fresh().ask(path, { "if-none-match": finished.etag });
  assert.deepEqual([fast.status, fast.cache], [304, finished.cache]);
  assert.ok(versionOnly(fast));
  await owner.query("UPDATE core.matches SET status = 'in_play' WHERE id = 1");
  try {
    const live = await fresh().ask(path);
    assert.match(live.cache, /s-maxage=15\b/);
    const again = await fresh().ask(path, { "if-none-match": live.etag });
    assert.deepEqual([again.status, again.cache], [304, live.cache]);
    assert.ok(versionOnly(again));
    // The finished answer's tag: its check bound 60 s, so it is built again; a 304 by content then says 15 s.
    const crossed = await fresh().ask(path, { "if-none-match": finished.etag });
    assert.ok(!versionOnly(crossed), "built");
    assert.deepEqual([crossed.status, crossed.etag, crossed.cache], [200, live.etag, live.cache]);
  } finally {
    await owner.query("UPDATE core.matches SET status = 'finished' WHERE id = 1");
  }
});

test("GH137A-s: a leaf truncated directly changes the version (the review's nine rows)", { skip }, async () => {
  await owner.query("BEGIN");
  try {
    const before = (await owner.query("SELECT count(*)::int AS n, api.data_version(ARRAY['api.player_form_minutes']) AS v FROM api.player_form_minutes")).rows[0];
    assert.ok(before.n > 0, "the seed's rows");
    await owner.query("TRUNCATE core.player_match_stats_s2025");
    const after = (await owner.query("SELECT count(*)::int AS n, api.data_version(ARRAY['api.player_form_minutes']) AS v FROM api.player_form_minutes")).rows[0];
    assert.equal(after.n, 0);
    assert.notEqual(after.v, before.v, "the version names the leaf's new file");
  } finally {
    await owner.query("ROLLBACK");
  }
});

test("GH137A-t: no fast 304 for a tag of a related route, of other parameters, or with a right check and another content", { skip }, async () => {
  const players = await fresh().ask("/api/rankings/power?kind=players&season=2025/2026");
  const clubs = await fresh().ask("/api/rankings/power?kind=clubs&season=2025/2026", { "if-none-match": players.etag });
  assert.equal(clubs.status, 200, "other parameters");
  assert.ok(!versionOnly(clubs));
  const index = await fresh().ask("/api/rankings/index");
  const cups = await fresh().ask("/api/cups/index", { "if-none-match": index.etag });
  assert.equal(cups.status, 200, "another route of the family");
  assert.ok(!versionOnly(cups));
  const [, , check] = V2.exec(index.etag);
  const forged = await fresh().ask("/api/rankings/index", { "if-none-match": `W/"catalog-v2-${check}-${"f".repeat(64)}"` });
  assert.equal(forged.status, 200, "the right check, another content");
  assert.ok(!versionOnly(forged));
});

test("GH137A-u: an answer over its size limit is a 413 without tag, for GET and HEAD, whatever is held", { skip }, async () => {
  const spec = { family: "catalog", reads: ["api.ranking_editions"], ttl: 60, maxBytes: 16 };
  const build = async (read) => ({ editions: await read("SELECT edition, kind FROM api.ranking_editions ORDER BY 1, 2") });
  const serve = createDataVersions(context.reader.read, { strict: true });
  const content = sha(JSON.stringify(await build(context.reader.read)));
  for (const method of ["GET", "HEAD"])
    for (const held of [null, "*", `W/"catalog-v1-${content}"`]) {
      const req = new Request("https://api.test/api/rankings/index", { method, headers: held ? { "if-none-match": held } : {} });
      const response = await serve(req, new URLSearchParams(), spec, build);
      assert.equal(response.status, 413, `${method} ${held}`);
      assert.equal(response.headers.get("etag"), null, `${method} ${held}: no tag`);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
});

test("GH137A-w: a day passing without any write: another check for a route reading current_date, the same for one that does not", { skip }, async () => {
  /** The route asked through one read-only transaction in `zone`, as vega_read. */
  const inZone = async (zone, path, headers = {}) => {
    const client = new pg.Client({ connectionString: DSN });
    await client.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL ROLE vega_read");
      await client.query("SET LOCAL search_path = api");
      await client.query(`SET LOCAL TimeZone = '${zone}'`);
      return await fresh(async (sql, values = []) => (await client.query(sql, values)).rows).ask(path, headers);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      await client.end();
    }
  };
  // Twelve hours behind and fourteen ahead of UTC: two different days, the same data.
  const dated = "/api/players/p_aaaab1", timeless = "/api/rankings/index";
  const west = await inZone("Etc/GMT+12", dated), east = await inZone("Etc/GMT-14", dated);
  assert.deepEqual([west.status, east.status], [200, 200]);
  assert.notEqual(V2.exec(west.etag)[2], V2.exec(east.etag)[2], "another day, another check");
  const crossed = await inZone("Etc/GMT-14", dated, { "if-none-match": west.etag });
  assert.ok(!versionOnly(crossed), "yesterday's tag is built again");
  assert.deepEqual([crossed.status, crossed.etag], [200, east.etag], "a 200 with today's tag");
  const plainWest = await inZone("Etc/GMT+12", timeless), plainEast = await inZone("Etc/GMT-14", timeless);
  assert.equal(plainWest.etag, plainEast.etag, "a route that reads no date");
  assert.ok(versionOnly(await inZone("Etc/GMT-14", timeless, { "if-none-match": plainWest.etag })));
});

test("GH137A-y: a request its parameters already refuse is refused before any statement, the base reachable or not", { skip }, async () => {
  const REFUSED = [
    ["/api/rankings/power?kind=players&season=bad", 400], ["/api/rankings/power?season=2025/2026&x=1", 400], ["/api/rankings/index?x=1", 400],
    ["/api/rankings/edition?kind=bad&edition=2026", 400], ["/api/rankings/level/player?season=2025/2026&player=bad", 400],
    ["/api/forecasts/live?match=1", 400], ["/api/forecasts/swap?season=2025/2026&out=p_aaaab1&in=p_aaaab1", 400],
    ["/api/players/p_aaaab1?x=1", 400], ["/api/players/p_aaaab1/similar?season=bad", 400], ["/api/players/p_aaaab1/similar?season=2025/2026&limit=999", 400],
    ["/api/teams/t_aaaaa1/similar?season=2025/2026&league=bad", 400], ["/api/teams/t_aaaaa1/absences?x=1", 400], ["/api/competitions?x=1", 400],
    ["/api/cups/edition?competition=l_3FJFUl", 400], ["/api/cup-snapshot?kind=bad&competition=l_3FJFUl&season=2025", 400], ["/api/cup-index?kind=worker", 404],
    ["/api/standings?season=2025/2026", 400], ["/api/club-facts?club=bad", 400], ["/api/coach-portrait", 400], ["/api/player-honours?id=bad", 400],
    ["/api/nations?season=bad", 400], ["/api/nations/t_aaaaa1?season=bad", 400], ["/api/worldcup/matches?edition=bad", 400],
    ["/api/worldcup/matches/bad-key", 400], ["/api/archives/details?match=a%20b", 400], ["/api/archives/index?kind=other", 400],
    ["/api/player-form?season=bad", 400], ["/api/matches/m_aaaaa1/players/display?x=1", 400], ["/api/matchdays?competition=l_3FJFUl", 400],
    ["/api/league-history?competition=l_3FJFUl&season=2015/2016&x=1", 400],
    // Checked after the edition's statement before the versions (one statement then); their form alone refuses them.
    ["/api/rankings/round?competition=l_3FJFUl&season=2025/2026&round=x1", 400], ["/api/rankings/round?competition=l_3FJFUl&season=2025/2026&race=10", 400],
    ["/api/rankings/round?competition=l_3FJFUl&season=2025/2026&race=", 400],
  ];
  const down = async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); };
  for (const [path, status] of REFUSED)
    for (const read of [context.reader.read, down]) {
      const r = await fresh(read).ask(path);
      assert.deepEqual([r.status, r.cache, r.statements.length], [status, "no-store", 0], `${path}${read === down ? " (base down)" : ""}`);
    }
});

test("GH137A-s: a leaf detached, updated without a new file and attached again: the tag held before is a 200 with the new bytes", { skip }, async () => {
  const path = "/api/rankings/match?match=m_aaaaa1";
  const before = await fresh().ask(path);
  assert.equal(before.status, 200);
  const goals = (text) => JSON.parse(text).grades.map((g) => g.goals);
  const { rows: kept } = await owner.query("SELECT player_id, goals FROM core.player_match_stats WHERE season_id = 2025 AND match_id = 1");
  await owner.query("ALTER TABLE core.player_match_stats DETACH PARTITION core.player_match_stats_s2025");
  try {
    // Detached, the leaf has no trigger: this update leaves no mark, and its file stays the same.
    await owner.query("UPDATE core.player_match_stats_s2025 SET goals = coalesce(goals, 0) + 5 WHERE match_id = 1");
  } finally {
    await owner.query("ALTER TABLE core.player_match_stats ATTACH PARTITION core.player_match_stats_s2025 FOR VALUES IN (2025)");
  }
  try {
    const after = await fresh().ask(path, { "if-none-match": before.etag });
    assert.equal(after.status, 200, "the tag held before is not current");
    assert.notDeepEqual(goals(after.text), goals(before.text), "the corrected bytes");
    assert.deepEqual(await held(path, after.etag), { status: 304, fast: true, etag: after.etag });
  } finally {
    for (const row of kept)
      await owner.query("UPDATE core.player_match_stats SET goals = $2 WHERE season_id = 2025 AND match_id = 1 AND player_id = $1", [row.player_id, row.goals]);
  }
});

// GH137A-y, the probe (third review, finding 12), without a base: a reader that answers the version and counts the rest.
function probe({ version = "v-one", fail = null } = {}) {
  const statements = [];
  const read = async (sql) => {
    statements.push(sql);
    if (sql === VERSION_SQL) {
      if (fail) throw fail;
      return [{ version }];
    }
    return [{ n: statements.length }];
  };
  const serve = createDataVersions(read, { strict: true });
  const spec = { family: "catalog", reads: ["api.probe_a", "api.probe_b"], ttl: 60 };
  const ask = async (build, held) => {
    statements.length = 0;
    const req = new Request("https://api.test/api/probe", { headers: held ? { "if-none-match": held } : {} });
    const r = await serve(req, new URLSearchParams(), spec, build).catch((error) => ({ error }));
    return r.error ? { error: r.error, statements: [...statements] } : { status: r.status, etag: r.headers.get("etag"), statements: [...statements] };
  };
  return { ask };
}

test("GH137A-y, probe: the version is read with the build's first statement, once; a verified tag runs no statement of the answer", async () => {
  const { ask } = probe();
  let checks = 0;
  const parallel = async (read) => {
    checks += 1; // the build's own checks: once per request
    const [a, b] = await Promise.all([read("SELECT 1 FROM api.probe_a"), read("SELECT 2 FROM api.probe_b")]);
    return { a: a.length, b: b.length };
  };
  const first = await ask(parallel);
  assert.equal(first.status, 200);
  assert.deepEqual(first.statements, [VERSION_SQL, "SELECT 1 FROM api.probe_a", "SELECT 2 FROM api.probe_b"], "one version for both statements");
  assert.equal(checks, 1, "the checks ran once");
  const again = await ask(parallel, first.etag);
  assert.deepEqual([again.status, again.etag, again.statements], [304, first.etag, [VERSION_SQL]], "Promise.all: no statement of the answer");
  assert.equal(checks, 2);
  // A build that catches its statements' rejections: a verified tag is still a 304 with no statement of the answer, and
  // a tag of another version a 200 built by its genuine statements.
  const forgiving = async (read) => ({ rows: await read("SELECT 1 FROM api.probe_a").catch(() => []), more: await read("SELECT 2 FROM api.probe_b").catch(() => []) });
  const built = await ask(forgiving);
  const hit = await ask(forgiving, built.etag);
  assert.deepEqual([hit.status, hit.statements], [304, [VERSION_SQL]], "a caught rejection: still no statement of the answer");
  const miss = await ask(forgiving, built.etag.replace(/-v2-[a-f0-9]{16}-/, "-v2-0000000000000000-"));
  assert.deepEqual([miss.status, miss.statements.length], [200, 3], "another check: the genuine statements");
});

test("GH137A-y, probe: refused parameters run nothing; a failed version is never a 200, whatever the build catches", async () => {
  const { ask } = probe();
  const refused = await ask(async () => {
    throw Object.assign(new Error("Paramètre invalide."), { status: 400 });
  });
  assert.deepEqual([refused.error?.status, refused.statements], [400, []]);
  const down = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  const failing = probe({ fail: down });
  const swallowed = await failing.ask(async (read) => ({ rows: await read("SELECT 1 FROM api.probe_a").catch(() => []) }));
  assert.equal(swallowed.error, down, "the version's error, not a 200 built from a swallowed failure");
  assert.deepEqual(swallowed.statements, [VERSION_SQL]);
  const missing = probe({ fail: Object.assign(new Error("no function"), { code: "42883" }) });
  const older = await missing.ask(async (read) => ({ rows: await read("SELECT 1 FROM api.probe_a") }));
  assert.equal(older.status, 200);
  assert.match(older.etag, /^W\/"catalog-v1-[a-f0-9]{64}"$/, "a base before 181: the former tag, its genuine statements");
});

// GH137A-o (third review, finding 13): the routes whose written contracts keep a client's tag through a writer's pass
// that leaves their bytes (test_sportscore_standings.py 35t, test_snapshot_roles.py 35m–35o, test_dfb_periods.py,
// test_transfermarkt_history.py 35w–35z) keep the base commit's content tag, and a 304 for it, reached by their own
// reads (GH137R.3: the receipts read before the answer are retired).
test("GH137A-o: standings, cup editions and transfers keep their content tags", { skip }, async () => {
  const handle = fresh();
  for (const [path, form] of [["/api/standings?competition=l_3FJFUl", /^W\/"support-v1-[a-f0-9]{64}"$/],
    ["/api/cups/edition?competition=l_3FJFUl&season=2025/2026", /^W\/"support-v1-[a-f0-9]{64}"$/],
    ["/api/players/p_aaaab1/transfers", /^W\/"profile-v1-[a-f0-9]{64}"$/]]) {
    const first = await handle.ask(path);
    if (first.status !== 200) {
      assert.equal(first.status, 404, path); // not in the seed: nothing to keep
      continue;
    }
    assert.match(first.etag, form, path);
    const again = await fresh().ask(path, { "if-none-match": first.etag });
    assert.deepEqual([again.status, again.etag], [304, first.etag], path);
  }
});
