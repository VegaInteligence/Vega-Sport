#!/usr/bin/env python3
"""Pre-implementation, source-free PG18 bulk phase workflow. Never a cloud client."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/verification/orion-pro-bulk-20261104'
PILOT = ROOT / 'docs/verification/orion-pro-pilot-20261104'
SCRIPTS = ROOT / 'dashboard/scripts'
WRITER = SCRIPTS / 'orion_pro_bulk.py'
MODEL = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
SQL_FILES = [ROOT / 'dashboard/backend/migrations' / name for name in
             ['012_orion_pro_domain.sql', '013_orion_pro_integrity.sql']]
MODEL_SHA = '18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
NOW = datetime(2026, 11, 4, 17, 0, tzinfo=timezone.utc)
VERSION = 'source_free_bulk_fixture_v1'
CASES = ['implementation_available', 'owned_two_database_setup', 'default_readonly',
         'endpoint_marker_role_refusals', 'bindings_and_source_drift', 'bootstrap_collision',
         'reservation_bound_refusal', 'ambiguous_source_and_cycle', 'typed_corruption_phase_oracle', 'mid_phase_rollback_sequence_gaps',
         'retry_committed_prefix', 'new_process_resume', 'independent_94_table_oracle',
         'exact_jsonb_and_native_states', 'complete_noop', 'next_native_identity',
         'corrupt_receipt_refusal', 'native_guards_and_json_kinds',
         'closed_history_refusal', 'deadline_rollback', 'no_publish_legacy_cleanup']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hashed(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def q(name):
    assert re.fullmatch('[a-z_][a-z0-9_]*', name), name
    return '"' + name + '"'


def rel(name):
    return '.'.join(q(part) for part in name.split('.'))


CATALOGUE_SQL = """SELECT kind,key,definition FROM (
 SELECT 'table' kind,n.nspname||'.'||c.relname key,ROW(c.relkind,c.relrowsecurity,pg_get_userbyid(c.relowner),c.relacl::text)::text definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind IN ('r','p')
 UNION ALL SELECT 'column',n.nspname||'.'||c.relname||'.'||a.attnum,ROW(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,pg_get_expr(d.adbin,d.adrelid),a.attacl::text)::text
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'constraint',n.nspname||'.'||c.relname||'.'||k.conname,pg_get_constraintdef(k.oid)
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics')
 UNION ALL SELECT 'index',schemaname||'.'||indexname,indexdef FROM pg_indexes WHERE schemaname IN ('ingest','football','analytics')
 UNION ALL SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,ROW(t.tgenabled,pg_get_triggerdef(t.oid))::text
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND NOT t.tgisinternal
 UNION ALL SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',ROW(pg_get_functiondef(p.oid),p.proacl::text,pg_get_userbyid(p.proowner))::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('ingest','football','analytics')
 UNION ALL SELECT 'sequence',schemaname||'.'||sequencename,ROW(start_value,min_value,max_value,increment_by,cycle,cache_size)::text FROM pg_sequences WHERE schemaname IN ('ingest','football','analytics')
) catalog ORDER BY kind,key"""


def catalogue_sha(conn):
    h = hashlib.sha256()
    for row in conn.execute(CATALOGUE_SQL):
        for value in row:
            body = value.encode(); h.update(str(len(body)).encode() + b':' + body + b'\n')
    return h.hexdigest()


def native_rows(conn, table, definitions, substitutions=None):
    """Independent SQL-native oracle: no producer/importer JSON adapter or row export."""
    columns = list(definitions[table]['columns'])
    projection = [(substitutions or {}).get(c, q(c)) for c in columns]
    order = ','.join(q(c) for c in definitions[table]['primary_key']['columns'])
    sql = f"SELECT ROW({','.join(projection)})::text FROM {rel(table)} ORDER BY {order}"
    h = hashlib.sha256(); count = 0
    with conn.cursor(name='oracle_' + str(time.monotonic_ns())) as cursor:
        cursor.execute(sql)
        for batch in iter(lambda: cursor.fetchmany(500), []):
            for row in batch:
                body = row[0].encode(); h.update(str(len(body)).encode() + b':' + body + b'\n'); count += 1
    return {'rows': count, 'sha256': h.hexdigest()}


def oracle(conn, definitions, substitutions=None):
    with conn.transaction():
        return {name: native_rows(conn, name, definitions, (substitutions or {}).get(name)) for name in sorted(definitions)}


def sequences(admin):
    names = [r[0] for r in admin.execute("SELECT schemaname||'.'||sequencename FROM pg_sequences WHERE schemaname IN ('ingest','football','analytics') ORDER BY 1")]
    assert len(names) == 67
    return {name: list(admin.execute(f'SELECT last_value,is_called FROM {rel(name)}').fetchone()) for name in names}


def state(admin, definitions):
    return {'tables': oracle(admin, definitions), 'sequences': sequences(admin)}


def fixture(conn, model, test_sha):
    """Native-only fixture, no HTTP input and no corrective positive phase."""
    tables = {t['qualified_name']: t for s in model['schemas'] for t in s['tables']}
    g = None

    def insert(table_name, **values):
        name = table_name
        common = {'contract_version': VERSION, 'transform_version': VERSION,
                  'transform_code_sha256': test_sha, 'canonical_policy_version': VERSION,
                  'variant_key': 'bulk:primary', 'is_canonical': True, 'provenance_kind': 'manual',
                  'recorded_from_gen': g, 'raw_position_code_state': 'absent', 'shirt_number_state': 'absent'}
        data = {k: v for k, v in common.items() if k in tables[name]['columns']}; data.update(values)
        if data.get('source_id') is not None and data.get('source_record_id') is not None and 'provenance_kind' in data:
            data['provenance_kind'] = 'provider'
        placeholders = ['%s::jsonb' if tables[name]['columns'][c]['type'] == 'jsonb' else '%s' for c in data]
        sql = f"INSERT INTO {rel(name)} ({','.join(q(c) for c in data)}) OVERRIDING SYSTEM VALUE VALUES ({','.join(placeholders)}) RETURNING *"
        cur = conn.execute(sql, tuple(data.values())); return dict(zip([c.name for c in cur.description], cur.fetchone()))

    def document(identifier, run, key):
        return insert('ingest.source_documents', id=identifier, source_id=2, dataset_id=3,
                      import_run_id=run, content_sha256=hashed(key), request_fingerprint=hashed('request:' + key),
                      retrieved_at=NOW, source_updated_at=NOW, source_url='https://fixture.invalid/' + key,
                      legacy_object_path='fixture:' + key)

    phases = []

    def finish(phase, run, paths):
        snapshot_id = conn.execute('SELECT id FROM ingest.dataset_snapshots WHERE generation=%s', (g,)).fetchone()[0]
        docs = sorted((row['legacy_object_path'], row['content_sha256']) for row in paths)
        binding = {'kind': 'orion_pro_phase_receipt_v2', 'phase': phase, 'transform_sha256': test_sha,
                   'transform_version': VERSION, 'model_sha256': sha(MODEL), 'source_document_count': len(docs),
                   'source_document_manifest_sha256': hashed(docs), 'selector_manifest_sha256': hashed(['native fixture', phase])}
        binding['input_manifest_sha256'] = hashed(binding)
        report = {'native_fixture_only': True, 'phase': phase, 'metric_rows': 10001 if phase == 'core' else 0}
        checkpoint = {'kind': binding['kind'], 'phase': phase, 'receipt_key': 'fixture:' + phase,
                      'binding': binding, 'generation': g, 'snapshot_id': snapshot_id,
                      'report': report, 'report_sha256': hashed(report)}
        conn.execute("UPDATE ingest.import_runs SET status='partial',finished_at=%s,checkpoint=%s::jsonb,counters=%s::jsonb WHERE id=%s",
                     (NOW, json.dumps(checkpoint), '{"full_acceptance":false,"native_fixture_only":true}', run))
        for doc in paths:
            conn.execute('INSERT INTO ingest.dataset_snapshot_documents(snapshot_id,document_id) VALUES(%s,%s)', (snapshot_id, doc['id']))
        manifest = hashed({'input_manifest_sha256': binding['input_manifest_sha256'], 'report_sha256': checkpoint['report_sha256']})
        conn.execute('SELECT ingest.seal_generation(%s,%s)', (g, manifest))
        phases.append({'phase': phase, 'generation': g, 'snapshotId': snapshot_id, 'runId': run, 'manifest': manifest})

    with conn.transaction():
        g = conn.execute('SELECT ingest.begin_generation(%s,%s,%s,%s)', ('fixture:core', VERSION, VERSION + ':core-policy', NOW)).fetchone()[0]
        for name, table in tables.items():
            if table['phase'] != 'models' and 'relation_code' in table['columns'] and 'contract_version' in table['columns']:
                conn.execute('INSERT INTO ingest.relation_contracts(relation_code,relation_name,contract_version,grain_definition) VALUES(%s,%s,%s,%s)',
                             (name, name, VERSION, table['grain']))
        insert('ingest.sources', id=10, code='bulk_upstream', name='Upstream fixture', created_at=NOW)
        insert('ingest.sources', id=2, code='bulk_primary', name='Native fixture', upstream_source_id=10, created_at=NOW)
        insert('ingest.source_datasets', id=3, source_id=2, dataset_key='bulk_native', contract_version=VERSION)
        insert('ingest.import_runs', id=7, mode='backfill', transform_version=VERSION, code_commit=test_sha, started_at=NOW)
        d1 = document(11, 7, 'core'); d2 = document(12, 7, 'derived')
        precise = '{"large":12345678901234567890123456789,"fraction":0.123456789012345678901234567890123456789,"null":null,"text":"null","array":[null,"",false,0],"empty":""}'
        insert('ingest.document_lineage', derived_document_id=12, parent_document_id=11, transform_version=VERSION, parameters=precise)
        insert('ingest.source_records', id=41, source_id=2, document_id=11, locator_kind='whole_document', locator='', record_kind='native_fixture', external_key='core')
        insert('ingest.resource_fetches', id=17, run_id=7, source_id=2, endpoint='/native/core', request_fingerprint=hashed('fetch-core'), attempt_no=1,
               requested_at=NOW, finished_at=NOW, http_status=200, response_state='available', document_id=11)
        insert('football.teams', id=20, slug='bulk-home', name='', team_type='club', gender='men')
        insert('football.teams', id=30, slug='bulk-away', name='Away', team_type='club', gender='men')
        insert('football.players', id=40, display_name='Native player')
        insert('football.players', id=41, display_name='Second player')
        profile = insert('football.player_profile_versions', id=50, player_id=40, display_name='', observed_at=NOW,
                         external_profile_version_id='native-40', profile_content_sha256=hashed('native profile'), profile_context='global')
        competition = insert('football.competitions', id=100, name='Native league', slug='bulk-league', competition_type='league', gender='men')
        edition = insert('football.competition_seasons', id=101, competition_id=100, competition_revision_id=competition['revision_id'],
                         season_key='2026/2027', label='Native season', status='active')
        match = insert('football.matches', id=200, competition_season_id=101, competition_season_revision_id=edition['revision_id'],
                       kickoff_precision='date', match_date=NOW.date(), status='finished', publication_state='draft', source_id=2, source_record_id=41)
        home = insert('football.match_teams', match_id=200, match_revision_id=match['revision_id'], side='home', team_id=20)
        insert('football.match_teams', match_id=200, match_revision_id=match['revision_id'], side='away', team_id=30)
        player = insert('football.match_players', match_id=200, team_id=20, player_id=40, profile_version_id=profile['id'], match_team_revision_id=home['revision_id'],
                        squad_status='starter', played=True, participation_evidence='native fixture', source_id=2, source_record_id=41)
        insert('football.metric_definitions', code='native_scalar', label='Native scalar', definition='Typed scalar states for bulk protocol', unit='fixture',
               scope='player', aggregation='none', allows_negative=True, definition_version=VERSION)
        # A child before its parent in lexical PK order forces row-level self-reference ordering in the writer.
        insert('football.metric_definitions', code='z_base', label='Base', definition='Base scalar', unit='fixture', scope='player', aggregation='sum', allows_negative=False, definition_version=VERSION)
        insert('football.metric_definitions', code='a_ratio', label='Ratio', definition='Explicit ratio', unit='fixture', scope='player', aggregation='ratio_of_sums', allows_negative=False,
               numerator_code='z_base', numerator_definition_version=VERSION, denominator_code='z_base', denominator_definition_version=VERSION, definition_version=VERSION)
        conn.execute("""INSERT INTO football.player_match_metric_values
            (match_id,player_id,team_id,period_code,period_definition_version,family_code,metric_code,metric_definition_version,
             value_kind,numeric_value,text_value,boolean_value,numerator,denominator,source_display,source_record_id,
             recorded_from_gen,variant_key,is_canonical,contract_version,transform_version,transform_code_sha256,source_id,provenance_kind,match_player_revision_id)
            SELECT 200,40,20,'full_match','bootstrap_v1','standard','native_scalar',%s,
             (ARRAY['number','string','boolean','null','absent'])[i%%5+1],
             CASE WHEN i%%5=0 THEN 12345678901234567890123456789.1234567890123456789::numeric END,
             CASE WHEN i%%5=1 THEN '' END,CASE WHEN i%%5=2 THEN false END,
             CASE WHEN i%%5=0 THEN 12345678901234567890123456789::numeric END,
             CASE WHEN i%%5=0 THEN 37::numeric END,CASE WHEN i%%5=0 THEN 'native fraction' END,41,
             %s,'bulk:'||i,i=0,%s,%s,%s,2,'provider',%s FROM generate_series(0,10000) i""",
             (VERSION, g, VERSION, VERSION, test_sha, player['revision_id']))
        finish('core', 7, [d1, d2])
    with conn.transaction():
        g = conn.execute('SELECT ingest.begin_generation(%s,%s,%s,%s)', ('fixture:families', VERSION, VERSION + ':family-policy', NOW)).fetchone()[0]
        insert('ingest.import_runs', id=13, mode='backfill', transform_version=VERSION, code_commit=test_sha, started_at=NOW)
        d3 = document(31, 13, 'families')
        insert('ingest.source_records', id=61, source_id=2, document_id=31, locator_kind='whole_document', locator='', record_kind='native_fixture', external_key='families')
        insert('ingest.quality_issues', id=19, run_id=13, source_record_id=61, rule_code='native_precision', severity='info', context=precise, detected_at=NOW)
        for feature in ['events', 'momentum', 'h2h']:
            insert('ingest.match_coverage', match_id=200, match_revision_id=match['revision_id'], source_id=2, source_record_id=61, document_id=31,
                   feature_code=feature, coverage_state='available', collection_state='present', observed_row_count=1, checked_at=NOW)
        insert('football.match_events', match_id=200, match_revision_id=match['revision_id'], event_seq=0, source_ordinal=0, event_type='',
               source_id=2, source_record_id=61, feature_code='events')
        insert('football.match_momentum', match_id=200, match_revision_id=match['revision_id'], series_code='home', sample_index=0, value=0,
               source_id=2, source_record_id=61, feature_code='momentum')
        insert('football.match_h2h_entries', match_id=200, match_revision_id=match['revision_id'], entry_ordinal=0, source_id=2, source_record_id=61, feature_code='h2h')
        heatmap = insert('football.match_heatmaps', match_id=200, team_id=20, match_team_revision_id=home['revision_id'], period_code='full_match',
                         period_definition_version='bootstrap_v1', map_kind='touches', grid_columns=2, grid_rows=2, cell_length_m=5.0, cell_width_m=5.0,
                         coordinate_frame='pitch_m', cells_state='available')
        insert('football.match_heatmap_cells', heatmap_id=heatmap['id'], cell_ordinal=0, column_index=0, row_index=0, action_count=0)
        network = insert('football.pass_networks', match_id=200, team_id=20, match_team_revision_id=home['revision_id'], window_kind='full_match')
        for pid in [40, 41]: insert('football.pass_network_nodes', network_id=network['id'], player_id=pid)
        insert('football.pass_network_edges', network_id=network['id'], from_player_id=40, to_player_id=41, passes=1)
        standing = insert('football.standing_snapshots', competition_season_id=101, competition_season_revision_id=edition['revision_id'], scope='overall', observed_at=NOW,
                          source_id=2, source_record_id=61, data_revision=1)
        insert('football.standing_rows', snapshot_id=standing['id'], team_id=20, rank=1, points=0, played=0)
        system = insert('football.ranking_systems', code='bulk_rank', authority='Native fixture', subject_kind='team', gender='men', methodology_version=VERSION)
        ranking = insert('football.ranking_snapshots', system_id=system['id'], subject_kind='team', edition_key='native', retrieved_at=NOW, revision=1, source_document_id=31)
        insert('football.team_ranking_entries', snapshot_id=ranking['id'], team_id=20, rank=1, points=0, source_record_id=61)
        insert('football.match_observation_details', source_record_id=61, resolution_state='resolved', match_id=200, match_revision_id=match['revision_id'], source_home_label='')
        finish('families', 13, [d3])
    return phases


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--label', default='bulk-e2e')
    parser.add_argument('--pg-bin', type=Path, default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'))
    args = parser.parse_args()
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}', args.label): parser.error('Use a simple label')
    sys.path[:0] = [str(SCRIPTS), str(PILOT), '/tmp/statarena-publication-test-python']
    import psycopg
    from psycopg.conninfo import make_conninfo
    from harness import LocalPostgres
    from orion_pro_integrity import role_grants_sql
    from orion_pro_migrate import bootstrap
    model = json.loads(MODEL.read_text())
    tables = {t['qualified_name']: t for s in model['schemas'] for t in s['tables'] if t['phase'] != 'models'}
    run = BASE / 'runs' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + args.label)
    inputs = run / 'inputs'; inputs.mkdir(parents=True)
    files = [Path(__file__), WRITER, MODEL, BASE / 'PROTOCOL.md', BASE / 'PLAN.md', *SQL_FILES,
             PILOT / 'harness.py', SCRIPTS / 'orion_pro_migrate.py', SCRIPTS / 'orion_pro_schema.py', SCRIPTS / 'orion_pro_integrity.py']
    report = {'kind': 'source_free_two_owned_db_bulk_e2e', 'command': ['python3', 'tests/orion_pro_bulk_local.py', *sys.argv[1:]],
              'startedAt': datetime.now(timezone.utc).isoformat(), 'setup': 'Owned loopback PG18.6; source + destination; exact sealed 012/013; ordinary source/ingest/runtime actors',
              'expected': 'PROTOCOL.md pre-code workflow matrix', 'sourceSha256': {}, 'cases': [], 'invocations': [], 'remoteActions': [],
              'limitations': ['No RDS connection or remote data import', 'Native fixture only; not real-source completeness or purge acceptance',
                              'Closed history refused; WAN throughput and real-candidate eight-second seal unverified'], 'fullAcceptance': False}
    for path in files:
        if path.exists():
            dest = inputs / path.relative_to(ROOT); dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(path, dest)
            report['sourceSha256'][str(path.relative_to(ROOT))] = sha(path)
    pg = None; admin = source = target = source_writer = None; blocker = None; acceptance = None
    marker = run / 'owned-local-marker.json'; acceptance_path = run / 'acceptance.json'
    env = {k: v for k, v in os.environ.items() if k in ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'DYLD_LIBRARY_PATH', 'PYTHONPATH']}

    def install(conn, journal_commit='source-free-bulk-fixture-install'):
        conn.execute("SET TimeZone='UTC'")
        conn.execute("SET DateStyle='ISO, YMD'")
        conn.execute("SET IntervalStyle='iso_8601'")
        conn.execute('SET extra_float_digits=3')
        artifacts = [(v, path, path.read_text()) for v, path in zip(['012', '013'], SQL_FILES)]
        with conn.transaction():
            for version, path, body in artifacts:
                conn.execute(body, prepare=False)
                conn.execute('INSERT INTO ingest.schema_migrations(version,content_sha256,applied_at,code_commit) VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',
                             (version, sha(path), journal_commit))
            bootstrap(conn, model, artifacts)
            conn.execute(role_grants_sql(model, ingest_role='bulk_ingest', runtime_role='bulk_runtime'), prepare=False)
            conn.execute('CREATE TABLE public.bulk_legacy_sentinel(id integer PRIMARY KEY,value text NOT NULL)')
            conn.execute("INSERT INTO public.bulk_legacy_sentinel VALUES(1,'untouched historical publication')")
        conn.execute("SET statement_timeout='8s'"); conn.execute("SET lock_timeout='1s'")

    def reset_target(journal_commit='source-free-bulk-fixture-install'):
        nonlocal target
        if target: target.close()
        admin.execute('DROP DATABASE IF EXISTS bulk_destination WITH (FORCE)')
        admin.execute('CREATE DATABASE bulk_destination')
        target = psycopg.connect(make_conninfo(pg.dsn, dbname='bulk_destination'), autocommit=True); install(target, journal_commit)
        # Legal allocation+rollback gives distinct snapshot and generation maps, with no reset.
        writer = psycopg.connect(env['ORION_BULK_TARGET_DSN'], autocommit=True)
        try:
            # A legal USAGE allocation makes snapshot IDs differ from generation numbers too.
            writer.execute("SELECT nextval('ingest.dataset_snapshots_id_seq')")
            try:
                with writer.transaction():
                    writer.execute('SELECT ingest.begin_generation(%s,%s,%s)', ('deliberate-gap', VERSION, VERSION))
                    raise RuntimeError('fixture rollback')
            except RuntimeError: pass
        finally: writer.close()

    def acceptance_for_source():
        native = oracle(source, tables)
        return {'kind': 'orion_pro_bulk_local_acceptance_v1', 'localOnly': True, 'modelSha256': sha(MODEL),
                'sqlSha256': {p.name: sha(p) for p in SQL_FILES}, 'writerSha256': sha(WRITER),
                'producerSha256': sha(Path(__file__)), 'producerVersion': VERSION, 'sourceNativeSha256': hashed(native),
                'catalogueSha256': catalogue_sha(source),
                'sourceRows': sum(v['rows'] for v in native.values()), 'sourceTables': native,
                'sourcePhases': report['fixturePhases']}

    def save_acceptance(value=None):
        acceptance_path.write_text(json.dumps(value or acceptance, indent=2) + '\n')

    def invoke(label, *, apply=False, fault=None, overrides=None, accepted=None):
        save_acceptance(accepted)
        destination = run / ('invoke-' + str(len(report['invocations']) + 1) + '-' + label + '.json')
        command = ['python3', str(WRITER), '--marker', str(marker), '--acceptance', str(acceptance_path), '--report', str(destination)]
        if apply: command += ['--apply-local']
        if fault: command += ['--fault', fault]
        start = time.monotonic()
        proc = subprocess.run(command, env={**env, **(overrides or {})}, capture_output=True, text=True, timeout=120)
        elapsed = round((time.monotonic() - start) * 1000, 3)
        if not destination.exists(): raise AssertionError('Writer returned no metadata receipt: ' + proc.stderr[-400:])
        value = json.loads(destination.read_text())
        report['invocations'].append({'label': label, 'argv': [str(WRITER.relative_to(ROOT)), *command[2:]], 'exitCode': proc.returncode,
                                      'elapsedMs': elapsed, 'receipt': destination.name, 'status': value.get('status'),
                                      'stdoutSha256': hashlib.sha256(proc.stdout.encode()).hexdigest(), 'stderrSha256': hashlib.sha256(proc.stderr.encode()).hexdigest()})
        return proc.returncode, value

    def refused(label, *, reason=None, **kwargs):
        before = state(target, tables); code, value = invoke(label, **kwargs)
        assert code != 0 and value['status'] == 'refused', value
        if reason: assert value['reasonCode'] == reason, value
        assert state(target, tables) == before, 'Refusal modified target rows or sequences'
        return value['reasonCode']

    try:
        assert sha(MODEL) == MODEL_SHA
        for name in CASES:
            if blocker:
                report['cases'].append({'case': name, 'status': 'unverified', 'reason': blocker}); continue
            try:
                actual = {}
                if name == 'implementation_available':
                    assert WRITER.is_file(), 'Required bulk importer implementation is absent'
                    actual = {'writerSha256': sha(WRITER), 'e2eSha256': sha(Path(__file__))}
                elif name == 'owned_two_database_setup':
                    pg = LocalPostgres(args.pg_bin, run)
                    pg.command([pg.binaries / 'initdb', '-D', pg.data, '--auth=trust', '--no-locale', '--encoding=UTF8'], name='initdb')
                    with (pg.data / 'postgresql.conf').open('a') as f:
                        f.write("\nlog_error_verbosity=terse\nlog_min_error_statement=panic\nlog_parameter_max_length_on_error=0\n")
                    pg.start(); admin = psycopg.connect(pg.dsn, autocommit=True)
                    assert admin.info.server_version == 180006
                    for role in ['bulk_ingest', 'bulk_runtime']:
                        admin.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
                    admin.execute('CREATE DATABASE bulk_source')
                    source = psycopg.connect(make_conninfo(pg.dsn, dbname='bulk_source'), autocommit=True); install(source)
                    env.update(ORION_BULK_SOURCE_DSN=make_conninfo(pg.dsn, dbname='bulk_source', user='bulk_runtime'),
                               ORION_BULK_TARGET_DSN=make_conninfo(pg.dsn, dbname='bulk_destination', user='bulk_ingest'))
                    reset_target()
                    source_writer = psycopg.connect(make_conninfo(pg.dsn, dbname='bulk_source', user='bulk_ingest'), autocommit=True)
                    source_writer.execute("SET statement_timeout='8s'"); source_writer.execute("SET lock_timeout='1s'")
                    report['fixturePhases'] = fixture(source_writer, model, sha(Path(__file__)))
                    marker.write_text(json.dumps({'kind': 'orion_pro_owned_bulk_local_v1', 'ownerUid': os.getuid(), 'dataDirectory': str(pg.data),
                                                  'port': pg.port, 'pid': int((pg.data / 'postmaster.pid').read_text().splitlines()[0]),
                                                  'postmasterStartedAt': admin.execute('SELECT pg_postmaster_start_time()::text').fetchone()[0],
                                                  'sourceDatabase': 'bulk_source', 'targetDatabase': 'bulk_destination'}, indent=2) + '\n')
                    acceptance = acceptance_for_source(); save_acceptance()
                    report['sourceNativeOracle'] = acceptance['sourceTables']; report['targetBaseline'] = state(target, tables)
                    actual = {'serverVersion': 180006, 'tables': len(tables), 'sourceRows': acceptance['sourceRows'], 'phases': report['fixturePhases']}
                elif name == 'default_readonly':
                    before = state(target, tables); code, value = invoke('plan-default')
                    assert code == 0 and value['status'] == 'planned', value
                    assert state(target, tables) == before
                    assert value['sourceNativeSha256'] == acceptance['sourceNativeSha256']
                    actual = {'zeroTargetMutation': True, 'plan': value}
                elif name == 'endpoint_marker_role_refusals':
                    actual['remote'] = refused('remote', overrides={'ORION_BULK_SOURCE_DSN': 'host=198.51.100.1 dbname=forbidden user=forbidden'}, reason='LOCAL_ONLY')
                    actual['sameDb'] = refused('same-db', overrides={'ORION_BULK_SOURCE_DSN': env['ORION_BULK_TARGET_DSN']}, reason='LOCAL_ONLY')
                    original = marker.read_text(); bad = json.loads(original); bad['pid'] += 999999; marker.write_text(json.dumps(bad))
                    try: actual['marker'] = refused('bad-marker', reason='OWNED_MARKER')
                    finally: marker.write_text(original)
                    runtime = make_conninfo(pg.dsn, dbname='bulk_destination', user='bulk_runtime')
                    actual['runtime'] = refused('runtime', apply=True, overrides={'ORION_BULK_TARGET_DSN': runtime}, reason='WRITER_ROLE')
                    runtime_conn = psycopg.connect(runtime, autocommit=True); denied = []
                    try:
                        for statement in ["SELECT ingest.begin_generation('runtime-denied','test','test')", "SELECT ingest.seal_generation(1,repeat('0',64))",
                                          "SELECT nextval('football.teams_id_seq')", "SELECT nextval('ingest.commit_generation_seq')"]:
                            try:
                                with runtime_conn.transaction():
                                    runtime_conn.execute(statement)
                                    raise AssertionError('Runtime statement was unexpectedly authorized')
                            except psycopg.Error as exc:
                                assert exc.sqlstate == '42501'; denied.append(exc.sqlstate)
                        try:
                            with runtime_conn.transaction():
                                with runtime_conn.cursor().copy('COPY football.teams(id,slug,name,team_type,gender) FROM STDIN'): pass
                                raise AssertionError('Runtime COPY was unexpectedly authorized')
                        except psycopg.Error as exc:
                            assert exc.sqlstate == '42501'; denied.append(exc.sqlstate)
                    finally: runtime_conn.close()
                    actual['nativeRuntimeSqlstates'] = denied
                    owner = make_conninfo(pg.dsn, dbname='bulk_destination')
                    actual['admin'] = refused('admin', apply=True, overrides={'ORION_BULK_TARGET_DSN': owner}, reason='PRIVILEGED_ROLE')
                elif name == 'bindings_and_source_drift':
                    for field in ['writerSha256', 'producerSha256', 'modelSha256']:
                        bad = {**acceptance, field: '0' * 64}; actual[field] = refused('bad-' + field, accepted=bad, apply=True, reason='BINDING')
                    source_writer.execute("UPDATE ingest.sources SET name='changed' WHERE id=2")
                    try: actual['sourceDrift'] = refused('source-drift', apply=True, reason='SOURCE_DRIFT')
                    finally: source_writer.execute("UPDATE ingest.sources SET name='Native fixture' WHERE id=2")
                elif name == 'bootstrap_collision':
                    # Journal is append-only even for the fixture owner: install a separate negative baseline, never rewrite it.
                    reset_target('unaccepted-install')
                    actual['journal'] = refused('journal', apply=True, reason='BASELINE')
                    reset_target()
                    target.execute("INSERT INTO football.teams(id,slug,name,team_type,gender) OVERRIDING SYSTEM VALUE VALUES(20,'collision','collision','club','men')")
                    actual['collision'] = refused('collision', apply=True, reason='TARGET_DRIFT')
                    reset_target()
                elif name == 'reservation_bound_refusal':
                    source_writer.execute("INSERT INTO ingest.sources(id,code,name) OVERRIDING SYSTEM VALUE VALUES(1000001,'sparse','sparse')")
                    bad = acceptance_for_source()
                    try: actual['reason'] = refused('sparse-id', accepted=bad, apply=True, reason='RESERVATION_BOUND')
                    finally: source.execute('DELETE FROM ingest.sources WHERE id=1000001')
                elif name == 'ambiguous_source_and_cycle':
                    source_writer.execute("INSERT INTO ingest.quality_issues(id,rule_code,severity) OVERRIDING SYSTEM VALUE VALUES(99,'unowned','info')")
                    try: actual['unknownOwner'] = refused('unknown-owner', accepted=acceptance_for_source(), apply=True, reason='PHASE_OWNERSHIP')
                    finally: source.execute('DELETE FROM ingest.quality_issues WHERE id=99')
                    try:
                        source_writer.execute('UPDATE ingest.sources SET upstream_source_id=2 WHERE id=10')
                    except psycopg.Error as exc:
                        assert exc.sqlstate in {'23514', '55000'}; actual['cycle'] = {'nativeRejected': exc.sqlstate}
                    else:
                        try: actual['cycle'] = refused('self-cycle', accepted=acceptance_for_source(), apply=True, reason='SELF_CYCLE')
                        finally: source_writer.execute('UPDATE ingest.sources SET upstream_source_id=NULL WHERE id=10')
                elif name == 'typed_corruption_phase_oracle':
                    before = state(target, tables); code, value = invoke('typed-corruption', apply=True, fault='corrupt-first-scalar')
                    assert code != 0 and value['status'] == 'failed' and value['reasonCode'] == 'PHASE_ORACLE', value
                    assert state(target, tables)['tables'] == before['tables']
                    actual = {'validTypedWrongValueCaughtBeforeSeal': True, 'phaseRolledBack': True}
                elif name == 'mid_phase_rollback_sequence_gaps':
                    before = state(target, tables); code, value = invoke('midphase', apply=True, fault='after-copy-chunks:2')
                    assert code != 0 and value['status'] == 'failed', value
                    after = state(target, tables); assert after['tables'] == before['tables']
                    assert after['sequences']['ingest.commit_generation_seq'][0] > before['sequences']['ingest.commit_generation_seq'][0]
                    assert after['sequences']['ingest.dataset_snapshots_id_seq'][0] > before['sequences']['ingest.dataset_snapshots_id_seq'][0]
                    actual = {'rollbackRowsExact': True, 'sequenceGaps': {n: [before['sequences'][n], after['sequences'][n]] for n in before['sequences'] if before['sequences'][n] != after['sequences'][n]}}
                elif name == 'retry_committed_prefix':
                    code, value = invoke('prefix-stop', apply=True, fault='after-phase:1')
                    assert code != 0 and value['status'] == 'failed' and len(value['completedPhases']) == 1, value
                    assert target.execute('SELECT count(*) FROM football.player_match_metric_values').fetchone()[0] == 10001
                    assert target.execute('SELECT count(*) FROM football.match_events').fetchone()[0] == 0
                    report['prefixReceipt'] = value; actual = {'committedPrefix': value['completedPhases']}
                elif name == 'new_process_resume':
                    code, value = invoke('resume', apply=True)
                    assert code == 0 and value['status'] == 'applied' and value['reusedPhases'] == 1, value
                    report['applyReceipt'] = value
                    actual = {'phaseMaps': value['completedPhases'], 'reusedPhases': 1}
                elif name == 'independent_94_table_oracle':
                    maps = report['applyReceipt']['completedPhases']
                    gm = {int(p['sourceGeneration']): int(p['generation']) for p in maps}; gm[1] = 1
                    sm = {int(p['sourceSnapshotId']): int(p['snapshotId']) for p in maps}; sm[1] = 1
                    assert any(s != d for s, d in gm.items()) and any(s != d for s, d in sm.items())
                    assert any(p['generation'] != p['snapshotId'] for p in maps), 'Fixture must distinguish generation and snapshot maps'
                    control_columns = {('ingest.dataset_snapshots', 'generation'): gm, ('ingest.dataset_snapshots', 'id'): sm}
                    changed = True
                    while changed:
                        changed = False
                        for table, definition in tables.items():
                            for fk in definition['foreign_keys']:
                                for column, ref in zip(fk['columns'], fk['references']['columns']):
                                    parent = (fk['references']['table'], ref); child = (table, column)
                                    if parent in control_columns and child not in control_columns:
                                        control_columns[child] = control_columns[parent]; changed = True
                    substitutions = {}
                    for table, definition in tables.items():
                        changes = {}
                        for column in definition['columns']:
                            if (table, column) in control_columns:
                                mapping = control_columns[(table, column)]
                                changes[column] = 'CASE ' + q(column) + ' ' + ' '.join(f'WHEN {s} THEN {d}' for s, d in mapping.items()) + ' ELSE ' + q(column) + ' END'
                        if changes: substitutions[table] = changes
                    expected = oracle(source, tables, substitutions); observed = oracle(target, tables)
                    excluded = {'ingest.dataset_snapshots', 'ingest.import_runs', 'ingest.schema_migrations'}
                    mismatches = [n for n in tables if n not in excluded and expected[n] != observed[n]]
                    assert not mismatches, mismatches
                    # Explicit journal projection tolerates only installation applied_at.
                    assert list(source.execute('SELECT version,content_sha256,code_commit FROM ingest.schema_migrations ORDER BY version')) == list(target.execute('SELECT version,content_sha256,code_commit FROM ingest.schema_migrations ORDER BY version'))
                    assert target.execute("SELECT count(*) FROM ingest.dataset_snapshots WHERE status <> 'sealed'").fetchone()[0] == 0
                    assert target.execute('SELECT count(*) FROM ingest.import_runs').fetchone()[0] == 2
                    for phase in maps:
                        row = target.execute("SELECT code_commit,checkpoint->>'kind',checkpoint->>'writer_sha256',checkpoint->>'source_native_sha256',checkpoint->>'generation',checkpoint->>'snapshot_id' FROM ingest.import_runs WHERE id=%s", (phase['runId'],)).fetchone()
                        assert row == (sha(WRITER), 'orion_pro_bulk_phase_v1', sha(WRITER), acceptance['sourceNativeSha256'], str(phase['generation']), str(phase['snapshotId'])), row
                        source_contract = source.execute('SELECT source_priority_version,knowledge_cutoff_at FROM ingest.dataset_snapshots WHERE id=%s', (phase['sourceSnapshotId'],)).fetchone()
                        target_contract = target.execute('SELECT source_priority_version,knowledge_cutoff_at FROM ingest.dataset_snapshots WHERE id=%s', (phase['snapshotId'],)).fetchone()
                        assert source_contract == target_contract, 'Source priority/cutoff changed during bulk phase recreation'
                    actual = {'nativeComparedTables': 91, 'explicitControlRelations': sorted(excluded), 'sourceMapped': expected, 'destination': observed, 'mismatches': mismatches}
                    report['destinationNativeOracle'] = observed
                elif name == 'exact_jsonb_and_native_states':
                    sql = "SELECT parameters::text,parameters->>'large',parameters->>'fraction',parameters ? 'null',(parameters->'null')::text,parameters->'missing' IS NULL,jsonb_typeof(parameters->'array'),jsonb_typeof(parameters->'text'),parameters->>'empty' FROM ingest.document_lineage"
                    a, b = source.execute(sql).fetchone(), target.execute(sql).fetchone(); assert a == b
                    assert a[1] == '12345678901234567890123456789' and a[2] == '0.123456789012345678901234567890123456789'
                    assert a[3:] == (True, 'null', True, 'array', 'string', '')
                    assert target.execute('SELECT bool_and(error IS NULL) FROM ingest.import_runs').fetchone()[0] is True
                    kinds = list(target.execute("SELECT value_kind,count(*) FROM football.player_match_metric_values GROUP BY value_kind ORDER BY value_kind"))
                    assert len(kinds) == 5 and sum(r[1] for r in kinds) == 10001
                    assert target.execute("SELECT bool_and(text_value='') FROM football.player_match_metric_values WHERE value_kind='string'").fetchone()[0] is True
                    assert target.execute("SELECT bool_and(boolean_value=false) FROM football.player_match_metric_values WHERE value_kind='boolean'").fetchone()[0] is True
                    actual = {'canonicalTechnicalSha256': hashlib.sha256(a[0].encode()).hexdigest(), 'types': list(a[3:]), 'valueKinds': kinds, 'largeAndFractionExact': True}
                elif name == 'complete_noop':
                    before = state(target, tables); code, value = invoke('noop', apply=True)
                    assert code == 0 and value['status'] == 'noop' and value['copiedRows'] == 0, value
                    assert state(target, tables) == before
                    actual = {'rowsSequencesGenerationsUnchanged': True}
                elif name == 'next_native_identity':
                    writer = psycopg.connect(env['ORION_BULK_TARGET_DSN'], autocommit=True)
                    try:
                        class Rollback(Exception): pass
                        try:
                            with writer.transaction():
                                new_id = writer.execute("INSERT INTO football.teams(slug,name,team_type,gender) VALUES('next-native','next native','club','men') RETURNING id").fetchone()[0]
                                assert new_id > 30; raise Rollback()
                        except Rollback: pass
                    finally: writer.close()
                    actual = {'nativeDefaultId': new_id, 'copiedMaximum': 30, 'rowRolledBackSequenceKept': True}
                elif name == 'corrupt_receipt_refusal':
                    prior = target.execute('SELECT checkpoint::text FROM ingest.import_runs WHERE id=7').fetchone()[0]
                    target.execute("UPDATE ingest.import_runs SET checkpoint=jsonb_set(checkpoint,'{generation}','999999'::jsonb) WHERE id=7")
                    try: actual['reason'] = refused('corrupt-receipt', apply=True, reason='TARGET_DRIFT')
                    finally: target.execute('UPDATE ingest.import_runs SET checkpoint=%s::jsonb WHERE id=7', (prior,))
                elif name == 'native_guards_and_json_kinds':
                    writer = psycopg.connect(env['ORION_BULK_TARGET_DSN'], autocommit=True); errors = []
                    try:
                        for raw in ['null', '[]', '"text"']:
                            try:
                                with writer.transaction(): writer.execute("INSERT INTO ingest.quality_issues(rule_code,severity,context) VALUES('wrong-kind','info',%s::jsonb)", (raw,))
                            except psycopg.Error as exc: assert exc.sqlstate == '23514'; errors.append(exc.sqlstate)
                            else: raise AssertionError('Native technical JSON kind CHECK bypassed')
                        try:
                            with writer.transaction():
                                writer.execute('SELECT ingest.begin_generation(%s,%s,%s)', ('bad-fk', VERSION, VERSION))
                                writer.execute('INSERT INTO ingest.source_records(source_id,document_id,locator_kind,locator,record_kind) VALUES(999999,999999,\'whole_document\',\'\',\'bad\')')
                        except psycopg.Error as exc: assert exc.sqlstate == '23503'; errors.append(exc.sqlstate)
                        else: raise AssertionError('Native FK bypassed')
                        try:
                            with writer.transaction(): writer.execute('UPDATE football.player_match_metric_values SET numeric_value=0 WHERE revision_id=1')
                        except psycopg.Error as exc: assert exc.sqlstate in {'42501', '55000'}; errors.append(exc.sqlstate)
                        else: raise AssertionError('Immutable typed guard bypassed')
                    finally: writer.close()
                    actual = {'expectedNativeSqlstates': errors}
                elif name == 'closed_history_refusal':
                    with source_writer.transaction():
                        new_g = source_writer.execute('SELECT ingest.begin_generation(%s,%s,%s)', ('closed-negative-only', VERSION, VERSION)).fetchone()[0]
                        source_writer.execute("UPDATE football.metric_definitions SET recorded_to_gen=%s WHERE code='a_ratio'", (new_g,))
                        source_writer.execute('SELECT ingest.seal_generation(%s,%s)', (new_g, hashed('closed negative only')))
                    bad = acceptance_for_source()
                    actual['reason'] = refused('closed-history', apply=True, accepted=bad, reason='CLOSED_HISTORY')
                elif name == 'deadline_rollback':
                    # Use the frozen positive candidate again by resetting owned DBs, never rewriting guarded history.
                    source_writer.close(); source_writer = None; source.close(); source = None
                    admin.execute('DROP DATABASE bulk_source WITH (FORCE)'); admin.execute('CREATE DATABASE bulk_source')
                    source = psycopg.connect(make_conninfo(pg.dsn, dbname='bulk_source'), autocommit=True); install(source)
                    source_writer = psycopg.connect(make_conninfo(pg.dsn, dbname='bulk_source', user='bulk_ingest'), autocommit=True)
                    source_writer.execute("SET statement_timeout='8s'"); source_writer.execute("SET lock_timeout='1s'")
                    report['fixturePhases'] = fixture(source_writer, model, sha(Path(__file__))); acceptance = acceptance_for_source()
                    reset_target(); before = state(target, tables)
                    code, value = invoke('deadline', apply=True, fault='before-seal-timeout')
                    assert code != 0 and value['status'] == 'failed' and value['sqlstate'] == '57014', value
                    after = state(target, tables); assert before['tables'] == after['tables']
                    assert value['statementTimeoutMs'] == 8000 and value['lockTimeoutMs'] == 1000
                    actual = {'timeoutSqlstate': value['sqlstate'], 'rolledBack': True, 'statementTimeoutMs': 8000}
                elif name == 'no_publish_legacy_cleanup':
                    for conn in [source, target]:
                        assert conn.execute('SELECT value FROM public.bulk_legacy_sentinel WHERE id=1').fetchone() == ('untouched historical publication',)
                        for table in tables:
                            if table.startswith('analytics.') or table in ['ingest.collection_jobs','ingest.asset_jobs','ingest.cleanup_items','ingest.dirty_editions']:
                                assert conn.execute(f'SELECT count(*) FROM {rel(table)}').fetchone()[0] == 0
                    positives = [report['prefixReceipt'], report['applyReceipt']]
                    assert all(p['statementTimeoutMs'] == 8000 and p['lockTimeoutMs'] == 1000 for p in positives)
                    seals = sum((p['sealMs'] for p in positives), []); commits = sum((p['commitMs'] for p in positives), [])
                    commands = sum(p['copyCommands'] for p in positives); rows = sum(p['copiedRows'] for p in positives)
                    assert max(seals + commits) < 8000 and commands < rows / 10
                    assert max(p['maxBufferedBytes'] for p in positives) <= 16 * 1024 * 1024
                    actual = {'sealMs': seals, 'commitMs': commits, 'copyCommands': commands,
                              'copiedRows': rows, 'legacySentinelsUnchanged': True, 'noAnalyticsQueuesPublish': True}
                report['cases'].append({'case': name, 'status': 'pass', 'actual': actual}); print('PASS ' + name, flush=True)
            except Exception as exc:
                report['cases'].append({'case': name, 'status': 'fail', 'errorType': type(exc).__name__, 'error': str(exc), 'traceback': traceback.format_exc()})
                print('FAIL ' + name + ': ' + str(exc)[:300], flush=True)
                blocker = 'Required workflow failed: ' + name
    except Exception as exc:
        report['setupError'] = {'type': type(exc).__name__, 'message': str(exc), 'traceback': traceback.format_exc()}
    finally:
        for conn in [source_writer, source, target, admin]:
            if conn:
                try: conn.close()
                except Exception: pass
        report['cleanup'] = pg.cleanup() if pg else {'serverStarted': False, 'serverStopped': True, 'ownedDirectoryRemoved': True}
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        report['counts'] = {s: sum(c['status'] == s for c in report['cases']) for s in ['pass', 'fail', 'unverified']}
        report['status'] = 'pass' if report['counts']['pass'] == len(CASES) and 'setupError' not in report and report['cleanup'].get('server_stopped', report['cleanup'].get('serverStopped')) else 'fail'
        report['currentSourcesUnchanged'] = all(sha(ROOT / name) == digest for name, digest in report['sourceSha256'].items())
        (run / 'result.json').write_text(json.dumps(report, indent=2, default=str) + '\n')
        print(json.dumps({'status': report['status'], 'counts': report['counts'], 'evidence': str(run)}), flush=True)
    return 0 if report['status'] == 'pass' else 1


if __name__ == '__main__':
    raise SystemExit(main())
