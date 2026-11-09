/**
 * GET /api/read/players — player directory and rankings, same parameters and same
 * response as dashboard/backend/services/relational-players.js on main, read from
 * api.player_appearances (019_api_players.sql). Added by v2: each player record has
 * `power`, its power ranking of the season read (api.power_players), or null.
 *
 * Differences with the legacy read, by construction of v2 (listed for the parity
 * comparison):
 * - one row per player and match by key, so there is no duplicate appearance to drop;
 * - `profile.identity.id` and `profile.latest.id` are `<match id>:<player id>` (v2 has
 *   no appearance rows of its own);
 * - search aliases come from the curated names (core.entity_names, kind alias);
 * - the rows of a player are in league, date, kick-off and match order (legacy: the
 *   order of the published partition files).
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
  scopeWhere,
} from "../publication.mjs";

// dashboard/shared/player-profile.js (main).
export const MIN_RATED_MATCHES = 5;

// The observed metrics of season-player.js; the columns of api.player_appearances.
export const PLAYER_COUNT_METRICS = [
  "goals", "assists", "xg", "npxg", "xgot", "xa", "shots", "shotsOnTarget", "touchesBox",
  "chancesCreated", "bigChancesCreated", "passesFinalThird", "dribbles", "touches",
  "passesAccurate", "passesAttempted", "duelsWon", "duelsLost", "tackles", "interceptions",
  "recoveries", "clearances", "defensiveActions", "blocks", "saves", "goalsPrevented",
];
const metricKeys = [...PLAYER_COUNT_METRICS, "passAccuracy", "duelRate"];
const conditionKeys = new Set([
  "goals", "assists", "xg", "xa", "shots", "shotsOnTarget", "chancesCreated", "touchesBox",
  "dribbles", "passesAccurate", "passAccuracy", "passesFinalThird", "touches", "duelsWon",
  "tackles", "interceptions", "recoveries", "clearances", "saves",
]);
const snake = (value) => value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const validDay = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// Membership and ranking compare derived numbers at twelve decimals (legacy rule).
export const comparisonNumberSql = (expression) => `round((${expression})::numeric,12)`;

function numberParam(params, name, fallback, { min = -1e6, max = 1e6 } = {}) {
  if (!params.has(name) || params.get(name) === "") return fallback;
  const raw = params.get(name),
    value = Number(raw);
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(value) || value < min || value > max)
    reject(400, `Filtre ${name} invalide.`);
  return value;
}
function option(params, name, values, fallback) {
  const value = params.get(name) || fallback;
  if (!values.includes(value)) reject(400, `Filtre ${name} invalide.`);
  return value;
}

export function parsePlayerRead(params) {
  validateParams(params, [
    "season", "league", "leagues", "generation", "q", "minutes", "pos", "role", "venue", "result",
    "rmin", "from", "to", "stats", "match", "basis", "sort", "direction", "ranking", "page", "limit",
  ]);
  const scope = parseReadScope(params),
    page = readPageArgs(params);
  const q = (params.get("q") || "").trim();
  if (q.length > 100 || /[\u0000-\u001f\u007f]/.test(q)) reject(400, "Recherche invalide.");
  const positions = params.get("pos") ? [...new Set(params.get("pos").split(","))] : [];
  if (positions.some((value) => !["G", "D", "M", "A"].includes(value))) reject(400, "Poste invalide.");
  const from = params.get("from") || "",
    to = params.get("to") || "";
  if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)) reject(400, "Période invalide.");
  const match = params.get("match") || "all";
  if (match !== "all" && !/^m_[A-Za-z0-9]{6}$/.test(match)) reject(400, "Match invalide.");
  const conditions = (params.get("stats") || "")
    .split(",")
    .filter(Boolean)
    .map((condition) => {
      const [key, raw, extra] = condition.split(":");
      if (!conditionKeys.has(key) || extra !== undefined || raw === undefined) reject(400, "Condition invalide.");
      return { key, min: numberParam(new URLSearchParams({ value: raw }), "value", null) };
    });
  if (conditions.length > 3 || conditions.some((condition) => condition.min === null)) reject(400, "Conditions invalides.");
  return {
    scope,
    ...page,
    q,
    positions,
    from,
    to,
    match,
    conditions,
    minutes: numberParam(params, "minutes", 1, { min: 0, max: 150 }),
    rating: numberParam(params, "rmin", null, { min: 0, max: 10 }),
    role: option(params, "role", ["all", "starter", "sub"], "all"),
    venue: option(params, "venue", ["all", "home", "away"], "all"),
    result: option(params, "result", ["all", "win", "draw", "loss"], "all"),
    basis: option(params, "basis", ["total", "perMatch", "per90"], "perMatch"),
    sort: option(params, "sort", ["name", "matches", "minutes", "rating", "finishingDelta", ...metricKeys], "rating"),
    direction: option(params, "direction", ["asc", "desc"], "desc"),
    ranking: option(params, "ranking", ["", "rating", "goals", "assists", "clinical", "wasteful"], ""),
  };
}

// Line of a PitchAPI position id (legacy positionLineSql): AM is the attacking midfield.
export function positionLineSql(value) {
  return `CASE WHEN ${value} IN(0,11) THEN 'G'
    WHEN ${value}=1 OR ${value}>=30 AND ${value}<40 OR ${value} IN(51,59) THEN 'D'
    WHEN ${value}=2 OR ${value}>=50 AND ${value}<80 THEN 'M'
    WHEN ${value}>=80 AND ${value}<90 THEN 'AM'
    WHEN ${value}=3 OR ${value}>=90 AND ${value}<120 THEN 'A' END`;
}

const roleDefinitions = {
  G: { label: "Gardien", group: "G", peers: "gardiens", positionId: 11 },
  D: { label: "Défenseur", group: "D", peers: "défenseurs", positionId: 31 },
  M: { label: "Milieu", group: "M", peers: "milieux", positionId: 61 },
  AM: { label: "Milieu offensif", group: "O", peers: "milieux offensifs et attaquants", positionId: 81 },
  A: { label: "Attaquant", group: "O", peers: "milieux offensifs et attaquants", positionId: 91 },
};
const countProjectionFor = (keys) =>
  keys
    .flatMap((key) => {
      const column = `p.${snake(key)}`,
        valid = finiteSql(column);
      return [
        `sum(${column}) FILTER(WHERE ${valid}) AS "${key}_sum"`,
        `count(*) FILTER(WHERE ${valid})::int AS "${key}_count"`,
        `sum(p.minutes) FILTER(WHERE ${valid}) AS "${key}_minutes"`,
      ];
    })
    .join(",\n");
const countProjection = countProjectionFor(PLAYER_COUNT_METRICS);
const ratioDefinitions = {
  passAccuracy: {
    numerator: "p.passes_accurate",
    denominator: "p.passes_attempted",
    valid: `${finiteSql("p.passes_accurate")} AND ${finiteSql("p.passes_attempted")} AND p.passes_attempted>0`,
  },
  duelRate: {
    numerator: "p.duels_won",
    denominator: "(p.duels_won+p.duels_lost)",
    valid: `${finiteSql("p.duels_won")} AND ${finiteSql("p.duels_lost")} AND p.duels_won+p.duels_lost>0`,
  },
};
const ratioProjectionFor = (keys) =>
  keys
    .flatMap((key) => {
      const ratio = ratioDefinitions[key];
      return [
        `sum(${ratio.numerator}) FILTER(WHERE ${ratio.valid}) AS "${key}_numerator"`,
        `sum(${ratio.denominator}) FILTER(WHERE ${ratio.valid}) AS "${key}_denominator"`,
        `count(*) FILTER(WHERE ${ratio.valid})::int AS "${key}_count"`,
        `sum(p.minutes) FILTER(WHERE ${ratio.valid}) AS "${key}_minutes"`,
      ];
    })
    .join(",\n");
const ratioProjection = ratioProjectionFor(Object.keys(ratioDefinitions));

/** The played-row filters shared by the player reads (scope, generation, match, period, context). */
export function appearanceWhere(filters, params, values, alias = "a") {
  const b = (value) => bindValue(values, value);
  const where = [scopeWhere(alias, filters.scope, values)];
  if (params.has("generation")) where.push(`EXISTS(SELECT 1 FROM publication WHERE generation=${b(params.get("generation"))})`);
  if (filters.match && filters.match !== "all") where.push(`${alias}.match_id=api.internal_id('match',${b(filters.match)})`);
  if (filters.from) where.push(`${alias}.date>=${b(filters.from)}::date`);
  if (filters.to) where.push(`${alias}.date<=${b(filters.to)}::date`);
  if (filters.role && filters.role !== "all") where.push(`${alias}.starter IS ${filters.role === "starter" ? "TRUE" : "FALSE"}`);
  if (filters.venue && filters.venue !== "all") where.push(`${alias}.team_id=${alias}.${filters.venue}_team_id`);
  if (filters.result && filters.result !== "all") {
    const own = `CASE WHEN ${alias}.team_id=${alias}.home_team_id THEN ${alias}.home_score ELSE ${alias}.away_score END`;
    const other = `CASE WHEN ${alias}.team_id=${alias}.home_team_id THEN ${alias}.away_score ELSE ${alias}.home_score END`;
    where.push(
      `${alias}.team_id IN(${alias}.home_team_id,${alias}.away_team_id)`,
      `(${own}) IS NOT NULL`,
      `(${other}) IS NOT NULL`,
      `(${own})${{ win: ">", loss: "<", draw: "=" }[filters.result]}(${other})`,
    );
  }
  return where.join(" AND ");
}

export function playerReadQuery(filters, params) {
  const values = [],
    publication = publicationSql(filters.scope, values);
  const b = (value) => bindValue(values, value);
  const where = appearanceWhere(filters, params, values);
  const metricValue = (key) => {
    if (Object.hasOwn(ratioDefinitions, key)) return `100.0*a."${key}_numerator"/nullif(a."${key}_denominator",0)`;
    return filters.basis === "total"
      ? `a."${key}_sum"`
      : filters.basis === "per90"
        ? `90.0*a."${key}_sum"/nullif(a."${key}_minutes",0)`
        : `a."${key}_sum"/nullif(a."${key}_count",0)`;
  };
  // Eligibility and ordering aggregate only the metrics they need; the page's
  // players get their complete profile after LIMIT, from the same played rows.
  const requiredMetrics = new Set(filters.conditions.map(({ key }) => key));
  const rankingMetrics = { rating: [], goals: ["goals", "xg"], assists: ["assists", "xa"], clinical: ["goals", "xg"], wasteful: ["goals", "xg"] };
  const finishingRequired = filters.ranking ? ["clinical", "wasteful"].includes(filters.ranking) : filters.sort === "finishingDelta";
  for (const key of filters.ranking
    ? rankingMetrics[filters.ranking]
    : finishingRequired
      ? ["goals", "xg"]
      : metricKeys.includes(filters.sort)
        ? [filters.sort]
        : [])
    requiredMetrics.add(key);
  const earlyCounts = PLAYER_COUNT_METRICS.filter((key) => requiredMetrics.has(key));
  const earlyRatios = Object.keys(ratioDefinitions).filter((key) => requiredMetrics.has(key));
  const sourceMetrics = new Set(earlyCounts);
  if (requiredMetrics.has("passAccuracy")) sourceMetrics.add("passesAccurate").add("passesAttempted");
  if (requiredMetrics.has("duelRate")) sourceMetrics.add("duelsWon").add("duelsLost");
  const earlyAggregates = [countProjectionFor(earlyCounts), ratioProjectionFor(earlyRatios)].filter(Boolean).join(",\n");
  const earlyProfile = [
    ...earlyCounts.flatMap((key) => ["sum", "count", "minutes"].map((suffix) => `a."${key}_${suffix}"`)),
    ...earlyRatios.flatMap((key) => ["numerator", "denominator", "count", "minutes"].map((suffix) => `a."${key}_${suffix}"`)),
    ...metricKeys.filter((key) => requiredMetrics.has(key)).map((key) => `${metricValue(key)} AS "${key}"`),
    ...(finishingRequired ? [`(${metricValue("goals")})-(${metricValue("xg")}) AS "finishingDelta"`] : []),
  ].join(",\n");
  const averageMetrics = metricKeys.map((key) => `${metricValue(key)} AS "${key}"`).join(",\n");
  const thresholds = ["true"];
  if (filters.minutes) thresholds.push(`${comparisonNumberSql("d.minutes")}>=${comparisonNumberSql(b(filters.minutes))}`);
  if (filters.rating !== null) thresholds.push(`${comparisonNumberSql("d.rating")}>=${comparisonNumberSql(b(filters.rating))}`);
  if (filters.positions.length)
    thresholds.push(`CASE WHEN d.role_code IN('AM','M') THEN 'M' ELSE d.role_code END=ANY(${b(filters.positions)}::text[])`);
  for (const { key, min } of filters.conditions)
    thresholds.push(`${comparisonNumberSql(`d."${key}"`)}>=${comparisonNumberSql(b(min))}`);
  if (filters.q)
    thresholds.push(
      `${normalizedSql("concat_ws(' ',d.name,array_to_string(d.teams,' · '),array_to_string(d.leagues,' · '),d.search_aliases)")} LIKE ${b(`%${likeText(filters.q)}%`)}`,
    );
  const ranking = {
    rating: {
      eligible: `d.rating_count>=${MIN_RATED_MATCHES}`,
      order: `${comparisonNumberSql("d.rating")} DESC NULLS LAST,d.rating_count DESC`,
    },
    goals: {
      eligible: `d."goals_count">0 AND ${comparisonNumberSql('d."goals_sum"')}>0`,
      order: `${comparisonNumberSql("d.goals")} DESC,${comparisonNumberSql("coalesce(d.xg,0)")} DESC`,
    },
    assists: {
      eligible: `d."assists_count">0 AND ${comparisonNumberSql('d."assists_sum"')}>0`,
      order: `${comparisonNumberSql("d.assists")} DESC,${comparisonNumberSql("coalesce(d.xa,0)")} DESC`,
    },
    clinical: { eligible: `${comparisonNumberSql('d."goals_sum"')}>=4 AND d."xg_count">0`, order: `${comparisonNumberSql('d."finishingDelta"')} DESC` },
    wasteful: { eligible: `${comparisonNumberSql('d."xg_sum"')}>=3 AND d."goals_count">0`, order: `${comparisonNumberSql('d."finishingDelta"')} ASC` },
  }[filters.ranking];
  if (ranking) thresholds.push(ranking.eligible);
  const names = `${normalizedSql("d.name")} ASC,d.name COLLATE "C" ASC,d.player_id ASC`;
  const order = ranking
    ? `${ranking.order},${names}`
    : filters.sort === "name"
      ? `${normalizedSql("d.name")} ${filters.direction},d.name COLLATE "C" ${filters.direction},d.player_id ASC`
      : `${filters.sort === "matches" ? 'd."matches"' : comparisonNumberSql(`d."${filters.sort}"`)} ${filters.direction} NULLS LAST,${names}`;
  const limit = b(filters.limit),
    offset = b(filters.offset);
  const identityColumns = `s.player_id,s.player_name AS name,s.image_url,s.match_id,s.date,s.team,s.team_id,s.league_id,s.league,s.position_number`;
  const identityJson = (alias) =>
    `CASE WHEN ${alias}.player_id IS NULL THEN NULL ELSE jsonb_build_object('id',api.public_id('match',${alias}.match_id)||':'||p.player_id,
     'name',${alias}.name,'image_url',${alias}.image_url,'date',${alias}.date,'team',${alias}.team,
     'team_id',api.public_id('team',${alias}.team_id),'league_id',${alias}.league_id,'league',${alias}.league,
     'position_number',${alias}.position_number) END`;
  const sql = `/*vega:v2:players*/
WITH publication AS MATERIALIZED (${publication}),
source AS MATERIALIZED (
 SELECT a.season_id,a.match_id,a.player_id,a.player_name,a.image_url,a.team_id,a.team,a.league_id,a.league,a.date,
 a.minutes,a.rating,a.starter,a.position_number,${[...sourceMetrics].map((key) => `a.${snake(key)},`).join("")}
 row_number() OVER(ORDER BY a.league_id,a.date NULLS LAST,a.kickoff_at NULLS LAST,a.match_id,a.player_id) source_order
 FROM api.player_appearances a WHERE ${where}
), identities AS (
 SELECT ${identityColumns} FROM (SELECT DISTINCT ON(player_id) * FROM source ORDER BY player_id,date DESC NULLS LAST,source_order) s
), played AS MATERIALIZED (
 SELECT s.*,${positionLineSql("s.position_number")} role_code FROM source s WHERE s.minutes>0
), latest AS (
 SELECT ${identityColumns} FROM (SELECT DISTINCT ON(player_id) * FROM played ORDER BY player_id,date DESC NULLS LAST,source_order) s
), unknown AS (
 SELECT s.player_id,count(DISTINCT s.match_id)::int amount FROM source s WHERE s.minutes IS NULL GROUP BY s.player_id
), leagues AS (
 SELECT player_id,array_agg(league ORDER BY first_order) names FROM (
   SELECT player_id,league,min(source_order) first_order FROM source WHERE league IS NOT NULL AND league<>'' GROUP BY player_id,league
 ) l GROUP BY player_id
), teams AS (
 SELECT player_id,array_agg(team ORDER BY first_order) names FROM (
   SELECT player_id,team,min(source_order) first_order FROM played WHERE team IS NOT NULL AND team<>'' GROUP BY player_id,team
 ) t GROUP BY player_id
), position_totals AS (
 SELECT player_id,role_code,CASE WHEN role_code IN('AM','A') THEN 'O' ELSE role_code END role_group,
 sum(minutes) minutes,min(source_order) first_order FROM played WHERE role_code IS NOT NULL GROUP BY player_id,role_code
), group_totals AS (
 SELECT player_id,role_group,sum(minutes) minutes,min(first_order) first_order FROM position_totals GROUP BY player_id,role_group
), main_group AS (
 SELECT DISTINCT ON(player_id) * FROM group_totals ORDER BY player_id,minutes DESC,first_order
), main_role AS (
 SELECT DISTINCT ON(p.player_id) p.player_id,p.role_code FROM position_totals p JOIN main_group g USING(player_id,role_group)
 ORDER BY p.player_id,p.minutes DESC,p.first_order
), aggregates AS (
 SELECT p.player_id,count(*)::int matches,sum(p.minutes) total_minutes,
 count(*) FILTER(WHERE p.starter IS TRUE)::int starts,count(*) FILTER(WHERE p.starter IS NOT NULL)::int known_starts,
 avg(p.rating) FILTER(WHERE ${finiteSql("p.rating")}) rating,count(*) FILTER(WHERE ${finiteSql("p.rating")})::int rating_count,
 array_agg(DISTINCT p.team_id) FILTER(WHERE p.team_id IS NOT NULL) internal_team_ids,
 array_agg(DISTINCT p.league_id) FILTER(WHERE p.league_id IS NOT NULL) league_ids${earlyAggregates ? `,\n${earlyAggregates}` : ""}
 FROM played p GROUP BY p.player_id
), averages AS (
 SELECT i.player_id internal_id,api.public_id('player',i.player_id) player_id,
 coalesce(nullif(l.name,''),nullif(i.name,''),'Joueur') name,coalesce(l.image_url,i.image_url) image_url,
 coalesce(t.names,CASE WHEN i.team IS NOT NULL AND i.team<>'' THEN ARRAY[i.team] ELSE '{}'::text[] END) teams,
 coalesce(le.names,'{}'::text[]) leagues,coalesce(r.role_code,${positionLineSql("i.position_number")}) role_code,
 coalesce(a.matches,0) matches,CASE WHEN a.matches>0 THEN a.total_minutes/a.matches WHEN u.amount>0 THEN NULL ELSE 0 END minutes,
 coalesce(a.total_minutes,0) total_minutes,coalesce(a.starts,0) starts,coalesce(a.known_starts,0) known_starts,
 coalesce(u.amount,0) unknown_minutes,a.rating,coalesce(a.rating_count,0) rating_count,
 coalesce(a.internal_team_ids,'{}'::int[]) internal_team_ids,coalesce(a.league_ids,'{}'::text[]) league_ids,
 al.search_aliases${earlyProfile ? `,\n${earlyProfile}` : ""}
 FROM identities i LEFT JOIN aggregates a USING(player_id) LEFT JOIN latest l USING(player_id)
 LEFT JOIN unknown u USING(player_id) LEFT JOIN teams t USING(player_id) LEFT JOIN leagues le USING(player_id)
 LEFT JOIN main_role r USING(player_id) LEFT JOIN api.player_search_aliases al ON al.player_id=i.player_id
), filtered AS MATERIALIZED (SELECT d.* FROM averages d WHERE ${thresholds.join(" AND ")}),
page AS MATERIALIZED (SELECT d.*,row_number() OVER(ORDER BY ${order}) result_order FROM filtered d ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}),
page_metrics AS (
 SELECT p.player_id,${countProjection},${ratioProjection}
 FROM api.player_appearances p
 JOIN played k ON k.season_id=p.season_id AND k.match_id=p.match_id AND k.player_id=p.player_id
 WHERE ${scopeWhere("p", filters.scope, values)} AND p.player_id IN(SELECT internal_id FROM page)
 GROUP BY p.player_id
), page_records AS (
 SELECT p.result_order,(to_jsonb(p)-'result_order'-'internal_id'-'internal_team_ids')
   ||jsonb_build_object('team_ids',coalesce((SELECT jsonb_agg(api.public_id('team',x) ORDER BY api.public_id('team',x)) FROM unnest(p.internal_team_ids) x),'[]'::jsonb),
     'identity',(SELECT ${identityJson("i")} FROM identities i WHERE i.player_id=p.internal_id),
     'latest',(SELECT ${identityJson("l")} FROM latest l WHERE l.player_id=p.internal_id))
   ||coalesce(to_jsonb(a)-'player_id','{}'::jsonb)||to_jsonb(v) AS record
 FROM page p LEFT JOIN page_metrics a ON a.player_id=p.internal_id
 CROSS JOIN LATERAL (SELECT ${averageMetrics},(${metricValue("goals")})-(${metricValue("xg")}) AS "finishingDelta") v
)
SELECT publication.*,(SELECT count(*)::int FROM filtered) total,
 coalesce((SELECT jsonb_agg(p.record ORDER BY p.result_order) FROM page_records p),'[]'::jsonb) players,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.public_id,'name',t.name,'imageUrl',t.image_url) ORDER BY t.public_id)
   FROM api.team_keys t WHERE t.team_id IN(SELECT unnest(internal_team_ids) FROM page)),'[]'::jsonb) teams
FROM publication`;
  return { sql, values };
}

const identity = (row, playerId) =>
  row
    ? {
        id: row.id,
        playerId,
        name: row.name,
        imageUrl: row.image_url,
        date: row.date,
        team: row.team,
        teamId: row.team_id,
        leagueId: row.league_id,
        league: row.league,
        positionId: row.position_number,
      }
    : null;

export function playerReadRecord(row) {
  const role = roleDefinitions[row.role_code] || null;
  const stats = {},
    ratios = {};
  for (const key of PLAYER_COUNT_METRICS)
    if (Number(row[`${key}_count`]) > 0)
      stats[key] = { sum: row[`${key}_sum`], count: Number(row[`${key}_count`]), minutes: row[`${key}_minutes`] };
  for (const key of Object.keys(ratioDefinitions))
    if (Number(row[`${key}_count`]) > 0)
      ratios[key] = {
        numerator: row[`${key}_numerator`],
        denominator: row[`${key}_denominator`],
        count: Number(row[`${key}_count`]),
        minutes: row[`${key}_minutes`],
      };
  const profile = {
    id: row.player_id,
    name: row.name,
    imageUrl: row.image_url,
    role,
    teams: row.teams,
    teamIds: row.team_ids,
    leagueIds: row.league_ids,
    leagues: row.leagues,
    matches: Number(row.matches),
    minutes: row.total_minutes,
    unknownMinutes: Number(row.unknown_minutes),
    starts: Number(row.starts),
    knownStarts: Number(row.known_starts),
    rating: row.rating,
    ratingCount: Number(row.rating_count),
    stats,
    ratios,
    identity: identity(row.identity, row.player_id),
    latest: identity(row.latest, row.player_id),
    rows: [],
  };
  return {
    id: row.player_id,
    playerId: row.player_id,
    name: row.name,
    imageUrl: row.image_url,
    team: row.teams.join(" · "),
    league: row.leagues.join(" · "),
    position: role?.label || "—",
    positionId: role?.positionId ?? null,
    matches: profile.matches,
    minutes: row.minutes,
    rating: row.rating,
    ...Object.fromEntries(metricKeys.map((key) => [key, row[key] ?? null])),
    finishingDelta: row.finishingDelta,
    totals: { goals: stats.goals?.sum ?? null, assists: stats.assists?.sum ?? null, xg: stats.xg?.sum ?? null },
    profile,
  };
}

export function createPlayerReadRoute(read) {
  return async (req, path, params) => {
    if (path !== "/api/read/players") return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    const filters = parsePlayerRead(params);
    const validated = await readValidator(req, params, filters.scope, read);
    if (validated) return validated;
    const { sql, values } = playerReadQuery(filters, params);
    const [snapshot] = await read(sql, values);
    const total = Number(snapshot?.total || 0);
    const players = (snapshot?.players || []).map(playerReadRecord);
    // Each player's power ranking of the season (rankings.mjs).
    const power = await powerOf(read, "players", filters.scope.season, players.map((p) => p.id));
    for (const p of players) p.power = power.get(p.id) ?? null;
    return readResponse(
      req,
      params,
      snapshot,
      { players, teams: snapshot?.teams || [] },
      {
        pagination: { page: filters.page, limit: filters.limit, total, pages: Math.max(1, Math.ceil(total / filters.limit)) },
        maxBytes: 1024 * 1024,
      },
    );
  };
}
