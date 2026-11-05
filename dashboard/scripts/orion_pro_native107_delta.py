"""Compile only the user-approved structural delta over the sealed015 chain."""
from __future__ import annotations

import copy
import json
from pathlib import Path

from orion_pro_schema import ALLOWED_TYPES, active_tables, cols, expression, ident, literal, relation
from orion_pro_integrity import _child_sets_equal, _no_op_check, _retained_insert_guard, _version_guard
from orion_pro_native107_schema import BASE, EXPECTED, approved_model, require, sha

HERE = Path(__file__).resolve().parent
NATIVE_RULES = HERE / 'sql/orion_pro_native107_validation.sql'
MIGRATION015 = next(p for p in EXPECTED if p.name == '015_orion_pro_metric_membership_guard.sql')
COVERAGE = 'ingest.match_coverage'
COVERAGE_KEY = ['match_id', 'source_id', 'feature_code', 'variant_key', 'recorded_from_gen']
COORDINATES = {'raw_pitch_x', 'raw_pitch_y'}
NEW_TABLES = {
    'football.match_team_stat_periods', 'football.match_team_stat_groups',
    'football.match_team_stat_items', 'football.match_h2h_summaries',
}
DESCENDANTS = {'football.match_team_stat_groups', 'football.match_team_stat_items'}
REPLACED_COLUMNS = {
    ('football.player_profile_versions', 'display_name'), ('football.match_events', 'event_type'),
    *(('football.match_players', name) for name in COORDINATES),
}


def column(name, spec):
    require(spec['type'] in ALLOWED_TYPES and not spec.get('identity'), 'Unexpected amended column type')
    result = ident(name) + ' ' + spec['type']
    if spec.get('default_sql') is not None:
        result += ' DEFAULT ' + expression(spec['default_sql'])
    return result + (' NOT NULL' if not spec['nullable'] else '')


def check(spec):
    return f"CONSTRAINT {ident(spec['name'])} CHECK ({expression(spec['sql'])})"


def unique(spec):
    require(not spec.get('where_sql') and not spec.get('deferrable'), 'Unexpected unique constraint')
    nulls = ' NULLS NOT DISTINCT' if spec.get('nulls_not_distinct') else ''
    return f"CONSTRAINT {ident(spec['name'])} UNIQUE{nulls} ({cols(spec['columns'])})"


def foreign(spec):
    ref = spec['references']
    match, update, delete = spec.get('match', 'SIMPLE'), spec.get('on_update', 'NO ACTION'), spec.get('on_delete', 'RESTRICT')
    require(match in {'SIMPLE', 'FULL'} and update in {'NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL'}
            and delete in {'NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL'}, 'Unexpected foreign-key action')
    tail = ' NOT DEFERRABLE'
    if spec.get('deferrable'):
        tail = ' DEFERRABLE INITIALLY ' + ('DEFERRED' if spec.get('initially_deferred') else 'IMMEDIATE')
    return (f"CONSTRAINT {ident(spec['name'])} FOREIGN KEY ({cols(spec['columns'])}) "
            f"REFERENCES {relation(ref['table'])} ({cols(ref['columns'])}) "
            f'MATCH {match} ON UPDATE {update} ON DELETE {delete}' + tail)


def index(table, spec):
    require(spec['method'] == 'btree' and not spec.get('nulls_not_distinct'), 'Unexpected added index')
    keys = []
    for key in spec['keys']:
        require(set(key) <= {'column', 'order', 'nulls'}, 'Unexpected index key')
        require(key.get('order') in {None, 'ASC', 'DESC'} and key.get('nulls') in {None, 'FIRST', 'LAST'}, 'Unexpected index ordering')
        keys.append(ident(key['column']) + (' ' + key['order'] if key.get('order') else '')
                    + (' NULLS ' + key['nulls'] if key.get('nulls') else ''))
    where = ' WHERE ' + expression(spec['where_sql']) if spec.get('where_sql') else ''
    return f"CREATE {'UNIQUE ' if spec.get('unique') else ''}INDEX {ident(spec['name'])} ON {relation(table)} USING btree ({', '.join(keys)}){where};"


def column_comment(table, name, spec):
    return f'COMMENT ON COLUMN {relation(table)}.{ident(name)} IS {literal(spec["description"])};'


def by_name(table, group):
    result = {x['name']: x for x in table.get(group, [])}
    require(len(result) == len(table.get(group, [])), 'Duplicate constraint name')
    return result


def replace_one(sql, before, after):
    require(sql.count(before) == 1, 'Cannot compose a unique sealed validator clause')
    return sql.replace(before, after, 1)


def old_shape_view(base_table, *, restore):
    # A view that directly depends on a column prevents ALTER COLUMN TYPE.
    # Both replacements are transactional and keep the exact old view types/OID.
    columns = []
    for name in base_table['columns']:
        value = ident(name)
        if name in COORDINATES:
            value = f'{value if restore else "NULL"}::double precision AS {value}'
        columns.append(value)
    return (f'CREATE OR REPLACE VIEW football.match_players_current AS SELECT {", ".join(columns)} '
            'FROM football.match_players WHERE recorded_to_gen IS NULL AND is_canonical AND NOT is_deleted;')


def compose_validator(old, new):
    sql = MIGRATION015.read_text()
    changed = []
    for name, before in old.items():
        if before['write_mode'] != 'immutable_values_close_interval_once':
            continue
        original = _no_op_check(before, old)
        amended = _no_op_check(new[name], new)
        if name == COVERAGE:
            extra = []
            for child_name in sorted(DESCENDANTS):
                child = copy.deepcopy(new[child_name])
                child['versioning']['parent_version_binding'] = {
                    'columns': COVERAGE_KEY, 'references': {'columns': COVERAGE_KEY},
                }
                extra.append(_child_sets_equal(new[COVERAGE], child))
            amended = replace_one(amended, ") THEN RAISE EXCEPTION", " AND " + ' AND '.join(extra) + ") THEN RAISE EXCEPTION")
        if original != amended:
            sql = replace_one(sql, original, amended)
            changed.append(name)
    require(set(changed) == {COVERAGE, 'football.player_profile_versions', 'football.team_profile_versions',
                            'football.match_lineups', 'football.match_players'}, 'Unexpected legacy validator delta')
    return replace_one(sql, '\nEND;\n$orion_pro$;', '\n    PERFORM ingest.validate_native107_generation(g);\nEND;\n$orion_pro$;')


def compile_migration():
    base, amended = json.loads(BASE.read_text()), approved_model()
    old, new = active_tables(base), active_tables(amended)
    require(set(new) - set(old) == NEW_TABLES and set(old) <= set(new), 'Unexpected new relation set')
    out = ['-- Approved native match details: append-only migration over exact015.',
           f'-- Parent015 SHA256 {sha(MIGRATION015)}; model107 remains a separate artifact.',
           'SET LOCAL extra_float_digits = 3;', old_shape_view(old['football.match_players'], restore=False)]
    added_columns, changed_columns, changed_checks = 0, set(), []
    added = dict(checks=0, foreign_keys=0, unique_constraints=0, indexes=0)
    for name, after in new.items():
        before = old.get(name)
        if before is None:
            pk = after['primary_key']
            definitions = [column(n, s) for n, s in after['columns'].items()]
            definitions.append(f"CONSTRAINT {ident(pk['name'])} PRIMARY KEY ({cols(pk['columns'])})")
            out.append(f'CREATE TABLE {relation(name)} (\n  ' + ',\n  '.join(definitions) + '\n);')
            out.append(f"COMMENT ON TABLE {relation(name)} IS {literal(after['description'] + ' Grain: ' + after['grain'])};")
            out.extend(column_comment(name, n, s) for n, s in after['columns'].items())
            continue
        require(before['primary_key'] == after['primary_key'] and set(before['columns']) <= set(after['columns']), 'Unapproved existing key/column removal')
        for key, old_check in by_name(before, 'checks').items():
            new_check = by_name(after, 'checks').get(key)
            require(new_check is not None, 'Unapproved CHECK removal')
            if old_check != new_check:
                changed_checks.append((name, key))
                out.append(f'ALTER TABLE {relation(name)} DROP CONSTRAINT {ident(key)};')
        for n, spec in after['columns'].items():
            original = before['columns'].get(n)
            if original is None:
                out.append(f'ALTER TABLE {relation(name)} ADD COLUMN {column(n, spec)};')
                added_columns += 1
            elif original != spec:
                require((name, n) in REPLACED_COLUMNS, 'Unapproved existing column change')
                changed_columns.add((name, n))
                if original['type'] != spec['type']:
                    require(original['type'] == 'double precision' and spec['type'] == 'numeric' and n in COORDINATES, 'Unexpected widening')
                    # Preserve the round-trippable historical decimal text, not the 15-digit implicit float→numeric cast.
                    out.append(f'ALTER TABLE {relation(name)} ALTER COLUMN {ident(n)} TYPE numeric USING {ident(n)}::text::numeric;')
                if original['nullable'] != spec['nullable']:
                    require(spec['nullable'], 'Unexpected nullable narrowing')
                    out.append(f'ALTER TABLE {relation(name)} ALTER COLUMN {ident(n)} DROP NOT NULL;')
            else:
                continue
            out.append(column_comment(name, n, spec))
    require(added_columns == 65 and changed_columns == REPLACED_COLUMNS and len(changed_checks) == 2, 'Incorrect approved existing column/CHECK delta')
    out.append(old_shape_view(old['football.match_players'], restore=True))
    for name, table in new.items():
        for group, renderer in [('unique_constraints', unique), ('checks', check), ('foreign_keys', foreign), ('indexes', None)]:
            prior = by_name(old.get(name, {}), group)
            now = by_name(table, group)
            require(set(prior) <= set(now), 'Unapproved constraint/index removal')
            for key, spec in now.items():
                if key in prior:
                    if spec == prior[key]:
                        continue
                    require(group == 'checks' and (name, key) in changed_checks, 'Unapproved constraint replacement')
                else:
                    added[group] += 1
                out.append(index(name, spec) if renderer is None else f'ALTER TABLE {relation(name)} ADD {renderer(spec)};')
    require(added == dict(checks=128, foreign_keys=16, unique_constraints=1, indexes=1), 'Incorrect approved constraint/index totals')
    rules = amended['selective_versioning']['append_only_revision_rules']
    for name in sorted(NEW_TABLES):
        out.extend(_retained_insert_guard(new[name], new, rules))
        out.append(f'REVOKE ALL ON {relation(name)} FROM PUBLIC;')
        out.append(f'GRANT SELECT ON {relation(name)} TO statarena_ingest, statarena_runtime;')
        out.append(f'GRANT INSERT ON {relation(name)} TO statarena_ingest;')
    for name in sorted({n for n, table in old.items() if table['columns'] != new[n]['columns']}):
        if new[name]['write_mode'] == 'immutable_values_close_interval_once':
            # The existing triggers stay attached; widen the exact immutable comparison in their function.
            out.append(_version_guard(new[name])[0])
    require(NATIVE_RULES.is_file(), 'Native generation validator not yet implemented')
    out.append(NATIVE_RULES.read_text().strip())
    out.append(compose_validator(old, new).strip())
    return ('\n\n'.join(out) + '\n').encode('utf-8')
