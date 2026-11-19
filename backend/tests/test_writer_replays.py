"""The writers still active, replayed end to end: repetition, partial answers, authority (FAILURE_MODES.md §40,
written before these tests; audit E02c, E02d, E03h).

Each replay calls the real writer through its real entry point on a disposable local PostgreSQL
(VEGA_V2_WRITER_REPLAYS_TEST_DSN, database vega_v2_writer_replays_test), on a connection under the collection role
(vega_collect): the Transfermarkt reader by `Reader.read` (fetch, data_of, write_*, queue row), the other sources by
`sources.run_due` (run, record_run). Only the provider is replaced, by synthetic answers; nothing is downloaded. The
state is compared by a fingerprint of the rows the writer writes (as JSON, sorted, without `updated_at`).

A replay that fails on the code it runs on is a defect of that writer: it is kept, marked by `defect(...)` (an
`unittest.expectedFailure` that names the defect and its owner), so that the suite stays green and the defect visible.
WRITER_REPLAY_STRICT=1 runs them as ordinary tests, to see each failure for its reason. WRITER_REPLAY_EVIDENCE=<dir>
writes each replay's observed states there as JSON.
"""

from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import unittest
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from vega import sources, transfermarkt as tm  # noqa: E402
from vega.sources import SourceError, fifa, honours, uefa, wikidata  # noqa: E402
from prerequisites import required  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_WRITER_REPLAYS_TEST_DSN")
STRICT = os.environ.get("WRITER_REPLAY_STRICT", "").strip().lower() in ("1", "true")
EVIDENCE = os.environ.get("WRITER_REPLAY_EVIDENCE")
NOW = datetime(2026, 11, 19, 8, tzinfo=timezone.utc)


def defect(description):
    """A replay that fails on this code: the defect it shows, kept visible without turning the suite red."""
    def decorate(test):
        test.defect = description
        return test if STRICT else unittest.expectedFailure(test)
    return decorate


def body(data):
    return json.dumps({"success": True, "data": data}).encode()


def value(day, amount, club=583):
    return {"clubId": club, "marketValue": {"value": amount, "currency": "EUR", "determined": day}}


def injury(start, end, label="Hamstring injury", games=3):
    return {"seasonId": 2025, "name": label, "start": start, "end": end, "missedGamesCount": games}


def member(key, shirt):
    return {"playerId": int(key), "shirtNumber": shirt}


VALUES = {"history": [value("2025-06-01", 150000000), value("2026-09-15", 180000000)]}
INJURIES = {"injuries": [injury("2025-03-01", "2025-03-20"), injury("2026-02-01", "2026-02-10", "Knee injury", 2)]}
SQUAD = {"squad": [member("342229", 7), member("288230", 10)]}
CLUBS = [{"id": 583, "name": "Paris Saint-Germain", "baseDetails": {"countryId": 50},
          "squadDetails": {"currentMarketValue": {"value": 900000000}, "averageAge": 25.1, "squadSize": 26}}]


@required(DSN and psycopg, "requires a disposable local writer replays DB (VEGA_V2_WRITER_REPLAYS_TEST_DSN) and psycopg")
class WriterReplay(unittest.TestCase):
    """The base every replay starts from: one league edition in progress, two clubs, four players who played it."""

    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local, migrate

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_writer_replays_test":
            raise RuntimeError("dedicated local writer replays DB required")
        cls.db = connect_local(DSN)
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(cls.db)
        x = cls.db.execute
        x("INSERT INTO core.countries(code) VALUES ('FRA'), ('ESP') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.seasons(id, label) VALUES (2025, '2025/2026'), (2026, '2026/2027') ON CONFLICT DO NOTHING")
        x("SELECT core.ensure_season_partitions(2025)")
        x("SELECT core.ensure_season_partitions(2026)")
        x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (30, 'Ligue 1', 'FRA', 'league')")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label, is_current) VALUES (30, 30, 2026, '2026/2027', true)")
        x("INSERT INTO core.teams(id, name, country_code) VALUES (1, 'Paris Saint-Germain', 'FRA'), (2, 'Olympique Lyonnais', 'FRA')")
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             VALUES ('team', 'pitchapi', 't_psg001', 1), ('team', 'pitchapi', 't_ol0002', 2)""")
        x("INSERT INTO core.team_seasons(team_id, competition_season_id) VALUES (1, 30), (2, 30)")
        x("""INSERT INTO core.players(id, name, short_name, birth_date) VALUES (10, 'Kylian Mbappé', 'K. Mbappé', NULL),
               (11, 'Ousmane Dembélé', 'O. Dembélé', NULL), (12, 'Achraf Hakimi', 'A. Hakimi', NULL), (13, 'Vitinha Ferreira', 'Vitinha', NULL)""")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (500, 30, 2026, 'pitchapi', 'finished', 1, 2, '2026-09-01T19:00:00Z', '2026-09-01'),
                    (501, 30, 2026, 'pitchapi', 'finished', 2, 1, '2026-10-01T19:00:00Z', '2026-10-01')""")
        for match in (500, 501):
            for p in (10, 11, 12, 13):
                x("INSERT INTO core.player_match_stats(season_id, match_id, team_id, player_id, minutes_played) VALUES (2026, %s, 1, %s, 90)", (match, p))
                x("INSERT INTO core.lineup_players(season_id, match_id, team_id, player_id, is_starter) VALUES (2026, %s, 1, %s, true)", (match, p))

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        # Each replay in one transaction rolled back at its end; the writer's own transactions are savepoints in it.
        transaction = self.db.transaction(force_rollback=True)
        transaction.__enter__()
        self.addCleanup(transaction.__exit__, None, None, None)
        self.x = self.db.execute
        self.observed = {}

    def tearDown(self):
        if EVIDENCE:
            Path(EVIDENCE).mkdir(parents=True, exist_ok=True)
            name = self.id().rsplit(".", 1)[-1]
            Path(EVIDENCE, name + ".json").write_text(json.dumps(self.observed, indent=1, default=str, ensure_ascii=False) + "\n")

    def as_collector(self):
        self.x("SET LOCAL ROLE vega_collect")
        self.assertEqual(self.x("SELECT current_user").fetchone(), ("vega_collect",))

    def rows(self, table, where="true", params=None, drop=("updated_at",)):
        """The rows of `table` as sorted JSON texts, without the columns `drop` names."""
        return sorted(r[0] for r in self.x(f"SELECT (to_jsonb(t) - %s::text[])::text FROM {table} t WHERE {where}",
                                            (list(drop), *(params or ()))).fetchall())

    def note(self, step, **state):
        plain = lambda v: {":".join(k) if isinstance(k, tuple) else k: plain(x) for k, x in v.items()} if isinstance(v, dict) else v
        self.observed[step] = plain(state)


class TransfermarktReplayTest(WriterReplay):
    """40a–40l: the Transfermarkt reader's values, injuries, squads and clubs, by Reader.read under vega_collect."""

    def setUp(self):
        super().setUp()
        x = self.x
        x("""INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id)
             VALUES ('player', 'transfermarkt', '342229', 10), ('player', 'transfermarkt', '288230', 11), ('team', 'transfermarkt', '583', 1)""")
        for kind, key in (("values", "342229"), ("injuries", "342229"), ("squad", "583:2026"), ("club", "583")):
            x("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES (%s, %s, 1, now() - interval '1 minute')", (kind, key))
        self.answers = {}
        self.as_collector()
        self.reader = tm.Reader(self.db, self.fetch, interval=0, jitter=0, sleep=lambda s: None, log=lambda *a, **k: None)

    def fetch(self, path, params=()):
        answer = self.answers[urlparse(path).path]
        return answer if isinstance(answer, tuple) else (200, {}, body(answer))

    def read(self, kind, key, path, answer):
        self.answers[path] = answer
        return self.reader.read(kind, [(key, 1)])

    def unit(self, kind, key):
        row = self.x("""SELECT error_code, last_http_status, next_due_at - now() <= interval '1 day', rows_written
                        FROM ops.transfermarkt_reads WHERE kind = %s AND provider_key = %s""", (kind, key)).fetchone()
        return {"error_code": row[0], "status": row[1], "due_within_a_day": row[2], "rows_written": row[3]}

    # Values ---------------------------------------------------------------------------------------------------------

    VALUES_PATH = "/player/342229/market-value-history"

    def values(self):
        return self.rows("core.player_market_values", "player_id = 10")

    def accepted_values(self):
        self.assertEqual(self.read("values", "342229", self.VALUES_PATH, VALUES), "ok")
        accepted = self.values()
        self.assertEqual(len(accepted), 2)
        return accepted

    def test_40a_the_same_value_history_twice_changes_nothing(self):
        accepted = self.accepted_values()
        self.assertEqual(self.read("values", "342229", self.VALUES_PATH, VALUES), "ok")
        self.note("40a", first=accepted, second=self.values(), unit=self.unit("values", "342229"))
        self.assertEqual(self.values(), accepted)

    def test_40b_an_empty_value_history_keeps_the_points(self):
        accepted = self.accepted_values()
        outcome = self.read("values", "342229", self.VALUES_PATH, {"history": []})
        self.note("40b", outcome=outcome, before=accepted, after=self.values(), unit=self.unit("values", "342229"))
        self.assertEqual(self.values(), accepted)

    @defect("write_values deletes every Transfermarkt point of the player absent from a valid, non-empty history "
            "(transfermarkt.py, DELETE … NOT (valued_at = ANY(days))): an omission is taken for a removal, without trace. "
            "Owner: VI-21 (Transfermarkt values, outside VI-31).")
    def test_40c_a_truncated_value_history_keeps_the_omitted_point(self):
        accepted = self.accepted_values()
        outcome = self.read("values", "342229", self.VALUES_PATH, {"history": VALUES["history"][1:]})
        unit = self.unit("values", "342229")
        self.note("40c", outcome=outcome, before=accepted, after=self.values(), unit=unit)
        refused = outcome != "ok" and unit["error_code"] is not None
        self.assertTrue(refused or self.values() == accepted, "the omitted point was deleted and the read accepted")

    def test_40d_a_malformed_value_history_keeps_the_points_and_is_traced(self):
        accepted = self.accepted_values()
        outcome = self.read("values", "342229", self.VALUES_PATH, {"history": "x"})
        unit = self.unit("values", "342229")
        self.note("40d", outcome=outcome, before=accepted, after=self.values(), unit=unit)
        self.assertEqual((outcome, self.values()), ("schema", accepted))
        self.assertEqual((unit["error_code"], unit["due_within_a_day"]), ("SCHEMA_CHANGED", True))

    # Injuries -------------------------------------------------------------------------------------------------------

    INJURIES_PATH = "/player/342229/injury"

    def injuries(self):
        return self.rows("core.player_injuries", "player_id = 10", drop=("updated_at", "id"))

    def accepted_injuries(self):
        self.assertEqual(self.read("injuries", "342229", self.INJURIES_PATH, INJURIES), "ok")
        accepted = self.injuries()
        self.assertEqual(len(accepted), 2)
        return accepted

    def ids(self):
        return [i for (i,) in self.x("SELECT id FROM core.player_injuries WHERE player_id = 10 ORDER BY start_date").fetchall()]

    def test_40e_the_same_injuries_twice_change_nothing(self):
        accepted, first = self.accepted_injuries(), self.ids()
        self.assertEqual(self.read("injuries", "342229", self.INJURIES_PATH, INJURIES), "ok")
        # The ids are recorded, not asserted: no table references core.player_injuries.id.
        self.note("40e", first=accepted, second=self.injuries(), ids_first=first, ids_second=self.ids())
        self.assertEqual(self.injuries(), accepted)

    @defect("write_injuries deletes the player's Transfermarkt episodes before writing the answer's: a 200 with an empty "
            "list erases the history and the read is acquitted (error_code NULL). Owner: VI-21 (Transfermarkt injuries).")
    def test_40f_an_empty_injury_list_keeps_the_episodes(self):
        accepted = self.accepted_injuries()
        outcome = self.read("injuries", "342229", self.INJURIES_PATH, {"injuries": []})
        unit = self.unit("injuries", "342229")
        self.note("40f", outcome=outcome, before=accepted, after=self.injuries(), unit=unit)
        refused = outcome != "ok" and unit["error_code"] is not None
        self.assertTrue(refused or self.injuries() == accepted, "the episodes were erased and the read accepted")

    @defect("write_injuries replaces the whole history by the answer: a valid list without one episode deletes it, "
            "without trace. Owner: VI-21 (Transfermarkt injuries).")
    def test_40g_a_truncated_injury_list_keeps_the_omitted_episode(self):
        accepted = self.accepted_injuries()
        outcome = self.read("injuries", "342229", self.INJURIES_PATH, {"injuries": INJURIES["injuries"][:1]})
        unit = self.unit("injuries", "342229")
        self.note("40g", outcome=outcome, before=accepted, after=self.injuries(), unit=unit)
        refused = outcome != "ok" and unit["error_code"] is not None
        self.assertTrue(refused or self.injuries() == accepted, "the omitted episode was deleted and the read accepted")

    @defect("a refused injuries read (SCHEMA_CHANGED) keeps the episodes in core.player_injuries but sets error_code on the "
            "unit, and api.player_injury_reads (116) requires error_code IS NULL: the player leaves the view and the route "
            "answers 404 although his accepted history is stored. Owner: VI-21 (Transfermarkt injuries, read API).")
    def test_40h_a_malformed_injury_answer_keeps_the_history_readable(self):
        accepted = self.accepted_injuries()
        outcome = self.read("injuries", "342229", self.INJURIES_PATH, {"injuries": "x"})
        unit = self.unit("injuries", "342229")
        self.assertEqual((outcome, self.injuries(), unit["error_code"], unit["due_within_a_day"]), ("schema", accepted, "SCHEMA_CHANGED", True))
        self.x("SET LOCAL ROLE vega_read")
        readable = self.x("SELECT count(*) FROM api.player_injury_reads WHERE player_key = 10").fetchone()[0]
        served = self.x("SELECT count(*) FROM api.player_injuries WHERE player_key = 10").fetchone()[0]
        self.note("40h", outcome=outcome, unit=unit, injury_reads_rows=readable, injuries_rows=served)
        self.assertEqual((readable, served), (1, 2))

    # Squads ---------------------------------------------------------------------------------------------------------

    SQUAD_PATH = "/club/583/squad"

    def squad(self):
        return self.rows("core.provider_squads", "club_key = '583'")

    def accepted_squad(self):
        self.assertEqual(self.read("squad", "583:2026", self.SQUAD_PATH, SQUAD), "ok")
        accepted = self.squad()
        self.assertEqual(len(accepted), 2)
        return accepted

    def test_40i_the_same_squad_twice_changes_nothing(self):
        accepted = self.accepted_squad()
        self.assertEqual(self.read("squad", "583:2026", self.SQUAD_PATH, SQUAD), "ok")
        self.note("40i", first=accepted, second=self.squad())
        self.assertEqual(self.squad(), accepted)

    @defect("write_squad deletes the club/season's members before writing the answer's: a 200 with an empty squad erases "
            "them (and the profile candidates the planner reads there), acquitted. Owner: VI-21 (Transfermarkt squads).")
    def test_40j_an_empty_squad_keeps_the_members(self):
        accepted = self.accepted_squad()
        outcome = self.read("squad", "583:2026", self.SQUAD_PATH, {"squad": []})
        unit = self.unit("squad", "583:2026")
        self.note("40j", outcome=outcome, before=accepted, after=self.squad(), unit=unit)
        refused = outcome != "ok" and unit["error_code"] is not None
        self.assertTrue(refused or self.squad() == accepted, "the members were erased and the read accepted")

    @defect("write_squad replaces the club/season by the answer: a valid squad without one member deletes him, without "
            "trace. Owner: VI-21 (Transfermarkt squads).")
    def test_40k_a_truncated_squad_keeps_the_omitted_member(self):
        accepted = self.accepted_squad()
        outcome = self.read("squad", "583:2026", self.SQUAD_PATH, {"squad": SQUAD["squad"][:1]})
        unit = self.unit("squad", "583:2026")
        self.note("40k", outcome=outcome, before=accepted, after=self.squad(), unit=unit)
        refused = outcome != "ok" and unit["error_code"] is not None
        self.assertTrue(refused or self.squad() == accepted, "the omitted member was deleted and the read accepted")

    # Clubs ----------------------------------------------------------------------------------------------------------

    def test_40l_the_same_club_record_twice_changes_nothing(self):
        self.assertEqual(self.read("club", "583", "/clubs", CLUBS), "ok")
        first = self.rows("core.provider_clubs", "provider_key = '583'")
        self.assertEqual(len(first), 1)
        self.assertEqual(self.read("club", "583", "/clubs", CLUBS), "ok")
        self.note("40l", first=first, second=self.rows("core.provider_clubs", "provider_key = '583'"))
        self.assertEqual(self.rows("core.provider_clubs", "provider_key = '583'"), first)


def uefa_club(ident, name, position, points):
    return {"member": {"id": ident, "displayName": name, "countryCode": "FRA", "logoUrl": f"https://img.uefa.com/imgml/TP/teams/logos/70x70/{ident}.png"},
            "overallRanking": {"position": position, "totalValue": points, "totalPoints": points - 1, "numberOfTeamsStillInPlaying": 1},
            "seasonRankings": [{"seasonYear": 2027, "totalPoints": 9.5, "nationalAssociationPoints": 2.0, "numberOfTeamsStillInPlaying": 1}]}


class RankingReplayTest(WriterReplay):
    """40m–40o: the UEFA coefficients and the FIFA ranking, by sources.run_due under vega_collect."""

    def uefa_get(self, members, total):
        def get(url):
            query = parse_qs(urlparse(url).query)
            if (query["coefficientType"][0], query["seasonYear"][0], query["page"][0]) != ("MEN_CLUB", "2027", "1"):
                raise SourceError("HTTP_404")
            return {"data": {"members": members, "lastUpdateDate": "2026-11-18T22:00:00Z"}, "meta": {"collection": {"totalElements": total}}}
        return get

    def edition(self):
        where = "edition_id IN (SELECT id FROM core.ranking_editions WHERE kind = 'uefa_clubs' AND label = '2026/2027')"
        return {"rows": self.rows("core.ranking_rows", where), "seasons": self.rows("core.ranking_season_points", where),
                "edition": self.rows("core.ranking_editions", "kind = 'uefa_clubs'"), "teams": self.rows("core.teams")}

    def scope_run(self, source, scope):
        return self.x("SELECT status, error_code, rows_written FROM ops.source_runs WHERE source = %s AND scope = %s", (source, scope)).fetchone()

    def accepted_uefa(self):
        self.as_collector()
        complete = [uefa_club(52747, "Paris Saint-Germain", 1, 120.0), uefa_club(52748, "Olympique Lyonnais", 2, 80.0)]
        results = sources.run_due(self.db, self.uefa_get(complete, 2), NOW, names={"uefa"})
        self.assertEqual(results[("uefa", "uefa_clubs:2027")], "ok")
        accepted = self.edition()
        self.assertEqual(len(accepted["rows"]), 2)
        return complete, accepted

    def test_40m_the_same_uefa_pages_twice_change_nothing(self):
        complete, accepted = self.accepted_uefa()
        version = self.x("SELECT version FROM ops.resource_versions WHERE resource_kind = 'ranking'").fetchall()
        results = sources.run_due(self.db, self.uefa_get(complete, 2), NOW + timedelta(days=2), names={"uefa"})
        self.assertEqual(results[("uefa", "uefa_clubs:2027")], "ok")
        self.note("40m", first=accepted, second=self.edition(), ranking_versions_before=version,
                  ranking_versions_after=self.x("SELECT version FROM ops.resource_versions WHERE resource_kind = 'ranking'").fetchall())
        self.assertEqual(self.edition(), accepted)

    @defect("uefa.save deletes and rewrites the edition's rows and increments its resource version at every read, even when "
            "the pages are identical: a repeat publishes a new version (the European level's cohorts recalculate) for an "
            "unchanged ranking. Content is idempotent (40m), publication is not. Owner: VI-21 (UEFA coefficients).")
    def test_40x_the_same_uefa_pages_twice_publish_no_new_version(self):
        complete, _ = self.accepted_uefa()
        versions = lambda: self.x("SELECT resource_id, version FROM ops.resource_versions WHERE resource_kind = 'ranking' ORDER BY 1").fetchall()
        before = versions()
        sources.run_due(self.db, self.uefa_get(complete, 2), NOW + timedelta(days=2), names={"uefa"})
        self.note("40x", before=before, after=versions())
        self.assertEqual(versions(), before)

    @defect("uefa.fetch accepts a page whose totalElements is 0 with no member, and uefa.save deletes the edition's rows "
            "before writing none: the stored coefficients are erased and the scope recorded ok. Owner: VI-21 (UEFA coefficients).")
    def test_40n_an_empty_uefa_edition_keeps_the_stored_rows(self):
        _, accepted = self.accepted_uefa()
        results = sources.run_due(self.db, self.uefa_get([], 0), NOW + timedelta(days=2), names={"uefa"})
        self.note("40n", outcome=results[("uefa", "uefa_clubs:2027")], before=accepted["rows"], after=self.edition()["rows"],
                  run=self.scope_run("uefa", "uefa_clubs:2027"))
        self.assertEqual(self.edition()["rows"], accepted["rows"])
        self.assertNotEqual(results[("uefa", "uefa_clubs:2027")], "ok")

    @defect("fifa.run reads an edition once: a stored edition is never read again, so an edition first published or read "
            "short (one row of three) stays short, and a correction of it at the source is never applied. fifa.save has no "
            "completeness check. Owner: VI-21 (FIFA ranking).")
    def test_40o_a_short_fifa_edition_is_completed_or_refused(self):
        self.as_collector()
        page = '<html><script id="__NEXT_DATA__" type="application/json">' + json.dumps(
            {"props": {"pageProps": {"pageData": {"ranking": {"allAvailableDates": [{"id": "id15000", "date": "2026-10-23"}]}}}}}) + "</script></html>"
        full = [{"rankingItem": {"idTeam": str(43900 + i), "name": name, "countryCode": code, "rank": i, "previousRank": i, "totalPoints": 1900.0 - i}}
                for i, (name, code) in enumerate((("Spain", "ESP"), ("France", "FRA"), ("Argentina", "ARG")), 1)]
        listed = {"rankings": full[:1]}

        def get(url, as_text=False):
            if url == fifa.PAGE:
                return page
            if url.startswith(fifa.OVERVIEW):
                return listed
            raise SourceError("HTTP_404")

        self.x("INSERT INTO core.countries(code) VALUES ('ARG') ON CONFLICT DO NOTHING")
        self.assertEqual(sources.run_due(self.db, get, NOW, names={"fifa"}), {("fifa", "fifa_men:editions"): "ok"})
        short = self.rows("core.ranking_rows", "edition_id IN (SELECT id FROM core.ranking_editions WHERE kind = 'fifa_men')")
        listed = {"rankings": full}  # the source now lists the whole edition
        second = sources.run_due(self.db, get, NOW + timedelta(days=2), names={"fifa"})
        after = self.rows("core.ranking_rows", "edition_id IN (SELECT id FROM core.ranking_editions WHERE kind = 'fifa_men')")
        self.note("40o", first=short, second_outcome=second, after=after)
        self.assertEqual(len(short), 1)
        self.assertEqual(len(after), 3)


class HonoursReplayTest(WriterReplay):
    """40p–40q: Wikipedia honours (the « wikimedia » adapter), by sources.run_due under vega_collect."""

    BODY = {"available": True, "source": "Wikipédia", "identitySourceUrl": "https://www.wikidata.org/wiki/Q21621995",
            "sourceUrl": "https://en.wikipedia.org/w/index.php?title=Kylian_Mbapp%C3%A9&oldid=1#Honours", "revision": 1,
            "fetchedAt": "2026-11-19T08:00:00+00:00",
            "honours": [{"name": "FIFA World Cup", "team": "France", "category": "team", "seasons": ["2018"]},
                        {"name": "Golden Boot", "team": None, "category": "individual", "seasons": ["2022"]}]}

    def titles(self):
        return {"titles": self.rows("core.player_honour_titles", "player_id = 10"),
                "links": self.rows("core.provider_ids", "entity_type = 'player' AND provider = 'wikidata'")}

    def run_with(self, answer, at):
        original, honours.collect = honours.collect, lambda name, observations: answer if name == "Kylian Mbappé" else None
        try:
            return sources.run_due(self.db, None, at, names={"wikimedia"})
        finally:
            honours.collect = original

    def accepted(self):
        self.as_collector()
        self.assertEqual(self.run_with(self.BODY, NOW), {("wikimedia", "players"): "ok"})
        accepted = self.titles()
        self.assertEqual(len(accepted["titles"]), 2)
        return accepted

    def test_40p_the_same_honours_twice_change_nothing(self):
        accepted = self.accepted()
        self.assertEqual(self.run_with(self.BODY, NOW + honours.PERIOD + timedelta(hours=2)), {("wikimedia", "players"): "ok"})
        self.note("40p", first=accepted, second=self.titles())
        self.assertEqual(self.titles(), accepted)

    def test_40q_no_answer_from_the_collector_keeps_the_titles(self):
        accepted = self.accepted()
        later = NOW + honours.PERIOD + timedelta(hours=2)
        self.assertEqual(self.run_with(None, later), {("wikimedia", "players"): "ok"})
        checked = self.x("SELECT honours_checked_at FROM core.players WHERE id = 10").fetchone()[0]
        self.note("40q", before=accepted, after=self.titles(), checked_at=checked)
        self.assertEqual((self.titles(), checked), (accepted, later))


def person(qid, names, birth, height=None):
    row = {"p": {"value": "http://www.wikidata.org/entity/" + qid}, "names": {"value": "|".join(names)},
           "birth": {"value": birth + "T00:00:00Z"}, "prec": {"value": "11"}}
    if height is not None:
        row["height"], row["unit"] = {"value": str(height)}, {"value": "http://www.wikidata.org/entity/Q11573"}
    return row


class WikidataReplayTest(WriterReplay):
    """40r–40w: Wikidata clubs, stadiums and player facts, by sources.run_due under vega_collect."""

    CLUB = {"sourceUrl": "https://www.wikidata.org/entity/Q483020", "fetchedAt": "2026-11-19T08:00:00.000Z", "stadium": "Parc des Princes",
            "stadiumId": "Q172287", "stadiumAlias": "Parc", "coach": {"name": "Luis Enrique", "photo": None}, "founded": "1970"}
    STADIUM = {"id": "Q172287", "sourceUrl": "https://www.wikidata.org/wiki/Q172287", "fetchedAt": "2026-11-19T08:00:00.000Z",
               "capacity": 47929, "capacityAsOf": "2019", "opened": "1897-07-18", "created": None, "coordinates": {"lat": 48.84, "lon": 2.25}}

    def run_with(self, answers, at, players=None):
        def bridge(command, *args):
            return answers.get((command, *args))

        def get(url, headers=None):
            return {"results": {"bindings": players or []}}

        original, wikidata.bridge = wikidata.bridge, bridge
        try:
            return sources.run_due(self.db, get, at, names={"wikidata"})
        finally:
            wikidata.bridge = original

    def club_state(self):
        return {"team": self.rows("core.teams", "id = 1", drop=("updated_at", "wikidata_fetched_at", "wikidata_players_at")),
                "venues": self.rows("core.venues", drop=("updated_at", "wikidata_fetched_at")),
                "tenures": self.rows("core.team_coach_tenures"), "coaches": self.rows("core.coaches"),
                "venue_names": self.rows("core.entity_names", "entity_type = 'venue'")}

    def answers(self, club=None, stadium=None):
        return {("identity", "Paris Saint-Germain", "FRA"): "Q483020", ("club", "Q483020"): club or self.CLUB,
                ("stadium", "Q172287"): stadium or self.STADIUM}

    def accepted_club(self):
        self.x("UPDATE core.teams SET wikidata_fetched_at = %s WHERE id = 2", (NOW,))  # only PSG is due
        self.as_collector()
        results = self.run_with(self.answers(), NOW)
        self.assertEqual((results[("wikidata", "clubs")], results[("wikidata", "stadiums")]), ("ok", "ok"))
        accepted = self.club_state()
        self.assertEqual(self.x("SELECT founded_year FROM core.teams WHERE id = 1").fetchone(), (1970,))
        self.assertEqual(self.x("SELECT capacity FROM core.venues").fetchall(), [(47929,)])
        return accepted

    def test_40r_the_same_club_and_stadium_twice_change_nothing(self):
        accepted = self.accepted_club()
        results = self.run_with(self.answers(), NOW + wikidata.STADIUM_PERIOD + timedelta(days=1))
        self.note("40r", outcome=results, first=accepted, second=self.club_state())
        self.assertEqual(self.club_state(), accepted)

    @defect("wikidata.save_club writes founded_year from the answer as it is (NULL when absent) and closes the open Wikidata "
            "tenure when the answer names no coach: a partial bridge answer erases the founded year and ends the current coach's "
            "tenure the day of the read. Owner: VI-21 (Wikidata clubs).")
    def test_40s_a_club_answer_without_founded_or_coach_keeps_them(self):
        self.accepted_club()
        partial = dict(self.CLUB, founded=None, coach=None)
        later = NOW + wikidata.CLUB_PERIOD + timedelta(days=1)
        self.run_with(self.answers(club=partial), later)
        founded = self.x("SELECT founded_year FROM core.teams WHERE id = 1").fetchone()[0]
        open_tenures = self.x("SELECT count(*) FROM core.team_coach_tenures WHERE team_id = 1 AND end_date IS NULL").fetchone()[0]
        self.note("40s", founded_year=founded, open_tenures=open_tenures, tenures=self.rows("core.team_coach_tenures"))
        self.assertEqual((founded, open_tenures), (1970, 1))

    @defect("wikidata.save_stadium writes capacity, its date and the coordinates from the answer as they are: an answer "
            "without them sets them to NULL. Owner: VI-21 (Wikidata stadiums).")
    def test_40t_a_stadium_answer_without_capacity_keeps_it(self):
        self.accepted_club()
        partial = dict(self.STADIUM, capacity=None, capacityAsOf=None, coordinates=None)
        self.run_with(self.answers(stadium=partial), NOW + wikidata.STADIUM_PERIOD + timedelta(days=1))
        venue = self.x("SELECT capacity, latitude IS NOT NULL, longitude IS NOT NULL FROM core.venues").fetchone()
        self.note("40t", venue=venue)
        self.assertEqual(venue, (47929, True, True))

    # Player facts ---------------------------------------------------------------------------------------------------

    PEOPLE = [person("Q21621995", ["Kylian Mbappé"], "1998-12-20", 1.78), person("Q5794", ["Ousmane Dembélé"], "1997-05-15", 1.78),
              person("Q1500000", ["Achraf Hakimi"], "1998-11-04", 1.81)]

    def facts(self):
        return self.rows("core.players", "id IN (10, 11, 12, 13)", drop=("updated_at", "honours_checked_at"))

    def accepted_facts(self):
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'wikidata', 'Q483020', 1)")
        self.x("UPDATE core.teams SET wikidata_fetched_at = %s", (NOW,))  # the clubs scope is not due: player facts only
        self.as_collector()
        results = self.run_with({}, NOW, players=self.PEOPLE)
        self.assertEqual(results[("wikidata", "players")], "ok")
        self.assertEqual(self.x("SELECT id, birth_date, height_cm FROM core.players WHERE id IN (10, 11, 12) ORDER BY id").fetchall(),
                         [(10, date(1998, 12, 20), 178), (11, date(1997, 5, 15), 178), (12, date(1998, 11, 4), 181)])
        return self.facts()

    def test_40u_the_same_player_facts_twice_change_nothing(self):
        accepted = self.accepted_facts()
        results = self.run_with({}, NOW + timedelta(days=31), players=self.PEOPLE)
        run = self.x("SELECT status, rows_written FROM ops.source_runs WHERE source = 'wikidata' AND scope = 'players'").fetchone()
        self.note("40u", outcome=results[("wikidata", "players")], run=run, first=accepted, second=self.facts())
        self.assertEqual((self.facts(), run), (accepted, ("ok", 0)))

    def test_40v_an_empty_wikidata_answer_keeps_the_player_facts(self):
        accepted = self.accepted_facts()
        results = self.run_with({}, NOW + timedelta(days=31), players=[])
        self.note("40v", outcome=results[("wikidata", "players")], before=accepted, after=self.facts())
        self.assertEqual(self.facts(), accepted)

    @defect("player_facts.save replaces core.players.birth_date whatever its provenance and leaves birth_date_source_url as "
            "it was: a date the Transfermarkt snapshot attested (player_fact_snapshot, coalesce) is overwritten by Wikidata's and "
            "served under the snapshot's URL. Owner: VI-21 (player facts; the « six dates Wikidata écrasées »).")
    def test_40w_a_snapshot_attested_birth_date_keeps_its_provenance(self):
        url = "https://www.transfermarkt.com/-/profil/spieler/340324"
        self.x("UPDATE core.players SET birth_date = '1998-11-04', birth_date_source_url = %s WHERE id = 12", (url,))
        self.x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'wikidata', 'Q483020', 1)")
        self.x("UPDATE core.teams SET wikidata_fetched_at = %s", (NOW,))
        self.as_collector()
        other = [person("Q1500000", ["Achraf Hakimi"], "1998-11-05", 1.81)]
        self.assertEqual(self.run_with({}, NOW, players=other)[("wikidata", "players")], "ok")
        birth, source = self.x("SELECT birth_date, birth_date_source_url FROM core.players WHERE id = 12").fetchone()
        self.note("40w", birth_date=birth, birth_date_source_url=source)
        self.assertFalse(birth == date(1998, 11, 5) and source == url, "Wikidata's date is served under the snapshot's URL")


if __name__ == "__main__":
    unittest.main()
