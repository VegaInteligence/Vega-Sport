"""Import a dated Transfermarkt valuation history through confirmed identities.

The vintage describes when the snapshot was captured, not the valuation date.
The stream is staged once; database joins and writes are set-based.
"""
import csv
from datetime import date, timedelta
import gzip
from pathlib import Path

from . import SourceError

VINTAGE = date(2026, 7, 6)
PATH = Path(__file__).parent / 'data' / 'transfermarkt-market-values-20260706.csv.gz'
HEADER = ['source_player_id', 'valued_at', 'value_eur']


def scopes(now):
    return {f'transfermarkt-values:{VINTAGE.isoformat()}': timedelta(days=1)}


def load(path=None):
    """Yield validated valuation rows, without holding the snapshot in memory."""
    try:
        with gzip.open(path or PATH, 'rt', encoding='utf-8', newline='') as stream:
            reader = csv.DictReader(stream)
            if reader.fieldnames != HEADER:
                raise SourceError('INVALID_SNAPSHOT')
            for row in reader:
                sid, raw_date, raw_value = (row.get(key) for key in HEADER)
                if (None in row or not sid or not sid.isascii() or not sid.isdigit()
                        or not raw_value or not raw_value.isascii() or not raw_value.isdigit()):
                    raise SourceError('INVALID_SNAPSHOT')
                day, value = date.fromisoformat(raw_date), int(raw_value)
                if day > VINTAGE or value > 9223372036854775807:
                    raise SourceError('INVALID_SNAPSHOT')
                yield sid, day, value
    except (OSError, UnicodeError, ValueError, TypeError, csv.Error):
        raise SourceError('INVALID_SNAPSHOT')


def run(conn, get, scope, now):
    if scope != f'transfermarkt-values:{VINTAGE.isoformat()}':
        raise SourceError('INVALID_SCOPE')
    linked = {sid for (sid,) in conn.execute(
        "SELECT source_player_id FROM core.player_fact_observations WHERE source='transfermarkt_snapshot'"
    )}
    conn.execute('''CREATE TEMP TABLE market_value_snapshot_stage (
        source_player_id text NOT NULL, valued_at date NOT NULL, value_eur bigint NOT NULL,
        PRIMARY KEY (source_player_id, valued_at)
    ) ON COMMIT DROP''')
    count = unmatched = 0
    with conn.cursor() as cursor:
        with cursor.copy('COPY market_value_snapshot_stage (source_player_id, valued_at, value_eur) FROM STDIN') as copy:
            for row in load():
                count += 1
                if row[0] in linked:
                    copy.write_row(row)
                else:
                    unmatched += 1
    if not count:
        raise SourceError('INVALID_SNAPSHOT')
    changed = conn.execute('''INSERT INTO core.player_market_values
        (player_id, valued_at, value_eur, source, as_of)
        SELECT o.player_id, s.valued_at, s.value_eur, 'transfermarkt', %s
        FROM market_value_snapshot_stage s
        JOIN core.player_fact_observations o ON o.source='transfermarkt_snapshot'
          AND o.source_player_id=s.source_player_id
        ON CONFLICT (player_id, valued_at, source) DO UPDATE SET
          value_eur=EXCLUDED.value_eur, as_of=EXCLUDED.as_of, updated_at=now()
        WHERE core.player_market_values.as_of <= EXCLUDED.as_of
          AND (core.player_market_values.value_eur, core.player_market_values.as_of)
              IS DISTINCT FROM (EXCLUDED.value_eur, EXCLUDED.as_of)''', (VINTAGE,)).rowcount
    return changed, unmatched
