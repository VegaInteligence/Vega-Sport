"""Count user tables using the existing read-only RDS connection; no data scan."""
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

SQL = """
SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
       c.relispartition AS is_partition,
       (SELECT count(*) FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg_%'
ORDER BY n.nspname, c.relname
"""


def main():
    with psycopg.connect(
        os.environ['DATABASE_URL'], connect_timeout=10, row_factory=dict_row,
        options='-c default_transaction_read_only=on -c statement_timeout=5000',
    ) as connection:
        identity = connection.execute('SELECT current_database() AS database').fetchone()
        relations = connection.execute(SQL).fetchall()
    schemas = defaultdict(lambda: dict(tables=0, partition_children=0, views=0,
                                      materialized_views=0, foreign_tables=0, table_columns=0))
    for row in relations:
        item = schemas[row['schema']]
        if row['kind'] in ('r', 'p'):
            item['partition_children' if row['is_partition'] else 'tables'] += 1
            if not row['is_partition']:
                item['table_columns'] += row['columns']
        else:
            item[{'v': 'views', 'm': 'materialized_views', 'f': 'foreign_tables'}[row['kind']]] += 1
    report = dict(**identity, checked_at=datetime.now(timezone.utc).isoformat(),
                  schemas=dict(schemas), tables=sum(s['tables'] for s in schemas.values()),
                  definition='User base tables, excluding child partitions and views; includes legacy and experimental schemas.')
    Path('schema-inventory.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
