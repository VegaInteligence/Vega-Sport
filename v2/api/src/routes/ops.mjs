/**
 * GET /api/ops/status: what the worker did in the last 24 hours, does now and has queued
 * for the next 24 hours, for the private status page (Vega Status, its own Vercel site).
 *
 * Behind its own key: the X-Vega-Ops-Key header must equal V2_OPS_KEY. Without a
 * configured key the route does not exist (404). Read from the api.ops_* views
 * (043_ops_status.sql, 050_ops_status_reads.sql) as vega_read, never cached.
 *
 * The job table holds two weeks of finished jobs and the whole backfill queue: every job
 * query here is bounded by an index of ops.fetch_jobs, except the queue's counts, which
 * read the table once.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { reject, send, validateParams } from "../http.mjs";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
// Every job and model run of the window is counted per 10 minutes (the dial, the totals);
// individual rows are a sample for the lists: per lane the latest finished and the next
// queued, every failure up to a bound, every running one.
const LIMITS = { done: 150, failed: 500, pending: 150, matches: 300, calcs: 300, warnings: 200, progress: 400, fields: 100 };
const SAMPLED = ["score", "details", "reference"];
const BUCKET = (column) => `to_timestamp(floor(extract(epoch FROM ${column}) / 600) * 600)`;
/** planner.PERMANENT_CODES: codes a retry cannot fix (a test keeps the two lists equal). */
export const PERMANENT = [
  "RESOURCE_NOT_FOUND", "INVALID_PARAMETER", "UNAUTHORIZED", "INVALID_ENDPOINT", "MATCH_ID_MISMATCH",
  "PROFILE_ID_MISMATCH", "MATCH_SEASON_CHANGED", "MATCH_COMPETITION_CHANGED", "CALENDAR_IDENTITY_MISMATCH",
];
// Lane and state are filtered on job_lane and job_state, the view's columns with the
// table's own types: a filter on the text ones never reaches the table's partial indexes.
const JOB = `id::text, lane, family, state, run_after, updated_at, attempts, priority, last_http, last_error_code, match_id, season_id, target
             FROM api.ops_jobs`;
/** One bounded branch per sampled lane, each read in the order of its index. */
const perLane = (where, order, limit) =>
  SAMPLED.map((lane) => `(SELECT ${JOB} WHERE job_lane = '${lane}' AND ${where} ORDER BY ${order} LIMIT ${limit})`);
const JOB_SAMPLE = [
  ...perLane("job_state = 'done' AND updated_at >= $1", "updated_at DESC", LIMITS.done),
  `(SELECT ${JOB} WHERE job_state = 'failed' AND updated_at >= $1 ORDER BY updated_at DESC LIMIT ${LIMITS.failed})`,
  `(SELECT ${JOB} WHERE job_state = 'leased')`,
  ...perLane("job_state = 'pending' AND run_after <= $2", "run_after", LIMITS.pending),
].join(" UNION ALL ");

const digest = (value) => createHash("sha256").update(value).digest();

/** Constant-time comparison of the given key with the configured one. */
export function keyMatches(given, expected) {
  return Boolean(given && expected) && timingSafeEqual(digest(given), digest(expected));
}

const ms = (value) => (value instanceof Date ? value.getTime() : value == null ? null : Date.parse(value));
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q,
    low = Math.floor(at);
  return Math.round(sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low));
}

/** Kickoff to first final score, and final score to last detail family, over the matches. */
export function freshness(rows) {
  const toScore = [],
    toDetails = [];
  for (const r of rows) {
    const kickoff = ms(r.kickoff_at),
      finished = ms(r.first_finished_at),
      family = ms(r.last_family_at);
    if (kickoff != null && finished != null) toScore.push(finished - kickoff);
    if (finished != null && family != null && family >= finished) toDetails.push(family - finished);
  }
  toScore.sort((a, b) => a - b);
  toDetails.sort((a, b) => a - b);
  return {
    matches: rows.length,
    kickoffToScoreMedianMs: quantile(toScore, 0.5),
    kickoffToScoreP95Ms: quantile(toScore, 0.95),
    scoreToDetailsMedianMs: quantile(toDetails, 0.5),
  };
}

export function createOpsRoute(read, { key = null, clock = Date.now } = {}) {
  return async (req, path, params) => {
    if (path !== "/api/ops/status") return null;
    if (!key) reject(404, "Ressource introuvable.");
    if (!keyMatches(req.headers.get("x-vega-ops-key"), key)) reject(401, "Clé d'accès requise.", "UNAUTHORIZED");
    validateParams(params, []);
    const now = new Date(clock()),
      since = new Date(now.getTime() - DAY),
      until = new Date(now.getTime() + DAY);

    const [
      jobs, jobBuckets, backfillEditions, backfillProgress, backlog, matches, sources, calcRuns, calcBuckets, calcLatest,
      requests, families, warnings, progress, parseFailures, unknownFields, [summary], finished, [publication],
    ] = await Promise.all([
      read(JOB_SAMPLE, [since, until]),
      // Finished and failed jobs by when they ended, queued ones by when they are due. The
      // ones already due are not read here: the queue's counts give them (see below).
      read(
        `SELECT lane, family, state, ${BUCKET("updated_at")} AS bucket, count(*)::integer AS jobs
         FROM api.ops_jobs WHERE job_state IN ('done', 'failed') AND updated_at >= $1 GROUP BY 1, 2, 3, 4
         UNION ALL
         SELECT lane, family, state, ${BUCKET("run_after")}, count(*)::integer
         FROM api.ops_jobs WHERE job_state = 'pending' AND run_after > $3 AND run_after <= $2 GROUP BY 1, 2, 3, 4`,
        [since, until, now],
      ),
      // Editions whose match families are not all collected yet, under their own season name.
      read(
        `SELECT season, season_id, count(*)::integer AS editions FROM (
           SELECT competition_season_id, max(season) AS season, max(season_id) AS season_id
           FROM api.ops_collection_progress WHERE family <> 'league_matches'
           GROUP BY competition_season_id HAVING sum(done + empty + failed) < sum(expected)) e
         GROUP BY 1, 2 ORDER BY 2 DESC, 1`,
      ),
      read(
        `SELECT coalesce(sum(expected), 0)::bigint::text AS expected, coalesce(sum(done + empty), 0)::bigint::text AS done,
                coalesce(sum(failed), 0)::bigint::text AS failed
         FROM api.ops_collection_progress WHERE family <> 'league_matches'`,
      ),
      // The queue: everything not finished, with what is due now and what a retry cannot fix.
      read(
        `SELECT lane, family, state, count(*)::integer AS jobs, min(run_after) AS oldest_run_after,
                count(*) FILTER (WHERE job_state = 'pending' AND run_after <= $1)::integer AS due,
                count(*) FILTER (WHERE job_state = 'failed' AND last_error_code = ANY($2::text[]))::integer AS permanent
         FROM api.ops_jobs WHERE job_state <> 'done' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
        [now, PERMANENT],
      ),
      // Beyond the bound, the matches kept are the ones still waiting for their final score,
      // then the nearest to now; they are given in kickoff order with the number there are.
      read(
        `SELECT * FROM (
           SELECT *, count(*) OVER ()::integer AS total FROM api.ops_match_watch
           WHERE kickoff_at BETWEEN $1::timestamptz - interval '12 hours' AND $2 OR watch_state = 'waiting_final'
           ORDER BY (watch_state = 'waiting_final') DESC, abs(extract(epoch FROM kickoff_at - $3::timestamptz)), match_id
           LIMIT ${LIMITS.matches}) m
         ORDER BY kickoff_at, match_id`,
        [since, until, now],
      ),
      read("SELECT * FROM api.ops_source_runs ORDER BY source, scope"),
      read(
        `(SELECT * FROM api.ops_calc_runs WHERE status = 'running' OR (status = 'failed' AND started_at >= $1) ORDER BY started_at DESC LIMIT ${LIMITS.failed})
         UNION ALL (SELECT * FROM api.ops_calc_runs WHERE status IN ('published', 'superseded') AND (started_at >= $1 OR finished_at >= $1)
                    ORDER BY started_at DESC LIMIT ${LIMITS.calcs})`,
        [since],
      ),
      read(
        `SELECT kind, ${BUCKET("started_at")} AS bucket, count(*)::integer AS runs FROM api.ops_calc_runs
         WHERE status IN ('published', 'superseded') AND (started_at >= $1 OR finished_at >= $1) GROUP BY 1, 2 ORDER BY 2, 1`,
        [since],
      ),
      read("SELECT DISTINCT ON (kind) * FROM api.ops_calc_runs ORDER BY kind, started_at DESC"),
      read(
        `SELECT date_trunc('hour', fetched_at) AS hour, count(*)::integer AS calls,
                count(*) FILTER (WHERE error_code IS NULL)::integer AS ok,
                count(*) FILTER (WHERE error_code = ANY($2::text[]))::integer AS permanent
         FROM api.ops_fetch_log WHERE fetched_at >= $1 GROUP BY 1 ORDER BY 1`,
        [since, PERMANENT],
      ),
      read(
        `SELECT family, count(*)::integer AS calls, count(*) FILTER (WHERE error_code IS NOT NULL)::integer AS errors,
                round(avg(duration_ms))::integer AS mean_ms,
                round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::integer AS p95_ms
         FROM api.ops_fetch_log WHERE fetched_at >= $1 GROUP BY family ORDER BY calls DESC, family`,
        [since],
      ),
      read(`SELECT * FROM api.ops_data_warnings ORDER BY detected_at DESC, match_id LIMIT ${LIMITS.warnings}`),
      // One row per edition: its match families added up (the season calendar is one call),
      // the latest worked on first, with the number of editions there are.
      read(
        `SELECT competition_season_id, max(competition) AS competition, max(season) AS season, max(season_id) AS season_id,
                sum(expected)::integer AS expected, sum(done)::integer AS done, sum(empty)::integer AS empty,
                sum(failed)::integer AS failed, max(last_success_at) AS last_success_at, count(*) OVER ()::integer AS total
         FROM api.ops_collection_progress WHERE family <> 'league_matches'
         GROUP BY competition_season_id ORDER BY max(updated_at) DESC, 2, 1 LIMIT ${LIMITS.progress}`,
      ),
      read(
        `SELECT family, error_code, count(*)::integer AS count FROM api.ops_parse_failures
         WHERE at >= $1 GROUP BY 1, 2 ORDER BY 3 DESC, 1, 2`,
        [since],
      ),
      read(`SELECT * FROM api.ops_unknown_fields ORDER BY last_seen_at DESC, family, field_path LIMIT ${LIMITS.fields}`),
      read("SELECT * FROM api.ops_summary"),
      read("SELECT kickoff_at, first_finished_at, last_family_at FROM api.ops_finished_matches WHERE first_finished_at >= $1", [since]),
      read("SELECT generation::text AS revision, published_at, (SELECT count(*) FROM api.editions)::integer AS editions FROM api.publication"),
    ]);

    const failedCalls = (r) => r.calls - r.ok;
    // Queued jobs already due are counted at now, one count per lane and family.
    const due = backlog.filter((b) => b.state === "pending" && b.due > 0).map((b) => ({ ...b, bucket: now, jobs: b.due }));
    const buckets = [...jobBuckets, ...due].sort(
      (a, b) => ms(a.bucket) - ms(b.bucket) || order(a.lane, b.lane) || order(a.family, b.family) || order(a.state, b.state),
    );
    return send(req, {
      generatedAt: now.toISOString(),
      window: { from: since.toISOString(), to: until.toISOString() },
      worker: { lastFetchAt: summary?.last_fetch_at ?? null, lastSourceAt: summary?.last_source_at ?? null, lastCalcAt: summary?.last_calc_at ?? null },
      publication: publication
        ? { revision: publication.revision, publishedAt: publication.published_at, editions: publication.editions }
        : null,
      jobs: jobs.map((j) => ({
        id: j.id, lane: j.lane, family: j.family, state: j.state, runAfter: j.run_after, updatedAt: j.updated_at,
        attempts: j.attempts, priority: j.priority, http: j.last_http, error: j.last_error_code,
        matchId: j.match_id, seasonId: j.season_id, target: j.target,
      })),
      jobBuckets: buckets.map((b) => ({ lane: b.lane, family: b.family, state: b.state, at: b.bucket, jobs: b.jobs })),
      backfill: {
        editions: backfillEditions.map((e) => ({ season: e.season, seasonId: e.season_id, editions: e.editions })),
        expected: Number(backfillProgress[0].expected),
        done: Number(backfillProgress[0].done),
        failed: Number(backfillProgress[0].failed),
      },
      backlog: backlog.map((b) => ({
        lane: b.lane, family: b.family, state: b.state, jobs: b.jobs, oldestRunAfter: b.oldest_run_after, due: b.due, permanent: b.permanent,
      })),
      matches: matches.map((m) => ({
        id: m.match_id, competition: m.competition, home: m.home, away: m.away, kickoffAt: m.kickoff_at, status: m.status,
        homeScore: m.home_score, awayScore: m.away_score, finishedAt: m.first_finished_at, watch: m.watch_state,
        checks: m.checks, nextCheckAt: m.next_check_at, familiesOk: m.families_ok,
      })),
      sources: sources.map((s) => ({
        source: s.source, scope: s.scope, lastAttemptAt: s.last_attempt_at, lastSuccessAt: s.last_success_at,
        status: s.status, errorCode: s.error_code, rowsWritten: s.rows_written, unmatched: s.unmatched,
      })),
      calcs: {
        runs: calcRuns.map(calc),
        buckets: calcBuckets.map((b) => ({ kind: b.kind, at: b.bucket, runs: b.runs })),
        latest: calcLatest.map(calc),
      },
      requests: requests.map((r) => ({
        hour: r.hour, calls: r.calls, ok: r.ok, permanent: r.permanent, transient: failedCalls(r) - r.permanent,
      })),
      families: families.map((f) => ({ family: f.family, calls: f.calls, errors: f.errors, meanMs: f.mean_ms, p95Ms: f.p95_ms })),
      warnings: warnings.map((w) => ({ matchId: w.match_id, match: w.match_label, kind: w.kind, detail: w.detail, detectedAt: w.detected_at })),
      progress: progress.map((p) => ({
        editionId: p.competition_season_id, competition: p.competition, season: p.season, seasonId: p.season_id,
        expected: p.expected, done: p.done, empty: p.empty, failed: p.failed, lastSuccessAt: p.last_success_at,
      })),
      // How many there are of what the lists above bound.
      totals: {
        matches: matches[0]?.total ?? 0,
        warnings: summary?.data_warnings ?? warnings.length,
        editions: progress[0]?.total ?? 0,
      },
      quality: {
        coverageGaps: summary?.coverage_gaps ?? 0,
        dirtyScopes: summary?.dirty_scopes ?? 0,
        oldestDirtyAt: summary?.oldest_dirty_at ?? null,
        parseFailures: parseFailures.map((p) => ({ family: p.family, code: p.error_code, count: p.count })),
        unknownFields: unknownFields.map((u) => ({
          family: u.family, path: u.field_path, occurrences: u.occurrences, firstSeenAt: u.first_seen_at, lastSeenAt: u.last_seen_at,
        })),
      },
      freshness: freshness(finished),
    });
  };
}

function calc(r) {
  return {
    id: `${r.origin}:${r.id}`, kind: r.kind, version: r.version, scope: r.scope,
    startedAt: r.started_at, finishedAt: r.finished_at, status: r.status,
  };
}
