"""Transfermarkt refreshes keep what was accepted (VI-31, FAILURE_MODES §20), end to end: the real
reader (its requests, its checks, its writes and its queue row in one transaction), every migration,
the views and the read API's profile route, against controlled answers of the provider. Contract
dates are relative to the base's current_date.

VEGA_TM_HISTORY_REPORT names a JSON file this module writes: the base's version, the hashes of the
reader and of migration 139, then for each case the requests and answers in order, the state after
each read and every check with its expected and actual value."""
from datetime import datetime, time as clock_time, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from vega import transfermarkt as tm

try:
    import psycopg
except ImportError:
    psycopg = None

DSN = os.environ.get("VEGA_V2_SOURCES_TEST_DSN")
REPORT = os.environ.get("VEGA_TM_HISTORY_REPORT")
MIGRATION = ROOT / "sql" / "139_transfermarkt_history.sql"
NODE = shutil.which("node")
HTTP_READY = bool(NODE) and (ROOT / "api" / "node_modules" / "pg").is_dir()
CASES, ENVIRONMENT = [], {}


def tearDownModule():
    if not REPORT or not CASES:
        return
    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    try:
        head = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10).stdout.strip()
        changed = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "--", "vega/transfermarkt.py", "sql", "tests", "api/test"],
                                 capture_output=True, text=True, timeout=10).stdout.splitlines()
    except (OSError, subprocess.SubprocessError):
        head, changed = None, None
    Path(REPORT).write_text(json.dumps({
        "at": datetime.now(timezone.utc), **ENVIRONMENT, "head": head, "uncommitted": changed,
        "reader_sha256": sha(ROOT / "vega" / "transfermarkt.py"), "migration_139_sha256": sha(MIGRATION),
        "http_route": "read API /api/players/{id} through tests/profile_http.mjs" if HTTP_READY else "unavailable (node or backend/api/node_modules missing)",
        "cases": CASES}, default=str, indent=1, ensure_ascii=False) + "\n")


class Provider:
    """The provider's API as the reader calls it: an answer per path (status, data), the player
    records /players gives by key, and every request with what was answered."""

    def __init__(self):
        self.answers, self.records, self.log = {}, {}, []

    def answer(self, path, status=200, data=None):
        self.answers[path] = (status, data)

    def __call__(self, path, params=()):
        if path == "/players":
            status, data = 200, [self.records[v] for _, v in params if v in self.records]
        else:
            status, data = self.answers.get(path, (404, None))
        self.log.append({"path": path, "params": [list(p) for p in params], "status": status, "data": data})
        return status, {}, (json.dumps({"success": True, "data": data}, default=str).encode() if status == 200 else b"")


def move(key, day, origin, target, *, kind="STANDARD", fee=None, free=False, value=None, until=None, season=None, pending=None):
    """A move as /transfer/history/player/{key} lists it."""
    details = {"date": f"{day.isoformat()}T00:00:00+01:00" if day else None}
    if season is not None:
        details["season"] = {"display": season}
    if free:
        details["fee"] = {"value": 0, "currency": "EUR", "compact": {"content": "free transfer"}}
    elif fee is not None:
        details["fee"] = {"value": fee, "currency": "EUR"}
    if value is not None:
        details["marketValue"] = {"value": value, "currency": "EUR"}
    if until is not None:
        details["contractUntilDate"] = f"{until.isoformat()}T00:00:00+02:00"
    if pending is not None:
        details["isPending"] = pending
    return {"id": key, "transferSource": {"clubId": origin}, "transferDestination": {"clubId": target},
            "typeDetails": {"type": kind}, "details": details}


def history(*terminated, pending=()):
    return {"history": {"terminated": list(terminated), "pending": list(pending)}}


def record(key, club, joined, until, *, attributes=True, assignments=True, value=None):
    """A player record of /players (a profile read or a search's squad member)."""
    r = {"id": int(key), "name": f"Joueur {key}", "lifeDates": {"dateOfBirth": "1997-01-01"}}
    if attributes:
        r["attributes"] = {"position": {"name": "Centre-Forward"}, "contractUntil": until.isoformat() if until else None}
    if assignments:
        r["clubAssignments"] = [{"type": "current", "clubId": int(club), "start": joined.isoformat() if joined else None}] if club else []
    if value:
        r["marketValueDetails"] = {"current": {"value": value, "currency": "EUR", "determined": "2026-10-01"}}
    return r


class Base(unittest.TestCase):
    """A fresh schema per class: every migration, our clubs 11, 22 and 33 linked to the provider's
    keys 11, 22 and 33, and the provider's club 9999 that is not ours."""

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
        ENVIRONMENT.setdefault("postgres", x("SELECT version()").fetchone()[0])
        cls.T = x("SELECT current_date").fetchone()[0]
        ENVIRONMENT.setdefault("base_date", cls.T)
        x("INSERT INTO core.countries(code) VALUES ('FRA')")
        for team, name in ((11, "Club Onze"), (22, "Club Vingt-Deux"), (33, "Club Trente-Trois"), (55, "Club Cherché"), (77, "Club Soixante-Dix-Sept")):
            x("INSERT INTO core.teams(id, name, country_code) VALUES (%s, %s, 'FRA')", (team, name))
        for team in (11, 22, 33):
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'transfermarkt', %s, %s)", (str(team), team))
        x("INSERT INTO core.provider_clubs(provider, provider_key, name, read_on) VALUES ('transfermarkt', '9999', 'Club Extérieur', current_date)")
        cls.columns = {r[0] for r in x("""SELECT table_name || '.' || column_name FROM information_schema.columns
                                           WHERE table_schema = 'core' AND table_name IN ('player_transfers', 'player_contracts')""")}

    @classmethod
    def tearDownClass(cls):
        cls.db.execute("DROP SCHEMA IF EXISTS api,ops,agg,core CASCADE")
        cls.db.close()

    def setUp(self):
        self.api, self.shift = Provider(), 0
        self.reader = self.make_reader(self.db)
        self.entry = {"case": None, "test": self.id().rsplit(".", 1)[-1], "requests": self.api.log, "states": [], "checks": []}
        CASES.append(self.entry)

    def make_reader(self, conn, cls=tm.Reader):
        return cls(conn, self.api, interval=0, jitter=0, sleep=lambda _: None, log=lambda *a, **k: None,
                   clock=lambda: datetime.combine(self.T + timedelta(days=self.shift), clock_time(12), tzinfo=timezone.utc))

    def d(self, days):
        return self.T + timedelta(days=days)

    def db_clock(self):
        """The base's clock. The reader schedules with SQL now(), so a due time is compared with
        it, not with this machine's clock (a container's clock may run some milliseconds ahead)."""
        return self.db.execute("SELECT clock_timestamp()").fetchone()[0]

    def case(self, ident, note):
        self.entry.update(case=ident, note=note)

    # The base --------------------------------------------------------------------

    def player(self, pid, *, linked=True):
        key = str(pid)
        x = self.db.execute
        x("INSERT INTO core.players(id, name, birth_date) VALUES (%s, %s, '1997-01-01')", (pid, f"Joueur {pid}"))
        if linked:
            x("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('player', 'transfermarkt', %s, %s)", (key, pid))
        for kind in ("profile", "transfers", "values"):
            x("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES (%s, %s, 1, now() + interval '1 day')", (kind, key))
        return key

    def transfers(self, pid):
        extra = ", absent_since" if "player_transfers.absent_since" in self.columns else ""
        rows = self.db.execute(
            f"""SELECT id, source::text, source_key, transfer_date, from_provider_club, from_team_id, to_provider_club, to_team_id,
                       kind::text, fee_eur, market_value_eur, contract_until, season_label, pending, as_of{extra}
                FROM core.player_transfers WHERE player_id = %s ORDER BY source, source_key NULLS FIRST, id""", (pid,))
        names = [c.name for c in rows.description]
        return [dict(zip(names, r)) for r in rows.fetchall()]

    def tm_keys(self, pid):
        return sorted(r["source_key"] for r in self.transfers(pid) if r["source"] == "transfermarkt" and r["source_key"])

    def ids(self, pid):
        return {r["source_key"]: r["id"] for r in self.transfers(pid) if r["source"] == "transfermarkt"}

    def facts(self, pid):
        """A player's Transfermarkt moves by key: what the provider stated, without the day of the read."""
        keep = ("id", "transfer_date", "from_provider_club", "from_team_id", "to_provider_club", "to_team_id", "kind", "fee_eur",
                "market_value_eur", "contract_until", "season_label", "pending")
        return {r["source_key"]: {k: r[k] for k in keep} for r in self.transfers(pid) if r["source"] == "transfermarkt"}

    def absent(self, pid):
        if "player_transfers.absent_since" not in self.columns:
            return "no absent_since column"
        return {r["source_key"]: r["absent_since"] for r in self.transfers(pid) if r["source"] == "transfermarkt"}

    def contracts(self, pid):
        extra = ", superseded_on" if "player_contracts.superseded_on" in self.columns else ""
        rows = self.db.execute(f"""SELECT team_id, start_date, end_date, source::text, as_of{extra} FROM core.player_contracts
                                   WHERE player_id = %s ORDER BY start_date, team_id""", (pid,))
        names = [c.name for c in rows.description]
        return [dict(zip(names, r)) for r in rows.fetchall()]

    def spells(self, pid):
        """(club, start) -> end of the player's Transfermarkt contracts."""
        return {(r["team_id"], r["start_date"]): r["end_date"] for r in self.contracts(pid) if r["source"] == "transfermarkt"}

    def superseded(self, pid):
        if "player_contracts.superseded_on" not in self.columns:
            return "no superseded_on column"
        return {(r["team_id"], r["start_date"]): r["superseded_on"] for r in self.contracts(pid) if r["source"] == "transfermarkt"}

    def queue(self, kind, key):
        row = self.db.execute("""SELECT last_http_status, error_code, attempts, rows_written, read_at, next_due_at FROM ops.transfermarkt_reads
                                 WHERE kind = %s AND provider_key = %s""", (kind, key)).fetchone()
        return dict(zip(("status", "code", "attempts", "rows", "read_at", "next_due_at"), row)) if row else None

    def public(self, pid):
        row = self.db.execute("""SELECT contract_until, contract_team, observed_contract_until, observed_contract_team
                                 FROM api.player_profiles WHERE player_id = %s""", (pid,)).fetchone()
        return dict(zip(("contract_until", "contract_team", "observed_contract_until", "observed_contract_team"), row)) if row else None

    def snapshot(self, label, pid, key, outcome):
        self.entry["states"].append({"after": label, "outcome": outcome, "transfers": self.transfers(pid), "contracts": self.contracts(pid),
                                     "queue": {k: self.queue(k, key) for k in ("profile", "transfers", "values")}, "public": self.public(pid)})

    # Reads ---------------------------------------------------------------------------

    def read(self, label, pid, kind="transfers", status=200, data=None, *, key=None, reader=None):
        """One unit read by the reader as the queue would give it; the outcome and the state after
        it go to the report. An exception is recorded, then raised."""
        key = key or str(pid)
        if kind == "transfers":
            self.api.answer(f"/transfer/history/player/{key}", status, data)
        try:
            outcome = (reader or self.reader).read(kind, [(key, 1)])
        except Exception as error:
            self.snapshot(label, pid, key, f"exception {type(error).__name__}: {error}")
            raise
        self.snapshot(label, pid, key, outcome)
        return outcome

    def profile(self, label, pid, club, joined, until, **shape):
        self.api.records[str(pid)] = record(pid, club, joined, until, **shape)
        return self.read(label, pid, "profile")

    def expect(self, label, actual, expected):
        def plain(value):  # a (club, start) key written as a JSON object key
            if isinstance(value, dict):
                return {k if isinstance(k, str) else " ".join(map(str, k)) if isinstance(k, tuple) else str(k): plain(v) for k, v in value.items()}
            return [plain(v) for v in value] if isinstance(value, (list, tuple, set)) else value

        ok = actual == expected
        self.entry["checks"].append({"check": label, "expected": plain(expected), "actual": plain(actual), "ok": ok})
        with self.subTest(check=label):
            self.assertEqual(actual, expected)


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class TransferHistoryTest(Base):
    """A transfers response is checked whole; a listed move updates its own row; a missing one
    keeps its facts (§20.2)."""

    def accepted(self, pid):
        """A player with three completed moves read once, beside another source's transfer and a
        Transfermarkt row without key: the accepted history every refusal starts from."""
        key = self.player(pid)
        self.db.execute("INSERT INTO core.player_transfers(player_id, transfer_date, source, as_of) VALUES (%s, %s, 'other', %s)", (pid, self.d(-4000), self.d(-4000)))
        self.db.execute("INSERT INTO core.player_transfers(player_id, transfer_date, source, as_of) VALUES (%s, %s, 'transfermarkt', %s)", (pid, self.d(-3900), self.d(-3900)))
        self.seeded = self.transfers(pid)
        self.full = history(move(81, self.d(-3000), 33, 11, fee=2500000, season="18/19"), move(82, self.d(-1500), 11, 22, free=True, until=self.d(400)),
                            move(83, self.d(-700), 22, 9999, kind="ACTIVE_LOAN_TRANSFER", value=1500000))
        self.read("accepted", pid, data=self.full)
        self.before = {"rows": self.transfers(pid), "facts": self.facts(pid), "queue": self.queue("transfers", key)}
        return key

    def refused(self, label, pid, key, status, data, code):
        self.read(label, pid, status=status, data=data)
        after = self.queue("transfers", key)
        self.expect(f"{label}: every row unchanged (ids, keys, facts, as_of, other sources)", self.transfers(pid), self.before["rows"])
        self.expect(f"{label}: queue keeps the true status and a code", (after["status"], after["code"], after["attempts"]), (status, code, 1))
        self.expect(f"{label}: last accepted read and its count kept", (after["read_at"], after["rows"]), (self.before["queue"]["read_at"], self.before["queue"]["rows"]))
        self.expect(f"{label}: next try after a bounded wait", timedelta(minutes=50) < after["next_due_at"] - self.db_clock() <= timedelta(hours=1, minutes=5), True)
        # The same history again: the same moves, the same row ids.
        self.read(f"{label} then the history again", pid, data=self.full)
        again = self.queue("transfers", key)
        self.expect(f"{label}: recovery keeps row ids and facts", self.facts(pid), self.before["facts"])
        self.expect(f"{label}: recovery clears the code", (again["status"], again["code"], again["attempts"], again["rows"]), (200, None, 0, 3))

    def test_20a_a_first_404_is_an_ordinary_outcome(self):
        self.case("20a", "404 on a first read")
        key = self.player(1001)
        self.read("404", 1001, status=404)
        q = self.queue("transfers", key)
        self.expect("no fact", self.transfers(1001), [])
        self.expect("queue: 404, no code, no attempt, 0 rows", (q["status"], q["code"], q["attempts"], q["rows"]), (404, None, 0, 0))
        self.expect("read and due again after the normal period (30 days)", (q["read_at"] is not None, q["next_due_at"] - q["read_at"]), (True, timedelta(days=30)))

    def test_20b_a_404_after_a_history_keeps_it(self):
        self.case("20b", "404 after an accepted history")
        key = self.accepted(1002)
        self.refused("404", 1002, key, 404, None, "HISTORY_MISSING")

    def test_20c_a_response_without_history_keeps_it(self):
        self.case("20c", "200 without history, data null, history null, no list")
        key = self.accepted(1003)
        for n, data in enumerate(({}, None, {"history": None}, {"history": {}}, {"history": {"terminated": None, "pending": None}})):
            self.db.execute("UPDATE ops.transfermarkt_reads SET attempts = 0 WHERE kind = 'transfers' AND provider_key = %s", (key,))
            self.refused(f"envelope {n} {json.dumps(data)}", 1003, key, 200, data, "HISTORY_MISSING")

    def test_20c_an_invalid_envelope_is_refused_on_a_first_read(self):
        self.case("20c", "200 without history on a first read")
        key = self.player(1004)
        self.read("no history", 1004, data={})
        q = self.queue("transfers", key)
        self.expect("no fact", self.transfers(1004), [])
        self.expect("refused, never read", (q["status"], q["code"], q["attempts"], q["read_at"]), (200, "HISTORY_MISSING", 1, None))

    def test_20d_empty_lists_after_a_completed_move_keep_it(self):
        self.case("20d", "200 with both lists empty after a completed move")
        key = self.accepted(1005)
        self.refused("empty", 1005, key, 200, history(), "HISTORY_EMPTY")

    def test_20e_an_empty_first_history_is_accepted(self):
        self.case("20e", "200 with both lists empty on a first read")
        key = self.player(1006)
        self.read("empty", 1006, data=history())
        q = self.queue("transfers", key)
        self.expect("no fact", self.transfers(1006), [])
        self.expect("accepted", (q["status"], q["code"], q["attempts"], q["rows"], q["read_at"] is not None), (200, None, 0, 0, True))

    def test_20f_withdrawn_announcements_are_marked_absent_not_removed(self):
        self.case("20f", "empty lists when only announcements are known; then the move completed")
        key = self.player(1007)
        announced = move(90, self.d(40), 11, 22, pending=True)
        self.read("announced", 1007, data=history(pending=[announced]))
        first = self.ids(1007)
        self.read("empty", 1007, data=history())
        q = self.queue("transfers", key)
        self.expect("the announcement kept", self.ids(1007), first)
        self.expect("absent since today", self.absent(1007), {"90": self.T})
        self.expect("accepted, no code", (q["status"], q["code"], q["rows"]), (200, None, 0))
        self.read("announced again", 1007, data=history(pending=[announced]))
        self.expect("listed again: absent_since cleared, same id", (self.absent(1007), self.ids(1007)), ({"90": None}, first))
        self.read("completed", 1007, data=history(move(90, self.d(-1), 11, 22)))
        f = self.facts(1007)["90"]
        self.expect("completed in place", (f["id"], f["pending"], f["transfer_date"]), (first["90"], False, self.d(-1)))

    def test_20g_lists_of_another_type_are_refused_without_an_exception(self):
        self.case("20g", "terminated an object, a string; history a list")
        key = self.accepted(1008)
        for n, data in enumerate(({"history": {"terminated": {"81": {}}, "pending": []}}, {"history": {"terminated": "81", "pending": []}}, {"history": [1]})):
            self.db.execute("UPDATE ops.transfermarkt_reads SET attempts = 0 WHERE kind = 'transfers' AND provider_key = %s", (key,))
            self.refused(f"type {n}", 1008, key, 200, data, "SCHEMA_CHANGED")

    def test_20h_an_unusable_element_writes_nothing(self):
        self.case("20h", "an element not an object; an id empty or not numeric")
        key = self.accepted(1009)
        valid = self.full["history"]["terminated"]
        for n, bad in enumerate(("81", {**valid[0], "id": None}, {**valid[0], "id": ""}, {**valid[0], "id": "8x1"})):
            self.db.execute("UPDATE ops.transfermarkt_reads SET attempts = 0 WHERE kind = 'transfers' AND provider_key = %s", (key,))
            self.refused(f"element {n}", 1009, key, 200, history(*valid[1:], bad), "HISTORY_INVALID")

    def test_20i_a_conflicting_duplicate_writes_nothing(self):
        self.case("20i", "one id twice with another date; the same record twice")
        key = self.accepted(1010)
        valid = self.full["history"]["terminated"]
        self.refused("conflict", 1010, key, 200, history(*valid, move(81, self.d(-2999), 33, 11)), "HISTORY_CONFLICT")
        self.read("identical duplicate", 1010, data=history(*valid, valid[0]))
        self.expect("the same record twice is one move", (self.tm_keys(1010), self.facts(1010)), (["81", "82", "83"], self.before["facts"]))

    def test_20j_a_partial_history_keeps_the_missing_move(self):
        self.case("20j", "a valid history without one completed move, twice, then with it again")
        key = self.accepted(1011)
        rest = history(*self.full["history"]["terminated"][1:])
        self.read("without 81", 1011, data=rest)
        self.expect("every move kept with its facts", self.facts(1011), self.before["facts"])
        self.expect("81 absent since today; the keyless row never marked", self.absent(1011), {None: None, "81": self.T, "82": None, "83": None})
        self.expect("accepted: rows listed", self.queue("transfers", key)["rows"], 2)
        self.shift = 1
        self.read("without 81, next day", 1011, data=rest)
        self.expect("the first day of absence kept", self.absent(1011), {None: None, "81": self.T, "82": None, "83": None})
        self.read("with 81 again", 1011, data=self.full)
        self.expect("listed again: same ids, absence cleared", (self.facts(1011), self.absent(1011)),
                    (self.before["facts"], {None: None, "81": None, "82": None, "83": None}))

    def test_20k_the_same_history_twice_changes_nothing(self):
        self.case("20k", "the same history twice")
        self.accepted(1012)
        self.read("again", 1012, data=self.full)
        self.expect("same rows, ids and facts", self.facts(1012), self.before["facts"])
        self.expect("no new row", len(self.transfers(1012)), len(self.before["rows"]))

    def test_20l_stated_fields_correct_in_place_and_omitted_ones_stay(self):
        self.case("20l", "corrections, a free transfer, a kind change, omitted and null fields")
        key = self.player(1013)
        self.read("first", 1013, data=history(move(81, self.d(-900), 11, 22, fee=5000000, value=1000000, until=self.d(300), season="23/24")))
        first = self.facts(1013)["81"]
        corrected = move(81, self.d(-901), 11, 22)  # the date corrected; fee, value, expiry and season omitted
        corrected["details"]["marketValue"] = None  # value given as null
        self.read("date corrected", 1013, data=history(corrected))
        f = self.facts(1013)["81"]
        self.expect("date replaced, omitted and null fields kept, same id",
                    (f["id"], f["transfer_date"], f["fee_eur"], f["market_value_eur"], f["contract_until"], f["season_label"], f["kind"]),
                    (first["id"], self.d(-901), 5000000, 1000000, self.d(300), "23/24", "transfer"))
        self.read("free transfer", 1013, data=history(move(81, self.d(-901), 11, 22, free=True)))
        f = self.facts(1013)["81"]
        self.expect("a free transfer states a fee of 0", (f["id"], f["kind"], f["fee_eur"]), (first["id"], "free", 0))
        self.read("loan without fee", 1013, data=history(move(81, self.d(-901), 11, 22, kind="ACTIVE_LOAN_TRANSFER")))
        f = self.facts(1013)["81"]
        self.expect("another kind without fee clears the old fee", (f["kind"], f["fee_eur"]), ("loan", None))
        self.read("loan fee", 1013, data=history(move(81, self.d(-901), 11, 22, kind="ACTIVE_LOAN_TRANSFER", fee=2000000)))
        self.read("zero without label", 1013, data=history(move(81, self.d(-901), 11, 22, kind="ACTIVE_LOAN_TRANSFER", fee=0)))
        f = self.facts(1013)["81"]
        self.expect("a 0 without the free label is no amount", (f["id"], f["kind"], f["fee_eur"]), (first["id"], "loan", 2000000))
        self.expect("one row", self.tm_keys(1013), ["81"])

    def test_20m_a_changed_club_key_never_keeps_the_old_canonical_club(self):
        self.case("20m", "club keys changed; a club linked between two reads")
        key = self.player(1014)
        self.read("first", 1014, data=history(move(81, self.d(-900), 11, 22), move(82, self.d(-300), 22, 7777)))
        first = self.ids(1014)
        self.read("destination not ours", 1014, data=history(move(81, self.d(-900), 11, 9999), move(82, self.d(-300), 22, 7777)))
        f = self.facts(1014)["81"]
        self.expect("new key, no canonical club", (f["id"], f["to_provider_club"], f["to_team_id"]), (first["81"], "9999", None))
        self.read("destination ours", 1014, data=history(move(81, self.d(-900), 11, 33), move(82, self.d(-300), 22, 7777)))
        f = self.facts(1014)["81"]
        self.expect("new key, its canonical club", (f["to_provider_club"], f["to_team_id"]), ("33", 33))
        # Club 7777 linked to our team 77 between two reads, its moves attached (as link_clubs does).
        self.db.execute("INSERT INTO core.provider_ids(entity_type, provider, provider_key, entity_id) VALUES ('team', 'transfermarkt', '7777', 77)")
        self.reader.attach_teams()
        self.read("re-read after the link", 1014, data=history(move(81, self.d(-900), 11, 33), move(82, self.d(-300), 22, 7777)))
        self.expect("the re-resolved club kept", self.facts(1014)["82"]["to_team_id"], 77)
        self.db.execute("UPDATE core.provider_ids SET is_current = false WHERE entity_type = 'team' AND provider_key = '7777'")
        self.read("re-read after the link is gone", 1014, data=history(move(81, self.d(-900), 11, 33), move(82, self.d(-300), 22, 7777)))
        self.expect("the same key keeps the club stored", (self.facts(1014)["82"]["to_team_id"], self.ids(1014)), (77, first))

    def test_20n_a_completed_move_never_becomes_announced_again(self):
        self.case("20n", "announced, completed, then announced in a later response")
        self.player(1015)
        self.read("announced", 1015, data=history(pending=[move(91, self.d(30), 11, 22, pending=True, fee=9000000)]))
        first = self.ids(1015)
        self.read("completed", 1015, data=history(move(91, self.d(-2), 11, 22, fee=8000000)))
        done = self.facts(1015)["91"]
        self.expect("completed in place", (done["id"], done["pending"], done["transfer_date"], done["fee_eur"]), (first["91"], False, self.d(-2), 8000000))
        self.read("announced again", 1015, data=history(pending=[move(91, self.d(30), 11, 22, pending=True, fee=9000000)]))
        self.expect("the completed facts kept", self.facts(1015)["91"], done)

    def test_20o_other_sources_and_keyless_rows_are_never_touched(self):
        self.case("20o", "another source's transfer and a keyless Transfermarkt row through every read")
        self.accepted(1016)
        kept = [r for r in self.seeded if r["source_key"] is None]
        self.expect("accepted: keyless rows unchanged", [r for r in self.transfers(1016) if r["source_key"] is None], kept)
        for label, status, data in (("404", 404, None), ("empty", 200, history()), ("partial", 200, history(self.full["history"]["terminated"][0])), ("again", 200, self.full)):
            self.read(label, 1016, status=status, data=data)
            self.expect(f"{label}: keyless rows unchanged", [r for r in self.transfers(1016) if r["source_key"] is None], kept)

    def test_20p_two_readers_at_once_keep_one_row_per_key(self):
        self.case("20p", "two readers on one player at once")
        from vega.store import connect_local

        key = self.player(1017)
        waiting, release = threading.Event(), threading.Event()

        class Holding(tm.Reader):
            def done(self, *args, **kwargs):
                # Reader A holds its transaction open after its writes, before its queue row.
                waiting.set()
                release.wait(10)
                return super().done(*args, **kwargs)

        first, second = history(move(81, self.d(-900), 11, 22), move(82, self.d(-300), 22, 33)), history(move(81, self.d(-899), 11, 22), move(82, self.d(-300), 22, 33))
        a_conn, b_conn = connect_local(DSN), connect_local(DSN)
        try:
            a_api, b_api = Provider(), Provider()
            a_api.answer(f"/transfer/history/player/{key}", 200, first)
            b_api.answer(f"/transfer/history/player/{key}", 200, second)
            a = Holding(a_conn, a_api, interval=0, jitter=0, sleep=lambda _: None, log=lambda *a, **k: None)
            b = tm.Reader(b_conn, b_api, interval=0, jitter=0, sleep=lambda _: None, log=lambda *a, **k: None)
            results = {}
            ta = threading.Thread(target=lambda: results.setdefault("a", a.read("transfers", [(key, 1)])))
            ta.start()
            self.assertTrue(waiting.wait(10), "reader A never reached its queue row")
            tb = threading.Thread(target=lambda: results.setdefault("b", b.read("transfers", [(key, 1)])))
            tb.start()
            tb.join(1.5)
            b_waited = tb.is_alive()
            release.set()
            ta.join(15)
            tb.join(15)
            self.api.log.extend(a_api.log + b_api.log)
            self.snapshot("both readers done", 1017, key, results)
            self.expect("reader B waited for reader A", b_waited, True)
            self.expect("one row per key", self.tm_keys(1017), ["81", "82"])
            self.expect("the second reader's facts on the first's row", self.facts(1017)["81"]["transfer_date"], self.d(-899))
        finally:
            release.set()
            a_conn.close()
            b_conn.close()

    def test_20q_a_unit_failing_for_the_41st_time_waits_a_week(self):
        self.case("20q", "a unit at 40 attempts fails again")
        key = self.player(1018)
        self.db.execute("UPDATE ops.transfermarkt_reads SET attempts = 40 WHERE kind = 'transfers' AND provider_key = %s", (key,))
        self.read("HTTP 500", 1018, status=500)
        q = self.queue("transfers", key)
        wait = q["next_due_at"] - self.db_clock()
        self.expect("attempts 41, HTTP 500", (q["attempts"], q["status"], q["code"]), (41, 500, "HTTP_500"))
        self.expect("due again in 7 days", timedelta(days=6, hours=23) < wait <= timedelta(days=7), True)


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class ReaderHealthTest(Base):
    """The reader's normal entry (step), as the worker's process runs it."""

    def test_20r_one_players_refusal_lets_the_reader_read_on(self):
        self.case("20r", "normal entry: one player's history refused, another's valid")
        x = self.db.execute
        refused, valid = self.player(1101), self.player(1102)
        x("UPDATE ops.transfermarkt_state SET planned_at = now() WHERE id = 1")  # planned: step reads
        x("UPDATE ops.transfermarkt_reads SET next_due_at = now() + interval '1 day'")
        self.read("accepted", 1101, data=history(move(81, self.d(-900), 11, 22)))
        known = self.facts(1101)
        x("UPDATE ops.transfermarkt_reads SET next_due_at = now() - interval '2 minutes' WHERE kind = 'transfers' AND provider_key = %s", (refused,))
        x("UPDATE ops.transfermarkt_reads SET next_due_at = now() - interval '1 minute' WHERE kind = 'transfers' AND provider_key = %s", (valid,))
        self.api.answer(f"/transfer/history/player/{refused}", 404)
        self.api.answer(f"/transfer/history/player/{valid}", 200, history(move(85, self.d(-100), 22, 33)))
        reader = tm.Reader(self.db, self.api, interval=0, jitter=0, sleep=lambda _: None, log=lambda *a, **k: None)
        outcomes = []
        for _ in range(5):
            try:
                outcomes.append(reader.step())
            except Exception as error:
                outcomes.append(f"exception {type(error).__name__}: {error}")
                break
            if outcomes[-1] == "idle":
                break
        state = x("SELECT paused_until, gave_up_at, blocks_in_row FROM ops.transfermarkt_state").fetchone()
        progress = x("SELECT units, due, failing FROM api.provider_reader_progress WHERE kind = 'transfers'").fetchone()
        self.snapshot("steps", 1101, refused, outcomes)
        self.entry["states"].append({"after": "steps", "state": state, "progress": progress, "valid": self.facts(1102)})
        self.expect("outcomes", outcomes, ["failed", "ok", "idle"])
        self.expect("the reader is not paused", state, (None, None, 0))
        self.expect("the refused history kept", self.facts(1101), known)
        self.expect("the valid one written", self.tm_keys(1102), ["85"])
        self.expect("progress: two units, none due, one failing", progress, (2, 0, 1))
        self.expect("the refused unit's queue row", (self.queue("transfers", refused)["status"], self.queue("transfers", refused)["code"]), (404, "HISTORY_MISSING"))


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class ContractTest(Base):
    """A contract is a dated fact; the current one is a dated choice (§20.2)."""

    def test_20s_20t_20v_20aa_20ab_moves_renewals_and_a_collision_keep_every_spell(self):
        self.case("20s 20t 20v 20aa 20ab", "a past spell, a move, the same profile twice, an expiry corrected, a renewal, another source's key")
        pid = 1201
        self.player(pid)
        self.profile("past", pid, 11, self.d(-2000), self.d(-1000))
        past = self.spells(pid)
        self.profile("move", pid, 22, self.d(-700), self.d(400))
        self.expect("move: the past spell kept", set(past) <= set(self.spells(pid)), True)
        self.expect("move: profile shows the new club", self.public(pid)["contract_team"], "Club Vingt-Deux")
        self.expect("move: the past spell superseded from the move", self.superseded(pid), {(11, self.d(-2000)): self.d(-700), (22, self.d(-700)): None})
        rows = len(self.contracts(pid))
        self.profile("same profile", pid, 22, self.d(-700), self.d(400))
        self.expect("same profile: no new row", len(self.contracts(pid)), rows)
        self.profile("expiry corrected", pid, 22, self.d(-700), self.d(500))
        self.expect("expiry corrected in place", self.spells(pid)[(22, self.d(-700))], self.d(500))
        self.expect("expiry corrected: published", self.public(pid)["contract_until"], self.d(500).isoformat())
        self.profile("renewal", pid, 22, self.d(-100), self.d(1200))
        self.expect("renewal: every spell kept, end dates as observed", self.spells(pid),
                    {(11, self.d(-2000)): self.d(-1000), (22, self.d(-700)): self.d(500), (22, self.d(-100)): self.d(1200)})
        self.expect("renewal: the old spell superseded from the renewal", self.superseded(pid).get((22, self.d(-700))) if isinstance(self.superseded(pid), dict) else self.superseded(pid), self.d(-100))
        self.expect("renewal: profile shows the new expiry", (self.public(pid)["contract_team"], self.public(pid)["contract_until"]), ("Club Vingt-Deux", self.d(1200).isoformat()))
        self.db.execute("""INSERT INTO core.player_contracts(player_id, team_id, start_date, end_date, source, as_of, source_url)
                           VALUES (%s, 33, %s, %s, 'other', %s, 'https://club.example/contract')""", (pid, self.d(-30), self.d(900), self.d(-30)))
        before = self.spells(pid)
        self.profile("another source's key", pid, 33, self.d(-30), self.d(1000))
        other = [c for c in self.contracts(pid) if c["source"] == "other"]
        self.expect("collision: the other source's row unchanged", [(c["team_id"], c["start_date"], c["end_date"], c["as_of"]) for c in other],
                    [(33, self.d(-30), self.d(900), self.d(-30))])
        self.expect("collision: every Transfermarkt spell kept", self.spells(pid), before)
        self.expect("collision: the renewal superseded from the move", self.superseded(pid).get((22, self.d(-100))) if isinstance(self.superseded(pid), dict) else self.superseded(pid), self.d(-30))
        self.expect("collision: the club's expiry confirmed, the provider's observed beside it", self.public(pid),
                    {"contract_until": self.d(900).isoformat(), "contract_team": "Club Trente-Trois",
                     "observed_contract_until": self.d(1000).isoformat(), "observed_contract_team": "Club Trente-Trois"})

    def test_20u_a_future_start_keeps_todays_contract(self):
        self.case("20u", "a move starting tomorrow; the same move started yesterday")
        for pid, start in ((1202, 1), (1203, -1)):
            self.player(pid)
            self.profile("current", pid, 11, self.d(-500), self.d(300))
            self.profile(f"move starting {start:+d}", pid, 22, self.d(start), self.d(1000))
            self.expect(f"{pid}: both spells kept", sorted(self.spells(pid)), [(11, self.d(-500)), (22, self.d(start))])
        self.expect("before the start: today's contract confirmed", (self.public(1202)["contract_team"], self.public(1202)["contract_until"]), ("Club Onze", self.d(300).isoformat()))
        self.expect("after the start: the new contract", (self.public(1203)["contract_team"], self.public(1203)["contract_until"]), ("Club Vingt-Deux", self.d(1000).isoformat()))

    def test_20w_a_move_to_a_club_not_ours_sets_the_old_claim_aside(self):
        self.case("20w", "a move to the provider's club 9999, not ours")
        pid = 1204
        self.player(pid)
        self.profile("current", pid, 11, self.d(-500), self.d(300))
        self.profile("move abroad", pid, 9999, self.d(-10), self.d(700))
        self.expect("no row for the club not ours; the old spell kept", self.spells(pid), {(11, self.d(-500)): self.d(300)})
        self.expect("the old spell superseded from the move", self.superseded(pid), {(11, self.d(-500)): self.d(-10)})
        self.expect("no confirmed contract; the observed one of that club", self.public(pid),
                    {"contract_until": None, "contract_team": None, "observed_contract_until": self.d(700).isoformat(), "observed_contract_team": "Club Extérieur"})

    def test_20x_a_profile_without_key_dates_or_blocks_changes_no_contract(self):
        self.case("20x", "no club, no start, expiry before start, a record without its blocks")
        pid = 1205
        self.player(pid)
        self.profile("current", pid, 11, self.d(-500), self.d(300))
        kept = self.contracts(pid)
        for label, club, joined, until, shape in (("no club", None, self.d(-5), self.d(800), {}), ("no start", 22, None, self.d(800), {}),
                                                  ("expiry before start", 22, self.d(-5), self.d(-6), {}),
                                                  ("no attributes", 22, self.d(-5), self.d(800), {"attributes": False}),
                                                  ("no club assignments", 22, self.d(-5), self.d(800), {"assignments": False})):
            self.profile(label, pid, club, joined, until, **shape)
            self.expect(f"{label}: contracts unchanged", self.contracts(pid), kept)
        self.expect("still confirmed", self.public(pid)["contract_team"], "Club Onze")

    def test_20y_an_older_profile_with_a_past_or_missing_expiry_supersedes_nothing(self):
        self.case("20y", "a stale profile naming an older spell")
        pid = 1206
        self.player(pid)
        self.profile("past", pid, 11, self.d(-2000), self.d(-1000))
        self.profile("current", pid, 22, self.d(-700), self.d(400))
        self.profile("the past again", pid, 11, self.d(-2000), self.d(-1000))
        self.profile("the past without expiry", pid, 11, self.d(-2000), None)
        self.expect("every spell kept", sorted(self.spells(pid)), [(11, self.d(-2000)), (22, self.d(-700))])
        self.expect("the current spell not superseded", self.superseded(pid).get((22, self.d(-700)), "absent") if isinstance(self.superseded(pid), dict) else self.superseded(pid), None)
        self.expect("still confirmed", (self.public(pid)["contract_team"], self.public(pid)["contract_until"]), ("Club Vingt-Deux", self.d(400).isoformat()))

    def test_20z_back_from_a_loan_the_parent_spell_is_revived(self):
        self.case("20z", "a loan, then the parent club's superseded key again with a current expiry")
        pid = 1207
        self.player(pid)
        self.profile("parent", pid, 11, self.d(-1500), self.d(600))
        self.profile("loan", pid, 22, self.d(-200), self.d(100))
        self.expect("on loan: the loan confirmed", self.public(pid)["contract_team"], "Club Vingt-Deux")
        self.profile("back", pid, 11, self.d(-1500), self.d(600))
        self.expect("both spells kept, end dates as observed", self.spells(pid), {(11, self.d(-1500)): self.d(600), (22, self.d(-200)): self.d(100)})
        self.expect("parent revived, loan superseded from the read day", self.superseded(pid), {(11, self.d(-1500)): None, (22, self.d(-200)): self.T})
        self.expect("one confirmed contract: the parent's", (self.public(pid)["contract_team"], self.public(pid)["contract_until"]), ("Club Onze", self.d(600).isoformat()))

    def test_20ac_a_quarantine_after_publication_hides_the_contract(self):
        self.case("20ac", "the link quarantined after the contract; entity_id naming the player, then an older one")
        for pid, entity in ((1208, 1208), (1209, 99999)):
            key = self.player(pid)
            self.profile("current", pid, 11, self.d(-300), self.d(500))
            self.expect(f"{pid}: published before the doubt", self.public(pid)["contract_team"], "Club Onze")
            self.db.execute("""INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason)
                               VALUES ('player', 'transfermarkt', %s, %s, 'snapshot', now(), 'birth_date_differs')""", (key, entity))
            self.snapshot("quarantined", pid, key, None)
            self.expect(f"{pid}: nothing of the provider shown", self.public(pid),
                        {"contract_until": None, "contract_team": None, "observed_contract_until": None, "observed_contract_team": None})
            self.expect(f"{pid}: the contract kept", self.spells(pid), {(11, self.d(-300)): self.d(500)})

    def search(self, team, members):
        """Our club `team` searched: the provider finds its club 5555 whose squad lists `members`."""
        x = self.db.execute
        x("INSERT INTO core.seasons(id, label) VALUES (2026, '2026/2027') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.competitions(id, name, country_code, kind) VALUES (30, 'Ligue', 'FRA', 'league') ON CONFLICT DO NOTHING")
        x("INSERT INTO core.competition_seasons(id, competition_id, season_id, native_label) VALUES (30, 30, 2026, '2026/2027') ON CONFLICT DO NOTHING")
        x("SELECT core.ensure_season_partitions(2026)")
        x("""INSERT INTO core.matches(id, competition_season_id, season_id, source, status, home_team_id, away_team_id, kickoff_at, match_date)
             VALUES (%s, 30, 2026, 'pitchapi', 'finished', %s, 11, now() - interval '3 days', current_date - 3) ON CONFLICT DO NOTHING""", (9000 + team, team))
        x("INSERT INTO ops.transfermarkt_reads(kind, provider_key, priority, next_due_at) VALUES ('search', %s, 1, now()) ON CONFLICT DO NOTHING", (str(team),))
        self.api.answer("/quick-search", 200, {"result": {"clubIds": [5555]}})
        self.api.answer("/club/5555/squad", 200, {"squad": [{"playerId": int(k)} for k in members]})
        outcome = self.reader.read("search", [(str(team), 1)])
        return outcome

    def test_20ad_a_search_applies_the_contract_step_of_a_profile(self):
        self.case("20ad", "a club search reads a linked player whose club changed")
        pid = 1210
        key = self.player(pid)
        self.profile("current", pid, 11, self.d(-500), self.d(300))
        self.api.records[key] = record(pid, 22, self.d(-20), self.d(900))
        outcome = self.search(55, [key])
        self.snapshot("search", pid, key, outcome)
        self.expect("the new spell written, the old one kept", sorted(self.spells(pid)), [(11, self.d(-500)), (22, self.d(-20))])
        self.expect("profile shows the new club", self.public(pid)["contract_team"], "Club Vingt-Deux")
        q = self.queue("transfers", key)
        self.expect("transfers due now", q["next_due_at"] <= self.db_clock(), True)
        self.expect("provider row written after the comparison", self.db.execute(
            "SELECT provider_club, joined_on, contract_until FROM core.provider_players WHERE provider = 'transfermarkt' AND provider_key = %s", (key,)).fetchone(),
            ("22", self.d(-20), self.d(900)))

    def test_20ae_a_record_without_its_blocks_keeps_the_provider_row(self):
        self.case("20ae", "a record without its blocks, from a search and from a profile")
        for pid, path in ((1211, "search"), (1212, "profile")):
            key = self.player(pid)
            self.profile("current", pid, 11, self.d(-500), self.d(300))
            row = lambda: self.db.execute("SELECT provider_club, joined_on, contract_until FROM core.provider_players WHERE provider = 'transfermarkt' AND provider_key = %s", (key,)).fetchone()
            known, contracts = row(), self.contracts(pid)
            self.db.execute("UPDATE ops.transfermarkt_reads SET next_due_at = now() + interval '7 days' WHERE kind = 'profile' AND provider_key = %s", (key,))
            if path == "search":
                self.api.records[key] = record(pid, 22, self.d(-20), self.d(900), assignments=False)
                self.snapshot("search", pid, key, self.search(55, [key]))
                self.expect(f"{path}: the profile due now", self.queue("profile", key)["next_due_at"] <= self.db_clock(), True)
            else:
                self.profile("no attributes", pid, 22, self.d(-20), self.d(900), attributes=False)
            self.expect(f"{path}: provider row keeps its fields", row(), known)
            self.expect(f"{path}: no contract change", self.contracts(pid), contracts)

    def test_20af_an_unlinked_or_doubted_player_gets_no_contract(self):
        self.case("20af", "an unlinked squad member, a doubted player's profile")
        loose = self.player(1213, linked=False)
        doubted = self.player(1214)
        self.db.execute("""INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason)
                           VALUES ('player', 'transfermarkt', %s, 1214, 'snapshot', now(), 'birth_date_differs')""", (doubted,))
        self.api.records[loose] = record(1213, 22, self.d(-20), self.d(900))
        self.search(55, [loose])
        self.profile("doubted", 1214, 22, self.d(-20), self.d(900))
        self.expect("no contract for either", (self.contracts(1213), self.contracts(1214)), ([], []))
        self.expect("their provider rows written", self.db.execute(
            "SELECT count(*) FROM core.provider_players WHERE provider = 'transfermarkt' AND provider_key IN (%s, %s)", (loose, doubted)).fetchone()[0], 2)

    @unittest.skipUnless(HTTP_READY, "requires node and backend/api/node_modules (npm ci --prefix backend/api)")
    def test_20aj_missing_invalid_and_undated_club_changes_keep_dated_contracts(self):
        self.case("20aj", "omitted, malformed and explicitly null expiry during profile and search, confirmed by the HTTP profile")
        cases = ((1401, "profile", "omitted"), (1402, "profile", "malformed"), (1403, "search", "omitted"),
                 (1404, "search", "malformed"), (1405, "profile", "null"), (1406, "profile", "trailing junk"))
        public_ids = []
        expected = (self.d(300).isoformat(), "Club Onze", self.d(300).isoformat(), "Club Onze")
        for pid, source, expiry in cases:
            with self.subTest(source=source, expiry=expiry):
                self.shift = 0
                key = self.player(pid)
                self.profile("accepted dated claim", pid, 11, self.d(-500), self.d(300))
                expected_contracts = self.contracts(pid)
                staging = """SELECT provider_club,joined_on,contract_until,read_on FROM core.provider_players
                             WHERE provider='transfermarkt' AND provider_key=%s"""
                expected_staging = self.db.execute(staging, (key,)).fetchone()
                self.shift = 1
                candidate = record(pid, 22, self.d(-15), None)
                if expiry == "omitted":
                    del candidate["attributes"]["contractUntil"]
                elif expiry == "malformed":
                    candidate["attributes"]["contractUntil"] = "definitely-not-a-date"
                elif expiry == "trailing junk":
                    candidate["attributes"]["contractUntil"] = self.d(600).isoformat() + "not-a-timestamp"
                self.api.records[key] = candidate
                if source == "search":
                    self.snapshot(expiry, pid, key, self.search(55, [key]))
                    self.expect("normal profile now due", self.queue("profile", key)["next_due_at"] <= self.db_clock(), True)
                else:
                    self.read(expiry, pid, "profile")
                    queue = self.queue("profile", key)
                    error = None if expiry == "null" else "CONTRACT_MISSING" if expiry == "omitted" else "CONTRACT_INVALID"
                    self.expect("specific HTTP 200 outcome", (queue["status"], queue["code"]), (200, error))
                self.expect("prior staging and provenance unchanged", self.db.execute(staging, (key,)).fetchone(), expected_staging)
                self.expect("dated facts and supersession unchanged", self.contracts(pid), expected_contracts)
                self.expect("ordinary view keeps both claims", tuple(self.public(pid).values()), expected)
                public_ids.append(self.db.execute("SELECT api.public_id('player', %s)", (pid,)).fetchone()[0])

        out = subprocess.run([NODE, str(ROOT / "tests" / "profile_http.mjs"), DSN, *public_ids], capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stderr)
        http = json.loads(out.stdout)
        self.entry["states"].append({"after": "GET /api/players/{id}", "http": http})
        fields = ("contract_until", "contract_team", "observed_contract_until", "observed_contract_team")
        for public_id in public_ids:
            answer = http[public_id]
            self.expect("profile API forwards the entire previous observation",
                        (answer["status"], tuple(answer["data"].get(key) for key in fields)), (200, expected))

        first = self.player(1408)
        self.profile("explicit null on first observation", 1408, 22, self.d(-15), None)
        seen = self.db.execute("""SELECT provider_club,joined_on,contract_until FROM core.provider_players
                                 WHERE provider='transfermarkt' AND provider_key=%s""", (first,)).fetchone()
        self.expect("an unmeasured expiry retains a first valid club association", seen, ("22", self.d(-15), None))
        self.expect("the undated observation produces no confirmed contract", self.contracts(1408), [])

    def test_20ak_a_dated_end_correction_is_still_an_observed_expiration(self):
        self.case("20ak", "a dated expiry correction for the exact existing spell is still accepted")
        pid = 1407
        key = self.player(pid)
        self.profile("current", pid, 11, self.d(-500), self.d(300))
        self.profile("stated effective end", pid, 11, self.d(-500), self.d(-5))
        self.expect("same fact, corrected end", self.spells(pid), {(11, self.d(-500)): self.d(-5)})
        self.expect("expired contract no longer confirmed", self.public(pid)["contract_until"], None)
        self.expect("profile accepted", self.queue("profile", key)["code"], None)

    @unittest.skipUnless(HTTP_READY, "requires node and backend/api/node_modules (npm ci --prefix backend/api)")
    def test_the_profile_route_publishes_what_the_view_holds(self):
        self.case("20s 20w 20z 20ac", "the read API's /api/players/{id} after a move, a move abroad, a loan return and a quarantine")
        pids = (1301, 1302, 1303, 1304)
        for pid in pids:
            self.player(pid)
        self.profile("past", 1301, 11, self.d(-2000), self.d(-1000))
        self.profile("move", 1301, 22, self.d(-700), self.d(400))
        self.profile("current", 1302, 11, self.d(-500), self.d(300))
        self.profile("move abroad", 1302, 9999, self.d(-10), self.d(700))
        self.profile("parent", 1303, 11, self.d(-1500), self.d(600))
        self.profile("loan", 1303, 22, self.d(-200), self.d(100))
        self.profile("back", 1303, 11, self.d(-1500), self.d(600))
        self.profile("current", 1304, 11, self.d(-300), self.d(500))
        self.db.execute("""INSERT INTO ops.provider_links(entity_type, provider, provider_key, entity_id, rule, quarantined_at, quarantine_reason)
                           VALUES ('player', 'transfermarkt', '1304', 99999, 'snapshot', now(), 'birth_date_differs')""")
        public = {pid: self.db.execute("SELECT api.public_id('player', %s)", (pid,)).fetchone()[0] for pid in pids}
        out = subprocess.run([NODE, str(ROOT / "tests" / "profile_http.mjs"), DSN, *public.values()], capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stderr)
        http = json.loads(out.stdout)
        self.entry["states"].append({"after": "GET /api/players/{id}", "http": http})
        fields = ("contract_until", "contract_team", "observed_contract_until", "observed_contract_team")
        expected = {1301: (self.d(400).isoformat(), "Club Vingt-Deux", self.d(400).isoformat(), "Club Vingt-Deux"),
                    1302: (None, None, self.d(700).isoformat(), "Club Extérieur"),
                    1303: (self.d(600).isoformat(), "Club Onze", self.d(600).isoformat(), "Club Onze"),
                    1304: (None, None, None, None)}
        for pid, want in expected.items():
            answer = http[public[pid]]
            self.expect(f"{pid}: HTTP 200", answer["status"], 200)
            self.expect(f"{pid}: the route's contract fields", tuple(answer["data"].get(k) for k in fields), want)
            self.expect(f"{pid}: the route publishes the view", tuple(answer["data"].get(k) for k in fields), tuple(self.public(pid)[k] for k in fields))


@unittest.skipUnless(DSN and psycopg, "requires disposable local sources DB and psycopg")
class MigrationTest(Base):
    """Migration 139 over the rows a base may hold, and the deletions it refuses (§20.2)."""

    def pre_139(self):
        """The base as it stood before 139: no index, no guard, 139 not recorded."""
        x = self.db.execute
        x("DROP INDEX IF EXISTS core.player_transfers_transfermarkt_key")
        x("DROP TRIGGER IF EXISTS keep_transfermarkt_history ON core.player_transfers")
        x("DROP TRIGGER IF EXISTS keep_transfermarkt_history ON core.player_contracts")
        x("DELETE FROM ops.schema_migrations WHERE version = %s", (MIGRATION.name,))

    def test_20ag_20ah_139_over_null_foreign_and_repeated_keys(self):
        from vega.store import migrate

        self.case("20ag 20ah", "migration 139 over NULL keys, another source's repeated keys, then a repeated Transfermarkt key")
        self.assertTrue(MIGRATION.exists(), f"{MIGRATION.name} missing")
        x = self.db.execute
        for pid in (1401, 1402):
            self.player(pid)
        self.pre_139()
        rows = [(1401, "transfermarkt", None), (1401, "transfermarkt", None), (1401, "other", "7"), (1401, "other", "7"), (1401, "transfermarkt", "81"), (1402, "transfermarkt", "81")]
        for pid, source, key in rows:
            x("INSERT INTO core.player_transfers(player_id, source, source_key, as_of) VALUES (%s, %s, %s, current_date)", (pid, source, key))
        migrate(self.db)
        index = x("SELECT indexdef FROM pg_indexes WHERE schemaname = 'core' AND indexname = 'player_transfers_transfermarkt_key'").fetchone()
        self.expect("applied over NULL keys and another source's repeats", (index is not None, x("SELECT count(*) FROM core.player_transfers").fetchone()[0]), (True, 6))
        self.expect("the index covers Transfermarkt's non-null keys only", bool(index) and "source_key IS NOT NULL" in index[0] and "'transfermarkt'" in index[0], True)
        self.pre_139()
        x("INSERT INTO core.player_transfers(player_id, source, source_key, as_of) VALUES (1402, 'transfermarkt', '81', current_date)")
        before = x("SELECT id, player_id, source::text, source_key FROM core.player_transfers ORDER BY id").fetchall()
        with self.assertRaises(psycopg.Error) as stopped:
            migrate(self.db)
        message = str(stopped.exception)
        self.entry["states"].append({"after": "139 over a repeated key", "error": message})
        self.expect("stops with its code and the first pair", ("TRANSFER_KEYS_NOT_UNIQUE" in message, "player 1402" in message and "key 81" in message), (True, True))
        self.expect("nothing changed", x("SELECT id, player_id, source::text, source_key FROM core.player_transfers ORDER BY id").fetchall(), before)
        self.expect("139 not recorded", x("SELECT count(*) FROM ops.schema_migrations WHERE version = %s", (MIGRATION.name,)).fetchone()[0], 0)
        with self.db.transaction():  # a person removes the repeat, then 139 applies
            x("DELETE FROM core.player_transfers WHERE id = %s", (before[-1][0],))
        migrate(self.db)
        self.expect("then applied", x("SELECT count(*) FROM ops.schema_migrations WHERE version = %s", (MIGRATION.name,)).fetchone()[0], 1)

    def test_20ai_the_deployed_writers_deletions_are_refused(self):
        self.case("20ai", "the statements of the reader before VI-31 after 139; an authorized deletion")
        x = self.db.execute
        self.player(1403)
        x("INSERT INTO core.player_transfers(player_id, source, source_key, as_of) VALUES (1403, 'transfermarkt', '81', current_date), (1403, 'other', NULL, current_date)")
        x("""INSERT INTO core.player_contracts(player_id, team_id, start_date, end_date, source, as_of) VALUES
             (1403, 11, current_date - 900, current_date - 100, 'transfermarkt', current_date), (1403, 22, current_date - 99, current_date + 300, 'transfermarkt', current_date)""")
        before = (self.transfers(1403), self.contracts(1403))
        # The deployed writer's two deletions (8018e0836c, transfermarkt.py:932 and :988).
        for sql, params in (("DELETE FROM core.player_transfers WHERE player_id = %s AND source = 'transfermarkt'", (1403,)),
                            ("DELETE FROM core.player_contracts WHERE player_id = %s AND source = 'transfermarkt' AND (team_id, start_date) <> (%s, %s)",
                             (1403, 22, self.d(-99)))):
            try:
                with self.db.transaction():
                    x(sql, params)
                refused = None
            except psycopg.Error as error:
                refused = str(error)
            self.entry["states"].append({"after": sql, "error": refused})
            self.expect(f"refused: {sql[:40]}", refused is not None and "TRANSFERMARKT_HISTORY_KEPT" in refused, True)
        self.expect("every row kept", (self.transfers(1403), self.contracts(1403)), before)
        with self.db.transaction():
            x("DELETE FROM core.player_transfers WHERE player_id = 1403 AND source = 'other'")
        self.expect("another source's row deletes as before", [r["source"] for r in self.transfers(1403)], ["transfermarkt"])
        with self.db.transaction():
            x("SET LOCAL vega.allow_history_delete = 'on'")
            x("DELETE FROM core.player_contracts WHERE player_id = 1403 AND team_id = 11")
        self.expect("an authorized deletion goes through", [c["team_id"] for c in self.contracts(1403)], [22])


if __name__ == "__main__":
    unittest.main()
