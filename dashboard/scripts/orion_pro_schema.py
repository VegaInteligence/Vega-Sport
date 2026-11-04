"""Compile the approved selective-inline model into additive PostgreSQL 18 DDL.

The E2E contract and its first missing-runner failure precede this compiler.
No cloud connection, ingestion, source body store or history table is created here.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
APPROVAL = ROOT / 'docs/verification/orion-pro-pilot-20261104/approval.json'
ALLOWED_TYPES = {'bigint', 'boolean', 'date', 'double precision', 'integer', 'jsonb',
                 'numeric', 'numeric(12,3)', 'numeric(16,6)', 'smallint', 'text',
                 'text[]', 'timestamptz', 'tsvector'}


def ident(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z_][a-z0-9_]*', value) or len(value.encode()) > 63:
        raise ValueError('Invalid approved SQL identifier')
    return '"' + value + '"'


def relation(value):
    parts = value.split('.')
    if len(parts) != 2 or parts[0] not in {'ingest', 'football', 'analytics'}:
        raise ValueError('SQL relation outside the approved schemas')
    return '.'.join(ident(p) for p in parts)


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return 'TRUE' if value else 'FALSE'
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError('Nonfinite literal')
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def cols(names):
    return ', '.join(ident(n) for n in names)


def expression(value):
    if not isinstance(value, str) or not value.strip() or any(x in value for x in (';', '--', '/*', '\x00')):
        raise ValueError('Unexpected statement syntax in an approved SQL expression')
    return value


def approved_model(path=SPEC):
    path = Path(path)
    body = path.read_bytes()
    receipt = json.loads(APPROVAL.read_text())
    if receipt.get('status') != 'approved_pilot_in_progress':
        raise ValueError('Missing explicit Pro pilot approval')
    actual = hashlib.sha256(body).hexdigest()
    model = json.loads(body)
    if actual == receipt['schemaSha256']:
        return model
    # The user's objective permits targeted missing-data/contract corrections.
    # Retain the original approval unchanged and accept only this bounded,
    # inspectable eight-path correction, never an arbitrary replacement model.
    amendment = json.loads(APPROVAL.with_name('model-amendments.json').read_text())
    if amendment['baselineModelSha256'] != receipt['schemaSha256'] or amendment['baselineModelGitCommit'] != receipt['approvedPlanCommit'] or len(amendment['amendments']) != 1:
        raise ValueError('Invalid bounded model amendment chain')
    delta = amendment['amendments'][0]
    if delta['id'] != 'native-metric-states-v1' or delta['status'] != 'in_scope_targeted_correction' or delta['resultModelSha256'] != actual:
        raise ValueError('Unrecognized targeted model correction')
    if any(delta[k] for k in ('tablesAdded', 'columnsAdded', 'keyChanges')) or len(delta['changes']) != 8:
        raise ValueError('Targeted correction cannot alter tables, columns or keys')
    baseline_bytes = subprocess.check_output(['git', 'show', receipt['approvedPlanCommit'] + ':docs/architecture/orion-plan-20261104/target-schema.proposed.json'], cwd=ROOT)
    if hashlib.sha256(baseline_bytes).hexdigest() != receipt['schemaSha256']:
        raise ValueError('Original approved model bytes differ')
    reconstructed = json.loads(baseline_bytes)
    tables = {t['qualified_name']: t for s in reconstructed['schemas'] for t in s['tables']}
    seen = set()
    for change in delta['changes']:
        name, kind = change['table'], change['kind']
        if name not in {'football.player_match_metric_values', 'football.team_match_metric_values'}:
            raise ValueError('Correction outside registered metric observations')
        table = tables[name]
        if kind == 'check':
            if change['name'] not in {name.replace('.', '_') + s for s in ('_one_value_ck', '_value_kind_ck')}:
                raise ValueError('Unapproved CHECK amendment')
            target, field = next(x for x in table['checks'] if x['name'] == change['name']), 'sql'
            key = name, kind, change['name']
        elif kind == 'column_description' and change.get('column') == 'value_kind':
            target, field = table['columns']['value_kind'], 'description'
            key = name, kind, 'value_kind'
        elif kind == 'table_description':
            target, field = table, 'description'
            key = name, kind, 'description'
        else:
            raise ValueError('Unapproved model amendment kind')
        if key in seen or target[field] != change['before']:
            raise ValueError('Amendment preimage mismatch or duplicate path')
        seen.add(key)
        target[field] = change['after']
    if len(seen) != 8 or reconstructed != model:
        raise ValueError('Model contains unrecorded changes outside the correction')
    return model


def active_tables(model, include_reserved=False):
    tables = {t['qualified_name']: t for s in model['schemas'] for t in s['tables']
              if include_reserved or t['phase'] != 'models'}
    for name, table in tables.items():
        relation(name)
        if name.endswith('_history') or name in {'ingest.row_versions', 'ingest.dataset_snapshot_rows',
                                                'ingest.field_states', 'ingest.record_row_links'}:
            raise ValueError('Superseded history/registry is not part of the approved model')
        for fk in table['foreign_keys']:
            if fk['references']['table'] not in tables:
                raise ValueError('Active table depends on a deferred model table')
    return tables


def schema_sql(model, include_reserved=False):
    tables = active_tables(model, include_reserved)
    out = ['-- Approved Pro selective-inline pilot; no legacy schema/data changes.',
           f'-- {len(tables)} typed tables; reserved model tables are deferred by default.']
    for schema in ('ingest', 'football', 'analytics'):
        out.extend((f'CREATE SCHEMA IF NOT EXISTS {ident(schema)};',
                    f'REVOKE ALL ON SCHEMA {ident(schema)} FROM PUBLIC;'))
    for seq in model['database'].get('sequences', []):
        if seq['type'] != 'bigint' or seq.get('minimum') != 1:
            raise ValueError('Unsupported approved sequence')
        out.append(f"CREATE SEQUENCE {relation(seq['qualified_name'])} AS bigint MINVALUE 1;")
    for name, table in tables.items():
        definitions = []
        for column, spec in table['columns'].items():
            if spec['type'] not in ALLOWED_TYPES:
                raise ValueError('Unsupported approved SQL type')
            line = ident(column) + ' ' + spec['type']
            if spec.get('identity'):
                if spec['identity'] != 'GENERATED ALWAYS AS IDENTITY':
                    raise ValueError('Unsupported identity declaration')
                line += ' GENERATED ALWAYS AS IDENTITY'
            if spec.get('default_sql') is not None:
                line += ' DEFAULT ' + expression(spec['default_sql'])
            if not spec['nullable']:
                line += ' NOT NULL'
            definitions.append(line)
        pk = table['primary_key']
        definitions.append(f"CONSTRAINT {ident(pk['name'])} PRIMARY KEY ({cols(pk['columns'])})")
        for uq in table['unique_constraints']:
            if uq.get('where_sql') or uq.get('deferrable'):
                raise ValueError('Expected real nonpartial nondeferrable unique constraints')
            nulls = ' NULLS NOT DISTINCT' if uq.get('nulls_not_distinct') else ''
            definitions.append(f"CONSTRAINT {ident(uq['name'])} UNIQUE{nulls} ({cols(uq['columns'])})")
        for ck in table['checks']:
            definitions.append(f"CONSTRAINT {ident(ck['name'])} CHECK ({expression(ck['sql'])})")
        out.append(f'CREATE TABLE {relation(name)} (\n  ' + ',\n  '.join(definitions) + '\n);')
        out.append(f"COMMENT ON TABLE {relation(name)} IS {literal(table['description'] + ' Grain: ' + table['grain'])};")
        for column, spec in table['columns'].items():
            out.append(f"COMMENT ON COLUMN {relation(name)}.{ident(column)} IS {literal(spec['description'])};")
    for name, table in tables.items():
        for fk in table['foreign_keys']:
            ref = fk['references']
            match, update, delete = fk.get('match', 'SIMPLE'), fk.get('on_update', 'NO ACTION'), fk.get('on_delete', 'RESTRICT')
            if match not in {'SIMPLE', 'FULL'} or update not in {'NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL'} or delete not in {'NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL'}:
                raise ValueError('Unsupported approved FK action')
            tail = f'MATCH {match} ON UPDATE {update} ON DELETE {delete}'
            tail += (' DEFERRABLE INITIALLY ' + ('DEFERRED' if fk.get('initially_deferred') else 'IMMEDIATE')) if fk.get('deferrable') else ' NOT DEFERRABLE'
            out.append(f"ALTER TABLE {relation(name)} ADD CONSTRAINT {ident(fk['name'])} FOREIGN KEY ({cols(fk['columns'])}) REFERENCES {relation(ref['table'])} ({cols(ref['columns'])}) {tail};")
        for idx in table['indexes']:
            method = idx['method']
            if method not in {'btree', 'gin'}:
                raise ValueError('Unsupported approved index method')
            keys = []
            for key in idx['keys']:
                value = ident(key['column'])
                if key.get('order'):
                    if method != 'btree' or key['order'] not in {'ASC', 'DESC'}:
                        raise ValueError('Unsupported index order')
                    value += ' ' + key['order']
                if key.get('nulls'):
                    if method != 'btree' or key['nulls'] not in {'FIRST', 'LAST'}:
                        raise ValueError('Unsupported index null ordering')
                    value += ' NULLS ' + key['nulls']
                keys.append(value)
            nulls = ' NULLS NOT DISTINCT' if idx.get('nulls_not_distinct') else ''
            if nulls and not idx.get('unique'):
                raise ValueError('NULLS NOT DISTINCT requires a unique index')
            where = ' WHERE ' + expression(idx['where_sql']) if idx.get('where_sql') else ''
            out.append(f"CREATE {'UNIQUE ' if idx.get('unique') else ''}INDEX {ident(idx['name'])} ON {relation(name)} USING {method} ({', '.join(keys)}){nulls}{where};")
    for name, table in tables.items():
        meta = table.get('versioning', {})
        if meta.get('class') != 'selected' and name not in model.get('selective_versioning', {}).get('selected_relations', []):
            if not ('recorded_to_gen' in table['columns'] or 'published_to_gen' in table['columns']):
                continue
        end = 'published_to_gen' if 'published_to_gen' in table['columns'] else 'recorded_to_gen'
        if end not in table['columns']:
            continue
        predicates = [ident(end) + ' IS NULL']
        if 'is_canonical' in table['columns']:
            predicates.append(ident('is_canonical'))
        if 'is_deleted' in table['columns']:
            predicates.append('NOT ' + ident('is_deleted'))
        out.append(f"CREATE VIEW {relation(name + '_current')} AS SELECT * FROM {relation(name)} WHERE " + ' AND '.join(predicates) + ';')
    return '\n\n'.join(out) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'dashboard/backend/migrations/012_orion_pro_domain.sql')
    args = parser.parse_args()
    model = approved_model()
    args.output.write_text(schema_sql(model))
    tables = active_tables(model)
    print(json.dumps({'file': str(args.output), 'tables': len(tables), 'columns': sum(len(t['columns']) for t in tables.values()),
                      'foreignKeys': sum(len(t['foreign_keys']) for t in tables.values()), 'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}))
