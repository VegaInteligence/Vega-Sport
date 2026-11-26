"""Restore the 35 Open Matchday identities from reviewed before and after captures.

A dry run is the default. Applying requires the original capture digests and an explicit
opt-in. This path restores two tables and signals the affected edition reads. It never
derives a parent row from a CSV or rewrites Elo. Run as the schema owner.
"""
import argparse
from datetime import datetime
from hashlib import sha256
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit
import zlib

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from .migrate import owner_url
from .sources.open_matchday_history import RESULTS
from .store import StoreError, connect_local
from .worker import connect


IDS = tuple((*range(8049, 8061), *range(8290, 8302), *range(8534, 8545)))
FOLDERS = {
    332: "ENG_6_national-league-north",
    333: "ENG_6_national-league-south",
    334: "ENG_7_northern-premier-league",
}
MATCHES = "core.matches"
BINDINGS = "core.provider_ids"
ELO = "agg.team_elo"
MATCH_STATS = "core.team_match_stats"
ENRICHMENT_COLUMNS = {"home_score_ht", "away_score_ht", "revision", "updated_at"}
# Relations naming a match created after the reviewed captures: 141, 143, the Fjelstul World Cup Database's pair
# (137_worldcup_database.sql), football-data.co.uk's (140_football_data.sql), the players' run's recorded exclusions
# (155_player_grade_status.sql), the reviewed side corrections (156_team_side_corrections.sql) and International
# Results' scorers (172_international_goals.sql), our probable elevens (176_match_probable_lineups.sql) and the matches
# graded on arrival of their statistics (178_match_grades_on_arrival.sql). Each is still checked for occupancy.
ADDED_DEPENDENCIES = {"core.archive_match_attestations", "ops.archive_removals", "core.worldcup_matches", "core.footballdata_matches",
                      "agg.player_grade_exclusions", "core.team_side_corrections", "core.international_goals",
                      "agg.match_probable_lineups", "agg.match_probable_lineup_players", "agg.match_grade_arrivals"}
# The Fjelstul World Cup Database's own match keys (137_worldcup_database.sql): text keys of core.worldcup_matches, never
# an id of core.matches.
FJELSTUL_MATCH_KEYS = frozenset({"core.worldcup_matches", "core.worldcup_appearances", "core.worldcup_goals",
                                 "core.worldcup_bookings", "core.worldcup_substitutions", "core.worldcup_shootout_kicks"})
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


# The latest migrations this path was reviewed against: 153 (production on 19 Nov 2026), and 160 with 155, 156 and 157
# before it. 155 adds agg.player_grade_exclusions and 156 core.team_side_corrections, which both name a match
# (ADDED_DEPENDENCIES; FAILURE_MODES.md §38, §39); 157 adds an index and 160 columns, no relation naming a match (§44,
# §46). 161 (VI-39) adds views in api only: no table, so nothing dependencies() reads. 162 (VI-40) adds
# agg.player_team_fit, keyed by season and player: no column naming a match. 163 adds core.league_player_seasons, keyed
# by league, season, player and club (transfermarkt-datasets): no column naming a match. 164 adds functions of the api
# schema only (the archived league seasons' reads): no table; 165 replaces two of them. 166 (#68) replaces the view
# api.match_strengths (four more columns read from core.matches): no table. 167 (#82) adds agg.level_runs and
# agg.player_level, agg.player_level_cells, agg.player_level_positions, keyed by season, player, position and club, and
# two api views: no column naming a match. 168 (§51, §53) adds a column to agg.team_power, the table agg.nation_elo_runs
# keyed by an Elo run (no column of agg.power_runs, whose reviewed row verify_elo compares whole) and redefines
# api.power_clubs: no relation naming a match. 169 (#90) adds a column to agg.player_level and redefines
# api.player_levels: no relation naming a match. 170 (§55) adds two columns to agg.nation_elo_runs (none to
# agg.power_runs) and re-arms two scopes of ops.source_runs: no relation naming a match. 171 (VI-48) adds
# core.home_stakes and core.home_level_scales, settings keyed by kind and key and by scope (no column naming a match,
# a team or an edition), and api functions and a view. 172 (§57) adds core.international_goals, International Results'
# scorers, which names a match (match_id, integer, ON DELETE CASCADE: ADDED_DEPENDENCIES, checked for occupancy like the
# others; none of the 35 restored Open Matchday matches is an International Results match), and the view
# api.international_goals; no column of agg.power_runs. 173 (§58) redefines the function api.nation_list only: no
# table. 174 (§59) adds core.player_suspensions, keyed by player and naming a competition (no column naming a match or a
# team), a column and a kind on ops.transfermarkt_reads and four api views: no relation naming a match. 175 (#105, §60)
# adds agg.award_runs, agg.player_award and agg.player_award_honours, keyed by season, player, team and edition
# (competition_season_id, not a match), and two api views: no column naming a match, none of agg.power_runs. 176 (§61)
# adds agg.match_probable_lineups (match_id, integer, REFERENCES core.matches ON DELETE CASCADE) and
# agg.match_probable_lineup_players (match_id, integer, through its parent's key), our probable elevens of matches not
# started, which name a match (ADDED_DEPENDENCIES, checked for occupancy like the others; the restored Open Matchday
# matches are finished, so none has a row there), two api views and two read grants to vega_calc; no column of
# agg.power_runs. 177 (GH137) redefines four functions only (api.league_history_matches, _next, _scorers, _players): the
# same rows, no table, no column. 178 (§69) adds agg.player_contribution_refs, keyed by award year, role and indicator
# (no column naming a match), and agg.match_grade_arrivals (match_id, integer, REFERENCES core.matches ON DELETE
# CASCADE), the matches graded as soon as their player statistics arrived, which names a match (ADDED_DEPENDENCIES,
# checked for occupancy like the others; it only holds matches kicked off in the last 7 days, so none of the restored
# Open Matchday matches); both reference agg.power_runs (run_id) without a column of it; and an index of core.matches
# (no column). 179 (GH171) creates the extension pg_stat_statements and the view ops.statement_stats over it: no table,
# no column of core, agg or ops, nothing naming a match. A later one needs its own review here.
REVIEWED_SCHEMAS = ("153_transfer_history_served.sql", "163_league_player_seasons.sql", "164_league_history_reads.sql",
                    "165_league_history_spellings.sql", "166_match_strengths_extra_time.sql", "167_player_level.sql",
                    "168_nation_world_ranking.sql", "169_player_level_measured.sql",
                    "170_nation_elo_national_set.sql", "171_home_importance_v2.sql", "172_international_goals.sql",
                    "173_nation_last_played.sql", "174_absences_suspensions.sql",
                    "175_player_award.sql", "176_match_probable_lineups.sql", "177_league_history_lean_reads.sql",
                    "178_match_grades_on_arrival.sql", "179_statement_statistics.sql")


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
        proof = RESULTS.get(key) or {}
        require(proof.get("id_at_incident") == ident and proof.get("score") == [hs, aws], "sporting attestation mismatch")
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
    require(tuple(sorted(applied))[-1] in REVIEWED_SCHEMAS, "unreviewed destination schema version")
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
        if column == "match_key" and data_type == "text" and table in FJELSTUL_MATCH_KEYS:
            continue
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


def verify_elo(conn, elo, bits, run, captured_after, needed):
    have = select_rows(conn, ELO, sql.SQL("t.match_id=ANY(%s)"), (list(IDS),))
    actual_bits = conn.execute("""
        SELECT match_id,team_id,jsonb_build_object('elo_before',encode(float4send(elo_before),'hex'),
          'elo_after',encode(float4send(elo_after),'hex'),'expected',encode(float4send(expected),'hex'),
          'result',encode(float4send(result),'hex'),'stakes',encode(float4send(stakes),'hex'))
        FROM agg.team_elo WHERE match_id=ANY(%s) ORDER BY match_id,team_id
    """, (list(IDS),)).fetchall()
    original_run = select_rows(conn, "agg.power_runs", sql.SQL("t.id=2097"))
    if (same_rows(elo, have) and bits == [list(r) for r in actual_bits] and same_rows(run, original_run)):
        return {"preserved_elo": 70, "elo_pending_sides": 0, "elo_run": 2097}
    require(same_rows([dict(run[0], status="superseded")], original_run),
            "Elo drift: the original run differs from the reviewed publication")
    published = select_rows(conn, "agg.power_runs", sql.SQL("t.kind='elo' AND t.season_id IS NULL AND t.status='published'"))
    require(len(published) == 1, "Elo drift: expected one later published run")
    later = published[0]
    require(later["id"] > 2097 and later["finished_at"] and later["matches"] and
            datetime.fromisoformat(later["finished_at"]) > datetime.fromisoformat(captured_after),
            "Elo drift: newer publication not established")
    counted, malformed = conn.execute("""
        SELECT count(*),count(*) FILTER (WHERE n<>2 OR NOT same_run)
          FROM (SELECT count(*) AS n,bool_and(run_id=%s) AS same_run FROM agg.team_elo GROUP BY match_id) checks
    """, (later["id"],)).fetchone()
    require(counted == later["matches"] and not malformed, "Elo drift: incomplete later published population")
    if have:
        expected = {(r["match_id"], r["team_id"], r["season_id"]) for r in elo}
        sides = {(r["match_id"], r["team_id"], r["season_id"]) for r in have}
        require(not needed and len(have) == len(expected) and sides == expected,
                "Elo drift: later published sides differ from the restored identities")
        return {"preserved_elo": 70, "elo_pending_sides": 0, "elo_run": later["id"]}
    return {"preserved_elo": 0, "elo_pending_sides": 70, "elo_run": later["id"]}


def guard_sequence(conn):
    last, called = conn.execute("SELECT last_value,is_called FROM core.matches_id_seq").fetchone()
    step, cycle, cache = conn.execute("SELECT seqincrement,seqcycle,seqcache FROM pg_sequence WHERE seqrelid='core.matches_id_seq'::regclass").fetchone()
    max_existing = conn.execute("SELECT max(id) FROM core.matches").fetchone()[0] or 0
    require(step == 1 and not cycle and cache == 1 and last + int(called) > max(max_existing, *IDS), "match identity sequence unsafe")


def current_state(conn, facts, parents, bindings, *, allow_enrichment=False):
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
        require(same_rows(keyed, bindings), "physical identity or provider key collision")
        if not same_rows(existing, parents):
            def identity(rows):
                return [{k: v for k, v in row.items() if k not in ENRICHMENT_COLUMNS} for row in rows]

            require(allow_enrichment and same_rows(identity(existing), identity(parents)), "physical identity or provider key collision")
            original = {m["id"]: m for m in parents}
            for row in existing:
                saved = original[row["id"]]
                require(row == saved or (row["revision"] > saved["revision"] and
                        datetime.fromisoformat(row["updated_at"]) >= datetime.fromisoformat(saved["updated_at"])),
                        "physical row changes have no newer enrichment revision")
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
        require(conn.execute("""SELECT pg_has_role(relowner,'USAGE') FROM pg_class
            WHERE oid='core.matches'::regclass""").fetchone()[0], "maintenance requires the match table owner")
        guard_schema(conn, before, after)
        checks = dependencies(conn)
        expected = captured - {MATCHES}
        require(expected <= set(checks) <= expected | ADDED_DEPENDENCIES, "unreviewed destination dependency inventory")
        if apply:
            locked = set(checks) | {v[0] for v in REFS.values()} | {MATCHES, "core.competitions", "agg.power_runs",
                                                                 "ops.resource_versions"}
            conn.execute(sql.SQL("LOCK TABLE {} IN SHARE ROW EXCLUSIVE MODE NOWAIT").format(sql.SQL(", ").join(map(typed, sorted(locked)))))
        guard_references(conn, before, parents)
        needed = current_state(conn, facts, parents, bindings, allow_enrichment=True)
        elo_state = verify_elo(conn, elo, bits, run, after["at"], needed)
        guard_sequence(conn)
        for table, predicates in checks.items():
            if table in (ELO, BINDINGS):
                continue
            where = sql.SQL(" OR ").join(sql.SQL("(") + sql.SQL(p) + sql.SQL(")") for p in sorted(predicates))
            if table == MATCH_STATS and not needed:
                # After restoration the normal writer may enrich only the verified match and its participants.
                where = sql.SQL("({}) AND NOT EXISTS (SELECT 1 FROM core.matches m WHERE m.id=t.match_id "
                                "AND m.season_id=t.season_id AND t.team_id IN (m.home_team_id,m.away_team_id))").format(where)
            occupied = conn.execute(sql.SQL("SELECT 1 FROM {} t WHERE {} LIMIT 1").format(typed(table), where),
                                    tuple(list(IDS) for _ in predicates)).fetchone()
            require(occupied is None, "unexpected dependent row in " + table)
        for table, data in ((MATCHES, parents), (BINDINGS, bindings)):
            columns = {r[0] for r in conn.execute("SELECT attname FROM pg_attribute WHERE attrelid=%s::regclass AND attnum>0 AND NOT attisdropped", (table,))}
            require(all(set(r) == columns for r in data), "incomplete physical row: " + table)
        report = {"would_restore": len(IDS) if needed else 0, "restored": 0, **elo_state, "edition_versions": {}}
        if needed and apply:
            for table, data in ((MATCHES, parents), (BINDINGS, bindings)):
                conn.execute(sql.SQL("INSERT INTO {} SELECT * FROM jsonb_populate_recordset(NULL::{},%s)").format(typed(table), typed(table)),
                             (Jsonb(data),))
            require(not current_state(conn, facts, parents, bindings), "restored identity differs")
            require(verify_elo(conn, elo, bits, run, after["at"], False) == elo_state, "Elo drift during restoration")
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
    destination = parser.add_mutually_exclusive_group(required=True)
    destination.add_argument("--dsn", help="dedicated loopback rehearsal database")
    destination.add_argument("--maintenance", action="store_true", help="use the schema owner configuration of vega.migrate")
    for name in ("preimage", "postimage"):
        parser.add_argument("--" + name, required=True, type=Path)
        parser.add_argument("--" + name + "-sha256", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        dsn = owner_url(os.environ) if args.maintenance else args.dsn
        if args.maintenance:
            require(dsn, "V2_MIGRATION_DATABASE_URL or V2_DB_HOST/NAME/USER/PASSWORD is required")
            connector = connect
        else:
            target = urlsplit(dsn)
            require(target.hostname == "127.0.0.1" and re.fullmatch(r"/vega_v2_open_matchday_restore_[a-z0-9_]+", target.path)
                    and not target.query and not target.fragment, "dedicated loopback copy required")
            connector = connect_local
        before = load_capture(args.preimage, args.preimage_sha256)
        after = load_capture(args.postimage, args.postimage_sha256)
        with connector(dsn) as conn:
            print(json.dumps(restore(conn, before, after, args.apply)))
    except psycopg.errors.LockNotAvailable:
        parser.exit(1, "restoration copy busy\n")
    except (Refusal, StoreError, psycopg.Error, KeyError, ValueError, TypeError, OSError, zlib.error) as error:
        parser.exit(1, f"restoration refused: {error}\n")


if __name__ == "__main__":
    main()
