/**
 * A whole match in the legacy match record of assembleMatches() (relational-core.js
 * on main): sides, team statistics, shots, coverage and the appearance ids. Shared by
 * the reads that embed a match (performance).
 */
import { teamStats } from "./team-stats.mjs";

const SHOT_FIELDS = `'id',x.id,'playerId',api.public_id('player',x.player_id),'playerName',x.player_name,
 'teamId',api.public_id('team',x.team_id),'type',x.type,'shotType',x.shot_type,'situation',x.situation,
 'keeperId',api.public_id('player',x.keeper_id),'keeperName',x.keeper_name,'period',x.period,'x',x.x,'y',x.y,'xg',x.xg,
 'xgot',x.xgot,'minute',x.minute,'goalCrossedY',x.goal_crossed_y,'goalCrossedZ',x.goal_crossed_z,'blockedX',x.blocked_x,
 'blockedY',x.blocked_y,'minuteAdded',x.minute_added,'isGoal',x.is_goal,'isOwnGoal',x.is_own_goal,'isOnTarget',x.is_on_target,
 'isBlocked',x.is_blocked,'insideBox',x.inside_box`;

/** SQL columns of a match record for the match row `f` of api.fixtures. */
export const matchRecordColumns = ({ shots = true } = {}) => `row_to_json(f) AS fixture,
 (SELECT json_agg(s ORDER BY s.side DESC) FROM api.match_sides s WHERE s.season_id=f.season_id AND s.match_id=f.match_id) sides,
 (SELECT to_json(t) FROM api.match_team_sides t WHERE t.season_id=f.season_id AND t.match_id=f.match_id AND t.team_id=f.home_internal_id AND t.period='all') home_stats,
 (SELECT to_json(t) FROM api.match_team_sides t WHERE t.season_id=f.season_id AND t.match_id=f.match_id AND t.team_id=f.away_internal_id AND t.period='all') away_stats,
 ${shots ? `(SELECT coalesce(json_agg(json_build_object(${SHOT_FIELDS}) ORDER BY x.shot_no),'[]'::json) FROM api.match_shots x WHERE x.season_id=f.season_id AND x.match_id=f.match_id)` : "'[]'::json"} shots,
 (SELECT row_to_json(d) FROM api.match_detail_state d WHERE d.season_id=f.season_id AND d.match_id=f.match_id) state,
 (SELECT json_build_object('listed',count(*),'played',count(*) FILTER(WHERE a.minutes>0),
   'rated',count(*) FILTER(WHERE a.minutes>0 AND a.rating IS NOT NULL),'xg',count(*) FILTER(WHERE a.minutes>0 AND a.xg IS NOT NULL),
   'xa',count(*) FILTER(WHERE a.minutes>0 AND a.xa IS NOT NULL),
   'ids',coalesce(json_agg(f.id||':'||api.public_id('player',a.player_id) ORDER BY api.public_id('player',a.player_id)),'[]'::json))
   FROM api.player_appearances a WHERE a.season_id=f.season_id AND a.match_id=f.match_id) players,
 f.referee AS referee,
 f.stadium AS stadium`;

const strip = (row) => (row ? Object.fromEntries(Object.entries(row).filter(([k]) => k.startsWith("for_")).map(([k, v]) => [k.slice(4), v])) : null);

/** The legacy match object, or null when the match's details are not collected
 * (`allowPending`: the record of a scored match whose details are still coming). */
export function assembleMatch(r, { statKeys, allowPending = false } = {}) {
  const f = r?.fixture;
  const state = r?.state || {};
  if (!f || (!state.detail_collected && !allowPending)) return null;
  const sides = Object.fromEntries((r.sides || []).map((s) => [s.side, s]));
  const side = (name) => {
    const s = sides[name] || {};
    return {
      id: f[name + "_team_id"], name: f[name + "_name"], imageUrl: f[name + "_image_url"], formation: s.formation ?? null,
      coach: s.coach ?? null, score: f["score_" + name], xg: s.xg ?? null, shots: s.shots ?? null,
      shotsOnTarget: s.shots_on_target ?? null, possession: s.possession ?? null, lineupConfirmed: s.lineup_confirmed ?? null,
    };
  };
  const n = r.players || {};
  return {
    id: f.id, season: f.season, leagueId: f.league_id, league: f.league_name, country: f.country, date: f.day,
    timeUtc: f.time_utc, status: f.status, roundName: f.round_name, hasPlayoff: f.has_playoff,
    referee: r.referee ?? null, stadium: r.stadium ?? null, home: side("home"), away: side("away"),
    shots: r.shots || [],
    stats: teamStats(strip(r.home_stats), strip(r.away_stats), statKeys),
    coverage: {
      players: Boolean(state.player_stats_ok) && n.listed > 0, playerStats: n.played > 0, ratings: n.rated > 0,
      xg: n.xg > 0, xa: n.xa > 0, shots: Boolean(state.shots_ok), teamStatsReliable: Boolean(state.team_stats_ok),
      listedPlayers: n.listed ?? 0, playedPlayers: n.played ?? 0, ratedPlayers: n.rated ?? 0, xgPlayers: n.xg ?? 0, xaPlayers: n.xa ?? 0,
    },
    warnings: [],
    warningCodes: [],
    detailCollected: Boolean(state.detail_collected),
    players: n.ids || [],
  };
}
