#!/usr/bin/env python3
"""Adopt migration 018 (read-model indexes) on RDS as the schema owner.

--plan is read-only; --apply runs one transaction under the migration, generation
and serving leases, only from the exact adopted 012-017 journal, then an
independent read-only connection verifies the six indexes and the 018 journal row.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dashboard/scripts'))
import orion_pro_native_transport_real_v4 as rds  # noqa: E402

MIGRATION = ROOT / 'dashboard/backend/migrations/018_orion_pro_read_model_indexes.sql'
EVIDENCE = ROOT / 'docs/verification/orion-pro-read-models-20261106'
CHAIN = [(number, sha) for number, _, sha in rds.overlay.CHAIN]
INDEXES = {
    'analytics_metric_totals_build_kind_metric_value_idx', 'analytics_metric_totals_build_kind_player_idx',
    'analytics_metric_totals_build_kind_team_idx', 'analytics_player_competition_team_stats_build_team_idx',
    'analytics_player_competition_team_stats_player_idx', 'analytics_player_competition_stats_player_idx'}
OPTIONS = ('-c statement_timeout=8000 -c lock_timeout=1000 -c timezone=UTC -c datestyle=ISO,YMD '
           '-c idle_in_transaction_session_timeout=15000')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def connect(role, readonly):
    name = '/statarena/app/rds-admin' if role == 'admin' else '/statarena/app/rds-ingest'
    raw = subprocess.run(['aws', 'ssm', 'get-parameter', '--name', name, '--with-decryption', '--profile', 'statarena',
                          '--region', 'us-east-2', '--query', 'Parameter.Value', '--output', 'text'],
                         capture_output=True, text=True, check=True).stdout
    secret = json.loads(raw)
    import psycopg
    address = sorted({v[4][0] for v in socket.getaddrinfo(rds.old.HOST, 5432, type=socket.SOCK_STREAM)})[0]
    with tempfile.TemporaryDirectory(prefix='orion-018-') as private:
        path = Path(private) / 'pgpass'
        path.write_text(':'.join([rds.old.HOST, '5432', 'statarena_prod', secret['username'],
                                  secret['password'].replace('\\', '\\\\').replace(':', '\\:')]) + '\n')
        path.chmod(0o600)
        conn = psycopg.connect(host=rds.old.HOST, hostaddr=address, port=5432, dbname='statarena_prod', user=secret['username'],
                               passfile=str(path), sslmode='verify-full', sslrootcert=str(rds.old.CA), connect_timeout=7,
                               autocommit=True, application_name='orion-adopt-018',
                               options=OPTIONS + (' -c default_transaction_read_only=on' if readonly else ''))
    return conn


def observe(conn):
    journal = [tuple(r) for r in conn.execute('SELECT version,content_sha256,applied_at::text,code_commit FROM ingest.schema_migrations ORDER BY version')]
    present = {r[0] for r in conn.execute("SELECT indexname FROM pg_indexes WHERE schemaname='analytics' AND indexname = ANY(%s)", (sorted(INDEXES),))}
    counts = conn.execute('SELECT (SELECT count(*) FROM analytics.metric_totals),(SELECT count(*) FROM analytics.player_competition_stats),'
                          '(SELECT count(*) FROM analytics.player_competition_team_stats)').fetchone()
    return {'journal': journal, 'indexes': sorted(present), 'aggregateRows': list(counts)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    sql = MIGRATION.read_text()
    sha = hashlib.sha256(MIGRATION.read_bytes()).hexdigest()
    commit = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    committed = subprocess.run(['git', 'show', commit + ':' + str(MIGRATION.relative_to(ROOT))], cwd=ROOT, capture_output=True).stdout
    EVIDENCE.mkdir(exist_ok=True)
    out = EVIDENCE / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + ('-018-apply.json' if args.apply else '-018-plan.json'))
    report = {'kind': 'orion_pro_adopt_018', 'migrationSha256': sha, 'codeCommit': commit, 'writes': []}
    started = time.monotonic()
    try:
        require(hashlib.sha256(committed).hexdigest() == sha, 'Migration 018 must be committed before adoption')
        conn = connect('admin', readonly=not args.apply)
        try:
            before = observe(conn)
            report['before'] = before
            if [r[:2] for r in before['journal']] == CHAIN + [('018', sha)] and len(before['indexes']) == 6:
                report['status'] = 'noop_already_adopted'
            else:
                require([r[:2] for r in before['journal']] == CHAIN and not before['indexes'], 'Exact 012-017 journal without 018 indexes required')
                if not args.apply:
                    report['status'] = 'planned'
                else:
                    with conn.transaction():
                        actor = conn.execute("SELECT current_user,current_setting('statement_timeout'),current_setting('lock_timeout')").fetchone()
                        require(actor == ('statarena_admin', '8s', '1s'), 'Exact owner and deadlines required')
                        for key in ('20261104,2', '20261104,1', '97813003::bigint'):
                            require(conn.execute('SELECT pg_try_advisory_xact_lock(' + key + ')').fetchone()[0], 'A native lease is occupied')
                        require(observe(conn)['journal'] == before['journal'], 'Journal changed after the plan')
                        conn.execute(sql, prepare=False)
                        conn.execute('INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,%s)', ('018', sha, commit))
                    report['writes'] = ['6 CREATE INDEX', 'schema_migrations 018']
                    report['status'] = 'applied'
        finally:
            conn.close()
        if args.apply:
            check = connect('ingest', readonly=True)
            try:
                after = observe(check)
            finally:
                check.close()
            require([r[:2] for r in after['journal']] == CHAIN + [('018', sha)] and after['journal'][:6] == report['before']['journal']
                    and set(after['indexes']) == INDEXES, 'Independent readback differs')
            report['independentReadback'] = after
    except BaseException as error:
        report.update(status='refused', errorType=type(error).__name__, error=str(error)[:2000], sqlstate=getattr(error, 'sqlstate', None))
    report['elapsedSeconds'] = round(time.monotonic() - started, 3)
    out.write_text(json.dumps(report, indent=2, default=str) + '\n')
    print(json.dumps({k: report.get(k) for k in ('status', 'error', 'elapsedSeconds')}))
    return 0 if report['status'] in {'planned', 'applied', 'noop_already_adopted'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
