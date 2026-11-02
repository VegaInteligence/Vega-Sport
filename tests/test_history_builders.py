"""Historical season imports must preserve older and current datasets."""
import gzip
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
