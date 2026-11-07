import { playerAliasEntries } from "../../shared/player-aliases.js";
import { MIN_RATED_MATCHES } from "../../shared/player-profile.js";
import {
  bindValue,
  comparisonNumberSql,
  checkReadGeneration,
  likeText,
  normalizedSql,
  publicationSql,
  scopeWhere,
} from "./relational-read-utils.js";

const ratioKeys = ["passAccuracy", "duelRate"];
const indexedMetricKeys = new Set(["goals", "xg", "assists", "xa"]);
const roleCode = (value) => `CASE WHEN ${value} IN(0,11) THEN 'G'
 WHEN ${value}=1 OR ${value}>=30 AND ${value}<40 OR ${value} IN(51,59) THEN 'D'
 WHEN ${value}=2 OR ${value}>=50 AND ${value}<80 THEN 'M'
 WHEN ${value}>=80 AND ${value}<90 THEN 'AM'
 WHEN ${value}=3 OR ${value}>=90 AND ${value}<120 THEN 'A' END`;
const keyCte = (name, source, key, full = false) => `${name} AS (
 SELECT DISTINCT ON(r.player_id) r.player_id,r.${key}->>'player_ref' player_ref,r.${key}->>'team' team,
  (r.${key}->>'position_number')::float8 position_number${full ? `,r.${key} value` : ""}
 FROM ${source} r WHERE r.${key} IS NOT NULL
 ORDER BY r.player_id,coalesce(r.${key}->>'date','') DESC,r.league_id,(r.${key}->>'source_order')::bigint)`;
const namesCte = (name, source, key) => `${name} AS (
 SELECT player_id,array_agg(name ORDER BY league_id,first_order) names FROM (
  SELECT DISTINCT ON(r.player_id,v->>'name') r.player_id,v->>'name' name,r.league_id,(v->>'first')::bigint first_order
  FROM ${source} r CROSS JOIN LATERAL jsonb_array_elements(r.${key}) v
  ORDER BY r.player_id,v->>'name',r.league_id,(v->>'first')::bigint
 ) n GROUP BY player_id)`;
function roleCtes(prefix, source) {
  return `${prefix}_positions AS (
 SELECT r.player_id,v->>'code' role_code,CASE WHEN v->>'code' IN('AM','A') THEN 'O' ELSE v->>'code' END role_group,
  sum((v->>'minutes')::float8) minutes,
  (array_agg(r.league_id ORDER BY r.league_id,(v->>'first')::bigint))[1] first_league,
  (array_agg((v->>'first')::bigint ORDER BY r.league_id,(v->>'first')::bigint))[1] first_order
 FROM ${source} r CROSS JOIN LATERAL jsonb_array_elements(r.roles) v GROUP BY r.player_id,v->>'code'
), ${prefix}_groups AS (
 SELECT player_id,role_group,sum(minutes) minutes,
  (array_agg(first_league ORDER BY first_league,first_order))[1] first_league,
  (array_agg(first_order ORDER BY first_league,first_order))[1] first_order
 FROM ${prefix}_positions GROUP BY player_id,role_group
), ${prefix}_group AS (
 SELECT DISTINCT ON(player_id) * FROM ${prefix}_groups ORDER BY player_id,minutes DESC,first_league,first_order
), ${prefix}_role AS (
 SELECT DISTINCT ON(p.player_id) p.player_id,p.role_code FROM ${prefix}_positions p JOIN ${prefix}_group g USING(player_id,role_group)
 ORDER BY p.player_id,p.minutes DESC,p.first_league,p.first_order)`;
}

function readiness(scope, values) {
  return `SELECT coalesce(bool_and(p.player_rollup_digest IS NOT NULL
    AND p.player_rollup_digest=p.source_digest AND NOT p.player_rollup_ambiguous),true) ready
    FROM statarena_app.partitions p WHERE ${scopeWhere("p", scope, values)}`;
}

export function supportsPlayerRollup(filters) {
  return (
    filters.match === "all" &&
    !filters.from &&
    !filters.to &&
    filters.role === "all" &&
    filters.venue === "all" &&
    filters.result === "all"
  );
}

function metricProjection(keys, alias = "r", indexed = false) {
  return keys.flatMap((key) =>
    (ratioKeys.includes(key)
      ? ["numerator", "denominator", "count", "minutes"]
      : ["sum", "count", "minutes"]
    ).map(
      (field) =>
        `sum(${indexed && indexedMetricKeys.has(key) ? `${alias}.rank_${key}_${field}` : `(${alias}.metrics->'${key}'->>'${field}')::float8`}) AS "${key}_${field}"`,
    ),
  );
}

/** Combine selected partition totals; hydrate full observations only for a page. */
export function playerRollupQuery(filters, params, countMetrics) {
  const values = [],
    b = (value) => bindValue(values, value);
  const publication = publicationSql(filters.scope, values);
  const state = readiness(filters.scope, values);
  const scope = scopeWhere("r", filters.scope, values);
  const fence = params.has("generation")
    ? ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${b(params.get("generation"))})`
    : "";
  const metricKeys = [...countMetrics, ...ratioKeys];
  const metricValue = (key, alias = "a") =>
    ratioKeys.includes(key)
      ? `100.0*${alias}."${key}_numerator"/nullif(${alias}."${key}_denominator",0)`
      : filters.basis === "total"
        ? `${alias}."${key}_sum"`
        : filters.basis === "per90"
          ? `90.0*${alias}."${key}_sum"/nullif(${alias}."${key}_minutes",0)`
          : `${alias}."${key}_sum"/nullif(${alias}."${key}_count",0)`;
  const rankingMetrics = {
    rating: [],
    goals: ["goals", "xg"],
    assists: ["assists", "xa"],
    clinical: ["goals", "xg"],
    wasteful: ["goals", "xg"],
  };
  const finishing = filters.ranking
    ? ["clinical", "wasteful"].includes(filters.ranking)
    : filters.sort === "finishingDelta";
  const required = new Set(filters.conditions.map(({ key }) => key));
  for (const key of filters.ranking
    ? rankingMetrics[filters.ranking]
    : finishing
      ? ["goals", "xg"]
      : metricKeys.includes(filters.sort)
        ? [filters.sort]
        : [])
    required.add(key);
  const requiredKeys = [...required];
  const earlyMetrics = metricProjection(requiredKeys, "r", true);
  const fullMetrics = metricProjection(metricKeys);
  const selectedFields = (keys) =>
    keys.flatMap((key) =>
      (ratioKeys.includes(key)
        ? ["numerator", "denominator", "count", "minutes"]
        : ["sum", "count", "minutes"]
      ).map((field) => `a."${key}_${field}"`),
    );
  const hasSearch = Boolean(filters.q),
    hasPositions = filters.positions.length > 0;
  const sourceFields = [
    "r.player_id",
    "r.league_id",
    "r.matches",
    "r.total_minutes",
    "r.unknown_minutes",
    "r.rating_sum",
    "r.rating_count",
    "r.identity_ref",
    "r.identity_date",
    "r.identity_source_order",
    "r.latest_ref",
    "r.latest_date",
    "r.latest_source_order",
    "r.latest_present",
    ...requiredKeys
      .filter((key) => indexedMetricKeys.has(key))
      .flatMap((key) =>
        ["sum", "count", "minutes"].map((field) => `r.rank_${key}_${field}`),
      ),
    ...(requiredKeys.some((key) => !indexedMetricKeys.has(key))
      ? ["r.metrics"]
      : []),
    ...(hasPositions
      ? [
          "r.roles",
          "(r.identity->>'position_number')::float8 identity_position_number",
        ]
      : []),
    ...(hasSearch
      ? ["r.teams", "r.leagues", "r.identity->>'team' identity_team"]
      : []),
  ];
  const aliases = b(
    JSON.stringify(
      playerAliasEntries().map(([player_id, names]) => ({
        player_id,
        search_aliases: names.join(" "),
      })),
    ),
  );
  const thresholds = ["true"];
  if (filters.minutes)
    thresholds.push(
      `${comparisonNumberSql("d.minutes")}>=${comparisonNumberSql(b(filters.minutes))}`,
    );
  if (filters.rating !== null)
    thresholds.push(
      `${comparisonNumberSql("d.rating")}>=${comparisonNumberSql(b(filters.rating))}`,
    );
  if (hasPositions)
    thresholds.push(
      `CASE WHEN d.role_code IN('AM','M') THEN 'M' ELSE d.role_code END=ANY(${b(filters.positions)}::text[])`,
    );
  for (const { key, min } of filters.conditions)
    thresholds.push(
      `${comparisonNumberSql(`d."${key}"`)}>=${comparisonNumberSql(b(min))}`,
    );
  if (hasSearch)
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
    clinical: {
      eligible: `${comparisonNumberSql('d."goals_sum"')}>=4 AND d."xg_count">0`,
      order: `${comparisonNumberSql('d."finishingDelta"')} DESC`,
    },
    wasteful: {
      eligible: `${comparisonNumberSql('d."xg_sum"')}>=3 AND d."goals_count">0`,
      order: `${comparisonNumberSql('d."finishingDelta"')} ASC`,
    },
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
  const earlyProjection = [
    ...selectedFields(requiredKeys),
    ...requiredKeys.map((key) => `${metricValue(key)} AS "${key}"`),
    ...(finishing
      ? [`(${metricValue("goals")})-(${metricValue("xg")}) AS "finishingDelta"`]
      : []),
  ];
  const sql = `/*vega:compact:players:rollup*/
WITH publication AS MATERIALIZED (${publication}),rollup_state AS MATERIALIZED (${state}),
source AS ${hasSearch || hasPositions ? "MATERIALIZED" : "NOT MATERIALIZED"} (SELECT ${sourceFields.join(",")} FROM statarena_app.player_season_rollups r
 WHERE ${scope}${fence} AND (SELECT ready FROM rollup_state)),
aggregates AS (
 SELECT r.player_id,sum(r.matches)::int matches,sum(r.total_minutes) total_minutes,
 sum(r.unknown_minutes)::int unknown_minutes,sum(r.rating_sum)/nullif(sum(r.rating_count),0) rating,sum(r.rating_count)::int rating_count,
 (array_agg(r.identity_ref ORDER BY r.identity_date DESC,r.league_id,r.identity_source_order))[1] identity_ref,
 (array_agg(r.latest_ref ORDER BY r.latest_date DESC,r.league_id,r.latest_source_order) FILTER(WHERE r.latest_present))[1] latest_ref
 ${hasPositions ? ",(array_agg(r.identity_position_number ORDER BY r.identity_date DESC,r.league_id,r.identity_source_order))[1] identity_position_number" : ""}
 ${hasSearch ? ",(array_agg(r.identity_team ORDER BY r.identity_date DESC,r.league_id,r.identity_source_order))[1] identity_team" : ""}
 ${earlyMetrics.length ? "," + earlyMetrics.join(",") : ""} FROM source r GROUP BY r.player_id
),
${hasPositions ? roleCtes("global", "source") + "," : ""}
${hasSearch ? namesCte("global_teams", "source", "teams") + "," + namesCte("global_leagues", "source", "leagues") + "," : ""}
averages AS (
 SELECT a.player_id,coalesce(nullif(lp.name,''),nullif(ip.name,''),'Joueur') name,
 a.matches,CASE WHEN a.matches>0 THEN a.total_minutes/a.matches WHEN a.unknown_minutes>0 THEN NULL ELSE 0 END minutes,
 a.rating,a.rating_count
 ${hasPositions ? `,coalesce(ro.role_code,${roleCode("a.identity_position_number")}) role_code` : ""}
 ${hasSearch ? ",coalesce(t.names,CASE WHEN a.identity_team IS NOT NULL AND a.identity_team<>'' THEN ARRAY[a.identity_team] ELSE '{}'::text[] END) teams,coalesce(le.names,'{}'::text[]) leagues,aliases.search_aliases" : ""}
 ${earlyProjection.length ? "," + earlyProjection.join(",") : ""}
 FROM aggregates a JOIN statarena_app.players ip ON ip.id=a.identity_ref
 LEFT JOIN statarena_app.players lp ON lp.id=a.latest_ref
 ${hasPositions ? "LEFT JOIN global_role ro ON ro.player_id=a.player_id" : ""}
 ${hasSearch ? "LEFT JOIN global_teams t ON t.player_id=a.player_id LEFT JOIN global_leagues le ON le.player_id=a.player_id" : ""}
 LEFT JOIN jsonb_to_recordset(${aliases}::jsonb) aliases(player_id text,search_aliases text) ON aliases.player_id=a.player_id
), filtered AS MATERIALIZED (SELECT d.* FROM averages d WHERE ${thresholds.join(" AND ")}),
page AS MATERIALIZED (SELECT d.*,row_number() OVER(ORDER BY ${order}) result_order FROM filtered d ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}),
selected AS MATERIALIZED (SELECT r.* FROM statarena_app.player_season_rollups r JOIN page p USING(player_id)
 WHERE ${scope}${fence} AND (SELECT ready FROM rollup_state)),
${keyCte("selected_identities", "selected", "identity", true)},${keyCte("selected_latest", "selected", "latest", true)},
${namesCte("selected_teams", "selected", "teams")},${namesCte("selected_leagues", "selected", "leagues")},
${roleCtes("selected", "selected")},
page_metrics AS (
 SELECT r.player_id,sum(r.matches)::int matches,sum(r.total_minutes) total_minutes,sum(r.starts)::int starts,sum(r.known_starts)::int known_starts,
 sum(r.unknown_minutes)::int unknown_minutes,sum(r.rating_sum)/nullif(sum(r.rating_count),0) rating,sum(r.rating_count)::int rating_count,
 ${fullMetrics.join(",")} FROM selected r GROUP BY r.player_id
), profiles AS (
 SELECT p.player_id,p.result_order,p.name,coalesce(lp.image_url,ip.image_url) image_url,
 coalesce(t.names,CASE WHEN i.value->>'team' IS NOT NULL AND i.value->>'team'<>'' THEN ARRAY[i.value->>'team'] ELSE '{}'::text[] END) teams,
 coalesce(le.names,'{}'::text[]) leagues,coalesce(ro.role_code,${roleCode("i.position_number")}) role_code,
 a.matches,CASE WHEN a.matches>0 THEN a.total_minutes/a.matches WHEN a.unknown_minutes>0 THEN NULL ELSE 0 END minutes,
 a.total_minutes,a.starts,a.known_starts,a.unknown_minutes,a.rating,a.rating_count,
 ARRAY(SELECT DISTINCT v FROM selected r CROSS JOIN LATERAL unnest(r.team_ids) v WHERE r.player_id=p.player_id ORDER BY v) team_ids,
 ARRAY(SELECT DISTINCT v FROM selected r CROSS JOIN LATERAL unnest(r.league_ids) v WHERE r.player_id=p.player_id ORDER BY v) league_ids,
 i.value||jsonb_build_object('name',ip.name,'image_url',ip.image_url) identity,
 CASE WHEN l.value IS NOT NULL THEN l.value||jsonb_build_object('name',lp.name,'image_url',lp.image_url) END latest,
 ${selectedFields(metricKeys).join(",")},${metricKeys.map((key) => `${metricValue(key)} AS "${key}"`).join(",")},
 (${metricValue("goals")})-(${metricValue("xg")}) AS "finishingDelta"
 FROM page p JOIN page_metrics a USING(player_id) JOIN selected_identities i USING(player_id)
 JOIN statarena_app.players ip ON ip.id=i.player_ref LEFT JOIN selected_latest l ON l.player_id=p.player_id
 LEFT JOIN statarena_app.players lp ON lp.id=l.player_ref LEFT JOIN selected_teams t ON t.player_id=p.player_id
 LEFT JOIN selected_leagues le ON le.player_id=p.player_id LEFT JOIN selected_role ro ON ro.player_id=p.player_id
)
SELECT publication.*,(SELECT ready FROM rollup_state) rollup_ready,(SELECT count(*)::int FROM filtered) total,
 coalesce((SELECT jsonb_agg(to_jsonb(p)-'result_order' ORDER BY result_order) FROM profiles p),'[]'::jsonb) players,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'imageUrl',t.image_url) ORDER BY t.id)
 FROM statarena_app.teams t WHERE t.id IN(SELECT unnest(team_ids) FROM profiles)),'[]'::jsonb) teams
FROM publication`;
  return { sql, values };
}

export async function readPlayerRollup(read, filters, params, countMetrics) {
  if (!supportsPlayerRollup(filters)) return null;
  const values = [],
    state = readiness(filters.scope, values);
  const [available] = await read(
    `SELECT g.generation::text generation,s.ready FROM statarena_app.publications g CROSS JOIN LATERAL (${state}) s WHERE g.singleton`,
    values,
  );
  checkReadGeneration(params, available?.generation);
  if (!available.ready) return null;
  const request = playerRollupQuery(filters, params, countMetrics);
  const [snapshot] = await read(request.sql, request.values);
  checkReadGeneration(params, snapshot?.generation);
  return snapshot.rollup_ready ? snapshot : null;
}
