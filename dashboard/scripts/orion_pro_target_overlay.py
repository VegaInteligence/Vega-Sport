"""Approved 016/017 target shape and lossless inverse oracle for the old core.

This module never opens a connection. The operator owns endpoint authentication,
the native state receipt and any decision to run its transaction.
"""
from __future__ import annotations

from functools import lru_cache
import hashlib
import json
from pathlib import Path

from orion_pro_policy import CATALOGUE_SQL
from orion_pro_schema import active_tables, ident, relation

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
TARGET = ROOT / 'docs/architecture/orion-native-details-107-20261105/target-schema.approved-107-core.json'
MIGRATIONS = ROOT / 'dashboard/backend/migrations'
SOURCE_SHA = '18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
TARGET_SHA = 'e06ba703bdebc3f8e7653521837f9e413b7147f4cb810fe1dc40f4668ea5f0e3'
CHAIN = (
    ('012', '012_orion_pro_domain.sql', 'f255868599c72d69f40f575a919045325ea1093a00fe4f5a6b96eae9f2c49f65'),
    ('013', '013_orion_pro_integrity.sql', '85525221cad51b32aff79a777098211b4112f9f00ea7161ac93945654eeb6968'),
    ('014', '014_orion_pro_membership_nonnull.sql', 'e0810f8670b2cb627ade2c76e3c8eb527ab31fd595d5cf939fd63bfc5cf649d6'),
    ('015', '015_orion_pro_metric_membership_guard.sql', '3b85fcb4fe9380cc5f96238620ff3f4bedee7485ed52c98fef0bddfac1092bd7'),
    ('016', '016_orion_pro_native_match_details.sql', '12d63eaab6f4d610de3f2ff4efc0dcd71059c4d2e489a5f30d62d2a8498fd087'),
    ('017', '017_orion_pro_native_match_core_fields.sql', '87aac35a93b8b0455a7dcf13fde5bb0be468d1183a0bf4a96f36b04b4b770458'),
)
COORDINATES = ('raw_pitch_x', 'raw_pitch_y')
APPEARANCES = 'football.match_players'
SCHEMAS = "('ingest','football','analytics')"
DEFAULT_VALUES = {None: None, "'unrecorded'": 'unrecorded', "'lineups'": 'lineups'}
NEW_TABLES = frozenset({
    'football.match_team_stat_periods', 'football.match_team_stat_groups',
    'football.match_team_stat_items', 'football.match_h2h_summaries',
})
VIEW_SQL = """SELECT c.oid,c.relacl::text,a.attname,format_type(a.atttypid,a.atttypmod)
FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
WHERE c.oid='football.match_players_current'::regclass AND a.attname IN ('raw_pitch_x','raw_pitch_y') ORDER BY 3"""
CATALOGUE = CATALOGUE_SQL.replace(
    "'policy_owner','policy_ingest','policy_runtime'", "'statarena_admin','statarena_ingest','statarena_runtime'")


class OverlayError(RuntimeError):
    code = 'TARGET_OVERLAY'


def require(condition, message):
    if not condition:
        raise OverlayError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def pinned(path, sha):
    raw = path.read_bytes()
    require(digest(raw) == sha, 'Approved model or migration bytes differ')
    return raw


@lru_cache(maxsize=1)
def models():
    old, new = (active_tables(json.loads(pinned(path, sha))) for path, sha in
                ((SOURCE, SOURCE_SHA), (TARGET, TARGET_SHA)))
    require(set(old) < set(new) and set(new) - set(old) == NEW_TABLES, 'Approved relation delta differs')
    extra, widened = {}, {}
    for table, before in old.items():
        after = new[table]
        require(set(before['columns']) <= set(after['columns']) and before['primary_key'] == after['primary_key'],
                'Old projection no longer fits the approved target')
        delta = {}
        for name, spec in after['columns'].items():
            if name not in before['columns']:
                default = spec.get('default_sql')
                require(default in DEFAULT_VALUES and (default is not None or spec['nullable']),
                        'An extra target column has no safe core default')
                delta[name] = DEFAULT_VALUES[default]
            else:
                left = before['columns'][name]
                old_shape = left['type'], left['nullable'], left.get('default_sql')
                new_shape = spec['type'], spec['nullable'], spec.get('default_sql')
                if old_shape != new_shape:
                    widened[table, name] = old_shape, new_shape
        if delta:
            extra[table] = delta
    allowed = {
        **{(APPEARANCES, name): (('double precision', True, None), ('numeric', True, None))
           for name in COORDINATES},
        ('football.player_profile_versions', 'display_name'): (('text', False, None), ('text', True, None)),
        ('football.match_events', 'event_type'): (('text', False, None), ('text', True, None)),
    }
    require(widened == allowed and len(old) == 94 and len(new) == 98 and
            sum(map(len, extra.values())) == 71, 'Unexpected changes to shared native columns')
    return old, new, extra


def dimensions(model):
    return [len(model), sum(len(t['columns']) for t in model.values()),
            sum(len(t['foreign_keys']) for t in model.values())]


def catalogue(conn, version):
    """Observe the complete journal and schema. Return only technical metadata."""
    require(version in {'015', '017'} and conn.info.server_version == 180006,
            'Unexpected PostgreSQL or overlay version')
    old, new, extra = models()
    model = old if version == '015' else new
    journal = [list(row) for row in conn.execute(
        'SELECT version,content_sha256,applied_at::text,code_commit FROM ingest.schema_migrations ORDER BY version LIMIT 8')]
    expected = [(number, sha) for number, _, sha in CHAIN if number <= version]
    require([tuple(row[:2]) for row in journal] == expected, 'Target migration journal differs')
    columns = conn.execute(f"""SELECT n.nspname||'.'||c.relname,a.attname,
      format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname IN {SCHEMAS} AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY 1,2 LIMIT 1830""").fetchall()
    types = {'timestamptz': 'timestamp with time zone'}
    wanted = {(table, name): (types.get(spec['type'], spec['type']), not spec['nullable'])
              for table, value in model.items() for name, spec in value['columns'].items()}
    got = {(table, name): (typ, nonnull) for table, name, typ, nonnull, _ in columns}
    require(got == wanted and len(got) == len(columns), 'Target table or column shape differs')
    if version == '017':
        defaults = {(t, c): d for t, c, _, _, d in columns}
        for table, added in extra.items():
            for column, value in added.items():
                expected_default = None if value is None else f"'{value}'::text"
                require(defaults[table, column] == expected_default, 'Approved core default differs')
    foreign_keys = conn.execute(f"""SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN {SCHEMAS} AND k.contype='f' AND k.convalidated""").fetchone()[0]
    dims = dimensions(model)
    require(foreign_keys == dims[2], 'Target foreign key count differs')
    view = [list(row) for row in conn.execute(VIEW_SQL)]
    require(len(view) == 2 and all(row[-1] == 'double precision' for row in view), 'V1 coordinate view differs')
    rows = conn.execute('SELECT * FROM (' + CATALOGUE + ') observed LIMIT 20001').fetchall()
    require(len(rows) <= 20000 and sum(len(value.encode()) for row in rows for value in row) <= 8 * 1024**2,
            'Target catalogue exceeds its evidence bound')
    raw = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()
    return {'version': version, 'dimensions': dims, 'journal': journal, 'coordinateView': view,
            'catalogueSha256': digest(raw), 'catalogueEntries': len(rows)}


def adopt(conn, before, *, release_commit, after_first=None):
    """Atomic 015→017 migration or an exact 017 replay. No implicit connection."""
    require(before.get('version') in {'015','017'} and isinstance(release_commit, str) and release_commit,
            'Exact observed before state and release commit required')
    require(after_first is None or conn.info.host == '127.0.0.1' and conn.info.dbname == 'native_target',
            'Fault injection requires the isolated owned target')
    scripts = [(version, sha, pinned(MIGRATIONS/name, sha).decode()) for version, name, sha in CHAIN[-2:]]
    with conn.transaction():
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ WRITE')
        actor, session, statement, lock = conn.execute("""SELECT current_user,session_user,
          current_setting('statement_timeout'),current_setting('lock_timeout')""").fetchone()
        require((actor, session, statement, lock) == ('statarena_admin', 'statarena_admin', '8s', '1s'),
                'Exact owner and deadline required for schema adoption')
        for key in ('20261104,2', '20261104,1', '97813003::bigint'):
            require(conn.execute('SELECT pg_try_advisory_xact_lock('+key+')').fetchone()[0],
                    'Native schema, generation or serving lease is occupied')
        require(catalogue(conn,before['version']) == before, 'Target changed after the accepted preflight')
        if before['version'] == '017':
            return {'status':'noop','ddl':0,'journalInserts':0,'after':before}
        clock = conn.execute('SELECT transaction_timestamp()::text').fetchone()[0]
        for version, sha, sql in scripts:
            conn.execute(sql,prepare=False)
            conn.execute('INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',
                         (version,sha,release_commit))
            if version == '016' and after_first:
                after_first(version)
        after = catalogue(conn, '017')
        require(after['journal'][:4] == before['journal'] and
                all(row[2:] == [clock,release_commit] for row in after['journal'][4:]) and
                after['coordinateView'] == before['coordinateView'],
                'Target journal or retained V1 view changed during adoption')
    return {'status':'applied','ddl':2,'journalInserts':2,'after':after}


def source_coordinate_guard(alias):
    ident(alias)
    parts = [f"coalesce({alias}.{ident(name)}::text IN ('-0','NaN','Infinity','-Infinity'),false)"
             for name in COORDINATES]
    return '(' + ' OR '.join(parts) + ')'


def target_coordinate_guard(alias):
    ident(alias)
    parts = []
    for name in COORDINATES:
        column = f'{alias}.{ident(name)}'
        parts.append(f"""CASE WHEN {column} IS NULL THEN false
            WHEN {column}::text IN ('NaN','Infinity','-Infinity') THEN true
            ELSE {column}::text IS DISTINCT FROM (({column}::double precision)::text::numeric)::text END""")
    return '(' + ' OR '.join(parts) + ')'


def verify_core_defaults(conn):
    _, _, added = models()
    checks = []
    for table, columns in sorted(added.items()):
        terms = [ident(column)+' IS NOT NULL' if value is None else ident(column)+f" IS DISTINCT FROM '{value}'"
                 for column,value in sorted(columns.items())]
        if table == APPEARANCES:
            terms.append(target_coordinate_guard('t'))
        checks.append('EXISTS (SELECT 1 FROM '+relation(table)+' t WHERE '+' OR '.join(terms)+')')
    checks.extend('EXISTS (SELECT 1 FROM '+relation(table)+')' for table in sorted(NEW_TABLES))
    flags = conn.execute('SELECT '+','.join(checks)).fetchone()
    require(flags is not None and not any(flags),
            'Target has nondefault new core fields, invented precision, or unrelated detail rows')
    return {'checkedSharedTables':len(added),'checkedAddedColumns':sum(map(len,added.values())),
            'emptyNewTables':len(NEW_TABLES),'coordinatesRoundTripExact':True}


class TransportOverlay:
    """Cooperative mixin over the existing native Stream, without a new COPY format."""
    def _check_source_coordinates(self):
        guard = source_coordinate_guard('t')
        require(not self.source.execute('SELECT EXISTS(SELECT 1 FROM football.match_players t WHERE '+guard+ ')').fetchone()[0],
                'The source has a coordinate which cannot round-trip through the approved target')

    def inspect_source(self):
        self._check_source_coordinates()
        return super().inspect_source()

    def source_reopen(self):
        super().source_reopen()
        try:
            self._check_source_coordinates()
        except BaseException:
            self.source.rollback()
            raise

    def projection(self, name, inverse=False):
        values = super().projection(name,inverse)
        if inverse and name == APPEARANCES:
            columns = list(self.tables[name]['columns'])
            for field in COORDINATES:
                i = columns.index(field)
                values[i] = '(' + values[i] + ')::double precision'
        return values

    def verify_business(self, expected, applying=False):
        evidence = verify_core_defaults(self.target)
        super().verify_business(expected,applying)
        self.report['approvedTargetOverlay'] = {'modelSha256':TARGET_SHA,**evidence}
