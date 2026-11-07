import { query } from "./postgres.js";
import { createReadCache } from "./relational-read-cache.js";
import { reject, validateParams } from "./relational-core.js";
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
  scopeWhere,
} from "./relational-read-utils.js";

const teamMetrics = {
  xgFor: ["expected_goals", "xg"],
  shotsFor: ["total_shots", "shots"],
  shotsOnTarget: ["ShotsOnTarget", "shots_on_target"],
  possession: ["BallPossesion", "possession"],
  passes: ["passes"],
  passesAccurate: ["accurate_passes"],
  touchesBox: ["touches_opp_box"],
  corners: ["corners"],
  duelsWon: ["duel_won"],
  aerialsWon: ["aerials_won"],
  tackles: ["matchstats.headers.tackles"],
  interceptions: ["interceptions"],
  clearances: ["clearances"],
  saves: ["keeper_saves"],
};
const matchFields = [
  "id",
  "name",
  "image_url",
  "formation",
  "score",
  "xg",
  "shots",
  "shots_on_target",
  "possession",
];
export const scoreSql = (value) =>
  `(${finiteSql(value)} AND ${value}>=0 AND ${value}=trunc(${value}))`;

/** The typed match wins over a fixture; only a null score inherits its fixture. */
export function clubMatchCtes(scope, values, generation = null) {
  const matchWhere = scopeWhere("m", scope, values),
    fixtureWhere = scopeWhere("f", scope, values);
  const fence =
    generation === null
      ? ""
      : ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${bindValue(values, generation)})`;
  const side = (name, field) => {
    const fixtureField =
      field === "id"
        ? `${name}_team_id`
        : field === "score"
          ? `score_${name}`
          : `${name}_${field}`;
    const canInherit = ["id", "name", "image_url", "score"].includes(field);
    return canInherit
      ? `coalesce(m.${name}_${field},f.${fixtureField}) AS ${name}_${field}`
      : `m.${name}_${field}`;
  };
  return `match_source AS MATERIALIZED (SELECT m.* FROM statarena_app.matches m WHERE ${matchWhere}${fence}),
fixture_source AS MATERIALIZED (SELECT f.* FROM statarena_app.fixtures f WHERE ${fixtureWhere}${fence}),
combined AS MATERIALIZED (
 SELECT coalesce(m.id,f.id) id,coalesce(m.season,f.season) season,coalesce(m.league_id,f.league_id) league_id,
 coalesce(m.league,f.league_name) league,coalesce(m.date,f.day::text) AS date,coalesce(m.day,f.day) AS day,
 CASE WHEN m.id IS NOT NULL THEN m.time_utc ELSE f.time_utc END time_utc,
 CASE WHEN m.id IS NOT NULL THEN m.status ELSE f.status END status,
 ${["home", "away"].flatMap((name) => matchFields.map((field) => side(name, field))).join(",")}
 FROM fixture_source f FULL JOIN match_source m USING(id)
), sides AS MATERIALIZED (
 SELECT m.*,s.side,s.team_id,s.name,s.image_url,s.formation,s.own,s.against,
 (m.status='finished' AND ${scoreSql("s.own")} AND ${scoreSql("s.against")}) scored
 FROM combined m CROSS JOIN LATERAL (VALUES
   ('home',m.home_id,m.home_name,m.home_image_url,m.home_formation,m.home_score,m.away_score),
   ('away',m.away_id,m.away_name,m.away_image_url,m.away_formation,m.away_score,m.home_score)
 ) s(side,team_id,name,image_url,formation,own,against)
 WHERE m.home_id IS NOT NULL AND m.away_id IS NOT NULL AND m.home_id<>m.away_id
)`;
}

const emptyResult = () => ({
  matches: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  points: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  cleanSheets: 0,
});
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
    "season",
    "league",
    "leagues",
    "generation",
    "q",
    "country",
    "competition",
    "analysis",
    "sort",
    "direction",
    "page",
    "limit",
  ]);
  const scope = parseReadScope(params),
    page = readPageArgs(params, 24),
    q = (params.get("q") || "").trim();
  if (q.length > 100 || /[\u0000-\u001f\u007f]/.test(q))
    reject(400, "Recherche invalide.");
  const country = params.get("country") || "all",
    competition = params.get("competition") || "all";
  if (
    !["all", "unknown"].includes(country) &&
    !/^[A-Z][A-Z0-9-]{1,10}$/.test(country)
  )
    reject(400, "Pays invalide.");
  if (competition !== "all" && !/^l_[A-Za-z0-9]{6}$/.test(competition))
    reject(400, "Compétition invalide.");
  const analysis = params.get("analysis") === "1";
  if (params.has("analysis") && !["0", "1"].includes(params.get("analysis")))
    reject(400, "Analyse invalide.");
  const sort = params.get("sort") || "name",
    direction = params.get("direction") || "asc";
  if (
    ![
      "name",
      "count",
      "matches",
      "points",
      "goalsFor",
      "goalsAgainst",
    ].includes(sort) ||
    !["asc", "desc"].includes(direction)
  )
    reject(400, "Tri invalide.");
  return { scope, ...page, q, country, competition, analysis, sort, direction };
}

export function clubReadQuery(filters, params) {
  const values = [],
    publication = publicationSql(filters.scope, values),
    b = (value) => bindValue(values, value);
  const withRecords =
    filters.analysis || !["name", "count"].includes(filters.sort);
  let matches;
  if (withRecords) {
    matches = clubMatchCtes(filters.scope, values, params.get("generation"));
  } else {
    const predicate = scopeWhere("m", filters.scope, values),
      fence = params.has("generation")
        ? ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${b(params.get("generation"))})`
        : "";
    // A directory needs identity/count columns only, not a materialized copy
    // of every score, formation, statistic and fixture in the selected season.
    matches = `match_source AS MATERIALIZED (
      SELECT m.id,m.league_id,m.league,m.time_utc,m.date,
        m.home_id,m.home_name,m.home_image_url,m.away_id,m.away_name,m.away_image_url
      FROM statarena_app.matches m WHERE ${predicate}${fence})`;
  }
  const where = [
    filters.analysis ? "(c.record->>'matches')::int>0" : "c.count>0",
  ];
  if (filters.q)
    where.push(
      `${normalizedSql("c.name")} LIKE ${b(`%${likeText(filters.q)}%`)}`,
    );
  if (filters.country !== "all") where.push(`c.country=${b(filters.country)}`);
  if (filters.competition !== "all")
    where.push(`c.competition_counts ? ${b(filters.competition)}`);
  const order =
    filters.sort === "name"
      ? `${normalizedSql("c.name")} ${filters.direction},c.name COLLATE "C" ${filters.direction},c.id`
      : `${filters.sort === "count" ? "c.count" : `(c.record->>'${filters.sort}')::float8`} ${filters.direction} NULLS LAST,${normalizedSql("c.name")},c.id`;
  const limit = b(filters.limit),
    offset = b(filters.offset);
  const statKeys = [...new Set(Object.values(teamMetrics).map(([key]) => key))];
  const observed = (key, field, opposite = false) => {
    const first = opposite ? "away" : "home",
      second = opposite ? "home" : "away";
    const column = `CASE WHEN s.side='home' THEN t.${first}_${statKeys.indexOf(key)} ELSE t.${second}_${statKeys.indexOf(key)} END`;
    return field
      ? `coalesce((${column}),(CASE WHEN s.side='home' THEN s.${first}_${field} ELSE s.${second}_${field} END))`
      : `(${column})`;
  };
  const observations = Object.entries(teamMetrics).map(
    ([metric, [key, field]]) => `${observed(key, field)} AS "${metric}"`,
  );
  observations.push(
    `${observed("expected_goals", "xg", true)} AS "xgAgainst"`,
    `${observed("total_shots", "shots", true)} AS "shotsAgainst"`,
    `(${observed("expected_goals", "xg")})-(${observed("expected_goals", "xg", true)}) AS "xgDifference"`,
  );
  const metricNames = [
    ...Object.keys(teamMetrics),
    "xgAgainst",
    "shotsAgainst",
    "xgDifference",
  ];
  const optional = filters.analysis
    ? `,
selected_sides AS MATERIALIZED (SELECT s.* FROM sides s JOIN page p ON p.id=s.team_id),
stat_values AS (
 SELECT t.match_id,${statKeys.flatMap((key, index) => ["home", "away"].map((side) => `max(t.${side}_value) FILTER(WHERE metric_key='${key}') AS ${side}_${index}`)).join(",")}
 FROM statarena_app.team_statistics t JOIN (SELECT DISTINCT id FROM selected_sides WHERE scored) m ON m.id=t.match_id GROUP BY t.match_id
), observations AS (
 SELECT s.*,co.flag reliable,${observations.join(",")}
 FROM selected_sides s LEFT JOIN stat_values t ON t.match_id=s.id
 LEFT JOIN statarena_app.match_coverage co ON co.match_id=s.id AND co.coverage_key='teamStatsReliable'
), observed AS (
 SELECT s.team_id,
 jsonb_build_object(${metricNames.flatMap((metric) => [`'${metric}'`, `jsonb_build_object('sum',sum(s."${metric}") FILTER(WHERE s.scored AND s.reliable IS DISTINCT FROM false AND ${finiteSql(`s."${metric}"`)}),'count',count(*) FILTER(WHERE s.scored AND s.reliable IS DISTINCT FROM false AND ${finiteSql(`s."${metric}"`)}))`]).join(",")}) stats,
 count(*) FILTER(WHERE s.scored AND s.reliable IS FALSE)::int excluded_stats,
 count(*) FILTER(WHERE s.status='finished' AND NOT s.scored)::int unscored
 FROM observations s GROUP BY s.team_id
), recent AS (
 SELECT s.*,row_number() OVER(PARTITION BY team_id ORDER BY coalesce(time_utc,date) DESC,id DESC) recent_order
 FROM selected_sides s WHERE scored
), forms AS (
 SELECT team_id,jsonb_agg(jsonb_build_object('match',jsonb_build_object('id',id,'season',season,'leagueId',league_id,'league',league,'date',date,'timeUtc',time_utc,'status',status,
 'home',jsonb_build_object('id',home_id,'name',home_name,'score',home_score,'formation',home_formation),
 'away',jsonb_build_object('id',away_id,'name',away_name,'score',away_score,'formation',away_formation)),
 'result',CASE WHEN own>against THEN 'V' WHEN own=against THEN 'N' ELSE 'D' END,'scoreFor',own,'scoreAgainst',against,'side',side) ORDER BY recent_order) forms
 FROM recent WHERE recent_order<=5 GROUP BY team_id
), formation_counts AS (
 SELECT team_id,formation,count(*)::int amount FROM selected_sides WHERE scored AND formation IS NOT NULL AND formation<>'' GROUP BY team_id,formation
), formations AS (
 SELECT team_id,jsonb_agg(jsonb_build_array(formation,amount) ORDER BY amount DESC,formation) formations FROM formation_counts GROUP BY team_id
), goal_buckets AS (
 SELECT s.team_id,sh.team_id=s.team_id own,least(5,greatest(0,floor((sh.minute-0.01)/15)::int)) bucket,count(*)::int amount
 FROM selected_sides s JOIN statarena_app.shots sh ON sh.match_id=s.id
 WHERE s.scored AND sh.team_id IN(s.home_id,s.away_id) AND sh.is_goal IS TRUE AND sh.is_own_goal IS DISTINCT FROM true AND ${finiteSql("sh.minute")}
 GROUP BY s.team_id,sh.team_id=s.team_id,least(5,greatest(0,floor((sh.minute-0.01)/15)::int))
), goal_times AS (
 SELECT p.id team_id,
 jsonb_build_object('for',jsonb_agg(coalesce(own.amount,0) ORDER BY n),'against',jsonb_agg(coalesce(other.amount,0) ORDER BY n),'observed',sum(coalesce(own.amount,0)+coalesce(other.amount,0))) goal_times
 FROM page p CROSS JOIN generate_series(0,5) n LEFT JOIN goal_buckets own ON own.team_id=p.id AND own.own AND own.bucket=n
 LEFT JOIN goal_buckets other ON other.team_id=p.id AND NOT other.own AND other.bucket=n GROUP BY p.id
)`
    : "";
  const final = filters.analysis
    ? "SELECT p.*,o.stats,o.excluded_stats,o.unscored,f.forms,fo.formations,g.goal_times FROM page p LEFT JOIN observed o ON o.team_id=p.id LEFT JOIN forms f ON f.team_id=p.id LEFT JOIN formations fo ON fo.team_id=p.id LEFT JOIN goal_times g ON g.team_id=p.id"
    : "SELECT p.* FROM page p";
  const sql = `/*vega:compact:clubs*/
WITH publication AS MATERIALIZED (${publication}),${matches},
directory_sides AS MATERIALIZED (
 SELECT m.id,m.league_id,m.league,coalesce(m.time_utc,m.date) chronology,s.*
 FROM match_source m CROSS JOIN LATERAL (VALUES(m.home_id,m.home_name,m.home_image_url),(m.away_id,m.away_name,m.away_image_url)) s(team_id,name,image_url)
 WHERE s.team_id IS NOT NULL
), identities AS (
 SELECT DISTINCT ON(team_id) team_id,name,image_url,league FROM ${filters.analysis ? "sides" : "directory_sides"}
 ORDER BY team_id,${filters.analysis ? "coalesce(time_utc,date) ASC NULLS LAST" : "chronology DESC NULLS LAST"},id
), competition_counts AS (
 SELECT team_id,league_id,count(*)::int amount FROM ${filters.analysis ? "sides" : "directory_sides"} GROUP BY team_id,league_id
), directories AS (
 SELECT team_id,sum(amount)::int count,jsonb_object_agg(league_id,amount) competition_counts FROM competition_counts GROUP BY team_id
), domestic AS (
 SELECT DISTINCT ON(s.team_id) s.team_id,c.country FROM ${filters.analysis ? "sides" : "directory_sides"} s JOIN statarena_app.competitions c ON c.id=s.league_id
 WHERE c.country IS NOT NULL AND c.country<>'' AND c.country NOT IN('UEFA','INT','INT-2','FIFA') ORDER BY s.team_id,s.id DESC
), records AS (
 ${
   withRecords
     ? `
 SELECT s.team_id,${resultProjection()} record,${resultProjection("s.scored AND s.side='home'")} home,${resultProjection("s.scored AND s.side='away'")} away
 FROM sides s GROUP BY s.team_id`
     : "SELECT NULL::text team_id,NULL::jsonb record,NULL::jsonb home,NULL::jsonb away WHERE false"
 }
), clubs AS MATERIALIZED (
 SELECT i.team_id id,coalesce(nullif(i.name,''),t.name,'Club') name,coalesce(i.image_url,t.image_url) image_url,i.league,
 coalesce(nullif(t.country,''),d.country,'unknown') country,di.count,di.competition_counts,r.record,r.home,r.away
 FROM identities i JOIN directories di USING(team_id) LEFT JOIN statarena_app.teams t ON t.id=i.team_id
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
    stats: Object.fromEntries(
      Object.entries(row.stats || {}).filter(([, value]) => value.count > 0),
    ),
    forms: row.forms || [],
    formations: row.formations || [],
    excludedStats: Number(row.excluded_stats || 0),
    unscored: Number(row.unscored || 0),
    games: [],
    shots: [],
    goalTimes: row.goal_times || {
      for: Array(6).fill(0),
      against: Array(6).fill(0),
      observed: 0,
    },
  };
}

export function createClubReadRoute(read = query) {
  const snapshotRead = createReadCache(read, { name: "clubs" });
  return async (req, path, params) => {
    if (path !== "/api/read/clubs") return null;
    if (!["GET", "HEAD"].includes(req.method))
      reject(405, "Méthode non autorisée.");
    const filters = parseClubRead(params);
    const validated = await readValidator(req, params, filters.scope, read);
    if (validated) return validated;
    const { sql, values } = clubReadQuery(filters, params);
    const snapshot = await snapshotRead(
      req,
      params,
      filters.scope,
      async () => (await read(sql, values))[0],
    );
    const total = Number(snapshot?.total || 0);
    return readResponse(
      req,
      params,
      snapshot,
      {
        clubs: (snapshot?.clubs || []).map((row) =>
          clubReadRecord(row, filters.analysis),
        ),
        facets: {
          countries: snapshot?.countries || [],
          competitionIds: snapshot?.competition_ids || [],
        },
      },
      {
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          pages: Math.max(1, Math.ceil(total / filters.limit)),
        },
        maxBytes: 1024 * 1024,
      },
    );
  };
}
export const relationalClubReadRoute = createClubReadRoute();
