import unittest
from vega_v2.normalize import normalize_family, number, NormalizationError

P = {"id": "p_123456", "name": "Example"}
T = {"id": "t_123456", "name": "Example Team"}


class NormalizeTest(unittest.TestCase):
    def test_numbers_strict(self):
        self.assertEqual(number(0, "smallint"), 0)
        for v in [1.1, 32768, float("nan"), float("inf"), True]:
            with self.assertRaises(NormalizationError):
                number(v, "smallint")
        with self.assertRaises(NormalizationError):
            number("3.5e38", "real")

    def test_empty_shots_and_events_are_known(self):
        for family, data in [("shots", {"periods": []}), ("events", {"events": []})]:
            result = normalize_family(family, data)
            self.assertEqual(result.coverage, "ok")
            self.assertEqual(result.rows, {})

    def test_player_groups_preserve_zero_and_fraction(self):
        groups = [
            {
                "key": "top_stats",
                "stats": {
                    "passes": {
                        "key": "accurate_passes",
                        "stat": {
                            "type": "fractionWithPercentage",
                            "value": 0,
                            "total": 2,
                        },
                    },
                    "x": {
                        "key": "expected_goals",
                        "stat": {"type": "double", "value": 0},
                    },
                },
            }
        ]
        row = normalize_family(
            "players", [{"player": P, "team_id": T["id"], "stats": groups}]
        ).rows["core.player_match_stats"][0]
        self.assertEqual(
            (row["accurate_passes"], row["accurate_passes_total"], row["xg"]),
            (0, 2, 0.0),
        )

    def test_advanced_zeros_only_for_observed_breakdown(self):
        row = normalize_family(
            "advanced_players",
            {
                "players": [
                    {
                        "player": P,
                        "team_id": T["id"],
                        "creation": {
                            "sca_breakdown": {"pass_live": 3},
                            "chances_created": 4,
                        },
                    }
                ]
            },
        ).rows["core.player_match_advanced"][0]
        self.assertEqual(row["sca_pass_live"], 3)
        self.assertEqual(row["sca_shot"], 0)
        self.assertNotIn("chances_created", row)
        row = normalize_family(
            "advanced_players",
            {"players": [{"player": P, "team_id": T["id"], "creation": {}}]},
        ).rows["core.player_match_advanced"][0]
        self.assertNotIn("sca_shot", row)

    def test_heatmap_shape_and_frame(self):
        data = {
            "grid": {"length": 16, "width": 12, "frame": "acting_ltr"},
            "teams": [{"team": T, "actions": 3, "cells": [[15, 11, 3]]}],
            "players": [],
        }
        row = normalize_family("heatmaps", data).rows["core.team_heatmaps"][0]
        self.assertEqual(len(row["cells"]), 192)
        self.assertEqual(row["cells"][191], 3)
        data["grid"]["frame"] = "home_ltr"
        with self.assertRaises(NormalizationError):
            normalize_family("heatmaps", data)

    def test_lineup_pitch_and_reference(self):
        data = {
            "home_team": T,
            "away_team": {"id": "t_abcdef"},
            "home": {
                "starters": [{"player_id": P["id"], "pitch_x": 0.5, "pitch_y": 0.9}],
                "subs": [],
            },
            "away": {"starters": [], "subs": []},
        }
        row = normalize_family("lineups", data).rows["core.lineup_players"][0]
        self.assertEqual(row["pitch_x"], 0.5)

    def test_official_shot_enums_and_both_team_stat_percentages(self):
        shot = {
            "team_id": T["id"],
            "player": P,
            "event_type": "AttemptSaved",
            "shot_type": "OtherBodyParts",
            "situation": "IndividualPlay",
        }
        got = normalize_family(
            "shots", {"periods": [{"period": "FirstHalf", "shots": [shot]}]}
        ).rows["core.shots"][0]
        self.assertEqual(
            (got["outcome"], got["body_part"], got["situation"]),
            ("saved", "other", "individual_play"),
        )
        data = {
            "home_team": T,
            "away_team": {"id": "t_abcdef"},
            "periods": [
                {
                    "period": "All",
                    "groups": [
                        {
                            "items": [
                                {
                                    "key": "long_balls_accurate",
                                    "home": "3 (60%)",
                                    "away": "0 (0%)",
                                    "format_type": "integerWithPercentage",
                                }
                            ]
                        }
                    ],
                }
            ],
        }
        home, away = normalize_family("stats", data).rows["core.team_match_stats"]
        self.assertEqual(
            (
                home["long_balls_accurate"],
                home["long_balls_pct"],
                away["long_balls_pct"],
            ),
            (3, 60, 0),
        )

    def test_dates_match_identity_and_unknown_error_sanitization(self):
        match = {
            "id": "m_123456",
            "home_team": T,
            "away_team": {"id": "t_abcdef"},
            "date": "2026-01-01",
            "time_utc": "2026-01-01T12:00:00Z",
            "status": "finished",
        }
        self.assertEqual(
            str(
                normalize_family("summary", match).rows["core.matches"][0]["match_date"]
            ),
            "2026-01-01",
        )
        with self.assertRaises(NormalizationError):
            normalize_family(
                "events", {"match_id": "m_654321", "events": []}, match_id="m_123456"
            )
        with self.assertRaises(NormalizationError) as e:
            normalize_family("events", {"events": [{"event_type": "secret_payload"}]})
        self.assertNotIn("secret_payload", str(e.exception))

    def test_unknown_paths_only_and_bad_formats(self):
        data = {"events": [], "future_metric": {"secret": "DO_NOT_LOG"}}
        got = normalize_family("events", data)
        self.assertEqual(got.unknown_paths, {"events.future_metric"})
        self.assertNotIn("DO_NOT_LOG", str(got.unknown_paths))
        data = {
            "home_team": T,
            "away_team": {"id": "t_abcdef"},
            "periods": [
                {
                    "period": "All",
                    "groups": [
                        {
                            "items": [
                                {
                                    "key": "passes",
                                    "home": "10",
                                    "away": "11",
                                    "format_type": "unknown",
                                }
                            ]
                        }
                    ],
                }
            ],
        }
        with self.assertRaises(NormalizationError):
            normalize_family("stats", data)

    def test_official_documented_family_shapes(self):
        cases = {
            "leagues": {
                "leagues": [
                    {
                        "id": "l_123456",
                        "name": "League",
                        "country_code": "FRA",
                        "seasons": ["2025/2026"],
                    }
                ]
            },
            "league": {"id": "l_123456", "name": "League", "season": "2025/2026"},
            "league_matches": {"league": {"id": "l_123456"}, "matches": []},
            "date": {"matches": []},
            "team": T,
            "player": P,
            "summary": {
                "id": "m_123456",
                "home_team": T,
                "away_team": {"id": "t_abcdef"},
            },
            "momentum": {"points": []},
            "h2h": {"home_wins": 0, "draws": 0, "away_wins": 0, "total_matches": 0},
            "players_halves": {"players": []},
            "advanced": {"teams": []},
            "advanced_network": {"networks": []},
            "stats": {"home_team": T, "away_team": {"id": "t_abcdef"}, "periods": []},
        }
        for family, data in cases.items():
            with self.subTest(family=family):
                self.assertEqual(normalize_family(family, data).coverage, "ok")

    def test_confirmed_player_source_aliases(self):
        aliases = {
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
        groups = [
            {
                "stats": {
                    key: {
                        "key": key,
                        "stat": {
                            "type": "double" if target == "xgot_faced" else "integer",
                            "value": 0,
                        },
                    }
                    for key, target in aliases.items()
                }
            }
        ]
        result = normalize_family(
            "players", [{"player": P, "team_id": T["id"], "stats": groups}]
        )
        row = result.rows["core.player_match_stats"][0]
        self.assertEqual(
            {target: row[target] for target in aliases.values()},
            {target: 0 for target in aliases.values()},
        )
        self.assertFalse(result.unknown_paths)

    def test_reference_unknown_paths_and_nonstring_enum_are_safe(self):
        for family, data, key in [
            (
                "league",
                {"id": "l_123456", "name": "League", "new_prop": "dont-log"},
                "league.new_prop",
            ),
            (
                "team",
                {"id": "t_123456", "name": "Team", "new_prop": "dont-log"},
                "team.new_prop",
            ),
            (
                "player",
                {"id": "p_123456", "name": "Player", "new_prop": "dont-log"},
                "player.new_prop",
            ),
        ]:
            result = normalize_family(family, data)
            self.assertIn(key, result.unknown_paths)
            self.assertNotIn("dont-log", str(result.unknown_paths))
        with self.assertRaises(NormalizationError):
            normalize_family(
                "shots", {"periods": [{"period": ["untrusted"], "shots": []}]}
            )

    def test_pilot_source_aliases_and_fraction_totals(self):
        team_alias = {
            "big_chance_missed_title": "big_chances_missed",
            "duel_won": "duels_won",
            "expected_goals_non_penalty": "npxg",
            "Offsides": "offsides",
            "player_throws": "throw_ins",
        }
        items = [
            {
                "key": key,
                "home": "0",
                "away": "0",
                "format_type": "double" if col == "npxg" else "integer",
            }
            for key, col in team_alias.items()
        ]
        data = {
            "home_team": T,
            "away_team": {"id": "t_abcdef"},
            "periods": [{"period": "All", "groups": [{"items": items}]}],
        }
        result = normalize_family("stats", data)
        row = result.rows["core.team_match_stats"][0]
        self.assertFalse(result.unknown_paths)
        for col in team_alias.values():
            self.assertEqual(row[col], 0)
        totals = {
            "aerials_won": "aerials_total",
            "dribbles_succeeded": "dribbles_total",
            "ground_duels_won": "ground_duels_total",
            "long_balls_accurate": "long_balls_total",
        }
        entries = {
            key: {
                "key": key,
                "stat": {"type": "fractionWithPercentage", "value": 0, "total": 2},
            }
            for key in totals
        }
        entries["Shot map"] = {"key": "", "stat": {"type": "boolean", "value": True}}
        result = normalize_family(
            "players",
            [{"player": P, "team_id": T["id"], "stats": [{"stats": entries}]}],
        )
        row = result.rows["core.player_match_stats"][0]
        self.assertFalse(result.unknown_paths)
        for col in totals.values():
            self.assertEqual(row[col], 2)

    def test_match_provider_scope_is_explicit_and_validated(self):
        obj = {
            "id": "m_123456",
            "home_team": T,
            "away_team": {"id": "t_abcdef"},
            "season": "2025/2026",
            "league": {"id": "l_123456"},
        }
        result = normalize_family("summary", obj, match_id="m_123456")
        row = result.rows["core.matches"][0]
        self.assertEqual(
            (row["provider_season"], row["provider_competition_id"]),
            ("2025/2026", "l_123456"),
        )
        self.assertNotIn("match.season", result.unknown_paths)
        obj["season"] = "invalid"
        with self.assertRaises(NormalizationError):
            normalize_family("summary", obj)

    def test_physical_metrics_keep_documented_units(self):
        metrics = {
            "physical_metrics_distance_covered": ("distance_m", "distance", 10324.5),
            "physical_metrics_running": ("running_m", "distance", 3234.5),
            "physical_metrics_sprinting": ("sprinting_m", "distance", 523.5),
            "physical_metrics_topspeed": ("top_speed_kmh", "speed", 33.4),
            "physical_metrics_number_of_sprints": ("sprints", "integer", 17),
        }
        groups = [
            {
                "stats": {
                    key: {"key": key, "stat": {"type": kind, "value": value}}
                    for key, (column, kind, value) in metrics.items()
                }
            }
        ]
        result = normalize_family(
            "players", [{"player": P, "team_id": T["id"], "stats": groups}]
        )
        row = result.rows["core.player_match_stats"][0]
        for key, (column, kind, value) in metrics.items():
            self.assertEqual(row[column], value)
        self.assertFalse(result.unknown_paths)

    def test_accurate_passes_published_percentage_is_not_lost(self):
        data = {
            "home_team": T,
            "away_team": {"id": "t_abcdef"},
            "periods": [
                {
                    "period": "All",
                    "groups": [
                        {
                            "items": [
                                {
                                    "key": "accurate_passes",
                                    "home": "329 (82%)",
                                    "away": "0 (0%)",
                                    "format_type": "integerWithPercentage",
                                }
                            ]
                        }
                    ],
                }
            ],
        }
        home, away = normalize_family("stats", data).rows["core.team_match_stats"]
        self.assertEqual(
            (home["accurate_passes"], home["accurate_passes_pct"]), (329, 82.0)
        )
        self.assertEqual(
            (away["accurate_passes"], away["accurate_passes_pct"]), (0, 0.0)
        )
