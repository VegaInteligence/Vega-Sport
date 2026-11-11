/**
 * GET /api/read/players — player directory and rankings, same parameters and same
 * response as the previous backend's relational-players.js on main. Added here:
 * each player record has `power`, its power ranking of the season read
 * (api.power_players), or null.
 *
 * Two reads give the same response:
 * - the season's rows per player and edition (api.player_list_editions, _teams,
 *   _positions: the calculator keeps them), when the request filters no appearance. It
 *   is the list as the site opens it: a season's players are ranked without reading
 *   each of their appearances;
 * - the appearances themselves (api.player_appearances), when a match, a period, a
 *   role, a venue or a result is asked: only they know which matches count.
 * The scope is bound by ids in both (season id, edition ids), so the season's
 * partitions and the editions are known when the statement is planned.
 *
 * Differences with the legacy read, by construction (listed for the parity
 * comparison):
 * - one row per player and match by key, so there is no duplicate appearance to drop;
 * - `profile.identity.id` and `profile.latest.id` are `<match id>:<player id>` (the base has
 *   no appearance rows of its own);
 * - search aliases come from the curated names (core.entity_names, kind alias);
 * - the rows of a player are in league, date, kick-off and match order (legacy: the
 *   order of the published partition files).
 */
import { createHash } from "node:crypto";
import { matchesEtag, reject, send, validateParams } from "../http.mjs";
import { powerOf } from "./rankings.mjs";
import {
  bindValue,
  finiteSql,
  idScopeWhere,
  likeText,
  normalizedSql,
  parseReadScope,
  publicationSql,
  readPageArgs,
  readResponse,
  readValidator,
  resolveEditions,
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

/**
 * `group`: the role groups a player's profile is compared in (roleDefinitions: G, D, M,
 * and O for the attacking midfielders and the forwards). `pos` reads lines, and its M
 * holds the attacking midfielders: a forward's group was asked as `pos=M,A`, 3,081
 * players of the Top 7 and UEFA cups on 11 November 2026 of which the page kept the O.
 */
const ROLE_GROUPS = ["G", "D", "M", "O"];

/**
 * `whole=1`: the selection in pages of this many players, where a page holds 100 at most.
 * A player's profile compares him with his whole position group: 1,988 midfielders of
 * the Top 7 and UEFA cups on 11 November 2026. The statement works the whole selection
 * out before it keeps a page, so twenty pages cost it twenty times (0.15 to 0.4 s each
 * on the base), against 0.8 s for them all at once.
 */
export const WHOLE_PAGE = 3000;

export function parsePlayerRead(params) {
  validateParams(params, [
    "season", "league", "leagues", "generation", "q", "minutes", "pos", "role", "venue", "result",
    "rmin", "from", "to", "stats", "match", "basis", "sort", "direction", "ranking", "page", "limit", "whole", "group",
    "detail", "v",
  ]);
  const detail = params.get("detail");
  if (detail !== null && detail !== "profile") reject(400, "Détail invalide.");
  // A selection of profiles is fenced by its own version (`v`), never by the publication.
  const pin = params.get("v");
  if ((pin !== null && (!detail || !/^[a-f0-9]{16}$/.test(pin))) || (detail && params.has("generation")))
    reject(400, "Publication invalide.");
  const whole = params.get("whole");
  if (whole !== null && whole !== "1") reject(400, "Pagination invalide.");
  const scope = parseReadScope(params),
    page = readPageArgs(params);
  if (whole) {
    page.limit = WHOLE_PAGE;
    page.offset = (page.page - 1) * WHOLE_PAGE;
  }
  const q = (params.get("q") || "").trim();
  if (q.length > 100 || /[\u0000-\u001f\u007f]/.test(q)) reject(400, "Recherche invalide.");
  const positions = params.get("pos") ? [...new Set(params.get("pos").split(","))] : [];
  if (positions.some((value) => !["G", "D", "M", "A"].includes(value))) reject(400, "Poste invalide.");
  const groups = params.get("group") ? [...new Set(params.get("group").split(","))] : [];
  if (groups.some((value) => !ROLE_GROUPS.includes(value))) reject(400, "Poste invalide.");
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
    whole: Boolean(whole),
    profiles: Boolean(detail),
    pin,
    q,
    positions,
    groups,
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

// The same sums read from the season's rows (api.player_list_editions): one row per
// player and edition, already restricted to the played matches and the finite values.
const rollupCounts = (keys) =>
  keys
    .flatMap((key) => {
      const column = `r.${snake(key)}`;
      return [
        `sum(${column}_sum)::float8 AS "${key}_sum"`,
        `sum(${column}_count)::int AS "${key}_count"`,
        `sum(${column}_minutes)::float8 AS "${key}_minutes"`,
      ];
    })
    .join(",\n");
const rollupRatios = (keys) =>
  keys
    .flatMap((key) => {
      const column = `r.${snake(key)}`;
      return [
        `sum(${column}_numerator)::float8 AS "${key}_numerator"`,
        `sum(${column}_denominator)::float8 AS "${key}_denominator"`,
        `sum(${column}_count)::int AS "${key}_count"`,
        `sum(${column}_minutes)::float8 AS "${key}_minutes"`,
      ];
    })
    .join(",\n");

/**
 * A page's player as the statements give him: four parts side by side, his row of the
 * page (p), the details read for the page (x), his sums (a) and his averages (v), put
 * together by playerReadRecord. They were merged in the statement (jsonb, a new document
 * at each merge): 0.51 s of the 0.84 s a position group of 1,988 players took on the
 * base on 11 November 2026.
 */
const recordSql = (details, averages) => `json_build_object('p',to_json(p),'x',${details},'a',to_json(a)${averages ? ",'v',to_json(v)" : ""})`;

/**
 * The appearance filters of a players read (scope, generation, match, period, context).
 * editions is the scope resolved to ids (resolveEditions).
 */
export function appearanceWhere(filters, params, values, editions, alias = "a") {
  const b = (value) => bindValue(values, value);
  const where = [idScopeWhere(alias, filters.scope, editions, values)];
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

/**
 * What a players read selects, whichever rows it reads: the metrics that eligibility
 * and ordering need for every player (the others are computed for the page only), the
 * thresholds, the order and the page. Both statements name their per-player sums `a`
 * ("<key>_sum", "_count", "_minutes"; a ratio's "_numerator", "_denominator") and the
 * player's row `d`; nameSort is the folded name the order compares.
 */
function playerSelection(filters, values, nameSort) {
  const b = (value) => bindValue(values, value);
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
  if (filters.groups.length)
    thresholds.push(`CASE WHEN d.role_code IN('AM','A') THEN 'O' ELSE d.role_code END=ANY(${b(filters.groups)}::text[])`);
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
  const names = `${nameSort} ASC,d.name COLLATE "C" ASC,d.player_id ASC`;
  const order = ranking
    ? `${ranking.order},${names}`
    : filters.sort === "name"
      ? `${nameSort} ${filters.direction},d.name COLLATE "C" ${filters.direction},d.player_id ASC`
      : `${filters.sort === "matches" ? 'd."matches"' : comparisonNumberSql(`d."${filters.sort}"`)} ${filters.direction} NULLS LAST,${names}`;
  return {
    metricValue,
    earlyCounts,
    earlyRatios,
    sourceMetrics,
    earlyProfile,
    // The page's averages on the asked basis: a profile carries the sums, not them.
    averages: filters.profiles
      ? ""
      : `\n CROSS JOIN LATERAL (SELECT ${averageMetrics},(${metricValue("goals")})-(${metricValue("xg")}) AS "finishingDelta") v`,
    thresholds: thresholds.join(" AND "),
    order,
    limit: b(filters.limit),
    offset: b(filters.offset),
  };
}

/** The read on the appearances: any filter. editions is the scope resolved to ids. */
export function playerReadQuery(filters, params, editions) {
  const values = [],
    publication = publicationSql(filters.scope, values);
  const where = appearanceWhere(filters, params, values, editions);
  const { earlyCounts, earlyRatios, sourceMetrics, earlyProfile, averages, thresholds, order, limit, offset } = playerSelection(
    filters,
    values,
    normalizedSql("d.name"),
  );
  const earlyAggregates = [countProjectionFor(earlyCounts), ratioProjectionFor(earlyRatios)].filter(Boolean).join(",\n");
  const identityColumns = `s.player_id,s.player_name AS name,s.image_url,s.match_id,s.date,s.team,s.team_id,s.league_id,s.league,s.position_number`;
  const identityJson = (alias) =>
    `CASE WHEN ${alias}.player_id IS NULL THEN NULL ELSE json_build_object('id',api.public_id('match',${alias}.match_id)||':'||p.player_id,
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
), filtered AS MATERIALIZED (SELECT d.* FROM averages d WHERE ${thresholds}),
page AS MATERIALIZED (SELECT d.*,row_number() OVER(ORDER BY ${order}) result_order FROM filtered d ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}),
page_metrics AS (
 SELECT p.player_id,${countProjection},${ratioProjection}
 FROM api.player_appearances p
 -- The played rows of the page's players: the same filters as source, minutes > 0
 -- (re-applied rather than joined to the played CTE; the page's players are given as
 -- one array, an index condition on the player).
 WHERE ${appearanceWhere(filters, params, values, editions, "p")} AND p.minutes>0 AND p.player_id=ANY(ARRAY(SELECT internal_id FROM page))
 GROUP BY p.player_id
), page_records AS (
 SELECT p.result_order,${recordSql(`json_build_object(
     'team_ids',coalesce((SELECT jsonb_agg(api.public_id('team',x) ORDER BY api.public_id('team',x)) FROM unnest(p.internal_team_ids) x),'[]'::jsonb),
     'identity',(SELECT ${identityJson("i")} FROM identities i WHERE i.player_id=p.internal_id),
     'latest',(SELECT ${identityJson("l")} FROM latest l WHERE l.player_id=p.internal_id))`, averages)} AS record
 FROM page p LEFT JOIN page_metrics a ON a.player_id=p.internal_id${averages}
)
SELECT publication.*,(SELECT count(*)::int FROM filtered) total,
 coalesce((SELECT json_agg(p.record ORDER BY p.result_order) FROM page_records p),'[]'::json) players,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.public_id,'name',t.name,'imageUrl',t.image_url) ORDER BY t.public_id)
   FROM api.team_keys t WHERE t.team_id IN(SELECT unnest(internal_team_ids) FROM page)),'[]'::jsonb) teams
FROM publication`;
  return { sql, values };
}

/** A request the season's rows answer: no filter on which appearances count. */
export const supportsPlayerRollup = (filters) =>
  filters.match === "all" && !filters.from && !filters.to && filters.role === "all" && filters.venue === "all" && filters.result === "all";

/**
 * The read on the season's rows (one per player and edition, kept by the calculator):
 * the same response as playerReadQuery for a request that filters no appearance.
 *
 * Every player of the scope gets only what the thresholds and the order need: his
 * sums, his name, and his role or his clubs and leagues when a position or a text is
 * asked. The rest (identity, latest match, clubs, leagues, role, every metric) is read
 * after LIMIT, for the page's players alone.
 *
 * The appearance read orders a player's rows by league, date, kick-off and match. The
 * season's rows keep that order inside an edition (first_order, the identity and latest
 * rows); across editions the league id decides, as there: a league has one edition in
 * a season.
 */
export function playerRollupQuery(filters, params, editions) {
  const values = [],
    publication = publicationSql(filters.scope, values);
  const scope = (alias) => idScopeWhere(alias, filters.scope, editions, values);
  const { earlyCounts, earlyRatios, earlyProfile, averages, thresholds, order, limit, offset } = playerSelection(
    filters,
    values,
    "d.sort_name",
  );
  const generation = params.has("generation")
    ? ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${bindValue(values, params.get("generation"))})`
    : "";
  const earlyAggregates = [rollupCounts(earlyCounts), rollupRatios(earlyRatios)].filter(Boolean).join(",\n");
  // What the thresholds read beyond the sums; everything else waits for the page.
  const needsRole = filters.positions.length > 0 || filters.groups.length > 0,
    needsText = Boolean(filters.q);
  const paged = (alias, early) => (early ? "" : ` AND ${alias}.player_id=ANY(ARRAY(SELECT internal_id FROM page))`);
  const edition = (alias) => `JOIN editions e ON e.competition_season_id=${alias}.competition_season_id`;
  // The most recent row of the player (prefix identity), or the most recent played one
  // (prefix latest, where he played): one candidate per edition, the first is kept.
  const recent = (name, prefix, early) => `${name} AS (
 SELECT DISTINCT ON(r.player_id) r.player_id,r.${prefix}_match_id match_id,r.${prefix}_date date,r.${prefix}_team_id team_id,
 e.league_id,e.league,r.${prefix}_position position_number
 FROM api.player_list_editions r ${edition("r")}
 WHERE ${scope("r")}${prefix === "latest" ? " AND r.matches>0" : ""}${paged("r", early)}
 ORDER BY r.player_id,r.${prefix}_date DESC NULLS LAST,e.league_id,r.${prefix}_kickoff NULLS LAST,r.${prefix}_match_id
)`;
  const teamNames = (early) => `team_names AS (
 SELECT player_id,array_agg(name ORDER BY first_rank) names FROM (
   SELECT x.player_id,t.name,min(x.rank) first_rank FROM (
     SELECT r.player_id,r.team_id,row_number() OVER(PARTITION BY r.player_id ORDER BY e.league_id,r.first_order) rank
     FROM api.player_list_teams r ${edition("r")} WHERE ${scope("r")}${paged("r", early)}
   ) x JOIN api.team_keys t ON t.team_id=x.team_id WHERE t.name<>'' GROUP BY x.player_id,t.name
 ) n GROUP BY player_id
)`;
  const leagueNames = (early) => `league_names AS (
 SELECT player_id,array_agg(league ORDER BY first_league) names FROM (
   SELECT r.player_id,e.league,min(e.league_id) first_league FROM api.player_list_editions r ${edition("r")}
   WHERE ${scope("r")}${paged("r", early)} AND e.league<>'' GROUP BY r.player_id,e.league
 ) l GROUP BY player_id
)`;
  const roles = (early) => `position_totals AS (
 SELECT player_id,role_code,CASE WHEN role_code IN('AM','A') THEN 'O' ELSE role_code END role_group,
 sum(minutes) minutes,min(rank) first_order FROM (
   SELECT r.player_id,${positionLineSql("r.position_number")} role_code,r.minutes,
   row_number() OVER(PARTITION BY r.player_id ORDER BY e.league_id,r.first_order) rank
   FROM api.player_list_positions r ${edition("r")} WHERE ${scope("r")}${paged("r", early)}
 ) x WHERE role_code IS NOT NULL GROUP BY player_id,role_code
), group_totals AS (
 SELECT player_id,role_group,sum(minutes) minutes,min(first_order) first_order FROM position_totals GROUP BY player_id,role_group
), main_group AS (
 SELECT DISTINCT ON(player_id) * FROM group_totals ORDER BY player_id,minutes DESC,first_order
), main_role AS (
 SELECT DISTINCT ON(p.player_id) p.player_id,p.role_code FROM position_totals p JOIN main_group g USING(player_id,role_group)
 ORDER BY p.player_id,p.minutes DESC,p.first_order
)`;
  // Each detail is read once: before the thresholds for every player when they need
  // it, after LIMIT for the page's players otherwise.
  const details = [
    [needsRole || needsText, (early) => recent("identities", "identity", early)],
    [needsRole, roles],
    [needsText, teamNames],
    [needsText, leagueNames],
  ];
  const detailSql = (early) =>
    details
      .filter(([needed]) => needed === early)
      .map(([, build]) => `${build(early)},\n`)
      .join("");
  const roleSql = `coalesce(mr.role_code,${positionLineSql("i.position_number")})`;
  const teamsSql = `coalesce(t.names,CASE WHEN it.name IS NOT NULL AND it.name<>'' THEN ARRAY[it.name] ELSE '{}'::text[] END)`;
  const leaguesSql = `coalesce(le.names,'{}'::text[])`;
  const identityJson = (alias, team) =>
    `CASE WHEN ${alias}.player_id IS NULL THEN NULL ELSE json_build_object('id',api.public_id('match',${alias}.match_id)||':'||p.player_id,
     'name',k.name,'image_url',k.image_url,'date',${alias}.date,'team',${team}.name,'team_id',${team}.public_id,
     'league_id',${alias}.league_id,'league',${alias}.league,'position_number',${alias}.position_number) END`;
  const sql = `/*vega:v2:players:rollup*/
WITH publication AS MATERIALIZED (${publication}),
editions AS MATERIALIZED (
 SELECT e.competition_season_id,e.league_id,e.league FROM api.edition_keys e WHERE ${scope("e")}
), aggregates AS (
 SELECT r.player_id,sum(r.matches)::int matches,sum(r.total_minutes)::float8 total_minutes,
 sum(r.unknown_matches)::int unknown_minutes,sum(r.starts)::int starts,sum(r.known_starts)::int known_starts,
 sum(r.rating_sum)/nullif(sum(r.rating_count),0) rating,sum(r.rating_count)::int rating_count${earlyAggregates ? `,\n${earlyAggregates}` : ""}
 FROM api.player_list_editions r WHERE ${scope("r")}${generation}
 GROUP BY r.player_id
),
${detailSql(true)}averages AS (
 SELECT a.player_id internal_id,k.public_id player_id,coalesce(nullif(k.name,''),'Joueur') name,
 -- The stored folded name (the folding of normalizedSql); 'Joueur' folds to 'joueur'.
 CASE WHEN k.name IS NULL OR k.name='' THEN 'joueur' ELSE k.search_name END sort_name,
 a.matches,CASE WHEN a.matches>0 THEN a.total_minutes/a.matches WHEN a.unknown_minutes>0 THEN NULL ELSE 0 END minutes,
 a.total_minutes,a.starts,a.known_starts,a.unknown_minutes,a.rating,a.rating_count${needsRole ? `,\n ${roleSql} role_code` : ""}${
   needsText ? `,\n ${teamsSql} teams,${leaguesSql} leagues,al.search_aliases` : ""
 }${earlyProfile ? `,\n${earlyProfile}` : ""}
 FROM aggregates a JOIN api.player_keys k ON k.player_id=a.player_id${
   needsRole || needsText ? "\n LEFT JOIN identities i ON i.player_id=a.player_id" : ""
 }${needsRole ? "\n LEFT JOIN main_role mr ON mr.player_id=a.player_id" : ""}${
   needsText
     ? `\n LEFT JOIN api.team_keys it ON it.team_id=i.team_id LEFT JOIN team_names t ON t.player_id=a.player_id
 LEFT JOIN league_names le ON le.player_id=a.player_id LEFT JOIN api.player_search_aliases al ON al.player_id=a.player_id`
     : ""
 }
), filtered AS MATERIALIZED (SELECT d.* FROM averages d WHERE ${thresholds}),
page AS MATERIALIZED (SELECT d.*,row_number() OVER(ORDER BY ${order}) result_order FROM filtered d ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}),
${detailSql(false)}${recent("latest", "latest", false)},
team_ids AS (
 SELECT r.player_id,array_agg(DISTINCT r.team_id) ids FROM api.player_list_teams r WHERE ${scope("r")}${paged("r", false)} GROUP BY r.player_id
), league_ids AS (
 SELECT r.player_id,array_agg(DISTINCT e.league_id) ids FROM api.player_list_editions r ${edition("r")}
 WHERE ${scope("r")} AND r.matches>0${paged("r", false)} GROUP BY r.player_id
), page_metrics AS (
 SELECT r.player_id,${rollupCounts(PLAYER_COUNT_METRICS)},${rollupRatios(Object.keys(ratioDefinitions))}
 FROM api.player_list_editions r WHERE ${scope("r")}${paged("r", false)} GROUP BY r.player_id
), page_records AS (
 SELECT p.result_order,${recordSql(`json_build_object('image_url',k.image_url,'teams',${teamsSql},'leagues',${leaguesSql},'role_code',${roleSql},
     'league_ids',coalesce(li.ids,'{}'::text[]),
     'team_ids',coalesce((SELECT jsonb_agg(x.public_id ORDER BY x.public_id) FROM api.team_keys x WHERE x.team_id=ANY(ti.ids)),'[]'::jsonb),
     'identity',${identityJson("i", "it")},'latest',${identityJson("l", "lt")})`, averages)} AS record
 FROM page p JOIN api.player_keys k ON k.player_id=p.internal_id
 LEFT JOIN identities i ON i.player_id=p.internal_id LEFT JOIN api.team_keys it ON it.team_id=i.team_id
 LEFT JOIN latest l ON l.player_id=p.internal_id LEFT JOIN api.team_keys lt ON lt.team_id=l.team_id
 LEFT JOIN team_names t ON t.player_id=p.internal_id LEFT JOIN league_names le ON le.player_id=p.internal_id
 LEFT JOIN main_role mr ON mr.player_id=p.internal_id LEFT JOIN team_ids ti ON ti.player_id=p.internal_id
 LEFT JOIN league_ids li ON li.player_id=p.internal_id LEFT JOIN page_metrics a ON a.player_id=p.internal_id${averages}
)
SELECT publication.*,(SELECT count(*)::int FROM filtered) total,
 coalesce((SELECT json_agg(p.record ORDER BY p.result_order) FROM page_records p),'[]'::json) players,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.public_id,'name',t.name,'imageUrl',t.image_url) ORDER BY t.public_id)
   FROM api.team_keys t WHERE t.team_id IN(SELECT unnest(ids) FROM team_ids)),'[]'::jsonb) teams
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

/** A player's row, from the parts of recordSql: the later part decides, and his sums
 * are keyed by his internal id, which the response does not carry. */
function playerRow({ p, x, a, v }) {
  const { player_id: _, ...sums } = a || {};
  return { ...p, ...x, ...sums, ...v };
}

/** A player's profile of the selection: what the site's scouting reads (season-player.js). */
function playerProfile(row) {
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
  return {
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
}

/** The record of a player of a list: his profile, and his values on the asked basis. */
export function playerReadRecord(parts) {
  const row = playerRow(parts),
    profile = playerProfile(row),
    { role, stats } = profile;
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

/** `detail=profile`: the profile alone. A player's page compares him with his group's
 * profiles and reads nothing else of a list's record (3.2 kB of it, of which 2.7 kB the
 * profile, on 11 November 2026). */
export function playerProfileRecord(parts) {
  const row = playerRow(parts);
  return { id: row.player_id, profile: playerProfile(row) };
}

// What a selection of profiles is made of besides its data; a change of the record
// changes it, so that no kept answer of the previous shape is said unchanged.
const PROFILE_SHAPE = "profile-1";
const DAY = 86_400_000;

/**
 * The version of a selection of profiles: what its answer is made from, in 16 hexadecimal
 * characters. An answer was fenced and validated by the publication, which changes every
 * five minutes while anything is collected: on 11 November 2026 the ten editions of the
 * site's European scope had not changed for twenty hours, and a player's page read his
 * group again (1 to 1.4 s in the function, 5 MB) at each publication.
 *
 * It names the scope's editions with their versions (the collector advances an edition's
 * with each match written, the calculator after each refresh of its rows) and the count
 * and sums of the season's rows read (a daily recount advances no version). A player's or
 * a club's name and image are not in it: their versions advance with every match of
 * every season, a backfill's included. The day is, so none stays more than a day.
 */
export async function selectionVersion(read, editions, now) {
  const [row] = await read(
    `SELECT coalesce((SELECT json_agg(json_build_array(v.resource_id,v.version) ORDER BY v.resource_id) FROM api.versions v
       WHERE v.resource_kind='competition_season' AND v.resource_id=ANY($2::int[])),'[]'::json) AS editions,
     (SELECT json_build_array(count(*),sum(r.matches),sum(r.total_minutes),sum(r.unknown_matches)) FROM api.player_list_editions r
       WHERE r.season_id=$1::smallint AND r.competition_season_id=ANY($2::int[])) AS list`,
    [editions.seasonId, editions.ids],
  );
  const parts = [PROFILE_SHAPE, editions.seasonId, editions.ids, row?.editions ?? [], row?.list ?? [], Math.floor(now / DAY)];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/**
 * The selection, read from the season's rows or from the appearances. On the appearances
 * of a whole scope (a venue, a result, a role or a period is asked), the statement is
 * planned without nested loops (db.mjs, PLANNER_SETTINGS.hashJoins). One match's players
 * keep the usual plan: they are a few rows found by the match's id.
 */
function readSelection(read, filters, params, editions) {
  if (supportsPlayerRollup(filters)) {
    const { sql, values } = playerRollupQuery(filters, params, editions);
    return read(sql, values);
  }
  const { sql, values } = playerReadQuery(filters, params, editions);
  return filters.match === "all" ? read(sql, values, { plan: ["hashJoins"] }) : read(sql, values);
}

/**
 * GET /api/read/players?detail=profile: the selection's profiles, kept by whoever holds
 * them until the selection's version changes. The request names no publication; `v`
 * fences the pages after the first on the version the first one gave (409 otherwise).
 */
async function profileSelection(req, params, filters, read, now) {
  const editions = await resolveEditions(read, filters.scope);
  const version = await selectionVersion(read, editions, now);
  if (filters.pin && filters.pin !== version) reject(409, "Les données ont été actualisées. Rechargez la première page.");
  const signature = [[...params].sort(([a], [b]) => a.localeCompare(b)), version];
  const etag = `W/"players-profile-${createHash("sha256").update(JSON.stringify(signature)).digest("hex")}"`;
  // Unchanged for whoever holds it: neither the selection nor its answer is worked out.
  if (req.method === "HEAD" || matchesEtag(req.headers.get("if-none-match"), etag)) return send(req, null, 200, { etag, ttl: 30 });
  const [snapshot] = await readSelection(read, filters, params, editions);
  const total = Number(snapshot?.total || 0);
  return readResponse(
    req,
    params,
    snapshot,
    { players: (snapshot?.players || []).map(playerProfileRecord), teams: snapshot?.teams || [] },
    {
      pagination: { page: filters.page, limit: filters.limit, total, pages: Math.max(1, Math.ceil(total / filters.limit)) },
      maxBytes: filters.whole ? 16 * 1024 * 1024 : 1024 * 1024,
      version,
      etag,
    },
  );
}

export function createPlayerReadRoute(read, { clock = Date.now } = {}) {
  return async (req, path, params) => {
    if (path !== "/api/read/players") return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    const filters = parsePlayerRead(params);
    if (filters.profiles) return profileSelection(req, params, filters, read, clock());
    const validated = await readValidator(req, params, filters.scope, read);
    if (validated) return validated;
    const editions = await resolveEditions(read, filters.scope);
    const [snapshot] = await readSelection(read, filters, params, editions);
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
        // A whole selection: 330 kB for 100 players on 11 November 2026, so 10 MB for
        // 3,000; compressed by the transport (about a sixth), within its 6 MB.
        maxBytes: filters.whole ? 16 * 1024 * 1024 : 1024 * 1024,
      },
    );
  };
}
