"""Checks the season archive to dashboard conversion with synthetic responses."""
import copy
import gzip
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from test_dashboard_data import synthetic

spec = importlib.util.spec_from_file_location('season_builder', ROOT / 'scripts/build_season_dashboard.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class SeasonDashboardTests(unittest.TestCase):
    def test_archive_conversion_preserves_scope_missing_values_and_coverage(self):
        raw, catalog = synthetic()
        samples = raw['samples']
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'archive'
            match_dir = archive / 'matches' / 'l_000001'
            match_dir.mkdir(parents=True)
            inventory = {'retrieved_at_utc': '2026-11-01T00:00:00Z', 'competitions': [{
                'id':'l_000001', 'name':'Example', 'country_code':'FRA', 'season':'2026/2027',
                'matches':[s['match'] for s in samples] + [dict(samples[0]['match'], id='m_000003', status='not_started')],
            }]}
            inventory['competitions'].append({'id':'l_000002', 'name':'1. Lig', 'country_code':'INT', 'season':'2026/2027', 'matches':[]})
            (archive / 'inventory.json').write_text(json.dumps(inventory), encoding='utf-8')
            (archive / 'catalogue.json').write_text(json.dumps(catalog['data']), encoding='utf-8')
            for sample in samples:
                def endpoint(name):
                    source = sample[name]
                    return {'status':200 if source['ok'] else 404, 'data':source['data']}
                record = {'fixture':sample['match'], 'endpoints':{'players':endpoint('players'), 'shots':endpoint('shots'), 'lineups':endpoint('lineups'), 'stats':endpoint('team_stats')}}
                (match_dir / (sample['match']['id'] + '.json')).write_text(json.dumps(record), encoding='utf-8')
            output = Path(directory) / 'football.json'
            with patch.object(builder, 'ARCHIVE', archive):
                self.assertEqual(builder.build(output), [])
            result = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual((result['meta']['matchCount'], result['meta']['expectedFinishedMatches']), (2, 2))
            self.assertEqual(len(result['appearances']), 2)
            self.assertEqual(len(result['fixtures']), 3)
            self.assertEqual(result['fixtures'][2]['status'], 'not_started')
            self.assertEqual(result['fixtures'][2]['league']['id'], 'l_000001')
            self.assertEqual(result['meta']['seasons'], ['2026/2027'])
            self.assertFalse(result['meta']['rankingAvailable'])
            turkish = next(c for c in result['competitions'] if c['id'] == 'l_000002')
            self.assertEqual((turkish['country'], turkish['providerCountry']), ('TUR', 'INT'))
            bad = next(m for m in result['matches'] if m['id'] == 'm_000002')
            self.assertFalse(bad['coverage']['shots'])
            self.assertIsNone(bad['home']['shots'])

            inventory['competitions'][0]['matches'].append(dict(samples[0]['match'], id='m_000004', season='2026'))
            (archive / 'inventory.json').write_text(json.dumps(inventory), encoding='utf-8')
            compressed = Path(directory) / 'season.json.gz'
            metadata = {}
            with patch.object(builder, 'ARCHIVE', archive):
                self.assertEqual(builder.build(compressed, display_season='2026/2027', include_inventory_only=True, metadata_out=metadata), [])
            with gzip.open(compressed, 'rt', encoding='utf-8') as stream:
                result = json.load(stream)
            missing = next(m for m in result['matches'] if m['id'] == 'm_000004')
            self.assertFalse(missing['detailCollected'])
            self.assertFalse(missing['coverage']['players'])
            self.assertEqual((metadata['collectedMatches'], metadata['expectedFinishedMatches']), (2, 3))


if __name__ == '__main__':
    unittest.main()
