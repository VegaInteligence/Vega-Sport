#!/usr/bin/env python3
"""Build a local dashboard snapshot from the collected European-season archive."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import gzip
import hashlib
import io
import json
import os
import sys

from build_dashboard_data import METRICS, build_snapshot

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'data' / 'sources' / 'pitchapi' / 'archives' / 'europe_2026_2027'
OUTPUT = ROOT / 'data' / 'staging' / 'dashboard' / 'football.json'


def season_label(value):
    value = str(value or '')
    return f'{value}/{int(value) + 1}' if len(value) == 4 and value.isdigit() else value


def build(output=OUTPUT, archive=None, display_season=None, include_inventory_only=False, write_issues=True, competition_id=None, metadata_out=None):
    archive = Path(archive or ARCHIVE)
    inventory_bytes = (archive / 'inventory.json').read_bytes()
    inventory = json.loads(inventory_bytes)
    catalogue = json.loads((archive / 'catalogue.json').read_text(encoding='utf-8'))
    if display_season:
        inventory['competitions'] = [c for c in inventory['competitions'] if season_label(c['season']) == display_season]
    if competition_id:
        inventory['competitions'] = [c for c in inventory['competitions'] if c['id'] == competition_id]
    catalogue_by_id = {league['id']: league for league in catalogue['leagues']}
    competitions = {}
    matches, appearances, issues = [], [], []
    collected_matches = 0
    teams = {}
    for c in inventory['competitions']:
        league = catalogue_by_id.get(c['id'], {})
        country = 'TUR' if c['name'] == '1. Lig' and c['country_code'] == 'INT' else c['country_code']
        competition = competitions.setdefault(c['id'], {
            'id': c['id'], 'name': c['name'], 'country': country, 'providerCountry': c['country_code'],
            'seasons': [], 'imageUrl': league.get('image_url'), 'sampleMatches': 0, 'sampleSeasons': [],
        })
        if c['season'] not in competition['seasons']:
            competition['seasons'].append(c['season'])
        for fixture in c['matches']:
            if fixture.get('status') != 'finished':
                continue
            match_id = fixture['id']
            safe_name = f'{match_id}--{match_id.encode().hex()}.json'
            file = archive / 'matches' / c['id'] / safe_name
            if not file.exists():
                file = archive / 'matches' / c['id'] / (match_id + '.json')
            has_record = file.exists()
            if not has_record and not include_inventory_only:
                continue
            try:
                raw = json.loads(file.read_text(encoding='utf-8')) if has_record else {'endpoints': {}}
                def response(name):
                    item = raw['endpoints'].get(name) or {}
                    return {'ok': item.get('status') == 200, 'data': item.get('data')}
                sample = {
                    'match': fixture, 'country': country, 'league': c['name'],
                    'league_id': c['id'], 'season': c['season'],
                    'players': response('players'), 'shots': response('shots'),
                    'lineups': response('lineups'), 'team_stats': response('stats'),
                }
                one = build_snapshot({'samples': [sample]}, {'data': {'leagues': []}})
            except (ValueError, KeyError, TypeError, AttributeError, OSError) as error:
                issues.append({'match_id': fixture.get('id'), 'error': type(error).__name__})
                continue
            for match in one['matches']:
                match['detailCollected'] = has_record and raw.get('complete', True) is not False
            collected_matches += int(has_record and raw.get('complete', True) is not False)
            matches.extend(one['matches'])
            appearances.extend(one['appearances'])
            competitions[c['id']]['sampleMatches'] += 1
            if c['season'] not in competitions[c['id']]['sampleSeasons']:
                competitions[c['id']]['sampleSeasons'].append(c['season'])
            for team in one['teams']:
                current = teams.setdefault(team['id'], team)
                if current is not team:
                    current['sampleMatches'] += team['sampleMatches']
                    current['leagueIds'] = sorted(set(current['leagueIds'] + team['leagueIds']))
                    current['seasons'] = sorted(set(current['seasons'] + team['seasons']))
    matches.sort(key=lambda m: (m.get('timeUtc') or '', m['id']), reverse=True)
    appearances.sort(key=lambda p: (p['matchId'], p['playerId']))
    played = [p for p in appearances if p['minutes'] is not None and p['minutes'] > 0]
    all_shots = [s for m in matches for s in m['shots']]
    dates = sorted(m['date'] for m in matches if m.get('date'))
    seasons = sorted({m['season'] for m in matches if m.get('season')})
    total_finished = sum(sum(m.get('status') == 'finished' for m in c['matches']) for c in inventory['competitions'])
    meta = {
        'schemaVersion': 1, 'retrievedAt': inventory['retrieved_at_utc'],
        'source': 'PitchAPI · archive européenne locale',
        'sourceFiles': [f'data/sources/pitchapi/archives/{archive.name}/inventory.json', f'data/sources/pitchapi/archives/{archive.name}/matches/'],
        'sourceSha256': {'inventory.json': hashlib.sha256(inventory_bytes).hexdigest()},
        'ratingSource': 'PitchAPI', 'rankingAvailable': False,
        'matchCount': len(matches), 'collectedMatches': collected_matches, 'expectedFinishedMatches': total_finished,
        'playerCount': len({p['playerId'] for p in appearances}),
        'activePlayerCount': len({p['playerId'] for p in played}),
        'appearanceCount': len(played), 'listedAppearanceCount': len(appearances),
        'teamCount': len({p['teamId'] for p in appearances if p['teamId']}),
        'catalogCount': len(competitions), 'seasonCount': len(competitions),
        'catalogSeasons': sorted({c['season'] for c in inventory['competitions']}),
        'sampleCompetitionCount': len({m['leagueId'] for m in matches}),
        'shotCount': len(all_shots), 'knownShotXgCount': sum(s['xg'] is not None for s in all_shots),
        'ratedAppearanceCount': sum(p['rating'] is not None for p in played),
        'xgAppearanceCount': sum(p['xg'] is not None for p in played),
        'xaAppearanceCount': sum(p['xa'] is not None for p in played),
        'xgMatchCount': sum(m['coverage']['xg'] for m in matches),
        'ratedMatchCount': sum(m['coverage']['ratings'] for m in matches),
        'shotMatchCount': sum(m['coverage']['shots'] for m in matches),
        'startDate': dates[0] if dates else None, 'endDate': dates[-1] if dates else None,
        'seasons': seasons,
        'notes': [
            'Compétitions européennes PitchAPI ; les saisons civiles sont regroupées par année de début.',
            'La collecte peut être incomplète ; comparer collectedMatches à expectedFinishedMatches.',
            'Les notes proviennent de PitchAPI ; aucun score Orion n’est calculé.',
            'Les valeurs absentes restent null ; les statistiques d’action incohérentes sont masquées.',
            'Les rôles ne sont pas déduits des codes de position non validés du fournisseur.',
        ],
    }
    fixtures = [dict(m, league={'id': c['id'], 'name': c['name']}, season=c['season'])
                for c in inventory['competitions'] for m in c['matches']]
    result = {'meta': meta, 'competitions': sorted(competitions.values(), key=lambda x: (x['name'], x['id'])),
              'teams': sorted(teams.values(), key=lambda x: (x['name'] or '', x['id'])),
              'fixtures': fixtures, 'matches': matches, 'appearances': appearances, 'metrics': METRICS}
    if metadata_out is not None:
        metadata_out.update({'matchCount':len(matches), 'collectedMatches':collected_matches,
                             'expectedFinishedMatches':total_finished, 'sourceSeasons':meta['catalogSeasons']})
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f'{output.name}.{os.getpid()}.tmp')
    if output.name.endswith('.gz'):
        with temporary.open('wb') as raw_file:
            with gzip.GzipFile(filename='', mode='wb', fileobj=raw_file, mtime=0) as compressed:
                with io.TextIOWrapper(compressed, encoding='utf-8') as stream:
                    json.dump(result, stream, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    else:
        temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    temporary.replace(output)
    if write_issues:
        (archive / 'dashboard_issues.json').write_text(json.dumps(issues, ensure_ascii=False), encoding='utf-8')
    print(f"Dashboard: {len(matches)} matches, {collected_matches}/{total_finished} detailed, {len(appearances)} player rows, {len(all_shots)} shots, {len(issues)} normalization issues")
    return issues


if __name__ == '__main__':
    sys.exit(1 if build() else 0)
