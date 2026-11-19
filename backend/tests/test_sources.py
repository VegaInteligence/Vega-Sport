"""Source adapters other than PitchAPI, against small synthetic response samples."""

import hashlib
import json
import os
import re
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vega import sources
from vega.sources import SourceError, cups, curated, fifa, footballdata, honours, market_value_snapshot, normalize, player_fact_snapshot, player_facts, sportscore, uefa, wikidata, worldcup
sys.path.insert(0, str(ROOT / "tests"))
from cup_samples import SAMPLES
import worldcup_samples
import footballdata_samples

try:
    import psycopg
except ImportError:
    psycopg = None
DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")
NOW = datetime(2026, 11, 9, 8, tzinfo=timezone.utc)


def uefa_page(members, total, updated="2026-11-06T22:00:00Z"):
    return {"data": {"members": members, "lastUpdateDate": updated}, "meta": {"collection": {"totalElements": total}}}


def club(ident, name, country, position, value, official=None):
    return {"member": {"id": ident, "displayName": name, "countryCode": country, "displayOfficialName": official,
                       "logoUrl": f"https://img.uefa.com/{ident}.png"},
            "overallRanking": {"position": position, "totalValue": value, "totalPoints": value - 1, "numberOfTeamsStillInPlaying": 1},
            "seasonRankings": [{"seasonYear": 2027, "totalPoints": 9.5, "nationalAssociationPoints": 2.0, "numberOfTeamsStillInPlaying": 1}]}


def person(qid, names, birth=None, precision="11", height=None, unit="Q11573"):
    row = {"p": {"value": "http://www.wikidata.org/entity/" + qid}, "names": {"value": "|".join(names)}}
    if birth:
        row["birth"], row["prec"] = {"value": birth + "T00:00:00Z"}, {"value": precision}
    if height is not None:
        row["height"], row["unit"] = {"value": str(height)}, {"value": "http://www.wikidata.org/entity/" + unit}
    return row


def no_players(url, headers=None):
    return {"results": {"bindings": []}}


class FakeSource:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def __call__(self, url):
        query = parse_qs(urlparse(url).query)
        key = (query["coefficientType"][0], int(query["seasonYear"][0]), int(query["page"][0]))
        self.calls.append(key)
        if key not in self.pages:
            raise SourceError("HTTP_404")
        return json.loads(json.dumps(self.pages[key]))


class PureTest(unittest.TestCase):
    def test_normalize_and_scopes(self):
        self.assertEqual(normalize("Atlético  de Madrid"), "atleticodemadrid")
        # The four editions main keeps: the running one and the three before it.
        self.assertEqual(sorted(uefa.scopes(NOW)), sorted(
            f"uefa_{kind}:{year}" for kind in ("clubs", "associations") for year in (2024, 2025, 2026, 2027)
        ))

    def test_sportscore_official_names_pair_with_the_clubs(self):
        # Ligue 1 2026/2027 as SportScore and PitchAPI spell it (live, 2026-11-09).
        clubs = ["Angers", "Auxerre", "Brest", "Le Havre", "Le Mans", "Lens", "Lille", "Lorient", "Lyon", "Marseille", "Monaco",
                 "Nice", "Paris FC", "Paris Saint-Germain", "Rennes", "Strasbourg", "Toulouse", "Troyes"]
        official = {"Paris Saint Germain": "Paris Saint-Germain", "LOSC Lille": "Lille", "Stade Rennais FC": "Rennes",
                    "AS Monaco": "Monaco", "OGC Nice": "Nice", "RC Lens": "Lens", "Toulouse FC": "Toulouse",
                    "Stade Brestois 29": "Brest", "RC Strasbourg Alsace": "Strasbourg", "AJ Auxerre": "Auxerre",
                    "Angers SCO": "Angers", "Havre Athletic Club": "Le Havre", "Paris FC": "Paris FC", "Lyon": "Lyon",
                    "Marseille": "Marseille", "Lorient": "Lorient", "Le Mans": "Le Mans", "Troyes": "Troyes"}
        teams = {i: {normalize(name)} for i, name in enumerate(clubs)}
        spelled = {i: {name} for i, name in enumerate(clubs)}
        found, missing = sportscore.pair(set(official), teams, spelled)
        self.assertEqual(missing, 0)
        self.assertEqual({row: clubs[team] for row, team in found.items()}, official)
        # Two rows equally close to one club stay unpaired: no table rather than a wrong one.
        found, missing = sportscore.pair({"Racing Club", "Racing Genk"}, {0: {"racing"}, 1: {"genk"}}, {0: {"Racing"}, 1: {"Genk"}})
        self.assertEqual(found, None)

    def test_archive_scores_written_as_a_bare_pair(self):
        # OpenFootball writes a match decided in ninety minutes as "score": [a, b] in its older World Cup files
        # (1950–2014) and as {"ft": [a, b]} elsewhere: both are the final score. Read as an object only, 666 of the
        # 1,069 archived World Cup matches had no score (18 November 2026: the 1998 final among them).
        body = {"matches": [
            {"round": "Final", "date": "1998-07-12", "team1": "Brazil", "team2": "France", "score": [0, 3]},
            {"round": "Semi-finals", "date": "1998-07-07", "team1": "Brazil", "team2": "Netherlands", "score": {"p": [4, 2], "et": [1, 1], "ft": [1, 1]}},
            {"round": "Matchday 1", "date": "1998-06-10", "team1": "Brazil", "team2": "Scotland", "score": {"ft": [2, 1]}},
            {"round": "Matchday 1", "date": "2028-06-09", "team1": "England", "team2": "A2"},
            # A pair that is no score: one number, a string, a negative, a boolean, three numbers.
            {"round": "Matchday 1", "date": "1998-06-11", "team1": "A", "team2": "B", "score": [1]},
            {"round": "Matchday 1", "date": "1998-06-11", "team1": "C", "team2": "D", "score": ["1", 2]},
            {"round": "Matchday 1", "date": "1998-06-11", "team1": "E", "team2": "F", "score": [-1, 2]},
            {"round": "Matchday 1", "date": "1998-06-11", "team1": "G", "team2": "H", "score": [True, 2]},
            {"round": "Matchday 1", "date": "1998-06-11", "team1": "I", "team2": "J", "score": [1, 2, 3]},
        ]}
        rows = [row for _, row in cups.match_rows("open-cups", "world-cup-history", "1998", body)]
        read = [(r["status"], r["home_score"], r["away_score"], r["home_score_90"], r["home_score_et"], r["home_penalty_score"]) for r in rows]
        self.assertEqual(read[:4], [("finished", 0, 3, None, None, None), ("finished", 1, 1, 1, 1, 4),
                                    ("finished", 2, 1, None, None, None), ("not_started", None, None, None, None, None)])
        self.assertEqual(set(read[4:]), {("not_started", None, None, None, None, None)})
        # The other cup sources' readers have not changed: their editions are not read again.
        self.assertEqual(set(cups.READER), {"open-cups"})

    # The Fjelstul World Cup Database (vega/sources/worldcup.py; the user's decision of 18 November 2026). Failure
    # modes and expected outcomes, written before the reader:
    # - the repository changes under the pinned commit, or a file is missing: nothing is read (SOURCE_CHANGED);
    # - a value the files write as text for « unknown » (a birth date « not available », a given name « not
    #   applicable », a shirt number 0) is absent in the base, never a fake date, name or number;
    # - a row that names a match, a team or a person the files do not hold, a key given twice, a date that is no
    #   date: the files are incoherent, nothing is written (INVALID_SOURCE);
    # - a match is paired with the base's archived match of the same edition, day and teams, in either order and
    #   under the spellings the two sources use; two candidates, a women's match (the base holds none), a replay of
    #   the day after: no pair, never a guess.
    def test_worldcup_files_are_the_pinned_ones(self):
        files = worldcup_samples.texts()
        pins = worldcup_samples.digests(files)
        digest = worldcup.verify(files, pins)
        self.assertRegex(digest, "^[0-9a-f]{64}$")
        self.assertEqual(worldcup.verify(dict(reversed(list(files.items()))), pins), digest)  # the order read does not matter
        changed = dict(files, goals=files["goals"].replace("P-00002", "P-00001"))
        with self.assertRaises(SourceError) as error:
            worldcup.verify(changed, pins)
        self.assertEqual(error.exception.code, "SOURCE_CHANGED")
        with self.assertRaises(SourceError) as error:
            worldcup.verify({name: text for name, text in files.items() if name != "squads"}, pins)
        self.assertEqual(error.exception.code, "SOURCE_CHANGED")
        # The real pins: the seventeen files read, each by its SHA-256, at one commit of the repository.
        self.assertEqual(set(worldcup.FILES), set(worldcup_samples.HEADERS))
        self.assertTrue(all(re.fullmatch("[0-9a-f]{64}", value) for value in worldcup.FILES.values()))
        self.assertRegex(worldcup.COMMIT, "^[0-9a-f]{40}$")

    def test_worldcup_rows_are_typed(self):
        tables = worldcup.typed(worldcup_samples.texts())
        self.assertEqual({name: len(rows) for name, rows in tables.items()}, {
            "tournaments": 2, "teams": 4, "stadiums": 2, "people": 7, "matches": 3, "squads": 4, "appearances": 6, "goals": 3,
            "bookings": 2, "substitutions": 2, "shootout_kicks": 2, "awards": 1})
        by = lambda table, key: {row[key]: row for row in tables[table]}
        self.assertEqual(by("tournaments", "tournament_key")["WC-1991"], {
            "tournament_key": "WC-1991", "name": "1991 FIFA Women's World Cup", "year": 1991, "women": True, "start_date": date(1991, 11, 16),
            "end_date": date(1991, 11, 30), "host_country": "China", "winner": "United States", "teams": 12})
        people = by("people", "person_key")
        self.assertEqual(people["P-00001"], {"person_key": "P-00001", "role": "player", "family_name": "Cruyff", "given_name": "Johan",
                                              "birth_date": date(1947, 4, 25), "country": None, "female": False, "goalkeeper": False, "defender": False,
                                              "midfielder": False, "forward": True, "wikipedia_url": "https://en.wikipedia.org/wiki/Johan_Cruyff"})
        # « not applicable », « not available » and an empty link are no name, no date and no link.
        self.assertEqual((people["P-00003"]["given_name"], people["P-00003"]["birth_date"], people["P-00003"]["wikipedia_url"]), (None, None, None))
        self.assertEqual((people["M-001"]["role"], people["M-001"]["country"], people["R-001"]["role"], people["P-00004"]["female"]), ("manager", "Netherlands", "referee", True))
        final = by("matches", "match_key")["M-1974-38"]
        self.assertEqual(final, {"match_key": "M-1974-38", "tournament_key": "WC-1974", "stage": "final", "group_name": None, "replayed": False, "replay": False,
                                 "match_date": date(1974, 7, 7), "match_time": time(16, 0), "stadium_key": "S-001", "home_team_key": "T-01", "away_team_key": "T-02",
                                 "home_score": 1, "away_score": 2, "extra_time": False, "shootout": False, "home_penalties": None, "away_penalties": None})
        shootout = by("matches", "match_key")["M-1974-01"]
        self.assertEqual((shootout["group_name"], shootout["extra_time"], shootout["shootout"], shootout["home_penalties"], shootout["away_penalties"]), ("Group 1", True, True, 4, 5))
        self.assertEqual(by("stadiums", "stadium_key")["S-001"]["capacity"], 77573)
        # A shirt number 0 is an unknown number.
        self.assertEqual([(r["player_key"], r["shirt_number"], r["position"]) for r in tables["squads"] if r["team_key"] == "T-02"], [("P-00002", 13, "FW"), ("P-00003", None, "FW")])
        seen = {(r["person_key"], r["role"], r["team_key"], r["shirt_number"], r["position"], r["starter"]) for r in tables["appearances"]}
        self.assertEqual(seen, {("P-00001", "player", "T-01", 14, "FW", True), ("P-00002", "player", "T-02", 13, "CF", True), ("P-00003", "player", "T-02", 20, "FW", False),
                                ("M-001", "manager", "T-01", None, None, None), ("M-002", "manager", "T-02", None, None, None), ("R-001", "referee", None, None, None, None)})
        goals = by("goals", "goal_key")
        # An own goal: credited to the other team, its scorer's team kept.
        self.assertEqual(goals["G-0003"], {"goal_key": "G-0003", "match_key": "M-1974-38", "team_key": "T-02", "player_key": "P-00001", "player_team_key": "T-01",
                                           "minute": 60, "stoppage": 0, "period": "second half", "own_goal": True, "penalty": False})
        self.assertEqual((goals["G-0002"]["minute"], goals["G-0002"]["stoppage"], goals["G-0002"]["period"], goals["G-0001"]["penalty"]), (45, 1, "first half, stoppage time", True))
        self.assertEqual([(r["booking_key"], r["minute"], r["yellow"], r["red"], r["second_yellow"], r["sending_off"]) for r in tables["bookings"]],
                         [("B-0001", 23, True, False, False, False), ("B-0002", 80, True, False, True, True)])
        self.assertEqual([(r["substitution_key"], r["player_key"], r["minute"], r["going_off"]) for r in tables["substitutions"]], [("S-0001", "P-00002", 68, True), ("S-0002", "P-00003", 68, False)])
        # The kicks of a shoot-out keep their order.
        self.assertEqual([(r["kick_key"], r["team_key"], r["player_key"], r["converted"], r["position"]) for r in tables["shootout_kicks"]],
                         [("PK-001", "T-04", "P-00002", True, 1), ("PK-002", "T-03", "P-00003", False, 2)])
        self.assertEqual(tables["awards"], [{"tournament_key": "WC-1974", "award": "Golden Ball", "player_key": "P-00001", "team_key": "T-01", "shared": True}])

    def test_worldcup_incoherent_files_are_refused(self):
        import copy

        def refused(change):
            rows = copy.deepcopy(worldcup_samples.ROWS)
            change(rows)
            with self.assertRaises(SourceError) as error:
                worldcup.typed(worldcup_samples.texts(rows))
            return error.exception.code

        self.assertEqual(refused(lambda r: r["goals"][0].update(player_id="P-99999")), "INVALID_SOURCE")  # an unknown scorer
        self.assertEqual(refused(lambda r: r["player_appearances"][0].update(match_id="M-1974-99")), "INVALID_SOURCE")  # an unknown match
        self.assertEqual(refused(lambda r: r["matches"][0].update(away_team_id="T-77")), "INVALID_SOURCE")  # an unknown team
        self.assertEqual(refused(lambda r: r["players"].append(dict(r["players"][0])) ), "INVALID_SOURCE")  # a key given twice
        self.assertEqual(refused(lambda r: r["matches"][0].update(match_date="7 July 1974")), "INVALID_SOURCE")  # no date
        self.assertEqual(refused(lambda r: r["matches"][0].update(home_team_score="one")), "INVALID_SOURCE")  # no number
        self.assertEqual(refused(lambda r: r["bookings"][0].update(yellow_card="yes")), "INVALID_SOURCE")  # no flag
        self.assertEqual(refused(lambda r: r["tournaments"][0].update(tournament_id="1974")), "INVALID_SOURCE")  # no key of the source

    def test_worldcup_matches_pair_with_the_base(self):
        source = [  # (match key, edition year, women, day, home, away)
            ("M-1974-38", 1974, False, date(1974, 7, 7), "Netherlands", "West Germany"),
            ("M-1974-01", 1974, False, date(1974, 6, 14), "United States", "Sweden"),
            ("M-1990-09", 1990, False, date(1990, 6, 11), "England", "Republic of Ireland"),
            ("M-2014-40", 2014, False, date(2014, 6, 24), "Greece", "Ivory Coast"),
            ("M-2014-10", 2014, False, date(2014, 6, 15), "Argentina", "Bosnia and Herzegovina"),
            ("M-1934-12", 1934, False, date(1934, 5, 31), "Italy", "Spain"),
            ("M-1934-13", 1934, False, date(1934, 6, 1), "Italy", "Spain"),
            ("M-1991-01", 1991, True, date(1991, 11, 17), "Sweden", "United States"),
            ("M-1974-05", 1974, False, date(1974, 6, 15), "Brazil", "Scotland"),
            ("M-1974-06", 1974, False, date(1974, 6, 18), "Zaire", "Yugoslavia"),
        ]
        base = [  # (our match, edition, day, home, away), as the archive spells them
            (11, "1974", date(1974, 7, 7), "West Germany", "Netherlands"),  # the other order
            (12, "1974", date(1974, 6, 14), "USA", "Sweden"),
            (13, "1990", date(1990, 6, 11), "England", "Ireland"),
            (14, "2014", date(2014, 6, 24), "Greece", "Côte d'Ivoire"),
            (15, "2014", date(2014, 6, 15), "Argentina", "Bosnia-Herzegovina"),
            (16, "1934", date(1934, 5, 31), "Italy", "Spain"), (17, "1934", date(1934, 6, 1), "Italy", "Spain"),  # a tie and its replay
            (18, "1991", date(1991, 11, 17), "Sweden", "USA"),  # another competition's edition of that year would not be read: the women's match pairs with nothing
            (19, "1974", date(1974, 6, 16), "Brazil", "Scotland"),  # a day apart: not the same match for certain
            (20, "1974", date(1974, 6, 18), "Zaire", "Yugoslavia"), (21, "1974", date(1974, 6, 18), "Yugoslavia", "Zaire"),  # two candidates
            (22, "1938", date(1938, 6, 5), "Sweden", "Austria"),  # a walkover the source does not list
        ]
        self.assertEqual(worldcup.pair(source, base), {"M-1974-38": 11, "M-1974-01": 12, "M-1990-09": 13, "M-2014-40": 14, "M-2014-10": 15, "M-1934-12": 16, "M-1934-13": 17})
        self.assertEqual(worldcup.pair(source, []), {})

    # football-data.co.uk's season files (vega/sources/footballdata.py; the user's choice of 19 November 2026, told
    # that the site's terms ask for private, non-automated use). Failure modes and expected outcomes, written before
    # the reader:
    # - a file differs from its pin, or one is missing: nothing is written (SOURCE_CHANGED);
    # - files in Latin-1 or UTF-8 with a byte-order mark read the same names; blank lines, trailing empty header
    #   columns and values past the header are no data; a row shorter than the header lacks the values it does not
    #   reach;
    # - a statistic or an odd the file does not give is absent (None), never 0; an odd of 1 or less, or a triple
    #   with a missing price, is no odd;
    # - the market average and maximum come from Oddsportal's columns (Avg, Max) when a file has them, else from
    #   Betbrain's (BbAv, BbMx);
    # - a row without a score, a date outside its season (July to August of the year after), a division other than
    #   its file's, the same fixture twice in a file: the file is incoherent, nothing is written (INVALID_SOURCE);
    # - a row pairs with the archived match of its country and season played by the two teams its names stand for,
    #   home and away as written, within three days; a name stands for the team found on its side among the
    #   same-score archived matches of a day apart in at least MIN_SHARE of its rows (and MIN_VOTES), more than any
    #   other team, one name per team; the reverse fixture, two candidates, a name without enough rows: no pair,
    #   never a guess.
    def test_football_data_files_are_the_pinned_ones(self):
        files = footballdata_samples.files()
        pins = footballdata_samples.digests(files)
        digest = footballdata.verify(files, pins)
        self.assertRegex(digest, "^[0-9a-f]{64}$")
        self.assertEqual(footballdata.verify(dict(reversed(list(files.items()))), pins), digest)
        with self.assertRaisesRegex(SourceError, "SOURCE_CHANGED"):
            footballdata.verify(dict(files, **{"F1/1011": files["F1/1011"] + b"F1,"}), pins)
        with self.assertRaisesRegex(SourceError, "SOURCE_CHANGED"):
            footballdata.verify({k: v for k, v in files.items() if k != "N1/1011"}, pins)
        # The pinned files: the top division of the seven leagues and the second (third and fourth in England), from
        # 2000/01 to 2020/21, the last season before PitchAPI's.
        self.assertEqual(len(footballdata.FILES), 14 * 21)
        self.assertEqual({k.split("/")[0] for k in footballdata.FILES}, set(footballdata.DIVISIONS))
        self.assertEqual({k.split("/")[1] for k in footballdata.FILES}, {f"{y % 100:02d}{(y + 1) % 100:02d}" for y in range(2000, 2021)})
        self.assertTrue(all(re.fullmatch("[0-9a-f]{64}", v) for v in footballdata.FILES.values()))
        self.assertEqual(footballdata.url("F1/1011"), "https://football-data.co.uk/mmz4281/1011/F1.csv")
        self.assertEqual(footballdata.DIVISIONS["F1"], ("France", 1))
        # The read view names each division's country and level as the reader does.
        view = (ROOT / "sql/140_football_data.sql").read_text()
        self.assertEqual({d: (c, int(n)) for d, c, n in re.findall(r"\('([A-Z0-9]+)', '([^']+)', (\d)\)", view)}, footballdata.DIVISIONS)

    def test_football_data_rows_are_typed(self):
        rows = {(r["file_key"], r["row_number"]): r for r in footballdata.typed(footballdata_samples.files())}
        self.assertEqual(sorted(rows), [("F1/1011", 2), ("F1/1011", 3), ("F1/1011", 4), ("F1/1112", 2), ("F1/1112", 3), ("N1/1011", 2), ("N1/1011", 3)])
        lyon = rows[("F1/1011", 2)]
        self.assertEqual({k: lyon[k] for k in ("division", "season_id", "match_date", "kickoff_time", "home_name", "away_name", "home_goals",
                                               "away_goals", "ht_home_goals", "ht_away_goals", "referee")},
                         {"division": "F1", "season_id": 2010, "match_date": date(2010, 8, 7), "kickoff_time": None, "home_name": "Lyon",
                          "away_name": "Monaco", "home_goals": 0, "away_goals": 0, "ht_home_goals": 0, "ht_away_goals": 0, "referee": None})
        self.assertEqual([lyon[f"{side}_{k}"] for k in ("shots", "shots_on_target", "fouls", "corners", "yellow_cards", "red_cards") for side in ("home", "away")],
                         [14, 9, 5, 2, 12, 15, 8, 3, 1, 2, 0, 0])
        self.assertEqual([lyon[f"{side}_{k}"] for k in ("woodwork", "offsides", "booking_points", "free_kicks_conceded") for side in ("home", "away")], [None] * 8)
        self.assertEqual([lyon[f"b365_{k}"] for k in ("home", "draw", "away")], [1.5, 4.0, 6.5])
        self.assertEqual([lyon[f"market_average_{k}"] for k in ("home", "draw", "away")], [1.5, 3.9, 6.2])
        self.assertEqual([lyon[f"market_maximum_{k}"] for k in ("home", "draw", "away")], [1.55, 4.2, 7.0])
        self.assertEqual([lyon[f"{b}_{k}"] for b in ("b365_closing", "pinnacle", "pinnacle_closing") for k in ("home", "draw", "away")], [None] * 9)
        # The values past the header are not read; a match without statistics has none, never zeros.
        self.assertEqual(rows[("F1/1011", 3)]["home_name"], "Paris SG")
        monaco = rows[("F1/1011", 4)]
        self.assertEqual([monaco[f"home_{k}"] for k in ("shots", "shots_on_target", "fouls", "corners", "yellow_cards", "red_cards")], [None] * 6)
        self.assertEqual([monaco[f"b365_{k}"] for k in ("home", "draw", "away")], [None] * 3)  # an odd of 1 or less is no odd
        # Four-digit years, a kick-off time, a referee; Pinnacle's prices and closing prices; Oddsportal's market over Betbrain's.
        later = rows[("F1/1112", 2)]
        self.assertEqual((later["match_date"], later["kickoff_time"], later["referee"]), (date(2011, 8, 6), time(20, 0), "A Bonnet"))
        self.assertEqual([later[f"pinnacle_{k}"] for k in ("home", "draw", "away")], [3.1, 3.3, 2.4])
        self.assertEqual([later[f"pinnacle_closing_{k}"] for k in ("home", "draw", "away")], [3.0, 3.4, 2.45])
        self.assertEqual([later[f"market_average_{k}"] for k in ("home", "draw", "away")], [3.0, 3.25, 2.35])
        self.assertEqual([later[f"market_maximum_{k}"] for k in ("home", "draw", "away")], [3.2, 3.4, 2.5])
        self.assertEqual((later["home_fouls"], later["home_corners"]), (None, 4))
        short = rows[("F1/1112", 3)]
        self.assertEqual((short["home_goals"], short["away_goals"], short["ht_home_goals"], short["referee"], short["home_shots"], short["pinnacle_home"]),
                         (0, 1, 0, None, None, None))
        # Latin-1 and the byte-order mark read the same characters.
        self.assertEqual(rows[("N1/1011", 2)]["home_name"], "Héracles")
        self.assertEqual(rows[("F1/1112", 2)]["division"], "F1")
        self.assertEqual(rows[("N1/1011", 3)]["home_shots"], None)

    def test_football_data_incoherent_files_are_refused(self):
        base = footballdata_samples.TEXTS
        broken = {
            "no score": base["F1/1011"].replace("Lyon,Monaco,0,0", "Lyon,Monaco,,0"),
            "outside its season": base["F1/1011"].replace("07/08/10", "07/08/12"),
            "another division": base["F1/1011"].replace("F1,07/08/10", "F2,07/08/10"),
            "a fixture twice": base["F1/1011"].replace("Monaco,Paris SG", "Lyon,Monaco"),
            "no date": base["F1/1011"].replace("07/08/10", "7 Aug"),
            "no home team": base["F1/1011"].replace("Lyon,Monaco", ",Monaco"),
        }
        for case, text in broken.items():
            with self.subTest(case), self.assertRaisesRegex(SourceError, "INVALID_SOURCE"):
                footballdata.typed(footballdata_samples.files(dict(base, **{"F1/1011": text})))
        # A statistic the file mistypes (145 fouls in 2. Bundesliga 2001/02, 9 red cards in Segunda 2020/21, « NA » for
        # an attendance in 2000/01) is absent, not a reason to drop the file: the score is what the row must have.
        typo = base["F1/1011"].replace("Lyon,Monaco,0,0,D,0,0,D,14,9,5,2,12,15", "Lyon,Monaco,0,0,D,0,0,D,14,9,5,2,145,NA")
        lyon = next(r for r in footballdata.typed(footballdata_samples.files(dict(base, **{"F1/1011": typo}))) if r["home_name"] == "Lyon")
        self.assertEqual((lyon["home_shots"], lyon["home_fouls"], lyon["away_fouls"]), (14, None, None))
        # One half-time value alone, or one above the final score, is no half-time score (the table's CHECK).
        lone = base["F1/1011"].replace("Lyon,Monaco,0,0,D,0,0,D", "Lyon,Monaco,0,0,D,1,,D")
        lyon = next(r for r in footballdata.typed(footballdata_samples.files(dict(base, **{"F1/1011": lone}))) if r["home_name"] == "Lyon")
        self.assertEqual((lyon["ht_home_goals"], lyon["ht_away_goals"]), (None, None))
        # A season that ends in August (2019/20, played on after the spring of 2020) is its season.
        late = base["F1/1011"].replace("14/08/10", "02/08/11")
        self.assertEqual(len(footballdata.typed(footballdata_samples.files(dict(base, **{"F1/1011": late})))), 7)

    def test_football_data_rows_pair_with_the_archive(self):
        # A league of four clubs in two rounds, as football-data names them (A–D) and as the archive holds them (10–13).
        names, teams = ["A", "B", "C", "D"], [10, 11, 12, 13]
        fixtures = [(h, a) for h in range(4) for a in range(4) if h != a]
        start = date(2010, 8, 7)
        source, base = [], []
        for n, (h, a) in enumerate(fixtures):
            day = start + timedelta(days=7 * n)
            source.append((f"F1/1011:{n + 2}", 2010, "France", day, names[h], names[a], n % 3, 1))
            base.append((100 + n, 2010, "France", day, teams[h], teams[a], n % 3, 1))
        # The archive moved a postponed match by two days; another has a score of its own (football-data's stands).
        base[3] = (103, 2010, "France", base[3][3] + timedelta(days=2), *base[3][4:])
        base[5] = (105, 2010, "France", base[5][3], base[5][4], base[5][5], 4, 4)
        # A cup match of the same two clubs, weeks away from their league matches; another country's league on the
        # same days, with the same scores.
        base.append((200, 2010, "France", start + timedelta(days=200), 10, 11, 0, 1))
        base += [(300 + n, 2010, "Espagne", d, t + 10, u + 10, hg, ag) for n, (_, _, _, d, t, u, hg, ag) in enumerate(base[:12])]
        found = footballdata.pair(source, base)
        self.assertEqual(found, {f"F1/1011:{n + 2}": 100 + n for n in range(12)})
        # A Saturday of four divisions and the cups: five other matches of the country on each day, with the same score
        # (England, 2000–2020: split into fractions, a club's votes fell under half and almost nothing paired).
        crowded = base + [(400 + 10 * n + k, 2010, "France", d, 20 + 2 * k + n % 2, 30 + 2 * k, hg, ag)
                          for n, (_, _, _, d, _, _, hg, ag) in enumerate(base[:12]) for k in range(5)]
        self.assertEqual(footballdata.pair(source, crowded), {f"F1/1011:{n + 2}": 100 + n for n in range(12)})
        # A fixture the archive does not hold; the archive's copy of a match (two candidates); a club with too few
        # rows to be known; the reverse fixture is never a pair.
        extra = [("F1/1011:20", 2010, "France", start + timedelta(days=300), "A", "B", 1, 1),
                 ("F1/1011:21", 2010, "France", start + timedelta(days=301), "E", "A", 1, 0)]
        copy = (199, 2010, "France", base[0][3], *base[0][4:])
        found = footballdata.pair(source + extra, base + [copy])
        self.assertNotIn("F1/1011:2", found)
        self.assertNotIn("F1/1011:20", found)
        self.assertNotIn("F1/1011:21", found)
        self.assertEqual(len(found), 11)
        swapped = [(k, s, c, d, a, h, hg, ag) for k, s, c, d, h, a, hg, ag in source[:1]]
        self.assertEqual(footballdata.pair(swapped + source[1:], [b for b in base if b[0] != 100 + fixtures.index((1, 0))]).get("F1/1011:2"), None)
        self.assertEqual(footballdata.pair(source, []), {})

    def test_curated_aliases_match_the_site(self):
        # dashboard/shared/player-aliases.js: `const ALIASES = Object.freeze({ key: Object.freeze([...]) })`.
        text = (ROOT.parent / "dashboard/shared/player-aliases.js").read_text()
        body = re.search(r"const ALIASES = Object\.freeze\(\{(.*?)\}\);", text, re.S).group(1)
        site = {key: tuple(re.findall(r'"([^"]+)"', values)) for key, values in re.findall(r"(p_[A-Za-z0-9]{6}): Object\.freeze\(\[(.*?)\]\)", body)}
        self.assertEqual(site, curated.PLAYER_ALIASES)

    def test_sportscore_leagues_match_the_site(self):
        text = (ROOT.parent / "dashboard/frontend/src/services/sportscore-standings.js").read_text()
        body = re.search(r"SPORTSCORE_LEAGUES = Object\.freeze\(\{(.*?)\}\);", text, re.S).group(1)
        self.assertEqual(dict(re.findall(r'(l_[A-Za-z0-9]{6}): "([a-z0-9-]+)"', body)), sportscore.LEAGUES)

    def test_national_cup_archives_match_the_site(self):
        archives = (ROOT.parent / "dashboard/frontend/src/services/cup-archives.js").read_text()
        self.assertEqual(re.findall(r'key: "([a-z-]+)"', archives), list(cups.NATIONAL_CUP_ARCHIVES))

    def test_player_facts_read_one_person_per_name(self):
        found = player_facts.people([
            person("Q1", ["Jean Dupont", "Dupont, Jean"], "2000-03-04", height=1.82),
            person("Q2", ["Rodri"], "1996-06-22", height=191, unit="Q174728"),
            person("Q3", ["Rodri", "Rodrigo Sánchez"], "1999-01-01"),
            person("Q4", ["Marc Année"], "2001-01-01", precision="9"),
            person("Q5", ["Karim Deux"], "2002-02-02", height=1.80),
            person("Q5", ["Karim Deux"], "2002-02-02", height=178, unit="Q174728"),
            person("Q6", ["Deux Dates"], "2003-03-03"), person("Q6", ["Deux Dates"], "2003-03-13"),
            person("Q7", ["Sans Date"]), person("Q8", ["Géant"], "2000-01-01", height=19.1),
            {"p": {"value": "https://example.org/Q9"}, "names": {"value": "Ailleurs"}},
        ])
        self.assertEqual(found["Q1"], ({"jeandupont", "dupontjean"}, datetime(2000, 3, 4).date(), 182))
        self.assertEqual(found["Q2"][1:], (datetime(1996, 6, 22).date(), 191))
        # A year is not a birth date; two days or two heights are no fact; an impossible height is dropped.
        self.assertEqual([found[q][1:] for q in ("Q4", "Q6", "Q7", "Q8")], [(None, None), (None, None), (None, None), (datetime(2000, 1, 1).date(), None)])
        self.assertEqual(found["Q5"][1:], (datetime(2002, 2, 2).date(), None))
        self.assertNotIn("Q9", found)
        squad = {1: {"jeandupont"}, 2: {"rodri"}, 3: {"karimdeux"}, 4: {"karimdeux"}, 5: {"inconnu"}}
        # One person for the name, and one player for the person: the two Rodri and the two Karim stay unlinked.
        self.assertEqual(player_facts.pair(squad, found), {1: "Q1"})
        day = lambda text: datetime.fromisoformat(text).date()
        self.assertTrue(player_facts.plausible(day("2000-03-04"), day("2021-08-01"), day("2026-05-01")))
        self.assertFalse(player_facts.plausible(day("2008-09-01"), day("2021-08-01"), day("2026-05-01")))  # 12 years old at his first match
        self.assertFalse(player_facts.plausible(day("1978-01-01"), day("2021-08-01"), day("2026-05-01")))  # 48 at his last
        self.assertFalse(player_facts.plausible(None, day("2021-08-01"), day("2026-05-01")))
        self.assertIn("wd:Q483020", player_facts.query("Q483020"))
        self.assertRaises(ValueError, player_facts.query, "Q1 } DROP")

    def test_pagination_must_be_complete(self):
        get = FakeSource({("MEN_CLUB", 2027, 1): uefa_page([club(1, "A", "FRA", 1, 10)], 3)})
        with self.assertRaises(SourceError):
            uefa.fetch(get, "uefa_clubs", 2027)


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class UefaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_sources_test":
            raise RuntimeError("dedicated local sources DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA'), ('ESP')")
        x("""INSERT INTO core.teams(id, name, country_code) VALUES
             (1, 'Olympique Lyonnais', 'FRA'), (2, 'Atlético de Madrid', 'ESP'),
             (3, 'Racing', 'FRA'), (4, 'Racing', 'FRA'), (5, 'Real Sociedad', 'ESP')""")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             SELECT 'team', 'pitchapi', 't_aaaaa' || id, id FROM core.teams""")
        x("INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source) VALUES ('team', 1, 'Lyon', 'lyon', 'alias', 'wikidata')")
        x("SELECT setval(pg_get_serial_sequence('core.teams', 'id'), 100)")

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def test_coefficients_linking_and_reconciliation(self):
        pages = {
            ("MEN_CLUB", 2027, 1): uefa_page([club(10, "Lyon", "FRA", 9, 80.5), club(11, "Atletico de Madrid", "ESP", 5, 95.0)], 5),
            ("MEN_CLUB", 2027, 2): uefa_page([club(12, "Racing", "FRA", 60, 12.0), club(13, "Celta Vigo", "ESP", 120, 8.5),
                                              club(14, "R. Sociedad", "ESP", 30, 40.0, official="Real Sociedad")], 5),
            ("MEN_ASSOCIATION", 2027, 1): uefa_page([{"member": {"id": 1, "displayName": "France", "countryCode": "FRA"}, "overallRanking": {"position": 5, "totalValue": 72.3}}], 1),
        }
        get = FakeSource(pages)
        results = sources.run_due(self.db, get, NOW, names={"uefa"})
        self.assertEqual(results[("uefa", "uefa_clubs:2027")], "ok")
        self.assertEqual(results[("uefa", "uefa_associations:2027")], "ok")
        self.assertEqual(results[("uefa", "uefa_clubs:2026")], "HTTP_404")  # an error is recorded, the others ran
        links = dict(self.db.execute(
            "SELECT provider_key, entity_id FROM core.provider_ids WHERE provider='uefa' ORDER BY 1"
        ).fetchall())
        # Alias "Lyon" (FRA) and accents (ESP) link; two "Racing" in France are ambiguous; Celta is unknown.
        self.assertEqual((links["10"], links["11"]), (1, 2))
        self.assertNotIn(links["12"], (3, 4))
        self.assertGreater(links["13"], 100)
        self.assertEqual(links["14"], 5)  # by its official UEFA name
        self.assertEqual(self.db.execute(
            "SELECT rows_written, unmatched, status FROM ops.source_runs WHERE scope='uefa_clubs:2027'"
        ).fetchone(), (5, 2, "ok"))
        # The facts the site reads: the source's name, id, logo, earned points, each season.
        self.assertEqual(self.db.execute(
            """SELECT r.provider_key, r.entity_name, r.earned_points, r.teams_still_playing, a.source_url, s.season_year, s.points
               FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id=r.edition_id AND e.kind='uefa_clubs'
               LEFT JOIN core.assets a ON a.id=r.image_asset_id
               LEFT JOIN core.ranking_season_points s ON s.edition_id=r.edition_id AND s.row_no=r.row_no WHERE r.team_id=1"""
        ).fetchone(), ("10", "Lyon", 79.5, 1, "https://img.uefa.com/10.png", 2027, 9.5))
        points = dict(self.db.execute(
            "SELECT r.team_id, r.points FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id=r.edition_id WHERE e.kind='uefa_clubs' AND e.is_current"
        ).fetchall())
        self.assertAlmostEqual(points[1], 80.5)
        self.assertEqual(self.db.execute(
            "SELECT country_code, position FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id=r.edition_id WHERE e.kind='uefa_associations'"
        ).fetchall(), [("FRA", 5)])
        # Run again the same day: nothing is due.
        self.assertNotIn(("uefa", "uefa_clubs:2027"), sources.run_due(self.db, get, NOW, names={"uefa"}))
        # PitchAPI now observes Celta: the UEFA-only club merges into it, rows follow.
        self.db.execute("INSERT INTO core.teams(id, name, country_code) VALUES (6, 'Celta Vigo', 'ESP')")
        self.db.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi','t_celta1',6)")
        celta_uefa_only = links["13"]
        with self.db.transaction():
            self.assertEqual(uefa.reconcile_teams(self.db), 1)
        self.assertEqual(self.db.execute("SELECT entity_id FROM core.provider_ids WHERE provider='uefa' AND provider_key='13'").fetchone()[0], 6)
        self.assertEqual(self.db.execute("SELECT count(*) FROM core.ranking_rows WHERE team_id=6").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT merged_into FROM core.teams WHERE id=%s", (celta_uefa_only,)).fetchone(), (6,))  # a pointer

    def test_a_club_without_country_takes_its_league_country(self):
        from vega.store import Store

        x = self.db.execute
        x("INSERT INTO core.countries(code) VALUES ('UEFA') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (1950, 'Ligue 1 (test)', 'FRA', 'league'), (1951, 'Champions League (test)', 'UEFA', NULL)")
        with self.db.transaction():
            season = Store(self.db).season("2025/2026")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (1950, 1950, %s, '2025/2026'), (1951, 1951, %s, '2025/2026')", (season, season))
        # PitchAPI gives Brest no country; its last match is in Europe, the one before in Ligue 1.
        x("INSERT INTO core.teams(id, name) VALUES (60, 'Stade Brestois'), (61, 'Opponent')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi','t_brest1',60), ('team','pitchapi','t_oppon1',61)")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, match_date, kickoff_at) VALUES
             (1950, 1950, %(s)s, 'pitchapi', 'finished', 60, 61, '2025-09-01', '2025-09-01T19:00:00Z'),
             (1951, 1951, %(s)s, 'pitchapi', 'finished', 61, 60, '2025-09-20', '2025-09-20T19:00:00Z')""", {"s": season})
        # A UEFA-only Brest (the coefficient arrived first).
        x("INSERT INTO core.teams(id, name, country_code) VALUES (62, 'Stade Brestois', 'FRA')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','uefa','uefa-brest',62)")
        with self.db.transaction():
            merged = uefa.reconcile_teams(self.db)
        self.assertGreaterEqual(merged, 1)
        self.assertEqual(x("SELECT country_code FROM core.teams WHERE id=60").fetchone(), ("FRA",))
        self.assertEqual(x("SELECT entity_id FROM core.provider_ids WHERE provider='uefa' AND provider_key='uefa-brest'").fetchone(), (60,))
        self.assertEqual(x("SELECT merged_into FROM core.teams WHERE id=62").fetchone(), (60,))
        # A UEFA-only club known by its display name ("Paris") merges through its official spelling.
        x("INSERT INTO core.teams(id, name) VALUES (63, 'Paris Saint-Germain')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi','t_psg001',63)")
        x("UPDATE core.matches SET away_team_id=63 WHERE id=1950")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (64, 'Paris', 'FRA')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','uefa','uefa-psg',64)")
        x("""INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source) VALUES
             ('team', 64, 'Paris', 'paris', 'source_spelling', 'uefa'), ('team', 64, 'Paris Saint-Germain', 'parissaintgermain', 'source_spelling', 'uefa')""")
        with self.db.transaction():
            uefa.reconcile_teams(self.db)
        self.assertEqual(x("SELECT entity_id FROM core.provider_ids WHERE provider='uefa' AND provider_key='uefa-psg'").fetchone(), (63,))
        # A club PitchAPI knows from European nights alone has no league to give it a country: it
        # takes its UEFA namesake's (club-form words aside), then merges with it (same name, same country).
        x("INSERT INTO core.countries(code) VALUES ('SVN'), ('ROU'), ('GEO') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.teams(id, name) VALUES (65, 'Celje (test)')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi','t_celje1',65)")
        x("UPDATE core.matches SET home_team_id=65 WHERE id=1951")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (66, 'Celje (test)', 'SVN')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','uefa','uefa-celje',66)")
        # Two UEFA clubs of one name in two countries say nothing.
        x("INSERT INTO core.teams(id, name) VALUES (67, 'Dinamo (test)')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','pitchapi','t_dinam1',67)")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (68, 'Dinamo (test)', 'ROU'), (69, 'FC Dinamo (test)', 'GEO')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team','uefa','uefa-dinamo1',68), ('team','uefa','uefa-dinamo2',69)")
        with self.db.transaction():
            uefa.reconcile_teams(self.db)
        self.assertEqual(x("SELECT country_code FROM core.teams WHERE id=65").fetchone(), ("SVN",))
        self.assertEqual(x("SELECT entity_id FROM core.provider_ids WHERE provider='uefa' AND provider_key='uefa-celje'").fetchone(), (65,))
        self.assertEqual(x("SELECT country_code FROM core.teams WHERE id=67").fetchone(), (None,))

    def test_curated_aliases(self):
        x = self.db.execute
        x("INSERT INTO core.players(id, name) VALUES (50, 'Cristiano Ronaldo'), (51, 'Cristiano Ronaldo')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player','pitchapi','p_3yEwhj',50), ('player','pitchapi','p_other1',51)")
        x("INSERT INTO core.entity_names(entity_type, entity_id, name, normalized, kind, source) VALUES ('player', 50, 'Old', 'old', 'alias', 'vega'), ('player', 50, 'CR', 'cr', 'alias', 'wikidata')")
        self.assertEqual(sources.run_due(self.db, None, NOW, names={"vega"}), {("vega", scope): "ok" for scope in ("player_aliases", "player_facts", "transfermarkt:2026-07-06", "transfermarkt-values:2026-07-06", "club_aliases", "stadium_plans", "league_zones", "cup_logos", "sportscore_ids", "country_names", "national_teams", "team_identity", "editorial_lists")})
        names = self.db.execute("SELECT entity_id, normalized, source::text FROM core.entity_names WHERE entity_type='player' ORDER BY 1, 2").fetchall()
        # The homonym gets nothing; the removed Vega alias goes; Wikidata's stays.
        self.assertEqual(names, [(50, "cr", "wikidata"), (50, "cr7", "vega")])

    def test_curated_player_facts_require_matching_identity_and_can_be_retried(self):
        x = self.db.execute
        with self.db.transaction(force_rollback=True):
            x("INSERT INTO core.players(id, name, birth_date) VALUES (340, 'Lamine Yamal', '2007-07-14')")
            x("INSERT INTO core.teams(id, name, country_code) VALUES (340, 'Barcelona', 'ESP')")
            x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
                 ('player','pitchapi','p_2e0FPo',340), ('team','pitchapi','t_32jSEF',340)""")
            self.assertEqual(curated.player_facts(self.db), (0, 2))
            x("UPDATE core.players SET birth_date = '2007-07-13' WHERE id = 340")
            x("INSERT INTO core.players(id,name,birth_date) VALUES (341,'Lionel Messi','1987-06-24')")
            x("INSERT INTO core.teams(id,name) VALUES (341,'Inter Miami CF')")
            x("""INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES
                 ('player','pitchapi','p_1mZO3B',341), ('team','pitchapi','t_1rgPN4',341)""")
            x("SET LOCAL ROLE vega_collect")
            self.assertEqual(curated.player_facts(self.db), (3, 0))
            self.assertEqual(curated.player_facts(self.db), (0, 0))
            x("RESET ROLE")
            self.assertIn("uefa.com", x("SELECT preferred_foot_source_url FROM core.players WHERE id=340").fetchone()[0])
            self.assertIn("fcbarcelona.com", x("SELECT source_url FROM core.player_contracts WHERE player_id=340").fetchone()[0])
            self.assertEqual(
                x("SELECT preferred_foot, contract_until, contract_team FROM api.player_profiles WHERE player_id=340").fetchone(),
                ("left", "2031-06-30", "Barcelona"),
            )
            self.assertEqual(
                x("""SELECT contract_until, contract_until_season, contract_season_competition, contract_team
                     FROM api.player_profiles WHERE player_id=341""").fetchone(),
                (None, 2028, "MLS", "Inter Miami CF"),
            )

    def test_bulk_player_snapshot_writes_under_the_production_collect_role(self):
        x = self.db.execute
        with self.db.transaction(force_rollback=True):
            x("INSERT INTO core.players(id,name,birth_date) VALUES (341,'Lionel Messi','1987-06-24')")
            x("SET LOCAL ROLE vega_collect")
            count, unmatched = player_fact_snapshot.run(self.db, None, "transfermarkt:2026-07-06", NOW)
            self.assertEqual(count, 2)  # one source observation and one canonical player
            self.assertGreater(unmatched, 50000)
            market_count, _ = market_value_snapshot.run(self.db, None, "transfermarkt-values:2026-07-06", NOW)
            self.assertGreater(market_count, 10)
            x("RESET ROLE")
            self.assertEqual(
                x("""SELECT p.preferred_foot::text, o.source_player_id, o.observed_on::text
                     FROM core.players p JOIN core.player_fact_observations o ON o.player_id=p.id
                     WHERE p.id=341""").fetchone(),
                ("left", "28003", "2026-07-06"),
            )
            self.assertEqual(
                x("SELECT market_value_eur, market_value_updated_at FROM api.player_profiles WHERE player_id=341").fetchone(),
                (15000000, "2026-06-02"),
            )

    def test_fifa_editions(self):
        x = self.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.teams(id, name, country_code, is_national) VALUES (20, 'France', 'FRA', true)")
        dates = [{"id": "FRS_Male_Football_20261007", "date": "2026-10-07"}, {"id": "id14870", "date": "2025-09-18"},
                 {"id": "FRS_future", "date": "2027-01-01"}, {"id": "id2", "date": "1993-08-08"}]
        page = '<html><script id="__NEXT_DATA__" type="application/json">' + json.dumps(
            {"props": {"pageProps": {"pageData": {"ranking": {"allAvailableDates": dates}}}}}) + "</script></html>"
        overview = {"rankings": [
            {"rankingItem": {"idTeam": "43969", "name": "Spain", "countryCode": "ESP", "rank": 1, "previousRank": 2, "totalPoints": 1875.37}},
            {"rankingItem": {"idTeam": "43946", "name": "France", "countryCode": "FRA", "rank": 2, "previousRank": 1, "totalPoints": 1870.0}},
            # A suspended association is listed without a rank: kept, as main keeps it.
            {"rankingItem": {"idTeam": "43965", "name": "Russia", "countryCode": "RUS", "rank": None, "previousRank": None, "totalPoints": 1503.0}},
        ]}
        native = {"Results": [
            {"IdTeam": "43946", "TeamName": [{"Description": "France"}], "IdCountry": "FRA", "Rank": 1, "PrevRank": 2, "TotalPoints": 2011.5},
            {"IdTeam": "43969", "TeamName": [{"Description": "Spain"}], "IdCountry": "ESP", "Rank": 2, "PrevRank": 0, "TotalPoints": 1995.8},
        ]}
        calls = []

        def get(url, as_text=False):
            calls.append(url)
            if url == fifa.PAGE:
                return page
            query = parse_qs(urlparse(url).query)
            if url.startswith(fifa.OVERVIEW):
                return overview if query["dateId"] == ["id14870"] else {"rankings": []}
            if url.startswith(fifa.SCHEDULE):
                return native
            raise SourceError("HTTP_404")

        # Spain has no national team here (the Euro sample another test saves holds one, which the curated pass flags).
        x("UPDATE core.teams SET is_national = false WHERE name = 'Spain'")
        self.assertEqual(sources.run_due(self.db, get, NOW, names={"fifa"}), {("fifa", "fifa_men:editions"): "ok"})
        editions = x("SELECT label, is_current FROM core.ranking_editions WHERE kind='fifa_men' ORDER BY label").fetchall()
        self.assertEqual(editions, [("2025-09-18", False), ("2026-10-07", True)])  # 1993 and the future are left out
        rows = x("""SELECT r.position, r.previous_position, r.team_id, r.country_code FROM core.ranking_rows r
                    JOIN core.ranking_editions e ON e.id = r.edition_id WHERE e.label = '2026-10-07' ORDER BY r.position""").fetchall()
        # France is the national team (not the club of the same country); Spain keeps its code; no previous rank 0.
        self.assertEqual(rows, [(1, 2, 20, None), (2, None, None, "ESP")])
        self.assertEqual(x("SELECT entity_id FROM core.provider_ids WHERE provider='fifa' AND provider_key='43946'").fetchone(), (20,))
        self.assertEqual(x("SELECT rows_written, unmatched FROM ops.source_runs WHERE source='fifa'").fetchone(), (5, 3))
        unranked = x("""SELECT r.position, r.points, r.country_code FROM core.ranking_rows r JOIN core.ranking_editions e ON e.id = r.edition_id
                        WHERE e.label = '2025-09-18' AND r.entity_name = 'Russia'""").fetchone()
        self.assertEqual(unranked, (None, 1503.0, "RUS"))
        # Published editions are not read again.
        calls.clear()
        later = NOW.replace(day=NOW.day + 1)
        sources.run_due(self.db, get, later, names={"fifa"})
        self.assertEqual(calls, [fifa.PAGE])
        # A rank that is not one fails the run; it is tried again an hour later, not at every round.
        overview["rankings"][0]["rankingItem"]["rank"] = "x"
        x("DELETE FROM core.ranking_editions WHERE label='2025-09-18'")
        failed = later + timedelta(days=1)
        self.assertEqual(sources.run_due(self.db, get, failed, names={"fifa"}), {("fifa", "fifa_men:editions"): "INVALID_ROW"})
        self.assertEqual(sources.run_due(self.db, get, failed + timedelta(minutes=1), names={"fifa"}), {})
        self.assertEqual(sources.run_due(self.db, get, failed + sources.RETRY_AFTER, names={"fifa"}), {("fifa", "fifa_men:editions"): "INVALID_ROW"})

    def test_sportscore_official_tables(self):
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2025/2026")
        x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (70, 'Ligue 1', 'FRA', 'league')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('competition','pitchapi','l_3FJFUl',70)")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES (70, 70, 2025, '2025/2026', true)")
        x("""INSERT INTO core.teams(id, name, short_name, country_code) VALUES (30, 'Paris Saint-Germain', 'PSG', 'FRA'),
             (31, 'Olympique de Marseille', 'Marseille', 'FRA'), (32, 'AS Monaco', NULL, 'FRA')""")
        x("INSERT INTO core.team_seasons(team_id, competition_season_id) SELECT id, 70 FROM core.teams WHERE id IN (30, 31, 32)")
        table = [{"team": "Paris Saint Germain", "pos": 1, "p": 12, "w": 9, "d": 2, "l": 1, "gf": 30, "ga": 8, "gd": 22, "pts": 29},
                 {"team": "Marseille", "pos": 2, "p": 12, "w": 8, "d": 2, "l": 2, "gf": 25, "ga": 12, "gd": 13, "pts": 26},
                 {"team": "Monaco FC", "pos": 3, "p": 12, "w": 7, "d": 3, "l": 2, "gf": 20, "ga": 11, "gd": 9, "pts": 24}]
        payload = {"sport": "football", "competition_slug": "french-ligue-1", "competition": "Ligue 1", "tables": [{"group": "", "rows": table}]}
        calls = []

        def get(url):
            calls.append(url)
            if "slug=french-ligue-1" not in url:
                raise AssertionError("only the collected competition is called")
            return json.loads(json.dumps(payload))

        def standings():
            return x("SELECT team_id, position, points FROM core.standings_official WHERE competition_season_id=70 ORDER BY position").fetchall()

        def version():
            row = x("SELECT version FROM ops.resource_versions WHERE resource_kind='competition_season' AND resource_id=70").fetchone()
            return row and row[0]

        with self.db.transaction():
            self.assertEqual(sportscore.run(self.db, get, "standings:l_3FJFUl", NOW), (3, 0))
        # Name, short name, and Monaco as the last team left.
        self.assertEqual(standings(), [(30, 1, 29), (31, 2, 26), (32, 3, 24)])
        published = version()
        with self.db.transaction():
            self.assertEqual(sportscore.run(self.db, get, "standings:l_3FJFUl", NOW), (0, 0))
        self.assertEqual(version(), published)  # unchanged table: no new publication
        # Another league without a current edition: no call at all.
        with self.db.transaction():
            self.assertEqual(sportscore.run(self.db, get, "standings:l_4WFCIZ", NOW), (0, 0))
        self.assertEqual(len(calls), 2)
        # A table naming clubs of another season: nothing official is kept.
        table[1]["team"], table[2]["team"] = "Paris FC", "Le Havre"
        with self.db.transaction():
            self.assertEqual(sportscore.run(self.db, get, "standings:l_3FJFUl", NOW), (0, 2))
        self.assertEqual(standings(), [])
        self.assertGreater(version(), published)
        payload["competition_slug"] = "other"
        with self.assertRaises(SourceError):
            sportscore.run(self.db, get, "standings:l_3FJFUl", NOW)

    def test_wikidata_clubs_stadiums_portraits_and_plans(self):
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2025/2026")
        x("INSERT INTO core.countries(code) VALUES ('ESP') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.competitions(id, name) VALUES (80, 'Liga Test')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, is_current) VALUES (80, 80, 2025, true)")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (40, 'Club Un', 'FRA'), (41, 'Club Bis', 'ESP')")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('team','pitchapi','t_club40',40), ('team','pitchapi','t_club41',41), ('team','uefa','777',40)""")
        x("INSERT INTO core.team_seasons(team_id, competition_season_id) VALUES (40, 80), (41, 80)")
        x("INSERT INTO core.matches(id, competition_season_id, season_id, source, home_team_id, away_team_id) VALUES (900, 80, 2025, 'pitchapi', 41, 40)")
        x("INSERT INTO core.coaches(id, name) VALUES (90, 'Coach B')")
        x("INSERT INTO core.lineups(season_id, match_id, team_id, side, coach_id) VALUES (2025, 900, 41, 'home', 90)")
        photo = {"url": "https://upload.wikimedia.org/wikipedia/commons/a/a1/A.jpg", "sourceUrl": "https://commons.wikimedia.org/wiki/File:A.jpg",
                 "author": "Someone", "license": "CC BY-SA 4.0"}
        answers = {
            ("club", "777"): {"sourceUrl": "https://www.wikidata.org/entity/Q1", "fetchedAt": "2026-11-09T08:00:00.000Z", "stadium": "Stade A",
                              "stadiumId": "Q11", "stadiumAlias": None, "coach": {"name": "Coach A", "photo": photo}, "founded": "1950"},
            ("identity", "Club Bis", "ESP"): "Q2",
            ("club", "Q2"): {"sourceUrl": "https://www.wikidata.org/entity/Q2", "fetchedAt": "2026-11-09T08:00:00.000Z", "stadium": None,
                             "stadiumId": None, "stadiumAlias": None, "coach": {"name": "Coach B", "photo": None}, "founded": None},
            ("stadium", "Q11"): {"id": "Q11", "sourceUrl": "https://www.wikidata.org/wiki/Q11", "fetchedAt": "2026-11-09T08:00:00.000Z",
                                 "capacity": 40000, "capacityAsOf": "2019", "opened": "1998-01-28", "created": None,
                                 "coordinates": {"lat": 48.84, "lon": 2.25}},
            ("portraits", '["Coach B"]'): {"Coach B": dict(photo, url="https://upload.wikimedia.org/wikipedia/commons/b/b1/B.jpg")},
            ("plans",): {"Q11": [{"title": "Plan", "source": "Club Un", "url": "https://club.example/plan", "format": "Plan"}],
                         "Q999": [{"title": "Elsewhere", "url": "https://x.example"}]},
        }
        calls = []

        def fake(command, *args):
            calls.append((command, *args))
            return answers.get((command, *args))

        original, wikidata.bridge = wikidata.bridge, fake
        try:
            results = sources.run_due(self.db, no_players, NOW, names={"wikidata"})
            self.assertEqual(results, {("wikidata", "clubs"): "ok", ("wikidata", "stadiums"): "ok", ("wikidata", "portraits"): "ok",
                                       ("wikidata", "players"): "ok"})
            with self.db.transaction():
                self.assertEqual(curated.stadium_plans(self.db), (1, 1))  # Q999 is not a known stadium yet
        finally:
            wikidata.bridge = original
        # The UEFA id is used as it is; the club without one is resolved by name and country.
        self.assertIn(("club", "777"), calls)
        self.assertIn(("identity", "Club Bis", "ESP"), calls)
        self.assertEqual(x("SELECT founded_year, (SELECT provider_key FROM core.provider_ids WHERE entity_type='team' AND provider='wikidata' AND entity_id=40) FROM core.teams WHERE id=40").fetchone(), (1950, "Q1"))
        self.assertEqual(x("""SELECT v.name, v.capacity, v.capacity_observed, v.opened, v.latitude::numeric(5,2)::float8 FROM core.teams t
                              JOIN core.venues v ON v.id=t.home_venue_id WHERE t.id=40""").fetchone(), ("Stade A", 40000, "2019", "1998-01-28", 48.84))
        coaches = x("""SELECT t.team_id, c.name, a.source_url FROM core.team_coach_tenures t JOIN core.coaches c ON c.id=t.coach_id
                       LEFT JOIN core.assets a ON a.id=c.photo_asset_id WHERE t.end_date IS NULL ORDER BY 1""").fetchall()
        self.assertEqual(coaches, [(40, "Coach A", photo["url"]), (41, "Coach B", "https://upload.wikimedia.org/wikipedia/commons/b/b1/B.jpg")])
        self.assertEqual(x("SELECT title, url FROM core.venue_plans").fetchall(), [("Plan", "https://club.example/plan")])
        # Fetched this week: nothing is due again an hour later.
        calls.clear()
        wikidata.bridge = fake
        try:
            sources.run_due(self.db, no_players, NOW + timedelta(hours=2), names={"wikidata"})
        finally:
            wikidata.bridge = original
        self.assertEqual(calls, [])

    def test_wikidata_one_failing_club_does_not_stop_the_others(self):
        from vega.sources import SourceError
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2025/2026")
        x("INSERT INTO core.countries(code) VALUES ('ESP') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.competitions(id, name) VALUES (86, 'Liga Bridge')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, is_current) VALUES (86, 86, 2025, true)")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (47, 'Club Sept', 'FRA'), (48, 'Club Huit', 'ESP')")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('team','pitchapi','t_club47',47), ('team','pitchapi','t_club48',48), ('team','uefa','8847',47), ('team','uefa','8848',48)""")
        x("INSERT INTO core.team_seasons(team_id, competition_season_id) VALUES (47, 86), (48, 86)")
        answer = lambda qid: {"sourceUrl": "https://www.wikidata.org/entity/" + qid, "fetchedAt": "2026-11-09T08:00:00.000Z", "stadium": None,
                              "stadiumId": None, "stadiumAlias": None, "coach": None, "founded": "1901"}
        broken = {"8847"}

        def fake(command, *args):
            if command == "club" and args[0] in broken:
                raise SourceError("BRIDGE_FAILED")
            return answer("Q88" + args[0][-2:]) if command == "club" and args[0] in ("8847", "8848") else None

        read = "SELECT id, wikidata_fetched_at IS NOT NULL FROM core.teams WHERE id IN (47, 48) ORDER BY id"
        original, wikidata.bridge = wikidata.bridge, fake
        try:
            self.assertEqual(sources.run_due(self.db, None, NOW + timedelta(hours=10), names={"wikidata"})[("wikidata", "clubs")], "ok")
            # The other club is read; the failing one is left for the next pass.
            self.assertEqual(x(read).fetchall(), [(47, False), (48, True)])
            # Every club of the pass failing is the source failing.
            self.assertEqual(sources.run_due(self.db, None, NOW + timedelta(hours=12), names={"wikidata"})[("wikidata", "clubs")], "BRIDGE_FAILED")
            broken.clear()
            self.assertEqual(sources.run_due(self.db, None, NOW + timedelta(hours=14), names={"wikidata"})[("wikidata", "clubs")], "ok")
            self.assertEqual(x(read).fetchall(), [(47, True), (48, True)])
        finally:
            wikidata.bridge = original

    def test_wikidata_players_are_linked_inside_their_club(self):
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2025/2026")
        x("INSERT INTO core.competitions(id, name) VALUES (87, 'Liga Joueurs')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, is_current) VALUES (87, 87, 2025, true)")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (70, 'Club Soixante', 'FRA'), (71, 'Club En Panne', 'FRA'), (72, 'Club Sans Lien', 'FRA')")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES
             ('team','wikidata','Q60',70), ('team','wikidata','Q61',71)""")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, home_team_id, away_team_id, match_date) VALUES
             (960, 87, 2025, 'pitchapi', 70, 71, '2025-09-01'), (961, 87, 2025, 'pitchapi', 71, 70, '2026-04-01')""")
        names = {601: "Jean Dupont", 602: "Rodri", 603: "Paul Martin", 604: "Paul Martin", 605: "Luis Vieux", 606: "Karim Deux", 607: "Déjà Lié", 611: "Autre Club"}
        for player, name in names.items():
            x("INSERT INTO core.players(id, name) VALUES (%s, %s)", (player, name))
            for match in (960, 961):
                x("INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id) VALUES (2025, %s, %s, %s)", (match, 71 if player == 611 else 70, player))
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player','wikidata','Q699',607), ('player','wikidata','Q605',611)")
        answers = {"Q60": [
            person("Q601", ["Jean Dupont", "J. Dupont"], "2000-03-04", height=1.82),
            person("Q602", ["Rodri"], "1996-06-22"), person("Q612", ["Rodri"], "1999-01-01"),
            person("Q603", ["Paul Martin"], "1998-08-08"),
            person("Q605", ["Luis Vieux"], "1999-09-09"),
            person("Q606", ["Karim Deux"], "1977-02-02"),
            person("Q607", ["Déjà Lié"], "2001-01-01"),
        ]}
        asked = []

        def get(url, headers=None):
            club = re.search(r"ps:P54 wd:(Q\d+)", parse_qs(urlparse(url).query)["query"][0]).group(1)
            asked.append((club, headers))
            if club not in answers:
                raise SourceError("TRANSPORT_ERROR")
            return {"results": {"bindings": answers[club]}}

        with self.db.transaction():
            self.assertEqual(wikidata.run(self.db, get, "players", NOW + timedelta(days=40)), (1, 5))
        # One query per linked club, under a client name that says nothing of the project.
        self.assertEqual([club for club, _ in asked if club in ("Q60", "Q61")], ["Q60", "Q61"])
        self.assertTrue(all(headers == {"User-Agent": "football-facts-reader/1.0"} for _, headers in asked))
        facts = x("SELECT id, birth_date::text, height_cm FROM core.players WHERE id BETWEEN 601 AND 611 AND birth_date IS NOT NULL").fetchall()
        self.assertEqual(facts, [(601, "2000-03-04", 182)])
        # Two persons for one name, two players for one person, a person already another player,
        # an age no footballer has, a player already linked to someone else: none is written.
        links = x("SELECT entity_id, provider_key FROM core.provider_ids WHERE entity_type='player' AND provider='wikidata' AND entity_id BETWEEN 601 AND 611 ORDER BY 1").fetchall()
        self.assertEqual(links, [(601, "Q601"), (607, "Q699"), (611, "Q605")])
        read = dict(x("SELECT id, wikidata_players_at FROM core.teams WHERE id IN (70, 71, 72)").fetchall())
        # The club the service failed on comes back tomorrow; a club without a Wikidata link is never asked.
        self.assertEqual((read[70], read[71], read[72]), (NOW + timedelta(days=40), NOW + timedelta(days=11), None))
        asked.clear()
        with self.db.transaction():
            self.assertEqual(wikidata.run(self.db, get, "players", NOW + timedelta(days=40, hours=1)), (0, 0))
        self.assertEqual(asked, [])
        # The player's profile carries the two facts.
        self.assertEqual(x("SELECT birth_date, height_cm FROM api.player_profiles WHERE player_id=601").fetchone(), ("2000-03-04", 182))

    def test_cup_editions_typed_and_kept_on_failure(self):
        x = self.db.execute
        answers = {}
        for kind, competition, season, body in SAMPLES:
            from urllib.parse import urlencode
            query = urlencode({"competition": competition, "season": season})
            answers[(kind, query)] = {"status": 200, "body": body}
        original, cups.bridge = cups.bridge, lambda command, kind, query: answers.get((kind, query), {"status": 502, "body": None})
        try:
            done = sources.run_due(self.db, None, NOW, names={"openfootball", "openligadb", "international_results"})
            self.assertEqual(done[("openfootball", "open-cups:euro:2024")], "ok")
            self.assertEqual(done[("openfootball", "open-cups:euro:2020")], "HTTP_502")  # not in the answers
            self.assertEqual(x("SELECT rows_written FROM ops.source_runs WHERE scope='open-cups:euro:2024'").fetchone(), (3,))
            rows = x("""SELECT m.home_score, m.away_score, m.home_score_90, m.home_score_et, m.home_penalty_score, s.label
                        FROM core.matches m JOIN core.seasons s ON s.id=m.season_id JOIN core.competition_seasons cs ON cs.id=m.competition_season_id
                        WHERE cs.cup_key='open-cups:euro:2024' ORDER BY m.archive_position""").fetchall()
            # Euro 2024 belongs to 2023/2024; a match decided after extra time keeps its 90-minute score.
            self.assertEqual(rows, [(5, 1, None, None, None, "2023/2024"), (0, 0, 0, 0, 3, "2023/2024"), (2, 1, None, None, None, "2023/2024")])
            # Unchanged content: nothing rewritten. A failing source keeps the edition.
            later = NOW + timedelta(days=8)
            self.assertEqual(sources.run_due(self.db, None, later, names={"openfootball"})[("openfootball", "open-cups:euro:2024")], "ok")
            self.assertEqual(x("SELECT rows_written FROM ops.source_runs WHERE scope='open-cups:euro:2024'").fetchone(), (0,))
            answers.clear()
            sources.run_due(self.db, None, NOW + timedelta(days=16), names={"openfootball"})
            self.assertEqual(x("SELECT count(*) FROM api.cup_matches m JOIN api.cup_editions e USING (competition_season_id) WHERE e.season='2024'").fetchone(), (3,))
            # A tournament of another confederation: in the season it ends in, its neutral grounds kept.
            self.assertEqual(done[("international_results", "nations-results:afcon:2023")], "ok")
            rows = x("""SELECT m.home_team_name, m.home_score, m.away_score, m.is_neutral, s.label FROM core.matches m JOIN core.seasons s ON s.id=m.season_id
                        JOIN core.competition_seasons cs ON cs.id=m.competition_season_id WHERE cs.cup_key='nations-results:afcon:2023' ORDER BY m.archive_position""").fetchall()
            self.assertEqual(rows, [("Ivory Coast", 2, 0, False, "2023/2024"), ("Nigeria", 1, 1, True, "2023/2024")])
            self.assertEqual(x("SELECT is_neutral FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id WHERE cs.cup_key='open-cups:euro:2024' LIMIT 1").fetchone(), (None,))
        finally:
            cups.bridge = original

    def test_an_edition_read_before_the_bare_scores_is_read_again_once(self):
        # The source's content has not changed, so its digest alone would leave the edition as the former reader
        # wrote it, the scores missing. The reader's version is part of the digest: each open-cups edition is read
        # again once, then left alone as before.
        x = self.db.execute
        body = {"name": "World Cup 1998", "season": "1998", "source": {"name": "OpenFootball", "url": "https://github.com/openfootball/worldcup.json"},
                "matches": [{"round": "Final", "date": "1998-07-12", "team1": "Ruritania", "team2": "Freedonia", "score": [0, 3]}]}
        key = "open-cups:world-cup-history:1998"
        final = "SELECT m.status::text, m.home_score, m.away_score FROM core.matches m JOIN core.competition_seasons cs ON cs.id=m.competition_season_id WHERE cs.cup_key=%s"
        with self.db.transaction():
            self.assertEqual(cups.save(self.db, "open-cups", "world-cup-history", "1998", body, NOW), 1)
        self.assertEqual(x(final, (key,)).fetchone(), ("finished", 0, 3))
        # As the base held the edition before the correction: the former reader's digest, the final without its score.
        former = hashlib.sha256(json.dumps([body.get("name"), body.get("matches")], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        x("UPDATE core.competition_seasons SET cup_digest=%s WHERE cup_key=%s", (former, key))
        x("""UPDATE core.matches SET status='not_started', home_score=NULL, away_score=NULL
             WHERE competition_season_id=(SELECT id FROM core.competition_seasons WHERE cup_key=%s)""", (key,))
        with self.db.transaction():
            self.assertEqual(cups.save(self.db, "open-cups", "world-cup-history", "1998", body, NOW + timedelta(days=8)), 1)
        self.assertEqual(x(final, (key,)).fetchone(), ("finished", 0, 3))
        with self.db.transaction():
            self.assertEqual(cups.save(self.db, "open-cups", "world-cup-history", "1998", body, NOW + timedelta(days=16)), 0)

    def test_worldcup_database_is_loaded_and_paired_with_the_archive(self):
        # The Fjelstul World Cup Database in the base (vega/sources/worldcup.py). Failure modes, written before the
        # reader ever ran on a base:
        # - the database's people are its own: the base's players and teams must not change;
        # - a match pairs with the archived match of the same edition, day and teams (in the other order, under the
        #   archive's spelling); the women's match pairs with none;
        # - the collect role alone does it all (the rows, the pair, the credit);
        # - a later run reads no file; an archive that replaces a match clears its pair, and the next run pairs the
        #   new match;
        # - a file that is not the pinned one changes nothing (SOURCE_CHANGED): the rows read before stay;
        # - a new commit replaces every row and the pairs are made again.
        x = self.db.execute

        class Files:
            def __init__(self, files):
                self.files, self.calls = files, []

            def __call__(self, url, *, as_text=False):
                self.calls.append(url)
                return self.files[url.rsplit("/", 1)[1].removesuffix(".csv")]

        def archive(final_number=None):
            final = {"round": "Final", "date": "1974-07-07", "team1": "West Germany", "team2": "Netherlands", "score": [2, 1]}
            return {"name": "World Cup 1974", "season": "1974", "source": {"name": "OpenFootball", "url": "https://github.com/openfootball/worldcup.json"}, "matches": [
                dict(final, num=final_number) if final_number else final,
                {"round": "Matchday 1", "group": "Group 1", "date": "1974-06-14", "team1": "USA", "team2": "Sweden", "score": {"ft": [1, 1], "et": [1, 1], "p": [4, 5]}},
                {"round": "Matchday 1", "group": "Group 2", "date": "1974-06-13", "team1": "Brazil", "team2": "Yugoslavia", "score": [0, 0]}]}

        pairs = """SELECT w.match_key, b.home_team_name, b.away_team_name FROM core.worldcup_matches w
                   LEFT JOIN core.matches b ON b.id = w.match_id ORDER BY 1"""
        run = "SELECT rows_written, unmatched, status, error_code FROM ops.source_runs WHERE source='fjelstul' AND scope='worldcup'"
        files = worldcup_samples.texts()
        pins, commit = worldcup.FILES, worldcup.COMMIT
        with self.db.transaction(force_rollback=True):
            try:
                worldcup.FILES, worldcup.COMMIT = worldcup_samples.digests(files), "a" * 40
                cups.save(self.db, "open-cups", "world-cup-history", "1974", archive(), NOW)
                before = x("SELECT (SELECT count(*) FROM core.players), (SELECT count(*) FROM core.teams)").fetchone()
                get = Files(files)
                x("SET LOCAL ROLE vega_collect")
                done = sources.run_due(self.db, get, NOW, names={"fjelstul"})
                x("RESET ROLE")
                self.assertEqual(done, {("fjelstul", "worldcup"): "ok"})
                self.assertEqual(len(get.calls), 17)
                self.assertTrue(all(url.startswith("https://raw.githubusercontent.com/jfjelstul/worldcup/" + "a" * 40 + "/data-csv/") for url in get.calls))
                self.assertEqual(x(run).fetchone(), (38, 0, "ok", None))
                self.assertEqual(x(pairs).fetchall(), [("M-1974-01", "USA", "Sweden"), ("M-1974-38", "West Germany", "Netherlands"), ("M-1991-01", None, None)])
                self.assertEqual(x("SELECT (SELECT count(*) FROM core.players), (SELECT count(*) FROM core.teams)").fetchone(), before)
                # The archive lists the final the other way: the pair says so, for the reads (138).
                self.assertEqual(x("SELECT match_key, swapped FROM core.worldcup_matches WHERE match_id IS NOT NULL ORDER BY 1").fetchall(),
                                 [("M-1974-01", False), ("M-1974-38", True)])
                # The credit the licence asks for, with the commit read.
                name, url, licence, revision, coverage = x("SELECT name, url, license, revision, coverage FROM core.source_revisions WHERE source='fjelstul-worldcup'").fetchone()
                self.assertIn("Joshua C. Fjelstul", name)
                self.assertIn("©", name)
                self.assertEqual((url, revision), ("https://github.com/jfjelstul/worldcup", "a" * 40))
                self.assertIn("CC-BY-SA 4.0", licence)
                self.assertIn("creativecommons.org/licenses/by-sa/4.0", licence)
                self.assertIn("Modified", coverage)
                # What the site will read of the base's own match: its line-up, its goals, who refereed it and where.
                final = "FROM core.worldcup_matches w JOIN core.matches b ON b.id = w.match_id AND b.match_date = '1974-07-07'"
                self.assertEqual(x(f"""SELECT p.family_name, p.given_name, a.shirt_number, a.position, a.starter {final}
                                       JOIN core.worldcup_appearances a USING (match_key) JOIN core.worldcup_people p USING (person_key)
                                       WHERE a.role = 'player' ORDER BY a.team_key, a.starter DESC, a.shirt_number""").fetchall(),
                                 [("Cruyff", "Johan", 14, "FW", True), ("Müller", "Gerd", 13, "CF", True), ("Jairzinho", None, 20, "FW", False)])
                self.assertEqual(x(f"""SELECT p.family_name, g.minute, g.stoppage, g.own_goal, g.penalty, t.name {final}
                                       JOIN core.worldcup_goals g USING (match_key) JOIN core.worldcup_people p ON p.person_key = g.player_key
                                       JOIN core.worldcup_teams t ON t.team_key = g.team_key ORDER BY g.minute""").fetchall(),
                                 [("Cruyff", 2, 0, False, True, "Netherlands"), ("Müller", 45, 1, False, False, "West Germany"), ("Cruyff", 60, 0, True, False, "West Germany")])
                self.assertEqual(x(f"""SELECT a.role, p.family_name, s.name, s.city, w.match_time::text {final}
                                       JOIN core.worldcup_stadiums s USING (stadium_key) JOIN core.worldcup_appearances a USING (match_key)
                                       JOIN core.worldcup_people p USING (person_key) WHERE a.role <> 'player' ORDER BY a.role, p.family_name""").fetchall(),
                                 [("manager", "Michels", "Olympiastadion", "Munich", "16:00:00"), ("manager", "Schön", "Olympiastadion", "Munich", "16:00:00"),
                                  ("referee", "Taylor", "Olympiastadion", "Munich", "16:00:00")])
                # A later run reads no file.
                get = Files({})
                self.assertEqual(sources.run_due(self.db, get, NOW + timedelta(days=8), names={"fjelstul"}), {("fjelstul", "worldcup"): "ok"})
                self.assertEqual((get.calls, x(run).fetchone()), ([], (0, 0, "ok", None)))
                # The archive replaces the final (its key changes): the pair is cleared, the next run pairs the new match.
                old = x("SELECT match_id FROM core.worldcup_matches WHERE match_key='M-1974-38'").fetchone()[0]
                # As in production, the cup reader deletes the replaced match under the collect role: the pair must not stop it.
                x("SET LOCAL ROLE vega_collect")
                cups.save(self.db, "open-cups", "world-cup-history", "1974", archive(final_number=38), NOW + timedelta(days=9))
                x("RESET ROLE")
                self.assertEqual(x("SELECT match_id FROM core.worldcup_matches WHERE match_key='M-1974-38'").fetchone(), (None,))
                self.assertEqual(sources.run_due(self.db, get, NOW + timedelta(days=16), names={"fjelstul"}), {("fjelstul", "worldcup"): "ok"})
                new = x("SELECT match_id FROM core.worldcup_matches WHERE match_key='M-1974-38'").fetchone()[0]
                self.assertTrue(new is not None and new != old)
                self.assertEqual((get.calls, x(run).fetchone()), ([], (0, 0, "ok", None)))
                # A file that is not the pinned one: nothing changes.
                worldcup.COMMIT = "b" * 40
                changed = Files(dict(files, goals=files["goals"].replace("P-00002", "P-00001")))
                self.assertEqual(sources.run_due(self.db, changed, NOW + timedelta(days=24), names={"fjelstul"}), {("fjelstul", "worldcup"): "SOURCE_CHANGED"})
                self.assertEqual(x(run).fetchone()[2:], ("error", "SOURCE_CHANGED"))
                self.assertEqual(x("SELECT (SELECT count(*) FROM core.worldcup_goals), (SELECT revision FROM core.source_revisions WHERE source='fjelstul-worldcup')").fetchone(), (3, "a" * 40))
                self.assertEqual(x("SELECT count(*) FROM core.worldcup_matches WHERE match_id IS NOT NULL").fetchone(), (2,))
                # A new commit, with one goal more: every row is replaced, the pairs are made again.
                rows = {**worldcup_samples.ROWS, "goals": [*worldcup_samples.ROWS["goals"], dict(worldcup_samples.ROWS["goals"][1], goal_id="G-0004", minute_label="88'", minute_regulation="88", minute_stoppage="0", match_period="second half")]}
                newer = worldcup_samples.texts(rows)
                worldcup.FILES, worldcup.COMMIT = worldcup_samples.digests(newer), "c" * 40
                self.assertEqual(sources.run_due(self.db, Files(newer), NOW + timedelta(days=32), names={"fjelstul"}), {("fjelstul", "worldcup"): "ok"})
                self.assertEqual(x(run).fetchone(), (39, 0, "ok", None))
                self.assertEqual(x("SELECT (SELECT count(*) FROM core.worldcup_goals), (SELECT revision FROM core.source_revisions WHERE source='fjelstul-worldcup')").fetchone(), (4, "c" * 40))
                self.assertEqual(x(pairs).fetchall(), [("M-1974-01", "USA", "Sweden"), ("M-1974-38", "West Germany", "Netherlands"), ("M-1991-01", None, None)])
            finally:
                worldcup.FILES, worldcup.COMMIT = pins, commit

    def test_football_data_is_loaded_and_paired_with_the_archive(self):
        # football-data.co.uk's season files in the base (vega/sources/footballdata.py). Failure modes, written before
        # the reader ever ran on a base:
        # - its rows are its own (core.footballdata_matches): the base's matches, teams and statistics do not change;
        # - each row pairs with the archived match of its country and season between the teams its names stand for;
        # - the collect role alone does it all (the rows, the pairs, the credit);
        # - a later run reads no file; an archive that replaces a match clears its pair, the next run pairs the new one;
        # - a file that is not the pinned one changes nothing (SOURCE_CHANGED).
        from vega.store import Store

        x = self.db.execute

        class Files:
            def __init__(self, files):
                self.files, self.calls = files, []

            def __call__(self, url, *, as_text=False, as_bytes=False):
                self.calls.append(url)
                if not as_bytes:
                    raise AssertionError("the files are read as bytes: their digest is the bytes'")
                found = re.fullmatch(r"https://football-data\.co\.uk/mmz4281/(\d{4})/([A-Z0-9]+)\.csv", url)
                return self.files[f"{found[2]}/{found[1]}"]

        run = "SELECT rows_written, unmatched, status, error_code FROM ops.source_runs WHERE source='football_data' AND scope='history'"
        pairs = """SELECT f.file_key, f.row_number, m.home_team_name, m.away_team_name FROM core.footballdata_matches f
                   LEFT JOIN core.matches m ON m.id = f.match_id ORDER BY 1, 2"""
        files = footballdata_samples.files()
        pins, votes = footballdata.FILES, footballdata.MIN_VOTES
        with self.db.transaction(force_rollback=True):
            try:
                footballdata.FILES, footballdata.MIN_VOTES = footballdata_samples.digests(files), 1
                for label in ("2010/2011", "2011/2012"):
                    Store(self.db).season(label)
                x("INSERT INTO core.teams(id, name) VALUES (9101, 'Olympique Lyonnais'), (9102, 'AS Monaco'), (9103, 'Paris Saint-Germain'), (9104, 'AS Saint-Étienne')")
                x("INSERT INTO core.competitions(id, name) VALUES (9100, 'French Ligue 1')")
                x("""INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, archive_key, archive_name, archive_country)
                     VALUES (9110, 9100, 2010, '2010/2011', 'engsoccerdata/france/all/2010', 'Championnat de France', 'France'),
                            (9111, 9100, 2011, '2011/2012', 'engsoccerdata/france/all/2011', 'Championnat de France', 'France')""")
                archived = [(9110, 2010, "2010-08-07", 9101, 9102, 0, 0, "f:1"), (9110, 2010, "2010-08-08", 9103, 9104, 3, 1, "f:2"),
                            (9110, 2010, "2010-08-14", 9102, 9103, 2, 2, "f:3"), (9111, 2011, "2011-08-06", 9102, 9101, 1, 2, "f:4"),
                            (9111, 2011, "2011-08-07", 9104, 9103, 0, 1, "f:5")]
                names = {9101: "Olympique Lyonnais", 9102: "AS Monaco", 9103: "Paris Saint-Germain", 9104: "AS Saint-Étienne"}
                for edition, season, day, home, away, hg, ag, key in archived:
                    x("""INSERT INTO core.matches(competition_season_id, season_id, match_date, status, home_team_id, away_team_id, home_score, away_score,
                         source, archive_key, home_team_name, away_team_name) VALUES (%s,%s,%s,'finished',%s,%s,%s,%s,'engsoccerdata',%s,%s,%s)""",
                      (edition, season, day, home, away, hg, ag, key, names[home], names[away]))
                before = x("SELECT (SELECT count(*) FROM core.matches), (SELECT count(*) FROM core.teams), (SELECT count(*) FROM core.team_match_stats)").fetchone()
                get = Files(files)
                x("SET LOCAL ROLE vega_collect")
                done = sources.run_due(self.db, get, NOW, names={"football_data"})
                x("RESET ROLE")
                self.assertEqual(done, {("football_data", "history"): "ok"})
                self.assertEqual(sorted(get.calls), sorted(footballdata.url(k) for k in files))
                # Seven rows; the two Eredivisie rows have no archived match.
                self.assertEqual(x(run).fetchone(), (7, 2, "ok", None))
                self.assertEqual(x(pairs).fetchall(), [
                    ("F1/1011", 2, "Olympique Lyonnais", "AS Monaco"), ("F1/1011", 3, "Paris Saint-Germain", "AS Saint-Étienne"),
                    ("F1/1011", 4, "AS Monaco", "Paris Saint-Germain"), ("F1/1112", 2, "AS Monaco", "Olympique Lyonnais"),
                    ("F1/1112", 3, "AS Saint-Étienne", "Paris Saint-Germain"), ("N1/1011", 2, None, None), ("N1/1011", 3, None, None)])
                self.assertEqual(x("SELECT (SELECT count(*) FROM core.matches), (SELECT count(*) FROM core.teams), (SELECT count(*) FROM core.team_match_stats)").fetchone(), before)
                self.assertEqual(x("""SELECT home_shots, away_shots, referee, pinnacle_closing_home FROM core.footballdata_matches
                                      WHERE file_key='F1/1112' AND row_number=2""").fetchone(), (10, 13, "A Bonnet", 3.0))
                self.assertEqual(x("SELECT home_name FROM core.footballdata_matches WHERE file_key='N1/1011' AND row_number=2").fetchone(), ("Héracles",))
                # The credit: the site, its terms as it states them, the digest of the files read.
                name, url, terms, revision, digest, coverage = x(
                    "SELECT name, url, license, revision, archive_sha256, coverage FROM core.source_revisions WHERE source='football-data-co-uk'").fetchone()
                self.assertEqual((name, url), ("Football-Data", "https://www.football-data.co.uk"))
                self.assertIn("private individuals", terms)
                self.assertEqual(digest, footballdata.verify(files, footballdata.FILES))
                self.assertEqual(revision, digest[:16])
                self.assertIn("2000/01", coverage)
                # A later run reads no file.
                get = Files({})
                self.assertEqual(sources.run_due(self.db, get, NOW + timedelta(days=8), names={"football_data"}), {("football_data", "history"): "ok"})
                self.assertEqual((get.calls, x(run).fetchone()), ([], (0, 2, "ok", None)))
                # The archive replaces Lyon–Monaco (its key changes): the pair is cleared, the next run pairs the new match.
                old = x("SELECT match_id FROM core.footballdata_matches WHERE file_key='F1/1011' AND row_number=2").fetchone()[0]
                x("SET LOCAL ROLE vega_collect")
                x("DELETE FROM core.matches WHERE id=%s", (old,))
                x("""INSERT INTO core.matches(competition_season_id, season_id, match_date, status, home_team_id, away_team_id, home_score, away_score,
                     source, archive_key, home_team_name, away_team_name) VALUES (9110, 2010, '2010-08-07', 'finished', 9101, 9102, 0, 0, 'engsoccerdata', 'f:1b',
                     'Olympique Lyonnais', 'AS Monaco')""")
                x("RESET ROLE")
                self.assertEqual(x("SELECT match_id FROM core.footballdata_matches WHERE file_key='F1/1011' AND row_number=2").fetchone(), (None,))
                self.assertEqual(sources.run_due(self.db, get, NOW + timedelta(days=16), names={"football_data"}), {("football_data", "history"): "ok"})
                new = x("SELECT match_id FROM core.footballdata_matches WHERE file_key='F1/1011' AND row_number=2").fetchone()[0]
                self.assertTrue(new is not None and new != old)
                # A file that is not the pinned one: nothing changes.
                x("UPDATE core.source_revisions SET revision='0' WHERE source='football-data-co-uk'")
                changed = Files(dict(files, **{"F1/1011": files["F1/1011"].replace(b"Lyon,Monaco,0,0", b"Lyon,Monaco,1,0")}))
                self.assertEqual(sources.run_due(self.db, changed, NOW + timedelta(days=24), names={"football_data"}), {("football_data", "history"): "SOURCE_CHANGED"})
                self.assertEqual(x("SELECT count(*), count(match_id) FROM core.footballdata_matches").fetchone(), (7, 5))
            finally:
                footballdata.FILES, footballdata.MIN_VOTES = pins, votes

    def test_football_data_files_are_read_outside_a_transaction(self):
        # Production ends a session left idle in a transaction for 60 s (infra/aws/database.yaml); the 294 files take
        # 150 s or more at the source client's interval. Read inside the scope's transaction, the first run lost its
        # connection, recorded nothing and came back at every restart (found in review, 19 Nov 2026). Here the limit
        # is half a second and each file takes 0.2 s: the files must be read with no transaction open, then written.
        import time as clock
        from vega.store import connect_local

        db = connect_local(DSN)
        files = footballdata_samples.files()
        pins = footballdata.FILES
        states = []

        def slow(url, *, as_text=False, as_bytes=False):
            states.append(db.info.transaction_status)
            clock.sleep(0.2)
            found = re.fullmatch(r"https://football-data\.co\.uk/mmz4281/(\d{4})/([A-Z0-9]+)\.csv", url)
            return files[f"{found[2]}/{found[1]}"]

        try:
            footballdata.FILES = footballdata_samples.digests(files)
            db.execute("SET idle_in_transaction_session_timeout = '500ms'")
            db.execute("SET ROLE vega_collect")
            self.assertEqual(sources.run_due(db, slow, NOW, names={"football_data"}), {("football_data", "history"): "ok"})
            db.execute("RESET ROLE")
            self.assertEqual(set(states), {psycopg.pq.TransactionStatus.IDLE})
            self.assertEqual(len(states), 3)
            self.assertEqual(db.execute("SELECT count(*) FROM core.footballdata_matches").fetchone(), (7,))
            # A file that differs stops the reading at that file: the others are not fetched for nothing.
            db.execute("UPDATE core.source_revisions SET revision = '0' WHERE source = 'football-data-co-uk'")
            files["F1/1011"] += b"F1,"
            states.clear()
            self.assertEqual(sources.run_due(db, slow, NOW + timedelta(days=8), names={"football_data"}), {("football_data", "history"): "SOURCE_CHANGED"})
            self.assertEqual(len(states), 1)
            self.assertEqual(db.execute("SELECT count(*) FROM core.footballdata_matches").fetchone(), (7,))
        finally:
            footballdata.FILES = pins
            db.execute("RESET ROLE")
            db.execute("DELETE FROM core.footballdata_matches")
            db.execute("DELETE FROM core.source_revisions WHERE source = 'football-data-co-uk'")
            db.execute("DELETE FROM ops.source_runs WHERE source = 'football_data'")
            db.close()

    def test_player_honours(self):
        from vega.store import Store

        x = self.db.execute
        with self.db.transaction():
            Store(self.db).season("2025/2026")
        x("INSERT INTO core.competitions(id, name) VALUES (85, 'Liga H')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id) VALUES (85, 85, 2025)")
        x("INSERT INTO core.teams(id, name) VALUES (85, 'Inter Miami')")
        x("INSERT INTO core.players(id, name) VALUES (60, 'Lionel Messi'), (61, 'Common Name')")
        x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player','pitchapi','p_1mZO3B',60), ('player','pitchapi','p_other2',61)")
        x("INSERT INTO core.matches(id, competition_season_id, season_id, source, match_date) VALUES (950, 85, 2025, 'pitchapi', '2025-10-01')")
        x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2025, 950, 85, 60, 90), (2025, 950, 85, 61, 90)")
        body = {"available": True, "source": "Wikipédia", "identitySourceUrl": "https://www.wikidata.org/wiki/Q615",
                "sourceUrl": "https://en.wikipedia.org/w/index.php?title=Lionel_Messi&oldid=1#Honours", "revision": 1, "fetchedAt": "2026-11-09T08:00:00+00:00",
                "honours": [{"name": "FIFA World Cup", "team": "Argentina", "category": "team", "seasons": ["2022"]},
                            {"name": "Ballon d'Or", "team": None, "category": "individual", "seasons": ["2009", "2010"]}]}
        seen = []

        def fake(name, observations):
            seen.append((name, observations))
            return body if name == "Lionel Messi" else None

        original, honours.collect = honours.collect, fake
        try:
            self.assertEqual(sources.run_due(self.db, None, NOW, names={"wikimedia"}), {("wikimedia", "players"): "ok"})
        finally:
            honours.collect = original
        self.assertEqual(seen[0], ("Lionel Messi", [{"team": "Inter Miami", "date": "2025-10-01"}]))  # Messi first
        self.assertEqual(x("SELECT category, name, team, seasons FROM core.player_honour_titles WHERE player_id=60 ORDER BY seq").fetchall(),
                         [("team", "FIFA World Cup", "Argentina", ["2022"]), ("individual", "Ballon d'Or", None, ["2009", "2010"])])
        self.assertEqual(x("SELECT provider_key FROM core.provider_ids WHERE entity_type='player' AND provider='wikidata' AND entity_id=60").fetchone(), ("Q615",))
        self.assertEqual(x("SELECT honours_fetched_at IS NULL, honours_checked_at IS NOT NULL FROM core.players WHERE id=61").fetchone(), (True, True))
        self.assertEqual(x("SELECT rows_written, unmatched FROM ops.source_runs WHERE source='wikimedia'").fetchone(), (1, 1))


if __name__ == "__main__":
    unittest.main()
