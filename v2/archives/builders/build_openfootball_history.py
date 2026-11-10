#!/usr/bin/env python3
"""Build clearly labelled, results-only European archives from openfootball JSON."""
import argparse
import gzip
import hashlib
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
COUNTRIES = {
    'ad':'Andorre', 'al':'Albanie', 'am':'Arménie', 'at':'Autriche', 'az':'Azerbaïdjan',
    'ba':'Bosnie-Herzégovine', 'be':'Belgique', 'bg':'Bulgarie', 'by':'Biélorussie',
    'ch':'Suisse', 'cy':'Chypre', 'cz':'Tchéquie', 'de':'Allemagne', 'dk':'Danemark',
    'ee':'Estonie', 'en':'Angleterre', 'es':'Espagne', 'fi':'Finlande', 'fo':'Îles Féroé',
    'fr':'France', 'ge':'Géorgie', 'gi':'Gibraltar', 'gr':'Grèce', 'hr':'Croatie',
    'hu':'Hongrie', 'ie':'Irlande', 'is':'Islande', 'it':'Italie', 'ks':'Kosovo',
    'lt':'Lituanie', 'lu':'Luxembourg', 'lv':'Lettonie', 'md':'Moldavie',
    'me':'Monténégro', 'mk':'Macédoine du Nord', 'mt':'Malte', 'nl':'Pays-Bas',
    'no':'Norvège', 'pl':'Pologne', 'pt':'Portugal', 'ro':'Roumanie', 'rs':'Serbie',
    'ru':'Russie', 'sco':'Écosse', 'se':'Suède', 'si':'Slovénie', 'sk':'Slovaquie',
    'sm':'Saint-Marin', 'tr':'Turquie', 'ua':'Ukraine', 'uefa':'Europe', 'wal':'Pays de Galles',
}
SOURCE = 'https://github.com/openfootball/football.json'
REVISION = 'e6744429ee395bc86f247348c6184bb08d4eb361'


def scored(match):
    score = match.get('score')
    ft = score.get('ft') if isinstance(score, dict) else None
    return isinstance(ft, list) and len(ft) == 2 and all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in ft)


def build(archive, output, first_year=2010, last_year=2020, revision=REVISION):
    archive, output = Path(archive), Path(output)
    groups = defaultdict(list)
    with zipfile.ZipFile(archive) as source:
        for name in source.namelist():
            parts = PurePosixPath(name).parts
            if len(parts) != 3 or not parts[2].endswith('.json'):
                continue
            season = re.fullmatch(r'(\d{4})(?:-(\d{2}))?', parts[1])
            if not season:
                continue
            year = int(season.group(1))
            if not first_year <= year <= last_year:
                continue
            if season.group(2) and int(season.group(2)) != (year + 1) % 100:
                continue
            code = parts[2][:-5]
            country = COUNTRIES.get(code.split('.')[0])
            if not country:
                continue
            item = json.loads(source.read(name))
            if not isinstance(item, dict) or not isinstance(item.get('matches'), list):
                raise ValueError(f'Invalid source file: {name}')
            if any(not isinstance(match, dict) for match in item['matches']):
                raise ValueError(f'Invalid match record: {name}')
            groups[f'{year}/{year + 1}'].append({
                'id': parts[1] + '/' + code,
                'code': code,
                'name': item.get('name') or code,
                'country': country,
                'sourceSeason': parts[1],
                'sourceFile': '/'.join(parts[1:]),
                'matches': item['matches'],
            })
    output.mkdir(parents=True, exist_ok=True)
    source_info = {'name':'OpenFootball', 'url':SOURCE, 'license':'CC0-1.0', 'revision':revision,
                   'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
                   'coverage':'Résultats et calendriers seulement ; pas de statistiques joueurs ni xG.'}
    index = {'schemaVersion':1, 'source':source_info, 'seasons':[]}
    for label, competitions in sorted(groups.items(), reverse=True):
        competitions.sort(key=lambda c: (c['country'], c['name'], c['id']))
        payload = {'season':label, 'source':source_info, 'competitions':competitions}
        raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
        compressed = gzip.compress(raw, compresslevel=6, mtime=0)
        filename = label.replace('/', '-') + '.json.gz'
        (output / filename).write_bytes(compressed)
        matches = sum(len(c['matches']) for c in competitions)
        results = sum(scored(m) for c in competitions for m in c['matches'])
        index['seasons'].append({'id':label, 'path':'raw/openfootball/' + filename,
                                 'competitions':len(competitions), 'matches':matches, 'results':results,
                                 'sha256':hashlib.sha256(compressed).hexdigest()})
    (output / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return index


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/raw/openfootball')
    args = parser.parse_args()
    result = build(args.archive, args.output)
    print(json.dumps({'seasons':len(result['seasons']), 'matches':sum(s['matches'] for s in result['seasons']),
                      'results':sum(s['results'] for s in result['seasons'])}, ensure_ascii=False))
