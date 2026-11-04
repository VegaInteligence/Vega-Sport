#!/usr/bin/env python3
"""Pre-code streaming capacity E2E, native fixtures only, never a live data client."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
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
import threading
import _thread

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'docs/verification/orion-pro-bulk-stream-20261105'
PILOT = ROOT / 'docs/verification/orion-pro-pilot-20261104'
SCRIPTS = ROOT / 'dashboard/scripts'
WRITER = SCRIPTS / 'orion_pro_bulk_stream.py'
MODEL = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
SQL_FILES = [ROOT / 'dashboard/backend/migrations' / n for n in ['012_orion_pro_domain.sql', '013_orion_pro_integrity.sql']]
MODEL_SHA = '18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
NOW = datetime(2026, 11, 5, 0, 0, tzinfo=timezone.utc)
VERSION = 'source_free_stream_fixture_v1'
APPEARANCES, METRICS, SCALARS, MATCHES, PLAYERS = 15437, 31, 478547, 612, 800
ESCAPED = 'Unicode Σ ⚽\tline\nbackslash\\N'
CASES = ['implementation_available', 'owned_two_database_setup', 'v1_bounded_capacity_attempt', 'default_readonly',
         'source_set_join_plans', 'endpoint_marker_role_refusals', 'bindings_and_source_drift', 'bootstrap_collision',
         'reservation_bound_refusal', 'ambiguous_source_and_cycle', 'typed_corruption_phase_oracle',
         'mid_phase_rollback_sequence_gaps', 'retry_committed_prefix', 'new_process_resume',
         'independent_94_table_oracle', 'exact_jsonb_and_native_states', 'complete_noop', 'next_native_identity',
         'corrupt_receipt_refusal', 'native_guards_and_json_kinds', 'closed_history_refusal', 'no_publish_legacy_cleanup']

# Reuse only pure SQL-oracle/quoting helpers; never invoke or modify v1's runner.
sys.path.insert(0, str(ROOT / 'tests'))
from orion_pro_bulk_local import sha, hashed, q, rel, oracle, native_rows, sequences, state, catalogue_sha


class RunBudget:
    def __init__(self, owned, evidence, label):
        self.owned, self.evidence = owned, evidence
        self.started = time.monotonic(); self.stop = threading.Event(); self.samples = []; self.reason = None
        self.child = None
        ledger_path = BASE / 'campaign.json'
        self.ledger_path = ledger_path
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {'maximumLargeRuns': 3, 'maximumCampaignSeconds': 3600, 'runs': []}
        assert len(ledger['runs']) < 3 and sum(r.get('elapsedSeconds', 0) for r in ledger['runs']) < 3600, 'Approved campaign budget exhausted'
        assert not ledger.get('stopForROOTReview'), 'Campaign stopped at genuine native deadline gate'
        self.ledger = ledger; self.entry = {'label': label, 'startedAt': datetime.now(timezone.utc).isoformat(), 'status': 'running'}
        ledger['runs'].append(self.entry); ledger_path.write_text(json.dumps(ledger, indent=2) + '\n')
        self.thread = threading.Thread(target=self.watch, daemon=True); self.thread.start()

    def watch(self):
        while not self.stop.wait(2):
            try:
                size = int(subprocess.check_output(['du', '-sk', str(self.owned)], text=True).split()[0]) * 1024
                elapsed = time.monotonic() - self.started
                self.samples.append({'elapsedSeconds': round(elapsed, 3), 'ownedDiskBytes': size})
                (self.evidence / 'resource-samples.json').write_text(json.dumps(self.samples, indent=2) + '\n')
                if size >= 7 * 1024**3 or elapsed >= 1200:
                    self.reason = 'owned_disk_soft_stop_7GiB' if size >= 7 * 1024**3 else 'run_wall_clock_20min'
                    if self.child is not None and self.child.poll() is None: self.child.terminate()
                    _thread.interrupt_main(); return
            except (OSError, subprocess.CalledProcessError):
                if not self.stop.is_set(): self.reason = 'resource_monitor_failed'; _thread.interrupt_main()
                return

    def close(self, status, native_deadline=False):
        self.stop.set(); self.thread.join(timeout=4)
        elapsed = time.monotonic() - self.started
        if self.owned.exists():
            self.samples.append({'elapsedSeconds': round(elapsed, 3), 'ownedDiskBytes': int(subprocess.check_output(['du', '-sk', str(self.owned)], text=True).split()[0]) * 1024})
        self.entry.update(status=status, elapsedSeconds=round(elapsed, 3), budgetStop=self.reason,
                          peakObservedDiskBytes=max((s['ownedDiskBytes'] for s in self.samples), default=0))
        if native_deadline: self.ledger['stopForROOTReview'] = 'native eight-second seal/commit gate failed'
        self.ledger_path.write_text(json.dumps(self.ledger, indent=2) + '\n')
        (self.evidence / 'resource-samples.json').write_text(json.dumps(self.samples, indent=2) + '\n')
        return self.entry


def fixture(conn, model, test_sha, evidence):
    tables = {t['qualified_name']: t for s in model['schemas'] for t in s['tables']}
    g = None; phases = []; observations = []

    def note(stage, **values):
        observations.append({'stage': stage, 'atUtc': datetime.now(timezone.utc).isoformat(), **values})
        (evidence / 'setup-observations.json').write_text(json.dumps(observations, indent=2, default=str) + '\n')

    def insert(table, **values):
        common = {'contract_version': VERSION, 'transform_version': VERSION, 'transform_code_sha256': test_sha,
                  'canonical_policy_version': VERSION, 'variant_key': 'stream:primary', 'is_canonical': True,
                  'provenance_kind': 'manual', 'recorded_from_gen': g,
                  'raw_position_code_state': 'absent', 'shirt_number_state': 'absent'}
        row = {k: v for k, v in common.items() if k in tables[table]['columns']}; row.update(values)
        if row.get('source_id') is not None and row.get('source_record_id') is not None and 'provenance_kind' in row: row['provenance_kind'] = 'provider'
        placeholders = ['%s::jsonb' if tables[table]['columns'][c]['type'] == 'jsonb' else '%s' for c in row]
        cursor = conn.execute(f"INSERT INTO {rel(table)} ({','.join(q(c) for c in row)}) OVERRIDING SYSTEM VALUE VALUES ({','.join(placeholders)}) RETURNING *", tuple(row.values()))
        return dict(zip([c.name for c in cursor.description], cursor.fetchone()))

    @contextmanager
    def phase_transaction(label):
        conn.execute('BEGIN')
        try:
            yield
            start = time.monotonic()
            try: conn.commit()
            except Exception as exc:
                note('native_commit_failed', phase=label, elapsedMs=round((time.monotonic() - start) * 1000, 3), sqlstate=getattr(exc, 'sqlstate', None))
                raise
            note('native_commit_passed', phase=label, elapsedMs=round((time.monotonic() - start) * 1000, 3))
        except BaseException:
            conn.rollback(); raise

    def document(identifier, run, key):
        return insert('ingest.source_documents', id=identifier, dataset_id=3, source_id=2, import_run_id=run,
                      retrieved_at=NOW, source_updated_at=NOW, content_sha256=hashed(key), request_fingerprint=hashed('request:' + key),
                      source_url='https://fixture.invalid/' + key, legacy_object_path='fixture:' + key)

    def finish(phase, run, docs):
        sid = conn.execute('SELECT id FROM ingest.dataset_snapshots WHERE generation=%s', (g,)).fetchone()[0]
        membership = sorted((d['legacy_object_path'], d['content_sha256']) for d in docs)
        binding = {'kind': 'orion_pro_phase_receipt_v2', 'phase': phase, 'transform_sha256': test_sha, 'transform_version': VERSION,
                   'model_sha256': sha(MODEL), 'source_document_count': len(docs), 'source_document_manifest_sha256': hashed(membership),
                   'selector_manifest_sha256': hashed(['typed native fixture', phase])}
        binding['input_manifest_sha256'] = hashed(binding)
        report = {'native_fixture_only': True, 'phase': phase, 'scalar_rows': SCALARS if phase == 'core' else 0}
        checkpoint = {'kind': binding['kind'], 'phase': phase, 'receipt_key': 'stream-fixture:' + phase, 'binding': binding,
                      'generation': g, 'snapshot_id': sid, 'report': report, 'report_sha256': hashed(report)}
        conn.execute("UPDATE ingest.import_runs SET status='partial',finished_at=%s,checkpoint=%s::jsonb,counters=%s::jsonb WHERE id=%s",
                     (NOW, json.dumps(checkpoint), '{"full_acceptance":false,"native_fixture_only":true}', run))
        for doc in docs: conn.execute('INSERT INTO ingest.dataset_snapshot_documents VALUES(%s,%s)', (sid, doc['id']))
        manifest = hashed({'input_manifest_sha256': binding['input_manifest_sha256'], 'report_sha256': checkpoint['report_sha256']})
        note('before_native_seal', phase=phase, generation=g, scalarRows=conn.execute('SELECT count(*) FROM football.player_match_metric_values').fetchone()[0])
        start = time.monotonic()
        try: conn.execute('SELECT ingest.seal_generation(%s,%s)', (g, manifest))
        except Exception as exc:
            note('native_seal_failed', phase=phase, elapsedMs=round((time.monotonic() - start) * 1000, 3), sqlstate=getattr(exc, 'sqlstate', None))
            raise
        note('native_seal_passed', phase=phase, elapsedMs=round((time.monotonic() - start) * 1000, 3))
        phases.append({'phase': phase, 'generation': g, 'snapshotId': sid, 'runId': run, 'manifest': manifest})

    with phase_transaction('core'):
        g = conn.execute('SELECT ingest.begin_generation(%s,%s,%s,%s)', ('stream-fixture:core', VERSION, VERSION + ':core-policy', NOW)).fetchone()[0]
        for name, table in tables.items():
            if table['phase'] != 'models' and 'relation_code' in table['columns'] and 'contract_version' in table['columns']:
                conn.execute('INSERT INTO ingest.relation_contracts VALUES(%s,%s,%s,%s)', (name, name, VERSION, table['grain']))
        insert('ingest.sources', id=10, code='stream_upstream', name='Upstream fixture', created_at=NOW)
        insert('ingest.sources', id=2, code='stream_primary', name='Native fixture', upstream_source_id=10, created_at=NOW)
        insert('ingest.source_datasets', id=3, source_id=2, dataset_key='stream_native', contract_version=VERSION)
        insert('ingest.import_runs', id=7, mode='backfill', transform_version=VERSION, code_commit=test_sha, started_at=NOW)
        d1, d2 = document(11, 7, 'core'), document(12, 7, 'derived')
        precise = '{"large":12345678901234567890123456789,"fraction":0.123456789012345678901234567890123456789,"null":null,"text":"null","array":[null,"",false,0],"empty":"","escaped":"Unicode Σ ⚽\\tline\\nbackslash\\\\N"}'
        insert('ingest.document_lineage', derived_document_id=12, parent_document_id=11, transform_version=VERSION, parameters=precise)
        # Every appearance has its own observation ID and typed locator, with no body.
        for lo in range(1, APPEARANCES + 1, 1000):
            hi = min(lo + 999, APPEARANCES)
            conn.execute("INSERT INTO ingest.source_records(id,source_id,document_id,locator_kind,locator,record_kind,external_key) OVERRIDING SYSTEM VALUE SELECT i,2,11,'json_pointer','/appearances/'||i,'native_appearance','a_'||i FROM generate_series(%s::integer,%s::integer) i", (lo, hi))
        conn.execute("INSERT INTO ingest.source_records(id,source_id,document_id,locator_kind,locator,record_kind,external_key) OVERRIDING SYSTEM VALUE SELECT 100000+i,2,11,'json_pointer','/profiles/'||i,'native_profile','p_'||i FROM generate_series(1,%s::integer) i", (PLAYERS,))
        insert('ingest.resource_fetches', id=17, run_id=7, source_id=2, endpoint='/native/core', request_fingerprint=hashed('fetch-core'), attempt_no=1,
               requested_at=NOW, finished_at=NOW, http_status=200, response_state='available', document_id=11)
        for tid, slug in [(20, 'stream-home'), (30, 'stream-away')]: insert('football.teams', id=tid, slug=slug, name=slug, team_type='club', gender='men')
        conn.execute("INSERT INTO football.players(id,display_name) OVERRIDING SYSTEM VALUE SELECT i,'Native player '||i FROM generate_series(1,%s::integer) i", (PLAYERS,))
        conn.execute("""INSERT INTO football.player_profile_versions(player_id,display_name,observed_at,external_profile_version_id,profile_content_sha256,profile_context,canonical_policy_version,raw_position_code_state,shirt_number_state,
            recorded_from_gen,variant_key,is_canonical,contract_version,transform_version,transform_code_sha256,source_id,source_record_id,provenance_kind)
            SELECT i,'Native player '||i,%s,'native-'||i,encode(sha256(convert_to('Native player '||i,'UTF8')),'hex'),'global',%s,'absent','absent',%s,'stream:primary',true,%s,%s,%s,2,100000+i,'provider'
            FROM generate_series(1,%s::integer) i""", (NOW, VERSION, g, VERSION, VERSION, test_sha, PLAYERS))
        competition = insert('football.competitions', id=100, name='Native league', slug='stream-league', competition_type='league', gender='men')
        edition = insert('football.competition_seasons', id=101, competition_id=100, competition_revision_id=competition['revision_id'], season_key='2026/2027', label='Native season', status='active')
        conn.execute("""INSERT INTO football.matches(id,competition_season_id,competition_season_revision_id,kickoff_precision,match_date,status,publication_state,source_id,source_record_id,
            canonical_policy_version,recorded_from_gen,variant_key,is_canonical,contract_version,transform_version,transform_code_sha256,provenance_kind)
            SELECT 199+i,101,%s,'date',%s,'finished','draft',2,1,%s,%s,'stream:primary',true,%s,%s,%s,'provider' FROM generate_series(1,%s::integer) i""",
            (edition['revision_id'], NOW.date(), VERSION, g, VERSION, VERSION, test_sha, MATCHES))
        conn.execute("""INSERT INTO football.match_teams(match_id,match_revision_id,side,team_id,canonical_policy_version,recorded_from_gen,variant_key,is_canonical,contract_version,transform_version,transform_code_sha256,provenance_kind)
            SELECT m.id,m.revision_id,s.side,s.team,%s,%s,'stream:primary',true,%s,%s,%s,'manual' FROM football.matches m CROSS JOIN (VALUES('home',20),('away',30)) s(side,team)""", (VERSION, g, VERSION, VERSION, test_sha))
        for lo in range(1, APPEARANCES + 1, 1000):
            hi = min(lo + 999, APPEARANCES)
            conn.execute("""INSERT INTO football.match_players(match_id,team_id,player_id,profile_version_id,match_team_revision_id,squad_status,played,participation_evidence,canonical_policy_version,
                source_id,source_record_id,raw_position_code_state,shirt_number_state,recorded_from_gen,variant_key,is_canonical,contract_version,transform_version,transform_code_sha256,provenance_kind)
                SELECT m.id,mt.team_id,p.player_id,p.id,mt.revision_id,CASE WHEN ((i-1)/%s)%%13<11 THEN 'starter' ELSE 'substitute' END,true,'native fixture',%s,
                2,i,'absent','absent',%s,'stream:primary',true,%s,%s,%s,'provider'
                FROM generate_series(%s::integer,%s::integer) i JOIN football.matches m ON m.id=200+(i-1)%%%s
                JOIN football.match_teams mt ON mt.match_id=m.id AND mt.team_id=CASE WHEN (i-1)/%s<13 THEN 20 ELSE 30 END
                JOIN football.player_profile_versions p ON p.player_id=(((i-1)/%s)+((i-1)%%%s)*29)%%%s+1""",
                (MATCHES, VERSION, g, VERSION, VERSION, test_sha, lo, hi, MATCHES, MATCHES, MATCHES, MATCHES, PLAYERS))
        # Thirty-one definitions, with one lexical child referencing later codes.
        for i in [29, 30, *range(29)]:
            code = 'a_ratio' if i == 0 else f'm{i:02d}'
            extra = {'numerator_code': 'm29', 'numerator_definition_version': VERSION, 'denominator_code': 'm30', 'denominator_definition_version': VERSION} if i == 0 else {}
            insert('football.metric_definitions', code=code, label=code, definition='Native scalar state fixture', unit='fixture', scope='player',
                   aggregation='ratio_of_sums' if i == 0 else 'none', allows_negative=True, definition_version=VERSION, **extra)
        start = time.monotonic()
        for lo in range(0, SCALARS, 1000):
            hi = min(lo + 999, SCALARS - 1)
            conn.execute("""INSERT INTO football.player_match_metric_values(match_id,player_id,team_id,period_code,period_definition_version,family_code,metric_code,metric_definition_version,
                value_kind,numeric_value,text_value,boolean_value,numerator,denominator,source_display,source_record_id,recorded_from_gen,variant_key,is_canonical,
                contract_version,transform_version,transform_code_sha256,source_id,provenance_kind,match_player_revision_id)
                SELECT mp.match_id,mp.player_id,mp.team_id,'full_match','bootstrap_v1','standard',CASE WHEN k%%31=0 THEN 'a_ratio' ELSE 'm'||lpad((k%%31)::text,2,'0') END,%s,
                CASE k%%31 WHEN 1 THEN 'string' WHEN 2 THEN 'boolean' WHEN 3 THEN 'null' WHEN 4 THEN 'absent' ELSE 'number' END,
                CASE WHEN k%%31 NOT IN (1,2,3,4) THEN CASE WHEN k%%31=0 THEN 12345678901234567890123456789.1234567890123456789::numeric ELSE (k%%997)::numeric/100 END END,
                CASE WHEN k%%31=1 THEN CASE WHEN (k/31)%%2=0 THEN '' ELSE %s END END,CASE WHEN k%%31=2 THEN false END,
                CASE WHEN k%%31=0 THEN 12345678901234567890123456789::numeric END,CASE WHEN k%%31=0 THEN 37::numeric END,CASE WHEN k%%31=0 THEN 'native fraction' END,
                mp.source_record_id,%s,'stream:primary',true,%s,%s,%s,2,'provider',mp.revision_id
                FROM generate_series(%s::integer,%s::integer) k JOIN football.match_players mp ON mp.source_id=2 AND mp.source_record_id=k/31+1 AND mp.recorded_from_gen=%s""",
                (VERSION, ESCAPED, g, VERSION, VERSION, test_sha, lo, hi, g))
        shape = conn.execute('SELECT count(*),count(DISTINCT(match_id,player_id,period_code,family_code,metric_code)),bool_and(is_canonical),count(DISTINCT variant_key) FROM football.player_match_metric_values').fetchone()
        assert shape == (SCALARS, SCALARS, True, 1), shape
        assert conn.execute('SELECT count(*) FROM football.match_players').fetchone()[0] == APPEARANCES
        note('canonical_shape_built', scalarRows=SCALARS, appearances=APPEARANCES, metrics=METRICS, matches=MATCHES, allCanonical=True, variants=1,
             scalarInsertMs=round((time.monotonic() - start) * 1000, 3))
        finish('core', 7, [d1, d2])
    note('core_committed')
    with phase_transaction('families'):
        g = conn.execute('SELECT ingest.begin_generation(%s,%s,%s,%s)', ('stream-fixture:families', VERSION, VERSION + ':family-policy', NOW)).fetchone()[0]
        insert('ingest.import_runs', id=13, mode='backfill', transform_version=VERSION, code_commit=test_sha, started_at=NOW)
        d3 = document(31, 13, 'families')
        insert('ingest.source_records', id=200001, source_id=2, document_id=31, locator_kind='whole_document', locator='', record_kind='native_family', external_key='families')
        insert('ingest.quality_issues', id=19, run_id=13, source_record_id=200001, rule_code='native_precision', severity='info', context=precise, detected_at=NOW)
        match = conn.execute('SELECT revision_id FROM football.matches WHERE id=200').fetchone()[0]
        home = conn.execute("SELECT revision_id FROM football.match_teams WHERE match_id=200 AND side='home'").fetchone()[0]
        for feature in ['events', 'momentum', 'h2h']:
            insert('ingest.match_coverage', match_id=200, match_revision_id=match, source_id=2, source_record_id=200001, document_id=31,
                   feature_code=feature, coverage_state='available', collection_state='present', observed_row_count=1, checked_at=NOW)
        insert('football.match_events', match_id=200, match_revision_id=match, event_seq=0, source_ordinal=0, event_type='', source_id=2, source_record_id=200001, feature_code='events')
        insert('football.match_momentum', match_id=200, match_revision_id=match, series_code='home', sample_index=0, value=0, source_id=2, source_record_id=200001, feature_code='momentum')
        insert('football.match_h2h_entries', match_id=200, match_revision_id=match, entry_ordinal=0, source_id=2, source_record_id=200001, feature_code='h2h')
        heatmap = insert('football.match_heatmaps', match_id=200, team_id=20, match_team_revision_id=home, period_code='full_match', period_definition_version='bootstrap_v1',
                         map_kind='touches', grid_columns=2, grid_rows=2, cell_length_m=5.0, cell_width_m=5.0, coordinate_frame='pitch_m', cells_state='available')
        insert('football.match_heatmap_cells', heatmap_id=heatmap['id'], cell_ordinal=0, column_index=0, row_index=0, action_count=0)
        network = insert('football.pass_networks', match_id=200, team_id=20, match_team_revision_id=home, window_kind='full_match')
        for pid in [1, 2]: insert('football.pass_network_nodes', network_id=network['id'], player_id=pid)
        insert('football.pass_network_edges', network_id=network['id'], from_player_id=1, to_player_id=2, passes=1)
        standing = insert('football.standing_snapshots', competition_season_id=101, competition_season_revision_id=edition['revision_id'], scope='overall', observed_at=NOW,
                          source_id=2, source_record_id=200001, data_revision=1)
        insert('football.standing_rows', snapshot_id=standing['id'], team_id=20, rank=1, points=0, played=0)
        system = insert('football.ranking_systems', code='stream_rank', authority='Native fixture', subject_kind='team', gender='men', methodology_version=VERSION)
        ranking = insert('football.ranking_snapshots', system_id=system['id'], subject_kind='team', edition_key='native', retrieved_at=NOW, revision=1, source_document_id=31)
        insert('football.team_ranking_entries', snapshot_id=ranking['id'], team_id=20, rank=1, points=0, source_record_id=200001)
        insert('football.match_observation_details', source_record_id=200001, resolution_state='resolved', match_id=200, match_revision_id=match, source_home_label='')
        finish('families', 13, [d3])
    note('families_committed')
    return phases


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--label', default='stream-e2e')
    parser.add_argument('--fixture-gate', action='store_true', help='Only construct/seal the native source before importer execution')
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
    files = [Path(__file__), WRITER, SCRIPTS/'orion_pro_bulk.py', ROOT/'tests/orion_pro_bulk_local.py', MODEL, BASE / 'PROTOCOL.md', BASE / 'PLAN.md', *SQL_FILES,
             PILOT / 'harness.py', SCRIPTS / 'orion_pro_migrate.py', SCRIPTS / 'orion_pro_schema.py', SCRIPTS / 'orion_pro_integrity.py']
    report = {'kind': 'source_free_streaming_two_owned_db_e2e', 'command': ['python3', 'tests/orion_pro_bulk_stream_local.py', *sys.argv[1:]],
              'startedAt': datetime.now(timezone.utc).isoformat(), 'setup': 'Owned loopback PG18.6; source + destination; exact sealed 012/013; ordinary source/ingest/runtime actors',
              'expected': 'PROTOCOL.md pre-code workflow matrix', 'sourceSha256': {}, 'cases': [], 'invocations': [], 'remoteActions': [],
              'limitations': ['No RDS connection or remote data import', 'Native fixture only; not real-source completeness or purge acceptance',
                              'Closed history refused; WAN throughput and real-candidate eight-second seal unverified'], 'fullAcceptance': False}
    for path in files:
        if path.exists():
            dest = inputs / path.relative_to(ROOT); dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(path, dest)
            report['sourceSha256'][str(path.relative_to(ROOT))] = sha(path)
    pg = None; admin = source = target = source_writer = None; blocker = None; acceptance = None; budget = None
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
        return {'kind': 'orion_pro_bulk_stream_acceptance_v1', 'localOnly': True, 'modelSha256': sha(MODEL),
                'sqlSha256': {p.name: sha(p) for p in SQL_FILES}, 'writerSha256': sha(WRITER) if WRITER.exists() else '0' * 64,
                'producerSha256': sha(Path(__file__)), 'producerVersion': VERSION, 'sourceNativeSha256': hashed(native),
                'catalogueSha256': catalogue_sha(source),
                'sourceRows': sum(v['rows'] for v in native.values()), 'sourceTables': native,
                'sourcePhases': report['fixturePhases']}

    def save_acceptance(value=None):
        acceptance_path.write_text(json.dumps(value or acceptance, indent=2) + '\n')

    def invoke(label, *, apply=False, fault=None, overrides=None, accepted=None, explain=False):
        save_acceptance(accepted)
        destination = run / ('invoke-' + str(len(report['invocations']) + 1) + '-' + label + '.json')
        command = ['python3', str(WRITER), '--marker', str(marker), '--acceptance', str(acceptance_path), '--report', str(destination)]
        if apply: command += ['--apply-local']
        if explain: command += ['--explain']
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
                    if args.fixture_gate:
                        report['cases'].append({'case':name,'status':'unverified','reason':'Source-only fixture gate does not require or test an importer'})
                        print('SKIP implementation_available (fixture-only)',flush=True)
                        continue
                    assert WRITER.is_file(), 'Required streaming importer implementation is absent'
                    actual = {'writerSha256': sha(WRITER) if WRITER.exists() else None, 'e2eSha256': sha(Path(__file__)), 'fixtureGateOnly': args.fixture_gate}
                elif name == 'owned_two_database_setup':
                    pg = LocalPostgres(args.pg_bin, run)
                    assert shutil.disk_usage(pg.root).free >= 16 * 1024**3, 'Need sixteen GiB free for bounded local run'
                    pg.command([pg.binaries / 'initdb', '-D', pg.data, '--auth=trust', '--no-locale', '--encoding=UTF8'], name='initdb')
                    with (pg.data / 'postgresql.conf').open('a') as f:
                        f.write("\nlog_error_verbosity=terse\nlog_min_error_statement=panic\nlog_parameter_max_length_on_error=0\ntemp_file_limit=512MB\n")
                    pg.start(); budget = RunBudget(pg.root,run,args.label); admin = psycopg.connect(pg.dsn, autocommit=True)
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
                    report['fixturePhases'] = fixture(source_writer, model, sha(Path(__file__)), run)
                    marker.write_text(json.dumps({'kind': 'orion_pro_owned_bulk_local_v1', 'ownerUid': os.getuid(), 'dataDirectory': str(pg.data),
                                                  'port': pg.port, 'pid': int((pg.data / 'postmaster.pid').read_text().splitlines()[0]),
                                                  'postmasterStartedAt': admin.execute('SELECT pg_postmaster_start_time()::text').fetchone()[0],
                                                  'sourceDatabase': 'bulk_source', 'targetDatabase': 'bulk_destination'}, indent=2) + '\n')
                    acceptance = acceptance_for_source(); save_acceptance()
                    report['sourceNativeOracle'] = acceptance['sourceTables']; report['targetBaseline'] = state(target, tables)
                    actual = {'serverVersion': 180006, 'tables': len(tables), 'sourceRows': acceptance['sourceRows'], 'phases': report['fixturePhases']}
                    report['serverSettings'] = {name:{'setting':setting,'unit':unit} for name,setting,unit in source.execute("SELECT name,setting,unit FROM pg_settings WHERE name IN ('work_mem','hash_mem_multiplier','temp_file_limit')")}
                    report['ownedDiskBytesAfterSetup'] = int(subprocess.check_output(['du','-sk',str(pg.root)],text=True).split()[0])*1024
                    if args.fixture_gate:
                        report['sourceFixtureSealed'] = True
                        blocker = 'Fixture-only seal gate; importer workflows deliberately unexecuted'
                elif name == 'v1_bounded_capacity_attempt':
                    before = state(target, tables)
                    v1 = SCRIPTS / 'orion_pro_bulk.py'
                    accepted_v1 = {**acceptance, 'kind': 'orion_pro_bulk_local_acceptance_v1', 'writerSha256': sha(v1)}
                    save_acceptance(accepted_v1)
                    destination = run / 'v1-capacity-plan.json'
                    command = ['python3',str(v1),'--marker',str(marker),'--acceptance',str(acceptance_path),'--report',str(destination)]
                    started = time.monotonic()
                    try:
                        proc = subprocess.run(command,env=env,capture_output=True,text=True,timeout=90)
                        value = json.loads(destination.read_text())
                        assert proc.returncode != 0 and value['status']=='refused' and value['reasonCode']=='SOURCE_BOUND', value
                        actual = {'refusalProven':True,'reason':value['reason'],'elapsedMs':round((time.monotonic()-started)*1000,3)}
                    except subprocess.TimeoutExpired:
                        actual = {'refusalProven':False,'capacityUnverified':True,'reason':'Bounded v1 attempt exceeded90s; no full replay'}
                        destination.write_text(json.dumps(actual,indent=2)+'\n')
                    assert state(target,tables)==before
                elif name == 'source_set_join_plans':
                    code,value = invoke('source-plans',explain=True)
                    assert code==0 and value['status']=='planned' and value.get('sourcePlans'), value
                    assert value['metadataBytes'] <= 32*1024**2 and value['rowOwnershipEntries']==0
                    actual = {'sourcePlans':value['sourcePlans'],'metadataBytes':value['metadataBytes'],'rowOwnershipEntries':0}
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
                    assert target.execute('SELECT count(*) FROM football.player_match_metric_values').fetchone()[0] == SCALARS
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
                        assert row == (sha(WRITER), 'orion_pro_bulk_stream_phase_v1', sha(WRITER), acceptance['sourceNativeSha256'], str(phase['generation']), str(phase['snapshotId'])), row
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
                    assert len(kinds) == 5 and sum(r[1] for r in kinds) == SCALARS
                    assert target.execute("SELECT bool_or(text_value=''),bool_or(text_value=%s) FROM football.player_match_metric_values WHERE value_kind='string'",(ESCAPED,)).fetchone() == (True,True)
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
                        source_writer.execute("UPDATE football.positions SET recorded_to_gen=%s WHERE code='GK'", (new_g,))
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
                    report['fixturePhases'] = fixture(source_writer, model, sha(Path(__file__)), run); acceptance = acceptance_for_source()
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
    except KeyboardInterrupt:
        report['setupError'] = {'type':'BudgetInterruption','message':budget.reason if budget else 'interrupted'}
    except Exception as exc:
        report['setupError'] = {'type': type(exc).__name__, 'message': str(exc), 'traceback': traceback.format_exc()}
    finally:
        for conn in [source_writer, source, target, admin]:
            if conn:
                try: conn.close()
                except Exception: pass
        if budget:
            observations=json.loads((run/'setup-observations.json').read_text()) if (run/'setup-observations.json').exists() else []
            native_deadline=any(o.get('stage') in {'native_seal_failed','native_commit_failed'} and o.get('sqlstate')=='57014' for o in observations)
            report['resourceBudget']=budget.close('source_fixture_sealed' if report.get('sourceFixtureSealed') else 'failed' if blocker or 'setupError' in report else 'completed',native_deadline)
        report['cleanup'] = pg.cleanup() if pg else {'serverStarted': False, 'serverStopped': True, 'ownedDirectoryRemoved': True}
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        report['counts'] = {s: sum(c['status'] == s for c in report['cases']) for s in ['pass', 'fail', 'unverified']}
        report['status'] = 'fixture_sealed' if args.fixture_gate and report.get('sourceFixtureSealed') and report['counts']['fail']==0 else 'pass' if report['counts']['pass'] == len(CASES) and 'setupError' not in report and report['cleanup'].get('server_stopped', report['cleanup'].get('serverStopped')) else 'fail'
        report['currentSourcesUnchanged'] = all(sha(ROOT / name) == digest for name, digest in report['sourceSha256'].items())
        (run / 'result.json').write_text(json.dumps(report, indent=2, default=str) + '\n')
        print(json.dumps({'status': report['status'], 'counts': report['counts'], 'evidence': str(run)}), flush=True)
    return 0 if report['status'] in {'pass','fixture_sealed'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
