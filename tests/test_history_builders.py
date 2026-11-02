"""Historical season imports must preserve older and current datasets."""
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dashboard/scripts'))
import build_multiseason_dashboard as multiseason
import build_json_database as database


class HistoricalBuilderTests(unittest.TestCase):
    def test_multiseason_groups_calendar_and_cross_year_seasons(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            archive = base / 'archive'
            archive.mkdir()
            competitions = [
                {'id': 'l_1', 'name': 'League', 'season': '2023/2024', 'matches': [{'id': 'm_1', 'status': 'finished'}]},
                {'id': 'l_2', 'name': 'Calendar league', 'season': '2023', 'matches': [{'id': 'm_2', 'status': 'finished'}]},
                {'id': 'l_3', 'name': 'Current league', 'season': '2024/2025', 'matches': [{'id': 'm_3', 'status': 'finished'}]},
            ]
            (archive / 'inventory.json').write_text(json.dumps({'retrieved_at_utc': '2026-11-02T00:00:00Z', 'competitions': competitions}), encoding='utf-8')
            out = base / 'dashboard'
            manifest = out / 'football-manifest.json'
            def fake_build(output, **kwargs):
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(gzip.compress(b'{}', mtime=0))
                kwargs['metadata_out'].update(collectedMatches=1, expectedFinishedMatches=1)
                return []
            with patch.object(multiseason, 'ARCHIVES', [archive]), patch.object(multiseason, 'DASHBOARD', out), patch.object(multiseason, 'MANIFEST', manifest), patch.object(multiseason, 'build', side_effect=fake_build):
                self.assertEqual(multiseason.main(), 0)
            result = json.loads(manifest.read_text(encoding='utf-8'))
            self.assertEqual([s['id'] for s in result['seasons']], ['2024/2025', '2023/2024'])
            older = result['seasons'][1]
            self.assertEqual(len(older['chunks']), 2)
            self.assertEqual((older['collectedMatches'], older['expectedFinishedMatches']), (2, 2))

    def test_inventory_refresh_reuses_unchanged_snapshot_but_rebuilds_changed_match(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            archive = base / 'europe_2021_2026'
            match_dir = archive / 'matches' / 'l_1'
            match_dir.mkdir(parents=True)
            match = match_dir / ('m_1--' + 'm_1'.encode().hex() + '.json')
            match.write_text('{"value":1}', encoding='utf-8')
            competition = {'id':'l_1', 'name':'League', 'season':'2023/2024',
                           'matches':[{'id':'m_1', 'status':'finished'}]}
            inventory = {'retrieved_at_utc':'2026-01-01T00:00:00Z', 'competitions':[competition]}
            source = archive / 'inventory.json'
            source.write_text(json.dumps(inventory), encoding='utf-8')
            out = base / 'dashboard'
            manifest = out / 'football-manifest.json'
            calls = []
            def fake_build(output, **kwargs):
                calls.append(1)
                current = json.loads(source.read_text(encoding='utf-8'))
                snapshot = {'meta':{'retrievedAt':current['retrieved_at_utc'],
                                    'sourceFiles':['data/sources/pitchapi/archives/europe_2021_2026/inventory.json'],
                                    'sourceSha256':{'inventory.json':hashlib.sha256(source.read_bytes()).hexdigest()}},
                            'matches':[json.loads(match.read_text(encoding='utf-8'))]}
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(gzip.compress(json.dumps(snapshot).encode(), mtime=0))
                kwargs['metadata_out'].update(collectedMatches=1, expectedFinishedMatches=1)
                return []
            with patch.object(multiseason, 'ARCHIVES', [archive]), patch.object(multiseason, 'DASHBOARD', out), \
                 patch.object(multiseason, 'MANIFEST', manifest), patch.object(multiseason, 'build', side_effect=fake_build):
                self.assertEqual(multiseason.main(), 0)
                first = json.loads(manifest.read_text(encoding='utf-8'))['seasons'][0]['chunks'][0]
                first_bytes = (out / first['path']).read_bytes()
                inventory['retrieved_at_utc'] = '2026-02-01T00:00:00Z'
                source.write_text(json.dumps(inventory), encoding='utf-8')
                self.assertEqual(multiseason.main(), 0)
                second = json.loads(manifest.read_text(encoding='utf-8'))['seasons'][0]['chunks'][0]
                self.assertEqual(len(calls), 1)
                self.assertEqual((out / second['path']).read_bytes(), first_bytes)
                self.assertEqual(json.loads(gzip.decompress(first_bytes))['meta']['retrievedAt'], '2026-01-01T00:00:00Z')
                match.write_text('{"value":12345}', encoding='utf-8')
                self.assertEqual(multiseason.main(), 0)
                self.assertEqual(len(calls), 2)
                changed = json.loads(manifest.read_text(encoding='utf-8'))['seasons'][0]['chunks'][0]
                self.assertEqual(json.loads(gzip.decompress((out / changed['path']).read_bytes()))['matches'][0]['value'], 12345)

    def test_canonical_tables_keep_both_new_and_existing_seasons(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            source = data / 'staging/dashboard'
            source.mkdir(parents=True)
            seasons = []
            for year in (2024, 2023):
                label = f'{year}/{year + 1}'
                part = {'meta': {'currentSeason': label}, 'metrics': [], 'competitions': [], 'teams': [], 'fixtures': [],
                        'matches': [{'id': f'm_{year}', 'shots': [{'id': 's_1', 'xg': 0.2}], 'stats': []}],
                        'appearances': [{'id': f'm_{year}:p_1', 'playerId': 'p_1', 'name': 'Player', 'imageUrl': None, 'minutes': 30, 'xg': None}]}
                file = f'{year}.json.gz'
                (source / file).write_bytes(gzip.compress(json.dumps(part).encode(), mtime=0))
                seasons.append({'id': label, 'chunks': [{'path': file, 'leagueId': 'l_1', 'meta': part['meta'], 'metrics': []}]})
            (source / 'football-manifest.json').write_text(json.dumps({'defaultSeason': '2024/2025', 'seasons': seasons}), encoding='utf-8')
            (source / 'open_matchday.json').write_text(json.dumps({'meta': {}, 'competitions': []}), encoding='utf-8')
            with patch.object(database, 'DATA', data):
                summary = database.build_tables()
                result = database.read(data / 'raw/index.json')
                older = next(s for s in result['seasons'] if s['id'] == '2023/2024')
                restored = database.restore_part(older['chunks'][0])
            self.assertEqual(summary['seasons'], 2)
            self.assertEqual([s['id'] for s in result['seasons']], ['2024/2025', '2023/2024'])
            self.assertIsNone(restored['appearances'][0]['xg'])
            self.assertEqual(restored['matches'][0]['shots'][0]['xg'], 0.2)

if __name__ == '__main__':
    unittest.main()
