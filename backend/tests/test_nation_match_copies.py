"""A match two editions hold, on the nation pages (FAILURE_MODES.md §43.2, 43k–43r), end to end on a disposable
PostgreSQL through GET /api/nations and GET /api/nations/{id} under vega_read (tests/read_http.mjs).

Written before the correction. The fixture is Argentina's World Cup 2026 as production held it on 19 November 2026
(`evidence/prod/raw/nation-t_0WmIZB.body`): 8 PitchAPI matches, their OpenFootball copies in the edition
`open-cups:world-cup-history:2026` (3 dated the day before, 5 the same day), the family's competition named after
its first edition (« World Cup 1930 »), and edge cases on 2022 and on friendlies. Failure modes: a copy one day
earlier listed as a second match; an archive match labelled with the family's first edition; two real matches one
day apart merged; the kept match losing the shoot-out its copy holds.
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from prerequisites import required  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_CLASSEMENTS_TEST_DSN")
NODE_READY = bool(shutil.which("node")) and (ROOT / "api" / "node_modules" / "pg").is_dir()
ARG = 1
TEAMS = {1: ("Argentina", "t_0WmIZB"), 2: ("Algeria", "t_2YDUOZ"), 3: ("Austria", "t_2lbA3n"), 4: ("Jordan", "t_1xZ20V"),
         5: ("Cape Verde", "t_0rmH6L"), 6: ("Egypt", "t_11chjf"), 7: ("Switzerland", "t_1sdYCl"), 8: ("England", "t_46FWvW"),
         9: ("Spain", "t_486gYN"), 10: ("Saudi Arabia", "t_sau000"), 11: ("Mexico", "t_0IuuRb"), 12: ("France", "t_2ysHaw"),
         13: ("Poland", "t_pol000"), 14: ("Australia", "t_aus000"), 15: ("Brazil", "t_bra000"), 16: ("Netherlands", "t_ned000")}
# Editions: id -> (competition, season id, native label, cup key, cup name).
NATIVE_2026, ARCHIVE_2026, NATIVE_2022, ARCHIVE_2022, ARCHIVE_1978, FRIENDLIES, FRIENDLIES_ARCHIVE = 10, 11, 12, 13, 14, 15, 16
EDITIONS = {
    NATIVE_2026: (100, 2025, "2026", None, None), ARCHIVE_2026: (101, 2025, "2026", "open-cups:world-cup-history:2026", "World Cup 2026"),
    NATIVE_2022: (100, 2022, "2022", None, None), ARCHIVE_2022: (101, 2022, "2022", "open-cups:world-cup-history:2022", "World Cup 2022"),
    ARCHIVE_1978: (101, 1977, "1978", "open-cups:world-cup-history:1978", "World Cup 1978"),
    FRIENDLIES: (102, 2026, "2027", None, None), FRIENDLIES_ARCHIVE: (103, 2026, "2027", "nations-results:friendly:2027", "Friendlies 2027"),
}
# (id, edition, day, home, away, score or None, round, penalties or None)
MATCHES = [
    # World Cup 2026, PitchAPI (production's rounds and scores).
    (101, NATIVE_2026, "2026-06-17", 1, 2, (3, 0), "1", None), (102, NATIVE_2026, "2026-06-22", 1, 3, (2, 0), "2", None),
    (103, NATIVE_2026, "2026-06-28", 4, 1, (1, 3), "3", None), (104, NATIVE_2026, "2026-07-03", 1, 5, (3, 2), "1/16", None),
    (105, NATIVE_2026, "2026-07-07", 1, 6, (3, 2), "1/8", None), (106, NATIVE_2026, "2026-07-12", 1, 7, (3, 1), "1/4", None),
    (107, NATIVE_2026, "2026-07-15", 8, 1, (1, 2), "1/2", None), (108, NATIVE_2026, "2026-07-19", 9, 1, (1, 0), "final", None),
    # Their OpenFootball copies: three the day before (as served in production), five the same day.
    (201, ARCHIVE_2026, "2026-06-16", 1, 2, (3, 0), "Matchday 6", None), (203, ARCHIVE_2026, "2026-06-27", 4, 1, (1, 3), "Matchday 17", None),
    (206, ARCHIVE_2026, "2026-07-11", 1, 7, (3, 1), "Quarter-final", None), (202, ARCHIVE_2026, "2026-06-22", 1, 3, (2, 0), "Matchday 11", None),
    (204, ARCHIVE_2026, "2026-07-03", 1, 5, (3, 2), "Round of 32", None), (205, ARCHIVE_2026, "2026-07-07", 1, 6, (3, 2), "Round of 16", None),
    (207, ARCHIVE_2026, "2026-07-15", 8, 1, (1, 2), "Semi-final", None), (208, ARCHIVE_2026, "2026-07-19", 9, 1, (1, 0), "Final", None),
    # 43l: the copy of the day before with another score; 43p: two days before; 43q: the shoot-out only in the copy;
    # 43n: the same day; 43m: two matches one day apart in one edition.
    (301, NATIVE_2022, "2022-11-22", 1, 10, (1, 2), "1", None), (401, ARCHIVE_2022, "2022-11-21", 1, 10, (2, 1), "Matchday 3", None),
    (302, NATIVE_2022, "2022-11-26", 1, 11, (2, 0), "2", None), (402, ARCHIVE_2022, "2022-11-24", 1, 11, (2, 0), "Matchday 7", None),
    (303, NATIVE_2022, "2022-12-18", 1, 12, (3, 3), None, None), (403, ARCHIVE_2022, "2022-12-17", 1, 12, (3, 3), "Final", (4, 2)),
    (304, NATIVE_2022, "2022-12-03", 1, 14, (2, 1), "1/8", None), (404, ARCHIVE_2022, "2022-12-03", 1, 14, (2, 1), "Round of 16", None),
    (305, NATIVE_2022, "2022-11-30", 13, 1, (0, 2), "3", None), (306, NATIVE_2022, "2022-12-01", 13, 1, (0, 2), "3b", None),
    # 43o: an archive match no native copy holds.
    (501, ARCHIVE_1978, "1978-06-25", 1, 16, (3, 1), "Final", None),
    # Two unscored copies one day apart in two editions: one match.
    (601, FRIENDLIES, "2027-03-20", 1, 15, None, None, None), (602, FRIENDLIES_ARCHIVE, "2027-03-19", 15, 1, None, None, None),
]
SEASON = "2025/2026"


def build(db):
    from vega.store import Store

    x = db.execute
    with db.transaction():
        for label in ("1977/1978", "2022/2023", "2025/2026", "2026/2027"):
            Store(db).season(label)
        for team, (name, key) in TEAMS.items():
            x("INSERT INTO core.teams(id, name, is_national) VALUES (%s, %s, true)", (team, name))
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'pitchapi', %s, %s)", (key, team))
        # The family's competition is named after the first edition cups.save imported.
        x("""INSERT INTO core.competitions(id, name) VALUES (100, 'World Cup'), (101, 'World Cup 1930'), (102, 'Friendlies'),
             (103, 'Friendlies 2014')""")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition', 'vega', 'cup:open-cups:world-cup-history', 101)")
        for edition, (competition, season, native, cup_key, cup_name) in EDITIONS.items():
            x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, cup_key, cup_name)
                 VALUES (%s, %s, %s, %s, %s, %s)""", (edition, competition, season, native, cup_key, cup_name))
        for match, edition, day, home, away, score, round_name, pens in MATCHES:
            cup = EDITIONS[edition][3]
            round_id = round_name and x("INSERT INTO core.rounds(competition_season_id, name) VALUES (%s, %s) RETURNING id",
                                        (edition, round_name)).fetchone()[0]
            x("""INSERT INTO core.matches(id, competition_season_id, season_id, round_id, source, status, home_team_id, away_team_id,
                   home_score, away_score, home_penalty_score, away_penalty_score, match_date, kickoff_at)
                 VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
              (match, edition, EDITIONS[edition][1], round_id, "openfootball" if cup else "pitchapi",
               "finished" if score else "not_started", home, away, *(score or (None, None)), *(pens or (None, None)), day,
               None if cup else day + "T01:00:00Z"))
            if not cup:
                x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
                     VALUES ('match', 'pitchapi', %s, %s)""", (f"m_{match:06d}", match))


def http(paths):
    done = subprocess.run([shutil.which("node"), str(ROOT / "tests" / "read_http.mjs"), DSN,
                           json.dumps([{"path": p} for p in paths])], capture_output=True, text=True, timeout=120)
    if done.returncode:
        raise AssertionError(done.stderr)
    return json.loads(done.stdout.strip().splitlines()[-1])


@required(DSN and psycopg and NODE_READY, "requires VEGA_V2_CLASSEMENTS_TEST_DSN, psycopg, node and backend/api/node_modules")
class NationMatchCopies(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_classements_test":
            raise RuntimeError("dedicated local test DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        build(cls.db)
        page, listing = http([f"/api/nations/{TEAMS[ARG][1]}?season={SEASON}", f"/api/nations?season={SEASON}"])
        assert page["status"] == 200 and page["conditional"] == 304, page
        cls.page, cls.listing = page["body"]["data"], listing["body"]["data"]

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def on(self, day, opponent):
        key = TEAMS[opponent][1]
        return [m for m in self.page["matches"] if m["date"] == day and key in (m["home"]["id"], m["away"]["id"])]

    def test_43k_a_copy_of_the_day_before_is_one_match_the_native_one(self):
        for native_day, copy_day, opponent in (("2026-06-17", "2026-06-16", 2), ("2026-06-28", "2026-06-27", 4), ("2026-07-12", "2026-07-11", 7)):
            with self.subTest(opponent=TEAMS[opponent][0]):
                self.assertEqual(self.on(copy_day, opponent), [])
                [kept] = self.on(native_day, opponent)
                self.assertEqual((kept["competition"], kept["edition"], "id" in kept), ("World Cup", None, True))

    def test_43l_43p_another_score_or_two_days_are_two_matches(self):
        self.assertEqual([len(self.on("2022-11-22", 10)), len(self.on("2022-11-21", 10))], [1, 1])
        self.assertEqual([len(self.on("2022-11-26", 11)), len(self.on("2022-11-24", 11))], [1, 1])

    def test_43m_one_day_apart_in_one_edition_are_two_matches(self):
        self.assertEqual([len(self.on("2022-11-30", 13)), len(self.on("2022-12-01", 13))], [1, 1])

    def test_43n_copies_of_one_day_are_one_match(self):
        self.assertEqual([m["round"] for m in self.on("2022-12-03", 14)], ["1/8"])

    def test_43o_an_archive_match_is_labelled_with_its_own_edition(self):
        [final] = self.on("1978-06-25", 16)
        self.assertEqual((final["competition"], final["edition"]), ("World Cup 1978", "open-cups:world-cup-history:1978"))

    def test_43q_the_kept_match_takes_the_shoot_out_and_round_of_its_copy(self):
        self.assertEqual(self.on("2022-12-17", 12), [])
        [final] = self.on("2022-12-18", 12)
        self.assertEqual((final["homePenalties"], final["awayPenalties"], final["round"], "id" in final), (4, 2, "Final", True))

    def test_43r_argentina_world_cup_2026_has_eight_matches(self):
        wc = [m for m in self.page["matches"] if m["date"] and m["date"].startswith("2026-0") and m["competition"].startswith("World Cup")]
        self.assertEqual(len(wc), 8)
        [run] = [t for t in self.page["tournaments"] if t["label"] == "Coupe du monde 2026"]
        self.assertEqual((run["matches"], run["stage"]), (8, "Finaliste"))

    def test_unscored_copies_one_day_apart_are_one_match(self):
        self.assertEqual(len(self.on("2027-03-20", 15)) + len(self.on("2027-03-19", 15)), 1)

    def test_the_list_counts_the_matches_the_page_lists(self):
        [own] = [n for n in self.listing["nations"] if n["id"] == TEAMS[ARG][1]]
        self.assertEqual(own["matches"], len(self.page["matches"]))
        self.assertEqual(len(self.page["matches"]), 8 + 8 + 1 + 1)


if __name__ == "__main__":
    unittest.main()
