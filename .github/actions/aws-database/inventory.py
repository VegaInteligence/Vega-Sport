"""Read-only PostgreSQL catalogue export. No business rows, secrets, DDL or writes."""
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import psycopg
from psycopg.rows import dict_row

FILTER = "n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'"
RELATIONS = f"""
SELECT c.oid::bigint AS oid, n.nspname AS schema, c.relname AS name,
 c.relkind AS kind, c.relispartition AS is_partition,
 CASE WHEN c.reltuples >= 0 AND c.relkind IN ('r','p','m') THEN c.reltuples::bigint END AS estimated_rows,
 CASE WHEN c.relkind IN ('r','m') THEN pg_total_relation_size(c.oid) END AS total_bytes,
 c.relrowsecurity AS row_security,
 obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','p','v','m','f') AND {FILTER}
ORDER BY n.nspname,c.relname
"""
COLUMNS = f"""
SELECT a.attrelid::bigint AS oid, a.attnum AS position, a.attname AS name,
 format_type(a.atttypid,a.atttypmod) AS type, NOT a.attnotnull AS nullable,
 pg_get_expr(d.adbin,d.adrelid) AS default_expression,
 a.attidentity AS identity, a.attgenerated AS generated,
 col_description(a.attrelid,a.attnum) AS comment
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f') AND {FILTER}
ORDER BY a.attrelid,a.attnum
"""
CONSTRAINTS = f"""
SELECT x.conrelid::bigint AS oid,x.conname AS name,x.contype AS kind,
 pg_get_constraintdef(x.oid,true) AS definition,x.convalidated AS validated,
 x.condeferrable AS deferrable,x.condeferred AS initially_deferred,
 ARRAY(SELECT a.attname FROM unnest(x.conkey) WITH ORDINALITY k(num,ord)
 JOIN pg_attribute a ON a.attrelid=x.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,
 CASE WHEN x.contype='f' THEN rn.nspname||'.'||rc.relname END AS target,
 ARRAY(SELECT a.attname FROM unnest(x.confkey) WITH ORDINALITY k(num,ord)
 JOIN pg_attribute a ON a.attrelid=x.confrelid AND a.attnum=k.num ORDER BY k.ord) AS target_columns
FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_class rc ON rc.oid=x.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
WHERE {FILTER} ORDER BY x.conrelid,x.conname
"""
INDEXES = f"""
SELECT i.indrelid::bigint AS oid,ic.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,
 i.indisunique AS is_unique,i.indisprimary AS is_primary,i.indisvalid AS is_valid,
 pg_relation_size(i.indexrelid) AS bytes
FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid
WHERE {FILTER} ORDER BY i.indrelid,ic.relname
"""
DEPENDENCIES = f"""
SELECT DISTINCT n.nspname||'.'||c.relname AS source,rn.nspname||'.'||rc.relname AS target
FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_depend d ON d.objid=r.oid AND d.classid='pg_rewrite'::regclass
JOIN pg_class rc ON rc.oid=d.refobjid AND d.refclassid='pg_class'::regclass
JOIN pg_namespace rn ON rn.oid=rc.relnamespace
WHERE c.relkind IN ('v','m') AND c.oid<>rc.oid AND {FILTER}
 AND rn.nspname <> 'information_schema' AND rn.nspname !~ '^pg_'
ORDER BY 1,2
"""

def main():
    with psycopg.connect(os.environ['DATABASE_URL'],connect_timeout=10,row_factory=dict_row,
        options='-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000') as db:
        db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        identity=db.execute('SELECT current_database() AS database,version() AS engine').fetchone()
        if identity['database']!='statarena_prod':
            raise ValueError('Unexpected database; refusing inventory')
        relations=db.execute(RELATIONS).fetchall()
        by_oid={row['oid']:row for row in relations}
        for row in relations:
            row['qualified_name']=row['schema']+'.'+row['name']
            for key in ('columns','constraints','indexes'): row[key]=[]
        for key,query in [('columns',COLUMNS),('constraints',CONSTRAINTS),('indexes',INDEXES)]:
            for item in db.execute(query).fetchall():
                oid=item.pop('oid')
                if oid in by_oid: by_oid[oid][key].append(item)
        dependencies=db.execute(DEPENDENCIES).fetchall()
    counts=Counter(row['schema'] for row in relations if row['kind'] in ('r','p') and not row['is_partition'])
    report=dict(format='statarena-live-schema-v1',**identity,
        checked_at=datetime.now(timezone.utc).isoformat(),tables=sum(counts.values()),
        schemas=dict(counts),relations=relations,view_dependencies=dependencies,
        warnings=['Estimated rows are planner estimates, not COUNT(*) and not proof of emptiness.',
                  'Schema membership does not prove runtime usage or justify deletion.',
                  'Snapshot only: refreshing this file requires rerunning the read-only workflow.'],
        source_commit=os.environ.get('GITHUB_SHA'))
    Path('schema-inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ('database','checked_at','tables','schemas')},ensure_ascii=False))

if __name__=='__main__': main()
