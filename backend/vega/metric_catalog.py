"""How every per-match metric becomes a season aggregate.

Single source of truth for agg.player_season_stats / agg.team_season_stats columns, the
calculator SQL and agg.metric_definitions. Rules follow the validated design document:

- sum: additive counts and values (goals, xG, distances). Stored with the number of
  matches and, for players, the minutes where the metric exists, so a per-90 value is
  divided by covered minutes only (a missing value is never a zero).
- ratio: made / attempted pairs summed over the matches where both exist.
- weighted_mean: a provider average or percentage weighted by a declared volume.
- match_mean: a provider percentage without its components, averaged per match.
- max: the season maximum (top speed).
- rating: the provider rating, weighted by the minutes of rated matches.

Every numeric column of the source tables must appear here (see tests); a new provider
column therefore cannot be silently ignored or silently summed.
"""

from dataclasses import dataclass

from .schema_contract import (
    PLAYER_ADVANCED_COLUMNS,
    PLAYER_STATS_COLUMNS,
    SOURCE_ONLY_PLAYER_COLUMNS,
    SOURCE_ONLY_TEAM_COLUMNS,
    TEAM_ADVANCED_COLUMNS,
    TEAM_STATS_COLUMNS,
)

PLAYER_BASE = "core.player_match_stats"
PLAYER_ADVANCED = "core.player_match_advanced"
TEAM_BASE = "core.team_match_stats"
TEAM_ADVANCED = "core.team_match_advanced"


@dataclass(frozen=True)
class Metric:
    key: str  # agg column stem, also agg.metric_definitions.key
    table: str  # source table
    column: str  # source column
    rule: str  # sum, weighted_mean, match_mean, max, rating
    real: bool  # the source column is real (else an integer count)
    weight: str | None = None  # source column weighting a weighted_mean


@dataclass(frozen=True)
class Ratio:
    key: str
    table: str
    numerator: str  # SQL expression over source columns
    denominator: str
    columns: tuple  # source columns that must all be non-null


# The player statistics the source leaves blank at zero: a blank of a measured row (its
# touches are filled) is a zero where agg.match_zeros (068) says so for the match. The
# table has one column per name; the physical statistics and those the source always
# fills are not in it.
ZERO_STATS = (
    "goals", "assists", "own_goals", "total_shots", "shots_on_target", "shots_off_target", "blocked_shots",
    "shots_woodwork", "big_chances_created", "big_chances_missed", "penalties_won", "penalties_missed",
    "passes_into_final_third", "chances_created", "accurate_crosses", "accurate_crosses_total", "long_balls_accurate",
    "long_balls_total", "corners", "throw_ins", "touches_opp_box", "dribbles_succeeded", "dribbles_total",
    "dispossessed", "offsides", "was_fouled", "last_man_tackles", "headed_clearances", "clearances_off_line",
    "shot_blocks", "dribbled_past", "errors_led_to_goal", "penalties_conceded", "duels_won", "duels_lost",
    "ground_duels_won", "ground_duels_total", "aerials_won", "aerials_total", "xg", "npxg", "xgot", "xa",
)

# The same for the starting goalkeeper (the line-up's slot 11; 070), three more columns of
# the table. NO_SHOT_FACED are zero only when his row shows no save and no goal conceded.
KEEPER_ZERO_STATS = ("penalties_saved", "goals_prevented", "xgot_faced")
NO_SHOT_FACED = ("goals_prevented", "xgot_faced")

# Source columns that are identities or the coverage base, not metrics.
# The columns of 074 are kept match by match and have no season aggregate yet.
NOT_METRICS = {
    PLAYER_BASE: {"position_id", "minutes_played", *SOURCE_ONLY_PLAYER_COLUMNS},
    PLAYER_ADVANCED: {"minutes_played"},
    TEAM_BASE: set(SOURCE_ONLY_TEAM_COLUMNS),
    TEAM_ADVANCED: set(),
}

_SPECIAL = {
    (PLAYER_BASE, "rating"): ("rating", None),
    (PLAYER_BASE, "top_speed_kmh"): ("max", None),
    (PLAYER_ADVANCED, "pass_accuracy"): ("weighted_mean", "passes"),
    (PLAYER_ADVANCED, "distribution_accuracy"): ("weighted_mean", "distributions"),
    (PLAYER_ADVANCED, "avg_pass_length"): ("weighted_mean", "distributions"),
    (PLAYER_ADVANCED, "claim_rate"): ("weighted_mean", "claims"),
    (PLAYER_ADVANCED, "launch_pct"): ("weighted_mean", "distributions"),
    (TEAM_ADVANCED, "pass_accuracy"): ("weighted_mean", "passes"),
    (TEAM_ADVANCED, "avg_defensive_action_x"): ("weighted_mean", "defensive_actions"),
    (TEAM_ADVANCED, "avg_action_x"): ("weighted_mean", "actions"),
    (TEAM_ADVANCED, "ppda"): ("match_mean", None),
    (TEAM_ADVANCED, "possession_pct"): ("match_mean", None),
    (TEAM_ADVANCED, "field_tilt"): ("match_mean", None),
    (TEAM_ADVANCED, "ball_recovery_time"): ("match_mean", None),
    (TEAM_ADVANCED, "passes_per_sequence"): ("match_mean", None),
    (TEAM_ADVANCED, "sequence_time"): ("match_mean", None),
    (TEAM_ADVANCED, "direct_speed"): ("match_mean", None),
}


def _metrics(table, columns, prefix):
    out = []
    for column, kind in columns.items():
        if column in NOT_METRICS[table]:
            continue
        rule, weight = _SPECIAL.get((table, column), (None, None))
        if rule is None:
            # A provider percentage without its components cannot be summed.
            rule = "match_mean" if column.endswith("_pct") else "sum"
        out.append(Metric(prefix + column, table, column, rule, kind == "real", weight))
    return tuple(out)


TEAM_BASE_COLUMNS = {**TEAM_STATS_COLUMNS, "accurate_passes_pct": "real"}

PLAYER_METRICS = _metrics(PLAYER_BASE, PLAYER_STATS_COLUMNS, "") + _metrics(
    PLAYER_ADVANCED, PLAYER_ADVANCED_COLUMNS, "adv_"
)
TEAM_METRICS = _metrics(TEAM_BASE, TEAM_BASE_COLUMNS, "") + _metrics(
    TEAM_ADVANCED, TEAM_ADVANCED_COLUMNS, "adv_"
)

PLAYER_RATIOS = (
    Ratio("pass_completion", PLAYER_BASE, "accurate_passes", "accurate_passes_total", ("accurate_passes", "accurate_passes_total")),
    Ratio("cross_completion", PLAYER_BASE, "accurate_crosses", "accurate_crosses_total", ("accurate_crosses", "accurate_crosses_total")),
    Ratio("long_ball_completion", PLAYER_BASE, "long_balls_accurate", "long_balls_total", ("long_balls_accurate", "long_balls_total")),
    Ratio("dribble_success", PLAYER_BASE, "dribbles_succeeded", "dribbles_total", ("dribbles_succeeded", "dribbles_total")),
    Ratio("ground_duel_success", PLAYER_BASE, "ground_duels_won", "ground_duels_total", ("ground_duels_won", "ground_duels_total")),
    Ratio("aerial_success", PLAYER_BASE, "aerials_won", "aerials_total", ("aerials_won", "aerials_total")),
    Ratio("duel_success", PLAYER_BASE, "duels_won", "duels_won+duels_lost", ("duels_won", "duels_lost")),
    Ratio("shot_accuracy", PLAYER_BASE, "shots_on_target", "total_shots", ("shots_on_target", "total_shots")),
    Ratio("adv_take_on_success", PLAYER_ADVANCED, "take_ons_won", "take_ons", ("take_ons_won", "take_ons")),
    Ratio("adv_aerial_success", PLAYER_ADVANCED, "aerials_won", "aerials", ("aerials_won", "aerials")),
    Ratio("adv_claim_success", PLAYER_ADVANCED, "claims_won", "claims", ("claims_won", "claims")),
    Ratio("adv_launch_share", PLAYER_ADVANCED, "launches", "distributions", ("launches", "distributions")),
)

TEAM_RATIOS = (
    Ratio("pass_completion", TEAM_BASE, "accurate_passes", "passes", ("accurate_passes", "passes")),
    Ratio("shot_accuracy", TEAM_BASE, "shots_on_target", "total_shots", ("shots_on_target", "total_shots")),
    # PPDA is recomputed from accumulated parts, never averaged.
    Ratio("ppda", TEAM_ADVANCED, "opponent_passes", "defensive_actions", ("opponent_passes", "defensive_actions")),
    Ratio("adv_take_on_success", TEAM_ADVANCED, "take_ons_won", "take_ons", ("take_ons_won", "take_ons")),
    Ratio("adv_aerial_success", TEAM_ADVANCED, "aerials_won", "aerials", ("aerials_won", "aerials")),
)


def metric_columns(metric, *, prefix="", minutes=False, legacy=False):
    """(column, SQL type) pairs stored for one metric. The rating is stored as the doc names
    it, rating_sum (rating x minutes) and rating_minutes; `legacy` gives the names that
    migrations 009 and 012 were generated with (049 renames them)."""
    stem = prefix + metric.key
    value = "real" if metric.real or metric.rule != "sum" else "integer"
    if metric.rule == "rating" and not legacy:
        cols = [(stem + "_sum", "real"), (stem + "_minutes", "integer")]
    elif metric.rule in ("weighted_mean", "rating"):
        cols = [(stem + "_wsum", "real"), (stem + "_w", "real")]
    elif metric.rule == "max":
        cols = [(stem + "_max", "real")]
    elif metric.rule == "match_mean":
        cols = [(stem + "_sum", "real")]
    else:
        cols = [(stem + "_sum", value)]
    cols.append((stem + "_n", "integer"))
    if minutes:
        cols.append((stem + "_min", "integer"))
    return cols


def ratio_columns(ratio, *, prefix=""):
    stem = prefix + ratio.key
    return [(stem + "_num", "real"), (stem + "_den", "real"), (stem + "_n", "integer")]


def player_season_columns(*, legacy=False):
    cols = []
    for metric in PLAYER_METRICS:
        cols += metric_columns(metric, minutes=True, legacy=legacy)
    for ratio in PLAYER_RATIOS:
        cols += ratio_columns(ratio)
    return cols


def team_season_columns():
    cols = []
    for side in ("for_", "against_"):
        for metric in TEAM_METRICS:
            cols += metric_columns(metric, prefix=side)
        for ratio in TEAM_RATIOS:
            cols += ratio_columns(ratio, prefix=side)
    return cols
