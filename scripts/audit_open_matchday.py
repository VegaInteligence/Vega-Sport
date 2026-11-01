#!/usr/bin/env python3
"""Compare exact match identities in the two independently sourced archives."""
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
PITCH = ROOT / 'data' / 'europe_2026_2027' / 'inventory.json'
SUPPLEMENT = ROOT / 'data' / 'open_matchday_2026_2027'

# Explicit competition-level equivalence; unmatched names are never guessed.
LEAGUES = {
    'AUT_1_bundesliga':('AUT','Bundesliga'), 'BEL_1_pro-league':('BEL','First Division A'),
    'CRO_1_hnl':('CRO','HNL'), 'CZE_1_chance-liga':('CZE','1. Liga'), 'DEN_1_superliga':('DEN','Superligaen'),
    'ENG_1_premier-league':('ENG','Premier League'), 'ENG_2_championship':('ENG','Championship'),
    'ENG_3_league-one':('ENG','League One'), 'ENG_4_league-two':('ENG','League Two'),
    'ESP_1_la-liga':('ESP','LaLiga'), 'ESP_2_segunda-division':('ESP','LaLiga2'),
    'FIN_1_veikkausliiga':('FIN','Veikkausliiga'), 'FRA_1_ligue-1':('FRA','Ligue 1'), 'FRA_2_ligue-2':('FRA','Ligue 2'),
    'GER_1_bundesliga':('GER','Bundesliga'), 'GER_2_2-bundesliga':('GER','2. Bundesliga'), 'GER_3_3-liga':('GER','3. Liga'),
    'GRE_1_super-league':('GRE','Super League 1'), 'ITA_1_serie-a':('ITA','Serie A'), 'ITA_2_serie-b':('ITA','Serie B'),
    'NED_1_eredivisie':('NED','Eredivisie'), 'NED_2_eerste-divisie':('NED','Eerste Divisie'),
    'NOR_1_eliteserien':('NOR','Eliteserien'), 'POL_1_ekstraklasa':('POL','Ekstraklasa'),
    'POR_1_primeira-liga':('POR','Liga Portugal'), 'ROU_1_liga-1':('ROU','Liga I'), 'RUS_1_premier-liga':('RUS','Premier League'),
    'SCO_1_premiership':('SCO','Premiership'), 'SUI_1_super-league':('SUI','Super League'), 'SVK_1_nike-liga':('SVK','1. liga'),
    'SWE_1_allsvenskan':('SWE','Allsvenskan'), 'TUR_1_super-lig':('TUR','Super Lig'),
    'UEFA_1_champions-league':('INT','Champions League'), 'UEFA_1_conference-league':('INT-2','Conference League'),
    'UEFA_1_europa-league':('INT-2','Europa League'),
}


def normalized(value):
    value = unicodedata.normalize('NFKD', str(value or '')).casefold()
    return re.sub(r'[^a-z0-9]', '', ''.join(c for c in value if not unicodedata.combining(c)))


def audit(inventory_path=PITCH, supplement=SUPPLEMENT):
    supplement = Path(supplement)
    inventory = json.loads(Path(inventory_path).read_text(encoding='utf-8'))
    manifest = json.loads((supplement / 'manifest.json').read_text(encoding='utf-8'))
    pitch_leagues = {(c['country_code'], c['name']): c for c in inventory['competitions']}
    compared = agreements = 0
    details, disagreements = [], []
    for source in manifest['competitions']:
        league = pitch_leagues.get(LEAGUES.get(source['folder']))
        result_file = source['files'].get('results')
        if not league or not result_file:
            continue
        candidates = {}
        for match in league['matches']:
            if match.get('status') != 'finished':
                continue
            key = (match.get('date'), normalized((match.get('home_team') or {}).get('name')), normalized((match.get('away_team') or {}).get('name')))
            candidates.setdefault(key, []).append(match)
        local_compared = local_agreements = 0
        with (supplement / result_file['path']).open(encoding='utf-8-sig', newline='') as stream:
            for row in csv.DictReader(stream):
                key = (row.get('date'), normalized(row.get('home')), normalized(row.get('away')))
                matches = candidates.get(key, [])
                if len(matches) != 1 or not key[1] or not key[2]:
                    continue
                try:
                    source_score = (int(row['ft_home']), int(row['ft_away']))
                    pitch_score = (int(matches[0]['score_home']), int(matches[0]['score_away']))
                except (TypeError, ValueError, KeyError):
                    continue
                compared += 1; local_compared += 1
                if source_score == pitch_score:
                    agreements += 1; local_agreements += 1
                else:
                    disagreements.append({'competition':source['name'], 'date':row['date'], 'home':row['home'], 'away':row['away'],
                                          'pitchapi_match_id':matches[0]['id'], 'pitchapi_score':pitch_score, 'open_matchday_score':source_score})
        details.append({'competition':source['name'], 'folder':source['folder'], 'compared':local_compared,
                        'agreements':local_agreements, 'disagreements':local_compared-local_agreements})
    result = {'generated_at_utc':datetime.now(timezone.utc).isoformat(), 'pitch_inventory_at_utc':inventory['retrieved_at_utc'],
              'open_matchday_generated_at_utc':manifest['source_generated_at_utc'], 'match_rule':'same mapped competition, date and normalized home/away names',
              'compared':compared, 'agreements':agreements, 'disagreements':disagreements, 'competitions':details}
    output = supplement / 'cross_source_audit.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"Cross-source score check: {agreements}/{compared} agree; {len(disagreements)} disagree")
    return result


if __name__ == '__main__':
    audit()
