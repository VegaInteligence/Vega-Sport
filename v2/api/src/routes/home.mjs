/**
 * The home page in two reads (doc "Accueil et personnalisation", "Ce qui change en v2"):
 * - GET /api/read/home, the common read: the week's results, the match and player of the
 *   week, the mini tables, the season leaders, the big upcoming matches by editorial
 *   weight and the season markers. It depends on the scope and the time only, so
 *   CloudFront keeps one entry per scope, served stale while it is computed again
 *   (stale-while-revalidate); a new publication changes its cache key (generation);
 * - GET /api/read/home-favourites, the personal read: the favourites' upcoming matches
 *   (« Prochains matchs ») and « Vos joueurs cette semaine », never in the common cache.
 *   The site chooses the five upcoming matches from the two (home-upcoming.js).
 * The settings are data: the lists in core.editorial_lists (api.editorial_lists), the
 * weights in api.home_weight_v1, the week in api.home_period, the thresholds in
 * api.home_rules_v1 (044_home_settings.sql). Same blocks and weights as
 * relational-home.js on main.
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

// The European club cups (a competition's nature, not an editorial choice).
export const HOME_UEFA = EUROPE_FOCUS.slice(7).map(({ id }) => id);
// Upcoming matches the common read offers: more than five, so that a match leaving at
// kick-off or taken by a favourite still leaves the five places filled.
export const UPCOMING_OFFERED = 12;
// The common read: fresh for 60 s, then served stale for 5 minutes while CloudFront
// computes it again, and for a day if that fails.
export const HOME_STALE = { revalidate: 300, error: 86400 };
// The season leaderboards: [name, who qualifies, order, size] (main's relational-home.js).
const BOARDS = [
  ["goals", "goals>0", "goals DESC,coalesce(xg,0) DESC,player_id", 10],
  ["assists", "assists>0", "assists DESC,coalesce(xa,0) DESC,player_id", 10],
  ["clinical", "goals>=4 AND xg IS NOT NULL", "goals-xg DESC,player_id", 8],
  ["wasteful", "xg>=3", "goals-xg,player_id", 8],
  ["rating", "rating IS NOT NULL AND minutes>=(SELECT rated_min FROM rating_minimum)", "rating DESC,player_id", 10],
];

const arraySql = (values) => `ARRAY[${values.map((value) => `'${value}'`).join(",")}]::text[]`;
const uefa = arraySql(HOME_UEFA);
// The editorial lists (api.editorial_lists), read once per request.
const LISTS = `SELECT coalesce(array_agg(entity_key ORDER BY seq) FILTER(WHERE list_kind='featured_clubs'),'{}') clubs,
 coalesce(array_agg(entity_key ORDER BY seq) FILTER(WHERE list_kind='title_race_leagues'),'{}') title_race,
 coalesce(array_agg(entity_key ORDER BY seq) FILTER(WHERE list_kind='top_seven'),'{}') top_seven,
 coalesce((array_agg(entity_key ORDER BY seq) FILTER(WHERE list_kind='top_seven'))[1:5],'{}') top_five FROM api.editorial_lists`;
// Cast: "= ANY((SELECT …))" would compare with each row, not with the array.
const bigClubs = "(SELECT clubs FROM lists)::text[]",
  topFive = "(SELECT top_five FROM lists)::text[]",
  topSeven = "(SELECT top_seven FROM lists)::text[]",
  simpleLeagues = "(SELECT title_race FROM lists)::text[]";
const scoreSql = (value) => `(${finiteSql(value)} AND ${value}>=0 AND ${value}=trunc(${value}))`;
const jsonRows = (sql) => `(SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (${sql}) r)`;
const oneRow = (sql) => `(SELECT to_jsonb(r) FROM (${sql}) r)`;
const IDENT = (prefix) => new RegExp(`^${prefix}_(?:[A-Za-z0-9]{6}|v\\d{7})$`);

export function parseHomeRead(params, { personal = false } = {}) {
  validateParams(params, ["season", "league", "leagues", "generation", "archive", ...(personal ? ["personalTeams", "personalPlayers"] : [])]);
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
const appearanceJson = (keys, pin) => `SELECT a.*,fx.id AS match_key,fx.id||':'||api.public_id('player',a.player_id) AS appearance_id,
  api.public_id('player',a.player_id) AS player_key,api.public_id('team',a.team_id) AS team_key
  FROM api.player_appearances a JOIN api.fixtures fx ON fx.season_id=a.season_id AND fx.match_id=a.match_id
  WHERE ${pin("a")} AND ${pin("fx")} AND a.match_id=ANY(ARRAY(SELECT k.match_id FROM (${keys}) k)) AND fx.match_id=ANY(ARRAY(SELECT k.match_id FROM (${keys}) k))
  AND (a.season_id,a.match_id,a.player_id) IN (${keys})`;

/** The scope as ids (api.edition_keys, 047): its season's id and its editions. Resolved
 * before the query and bound, so the query filters on indexed ids and the planner prunes
 * the other seasons' partitions at plan time (a subquery only prunes at run time, after
 * planning every season's partitions: 39 s of planning for the Ligue 1 home). */
export const EDITIONS_SQL = `SELECT (SELECT k.season_id FROM api.season_keys k WHERE k.season=$1) AS season_id,
  coalesce((SELECT array_agg(e.competition_season_id ORDER BY e.competition_season_id) FROM api.edition_keys e
    WHERE e.season=$1 AND ($2::text[] IS NULL OR e.league_id=ANY($2::text[]))),'{}') AS ids`;
export async function resolveEditions(read, scope) {
  const [row] = await read(EDITIONS_SQL, [scope.season, scope.leagueIds]);
  return { seasonId: row?.season_id ?? null, ids: (row?.ids || []).map(Number) };
}

// The scope's fixtures and its last result, then the displayed week (api.home_period):
// the start of both reads, so that they show the same week.
const weekSql = (fixtureScope, fence, instant, archive) => `fixture_source AS MATERIALIZED (
 SELECT f.*,f.kickoff_at explicit_time FROM api.fixtures f WHERE ${fixtureScope}${fence}
), fixtures AS MATERIALIZED (
 SELECT f.*,coalesce(explicit_time,(f.day+time '12:00') AT TIME ZONE 'UTC') kickoff,
 coalesce((explicit_time AT TIME ZONE 'Europe/Paris')::date,f.day) local_day FROM fixture_source f
), matches AS MATERIALIZED (
 SELECT f.*,f.home_team_id home_id,f.away_team_id away_id,f.score_home home_score,f.score_away away_score FROM fixtures f
 WHERE f.status='finished' AND ${scoreSql("f.score_home")} AND ${scoreSql("f.score_away")}
), last_finished AS (
 SELECT kickoff,local_day FROM matches WHERE kickoff<=${instant} ORDER BY kickoff DESC,id LIMIT 1
), period AS MATERIALIZED (
 SELECT p.* FROM api.home_period(${instant},(SELECT kickoff FROM last_finished),${archive},(SELECT latest_week_days FROM rules)) p
)`;

export function homeReadQuery(filters, params, now, editions) {
  const values = [],
    b = (value) => bindValue(values, value),
    publication = publicationSql(filters.scope, values);
  // The scope as bound ids (resolveEditions): the season's partitions only, the editions by index.
  const season = b(editions.seasonId),
    ids = b(editions.ids),
    seasonPin = (alias) => `${alias}.season_id=${season}::smallint`,
    inScope = (alias) => `${seasonPin(alias)} AND ${alias}.competition_season_id=ANY(${ids}::int[])`;
  const fixtureScope = inScope("f"),
    appearanceScope = inScope("a");
  const fence = params.has("generation") ? ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${b(params.get("generation"))})` : "";
  const instant = `${b(new Date(now).toISOString())}::timestamptz`;
  const weight = (alias, home, away) =>
    `api.home_weight_v1('editorial',${alias}.league_id,${alias}.${home},${alias}.${away},rh.rank,ra.rank,false,l.clubs,l.top_five)`;
  const tableRow = (alias) => `jsonb_build_object('id',${alias}.team_id,'name',${alias}.name,'imageUrl',${alias}.image_url,'leagueId',${alias}.league_id,
    'played',${alias}.played,'points',${alias}.points,'goalsFor',${alias}.goals_for,'goalsAgainst',${alias}.goals_against,
    'cleanSheets',${alias}.clean_sheets,'results',${alias}.results,'cumulative',${alias}.cumulative,
    'difference',${alias}.difference,'form',${alias}.form,'streak',${alias}.streak,'rank',${alias}.rank)`;
  const seasonRow = (alias) => `jsonb_build_object('playerId',api.public_id('player',${alias}.player_id),'name',${alias}.name,'imageUrl',${alias}.image_url,
    'team',${alias}.team,'teamId',api.public_id('team',${alias}.team_id),'date',${alias}.date,
    'lastId',api.public_id('match',${alias}.last_match_id)||':'||api.public_id('player',${alias}.player_id),'apps',${alias}.apps,
    'minutes',${alias}.minutes,'goals',${alias}.goals,'assists',${alias}.assists,'xg',${alias}.xg,'xa',${alias}.xa,
    'xgMatches',${alias}.xg_matches,'xaMatches',${alias}.xa_matches,'ratingSum',${alias}.rating_sum,'ratingMinutes',${alias}.rating_minutes,'rating',${alias}.rating)`;
  const leaders = (key) => {
    const [, predicate, order, limit] = BOARDS.find(([name]) => name === key);
    return `(SELECT coalesce(jsonb_agg(${seasonRow("p")} ORDER BY ${order}),'[]'::jsonb)
    FROM (SELECT * FROM season_rows WHERE ${predicate} ORDER BY ${order} LIMIT ${limit}) p)`;
  };
  const sql = `/*vega:v2:home*/
WITH publication AS MATERIALIZED (${publication}),
lists AS MATERIALIZED (${LISTS}),
rules AS MATERIALIZED (SELECT * FROM api.home_rules_v1),
${weekSql(fixtureScope, fence, instant, filters.archive)}, league_sides AS MATERIALIZED (
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
 api.home_weight_v1('showcase',m.league_id,m.home_id,m.away_id,rh.rank,ra.rank,
 EXISTS(SELECT 1 FROM api.match_shots sh WHERE sh.season_id=m.season_id AND sh.match_id=m.match_id),l.clubs,l.top_five) showcase_weight
 FROM matches m CROSS JOIN period p CROSS JOIN lists l LEFT JOIN ranks rh ON rh.team_id=m.home_id LEFT JOIN ranks ra ON ra.team_id=m.away_id
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
), season_players AS MATERIALIZED (
 -- The season's totals from agg.player_season_stats (api.home_season_players, 046), summed
 -- over the scope's editions: never every appearance of the season (doc "Ce qui change en v2").
 SELECT s.player_id,sum(s.appearances)::int apps,sum(s.minutes) minutes,sum(s.goals) goals,sum(s.assists) assists,
 CASE WHEN sum(s.xg_matches)=sum(s.appearances) THEN sum(s.xg) END xg,
 CASE WHEN sum(s.xa_matches)=sum(s.appearances) THEN sum(s.xa) END xa,
 sum(s.xg_matches)::int xg_matches,sum(s.xa_matches)::int xa_matches,
 sum(s.rating_sum) rating_sum,sum(s.rating_minutes) rating_minutes,
 CASE WHEN sum(s.rating_minutes)>0 THEN sum(s.rating_sum)/sum(s.rating_minutes) END rating
 FROM api.home_season_players s WHERE s.competition_season_id=ANY(${ids}::int[]) AND s.appearances>0
 GROUP BY s.player_id
), rating_minimum AS (SELECT greatest(450,round(coalesce(max(minutes),0)*0.4)) rated_min FROM season_players),
week_apps AS MATERIALIZED (
 -- The week's appearances only (the player of the week, the others, the featured match).
 SELECT a.season_id,a.match_id,a.player_id,a.team_id,a.team,a.league_id,a.date,a.kickoff_at,a.minutes,a.rating,a.goals,a.assists,a.xg,a.xa,
 a.player_name AS name,a.image_url,
 row_number() OVER(ORDER BY a.league_id,a.date NULLS LAST,a.kickoff_at NULLS LAST,a.match_id,a.player_id) source_order
 FROM api.player_appearances a JOIN weekly w ON w.season_id=a.season_id AND w.match_id=a.match_id
 WHERE ${seasonPin("a")} AND a.match_id=ANY(ARRAY(SELECT match_id FROM weekly)) AND a.minutes>=1
), weekly_performances AS MATERIALIZED (
 SELECT DISTINCT ON(a.player_id) a.* FROM week_apps a
 WHERE a.minutes>=60 AND ${finiteSql("a.rating")} ORDER BY a.player_id,a.rating DESC,a.source_order
), potw AS MATERIALIZED (
 SELECT * FROM weekly_performances ORDER BY (league_id=ANY(${topFive}||${uefa})) DESC,rating DESC,coalesce(goals,0) DESC,${normalizedSql("name")},name COLLATE "C",source_order LIMIT 1
), other_performances AS MATERIALIZED (
 SELECT * FROM weekly_performances WHERE player_id IS DISTINCT FROM (SELECT player_id FROM potw)
 ORDER BY rating DESC,coalesce(goals,0) DESC,${normalizedSql("name")},name COLLATE "C",source_order LIMIT 9
), best_featured AS MATERIALIZED (
 SELECT a.* FROM week_apps a JOIN featured f ON f.season_id=a.season_id AND f.match_id=a.match_id WHERE ${finiteSql("a.rating")} ORDER BY a.rating DESC,a.source_order LIMIT 1
), recent_performances AS MATERIALIZED (
 SELECT a.*,row_number() OVER(ORDER BY a.date NULLS LAST,a.kickoff_at NULLS LAST,a.match_id) source_order FROM (
  SELECT a.* FROM api.player_appearances a WHERE a.player_id=(SELECT player_id FROM potw) AND ${appearanceScope} AND a.minutes>=1 AND ${finiteSql("a.rating")}
  ORDER BY a.date DESC NULLS LAST,a.kickoff_at DESC NULLS LAST,a.match_id DESC LIMIT 6) a
), leader_ids AS MATERIALIZED (
 ${BOARDS.map(([, predicate, order, limit]) => `(SELECT player_id FROM season_players WHERE ${predicate} ORDER BY ${order} LIMIT ${limit})`).join(" UNION ")}
 UNION SELECT player_id FROM potw
), identities AS MATERIALIZED (
 -- Name, photo, latest club (a league match first) and last match, for the players shown.
 SELECT l.player_id,last.name,last.image_url,last.date,last.match_id last_match_id,
 coalesce(club.team_id,last.team_id) team_id,coalesce(club.team,last.team) team
 FROM leader_ids l
 CROSS JOIN LATERAL (SELECT a.player_name name,a.image_url,a.date,a.match_id,a.team_id,a.team FROM api.player_appearances a
  WHERE a.player_id=l.player_id AND ${appearanceScope} AND a.minutes>=1 ORDER BY a.date DESC NULLS LAST,a.kickoff_at DESC NULLS LAST,a.match_id DESC LIMIT 1) last
 LEFT JOIN LATERAL (SELECT a.team_id,a.team FROM api.player_appearances a
  WHERE a.player_id=l.player_id AND ${appearanceScope} AND a.minutes>=1 AND NOT a.league_id=ANY(${uefa})
  ORDER BY a.date DESC NULLS LAST,a.kickoff_at DESC NULLS LAST,a.match_id DESC LIMIT 1) club ON true
), season_rows AS MATERIALIZED (
 SELECT p.*,i.name,i.image_url,i.team_id,i.team,i.date,i.last_match_id FROM season_players p JOIN identities i USING(player_id)
), selected_appearances AS MATERIALIZED (${appearanceJson(`SELECT season_id,match_id,player_id FROM potw UNION SELECT season_id,match_id,player_id FROM other_performances
   UNION SELECT season_id,match_id,player_id FROM best_featured UNION SELECT season_id,match_id,player_id FROM recent_performances`, seasonPin)}
), upcoming_candidates AS MATERIALIZED (
 -- The big matches of the next days in the scope, by editorial weight; the favourites'
 -- matches come from the personal read.
 SELECT f.*,extract(epoch FROM f.kickoff)*1000 time_ms,(f.kickoff AT TIME ZONE 'Europe/Paris')::date upcoming_day,
 ${weight("f", "home_team_id", "away_team_id")} editorial_weight
 FROM fixtures f CROSS JOIN lists l LEFT JOIN ranks rh ON rh.team_id=f.home_team_id LEFT JOIN ranks ra ON ra.team_id=f.away_team_id
 WHERE f.status='not_started' AND f.kickoff>${instant}
 AND f.kickoff<=${instant}+make_interval(days=>(SELECT upcoming_days FROM rules))
 AND coalesce(f.home_name,'')<>'' AND coalesce(f.away_name,'')<>''
), upcoming AS MATERIALIZED (
 SELECT u.*,(league_id=ANY(${uefa})) europe,
 row_number() OVER(ORDER BY editorial_weight DESC,kickoff,id) highlight_order
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
 SELECT f.id,${matchRecordColumns({ shots: true })} FROM api.fixtures f
 WHERE ${seasonPin("f")} AND f.match_id=ANY(ARRAY(SELECT match_id FROM record_keys)) AND (f.season_id,f.match_id) IN (SELECT season_id,match_id FROM record_keys)
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
 (SELECT ${seasonRow("s")} FROM season_rows s JOIN potw p USING(player_id)) potw_season,
 ${jsonRows("SELECT s.* FROM selected_appearances s JOIN recent_performances p ON p.season_id=s.season_id AND p.match_id=s.match_id AND p.player_id=s.player_id ORDER BY p.date NULLS FIRST,p.source_order")} potw_recent,
 ${oneRow("SELECT s.* FROM selected_appearances s JOIN best_featured p ON p.season_id=s.season_id AND p.match_id=s.match_id AND p.player_id=s.player_id")} best_featured,
 ${jsonRows(`SELECT s.* FROM selected_appearances s JOIN other_performances p ON p.season_id=s.season_id AND p.match_id=s.match_id AND p.player_id=s.player_id
   ORDER BY p.rating DESC,coalesce(p.goals,0) DESC,${normalizedSql("p.name")},p.name COLLATE "C",p.source_order`)} others,
 (SELECT coalesce(jsonb_agg(DISTINCT f.id),'[]'::jsonb) FROM other_performances o JOIN fixtures f ON f.season_id=o.season_id AND f.match_id=o.match_id) other_matches,
 jsonb_build_object('goals',${leaders("goals")},'assists',${leaders("assists")},'clinical',${leaders("clinical")},
 'wasteful',${leaders("wasteful")},'rating',${leaders("rating")},
 'ratedMin',(SELECT rated_min FROM rating_minimum)) leaders,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('leagueId',t.league_id,'played',t.played,'games',t.games,'teamCount',t.team_count,
 'rows',(SELECT jsonb_agg(${tableRow("r")} ORDER BY r.rank) FROM ranked r WHERE r.league_id=t.league_id AND r.rank<=6))
 ORDER BY coalesce(array_position(${topSeven},t.league_id),99),${normalizedSql("c.name")},t.league_id),'[]'::jsonb)
 FROM displayed_tables t LEFT JOIN api.competitions c ON c.id=t.league_id) tables,
 (SELECT coalesce(jsonb_agg(jsonb_build_array(team_id,jsonb_build_object('id',team_id,'rank',rank,'leagueId',league_id,'form',form)) ORDER BY team_id),'[]'::jsonb) FROM ranks) ranks,
 (SELECT ${tableRow("s")} FROM streak s) streak,
 (SELECT coalesce(jsonb_agg(${tableRow("d")}||jsonb_build_object('perGame',d.per_game) ORDER BY d.per_game,d.clean_sheets DESC,d.league_id,d.rank),'[]'::jsonb) FROM defences d) defences,
 ${jsonRows(`SELECT * FROM upcoming ORDER BY highlight_order LIMIT ${UPCOMING_OFFERED}`)} highlights,
 (SELECT to_jsonb(r) FROM rules r) rules,
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
        europe: Boolean(row.europe),
        weight: row.editorial_weight,
      }
    : null;

export const homeRules = (row) =>
  row
    ? {
        places: row.upcoming_places, favouritePlaces: row.favourite_places, upcomingDays: row.upcoming_days,
        favouriteDays: row.favourite_days, bigCardHours: row.big_card_hours, latestWeekDays: row.latest_week_days,
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
    rules: homeRules(snapshot.rules),
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
    const validated = await readValidator(req, params, filters.scope, read, { periodKey, ttl: 60, stale: HOME_STALE });
    if (validated) return validated;
    const { sql, values } = homeReadQuery(filters, params, now, await resolveEditions(read, filters.scope));
    const [snapshot] = await read(sql, values);
    checkReadGeneration(params, snapshot?.generation);
    const data = homeReadRecord(snapshot);
    if (data.period) data.period = { ...data.period, asOf: now };
    // A slightly old home rather than an error: served stale while computed again.
    return readResponse(req, params, snapshot, data, { periodKey, maxBytes: 1024 * 1024, ttl: 60, stale: HOME_STALE });
  };
}

/**
 * GET /api/read/home-favourites — the personal read (doc "Prochains matchs : comment on
 * choisit", steps 1 and 2, and « Vos joueurs cette semaine »):
 * - the favourites and their strength: a followed club (1), the last observed club of a
 *   followed player, his latest league or European cup match (2), the national team of a
 *   followed player, his latest international match (3); a team that is several of
 *   these keeps its strongest;
 * - their matches: every one of the next upcoming_days (7) days, and each favourite's
 *   next match whatever the competition up to favourite_days (21) days, as in the doc's
 *   international break example (France – Allemagne, then the clubs at 10 and 11 days,
 *   then France – Espagne). A match between two favourites is one match;
 * - each followed player's matches of the displayed week and his club's next match.
 * Never in the common cache (private): a visitor's favourites only change his own read.
 */
export function homeFavouritesQuery(filters, params, now, editions) {
  const values = [],
    b = (value) => bindValue(values, value),
    publication = publicationSql(filters.scope, values);
  const season = b(editions.seasonId),
    seasonPin = (alias) => `${alias}.season_id=${season}::smallint`,
    fixtureScope = `${seasonPin("f")} AND f.competition_season_id=ANY(${b(editions.ids)}::int[])`,
    // The favourites' upcoming matches and latest clubs, whatever the season shown: the
    // recent seasons' partitions only (season ids are start years).
    recent = (alias, years) => `${alias}.season_id>=${b(new Date(now).getUTCFullYear() - years)}::smallint`;
  const fence = params.has("generation") ? ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${b(params.get("generation"))})` : "";
  const instant = `${b(new Date(now).toISOString())}::timestamptz`,
    teams = `${b(filters.personalTeams)}::text[]`,
    players = `${b(filters.personalPlayers)}::text[]`;
  const sql = `/*vega:v2:home-favourites*/
WITH publication AS MATERIALIZED (${publication}),
rules AS MATERIALIZED (SELECT * FROM api.home_rules_v1),
${weekSql(fixtureScope, fence, instant, filters.archive)},
followed_players AS MATERIALIZED (
 SELECT DISTINCT k player_key,api.internal_id('player',k) player_id FROM unnest(${players}) k
), player_clubs AS MATERIALIZED (
 SELECT DISTINCT ON(y.player_id) y.player_key,a.team_id FROM followed_players y JOIN api.player_appearances a ON a.player_id=y.player_id
 WHERE ${seasonPin("a")} AND a.minutes>0 AND a.team_id IS NOT NULL AND a.date IS NOT NULL AND a.team_is_national IS NOT TRUE
 AND (coalesce(a.country,'') NOT IN('INT','INT-2','UEFA','WORLD') OR a.league_id=ANY(${uefa}))
 ORDER BY y.player_id,a.date DESC,a.match_id DESC
), player_nations AS MATERIALIZED (
 SELECT DISTINCT ON(y.player_id) y.player_key,a.team_id FROM followed_players y JOIN api.player_appearances a ON a.player_id=y.player_id
 WHERE ${recent("a", 3)} AND a.team_is_national AND a.minutes>0 AND a.date IS NOT NULL ORDER BY y.player_id,a.date DESC,a.match_id DESC
), favourite_rows AS (
 SELECT api.internal_id('team',k) team_id,1 strength,'club' reason,NULL::text player_key FROM unnest(${teams}) k
 UNION ALL SELECT team_id,2,'player_club',player_key FROM player_clubs
 UNION ALL SELECT team_id,3,'player_nation',player_key FROM player_nations
), favourites AS MATERIALIZED (
 SELECT team_id,api.public_id('team',team_id) team_key,min(strength) strength,(array_agg(reason ORDER BY strength))[1] reason,
 coalesce(array_agg(DISTINCT player_key) FILTER(WHERE player_key IS NOT NULL),'{}') players
 FROM favourite_rows WHERE team_id IS NOT NULL GROUP BY team_id
), favourite_fixtures AS MATERIALIZED (
 SELECT f.*,v.team_key favourite,v.strength,
 row_number() OVER(PARTITION BY v.team_id ORDER BY f.kickoff_at,f.id) nth
 FROM favourites v JOIN api.fixtures f ON v.team_id IN(f.home_internal_id,f.away_internal_id)
 WHERE ${recent("f", 1)} AND f.status='not_started' AND f.kickoff_at>${instant}
 AND f.kickoff_at<=${instant}+make_interval(days=>(SELECT favourite_days FROM rules))
 AND coalesce(f.home_name,'')<>'' AND coalesce(f.away_name,'')<>''
), candidates AS (
 SELECT f.id,min(f.strength) strength,array_agg(DISTINCT f.favourite) favourites FROM favourite_fixtures f
 WHERE f.nth=1 OR f.kickoff_at<=${instant}+make_interval(days=>(SELECT upcoming_days FROM rules)) GROUP BY f.id
), upcoming AS (
 SELECT DISTINCT ON(f.id) f.*,c.strength best_strength,c.favourites favourite_keys,extract(epoch FROM f.kickoff_at)*1000 time_ms,
 (f.kickoff_at AT TIME ZONE 'Europe/Paris')::date upcoming_day,(f.league_id=ANY(${uefa})) europe
 FROM candidates c JOIN favourite_fixtures f ON f.id=c.id ORDER BY f.id
), your_matches AS MATERIALIZED (
 SELECT y.player_key,f.id match_key,a.date,a.minutes,a.rating,a.goals,a.assists,
 CASE WHEN a.team_id=f.home_internal_id THEN f.away_team_id ELSE f.home_team_id END opponent_id,
 CASE WHEN a.team_id=f.home_internal_id THEN f.away_name ELSE f.home_name END opponent,
 CASE WHEN a.team_id=f.home_internal_id THEN f.score_home ELSE f.score_away END gf,
 CASE WHEN a.team_id=f.home_internal_id THEN f.score_away ELSE f.score_home END ga
 FROM followed_players y JOIN api.player_appearances a ON a.player_id=y.player_id
 JOIN api.fixtures f ON f.season_id=a.season_id AND f.match_id=a.match_id CROSS JOIN period p
 WHERE ${seasonPin("a")} AND a.date BETWEEN p.start_day AND p.end_day AND a.minutes>0
), your_clubs AS MATERIALIZED (
 SELECT DISTINCT ON(y.player_id) y.player_key,y.player_id,a.player_name,a.image_url,a.team_id,a.team
 FROM followed_players y JOIN api.player_appearances a ON a.player_id=y.player_id
 WHERE ${recent("a", 2)} AND a.minutes>0 AND a.team_id IS NOT NULL AND a.date IS NOT NULL AND a.team_is_national IS NOT TRUE
 ORDER BY y.player_id,a.date DESC,a.match_id DESC
), your_next AS MATERIALIZED (
 SELECT c.player_key,n.* FROM your_clubs c CROSS JOIN LATERAL (
 SELECT f.id,extract(epoch FROM f.kickoff_at)*1000 time_ms,f.league_id,f.home_team_id,f.home_name,f.away_team_id,f.away_name
 FROM api.fixtures f WHERE ${recent("f", 1)} AND c.team_id IN(f.home_internal_id,f.away_internal_id) AND f.status='not_started' AND f.kickoff_at>${instant}
 ORDER BY f.kickoff_at,f.id LIMIT 1) n
)
SELECT publication.*,
 (SELECT CASE WHEN start_day IS NULL THEN null ELSE jsonb_build_object('start',start_day,'end',end_day,'latest',latest) END FROM period) period,
 (SELECT to_jsonb(r) FROM rules r) rules,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('teamId',team_key,'strength',strength,'reason',reason,'players',players)
   ORDER BY strength,team_key),'[]'::jsonb) FROM favourites) favourites,
 ${jsonRows("SELECT * FROM upcoming ORDER BY kickoff_at,id")} upcoming,
 (SELECT coalesce(jsonb_agg(to_jsonb(x)-'best' ORDER BY x.best DESC NULLS LAST,x.name,x.player_id),'[]'::jsonb) FROM (
  SELECT c.player_key player_id,c.player_name name,c.image_url,api.public_id('team',c.team_id) team_id,c.team,
  (SELECT max(w.rating) FROM your_matches w WHERE w.player_key=c.player_key) best,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('matchId',w.match_key,'date',w.date,'minutes',w.minutes,'rating',w.rating,'goals',w.goals,
    'assists',w.assists,'opponentId',w.opponent_id,'opponent',w.opponent,'score',jsonb_build_array(w.gf,w.ga)) ORDER BY w.date,w.match_key),'[]'::jsonb)
   FROM your_matches w WHERE w.player_key=c.player_key) matches,
  (SELECT to_jsonb(n)-'player_key' FROM your_next n WHERE n.player_key=c.player_key) next
  FROM your_clubs c) x WHERE jsonb_array_length(x.matches)>0 OR x.next IS NOT NULL) your_players
FROM publication`;
  return { sql, values };
}

export function homeFavouritesRecord(snapshot) {
  return {
    period: snapshot.period,
    rules: homeRules(snapshot.rules),
    favourites: snapshot.favourites || [],
    upcoming: (snapshot.upcoming || []).map((row) => ({
      fixture: fixture(row),
      time: Number(row.time_ms),
      day: row.upcoming_day,
      europe: Boolean(row.europe),
      strength: row.best_strength,
      favourites: [...(row.favourite_keys || [])].sort(),
    })),
    // « Vos joueurs cette semaine » (doc, retained): each followed player's matches of
    // the displayed week and the next match of his latest club.
    yourPlayers: (snapshot.your_players || []).map((p) => ({
      playerId: p.player_id, name: p.name, imageUrl: p.image_url ?? null, teamId: p.team_id, team: p.team, matches: p.matches,
      next: p.next
        ? { id: p.next.id, time: Number(p.next.time_ms), leagueId: p.next.league_id,
            home: { id: p.next.home_team_id, name: p.next.home_name }, away: { id: p.next.away_team_id, name: p.next.away_name } }
        : null,
    })),
  };
}

export function createHomeFavouritesRoute(read, clock = Date.now) {
  return async (req, path, params) => {
    if (path !== "/api/read/home-favourites") return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    const filters = parseHomeRead(params, { personal: true }),
      now = clock(),
      periodKey = Math.floor(now / 60_000);
    if (!filters.personalTeams.length && !filters.personalPlayers.length) reject(400, "Favoris manquants.");
    const validated = await readValidator(req, params, filters.scope, read, { periodKey, personal: true });
    if (validated) return validated;
    const { sql, values } = homeFavouritesQuery(filters, params, now, await resolveEditions(read, filters.scope));
    const [snapshot] = await read(sql, values);
    checkReadGeneration(params, snapshot?.generation);
    return readResponse(req, params, snapshot, homeFavouritesRecord(snapshot), { periodKey, maxBytes: 512 * 1024, personal: true });
  };
}
