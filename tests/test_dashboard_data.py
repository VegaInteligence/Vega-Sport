"""Data normalization checks using synthetic, independent match records."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_dashboard_data', ROOT / 'scripts/build_dashboard_data.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def metric(key, value, total=None):
    stat = {'type': 'integer', 'value': value}
    if total is not None:
        stat['total'] = total
    return {'key': key, 'stat': stat}


def synthetic():
    teams = {'home_team': {'id': 't_000001', 'name': 'A'}, 'away_team': {'id': 't_000002', 'name': 'B'}}
    player = {'player': {'id': 'p_000001', 'name': 'Player'}, 'team_id': 't_000001', 'stats': [
        {'key': 'top_stats', 'stats': {'Minutes': metric('minutes_played', 90), 'Goals': metric('goals', 1), 'Passes': metric('accurate_passes', 4, 5), 'Actions': metric('defensive_actions', 1)}},
        {'key': 'defense', 'stats': {'Repeated': metric('defensive_actions', 1)}},
    ]}
    def response(value): return {'ok': True, 'data': value, 'status': 200}
    sample = {'country': 'FRA', 'league': 'Example', 'league_id': 'l_000001', 'season': '2026/2027',
              'match': {'id': 'm_000001', 'date': '2026-08-01', 'time_utc': '2026-08-01T12:00:00Z', 'status': 'finished', 'score_home': 1, 'score_away': 0, **teams},
              'players': response([player]), 'lineups': response({'home': {'starters': [{'player_id': 'p_000001', 'position_id': 11}], 'subs': []}, 'away': {'starters': [], 'subs': []}}),
              'shots': response({'periods': [{'shots': [{'id': 's_000001', 'event_type': 'OwnGoal', 'is_own_goal': True, 'player': {'id': 'p_000001'}, 'team_id': 't_000001'}]}]}),
              'team_stats': response({'periods': [{'period': 'All', 'groups': [{'items': [{'key': 'total_shots', 'title': 'Shots', 'home': '1', 'away': '0'}, {'key': 'accurate_passes', 'title': 'Passes', 'home': '4 (80%)', 'away': '5 (90%)'}]}]}]})}
    suspicious = copy.deepcopy(sample)
    suspicious['league'] = '3. Liga'; suspicious['match']['id'] = 'm_000002'; suspicious['match']['score_home'] = 1; suspicious['match']['score_away'] = 2
    suspicious['shots']['data']['periods'] = None
    for item in suspicious['team_stats']['data']['periods'][0]['groups'][0]['items']:
        item['home'] = item['away'] = '0'
    return {'samples': [sample, suspicious]}, {'data': {'leagues': [{'id': 'l_000001', 'name': 'Example', 'country_code': 'FRA', 'seasons': ['2026/2027']}]}}


class DashboardDataTests(unittest.TestCase):
    def setUp(self):
        self.raw, self.catalog = synthetic()
        self.snapshot = builder.build_snapshot(self.raw, self.catalog)

    def test_counts_references_and_unknown_own_goal_xg(self):
        self.assertEqual(self.snapshot['meta']['matchCount'], 2)
        self.assertEqual(len(self.snapshot['appearances']), 2)
        own_goal = next(s for m in self.snapshot['matches'] for s in m['shots'] if s['isOwnGoal'])
        self.assertIsNone(own_goal['xg'])
        self.assertFalse(own_goal['isGoal'])
        self.assertEqual({p['id'] for p in self.snapshot['appearances']}, {p for m in self.snapshot['matches'] for p in m['players']})

    def test_goal_event_with_own_goal_flag_is_not_a_scorers_goal(self):
        raw = copy.deepcopy(self.raw)
        shot = raw['samples'][0]['shots']['data']['periods'][0]['shots'][0]
        shot['event_type'] = 'Goal'
        shot['is_own_goal'] = True
        snapshot = builder.build_snapshot(raw, self.catalog)
        result = next(m for m in snapshot['matches'] if m['id'] == 'm_000001')['shots'][0]
        self.assertTrue(result['isOwnGoal'])
        self.assertFalse(result['isGoal'])

    def test_suspicious_zeros_are_masked_but_goals_and_minutes_remain(self):
        match = next(m for m in self.snapshot['matches'] if m['league'] == '3. Liga')
        self.assertFalse(match['coverage']['shots'])
        self.assertIsNone(match['home']['shots'])
        p = next(p for p in self.snapshot['appearances'] if p['matchId'] == match['id'])
        self.assertIsNone(p['passesAccurate'])
        self.assertEqual((p['goals'], p['minutes']), (1, 90))

    def test_scoreless_match_with_missing_shots_and_zero_placeholders(self):
        raw = copy.deepcopy(self.raw)
        match = raw['samples'][1]['match']
        match['score_home'] = match['score_away'] = 0
        snapshot = builder.build_snapshot(raw, self.catalog)
        result = next(m for m in snapshot['matches'] if m['id'] == match['id'])
        self.assertFalse(result['coverage']['shots'])
        self.assertIsNone(result['home']['shots'])

    def test_empty_shot_list_with_reported_shots_does_not_mask_valid_player_stats(self):
        raw = copy.deepcopy(self.raw)
        raw['samples'][0]['shots']['data']['periods'] = []
        snapshot = builder.build_snapshot(raw, self.catalog)
        match = next(m for m in snapshot['matches'] if m['id'] == 'm_000001')
        player = next(p for p in snapshot['appearances'] if p['matchId'] == match['id'])
        self.assertFalse(match['coverage']['shots'])
        self.assertEqual(match['home']['shots'], 1)
        self.assertEqual(player['passesAccurate'], 4)

    def test_fraction_duplicates_and_roles(self):
        p = next(p for p in self.snapshot['appearances'] if p['matchId'] == 'm_000001')
        self.assertEqual((p['passesAccurate'], p['passesAttempted'], p['defensiveActions']), (4, 5, 1))
        self.assertIsNone(p['role'])
        self.assertIsNone(builder.number(False))
        self.assertEqual(builder.number(0), 0)

    def test_duplicate_and_failed_endpoint(self):
        duplicate = copy.deepcopy(self.raw)
        duplicate['samples'].append(copy.deepcopy(duplicate['samples'][0]))
        self.assertEqual(builder.build_snapshot(duplicate, self.catalog), self.snapshot)
        failed = copy.deepcopy(self.raw)
        failed['samples'][0]['players']['ok'] = False
        result = builder.build_snapshot(failed, self.catalog)
        match = next(m for m in result['matches'] if m['id'] == 'm_000001')
        self.assertFalse(match['coverage']['players'])

    def test_deterministic_without_mutating_sources(self):
        before = json.dumps(self.raw, sort_keys=True)
        self.assertEqual(builder.build_snapshot(self.raw, self.catalog), self.snapshot)
        self.assertEqual(json.dumps(self.raw, sort_keys=True), before)


if __name__ == '__main__':
    unittest.main()
