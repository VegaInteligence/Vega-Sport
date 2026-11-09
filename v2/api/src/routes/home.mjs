/**
 * GET /api/read/home — the home page in one read: the week's results, the match and
 * player of the week, the mini tables, the season leaders, the upcoming highlights
 * (favourites first) and the season markers. Same parameters, same editorial weights
 * and same response as relational-home.js on main, read from the v2 api views.
 *
 * Differences with the legacy read, by construction of v2 (listed for the parity
 * comparison):
 * - a finished match with its final score counts as a result as soon as the score is
 *   known (legacy: once the partition with its details was published); its record says
 *   `detailCollected: false` until the details arrive;
 * - Champions League rounds come from the matches' rounds (legacy: the matchdays
 *   catalogue);
 * - no projection table nor process cache: the read is computed per request and cached
 *   by CloudFront (doc "Accueil": no table of its own);
 * - appearance and match records are those of performance.mjs and match-record.mjs.
 */
import { reject, validateParams } from "../http.mjs";
import { EUROPE_FOCUS } from "../../../../dashboard/shared/competition-scope.js";
import { assembleMatch, matchRecordColumns } from "../match-record.mjs";
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
} from "../publication.mjs";
import { fixture } from "./matches.mjs";
import { appearanceRecord } from "./performance.mjs";

export const HOME_TOP_FIVE = EUROPE_FOCUS.slice(0, 5).map(({ id }) => id);
export const HOME_TOP_SEVEN = EUROPE_FOCUS.slice(0, 7).map(({ id }) => id);
export const HOME_UEFA = EUROPE_FOCUS.slice(7).map(({ id }) => id);
// relational-home.js on main (a test compares them).
export const HOME_SIMPLE_LEAGUES = [
  "l_3FJFUl", "l_0275VP", "l_4WFCIZ", "l_4DWyTT", "l_0ahLw8", "l_1W6idJ", "l_1Isor4", "l_3hvsne", "l_47077Y",
  "l_0ErfuF", "l_3kyHLd", "l_0ALvwF", "l_0jy5yE", "l_4QexZg", "l_4H43wr", "l_49KZaB", "l_0S1uaf", "l_1BFfna",
];
// dashboard/backend/services/relational-home.js (main), mirrored by the site's home-insights.js.
export const LATEST_WEEK_DAYS = 14;

export const HOME_FEATURED_CLUBS = [
  "t_1gkhxH", "t_4R934X", "t_0BrMnM", "t_0UCNPX", "t_2I313i", "t_2eQl9k", "t_4A7FfD", "t_41iFW3", "t_2s2eyG", "t_0xMlRV",
  "t_13gLEF", "t_0tnX1I", "t_4NZcri", "t_32jSEF", "t_3NIiXl", "t_1cpjqO", "t_386iz1", "t_2lHR8t", "t_4ZwKDn", "t_3CPHHF",
  "t_1DYf1D", "t_2toJRF", "t_0RhqmW", "t_0Mzm1V", "t_0dVrhE", "t_1TAfIz", "t_3t08JG", "t_1jOgDP", "t_4KvHFN",
];

const arraySql = (values) => `ARRAY[${values.map((value) => `'${value}'`).join(",")}]::text[]`;
const topFive = arraySql(HOME_TOP_FIVE),
  topSeven = arraySql(HOME_TOP_SEVEN),
  uefa = arraySql(HOME_UEFA),
  simpleLeagues = arraySql(HOME_SIMPLE_LEAGUES),
  bigClubs = arraySql(HOME_FEATURED_CLUBS);
const scoreSql = (value) => `(${finiteSql(value)} AND ${value}>=0 AND ${value}=trunc(${value}))`;
const jsonRows = (sql) => `(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (${sql}) r)`;
const oneRow = (sql) => `(SELECT to_jsonb(r) FROM (${sql}) r)`;
const IDENT = (prefix) => new RegExp(`^${prefix}_(?:[A-Za-z0-9]{6}|v\\d{7})$`);

export function parseHomeRead(params) {
  validateParams(params, ["season", "league", "leagues", "generation", "archive", "personalTeams", "personalPlayers"]);
  const scope = parseReadScope(params);
  if (params.has("archive") && !["0", "1"].includes(params.get("archive"))) reject(400, "Période invalide.");
  const identifiers = (key, prefix) => {
    const raw = params.get(key),
      ids = raw ? raw.split(",") : [];
    if (ids.length > 100 || ids.some((id) => !IDENT(prefix).test(id))) reject(400, "Favoris invalides.");
    return [...new Set(ids)].sort();
  };
  return {
    scope,
    archive: params.get("archive") === "1",
    personalTeams: identifiers("personalTeams", "t"),
    personalPlayers: identifiers("personalPlayers", "p"),
  };
}

// The appearance record columns of performance.mjs, for the selected appearances only.
const appearanceJson = (keys) => `SELECT a.*,fx.id AS match_key,fx.id||':'||api.public_id('player',a.player_id) AS appearance_id,
  api.public_id('player',a.player_id) AS player_key,api.public_id('team',a.team_id) AS team_key
  FROM api.player_appearances a JOIN api.fixtures fx ON fx.season_id=a.season_id AND fx.match_id=a.match_id
  WHERE (a.season_id,a.match_id,a.player_id) IN (${keys})`;

export function homeReadQuery(filters, params, now) {
  const values = [],
    b = (value) => bindValue(values, value),
    publication = publicationSql(filters.scope, values);
  const fixtureScope = scopeWhere("f", filters.scope, values),
    appearanceScope = scopeWhere("a", filters.scope, values);
  const fence = params.has("generation") ? ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${b(params.get("generation"))})` : "";
  const instant = `${b(new Date(now).toISOString())}::timestamptz`,
    personalTeams = `${b(filters.personalTeams)}::text[]`,
    personalPlayers = `${b(filters.personalPlayers)}::text[]`,
    personalSeason = b(filters.scope.season);
  const weight = (alias, home, away) => `(2*(coalesce((${alias}.${home}=ANY(${bigClubs}))::int,0)+coalesce((${alias}.${away}=ANY(${bigClubs}))::int,0))
    +CASE WHEN ${alias}.league_id='l_0bfbkO' THEN 3 WHEN ${alias}.league_id=ANY(${uefa}) THEN 1 ELSE 0 END
    +coalesce((${alias}.league_id=ANY(${topFive}))::int,0)+coalesce((rh.rank<=3)::int,0)+coalesce((ra.rank<=3)::int,0))`;
  const tableRow = (alias) => `jsonb_build_object('id',${alias}.team_id,'name',${alias}.name,'imageUrl',${alias}.image_url,'leagueId',${alias}.league_id,
    'played',${alias}.played,'points',${alias}.points,'goalsFor',${alias}.goals_for,'goalsAgainst',${alias}.goals_against,
    'cleanSheets',${alias}.clean_sheets,'results',${alias}.results,'cumulative',${alias}.cumulative,
    'difference',${alias}.difference,'form',${alias}.form,'streak',${alias}.streak,'rank',${alias}.rank)`;
  const seasonRow = (alias) => `jsonb_build_object('playerId',api.public_id('player',${alias}.player_id),'name',${alias}.name,'imageUrl',${alias}.image_url,
    'team',${alias}.team,'teamId',api.public_id('team',${alias}.team_id),'date',${alias}.date,
    'lastId',api.public_id('match',${alias}.last_match_id)||':'||api.public_id('player',${alias}.player_id),'apps',${alias}.apps,
    'minutes',${alias}.minutes,'goals',${alias}.goals,'assists',${alias}.assists,'xg',${alias}.xg,'xa',${alias}.xa,
    'xgMatches',${alias}.xg_matches,'xaMatches',${alias}.xa_matches,'ratingSum',${alias}.rating_sum,'ratingMinutes',${alias}.rating_minutes,'rating',${alias}.rating)`;
  const leaders = (predicate, order, limit) => `(SELECT coalesce(jsonb_agg(${seasonRow("p")} ORDER BY ${order}),'[]'::jsonb)
    FROM (SELECT * FROM season_players WHERE ${predicate} ORDER BY ${order} LIMIT ${limit}) p)`;
  const sql = `/*vega:v2:home*/
WITH publication AS MATERIALIZED (${publication}),
fixture_source AS MATERIALIZED (
 SELECT f.*,f.kickoff_at explicit_time FROM api.fixtures f WHERE ${fixtureScope}${fence}
), fixtures AS MATERIALIZED (
 SELECT f.*,coalesce(explicit_time,(f.day+time '12:00') AT TIME ZONE 'UTC') kickoff,
 coalesce((explicit_time AT TIME ZONE 'Europe/Paris')::date,f.day) local_day FROM fixture_source f
), matches AS MATERIALIZED (
 SELECT f.*,f.home_team_id home_id,f.away_team_id away_id,f.score_home home_score,f.score_away away_score FROM fixtures f
 WHERE f.status='finished' AND ${scoreSql("f.score_home")} AND ${scoreSql("f.score_away")}
), last_finished AS (
 SELECT kickoff,local_day FROM matches WHERE kickoff<=${instant} ORDER BY kickoff DESC,id LIMIT 1
), period_anchor AS (
 -- As on main: an archive uses its last played week. A live home keeps the latest week
 -- with results while the current week has none (Monday morning, international
 -- breaks), as long as that result is under ${LATEST_WEEK_DAYS} days old.
 SELECT CASE WHEN ${filters.archive} OR latest THEN l.kickoff ELSE ${instant} END anchor,coalesce(latest,false) latest
 FROM (SELECT 1) one LEFT JOIN last_finished l ON true CROSS JOIN LATERAL (SELECT NOT ${filters.archive}
 AND l.local_day<date_trunc('week',${instant} AT TIME ZONE 'Europe/Paris')::date
 AND l.local_day>(${instant} AT TIME ZONE 'Europe/Paris')::date-${LATEST_WEEK_DAYS} latest) fallback
), period AS (
 SELECT date_trunc('week',anchor AT TIME ZONE 'Europe/Paris')::date start_day,
 date_trunc('week',anchor AT TIME ZONE 'Europe/Paris')::date+6 end_day,
 (${instant} AT TIME ZONE 'Europe/Paris')::date as_of_day,latest FROM period_anchor
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
 SELECT t.* FROM table_totals t LEFT JOIN api.competitions c ON c.id=t.league_id
 WHERE t.played>0 AND t.team_count>=4 ORDER BY coalesce(array_position(${topSeven},t.league_id),99),${normalizedSql("c.name")},t.league_id LIMIT 8
), weekly AS MATERIALIZED (
 SELECT m.*,${weight("m", "home_id", "away_id")} editorial_weight,
 4*(coalesce((m.home_id=ANY(${bigClubs}))::int,0)+coalesce((m.away_id=ANY(${bigClubs}))::int,0))
 +coalesce((rh.rank<=4)::int,0)*2+coalesce((ra.rank<=4)::int,0)*2
 +coalesce((rh.rank<=3 AND ra.rank<=3)::int,0)*2+(m.league_id='l_0bfbkO')::int*3
 +(m.league_id=ANY(${topFive}))::int+(EXISTS(SELECT 1 FROM api.match_shots sh WHERE sh.season_id=m.season_id AND sh.match_id=m.match_id))::int showcase_weight
 FROM matches m CROSS JOIN period p LEFT JOIN ranks rh ON rh.team_id=m.home_id LEFT JOIN ranks ra ON ra.team_id=m.away_id
 WHERE m.local_day BETWEEN p.start_day AND p.end_day AND m.local_day<=p.as_of_day
 AND (m.explicit_time IS NULL OR m.explicit_time<=${instant})
), ticker_ordered AS (
 SELECT w.*,dense_rank() OVER(ORDER BY local_day DESC) day_number,
 row_number() OVER(PARTITION BY local_day ORDER BY editorial_weight DESC,kickoff DESC,id) daily_number FROM weekly w
), results AS MATERIALIZED (
 SELECT * FROM ticker_ordered WHERE day_number<=4 AND daily_number<=8
), featured AS MATERIALIZED (
 SELECT * FROM weekly ORDER BY showcase_weight DESC,kickoff DESC,id LIMIT 1
), biggest_win AS MATERIALIZED (
 SELECT w.*,abs(home_score-away_score) margin,home_score+away_score goals FROM weekly w
 WHERE abs(home_score-away_score)>=3 ORDER BY margin DESC,goals DESC,kickoff DESC,id LIMIT 1
), season_apps AS MATERIALIZED (
 SELECT a.season_id,a.match_id,a.player_id,a.team_id,a.team,a.league_id,a.date,a.minutes,a.rating,a.goals,a.assists,a.xg,a.xa,
 a.player_name AS name,a.image_url,
 row_number() OVER(ORDER BY a.league_id,a.date NULLS LAST,a.kickoff_at NULLS LAST,a.match_id,a.player_id) source_order
 FROM api.player_appearances a WHERE ${appearanceScope}${fence} AND a.minutes>=1
), season_identity AS (
 SELECT DISTINCT ON(player_id) player_id,name,image_url,team_id,team FROM season_apps ORDER BY player_id,source_order
), season_latest AS (
 SELECT DISTINCT ON(player_id) player_id,match_id,date FROM season_apps ORDER BY player_id,date DESC NULLS LAST,source_order DESC
), season_team_candidates AS (
 SELECT player_id,team_id,team,league_id,date,source_order,
 max(coalesce(date,'0001-01-01')) OVER(PARTITION BY player_id ORDER BY source_order ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prior_date
 FROM season_apps
), season_team AS (
 SELECT DISTINCT ON(player_id) player_id,team_id,team FROM season_team_candidates
 WHERE coalesce(date,'0001-01-01')>=coalesce(prior_date,'0001-01-01') AND NOT league_id=ANY(${uefa}) ORDER BY player_id,source_order DESC
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
 SELECT p.*,i.name,i.image_url,coalesce(t.team_id,i.team_id) team_id,coalesce(t.team,i.team) team,l.date,l.match_id last_match_id,
 CASE WHEN p.rating_minutes>0 THEN p.rating_sum/p.rating_minutes END rating
 FROM player_totals p JOIN season_identity i USING(player_id) JOIN season_latest l USING(player_id) LEFT JOIN season_team t USING(player_id)
), rating_minimum AS (SELECT greatest(450,round(coalesce(max(minutes),0)*0.4)) rated_min FROM season_players),
weekly_performances AS MATERIALIZED (
 SELECT DISTINCT ON(a.player_id) a.* FROM season_apps a JOIN weekly w ON w.season_id=a.season_id AND w.match_id=a.match_id
 WHERE a.minutes>=60 AND ${finiteSql("a.rating")} ORDER BY a.player_id,a.rating DESC,a.source_order
), potw AS MATERIALIZED (
 SELECT * FROM weekly_performances ORDER BY (league_id=ANY(${topFive}||${uefa})) DESC,rating DESC,coalesce(goals,0) DESC,${normalizedSql("name")},name COLLATE "C",source_order LIMIT 1
), other_performances AS MATERIALIZED (
 SELECT * FROM weekly_performances WHERE player_id IS DISTINCT FROM (SELECT player_id FROM potw)
 ORDER BY rating DESC,coalesce(goals,0) DESC,${normalizedSql("name")},name COLLATE "C",source_order LIMIT 9
), best_featured AS MATERIALIZED (
 SELECT a.* FROM season_apps a JOIN featured f ON f.season_id=a.season_id AND f.match_id=a.match_id WHERE ${finiteSql("a.rating")} ORDER BY a.rating DESC,a.source_order LIMIT 1
), recent_performances AS MATERIALIZED (
 SELECT * FROM season_apps WHERE player_id=(SELECT player_id FROM potw) AND ${finiteSql("rating")}
 ORDER BY date DESC NULLS LAST,source_order DESC LIMIT 6
), selected_appearances AS MATERIALIZED (${appearanceJson(`SELECT season_id,match_id,player_id FROM potw UNION SELECT season_id,match_id,player_id FROM other_performances
   UNION SELECT season_id,match_id,player_id FROM best_featured UNION SELECT season_id,match_id,player_id FROM recent_performances`)}
), personal_clubs AS MATERIALIZED (
 SELECT unnest(${personalTeams}) team_id UNION
 SELECT api.public_id('team',team_id) FROM (SELECT DISTINCT ON(a.player_id) a.team_id FROM api.player_appearances a
 WHERE a.season=${personalSeason} AND a.player_id IN (SELECT api.internal_id('player',k) FROM unnest(${personalPlayers}) k)
 AND a.minutes>0 AND a.team_id IS NOT NULL AND a.date IS NOT NULL
 AND (coalesce(a.country,'') NOT IN('INT','INT-2','UEFA','WORLD') OR a.league_id=ANY(${uefa}))
 ORDER BY a.player_id,a.date DESC,a.match_id DESC) p
), your_list AS MATERIALIZED (
 SELECT DISTINCT y.k player_key,api.internal_id('player',y.k) player_id FROM unnest(${personalPlayers}) y(k)
), your_matches AS MATERIALIZED (
 SELECT y.player_key,f.id match_key,a.date,a.minutes,a.rating,a.goals,a.assists,
 CASE WHEN a.team_id=f.home_internal_id THEN f.away_team_id ELSE f.home_team_id END opponent_id,
 CASE WHEN a.team_id=f.home_internal_id THEN f.away_name ELSE f.home_name END opponent,
 CASE WHEN a.team_id=f.home_internal_id THEN f.score_home ELSE f.score_away END gf,
 CASE WHEN a.team_id=f.home_internal_id THEN f.score_away ELSE f.score_home END ga
 FROM your_list y JOIN api.player_appearances a ON a.player_id=y.player_id
 JOIN api.fixtures f ON f.season_id=a.season_id AND f.match_id=a.match_id CROSS JOIN period p
 WHERE a.date BETWEEN p.start_day AND p.end_day AND a.minutes>0
), your_clubs AS MATERIALIZED (
 SELECT DISTINCT ON(y.player_id) y.player_key,y.player_id,a.player_name,a.image_url,a.team_id,a.team
 FROM your_list y JOIN api.player_appearances a ON a.player_id=y.player_id
 WHERE a.minutes>0 AND a.team_id IS NOT NULL AND a.date IS NOT NULL AND a.team_is_national IS NOT TRUE
 ORDER BY y.player_id,a.date DESC,a.match_id DESC
), your_next AS MATERIALIZED (
 SELECT c.player_key,n.* FROM your_clubs c CROSS JOIN LATERAL (
 SELECT f.id,extract(epoch FROM f.kickoff_at)*1000 time_ms,f.league_id,f.home_team_id,f.home_name,f.away_team_id,f.away_name
 FROM api.fixtures f WHERE c.team_id IN(f.home_internal_id,f.away_internal_id) AND f.status='not_started' AND f.kickoff_at>${instant}
 ORDER BY f.kickoff_at,f.id LIMIT 1) n
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
champions_stages AS (
 SELECT btrim(regexp_replace(regexp_replace(${normalizedSql("round_name")},'[-–—]',' ','g'),'[[:space:]]+',' ','g')) stage,
 (status='finished') finished FROM fixtures WHERE league_id='l_0bfbkO'
), record_keys AS MATERIALIZED (
 SELECT season_id,match_id FROM results UNION SELECT season_id,match_id FROM featured UNION SELECT season_id,match_id FROM biggest_win
 UNION SELECT season_id,match_id FROM potw UNION SELECT season_id,match_id FROM other_performances
), records AS (
 SELECT f.id,${matchRecordColumns({ shots: true })} FROM api.fixtures f WHERE (f.season_id,f.match_id) IN (SELECT season_id,match_id FROM record_keys)
)
SELECT publication.*,
 (SELECT min(change_at) FROM (
   SELECT kickoff AS change_at FROM matches
   UNION ALL SELECT kickoff FROM fixtures
   UNION ALL SELECT kickoff - interval '7 days' FROM fixtures
   UNION ALL SELECT (((${instant} AT TIME ZONE 'Europe/Paris')::date+1)::timestamp AT TIME ZONE 'Europe/Paris')
 ) changes WHERE change_at > ${instant}) AS next_change,
 (SELECT CASE WHEN start_day IS NULL THEN null ELSE jsonb_build_object('start',start_day,'end',end_day,'current',${!filters.archive},'latest',latest,'asOf',${b(now)}::float8,'asOfDay',as_of_day) END FROM period) period,
 (SELECT count(*)::int FROM weekly) result_count,
 (SELECT coalesce(jsonb_agg(id ORDER BY kickoff DESC,id),'[]'::jsonb) FROM results) results,
 (SELECT id FROM featured) featured,
 ${oneRow("SELECT id,margin,goals FROM biggest_win")} biggest_win,
 (SELECT coalesce(jsonb_object_agg(r.id,to_jsonb(r)),'{}'::jsonb) FROM records r) records,
 ${oneRow("SELECT s.* FROM selected_appearances s JOIN potw p ON p.season_id=s.season_id AND p.match_id=s.match_id AND p.player_id=s.player_id")} potw,
 (SELECT f.id FROM potw p JOIN fixtures f ON f.season_id=p.season_id AND f.match_id=p.match_id) potw_match,
 (SELECT ${seasonRow("s")} FROM season_players s JOIN potw p USING(player_id)) potw_season,
 ${jsonRows("SELECT s.* FROM selected_appearances s JOIN recent_performances p ON p.season_id=s.season_id AND p.match_id=s.match_id AND p.player_id=s.player_id ORDER BY p.date NULLS FIRST,p.source_order")} potw_recent,
 ${oneRow("SELECT s.* FROM selected_appearances s JOIN best_featured p ON p.season_id=s.season_id AND p.match_id=s.match_id AND p.player_id=s.player_id")} best_featured,
 ${jsonRows(`SELECT s.* FROM selected_appearances s JOIN other_performances p ON p.season_id=s.season_id AND p.match_id=s.match_id AND p.player_id=s.player_id
   ORDER BY p.rating DESC,coalesce(p.goals,0) DESC,${normalizedSql("p.name")},p.name COLLATE "C",p.source_order`)} others,
 (SELECT coalesce(jsonb_agg(DISTINCT f.id),'[]'::jsonb) FROM other_performances o JOIN fixtures f ON f.season_id=o.season_id AND f.match_id=o.match_id) other_matches,
 jsonb_build_object('goals',${leaders("goals>0", "goals DESC,coalesce(xg,0) DESC,first_order", 10)},
 'assists',${leaders("assists>0", "assists DESC,coalesce(xa,0) DESC,first_order", 10)},
 'clinical',${leaders("goals>=4 AND xg IS NOT NULL", "goals-xg DESC,first_order", 8)},
 'wasteful',${leaders("xg>=3", "goals-xg,first_order", 8)},
 'rating',${leaders("rating IS NOT NULL AND minutes>=(SELECT rated_min FROM rating_minimum)", "rating DESC,first_order", 10)},
 'ratedMin',(SELECT rated_min FROM rating_minimum)) leaders,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('leagueId',t.league_id,'played',t.played,'games',t.games,'teamCount',t.team_count,
 'rows',(SELECT jsonb_agg(${tableRow("r")} ORDER BY r.rank) FROM ranked r WHERE r.league_id=t.league_id AND r.rank<=6))
 ORDER BY coalesce(array_position(${topSeven},t.league_id),99),${normalizedSql("c.name")},t.league_id),'[]'::jsonb)
 FROM displayed_tables t LEFT JOIN api.competitions c ON c.id=t.league_id) tables,
 (SELECT coalesce(jsonb_agg(jsonb_build_array(team_id,jsonb_build_object('id',team_id,'rank',rank,'leagueId',league_id,'form',form)) ORDER BY team_id),'[]'::jsonb) FROM ranks) ranks,
 (SELECT ${tableRow("s")} FROM streak s) streak,
 (SELECT coalesce(jsonb_agg(${tableRow("d")}||jsonb_build_object('perGame',d.per_game) ORDER BY d.per_game,d.clean_sheets DESC,d.league_id,d.rank),'[]'::jsonb) FROM defences d) defences,
 ${jsonRows("SELECT * FROM upcoming ORDER BY highlight_order LIMIT 5")} highlights,
 (SELECT coalesce(jsonb_agg(to_jsonb(x)-'best' ORDER BY x.best DESC NULLS LAST,x.name,x.player_id),'[]'::jsonb) FROM (
  SELECT c.player_key player_id,c.player_name name,c.image_url,api.public_id('team',c.team_id) team_id,c.team,
  (SELECT max(w.rating) FROM your_matches w WHERE w.player_key=c.player_key) best,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('matchId',w.match_key,'date',w.date,'minutes',w.minutes,'rating',w.rating,'goals',w.goals,
    'assists',w.assists,'opponentId',w.opponent_id,'opponent',w.opponent,'score',jsonb_build_array(w.gf,w.ga)) ORDER BY w.date,w.match_key),'[]'::jsonb)
   FROM your_matches w WHERE w.player_key=c.player_key) matches,
  (SELECT to_jsonb(n)-'player_key' FROM your_next n WHERE n.player_key=c.player_key) next
  FROM your_clubs c) x WHERE jsonb_array_length(x.matches)>0 OR x.next IS NOT NULL) your_players,
 ${oneRow("SELECT u.* FROM upcoming u JOIN streak s ON s.team_id IN(u.home_team_id,u.away_team_id) ORDER BY u.highlight_order LIMIT 1")} streak_next,
 (SELECT coalesce(avg(least(1,played::float8/games)),0) FROM table_totals t WHERE games>0
 AND (league_id=ANY(${topFive}) OR NOT EXISTS(SELECT 1 FROM table_totals WHERE games>0 AND league_id=ANY(${topFive})))) season_progress,
 EXISTS(SELECT 1 FROM season_players) has_season_players,
 (EXISTS(SELECT 1 FROM champions_stages WHERE stage ~ '^(1/2|semi ?finals?|demi finales?|final|finale)$' AND finished)
 OR (SELECT count(*)>=8 AND bool_and(finished) FROM champions_stages WHERE stage ~ '^(1/4|quarter ?finals?|quarts? de finale)$')) race_open,
 ${jsonRows("SELECT c.* FROM api.competitions c WHERE c.id IN(SELECT league_id FROM matches UNION SELECT league_id FROM fixtures) ORDER BY c.id")} competitions
FROM publication`;
  return { sql, values };
}

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
  const records = snapshot.records || {};
  // A result row carries its sides only (legacy assembleMatches without children);
  // the featured match also its shots, statistics and coverage.
  const match = (id, { full = false } = {}) => {
    const m = id ? assembleMatch(records[id], { allowPending: true }) : null;
    if (!m) return null;
    m.players = [];
    if (!full) Object.assign(m, { shots: [], stats: [], coverage: {} });
    return m;
  };
  const appearance = (value) => (value ? appearanceRecord(value) : null);
  return {
    period: snapshot.period,
    resultCount: snapshot.result_count,
    results: (snapshot.results || []).map((id) => match(id)),
    featured: match(snapshot.featured, { full: true }),
    bestOfFeatured: appearance(snapshot.best_featured),
    potw: appearance(snapshot.potw),
    potwMatch: match(snapshot.potw_match),
    potwSeason: snapshot.potw_season,
    potwRecent: (snapshot.potw_recent || []).map(appearance),
    others: (snapshot.others || []).map(appearance),
    otherMatches: (snapshot.other_matches || []).sort().map((id) => match(id)),
    leaders: snapshot.leaders,
    tables: snapshot.tables || [],
    ranks: snapshot.ranks || [],
    highlights: (snapshot.highlights || []).map(upcomingRecord),
    streak: snapshot.streak,
    defences: snapshot.defences || [],
    win: snapshot.biggest_win ? { match: match(snapshot.biggest_win.id), margin: snapshot.biggest_win.margin, goals: snapshot.biggest_win.goals } : null,
    streakNext: upcomingRecord(snapshot.streak_next),
    // « Vos joueurs cette semaine » (v2 doc, retenu): each followed player's matches of the
    // displayed week and the next match of his latest club.
    yourPlayers: (snapshot.your_players || []).map((p) => ({
      playerId: p.player_id, name: p.name, imageUrl: p.image_url ?? null, teamId: p.team_id, team: p.team, matches: p.matches,
      next: p.next
        ? { id: p.next.id, time: Number(p.next.time_ms), leagueId: p.next.league_id,
            home: { id: p.next.home_team_id, name: p.next.home_name }, away: { id: p.next.away_team_id, name: p.next.away_name } }
        : null,
    })),
    seasonProgress: snapshot.season_progress,
    hasSeasonPlayers: snapshot.has_season_players,
    raceOpen: Boolean(snapshot.race_open),
    competitions: (snapshot.competitions || []).map((c) => ({
      id: c.id, name: c.name, country: c.country, providerCountry: c.country, imageUrl: c.image_url, seasons: [],
    })),
  };
}

export function createHomeReadRoute(read, clock = Date.now) {
  return async (req, path, params) => {
    if (path !== "/api/read/home") return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    const filters = parseHomeRead(params),
      now = clock(),
      periodKey = Math.floor(now / 60_000);
    const validated = await readValidator(req, params, filters.scope, read, { periodKey });
    if (validated) return validated;
    const { sql, values } = homeReadQuery(filters, params, now);
    const [snapshot] = await read(sql, values);
    checkReadGeneration(params, snapshot?.generation);
    const data = homeReadRecord(snapshot);
    if (data.period) data.period = { ...data.period, asOf: now };
    return readResponse(req, params, snapshot, data, { periodKey, maxBytes: 1024 * 1024 });
  };
}
