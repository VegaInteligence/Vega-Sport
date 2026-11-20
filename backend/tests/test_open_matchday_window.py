"""Open Matchday's sliding window, written before the code: FAILURE_MODES.md §41 (41a–41r).

On a disposable local PostgreSQL (VEGA_V2_WINDOW_TEST_DSN, database vega_v2_window_test), the real writer runs through
sources.run_due under vega_collect, the Elo through Worker.daily under vega_calc, and the restore tool as the owner, with
consecutive real versions of the source's results files (fixtures/open_matchday/history, provenance.json: commits of
github.com/oladeeayo/open-matchday) and, for 41n, the reviewed captures of the 35 English matches
(docs/audits/2026-11-17/controles/verification-integree/35-matchs-identites-et-elo.zip).

Failure modes: a version that drops results by its left edge freezing a folder without attestation (41a, 41b); a
withdrawal inside the window, a moved result or a version unrelated to the stored one passing as a slide (41c–41f); a
score correction refused while the window slides (41g); results the source published, then dropped, never created
(41h–41j), or created twice, under the wrong teams, or beside a match that already holds them (41i, 41k, 41l); the 35
created under new ids, or duplicated once the restore tool brought them back (41m, 41n); the Elo left behind by a
creation (41o); the organizer's final of 8625 freezing its edition (41p); the remaining refusals weakened (41q, 41r).
"""

import contextlib
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import urlparse
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from prerequisites import required  # noqa: E402

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_WINDOW_TEST_DSN")
HISTORY = ROOT / "tests/fixtures/open_matchday/history"
DATA = ROOT / "vega/sources/data"
CAPTURES = ROOT.parent / "docs/audits/2026-11-17/controles/verification-integree/35-matchs-identites-et-elo.zip"
NOW = datetime(2026, 11, 19, 7, tzinfo=timezone.utc)
SEASON = "2026/2027"
NORTH, SOUTH, NPL = "ENG_6_national-league-north", "ENG_6_national-league-south", "ENG_7_northern-premier-league"
POL1, POL2, WAL, FA = "POL_2_division-1", "POL_3_division-2", "WAL_1_cymru-premier", "ENG_CUP_fa-cup"
LATEST = {NORTH: "13a434955d", SOUTH: "13a434955d", NPL: "13a434955d", POL1: "772fb543b5", POL2: "a49c863c76",
          WAL: "772fb543b5", FA: "e1ec9773df"}
ASHTON = f"{NPL}:{SEASON}:2026-11-03|Ashton Utd|Warrington"  # match 8625
RYLANDS = f"{NPL}:{SEASON}:2026-10-31|Ashton Utd|Warrington Rylands"
HEADER = "date,home,away,ft_home,ft_away"


def version(folder, sha):
    return (HISTORY / f"{folder}@{sha}.csv").read_text(encoding="utf-8")


def lines(text):
    return text.splitlines()


def attestations():
    """{provider key: entry} of both attestation files: the 35-result ledger and the published results (§41)."""
    out = {}
    for name in ("open_matchday_history.json", "open_matchday_published.json"):
        for row in json.loads((DATA / name).read_bytes())["results"]:
            assert row["provider_key"] not in out, row["provider_key"]
            out[row["provider_key"]] = row
    return out


ATTESTED = attestations()


def attested_of(folder):
    return {k: r for k, r in ATTESTED.items() if k.startswith(f"{folder}:{SEASON}:")}


@required(DSN and psycopg, "requires a disposable local window DB (VEGA_V2_WINDOW_TEST_DSN) and psycopg")
class WindowBase(unittest.TestCase):
    """A fresh migrated base per test; the writer under vega_collect."""
    attested = None  # None: the module's own attestations; a dict: patched in (RESULTS)

    @classmethod
    def setUpClass(cls):
        from vega.store import connect_local

        target = urlparse(DSN)
        if target.hostname not in ("localhost", "127.0.0.1", "::1") or target.path != "/vega_v2_window_test":
            raise RuntimeError("dedicated local window DB required")
        cls.db = connect_local(DSN)

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        from vega.sources import open_matchday_history
        from vega.store import connect_local, migrate

        self.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        migrate(self.db)
        self.x = self.db.execute
        self.collect = connect_local(DSN)
        self.addCleanup(self.collect.close)
        self.collect.execute("SET ROLE vega_collect")
        self.step = 0
        if self.attested is not None:
            self.patch_attested(self.attested)

    def patch_attested(self, rows):
        from vega.sources import open_matchday_history

        patcher = patch.object(open_matchday_history, "RESULTS", dict(rows))
        patcher.start()
        self.addCleanup(patcher.stop)

    def read(self, files, fixtures=None):
        """One due read of the europe scope with {folder: results text} (and {folder: fixtures text}): (outcome,
        rows written, unmatched)."""
        from vega import sources
        from vega.sources import open_matchday

        fixtures = fixtures or {}
        leagues = [{"folder": f"data/{folder}", "league": folder, "results": len(open_matchday.rows(text)),
                    "fixtures": len(open_matchday.rows(fixtures[folder])) if folder in fixtures else 0, "errors": []}
                   for folder, text in files.items()]
        bodies = {f"{open_matchday.RAW}data/{folder}/results_2627.csv": text for folder, text in files.items()}
        bodies.update({f"{open_matchday.RAW}data/{folder}/fixtures_2627.csv": text for folder, text in fixtures.items()})

        def get(url, *, as_text=False):
            if url.endswith("build_summary.json"):
                return {"season": "2627", "generated_utc": "2026-11-19T06:46:25Z", "leagues": leagues}
            if url not in bodies:
                raise sources.SourceError("HTTP_404")
            return bodies[url]

        self.step += 1
        at = NOW + timedelta(hours=7 * self.step)
        outcome = sources.run_due(self.collect, get, at, names={"open_matchday"})[("open_matchday", "europe")]
        return (outcome, *self.x("SELECT rows_written, unmatched FROM ops.source_runs WHERE source='open_matchday'").fetchone())

    def state(self, folder):
        """{provider key: (id, status, home score, away score, revision, updated_at, row version, home id, away id)}."""
        return {key: tuple(rest) for key, *rest in self.x(
            """SELECT p.provider_key, m.id, m.status::text, m.home_score, m.away_score, m.revision, m.updated_at, m.xmin::text,
                      m.home_team_id, m.away_team_id
               FROM core.matches m JOIN core.competition_seasons cs ON cs.id = m.competition_season_id
               JOIN core.provider_ids p ON p.entity_type='match' AND p.entity_id=m.id AND p.is_current
               WHERE cs.cup_key = %s""", (f"open-matchday:{folder}:{SEASON}",)).fetchall()}

    def edition(self, folder):
        return self.x("SELECT cup_checked_at, cup_updated_at FROM core.competition_seasons WHERE cup_key=%s",
                      (f"open-matchday:{folder}:{SEASON}",)).fetchone()

    def failures(self, code=None):
        rows = self.x("SELECT error_code, message FROM ops.parse_failures ORDER BY id").fetchall()
        return [r for r in rows if code is None or r[0] == code]

    def team(self, name):
        found = self.x("SELECT entity_id FROM core.provider_ids WHERE entity_type='team' AND provider='open_matchday' AND provider_key=%s",
                       ("name:" + name,)).fetchone()
        return found and found[0]

    @staticmethod
    def keys(folder, text):
        from vega.sources import open_matchday

        return {f"{folder}:{SEASON}:{r['date']}|{r['home']}|{r['away']}": (int(r["ft_home"]), int(r["ft_away"]))
                for r in open_matchday.rows(text)}

    def assertUnchanged(self, before, after, keys):
        for key in keys:
            self.assertEqual(after[key], before[key], key)


class LeftEdgeTest(WindowBase):
    """41a–41g in folders without attestations (the next slides, beyond the attested files)."""
    attested = {}

    def slide(self, folder, old, new):
        first = self.read({folder: version(folder, old)})
        self.assertEqual(first, ("ok", len(self.keys(folder, version(folder, old))), 0))
        return self.state(folder)

    def test_41a_poland_i_liga_a_left_edge_exit_keeps_the_old_results_and_writes_the_new(self):
        before = self.slide(POL1, "06b3cf482d", "772fb543b5")
        old, new = self.keys(POL1, version(POL1, "06b3cf482d")), self.keys(POL1, version(POL1, "772fb543b5"))
        gone, arriving = set(old) - set(new), set(new) - set(old)
        self.assertEqual((len(before), len(gone), len(arriving)), (106, 9, 9))
        stamps = self.edition(POL1)
        self.assertEqual(self.read({POL1: version(POL1, "772fb543b5")}), ("ok", 115, 0))  # red: ("ok", 0, 1)
        after = self.state(POL1)
        self.assertEqual(set(after), set(old) | set(new))
        self.assertUnchanged(before, after, gone)  # the 9 kept: same id, revision, updated_at, row version
        self.assertEqual({k: after[k][2:4] for k in arriving}, {k: new[k] for k in arriving})
        self.assertEqual(self.failures(), [])
        self.assertGreater(self.edition(POL1)[1], stamps[1])
        # Read again: nothing written.
        self.assertEqual(self.read({POL1: version(POL1, "772fb543b5")}), ("ok", 115, 0))
        self.assertEqual(self.state(POL1), after)
        self.assertEqual(self.failures(), [])

    def test_41b_wales_fa_cup_and_poland_ii_liga_slides_are_accepted(self):
        for folder, old, new in ((WAL, "fd27c060ea", "772fb543b5"), (FA, "55a7b8e0f4", "772fb543b5"), (POL2, "77e35fdbd5", "3a3ac5075a")):
            with self.subTest(folder=folder):
                before = self.slide(folder, old, new)
                first, last = self.keys(folder, version(folder, old)), self.keys(folder, version(folder, new))
                self.assertEqual(self.read({folder: version(folder, new)}), ("ok", len(set(first) | set(last)), 0))
                after = self.state(folder)
                self.assertEqual(set(after), set(first) | set(last))
                self.assertUnchanged(before, after, set(first) - set(last))
                self.assertEqual(self.failures(), [])

    def test_41c_a_result_moved_inside_the_window_still_refuses_the_version(self):
        before = self.slide(POL2, "3272e1f9d4", "b90bce70d4")
        self.assertEqual(self.read({POL2: version(POL2, "b90bce70d4")}), ("ok", 0, 1))
        self.assertEqual(self.state(POL2), before)
        self.assertEqual([f[0] for f in self.failures()], ["SNAPSHOT_DROPS_RESULT"])
        self.assertIn("2026-07-31|Kleczew|Podhale Nowy Targ", self.failures()[0][1])

    def refused(self, folder, before, rows, code="SNAPSHOT_DROPS_RESULT"):
        self.assertEqual(self.read({folder: "\n".join(rows) + "\n"}), ("ok", 0, 1))
        self.assertEqual(self.state(folder), before)
        self.assertEqual(self.failures()[-1][0], code)

    def test_41d_41e_41f_inside_withdrawals_a_disjoint_version_and_a_moved_result_are_refused(self):
        before = self.slide(POL1, "06b3cf482d", "772fb543b5")
        head, *rows = lines(version(POL1, "772fb543b5"))
        old = self.keys(POL1, version(POL1, "06b3cf482d"))
        start = min(r.split(",")[1] for r in rows)
        first_day = [r for r in rows if r.split(",")[1] == start and f"{POL1}:{SEASON}:{'|'.join(r.split(',')[1:2] + r.split(',')[3:5])}" in old]
        middle = [r for r in rows if r.split(",")[1] > start and f"{POL1}:{SEASON}:{'|'.join(r.split(',')[1:2] + r.split(',')[3:5])}" in old]
        with self.subTest("41d: a stored result of the first day missing"):
            self.assertTrue(first_day)
            self.refused(POL1, before, [head, *[r for r in rows if r != first_day[0]]])
        with self.subTest("41d: a stored result inside the window missing"):
            self.refused(POL1, before, [head, *[r for r in rows if r != middle[len(middle) // 2]]])
        with self.subTest("41e: a version that shares no stored result"):
            newest = [r for r in rows if f"{POL1}:{SEASON}:{'|'.join(r.split(',')[1:2] + r.split(',')[3:5])}" not in old]
            self.refused(POL1, before, [head, *newest])
        with self.subTest("41f: a leaving result whose sides arrive under another key"):
            gone = sorted(set(old) - set(self.keys(POL1, version(POL1, "772fb543b5"))))[0]
            day, home, away = gone.split(":", 2)[2].split("|")
            moved = (datetime.fromisoformat(day) + timedelta(days=29)).date().isoformat()
            template = next(r for r in rows).split(",")
            template[1], template[3], template[4] = moved, home, away
            self.refused(POL1, before, [head, *rows, ",".join(template)])

    def test_41g_a_score_corrected_inside_the_window_while_results_leave_is_written(self):
        before = self.slide(POL1, "06b3cf482d", "772fb543b5")
        head, *rows = lines(version(POL1, "772fb543b5"))
        old, new = self.keys(POL1, version(POL1, "06b3cf482d")), self.keys(POL1, version(POL1, "772fb543b5"))
        index = next(i for i, r in enumerate(rows) if f"{POL1}:{SEASON}:{'|'.join(r.split(',')[1:2] + r.split(',')[3:5])}" in old)
        cells = rows[index].split(",")
        key = f"{POL1}:{SEASON}:{cells[1]}|{cells[3]}|{cells[4]}"
        cells[5] = str(int(cells[5]) + 1)
        rows[index] = ",".join(cells)
        self.assertEqual(self.read({POL1: "\n".join([head, *rows]) + "\n"}), ("ok", 115, 0))  # red: refused
        after = self.state(POL1)
        self.assertEqual(after[key][0], before[key][0])
        self.assertEqual((after[key][2], after[key][4]), (int(cells[5]), before[key][4] + 1))
        self.assertUnchanged(before, after, set(old) - set(new))


class AttestedTest(WindowBase):
    """41g (English), 41h–41m, 41p–41r with both attestation files."""
    attested = ATTESTED

    def test_41g_english_a_score_corrected_inside_the_window_while_results_leave_is_written(self):
        self.assertEqual(self.read({NORTH: version(NORTH, "226252ce7c")})[0], "ok")
        before = self.state(NORTH)
        head, *rows = lines(version(NORTH, "13a434955d"))
        cells = rows[len(rows) // 2].split(",")
        key = f"{NORTH}:{SEASON}:{cells[1]}|{cells[3]}|{cells[4]}"
        self.assertIn(key, before)
        self.assertNotIn(key, ATTESTED)
        cells[5] = str(int(cells[5]) + 1)
        rows[len(rows) // 2] = ",".join(cells)
        self.assertEqual(self.read({NORTH: "\n".join([head, *rows]) + "\n"})[1:], (len(before) + 4, 0))  # red: (0, 1)
        after = self.state(NORTH)
        self.assertEqual((after[key][0], after[key][2], after[key][4]), (before[key][0], int(cells[5]), before[key][4] + 1))

    def test_41h_41i_the_english_files_of_18_november_give_540_results_once(self):
        files = {folder: version(folder, LATEST[folder]) for folder in (NORTH, SOUTH, NPL)}
        self.assertEqual(self.read(files)[0], "ok")
        expected = {NORTH: 116 + 59, SOUTH: 112 + 64, NPL: 111 + 78}
        states = {folder: self.state(folder) for folder in files}
        self.assertEqual({f: len(s) for f, s in states.items()}, expected)  # red: 116, 112, 111
        self.assertEqual(sum(map(len, states.values())), 540)
        for folder, found in states.items():
            live = self.keys(folder, files[folder])
            for key, proof in attested_of(folder).items():
                if proof.get("id_at_incident"):
                    self.assertNotIn(key, found)  # 41m: the 35 are the restore tool's
                    continue
                with self.subTest(key=key):
                    self.assertIn(key, found)
                    _, status, hs, aws, revision, *_, home, away = found[key]
                    self.assertEqual((status, [hs, aws]), ("finished", proof["score"]))
                    names = key.split(":", 2)[2].split("|")[1:]
                    self.assertEqual((home, away), (self.team(names[0]), self.team(names[1])))
                    if key not in live:
                        self.assertEqual(revision, 1)
        self.assertEqual(states[NPL][ASHTON][2:4], (0, 1))
        self.assertEqual(states[NPL][RYLANDS][2:4], (1, 2))
        self.assertEqual([f[0] for f in self.failures()], ["ATTESTED_FINAL_KEPT"])
        self.assertIn(ASHTON, self.failures()[0][1])
        stamps = {folder: self.edition(folder) for folder in files}
        # 41i: read again, nothing written.
        self.assertEqual(self.read(files)[0], "ok")
        self.assertEqual({folder: self.state(folder) for folder in files}, states)
        self.assertEqual({folder: self.edition(folder)[1] for folder in files}, {f: s[1] for f, s in stamps.items()})
        self.assertEqual(len(self.failures()), 1)

    def test_41j_poland_wales_and_the_fa_cup_qualifying_rounds_are_created(self):
        files = {folder: version(folder, LATEST[folder]) for folder in (POL1, POL2, WAL, FA)}
        self.assertEqual(self.read(files)[0], "ok")
        self.assertEqual({f: len(self.state(f)) for f in files}, {POL1: 106 + 20, POL2: 105 + 36, WAL: 105 + 22, FA: 142 + 80})
        self.assertEqual(self.failures(), [])
        for folder in files:
            found = self.state(folder)
            self.assertTrue(all(found[k][1:4] == ("finished", *r["score"]) for k, r in attested_of(folder).items()))

    def test_41k_an_attested_result_another_match_holds_is_not_created(self):
        from vega.sources import open_matchday_history

        own = attested_of(POL1)
        with patch.object(open_matchday_history, "RESULTS", {}):
            self.assertEqual(self.read({POL1: version(POL1, LATEST[POL1])}), ("ok", 106, 0))
        known = [k for k in sorted(own) if all(self.team(n) for n in k.split(":", 2)[2].split("|")[1:])]
        same_pair, elsewhere = known[0], known[1]
        day, home, away = same_pair.split(":", 2)[2].split("|")
        comp = self.x("INSERT INTO core.competitions(name) VALUES ('Another') RETURNING id").fetchone()[0]
        other = self.x("INSERT INTO core.competition_seasons(competition_id,season_id,native_label) VALUES (%s,2026,'2026/2027') RETURNING id",
                       (comp,)).fetchone()[0]
        # Its day and its two teams, reversed, in another edition; and its key on another match.
        self.x("""INSERT INTO core.matches(competition_season_id,season_id,source,status,match_date,home_team_id,away_team_id,home_score,away_score)
                  VALUES (%s,2026,'open_matchday','finished',%s,%s,%s,0,0)""", (other, day, self.team(away), self.team(home)))
        holder = self.x("""INSERT INTO core.matches(competition_season_id,season_id,source,status,match_date)
                           VALUES (%s,2026,'open_matchday','not_started','2026-12-01') RETURNING id""", (other,)).fetchone()[0]
        self.x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('match','open_matchday',%s,%s)",
               (elsewhere, holder))
        self.assertEqual(self.read({POL1: version(POL1, LATEST[POL1])})[0], "ok")
        found = self.state(POL1)
        self.assertEqual(set(own) - set(found), {same_pair, elsewhere})
        self.assertEqual(len(found), 106 + 18)
        held = self.failures("ATTESTED_RESULT_NOT_CREATED")
        self.assertEqual(len(held), 2)
        self.assertTrue(any(same_pair in m for _, m in held) and any(elsewhere in m for _, m in held))
        self.read({POL1: version(POL1, LATEST[POL1])})
        self.assertEqual((self.state(POL1), len(self.failures())), (found, 2))

    def test_41l_a_source_attestation_inside_the_window_is_not_created(self):
        inside = f"{POL1}:{SEASON}:2026-10-04|Nowhere FC|Elsewhere FC"
        self.patch_attested({**ATTESTED, inside: {"provider_key": inside, "score": [1, 0], "round": None,
                                                  "published_in": {"commit": "0" * 40}}})
        self.assertEqual(self.read({POL1: version(POL1, LATEST[POL1])})[0], "ok")
        found = self.state(POL1)
        self.assertNotIn(inside, found)
        self.assertEqual(len(found), 106 + 20)
        self.assertEqual(len(self.failures("ATTESTED_RESULT_NOT_CREATED")), 1)

    def test_41m_the_35_are_never_created_and_their_return_while_absent_refuses_the_version(self):
        self.assertEqual(self.read({NORTH: version(NORTH, "13a434955d")})[0], "ok")
        before = self.state(NORTH)
        self.assertFalse(any(r.get("id_at_incident") and k in before for k, r in ATTESTED.items()))
        self.assertEqual(self.read({NORTH: version(NORTH, "226252ce7c")}), ("ok", 0, 1))
        self.assertEqual(self.state(NORTH), before)
        self.assertEqual(self.failures()[-1][0], "ATTESTED_HISTORY_RESTORE_REQUIRED")

    def test_41p_the_organizer_final_of_8625_prevails_once_and_the_edition_is_written(self):
        self.patch_attested({k: r for k, r in ATTESTED.items() if k != ASHTON})
        self.assertEqual(self.read({NPL: version(NPL, LATEST[NPL])})[0], "ok")
        before = self.state(NPL)
        self.assertEqual(before[ASHTON][2:4], (1, 2))
        self.patch_attested(ATTESTED)
        self.assertEqual(self.read({NPL: version(NPL, LATEST[NPL])}), ("ok", len(before), 1))  # red: ("ok", 0, 1)
        after = self.state(NPL)
        self.assertEqual((after[ASHTON][0], after[ASHTON][2:4], after[ASHTON][4]), (before[ASHTON][0], (0, 1), before[ASHTON][4] + 1))
        self.assertUnchanged(before, after, set(before) - {ASHTON})
        kept = self.failures("ATTESTED_FINAL_KEPT")
        self.assertEqual(len(kept), 1)
        self.assertIn("1–2", kept[0][1])
        self.assertIn("0–1", kept[0][1])
        self.read({NPL: version(NPL, LATEST[NPL])})
        self.assertEqual((self.state(NPL), len(self.failures())), (after, 1))

    def test_41q_a_source_attestation_contradicted_and_an_attested_final_listed_unplayed_still_refuse(self):
        head, *rows = lines(version(POL1, "06b3cf482d"))
        own = attested_of(POL1)
        index = next(i for i, r in enumerate(rows) if f"{POL1}:{SEASON}:{'|'.join(r.split(',')[1:2] + r.split(',')[3:5])}" in own)
        cells = rows[index].split(",")
        cells[5] = str(int(cells[5]) + 1)
        changed = [*rows[:index], ",".join(cells), *rows[index + 1:]]
        self.assertEqual(self.read({POL1: "\n".join([head, *changed]) + "\n"}), ("ok", 0, 1))
        self.assertEqual(self.failures()[-1][0], "ATTESTED_HISTORY_CONFLICT")
        self.assertEqual(self.state(POL1), {})
        fixture = rows[index].split(",")
        without = [*rows[:index], *rows[index + 1:]]
        fixtures = f"date,home,away\n{fixture[1]},{fixture[3]},{fixture[4]}\n"
        self.assertEqual(self.read({POL1: "\n".join([head, *without]) + "\n"}, {POL1: fixtures}), ("ok", 0, 1))
        self.assertEqual(self.failures()[-1][0], "ATTESTED_HISTORY_CONFLICT")

    def test_41r_both_attestation_files_are_pinned(self):
        import importlib
        from vega.sources import open_matchday_history

        self.assertEqual(dict(open_matchday_history.RESULTS), ATTESTED)  # red: the ledger alone
        for name in ("open_matchday_history.json", "open_matchday_published.json"):
            with self.subTest(name=name):
                original = (DATA / name).read_bytes()
                real = Path.read_bytes
                with patch.object(Path, "read_bytes", lambda p: (original + b" ") if p.name == name else real(p)):
                    with self.assertRaises(ValueError):
                        importlib.reload(open_matchday_history)
        importlib.reload(open_matchday_history)
        self.assertEqual(dict(open_matchday_history.RESULTS), ATTESTED)


def capture(name):
    with zipfile.ZipFile(CAPTURES) as archive:
        return archive.read(name)


class RestoreTest(WindowBase):
    """41n: the reviewed captures of the 35, the English files of 18 Nov, the restore tool, then the writer."""
    attested = ATTESTED

    def rows(self, view, key):
        return [json.loads(line) for line in view["reads"][key]["rows_json"]]

    def insert(self, table, documents):
        from psycopg import sql
        from psycopg.types.json import Jsonb

        columns = [c for (c,) in self.x("""SELECT attname FROM pg_attribute WHERE attrelid=%s::regclass AND attnum>0
                                            AND NOT attisdropped AND attgenerated='' ORDER BY attnum""", (table,))]
        names = sql.SQL(", ").join(map(sql.Identifier, columns))
        target = sql.Identifier(*table.split("."))
        self.x(sql.SQL("INSERT INTO {} ({}) SELECT {} FROM jsonb_populate_recordset(NULL::{}, %s)").format(target, names, names, target),
               (Jsonb(documents),))

    def setUp(self):
        super().setUp()
        self.before_raw, self.after_raw = capture("rds/avant.zlib"), capture("rds/apres.zlib")
        before = json.loads(zlib.decompress(self.before_raw))
        after = json.loads(zlib.decompress(self.after_raw))
        # The production parents of the 35 as the preimage holds them: season, the three editions, rounds, the 70 clubs
        # and their Open Matchday names; the published Elo run 2097 and its 70 sides. The 35 themselves are absent.
        self.insert("core.seasons", self.rows(before, "parent.matches_season_id_fkey"))
        self.x("SELECT core.ensure_season_partitions(2026)")
        teams = {r["id"]: dict(r, crest_asset_id=None, home_venue_id=None)
                 for key in ("parent.matches_home_team_id_fkey", "parent.matches_away_team_id_fkey") for r in self.rows(before, key)}
        self.x("INSERT INTO core.countries(code) SELECT unnest(%s::text[]) ON CONFLICT DO NOTHING",
               (sorted({t["country_code"] for t in teams.values() if t["country_code"]}),))
        self.insert("core.teams", list(teams.values()))
        editions = self.rows(before, "parent.matches_competition_season_id_season_id_fkey")
        for edition in editions:
            self.x("INSERT INTO core.competitions(id,name,country_code) VALUES (%s,%s,'ENG')", (edition["competition_id"], edition["cup_name"]))
            self.x("INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('competition','vega',%s,%s)",
                   ("cup:open-matchday:" + edition["cup_key"].split(":")[1], edition["competition_id"]))
        self.insert("core.competition_seasons", editions)
        self.insert("core.rounds", self.rows(before, "parent.matches_round_id_fkey"))
        for match in self.rows(before, "table.core.matches"):
            for side in ("home", "away"):
                self.x("""INSERT INTO core.provider_ids(entity_type,provider,provider_key,entity_id) VALUES ('team','open_matchday',%s,%s)
                          ON CONFLICT DO NOTHING""", ("name:" + match[side + "_team_name"], match[side + "_team_id"]))
        self.insert("agg.power_runs", self.rows(after, "elo_runs"))
        self.insert("agg.team_elo", self.rows(after, "table.agg.team_elo"))
        self.x("SELECT setval(pg_get_serial_sequence('core.matches','id'), 20000)")
        self.ids = sorted(r["id"] for r in self.rows(before, "table.core.matches"))
        self.before_view, self.after_view = before, after

    def restore(self, apply):
        from vega import open_matchday_restore

        with patch.object(open_matchday_restore, "RESULTS", ATTESTED):
            return open_matchday_restore.restore(self.db, self.before_view, self.after_view, apply)

    def test_41n_restored_35_are_kept_without_duplicates_and_the_next_passes_write_nothing(self):
        files = {folder: version(folder, LATEST[folder]) for folder in (NORTH, SOUTH, NPL)}
        self.assertEqual(self.read(files)[0], "ok")
        self.assertEqual(sum(len(self.state(f)) for f in files), 540)  # red: 339
        self.assertFalse(self.x("SELECT 1 FROM core.matches WHERE id = ANY(%s)", (self.ids,)).fetchone())
        self.assertEqual(self.restore(False)["would_restore"], 35)
        report = self.restore(True)
        self.assertEqual((report["restored"], report["preserved_elo"]), (35, 70))
        self.assertEqual(sum(len(self.state(f)) for f in files), 575)
        # The next pass keeps them: no duplicate, no new match, no revision; the one after writes nothing.
        revisions = {f: {k: v[:6] for k, v in self.state(f).items()} for f in files}
        self.assertEqual(self.read(files), ("ok", 575, 1))  # unmatched: 8625's kept final (41p)
        states = {f: self.state(f) for f in files}
        self.assertEqual({f: {k: v[:6] for k, v in s.items()} for f, s in states.items()}, revisions)
        restored = {k: v for s in states.values() for k, v in s.items() if v[0] in self.ids}
        self.assertEqual(len(restored), 35)
        self.assertTrue(all(ATTESTED[k]["id_at_incident"] == v[0] for k, v in restored.items()))
        pairs = self.x("""SELECT count(*) FROM (SELECT match_date, least(home_team_id, away_team_id), greatest(home_team_id, away_team_id)
                          FROM core.matches GROUP BY 1, 2, 3 HAVING count(*) > 1) d""").fetchone()[0]
        self.assertEqual(pairs, 0)
        self.assertEqual(self.read(files), ("ok", 575, 1))  # unmatched: 8625's kept final (41p)
        self.assertEqual({f: self.state(f) for f in files}, states)
        self.assertEqual(self.restore(True)["restored"], 0)


class EloAfterCreationTest(WindowBase):
    """41o: a pass whose only change is the creation of attested results publishes the Elo, once."""

    def setUp(self):
        super().setUp()
        from vega.store import Store, connect_local
        from vega.worker import Worker

        self.calc = connect_local(DSN)
        self.addCleanup(self.calc.close)
        self.calc.execute("SET ROLE vega_calc")
        self.clock = NOW
        self.worker = Worker(Store(self.collect), SimpleNamespace(), clock=lambda: self.clock, calc_conn=self.calc, source_get=self.get)

    def get(self, url, *, as_text=False):
        from vega.sources import open_matchday

        text = version(POL1, LATEST[POL1])
        if url.endswith("build_summary.json"):
            return {"season": "2627", "generated_utc": "2026-11-19T06:46:25Z", "leagues": [
                {"folder": f"data/{POL1}", "league": POL1, "results": len(open_matchday.rows(text)), "fixtures": 0, "errors": []}]}
        return text

    def daily(self):
        from vega import sources
        from vega.sources import open_matchday

        out = io.StringIO()
        with contextlib.redirect_stdout(out), patch.object(sources, "adapters", lambda: {"open_matchday": open_matchday}):
            self.worker.daily()
        self.assertNotIn("error=", out.getvalue())

    def elo(self):
        runs = self.x("SELECT id, status FROM agg.power_runs WHERE kind='elo' ORDER BY id").fetchall()
        published = {r[0] for r in runs if r[1] == "published"}
        sides = {m for m, run in self.x("SELECT match_id, run_id FROM agg.team_elo").fetchall() if run in published}
        return runs, sides

    def test_41o_the_elo_runs_once_after_a_creation_and_covers_the_created_matches(self):
        from vega.sources import open_matchday_history

        with patch.object(open_matchday_history, "RESULTS", {}):
            self.daily()  # the version alone: 106 results, the Elo of the first complementary population
        runs, sides = self.elo()
        self.assertEqual((len(runs), len(sides)), (1, 106))
        self.clock += timedelta(hours=7)
        self.patch_attested(ATTESTED)
        self.daily()  # the 20 created: the only change of this pass
        created = {v[0] for k, v in self.state(POL1).items() if k in attested_of(POL1)}
        self.assertEqual(len(created), 20)  # red: 0
        runs, sides = self.elo()
        self.assertEqual([r[1] for r in runs], ["superseded", "published"])
        self.assertLessEqual(created, sides)
        self.assertEqual(len(sides), 126)
        self.clock += timedelta(hours=7)
        self.daily()
        self.assertEqual(self.elo(), (runs, sides))


if __name__ == "__main__":
    unittest.main()
