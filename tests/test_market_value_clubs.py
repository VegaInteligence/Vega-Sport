import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'dashboard/scripts'))
sys.modules.setdefault('psycopg', types.ModuleType('psycopg'))
from import_player_market_values import prepare_snapshot
from import_dcaribou_market_values import prepare_active_replay


class MarketValueClubsTest(unittest.TestCase):
    def test_optional_clubs_and_replay_preserve_exact_identities(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source.csv'
            source.write_text('player_id,date,market_value_in_eur,current_club_name,current_club_id\n'
                              '28003,2020-01-01,100,Barcelona,131\n'
                              '28003,2021-01-01,200,Unknown,131\n', encoding='utf-8')
            old, old_report, _ = prepare_snapshot(source, {'28003': ('p_1mZO3B', 'wikidata:Q615')}, '679')
            with ZipFile(io.BytesIO(old)) as archive:
                points = json.loads(archive.read('source/28003.json'))['history']
                self.assertEqual(points[0]['clubName'], 'Barcelona')
                self.assertEqual(points[0]['clubId'], '131')
                self.assertNotIn('clubName', points[1])
            class DB:
                def execute(self, *args): return self
                def fetchone(self): return (old_report['archive_path'],)
                def close(self): pass
            class Store:
                db = DB()
                def bytes(self, path): return old
            fake_store = types.ModuleType('aws_store')
            fake_store.Store = Store
            with patch.dict(sys.modules, {'aws_store': fake_store}):
                base, rebuilt, report, ids = prepare_active_replay(root)
            self.assertEqual(base, old_report['archive_path'])
            self.assertEqual(ids, ['p_1mZO3B'])
            self.assertEqual(old, rebuilt)
            self.assertEqual(report['archive_path'], old_report['archive_path'])

    def test_legacy_csv_and_conflicting_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source.csv'
            source.write_text('player_id,date,market_value_in_eur\n28003,2020-01-01,100\n', encoding='utf-8')
            payload, _, _ = prepare_snapshot(source, {}, 'old')
            with ZipFile(io.BytesIO(payload)) as archive:
                self.assertEqual(json.loads(archive.read('source/28003.json'))['history'], [{'date': '2020-01-01', 'valueEur': 100}])
            source.write_text('player_id,date,market_value_in_eur,current_club_name\n28003,2020-01-01,100,A\n28003,2020-01-01,100,B\n', encoding='utf-8')
            with self.assertRaises(ValueError): prepare_snapshot(source, {}, 'old')

    def test_replay_enriches_legacy_documents_from_original_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'source.csv'
            source.write_text('player_id,date,market_value_in_eur,current_club_name,current_club_id\n28003,2020-01-01,100,Barcelona,131\n', encoding='utf-8')
            enriched, report, _ = prepare_snapshot(source, {'28003': ('p_1mZO3B', 'verified')}, '679')
            output = io.BytesIO()
            with ZipFile(io.BytesIO(enriched)) as src, ZipFile(output, 'w') as dst:
                for name in src.namelist():
                    body = src.read(name)
                    if name == 'source/28003.json':
                        doc = json.loads(body)
                        doc['history'][0].pop('clubName')
                        doc['history'][0].pop('clubId')
                        body = json.dumps(doc).encode()
                    dst.writestr(name, body)
            legacy = output.getvalue()
            class DB:
                def execute(self, *args): return self
                def fetchone(self): return (report['archive_path'],)
                def close(self): pass
            class Store:
                db = DB()
                def bytes(self, path): return legacy
            fake_store = types.ModuleType('aws_store')
            fake_store.Store = Store
            with patch.dict(sys.modules, {'aws_store': fake_store}):
                _, replayed, _, _ = prepare_active_replay(root)
            with ZipFile(io.BytesIO(replayed)) as archive:
                point = json.loads(archive.read('source/28003.json'))['history'][0]
            self.assertEqual(point, {'date': '2020-01-01', 'valueEur': 100, 'clubName': 'Barcelona', 'clubId': '131'})


if __name__ == '__main__': unittest.main()
