#!/usr/bin/env python3
"""Local-only, exact-policy native phase transport. Offline plan is the default.

Source facts are streamed as PostgreSQL text COPY bytes. Ownership is evaluated
by bounded source SQL joins; only the three small self-reference DAGs have row
metadata in memory. This tool has no remote adapter or source collector.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

sys.dont_write_bytecode = True

import orion_pro_bulk as v1
import orion_pro_policy as policy

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/verification/orion-pro-bulk-stream-v2-local-20261105'
BINDINGS = BASE / 'BINDINGS_V2.json'
BINDINGS_SHA = '5366f23acf923dd1ec3834cae64d6f9abc04d6b0be0355536fdcd7ab5f0e35d5'
MODEL = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
MATRIX = ROOT / 'docs/verification/orion-pro-bulk-stream-v2-20261105/OWNERSHIP_MATRIX.json'
VERSION = 'orion_pro_bulk_stream_v2_local_v2'
FIXTURE_VERSION = 'source_free_stream_v2_fixture_v1'
FUNCTION_SHA = '30f86fa262fd4cf10307e78431350f25b9d7a5b353d0c76abc0594340edb5d20'
P1_SHA = '6ecdf33f7084eba21eb31198621a50cd01a53309c303d8c221908c07503e2a92'
ROW_MAX = CHUNK_MAX = 1024 ** 2
BUFFER_MAX, META_MAX = 16 * 1024 ** 2, 32 * 1024 ** 2
CONTROL = v1.CONTROL
FAULTS = {'wrong-generation-map', 'corrupt-first-fact', 'after-copy-batches:2',
          'before-seal-timeout', 'after-core-commit', 'during-families-after-copy',
          'after-commit-ack'}
Refusal, require = v1.Refusal, v1.require
q, rel, digest, canonical, hashed = v1.q, v1.rel, v1.digest, v1.canonical, v1.hashed


def read_json(path, maximum=1024 ** 2):
    try:
        return v1.bounded_json(path, maximum)
    except (OSError, ValueError, TypeError):
        raise Refusal('BINDING', 'Malformed bounded local metadata') from None


def fixed_bindings():
    require(digest(BINDINGS) == BINDINGS_SHA, 'BINDING', 'Closed local bindings differ')
    binding = read_json(BINDINGS)
    require(binding['localOnly'] is True and binding['campaignAuthorized'] is False and
            binding['writerVersion'] == VERSION and binding['controlReceiptVersion'] == 'orion_pro_bulk_stream_v2_phase_v2',
            'BINDING', 'Only the closed local implementation contract is supported')
    for path, expected in binding['inputs'].items():
        candidate = ROOT / path
        require(candidate.is_file() and digest(candidate) == expected,
                'BINDING', 'A frozen model/policy/producer dependency differs')
    return binding


def owned_marker(path):
    """File and process checks precede even the literal loopback connection."""
    try:
        marker = read_json(path, 4096)
        root = Path(marker['ownedRoot']).resolve()
        require(path.stat().st_uid == os.getuid() and path.stat().st_mode & 0o077 == 0,
                'LOCAL_ONLY', 'Owned marker must be private to this user')
        require(root.name.startswith('orion-pro-e2e-') and root.stat().st_uid == os.getuid(),
                'LOCAL_ONLY', 'Unowned local engine root')
        data = root / 'data'
        lines = (data / 'postmaster.pid').read_text().splitlines()
        require(marker['kind'] == 'orion_owned_stream_v2_pg18' and
                marker['sourceDatabase'] == 'policy_facts' and marker['targetDatabase'] == 'policy_empty' and
                1024 < marker['port'] < 65536 and int(lines[3]) == marker['port'] and
                Path(lines[1]).resolve() == data.resolve() and
                (data / 'PG_VERSION').read_text().strip() == '18',
                'LOCAL_ONLY', 'Marker database/port/engine identity differs')
        epoch = datetime.fromisoformat(marker['postmasterStartedAt'])
        require(epoch.tzinfo is not None, 'LOCAL_ONLY', 'Naive postmaster epoch is forbidden')
        os.kill(int(lines[0]), 0)
        marker['epoch'] = epoch
        return marker
    except Refusal:
        raise
    except (OSError, KeyError, TypeError, ValueError):
        raise Refusal('LOCAL_ONLY', 'Invalid owned local postmaster marker') from None


def connect(psycopg, marker, source):
    actor = 'policy_runtime' if source else 'policy_ingest'
    database = marker['sourceDatabase'] if source else marker['targetDatabase']
    # hostaddr must override an inherited PGHOSTADDR before any connection attempt.
    conn = psycopg.connect(host='127.0.0.1', hostaddr='127.0.0.1', port=marker['port'],
                           dbname=database, user=actor, password='', passfile='/dev/null',
                           sslmode='disable', connect_timeout=8, autocommit=True,
                           application_name=VERSION,
                           options='-c statement_timeout=8000 -c lock_timeout=1000 '
                                   '-c default_transaction_read_only=on -c search_path=pg_catalog '
                                   '-c timezone=UTC -c datestyle=ISO,YMD -c intervalstyle=iso_8601 '
                                   '-c client_encoding=UTF8 -c extra_float_digits=3')
    try:
        identity = conn.execute('SELECT current_database(),current_user,host(inet_server_addr()),'
                                'inet_server_port(),pg_postmaster_start_time()').fetchone()
        require(conn.info.server_version == 180006 and
                identity == (database, actor, '127.0.0.1', marker['port'], marker['epoch']),
                'LOCAL_ONLY', 'Connected engine/actor/epoch differs from the owned marker')
        flags = conn.execute('SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls '
                             'FROM pg_roles WHERE rolname=current_user').fetchone()
        members = conn.execute("SELECT count(*) FROM pg_roles WHERE rolname<>current_user "
                               "AND pg_has_role(current_user,oid,'MEMBER')").fetchone()[0]
        owners = conn.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                              "WHERE n.nspname IN ('ingest','football','analytics') "
                              "AND c.relowner=current_user::regrole").fetchone()[0]
        can_insert = conn.execute("SELECT has_table_privilege(current_user,'ingest.import_runs','INSERT')").fetchone()[0]
        require(flags is not None and not any(flags) and not members and not owners and
                can_insert == (not source), 'LOCAL_ONLY', 'Actor privileges differ from the closed pair')
        require(conn.execute("SHOW statement_timeout").fetchone()[0] == '8s' and
                conn.execute("SHOW lock_timeout").fetchone()[0] == '1s', 'LOCAL_ONLY', 'Native deadlines differ')
        return conn
    except BaseException:
        conn.close()
        raise


class Stream:
    def __init__(self, source, target, pair, accepted, report, pair_sha, binding):
        self.source, self.target = source, target
        self.pair, self.accepted, self.report = pair, accepted, report
        self.pair_sha, self.binding = pair_sha, binding
        self.model = json.loads(MODEL.read_text())
        self.tables = {t['qualified_name']: t for s in self.model['schemas'] for t in s['tables'] if t['phase'] != 'models'}
        self.matrix = json.loads(MATRIX.read_text())
        self.rules = {r['relation']: r for r in self.matrix['relations']}
        self.scope = set(self.matrix['copiedRelations']) | {'ingest.import_runs'}
        self.order = self.matrix['interTableDependencyOrder']
        self.maps_g, self.maps_s, self.source_runs = {}, {}, {}
        self.phases, self.phase_contracts, self.source_run_digest, self.phase_rows = [], {}, {}, {}
        self.bootstrap, self.self_order, self.sequence_plan, self.widths = {}, {}, [], {}
        self.target_widths = {}
        self.control_columns = {('ingest.dataset_snapshots', 'generation'): 'generation',
                                ('ingest.dataset_snapshots', 'id'): 'snapshot'}
        changed = True
        while changed:
            changed = False
            for name, table in self.tables.items():
                for fk in table['foreign_keys']:
                    for child, parent in zip(fk['columns'], fk['references']['columns']):
                        kind = self.control_columns.get((fk['references']['table'], parent))
                        if kind:
                            old = self.control_columns.get((name, child))
                            require(old in {None, kind}, 'BINDING', 'Conflicting control-component mapping')
                            if old is None:
                                self.control_columns[name, child] = kind
                                changed = True
        require(len(self.tables) == 94 and len(self.scope) == 75 and len(self.control_columns) == 106 and
                set(self.rules) == set(self.tables) and set(self.order) == set(self.tables),
                'BINDING', 'Closed94-relation/control-component matrix differs')
        report.update(controlComponents=106, copyRelations=74, regeneratedControls=3,
                      forcedEmptyRelations=17, ownershipDictionaryRows=0,
                      controlColumns={n: {c: k for (t, c), k in self.control_columns.items() if t == n}
                                      for n in self.tables if any(t == n for t, _ in self.control_columns)},
                      externalRequests=0, temporaryTablesCreated=0, selfGraphTables=3,
                      metadataAccounting='conservative combined retained/transient containers, not process RSS')
        self.memory()

    def ownership_and_dependencies(self):
        self.phase_rows = {p['generation']: 0 for p in self.phases}
        for name, table in self.tables.items():
            if self.widths[name]['rows'] == 0:
                continue
            owner = self.owner(name)
            groups = self.source.execute('SELECT (' + owner + '),count(*) FROM ' + rel(name) +
                                         ' t GROUP BY 1 LIMIT 66').fetchall()
            require(len(groups) <= 65 and sum(count for _, count in groups) == self.widths[name]['rows'] and
                    all(generation in {0, *self.phase_rows} for generation, _ in groups),
                    'PHASE_OWNERSHIP', 'Unresolved or unaccepted source row owner')
            if name in self.matrix['copiedRelations']:
                for generation, count in groups:
                    if generation != 0:
                        self.phase_rows[generation] += count
            if 'transform_code_sha256' in table['columns']:
                invalid = self.source.execute('SELECT EXISTS(SELECT 1 FROM ' + rel(name) + ' t WHERE (' + owner +
                    ')<>0 AND transform_code_sha256 IS DISTINCT FROM %s)', (self.accepted['producerSha256'],)).fetchone()[0]
                require(not invalid, 'BINDING', 'A fact transform differs from the accepted producer')
            for fk in table['foreign_keys']:
                parent = fk['references']['table']
                present = ' AND '.join('c.' + q(c) + ' IS NOT NULL' for c in fk['columns'])
                join = ' AND '.join('p.' + q(pc) + '=c.' + q(cc) for cc, pc in zip(fk['columns'], fk['references']['columns']))
                po, co = self.owner(parent, 'p'), self.owner(name, 'c')
                pk = self.tables[parent]['primary_key']['columns'][0]
                invalid = self.source.execute('SELECT EXISTS(SELECT 1 FROM ' + rel(name) + ' c LEFT JOIN ' + rel(parent) +
                    ' p ON ' + join + ' WHERE ' + present + ' AND (p.' + q(pk) + ' IS NULL OR (' + po +
                    ') IS NULL OR ((' + po + ')<>0 AND (' + po + ')>(' + co + '))))').fetchone()[0]
                require(not invalid, 'PHASE_OWNERSHIP', 'Missing or future source dependency; MATCH SIMPLE is preserved')
        # Native plans inspect the actual source ownership paths, not an invented
        # SELECT or the old dense013 validator. Server temp/actual work are bounded.
        for name in ['football.player_match_metric_values', 'ingest.document_lineage']:
            sql = 'SELECT ' + self.owner(name) + ' AS owner,count(*) FROM ' + rel(name) + ' t GROUP BY 1'
            plan = self.source.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + sql).fetchone()[0][0]
            pending, work, temporary = [plan['Plan']], 0, 0
            while pending:
                node = pending.pop()
                work = max(work, node.get('Actual Rows', 0) * node.get('Actual Loops', 1))
                temporary += node.get('Temp Read Blocks', 0) + node.get('Temp Written Blocks', 0)
                pending.extend(node.get('Plans', []))
            require(work <= 500000 and temporary <= 65536, 'SOURCE_BOUND', 'Ownership server work/temp exceeds the local plan gate')
            self.report['plans'].append({'relation': name, 'mode': 'EXPLAIN_ANALYZE_OWNERSHIP', 'sql': sql,
                                         'actualRows': work, 'tempBlocks': temporary, 'plan': plan})
        self.report['sourcePhaseCopiedRows'] = self.phase_rows.copy()
        self.memory()

    def self_graphs(self):
        self.self_order = {}
        all_nodes, all_edges = 0, 0
        for name, table in self.tables.items():
            fks = [fk for fk in table['foreign_keys'] if fk['references']['table'] == name]
            if not fks:
                continue
            count = self.widths[name]['rows']
            all_nodes += count
            require(all_nodes <= 4096, 'SELF_GRAPH_BOUND', 'Self-reference vertices exceed4096 before fetch')
            pk = table['primary_key']['columns']
            columns = list(dict.fromkeys([*pk, *(c for fk in fks for c in [*fk['columns'], *fk['references']['columns']])]))
            estimate = self.source.execute('SELECT coalesce(sum(' +
                '+'.join('4*coalesce(octet_length(' + q(c) + '::text),0)+512' for c in columns) +
                '+4096),0) FROM ' + rel(name)).fetchone()[0]
            require(estimate + v1.container_bytes(self.self_order) <= 8 * 1024 ** 2,
                    'SELF_GRAPH_BOUND', 'Self graph key/workspace estimate exceeds8MiB before fetch')
            rows = list(self.source.execute('SELECT ' + ','.join(q(c) + '::text' for c in columns) + ' FROM ' + rel(name)))
            entries = [dict(zip(columns, row)) for row in rows]
            indexes = {tuple(fk['references']['columns']): {} for fk in fks}
            dependencies = {}
            for row in entries:
                key = tuple(row[c] for c in pk)
                dependencies[key] = set()
                for fields, index in indexes.items():
                    index[tuple(row[c] for c in fields)] = key
            for row in entries:
                key = tuple(row[c] for c in pk)
                for fk in fks:
                    values = tuple(row[c] for c in fk['columns'])
                    if any(v is None for v in values):
                        continue
                    parent = indexes[tuple(fk['references']['columns'])].get(values)
                    require(parent is not None, 'PHASE_OWNERSHIP', 'Self dependency has no exact native parent')
                    dependencies[key].add(parent)
                    all_edges += 1
                    require(all_edges <= 8192, 'SELF_GRAPH_BOUND', 'Self-reference edges exceed8192')
            graph_charge = sum(v1.container_bytes(o) for o in [rows, entries, indexes, dependencies]) + 4096
            require(graph_charge <= 8 * 1024 ** 2, 'SELF_GRAPH_BOUND', 'Self graph workspace exceeds8MiB')
            ordered = []
            self.memory(rows, entries, indexes, dependencies, ordered)
            while dependencies:
                ready = sorted(k for k, parents in dependencies.items() if not parents)
                require(ready, 'SELF_CYCLE', 'Self-reference cycle is unsupported')
                ordered.extend(ready)
                self.memory(rows, entries, indexes, dependencies, ordered, ready)
                for key in ready:
                    del dependencies[key]
                for parents in dependencies.values():
                    parents.difference_update(ready)
            self.self_order[name] = ordered
            # Bounded witnesses describe actual native self edges. They never
            # modify order/batch sizing; the COPY windows below supply execution.
            witnesses = []
            for row in entries:
                for fk in fks:
                    values = tuple(row[c] for c in fk['columns'])
                    if any(v is None for v in values) or len(witnesses) == 8:
                        continue
                    child = tuple(row[c] for c in pk)
                    parent = indexes[tuple(fk['references']['columns'])][values]
                    witnesses.append({'relation': name, 'childPk': list(child), 'parentPk': list(parent),
                                      'childRank': ordered.index(child), 'parentRank': ordered.index(parent)})
            self.report['selfRankWitnesses'].extend(witnesses)
            require(v1.container_bytes(self.self_order) + graph_charge <= 8 * 1024 ** 2,
                    'SELF_GRAPH_BOUND', 'Retained self ranks plus workspace exceed8MiB')
        require(len(self.self_order) == 3, 'BINDING', 'Exactly three native self-reference graphs are expected')
        self.report['selfGraphs'] = {'vertices': all_nodes, 'edges': all_edges,
                                    'retainedBytes': v1.container_bytes(self.self_order)}
        for name in self.self_order:
            self.ranked_from(name)  # Admit typed rank-map bytes before target DML.
        self.memory()

    def sequence_inspection(self):
        self.sequence_plan = []
        # Pure v1 method only: bounded65-relation sequence summaries, no Candidate
        # constructor, ownership/index dictionary, old connection or policy guard.
        v1.Candidate.sequence_inspection(self)
        require(len(self.sequence_plan) <= 65, 'RESERVATION_BOUND', 'Unexpected business sequence count')
        self.memory()

    def inspect_source(self):
        self.source_bounds()
        self.receipts()
        self.ownership_and_dependencies()
        self.self_graphs()
        self.sequence_inspection()
        native = {name: self.native(self.source, name) for name in sorted(self.tables)}
        require(native == self.accepted['sourceTables'] and hashed(native) == self.accepted['sourceNativeSha256'] and
                sum(v['rows'] for v in native.values()) == self.accepted['sourceRows'],
                'SOURCE_DRIFT', 'Native94-table source differs from the exact acceptance')
        self.report['sourceNativeSha256'] = hashed(native)
        self.report['sourcePhases'] = self.phases

    def source_reopen(self):
        self.source.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        started = time.monotonic()
        try:
            self.policies()
            native = {name: self.native(self.source, name) for name in sorted(self.tables)}
            require(native == self.accepted['sourceTables'] and hashed(native) == self.accepted['sourceNativeSha256'],
                    'SOURCE_DRIFT', 'Source changed at phase reopen')
            self.report['sourceReopenMs'].append(round((time.monotonic() - started) * 1000, 3))
        except BaseException:
            self.source.rollback()
            raise

    def target_bounds(self):
        total = 0
        for name, table in self.tables.items():
            count, maximum = self.target.execute('SELECT count(*),coalesce(max(octet_length(ROW(' +
                ','.join(map(q, table['columns'])) + ')::text)),0) FROM ' + rel(name)).fetchone()
            total += count
            require(count <= 500000 and total <= 2000000 and maximum <= ROW_MAX,
                    'TARGET_DRIFT', 'Target native row/count bound differs')
            self.target_widths[name] = maximum

    def control_binding(self, phase):
        return {'kind': 'orion_pro_bulk_stream_v2_phase_v2', 'phase': phase['phase'],
                'writer_sha256': self.accepted['writerSha256'], 'model_sha256': digest(MODEL),
                'bindings_sha256': digest(BINDINGS), 'pair_sha256': self.pair_sha,
                'source_native_sha256': self.accepted['sourceNativeSha256'],
                'producer_sha256': self.accepted['producerSha256'],
                'source_generation': phase['generation'], 'source_snapshot_id': phase['snapshotId'],
                'source_run_id': phase['runId'], 'source_run_sha256': self.source_run_digest[phase['runId']],
                'source_phase_manifest_sha256': phase['manifest']}

    def parameters(self, phase):
        return {'kind': VERSION, 'pair_sha256': self.pair_sha, 'source_run_sha256': self.source_run_digest[phase['runId']],
                'producer_sha256': self.accepted['producerSha256']}

    def prefix(self):
        """Inspect bounded controls; business91 parity is checked after source RO closes."""
        rows = list(self.target.execute('SELECT id,mode,status,transform_version,code_commit,started_at,finished_at,'
            'parameters::text,counters::text,checkpoint::text,error IS NULL FROM ingest.import_runs ORDER BY id LIMIT 65'))
        require(len(rows) <= 64, 'TARGET_DRIFT', 'Foreign/oversized destination run set')
        by_phase = {}
        for row in rows:
            try:
                require(isinstance(row[9], str) and len(row[9].encode()) <= 16384, 'TARGET_DRIFT', 'Missing/oversized target checkpoint')
                checkpoint = json.loads(row[9], parse_float=Decimal)
                checksum = checkpoint.pop('receipt_sha256')
                require(checksum == hashed(checkpoint), 'TARGET_DRIFT', 'Receipt checksum differs')
                checkpoint['receipt_sha256'] = checksum
                phase = next(p for p in self.phases if p['phase'] == checkpoint['phase'])
                require(set(checkpoint) == set(self.control_binding(phase)) | {
                        'receipt_sha256', 'generation', 'snapshot_id', 'copied_rows', 'transaction_started_at'} and
                        type(checkpoint['copied_rows']) is int and
                        checkpoint['copied_rows'] == self.phase_rows[phase['generation']],
                        'TARGET_DRIFT', 'Checkpoint shape/source-derived row count differs')
                clock = datetime.fromisoformat(checkpoint['transaction_started_at'])
                require(clock.tzinfo is not None, 'TARGET_DRIFT', 'Aware native transaction clock required')
                require(phase['phase'] not in by_phase and
                        row[0] == phase['runId'] and row[1:5] == ('backfill', 'partial', VERSION, self.accepted['writerSha256']) and
                        row[5] is not None and row[6] is not None and row[5] <= row[6] and row[10] is True and
                        all(checkpoint.get(k) == v for k, v in self.control_binding(phase).items()),
                        'TARGET_DRIFT', 'Foreign/different target execution receipt')
                generation, sid = checkpoint['generation'], checkpoint['snapshot_id']
                require(type(generation) is int and type(sid) is int and generation > 1 and sid > 1,
                        'TARGET_DRIFT', 'Malformed destination control IDs')
                snap = self.target.execute('SELECT generation,status,manifest_sha256,transform_version,source_priority_version,'
                    'snapshot_key,knowledge_cutoff_at,created_at,sealed_at FROM ingest.dataset_snapshots WHERE id=%s', (sid,)).fetchone()
                priority, cutoff = self.phase_contracts[phase['generation']]
                require(snap is not None and snap[:7] == (generation, 'sealed', hashed(checkpoint), VERSION, priority,
                        self.snapshot_key(phase), cutoff) and snap[7] is not None and snap[8] is not None and
                        snap[7] == row[5] == row[6] == snap[8] == clock,
                        'TARGET_DRIFT', 'Destination snapshot/control clocks differ')
                parameters = json.loads(row[7], parse_float=Decimal)
                counters = json.loads(row[8], parse_float=Decimal)
                require(parameters == self.parameters(phase) and counters == {'copied_rows': checkpoint['copied_rows'],
                        'full_acceptance': False, 'local_only': True}, 'TARGET_DRIFT', 'Technical parameters/counters differ')
                by_phase[phase['phase']] = {'phase': phase['phase'], 'sourceGeneration': phase['generation'],
                    'sourceSnapshotId': phase['snapshotId'], 'generation': generation, 'snapshotId': sid, 'runId': phase['runId']}
            except Refusal:
                raise
            except (KeyError, ValueError, TypeError, StopIteration):
                raise Refusal('TARGET_DRIFT', 'Malformed or foreign destination control receipt') from None
        completed = []
        for phase in self.phases:
            if phase['phase'] not in by_phase:
                break
            item = by_phase[phase['phase']]
            self.maps_g[item['sourceGeneration']] = item['generation']
            self.maps_s[item['sourceSnapshotId']] = item['snapshotId']
            completed.append(item)
        require(len(completed) == len(rows) and
                {r[0] for r in self.target.execute('SELECT id FROM ingest.dataset_snapshots ORDER BY id LIMIT 66')} == {1, *(i['snapshotId'] for i in completed)} and
                len(set(self.maps_g.values())) == len(self.maps_g) and len(set(self.maps_s.values())) == len(self.maps_s) and
                list(self.maps_g.values()) == sorted(self.maps_g.values()) and list(self.maps_s.values()) == sorted(self.maps_s.values()),
                'TARGET_DRIFT', 'Destination is not an exact monotone committed phase prefix')
        self.report['controlContractsVerified'] = 3
        self.memory()
        return completed

    def snapshot_key(self, phase):
        return 'bulk-stream-v2:' + self.accepted['sourceNativeSha256'] + ':' + phase['phase']

    def verify_business(self, expected, applying=False):
        started = time.monotonic()
        self.target_bounds()
        actual = self.business(self.target, inverse=True)
        require(actual == expected, 'PHASE_ORACLE' if applying else 'TARGET_DRIFT', 'Exact source-coordinate91-relation oracle differs')
        self.report['nativeRelationsVerified'] = 91
        self.report['targetOracleMs'].append(round((time.monotonic() - started) * 1000, 3))
        self.memory(expected, actual)

    def ranked_from(self, name):
        """A bounded typed VALUES map for self FK order only; never a fact map."""
        table = self.tables[name]
        pk = table['primary_key']['columns']
        rows = self.self_order.get(name)
        if rows is None or not rows:
            return rel(name) + ' t', [], None
        slots, params = [], []
        for rank, key in enumerate(rows):
            slots.append('(' + ','.join('%s::' + table['columns'][c]['type'] for c in pk) + ',%s::integer)')
            params.extend([*key, rank])
        sql = (rel(name) + ' t JOIN (VALUES ' + ','.join(slots) + ') AS ranks(' + ','.join(map(q, pk)) + ',rank) ON ' +
               ' AND '.join('t.' + q(c) + '=ranks.' + q(c) for c in pk))
        require(len(sql.encode()) + v1.container_bytes(params) <= ROW_MAX,
                'SELF_GRAPH_BOUND', 'Typed self-rank query/parameters exceed1MiB')
        self.memory(params, sql)
        return sql, params, 'ranks.rank'

    def batches(self, name, generation):
        """PK/rank keysets, then raw COPY for that exact bounded range."""
        table, width = self.tables[name], self.widths[name]
        if width['rows'] == 0:
            return
        from_sql, rank_params, rank = self.ranked_from(name)
        pk = table['primary_key']['columns']
        fields = [rank] if rank else ['t.' + q(c) for c in pk]
        types = ['integer'] if rank else [table['columns'][c]['type'] for c in pk]
        key_sql = fields[0] if len(fields) == 1 else '(' + ','.join(fields) + ')'
        slot = '%s::' + types[0] if len(types) == 1 else '(' + ','.join('%s::' + t for t in types) + ')'
        take = max(1, min(1000, CHUNK_MAX // max(1, width['wire']), CHUNK_MAX // max(1, width['pk'])))
        last = None
        while True:
            lower = '' if last is None else ' AND ' + key_sql + '>' + slot
            args = [*rank_params, generation, *(last or []), take]
            base = ' FROM ' + from_sql + ' WHERE (' + self.owner(name) + ')=%s' + lower
            keys = self.source.execute('SELECT ' + ','.join(fields) + base + ' ORDER BY ' + ','.join(fields) + ' LIMIT %s', args).fetchall()
            if not keys:
                break
            self.buffered(keys, rank_params, args)
            upper = list(keys[-1])
            expressions = self.projection(name)
            if self.report.get('activeFault') == 'wrong-generation-map' and name == 'ingest.dataset_snapshot_documents' and not self.report.get('faultInjected'):
                index = list(table['columns']).index('snapshot_id')
                expressions[index] = '(' + expressions[index] + ')+1000000000'
                self.report['faultInjected'] = True
            select = 'SELECT ' + ','.join(expressions) + base + ' AND ' + key_sql + '<=' + slot + ' ORDER BY ' + ','.join(fields)
            copy_args = [*rank_params, generation, *(last or []), *upper]
            pieces, payload_size = [], 0
            started = time.monotonic()
            with self.source.cursor().copy('COPY (' + select + ') TO STDOUT WITH (FORMAT text)', copy_args) as cp:
                while True:
                    block = cp.read()
                    if not block:
                        break
                    payload_size += len(block)
                    require(payload_size <= CHUNK_MAX, 'SOURCE_BOUND', 'Actual encoded COPY batch exceeds1MiB')
                    pieces.append(bytes(block))
                    self.buffered(pieces, block, keys, rank_params, copy_args)
            payload = b''.join(pieces)
            self.buffered(payload, pieces, keys, rank_params, copy_args)
            self.report['sourceCopyReadMs'] += round((time.monotonic() - started) * 1000, 3)
            window = None if rank is None else {'relation': name, 'sourceGeneration': generation,
                'firstRank': int(keys[0][0]), 'lastRank': int(keys[-1][0]),
                'firstPk': list(self.self_order[name][int(keys[0][0])]),
                'lastPk': list(self.self_order[name][int(keys[-1][0])])}
            yield payload, len(keys), window
            # Keep only the last bounded PK tuple, never a growing ownership map.
            last = upper

    def copy_table(self, name, generation, fault):
        columns = list(self.tables[name]['columns'])
        for payload, rows, window in self.batches(name, generation):
            if fault == 'corrupt-first-fact' and name == 'ingest.sources' and not self.report.get('faultInjected'):
                # A valid text alteration which native SQL permits; phase parity
                # must reject it. No generic CSV/JSON parse/adaptation exists.
                payload, changed = re.subn(rb'Upstream fixture', b'Upstream corrupted', payload, count=1)
                require(changed == 1, 'INJECTED_FAILURE', 'The exact compact corruption fixture was not found')
                self.report['faultInjected'] = True
            require(len(payload) <= CHUNK_MAX, 'SOURCE_BOUND', 'Encoded COPY payload exceeds1MiB')
            self.buffered(payload)
            started = time.monotonic()
            with self.target.cursor().copy('COPY ' + rel(name) + ' (' + ','.join(map(q, columns)) + ') FROM STDIN WITH (FORMAT text)') as cp:
                # Deliberately unrelated to PostgreSQL row boundaries: exact raw
                # escaping, multibyte UTF8, JSONB and precision survive transport.
                for offset in range(0, len(payload), 4093):
                    cp.write(memoryview(payload)[offset:offset + 4093])
            elapsed = round((time.monotonic() - started) * 1000, 3)
            self.report['copyCommands'] += 1
            self.report['copiedRows'] += rows
            self.report['copiedScalarRows'] += rows if name == 'football.player_match_metric_values' else 0
            self.report['copyWriteMs'] += elapsed
            summary = self.report['copyTables'].setdefault(name, {'batches': 0, 'rows': 0, 'bytes': 0, 'maxBatchBytes': 0, 'writeMs': 0})
            summary.update(batches=summary['batches'] + 1, rows=summary['rows'] + rows,
                           bytes=summary['bytes'] + len(payload), maxBatchBytes=max(summary['maxBatchBytes'], len(payload)),
                           writeMs=round(summary['writeMs'] + elapsed, 3))
            if window is not None:
                self.report['selfCopyWindows'].append({**window, 'copyCommand': self.report['copyCommands'],
                                                       'rows': rows, 'encodedBytes': len(payload)})
            self.memory()
            if fault == 'after-copy-batches:2' and self.report['copyCommands'] == 2:
                raise Refusal('INJECTED_FAILURE', 'Deliberate compact mid-phase COPY rollback')
            if fault == 'during-families-after-copy' and generation == self.phases[-1]['generation']:
                raise Refusal('INJECTED_FAILURE', 'Deliberate family COPY rollback after committed core')

    def reserve(self):
        v1.Candidate.reserve(self)
        self.report['nextvalCalls'] = sum(r['calls'] for r in self.report['reservations'])
        self.memory()

    def apply(self, completed, fault):
        self.report['reusedPhases'] = len(completed)
        self.report['completedPhases'] = completed
        if len(completed) == len(self.phases):
            self.report['status'] = 'noop'
            return
        self.target.execute('SET default_transaction_read_only=off')
        reserved = False
        for phase in self.phases[len(completed):]:
            self.source_reopen()
            owners = {0, *(p['sourceGeneration'] for p in completed), phase['generation']}
            started = time.monotonic()
            expected = self.business(self.source, owners=owners)
            self.report['sourcePrefixOracleMs'].append(round((time.monotonic() - started) * 1000, 3))
            # All source acceptance/prefix work above precedes the target BEGIN.
            self.target.execute('BEGIN')
            try:
                transaction_start = self.target.execute('SELECT transaction_timestamp()').fetchone()[0]
                self.report['applicationStarted'] = True
                priority, cutoff = self.phase_contracts[phase['generation']]
                g = self.target.execute('SELECT ingest.begin_generation(%s,%s,%s,%s)',
                    (self.snapshot_key(phase), VERSION, priority, cutoff)).fetchone()[0]
                sid = self.target.execute('SELECT id FROM ingest.dataset_snapshots WHERE generation=%s', (g,)).fetchone()[0]
                self.maps_g[phase['generation']] = g
                self.maps_s[phase['snapshotId']] = sid
                require(len(set(self.maps_g.values())) == len(self.maps_g) and len(set(self.maps_s.values())) == len(self.maps_s),
                        'TARGET_DRIFT', 'Destination allocated a colliding control reference')
                if not reserved:
                    self.reserve()
                    reserved = True
                self.target.execute("INSERT INTO ingest.import_runs(id,mode,status,transform_version,code_commit,parameters) "
                    "OVERRIDING SYSTEM VALUE VALUES(%s,'backfill','running',%s,%s,%s::jsonb)",
                    (phase['runId'], VERSION, self.accepted['writerSha256'], canonical(self.parameters(phase))))
                start_count = self.report['copiedRows']
                for name in self.order:
                    if name in self.matrix['copiedRelations']:
                        self.copy_table(name, phase['generation'], fault)
                # No source reader is held idle during the target oracle or either
                # native admission. No heartbeat or timeout change is used.
                self.source.commit()
                self.report['sourceTransactionsClosedBeforeTargetAdmission'] += 1
                self.verify_business(expected, applying=True)
                require(self.report['copiedRows'] - start_count == self.phase_rows[phase['generation']],
                        'PHASE_ORACLE', 'Actual copied row count differs from accepted source ownership')
                checkpoint = {**self.control_binding(phase), 'generation': g, 'snapshot_id': sid,
                              'copied_rows': self.report['copiedRows'] - start_count,
                              'transaction_started_at': transaction_start.isoformat()}
                checkpoint['receipt_sha256'] = hashed(checkpoint)
                require(len(canonical(checkpoint).encode()) <= 16384, 'SOURCE_BOUND', 'Regenerated technical receipt exceeds16KiB')
                counters = {'copied_rows': checkpoint['copied_rows'], 'full_acceptance': False, 'local_only': True}
                self.target.execute("UPDATE ingest.import_runs SET status='partial',finished_at=CURRENT_TIMESTAMP,checkpoint=%s::jsonb,counters=%s::jsonb WHERE id=%s",
                                    (canonical(checkpoint), canonical(counters), phase['runId']))
                if fault == 'before-seal-timeout':
                    self.target.execute('SELECT pg_sleep(8.1)')
                started = time.monotonic()
                self.target.execute('SELECT ingest.seal_generation(%s,%s)', (g, hashed(checkpoint)))
                seal_ms = round((time.monotonic() - started) * 1000, 3)
                self.report['sealMs'].append(seal_ms)
                require(seal_ms < 8000, 'NATIVE_TIMEOUT', 'Native seal exceeded8s')
                started = time.monotonic()
                self.target.commit()
                commit_ms = round((time.monotonic() - started) * 1000, 3)
                self.report['commitMs'].append(commit_ms)
                require(commit_ms < 8000, 'NATIVE_TIMEOUT', 'Native deferred commit exceeded8s')
                item = {'phase': phase['phase'], 'sourceGeneration': phase['generation'], 'sourceSnapshotId': phase['snapshotId'],
                        'generation': g, 'snapshotId': sid, 'runId': phase['runId']}
                completed.append(item)
                self.report['completedPhases'] = completed
                if fault == 'after-commit-ack':
                    raise Refusal('COMMIT_ACK_UNKNOWN', 'Commit sent; fresh readonly prefix inspection is required')
                if fault == 'after-core-commit' and phase['phase'] == 'core':
                    raise Refusal('INJECTED_FAILURE', 'Deliberate process exit after committed core')
            except BaseException:
                self.source.rollback()
                self.target.rollback()
                raise
        # Fresh native control inspection verifies regenerated3 separately.
        completed = self.prefix()
        require(len(completed) == len(self.phases), 'TARGET_DRIFT', 'Final target control prefix is incomplete')
        self.report['status'] = 'applied'


    def memory(self, *extra):
        objects = (self.model, self.tables, self.matrix, self.rules, self.scope, self.order, self.binding, self.pair, self.accepted, self.report,
                   self.phases, self.phase_contracts, self.source_run_digest, self.source_runs, self.phase_rows,
                   self.bootstrap, self.self_order, self.sequence_plan, self.widths, self.target_widths,
                   self.control_columns, self.maps_g, self.maps_s, *extra)
        # Count shared children again, plus2MiB for bounded SQL/driver/iterator metadata.
        size = 2 * 1024 ** 2 + sum(v1.container_bytes(o) for o in objects)
        require(size <= META_MAX, 'SOURCE_BOUND', 'Combined metadata exceeds32MiB')
        self.report['maxMetadataBytes'] = max(self.report['maxMetadataBytes'], size)

    def buffered(self, *objects):
        # Two protocol buffers, the preceding yielded payload still referenced by
        # the consumer, and one live UTF8/framing or COPY encoding allocation.
        size = sum(v1.container_bytes(o) for o in objects) + 4 * ROW_MAX
        require(size <= BUFFER_MAX, 'SOURCE_BOUND', 'Combined live transport buffers exceed16MiB')
        self.report['maxBufferedBytes'] = max(self.report['maxBufferedBytes'], size)

    def check_pair(self):
        p, a = self.pair, self.accepted
        require(p.get('kind') == 'explicit_stream_v2_local_policy_pair_v1' and p.get('localOnly') is True and
                a.get('kind') == 'orion_pro_bulk_stream_v2_local_acceptance_v1' and a.get('localOnly') is True and
                p.get('writerSha256') == a.get('writerSha256') == digest(Path(__file__)) and
                p.get('bindingSha256') == a.get('bindingsSha256') == digest(BINDINGS) and
                a.get('modelSha256') == digest(MODEL) and a.get('pairSha256') == self.pair_sha,
                'BINDING', 'Writer/model/local acceptance is not this exact closed pair')
        sd, td = p['source'], p['target']
        shape = a['fixtureShape']
        expected_shape = {'APPEARANCES': shape['appearances'], 'SCALARS': shape['scalarRows'],
                          'MATCHES': shape['matches'], 'PLAYERS': 800 if shape['scalarRows'] == 478547 else 40,
                          'VERSION': FIXTURE_VERSION}
        producer = hashed({'frozenFixtureSha256': digest(ROOT / 'tests/orion_pro_bulk_stream_local.py'),
                           'e2eSha256': digest(ROOT / 'tests/orion_pro_bulk_stream_v2_local.py'),
                           'version': FIXTURE_VERSION, 'shape': expected_shape})
        require(sd.get('kind') == 'exact_local_typed_p1_overlay_v1' and
                td.get('kind') == 'exact_local_guard_v2_p1_journal_v1' and
                td.get('manifestSha256') == P1_SHA and
                (td.get('sourceRole'), td.get('targetRole')) == ('policy_runtime', 'policy_ingest') and
                sd.get('producerSha256') == a.get('producerSha256') == producer and
                sd.get('producerVersion') == a.get('producerVersion') == FIXTURE_VERSION and
                sd.get('producerOrigin') == a.get('fixtureOrigin') == 'owned_source_free_fixture' and
                sd.get('fixtureCodeSha256') == digest(ROOT / 'tests/orion_pro_bulk_stream_local.py') and
                sd.get('fixtureE2eSha256') == digest(ROOT / 'tests/orion_pro_bulk_stream_v2_local.py') and
                sd.get('functionSqlSha256') == FUNCTION_SHA and sd.get('modelSha256') == digest(MODEL) and
                shape in [{'scalarRows': 1240, 'appearances': 40, 'metrics': 31, 'matches': 4},
                          {'scalarRows': 478547, 'appearances': 15437, 'metrics': 31, 'matches': 612}],
                'BINDING', 'No implicit overlay/journal or real-source/fixture compatibility')

    def policies(self):
        # The closed policy loader ran and released its large temporary bundle
        # before the model/ownership structures were constructed.
        expected = self.report['policyCatalogueSha256']
        for conn, descriptor, code, versions in [(self.source, self.pair['source'], 'SOURCE_POLICY', ['012', '013']),
                                                 (self.target, self.pair['target'], 'TARGET_POLICY', ['012', '013', '014'])]:
            cat = policy.catalogue(conn)
            self.memory(cat)
            require(cat['sha256'] == expected == descriptor['catalogueSha256'], code, 'Exact native/security catalogue differs')
            del cat
            require(policy.function_properties(conn) == descriptor['functionProperties'], code, 'Validator native properties differ')
            journal = [list(row) for row in conn.execute('SELECT version,content_sha256,code_commit FROM ingest.schema_migrations ORDER BY version')]
            require(journal == descriptor['journal'] and [r[0] for r in journal] == versions and
                    [r[1] for r in journal] == [self.binding['inputs']['dashboard/backend/migrations/' + n]
                        for n in (['012_orion_pro_domain.sql', '013_orion_pro_integrity.sql'] +
                                  (['014_orion_pro_membership_nonnull.sql'] if len(versions) == 3 else []))],
                    code, 'Endpoint journal is not its explicitly bound chain')

    def baseline(self, conn, source):
        descriptor = self.pair['source' if source else 'target']
        rows = list(conn.execute("SELECT id,generation,snapshot_key,status,manifest_sha256,transform_version,"
                                 "source_priority_version,knowledge_cutoff_at,created_at,sealed_at,ROW(s.*)::text "
                                 "FROM ingest.dataset_snapshots s WHERE transform_version='bootstrap_v1' "
                                 "AND octet_length(ROW(s.*)::text)<=1048576 LIMIT 2"))
        require(len(rows) == 1, 'TARGET_DRIFT' if not source else 'SOURCE_POLICY', 'One exact B0 snapshot is required')
        sid, g, key, status, manifest, transform, priority, cutoff, created, sealed, native = rows[0]
        b0 = policy.bootstrap_contract()
        require((sid, g, key, status, manifest, transform, priority, cutoff) ==
                (1, 1, 'bootstrap-v1-' + digest(MODEL)[:16], 'sealed', b0['manifestSha256'], 'bootstrap_v1', 'bootstrap_v1', None) and
                created is not None and sealed is not None and created <= sealed and native == descriptor['bootstrapNativeText'],
                'TARGET_DRIFT' if not source else 'SOURCE_POLICY', 'Exact B0/control fields differ')
        for name, seeds in self.model['seed_data'].items():
            columns = list(self.tables[name]['columns'])
            actual = list(conn.execute('SELECT ' + ','.join(map(q, columns)) + ' FROM ' + rel(name) +
                                       " WHERE definition_version='bootstrap_v1' ORDER BY code"))
            expected = []
            for seed in sorted(seeds, key=lambda s: s['code']):
                values = dict.fromkeys(columns)
                values.update(seed, recorded_from_gen=1, transform_code_sha256=b0['artifactSha256'])
                expected.append(tuple(values[c] for c in columns))
            require(actual == expected, 'SOURCE_POLICY' if source else 'TARGET_DRIFT', 'Exact seed native values differ')
        for contract in self.model['bootstrap']['relation_contracts']:
            row = conn.execute('SELECT ' + ','.join(map(q, contract)) + ' FROM ingest.relation_contracts '
                               'WHERE relation_code=%s AND contract_version=%s',
                               (contract['relation_code'], contract['contract_version'])).fetchone()
            require(row == tuple(contract.values()), 'SOURCE_POLICY' if source else 'TARGET_DRIFT', 'B0 contract differs')
        require(self.native(conn, 'ingest.schema_migrations')['sha256'] == descriptor['journalNativeSha256'],
                'SOURCE_POLICY' if source else 'TARGET_DRIFT', 'Installation journal fields/clocks drifted')
        self.bootstrap['source' if source else 'target'] = {'generation': g, 'snapshotId': sid, 'nativeText': native}
        self.maps_g[1] = 1
        self.maps_s[1] = 1

    def owner(self, name, alias='t', depth=0):
        require(depth < 8, 'BINDING', 'Ownership ancestry is cyclic/deeper than the closed model')
        rule = self.rules[name]
        kind = rule['sourceOwnerRule']
        c = lambda column: alias + '.' + q(column)
        if name == 'ingest.schema_migrations':
            return '0::bigint'
        if name == 'ingest.dataset_snapshots':
            return 'CASE WHEN ' + c('generation') + '=1 THEN 0 ELSE ' + c('generation') + ' END'
        if kind in {'exactAcceptedRunPhase', 'exactImportRunPhase', 'exactAcceptedSourceRunToPhase_regenerateSameRunId'}:
            column = 'run_id' if kind == 'exactAcceptedRunPhase' else 'import_run_id' if kind == 'exactImportRunPhase' else 'id'
            return 'CASE ' + c(column) + ' ' + ' '.join('WHEN ' + str(run) + ' THEN ' + str(g) for run, g in self.source_runs.items()) + ' END'
        if kind == 'nativeRecordedGeneration':
            value = c('recorded_from_gen')
            if name in self.model['seed_data']:
                value = "CASE WHEN " + c('definition_version') + "='bootstrap_v1' THEN 0 ELSE " + value + ' END'
            return value
        if kind == 'explicitFirstPhase':
            value = str(self.phases[0]['generation']) + '::bigint'
            if name == 'ingest.relation_contracts':
                tests = ['(' + c('relation_code') + "='" + item['relation_code'] + "' AND " + c('contract_version') + "='" + item['contract_version'] + "')" for item in self.model['bootstrap']['relation_contracts']]
                value = 'CASE WHEN ' + ' OR '.join(tests) + ' THEN 0 ELSE ' + value + ' END'
            return value
        if kind == 'outOfScopeMustBeEmpty':
            return 'NULL::bigint'
        if kind == 'exactDatasetSnapshotPhase':
            parent, child, columns = 'ingest.dataset_snapshots', ['snapshot_id'], ['id']
        elif kind == 'exactDocumentPhase':
            parent, child, columns = 'ingest.source_documents', [rule['ancestry']['column']], ['id']
        elif kind in {'declaredParentVersionPhase', 'declaredAppendParentPhase'}:
            ancestry = rule['ancestry']
            parent, child, columns = ancestry['references']['table'], ancestry['columns'], ancestry['references']['columns']
        else:
            raise Refusal('BINDING', 'Unrecognized closed native ownership rule')
        p = 'owner_' + str(depth)
        where = ' AND '.join(p + '.' + q(pc) + '=' + c(cc) for cc, pc in zip(child, columns))
        return '(SELECT ' + self.owner(parent, p, depth + 1) + ' FROM ' + rel(parent) + ' ' + p + ' WHERE ' + where + ')'

    def projection(self, name, inverse=False):
        expressions = []
        for column in self.tables[name]['columns']:
            value = 't.' + q(column)
            kind = self.control_columns.get((name, column))
            if kind:
                mapping = self.maps_g if kind == 'generation' else self.maps_s
                if inverse:
                    mapping = {d: s for s, d in mapping.items()}
                value = 'CASE ' + value + ' ' + ' '.join('WHEN ' + str(s) + ' THEN ' + str(d) for s, d in mapping.items()) + ' ELSE ' + value + ' END'
            expressions.append(value)
        return expressions

    def native(self, conn, name, owners=None, inverse=False):
        columns = self.projection(name, True) if inverse else ['t.' + q(c) for c in self.tables[name]['columns']]
        sql = 'SELECT ROW(' + ','.join(columns) + ')::text FROM ' + rel(name) + ' t'
        if owners is not None:
            sql += ' WHERE (' + self.owner(name) + ') IN (' + ','.join(map(str, sorted(owners))) + ')'
        sql += ' ORDER BY ' + ','.join('t.' + q(c) for c in self.tables[name]['primary_key']['columns'])
        h, count = hashlib.sha256(), 0
        # Named cursor/FETCH creates bounded statements rather than a multi-minute
        # client COPY query. Each FETCH still has the unchanged native8s deadline.
        maximum = self.target_widths.get(name, ROW_MAX) if conn is self.target else self.widths.get(name, {}).get('native', ROW_MAX)
        take = max(1, min(1000, CHUNK_MAX // max(1, maximum + 128)))
        with conn.cursor(name='stream_v2_hash_' + str(time.monotonic_ns())) as cursor:
            cursor.execute(sql)
            for batch in iter(lambda: cursor.fetchmany(take), []):
                self.buffered(batch)
                for (text,) in batch:
                    require(len(text.encode()) <= ROW_MAX, 'SOURCE_BOUND', 'Native row exceeds1MiB')
                    v1.framed(h, text)
                    count += 1
                    require(count <= 500000, 'SOURCE_BOUND', 'Native table exceeds500k rows')
        return {'rows': count, 'sha256': h.hexdigest()}

    def business(self, conn, owners=None, inverse=False):
        return {name: self.native(conn, name, owners, inverse) for name in sorted(self.tables) if name not in CONTROL}

    def source_bounds(self):
        total = 0
        for name, table in self.tables.items():
            cols = list(table['columns'])
            native = 'octet_length(ROW(' + ','.join(map(q, cols)) + ')::text)'
            # COPY text escapes each byte at most fourfold. Control replacements
            # reserve20decimal digits independently of the source generation width.
            encoded = '+'.join('CASE WHEN ' + q(c) + ' IS NULL THEN 3 ELSE 4*greatest(octet_length(' + q(c) + '::text),' +
                               ('20' if (name, c) in self.control_columns else '0') + ')+1 END' for c in cols) + '+1'
            pk_width = '+'.join('coalesce(octet_length(' + q(c) + '::text),0)+128' for c in table['primary_key']['columns'])
            count, maximum, wire, key = self.source.execute('SELECT count(*),coalesce(max(' + native + '),0),'
                'coalesce(max(' + encoded + '),0),coalesce(max(' + pk_width + '),0) FROM ' + rel(name)).fetchone()
            require(count <= 500000 and maximum <= ROW_MAX and wire <= ROW_MAX and key <= ROW_MAX,
                    'SOURCE_BOUND', 'Source native/encoded/key row or relation cap exceeded')
            total += count
            require(total <= 2000000, 'SOURCE_BOUND', 'Source total exceeds2M rows')
            self.widths[name] = {'native': maximum, 'wire': wire, 'pk': key, 'rows': count}
            if name in self.matrix['mustBeEmptyRelations']:
                require(count == 0, 'PHASE_OWNERSHIP', 'Out-of-scope relation must be empty')
            if 'recorded_to_gen' in cols:
                require(not self.source.execute('SELECT EXISTS(SELECT 1 FROM ' + rel(name) + ' WHERE recorded_to_gen IS NOT NULL)').fetchone()[0],
                        'CLOSED_HISTORY', 'First delivery refuses retained closed intervals')
        self.report['sourceRows'] = total
        self.memory()

    def receipts(self):
        snapshots = list(self.source.execute('SELECT id,generation,status,manifest_sha256,snapshot_key,transform_version,'
            'source_priority_version,knowledge_cutoff_at FROM ingest.dataset_snapshots ORDER BY generation LIMIT 66'))
        require(len(snapshots) <= 65 and all(r[2] == 'sealed' for r in snapshots), 'SOURCE_RECEIPT', 'Invalid/unsealed source phase set')
        snapshots = {r[1]: r for r in snapshots if r[1] != 1}
        require(0 < len(snapshots) <= 64, 'SOURCE_RECEIPT', 'Source phase count outside1..64')
        self.phases, self.phase_contracts, self.source_runs, self.source_run_digest = [], {}, {}, {}
        runs = {}
        run_rows = self.source.execute('SELECT id,status,transform_version,code_commit,checkpoint::text,ROW(r.*)::text FROM ingest.import_runs r ORDER BY id LIMIT 65').fetchall()
        require(len(run_rows) <= 64, 'SOURCE_RECEIPT', 'Source run count exceeds64')
        for identifier, status, transform, producer, raw, native in run_rows:
            require(raw is not None and len(raw.encode()) <= 16384, 'SOURCE_RECEIPT', 'Oversized/missing source checkpoint')
            checkpoint = json.loads(raw, parse_float=Decimal)
            binding = checkpoint.get('binding', {})
            require(checkpoint.get('kind') == binding.get('kind') == 'orion_pro_phase_receipt_v2', 'SOURCE_RECEIPT', 'Unowned/unsupported source run')
            require((status, transform, producer) == ('partial', self.accepted['producerVersion'], self.accepted['producerSha256']) and
                    binding.get('model_sha256') == digest(MODEL) and binding.get('transform_sha256') == producer and
                    binding.get('transform_version') == transform, 'BINDING', 'Source transform/producer differs')
            generation = checkpoint.get('generation')
            snap = snapshots.get(generation)
            require(type(generation) is int and type(checkpoint.get('snapshot_id')) is int and
                    snap and generation not in runs and checkpoint.get('snapshot_id') == snap[0] and
                    checkpoint.get('receipt_key') == snap[4] and checkpoint.get('phase') == binding.get('phase'),
                    'SOURCE_RECEIPT', 'Phase receipt owner/snapshot differs')
            bare = {k: v for k, v in binding.items() if k != 'input_manifest_sha256'}
            require(binding.get('input_manifest_sha256') == hashed(bare) and
                    checkpoint.get('report_sha256') == hashed(checkpoint.get('report')) and
                    snap[3] == hashed({'input_manifest_sha256': binding['input_manifest_sha256'], 'report_sha256': checkpoint['report_sha256']}) and
                    snap[5] == transform, 'SOURCE_RECEIPT', 'Source sealed receipt digest differs')
            documents, h = 0, hashlib.sha256(b'[')
            with self.source.cursor(name='source_docs_' + str(time.monotonic_ns())) as cursor:
                cursor.itersize = 1
                cursor.execute('SELECT d.legacy_object_path,d.content_sha256 FROM ingest.dataset_snapshot_documents m '
                               'JOIN ingest.source_documents d ON d.id=m.document_id WHERE m.snapshot_id=%s '
                               'ORDER BY d.legacy_object_path,d.content_sha256', (snap[0],))
                for row in cursor:
                    if documents:
                        h.update(b',')
                    text = canonical(list(row)).encode()
                    require(len(text) <= ROW_MAX, 'SOURCE_BOUND', 'Document selector metadata exceeds bound')
                    h.update(text)
                    documents += 1
            h.update(b']')
            require(documents == binding['source_document_count'] and h.hexdigest() == binding['source_document_manifest_sha256'],
                    'SOURCE_RECEIPT', 'Exact source document membership differs')
            phase = {'phase': checkpoint['phase'], 'generation': generation, 'snapshotId': snap[0], 'runId': identifier, 'manifest': snap[3]}
            self.phase_contracts[generation] = (snap[6], snap[7])
            self.source_runs[identifier] = generation
            self.source_run_digest[identifier] = hashlib.sha256(native.encode()).hexdigest()
            runs[generation] = phase
        require(set(runs) == set(snapshots), 'SOURCE_RECEIPT', 'Every source phase needs exactly one receipt')
        self.phases = [runs[g] for g in sorted(runs)]
        require(self.phases == self.accepted.get('sourcePhases') and len({p['phase'] for p in self.phases}) == len(self.phases),
                'SOURCE_RECEIPT', 'Accepted source phase manifest differs')
        self.memory()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--preflight-local', action='store_true')
    mode.add_argument('--apply-local', action='store_true')
    parser.add_argument('--marker', type=Path)
    parser.add_argument('--pair', type=Path)
    parser.add_argument('--pair-sha256')
    parser.add_argument('--acceptance', type=Path)
    parser.add_argument('--acceptance-sha256')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--fault', choices=sorted(FAULTS))
    args = parser.parse_args()
    report = {'kind': VERSION, 'writerSha256': digest(Path(__file__)), 'status': 'offline_plan', 'localOnly': True, 'fullAcceptance': False,
              'connections': 0, 'copyCommands': 0, 'copiedRows': 0, 'copiedScalarRows': 0,
              'nextvalCalls': 0, 'reservations': [], 'copyTables': {}, 'plans': [],
              'sourceCopyReadMs': 0, 'copyWriteMs': 0, 'sourceReopenMs': [], 'sourcePrefixOracleMs': [],
              'targetOracleMs': [], 'sealMs': [], 'commitMs': [], 'reusedPhases': 0,
              'maxMetadataBytes': 0, 'maxBufferedBytes': 0, 'externalRequests': 0,
              'selfRankWitnesses': [], 'selfCopyWindows': [],
              'temporaryTablesCreated': 0, 'sourceTransactionsClosedBeforeTargetAdmission': 0,
              'startedAt': datetime.now(timezone.utc).isoformat()}
    source = target = stream = None
    locked = []
    started = time.monotonic()
    code = 0
    try:
        if not (args.preflight_local or args.apply_local):
            require(not args.fault, 'BINDING', 'Fault injection requires explicit owned local apply')
            report['nextStep'] = 'Exact owned fixture/policy acceptance; no connection or environment source is used by offline plan'
        else:
            require(all([args.marker, args.pair, args.pair_sha256, args.acceptance, args.acceptance_sha256]),
                    'BINDING', 'Explicit owned marker/pair/acceptance hashes are required')
            require(not args.fault or args.apply_local, 'BINDING', 'Closed faults require explicit apply')
            binding = fixed_bindings()
            require(digest(args.pair) == args.pair_sha256 and digest(args.acceptance) == args.acceptance_sha256,
                    'BINDING', 'Exact accepted metadata bytes differ')
            pair, accepted = read_json(args.pair), read_json(args.acceptance)
            marker = owned_marker(args.marker)
            loaded = policy.load_policy(policy.P1, P1_SHA)
            require(loaded['manifest']['qualifiedImportPairs'] == [], 'BINDING', 'Historical import pairs changed')
            caller_bytes = sum(v1.container_bytes(o) for o in [binding, pair, accepted, marker, report])
            # Additional8MiB conservatively reserves the loader's temporary
            # model/SQL/JSON serialization workspaces. Do not retain its oracle.
            loader_peak = max(loaded['metadataBytes'], v1.container_bytes(loaded)) + caller_bytes + 8 * 1024 ** 2
            require(loader_peak <= META_MAX, 'SOURCE_BOUND', 'Combined policy-loader metadata exceeds32MiB')
            report['maxMetadataBytes'] = loader_peak
            report['policyLoaderPeakEstimateBytes'] = loader_peak
            report['policyCatalogueSha256'] = loaded['oracle']['P1']['sha256']
            del loaded
            import psycopg
            source = connect(psycopg, marker, True)
            report['connections'] += 1
            target = connect(psycopg, marker, False)
            report['connections'] += 1
            if args.apply_local:
                for conn in [source, target]:
                    require(conn.execute('SELECT pg_try_advisory_lock(20261104,1)').fetchone()[0],
                            'LOCKED', 'A native writer already owns the source/target phase lock')
                    locked.append(conn)
            stream = Stream(source, target, pair, accepted, report, args.pair_sha256, binding)
            stream.check_pair()
            stream.policies()
            for conn, is_source in [(source, True), (target, False)]:
                with conn.transaction():
                    stream.baseline(conn, is_source)
            source.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
            stream.inspect_source()
            stream.target_bounds()
            completed = stream.prefix()
            expected = stream.business(source, owners={0, *(p['sourceGeneration'] for p in completed)})
            source.commit()
            with target.transaction():
                stream.verify_business(expected)
            report['status'] = 'preflight'
            report['activeFault'] = args.fault
            if args.apply_local:
                stream.apply(completed, args.fault)
    except BaseException as exc:
        code = 1
        sqlstate = getattr(exc, 'sqlstate', None)
        reason = getattr(exc, 'code', None)
        if reason is None:
            reason = 'NATIVE_TIMEOUT' if sqlstate in {'57014', '25P03', '55P03'} else 'NATIVE_FK' if sqlstate == '23503' else 'NATIVE_REJECTION' if sqlstate else 'LOCAL_FAILURE'
        report.update(status='refused', reasonCode=reason, sqlstate=sqlstate,
                      error=str(exc) if isinstance(exc, Refusal) else type(exc).__name__)
    finally:
        if stream:
            report['generationMap'] = stream.maps_g
            report['snapshotMap'] = stream.maps_s
        for conn in [source, target]:
            if conn is not None:
                try:
                    conn.rollback()
                    if conn in locked:
                        conn.execute('SELECT pg_advisory_unlock(20261104,1)')
                except Exception:
                    pass
                conn.close()
        report['elapsedMs'] = round((time.monotonic() - started) * 1000, 3)
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        text = json.dumps(report, indent=2, ensure_ascii=False, default=str) + '\n'
        require(len(text.encode()) <= 4 * 1024 ** 2, 'SOURCE_BOUND', 'Bounded evidence report exceeds4MiB')
        if args.report:
            args.report.write_text(text)
        print(text)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
