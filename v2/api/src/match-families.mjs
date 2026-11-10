/**
 * The match detail families in the bodies the site reads (football-client.js
 * `endpointResponse`, MatchSections.jsx, PlayerData.jsx, club-facts.js, pro-match-data.js),
 * rebuilt from the typed rows of one match (031_match_details.sql).
 *
 * The vocabulary of the source (stat keys, labels, groups, display formats) is not data
 * kept per match: it is the catalogue below, taken from a real match of every family
 * (v2/tests/fixtures/match_m_08LEIz, round-trip tested). A stat the catalogue does not
 * name is not shown; labels of stats absent from that match come from the site's own
 * label list (PlayerMetrics.jsx).
 */

const PERIOD = { all: "All", first_half: "FirstHalf", second_half: "SecondHalf", extra_time: "ExtraTime", penalties: "Penalties" };
const EVENT_TYPE = { goal: "goal", substitution: "substitution", yellow_card: "yellowcard", second_yellow: "secondyellow", red_card: "redcard" };
const SHOT_OUTCOME = { goal: "Goal", saved: "AttemptSaved", miss: "Miss", post: "Post" };
const BODY_PART = { right_foot: "RightFoot", left_foot: "LeftFoot", header: "Header", other: "OtherBodyParts" };
const SITUATION = {
  regular_play: "RegularPlay", from_corner: "FromCorner", set_piece: "SetPiece", fast_break: "FastBreak", free_kick: "FreeKick",
  throw_in_set_piece: "ThrowInSetPiece", penalty: "Penalty", individual_play: "IndividualPlay",
};
const PERIOD_ORDER = ["all", "first_half", "second_half", "extra_time", "penalties"];

const present = (v) => v !== null && v !== undefined;
const put = (o, k, v) => {
  if (present(v)) o[k] = v;
  return o;
};
// Labels in the order the legacy responses list them (JSONB object keys: shortest first).
const byteLength = (s) => Buffer.byteLength(s);
const jsonbOrder = (a, b) => byteLength(a) - byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b));
const ascii = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const team = (id, name, image) => ({ id, name, image_url: image ?? null });
const person = (id, name, image) => ({ id, name, image_url: image ?? null, position_id: null });

// --- Player statistics -------------------------------------------------------------
// [label, source key, type, column | derived, total column]
const fraction = (label, key, column, total) => [label, key, "fractionWithPercentage", column, total];
const integer = (label, key, column = key) => [label, key, "integer", column];
const double = (label, key, column) => [label, key, "double", column];
const DERIVED = {
  shotmap: (r) => (r.has_shot ? 1 : 0),
  xg_and_xa: (r) => (present(r.xg) || present(r.xa) ? (r.xg ?? 0) + (r.xa ?? 0) : null),
};
const SHOT_ACCURACY = ["Shot accuracy", "shot_accuracy", "fractionWithPercentage", "shot_accuracy"];
const PASSES = fraction("Accurate passes", "accurate_passes", "accurate_passes", "accurate_passes_total");
const LONG_BALLS = fraction("Accurate long balls", "long_balls_accurate", "long_balls_accurate", "long_balls_total");
const CROSSES = fraction("Accurate crosses", "accurate_crosses", "accurate_crosses", "accurate_crosses_total");
const DRIBBLES = fraction("Successful dribbles", "dribbles_succeeded", "dribbles_succeeded", "dribbles_total");
const AERIALS = fraction("Aerial duels won", "aerials_won", "aerials_won", "aerials_total");
const GROUND = fraction("Ground duels won", "ground_duels_won", "ground_duels_won", "ground_duels_total");
const TACKLES = integer("Tackles", "matchstats.headers.tackles", "tackles");
const DUELS = [integer("Duels won", "duel_won", "duels_won"), integer("Duels lost", "duel_lost", "duels_lost"),
  integer("Was fouled", "was_fouled"), integer("Fouls committed", "fouls"), AERIALS, GROUND];

export const PLAYER_LAYOUTS = {
  outfield: [
    ["top_stats", "Top stats", [
      integer("Goals", "goals"), double("Rating", "rating_title", "rating"), integer("Assists", "assists"),
      ["Shotmap", "", "boolean", "shotmap"], double("xG + xA", "xg_and_xa", "xg_and_xa"), integer("Total shots", "total_shots"),
      SHOT_ACCURACY, integer("Minutes played", "minutes_played"), PASSES, integer("Chances created", "chances_created"),
      integer("Shots on target", "ShotsOnTarget", "shots_on_target"), integer("Shots off target", "ShotsOffTarget", "shots_off_target"),
      integer("Defensive actions", "defensive_actions"), double("Expected goals (xG)", "expected_goals", "xg"),
      double("Expected assists (xA)", "expected_assists", "xa"), double("Expected goals on target (xGOT)", "expected_goals_on_target_variant", "xgot"),
      integer("Blocked shots", "blocked_shots"), integer("Big chances created", "big_chance_created_team_title", "big_chances_created"),
      integer("Own goal", "owngoal", "own_goals"),
    ]],
    ["attack", "Attack", [
      integer("Touches", "touches"), integer("Dispossessed", "dispossessed"), double("xG Non-penalty", "expected_goals_non_penalty", "npxg"),
      LONG_BALLS, integer("Passes into final third", "passes_into_final_third"), integer("Touches in opposition box", "touches_opp_box"),
      integer("Corners", "corners"), CROSSES, DRIBBLES, integer("Offsides", "Offsides", "offsides"),
      integer("Big chances missed", "big_chance_missed_title", "big_chances_missed"), integer("Hit woodwork", "shots_woodwork"),
      integer("Penalties won", "penalties_won"), integer("Missed penalty", "missed_penalty", "penalties_missed"),
      integer("Line breaking passes", "line_breaking_passes"),
    ]],
    ["defense", "Defense", [
      integer("Blocks", "shot_blocks"), TACKLES, integer("Clearances", "clearances"), integer("Recoveries", "recoveries"),
      integer("Dribbled past", "dribbled_past"), integer("Interceptions", "interceptions"),
      integer("Headed clearance", "headed_clearance", "headed_clearances"), integer("Defensive actions", "defensive_actions"),
      integer("Clearance off the line", "clearance_off_the_line", "clearances_off_line"),
      integer("Last man tackle", "last_man_tackle", "last_man_tackles"), integer("Error led to goal", "errors_led_to_goal"),
      integer("Conceded penalty", "conceded_penalties", "penalties_conceded"),
    ]],
    ["duels", "Duels", DUELS],
  ],
  keeper: [
    ["top_stats", "Top stats", [
      integer("Saves", "saves"), double("Rating", "rating_title", "rating"), integer("Throws", "player_throws", "throw_ins"),
      integer("Punches", "punches"), ["Shotmap", "", "boolean", "shotmap"], TACKLES, integer("Touches", "touches"),
      integer("Duels won", "duel_won", "duels_won"), integer("Clearances", "clearances"), integer("High claim", "keeper_high_claim", "high_claims"),
      integer("Recoveries", "recoveries"), integer("Was fouled", "was_fouled"), double("xGOT faced", "expected_goals_on_target_faced", "xgot_faced"),
      integer("Diving save", "keeper_diving_save", "diving_saves"), integer("Interceptions", "interceptions"),
      integer("Goals conceded", "goals_conceded"), integer("Minutes played", "minutes_played"), PASSES, integer("Fouls committed", "fouls"),
      double("Goals prevented", "goals_prevented", "goals_prevented"), integer("Acted as sweeper", "keeper_sweeper", "sweeper_actions"),
      AERIALS, GROUND, integer("Saves inside box", "saves_inside_box"), integer("Defensive actions", "defensive_actions"), LONG_BALLS,
      integer("Passes into final third", "passes_into_final_third"), integer("Penalties saved", "saved_penalties", "penalties_saved"),
      integer("Goals", "goals"), integer("Assists", "assists"),
    ]],
  ],
  half: [
    ["top_stats", "Top stats", [
      integer("Goals", "goals"), integer("Saves", "saves"), integer("Assists", "assists"), integer("Total shots", "total_shots"),
      integer("Minutes played", "minutes_played"), PASSES, double("Expected goals (xG)", "expected_goals", "xg"),
    ]],
    ["attack", "Attack", [integer("Touches", "touches"), integer("Dispossessed", "dispossessed"), CROSSES, LONG_BALLS, DRIBBLES,
      integer("Touches in opposition box", "touches_opp_box")]],
    ["defense", "Defense", [TACKLES, integer("Clearances", "clearances"), integer("Recoveries", "recoveries"), integer("Interceptions", "interceptions")]],
    ["duels", "Duels", DUELS],
  ],
};

// A keeper's statistics come in their own layout (one group).
const KEEPER_COLUMNS = ["saves", "goals_conceded", "xgot_faced", "goals_prevented", "diving_saves", "high_claims", "punches", "saves_inside_box"];
const isKeeper = (r) => KEEPER_COLUMNS.some((c) => present(r[c]) && c !== "saves") || (present(r.saves) && present(r.goals_conceded));

function stat(r, [, key, type, column, total]) {
  if (column === "shot_accuracy") {
    // On target out of the shots on and off target (blocked shots excluded).
    const on = r.shots_on_target, off = r.shots_off_target;
    if (!present(on) || !present(off) || on + off === 0) return null;
    return { key, stat: { type, value: on, total: on + off } };
  }
  const value = DERIVED[column] ? DERIVED[column](r) : r[column];
  if (!present(value)) return null;
  const s = { type, value };
  if (total && present(r[total])) s.total = r[total];
  return { key, stat: s };
}

export function playerStats(r, layout) {
  const groups = [];
  for (const [key, title, items] of PLAYER_LAYOUTS[layout]) {
    const stats = {};
    for (const item of [...items].sort((a, b) => jsonbOrder(a[0], b[0]))) {
      const s = stat(r, item);
      if (s) stats[item[0]] = s;
    }
    if (Object.keys(stats).length) groups.push({ key, stats, title });
  }
  // A player without any statistic (an unused substitute) has none at all.
  return groups.some((g) => Object.keys(g.stats).some((label) => label !== "Shotmap")) ? groups : [];
}

// --- Team statistics ---------------------------------------------------------------
// [group, key, title, format, column, percentage column]
const TEAM_STATS = [
  ["Defence", [["clearances", "Clearances", "integer"], ["interceptions", "Interceptions", "integer"], ["keeper_saves", "Keeper saves", "integer"],
    ["matchstats.headers.tackles", "Tackles", "integer", "tackles"], ["shot_blocks", "Blocks", "integer"]]],
  ["Discipline", [["fouls", "Fouls committed", "integer"], ["red_cards", "Red cards", "integer"], ["yellow_cards", "Yellow cards", "integer"]]],
  ["Duels", [["aerials_won", "Aerial duels won", "integerWithPercentage", "aerials_won", "aerials_pct"],
    ["dribbles_succeeded", "Successful dribbles", "integerWithPercentage", "dribbles_succeeded", "dribbles_pct"],
    ["duel_won", "Duels won", "integer", "duels_won"],
    ["ground_duels_won", "Ground duels won", "integerWithPercentage", "ground_duels_won", "ground_duels_pct"]]],
  ["Expected goals (xG)", [["expected_goals", "Expected goals (xG)", "double", "xg"], ["expected_goals_non_penalty", "xG non-penalty", "double", "npxg"],
    ["expected_goals_on_target", "xG on target (xGOT)", "double", "xgot"], ["expected_goals_open_play", "xG open play", "double", "xg_open_play"],
    ["expected_goals_set_play", "xG set play", "double", "xg_set_play"]]],
  ["Passes", [["Offsides", "Offsides", "integer", "offsides"],
    ["accurate_crosses", "Accurate crosses", "integerWithPercentage", "accurate_crosses", "crosses_pct"],
    ["accurate_passes", "Accurate passes", "integerWithPercentage", "accurate_passes", "accurate_passes_pct"],
    ["long_balls_accurate", "Accurate long balls", "integerWithPercentage", "long_balls_accurate", "long_balls_pct"],
    ["opposition_half_passes", "Opposition half", ""], ["own_half_passes", "Own half", ""], ["passes", "Passes", "integer"],
    ["player_throws", "Throws", "integer", "throw_ins"], ["touches_opp_box", "Touches in opposition box", ""]]],
  ["Shots", [["ShotsOffTarget", "Shots off target", "integer", "shots_off_target"], ["ShotsOnTarget", "Shots on target", "integer", "shots_on_target"],
    ["blocked_shots", "Blocked shots", "integer"], ["shots_inside_box", "Shots inside box", "integer"],
    ["shots_outside_box", "Shots outside box", "integer"], ["shots_woodwork", "Hit woodwork", "integer"], ["total_shots", "Total shots", "integer"]]],
  ["Top stats", [["BallPossesion", "Ball possession", "integer", "possession_pct"], ["ShotsOnTarget", "Shots on target", "integer", "shots_on_target"],
    ["accurate_passes", "Accurate passes", "integerWithPercentage", "accurate_passes", "accurate_passes_pct"],
    ["big_chance", "Big chances", "integer", "big_chances"], ["big_chance_missed_title", "Big chances missed", "", "big_chances_missed"],
    ["corners", "Corners", "integer"], ["expected_goals", "Expected goals (xG)", "double", "xg"], ["total_shots", "Total shots", "integer"],
    ["touches_opp_box", "Touches in opposition box", ""], ["yellow_cards", "Yellow cards", "integer"]]],
];

function display(row, format, column, pct) {
  const v = row[column];
  if (!present(v)) return null;
  if (format === "double") return v.toFixed(2);
  if (format === "integerWithPercentage" && present(row[pct])) return `${v} (${Math.round(row[pct])}%)`;
  return String(v);
}

export function teamStatPeriods(home, away) {
  const periods = [];
  for (const period of PERIOD_ORDER) {
    const h = home.find((r) => r.period_name === period),
      a = away.find((r) => r.period_name === period);
    if (!h || !a) continue;
    const groups = [];
    for (const [group, items] of TEAM_STATS) {
      const out = [];
      for (const [key, title, format, column = key, pct] of [...items].sort((x, y) => ascii(x[0], y[0]))) {
        const hv = display(h, format, column, pct),
          av = display(a, format, column, pct);
        if (hv !== null && av !== null) out.push({ key, away: av, home: hv, title, format_type: format });
      }
      if (out.length) groups.push({ items: out, group_name: group });
    }
    if (groups.length) periods.push({ groups, period: PERIOD[period] });
  }
  return periods;
}

// --- Advanced ----------------------------------------------------------------------
const ADVANCED_GROUPS = {
  tempo: ["direct_speed", "sequence_time", "direct_attacks", "buildup_attacks", "passes_per_sequence"],
  passing: ["passes", "assists", "crosses", "switches", "key_passes", "pass_accuracy", "through_balls", "passes_into_box", "progressive_passes",
    "progressive_pass_distance"],
  carrying: ["carries", "take_ons", "miscontrols", "dispossessed", "take_ons_won", "carry_distance", "carries_into_box", "progressive_carries",
    "carries_into_final_third", "progressive_carry_distance"],
  creation: ["gca", "sca", "xag", "xg_chain", "xg_buildup", "second_assists"],
  defending: ["ppda", "blocks", "aerials", "tackles", "duels_won", "challenges", "clearances", "aerials_won", "interceptions", "high_turnovers",
    "opponent_passes", "defensive_actions", "ball_recovery_time", "avg_defensive_action_x", "counterpress_regains_5s"],
  territory: ["field_tilt", "box_entries", "avg_action_x", "possession_pct", "final_third_entries"],
  possession_value: ["pv_total", "xt_total", "vaep_total", "pv_defensive", "pv_offensive", "vaep_defensive", "vaep_offensive"],
  goalkeeping: ["claims", "launches", "claim_rate", "claims_won", "launch_pct", "distributions", "avg_pass_length", "sweeper_actions",
    "distribution_accuracy"],
};
const SCA = ["shot", "take_on", "defensive", "pass_dead", "pass_live", "foul_drawn"];

export function advancedEntry(r, player) {
  const out = put({}, "actions", r.actions);
  for (const [group, columns] of Object.entries(ADVANCED_GROUPS)) {
    if (player && group === "tempo") continue;
    if (player && group === "territory") continue;
    const values = {};
    for (const c of columns) put(values, c, r[c]);
    if (group === "creation") {
      const sca = {};
      // A player's breakdown lists the categories he has; a team's lists every one.
      for (const c of SCA) if (present(r["sca_" + c]) && (!player || r["sca_" + c] !== 0)) sca[c] = r["sca_" + c];
      // (empty for a player without any; absent when the source gave no breakdown)
      if (Object.keys(sca).length || SCA.some((c) => present(r["sca_" + c]))) values.sca_breakdown = sca;
      put(values, "chances_created", r.key_passes); // the source repeats key passes here
    }
    if (Object.keys(values).length) out[group] = values;
    else if (player && group === "goalkeeping") out.goalkeeping = null;
  }
  if (player && !("goalkeeping" in out)) out.goalkeeping = null;
  return out;
}

// --- Heatmaps ----------------------------------------------------------------------
const GRID = { length: 16, width: 12, cell_length_m: 105 / 16, cell_width_m: 68 / 12 };

export function heatmapCells(cells, rotate) {
  const out = [];
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 12; y++) {
      const n = cells?.[y * 16 + x];
      if (n > 0) out.push(rotate ? [15 - x, 11 - y, n] : [x, y, n]);
    }
  return out;
}

export function heatmapsBody(mid, rows, frame) {
  const entry = (r) => {
    const e = { side: r.side, team: { id: r.team_id, name: r.team_name }, cells: heatmapCells(r.cells, frame === "home_ltr" && r.side === "away"), actions: r.actions };
    if (r.kind === "player") e.player = { id: r.player_id, name: r.player_name, shirt_number: r.shirt };
    return e;
  };
  const sides = (a, b) => (a.side === b.side ? 0 : a.side === "home" ? -1 : 1);
  return {
    match_id: mid,
    grid: { ...GRID, frame },
    teams: rows.filter((r) => r.kind === "team").sort(sides).map(entry),
    players: rows
      .filter((r) => r.kind === "player")
      .sort((a, b) => sides(a, b) || (b.actions ?? -1) - (a.actions ?? -1) || ascii(a.player_name ?? "", b.player_name ?? ""))
      .map(entry),
  };
}

// --- Bodies --------------------------------------------------------------------------
export function matchBody(f) {
  const body = {
    id: f.id, date: f.day, league: team(f.league_id, f.league_name, f.league_image_url), season: f.native_season ?? f.season,
    status: f.status, time_utc: f.time_utc, away_team: team(f.away_team_id, f.away_name, f.away_image_url),
    home_team: team(f.home_team_id, f.home_name, f.home_image_url), round_name: f.round_name, score_away: f.score_away,
    score_home: f.score_home, has_playoff: f.has_playoff,
  };
  put(body, "referee", f.referee);
  put(body, "stadium", f.stadium);
  put(body, "score_penalty_home", f.score_penalty_home);
  put(body, "score_penalty_away", f.score_penalty_away);
  return body;
}

export function lineupsBody(f, teams, players) {
  const body = { match_id: f.id, home_team: team(f.home_team_id, f.home_name, f.home_image_url), away_team: team(f.away_team_id, f.away_name, f.away_image_url) };
  for (const l of teams) {
    const mine = players.filter((p) => p.internal_team_id === l.internal_team_id).sort((a, b) => (a.lineup_order ?? 1e4) - (b.lineup_order ?? 1e4) || ascii(a.name, b.name));
    const entry = (p) => ({
      name: p.name, pitch_x: p.pitch_x ?? 0, pitch_y: p.pitch_y ?? 0, player_id: p.player_id, is_captain: p.is_captain ?? false,
      position_id: p.position_id, shirt_number: present(p.shirt_number) ? String(p.shirt_number) : null,
    });
    const side = { subs: mine.filter((p) => !p.is_starter).map(entry), starters: mine.filter((p) => p.is_starter).map(entry) };
    put(side, "confirmed", l.confirmed);
    put(side, "formation", l.formation);
    put(side, "lineup_type", l.lineup_type);
    if (l.coach) side.coach = { name: l.coach };
    body[l.side] = side;
  }
  return body;
}

export function eventsBody(mid, rows) {
  return {
    match_id: mid,
    events: rows.map((e) => {
      const out = { minute: e.minute, period: PERIOD[e.period] ?? null, team_id: e.team_id, event_type: EVENT_TYPE[e.event_type] ?? null };
      if (e.player_id) out.player = person(e.player_id, e.player_name, e.player_image_url);
      if (e.related_id) out.sub_in_player = person(e.related_id, e.related_name, e.related_image_url);
      for (const k of ["is_penalty", "is_own_goal", "minute_added", "score_home", "score_away"]) put(out, k, e[k]);
      return out;
    }),
  };
}

export function shotsBody(mid, rows) {
  const periods = [];
  for (const s of rows) {
    const period = PERIOD[s.period] ?? null;
    let group = periods.at(-1);
    if (!group || group.period !== period) periods.push((group = { shots: [], period }));
    const shot = { team_id: s.team_id };
    put(shot, "id", s.id);
    if (s.player_id) shot.player = person(s.player_id, s.player_name, s.player_image_url);
    if (s.keeper_id) shot.keeper = person(s.keeper_id, s.keeper_name, s.keeper_image_url);
    for (const [k, c] of [["x", "x"], ["y", "y"], ["minute", "minute"], ["minute_added", "minute_added"], ["expected_goals", "xg"],
      ["expected_goals_on_target", "xgot"], ["goal_crossed_y", "goal_crossed_y"], ["goal_crossed_z", "goal_crossed_z"], ["blocked_x", "blocked_x"],
      ["blocked_y", "blocked_y"], ["is_on_target", "is_on_target"], ["is_inside_box", "is_inside_box"], ["is_blocked", "is_blocked"],
      ["is_own_goal", "is_own_goal"], ["is_saved_off_line", "is_saved_off_line"]])
      put(shot, k, s[c]);
    put(shot, "event_type", s.outcome === "goal" && s.is_own_goal ? "OwnGoal" : SHOT_OUTCOME[s.outcome]);
    put(shot, "shot_type", BODY_PART[s.body_part]);
    put(shot, "situation", SITUATION[s.situation]);
    group.shots.push(shot);
  }
  return { match_id: mid, periods };
}

const lineupRank = (order) => (r) => [r.team_public_id === order.home ? 0 : 1, order.rank.get(r.player_public_id) ?? 1e4, r.player_name ?? ""];
const compareRank = (rank) => (a, b) => {
  const x = rank(a), y = rank(b);
  return x[0] - y[0] || x[1] - y[1] || ascii(x[2], y[2]);
};

/** Players listed home first, in line-up order (the source's own order carries no rule). */
export function playerOrder(f, lineupPlayers) {
  const rank = new Map();
  for (const p of lineupPlayers) rank.set(p.player_id, (p.is_starter ? 0 : 100) + (p.lineup_order ?? 99));
  return compareRank(lineupRank({ home: f.home_team_id, rank }));
}

export function playersBody(rows, order) {
  return [...rows].sort(order).map((r) => ({
    stats: playerStats(r, isKeeper(r) ? "keeper" : "outfield"),
    player: person(r.player_public_id, r.player_name, r.player_image_url),
    team_id: r.team_public_id,
  }));
}

export function halvesBody(mid, rows, order) {
  const players = new Map();
  for (const r of [...rows].sort(order)) {
    if (!players.has(r.player_public_id))
      players.set(r.player_public_id, { player: person(r.player_public_id, r.player_name, r.player_image_url), periods: [], team_id: r.team_public_id });
    players.get(r.player_public_id).periods.push({ stats: playerStats(r, "half"), period: PERIOD[r.period_name] });
  }
  for (const p of players.values()) p.periods.sort((a, b) => ascii(a.period, b.period));
  return { players: [...players.values()], match_id: mid };
}

export function momentumBody(mid, rows) {
  return { match_id: mid, points: rows.map((r) => ({ value: r.value, minute: r.minute })) };
}

export function h2hBody(f, h, meetings) {
  return {
    draws: h.draws, match_id: f.id, away_team: team(f.away_team_id, f.away_name, f.away_image_url), away_wins: h.away_wins,
    home_team: team(f.home_team_id, f.home_name, f.home_image_url), home_wins: h.home_wins, total_matches: h.total_matches,
    recent_matches: meetings.map((m) => ({
      away: { id: m.away_id, name: m.away_name, image_url: null }, home: { id: m.home_id, name: m.home_name, image_url: null },
      finished: m.finished, time_utc: m.kickoff_at instanceof Date ? m.kickoff_at.toISOString() : m.kickoff_at, score_away: m.away_score,
      score_home: m.home_score,
    })),
  };
}

export function advancedTeamsBody(f, rows) {
  const side = (r) => (r.team_public_id === f.home_team_id ? 0 : 1);
  return {
    match_id: f.id,
    teams: [...rows].sort((a, b) => side(a) - side(b)).map((r) => ({ team: { id: r.team_public_id, name: r.team_name }, ...advancedEntry(r, false) })),
  };
}

export function advancedPlayersBody(mid, rows) {
  const vaep = (r) => r.vaep_total ?? -Infinity;
  return {
    match_id: mid,
    sorted_by: "possession_value.vaep_total",
    players: [...rows]
      .sort((a, b) => vaep(b) - vaep(a) || ascii(a.player_name ?? "", b.player_name ?? ""))
      .map((r) => ({
        player: { id: r.player_public_id, name: r.player_name, shirt_number: r.shirt }, team_id: r.team_public_id,
        ...advancedEntry(r, true), minutes_played: r.minutes_played,
      })),
  };
}

export function networkBody(f, teams, nodes, edges) {
  const side = (r) => (r.team_id === f.home_team_id ? 0 : 1);
  const who = (id, name, shirt) => ({ id, name, shirt_number: shirt });
  return {
    match_id: f.id,
    networks: [...teams].sort((a, b) => side(a) - side(b)).map((t) => ({
      team: { id: t.team_id, name: t.team_name },
      edges: edges
        .filter((e) => e.internal_team_id === t.internal_team_id)
        .sort((a, b) => b.passes - a.passes || ascii(a.from_name, b.from_name) || ascii(a.to_name, b.to_name))
        .map((e) => ({ to: who(e.to_id, e.to_name, e.to_shirt), from: who(e.from_id, e.from_name, e.from_shirt), passes: e.passes })),
      nodes: nodes
        .filter((n) => n.internal_team_id === t.internal_team_id)
        .sort((a, b) => b.passes - a.passes || ascii(a.name, b.name))
        .map((n) => ({
          avg_x: n.avg_x, avg_y: n.avg_y, degree: n.degree, passes: n.passes, player: who(n.player_id, n.name, n.shirt), strength: n.strength,
          clustering: n.clustering, betweenness: n.betweenness, passes_received: n.passes_received,
        })),
      window: { kind: t.window_kind, until_seconds: t.window_until_s },
      centralization: t.centralization,
    })),
  };
}
