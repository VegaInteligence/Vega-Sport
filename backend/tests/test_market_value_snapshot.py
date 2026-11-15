"""Validation and scheduling for the dated market value import."""
from datetime import date, datetime, timezone
import gzip
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vega.sources import SourceError
from vega.sources import market_value_snapshot as snapshot


class MarketValueSnapshotTest(unittest.TestCase):
    def read_csv(self, content):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sample.csv.gz'
            with gzip.open(path, 'wt', encoding='utf-8', newline='') as stream:
                stream.write(content)
            return list(snapshot.load(path))

    def test_actual_gzip_loader(self):
        self.assertEqual(self.read_csv('source_player_id,valued_at,value_eur\n12,2024-01-01,1000000\n12,2026-07-06,0\n'),
                         [('12', date(2024, 1, 1), 1000000), ('12', date(2026, 7, 6), 0)])

    def test_rejects_invalid_rows_and_header(self):
        header = 'source_player_id,valued_at,value_eur\n'
        for content in ('id,date,value\n1,2024-01-01,1\n', header + '1,2026-07-07,1\n',
                        header + '1,2024-01-01,-1\n', header + '1,2024-01-01,9223372036854775808\n',
                        header + 'x,2024-01-01,1\n', header + '1,2024-01-01,1,extra\n'):
            with self.subTest(content=content), self.assertRaises(SourceError):
                self.read_csv(content)

    def test_daily_scope_keeps_snapshot_vintage(self):
        self.assertEqual(list(snapshot.scopes(datetime(2026, 11, 15, tzinfo=timezone.utc))),
                         ['transfermarkt-values:2026-07-06'])


if __name__ == '__main__':
    unittest.main()
