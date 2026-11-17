"""The server's club indicators, each with the number of matches it stands on.

Version 2 (VI-23 B10, calculation audit of 16 November 2026, new finding N1;
docs/calculs/09-audit-2026-11/FAILURE_MODES.md §11). Version 1 is api_schema.CLUB_INDICATORS,
kept unchanged for migrations 012 and 015, which are generated from it. It had two faults:
- every indicator said it covered all of the club's matches (models._team_values_sql), so an
  axis known on 3 matches of 8 passed a gate of 5;
- a ratio of two statistics, or of two sides, divided sums that did not stand on the same
  matches. xG per shot divided the non-penalty xG by every shot, penalties included, and an
  opponent's own goal counted in the club's finishing and conversion; the club's own goal
  counted against its keeper.

Each indicator is (value, covered), two expressions over a row `t` of agg.team_season_stats
(or of its sums over a cohort's editions):
- value: the indicator, a double precision (red_total: an integer);
- covered: the matches its value stands on.

A ratio reads the pair_* columns (migration 127, filled by calculator.py): its terms summed
over the matches that know every input of it, and the count of those matches. Penalty
attempts and own goals are established, never inferred:
- penalties: the match's complete, reconciled shot set (shot coverage ok, the shoot-out left
  out; each side's shots other than own goals as many as its statistics count, the club's all
  classified, and the goals reproducing the score). Equal xG and non-penalty xG establish
  nothing (amendment §1).
- own goals: the match's goal events (event coverage ok), read in the order of the score,
  going up one goal at a time to the final score; an own goal counts for the side whose score
  it raises.

api.team_season (127) publishes the same expressions: the cohort percentiles and the published
season row are one definition (test_audit_club_aggregates.py checks they agree).
"""

from .api_schema import CLUB_INDICATORS as VERSION_1

VERSION = "club-indicators-v2"


def _same(key, covered):
    """Version 1's expression of `key` (012), unchanged, with the matches it stands on."""
    return (VERSION_1[key], covered)


def _mean(key, column):
    """Version 1's per-match mean of a team statistic, over the matches that know it."""
    return _same(key, f"t.{column}_n")


def _pct(name):
    """A paired percentage: 100 × Σ numerator / Σ denominator over the matches that know both."""
    return (f"core.pct(t.pair_{name}_num, t.pair_{name}_den)", f"t.pair_{name}_n")


INDICATORS = {
    "ppm": _same("ppm", "t.matches"),
    "xpts_pm": _same("xpts_pm", "t.xpts_matches"),
    "goals_for_pm": _same("goals_for_pm", "t.matches"),
    "goals_against_pm": _same("goals_against_pm", "t.matches"),
    "xg_pm": _mean("xg_pm", "for_xg"),
    "npxg_pm": _mean("npxg_pm", "for_npxg"),
    "xg_open_pm": _mean("xg_open_pm", "for_xg_open_play"),
    "big_chances_pm": _mean("big_chances_pm", "for_big_chances"),
    "shots_pm": _mean("shots_pm", "for_total_shots"),
    "shots_on_target_pm": _mean("shots_on_target_pm", "for_shots_on_target"),
    # Non-penalty xG over non-penalty shots, on the matches whose penalty attempts are counted.
    "xg_per_shot": ("t.pair_xg_per_shot_num / nullif(t.pair_xg_per_shot_den, 0)", "t.pair_xg_per_shot_n"),
    "box_shots_pct": _pct("box_shots"),
    "touches_box_pm": _mean("touches_box_pm", "for_touches_opp_box"),
    # The club's own goals (an opponent's own goal is no finishing) minus its xG.
    "finishing_pm": ("t.pair_finishing_sum / nullif(t.pair_finishing_n, 0)", "t.pair_finishing_n"),
    # xGOT against minus the goals the keeper let in (the club's own goals are not his).
    "keeper_pm": ("t.pair_keeper_sum / nullif(t.pair_keeper_n, 0)", "t.pair_keeper_n"),
    "conversion_pct": _pct("conversion"),
    "xga_pm": _mean("xga_pm", "against_xg"),
    "npxga_pm": _mean("npxga_pm", "against_npxg"),
    "shots_against_pm": _mean("shots_against_pm", "against_total_shots"),
    "big_chances_against_pm": _mean("big_chances_against_pm", "against_big_chances"),
    "touches_box_against_pm": _mean("touches_box_against_pm", "against_touches_opp_box"),
    "shots_on_target_against_pm": _mean("shots_on_target_against_pm", "against_shots_on_target"),
    "xg_open_against_pm": _mean("xg_open_against_pm", "against_xg_open_play"),
    "passes_against_pm": _mean("passes_against_pm", "against_passes"),
    "xgot_pm": _mean("xgot_pm", "for_xgot"),
    "placement_pm": _same("placement_pm", "t.placement_matches"),
    "clean_sheets_pct": _same("clean_sheets_pct", "t.matches"),
    "possession_pct": _mean("possession_pct", "for_possession_pct"),
    "passes_pm": _mean("passes_pm", "for_passes"),
    "pass_accuracy_pct": _same("pass_accuracy_pct", "t.for_pass_completion_n"),
    "field_tilt_pct": _pct("field_tilt"),
    "box_share_pct": _pct("box_share"),
    "directness_pct": _pct("directness"),
    "crosses_pm": _mean("crosses_pm", "for_accurate_crosses"),
    "ppda_approx": ("t.pair_ppda_num / nullif(t.pair_ppda_den, 0)", "t.pair_ppda_n"),
    # The season's tackles and interceptions per match, brought to 50 % of the opponent's
    # possession by the season's possession (version 1's estimand), all three on the same matches.
    "def_actions_adj": (
        "t.pair_def_actions_sum / nullif(t.pair_def_actions_n, 0) * 50"
        " / nullif(100 - t.pair_def_actions_possession / nullif(t.pair_def_actions_n, 0), 0)",
        "t.pair_def_actions_n",
    ),
    "duels_pct": _pct("duels"),
    "aerials_pct": _pct("aerials"),
    "fouls_pm": _mean("fouls_pm", "for_fouls"),
    "xg_set_pm": _mean("xg_set_pm", "for_xg_set_play"),
    "xg_set_against_pm": _mean("xg_set_against_pm", "against_xg_set_play"),
    "set_share_pct": _pct("set_share"),
    "corners_pm": _mean("corners_pm", "for_corners"),
    "corners_against_pm": _mean("corners_against_pm", "against_corners"),
    "yellow_pm": _mean("yellow_pm", "for_yellow_cards"),
    "red_total": _same("red_total", "t.for_red_cards_n"),
}
# The indicators version 2 reads on a paired support; the others are version 1's expression.
REDEFINED = tuple(key for key, (value, _) in INDICATORS.items() if value != VERSION_1[key])

# The paired supports the calculator fills (calculator.py PAIRED), by name: the parts summed,
# each an expression over one match (o, p: the club's and the opponent's statistics; side: the
# match's score; q: its own goals and penalty attempts), and the inputs the match must know.
# Every name gives pair_<name>_<part> (double precision) and pair_<name>_n (integer).
PAIRED = {
    "field_tilt": ((("num", "o.opposition_half_passes"), ("den", "o.opposition_half_passes + p.opposition_half_passes")),
                   ("o.opposition_half_passes", "p.opposition_half_passes")),
    "box_share": ((("num", "o.touches_opp_box"), ("den", "o.touches_opp_box + p.touches_opp_box")),
                  ("o.touches_opp_box", "p.touches_opp_box")),
    "duels": ((("num", "o.duels_won"), ("den", "o.duels_won + p.duels_won")), ("o.duels_won", "p.duels_won")),
    "aerials": ((("num", "o.aerials_won"), ("den", "o.aerials_won + p.aerials_won")), ("o.aerials_won", "p.aerials_won")),
    "directness": ((("num", "o.long_balls_accurate"), ("den", "o.accurate_passes")), ("o.long_balls_accurate", "o.accurate_passes")),
    "box_shots": ((("num", "o.shots_inside_box"), ("den", "o.total_shots")), ("o.shots_inside_box", "o.total_shots")),
    "set_share": ((("num", "o.xg_set_play"), ("den", "o.xg")), ("o.xg_set_play", "o.xg")),
    "ppda": ((("num", "p.own_half_passes"), ("den", "o.tackles + o.interceptions + o.fouls")),
             ("p.own_half_passes", "o.tackles", "o.interceptions", "o.fouls")),
    "def_actions": ((("sum", "o.tackles + o.interceptions"), ("possession", "o.possession_pct")),
                    ("o.tackles", "o.interceptions", "o.possession_pct")),
    "xg_per_shot": ((("num", "o.npxg"), ("den", "o.total_shots - q.penalties")), ("o.npxg", "o.total_shots", "q.penalties")),
    "conversion": ((("num", "side.gf - q.own_goals_for"), ("den", "o.total_shots")), ("o.total_shots", "q.own_goals_for")),
    "finishing": ((("sum", "side.gf - q.own_goals_for - o.xg"),), ("o.xg", "q.own_goals_for")),
    "keeper": ((("sum", "p.xgot - (side.ga - q.own_goals_against)"),), ("p.xgot", "q.own_goals_against")),
}


def paired_columns():
    """The pair_* columns of agg.team_season_stats, in order, with their types."""
    out = []
    for name, (parts, _) in PAIRED.items():
        out += [(f"pair_{name}_{part}", "double precision") for part, _ in parts]
        out.append((f"pair_{name}_n", "integer"))
    return out
