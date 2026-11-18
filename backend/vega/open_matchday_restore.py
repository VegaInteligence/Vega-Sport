"""Restore the 35 Open Matchday identities from reviewed captures on a dedicated local copy.

A dry run is the default. Applying requires the original capture digests and an explicit
opt-in. This path restores two tables and signals the affected edition reads. It never
derives a parent row from a CSV or rewrites the preserved Elo. Run with the copy's owner.
"""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.parse import urlsplit
import zlib

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from .store import connect_local


IDS = tuple((*range(8049, 8061), *range(8290, 8302), *range(8534, 8545)))
FOLDERS = {
    332: "ENG_6_national-league-north",
    333: "ENG_6_national-league-south",
    334: "ENG_7_northern-premier-league",
}
MATCHES = "core.matches"
BINDINGS = "core.provider_ids"
ELO = "agg.team_elo"
ADDED_DEPENDENCIES = {"core.archive_match_attestations", "ops.archive_removals"}
REFS = {
    "season_id": ("core.seasons", "season_id", ("id", "label")),
    "competition_season_id_season_id": ("core.competition_seasons", "competition_season_id",
                                       ("id", "season_id", "competition_id", "cup_key", "native_label")),
    "round_id": ("core.rounds", "round_id", ("id", "competition_season_id", "name", "stage")),
    "home_team_id": ("core.teams", "home_team_id", ("id", "country_code", "name", "merged_into")),
    "away_team_id": ("core.teams", "away_team_id", ("id", "country_code", "name", "merged_into")),
    "venue_id": ("core.venues", "venue_id", ("id", "name", "city")),
    "referee_id": ("core.referees", "referee_id", ("id", "name")),
}


class Refusal(RuntimeError):
    """The reviewed copy and the current state do not agree."""


def require(ok, message):
    if not ok:
        raise Refusal(message)


def sha(data):
    return sha256(data).hexdigest()


def load_capture(path, expected):
    with path.open("rb") as stream:
        raw = stream.read(2_000_001)
    require(len(raw) <= 2_000_000 and sha(raw) == expected, "capture digest or size mismatch")
    decoder = zlib.decompressobj()
    plain = decoder.decompress(raw, 4_000_001)
    require(len(plain) <= 4_000_000 and decoder.eof and not decoder.unused_data, "incomplete capture compression")
    view = json.loads(plain)
    require(view["probe_version"] in ("astra-preimage-v2", "preimage-v3-private-restore") and view["read_only"] == "on", "wrong capture format")
    for gap in view["not_verified"]:
        table = gap.get("table")
        # A private column makes a nonempty observation partial. No column value
        # is required when the predicate was actually evaluated and found zero rows.
        read = view["reads"].get("table." + table, {}) if table else {}
        require(gap["reason"] == "columns_intentionally_omitted" and read.get("count") == 0 and read.get("ok"),
                "incomplete capture dependency: " + str(gap.get("read", table)))
    return view


def rows(capture, key, count=None):
    entry = capture["reads"][key]
    require(entry["ok"] and entry.get("complete") and not entry.get("rls_active"), "incomplete read: " + key)
    raw = entry["rows_json"]
    require(sha("\n".join(raw).encode()) == entry["sha256"] and len(raw) == entry["count"], "corrupt read: " + key)
    require(count is None or len(raw) == count, "unexpected rows in " + key)
    require(not raw or not entry.get("omitted_columns"), "incomplete row in " + key)
    return [json.loads(line) for line in raw]


def plain_rows(capture, key, count=None):
    entry = capture["reads"][key]
    bounds = count is None or entry["count"] == len(entry["rows"]) == count
    require(entry["ok"] and bounds, "incomplete read: " + key)
    return entry["rows"]


def typed(reference):
    return sql.Identifier(*reference.split("."))


def compact(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def same_rows(actual, expected):
    return sorted(map(compact, actual)) == sorted(map(compact, expected))


def select_rows(conn, table, where, parameters=()):
    return [r[0] for r in conn.execute(
        sql.SQL("SELECT to_jsonb(t) FROM {} t WHERE {}").format(typed(table), where), parameters
    )]


def inspect_capture(before, after):
    facts = before["witnesses"]
    keys = before["provider_keys"]
    require(facts == after["witnesses"] and [r[0] for r in facts] == list(IDS)
            and keys == after["provider_keys"] and len(set(keys)) == len(keys) == len(IDS), "incident scope mismatch")
    parents = rows(before, "table." + MATCHES, len(IDS))
    bindings = rows(before, "table." + BINDINGS, len(IDS))
    by_id = {r["id"]: r for r in parents}
    key_by_id = {r["entity_id"]: r for r in bindings}
    require(set(by_id) == set(key_by_id) == set(IDS), "duplicate physical row")
    for fact, key in zip(facts, keys, strict=True):
        ident, home, away, day, hs, aws, edition = fact
        m, p = by_id[ident], key_by_id[ident]
        require([m[c] for c in ("id", "home_team_id", "away_team_id", "match_date", "home_score",
                               "away_score", "competition_season_id")] == fact
                and m["season_id"] == 2026 and m["source"] == "open_matchday" and m["status"] == "finished"
                and home != away and hs >= 0 and aws >= 0
                and key == f"{FOLDERS[edition]}:2026/2027:{day}|{m['home_team_name']}|{m['away_team_name']}"
                and p["entity_type"] == "match" and p["provider"] == "open_matchday"
                and p["provider_key"] == key and p["is_current"], "source identity mismatch")
    require(not plain_rows(after, "id_and_pair_candidates", 0), "destination collision in signed capture")
    table_keys = {k[6:] for k in before["reads"] if k.startswith("table.")}
    require(table_keys == {k[6:] for k in after["reads"] if k.startswith("table.")}, "different capture dependency inventories")
    for table in table_keys - {MATCHES, BINDINGS, ELO}:
        rows(before, "table." + table, 0)
    for table in table_keys - {ELO}:
        rows(after, "table." + table, 0)
    elo = rows(after, "table." + ELO, 70)
    bits = plain_rows(after, "elo_float_bits", 70)
    run = rows(after, "elo_runs", 1)
    expected_sides = {(mid, team) for mid, home, away, *_ in facts for team in (home, away)}
    require({(r["match_id"], r["team_id"]) for r in elo} == expected_sides
            and all(r["run_id"] == 2097 and r["season_id"] == 2026 for r in elo)
            and run[0]["id"] == 2097 and run[0]["status"] == "published"
            and same_rows(elo, rows(before, "table." + ELO, 70))
            and bits == plain_rows(before, "elo_float_bits", 70)
            and same_rows(run, rows(before, "elo_runs", 1)), "Elo evidence differs across captures")
    return facts, parents, bindings, table_keys, elo, bits, run


def guard_schema(conn, before, after):
    directory = Path(__file__).resolve().parents[1] / "sql"
    known = {p.name: sha(p.read_text().encode()) for p in directory.glob("*.sql")}
    applied = dict(conn.execute("SELECT version, encode(checksum,'hex') FROM ops.schema_migrations"))
    require(applied == {k: h for k, h in known.items() if "vector_optional" not in k or k in applied}, "destination schema mismatch")
    early = {k: h for k, h in known.items() if k <= "133_cohort_max_wait.sql" and ("vector_optional" not in k or k in applied)}
    require(tuple(sorted(applied))[-1] == "149_validate_archive_attestation.sql", "unreviewed destination schema version")
    for capture in (before, after):
        require({n: h for n, h, _ in plain_rows(capture, "migrations")} == early, "preimage schema mismatch")


def dependencies(conn):
    attributes = conn.execute("""
        SELECT n.nspname||'.'||c.relname,a.attname,t.typname
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
          JOIN pg_type t ON t.oid=a.atttypid
        WHERE n.nspname IN ('core','agg','ops') AND c.relkind IN ('r','p') AND NOT c.relispartition
          AND a.attnum>0 AND NOT a.attisdropped
    """).fetchall()
    queries = {}
    available = {(table,col) for table,col,_ in attributes}

    def predicate(table, expression):
        queries.setdefault(table, set()).add(expression.as_string(conn))

    for table, column, data_type in attributes:
        if (column in ("match_id", "match_key") or column.endswith("_match_id")
                or (table == "core.archive_match_attestations" and column == "former_id")):
            require(data_type in ("int2", "int4", "int8"), "unreviewed reference type: " + table + "." + column)
            predicate(table, sql.SQL("t.{}=ANY(%s)").format(sql.Identifier(column)))
        for id_col, type_col in (("entity_id","entity_type"), ("resource_id","resource_kind")):
            if column == id_col and (table,type_col) in available:
                require(data_type in ("int2", "int4", "int8"), "unreviewed polymorphic reference: " + table)
                predicate(table, sql.SQL("t.{}=ANY(%s) AND t.{}::text='match'").format(sql.Identifier(column),sql.Identifier(type_col)))
    for table, column in conn.execute("""
        SELECT n.nspname||'.'||c.relname,a.attname
          FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON c.relnamespace=n.oid
          JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=k.conkey[
             array_position(k.confkey,(SELECT attnum FROM pg_attribute WHERE attrelid='core.matches'::regclass AND attname='id'))]
         WHERE k.contype='f' AND k.confrelid='core.matches'::regclass AND NOT c.relispartition
    """):
        predicate(table, sql.SQL("t.{}=ANY(%s)").format(sql.Identifier(column)))
    predicate("ops.archive_removals", sql.SQL("t.id=ANY(%s) AND t.kind='match'"))
    return queries


def guard_references(conn, capture, matches):
    for name, (table, field, cols) in REFS.items():
        actual_ids = {m[field] for m in matches if m[field] is not None}
        saved = rows(capture, "parent.matches_" + name + "_fkey", len(actual_ids))
        require({r["id"] for r in saved} == actual_ids, "missing parent evidence: " + field)
        actual = select_rows(conn, table, sql.SQL("t.id=ANY(%s)"), (list(actual_ids),))
        narrow = lambda records: [{col: r[col] for col in cols} for r in records]
        require(same_rows(narrow(actual), narrow(saved)), "referenced parent drift: " + table)
        if table == "core.teams":
            require(all(t["merged_into"] is None for t in actual), "merged team needs identity review")
    require(all(conn.execute("SELECT 1 FROM core.rounds WHERE id=%s AND competition_season_id=%s",
                              (m["round_id"], m["competition_season_id"])).fetchone()
                for m in matches if m["round_id"] is not None), "round edition mismatch")


def verify_elo(conn, elo, bits, run):
    have = select_rows(conn, ELO, sql.SQL("t.match_id=ANY(%s)"), (list(IDS),))
    actual_bits = conn.execute("""
        SELECT match_id,team_id,jsonb_build_object('elo_before',encode(float4send(elo_before),'hex'),
          'elo_after',encode(float4send(elo_after),'hex'),'expected',encode(float4send(expected),'hex'),
          'result',encode(float4send(result),'hex'),'stakes',encode(float4send(stakes),'hex'))
        FROM agg.team_elo WHERE match_id=ANY(%s) ORDER BY match_id,team_id
    """, (list(IDS),)).fetchall()
    require(same_rows(elo, have) and bits == [list(r) for r in actual_bits]
            and same_rows(run, select_rows(conn, "agg.power_runs", sql.SQL("t.id=2097"))), "Elo drift on the copy")


def guard_sequence(conn):
    last, called = conn.execute("SELECT last_value,is_called FROM core.matches_id_seq").fetchone()
    step, cycle, cache = conn.execute("SELECT seqincrement,seqcycle,seqcache FROM pg_sequence WHERE seqrelid='core.matches_id_seq'::regclass").fetchone()
    max_existing = conn.execute("SELECT max(id) FROM core.matches").fetchone()[0] or 0
    require(step == 1 and not cycle and cache == 1 and last + int(called) > max(max_existing, *IDS), "match identity sequence unsafe")


def current_state(conn, facts, parents, bindings):
    mids = list(IDS)
    keys = [r["provider_key"] for r in bindings]
    existing = select_rows(conn, MATCHES, sql.SQL("t.id=ANY(%s)"), (mids,))
    keyed = select_rows(conn, BINDINGS, sql.SQL(
        "t.entity_type='match' AND (t.entity_id=ANY(%s) OR (t.provider='open_matchday' AND t.provider_key=ANY(%s)))"),
        (mids, keys))
    for mid, home, away, day, _, _, eid in facts:
        duplicate = conn.execute("""
            SELECT id FROM core.matches WHERE match_date=%s AND id<>%s
              AND ((home_team_id=%s AND away_team_id=%s) OR (home_team_id=%s AND away_team_id=%s)) LIMIT 1
        """, (day,mid,home,away,away,home)).fetchone()
        require(duplicate is None, "same-day pair collision at " + str(mid))
    if existing or keyed:
        require(same_rows(existing, parents) and same_rows(keyed, bindings), "physical identity or provider key collision")
        return False
    return True


def restore(conn, before, after, apply):
    facts, parents, bindings, captured, elo, bits, run = inspect_capture(before, after)
    with conn.transaction():
        if not apply:
            conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        conn.execute("SET LOCAL TIME ZONE 'UTC'")
        conn.execute("SET LOCAL statement_timeout='20s'")
        conn.execute("SET LOCAL lock_timeout='3s'")
        if apply:
            require(conn.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('vega_v2_migrate',0))").fetchone()[0], "migration busy")
        guard_schema(conn, before, after)
        checks = dependencies(conn)
        expected = captured - {MATCHES}
        require(expected <= set(checks) <= expected | ADDED_DEPENDENCIES, "unreviewed destination dependency inventory")
        if apply:
            locked = set(checks) | {v[0] for v in REFS.values()} | {MATCHES, "core.competitions", "agg.power_runs",
                                                                 "ops.resource_versions"}
            conn.execute(sql.SQL("LOCK TABLE {} IN SHARE ROW EXCLUSIVE MODE NOWAIT").format(sql.SQL(", ").join(map(typed, sorted(locked)))))
        guard_references(conn, before, parents)
        verify_elo(conn, elo, bits, run)
        needed = current_state(conn, facts, parents, bindings)
        guard_sequence(conn)
        for table, predicates in checks.items():
            if table in (ELO, BINDINGS):
                continue
            where = sql.SQL(" OR ").join(sql.SQL("(") + sql.SQL(p) + sql.SQL(")") for p in sorted(predicates))
            occupied = conn.execute(sql.SQL("SELECT 1 FROM {} t WHERE {} LIMIT 1").format(typed(table), where),
                                    tuple(list(IDS) for _ in predicates)).fetchone()
            require(occupied is None, "unexpected dependent row in " + table)
        for table, data in ((MATCHES, parents), (BINDINGS, bindings)):
            columns = {r[0] for r in conn.execute("SELECT attname FROM pg_attribute WHERE attrelid=%s::regclass AND attnum>0 AND NOT attisdropped", (table,))}
            require(all(set(r) == columns for r in data), "incomplete physical row: " + table)
        report = {"would_restore": len(IDS) if needed else 0, "restored": 0, "preserved_elo": 70, "edition_versions": {}}
        if needed and apply:
            for table, data in ((MATCHES, parents), (BINDINGS, bindings)):
                conn.execute(sql.SQL("INSERT INTO {} SELECT * FROM jsonb_populate_recordset(NULL::{},%s)").format(typed(table), typed(table)),
                             (Jsonb(data),))
            require(not current_state(conn, facts, parents, bindings), "restored identity differs")
            verify_elo(conn, elo, bits, run)
            conn.execute("UPDATE core.competition_seasons SET cup_updated_at=now() WHERE id=ANY(%s)", (list(FOLDERS),))
            for edition in sorted(FOLDERS):
                version = conn.execute("""INSERT INTO ops.resource_versions(resource_kind,resource_id) VALUES('competition_season',%s)
                    ON CONFLICT(resource_kind,resource_id) DO UPDATE SET version=ops.resource_versions.version+1,updated_at=now()
                    RETURNING version""", (edition,)).fetchone()[0]
                report["edition_versions"][edition] = version
            report["restored"] = len(IDS)
        return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", required=True)
    for name in ("preimage", "postimage"):
        parser.add_argument("--" + name, required=True, type=Path)
        parser.add_argument("--" + name + "-sha256", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        target = urlsplit(args.dsn)
        require(target.hostname == "127.0.0.1" and re.fullmatch(r"/vega_v2_open_matchday_restore_[a-z0-9_]+", target.path)
                and not target.query and not target.fragment, "dedicated loopback copy required")
        before = load_capture(args.preimage, args.preimage_sha256)
        after = load_capture(args.postimage, args.postimage_sha256)
        with connect_local(args.dsn) as conn:
            print(json.dumps(restore(conn, before, after, args.apply)))
    except psycopg.errors.LockNotAvailable:
        parser.exit(1, "restoration copy busy\n")
    except (Refusal, psycopg.Error, KeyError, ValueError, TypeError, OSError, zlib.error) as error:
        parser.exit(1, f"restoration refused: {error}\n")


if __name__ == "__main__":
    main()
