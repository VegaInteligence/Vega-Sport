# Selective inline version transform protocol

Written before `apply_pro_versions.py`, after reading the complete `../PRO_VERSIONING_DESIGN.md`. This is a structural proposal transform, not a migration or executed SQL acceptance. Apply the existing Pro constraint helper **first**, then this helper, then recompute builder table maps/totals and render. Only the new helper and this protocol are authored in this task.

## Failure matrix, before code

| Failure/input | Expected structural outcome; SQL/workflow outcome still pending |
| --- | --- |
| Correct xG 0.82 to 0.67. | Both typed values fit the same logical key under separate physical revisions/half-open generation intervals. No global old-grain UQ blocks correction. Snapshot readers select at one generation. |
| Reimport identical data; failed HTTP attempt. | Normalizer must avoid new versions/publications; attempt remains separate. Structural helper does not execute normalizer behavior. |
| Reuse logical id for a new revision. | Logical id is a bigint with dedicated sequence default, not GENERATED ALWAYS identity; revision_id is the physical identity PK. |
| Concurrent generation allocation, overlap, sealed-generation writes, old-value mutation. | Model declares one transaction advisory lock before sequence allocation and deferred interval/selection/immutability gates. Not claimed enforced until runtime triggers/roles/E2E exist. |
| FK references only mutable logical id or a partial current index. | Replace with full compatible physical anchor and declare real nonpartial PK/UQ; reject any invalid output atomically. |
| Optional logical reference without anchor, anchor without identity/discriminant. | Local CHECK blocks MATCH SIMPLE bypass while allowing the entire optional reference to be absent. |
| Match-team/player FK has wrong team/player/side. | Full typed anchor includes original discriminator columns. Further same-generation selected membership is a separate seal gate. |
| Reuse a hash/source id to reselect an old profile. | Old timeless natural UQ is replaced with generation-aware identity; physical `(id, actor_id)` anchor UQ remains. |
| Two variants or tombstone + another canonical current row. | Separate variant-current and canonical-current unique partial indexes; canonical index includes tombstones. Historical overlap still needs a gate. |
| Collection correction or empty/null/absent result. | Whole-parent key in event/momentum/H2H PK+FK; typed collection_state distinguishes shapes, with row-count consistency. Failed attempts never clear accepted collections. |
| Heatmap/network correction. | New immutable parent id; six child tables inherit parent identity, with no per-cell/node/event revision registry. Same coordinates across different parent versions allowed. |
| Metric/position/period correction. | Exact definition version added to every code FK, including self ratios; optional code/version pairs guarded. |
| Parser/mapping correction from the same source_record_id in an append-only standing or match detail observation. | A new standing snapshot uses a new physical id and incremented data_revision under a revision-aware natural UQ; a new match detail uses the same source record and new recorded_from_gen in its composite PK. Existing typed values and children remain immutable. Identical reimport reuses the prior revision; runtime normalization/selection and SQL rejection remain unverified. |
| Ranking methodology v2 for an existing system code. | Immutable generated system id per `(code, methodology_version)`; no timeless UNIQUE(code) blocks coexistence. Snapshots keep exact `(system_id, subject_kind)` binding. |
| Empty/whitespace variant, profile context, definition or mapping version. | Required selection discriminants have explicit nonempty CHECKs; optional referenced versions may be NULL together with their optional code, but cannot be blank when supplied. Raw source strings such as an empty shirt are not rejected by these identifier checks. |
| Source position 0 or shirt number 0/empty string. | Targeted local state plus native numeric sidecar preserves text vs number, absence vs null, empty vs zero. No universal EAV/body copy. |
| Append-only revision/generation order, two normalizers, or identical reimport. | Seal gate serializes by logical source context, requires strictly increasing standing/ranking normalization revisions with generations, forbids same-grain duplicate generation/backdating, and leaves no-op imports at the existing revision/generation. At-g match details select greatest recorded_from_gen <= g. Runtime rejection/concurrency must be proved in the typed local pilot. |
| H2H child source_record_id belongs to another provider. | Composite FK (source_id,source_record_id) targets source_records(source_id,id), using the source_id already fixed by the coverage-parent PK; a mere source-record id existence FK is removed. Wrong-provider row must fail runtime FK acceptance. |
| Other unclassified source forms or contributions. | Explicit inventory/purge blocker remains. No claim these four targeted columns cover all fields or all multi-record derivations. |
| Contract v2/bootstrap. | Versioned contract PK/FK. Seeds have explicit definition version/manual provenance and named generation/code-hash bindings; bootstrap runtime must resolve them before insert. |
| Existing enrichment field. | Retained unchanged except xG numeric precision, required FK anchors, provenance semantics and explicitly targeted state descriptions. |
| Bad input FK/type, partial-only target, dangling removed column, duplicate/long name. | `ValueError`; original model and change log stay unchanged. |
| Reapply/JSON roundtrip. | Byte-equivalent canonical JSON and zero additional change records. |
| Viewer labels one physical revision as an unversioned logical fact. | All 46 selected and 6 parent-version child relations expose their actual physical PK, stored logical key and parent/variant/generation scope in grain/description metadata; child ordinals are not advertised as stable identities across corrections. Changes log includes grain/description edits and repeat application never duplicates prefixes. |
| Any unjustified table quota. | No added history/copy tables and no 84-table quota. Exact design classes are 46 selective, 6 parent-version children, 9 append-only, 3 stable identities. |

## Concrete choices

The 26 corrected facts/dimensions use physical `revision_id`; the remaining selected tables use the design's own definition/mapping/profile/generation/publication keys. A stable logical id sequence is allocated only on initial entity creation; corrections explicitly pass the old id. Generation allocation has no column default: the writer takes the global transaction advisory lock, then allocates `ingest.commit_generation_seq`, creates a generation receipt and writes/closes rows before committing. Sequence metadata is a proposal, not deployed objects.

`coverage_state` retains its existing operational distinctions. `match_coverage.collection_state` adds `absent/null/empty/present/unavailable`, with NULL count for absent/null/unavailable, zero for empty and a positive count for present. `cells_state` on heatmaps already carries collection shape and remains distinct. Event, momentum and H2H children include the entire coverage PK and a CHECK fixing `feature_code` to their family. Network/grid children have no independent interval or registry.

Each selected relation binds a table-fixed `relation_code` and `contract_version` to the actual contract PK, and retains `transform_version` plus an immutable `transform_code_sha256`. Definitions and mappings are immutable by declared version, not overwritten. Full enforcement of immutability, artifacts and determinism remains a runtime acceptance gate.

The native-form evidence comes from `docs/verification/aws-wire-pages/disposable.mjs:125` (numeric 11 versus string 11), `docs/verification/aws-relational-core-20261104/workflow.py:97` (shirt `'07'` versus numeric 7), `docs/verification/aws-native-shirts-live-20261104/PROTOCOL.md` and existing dictionary/typed columns. Only `raw_position_code` and `shirt_number` on `match_players` and `player_profile_versions` receive new local source states: `absent/null/string/number`, with text in the existing column and an exact optional `*_source_number NUMERIC` used only for native numbers. Strings include `''` and `'07'`; zero/false are never inferred from missing data. Unknown booleans/objects/nonfinite forms must fail inventory/normalization, not be stringified into a body store. The exact positional representation contract and every other ambiguous field remain blockers until the exhaustive destination matrix is accepted.

`player_match_stats.xg` becomes unconstrained-scale NUMERIC as designed; its finite check uses numeric casts. No claim is made that all decimal columns have been inventoried. Identity attributes on players/teams/associations remain explicit current caches, with corresponding fields added to their existing profile tables. Frozen reads must use retained profiles, not identity caches or player_search.

The four universal registry/state/link tables are removed. Their useful information must be represented directly in retained typed facts/provenance; the metadata blocker specifically forbids source purge if a multi-record contribution or observed source variant still lacks a typed destination. No new table or body copy replaces them.

Bootstrap seed rows are templates: `definition_version='bootstrap_v1'`, manual provenance and fixed relation/contract/transform versions are literal, while `recorded_from_gen` and `transform_code_sha256` are resolved from named bootstrap bindings. The metadata orders generation, contract, seeds and dependent rows. It never invents actual generation ids or artifact hashes.

## Static acceptance script, written before helper

Run from the repo root. This is whole-model transform/serialization/structural acceptance, not PostgreSQL execution. Exact rerun command:

```sh
python3 -B - <<'PY'
from pathlib import Path
import re
p = Path('docs/architecture/orion-plan-20261104/tools/PRO_VERSION_PROTOCOL.md')
code = re.search(r'```python\n(.*?)\n```', p.read_text(), re.S).group(1)
exec(compile(code, str(p), 'exec'))
PY
```

The rerun now builds a fresh temporary `before_versions` fixture from the immutable original input through the same builder. This keeps the first-application assertions meaningful after the published target has already become the final 103-table model. The original protocol and historical stdout are preserved in `../evidence/historical-pre-pro-protocols/`; their earlier input hash is not current-model proof. No helper code or original assertions have changed. The fixture is removed on interpreter exit and cannot overwrite this review folder.

```python
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

base = Path('docs/architecture/orion-plan-20261104')
fixture_directory = tempfile.TemporaryDirectory(prefix='orion-before-versions-')
source = Path(fixture_directory.name) / 'before-versions.json'
subprocess.run([sys.executable, '-B', str(base / 'tools/build_proposal.py'),
                '--fixture-phase', 'before_versions', '--output', str(source)],
               check=True, capture_output=True, text=True)
helper = base / 'tools/apply_pro_versions.py'
def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
constraints = load(base / 'tools/apply_pro_constraints.py', 'constraints')
versions = load(helper, 'versions')
model = json.loads(source.read_text())
constraints.apply(model, [])
before = copy.deepcopy(model)
def tables(m):
    return {t['qualified_name']:t for s in m['schemas'] for t in s['tables']}
def stable(m):
    return json.dumps(m, sort_keys=True, ensure_ascii=False)
old = tables(before)
changes = []
assert versions.apply(model, changes) is model
t = tables(model)
removed = {'ingest.row_versions','ingest.dataset_snapshot_rows','ingest.field_states','ingest.record_row_links'}
assert set(t) == set(old) - removed
assert len(versions.VERSIONED_TABLES) == 46
assert len(versions.CHILD_TABLES) == 6
assert len(versions.APPEND_ONLY_TABLES) == 9
assert len(versions.STABLE_IDENTITIES) == 3
assert not any(n.endswith('_history') for n in t)
assert 'row_version_id' not in stable(t)
index_names = set()
for name, table in t.items():
    cols = table['columns']
    pk = table['primary_key']
    assert pk['columns'] and all(c in cols and cols[c]['nullable'] is False for c in pk['columns']), name
    local_names = set()
    for group in ([pk],table['unique_constraints'],table['foreign_keys'],table['checks'],table['indexes']):
        for entry in group:
            assert len(entry['name'].encode()) <= 63, (name,entry['name'])
            assert entry['name'] not in local_names, (name,entry['name'])
            local_names.add(entry['name'])
    for entry in [pk]+table['unique_constraints']+table['indexes']:
        scoped = (name.split('.')[0],entry['name'])
        assert scoped not in index_names, scoped
        index_names.add(scoped)
    for u in table['unique_constraints']:
        assert all(c in cols for c in u['columns']), (name,u)
    for idx in table['indexes']:
        assert all(k['column'] in cols for k in idx['keys'] if 'column' in k), (name,idx)
    for column, value in cols.items():
        if 'identity' in value:
            assert value['type'] in ('bigint','integer','smallint') and value['nullable'] is False
        if column == 'id' and name in versions.FACT_KEYS:
            assert 'identity' not in value and 'nextval(' in value['default_sql']
    for fk in table['foreign_keys']:
        parent = t[fk['references']['table']]
        a,b = fk['columns'],fk['references']['columns']
        assert len(a)==len(b) and all(c in cols for c in a)
        assert all(cols[x]['type']==parent['columns'][y]['type'] for x,y in zip(a,b)), (name,fk)
        keys = [parent['primary_key']]+parent['unique_constraints']
        assert any(k['columns']==b and not k.get('deferrable',False) and not k.get('where_sql') for k in keys), (name,fk)
    for column in set(old[name]['columns'])-{'row_version_id'}:
        assert column in cols, (name,column)
for name, key in versions.FACT_KEYS.items():
    table = t[name]
    assert table['primary_key']['columns']==['revision_id']
    assert all(table['columns'][c]['nullable'] is False for c in key)
    assert any(u['columns']==key+['revision_id'] for u in table['unique_constraints'])
    assert any(i.get('unique') and [k['column'] for k in i['keys']]==key and
               i.get('where_sql')=='recorded_to_gen IS NULL AND is_canonical' for i in table['indexes'])
for name in versions.VERSIONED_TABLES:
    table=t[name]
    assert table['columns']['contract_version']['nullable'] is False
    assert table['columns']['transform_code_sha256']['nullable'] is False
    assert any(f['references']['table']=='ingest.relation_contracts' and
               f['references']['columns']==['relation_code','contract_version'] for f in table['foreign_keys'])
    start='published_from_gen' if name=='analytics.publication_versions' else 'recorded_from_gen'
    end='published_to_gen' if name=='analytics.publication_versions' else 'recorded_to_gen'
    assert table['columns'][start]['nullable'] is False and table['columns'][end]['nullable'] is True
    assert any(f['columns']==[start] and f['references']['columns']==['generation'] for f in table['foreign_keys'])
for name in versions.CHILD_TABLES:
    assert 'revision_id' not in t[name]['columns'] and 'recorded_to_gen' not in t[name]['columns']
for name in versions.VERSIONED_TABLES + versions.CHILD_TABLES:
    table=t[name]
    meta=table['versioning']
    assert table['grain'].startswith('Ligne physique :'), name
    assert table['grain'].count('Ligne physique :')==1, name
    assert meta['physical_key']==table['primary_key']['columns'], name
    assert meta['physical_grain']==table['grain'], name
    assert meta['logical_key'] and 'Grain physique :' in table['description'], name
    assert any(c['table']==name and c['operation']=='change_grain' for c in changes), name
    assert any(c['table']==name and c['operation']=='change_description' for c in changes), name
    if name in versions.CHILD_TABLES:
        parent=meta['parent_version_binding']
        assert parent['columns'] and parent['references']['table'] in t, name
        assert parent['references']['columns']==t[parent['references']['table']]['primary_key']['columns'], name
    else:
        assert 'selection_indexes' in meta, name
for name in versions.STABLE_IDENTITIES:
    assert t[name]['primary_key']['columns']==['id'] and 'revision_id' not in t[name]['columns']
for name in versions.APPEND_ONLY_TABLES:
    assert t[name]['write_mode']=='append_only'
h2h=t['football.match_h2h_entries']
assert any(f['columns']==['source_id','source_record_id'] and f['references']=={'table':'ingest.source_records','columns':['source_id','id']}
           for f in h2h['foreign_keys']), 'H2H wrong-provider provenance remains structurally possible'
assert not any(f['columns']==['source_record_id'] and f['references']['table']=='ingest.source_records'
               for f in h2h['foreign_keys'])
# Failure documented before the append-only key correction: re-normalizing the
# same retained source record must not require overwriting its old typed values.
standing=t['football.standing_snapshots']
standing_logical=['source_record_id','competition_season_id','stage_id','group_id','group_label','scope']
assert any(u['columns']==standing_logical+['data_revision'] and u.get('nulls_not_distinct')
           for u in standing['unique_constraints']), 'standing same-record correction blocked'
assert not any(u['columns']==standing_logical for u in standing['unique_constraints'])
assert standing['primary_key']['columns']==['id']
assert standing['versioning']['version_key']==['data_revision']
detail=t['football.match_observation_details']
assert detail['primary_key']['columns']==['source_record_id','recorded_from_gen'], 'match detail same-record correction blocked'
assert detail['versioning']['logical_key']==['source_record_id']
assert detail['versioning']['version_key']==['recorded_from_gen']
assert detail['versioning']['historical_selection']=='latest recorded_from_gen <= g per source_record_id'
rules=model['selective_versioning']['append_only_revision_rules']
assert set(rules)=={'football.standing_snapshots','football.ranking_snapshots','football.match_observation_details'}
assert rules['football.standing_snapshots']['revision_column']=='data_revision'
assert rules['football.ranking_snapshots']['revision_column']=='revision'
for rule in rules.values():
    assert rule['seal_gate']=='strict_revision_generation_order_and_immutable_prior_rows'
    assert rule['no_op_reimport']=='reuse_existing_revision_and_generation'

assert any(f['columns']==['snapshot_id'] and f['references']=={'table':'football.standing_snapshots','columns':['id']}
           for f in t['football.standing_rows']['foreign_keys'])
ranking=t['football.ranking_systems']
assert ranking['columns']['methodology_version']['nullable'] is False
assert any(u['columns']==['code','methodology_version'] for u in ranking['unique_constraints'])
assert not any(u['columns']==['code'] for u in ranking['unique_constraints'])
assert any(f['columns']==['system_id','subject_kind'] and f['references']=={'table':'football.ranking_systems','columns':['id','subject_kind']}
           for f in t['football.ranking_snapshots']['foreign_keys'])
for name, table in t.items():
    for column, spec in table['columns'].items():
        if column in ('variant_key','profile_context','definition_version','mapping_version','methodology_version') or column.endswith(('_definition_version','_mapping_version')):
            assert any(f"btrim({column}) <> ''" in c['sql'] for c in table['checks']), (name,column)
assert t['ingest.relation_contracts']['primary_key']['columns']==['relation_code','contract_version']
assert t['ingest.field_contracts']['primary_key']['columns']==['relation_code','contract_version','field_code']
assert t['football.player_match_stats']['columns']['xg']['type']=='numeric'
for name in ('football.match_players','football.player_profile_versions'):
    for field in ('raw_position_code','shirt_number'):
        assert t[name]['columns'][field+'_state']['allowed_values']==['absent','null','string','number']
        assert t[name]['columns'][field+'_source_number']['type']=='numeric'
cells=t['football.match_heatmap_cells']
assert any(u['columns']==['heatmap_id','column_index','row_index'] for u in cells['unique_constraints'])
for name in ('football.match_heatmaps','football.pass_networks'):
    assert t[name]['primary_key']['columns']==['id'] and 'identity' in t[name]['columns']['id']
for name, ending in [('football.match_events',['event_seq']),('football.match_momentum',['series_code','sample_index']),('football.match_h2h_entries',['entry_ordinal'])]:
    parent_key=['match_id','source_id','feature_code','variant_key','recorded_from_gen']
    assert t[name]['primary_key']['columns']==parent_key+ending
    assert any(f['columns']==parent_key and f['references']['table']=='ingest.match_coverage' for f in t[name]['foreign_keys'])
for name, rows in model['seed_data'].items():
    binding=model['bootstrap']['seed_bindings'].get(name,{})
    for row in rows:
        for col, spec in t[name]['columns'].items():
            assert spec['nullable'] or 'identity' in spec or 'default_sql' in spec or col in row or col in binding, (name,col)
assert model['selective_versioning']['source_inventory_complete'] is False
assert model['selective_versioning']['purge_authorized'] is False
assert all({'table','operation','column','reason'} <= set(c) for c in changes)
count=len(changes)
first=stable(model)
versions.apply(model,changes)
assert stable(model)==first and len(changes)==count
again=[]
roundtrip=json.loads(first)
versions.apply(roundtrip,again)
assert stable(roundtrip)==first and not again
bad=copy.deepcopy(before)
fk=next(f for f in tables(bad)['football.shots']['foreign_keys'] if f['references']['table']=='football.match_teams')
fk['references']['table']='football.missing_target'
bad_before=stable(bad)
bad_changes=[]
try:
    versions.apply(bad,bad_changes)
except ValueError:
    pass
else:
    raise AssertionError('invalid FK accepted')
assert stable(bad)==bad_before and not bad_changes
print(json.dumps({'result':'passed_static_selective_version_transform_only',
    'input_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
    'helper_sha256':hashlib.sha256(helper.read_bytes()).hexdigest(),
    'tables':len(t),'selected':len(versions.VERSIONED_TABLES),'children':len(versions.CHILD_TABLES),
    'append_only':len(versions.APPEND_ONLY_TABLES),'stable':len(versions.STABLE_IDENTITIES),
    'changes_first_apply':count,'second_apply_changes':len(again),
    'invalid_fk_atomic_rejection':True,'sql_executed':False,
    'source_inventory_complete':False,'purge_authorized':False},indent=2))
```

## Runtime acceptance remains required

On an owned disposable PostgreSQL 18 instance, build all DDL/sequences, resolve bootstrap bindings, load actual FK parents, then run every failure row with positive controls and inspect SQLSTATE/readbacks. Verify corrections, complete source variants, generations under two writers, historical interval overlap, close-once/immutability roles, selected membership at the same generation, coverage/child sets, source/native types, restart/idempotence, builds and code artifacts, cache/ETag/cursors and browser routes. Save exact SQL/input/hash/commands/logs and repeat on representative pilot volumes. No PostgreSQL, migration, backend, source-purge or performance acceptance is claimed by this structural helper.

Suggested commit: `feat: model selective inline revisions and typed snapshot dependencies`

## Recorded static evidence — historical pre-integration run

The documented script was written first and executed before the helper existed; it failed with the expected `FileNotFoundError` for `apply_pro_versions.py`. It then passed on the in-memory result of applying the corrected Pro constraint helper to the current WIP proposal. After code review, the same script was rerun: empty/present collection counters now explicitly reject NULL, numeric native text is checked against its exact NUMERIC sidecar through a guarded CASE, and bootstrap contract metadata contains the actual required catalog columns. No SQL was run.

Final stdout:

```json
{
  "result": "passed_static_selective_version_transform_only",
  "input_sha256": "b9f48815ed072009c0af9a8e433d5059f3222d826b135ae78fe91bae6f145227",
  "helper_sha256": "592a46e6d3d89fbf9b45364985c96086e0837ee8fe1d8910ae999cf86e35fd66",
  "tables": 103,
  "selected": 46,
  "children": 6,
  "append_only": 9,
  "stable": 3,
  "changes_first_apply": 1275,
  "second_apply_changes": 0,
  "invalid_fk_atomic_rejection": true,
  "sql_executed": false,
  "source_inventory_complete": false,
  "purge_authorized": false
}
```

This evidence identifies the pre-version 107-table input by hash. To repeat the first transformation after the parent integrates the generated 103-table schema, use that pre-helper builder model as the input; do not apply the preceding constraint helper to an already versioned model that deliberately lacks `field_states`. `apply_pro_versions.apply` itself accepts/rechecks its already transformed result and is idempotent. Counts above are observed class/inventory results, not a universal table quota. Full PostgreSQL, immutability/interval/selection gates, source migration/native-type inventory, API/cache/browser behavior, measured performance and source purge remain unexecuted and unapproved by this helper.

Independent review requested explicit ranking-method and nonempty-selection readiness. The source model already contained `methodology_version NOT NULL` and `UNIQUE(code, methodology_version)`; the helper now explicitly ensures that contract, removes an obsolete timeless code-only UQ/index if encountered, and documents exact immutable system-id binding in snapshots. Before implementing this refinement, the matrix/script were extended and failed as expected on the missing `match_coverage.variant_key` nonempty CHECK. The refined implementation adds explicit nonempty checks to required selectors and nullable version references, while preserving raw source empty strings. The same complete script then passed; the final stdout above includes this refinement.

The physical-grain coherence refinement also followed protocol first: the new acceptance checks failed on the unchanged logical-only grain of `football.countries`. The helper then updated all 46 selected and six parent-version child grains/descriptions from their actual PKs, preserving logical keys and precise variant selection in metadata. Child-local ordinals are scoped to the exact parent version; network edges describe the actual two-node-FK path to their shared network parent. The change log now records grain/description edits. Saved business text prevents duplicate prefixes on repeats, and the heatmap description now explicitly names typed cells rather than the superseded JSONB representation. The complete static script passed again with zero repeat/roundtrip changes; stdout above reflects this final helper revision. No runtime behavior changed.
