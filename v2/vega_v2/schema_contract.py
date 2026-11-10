"""Canonical typed v2 metric contract; source aliases are explicit, never JSON columns."""


def _columns(counts, values):
    return {
        **{key: "smallint" for key in counts.split()},
        **{key: "real" for key in values.split()},
    }


PLAYER_STATS_COLUMNS = _columns(
    """position_id minutes_played goals assists own_goals total_shots shots_on_target shots_off_target blocked_shots shots_woodwork big_chances_created big_chances_missed penalties_won penalties_missed accurate_passes accurate_passes_total passes_into_final_third chances_created crosses accurate_crosses accurate_crosses_total long_balls_accurate long_balls_total line_breaking_passes corners throw_ins touches touches_opp_box dribbles_succeeded dribbles_total dispossessed offsides was_fouled tackles last_man_tackles interceptions clearances headed_clearances clearances_off_line shot_blocks recoveries defensive_actions dribbled_past errors_led_to_goal penalties_conceded fouls duels_won duels_lost ground_duels_won ground_duels_total aerials_won aerials_total saves saves_inside_box diving_saves high_claims punches sweeper_actions goals_conceded penalties_saved shootout_penalties_saved sprints""",
    """rating fantasy_points xg npxg xgot xa goals_prevented xgot_faced distance_m running_m sprinting_m top_speed_kmh""",
)
TEAM_STATS_COLUMNS = _columns(
    """total_shots shots_on_target shots_off_target blocked_shots shots_woodwork shots_inside_box shots_outside_box big_chances big_chances_missed passes accurate_passes own_half_passes opposition_half_passes long_balls_accurate accurate_crosses touches_opp_box corners offsides throw_ins tackles interceptions clearances shot_blocks keeper_saves duels_won ground_duels_won aerials_won dribbles_succeeded fouls yellow_cards red_cards sprints""",
    """xg npxg xgot xg_open_play xg_set_play possession_pct long_balls_pct crosses_pct ground_duels_pct aerials_pct dribbles_pct distance_m walking_m running_m sprinting_m""",
)
_ADVANCED_COMMON_COUNTS = """actions passes progressive_passes passes_into_box key_passes assists through_balls crosses switches carries progressive_carries carries_into_final_third carries_into_box take_ons take_ons_won miscontrols dispossessed sca gca second_assists sca_pass_live sca_pass_dead sca_take_on sca_shot sca_defensive tackles interceptions blocks clearances duels_won aerials aerials_won"""
_ADVANCED_COMMON_REAL = """xt_total vaep_total vaep_offensive vaep_defensive pv_total pv_offensive pv_defensive pass_accuracy progressive_pass_distance carry_distance progressive_carry_distance xag"""
TEAM_ADVANCED_COLUMNS = _columns(
    _ADVANCED_COMMON_COUNTS
    + " sca_foul_drawn opponent_passes defensive_actions challenges high_turnovers counterpress_regains_5s final_third_entries box_entries buildup_attacks direct_attacks",
    _ADVANCED_COMMON_REAL
    + " ppda avg_defensive_action_x ball_recovery_time possession_pct field_tilt avg_action_x passes_per_sequence sequence_time direct_speed",
)
PLAYER_ADVANCED_COLUMNS = _columns(
    _ADVANCED_COMMON_COUNTS
    + " claims claims_won sweeper_actions distributions launches",
    _ADVANCED_COMMON_REAL
    + " xg_chain xg_buildup claim_rate launch_pct avg_pass_length distribution_accuracy",
)
# Identity mappings plus observed provider spellings from the approved specification.
PITCHAPI_PLAYER_KEYS = {name: name for name in PLAYER_STATS_COLUMNS}
PITCHAPI_PLAYER_KEYS.update(
    {
        "rating_title": "rating",
        "owngoal": "own_goals",
        "ShotsOnTarget": "shots_on_target",
        "ShotsOffTarget": "shots_off_target",
        "expected_goals": "xg",
        "expected_goals_non_penalty": "npxg",
        "expected_goals_on_target_variant": "xgot",
        "expected_assists": "xa",
        "big_chance_created_team_title": "big_chances_created",
        "big_chance_missed_title": "big_chances_missed",
        "missed_penalty": "penalties_missed",
        "player_throws": "throw_ins",
        "matchstats.headers.tackles": "tackles",
        "duel_won": "duels_won",
        "duel_lost": "duels_lost",
    }
)
PITCHAPI_TEAM_KEYS = {name: name for name in TEAM_STATS_COLUMNS}
PITCHAPI_TEAM_KEYS.update(
    {
        "big_chance": "big_chances",
        "BallPossesion": "possession_pct",
        "ShotsOnTarget": "shots_on_target",
        "ShotsOffTarget": "shots_off_target",
        "matchstats.headers.tackles": "tackles",
        "expected_goals": "xg",
        "expected_goals_on_target": "xgot",
        "expected_goals_open_play": "xg_open_play",
        "expected_goals_set_play": "xg_set_play",
    }
)

# Exact provider spellings confirmed from the existing typed collector definitions.
PITCHAPI_PLAYER_KEYS.update(
    {
        "Offsides": "offsides",
        "clearance_off_the_line": "clearances_off_line",
        "conceded_penalties": "penalties_conceded",
        "expected_goals_on_target_faced": "xgot_faced",
        "headed_clearance": "headed_clearances",
        "keeper_diving_save": "diving_saves",
        "keeper_high_claim": "high_claims",
        "keeper_sweeper": "sweeper_actions",
        "last_man_tackle": "last_man_tackles",
        "saved_penalties": "penalties_saved",
    }
)

# Explicit team spellings observed by the metadata-only pilot.
PITCHAPI_TEAM_KEYS.update(
    {
        "big_chance_missed_title": "big_chances_missed",
        "duel_won": "duels_won",
        "expected_goals_non_penalty": "npxg",
        "Offsides": "offsides",
        "player_throws": "throw_ins",
    }
)
PLAYER_TOTAL_KEYS = {
    "aerials_won": "aerials_total",
    "dribbles_succeeded": "dribbles_total",
    "ground_duels_won": "ground_duels_total",
    "long_balls_accurate": "long_balls_total",
}

# Explicit physical-metric spellings from the existing provider adapter.
PITCHAPI_PLAYER_KEYS.update(
    {
        "physical_metrics_distance_covered": "distance_m",
        "physical_metrics_topspeed": "top_speed_kmh",
        "physical_metrics_number_of_sprints": "sprints",
        "physical_metrics_running": "running_m",
        "physical_metrics_sprinting": "sprinting_m",
    }
)
# The team endpoint can publish a count and percentage with no total.
TEAM_STATS_COLUMNS["accurate_passes_pct"] = "real"
