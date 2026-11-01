"""Scope and missing-value checks for the supplemental European source."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'dashboard/scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


collector = load('collect_open_matchday')
builder = load('build_open_matchday_dashboard')
auditor = load('audit_open_matchday')


class OpenMatchdayTests(unittest.TestCase):
    def test_europe_scope_and_empty_values_survive_the_dashboard_build(self):
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, 'w') as archive:
            archive.writestr('open-matchday-master/build_summary.json', json.dumps({
                'season':'2627', 'generated_utc':'2026-10-31T00:00:00Z', 'leagues':[
                    {'folder':'data/UKR_1_premier-league', 'league':'Ukrainian Premier League'},
                    {'folder':'data/BRA_1_serie-a', 'league':'Serie A'},
                ]}))
            archive.writestr('open-matchday-master/data/UKR_1_premier-league/results_2627.csv', 'date,home,away,ft_home,ft_away,home_shots\n2026-08-01,A,B,1,0,\n')
            archive.writestr('open-matchday-master/data/BRA_1_serie-a/results_2627.csv', 'date,home,away\n2026-08-01,C,D\n')
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'archive'
            output = Path(directory) / 'dashboard.json'
            manifest = collector.collect(payload.getvalue(), archive)
            self.assertEqual([c['country_code'] for c in manifest['competitions']], ['UKR'])
            builder.build(archive, output)
            snapshot = json.loads(output.read_text(encoding='utf-8'))
            row = snapshot['competitions'][0]['results'][0]
            self.assertEqual((row['ft_home'], row['ft_away'], row['home_shots']), ('1', '0', ''))
            self.assertEqual(snapshot['competitions'][0]['fixtures'], [])

    def test_cross_source_audit_reports_disagreement_and_does_not_guess_names(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            supplement = base / 'source'
            supplement.mkdir()
            (supplement / 'results.csv').write_text('date,home,away,ft_home,ft_away\n2026-08-01,A,B,1,0\n2026-08-02,A,C,2,0\n', encoding='utf-8')
            (supplement / 'manifest.json').write_text(json.dumps({'source_generated_at_utc':'2026-10-31', 'competitions':[
                {'folder':'ENG_1_premier-league','name':'Premier League','files':{'results':{'path':'results.csv'}}}]}), encoding='utf-8')
            inventory = {'retrieved_at_utc':'2026-11-01','competitions':[{'country_code':'ENG','name':'Premier League','matches':[
                {'id':'m_000001','date':'2026-08-01','status':'finished','home_team':{'name':'A'},'away_team':{'name':'B'},'score_home':1,'score_away':1},
                {'id':'m_000002','date':'2026-08-02','status':'finished','home_team':{'name':'A'},'away_team':{'name':'Different'},'score_home':2,'score_away':0}]}]}
            inventory_path = base / 'inventory.json'
            inventory_path.write_text(json.dumps(inventory), encoding='utf-8')
            result = auditor.audit(inventory_path, supplement)
            self.assertEqual((result['compared'], result['agreements'], len(result['disagreements'])), (1, 0, 1))
            self.assertEqual(result['disagreements'][0]['pitchapi_match_id'], 'm_000001')


if __name__ == '__main__':
    unittest.main()
