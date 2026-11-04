"""Football domain schema shared by the ingestion worker and SQL migration renderer.

Objects with a fixed, small cardinality (player identity, team identity, pitch grid
definition) become typed columns on their event. Repeated entities are separate
tables with foreign keys to their parent and an explicit provider ordinal.
"""

from copy import deepcopy
from dataclasses import dataclass


@dataclass(frozen=True)
class Children:
    table: str
    fields: dict
    keyed: bool = False


def columns(text="", integer="", number="", boolean=""):
    return {
        name: kind
        for names, kind in (
            (text, "text"),
            (integer, "integer"),
            (number, "double precision"),
            (boolean, "boolean"),
        )
        for name in names.split()
    }


team = columns("id name image_url")
player = dict(columns("id name image_url", "position_id shirt_number"))
fixture = dict(
    columns("id date time_utc status", "score_home score_away"),
    home_team=team,
    away_team=team,
)
context = dict(
    columns(
        "competition_id competition_name country_code season retrieved_at_utc",
        boolean="complete",
    ),
    fixture=fixture,
)
summary = dict(
    fixture,
    league=team,
    **columns("season round_name referee stadium", boolean="has_playoff"),
)
event = dict(
    columns(
        "event_type period team_id",
        "minute minute_added score_home score_away",
        boolean="is_own_goal is_penalty",
    ),
    player=player,
    sub_in_player=player,
)
shot = dict(
    columns(
        "id team_id shot_type situation event_type",
        "minute minute_added",
        "x y expected_goals expected_goals_on_target goal_crossed_y goal_crossed_z blocked_x blocked_y",
        "is_on_target is_inside_box is_blocked",
    ),
    player=player,
    keeper=player,
)
lineup_member = columns(
    "player_id name shirt_number", "position_id", "pitch_x pitch_y", "is_captain"
)
team_sides = {"home_team": team, "away_team": team}


def lineup_side(side):
    return dict(
        columns("formation lineup_type", boolean="confirmed"),
        coach=columns("name"),
        starters=Children("lineup_" + side + "_starters", lineup_member),
        subs=Children("lineup_" + side + "_substitutes", lineup_member),
    )


def stat_groups(prefix):
    return Children(
        prefix + "_groups",
        dict(
            columns("key title"),
            stats=Children(
                prefix + "_metrics",
                dict(columns("key"), stat=columns("type", number="value total")),
                keyed=True,
            ),
        ),
    )


player_row = dict(columns("team_id"), player=player)
value = columns(
    number="xt_total vaep_total vaep_offensive vaep_defensive pv_total pv_offensive pv_defensive"
)
passing = columns(
    number="passes pass_accuracy progressive_passes progressive_pass_distance passes_into_box key_passes assists through_balls crosses switches"
)
carrying = columns(
    number="carries carry_distance progressive_carries progressive_carry_distance carries_into_final_third carries_into_box take_ons take_ons_won miscontrols dispossessed"
)
creation = dict(
    columns(number="sca gca chances_created second_assists xag xg_chain xg_buildup"),
    sca_breakdown=columns(
        number="pass_live pass_dead take_on shot foul_drawn defensive"
    ),
)
defending = columns(
    number="tackles interceptions blocks clearances duels_won aerials aerials_won ppda opponent_passes defensive_actions challenges avg_defensive_action_x high_turnovers counterpress_regains_5s ball_recovery_time"
)
advanced = dict(
    columns(integer="actions"),
    possession_value=value,
    passing=passing,
    carrying=carrying,
    creation=creation,
    defending=defending,
)
territory = columns(
    number="possession_pct field_tilt final_third_entries box_entries avg_action_x"
)
tempo = columns(
    number="passes_per_sequence sequence_time direct_speed buildup_attacks direct_attacks"
)
goalkeeping = columns(
    number="claims claims_won claim_rate sweeper_actions distributions launches launch_pct avg_pass_length distribution_accuracy"
)
network = dict(
    columns(number="centralization"),
    team=team,
    window=columns("kind", "until_seconds"),
    nodes=Children(
        "pass_nodes",
        dict(
            columns(
                number="avg_x avg_y passes passes_received degree strength betweenness clustering"
            ),
            player=player,
        ),
    ),
    edges=Children("pass_edges", {"from": player, "to": player, "passes": "integer"}),
)
grid = columns("frame", "length width", "cell_length_m cell_width_m")
# Each sparse cell is the provider's integer triplet [column, row, count].
heat_participant = dict(columns("side", "actions"), team=team, cells="integer[][]")
head = columns("match_id")
team_stat_group = dict(
    columns("group_name"),
    items=Children("team_stat_items", columns("title key home away format_type")),
)
team_stat_period = dict(
    columns("period"), groups=Children("team_stat_groups", team_stat_group)
)
families = {
    "match": Children("match_summaries", summary),
    "events": Children(
        "event_sheets", dict(head, events=Children("match_events", event))
    ),
    "shots": Children(
        "shot_sheets",
        dict(
            head,
            periods=Children(
                "shot_periods",
                dict(columns("period"), shots=Children("match_shots", shot)),
            ),
        ),
    ),
    "stats": Children(
        "team_stat_sheets",
        dict(
            head, **team_sides, periods=Children("team_stat_periods", team_stat_period)
        ),
    ),
    "lineups": Children(
        "lineup_sheets",
        dict(head, **team_sides, home=lineup_side("home"), away=lineup_side("away")),
    ),
    "players": Children(
        "player_sheets",
        {
            "players": Children(
                "match_players", dict(player_row, stats=stat_groups("player_stat"))
            )
        },
    ),
    "player_halves": Children(
        "half_sheets",
        dict(
            head,
            players=Children(
                "half_players",
                dict(
                    player_row,
                    periods=Children(
                        "player_periods",
                        dict(columns("period"), stats=stat_groups("half_stat")),
                    ),
                ),
            ),
        ),
    ),
    "momentum": Children(
        "momentum_sheets",
        dict(head, points=Children("momentum_points", columns(number="minute value"))),
    ),
    "h2h": Children(
        "h2h_sheets",
        dict(
            head,
            **team_sides,
            **columns(integer="home_wins draws away_wins total_matches"),
            recent_matches=Children(
                "h2h_matches",
                dict(
                    columns("time_utc", "score_home score_away", boolean="finished"),
                    home=team,
                    away=team,
                ),
            ),
        ),
    ),
    "advanced_teams": Children(
        "advanced_team_sheets",
        dict(
            head,
            teams=Children(
                "advanced_team_totals",
                dict(advanced, team=team, territory=territory, tempo=tempo),
            ),
        ),
    ),
    "advanced_players": Children(
        "advanced_player_sheets",
        dict(
            head,
            **columns("sorted_by"),
            players=Children(
                "advanced_player_totals",
                dict(
                    advanced,
                    **player_row,
                    **columns(integer="minutes_played"),
                    goalkeeping=goalkeeping,
                ),
            ),
        ),
    ),
    "pass_networks": Children(
        "network_sheets", dict(head, networks=Children("pass_networks", network))
    ),
    "heatmaps": Children(
        "heatmap_sheets",
        dict(
            head,
            grid=grid,
            teams=Children("team_heatmaps", heat_participant),
            players=Children("player_heatmaps", dict(heat_participant, player=player)),
        ),
    ),
}

# A saved single-player shot list names its player even when the list is empty.
families["player_shots"] = Children(
    "player_shot_sheets",
    {"player": player, "shots": Children("individual_player_shots", shot)},
)

# These independent saved resources share the domain tables of the batch endpoint.
# Their resource_id and subject_id retain their own status, body shape and timestamp.
nested_families = {
    "single_shot": "shots",
    "single_player": "players",
    "single_halves": "player_halves",
    "single_advanced": "advanced_players",
    "player_shots": "player_shots",
}


# The first four migrations were already published. Retain the 004 contract so
# its original DDL is reproducible and 007 can upgrade previously populated rows.
families_v004 = deepcopy(families)
shot.update(columns(boolean="is_own_goal is_saved_off_line"))


# Match-level playing position is independent of the player's identity metadata.
# Individually saved player responses reuse this same table.
families["players"].fields["players"].fields["position_id"] = "integer"
