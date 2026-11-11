// Contract tests of /api/ops/status, the private status page's read (043_ops_status.sql,
// 050_ops_status_reads.sql, 051_ops_followed_matches.sql): its key, its 24-hour window and
// every block, read as vega_read.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";
import { context, skip } from "./context.mjs";
import { createHandler } from "../src/handler.mjs";
import { PERMANENT, freshness, keyMatches } from "../src/routes/ops.mjs";

const KEY = "k".repeat(64);
const NOW = Date.parse("2025-09-06T12:00:00Z");
const at = (minutes) => new Date(NOW + minutes * 60_000);
const iso = (minutes) => at(minutes).toISOString();
let handle, owner;

async function status(headers = { "x-vega-ops-key": KEY }, query = "", h = handle) {
  const response = await h(new Request("https://api.test/api/ops/status" + query, { headers }));
  return { response, body: await response.json() };
}

before(async () => {
  if (skip) return;
  handle = createHandler({ read: context.reader.read, clock: () => NOW, opsKey: KEY });
  owner = new pg.Client({ connectionString: process.env.VEGA_V2_API_NODE_TEST_DSN });
  await owner.connect();
  const x = (sql, values) => owner.query(sql, values);
  const job = (lane, family, target, state, minutes, extra = {}) =>
    x(
      `INSERT INTO ops.fetch_jobs(lane, family, entity_type, entity_id, target_date, competition_season_id, run_after, updated_at, state,
                                  attempts, last_http, last_error_code, lease_until, lease_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13)`,
      [lane, family, target.type ?? null, target.id ?? null, target.date ?? null, target.edition ?? null, at(minutes), state,
       extra.attempts ?? 0, extra.http ?? null, extra.error ?? null, state === "leased" ? at(minutes + 5) : null,
       state === "leased" ? "00000000-0000-4000-8000-000000000001" : null],
    );
  const match = (id) => ({ type: "match", id });
  await job("score", "summary", match(5), "done", -600);
  await job("details", "shots", match(5), "done", -1800); // older than 24 h
  await job("reference", "calendar", { date: "2025-09-06" }, "done", -360);
  await job("details", "heatmaps", match(5), "failed", -540, { attempts: 1, http: 404, error: "RESOURCE_NOT_FOUND" });
  await job("score", "lineups", match(6), "leased", -1);
  await job("score", "summary", match(6), "pending", 525);
  await job("reference", "player", { type: "player", id: 101 }, "pending", -5);
  await job("reference", "team", { type: "team", id: 1 }, "pending", 1800); // after the next 24 h
  await job("backfill", "league_matches", { edition: 1 }, "done", -119);
  await job("backfill", "events", match(1), "done", -119);
  await job("backfill", "events", match(2), "done", -115);
  await job("backfill", "network", match(3), "failed", -113, { attempts: 5, error: "HTTP_SERVER_ERROR" });
  await job("backfill", "shots", match(4), "pending", -60);

  await x("UPDATE core.matches SET first_finished_at = $1 WHERE id = 5", [iso(-905)]); // kickoff + 1 h 55
  await x("UPDATE core.matches SET first_finished_at = $1 WHERE id = 4", [iso(-2350)]); // before the window
  // Two matches the worker did not follow. Match 1 was first seen two hours ago, already
  // played: its watch opens after its kickoff. Match 2 came from the backfill: no watch.
  await x("UPDATE core.matches SET first_finished_at = $1 WHERE id = 1", [iso(-120)]);
  await x("UPDATE core.matches SET first_finished_at = $1 WHERE id = 2", [iso(-180)]);
  await x("UPDATE ops.family_state SET last_success_at = $1 WHERE match_id = 5 AND family = 'summary'", [iso(-900)]);
  await x(
    `INSERT INTO ops.family_state(match_id, family, status, last_success_at) VALUES
       (5, 'shots', 'ok', $1), (5, 'events', 'ok', $1), (5, 'heatmaps', 'error', NULL), (5, 'network', 'unavailable', NULL)`,
    [iso(-870)],
  );
  await x(
    `INSERT INTO ops.match_watch(match_id, state, checks, next_check_at, kickoff_at, created_at) VALUES
       (1, 'corrected', 9, NULL, '2025-09-01T19:00:00Z', $4), (4, 'waiting_final', 30, $1, '2025-09-04T19:00:00Z', $5),
       (5, 'final', 4, $2, '2025-09-05T19:00:00Z', $5), (6, 'scheduled', 0, $3, '2025-09-06T19:00:00Z', $5)`,
    [iso(60), iso(720), iso(525), iso(-120), "2025-08-30T08:00:00Z"], // $5: seen in a calendar before kickoff
  );
  await x(
    `INSERT INTO ops.source_runs(source, scope, last_attempt_at, last_success_at, status, error_code, rows_written, unmatched) VALUES
       ('wikidata', 'clubs', $1, $1, 'ok', NULL, 12, 1), ('sportscore', 'standings:l_x', $2, $3, 'error', 'HTTP_TIMEOUT', 0, 0)`,
    [iso(-30), iso(-20), iso(-420)],
  );
  await x(
    `INSERT INTO agg.calc_runs(kind, model_version, cohort_definition, started_at, finished_at, status) VALUES
       ('percentiles', 'p1', 'league:1', $1, $2, 'published'), ('levels', 'l1', 'season:2025', $3, $4, 'published'),
       ('index', 'i1', 'league:1', $5, NULL, 'running')`,
    [iso(-180), at(-180 + 1 / 12), iso(-1800), at(-1799), iso(-1)],
  );
  await x("SELECT ops.ensure_fetch_log_partition($1)", [iso(0)]);
  await x(
    `INSERT INTO ops.fetch_log(family, http_status, error_code, duration_ms, fetched_at) VALUES
       ('summary', 200, NULL, 300, $1), ('summary', 200, NULL, 500, $1), ('heatmaps', 404, 'RESOURCE_NOT_FOUND', 100, $1),
       ('network', 503, 'HTTP_SERVER_ERROR', 900, $2), ('player_halves', 404, 'HALVES_UNAVAILABLE', 200, $2), ('summary', 200, NULL, 50, $3)`,
    [iso(-175), iso(-110), iso(-1800)],
  );
  await x("INSERT INTO ops.data_warnings(match_id, kind, detail, detected_at) VALUES (5, 'score_disagreement', '2-0 / 2-1', $1)", [iso(-60)]);
  await x(
    `INSERT INTO ops.collection_progress(source, competition_season_id, family, expected, done, empty, failed, last_success_at, updated_at) VALUES
       ('pitchapi', 1, 'shots', 6, 3, 1, 1, $1, $1), ('pitchapi', 1, 'league_matches', 1, 1, 0, 0, $2, $2)`,
    [iso(-60), iso(-120)],
  );
  await x(
    "INSERT INTO ops.parse_failures(family, error_code, message, at) VALUES ('calendar', 'INVALID_ENVELOPE', 'x', $1), ('calendar', 'INVALID_ENVELOPE', 'x', $1), ('team', 'OLD', 'x', $2)",
    [iso(-120), iso(-2400)],
  );
  await x("INSERT INTO ops.unknown_fields(family, field_path, first_seen_at, last_seen_at, occurrences) VALUES ('shots', 'data.foo', $1, $2, 3)", [iso(-7200), iso(-60)]);
});
after(() => owner?.end());

test("the key is compared in constant time and required", { skip }, async () => {
  assert.equal(keyMatches(KEY, KEY), true);
  assert.equal(keyMatches("other", KEY), false);
  assert.equal(keyMatches(null, KEY), false);
  assert.equal(keyMatches(KEY, null), false);
  for (const headers of [{}, { "x-vega-ops-key": "wrong" }]) {
    const { response, body } = await status(headers);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(body.error, { code: "UNAUTHORIZED", message: "Clé d'accès requise.", retry: false });
  }
  // Without a configured key the route does not exist.
  const closed = createHandler({ read: context.reader.read, clock: () => NOW });
  assert.equal((await status(undefined, "", closed)).response.status, 404);
  assert.equal((await status(undefined, "?x=1")).response.status, 400);
});

test("jobs of the last and next 24 hours: counts per 10 minutes, sample rows", { skip }, async () => {
  const { response, body } = await status();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body.generatedAt, iso(0));
  assert.deepEqual(body.window, { from: iso(-1440), to: iso(1440) });
  const jobs = body.jobs.map((j) => [j.lane, j.family, j.state, j.target, j.state === "pending" || j.state === "leased" ? j.runAfter : j.updatedAt]);
  assert.deepEqual(jobs.sort(), [
    ["backfill", "network", "failed", "Olympique Été – Stade Nord", iso(-113)],
    ["details", "heatmaps", "failed", "Union Sud – Olympique Été", iso(-540)],
    ["reference", "calendar", "done", "2025-09-06", iso(-360)],
    ["reference", "player", "pending", "Élie Durand", iso(-5)],
    ["score", "lineups", "leased", "Racing Club – Stade Nord", iso(-1)],
    ["score", "summary", "done", "Union Sud – Olympique Été", iso(-600)],
    ["score", "summary", "pending", "Racing Club – Stade Nord", iso(525)],
  ]);
  const failed = body.jobs.find((j) => j.family === "heatmaps");
  assert.deepEqual([failed.http, failed.error, failed.attempts, failed.matchId, failed.seasonId], [404, "RESOURCE_NOT_FOUND", 1, 5, 2025]);
  // Every job of the window, counted where it ended or is due; the due ones at now.
  assert.deepEqual(body.jobBuckets.map((b) => [b.at, b.lane, b.family, b.state, b.jobs]), [
    [iso(-600), "score", "summary", "done", 1],
    [iso(-540), "details", "heatmaps", "failed", 1],
    [iso(-360), "reference", "calendar", "done", 1],
    [iso(-120), "backfill", "events", "done", 2],
    [iso(-120), "backfill", "league_matches", "done", 1],
    [iso(-120), "backfill", "network", "failed", 1],
    [iso(0), "backfill", "shots", "pending", 1],
    [iso(0), "reference", "player", "pending", 1],
    [iso(520), "score", "summary", "pending", 1],
  ]);
  // Editions still to collect, under their own season name.
  assert.deepEqual(body.backfill, { editions: [{ season: "2025/2026", seasonId: 2025, editions: 1 }], expected: 6, done: 4, failed: 1 });
  // The queue: per lane, family and state, what waits, what is due now, what a retry cannot fix.
  const backlog = Object.fromEntries(body.backlog.map((b) => [`${b.lane}/${b.family}/${b.state}`, [b.jobs, b.due, b.permanent]]));
  assert.deepEqual(backlog["backfill/shots/pending"], [1, 1, 0]);
  assert.deepEqual(backlog["reference/team/pending"], [1, 0, 0]); // due after the window
  assert.deepEqual(backlog["score/lineups/leased"], [1, 0, 0]);
  assert.deepEqual(backlog["details/heatmaps/failed"], [1, 0, 1]); // 404: stays failed
  assert.deepEqual(backlog["backfill/network/failed"], [1, 0, 0]); // 5xx: tried again after a day
  assert.equal(body.backlog.find((b) => b.family === "team").oldestRunAfter, iso(1800));
  assert.ok(!body.backlog.some((b) => b.state === "done"));
});

test("the codes a retry cannot fix are the planner's", () => {
  const source = readFileSync(new URL("../../vega/planner.py", import.meta.url), "utf8");
  const tuple = /^PERMANENT_CODES = \(([^)]*)\)/m.exec(source);
  assert.ok(tuple, "planner.PERMANENT_CODES not found");
  assert.deepEqual([...PERMANENT].sort(), [...tuple[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort());
});

test("watched matches, sources, model runs", { skip }, async () => {
  const { body } = await status();
  assert.deepEqual(
    body.matches.map((m) => [m.id, m.watch, m.status, m.home, m.away, m.familiesOk, m.competition]),
    [
      [4, "waiting_final", "finished", "Racing Club", "Union Sud", 0, "Ligue 1"],
      // Settled families: two collected, one the provider does not have; the failed one is not.
      [5, "final", "finished", "Union Sud", "Olympique Été", 3, "Ligue 1"],
      [6, "scheduled", "not_started", "Racing Club", "Stade Nord", 0, "Ligue 1"],
    ],
  );
  assert.equal(body.totals.matches, 3);
  assert.equal(body.matches[2].nextCheckAt, iso(525));
  assert.deepEqual(body.sources, [
    { source: "sportscore", scope: "standings:l_x", lastAttemptAt: iso(-20), lastSuccessAt: iso(-420), status: "error", errorCode: "HTTP_TIMEOUT", rowsWritten: 0, unmatched: 0 },
    { source: "wikidata", scope: "clubs", lastAttemptAt: iso(-30), lastSuccessAt: iso(-30), status: "ok", errorCode: null, rowsWritten: 12, unmatched: 1 },
  ]);
  assert.deepEqual(body.calcs.buckets.find((b) => b.kind === "percentiles"), { kind: "percentiles", at: iso(-180), runs: 1 });
  assert.ok(!body.calcs.buckets.some((b) => b.kind === "levels" || b.kind === "index"));
  const runs = body.calcs.runs.map((r) => `${r.kind}:${r.status}`);
  assert.ok(runs.includes("percentiles:published") && runs.includes("index:running"));
  assert.ok(!runs.includes("levels:published")); // finished more than 24 h ago
  const latest = Object.fromEntries(body.calcs.latest.map((r) => [r.kind, r]));
  assert.equal(latest.levels.version, "l1");
  assert.equal(latest.levels.scope, "season:2025");
  assert.ok(latest.power_elo.id.startsWith("power:"));
});

test("provider calls, warnings, progress, quality, freshness, publication", { skip }, async () => {
  const { body } = await status();
  assert.deepEqual(body.requests, [
    { hour: "2025-09-06T09:00:00.000Z", calls: 3, ok: 2, permanent: 1, transient: 0, unavailable: 0 },
    // The source's "no such data for this match" stays among the transient ones and is counted apart.
    { hour: "2025-09-06T10:00:00.000Z", calls: 2, ok: 0, permanent: 0, transient: 2, unavailable: 1 },
  ]);
  assert.deepEqual(body.families, [
    { family: "summary", calls: 2, errors: 0, unavailable: 0, meanMs: 400, p95Ms: 490 },
    { family: "heatmaps", calls: 1, errors: 1, unavailable: 0, meanMs: 100, p95Ms: 100 },
    { family: "network", calls: 1, errors: 1, unavailable: 0, meanMs: 900, p95Ms: 900 },
    { family: "player_halves", calls: 1, errors: 1, unavailable: 1, meanMs: 200, p95Ms: 200 },
  ]);
  assert.deepEqual(body.warnings, [{ matchId: 5, match: "Union Sud – Olympique Été", kind: "score_disagreement", detail: "2-0 / 2-1", detectedAt: iso(-60) }]);
  // One row per edition, its match families added up; the season calendar is not one of them.
  assert.deepEqual(body.progress, [
    { editionId: 1, competition: "Ligue 1", season: "2025/2026", seasonId: 2025, expected: 6, done: 3, empty: 1, failed: 1, lastSuccessAt: iso(-60) },
  ]);
  assert.deepEqual(body.totals, { matches: 3, warnings: 1, editions: 1 });
  assert.deepEqual(body.quality.parseFailures, [{ family: "calendar", code: "INVALID_ENVELOPE", count: 2 }]);
  assert.deepEqual(body.quality.unknownFields, [{ family: "shots", path: "data.foo", occurrences: 3, firstSeenAt: iso(-7200), lastSeenAt: iso(-60) }]);
  assert.ok(body.quality.coverageGaps >= 1); // match 5 still lacks families
  assert.equal(typeof body.quality.dirtyScopes, "number");
  // Match 5 only, watched since before its kickoff: kickoff to score 1 h 55, score to its
  // last family 35 min. Matches 1 and 2 got their final score days after kickoff, when
  // they were first met: that is their age, not a score delay.
  assert.deepEqual(body.freshness, { matches: 1, kickoffToScoreMedianMs: 6_900_000, kickoffToScoreP95Ms: 6_900_000, scoreToDetailsMedianMs: 2_100_000 });
  assert.match(body.publication.revision, /^\d+$/);
  assert.ok(body.publication.editions >= 1);
  assert.equal(body.worker.lastSourceAt, iso(-20));
  assert.ok(Date.parse(body.worker.lastFetchAt) >= Date.parse(iso(-110)));
});

test("freshness quantiles", () => {
  assert.deepEqual(freshness([]), { matches: 0, kickoffToScoreMedianMs: null, kickoffToScoreP95Ms: null, scoreToDetailsMedianMs: null });
  const rows = [10, 20, 30, 40].map((m) => ({ kickoff_at: new Date(0), first_finished_at: new Date(m), last_family_at: new Date(m + 5) }));
  assert.deepEqual(freshness(rows), { matches: 4, kickoffToScoreMedianMs: 25, kickoffToScoreP95Ms: 39, scoreToDetailsMedianMs: 5 });
});
