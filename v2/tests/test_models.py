"""Models against docs/calculs: a synthetic Ligue 1 of 8 clubs, 56 matches, 88 players.

Expected values are recomputed here, in plain Python, from the rows inserted, with the
formulas of the docs; the database must agree.
"""

import os
from pathlib import Path
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega_v2 import models
from vega_v2.models import half_up, level_parts

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_MODELS_TEST_DSN")
TEAMS = range(1, 9)
SQUAD = (("G", 11), ("D", 32), ("D", 33), ("D", 34), ("D", 35), ("M", 62), ("M", 63), ("M", 64), ("M", 65), ("O", 92), ("O", 93))


def centile(values, x, direction=1):
    """docs/calculs/04-clubs/02: round(100 × (#below + ½ #equal) / n), inverted if lower is better."""
    raw = half_up(100 * (sum(v < x for v in values) + 0.5 * sum(v == x for v in values)) / len(values))
    return 100 - raw if direction == -1 else raw


class FormulaTest(unittest.TestCase):
    def test_level_examples_of_the_docs(self):
        # docs/calculs/04-clubs/03, examples A, B, C.
        self.assertAlmostEqual(level_parts("FRA", 1.0, 100)[2], 0.74, places=2)
        self.assertAlmostEqual(level_parts("ENG", 0.2, 15)[2], 0.08, places=2)
        self.assertAlmostEqual(level_parts("FRA", -0.3, None)[2], -0.46, places=2)

    def test_rounding_and_centile_examples(self):
        self.assertEqual((half_up(64.5), half_up(63.9), half_up(2.5)), (65, 64, 3))
        # 18 clubs, 11 below, none equal but the club itself -> 64.
        self.assertEqual(centile(list(range(11)) + [11] + list(range(12, 18)), 11), 64)
        # Vega index example: 0.30×80 + 0.30×60 + 0.15×70 + 0.10×50 + 0.10×40 + 0.05×55 = 64.25 -> 64.
        phases = {"attack": 80, "defence": 60, "control": 70, "pressing": 50, "finishing": 40, "set_pieces": 55}
        self.assertEqual(half_up(sum(models.PHASE_WEIGHTS[p] * v for p, v in phases.items())), 64)

    def test_generated_labels_migration_is_current(self):
        self.assertEqual((ROOT / "sql" / "015_metric_labels.sql").read_text(encoding="utf-8"), models.definitions_sql())


@unittest.skipUnless(DSN and psycopg, "requires disposable local models DB and psycopg")
class ModelsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_models_test":
            raise RuntimeError("dedicated local models DB required")
        from vega_v2.calculator import refresh_competition_season
        from vega_v2.store import Store, connect_local, migrate

        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        with cls.db.transaction():
            Store(cls.db).season("2025/2026")
        cls.facts = cls.build()
        refresh_competition_season(cls.db, 1)
        cls.cohorts = models.refresh_season(cls.db, 2025)

    def test_power_rankings_of_clubs(self):
        rows = self.db.execute("SELECT team_id, elo, rank, matches, scope FROM agg.team_power WHERE season_id=2025 ORDER BY rank").fetchall()
        self.assertEqual(len(rows), 8)
        self.assertTrue(all(r[4] == "clubs" and r[3] == 14 for r in rows))
        self.assertAlmostEqual(sum(r[1] for r in rows) / 8, 1500, places=2)  # Elo only moves points between clubs
        self.assertEqual([r[2] for r in rows], sorted(r[2] for r in rows))
        points = self.facts["points"]
        self.assertGreater(points[rows[0][0]], points[rows[-1][0]])

    def test_power_rankings_of_players(self):
        from vega_v2 import power

        for slot in range(0, 121):
            self.assertEqual(self.db.execute("SELECT core.power_role(%s)", (slot,)).fetchone()[0], power.ROLE_OF_SLOT(slot), slot)
        ranked = self.db.execute(
            "SELECT player_id, role, minutes, total, rate, score, rank, role_rank FROM agg.player_power WHERE season_id=2025 AND eligible ORDER BY rank"
        ).fetchall()
        self.assertEqual(len(ranked), 88)  # 14 matches of 90 minutes: everyone is eligible
        self.assertEqual({r[1] for r in ranked}, {"goalkeeper", "full_back", "centre_back", "defensive_midfielder", "winger", "centre_forward"})
        self.assertTrue(all(0 <= r[5] <= 100 for r in ranked))
        self.assertEqual(ranked[0][6], 1)
        for player, role, minutes, total, rate, *_ in ranked[:5]:
            self.assertAlmostEqual(rate, 90 * total / (minutes + 450), places=3)
            summed = self.db.execute(
                "SELECT sum(contribution), sum(minutes) FROM agg.player_power_matches WHERE season_id=2025 AND player_id=%s", (player,)
            ).fetchone()
            self.assertAlmostEqual(summed[0], total, places=3)
            self.assertEqual(summed[1], minutes)
        # The best of each role is first of his role.
        for role in {r[1] for r in ranked}:
            mine = [r for r in ranked if r[1] == role]
            self.assertEqual(min(r[7] for r in mine), 1)
        run = self.db.execute("SELECT method_version, elo_k, regularisation_minutes, eligibility_minutes FROM agg.power_runs WHERE kind='players' AND status='published'").fetchone()
        self.assertEqual(run, ("power-ranking-v1", 20.0, 450.0, 900.0))

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    @classmethod
    def build(cls):
        x = cls.db.execute
        x("INSERT INTO core.competitions(id,name,country_code,kind) VALUES(1,'Ligue 1',NULL,'league')")
        x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES('competition','pitchapi','l_3FJFUl',1)")
        x("INSERT INTO core.competition_seasons(id,competition_id,season_id,native_label) VALUES(1,1,2025,'2025/2026')")
        x("INSERT INTO core.teams(id,name) SELECT t, 'Club ' || t FROM generate_series(1,8) t")
        # A UEFA coefficient for club 1 only; the others take the association floor.
        x("INSERT INTO core.ranking_editions(id,kind,provider,label,is_current) VALUES(1,'uefa_clubs','uefa','2025/2026',true)")
        x("INSERT INTO core.ranking_rows(edition_id,row_no,team_id,position,points) VALUES(1,1,1,10,100)")
        players = []
        for team in TEAMS:
            for slot, (group, position) in enumerate(SQUAD):
                pid = team * 100 + slot
                players.append((pid, team, group, position))
                birth = "2000-01-01" if team == 1 else None
                x("INSERT INTO core.players(id,name,birth_date) VALUES(%s,%s,%s)", (pid, f"P{pid}", birth))
        facts = {k: {t: 0 for t in TEAMS} for k in ("points", "matches", "goals_for", "goals_against")}
        facts["recoveries"] = {}
        mid = 0
        for home in TEAMS:
            for away in TEAMS:
                if home == away:
                    continue
                mid += 1
                hs, as_ = (home * 3 + away) % 4, (away * 2 + home) % 3
                x(
                    "INSERT INTO core.matches(id,competition_season_id,season_id,source,status,home_team_id,away_team_id,home_score,away_score,match_date) VALUES(%s,1,2025,'pitchapi','finished',%s,%s,%s,%s,'2025-10-01')",
                    (mid, home, away, hs, as_),
                )
                x("INSERT INTO core.match_coverage(season_id,match_id) VALUES(2025,%s)", (mid,))
                for team, gf, ga in ((home, hs, as_), (away, as_, hs)):
                    facts["points"][team] += 3 if gf > ga else 1 if gf == ga else 0
                    facts["matches"][team] += 1
                    facts["goals_against"][team] += ga
                    facts["goals_for"][team] += gf
                    x(
                        """INSERT INTO core.team_match_stats(season_id,match_id,team_id,period,xg,npxg,total_shots,shots_on_target,possession_pct,
                             passes,accurate_passes,touches_opp_box,big_chances,duels_won,aerials_won,tackles,interceptions,fouls,corners,
                             opposition_half_passes,own_half_passes,long_balls_accurate,accurate_crosses,xg_set_play)
                           VALUES(2025,%s,%s,'all',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (mid, team, 0.4 + 0.15 * team + 0.05 * (mid % 3), 0.35 + 0.15 * team, 8 + team + mid % 4, 3 + team % 3,
                         40 + team * 2 + (mid % 5), 300 + team * 20, 240 + team * 18, 15 + team, 1 + team % 4, 40 + mid % 7,
                         12 + team % 5, 14 + mid % 6, 9 + team % 4, 11 + mid % 3, 4 + team % 3, 120 + team * 10, 150 - team * 5,
                         20 + team % 6, 3 + mid % 4, 0.1 + 0.02 * team),
                    )
                for pid, team, group, position in players:
                    if team not in (home, away):
                        continue
                    # Player 102 (a defender) has no xG in one match: no xG ranking for him.
                    xg = None if (pid == 102 and mid == 1) else round(0.01 * (pid % 17), 2)
                    recoveries = (pid * 7 + mid) % 9
                    facts["recoveries"][pid] = facts["recoveries"].get(pid, 0) + recoveries
                    x(
                        """INSERT INTO core.player_match_stats(season_id,match_id,team_id,player_id,position_id,minutes_played,goals,xg,
                             total_shots,recoveries,interceptions,tackles,clearances,shot_blocks,duels_won,duels_lost,accurate_passes,
                             accurate_passes_total,touches,chances_created,passes_into_final_third,dribbles_succeeded,touches_opp_box,saves,goals_prevented)
                           VALUES(2025,%s,%s,%s,%s,90,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (mid, team, pid, position, int((pid + mid) % 5 == 0), xg, pid % 4, recoveries, (pid + mid) % 4, (pid * 3 + mid) % 5,
                         (pid + 2 * mid) % 6, pid % 3, (pid * 5 + mid) % 8, (pid + mid) % 7, 20 + pid % 30, 30 + pid % 30,
                         40 + (pid * 11 + mid) % 25, (pid + mid) % 4, (pid * 2 + mid) % 6, pid % 5, (pid + mid) % 3,
                         (pid + mid) % 6 if group == "G" else None, 0.1 * ((pid + mid) % 3) if group == "G" else None),
                    )
        facts["players"] = players
        return facts

    def one(self, sql, *args):
        return self.db.execute(sql, args).fetchone()

    def cohort(self, key):
        return self.one("SELECT id FROM agg.cohorts WHERE key=%s", key)[0]

    def test_cohorts_of_a_top7_league(self):
        keys = {k for (k,) in self.db.execute("SELECT key FROM agg.cohorts")}
        expected = {"team:2025:cs:1", "team:2025:europe"} | {
            f"player:2025:{scope}:{g}" for scope in ("cs:1", "europe") for g in "GDMO"
        }
        self.assertEqual(keys, expected)
        self.assertEqual(self.one("SELECT per_match, universe::text FROM agg.cohorts WHERE key='team:2025:europe'"), (True, "europe"))
        runs = dict(self.db.execute("SELECT kind::text, count(*) FROM agg.calc_runs WHERE status='published' GROUP BY 1"))
        self.assertEqual(runs["percentiles"], 10)
        self.assertEqual(self.one("SELECT count(*) FROM agg.calc_runs WHERE status='running'")[0], 0)

    def test_club_percentiles_ranks_and_distributions(self):
        cohort = self.cohort("team:2025:cs:1")
        ppm = {t: self.facts["points"][t] / self.facts["matches"][t] for t in TEAMS}
        gapm = {t: self.facts["goals_against"][t] / self.facts["matches"][t] for t in TEAMS}
        for team in TEAMS:
            value, pct, rank = self.one(
                "SELECT value, percentile, rank FROM agg.team_percentiles WHERE cohort_id=%s AND team_id=%s AND metric_key='ppm'", cohort, team
            )
            self.assertAlmostEqual(value, ppm[team], places=5)
            self.assertEqual(pct, centile(list(ppm.values()), ppm[team]))
            self.assertEqual(rank, 1 + sum(v > ppm[team] for v in ppm.values()))
            # Lower is better: the percentile is inverted and the rank counts lower values.
            pct, rank = self.one(
                "SELECT percentile, rank FROM agg.team_percentiles WHERE cohort_id=%s AND team_id=%s AND metric_key='goals_against_pm'", cohort, team
            )
            self.assertEqual(pct, centile(list(gapm.values()), gapm[team], -1))
            self.assertEqual(rank, 1 + sum(v < gapm[team] for v in gapm.values()))
        median = sorted(ppm.values())
        self.assertAlmostEqual(
            self.one("SELECT p50 FROM agg.cohort_distributions WHERE cohort_id=%s AND metric_key='ppm'", cohort)[0],
            (median[3] + median[4]) / 2, places=5,
        )
        self.assertEqual(self.one("SELECT size FROM agg.cohorts WHERE id=%s", cohort)[0], 8)

    def test_club_index_phases_and_positions(self):
        cohort = self.cohort("team:2025:cs:1")
        pct = {}
        for team, key, value in self.db.execute(
            "SELECT team_id, metric_key, percentile FROM agg.team_percentiles WHERE cohort_id=%s AND percentile IS NOT NULL", (cohort,)
        ):
            pct.setdefault(team, {})[key] = value
        indices = {}
        for team in TEAMS:
            phases = {}
            for phase, keys in models.TEAM_PHASES.items():
                known = [pct[team][k] for k in keys if k in pct[team]]
                phases[phase] = half_up(sum(known) / len(known)) if known else None
            used = {p: w for p, w in models.PHASE_WEIGHTS.items() if phases[p] is not None}
            indices[team] = half_up(sum(w * phases[p] for p, w in used.items()) / sum(used.values()))
            row = self.one("SELECT vega_index, attack, defence FROM agg.team_index WHERE cohort_id=%s AND team_id=%s", cohort, team)
            self.assertEqual(row, (indices[team], phases["attack"], phases["defence"]))
        for team in TEAMS:
            self.assertEqual(
                self.one("SELECT vega_rank FROM agg.team_index WHERE cohort_id=%s AND team_id=%s", cohort, team)[0],
                1 + sum(v > indices[team] for v in indices.values()),
            )
        # Position follows the standings: points, then goal difference, then goals scored.
        f = self.facts
        table = {t: (f["points"][t], f["goals_for"][t] - f["goals_against"][t], f["goals_for"][t]) for t in TEAMS}
        for team in TEAMS:
            self.assertEqual(
                self.one("SELECT position FROM agg.team_index WHERE cohort_id=%s AND team_id=%s", cohort, team)[0],
                1 + sum(v > table[team] for v in table.values()),
            )

    def test_player_percentiles_coverage_and_thresholds(self):
        defenders = self.cohort("player:2025:cs:1:D")
        keepers = self.cohort("player:2025:cs:1:G")
        d_players = [p for p, _, g, _ in self.facts["players"] if g == "D"]
        per90 = {p: 90 * self.facts["recoveries"][p] / (14 * 90) for p in d_players}
        for pid in (101, 204, 803):
            value, pct, rank = self.one(
                "SELECT value_p90, percentile, rank FROM agg.player_percentiles WHERE cohort_id=%s AND player_id=%s AND metric_key='recoveries'",
                defenders, pid,
            )
            self.assertAlmostEqual(value, per90[pid], places=4)
            self.assertEqual(pct, centile(list(per90.values()), per90[pid]))
            self.assertEqual(rank, 1 + sum(v > per90[pid] for v in per90.values()))
        # xG missing on one of his matches: no xG value for player 102 (and still 31 others).
        self.assertIsNone(self.one("SELECT 1 FROM agg.player_percentiles WHERE cohort_id=%s AND player_id=102 AND metric_key='xg'", defenders))
        self.assertEqual(
            self.one("SELECT count(*) FROM agg.player_percentiles WHERE cohort_id=%s AND metric_key='xg'", defenders)[0], 31
        )
        # 8 keepers: values and ranks, but fewer than 30 peers so no percentile.
        self.assertEqual(
            self.one("SELECT count(*), count(percentile) FROM agg.player_percentiles WHERE cohort_id=%s AND metric_key='saves'", keepers),
            (8, 0),
        )

    def test_roles_player_index_and_similarity(self):
        defenders = self.cohort("player:2025:cs:1:D")
        europe = self.cohort("player:2025:europe:D")
        roles = {r for (r,) in self.db.execute("SELECT DISTINCT role_code FROM agg.player_role_scores WHERE cohort_id=%s", (defenders,))}
        self.assertEqual(roles, {"recovery", "box_defence", "build_up"})
        pct = dict(
            self.db.execute(
                "SELECT metric_key, percentile FROM agg.player_percentiles WHERE cohort_id=%s AND player_id=101", (defenders,)
            ).fetchall()
        )
        score = self.one("SELECT score FROM agg.player_role_scores WHERE cohort_id=%s AND player_id=101 AND role_code='recovery'", defenders)[0]
        self.assertEqual(score, half_up((pct["recoveries"] + pct["interceptions"] + pct["tackles"]) / 3))
        self.assertEqual(
            self.one("SELECT count(*) FROM agg.player_role_scores WHERE cohort_id=%s AND is_primary", defenders)[0], 32
        )
        # Index: the primary role score in the canonical (Europe) cohort.
        self.assertEqual(
            self.one("SELECT vega_index, potential FROM agg.player_index WHERE player_id=101 AND season_id=2025"),
            (self.one("SELECT score FROM agg.player_role_scores WHERE cohort_id=%s AND player_id=101 AND is_primary", europe)[0], None),
        )
        # Similarity: 100 − mean percentile gap over the axes both players have.
        sim, other = self.one(
            "SELECT similarity, similar_player_id FROM agg.player_similar WHERE cohort_id=%s AND player_id=101 AND rank=1", defenders
        )
        mine = {k: v for k, v in pct.items() if k in models.PLAYER_SIMILARITY_AXES and v is not None}
        theirs = dict(
            self.db.execute(
                "SELECT metric_key, percentile FROM agg.player_percentiles WHERE cohort_id=%s AND player_id=%s AND percentile IS NOT NULL",
                (defenders, other),
            ).fetchall()
        )
        common = [k for k in mine if k in theirs]
        self.assertAlmostEqual(sim, 100 - sum(abs(mine[k] - theirs[k]) for k in common) / len(common), places=3)
        self.assertEqual(self.one("SELECT max(rank) FROM agg.team_similar WHERE cohort_id=%s", self.cohort("team:2025:cs:1"))[0], 7)

    def test_levels_strength_and_squad(self):
        xgd = self.one(
            "SELECT (has_xg_for - has_xg_against) / xpts_matches FROM agg.team_season_stats WHERE team_id=1 AND competition_season_id=1"
        )[0]
        # Club 1 has a coefficient; club 2 takes the "other" floor (country unknown).
        self.assertAlmostEqual(self.one("SELECT level FROM agg.team_levels WHERE team_id=1")[0], level_parts(None, xgd, 100)[2], places=5)
        xgd2 = self.one("SELECT (has_xg_for - has_xg_against) / xpts_matches FROM agg.team_season_stats WHERE team_id=2")[0]
        self.assertAlmostEqual(self.one("SELECT level FROM agg.team_levels WHERE team_id=2")[0], level_parts(None, xgd2, None)[2], places=5)
        goals = self.one("SELECT sum(home_score + away_score)::float / count(*) FROM core.matches")[0]
        self.assertEqual(self.one("SELECT strength FROM agg.competition_strength WHERE competition_season_id=1")[0], 50)
        self.assertAlmostEqual(self.one("SELECT goals_per90 FROM agg.competition_strength")[0], goals, places=5)
        # Only club 1's players have a birth date; no market value source yet.
        self.assertEqual(
            self.one("SELECT squad_value_eur, minutes_24_26 FROM agg.team_squad_profile WHERE team_id=1 AND season_id=2025"),
            (None, 11 * 14 * 90),
        )
        self.assertEqual(self.one("SELECT count(*) FROM agg.team_squad_profile")[0], 1)
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_projections")[0], 0)
        self.assertEqual(self.one("SELECT count(*) FROM agg.player_award_ranking")[0], 0)

    def test_z_incremental_cohort_refresh(self):
        from vega_v2.calculator import process_dirty

        self.db.execute("UPDATE core.matches SET home_score = home_score + 3 WHERE id = 1")
        self.db.execute("INSERT INTO ops.dirty_scopes(scope_kind, competition_season_id) VALUES ('competition_season', 1)")
        before = self.one("SELECT percentile FROM agg.team_percentiles WHERE cohort_id=%s AND team_id=1 AND metric_key='goals_for_pm'", self.cohort("team:2025:cs:1"))[0]
        process_dirty(self.db)
        self.assertEqual(models.process_cohorts(self.db, min_age_seconds=3600), 0)  # debounced
        self.assertEqual(models.process_cohorts(self.db, min_age_seconds=0), 10)
        after = self.one("SELECT percentile FROM agg.team_percentiles WHERE cohort_id=%s AND team_id=1 AND metric_key='goals_for_pm'", self.cohort("team:2025:cs:1"))[0]
        self.assertGreaterEqual(after, before)
        self.assertEqual(self.one("SELECT count(*) FROM ops.dirty_scopes")[0], 0)
        self.assertEqual(self.one("SELECT count(*) FROM ops.resource_versions WHERE resource_kind='cohort'")[0], 10)
        self.db.execute("UPDATE core.matches SET home_score = home_score - 3 WHERE id = 1")


if __name__ == "__main__":
    unittest.main()
