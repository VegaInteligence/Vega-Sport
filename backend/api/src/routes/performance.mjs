/**
 * GET /api/read/performance — one player's match, its percentiles among the season's
 * performances of the same line, and his rating rank in the match. Same parameters and
 * same response as relational-performance.js on main, read from api.player_appearances.
 *
 * The profile itself is computed by shared/player-profile.js (imported, not copied):
 * SQL returns the exact below/equal/known counts of each ranked metric, summed over the
 * peers' histogram (api.performance_distribution, 055: the calculator keeps it per
 * edition, so the read no longer ranks every appearance of the season). The histogram
 * follows the calculator: a match played a minute ago joins the peers at its next pass.
 *
 * Differences with the legacy read, by construction: an appearance id is
 * `<match id>:<player id>`; the appearance record has no `role` nor `shotAccuracy`
 * (no typed source), `statsReliable` is true; the embedded match is match-record.mjs's.
 */
import { reject, validateParams } from "../http.mjs";
import {
  bindValue,
  checkReadGeneration,
  finiteSql,
  idScopeWhere,
  parseReadScope,
  publicationSql,
  readResponse,
  readValidator,
  resolveEditions,
} from "../publication.mjs";
import { performanceProfileFromCounts, PROFILE_METRICS } from "../../../../dashboard/shared/player-profile.js";
import { assembleMatch, matchRecordColumns } from "../match-record.mjs";
import { positionLineSql } from "./players.mjs";

const APPEARANCE = /^(m_(?:[A-Za-z0-9]{6}|v\d{7})):(p_(?:[A-Za-z0-9]{6}|v\d{7}))$/;
const ranked = Object.keys(PROFILE_METRICS).filter((key) => !["goals", "assists", "xa"].includes(key));
const snake = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
// Peer line of shared/player-profile.js peerGroup(): position line, else a keeper by saves, else outfield (F).
// agg.performance_values (055) files the peers the same way; the metrics are defined there.
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

/** The CTEs counting the peers of the `target` CTE (one api.player_appearances row) below
 * and tied with it, per metric: `season` is the bound season id, `scoped` the bound
 * editions of the scope. A player of no known line ('F') is ranked among every outfield line. */
export const peerCountsSql = (season, scoped) => `lines AS MATERIALIZED (
        SELECT unnest(CASE WHEN g.line='F' THEN ARRAY['D','M','O','F'] ELSE ARRAY[g.line] END) AS profile_group
        FROM (SELECT ${peerGroupSql("t")} AS line FROM target t) g),
      own AS MATERIALIZED (SELECT v.metric,v.value FROM target t JOIN api.performance_values v
        ON v.season_id=${season} AND v.match_id=t.match_id AND v.player_id=t.player_id),
      counts AS MATERIALIZED (SELECT d.metric,sum(d.appearances) AS known,
        coalesce(sum(d.appearances) FILTER(WHERE d.value<o.value),0) AS below,
        coalesce(sum(d.appearances) FILTER(WHERE d.value=o.value),0) AS equal
        FROM lines l JOIN api.performance_distribution d ON d.profile_group=l.profile_group AND d.competition_season_id=ANY(${scoped})
        LEFT JOIN own o ON o.metric=d.metric GROUP BY d.metric)`;
export const PEER_COUNTS = `json_object_agg(c.metric,json_build_object('known',c.known,'below',c.below,'equal',c.equal))`;

/** The histogram's sums as the counts of performanceProfileFromCounts: 'appearances' is
 * the number of peers, a metric no peer has is known for none. */
export function profileCounts(sums) {
  const none = { known: 0, below: 0, equal: 0 };
  return {
    peers: Number(sums?.appearances?.known || 0),
    metrics: Object.fromEntries(ranked.map((key) => [key, sums?.[snake(key)] || none])),
  };
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
    const editions = await resolveEditions(read, scope);
    const found = (keys) =>
      `SELECT a.* FROM api.player_appearances a WHERE a.match_id=api.internal_id('match',${bindValue(keys, ids[1])})
       AND a.player_id=api.internal_id('player',${bindValue(keys, ids[2])}) AND ${idScopeWhere("a", scope, editions, keys)}`;
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
    // The season as a bound id: only its partitions are planned and read.
    const season = `${bindValue(values, editions.seasonId)}::smallint`,
      scoped = `${bindValue(values, editions.ids)}::int[]`;
    const sql = `WITH publication AS MATERIALIZED (${publication}),target AS MATERIALIZED (${target}),
      ${peerCountsSql(season, scoped)},
      f AS MATERIALIZED (SELECT x.* FROM api.fixtures x JOIN target t ON x.season_id=${season} AND x.match_id=t.match_id)
      SELECT publication.*,
        (SELECT row_to_json(r) FROM (SELECT t.*,f.id AS match_key,f.id||':'||api.public_id('player',t.player_id) AS appearance_id,
           api.public_id('player',t.player_id) AS player_key,api.public_id('team',t.team_id) AS team_key FROM target t,f) r) AS appearance,
        (SELECT ${PEER_COUNTS} FROM counts c) AS profile_counts,
        (SELECT CASE WHEN ${finiteSql("t.rating")} THEN json_build_object(
           'rank',1+(SELECT count(*) FROM api.player_appearances a WHERE a.season_id=${season} AND a.match_id=t.match_id AND ${finiteSql("a.rating")} AND a.rating>t.rating),
           'total',(SELECT count(*) FROM api.player_appearances a WHERE a.season_id=${season} AND a.match_id=t.match_id AND ${finiteSql("a.rating")})) END FROM target t) AS rank,
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
        profile: performanceProfileFromCounts(row, profileCounts(snapshot.profile_counts)),
        rank: snapshot.rank || null,
      },
      { maxBytes: 256 * 1024 },
    );
  };
}
