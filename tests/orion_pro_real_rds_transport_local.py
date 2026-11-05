#!/usr/bin/env python3
"""Test-first native transport workflow. No PG without a separate ROOT release."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import types

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'dashboard/scripts'
BASE = ROOT / 'docs/verification/orion-pro-real-rds-transfer-20261105/transport'
WRITER = SCRIPTS / 'orion_pro_native_transport.py'
MODEL = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
FIXTURE = ROOT / 'tests/orion_pro_bulk_stream_local.py'
PILOT = ROOT / 'docs/verification/orion-pro-pilot-20261104'
PG_BIN = Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin')
FIXTURE_VERSION = 'source_free_native_transport_fixture_v1'
CASES = ['implementation_available', 'offline_default', 'explicit_metadata_required', 'origin_pair_policy_routes',
         'campaign_release', 'owned_tls_native_setup', 'independent_endpoint_policies', 'native94_sequence_metadata',
         'endpoint_actor_route_refusals', 'source_and_policy_drift', 'foreign_target_bootstrap', 'exact_preflight',
         'mid_copy_rollback', 'deadline_rollback', 'committed_core_resume', 'exact_native_controls',
         'technical_clocks', 'closed_checkpoint_corruption', 'lost_commit_ack', 'noop_and_native_identity',
         'sourcefree_scope_cleanup']
SOURCEFREE = set(CASES[:4])


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def hashed(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str) + '\n')


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--label', default='native-transport')
    ap.add_argument('--precode-only', action='store_true')
    ap.add_argument('--source-free', action='store_true')
    ap.add_argument('--run-local', action='store_true')
    ap.add_argument('--release', type=Path)
    ap.add_argument('--release-sha256')
    ap.add_argument('--pg-bin', type=Path, default=PG_BIN)
    args = ap.parse_args()
    assert args.label.replace('-', '').isalnum()
    sys.path[:0] = [str(SCRIPTS), str(PILOT), str(ROOT / 'tests'), '/tmp/statarena-publication-test-python']
    from orion_e2e_process import run_bounded
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    run = BASE / 'runs' / (stamp + '-' + args.label)
    (run / 'inputs').mkdir(parents=True)
    report = {'kind': 'owned_source_free_native_transport_e2e_v1', 'startedAt': datetime.now(timezone.utc).isoformat(),
              'command': ['python3', str(Path(__file__)), *sys.argv[1:]], 'expected': str(BASE / 'PROTOCOL.md'),
              'cases': [], 'invocations': [], 'sourceSha256': {}, 'sourceRamReads': 0, 'remoteCalls': 0,
              'remoteWrites': [], 'rawSourceCopies': [], 'fullAcceptance': False, 'fixtureConstructions': 0}
    paths = [Path(__file__), BASE / 'PROTOCOL.md', BASE / 'BINDINGS.json', WRITER,
             ROOT / 'tests/orion_e2e_process.py', FIXTURE, ROOT / 'tests/orion_pro_bulk_local.py',
             SCRIPTS / 'orion_pro_bulk_stream_v2.py', SCRIPTS / 'orion_pro_bulk.py',
             SCRIPTS / 'orion_pro_policy.py', MODEL, PILOT / 'harness.py']
    if args.release:
        paths.append(args.release)
    for path in paths:
        if path.is_file():
            dest = run / 'inputs' / path.relative_to(ROOT)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
            report['sourceSha256'][str(path.relative_to(ROOT))] = sha(path)
    env = {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'USER', 'TMPDIR', 'LANG')}
    env.update(PYTHONDONTWRITEBYTECODE='1', PYTHONPATH='/tmp/statarena-publication-test-python')
    started = time.monotonic()
    deadline = started + 600
    pg = admin = source = target = None
    module = accepted = pair = marker = pair_path = acceptance_path = None
    block = None
    resources = []
    resource_tick = [0.0]

    def budget_reason():
        now = time.monotonic()
        if now - resource_tick[0] < .5:
            return None
        resource_tick[0] = now
        if pg is not None and pg.root.exists():
            disk = int(subprocess.check_output(['du', '-sk', str(pg.root)], text=True).split()[0]) * 1024
            proof = sum(p.stat().st_size for p in run.rglob('*') if p.is_file())
            resources.append({'elapsedSeconds': round(time.monotonic() - started, 3), 'ownedDiskBytes': disk, 'proofBytes': proof})
            if disk >= 1024 ** 3 or proof >= 64 * 1024 ** 2:
                return 'campaign_resource_bound'
        return None

    def cli(flags, label, *, tripwire=False, extra_env=None):
        local_env = {**env, **(extra_env or {})}
        if tripwire:
            guard = run / 'tripwire'
            guard.mkdir(exist_ok=True)
            (guard / 'sitecustomize.py').write_text("import socket,subprocess\ndef deny(*a,**k): raise RuntimeError('UNEXPECTED_EXTERNAL_OPERATION')\nsocket.socket.connect=deny\nsocket.getaddrinfo=deny\nsubprocess.Popen=deny\n")
            (guard / 'psycopg.py').write_text("raise RuntimeError('UNEXPECTED_DRIVER_IMPORT')\n")
            local_env['PYTHONPATH'] = str(guard)
        command = ['python3', str(WRITER), *map(str, flags)]
        result = run_bounded(command, cwd=ROOT, env=local_env, deadline=min(deadline, time.monotonic() + (10 if tripwire else 90)), stop_reason=budget_reason)
        (run / (label + '.stdout.log')).write_text(result.stdout)
        (run / (label + '.stderr.log')).write_text(result.stderr)
        report['invocations'].append({'command': command, 'exitCode': result.returncode,
                                      'stdout': label + '.stdout.log', 'stderr': label + '.stderr.log'})
        assert 'UNEXPECTED_' not in result.stdout + result.stderr, result.stderr
        data = json.loads(result.stdout) if result.stdout.startswith('{') else None
        return result, data

    def connect(database, actor='orion_pro_owner'):
        import psycopg
        return psycopg.connect(host='127.0.0.1', hostaddr='127.0.0.1', port=pg.port, dbname=database, user=actor,
                               sslmode='verify-full', sslrootcert=str(pg.data / 'server.crt'), autocommit=True,
                               options='-c statement_timeout=8000 -c lock_timeout=1000 -c timezone=UTC -c datestyle=ISO,YMD')

    def independent(conn):
        from orion_pro_bulk_local import oracle
        return oracle(conn, tables)

    def state(conn):
        from orion_pro_bulk_local import sequences
        return {'tables': independent(conn), 'sequences': sequences(conn)}

    def bind():
        nonlocal pair, accepted, pair_path, acceptance_path
        with source.transaction():
            source.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            sd = module.describe_endpoint(source, source=True, origin='owned_source_free_fixture')
            native = independent(source)
        with target.transaction():
            target.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            td = module.describe_endpoint(target, source=False, origin='owned_local_tls_target')
        pair = {'kind': 'explicit_native_sql_transport_pair_v1', 'environment': 'owned_local_tls',
                'writerSha256': sha(WRITER), 'bindingSha256': sha(BASE / 'BINDINGS.json'), 'source': sd, 'target': td}
        index = len(list(run.glob('pair-*.json')))
        pair_path = run / ('pair-' + str(index) + '.json')
        acceptance_path = run / ('acceptance-' + str(index) + '.json')
        save(pair_path, pair)
        accepted = {'kind': 'native_sql_transport_acceptance_v1', 'dataOrigin': 'owned_source_free_fixture',
                    'writerSha256': sha(WRITER), 'bindingsSha256': sha(BASE / 'BINDINGS.json'), 'pairSha256': sha(pair_path),
                    'modelSha256': sha(MODEL), 'producerSha256': producer, 'producerVersion': FIXTURE_VERSION,
                    'sourceNativeSha256': hashed(native), 'sourceTables': native, 'sourceRows': sum(v['rows'] for v in native.values()),
                    'sourcePhases': phases, 'sourceCheckpointSha256': hashed({'fixtureCodeSha256': sha(FIXTURE), 'testSha256': sha(Path(__file__))}),
                    'fullAcceptance': False}
        accepted['fixture'] = {'codeSha256': sha(FIXTURE), 'testSha256': sha(Path(__file__)), 'version': FIXTURE_VERSION,
                               'shape': {'APPEARANCES': 40, 'SCALARS': 1240, 'MATCHES': 4, 'PLAYERS': 40, 'VERSION': FIXTURE_VERSION}}
        save(acceptance_path, accepted)

    def invoke(*, apply=False, fault=None, expected=None, mutate_pair=None, mutate_acceptance=None, extra_env=None):
        ppath, apath = pair_path, acceptance_path
        if mutate_pair:
            body = json.loads(ppath.read_text()); mutate_pair(body)
            ppath = run / ('mutated-pair-' + str(len(report['invocations'])) + '.json'); save(ppath, body)
        if mutate_acceptance:
            body = json.loads(apath.read_text()); mutate_acceptance(body)
            apath = run / ('mutated-acceptance-' + str(len(report['invocations'])) + '.json'); save(apath, body)
        release = run / ('operation-release-' + str(len(report['invocations'])) + '.json')
        save(release, {'kind': 'native_transport_operation_release_v1', 'scope': 'owned_source_free_fixture',
                       'mode': 'apply-local' if apply else 'preflight-local', 'writerSha256': sha(WRITER),
                       'bindingSha256': sha(BASE / 'BINDINGS.json'), 'pairSha256': sha(ppath), 'acceptanceSha256': sha(apath),
                       'expiresAt': datetime.fromtimestamp(time.time() + 600, timezone.utc).isoformat(), 'fullAcceptance': False})
        flags = ['--apply-local' if apply else '--preflight-local', '--source-marker', marker,
                 '--pair', ppath, '--pair-sha256', sha(ppath), '--acceptance', apath, '--acceptance-sha256', sha(apath),
                 '--release', release, '--release-sha256', sha(release)]
        if fault:
            flags += ['--fault', fault]
        got, data = cli(flags, 'worker-' + str(len(report['invocations'])), extra_env=extra_env)
        if expected:
            assert got.returncode != 0 and data['reasonCode'] in expected, data
        else:
            assert got.returncode == 0, data
        return data

    try:
        for name in CASES:
            if block or (args.precode_only and name != 'implementation_available') or ((args.source_free or not args.run_local) and name not in SOURCEFREE):
                report['cases'].append({'case': name, 'status': 'unverified', 'reason': block or 'No PG campaign released/executed'})
                continue
            tick = time.monotonic()
            try:
                actual = {}
                if name == 'implementation_available':
                    assert WRITER.is_file(), 'Native real-RDS transport implementation is absent'
                    actual = {'writerSha256': sha(WRITER)}
                elif name == 'offline_default':
                    got, data = cli([], name, tripwire=True, extra_env={'PGHOSTADDR': '203.0.113.91', 'PGOPTIONS': '-c statement_timeout=0', 'AWS_PROFILE': 'forbidden'})
                    assert got.returncode == 0 and data['status'] == 'offline_plan' and data['connections'] == 0
                    actual = data
                elif name == 'explicit_metadata_required':
                    actual = []
                    for mode in ['--preflight-local', '--apply-local', '--preflight-rds', '--apply-rds']:
                        got, data = cli([mode], name + mode, tripwire=True)
                        assert got.returncode != 0 and data['reasonCode'] == 'BINDING' and data['connections'] == 0
                        actual.append(mode)
                elif name == 'origin_pair_policy_routes':
                    actual = []
                    for flags in [['--host', 'external.invalid'], ['--dsn', 'postgresql://external.invalid/x'], ['--policy', 'latest'], ['--apply-rds', '--fault', 'after-commit-ack']]:
                        got, data = cli(flags, name + '-' + str(len(actual)), tripwire=True)
                        assert got.returncode != 0 and (data is None or data['connections'] == 0)
                        actual.append(flags)
                    # Metadata is fully explicit but deliberately unobserved: a
                    # missing owned marker must remain the final offline gate.
                    # Mutations below exercise actual CLI guards, not parser-only
                    # missing-input failures or imported fake DB connections.
                    binding = json.loads((BASE / 'BINDINGS.json').read_text())
                    m = json.loads(MODEL.read_text())
                    names = [t['qualified_name'] for s in m['schemas'] for t in s['tables'] if t['phase'] != 'models']
                    native = {n: {'rows': 0, 'sha256': hashlib.sha256(b'').hexdigest()} for n in names}
                    descriptors = []
                    for is_source in [True, False]:
                        roles = {'owner': 'orion_pro_owner', 'writer': 'orion_pro_ingest', 'reader': 'orion_pro_runtime'} if is_source else {'owner': 'statarena_admin', 'writer': 'statarena_ingest', 'reader': 'statarena_runtime'}
                        journal = [[v, binding['inputs']['dashboard/backend/migrations/' + f], '2026-11-05 00:00:00+00', 'unobserved-boundary-only'] for v,f in [('012','012_orion_pro_domain.sql'),('013','013_orion_pro_integrity.sql'),*([('014','014_orion_pro_membership_nonnull.sql')] if not is_source else [])]]
                        descriptors.append({'kind': 'typed_native_p1_overlay_v1' if is_source else 'typed_native_p1_journal_v1',
                            'origin': 'owned_source_free_fixture' if is_source else 'owned_local_tls_target', 'roles': roles,
                            'endpoint': {'database': 'native_source' if is_source else 'native_target', 'actor': roles['reader' if is_source else 'writer'],
                                'serverVersion': 180006, 'postmasterStartedAt': '2026-11-05T00:00:00+00:00', 'tls': True},
                            'catalogueSha256': '0'*64, 'nativeCatalogueCounts': {'table':94,'column':1709,'view':46,'sequence':67},
                            'functionProperties': [None]*7, 'journal': journal, 'journalNativeSha256':'0'*64, 'bootstrapNativeText':'UNOBSERVED_SOURCE_FREE_METADATA'})
                    base_pair={'kind':'explicit_native_sql_transport_pair_v1','environment':'owned_local_tls','writerSha256':sha(WRITER),'bindingSha256':sha(BASE/'BINDINGS.json'),'source':descriptors[0],'target':descriptors[1]}
                    shape={'APPEARANCES':40,'SCALARS':1240,'MATCHES':4,'PLAYERS':40,'VERSION':FIXTURE_VERSION}
                    base_accept={'kind':'native_sql_transport_acceptance_v1','dataOrigin':'owned_source_free_fixture','writerSha256':sha(WRITER),'bindingsSha256':sha(BASE/'BINDINGS.json'),'modelSha256':sha(MODEL),'producerSha256':hashed({'fixtureCodeSha256':sha(FIXTURE),'testSha256':sha(Path(__file__)),'shape':shape}),'producerVersion':FIXTURE_VERSION,'sourceNativeSha256':hashed(native),'sourceTables':native,'sourceRows':0,'sourcePhases':[{'phase':'core','generation':2,'snapshotId':2,'runId':1,'manifest':'0'*64}],'sourceCheckpointSha256':'0'*64,'fullAcceptance':False,'fixture':{'codeSha256':sha(FIXTURE),'testSha256':sha(Path(__file__)),'version':FIXTURE_VERSION,'shape':shape}}
                    checks=[('valid_until_owned_marker',None,None,'OWNED_ENDPOINT'),
                            ('wrong_source_origin',lambda p:p['source'].update(origin='real_native_sql_checkpoint'),None,'BINDING'),
                            ('wrong_target_origin',lambda p:p['target'].update(origin='existing_rds_p1'),None,'BINDING'),
                            ('wrong_writer_actor',lambda p:p['target']['endpoint'].update(actor='statarena_admin'),None,'BINDING'),
                            ('unknown_pair_field',lambda p:p.update(host='external.invalid'),None,'BINDING'),
                            ('wrong_model',None,lambda a:a.update(modelSha256='0'*64),'BINDING'),
                            ('wrong_producer',None,lambda a:a.update(producerSha256='0'*64),'BINDING'),
                            ('wrong_journal_chain',lambda p:p['source']['journal'].append(p['target']['journal'][-1]),None,'BINDING'),
                            ('unclosed_acceptance',None,lambda a:a.update(localOnly=True),'BINDING')]
                    for label,pm,am,reason in checks:
                        p=json.loads(json.dumps(base_pair));a=json.loads(json.dumps(base_accept))
                        if pm:pm(p)
                        if am:am(a)
                        pp=run/(label+'-pair.json');aa=run/(label+'-acceptance.json');rr=run/(label+'-release.json')
                        save(pp,p);a['pairSha256']=sha(pp);save(aa,a)
                        save(rr,{'kind':'native_transport_operation_release_v1','scope':'owned_source_free_fixture','mode':'preflight-local','writerSha256':sha(WRITER),'bindingSha256':sha(BASE/'BINDINGS.json'),'pairSha256':sha(pp),'acceptanceSha256':sha(aa),'expiresAt':datetime.fromtimestamp(time.time()+600,timezone.utc).isoformat(),'fullAcceptance':False})
                        flags=['--preflight-local','--source-marker',run/'absent-owned-marker.json','--pair',pp,'--pair-sha256',sha(pp),'--acceptance',aa,'--acceptance-sha256',sha(aa),'--release',rr,'--release-sha256',sha(rr)]
                        got,data=cli(flags,label,tripwire=True);assert got.returncode!=0 and data['reasonCode']==reason and data['connections']==0,data
                        actual.append({'case':label,'reasonCode':reason,'connections':0})
                        if label == 'valid_until_owned_marker':
                            for remote_mode in ['--preflight-rds', '--apply-rds']:
                                remote_flags=[remote_mode,*flags[1:],'--target-passfile',run/'absent-private-auth']
                                got,data=cli(remote_flags,label+remote_mode,tripwire=True)
                                assert got.returncode!=0 and data['reasonCode']=='BINDING' and data['connections']==0,data
                                actual.append({'case':'fixture_rejected_by_'+remote_mode,'reasonCode':'BINDING','connections':0})
                elif name == 'campaign_release':
                    assert args.release and args.release_sha256 == sha(args.release), 'Exact ROOT PG allocation required'
                    release = json.loads(args.release.read_text())
                    assert release['kind'] == 'root_native_transport_local_campaign_v1' and release['approvedBy'] == 'ROOT'
                    assert release['writerSha256'] == sha(WRITER) and release['testSha256'] == sha(Path(__file__))
                    assert release['bindingsSha256'] == sha(BASE / 'BINDINGS.json') and release['protocolSha256'] == sha(BASE / 'PROTOCOL.md')
                    allocation = BASE / (release['allocationId'] + '.consumed.json')
                    assert not allocation.exists(), 'Allocation already consumed'
                    save(allocation, {'startedAt': report['startedAt'], 'run': str(run.relative_to(ROOT)), 'releaseSha256': sha(args.release)})
                    actual = release
                elif name == 'owned_tls_native_setup':
                    import psycopg
                    from harness import LocalPostgres
                    from orion_pro_migrate import bootstrap
                    from orion_pro_integrity import role_grants_sql
                    tempfile.tempdir = '/tmp'
                    pg = LocalPostgres(args.pg_bin, run)
                    def owned_command(argv, *, env=None, check=True, name='command'):
                        tick=time.monotonic();command=[str(v) for v in argv]
                        result=run_bounded(command,cwd=ROOT,env=env,deadline=deadline,stop_reason=budget_reason)
                        index=len(pg.commands)+1
                        entry={'argv':command,'exit_code':result.returncode,'elapsed_ms':round((time.monotonic()-tick)*1000,3),
                               'stdout':f'{index:03d}-{name}.stdout.log','stderr':f'{index:03d}-{name}.stderr.log'}
                        pg.commands.append(entry);(run/entry['stdout']).write_text(result.stdout);(run/entry['stderr']).write_text(result.stderr);save(run/'commands.json',pg.commands)
                        if check and result.returncode:raise RuntimeError(name+': '+result.stderr[-2000:])
                        return result
                    pg.command=owned_command
                    pg.command([args.pg_bin / 'initdb', '-D', pg.data, '--auth=trust', '--no-locale', '--encoding=UTF8'], name='initdb')
                    cert, key = pg.data / 'server.crt', pg.data / 'server.key'
                    pg.command(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '2', '-keyout', key, '-out', cert,
                                '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:' + 'statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com'], name='owned-tls')
                    key.chmod(0o600)
                    with (pg.data / 'postgresql.conf').open('a') as f:
                        f.write("\nssl=on\nssl_cert_file='server.crt'\nssl_key_file='server.key'\nstatement_timeout=8000\nlock_timeout=1000\ntemp_file_limit=128MB\nlog_error_verbosity=terse\nlog_min_error_statement=panic\nlog_parameter_max_length_on_error=0\n")
                    pg.start()
                    admin = connect('postgres', os.environ.get('USER', 'postgres'))
                    assert admin.info.server_version == 180006
                    for role in ['orion_pro_owner', 'orion_pro_ingest', 'orion_pro_runtime', 'statarena_admin', 'statarena_ingest', 'statarena_runtime']:
                        admin.execute('CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
                    for db, owner in [('native_source', 'orion_pro_owner'), ('native_target', 'statarena_admin')]:
                        admin.execute('CREATE DATABASE ' + db + ' OWNER ' + owner)
                    model = json.loads(MODEL.read_text())
                    tables = {t['qualified_name']: t for s in model['schemas'] for t in s['tables'] if t['phase'] != 'models'}
                    for db, owner, writer, reader in [('native_source', 'orion_pro_owner', 'orion_pro_ingest', 'orion_pro_runtime'), ('native_target', 'statarena_admin', 'statarena_ingest', 'statarena_runtime')]:
                        with connect(db, owner) as c:
                            with c.transaction():
                                artifacts = []
                                for version, filename in [('012', '012_orion_pro_domain.sql'), ('013', '013_orion_pro_integrity.sql')]:
                                    path = ROOT / 'dashboard/backend/migrations' / filename
                                    artifacts.append((version, path, path.read_text())); c.execute(path.read_text(), prepare=False)
                                    c.execute('INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,%s)', (version, sha(path), 'owned-native-transport-' + db))
                                bootstrap(c, model, artifacts); c.execute(role_grants_sql(model, writer, reader), prepare=False)
                            with c.transaction():
                                path = ROOT / 'dashboard/backend/migrations/014_orion_pro_membership_nonnull.sql'; c.execute(path.read_text(), prepare=False)
                                if db == 'native_target':
                                    c.execute('INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,%s)', ('014', sha(path), 'owned-native-transport-target14'))
                            c.execute('CREATE TABLE public.native_transport_legacy_sentinel(id integer PRIMARY KEY,value text)')
                            c.execute("INSERT INTO public.native_transport_legacy_sentinel VALUES(1,'legacy unchanged')")
                    module = load(WRITER, 'qualified_native_transport')
                    fm = load(FIXTURE, 'frozen_native_transport_fixture')
                    shape = {'APPEARANCES': 40, 'SCALARS': 1240, 'MATCHES': 4, 'PLAYERS': 40, 'VERSION': FIXTURE_VERSION}
                    producer = hashed({'fixtureCodeSha256': sha(FIXTURE), 'testSha256': sha(Path(__file__)), 'shape': shape})
                    fn = types.FunctionType(fm.fixture.__code__, {**fm.fixture.__globals__, **shape})
                    fixture_evidence = run / 'compact-source'; fixture_evidence.mkdir()
                    with connect('native_source', 'orion_pro_ingest') as c:
                        phases = fn(c, model, producer, fixture_evidence)
                    report['fixtureConstructions'] += 1
                    source = connect('native_source'); target = connect('native_target', 'statarena_admin')
                    marker = pg.root / 'native-marker.json'
                    save(marker, {'kind': 'owned_native_transport_pg18_v1', 'ownedRoot': str(pg.root), 'port': pg.port,
                                  'postmasterStartedAt': admin.execute('SELECT pg_postmaster_start_time()').fetchone()[0].isoformat(),
                                  'sourceDatabase': 'native_source', 'targetDatabase': 'native_target',
                                  'certificatePath': str(cert), 'certificateSha256': sha(cert)})
                    marker.chmod(0o600)
                    bind(); original_source = state(source); bootstrap_target = state(target)
                    actual = {'fixtureOrigin': 'owned_source_free_fixture', 'phases': phases, 'fixtureConstructions': 1}
                elif name == 'independent_endpoint_policies':
                    assert pair['source']['catalogueSha256'] != pair['target']['catalogueSha256']
                    assert len(pair['source']['journal']) == 2 and len(pair['target']['journal']) == 3
                    assert pair['source']['bootstrapNativeText'] != pair['target']['bootstrapNativeText']
                    actual = {'source': pair['source'], 'target': pair['target']}
                elif name == 'native94_sequence_metadata':
                    data = invoke(); assert data['nativeCatalogueCounts']['source']['table'] == 94
                    assert data['nativeCatalogueCounts']['target']['sequence'] == 67
                    assert data['sequenceValueSelects'] == 0
                    actual = data
                elif name == 'endpoint_actor_route_refusals':
                    import psycopg
                    old = marker.read_text(); bad = json.loads(old); bad['port'] += 1; save(marker, bad)
                    try: route = invoke(expected={'OWNED_ENDPOINT'})
                    finally: marker.write_text(old); marker.chmod(0o600)
                    poisoned = invoke(expected={'ENVIRONMENT'}, extra_env={'PGHOSTADDR': '203.0.113.4'})
                    with connect('native_target', 'statarena_runtime') as c:
                        try:
                            with c.cursor().copy('COPY ingest.sources(id,code,name) FROM STDIN') as cp: cp.write(b'999\tdenied\tdenied\n')
                        except psycopg.Error as e: assert e.sqlstate == '42501'
                        else: raise AssertionError('Runtime COPY must be denied')
                    assert state(target) == bootstrap_target
                    actual = {'route': route, 'poisonedRoute': poisoned, 'runtimeCopySqlstate': '42501'}
                elif name == 'source_and_policy_drift':
                    before = state(target)
                    bad = invoke(expected={'BINDING'}, mutate_acceptance=lambda a: a.update(producerSha256='0' * 64))
                    source.execute("UPDATE ingest.sources SET name=name||':drift' WHERE id=2")
                    try: drift = invoke(expected={'SOURCE_DRIFT'})
                    finally: source.execute("UPDATE ingest.sources SET name=left(name,length(name)-6) WHERE id=2")
                    target.execute('ALTER VIEW ingest.public_aliases_current SET (security_barrier=true)')
                    try: policy = invoke(expected={'TARGET_POLICY'})
                    finally: target.execute('ALTER VIEW ingest.public_aliases_current RESET (security_barrier)')
                    assert state(target) == before
                    actual = {'producer': bad, 'source': drift, 'targetPolicy': policy}
                elif name == 'foreign_target_bootstrap':
                    target.execute("INSERT INTO ingest.sources(id,code,name) OVERRIDING SYSTEM VALUE VALUES(999,'foreign','foreign')")
                    try: data = invoke(expected={'TARGET_DRIFT'})
                    finally: target.execute('DELETE FROM ingest.sources WHERE id=999')
                    assert state(target) == bootstrap_target; actual = data
                elif name == 'exact_preflight':
                    data = invoke(); assert data['controlComponents'] == 106 and data['status'] == 'preflight'
                    assert state(target) == bootstrap_target; actual = data
                elif name == 'mid_copy_rollback':
                    data = invoke(apply=True, fault='after-copy-batches:2', expected={'INJECTED_FAILURE'})
                    assert independent(target) == bootstrap_target['tables']; assert data['copyCommands'] == 2
                    actual = data
                elif name == 'deadline_rollback':
                    data = invoke(apply=True, fault='before-seal-timeout', expected={'NATIVE_TIMEOUT'})
                    assert data['sqlstate'] == '57014' and independent(target) == bootstrap_target['tables']; actual = data
                elif name == 'committed_core_resume':
                    first = invoke(apply=True, fault='after-core-commit', expected={'INJECTED_FAILURE'})
                    assert first['copiedScalarRows'] == 1240
                    resumed = invoke(apply=True); assert resumed['copiedScalarRows'] == 0 and resumed['reusedPhases'] == 1
                    actual = {'first': first, 'resumed': resumed}
                elif name == 'exact_native_controls':
                    data = invoke(); maps = {k: {int(s): d for s, d in data[k].items()} for k in ['generationMap', 'snapshotMap']}
                    with target.transaction():
                        target.execute('SET TRANSACTION READ ONLY')
                        transport = module.NativeTransport(source, target, pair, accepted, module.new_report(), sha(pair_path), module.fixed_bindings())
                        transport.maps_g = maps['generationMap']; transport.maps_s = maps['snapshotMap']
                        transport.target_bounds(); native = transport.business(target, inverse=True)
                    assert native == {n: v for n, v in original_source['tables'].items() if n not in module.CONTROL}
                    copied = sum(p['copied_rows'] for (p,) in target.execute('SELECT checkpoint FROM ingest.import_runs'))
                    source_count = sum(v['rows'] for n, v in original_source['tables'].items() if n in transport.matrix['copiedRelations'])
                    assert copied == source_count - 12, (copied, source_count)
                    assert independent(source) == original_source['tables']; actual = {'nativeBusinessRelations': 91, 'controls': 3, 'bootstrapRowsExcluded': 12, 'copiedRows': copied}
                elif name == 'technical_clocks':
                    rows = list(target.execute("SELECT r.started_at,r.finished_at,s.created_at,s.sealed_at,r.checkpoint->>'transaction_started_at' FROM ingest.import_runs r JOIN ingest.dataset_snapshots s ON s.id=(r.checkpoint->>'snapshot_id')::bigint"))
                    assert len(rows) == 2 and all(a == b == c == d == datetime.fromisoformat(e) for a,b,c,d,e in rows)
                    actual = {'phases': len(rows), 'allFourTransactionClocksExact': True}
                elif name == 'closed_checkpoint_corruption':
                    row = target.execute('SELECT id,checkpoint,counters FROM ingest.import_runs ORDER BY id LIMIT 1').fetchone()
                    results = []
                    for kind in ['unknown_key', 'count', 'checksum', 'clock']:
                        cp = json.loads(json.dumps(row[1])); counters = dict(row[2])
                        if kind == 'unknown_key': cp['foreign'] = True
                        elif kind == 'count': cp['copied_rows'] += 1; counters['copied_rows'] += 1
                        elif kind == 'clock': cp['transaction_started_at'] = '2000-01-01T00:00:00+00:00'
                        if kind == 'checksum': cp['receipt_sha256'] = '0' * 64
                        else: cp['receipt_sha256'] = hashed({k:v for k,v in cp.items() if k != 'receipt_sha256'})
                        target.execute('UPDATE ingest.import_runs SET checkpoint=%s::jsonb,counters=%s::jsonb WHERE id=%s', (json.dumps(cp), json.dumps(counters), row[0]))
                        try: results.append(invoke(expected={'TARGET_DRIFT'}))
                        finally: target.execute('UPDATE ingest.import_runs SET checkpoint=%s::jsonb,counters=%s::jsonb WHERE id=%s', (json.dumps(row[1]), json.dumps(row[2]), row[0]))
                    assert invoke(apply=True)['status'] == 'noop'; actual = {'corruptionsRefused': len(results)}
                elif name == 'lost_commit_ack':
                    # Restore target only through disposable owner setup; build no new source.
                    with connect('native_target', 'statarena_admin') as c:
                        c.execute('DROP SCHEMA analytics CASCADE; DROP SCHEMA football CASCADE; DROP SCHEMA ingest CASCADE', prepare=False)
                        with c.transaction():
                            from orion_pro_migrate import bootstrap
                            from orion_pro_integrity import role_grants_sql
                            artifacts=[]
                            for v,filename in [('012','012_orion_pro_domain.sql'),('013','013_orion_pro_integrity.sql')]:
                                path=ROOT/'dashboard/backend/migrations'/filename;artifacts.append((v,path,path.read_text()));c.execute(path.read_text(),prepare=False);c.execute('INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(v,sha(path),'owned-native-transport-native_target'))
                            bootstrap(c,model,artifacts);c.execute(role_grants_sql(model,'statarena_ingest','statarena_runtime'),prepare=False)
                        with c.transaction():
                            path=ROOT/'dashboard/backend/migrations/014_orion_pro_membership_nonnull.sql';c.execute(path.read_text(),prepare=False);c.execute('INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',('014',sha(path),'owned-native-transport-target14'))
                    bind()
                    lost = invoke(apply=True, fault='after-commit-ack', expected={'COMMIT_ACK_UNKNOWN'})
                    retry = invoke(apply=True); assert retry['copiedScalarRows'] == 0 and retry['reusedPhases'] == 1
                    actual = {'unknownAck': lost, 'newProcessResume': retry}
                elif name == 'noop_and_native_identity':
                    before=state(target);data=invoke(apply=True);assert data['status']=='noop' and data['copyCommands']==data['nextvalCalls']==0 and state(target)==before
                    maximum=source.execute('SELECT max(id) FROM football.players').fetchone()[0]
                    with connect('native_target','statarena_ingest') as c:
                        native_id=c.execute("INSERT INTO football.players(display_name) VALUES('native next identity') RETURNING id").fetchone()[0]
                    assert native_id>maximum;actual={'freshNoop':data,'nextNativeIdentity':native_id,'sourceMaximum':maximum}
                elif name == 'sourcefree_scope_cleanup':
                    assert report['fixtureConstructions']==1 and independent(source)==original_source['tables']
                    assert source.execute('TABLE public.native_transport_legacy_sentinel').fetchall()==target.execute('TABLE public.native_transport_legacy_sentinel').fetchall()==[(1,'legacy unchanged')]
                    actual={'remoteCalls':0,'sourceRamReads':0,'sourceUnchanged':True,'legacySentinelsUnchanged':True}
                report['cases'].append({'case': name, 'status': 'pass', 'elapsedMs': round((time.monotonic() - tick) * 1000, 3), 'actual': actual})
            except BaseException as exc:
                block = name + ': ' + str(exc)
                report['cases'].append({'case': name, 'status': 'fail', 'error': str(exc), 'traceback': traceback.format_exc()})
    finally:
        for c in [source, target, admin]:
            if c is not None: c.close()
        if pg is not None:
            report['cleanup'] = pg.cleanup()
        else:
            report['cleanup'] = {'pgStarted': False, 'connections': 0}
        report['elapsedSeconds'] = round(time.monotonic() - started, 3)
        report['resources'] = resources
        report['status'] = 'fail' if any(c['status'] == 'fail' for c in report['cases']) else 'pass_source_free_only' if not args.run_local else 'pass_owned_source_free_only'
        report['counts'] = {s: sum(c['status'] == s for c in report['cases']) for s in ['pass', 'fail', 'unverified']}
        report['currentInputHashesExact'] = all(sha(ROOT / p) == h for p, h in report['sourceSha256'].items())
        save(run / 'result.json', report)
        print(json.dumps({'status': report['status'], 'counts': report['counts'], 'evidence': str(run / 'result.json')}))
    return 1 if report['status'] == 'fail' else 0


if __name__ == '__main__':
    raise SystemExit(main())
