// Season read-model routes (approved design: docs/architecture/orion-read-models-20261105/PLAN.md).
// Small indexed reads of the per-build aggregates written at publication. No
// season is rebuilt per request; each route resolves exactly one published build
// (or all current ones for cross-season views) and reads at most a few hundred rows.
import { createHash } from "node:crypto";
import { query } from "./postgres.js";
import { reject, send, validateParams } from "./relational-core.js";
import { cacheHeaders } from "./cache-policy.js";
import { proRepresentations } from "./orion-pro.js";

const CONTRACT = "orion_pro_season_aggregates_v1";
const PREFIX = "legacy_normalized_";
const METRICS = new Set([
  "aerialDuels", "aerialsWon", "assists", "bigChancesCreated", "blocks", "chancesCreated", "clearances",
  "defensiveActions", "dribbles", "dribblesAttempted", "duelsLost", "duelsWon", "goals", "goalsPrevented",
  "interceptions", "minutes", "npxg", "passesAccurate", "passesAttempted", "passesFinalThird", "rating",
  "recoveries", "saves", "shots", "shotsOnTarget", "tackles", "touches", "touchesBox", "xa", "xg", "xgot",
]);
const lid = /^l_[A-Za-z0-9]{6}$/;
const tid = /^t_[A-Za-z0-9]{6}$/;
const pid = /^p_[A-Za-z0-9]{6}$/;
const year = /^\d{4}(?:\/\d{4})?$/;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const at = (a, g) => `${a}.recorded_from_gen<=${g} AND (${a}.recorded_to_gen IS NULL OR ${g}<${a}.recorded_to_gen)`;
const aliasAt = (a, g) => `${at(a, g)} AND NOT ${a}.is_deleted`;
const num = (v) => (v === null || v === undefined ? null : Number(v));

// One published aggregate build for (league, season), optionally pinned by v.
async function edition(params) {
  const league = params.get("league"), season = params.get("season"), v = params.get("v");
  if (!lid.test(league || "") || !year.test(season || "")) reject(400, "Édition invalide.");
  const rows = await proRepresentations(v, { leagues: [league], seasons: [season] });
  const row = rows.find((r) => r.league_keys.includes(league) && r.season === season);
  if (!row) reject(404, "Édition non publiée.");
  if (row.metrics_contract_version !== CONTRACT) reject(503, "Agrégats de saison indisponibles pour cette version.");
  return { ...row, league_id: league };
}

function reply(req, body, versionKey, { maxBytes = 512 * 1024 } = {}) {
  const url = new URL(req.url);
  const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
  const pinned = url.searchParams.has("v");
  return send(req, body, 200, {
    etag: `W/"orion-season1-${digest(JSON.stringify([url.pathname, params, versionKey]))}"`,
    ttl: 15,
    maxBytes,
    headers: pinned ? cacheHeaders(31536000, 0, { immutable: true }) : {},
  });
}

const meta = (e) => ({ leagueId: e.league_id, league: e.league_name, season: e.season, representationToken: e.token,
  datasetGeneration: String(e.dataset_generation), source: "AWS", contract: CONTRACT });

// Public identities and current names, resolved once per request at the build's catalogue generation.
const identitySql = (g) => `
players AS (SELECT a.player_id, min(a.public_key COLLATE "C") public_id FROM ingest.public_aliases a
  WHERE a.route_kind='player' AND a.public_key ~ '^p_[A-Za-z0-9]{6}$' AND ${aliasAt("a", g)} GROUP BY a.player_id),
teams AS (SELECT a.team_id, min(a.public_key COLLATE "C") public_id FROM ingest.public_aliases a
  WHERE a.route_kind='team' AND a.public_key ~ '^t_[A-Za-z0-9]{6}$' AND ${aliasAt("a", g)} GROUP BY a.team_id),
profiles AS (SELECT DISTINCT ON (pp.player_id) pp.player_id, pp.display_name, pp.image_asset_id
  FROM football.player_profile_versions pp WHERE ${at("pp", g)} AND NOT pp.is_deleted AND pp.is_canonical
  ORDER BY pp.player_id, pp.observed_at DESC NULLS LAST, pp.id DESC)`;

async function table(req, params) {
  validateParams(params, ["league", "season", "v"]);
  const e = await edition(params);
  const rows = await query(`/*orion:season:table*/ WITH ${identitySql(e.catalog_generation)}
SELECT t.public_id AS id, tm.name, s.matches_played, s.wins, s.draws, s.losses, s.goals_for, s.goals_against,
 s.points_calculated AS points, s.xg_for::text, s.xg_against::text
FROM analytics.team_competition_stats s JOIN football.teams tm ON tm.id=s.team_id LEFT JOIN teams t ON t.team_id=s.team_id
WHERE s.build_id=$1::bigint
ORDER BY s.points_calculated DESC NULLS LAST, (s.goals_for-s.goals_against) DESC NULLS LAST, s.goals_for DESC NULLS LAST, tm.name COLLATE "C"`,
    [e.build_id]);
  if (rows.some((r) => !r.id)) reject(503, "Identité publique d’équipe indisponible.");
  return reply(req, { data: { meta: { ...meta(e), standings: "calculated_from_results" },
    teams: rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, played: r.matches_played, wins: r.wins, draws: r.draws,
      losses: r.losses, goalsFor: r.goals_for, goalsAgainst: r.goals_against, points: r.points,
      xgFor: num(r.xg_for), xgAgainst: num(r.xg_against) })) } }, e.token);
}

function metricParam(value, fallback) {
  const name = value ?? fallback;
  if (!METRICS.has(name)) reject(400, "Statistique inconnue.");
  return name;
}

// Leaderboard / directory page over one edition. per90 ranks by sum*90/minutes observed.
async function players(req, params) {
  validateParams(params, ["league", "season", "v", "metric", "order", "per90", "minMinutes", "team", "limit", "offset"]);
  const e = await edition(params);
  const metric = metricParam(params.get("metric"), "goals");
  const order = params.get("order") ?? "desc", per90 = params.get("per90") === "1";
  if (!["asc", "desc"].includes(order) || !["0", "1", null].includes(params.get("per90"))) reject(400, "Tri invalide.");
  const minMinutes = Number(params.get("minMinutes") ?? "0"), limit = Number(params.get("limit") ?? "50"), offset = Number(params.get("offset") ?? "0");
  if (!Number.isInteger(minMinutes) || minMinutes < 0 || minMinutes > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 100
    || !Number.isInteger(offset) || offset < 0 || offset > 5000) reject(400, "Pagination invalide.");
  const team = params.get("team");
  if (team !== null && !tid.test(team)) reject(400, "Équipe invalide.");
  const value = metric === "rating"
    ? "m.numeric_value/NULLIF(m.observed_count,0)"
    : per90 ? "m.numeric_value*90/NULLIF(m.eligible_minutes,0)" : "m.numeric_value";
  const rows = await query(`/*orion:season:players*/ WITH ${identitySql(e.catalog_generation)},
scope AS (SELECT s.player_id, s.appearances, s.starts, s.minutes_played, s.goals, s.assists, s.xg::text xg, s.xa::text xa,
  s.provider_rating_weighted::text rating_weighted FROM analytics.player_competition_stats s
  WHERE s.build_id=$1::bigint AND coalesce(s.minutes_played,0)>=$3::int
  AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM analytics.player_competition_team_stats pt JOIN teams t ON t.team_id=pt.team_id
    WHERE pt.build_id=$1::bigint AND pt.player_id=s.player_id AND t.public_id=$6::text)))
SELECT p.public_id AS id, pr.display_name AS name, sc.*, (${value})::text AS value, m.observed_count, m.eligible_count,
 m.eligible_minutes::text, m.coverage_state, count(*) OVER () AS total,
 (SELECT array_agg(t.public_id ORDER BY pt.minutes_played DESC NULLS LAST) FROM analytics.player_competition_team_stats pt
   JOIN teams t ON t.team_id=pt.team_id WHERE pt.build_id=$1::bigint AND pt.player_id=sc.player_id) AS team_ids
FROM scope sc JOIN players p ON p.player_id=sc.player_id LEFT JOIN profiles pr ON pr.player_id=sc.player_id
LEFT JOIN analytics.metric_totals m ON m.build_id=$1::bigint AND m.subject_kind='player' AND m.player_id=sc.player_id
 AND m.metric_code=$2::text
ORDER BY (${value}) ${order === "asc" ? "ASC" : "DESC"} NULLS LAST, p.public_id COLLATE "C"
LIMIT $4::int OFFSET $5::int`, [e.build_id, PREFIX + metric, minMinutes, limit, offset, team]);
  return reply(req, { data: { meta: { ...meta(e), metric, per90, order, minMinutes, total: Number(rows[0]?.total ?? 0), offset, limit },
    players: rows.map((r) => ({ id: r.id, name: r.name, teamIds: r.team_ids || [], appearances: r.appearances, starts: r.starts,
      minutes: r.minutes_played, goals: r.goals, assists: r.assists, xg: num(r.xg), xa: num(r.xa), ratingWeighted: num(r.rating_weighted),
      value: num(r.value), observed: num(r.observed_count), eligible: num(r.eligible_count), observedMinutes: num(r.eligible_minutes),
      coverage: r.coverage_state ?? "unavailable" })) } }, e.token);
}

// Compact metric vectors for centiles and similarity over eligible players.
async function cohort(req, params) {
  validateParams(params, ["league", "season", "v", "metrics", "minMinutes"]);
  const e = await edition(params);
  const metrics = (params.get("metrics") || "").split(",").filter(Boolean);
  if (!metrics.length || metrics.length > 12 || new Set(metrics).size !== metrics.length) reject(400, "Statistiques invalides.");
  metrics.forEach((m) => metricParam(m));
  const minMinutes = Number(params.get("minMinutes") ?? "450");
  if (!Number.isInteger(minMinutes) || minMinutes < 0 || minMinutes > 10000) reject(400, "Seuil invalide.");
  const rows = await query(`/*orion:season:cohort*/ WITH ${identitySql(e.catalog_generation)}
SELECT p.public_id AS id, s.minutes_played, json_agg(json_build_array(substring(m.metric_code FROM ${PREFIX.length + 1}),
  m.numeric_value::text, m.observed_count, m.eligible_minutes::text) ORDER BY m.metric_code) AS metrics
FROM analytics.player_competition_stats s JOIN players p ON p.player_id=s.player_id
JOIN analytics.metric_totals m ON m.build_id=s.build_id AND m.subject_kind='player' AND m.player_id=s.player_id
 AND m.metric_code=ANY($2::text[])
WHERE s.build_id=$1::bigint AND coalesce(s.minutes_played,0)>=$3::int
GROUP BY p.public_id, s.minutes_played ORDER BY p.public_id COLLATE "C"`, [e.build_id, metrics.map((m) => PREFIX + m), minMinutes]);
  return reply(req, { data: { meta: { ...meta(e), metrics, minMinutes, players: rows.length },
    players: rows.map((r) => ({ id: r.id, minutes: r.minutes_played,
      metrics: Object.fromEntries(r.metrics.map(([k, sum, observed, minutes]) => [k, { sum: num(sum), observed, minutes: num(minutes) }])) })) } }, e.token);
}

// One club in one edition: squad rows and team totals.
async function teamSeason(req, params) {
  validateParams(params, ["league", "season", "v", "team"]);
  const e = await edition(params);
  const team = params.get("team");
  if (!tid.test(team || "")) reject(400, "Équipe invalide.");
  const rows = await query(`/*orion:season:team*/ WITH ${identitySql(e.catalog_generation)}
SELECT p.public_id AS id, pr.display_name AS name, s.appearances, s.starts, s.minutes_played, s.goals, s.assists, s.shots,
 s.shots_on_target, s.passes_completed, s.passes_attempted, s.xg::text, s.xa::text, s.goals_prevented::text,
 s.provider_rating_weighted::text AS rating_weighted
FROM analytics.player_competition_team_stats s JOIN teams t ON t.team_id=s.team_id AND t.public_id=$2::text
JOIN players p ON p.player_id=s.player_id LEFT JOIN profiles pr ON pr.player_id=s.player_id
WHERE s.build_id=$1::bigint ORDER BY s.minutes_played DESC NULLS LAST, p.public_id COLLATE "C"`, [e.build_id, team]);
  const [totals] = await query(`/*orion:season:teamtotals*/ WITH ${identitySql(e.catalog_generation)}
SELECT s.matches_played, s.wins, s.draws, s.losses, s.goals_for, s.goals_against, s.points_calculated, s.xg_for::text, s.xg_against::text
FROM analytics.team_competition_stats s JOIN teams t ON t.team_id=s.team_id AND t.public_id=$2::text WHERE s.build_id=$1::bigint`,
    [e.build_id, team]);
  if (!totals) reject(404, "Équipe absente de cette édition.");
  return reply(req, { data: { meta: meta(e), team: { id: team, played: totals.matches_played, wins: totals.wins, draws: totals.draws,
      losses: totals.losses, goalsFor: totals.goals_for, goalsAgainst: totals.goals_against, points: totals.points_calculated,
      xgFor: num(totals.xg_for), xgAgainst: num(totals.xg_against) },
    squad: rows.map((r) => ({ id: r.id, name: r.name, appearances: r.appearances, starts: r.starts, minutes: r.minutes_played,
      goals: r.goals, assists: r.assists, shots: r.shots, shotsOnTarget: r.shots_on_target, passesCompleted: r.passes_completed,
      passesAttempted: r.passes_attempted, xg: num(r.xg), xa: num(r.xa), goalsPrevented: num(r.goals_prevented),
      ratingWeighted: num(r.rating_weighted) })) } }, e.token);
}

// One player across all currently published aggregate editions.
async function playerSeasons(req, params) {
  validateParams(params, ["player"]);
  const player = params.get("player");
  if (!pid.test(player || "")) reject(400, "Joueur invalide.");
  const editions = (await proRepresentations(null, null)).filter((r) => r.metrics_contract_version === CONTRACT);
  if (!editions.length) reject(503, "Agrégats de saison indisponibles.");
  const builds = editions.map((r) => r.build_id);
  const g = Math.max(...editions.map((r) => Number(r.catalog_generation)));
  const rows = await query(`/*orion:season:player*/ WITH ${identitySql(g)}
SELECT s.build_id::text, t.public_id AS team_id, tm.name AS team, s.appearances, s.starts, s.minutes_played, s.goals, s.assists,
 s.shots, s.shots_on_target, s.xg::text, s.xa::text, s.provider_rating_weighted::text AS rating_weighted
FROM players p JOIN analytics.player_competition_team_stats s ON s.player_id=p.player_id AND s.build_id=ANY($2::bigint[])
JOIN football.teams tm ON tm.id=s.team_id LEFT JOIN teams t ON t.team_id=s.team_id
WHERE p.public_id=$1::text ORDER BY s.build_id`, [player, builds]);
  const byBuild = new Map(editions.map((r) => [String(r.build_id), r]));
  return reply(req, { data: { meta: { source: "AWS", contract: CONTRACT, editions: editions.length },
    seasons: rows.map((r) => { const ed = byBuild.get(r.build_id);
      return { leagueId: ed.league_keys[0], league: ed.league_name, season: ed.season, representationToken: ed.token,
        teamId: r.team_id, team: r.team, appearances: r.appearances, starts: r.starts, minutes: r.minutes_played, goals: r.goals,
        assists: r.assists, shots: r.shots, shotsOnTarget: r.shots_on_target, xg: num(r.xg), xa: num(r.xa),
        ratingWeighted: num(r.rating_weighted) }; }) } }, JSON.stringify(editions.map((r) => r.token)));
}

const ROUTES = {
  "/api/editions/table": table,
  "/api/editions/players": players,
  "/api/editions/cohort": cohort,
  "/api/editions/team": teamSeason,
  "/api/players/seasons": playerSeasons,
};

export async function orionProSeasonRoute(req, path, params) {
  const handler = ROUTES[path];
  if (!handler) return null;
  if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
  return handler(req, params);
}
