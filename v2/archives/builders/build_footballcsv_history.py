#!/usr/bin/env python3
"""Extend the results-only OpenFootball archive using CC0 footballcsv datasets."""
import argparse
import csv
import datetime
import gzip
import hashlib
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
MONTHS = {name: number for number, name in enumerate(('Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'), 1)}
SOURCES = {
    'england': {'name':'footballcsv/england', 'url':'https://github.com/footballcsv/england', 'license':'CC0-1.0', 'revision':'52b7e5f5f37b28db72dba1fdc8dbec1adae4c8d0', 'country':'Angleterre'},
    'deutschland': {'name':'footballcsv/deutschland', 'url':'https://github.com/footballcsv/deutschland', 'license':'CC0-1.0', 'revision':'178324626681a9e4c42b81463f59f9c4500dbd53', 'country':'Allemagne'},
    'europe': {'name':'footballcsv/europe-champions-league', 'url':'https://github.com/footballcsv/europe-champions-league', 'license':'CC0-1.0', 'revision':'66393c8dc5c86b459dc700a0ae3a0bd0abedb56e', 'country':'Europe'},
    'soccerdata': {'name':'footballcsv/cache.soccerdata', 'url':'https://github.com/footballcsv/cache.soccerdata', 'license':'CC0-1.0', 'revision':'f1c9d41893a42afef0e72fd5c48ccfb51d166281', 'country':'Angleterre', 'upstream':{'name':'engsoccerdata', 'url':'https://github.com/jalapic/engsoccerdata', 'license':'GPL-2.0-or-later','usage':'usage gratuit non commercial ; attribution demandée'}},
}


def source_date(value):
    value = value.strip()
    normal = re.fullmatch(r'[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})', value)
    europe = re.fullmatch(r'\([A-Za-z]{3}\)\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+\(W\d+\))?', value)
    if normal: month, day, year = normal.groups()
    elif europe: day, month, year = europe.groups()
    else: raise ValueError(f'Unrecognised source date: {value}')
    if month not in MONTHS: raise ValueError(f'Unrecognised source month: {value}')
    return datetime.date(int(year), MONTHS[month], int(day)).isoformat()


def source_score(value):
    match = re.fullmatch(r'\s*(\d+)\s*-\s*(\d+)(?:\s*\((?:\*|a\.e\.t\.|pen\.)\))?\s*', value or '')
    return [int(match.group(1)), int(match.group(2))] if match else None


def competition_name(repo, code, year):
    if repo == 'europe' and code == 'champs': return 'Coupe d’Europe des clubs champions' if year < 1992 else 'Ligue des champions'
    if repo == 'deutschland' and code == 'de.1': return 'Bundesliga'
    if repo == 'soccerdata' and code.startswith('eng.'):
        tier = code.split('.',1)[1]
        labels = {'3a':'3 Nord','3b':'3 Sud'}
        return f"Angleterre · Division {labels.get(tier,tier)}"
    if repo == 'england' and code.startswith('eng.'):
        tier = code.split('.',1)[1]
        return 'Premier League' if tier == '1' else f'Angleterre · Division {tier}'
    return code


def build(output, sources):
    output = Path(output)
    index_path = output / 'index.json'
    index = json.loads(index_path.read_text(encoding='utf-8'))
    retained = [entry for entry in index['seasons'] if int(entry['id'][:4]) >= 2010]
    groups = defaultdict(list)
    additional = []
    for repo, archive in sources.items():
        info = SOURCES[repo]
        archive = Path(archive)
        additional.append({key: info[key] for key in ('name','url','license','revision')} | {'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest()} | ({'upstream':info['upstream']} if 'upstream' in info else {}))
        with zipfile.ZipFile(archive) as zipped:
            for name in zipped.namelist():
                parts = PurePosixPath(name).parts
                if len(parts) < 3 or not parts[-1].endswith('.csv'): continue
                season = re.fullmatch(r'(\d{4})-(\d{2})', parts[-2])
                if not season: continue
                year = int(season.group(1))
                if year >= (1992 if repo == 'soccerdata' else 2010) or int(season.group(2)) != (year + 1) % 100: continue
                code = parts[-1][:-4]
                text = zipped.read(name).decode('utf-8-sig')
                reader = csv.DictReader(io.StringIO(text))
                required = {'Date','Team 1','FT','Team 2'}
                if not required.issubset(set(reader.fieldnames or [])): raise ValueError(f'Unknown CSV schema: {name}')
                matches = []
                for row in reader:
                    match = {'round':row.get('Round') or row.get('Matchday'), 'date':source_date(row.get('Date') or ''),
                             'team1':row.get('Team 1'), 'team2':row.get('Team 2'), 'sourceFields':row}
                    scores={key:value for key,field in (('ft','FT'),('ht','HT'),('et','ET'),('p','P')) if (value:=source_score(row.get(field))) is not None}
                    if scores: match['score'] = scores
                    matches.append(match)
                groups[f'{year}/{year + 1}'].append({'id':repo+'/'+parts[-2]+'/'+code,'code':code,
                    'name':competition_name(repo,code,year),'country':info['country'],'sourceSeason':parts[-2],
                    'sourceFile':'/'.join(parts[1:]),'sourceRepository':info['name'],'sourceRevision':info['revision'],'matches':matches})
    index['source']['additionalSources'] = additional
    entries = []
    for label, competitions in sorted(groups.items(), reverse=True):
        competitions.sort(key=lambda c:(c['country'],c['name'],c['id']))
        raw=json.dumps({'season':label,'source':index['source'],'competitions':competitions},ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
        compressed=gzip.compress(raw,compresslevel=6,mtime=0)
        filename=label.replace('/','-')+'.json.gz';(output/filename).write_bytes(compressed)
        matches=sum(len(c['matches']) for c in competitions)
        results=sum(1 for c in competitions for m in c['matches'] if isinstance(m.get('score',{}).get('ft'),list))
        entries.append({'id':label,'path':'raw/openfootball/'+filename,'competitions':len(competitions),'matches':matches,'results':results,'sha256':hashlib.sha256(compressed).hexdigest()})
    index['seasons']=sorted(retained+entries,key=lambda entry:entry['id'],reverse=True)
    index_path.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return {'seasons':len(entries),'matches':sum(e['matches'] for e in entries),'results':sum(e['results'] for e in entries),'entries':entries}


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'data/raw/openfootball')
    parser.add_argument('--england',type=Path,required=True)
    parser.add_argument('--deutschland',type=Path,required=True)
    parser.add_argument('--europe',type=Path,required=True)
    parser.add_argument('--soccerdata',type=Path,required=True)
    args=parser.parse_args()
    result=build(args.output,{'england':args.england,'deutschland':args.deutschland,'europe':args.europe,'soccerdata':args.soccerdata})
    print(json.dumps({key:value for key,value in result.items() if key!='entries'},ensure_ascii=False))
