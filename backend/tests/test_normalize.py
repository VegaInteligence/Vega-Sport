import unittest
from vega.normalize import normalize_family, number, NormalizationError

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

    def test_source_gaps_seen_on_live_matches(self):
        # 2026-11-08: no shot map ("periods": null) is an unavailable family, not an error.
        self.assertEqual(normalize_family("shots", {"match_id": "m_123456", "periods": None}).coverage, "unavailable")
        # A shot without its shooter ({"id": ""}) is kept, unattributed.
        shot = {"team_id": "t_123456", "player": {"id": "", "name": "", "position_id": None, "image_url": None}, "x": 90, "y": 50}
        rows = normalize_family("shots", {"periods": [{"period": "FirstHalf", "shots": [shot]}]}).rows["core.shots"]
        self.assertEqual([r["player_id"] for r in rows], [None])
        # A blank shirt number is none; a player listed twice keeps his first entry.
        side = lambda players: {"formation": "4-3-3", "starters": players, "subs": [dict(P, player_id="p_123456", shirt_number="12")]}
        data = {"home_team": T, "away_team": {"id": "t_654321", "name": "Other"},
                "home": side([dict(P, player_id="p_123456", shirt_number="")]), "away": side([])}
        data["away"]["subs"] = []
        players = normalize_family("lineups", data).rows["core.lineup_players"]
        self.assertEqual([(r["player_id"], r["is_starter"], r.get("shirt_number")) for r in players], [("p_123456", True, None)])
        with self.assertRaises(NormalizationError):
            normalize_family("lineups", dict(data, home=side([dict(P, player_id="p_123456", shirt_number="x")])))

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

    def test_source_gaps_seen_on_the_backfill(self):
        # 2026-11-12, seen on 97 line-ups of one league: a coach the source does not name ({"name": ""}) is none.
        side = lambda coach: {"formation": "4-2-3-1", "coach": coach, "starters": [dict(P, player_id="p_123456")], "subs": []}
        data = {"home_team": T, "away_team": {"id": "t_654321", "name": "Other"}, "home": side({"name": ""}), "away": side({"name": "Ana Coach"})}
        got = normalize_family("lineups", data)
        self.assertEqual([r.get("coach_id") for r in got.rows["core.lineups"]], [None, "Ana Coach"])
        self.assertEqual([r.natural_name for r in got.references if r.entity_type == "coach"], ["Ana Coach"])
        with self.assertRaises(NormalizationError):
            normalize_family("lineups", dict(data, home=side({"name": 7})))
        # A line-up not published yet names a formation and no player: unavailable, to be asked again.
        empty = {"formation": "4-3-3", "confirmed": True, "starters": None, "subs": None}
        self.assertEqual(normalize_family("lineups", dict(data, home=empty, away=empty)).coverage, "unavailable")
        # One side published: it is kept, the other has its formation and no player.
        half = normalize_family("lineups", dict(data, home=empty))
        self.assertEqual((half.coverage, len(half.rows["core.lineups"]), [r["team_id"] for r in half.rows["core.lineup_players"]]), ("ok", 2, ["t_654321"]))
        # Extra time: the statistics of its two halves are left out; the match and its halves are kept.
        item = {"key": "total_shots", "home": "9", "away": "4", "format_type": "integer"}
        stats = {"home_team": T, "away_team": {"id": "t_654321", "name": "Other"},
                 "periods": [{"period": name, "groups": [{"items": [item]}]} for name in ("All", "FirstHalf", "SecondHalf", "FirstExtraHalf", "SecondExtraHalf")]}
        rows = normalize_family("stats", stats).rows["core.team_match_stats"]
        self.assertEqual(sorted({r["period"] for r in rows}), ["all", "first_half", "second_half"])
        with self.assertRaises(NormalizationError):  # a period nobody knows is still refused
            normalize_family("stats", dict(stats, periods=[{"period": "ThirdHalf", "groups": []}]))

    def test_fields_the_collector_left_out_until_november_2026(self):
        # The source's own answers of 12 November 2026 (a Premier League match, a Serie B one).
        items = [
            {"key": "physical_metrics_distance_covered", "home": "116276", "away": "108097", "format_type": "distance"},
            {"key": "physical_metrics_number_of_sprints", "home": "96", "away": "97", "format_type": "integer"},
            {"key": "physical_metrics_running", "home": "24904", "away": "22307", "format_type": "distance"},
            {"key": "physical_metrics_sprinting", "home": "1731", "away": "1702", "format_type": "distance"},
            {"key": "poss_won_att_3rd", "home": "3", "away": "3", "format_type": "integer"},
            {"key": "poss_won_mid_3rd", "home": "19", "away": "22", "format_type": "integer"},
            {"key": "poss_won_def_3rd", "home": "18", "away": "16", "format_type": "integer"},
            {"key": "ppda", "home": "7.60", "away": "16.70", "format_type": "double"},
            {"key": "recoveries", "home": "47", "away": "46", "format_type": "integer"},
            {"key": "final_third_entries", "home": "38 (68%)", "away": "32 (55%)", "format_type": "integerWithPercentage"},
            {"key": "penalty_area_entries", "home": "13 (68%)", "away": "6 (25%)", "format_type": "integerWithPercentage"},
        ]
        stats = {"home_team": T, "away_team": {"id": "t_654321", "name": "Other"}, "periods": [{"period": "All", "groups": [{"items": items}]}]}
        got = normalize_family("stats", stats)
        self.assertEqual(got.unknown_paths, set())
        home, away = got.rows["core.team_match_stats"]
        self.assertEqual([home[k] for k in ("distance_m", "sprints", "running_m", "sprinting_m")], [116276.0, 96, 24904.0, 1731.0])
        self.assertEqual([home[k] for k in ("poss_won_att_3rd", "poss_won_mid_3rd", "poss_won_def_3rd", "recoveries")], [3, 19, 18, 47])
        self.assertEqual((home["ppda"], away["ppda"]), (7.6, 16.7))
        self.assertEqual([away[k] for k in ("final_third_entries", "final_third_entries_pct", "penalty_area_entries", "penalty_area_entries_pct")], [32, 55.0, 6, 25.0])
        # A player's running distance comes with his distance covered; his walking distance and a keeper's shoot-out saves are kept.
        stat = lambda key, value: {"key": key, "stat": value}
        groups = [{"stats": {
            "Running": stat("physical_metrics_running", {"total": 12102, "type": "distanceWithPercentage", "value": 2865}),
            "Sprinting": stat("physical_metrics_sprinting", {"total": 12102, "type": "distanceWithPercentage", "value": 98}),
            "Walking": stat("physical_metrics_walking", {"type": "distance", "value": 4012}),
            "Saved penalties in shootout": stat("saved_penalties_in_shootout", {"type": "integer", "value": 2}),
        }}]
        from vega import normalize as module

        class Out:
            unknown_paths = set()

        out, row = Out(), {}
        module._player_stats(out, row, groups)
        self.assertEqual(out.unknown_paths, set())
        self.assertEqual([row[k] for k in ("running_m", "sprinting_m", "distance_m", "walking_m", "shootout_penalties_saved")], [2865.0, 98.0, 12102.0, 4012.0, 2])

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
        # The day calendar lists a match with its kick-off and no day: the day is the
        # kick-off's UTC day. A match without a kick-off says nothing about its day.
        listed = {k: v for k, v in match.items() if k != "date"}
        listed["time_utc"] = "2026-01-03T00:30:00Z"
        row = normalize_family("date", {"date": "2026-01-03", "matches": [listed]}).rows["core.matches"][0]
        self.assertEqual(str(row["match_date"]), "2026-01-03")
        listed["time_utc"] = None
        row = normalize_family("date", {"date": "2026-01-03", "matches": [listed]}).rows["core.matches"][0]
        self.assertNotIn("match_date", row)
        with self.assertRaises(NormalizationError):
            normalize_family(
                "events", {"match_id": "m_654321", "events": []}, match_id="m_123456"
            )
        # A new event kind keeps the event, type empty, reported as a path; a value that is
        # not a code word is never echoed.
        got = normalize_family("events", {"events": [{"event_type": "VarDecision", "minute": 12}, {"event_type": "<b>x</b>"},
                                                     {"event_type": "SecondYellow", "minute": 80}]})
        self.assertEqual([r["event_type"] for r in got.rows["core.match_events"]], [None, None, "second_yellow"])
        self.assertEqual(got.unknown_paths, {"event.event_type.VarDecision", "event.event_type.invalid"})

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


class NewProviderCodesTest(unittest.TestCase):
    def test_unknown_shot_codes_keep_the_shot(self):
        from vega.normalize import normalize_family

        batch = normalize_family(
            "shots",
            {"periods": [{"period": "FirstHalf", "shots": [
                {"id": "s_111111", "team_id": "t_111111", "minute": 3, "event_type": "Deflected", "situation": "KickOff"}
            ]}]},
        )
        self.assertEqual(len(batch.rows["core.shots"]), 1)
        self.assertNotIn("outcome", batch.rows["core.shots"][0])
        self.assertEqual(batch.unknown_paths, {"shot.event_type.Deflected", "shot.situation.KickOff"})

    def test_own_goal_shot(self):
        from vega.normalize import normalize_family

        batch = normalize_family(
            "shots",
            {"periods": [{"period": "SecondHalf", "shots": [{"id": "s_222222", "team_id": "t_111111", "minute": 70, "event_type": "OwnGoal"}]}]},
        )
        shot = batch.rows["core.shots"][0]
        self.assertEqual((shot["outcome"], shot["is_own_goal"]), ("goal", True))
        self.assertEqual(batch.unknown_paths, set())
