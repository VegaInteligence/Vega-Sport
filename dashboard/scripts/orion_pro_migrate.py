"""Apply the approved Pro pilot migrations to an owned disposable local PG18.

Remote application is deliberately a separate later mode, after local acceptance
and a fresh owner-reviewed RDS preflight. No credentials are accepted in argv.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from orion_pro_schema import ROOT, SPEC, active_tables, approved_model, cols, ident, relation, schema_sql

MIGRATIONS = ROOT / 'dashboard/backend/migrations'


def digest(body):
    return hashlib.sha256(body).hexdigest()


def compiled_migrations(model, target):
    schema = schema_sql(model)
    result = [('012', MIGRATIONS / '012_orion_pro_domain.sql', schema)]
    if target == '013':
        from orion_pro_integrity import integrity_sql
        result.append(('013', MIGRATIONS / '013_orion_pro_integrity.sql', integrity_sql(model, active_tables(model))))
    # The checked source SQL is deterministic and its applied digest is journaled.
    for _, path, sql in result:
        if not path.exists() or path.read_text() != sql:
            path.write_text(sql)
    return result


def bootstrap(db, model, artifacts):
    existing = db.execute("SELECT generation,status FROM ingest.dataset_snapshots WHERE snapshot_key=%s",
                          ('bootstrap-v1-' + digest(SPEC.read_bytes())[:16],)).fetchone()
    if existing:
        if existing[1] != 'sealed':
            raise ValueError('Existing bootstrap is not sealed')
        for name, seeds in model['seed_data'].items():
            for seed in seeds:
                keys = list(seed)
                row = db.execute(f"SELECT {cols(keys)},recorded_from_gen,transform_code_sha256 FROM {relation(name)} WHERE code=%s AND definition_version=%s",
                                 (seed['code'], seed['definition_version'])).fetchone()
                if not row or list(row[:len(keys)]) != list(seed.values()) or row[-2] != existing[0]:
                    raise ValueError('Committed bootstrap content differs; refusing overwrite')
        return {'generation': existing[0], 'reused': True, 'seedRows': sum(map(len, model['seed_data'].values()))}
    bundle = {'model': digest(SPEC.read_bytes()), 'migrator': digest(Path(__file__).read_bytes()),
              'migrations': {version: digest(sql.encode()) for version, _, sql in artifacts}}
    code_hash = digest(json.dumps(bundle, sort_keys=True, separators=(',', ':')).encode())
    generation = db.execute('SELECT ingest.begin_generation(%s,%s,%s)',
                            ('bootstrap-v1-' + bundle['model'][:16], 'bootstrap_v1', 'bootstrap_v1')).fetchone()[0]
    for contract in model['bootstrap']['relation_contracts']:
        keys = list(contract)
        db.execute(f"INSERT INTO ingest.relation_contracts ({cols(keys)}) VALUES ({','.join(['%s'] * len(keys))})", tuple(contract.values()))
    for name, seeds in model['seed_data'].items():
        for template in seeds:
            row = {**template, 'recorded_from_gen': generation, 'transform_code_sha256': code_hash}
            db.execute(f"INSERT INTO {relation(name)} ({cols(row)}) VALUES ({','.join(['%s'] * len(row))})", tuple(row.values()))
    manifest_hash = digest(json.dumps({'bootstrap': model['seed_data'], 'artifact': code_hash}, sort_keys=True,
                                     separators=(',', ':'), ensure_ascii=False).encode())
    db.execute('SELECT ingest.seal_generation(%s,%s)', (generation, manifest_hash))
    return {'generation': generation, 'reused': False, 'seedRows': sum(map(len, model['seed_data'].values())),
            'codeSha256': code_hash, 'artifact': bundle, 'manifestSha256': manifest_hash}


def local_connection(psycopg):
    from psycopg.conninfo import conninfo_to_dict
    dsn = os.environ.get('ORION_PILOT_DATABASE_URL')
    if os.environ.get('STATARENA_TEST_DATABASE') != '1' or not dsn:
        raise ValueError('Explicit local test database setup is required')
    args = conninfo_to_dict(dsn)
    if args.get('host') not in {'127.0.0.1', 'localhost', '::1'}:
        raise ValueError('Local pilot only accepts a loopback host')
    db = psycopg.connect(dsn, autocommit=True, connect_timeout=5)
    try:
        directory = Path(db.execute('SHOW data_directory').fetchone()[0]).resolve()
        if not any(p.name.startswith(('orion-pro-e2e-', 'statarena-orion-pro-local-')) for p in directory.parents):
            raise ValueError('Refusing an unowned local PostgreSQL directory')
        if db.info.server_version != 180006:
            raise ValueError('Pilot requires the observed PostgreSQL18.6 engine')
        db.execute("SET statement_timeout='30s'")
        db.execute("SET lock_timeout='2s'")
        db.execute("SET idle_in_transaction_session_timeout='30s'")
        return db
    except Exception:
        db.close()
        raise


def bind_local_roles(db, model):
    """Only called after validating the owned local cluster; never real roles."""
    from orion_pro_integrity import role_grants_sql
    for role in ('orion_pro_ingest', 'orion_pro_web'):
        prior = db.execute('SELECT rolsuper,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname=%s', (role,)).fetchone()
        if prior is None:
            db.execute(f'CREATE ROLE {ident(role)} NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
        elif any(prior):
            raise ValueError('Unexpected privileges on an existing local pilot role')
    db.execute(role_grants_sql(model, ingest_role='orion_pro_ingest', runtime_role='orion_pro_web'), prepare=False)
    return ['orion_pro_ingest', 'orion_pro_web']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--local', action='store_true')
    parser.add_argument('--target', choices=['012', '013'], default='013')
    parser.add_argument('--rollback-to', choices=['012', 'empty'])
    parser.add_argument('--model', type=Path, default=SPEC)
    args = parser.parse_args()
    if not args.local:
        parser.error('Only --local owned disposable mode is implemented at this stage')
    if args.model.resolve() != SPEC.resolve():
        parser.error('Use the approved model at its recorded repository location')
    model = approved_model(args.model)
    target = args.rollback_to if args.rollback_to == '012' else args.target
    artifacts = compiled_migrations(model, target)
    import psycopg
    report = {'mode': 'owned_disposable_local', 'target': target, 'modelSha256': digest(SPEC.read_bytes()),
              'rollbackTo': args.rollback_to, 'applied': [], 'reused': [], 'remoteActions': []}
    try:
        with local_connection(psycopg) as db:
            with db.transaction():
                db.execute('SELECT pg_advisory_xact_lock(20261104,2)')
                if args.rollback_to:
                    # Local-only reset: this connection was checked against our
                    # owned temp cluster before any schema mutation, including DROP.
                    for schema in ('analytics', 'football', 'ingest'):
                        db.execute(f'DROP SCHEMA IF EXISTS {ident(schema)} CASCADE')
                    if args.rollback_to == 'empty':
                        report['status'] = 'reset_to_empty'
                        print(json.dumps(report))
                        return 0
                exists = db.execute("SELECT to_regclass('ingest.schema_migrations')").fetchone()[0]
                if not exists:
                    leftovers = db.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind IN ('r','p')").fetchone()[0]
                    if leftovers:
                        raise ValueError('Unjournaled target tables already exist; refusing overwrite')
                try:
                    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
                except subprocess.CalledProcessError:
                    commit = None
                for version, path, sql in artifacts:
                    checksum = digest(sql.encode())
                    prior = db.execute('SELECT content_sha256 FROM ingest.schema_migrations WHERE version=%s', (version,)).fetchone() if exists else None
                    if prior:
                        if prior[0] != checksum:
                            raise ValueError('Applied migration digest drift; create a new version')
                        report['reused'].append(version)
                        continue
                    db.execute(sql, prepare=False)
                    exists = True
                    db.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',
                               (version, checksum, commit))
                    report['applied'].append(version)
                if target == '013':
                    report['bootstrap'] = bootstrap(db, model, artifacts)
                    report['localRoles'] = bind_local_roles(db, model)
                report['status'] = 'applied'
        print(json.dumps(report))
        return 0
    except Exception as error:
        # Never print DSN/environment or a PostgreSQL detail containing a row.
        report.update(status='failed', errorType=type(error).__name__, sqlstate=getattr(error, 'sqlstate', None))
        if isinstance(error, ValueError):
            report['reason'] = str(error)
        elif getattr(error, 'diag', None):
            report['reason'] = error.diag.message_primary
        print(json.dumps(report))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
