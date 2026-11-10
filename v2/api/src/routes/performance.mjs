/**
 * GET /api/read/performance — one player's match, its percentiles among the season's
 * performances of the same line, and his rating rank in the match. Same parameters and
 * same response as relational-performance.js on main, read from api.player_appearances.
 *
 * The profile itself is computed by shared/player-profile.js (imported, not copied):
 * SQL returns the exact below/equal/known counts of each ranked metric.
 *
 * Differences with the legacy read, by construction of v2: an appearance id is
 * `<match id>:<player id>`; the appearance record has no `role` nor `shotAccuracy`
 * (no typed source), `statsReliable` is true; the embedded match is match-record.mjs's.
 */
import { reject, validateParams } from "../http.mjs";
import { bindValue, checkReadGeneration, finiteSql, parseReadScope, publicationSql, readResponse, readValidator, scopeWhere } from "../publication.mjs";
import { performanceProfileFromCounts, PROFILE_METRICS, MIN_PEER_MINUTES } from "../../../../dashboard/shared/player-profile.js";
import { assembleMatch, matchRecordColumns } from "../match-record.mjs";
import { positionLineSql } from "./players.mjs";

const APPEARANCE = /^(m_(?:[A-Za-z0-9]{6}|v\d{7})):(p_(?:[A-Za-z0-9]{6}|v\d{7}))$/;
const ranked = Object.keys(PROFILE_METRICS).filter((key) => !["goals", "assists", "xa"].includes(key));
const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const number = (column) => `CASE WHEN ${finiteSql(column)} THEN ${column} END`;

// The getters of PROFILE_METRICS, in SQL (same thresholds).
function metric(alias, key) {
  const field = `${alias}.${snake(key)}`;
  if (key === "passAccuracy")
    return `CASE WHEN ${finiteSql(`${alias}.passes_accurate`)} AND ${finiteSql(`${alias}.passes_attempted`)} AND ${alias}.passes_attempted>=10 THEN ${alias}.passes_accurate/${alias}.passes_attempted*100 END`;
  if (key === "duelRate")
    return `CASE WHEN ${finiteSql(`${alias}.duels_won`)} AND ${finiteSql(`${alias}.duels_lost`)} AND ${alias}.duels_won+${alias}.duels_lost>=4 THEN ${alias}.duels_won/(${alias}.duels_won+${alias}.duels_lost)*100 END`;
  if (key === "xg" || key === "shotsOnTarget") return `CASE WHEN ${finiteSql(field)} THEN ${field} WHEN ${alias}.shots=0 THEN 0 END`;
  return number(field);
}

// Peer line of shared/player-profile.js peerGroup(): position line, else a keeper by saves, else outfield (F).
const peerGroupSql = (alias) => `CASE (${positionLineSql(`${alias}.position_number`)}) WHEN 'AM' THEN 'O' WHEN 'A' THEN 'O'
  WHEN 'G' THEN 'G' WHEN 'D' THEN 'D' WHEN 'M' THEN 'M'
  ELSE CASE WHEN ${finiteSql(`${alias}.saves`)} AND ${alias}.saves>0 THEN 'G' ELSE 'F' END END`;

// Legacy appearance record keys (appearanceRecord on main) -> api.player_appearances columns.
const RECORD = [
  "team", "league", "country", "season", "raw_pitch_x", "raw_pitch_y", "shirt_number", "minutes", "rating", "goals", "assists",
  "xg", "npxg", "xa", "xgot", "shots", "shots_on_target", "chances_created", "big_chances_created", "passes_accurate",
  "defensive_actions", "interceptions", "tackles", "recoveries", "duels_won", "duels_lost", "touches", "touches_box",
  "passes_final_third", "clearances", "blocks", "dribbles", "saves", "goals_prevented", "shots_off_target", "blocked_shots",
  "shots_woodwork", "big_chances_missed", "xg_plus_xa", "long_balls_accurate", "line_breaking_passes", "accurate_crosses",
  "corners", "throws", "offsides", "dispossessed", "dribbled_past", "headed_clearances", "aerials_won", "ground_duels_won",
  "fouls", "was_fouled", "errors_led_to_goal", "goals_conceded", "saves_inside_box", "dive_saves", "sweeper_actions",
  "high_claims", "punches", "xgot_faced", "distance_covered", "top_speed", "sprints", "running_distance", "sprinting_distance",
  "fantasy_points", "passes_attempted", "long_balls_attempted", "crosses_attempted", "ground_duels", "aerial_duels",
  "dribbles_attempted", "starter", "is_captain",
];
const camel = (k) => k.replace(/_([a-z])/g, (_, v) => v.toUpperCase());

export function appearanceRecord(t) {
  const row = { id: t.appearance_id, playerId: t.player_key, teamId: t.team_key, matchId: t.match_key, leagueId: t.league_id };
  for (const key of RECORD) row[camel(key)] = t[key] ?? null;
  return { ...row, date: t.date, statsReliable: true, name: t.player_name, imageUrl: t.image_url, positionId: t.position_number };
}

export function createPerformanceRoute(read) {
  return async (req, path, params) => {
    if (path !== "/api/read/performance") return null;
    if (!["GET", "HEAD"].includes(req.method)) reject(405, "Méthode non autorisée.");
    validateParams(params, ["season", "leagues", "league", "generation", "appearance", "include"]);
    const appearance = params.get("appearance");
    if (!appearance || appearance.length > 240 || /[\u0000- \u007f]/.test(appearance)) reject(400, "Performance invalide.");
    if (params.has("include") && params.get("include") !== "shots") reject(400, "Détail invalide.");
    const ids = appearance.match(APPEARANCE);
    if (!ids) reject(404, "Performance indisponible dans ce périmètre.");
    const scope = parseReadScope(params);
    const found = (keys) =>
      `SELECT a.* FROM api.player_appearances a WHERE a.match_id=api.internal_id('match',${bindValue(keys, ids[1])})
       AND a.player_id=api.internal_id('player',${bindValue(keys, ids[2])}) AND ${scopeWhere("a", scope, keys)}`;
    const cached = await readValidator(req, params, scope, async (sql, bindings) => {
      const keys = [...bindings];
      const [state] = await read(`WITH state AS (${sql}) SELECT state.*,EXISTS(${found(keys)}) AS appearance_exists FROM state`, keys);
      checkReadGeneration(params, state?.generation);
      if (!state.appearance_exists) reject(404, "Performance indisponible dans ce périmètre.");
      return [state];
    });
    if (cached) return cached;
    const values = [],
      publication = publicationSql(scope, values);
    const fence = params.has("generation") ? ` AND EXISTS(SELECT 1 FROM publication WHERE generation=${bindValue(values, params.get("generation"))})` : "";
    const target = `${found(values)}${fence}`;
    const cohortScope = scopeWhere("a", scope, values);
    const projection = (alias) => ranked.map((key) => `${metric(alias, key)} AS ${snake(key)}`).join(",");
    const counts = ranked
      .map((key) => {
        const c = snake(key);
        return `'${key}',json_build_object('known',count(p.${c}),'below',count(*) FILTER(WHERE p.${c}<t.${c}),'equal',count(*) FILTER(WHERE p.${c}=t.${c}))`;
      })
      .join(",");
    const sql = `WITH publication AS MATERIALIZED (${publication}),target AS MATERIALIZED (${target}),
      target_values AS MATERIALIZED (SELECT ${peerGroupSql("t")} AS profile_group,${projection("t")} FROM target t),
      peers AS NOT MATERIALIZED (SELECT ${projection("a")} FROM target_values t JOIN api.player_appearances a
        ON ${peerGroupSql("a")}=ANY(CASE WHEN t.profile_group='F' THEN ARRAY['D','M','O','F'] ELSE ARRAY[t.profile_group] END)
        WHERE ${cohortScope} AND a.minutes>=${MIN_PEER_MINUTES}),
      f AS MATERIALIZED (SELECT x.* FROM api.fixtures x JOIN target t ON x.season_id=t.season_id AND x.match_id=t.match_id)
      SELECT publication.*,
        (SELECT row_to_json(r) FROM (SELECT t.*,f.id AS match_key,f.id||':'||api.public_id('player',t.player_id) AS appearance_id,
           api.public_id('player',t.player_id) AS player_key,api.public_id('team',t.team_id) AS team_key FROM target t,f) r) AS appearance,
        (SELECT json_build_object('peers',count(*),'metrics',json_build_object(${counts})) FROM peers p CROSS JOIN target_values t) AS profile_counts,
        (SELECT CASE WHEN ${finiteSql("t.rating")} THEN json_build_object(
           'rank',1+(SELECT count(*) FROM api.player_appearances a WHERE a.season_id=t.season_id AND a.match_id=t.match_id AND ${finiteSql("a.rating")} AND a.rating>t.rating),
           'total',(SELECT count(*) FROM api.player_appearances a WHERE a.season_id=t.season_id AND a.match_id=t.match_id AND ${finiteSql("a.rating")})) END FROM target t) AS rank,
        (SELECT row_to_json(m) FROM (SELECT ${matchRecordColumns({ shots: params.get("include") === "shots" })} FROM f) m) AS match,
        (SELECT row_to_json(c) FROM api.competitions c JOIN target t ON c.id=t.league_id) AS competition
      FROM publication`;
    const [snapshot] = await read(sql, values);
    checkReadGeneration(params, snapshot?.generation);
    if (!snapshot.appearance) reject(404, "Performance indisponible dans ce périmètre.");
    const row = appearanceRecord(snapshot.appearance);
    const c = snapshot.competition;
    return readResponse(
      req,
      params,
      snapshot,
      {
        row,
        match: assembleMatch(snapshot.match),
        competition: c ? { id: c.id, name: c.name, country: c.country, providerCountry: c.country, imageUrl: c.image_url, seasons: c.seasons || [] } : null,
        profile: performanceProfileFromCounts(row, snapshot.profile_counts),
        rank: snapshot.rank || null,
      },
      { maxBytes: 256 * 1024 },
    );
  };
}
