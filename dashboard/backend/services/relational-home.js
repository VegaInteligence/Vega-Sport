import { query } from "./postgres.js";
import {
  appearanceRecord,
  assembleMatches,
  competition,
  fixture,
  reject,
  validateParams,
} from "./relational-core.js";
import { scoreSql } from "./relational-clubs.js";
import {
  bindValue,
  checkReadGeneration,
  finiteSql,
  normalizedSql,
  parseReadScope,
  publicationSql,
  readResponse,
  readValidator,
  scopeWhere,
} from "./relational-read-utils.js";
import { EUROPE_FOCUS } from "../../shared/competition-scope.js";

// The SQL policy is checked against the presentation policy in the contract tests.
export const HOME_TOP_FIVE = EUROPE_FOCUS.slice(0, 5).map(({ id }) => id);
export const HOME_TOP_SEVEN = EUROPE_FOCUS.slice(0, 7).map(({ id }) => id);
export const HOME_UEFA = EUROPE_FOCUS.slice(7).map(({ id }) => id);
export const HOME_SIMPLE_LEAGUES = [
  "l_3FJFUl",
  "l_0275VP",
  "l_4WFCIZ",
  "l_4DWyTT",
  "l_0ahLw8",
  "l_1W6idJ",
  "l_1Isor4",
  "l_3hvsne",
  "l_47077Y",
  "l_0ErfuF",
  "l_3kyHLd",
  "l_0ALvwF",
  "l_0jy5yE",
  "l_4QexZg",
  "l_4H43wr",
  "l_49KZaB",
  "l_0S1uaf",
  "l_1BFfna",
];
export const HOME_FEATURED_CLUBS = [
  "t_1gkhxH",
  "t_4R934X",
  "t_0BrMnM",
  "t_0UCNPX",
  "t_2I313i",
  "t_2eQl9k",
  "t_4A7FfD",
  "t_41iFW3",
  "t_2s2eyG",
  "t_0xMlRV",
  "t_13gLEF",
  "t_0tnX1I",
  "t_4NZcri",
  "t_32jSEF",
  "t_3NIiXl",
  "t_1cpjqO",
  "t_386iz1",
  "t_2lHR8t",
  "t_4ZwKDn",
  "t_3CPHHF",
  "t_1DYf1D",
  "t_2toJRF",
  "t_0RhqmW",
  "t_0Mzm1V",
  "t_0dVrhE",
  "t_1TAfIz",
  "t_3t08JG",
  "t_1jOgDP",
  "t_4KvHFN",
];

const arraySql = (values) =>
  `ARRAY[${values.map((value) => `'${value}'`).join(",")}]::text[]`;
const topFive = arraySql(HOME_TOP_FIVE),
  topSeven = arraySql(HOME_TOP_SEVEN),
  uefa = arraySql(HOME_UEFA);
const simpleLeagues = arraySql(HOME_SIMPLE_LEAGUES),
  bigClubs = arraySql(HOME_FEATURED_CLUBS);
const explicitTime = (
  alias,
) => `CASE WHEN ${alias}.time_utc ~* 'T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
 AND pg_input_is_valid(${alias}.time_utc,'timestamp with time zone') THEN ${alias}.time_utc::timestamptz END`;
const safeDate = (value) =>
  `CASE WHEN ${value} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND pg_input_is_valid(${value},'date') THEN ${value}::date END`;
const jsonRows = (sql) =>
  `(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (${sql}) r)`;
const oneRow = (sql) => `(SELECT to_jsonb(r) FROM (${sql}) r)`;

export function parseHomeRead(params) {
  validateParams(params, [
    "season",
    "league",
    "leagues",
    "generation",
    "archive",
    "personalTeams",
    "personalPlayers",
  ]);
  const scope = parseReadScope(params);
  if (params.has("archive") && !["0", "1"].includes(params.get("archive")))
    reject(400, "Période invalide.");
  const identifiers = (key, prefix) => {
    const raw = params.get(key),
      ids = raw ? raw.split(",") : [];
    if (
      ids.length > 100 ||
      ids.some((id) => !new RegExp(`^${prefix}_[A-Za-z0-9]{6}$`).test(id))
    )
      reject(400, "Favoris invalides.");
    return [...new Set(ids)].sort();
  };
  return {
    scope,
    archive: params.get("archive") === "1",
    personalTeams: identifiers("personalTeams", "t"),
    personalPlayers: identifiers("personalPlayers", "p"),
  };
}

/**
 * All rankings use the complete selected season before LIMIT. Only the small
 * display structures leave PostgreSQL. No season of appearances, shots or
 * team statistics is hydrated by the application for this endpoint.
 */
export function homeReadQuery(filters, params, now) {
  const values = [],
    b = (value) => bindValue(values, value),
    publication = publicationSql(filters.scope, values);
  const matchScope = scopeWhere("m", filters.scope, values),
    fixtureScope = scopeWhere("f", filters.scope, values);
  const appearanceScope = scopeWhere("a", filters.scope, values);
  const fence = params.has("generation")
    ? ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${b(params.get("generation"))})`
    : "";
  const instant = `${b(new Date(now).toISOString())}::timestamptz`,
    personalTeams = `${b(filters.personalTeams)}::text[]`,
    personalPlayers = `${b(filters.personalPlayers)}::text[]`;
  const personalSeason = b(filters.scope.season);
  const weight = (
    alias,
    home,
    away,
  ) => `(2*(coalesce((${alias}.${home}=ANY(${bigClubs}))::int,0)+coalesce((${alias}.${away}=ANY(${bigClubs}))::int,0))
    +CASE WHEN ${alias}.league_id='l_0bfbkO' THEN 3 WHEN ${alias}.league_id=ANY(${uefa}) THEN 1 ELSE 0 END
    +coalesce((${alias}.league_id=ANY(${topFive}))::int,0)+coalesce((rh.rank<=3)::int,0)+coalesce((ra.rank<=3)::int,0))`;
  const tableRow = (
    alias,
  ) => `jsonb_build_object('id',${alias}.team_id,'name',${alias}.name,'imageUrl',${alias}.image_url,'leagueId',${alias}.league_id,
    'played',${alias}.played,'points',${alias}.points,'goalsFor',${alias}.goals_for,'goalsAgainst',${alias}.goals_against,
    'cleanSheets',${alias}.clean_sheets,'results',${alias}.results,'cumulative',${alias}.cumulative,
    'difference',${alias}.difference,'form',${alias}.form,'streak',${alias}.streak,'rank',${alias}.rank)`;
  const seasonRow = (
    alias,
  ) => `jsonb_build_object('playerId',${alias}.player_id,'name',${alias}.name,'imageUrl',${alias}.image_url,
    'team',${alias}.team,'teamId',${alias}.team_id,'date',${alias}.date,'lastId',${alias}.last_id,'apps',${alias}.apps,
    'minutes',${alias}.minutes,'goals',${alias}.goals,'assists',${alias}.assists,'xg',${alias}.xg,'xa',${alias}.xa,
    'xgMatches',${alias}.xg_matches,'xaMatches',${alias}.xa_matches,'ratingSum',${alias}.rating_sum,'ratingMinutes',${alias}.rating_minutes,'rating',${alias}.rating)`;
  const leaders = (
    predicate,
    order,
    limit,
  ) => `(SELECT coalesce(jsonb_agg(${seasonRow("p")} ORDER BY ${order}),'[]'::jsonb)
    FROM (SELECT * FROM season_players WHERE ${predicate} ORDER BY ${order} LIMIT ${limit}) p)`;
  const statement = `/*vega:compact:home*/
WITH publication AS MATERIALIZED (${publication}),
match_source AS MATERIALIZED (
 SELECT m.*,${explicitTime("m")} explicit_time,${safeDate("left(m.date,10)")} calendar_day
 FROM statarena_app.matches m WHERE ${matchScope}${fence}
), matches AS MATERIALIZED (
 SELECT m.*,coalesce(explicit_time,(calendar_day+time '12:00') AT TIME ZONE 'UTC') kickoff,
 coalesce((explicit_time AT TIME ZONE 'Europe/Paris')::date,calendar_day) local_day
 FROM match_source m
), fixture_source AS MATERIALIZED (
 SELECT f.*,${explicitTime("f")} explicit_time FROM statarena_app.fixtures f WHERE ${fixtureScope}${fence}
), fixtures AS MATERIALIZED (
 SELECT f.*,coalesce(explicit_time,(f.day+time '12:00') AT TIME ZONE 'UTC') kickoff,
 coalesce((explicit_time AT TIME ZONE 'Europe/Paris')::date,f.day) local_day FROM fixture_source f
), period_anchor AS (
 SELECT ${filters.archive ? `(SELECT max(kickoff) FROM matches WHERE status='finished' AND ${scoreSql("home_score")} AND ${scoreSql("away_score")} AND kickoff<=${instant})` : instant} anchor
), period AS (
 SELECT date_trunc('week',anchor AT TIME ZONE 'Europe/Paris')::date start_day,
 date_trunc('week',anchor AT TIME ZONE 'Europe/Paris')::date+6 end_day,
 (${instant} AT TIME ZONE 'Europe/Paris')::date as_of_day FROM period_anchor
), league_sides AS MATERIALIZED (
 SELECT f.*,s.team_id,s.name,s.image_url,s.gf,s.ga,
 (f.status='finished' AND ${scoreSql("f.score_home")} AND ${scoreSql("f.score_away")}) scored
 FROM fixtures f CROSS JOIN LATERAL (VALUES(f.home_team_id,f.home_name,f.home_image_url,f.score_home,f.score_away),
 (f.away_team_id,f.away_name,f.away_image_url,f.score_away,f.score_home)) s(team_id,name,image_url,gf,ga)
 WHERE f.league_id=ANY(${simpleLeagues}) AND f.home_team_id IS NOT NULL AND f.away_team_id IS NOT NULL AND f.home_team_id<>f.away_team_id
), league_teams AS (
 SELECT DISTINCT ON(league_id,team_id) league_id,team_id,name,image_url FROM league_sides ORDER BY league_id,team_id,day NULLS LAST,id
), game_points AS (
 SELECT s.*,CASE WHEN gf>ga THEN 3 WHEN gf=ga THEN 1 ELSE 0 END points,
 CASE WHEN gf>ga THEN 'W' WHEN gf=ga THEN 'D' ELSE 'L' END outcome,
 row_number() OVER(PARTITION BY league_id,team_id ORDER BY kickoff NULLS LAST,id) game_number
 FROM league_sides s WHERE scored
), game_history AS (
 SELECT g.*,sum(points) OVER(PARTITION BY league_id,team_id ORDER BY game_number) cumulative FROM game_points g
), league_records AS (
 SELECT league_id,team_id,count(*)::int played,sum(points)::int points,sum(gf) goals_for,sum(ga) goals_against,
 count(*) FILTER(WHERE ga=0)::int clean_sheets,array_agg(outcome ORDER BY game_number) results,
 array_agg(cumulative ORDER BY game_number) cumulative,
 (count(*)-coalesce(max(game_number) FILTER(WHERE outcome<>'W'),0))::int streak
 FROM game_history GROUP BY league_id,team_id
), league_rows AS (
 SELECT t.*,coalesce(r.played,0) played,coalesce(r.points,0) points,coalesce(r.goals_for,0) goals_for,
 coalesce(r.goals_against,0) goals_against,coalesce(r.clean_sheets,0) clean_sheets,coalesce(r.streak,0) streak,
 coalesce(r.results,ARRAY[]::text[]) results,coalesce(r.cumulative,ARRAY[]::bigint[]) cumulative,
 coalesce(r.goals_for-r.goals_against,0) difference,coalesce(r.results[greatest(1,r.played-4):r.played],ARRAY[]::text[]) form
 FROM league_teams t LEFT JOIN league_records r USING(league_id,team_id)
), ranked AS MATERIALIZED (
 SELECT r.*,row_number() OVER(PARTITION BY league_id ORDER BY points DESC,difference DESC,goals_for DESC,${normalizedSql("r.name")},r.name COLLATE "C",team_id)::int rank
 FROM league_rows r
), ranks AS MATERIALIZED (
 SELECT DISTINCT ON(team_id) * FROM ranked ORDER BY team_id,league_id
), table_totals AS MATERIALIZED (
 SELECT league_id,count(*)::int team_count,max(played) played,greatest(0,(count(*)-1)*2)::int games FROM ranked GROUP BY league_id
), displayed_tables AS (
 SELECT t.* FROM table_totals t LEFT JOIN statarena_app.competitions c ON c.id=t.league_id
 WHERE t.played>0 AND t.team_count>=4 ORDER BY coalesce(array_position(${topSeven},t.league_id),99),${normalizedSql("c.name")},t.league_id LIMIT 8
), weekly AS MATERIALIZED (
 SELECT m.*,${weight("m", "home_id", "away_id")} editorial_weight,
 4*(coalesce((m.home_id=ANY(${bigClubs}))::int,0)+coalesce((m.away_id=ANY(${bigClubs}))::int,0))
 +coalesce((rh.rank<=4)::int,0)*2+coalesce((ra.rank<=4)::int,0)*2
 +coalesce((rh.rank<=3 AND ra.rank<=3)::int,0)*2+(m.league_id='l_0bfbkO')::int*3
 +(m.league_id=ANY(${topFive}))::int+(EXISTS(SELECT 1 FROM statarena_app.shots sh WHERE sh.match_id=m.id))::int showcase_weight
 FROM matches m CROSS JOIN period p LEFT JOIN ranks rh ON rh.team_id=m.home_id LEFT JOIN ranks ra ON ra.team_id=m.away_id
 WHERE m.status='finished' AND ${scoreSql("m.home_score")} AND ${scoreSql("m.away_score")}
 AND m.local_day BETWEEN p.start_day AND p.end_day AND m.local_day<=p.as_of_day
 AND (m.explicit_time IS NULL OR m.explicit_time<=${instant})
), ticker_ordered AS (
 SELECT w.*,dense_rank() OVER(ORDER BY local_day DESC) day_number,
 row_number() OVER(PARTITION BY local_day ORDER BY editorial_weight DESC,kickoff DESC,id) daily_number FROM weekly w
), featured AS MATERIALIZED (
 SELECT * FROM weekly ORDER BY showcase_weight DESC,kickoff DESC,id LIMIT 1
), biggest_win AS (
 SELECT w.*,abs(home_score-away_score) margin,home_score+away_score goals FROM weekly w
 WHERE abs(home_score-away_score)>=3 ORDER BY margin DESC,goals DESC,kickoff DESC,id LIMIT 1
), season_apps AS MATERIALIZED (
 SELECT a.id,a.player_id,a.team_id,a.team,a.match_id,a.league_id,a.date,
 a.minutes,a.rating,a.goals,a.assists,a.xg,a.xa,p.name,p.image_url,
 row_number() OVER(ORDER BY a.league_id,a.date NULLS LAST,a.match_id,a.ordinal,a.id) source_order
 FROM statarena_app.appearances a JOIN statarena_app.players p ON p.id=a.player_ref
 WHERE ${appearanceScope}${fence} AND ${finiteSql("a.minutes")} AND a.minutes>=1
), season_identity AS (
 SELECT DISTINCT ON(player_id) player_id,name,image_url,team_id,team FROM season_apps ORDER BY player_id,source_order
), season_latest AS (
 SELECT DISTINCT ON(player_id) player_id,id,date FROM season_apps ORDER BY player_id,coalesce(date,'') DESC,source_order DESC
), season_team_candidates AS (
 SELECT player_id,team_id,team,league_id,date,source_order,
 max(coalesce(date,'')) OVER(PARTITION BY player_id ORDER BY source_order ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_date
 FROM season_apps
), season_team AS (
 SELECT DISTINCT ON(player_id) player_id,team_id,team FROM season_team_candidates
 WHERE coalesce(date,'')>=coalesce(prior_date,'') AND NOT league_id=ANY(${uefa}) ORDER BY player_id,source_order DESC
), player_totals AS (
 SELECT player_id,count(*)::int apps,sum(minutes) minutes,coalesce(sum(goals) FILTER(WHERE ${finiteSql("goals")}),0) goals,
 coalesce(sum(assists) FILTER(WHERE ${finiteSql("assists")}),0) assists,
 CASE WHEN count(xg) FILTER(WHERE ${finiteSql("xg")})=count(*) THEN sum(xg) END xg,
 CASE WHEN count(xa) FILTER(WHERE ${finiteSql("xa")})=count(*) THEN sum(xa) END xa,
 count(xg) FILTER(WHERE ${finiteSql("xg")})::int xg_matches,count(xa) FILTER(WHERE ${finiteSql("xa")})::int xa_matches,
 coalesce(sum(rating*minutes) FILTER(WHERE ${finiteSql("rating")}),0) rating_sum,
 coalesce(sum(minutes) FILTER(WHERE ${finiteSql("rating")}),0) rating_minutes,min(source_order) first_order
 FROM season_apps GROUP BY player_id
), season_players AS MATERIALIZED (
 SELECT p.*,i.name,i.image_url,coalesce(t.team_id,i.team_id) team_id,coalesce(t.team,i.team) team,l.date,l.id last_id,
 CASE WHEN p.rating_minutes>0 THEN p.rating_sum/p.rating_minutes END rating
 FROM player_totals p JOIN season_identity i USING(player_id) JOIN season_latest l USING(player_id) LEFT JOIN season_team t USING(player_id)
), rating_minimum AS (SELECT greatest(450,round(coalesce(max(minutes),0)*0.4)) rated_min FROM season_players),
weekly_performances AS MATERIALIZED (
 SELECT DISTINCT ON(a.player_id) a.* FROM season_apps a JOIN weekly w ON w.id=a.match_id
 WHERE a.minutes>=60 AND ${finiteSql("a.rating")} ORDER BY a.player_id,a.rating DESC,a.source_order
), potw AS MATERIALIZED (
 SELECT * FROM weekly_performances ORDER BY (league_id=ANY(${topFive}||${uefa})) DESC,rating DESC,coalesce(goals,0) DESC,${normalizedSql("name")},name COLLATE "C",source_order LIMIT 1
), other_performances AS MATERIALIZED (
 SELECT * FROM weekly_performances WHERE player_id IS DISTINCT FROM (SELECT player_id FROM potw)
 ORDER BY rating DESC,coalesce(goals,0) DESC,${normalizedSql("name")},name COLLATE "C",source_order LIMIT 9
), best_featured AS (
 SELECT a.* FROM season_apps a JOIN featured f ON f.id=a.match_id WHERE ${finiteSql("a.rating")} ORDER BY a.rating DESC,a.source_order LIMIT 1
), recent_performances AS (
 SELECT * FROM season_apps WHERE player_id=(SELECT player_id FROM potw) AND ${finiteSql("rating")}
 ORDER BY date DESC NULLS LAST,source_order DESC LIMIT 6
), selected_appearances AS MATERIALIZED (
 SELECT a.*,p.name,p.image_url FROM statarena_app.appearances a JOIN statarena_app.players p ON p.id=a.player_ref
 WHERE a.id IN(SELECT id FROM potw UNION SELECT id FROM other_performances UNION SELECT id FROM best_featured UNION SELECT id FROM recent_performances)
), personal_clubs AS MATERIALIZED (
 SELECT unnest(${personalTeams}) team_id UNION
 SELECT team_id FROM (SELECT DISTINCT ON(a.player_id) a.team_id FROM statarena_app.appearances a
 WHERE a.season=${personalSeason} AND a.player_id=ANY(${personalPlayers}) AND a.minutes>0 AND ${finiteSql("a.minutes")}
 AND a.team_id IS NOT NULL AND coalesce(a.date,'')<>''
 AND (coalesce(a.country,'') NOT IN('INT','INT-2','UEFA','WORLD') OR a.league_id=ANY(${uefa}))
 ORDER BY a.player_id,a.date DESC,a.id DESC) p
), upcoming_candidates AS MATERIALIZED (
 SELECT f.*,extract(epoch FROM f.kickoff)*1000 time_ms,(f.kickoff AT TIME ZONE 'Europe/Paris')::date upcoming_day,
 coalesce(((f.home_team_id IN(SELECT team_id FROM personal_clubs)) OR (f.away_team_id IN(SELECT team_id FROM personal_clubs)))::int,0) personal,
 ${weight("f", "home_team_id", "away_team_id")} editorial_weight
 FROM fixtures f LEFT JOIN ranks rh ON rh.team_id=f.home_team_id LEFT JOIN ranks ra ON ra.team_id=f.away_team_id
 WHERE f.status='not_started' AND f.kickoff>${instant} AND f.kickoff<=${instant}+interval '7 days'
 AND coalesce(f.home_name,'')<>'' AND coalesce(f.away_name,'')<>''
), upcoming AS MATERIALIZED (
 SELECT u.*,CASE WHEN personal=1 THEN coalesce(4-array_position(${uefa},league_id),0) ELSE 0 END europe_priority,
 row_number() OVER(ORDER BY personal DESC,CASE WHEN personal=1 THEN upcoming_day END ASC NULLS LAST,
 CASE WHEN personal=1 THEN coalesce(4-array_position(${uefa},league_id),0) END DESC NULLS LAST,
 CASE WHEN personal=1 THEN kickoff END ASC NULLS LAST,
 CASE WHEN personal=1 THEN id END ASC NULLS LAST,editorial_weight DESC,kickoff,id) highlight_order
 FROM upcoming_candidates u
), streak AS MATERIALIZED (
 SELECT * FROM ranked WHERE streak>=3 ORDER BY streak DESC,rank,league_id LIMIT 1
), defence_candidates AS (
 SELECT r.*,goals_against/played per_game FROM ranked r WHERE played>=5
), distinct_defences AS (
 SELECT DISTINCT ON(team_id) * FROM defence_candidates ORDER BY team_id,per_game,clean_sheets DESC,league_id,rank
), defences AS (SELECT * FROM distinct_defences ORDER BY per_game,clean_sheets DESC,league_id,rank LIMIT 3),
champions_rounds AS MATERIALIZED (
 SELECT DISTINCT ON(r.metric_label) r.metric_label match_id,r.name
 FROM statarena_app.catalog_editions c JOIN statarena_app.cat_matchdays d USING(resource_id)
 JOIN statarena_app.cat_matchdays_matches r ON r.resource_id=d.resource_id AND r.parent_no=d.record_no
 WHERE c.catalog='matchdays' AND c.scope='l_0bfbkO' AND c.edition=${personalSeason}
 AND coalesce(c.response_status,200) BETWEEN 200 AND 299
 AND NOT 'matches'=ANY(d.missing) AND NOT 'matches'=ANY(d.null_groups) AND NOT 'name'=ANY(r.missing)
 ORDER BY r.metric_label,r.position DESC,r.record_no DESC
),
champions_games AS (
 SELECT coalesce(m.id,f.id) id,coalesce(nullif(r.name,''),nullif(f.round_name,''),m.round_name) stage,
 (f.status='finished' OR (m.status='finished' AND ${scoreSql("m.home_score")} AND ${scoreSql("m.away_score")})) finished
 FROM (SELECT * FROM matches WHERE league_id='l_0bfbkO') m FULL JOIN (SELECT * FROM fixtures WHERE league_id='l_0bfbkO') f USING(id)
 LEFT JOIN champions_rounds r ON r.match_id=coalesce(m.id,f.id)
), champions_stages AS (
 SELECT btrim(regexp_replace(regexp_replace(${normalizedSql("stage")},'[-–—]',' ','g'),'[[:space:]]+',' ','g')) stage,coalesce(finished,false) finished FROM champions_games
), featured_shots AS MATERIALIZED (
 SELECT s.* FROM statarena_app.shots s JOIN featured f ON f.id=s.match_id ORDER BY s.ordinal,s.id LIMIT 1001
)
SELECT publication.*,
 (SELECT min(change_at) FROM (
   SELECT kickoff AS change_at FROM matches
   UNION ALL SELECT kickoff FROM fixtures
   UNION ALL SELECT kickoff - interval '7 days' FROM fixtures
   UNION ALL SELECT (((${instant} AT TIME ZONE 'Europe/Paris')::date+1)::timestamp AT TIME ZONE 'Europe/Paris')
 ) changes WHERE change_at > ${instant}) AS next_change,
 (SELECT CASE WHEN start_day IS NULL THEN null ELSE jsonb_build_object('start',start_day,'end',end_day,'current',${!filters.archive},'asOf',${b(now)}::float8,'asOfDay',as_of_day) END FROM period) period,
 (SELECT count(*)::int FROM weekly) result_count,
 ${jsonRows("SELECT * FROM ticker_ordered WHERE day_number<=4 AND daily_number<=8 ORDER BY kickoff DESC,id")} results,
 ${oneRow("SELECT * FROM featured")} featured,
 ${oneRow("SELECT * FROM biggest_win")} biggest_win,
 ${oneRow("SELECT s.* FROM selected_appearances s JOIN potw p USING(id)")} potw,
 ${oneRow("SELECT m.* FROM matches m JOIN potw p ON p.match_id=m.id")} potw_match,
 (SELECT ${seasonRow("s")} FROM season_players s JOIN potw p USING(player_id)) potw_season,
 ${jsonRows("SELECT s.* FROM selected_appearances s JOIN recent_performances p USING(id) ORDER BY p.date NULLS FIRST,p.source_order")} potw_recent,
 ${oneRow("SELECT s.* FROM selected_appearances s JOIN best_featured p USING(id)")} best_featured,
 ${jsonRows(`SELECT s.* FROM selected_appearances s JOIN other_performances p USING(id) ORDER BY p.rating DESC,coalesce(p.goals,0) DESC,${normalizedSql("p.name")},p.name COLLATE "C",p.source_order`)} others,
 ${jsonRows("SELECT m.* FROM matches m WHERE m.id IN(SELECT match_id FROM other_performances) ORDER BY m.id")} other_matches,
 jsonb_build_object('goals',${leaders("goals>0", "goals DESC,coalesce(xg,0) DESC,first_order", 10)},
 'assists',${leaders("assists>0", "assists DESC,coalesce(xa,0) DESC,first_order", 10)},
 'clinical',${leaders("goals>=4 AND xg IS NOT NULL", "goals-xg DESC,first_order", 8)},
 'wasteful',${leaders("xg>=3", "goals-xg,first_order", 8)},
 'rating',${leaders("rating IS NOT NULL AND minutes>=(SELECT rated_min FROM rating_minimum)", "rating DESC,first_order", 10)},
 'ratedMin',(SELECT rated_min FROM rating_minimum)) leaders,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('leagueId',t.league_id,'played',t.played,'games',t.games,'teamCount',t.team_count,
 'rows',(SELECT jsonb_agg(${tableRow("r")} ORDER BY r.rank) FROM ranked r WHERE r.league_id=t.league_id AND r.rank<=6))
 ORDER BY coalesce(array_position(${topSeven},t.league_id),99),${normalizedSql("c.name")},t.league_id),'[]'::jsonb)
 FROM displayed_tables t LEFT JOIN statarena_app.competitions c ON c.id=t.league_id) tables,
 (SELECT coalesce(jsonb_agg(jsonb_build_array(team_id,jsonb_build_object('id',team_id,'rank',rank,'leagueId',league_id,'form',form)) ORDER BY team_id),'[]'::jsonb) FROM ranks) ranks,
 (SELECT ${tableRow("s")} FROM streak s) streak,
 (SELECT coalesce(jsonb_agg(${tableRow("d")}||jsonb_build_object('perGame',d.per_game) ORDER BY d.per_game,d.clean_sheets DESC,d.league_id,d.rank),'[]'::jsonb) FROM defences d) defences,
 ${jsonRows("SELECT * FROM upcoming ORDER BY highlight_order LIMIT 5")} highlights,
 ${oneRow("SELECT u.* FROM upcoming u JOIN streak s ON s.team_id IN(u.home_team_id,u.away_team_id) ORDER BY u.highlight_order LIMIT 1")} streak_next,
 (SELECT coalesce(avg(least(1,played::float8/games)),0) FROM table_totals t WHERE games>0
 AND (league_id=ANY(${topFive}) OR NOT EXISTS(SELECT 1 FROM table_totals WHERE games>0 AND league_id=ANY(${topFive})))) season_progress,
 EXISTS(SELECT 1 FROM season_players) has_season_players,
 (EXISTS(SELECT 1 FROM champions_stages WHERE stage ~ '^(1/2|semi ?finals?|demi finales?|final|finale)$' AND finished)
 OR (SELECT count(*)>=8 AND bool_and(finished) FROM champions_stages WHERE stage ~ '^(1/4|quarter ?finals?|quarts? de finale)$')) race_open,
 ${jsonRows("SELECT * FROM featured_shots ORDER BY ordinal,id")} shots,
 ${jsonRows("SELECT s.* FROM statarena_app.team_statistics s JOIN featured f ON f.id=s.match_id ORDER BY s.ordinal LIMIT 257")} stats,
 ${jsonRows("SELECT c.* FROM statarena_app.match_coverage c JOIN featured f ON f.id=c.match_id")} cover,
 ${jsonRows("SELECT c.* FROM statarena_app.competitions c WHERE c.id IN(SELECT league_id FROM matches UNION SELECT league_id FROM fixtures) ORDER BY c.id")} competitions
FROM publication`;
  return { sql: statement, values };
}

const matchRecord = (row, extra = {}) =>
  row ? assembleMatches({ matches: [row], ...extra })[0] : null;
const upcomingRecord = (row) =>
  row
    ? {
        fixture: fixture(row),
        time: Number(row.time_ms),
        day: row.upcoming_day,
        personal: row.personal,
        europePriority: row.europe_priority,
        weight: row.editorial_weight,
      }
    : null;

export function homeReadRecord(snapshot) {
  if (snapshot?.shots?.length > 1000 || snapshot?.stats?.length > 256)
    reject(503, "Le détail du match dépasse la limite de cette synthèse.");
  const appearance = (value) => (value ? appearanceRecord(value) : null);
  return {
    period: snapshot.period,
    resultCount: snapshot.result_count,
    results: (snapshot.results || []).map((row) => matchRecord(row)),
    featured: matchRecord(snapshot.featured, snapshot),
    bestOfFeatured: appearance(snapshot.best_featured),
    potw: appearance(snapshot.potw),
    potwMatch: matchRecord(snapshot.potw_match),
    potwSeason: snapshot.potw_season,
    potwRecent: (snapshot.potw_recent || []).map(appearance),
    others: (snapshot.others || []).map(appearance),
    otherMatches: (snapshot.other_matches || []).map((row) => matchRecord(row)),
    leaders: snapshot.leaders,
    tables: snapshot.tables || [],
    ranks: snapshot.ranks || [],
    highlights: (snapshot.highlights || []).map(upcomingRecord),
    streak: snapshot.streak,
    defences: snapshot.defences || [],
    win: snapshot.biggest_win
      ? {
          match: matchRecord(snapshot.biggest_win),
          margin: snapshot.biggest_win.margin,
          goals: snapshot.biggest_win.goals,
        }
      : null,
    streakNext: upcomingRecord(snapshot.streak_next),
    seasonProgress: snapshot.season_progress,
    hasSeasonPlayers: snapshot.has_season_players,
    raceOpen: Boolean(snapshot.race_open),
    competitions: (snapshot.competitions || []).map(competition),
  };
}

export const homeStamp = (row) =>
  JSON.stringify([
    "home-projection-v1",
    String(row?.generation),
    row?.published_at,
    row?.source_retrieved_at,
    row?.latest_source_retrieved_at,
    row?.start_date,
    row?.end_date,
    Number(row?.partition_count || 0),
    Number(row?.missing_watermarks || 0),
  ]);

export function createHomeReadRoute(read = query, clock = Date.now) {
  // A process-local bounded cache: SQL remains the authority, and each request
  // checks publication metadata and every time boundary before reusing a result.
  const cache = new Map(),
    inflight = new Map();
  return async (req, path, params) => {
    if (path !== "/api/read/home") return null;
    if (!["GET", "HEAD"].includes(req.method))
      reject(405, "M\u00e9thode non autoris\u00e9e.");
    const filters = parseHomeRead(params),
      now = clock(),
      periodKey = Math.floor(now / 60_000);
    const validated = await readValidator(req, params, filters.scope, read, {
      periodKey,
    });
    if (validated) return validated;
    // A conditional miss retains the existing one-statement payload snapshot.
    if (req.headers.get("if-none-match")) {
      const { sql, values } = homeReadQuery(filters, params, now);
      const [snapshot] = await read(sql, values);
      return readResponse(
        req,
        params,
        snapshot,
        snapshot ? homeReadRecord(snapshot) : {},
        { periodKey, maxBytes: 1024 * 1024 },
      );
    }
    const metaValues = [];
    const [meta] = await read(
      publicationSql(filters.scope, metaValues),
      metaValues,
    );
    checkReadGeneration(params, meta?.generation);
    const key = JSON.stringify([
      filters,
      params.get("generation"),
      homeStamp(meta),
    ]);
    let entry = cache.get(key);
    if (!entry || !(now >= entry.from && now < entry.until)) {
      // Both cold workers and arbitrary scopes fall back when a projection is unavailable.
      try {
        const [capability] = await read(
          "SELECT CASE WHEN to_regclass('statarena_app.home_projection') IS NULL THEN false ELSE has_table_privilege(to_regclass('statarena_app.home_projection'),'SELECT') END AS available",
        );
        const [projection] = capability?.available
          ? await read(
              "SELECT stamp,computed_at,valid_until,snapshot FROM statarena_app.home_projection WHERE scope_key=$1",
              [JSON.stringify(filters)],
            )
          : [];
        if (
          projection &&
          projection.stamp === homeStamp(meta) &&
          now >= new Date(projection.computed_at).getTime() &&
          now < new Date(projection.valid_until).getTime()
        ) {
          entry = {
            snapshot: projection.snapshot,
            data: homeReadRecord(projection.snapshot),
            from: new Date(projection.computed_at).getTime(),
            until: new Date(projection.valid_until).getTime(),
          };
          cache.set(key, entry);
          while (cache.size > 64) cache.delete(cache.keys().next().value);
        }
      } catch (error) {
        if (!["42P01", "42501"].includes(error.code)) throw error;
      }
    }
    if (!entry || !(now >= entry.from && now < entry.until)) {
      const flightKey = key;
      let pending = inflight.get(flightKey);
      if (!pending) {
        pending = (async () => {
          const { sql, values } = homeReadQuery(filters, params, now);
          const [snapshot] = await read(sql, values);
          checkReadGeneration(params, snapshot?.generation);
          const boundary = new Date(snapshot.next_change).getTime();
          const result = {
            snapshot,
            data: homeReadRecord(snapshot),
            from: now,
            until: boundary,
          };
          // A publication racing the aggregation is never cached under the old fence.
          if (
            homeStamp(snapshot) === homeStamp(meta) &&
            Number.isFinite(boundary) &&
            boundary > now
          ) {
            cache.delete(key);
            cache.set(key, result);
            while (cache.size > 64) cache.delete(cache.keys().next().value);
          }
          return result;
        })();
        inflight.set(flightKey, pending);
        pending.finally(() => inflight.delete(flightKey)).catch(() => {});
      }
      entry = await pending;
      // A request that crossed the flight's boundary needs a fresh read.
      if (!(now >= entry.from && now < entry.until) && now !== entry.from) {
        const { sql, values } = homeReadQuery(filters, params, now);
        const [snapshot] = await read(sql, values);
        checkReadGeneration(params, snapshot?.generation);
        entry = { snapshot, data: homeReadRecord(snapshot) };
      }
    }
    const data = entry.data.period
      ? { ...entry.data, period: { ...entry.data.period, asOf: now } }
      : entry.data;
    return readResponse(req, params, entry.snapshot, data, {
      periodKey,
      maxBytes: 1024 * 1024,
    });
  };
}
export const relationalHomeReadRoute = createHomeReadRoute();
