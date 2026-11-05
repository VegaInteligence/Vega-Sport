#!/usr/bin/env python3
"""Recover two source facts the frozen core normalizer dropped, as one generation.

1. Kickoff instants. Every fixture of the two Ligue 1 partitions carries
   ``time_utc`` ('YYYY-MM-DDTHH:MM:SSZ'); the normalizer kept only ``date[:10]``.
   Each current match gets a successor revision with the exact instant
   (kickoff_precision 'second', source_timezone 'UTC'); its match alias is
   re-pointed to the new revision, as the admission does.
2. Shot actors. Four 2025/2026 shots name source players p_4D4L8O / p_2mYiIC that
   have no profile, appearance or name anywhere in the corpus (playerName is '').
   Each observed source ID becomes a typed player identity with an unknown
   display name (NULL: no name was observed), with its player alias, and the
   shots get successors linked to it. No profile, statistic or name is invented.

Values come only from the frozen RAM capture (exact manifest/normalizer binding)
and are tied to SQL through each row's own source record: same document path and
content SHA, same JSON pointer ordinal, same external key. Nothing is persisted
besides technical counts and digests. Default is offline; --plan and --readback
are read-only; --apply writes one sealed generation in a single transaction.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dashboard/scripts'))
import orion_pro_native_transport_real_v4 as rds  # noqa: E402

FROZEN = ROOT / 'docs/verification/orion-pro-real-native-spatial-20261104'
RAM = '/tmp/orion-real-rds-source-20261105-v3/source.sock'
EVIDENCE = ROOT / 'docs/verification/orion-pro-source-recovery-20261105'
TRANSFORM = 'orion_pro_source_recovery_v1'
POLICY = 'real_source_core_v2_native31'
ACTORS = ('p_2mYiIC', 'p_4D4L8O')
UTC_FORMAT = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z')
FIXTURE = re.compile(r'/tables/fixtures/rows/(\d+)')
SHOT = re.compile(r'/tables/shots/rows/(\d+)')
CODE_SHA = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
RO = ('-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=1000 '
      '-c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3 -c idle_in_transaction_session_timeout=60000')
RW = ('-c default_transaction_read_only=off -c statement_timeout=8000 -c lock_timeout=1000 '
      '-c timezone=UTC -c datestyle=ISO,YMD -c extra_float_digits=3 -c idle_in_transaction_session_timeout=60000')


class Refused(RuntimeError):
    pass


def require(ok, message):
    if not ok:
        raise Refused(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), default=str).encode()).hexdigest()


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_parts():
    capture = load(FROZEN / 'capture.py', 'frozen_capture')
    checks = load(FROZEN / 'e2e.py', 'frozen_checks')
    snapshot = capture.fetch_snapshot(RAM)
    parts = {p['path']: p for p in checks.unpack_independent(snapshot)}
    meta = snapshot.get('meta') or {}
    hashes = {path: (meta.get(path) or {}).get('physicalSha256') for path in parts}
    binding = {'manifestSha256': snapshot['manifestSha256'], 'normalizerSha256': snapshot['normalizerSha256'],
               'captureCodeSha256': snapshot['captureCodeSha256'], 'documentHashes': hashes}
    snapshot.clear()
    return parts, binding


def columns(conn, table):
    schema, name = table.split('.')
    rows = conn.execute("SELECT a.attname, a.attidentity<>'' OR a.attgenerated<>'' FROM pg_attribute a "
                        "JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
                        "WHERE n.nspname=%s AND c.relname=%s AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
                        (schema, name)).fetchall()
    return [r[0] for r in rows], {r[0] for r in rows if r[1]}


def adapt(conn, table, values):
    """Wrap JSON/JSONB values explicitly; every other type keeps psycopg's native adaptation."""
    from psycopg.types.json import Jsonb
    if table not in JSON_COLUMNS:
        JSON_COLUMNS[table] = json_columns_of(conn, table)
    json_columns = JSON_COLUMNS[table]
    return [Jsonb(v) if c in json_columns and v is not None else v for c, v in values]


JSON_COLUMNS = {}


def json_columns_of(conn, table):
    schema, name = table.split('.')
    return {r[0] for r in conn.execute(
        "SELECT a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname=%s AND c.relname=%s AND a.attnum>0 AND NOT a.attisdropped AND a.atttypid IN ('json'::regtype,'jsonb'::regtype)",
        (schema, name)).fetchall()}


def fetch(conn, sql, params=()):
    cursor = conn.execute(sql, params)
    names = [c.name for c in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def observe(conn, parts, binding):
    """Read current SQL rows and bind each to its exact source row. Read-only."""
    docs = {r['id']: r for r in fetch(conn, 'SELECT id,legacy_object_path,content_sha256 FROM ingest.source_documents')}
    for path, sha in binding['documentHashes'].items():
        match = [d for d in docs.values() if d['legacy_object_path'] == path]
        require(len(match) == 1, 'Partition document missing in SQL: ' + path)
        require(sha is None or match[0]['content_sha256'] == sha, 'RAM document bytes differ from SQL lineage: ' + path)
    matches = fetch(conn, "SELECT m.*, r.locator AS _locator, r.external_key AS _key, r.document_id AS _doc "
                          "FROM football.matches m JOIN ingest.source_records r ON r.id=m.source_record_id "
                          "WHERE m.recorded_to_gen IS NULL AND m.is_canonical AND NOT m.is_deleted ORDER BY m.id")
    aliases = {a['match_id']: a for a in fetch(conn, "SELECT * FROM ingest.public_aliases WHERE route_kind='match' "
                                                       "AND recorded_to_gen IS NULL")}
    require(len(matches) == len(aliases) == 612, 'Exactly 612 current matches and match aliases required')
    kickoff = {}
    for m in matches:
        path = docs[m['_doc']]['legacy_object_path']
        ordinal = FIXTURE.fullmatch(m['_locator'])
        require(path in parts and ordinal, 'Match source record is not a partition fixture row')
        fixture = parts[path]['tables']['fixtures'][int(ordinal.group(1))]
        alias = aliases[m['id']]
        require(fixture['id'] == m['_key'] == alias['public_key'] and alias['match_revision_id'] == m['revision_id'],
                'Fixture/record/alias identity differs')
        text = fixture.get('time_utc')
        require(isinstance(text, str) and UTC_FORMAT.fullmatch(text), 'Unexpected time_utc shape')
        instant = datetime.strptime(text, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        require(fixture['date'] == text[:10] and m['match_date'] == instant.date(), 'UTC date differs from match_date')
        require(m['kickoff_at'] is None and m['kickoff_precision'] == 'date' and m['source_timezone'] is None,
                'Match is not in the original date-only state')
        kickoff[m['id']] = instant
    shots = fetch(conn, "SELECT s.*, r.locator AS _locator, r.external_key AS _key, r.document_id AS _doc "
                        "FROM football.shots s JOIN ingest.source_records r ON r.id=s.source_record_id "
                        "WHERE s.recorded_to_gen IS NULL AND s.is_canonical AND NOT s.is_deleted AND s.player_id IS NULL ORDER BY s.external_shot_id")
    teams = {a['public_key']: a['team_id'] for a in fetch(conn, "SELECT public_key,team_id FROM ingest.public_aliases "
                                                                 "WHERE route_kind='team' AND recorded_to_gen IS NULL")}
    players = {a['public_key'] for a in fetch(conn, "SELECT public_key FROM ingest.public_aliases WHERE route_kind='player'")}
    require(len(shots) == 4, 'Exactly four actorless shots expected')
    actor = {}
    for s in shots:
        path = docs[s['_doc']]['legacy_object_path']
        ordinal = SHOT.fullmatch(s['_locator'])
        require(path in parts and ordinal, 'Shot source record is not a partition shot row')
        row = parts[path]['tables']['shots'][int(ordinal.group(1))]
        require(row['id'] == s['_key'] == s['external_shot_id'] and row['playerId'] in ACTORS and row.get('playerName') == ''
                and teams.get(row['teamId']) == s['team_id'], 'Shot source actor/team binding differs')
        actor[s['revision_id']] = row['playerId']
    require(not players & set(ACTORS), 'Actor already has a player alias')
    require(set(actor.values()) == set(ACTORS), 'Both observed actors expected')
    # The actors must not appear anywhere else in the corpus (no profile/performance/name to recover).
    for path, part in parts.items():
        for name, rows in part['tables'].items():
            if name == 'shots':
                continue
            require(not any(set(ACTORS) & {str(v) for v in r.values()} for r in rows), 'Actor has other source observations: ' + name)
    template = fetch(conn, "SELECT * FROM ingest.public_aliases WHERE route_kind='player' AND recorded_to_gen IS NULL "
                           "ORDER BY public_key LIMIT 1")[0]
    editions = fetch(conn, 'SELECT id,revision_id FROM football.competition_seasons WHERE recorded_to_gen IS NULL AND is_canonical AND NOT is_deleted')
    plan = {'matches': len(kickoff), 'shots': len(actor), 'actors': sorted(set(actor.values())),
            'kickoffSha256': digest(sorted((aliases[m]['public_key'], v.isoformat()) for m, v in kickoff.items())),
            'actorBindingSha256': digest(sorted((s['external_shot_id'], actor[s['revision_id']]) for s in shots)),
            'editions': len(editions)}
    return {'matches': matches, 'aliases': aliases, 'kickoff': kickoff, 'shots': shots, 'actor': actor,
            'template': template, 'editions': editions, 'plan': plan}


def successors(conn, table, olds, changes, g, key='revision_id'):
    names, generated = columns(conn, table)
    skip = generated | {'recorded_to_gen', 'updated_at'}
    ids = [o[key] for o in olds]
    closed = conn.execute(f'UPDATE {table} SET recorded_to_gen=%s WHERE recorded_to_gen IS NULL AND {key}=ANY(%s)', (g, ids)).rowcount
    require(closed == len(olds), 'Predecessors moved: ' + table)
    written = []
    for old in olds:
        fresh = {c: old[c] for c in names if c not in skip}
        fresh.update(changes(old), recorded_from_gen=g, transform_version=TRANSFORM, transform_code_sha256=CODE_SHA)
        if 'data_revision' in fresh:
            fresh['data_revision'] = old['data_revision'] + 1
        cols = list(fresh)
        cursor = conn.execute(f"INSERT INTO {table} ({','.join(chr(34) + c + chr(34) for c in cols)}) VALUES "
                              f"({','.join(['%s'] * len(cols))}) RETURNING *", adapt(conn, table, [(c, fresh[c]) for c in cols]))
        names_out = [c.name for c in cursor.description]
        written.append(dict(zip(names_out, cursor.fetchone())))
    return written


def apply(conn, observed, binding):
    # Caller opened the transaction before observing, so plan and writes share one snapshot.
    g = conn.execute('SELECT ingest.begin_generation(%s,%s,%s,NULL)',
                     ('real-source-recovery:' + uuid.uuid4().hex, TRANSFORM, POLICY)).fetchone()[0]
    new_players = {}
    for pid in ACTORS:
        new_players[pid] = conn.execute('INSERT INTO football.players(display_name) VALUES (NULL) RETURNING id').fetchone()[0]
    names, generated = columns(conn, 'ingest.public_aliases')
    template = observed['template']
    for pid, player_id in new_players.items():
        fresh = {c: template[c] for c in names if c not in generated | {'recorded_to_gen', 'updated_at'}}
        fresh.update(public_key=pid, player_id=player_id, recorded_from_gen=g, transform_version=TRANSFORM,
                     transform_code_sha256=CODE_SHA)
        if 'data_revision' in fresh:
            fresh['data_revision'] = 1
        cols = list(fresh)
        conn.execute(f"INSERT INTO ingest.public_aliases ({','.join(chr(34) + c + chr(34) for c in cols)}) VALUES "
                     f"({','.join(['%s'] * len(cols))})", adapt(conn, 'ingest.public_aliases', [(c, fresh[c]) for c in cols]))
    kickoff = observed['kickoff']
    fresh_matches = successors(conn, 'football.matches', observed['matches'],
                               lambda old: {'kickoff_at': kickoff[old['id']], 'kickoff_precision': 'second',
                                            'source_timezone': 'UTC'}, g)
    revision = {m['id']: m['revision_id'] for m in fresh_matches}
    aliases = list(observed['aliases'].values())
    names, generated = columns(conn, 'ingest.public_aliases')
    closed = conn.execute("UPDATE ingest.public_aliases SET recorded_to_gen=%s WHERE route_kind='match' AND recorded_to_gen IS NULL "
                          "AND match_id=ANY(%s)", (g, list(revision))).rowcount
    require(closed == len(aliases) == len(revision), 'Match aliases moved')
    for old in aliases:
        fresh = {c: old[c] for c in names if c not in generated | {'recorded_to_gen', 'updated_at'}}
        fresh.update(match_revision_id=revision[old['match_id']], recorded_from_gen=g, transform_version=TRANSFORM,
                     transform_code_sha256=CODE_SHA)
        if 'data_revision' in fresh:
            fresh['data_revision'] = old['data_revision'] + 1
        cols = list(fresh)
        conn.execute(f"INSERT INTO ingest.public_aliases ({','.join(chr(34) + c + chr(34) for c in cols)}) VALUES "
                     f"({','.join(['%s'] * len(cols))})", adapt(conn, 'ingest.public_aliases', [(c, fresh[c]) for c in cols]))
    actor = observed['actor']
    successors(conn, 'football.shots', observed['shots'], lambda old: {'player_id': new_players[actor[old['revision_id']]]}, g)
    for edition in observed['editions']:
        updated = conn.execute('UPDATE ingest.dirty_editions SET generation=%s,competition_season_revision_id=%s,'
                               'changed_at=CURRENT_TIMESTAMP,reason=%s WHERE competition_season_id=%s',
                               (g, edition['revision_id'], 'Recovered source kickoff instants and shot actors', edition['id'])).rowcount
        if updated == 0:
            conn.execute('INSERT INTO ingest.dirty_editions(competition_season_id,competition_season_revision_id,generation,changed_at,reason) '
                         'VALUES(%s,%s,%s,CURRENT_TIMESTAMP,%s)', (edition['id'], edition['revision_id'], g, 'Recovered source kickoff instants and shot actors'))
    manifest = {'transform': TRANSFORM, 'codeSha256': CODE_SHA, 'source': binding, 'plan': observed['plan']}
    conn.execute('SET LOCAL statement_timeout = 300000')
    conn.execute("SET LOCAL work_mem = '64MB'")
    started = time.monotonic()
    conn.execute('SELECT ingest.seal_generation(%s,%s)', (g, digest(manifest)))
    seal_ms = round((time.monotonic() - started) * 1000, 3)
    started = time.monotonic()
    conn.commit()
    commit_ms = round((time.monotonic() - started) * 1000, 3)
    return {'generation': g, 'newPlayers': len(new_players), 'sealMs': seal_ms, 'commitMs': commit_ms,
            'manifestSha256': digest(manifest)}


def readback(conn, parts, binding, generation):
    snap = fetch(conn, 'SELECT generation,status,transform_version FROM ingest.dataset_snapshots WHERE generation=%s', (generation,))
    require(snap == [{'generation': generation, 'status': 'sealed', 'transform_version': TRANSFORM}], 'Recovery snapshot not sealed')
    rows = fetch(conn, "SELECT a.public_key, m.kickoff_at, m.kickoff_precision, m.source_timezone, m.recorded_from_gen, "
                       "a.match_revision_id=m.revision_id AS aligned FROM football.matches m JOIN ingest.public_aliases a "
                       "ON a.match_id=m.id AND a.route_kind='match' AND a.recorded_to_gen IS NULL "
                       "WHERE m.recorded_to_gen IS NULL AND m.is_canonical AND NOT m.is_deleted")
    expected = {}
    for part in parts.values():
        for f in part['tables']['fixtures']:
            expected[f['id']] = datetime.strptime(f['time_utc'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    require(len(rows) == len(expected) == 612 and all(r['aligned'] and r['recorded_from_gen'] == generation and
            r['kickoff_precision'] == 'second' and r['source_timezone'] == 'UTC' and r['kickoff_at'] == expected[r['public_key']]
            for r in rows), 'Kickoff readback differs')
    closed = conn.execute('SELECT count(*) FROM football.matches WHERE recorded_to_gen=%s', (generation,)).fetchone()[0]
    shots = fetch(conn, "SELECT s.external_shot_id, a.public_key FROM football.shots s JOIN ingest.public_aliases a "
                        "ON a.player_id=s.player_id AND a.route_kind='player' AND a.recorded_to_gen IS NULL "
                        "WHERE s.recorded_from_gen=%s AND s.recorded_to_gen IS NULL", (generation,))
    nulls = conn.execute('SELECT count(*) FROM football.shots WHERE recorded_to_gen IS NULL AND player_id IS NULL').fetchone()[0]
    require(len(shots) == 4 and nulls == 0 and closed == 612, 'Shot actor or closure readback differs')
    return {'snapshot': snap[0], 'matches': len(rows), 'closedPredecessors': closed,
            'kickoffSha256': digest(sorted((r['public_key'], r['kickoff_at'].isoformat()) for r in rows)),
            'shotsLinked': len(shots), 'actorlessShots': nulls,
            'actorBindingSha256': digest(sorted((s['external_shot_id'], s['public_key']) for s in shots))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    for name in ('plan', 'apply', 'readback'):
        mode.add_argument('--' + name, action='store_true')
    parser.add_argument('--generation', type=int)
    args = parser.parse_args()
    if not (args.plan or args.apply or args.readback):
        print(json.dumps({'status': 'offline_plan', 'transform': TRANSFORM, 'codeSha256': CODE_SHA}))
        return 0
    EVIDENCE.mkdir(exist_ok=True)
    label = 'plan' if args.plan else 'apply' if args.apply else 'readback'
    out = EVIDENCE / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + label + '.json')
    report = {'kind': TRANSFORM + '_' + label, 'codeSha256': CODE_SHA, 'startedAt': datetime.now(timezone.utc).isoformat(),
              'rawBodiesPersisted': False}
    started = time.monotonic()
    conn = None
    try:
        parts, binding = source_parts()
        report['sourceBinding'] = binding
        with rds.ingest_auth() as passfile:
            conn = rds.rds_connection(passfile, RO if not args.apply else RW)
        if args.readback:
            require(args.generation, '--generation required')
            conn.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            report['readback'] = readback(conn, parts, binding, args.generation)
            conn.rollback()
            report['status'] = 'verified'
        else:
            conn.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' if args.plan else 'BEGIN ISOLATION LEVEL REPEATABLE READ')
            observed = observe(conn, parts, binding)
            report['plan'] = observed['plan']
            if args.plan:
                conn.rollback()
                report['status'] = 'planned'
            else:
                report['applied'] = apply(conn, observed, binding)
                report['status'] = 'committed'
    except BaseException as error:
        if conn is not None:
            try:
                conn.rollback()
            except Exception:
                pass
        report.update(status='refused', errorType=type(error).__name__, error=str(error)[:4000],
                      sqlstate=getattr(error, 'sqlstate', None))
        context = getattr(getattr(error, 'diag', None), 'context', None)
        if isinstance(context, str):
            report['nativeErrorContext'] = context[:8000]
    finally:
        if conn is not None:
            conn.close()
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
        out.write_text(json.dumps(report, indent=2, default=str) + '\n')
        print(json.dumps({k: report.get(k) for k in ('status', 'plan', 'applied', 'readback', 'error', 'elapsedSeconds')}, default=str))
    return 0 if report['status'] in {'planned', 'committed', 'verified'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
