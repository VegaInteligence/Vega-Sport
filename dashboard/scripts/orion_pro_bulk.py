#!/usr/bin/env python3
"""Bounded, local-only native phase bulk writer; default is read-only preflight.

No source/collector/cloud client, raw body, schema mutation, privilege escalation,
sequence reset or sealed-table clone. See the pre-code bulk protocol and E2E.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
MIGRATOR = ROOT / 'dashboard/scripts/orion_pro_migrate.py'
SQL_PATHS = [ROOT / 'dashboard/backend/migrations' / n for n in ['012_orion_pro_domain.sql', '013_orion_pro_integrity.sql']]
APPROVED_MODEL = '18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
APPROVED_SQL = ['f255868599c72d69f40f575a919045325ea1093a00fe4f5a6b96eae9f2c49f65', '85525221cad51b32aff79a777098211b4112f9f00ea7161ac93945654eeb6968']
VERSION = 'orion_pro_bulk_local_v1'
MAX_PHASES, MAX_ROWS, MAX_TABLE = 64, 2_000_000, 500_000
CHUNK_ROWS, CHUNK_BYTES, ROW_BYTES = 1000, 1024 * 1024, 1024 * 1024
BUFFER_BYTES, META_BYTES = 16 * 1024 * 1024, 32 * 1024 * 1024
MAX_RESERVE, MAX_RESERVE_TOTAL, RESERVE_BLOCK = 1_000_000, 5_000_000, 10_000
EXCLUDED_INGEST = {'identity_candidates', 'reconciliation_runs', 'document_reconciliations', 'cleanup_items', 'collection_jobs', 'asset_jobs', 'dirty_editions'}
CONTROL = {'ingest.dataset_snapshots', 'ingest.schema_migrations', 'ingest.import_runs'}
FIRST_PHASE = {'ingest.sources', 'ingest.source_datasets', 'ingest.media_assets', 'ingest.relation_contracts', 'ingest.field_contracts',
               'football.associations', 'football.teams', 'football.players'}


class Refusal(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def require(condition, code, message):
    if not condition: raise Refusal(code, message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(value):
    """Lossless bounded control JSON only. COPY JSONB never passes through this."""
    if value is None: return 'null'
    if value is True: return 'true'
    if value is False: return 'false'
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int): return str(value)
    if isinstance(value, Decimal):
        require(value.is_finite(), 'SOURCE_RECEIPT', 'Non-finite control number')
        return format(value, 'f')
    if isinstance(value, list): return '[' + ','.join(canonical(v) for v in value) + ']'
    if isinstance(value, dict): return '{' + ','.join(canonical(k) + ':' + canonical(value[k]) for k in sorted(value)) + '}'
    raise Refusal('SOURCE_RECEIPT', 'Unsupported control JSON type')


def hashed(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def q(value):
    require(bool(re.fullmatch('[a-z_][a-z0-9_]*', value)), 'BINDING', 'Invalid approved SQL identifier')
    return '"' + value + '"'


def rel(value):
    return '.'.join(q(p) for p in value.split('.'))


def framed(h, value):
    raw = value.encode(); h.update(str(len(raw)).encode() + b':' + raw + b'\n')


def container_bytes(value):
    """Conservative metadata accounting: shared children deliberately counted twice."""
    size = sys.getsizeof(value)
    if isinstance(value, dict):
        size += sum(container_bytes(k) + container_bytes(v) for k, v in value.items())
    elif isinstance(value, (tuple, list, set)):
        size += sum(container_bytes(v) for v in value)
    return size


def bounded_json(path, limit):
    require(path.is_file() and path.stat().st_size <= limit, 'BINDING', 'Missing or oversized local metadata')
    return json.loads(path.read_text(), parse_float=Decimal)


def local_marker(path):
    marker = bounded_json(path, 4096)
    try:
        directory = Path(marker['dataDirectory']).resolve()
        require(marker['kind'] == 'orion_pro_owned_bulk_local_v1' and marker['ownerUid'] == os.getuid(), 'OWNED_MARKER', 'Wrong local marker owner')
        require(directory.name == 'data' and directory.parent.name.startswith('orion-pro-e2e-') and directory.stat().st_uid == os.getuid(), 'OWNED_MARKER', 'Unowned local data directory')
        lines = (directory / 'postmaster.pid').read_text().splitlines()
        require(int(lines[0]) == marker['pid'] and int(lines[3]) == marker['port'], 'OWNED_MARKER', 'Local postmaster identity differs')
        os.kill(marker['pid'], 0)
        require((directory / 'PG_VERSION').read_text().strip() == '18', 'OWNED_MARKER', 'Wrong local engine marker')
        require(marker['sourceDatabase'] != marker['targetDatabase'], 'LOCAL_ONLY', 'Source and target must differ')
        return marker
    except Refusal: raise
    except (OSError, KeyError, ValueError, TypeError): raise Refusal('OWNED_MARKER', 'Invalid local postmaster marker') from None


def connection(psycopg, marker, *, source, apply):
    from psycopg.conninfo import conninfo_to_dict
    key = 'ORION_BULK_SOURCE_DSN' if source else 'ORION_BULK_TARGET_DSN'
    try: args = conninfo_to_dict(os.environ.get(key, ''))
    except Exception: raise Refusal('LOCAL_ONLY', 'Invalid explicit local connection settings') from None
    allowed = {'host', 'port', 'dbname', 'user', 'sslmode', 'connect_timeout'}
    require(set(args) <= allowed and args.get('host') in {'127.0.0.1', '::1'} and args.get('user'), 'LOCAL_ONLY', 'Only literal owned loopback endpoints are allowed')
    expected = marker['sourceDatabase'] if source else marker['targetDatabase']
    require(args.get('dbname') == expected and str(args.get('port')) == str(marker['port']), 'LOCAL_ONLY', 'Database/port differs from owned local marker')
    try: connect_seconds = int(args.pop('connect_timeout', '8'))
    except ValueError: raise Refusal('LOCAL_ONLY', 'Invalid bounded local connection deadline') from None
    require(1 <= connect_seconds <= 8, 'LOCAL_ONLY', 'Connection deadline must not exceed eight seconds')
    conn = psycopg.connect(**args, autocommit=True, connect_timeout=connect_seconds,
                           options='-c statement_timeout=8000 -c lock_timeout=1000 -c default_transaction_read_only=on -c search_path=pg_catalog',
                           application_name=VERSION)
    try:
        require(conn.info.server_version == 180006, 'LOCAL_ONLY', 'Only the owned PostgreSQL18.6 engine is accepted')
        identity = conn.execute('SELECT current_database(),host(inet_server_addr()),inet_server_port(),pg_postmaster_start_time()').fetchone()
        require(identity[0] == expected and identity[1] in {'127.0.0.1', '::1'} and identity[2] == marker['port'] and identity[3] == datetime.fromisoformat(marker['postmasterStartedAt']), 'OWNED_MARKER', 'Server identity differs from owned local marker')
        role = conn.execute('SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
        memberships = conn.execute("SELECT count(*) FROM pg_roles WHERE rolname<>current_user AND pg_has_role(current_user,oid,'MEMBER')").fetchone()[0]
        owns = conn.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND c.relowner=current_user::regrole").fetchone()[0]
        require(not any(role) and not memberships and not owns, 'PRIVILEGED_ROLE', 'Application actors must be ordinary nonowner roles without memberships')
        if source:
            require(not conn.execute("SELECT has_table_privilege(current_user,'ingest.import_runs','INSERT')").fetchone()[0], 'SOURCE_ROLE', 'Source actor must be a reader')
        elif apply:
            permitted = conn.execute("SELECT has_table_privilege(current_user,'ingest.import_runs','INSERT') AND has_table_privilege(current_user,'ingest.import_runs','UPDATE') AND has_function_privilege(current_user,'ingest.begin_generation(text,text,text,timestamptz)','EXECUTE') AND has_function_privilege(current_user,'ingest.seal_generation(bigint,text)','EXECUTE')").fetchone()[0]
            require(permitted, 'WRITER_ROLE', 'Runtime actor cannot apply a typed generation')
        for statement in ["SET TimeZone='UTC'", "SET DateStyle='ISO, YMD'", "SET IntervalStyle='iso_8601'", "SET extra_float_digits=3", "SET client_encoding='UTF8'"]:
            conn.execute(statement)
        return conn
    except Exception:
        conn.close(); raise


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


def catalogue(conn):
    h = hashlib.sha256()
    for row in conn.execute(CATALOGUE_SQL):
        for value in row: framed(h, value)
    return h.hexdigest()


class Candidate:
    def __init__(self, source, target, accepted, report):
        self.source, self.target, self.accepted, self.report = source, target, accepted, report
        self.model = json.loads(MODEL.read_text())
        self.tables = {t['qualified_name']: t for s in self.model['schemas'] for t in s['tables'] if t['phase'] != 'models'}
        self.scope = {n for n in self.tables if n.startswith('football.') or (n.startswith('ingest.') and n.split('.')[1] not in EXCLUDED_INGEST and n not in {'ingest.dataset_snapshots', 'ingest.schema_migrations'})}
        require(len(self.tables) == 94 and len(self.scope) == 75, 'BINDING', 'Active catalogue/scope differs')
        remaining = {n: {f['references']['table'] for f in t['foreign_keys'] if f['references']['table'] != n} for n, t in self.tables.items()}
        self.order = []
        while remaining:
            ready = sorted(n for n, parents in remaining.items() if not parents)
            require(ready, 'BINDING', 'Inter-table FK cycle is unsupported')
            self.order.extend(ready)
            for n in ready: del remaining[n]
            for parents in remaining.values(): parents.difference_update(ready)
        self.owners = defaultdict(dict); self.indexes = defaultdict(lambda: defaultdict(dict)); self.self_order = {}
        self.meta_size = 1024 * 1024; self.retained_self_bytes = 0; self.metadata_peak = self.meta_size; self.graph_peak = 0
        self.sequence_plan = []; self.bootstrap = {}; self.phases = []; self.reserved = False
        self.maps_g = {}; self.maps_s = {}; self.source_runs = {}; self.source_run_digest = {}; self.phase_contracts = {}; self.max_row_bytes = {}
        # A collection child inherits its generation through the parent FK. Never
        # infer from a column's name or remap business/snapshot IDs indiscriminately.
        self.control_columns = {('ingest.dataset_snapshots', 'generation'): 'generation', ('ingest.dataset_snapshots', 'id'): 'snapshot'}
        changed = True
        while changed:
            changed = False
            for name, table in self.tables.items():
                for fk in table['foreign_keys']:
                    for column, parent in zip(fk['columns'], fk['references']['columns']):
                        kind = self.control_columns.get((fk['references']['table'], parent))
                        if kind:
                            old = self.control_columns.get((name, column))
                            require(old in {None, kind}, 'BINDING', 'Ambiguous control reference mapping')
                            if old is None: self.control_columns[(name, column)] = kind; changed = True

    def rows(self, conn, name, expressions=None):
        table = self.tables[name]; columns = list(table['columns'])
        expressions = expressions or [q(c) + '::text' for c in columns]
        order = ','.join('t.' + q(c) for c in table['primary_key']['columns'])
        with conn.cursor(name='bulk_' + str(time.monotonic_ns())) as cursor:
            cursor.execute(f"SELECT {','.join(expressions)} FROM {rel(name)} AS t ORDER BY {order}")
            # A single source row was size-checked server-side before any fetch.
            while True:
                item = cursor.fetchone()
                if item is None: break
                yield dict(zip(columns, item))

    def native(self, conn, name, *, source=False, phases=None, phase_only=None):
        table = self.tables[name]; columns = list(table['columns']); projections = {c: q(c) for c in columns}
        if not source and conn is self.target:
            maximum = conn.execute(f"SELECT coalesce(max(octet_length(ROW({','.join(q(c) for c in columns)})::text)),0) FROM {rel(name)}").fetchone()[0]
            require(maximum <= ROW_BYTES // 2, 'TARGET_DRIFT', 'Target row exceeds bounded preflight transport')
        else:
            maximum = self.max_row_bytes.get(name, ROW_BYTES // 2)
        fetch_rows = max(1, min(CHUNK_ROWS, CHUNK_BYTES // max(maximum + 64, 64)))
        if source:
            for col in columns:
                kind = self.control_columns.get((name, col))
                if kind:
                    mapping = self.maps_g if kind == 'generation' else self.maps_s
                    if mapping: projections[col] = 'CASE ' + q(col) + ' ' + ' '.join(f'WHEN {s} THEN {d}' for s, d in mapping.items()) + ' ELSE ' + q(col) + ' END'
        pk = table['primary_key']['columns']; h = hashlib.sha256(); count = 0
        order = ','.join('t.' + q(c) for c in pk)
        query = f"SELECT ROW({','.join(projections[c] for c in columns)})::text,{','.join(q(c) + '::text' for c in pk)} FROM {rel(name)} AS t ORDER BY {order}"
        with conn.cursor(name='hash_' + str(time.monotonic_ns())) as cursor:
            cursor.execute(query)
            for batch in iter(lambda: cursor.fetchmany(fetch_rows), []):
                for row in batch:
                    if source and phases is not None and self.owners[name][tuple(row[1:])] not in phases: continue
                    if source and phase_only is not None and self.owners[name][tuple(row[1:])] != phase_only: continue
                    framed(h, row[0]); count += 1
        return {'rows': count, 'sha256': h.hexdigest()}

    def baseline(self, conn, *, source):
        rows = list(conn.execute("SELECT id,generation,snapshot_key,status,manifest_sha256,transform_version,source_priority_version,knowledge_cutoff_at FROM ingest.dataset_snapshots WHERE snapshot_key LIKE 'bootstrap-v1-%'"))
        require(len(rows) == 1, 'BASELINE', 'One exact bootstrap receipt is required')
        sid, g, key, status, manifest, transform, priority, cutoff = rows[0]
        bundle = {'model': digest(MODEL), 'migrator': digest(MIGRATOR), 'migrations': {v: digest(p) for v, p in zip(['012', '013'], SQL_PATHS)}}
        artifact = hashed(bundle); expected_manifest = hashed({'bootstrap': self.model['seed_data'], 'artifact': artifact})
        require((key, status, manifest, transform, priority, cutoff) == ('bootstrap-v1-' + digest(MODEL)[:16], 'sealed', expected_manifest, 'bootstrap_v1', 'bootstrap_v1', None), 'BASELINE', 'Bootstrap contract differs')
        for name, seeds in self.model['seed_data'].items():
            columns = list(self.tables[name]['columns'])
            actual = list(conn.execute(f"SELECT {','.join(q(c) for c in columns)} FROM {rel(name)} WHERE definition_version='bootstrap_v1' ORDER BY code"))
            expected = []
            for seed in sorted(seeds, key=lambda s: s['code']):
                value = {c: None for c in columns}; value.update(seed, recorded_from_gen=g, transform_code_sha256=artifact)
                expected.append(tuple(value[c] for c in columns))
            require(actual == expected, 'BASELINE', 'Bootstrap seed native values differ')
        for expected in self.model['bootstrap']['relation_contracts']:
            columns = list(expected)
            value = conn.execute(f"SELECT {','.join(q(c) for c in columns)} FROM ingest.relation_contracts WHERE relation_code=%s AND contract_version=%s", (expected['relation_code'], expected['contract_version'])).fetchone()
            require(value == tuple(expected.values()), 'BASELINE', 'Bootstrap relation contract differs')
        journal = list(conn.execute('SELECT version,content_sha256,code_commit FROM ingest.schema_migrations ORDER BY version'))
        require([(r[0], r[1]) for r in journal] == list(zip(['012', '013'], APPROVED_SQL)), 'BASELINE', 'Sealed migration journal differs')
        if source: self.source_journal = journal; self.source_bootstrap = (g, sid)
        else:
            require(journal == self.source_journal, 'BASELINE', 'Installation code commit differs from accepted baseline')
            self.maps_g[self.source_bootstrap[0]] = g; self.maps_s[self.source_bootstrap[1]] = sid
        self.bootstrap['source' if source else 'target'] = {'generation': g, 'snapshotId': sid,
            'snapshotInstallationClocks': list(conn.execute('SELECT created_at::text,sealed_at::text FROM ingest.dataset_snapshots WHERE id=%s', (sid,)).fetchone()),
            'migrationInstallationClocks': list(conn.execute('SELECT version,applied_at::text FROM ingest.schema_migrations ORDER BY version'))}

    def phase_receipts(self):
        source = self.source
        rows = list(source.execute('SELECT id,generation,status,manifest_sha256,snapshot_key,transform_version,source_priority_version,knowledge_cutoff_at FROM ingest.dataset_snapshots ORDER BY generation'))
        require(all(r[2] == 'sealed' for r in rows), 'SOURCE_RECEIPT', 'Source has an unsealed/invalid snapshot')
        rows = [r for r in rows if r[1] != self.source_bootstrap[0]]
        require(0 < len(rows) <= MAX_PHASES, 'PHASE_BOUND', 'Source phase count is outside the approved bound')
        snapshots = {r[1]: r for r in rows}; runs = {}
        for identifier, status, transform, producer, raw, native in source.execute('SELECT id,status,transform_version,code_commit,checkpoint::text,ROW(r.*)::text FROM ingest.import_runs r ORDER BY id'):
            require(len(raw.encode()) <= 16384, 'SOURCE_RECEIPT', 'Oversized source checkpoint')
            checkpoint = json.loads(raw, parse_float=Decimal)
            binding = checkpoint.get('binding', {})
            require(checkpoint.get('kind') == 'orion_pro_phase_receipt_v2' and binding.get('kind') == checkpoint['kind'], 'SOURCE_RECEIPT', 'Unsupported source phase receipt')
            require((status, transform, producer) == ('partial', self.accepted['producerVersion'], self.accepted['producerSha256']) and
                    binding.get('model_sha256') == APPROVED_MODEL and binding.get('transform_sha256') == producer and binding.get('transform_version') == transform,
                    'BINDING', 'Source producer/transform differs from acceptance')
            generation = checkpoint.get('generation'); snap = snapshots.get(generation)
            require(snap and generation not in runs and checkpoint.get('snapshot_id') == snap[0] and checkpoint.get('receipt_key') == snap[4] and checkpoint.get('phase') == binding.get('phase'), 'SOURCE_RECEIPT', 'Phase ownership/receipt differs')
            input_binding = {k: v for k, v in binding.items() if k != 'input_manifest_sha256'}
            require(binding.get('input_manifest_sha256') == hashed(input_binding) and checkpoint.get('report_sha256') == hashed(checkpoint.get('report')), 'SOURCE_RECEIPT', 'Source phase control digest differs')
            require(snap[3] == hashed({'input_manifest_sha256': binding['input_manifest_sha256'], 'report_sha256': checkpoint['report_sha256']}) and snap[5] == transform, 'SOURCE_RECEIPT', 'Source sealed manifest differs')
            docs = list(source.execute('SELECT d.legacy_object_path,d.content_sha256 FROM ingest.dataset_snapshot_documents m JOIN ingest.source_documents d ON d.id=m.document_id WHERE m.snapshot_id=%s ORDER BY d.legacy_object_path,d.content_sha256', (snap[0],)))
            require(len(docs) == binding['source_document_count'] and hashed([list(r) for r in docs]) == binding['source_document_manifest_sha256'], 'SOURCE_RECEIPT', 'Source document membership differs')
            phase = {'phase': checkpoint['phase'], 'generation': generation, 'snapshotId': snap[0], 'runId': identifier, 'manifest': snap[3]}
            self.phase_contracts[generation] = (snap[6], snap[7])
            runs[generation] = phase; self.source_runs[str(identifier)] = generation
            self.source_run_digest[identifier] = hashlib.sha256(native.encode()).hexdigest()
        require(set(runs) == set(snapshots), 'SOURCE_RECEIPT', 'Source phases need one producer receipt each')
        self.phases = [runs[g] for g in sorted(runs)]
        require(self.phases == self.accepted.get('sourcePhases'), 'SOURCE_RECEIPT', 'Accepted source phase manifest differs')

    def index_lookup(self, table, columns, values):
        entry = self.indexes[table][tuple(columns)].get(tuple(values))
        require(entry is not None, 'PHASE_OWNERSHIP', 'Missing exact source dependency or unresolved phase ownership')
        return entry

    def check_metadata(self, graph_bytes=0):
        total = self.meta_size + self.retained_self_bytes + graph_bytes
        self.metadata_peak = max(self.metadata_peak, total); self.graph_peak = max(self.graph_peak, graph_bytes)
        require(total <= META_BYTES, 'SOURCE_BOUND', 'Ownership/index/self-reference metadata exceeds 32MiB')

    def owner(self, name, row):
        if name == 'ingest.schema_migrations': return 0
        if name == 'ingest.dataset_snapshots': return 0 if int(row['generation']) == self.source_bootstrap[0] else int(row['generation'])
        if name == 'ingest.import_runs':
            require(row['id'] in self.source_runs, 'PHASE_OWNERSHIP', 'Unowned source import run'); return self.source_runs[row['id']]
        if name in self.model['seed_data'] and row['definition_version'] == 'bootstrap_v1': return 0
        if name == 'ingest.relation_contracts' and (row['relation_code'], row['contract_version']) in {(c['relation_code'], c['contract_version']) for c in self.model['bootstrap']['relation_contracts']}: return 0
        if row.get('recorded_from_gen') is not None: return int(row['recorded_from_gen'])
        if name in FIRST_PHASE: return self.phases[0]['generation']
        if name == 'ingest.source_documents':
            require(row['import_run_id'] in self.source_runs, 'PHASE_OWNERSHIP', 'Source document needs an exact producer run'); return self.source_runs[row['import_run_id']]
        if name in {'ingest.source_records', 'ingest.document_lineage'}:
            column = 'document_id' if name == 'ingest.source_records' else 'derived_document_id'
            return self.index_lookup('ingest.source_documents', ['id'], [row[column]])[1]
        if name in {'ingest.resource_fetches', 'ingest.quality_issues'}:
            require(row['run_id'] in self.source_runs, 'PHASE_OWNERSHIP', 'Fetch/issue needs an exact producer run'); return self.source_runs[row['run_id']]
        if name == 'ingest.dataset_snapshot_documents':
            return self.index_lookup('ingest.dataset_snapshots', ['id'], [row['snapshot_id']])[1]
        definition = self.tables[name]; binding = definition.get('versioning', {}).get('parent_version_binding')
        if binding:
            return self.index_lookup(binding['references']['table'], binding['references']['columns'], [row[c] for c in binding['columns']])[1]
        if definition.get('versioning', {}).get('kind') == 'existing_append_only':
            parents = [fk for fk in definition['foreign_keys'] if self.tables[fk['references']['table']].get('versioning', {}).get('kind') == 'existing_append_only']
            require(parents, 'PHASE_OWNERSHIP', 'Append child has no approved generation ancestor')
            fk = parents[0]; return self.index_lookup(fk['references']['table'], fk['references']['columns'], [row[c] for c in fk['columns']])[1]
        raise Refusal('PHASE_OWNERSHIP', 'No native phase ownership rule for allowlisted table')

    def inspect_source(self):
        require(catalogue(self.source) == self.accepted.get('catalogueSha256') == catalogue(self.target), 'BINDING', 'Catalogue/constraints/triggers/functions/ACLs differ')
        for name, table in self.tables.items():
            if 'recorded_to_gen' in table['columns']:
                require(not self.source.execute(f'SELECT EXISTS(SELECT 1 FROM {rel(name)} WHERE recorded_to_gen IS NOT NULL)').fetchone()[0], 'CLOSED_HISTORY', 'v1 refuses closed retained intervals')
        self.baseline(self.source, source=True); self.baseline(self.target, source=False)
        manifest = {}; total = 0
        for name in sorted(self.tables):
            table = self.tables[name]; columns = list(table['columns'])
            count, maximum = self.source.execute(f"SELECT count(*),coalesce(max(octet_length(ROW({','.join(q(c) for c in columns)})::text)),0) FROM {rel(name)}").fetchone()
            require(count <= MAX_TABLE and maximum <= ROW_BYTES // 2, 'SOURCE_BOUND', 'Source table/row exceeds conservative local buffer bound')
            self.max_row_bytes[name] = maximum
            total += count; require(total <= MAX_ROWS, 'SOURCE_BOUND', 'Source exceeds approved total row bound')
            require(name in self.scope or name in CONTROL or count == 0, 'SOURCE_SCOPE', 'Source operational/analytics relation is nonempty')
            manifest[name] = self.native(self.source, name)
        self.report['sourceFingerprintComparison'] = {'actual': hashed(manifest), 'expected': self.accepted.get('sourceNativeSha256'),
            'mismatchedTables': [n for n in manifest if manifest[n] != self.accepted.get('sourceTables', {}).get(n)]}
        require(hashed(manifest) == self.accepted.get('sourceNativeSha256') and manifest == self.accepted.get('sourceTables') and total == self.accepted.get('sourceRows'), 'SOURCE_DRIFT', 'Native source fingerprint differs from acceptance')
        self.report['sourceNativeSha256'] = hashed(manifest)
        self.phase_receipts()
        references = defaultdict(set)
        for table in self.tables.values():
            references[table['qualified_name']].add(tuple(table['primary_key']['columns']))
            for fk in table['foreign_keys']: references[fk['references']['table']].add(tuple(fk['references']['columns']))
        allowed = {0, *(p['generation'] for p in self.phases)}
        for name in self.order:
            dependencies = {}; table = self.tables[name]; self_fks = [f for f in table['foreign_keys'] if f['references']['table'] == name]
            graph_bytes = sys.getsizeof(dependencies) if self_fks else 0
            for row in self.rows(self.source, name):
                key = tuple(row[c] for c in table['primary_key']['columns']); owner = self.owner(name, row)
                require(owner in allowed, 'PHASE_OWNERSHIP', 'Source row generation is not in accepted phase manifest')
                if row.get('transform_code_sha256') is not None and owner != 0:
                    require(row['transform_code_sha256'] == self.accepted['producerSha256'], 'BINDING', 'Fact transform differs from accepted producer')
                self.owners[name][key] = owner
                self.meta_size += sys.getsizeof(key) + sum(sys.getsizeof(v) for v in key) + 160
                for columns in references[name]:
                    values = tuple(row[c] for c in columns)
                    if any(v is None for v in values): continue
                    self.indexes[name][columns][values] = (key, owner)
                    self.meta_size += sys.getsizeof(values) + sum(sys.getsizeof(v) for v in values) + 160
                if self_fks:
                    dependencies[key] = [tuple(row[c] for c in f['columns']) for f in self_fks]
                    graph_bytes += container_bytes(key) + container_bytes(dependencies[key]) + 128
                self.check_metadata(graph_bytes)
                for fk in table['foreign_keys']:
                    values = tuple(row[c] for c in fk['columns'])
                    if any(v is None for v in values) or fk['references']['table'] == name: continue
                    _, parent_owner = self.index_lookup(fk['references']['table'], fk['references']['columns'], values)
                    # Bootstrap is generation-neutral; otherwise no forward dependency is transportable.
                    require(parent_owner == 0 or parent_owner <= owner, 'PHASE_OWNERSHIP', 'Source row depends on a future phase')
            if self_fks:
                edges = {}
                # Ready and ordered can both contain every key. Reserve both in
                # advance; keep the full edge/dependency charge while deleting edges.
                graph_bytes += sys.getsizeof(edges) + 2 * (64 + sum(16 + container_bytes(k) for k in dependencies))
                self.check_metadata(graph_bytes)
                for key, parents in dependencies.items():
                    edges[key] = set()
                    for fk, values in zip(self_fks, parents):
                        if any(v is None for v in values): continue
                        parent_key, parent_owner = self.index_lookup(name, fk['references']['columns'], values)
                        require(parent_owner == 0 or parent_owner <= self.owners[name][key], 'PHASE_OWNERSHIP', 'Self dependency points to a future phase')
                        edges[key].add(parent_key)
                    graph_bytes += container_bytes(key) + container_bytes(edges[key]) + 128
                    self.check_metadata(graph_bytes)
                ordered = []
                while edges:
                    ready = sorted(k for k, parents in edges.items() if not parents)
                    require(ready, 'SELF_CYCLE', 'Self dependency cycle is unsupported')
                    ordered.extend(ready)
                    for k in ready: del edges[k]
                    for parents in edges.values(): parents.difference_update(ready)
                self.self_order[name] = ordered
                self.retained_self_bytes += container_bytes(name) + container_bytes(ordered) + 128
                self.check_metadata()
                # Drop graph workspaces at this table, not only at the next self table.
                del edges, dependencies
        self.sequence_inspection()
        self.report.update(metadataBytes=self.metadata_peak, ownershipIndexBytes=self.meta_size,
                           retainedSelfReferenceBytes=self.retained_self_bytes, temporaryGraphPeakBytes=self.graph_peak,
                           metadataAccounting='conservative containers/graphs, not process RSS', sourceRows=total)

    def sequence_inspection(self):
        total = 0
        for name in sorted(self.scope):
            table = self.tables[name]
            for column, spec in table['columns'].items():
                sequence = None
                if spec.get('identity'):
                    sequence = self.source.execute('SELECT pg_get_serial_sequence(%s,%s)', (name, column)).fetchone()[0]
                else:
                    found = re.fullmatch(r"nextval\('([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)'::regclass\)", spec.get('default_sql', ''))
                    if found: sequence = found[1]
                if not sequence: continue
                minimum, maximum = self.source.execute(f'SELECT min({q(column)}),max({q(column)}) FROM {rel(name)}').fetchone()
                if maximum is None: continue
                require(minimum >= 1 and maximum <= MAX_RESERVE, 'RESERVATION_BOUND', 'Source business IDs exceed the approved nextval reservation bound')
                total += int(maximum); require(total <= MAX_RESERVE_TOTAL, 'RESERVATION_BOUND', 'Total source sequence reservation bound exceeded')
                spec_row = self.target.execute("SELECT increment_by,cycle,cache_size FROM pg_sequences WHERE schemaname||'.'||sequencename=%s", (sequence,)).fetchone()
                require(spec_row == (1, False, 1), 'RESERVATION_BOUND', 'Only increment1/noncycling/cache1 business sequences are supported')
                self.sequence_plan.append({'sequence': sequence, 'maximum': int(maximum)})
        self.report['reservationUpperBound'] = total

    def expected_business(self, phases):
        return {n: self.native(self.source, n, source=True, phases=phases) for n in sorted(self.tables) if n not in CONTROL}

    def verify_target(self, completed):
        expected = self.expected_business({0, *(p['sourceGeneration'] for p in completed)})
        actual = {n: self.native(self.target, n) for n in expected}
        require(expected == actual, 'TARGET_DRIFT', 'Destination rows differ from bootstrap/exact committed prefix')

    def prefix(self):
        rows = list(self.target.execute('SELECT id,mode,status,transform_version,code_commit,started_at,finished_at,parameters::text,counters::text,checkpoint::text,error IS NULL FROM ingest.import_runs ORDER BY id'))
        by_phase = {}
        for row in rows:
            try:
                checkpoint = json.loads(row[9], parse_float=Decimal)
                checksum = checkpoint.pop('receipt_sha256')
                require(checksum == hashed(checkpoint), 'TARGET_DRIFT', 'Bulk receipt checksum differs')
                checkpoint['receipt_sha256'] = checksum
                phase = checkpoint['phase']; planned = next(p for p in self.phases if p['phase'] == phase)
                require(phase not in by_phase and row[0] == planned['runId'] and row[1:5] == ('backfill', 'partial', VERSION, self.accepted['writerSha256']) and row[5] is not None and row[6] is not None and row[5] <= row[6] and row[10], 'TARGET_DRIFT', 'Bulk execution control row differs')
                binding = {'kind': 'orion_pro_bulk_phase_v1', 'phase': phase, 'writer_sha256': self.accepted['writerSha256'], 'model_sha256': APPROVED_MODEL,
                           'source_native_sha256': self.accepted['sourceNativeSha256'], 'source_generation': planned['generation'], 'source_snapshot_id': planned['snapshotId'],
                           'source_run_id': planned['runId'], 'source_run_sha256': self.source_run_digest[planned['runId']], 'source_phase_manifest_sha256': planned['manifest'],
                           'producer_sha256': self.accepted['producerSha256'], 'sql_sha256': self.accepted['sqlSha256']}
                require(all(checkpoint.get(k) == v for k, v in binding.items()), 'TARGET_DRIFT', 'Bulk binding differs from accepted source/writer')
                g, sid = checkpoint['generation'], checkpoint['snapshot_id']
                snap = self.target.execute('SELECT generation,status,manifest_sha256,transform_version,source_priority_version,snapshot_key,knowledge_cutoff_at FROM ingest.dataset_snapshots WHERE id=%s', (sid,)).fetchone()
                expected_key = 'bulk-v1:' + self.accepted['sourceNativeSha256'] + ':' + phase
                priority, cutoff = self.phase_contracts[planned['generation']]
                require(snap == (g, 'sealed', hashed(checkpoint), VERSION, priority, expected_key, cutoff), 'TARGET_DRIFT', 'Bulk snapshot/manifest differs')
                expected_parameters = canonical({'kind': VERSION, 'source_run_sha256': binding['source_run_sha256'], 'producer_sha256': binding['producer_sha256']})
                require(self.target.execute('SELECT %s::jsonb=%s::jsonb', (row[7], expected_parameters)).fetchone()[0], 'TARGET_DRIFT', 'Bulk parameters differ')
                counters = json.loads(row[8]); require(counters == {'copied_rows': checkpoint['copied_rows'], 'full_acceptance': False, 'local_only': True}, 'TARGET_DRIFT', 'Bulk counters differ')
                by_phase[phase] = {'phase': phase, 'sourceGeneration': planned['generation'], 'sourceSnapshotId': planned['snapshotId'], 'generation': g, 'snapshotId': sid, 'runId': planned['runId']}
            except Refusal: raise
            except (KeyError, StopIteration, TypeError, ValueError): raise Refusal('TARGET_DRIFT', 'Malformed or foreign destination receipt') from None
        completed = []
        for phase in self.phases:
            if phase['phase'] not in by_phase: break
            item = by_phase[phase['phase']]
            self.maps_g[item['sourceGeneration']] = item['generation']; self.maps_s[item['sourceSnapshotId']] = item['snapshotId']; completed.append(item)
        require(len(completed) == len(rows), 'TARGET_DRIFT', 'Destination phases are not an exact complete prefix')
        snapshots = {r[0] for r in self.target.execute('SELECT id FROM ingest.dataset_snapshots')}
        require(snapshots == {self.bootstrap['target']['snapshotId'], *(p['snapshotId'] for p in completed)}, 'TARGET_DRIFT', 'Destination has an unrelated snapshot')
        require(all(completed[i]['generation'] < completed[i + 1]['generation'] for i in range(len(completed) - 1)), 'TARGET_DRIFT', 'Destination generation ordering differs')
        self.verify_target(completed)
        return completed

    def reserve(self):
        for plan in self.sequence_plan:
            sequence, maximum = plan['sequence'], plan['maximum']
            value = self.target.execute('SELECT nextval(%s::regclass)', (sequence,)).fetchone()[0]; first = value; calls = 1
            while value < maximum:
                amount = min(RESERVE_BLOCK, maximum - value)
                value = self.target.execute('SELECT max(nextval(%s::regclass)) FROM generate_series(1,%s)', (sequence, amount)).fetchone()[0]
                calls += amount; require(calls <= MAX_RESERVE, 'RESERVATION_BOUND', 'Actual sequence reservation exceeded bound')
            self.report['reservations'].append({'sequence': sequence, 'sourceMaximum': maximum, 'firstReturned': first, 'lastReturned': value, 'calls': calls})
            require(sum(r['calls'] for r in self.report['reservations']) <= MAX_RESERVE_TOTAL, 'RESERVATION_BOUND', 'Actual total reservation exceeded bound')

    def phase_rows(self, name, generation):
        table = self.tables[name]; pk = table['primary_key']['columns']
        if name in self.self_order:
            for key in self.self_order[name]:
                if self.owners[name][key] != generation: continue
                where = ' AND '.join(q(c) + '::text=%s' for c in pk)
                value = self.source.execute(f"SELECT {','.join(q(c) + '::text' for c in table['columns'])} FROM {rel(name)} WHERE {where}", key).fetchone()
                yield dict(zip(table['columns'], value))
        else:
            for row in self.rows(self.source, name):
                if self.owners[name][tuple(row[c] for c in pk)] == generation: yield row

    def mapped_row(self, name, row):
        values = dict(row)
        for col in values:
            kind = self.control_columns.get((name, col))
            if kind and values[col] is not None:
                mapping = self.maps_g if kind == 'generation' else self.maps_s
                require(int(values[col]) in mapping, 'PHASE_OWNERSHIP', 'Forward/unknown destination control reference')
                values[col] = str(mapping[int(values[col])])
        return values

    def copy_table(self, name, generation, fault):
        columns = list(self.tables[name]['columns']); batch = []; size = 0; python_bytes = 0

        def flush():
            nonlocal batch, size, python_bytes
            if not batch: return
            before = time.monotonic()
            with self.target.cursor().copy(f"COPY {rel(name)} ({','.join(q(c) for c in columns)}) FROM STDIN") as copy:
                for values in batch: copy.write_row(values)
            elapsed = round((time.monotonic() - before) * 1000, 3)
            self.report['copyCommands'] += 1; self.report['copiedRows'] += len(batch)
            self.report['copyChunks'].append({'table': name, 'rows': len(batch), 'estimatedBytes': size, 'elapsedMs': elapsed})
            batch = []; size = 0; python_bytes = 0
            if fault and fault.startswith('after-copy-chunks:') and self.report['copyCommands'] == int(fault.split(':')[1]):
                raise Refusal('INJECTED_FAILURE', 'Deliberate local mid-phase rollback')

        for row in self.phase_rows(name, generation):
            values = self.mapped_row(name, row)
            if fault == 'corrupt-first-scalar' and name == 'ingest.sources' and not self.report.get('faultInjected'):
                values['name'] = values['name'] + ':corrupted'; self.report['faultInjected'] = True
            line = tuple(values[c] for c in columns)
            estimate = sum(2 if v is None else len(v.encode()) * 2 + 1 for v in line) + 1
            require(estimate <= ROW_BYTES, 'SOURCE_BOUND', 'Encoded COPY row exceeds 1MiB')
            if batch and (len(batch) >= CHUNK_ROWS or size + estimate > CHUNK_BYTES): flush()
            batch.append(line); size += estimate
            python_bytes += sys.getsizeof(line) + sum(sys.getsizeof(v) for v in line)
            # Count the entire retained batch (shared values deliberately overcounted),
            # two wire/adaptation buffers and 2MiB for the bounded live source row.
            buffered = size * 2 + python_bytes + sys.getsizeof(batch) + 2 * ROW_BYTES
            require(buffered <= BUFFER_BYTES, 'SOURCE_BOUND', 'COPY buffers exceed 16MiB')
            self.report['maxBufferedBytes'] = max(self.report['maxBufferedBytes'], buffered)
        flush()

    def apply(self, completed, fault):
        self.report['completedPhases'] = completed; self.report['reusedPhases'] = len(completed)
        if len(completed) == len(self.phases): self.report['status'] = 'noop'; return
        self.target.execute('SET default_transaction_read_only=off')
        for phase in self.phases[len(completed):]:
            self.target.execute('BEGIN')
            try:
                self.report['applicationStarted'] = True
                key = 'bulk-v1:' + self.accepted['sourceNativeSha256'] + ':' + phase['phase']
                priority, cutoff = self.phase_contracts[phase['generation']]
                g = self.target.execute('SELECT ingest.begin_generation(%s,%s,%s,%s)', (key, VERSION, priority, cutoff)).fetchone()[0]
                sid = self.target.execute('SELECT id FROM ingest.dataset_snapshots WHERE generation=%s', (g,)).fetchone()[0]
                self.maps_g[phase['generation']] = g; self.maps_s[phase['snapshotId']] = sid
                if not self.reserved:
                    self.reserve(); self.reserved = True
                parameters = {'kind': VERSION, 'source_run_sha256': self.source_run_digest[phase['runId']], 'producer_sha256': self.accepted['producerSha256']}
                self.target.execute("INSERT INTO ingest.import_runs(id,mode,status,transform_version,code_commit,parameters) OVERRIDING SYSTEM VALUE VALUES(%s,'backfill','running',%s,%s,%s::jsonb)",
                                    (phase['runId'], VERSION, self.accepted['writerSha256'], canonical(parameters)))
                start_count = self.report['copiedRows']
                for name in self.order:
                    if name in self.scope and name != 'ingest.import_runs': self.copy_table(name, phase['generation'], fault)
                item = {'phase': phase['phase'], 'sourceGeneration': phase['generation'], 'sourceSnapshotId': phase['snapshotId'], 'generation': g, 'snapshotId': sid, 'runId': phase['runId']}
                try: self.verify_target([*completed, item])
                except Refusal: raise Refusal('PHASE_ORACLE', 'Native phase rows differ before seal') from None
                checkpoint = {'kind': 'orion_pro_bulk_phase_v1', 'phase': phase['phase'], 'writer_sha256': self.accepted['writerSha256'], 'model_sha256': APPROVED_MODEL,
                              'sql_sha256': self.accepted['sqlSha256'], 'producer_sha256': self.accepted['producerSha256'],
                              'source_native_sha256': self.accepted['sourceNativeSha256'], 'source_generation': phase['generation'], 'source_snapshot_id': phase['snapshotId'],
                              'source_run_id': phase['runId'], 'source_run_sha256': self.source_run_digest[phase['runId']], 'source_phase_manifest_sha256': phase['manifest'],
                              'generation': g, 'snapshot_id': sid, 'copied_rows': self.report['copiedRows'] - start_count}
                checkpoint['receipt_sha256'] = hashed(checkpoint)
                require(len(canonical(checkpoint).encode()) <= 16384, 'SOURCE_BOUND', 'Bulk checkpoint exceeds installed bound')
                counters = {'copied_rows': checkpoint['copied_rows'], 'full_acceptance': False, 'local_only': True}
                self.target.execute("UPDATE ingest.import_runs SET status='partial',finished_at=CURRENT_TIMESTAMP,checkpoint=%s::jsonb,counters=%s::jsonb WHERE id=%s", (canonical(checkpoint), canonical(counters), phase['runId']))
                if fault == 'before-seal-timeout': self.target.execute('SELECT pg_sleep(8.1)')
                start = time.monotonic(); self.target.execute('SELECT ingest.seal_generation(%s,%s)', (g, hashed(checkpoint)))
                self.report['sealMs'].append(round((time.monotonic() - start) * 1000, 3))
                start = time.monotonic(); self.target.commit(); self.report['commitMs'].append(round((time.monotonic() - start) * 1000, 3))
                completed.append(item)
                if fault and fault.startswith('after-phase:') and len(completed) == int(fault.split(':')[1]):
                    raise Refusal('INJECTED_FAILURE', 'Deliberate stop after committed prefix')
            except Exception:
                self.target.rollback(); raise
        self.report['status'] = 'applied'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--marker', type=Path, required=True)
    parser.add_argument('--acceptance', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--apply-local', action='store_true')
    parser.add_argument('--fault', choices=['after-copy-chunks:2', 'after-phase:1', 'before-seal-timeout', 'corrupt-first-scalar'])
    args = parser.parse_args()
    report = {'kind': VERSION, 'startedAt': datetime.now(timezone.utc).isoformat(), 'status': 'refused', 'remoteActions': [], 'fullAcceptance': False,
              'applyLocal': args.apply_local, 'statementTimeoutMs': 8000, 'lockTimeoutMs': 1000, 'completedPhases': [], 'reusedPhases': 0,
              'copyCommands': 0, 'copiedRows': 0, 'copyChunks': [], 'maxBufferedBytes': 0, 'sealMs': [], 'commitMs': [], 'reservations': []}
    source = target = None
    try:
        require(digest(MODEL) == APPROVED_MODEL and [digest(p) for p in SQL_PATHS] == APPROVED_SQL, 'BINDING', 'Approved model/sealed SQL bytes differ')
        accepted = bounded_json(args.acceptance, 128 * 1024)
        require(accepted.get('kind') == 'orion_pro_bulk_local_acceptance_v1' and accepted.get('localOnly') is True and accepted.get('modelSha256') == APPROVED_MODEL and
                accepted.get('writerSha256') == digest(Path(__file__)) and accepted.get('sqlSha256') == {p.name: h for p, h in zip(SQL_PATHS, APPROVED_SQL)}, 'BINDING', 'Acceptance/writer/model/SQL binding differs')
        require(not args.fault or args.apply_local, 'LOCAL_ONLY', 'Local fault requires explicit apply-local')
        marker = local_marker(args.marker)
        import psycopg
        source = connection(psycopg, marker, source=True, apply=args.apply_local)
        target = connection(psycopg, marker, source=False, apply=args.apply_local)
        if args.apply_local:
            for conn in [source, target]:
                require(conn.execute('SELECT pg_try_advisory_lock(20261104,1)').fetchone()[0], 'WRITER_LEASE', 'Writer coordination lease is occupied')
        source.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); target.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        candidate = Candidate(source, target, accepted, report); candidate.inspect_source(); completed = candidate.prefix()
        report.update(bootstrap=candidate.bootstrap, completedPhases=completed, reusedPhases=len(completed),
                      phaseCount=len(candidate.phases), sourceTables=75, tableOrder=[n for n in candidate.order if n in candidate.scope],
                      limits={'phases': MAX_PHASES, 'rows': MAX_ROWS, 'rowsPerTable': MAX_TABLE, 'chunkRows': CHUNK_ROWS, 'chunkBytes': CHUNK_BYTES, 'bufferBytes': BUFFER_BYTES, 'metadataBytes': META_BYTES})
        target.rollback()
        if args.apply_local: candidate.apply(completed, args.fault)
        else: report['status'] = 'planned'
    except Exception as exc:
        report['status'] = 'failed' if report.get('applicationStarted') else 'refused'
        report['errorType'] = type(exc).__name__; report['sqlstate'] = getattr(exc, 'sqlstate', None)
        report['reasonCode'] = exc.code if isinstance(exc, Refusal) else ('DATABASE' if report['sqlstate'] else 'LOCAL_ERROR')
        report['reason'] = str(exc) if isinstance(exc, Refusal) else (exc.diag.message_primary if getattr(exc, 'diag', None) else 'Local bulk operation failed; no payload logged')
    finally:
        for conn in [source, target]:
            if conn:
                try: conn.close()
                except Exception: pass
        report['finishedAt'] = datetime.now(timezone.utc).isoformat()
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, default=str) + '\n')
        print(json.dumps({'status': report['status'], 'reasonCode': report.get('reasonCode'), 'report': str(args.report)}))
    return 0 if report['status'] in {'planned', 'applied', 'noop'} else 1


if __name__ == '__main__':
    raise SystemExit(main())
