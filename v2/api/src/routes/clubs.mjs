/**
 * GET /api/read/clubs — club directory and club analysis, same parameters and same
 * response as dashboard/backend/services/relational-clubs.js on main, read from
 * api.club_match_sides and api.match_shots.
 *
 * The scope is resolved to ids before the query (resolveEditions) and bound: the view
 * reaches the scope's matches by index and its season's partitions only. Every club of
 * the scope is ranked from the columns of its matches (ids, scores, competition); the
 * formations, the team statistics and the score lines' keys are read for the page's
 * clubs only (`selected`).
 *
 * Differences with the legacy read, by construction of v2 (listed for the parity
 * comparison): team statistics have one source, so there is no "unreliable stats"
 * exclusion (excludedStats is always 0) and no fallback to match-level fields.
 * Added by v2: each directory club has `power`, its power ranking of the season read
 * (api.power_clubs: rank, Elo, Elo change, matches), or null.
 */
import { reject, validateParams } from "../http.mjs";
import { powerOf } from "./rankings.mjs";
import {
  bindValue,
  finiteSql,
  likeText,
  normalizedSql,
  parseReadScope,
  publicationSql,
  readPageArgs,
  readResponse,
  readValidator,
  resolveEditions,
} from "../publication.mjs";

// Legacy metric name -> v2 column of api.club_match_sides.
const TEAM_METRICS = {
  xgFor: "s.xg",
  shotsFor: "s.total_shots",
  shotsOnTarget: "s.shots_on_target",
  possession: "s.possession_pct",
  passes: "s.passes",
  passesAccurate: "s.accurate_passes",
  touchesBox: "s.touches_opp_box",
  corners: "s.corners",
  duelsWon: "s.duels_won",
  aerialsWon: "s.aerials_won",
  tackles: "s.tackles",
  interceptions: "s.interceptions",
  clearances: "s.clearances",
  saves: "s.keeper_saves",
  xgAgainst: "s.xg_against",
  shotsAgainst: "s.shots_against",
  xgDifference: "(s.xg - s.xg_against)",
};
const SORTS = ["name", "count", "matches", "points", "goalsFor", "goalsAgainst"];
const utc = (column) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const chronology = "coalesce(s.time_utc, s.date::timestamptz)";

const emptyResult = () => ({ matches: 0, wins: 0, draws: 0, losses: 0, points: 0, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0 });

function resultProjection(predicate = "s.scored") {
  return `jsonb_build_object(
 'matches',count(*) FILTER(WHERE ${predicate}),
 'wins',count(*) FILTER(WHERE ${predicate} AND s.own>s.against),
 'draws',count(*) FILTER(WHERE ${predicate} AND s.own=s.against),
 'losses',count(*) FILTER(WHERE ${predicate} AND s.own<s.against),
 'points',coalesce(sum(CASE WHEN s.own>s.against THEN 3 WHEN s.own=s.against THEN 1 ELSE 0 END) FILTER(WHERE ${predicate}),0),
 'goalsFor',coalesce(sum(s.own) FILTER(WHERE ${predicate}),0),
 'goalsAgainst',coalesce(sum(s.against) FILTER(WHERE ${predicate}),0),
 'cleanSheets',count(*) FILTER(WHERE ${predicate} AND s.against=0))`;
}

export function parseClubRead(params) {
  validateParams(params, [
    "season", "league", "leagues", "generation", "q", "country", "competition",
    "analysis", "sort", "direction", "page", "limit", "media", "v",
  ]);
  const scope = parseReadScope(params),
    page = readPageArgs(params, 24),
    q = (params.get("q") || "").trim();
  if (q.length > 100 || /[\u0000-\u001f\u007f]/.test(q)) reject(400, "Recherche invalide.");
  const country = params.get("country") || "all",
    competition = params.get("competition") || "all";
  if (!["all", "unknown"].includes(country) && !/^[A-Z][A-Z0-9-]{1,10}$/.test(country)) reject(400, "Pays invalide.");
  if (competition !== "all" && !/^l_[A-Za-z0-9]{6}$/.test(competition)) reject(400, "Compétition invalide.");
  if (params.has("analysis") && !["0", "1"].includes(params.get("analysis"))) reject(400, "Analyse invalide.");
  const analysis = params.get("analysis") === "1";
  const sort = params.get("sort") || "name",
    direction = params.get("direction") || "asc";
  if (!SORTS.includes(sort) || !["asc", "desc"].includes(direction)) reject(400, "Tri invalide.");
  return { scope, ...page, q, country, competition, analysis, sort, direction };
}

/** editions is the scope resolved to ids (resolveEditions). */
export function clubReadQuery(filters, params, editions) {
  const values = [],
    publication = publicationSql(filters.scope, values),
    b = (value) => bindValue(values, value);
  const withRecords = filters.analysis || !["name", "count"].includes(filters.sort);
  // core.matches is one table for every season: the editions' ids reach the scope's
  // matches by index, the season's id keeps the partitioned tables to its partitions.
  const sid = b(editions.seasonId),
    eds = b(editions.ids);
  const scope = (alias) => `${alias}.season_id=${sid}::smallint AND ${alias}.competition_season_id=ANY(${eds}::int[])`;
  const fence = params.has("generation")
    ? ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${b(params.get("generation"))})`
    : "";
  const where = [filters.analysis ? "(c.record->>'matches')::int>0" : "c.count>0"];
  if (filters.q) where.push(`${normalizedSql("c.name")} LIKE ${b(`%${likeText(filters.q)}%`)}`);
  if (filters.country !== "all") where.push(`c.country=${b(filters.country)}`);
  if (filters.competition !== "all") where.push(`c.competition_counts ? ${b(filters.competition)}`);
  const order =
    filters.sort === "name"
      ? `${normalizedSql("c.name")} ${filters.direction},c.name COLLATE "C" ${filters.direction},c.id`
      : `${filters.sort === "count" ? "c.count" : `(c.record->>'${filters.sort}')::float8`} ${filters.direction} NULLS LAST,${normalizedSql("c.name")},c.id`;
  const limit = b(filters.limit),
    offset = b(filters.offset);
  const records = withRecords
    ? `SELECT s.team_id,${resultProjection()} record,${resultProjection("s.scored AND s.side='home'")} home,${resultProjection("s.scored AND s.side='away'")} away
       FROM sides s GROUP BY s.team_id`
    : "SELECT NULL::text team_id,NULL::jsonb record,NULL::jsonb home,NULL::jsonb away WHERE false";
  const stats = Object.entries(TEAM_METRICS)
    .map(
      ([metric, column]) =>
        `'${metric}',jsonb_build_object('sum',sum(${column}) FILTER(WHERE s.scored AND ${finiteSql(column)}),'count',count(*) FILTER(WHERE s.scored AND ${finiteSql(column)}))`,
    )
    .join(",");
  const optional = filters.analysis
    ? `,
selected AS MATERIALIZED (
 SELECT s.*,v.public_id,v.season,v.formation,
 v.home_public_id,v.home_name,v.home_score,v.home_formation,v.away_public_id,v.away_name,v.away_score,v.away_formation,
 ${Object.values(TEAM_METRICS)
   .filter((c) => c.startsWith("s."))
   .map((c) => c.replace("s.", "v."))
   .join(",")}
 FROM sides s JOIN page p ON p.id=s.team_id
 JOIN api.club_match_sides v ON ${scope("v")} AND v.match_id=s.match_id AND v.team_id=s.internal_team_id
),
observed AS (
 SELECT s.team_id,jsonb_build_object(${stats}) stats,
 count(*) FILTER(WHERE s.status='finished' AND NOT s.scored)::int unscored
 FROM selected s GROUP BY s.team_id
), recent AS (
 SELECT s.*,row_number() OVER(PARTITION BY s.team_id ORDER BY ${chronology} DESC,s.match_id DESC) recent_order FROM selected s WHERE s.scored
), forms AS (
 SELECT team_id,jsonb_agg(jsonb_build_object('match',jsonb_build_object('id',public_id,'season',season,'leagueId',league_id,'league',league,
 'date',date::text,'timeUtc',${utc("time_utc")},'status',status,
 'home',jsonb_build_object('id',home_public_id,'name',home_name,'score',home_score,'formation',home_formation),
 'away',jsonb_build_object('id',away_public_id,'name',away_name,'score',away_score,'formation',away_formation)),
 'result',CASE WHEN own>against THEN 'V' WHEN own=against THEN 'N' ELSE 'D' END,'scoreFor',own,'scoreAgainst',against,'side',side) ORDER BY recent_order) forms
 FROM recent WHERE recent_order<=5 GROUP BY team_id
), formation_counts AS (
 SELECT team_id,formation,count(*)::int amount FROM selected WHERE scored AND formation IS NOT NULL AND formation<>'' GROUP BY team_id,formation
), formations AS (
 SELECT team_id,jsonb_agg(jsonb_build_array(formation,amount) ORDER BY amount DESC,formation) formations FROM formation_counts GROUP BY team_id
), goal_buckets AS (
 SELECT s.team_id,g.team_id=s.internal_team_id own,least(5,greatest(0,floor((g.minute-0.01)/15)::int)) bucket,count(*)::int amount
 -- As main: the goals of the shot map (not the goal events), own goals left out.
 FROM selected s JOIN api.match_shots g ON g.season_id=${sid}::smallint AND g.match_id=s.match_id
 WHERE s.scored AND g.is_goal IS TRUE AND g.is_own_goal IS DISTINCT FROM true AND g.minute IS NOT NULL
 GROUP BY 1,2,3
), goal_times AS (
 SELECT p.id team_id,jsonb_build_object('for',jsonb_agg(coalesce(o.amount,0) ORDER BY n),'against',jsonb_agg(coalesce(a.amount,0) ORDER BY n),
 'observed',sum(coalesce(o.amount,0)+coalesce(a.amount,0))) goal_times
 FROM page p CROSS JOIN generate_series(0,5) n
 LEFT JOIN goal_buckets o ON o.team_id=p.id AND o.own AND o.bucket=n
 LEFT JOIN goal_buckets a ON a.team_id=p.id AND NOT a.own AND a.bucket=n GROUP BY p.id
)`
    : "";
  const final = filters.analysis
    ? "SELECT p.*,o.stats,0 excluded_stats,o.unscored,f.forms,fo.formations,g.goal_times FROM page p LEFT JOIN observed o ON o.team_id=p.id LEFT JOIN forms f ON f.team_id=p.id LEFT JOIN formations fo ON fo.team_id=p.id LEFT JOIN goal_times g ON g.team_id=p.id"
    : "SELECT p.* FROM page p";
  const columns = ["s.team_public_id team_id,s.match_id,s.league_id,s.league,s.league_country,s.date,s.time_utc,s.name,s.image_url,s.country"];
  if (withRecords) columns.push("s.side,s.own,s.against,s.scored");
  if (filters.analysis) columns.push("s.team_id internal_team_id,s.status");
  const sql = `/*vega:v2:clubs*/
WITH publication AS MATERIALIZED (${publication}),
sides AS MATERIALIZED (
 SELECT ${columns.join(",")}
 FROM api.club_match_sides s WHERE ${scope("s")}${fence}
), identities AS (
 SELECT DISTINCT ON(team_id) team_id,name,image_url,league FROM sides s
 ORDER BY team_id,${chronology} ${filters.analysis ? "ASC" : "DESC"} NULLS LAST,match_id
), competition_counts AS (
 SELECT team_id,league_id,count(*)::int amount FROM sides GROUP BY team_id,league_id
), directories AS (
 SELECT team_id,sum(amount)::int count,jsonb_object_agg(league_id,amount) competition_counts FROM competition_counts GROUP BY team_id
), domestic AS (
 SELECT DISTINCT ON(team_id) team_id,league_country country FROM sides
 WHERE league_country IS NOT NULL AND league_country<>'' AND league_country NOT IN('UEFA','INT','INT-2','FIFA') ORDER BY team_id,match_id DESC
), team_country AS (
 SELECT DISTINCT ON(team_id) team_id,country FROM sides WHERE country IS NOT NULL AND country<>'' ORDER BY team_id,match_id DESC
), records AS (${records}),
clubs AS MATERIALIZED (
 SELECT i.team_id id,coalesce(nullif(i.name,''),'Club') name,i.image_url,i.league,
 coalesce(t.country,d.country,'unknown') country,di.count,di.competition_counts,r.record,r.home,r.away
 FROM identities i JOIN directories di USING(team_id) LEFT JOIN team_country t USING(team_id)
 LEFT JOIN domestic d USING(team_id) LEFT JOIN records r USING(team_id)
), filtered AS MATERIALIZED (SELECT c.* FROM clubs c WHERE ${where.join(" AND ")}),
page AS MATERIALIZED (SELECT c.*,row_number() OVER(ORDER BY ${order}) result_order FROM filtered c ORDER BY ${order} LIMIT ${limit} OFFSET ${offset})
${optional},payload AS (${final})
SELECT publication.*,(SELECT count(*)::int FROM filtered) total,
 coalesce((SELECT jsonb_agg(to_jsonb(p)-'result_order' ORDER BY result_order) FROM payload p),'[]'::jsonb) clubs,
 coalesce((SELECT jsonb_agg(country ORDER BY country) FROM (SELECT DISTINCT country FROM clubs) c),'[]'::jsonb) countries,
 coalesce((SELECT jsonb_agg(league_id ORDER BY league_id) FROM (SELECT DISTINCT league_id FROM competition_counts) c),'[]'::jsonb) competition_ids
FROM publication`;
  return { sql, values };
}

export function clubReadRecord(row, analysis) {
  const base = {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    league: row.league,
    country: row.country,
    count: Number(row.count),
    competitionCounts: row.competition_counts,
  };
  if (!analysis) return base;
  return {
    ...base,
    ...(row.record || emptyResult()),
    home: row.home || emptyResult(),
    away: row.away || emptyResult(),
    stats: Object.fromEntries(Object.entries(row.stats || {}).filter(([, value]) => value.count > 0)),
    forms: row.forms || [],
    formations: row.formations || [],
    excludedStats: Number(row.excluded_stats || 0),
    unscored: Number(row.unscored || 0),
    games: [],
    shots: [],
    goalTimes: row.goal_times || { for: Array(6).fill(0), against: Array(6).fill(0), observed: 0 },
  };
}

export function createClubReadRoute(read) {
  return async (req, path, params) => {
    if (path !== "/api/read/clubs") return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    const filters = parseClubRead(params);
    const validated = await readValidator(req, params, filters.scope, read);
    if (validated) return validated;
    const { sql, values } = clubReadQuery(filters, params, await resolveEditions(read, filters.scope));
    const [snapshot] = await read(sql, values);
    const total = Number(snapshot?.total || 0);
    const clubs = (snapshot?.clubs || []).map((row) => clubReadRecord(row, filters.analysis));
    // Each club's power ranking of the season (its Elo strength, rankings.mjs).
    const power = await powerOf(read, "clubs", filters.scope.season, clubs.map((c) => c.id));
    for (const c of clubs) c.power = power.get(c.id) ?? null;
    return readResponse(
      req,
      params,
      snapshot,
      {
        clubs,
        facets: { countries: snapshot?.countries || [], competitionIds: snapshot?.competition_ids || [] },
      },
      {
        pagination: { page: filters.page, limit: filters.limit, total, pages: Math.max(1, Math.ceil(total / filters.limit)) },
        maxBytes: 1024 * 1024,
      },
    );
  };
}
