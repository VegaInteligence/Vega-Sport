/**
 * Team statistics of a match in the legacy form: one entry per provider key, in the
 * site's editorial order (frontend/src/services/match-data.js on main), read from the
 * typed columns of api.match_team_sides (for_* / against_*). Key -> column follows
 * vega/schema_contract.py; a Python drift test compares both lists with this one.
 *
 * Legacy differences: the provider's title and raw display string are not stored
 * (typed tables only), so `label` is null (the site has its own labels) and
 * `homeRaw`/`awayRaw` repeat the numbers; `reliable` is true.
 */
export const TEAM_STAT_KEYS = [
  ["BallPossesion", "possession_pct", "integer"],
  ["total_shots", "total_shots", "integer"],
  ["ShotsOnTarget", "shots_on_target", "integer"],
  ["ShotsOffTarget", "shots_off_target", "integer"],
  ["blocked_shots", "blocked_shots", "integer"],
  ["shots_inside_box", "shots_inside_box", "integer"],
  ["shots_outside_box", "shots_outside_box", "integer"],
  ["big_chance", "big_chances", "integer"],
  ["big_chance_missed_title", "big_chances_missed", "integer"],
  ["shots_woodwork", "shots_woodwork", "integer"],
  ["expected_goals", "xg", "double"],
  ["expected_goals_non_penalty", "npxg", "double"],
  ["expected_goals_open_play", "xg_open_play", "double"],
  ["expected_goals_set_play", "xg_set_play", "double"],
  ["expected_goals_on_target", "xgot", "double"],
  ["passes", "passes", "integer"],
  ["accurate_passes", "accurate_passes", "integer"],
  ["opposition_half_passes", "opposition_half_passes", "integer"],
  ["own_half_passes", "own_half_passes", "integer"],
  ["long_balls_accurate", "long_balls_accurate", "integer"],
  ["accurate_crosses", "accurate_crosses", "integer"],
  ["touches_opp_box", "touches_opp_box", "integer"],
  ["corners", "corners", "integer"],
  ["player_throws", "throw_ins", "integer"],
  ["duel_won", "duels_won", "integer"],
  ["ground_duels_won", "ground_duels_won", "integer"],
  ["aerials_won", "aerials_won", "integer"],
  ["dribbles_succeeded", "dribbles_succeeded", "integer"],
  ["matchstats.headers.tackles", "tackles", "integer"],
  ["interceptions", "interceptions", "integer"],
  ["clearances", "clearances", "integer"],
  ["shot_blocks", "shot_blocks", "integer"],
  ["keeper_saves", "keeper_saves", "integer"],
  ["fouls", "fouls", "integer"],
  ["yellow_cards", "yellow_cards", "integer"],
  ["red_cards", "red_cards", "integer"],
  ["Offsides", "offsides", "integer"],
];

/** [{key,label,home,away,homeRaw,awayRaw,format,reliable}] for the keys either side has. */
export function teamStats(home, away, keys = TEAM_STAT_KEYS) {
  return keys
    .filter(([, column]) => home?.[column] != null || away?.[column] != null)
    .map(([key, column, format]) => ({
      key,
      label: null,
      home: home?.[column] ?? null,
      away: away?.[column] ?? null,
      homeRaw: home?.[column] ?? null,
      awayRaw: away?.[column] ?? null,
      format,
      reliable: true,
    }));
}
