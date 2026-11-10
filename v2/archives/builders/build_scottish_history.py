#!/usr/bin/env python3
"""Add separately sourced Scottish league scores to the historical archive."""
import argparse, csv, gzip, hashlib, io, json
from collections import defaultdict
from pathlib import Path
from build_engsoccerdata_history import scored

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'data/sources/worldclub'
OUTPUT=ROOT/'data/raw/openfootball'

def build(source,output):
    source,output=Path(source),Path(output)
    manifest=json.loads((source/'scotland-manifest.json').read_text(encoding='utf-8'))
    compressed=(source/manifest['path']).read_bytes()
    if hashlib.sha256(compressed).hexdigest()!=manifest['sha256Compressed']: raise ValueError('Compressed source checksum mismatch')
    raw=gzip.decompress(compressed)
    if hashlib.sha256(raw).hexdigest()!=manifest['sha256Raw']: raise ValueError('Source checksum mismatch')
    index_path=output/'index.json';index=json.loads(index_path.read_text(encoding='utf-8'))
    groups=defaultdict(list);seen=set()
    for row in csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))):
        day=row['date'];year=int(day[:4]);season_year=year if int(day[5:7])>=7 else year-1
        if row['competition']!='scotland' or row['level']!='national' or row['full_time']!='F' or not row['gh'].isdigit() or not row['ga'].isdigit():
            raise ValueError('Unexpected source record: '+repr(row))
        key=(day,row['home'],row['away'],row['gh'],row['ga'])
        if key in seen:raise ValueError('Duplicate match: '+repr(key))
        seen.add(key)
        groups[season_year].append({'round':None,'date':day,'team1':row['home'],'team2':row['away'],
                                    'score':{'ft':[int(row['gh']),int(row['ga'])]},'sourceFields':row})
    info={'name':manifest['name'],'url':manifest['url'],'license':manifest['license'],'revision':manifest['revision'],
          'sourceManifest':'sources/worldclub/scotland-manifest.json',
          'usage':'couverture variable ; en 1915/1916, Morton–Hearts ne fut pas disputé (379 matchs joués)'}
    sources=index['source'].setdefault('additionalSources',[])
    sources[:]=[s for s in sources if s.get('name')!=info['name']]+[info]
    previous={x['id']:x for x in index['seasons']};changed=[];new=[]
    for year,matches in sorted(groups.items()):
        season=f'{year}/{year+1}';filename=f'{year}-{year+1}.json.gz';path=output/filename
        if season in previous:
            data=json.loads(gzip.decompress(path.read_bytes()))
        else:
            data={'season':season,'source':index['source'],'competitions':[]};new.append(season)
        league_id=f'worldclub/scotland/{year}'
        if any(c.get('country')=='Écosse' and c.get('id')!=league_id for c in data['competitions']):
            raise ValueError('Existing Scottish competition needs manual review: '+season)
        league={'id':league_id,'code':'sco.1','name':'Championnat d’Écosse · Division 1','country':'Écosse',
                'sourceSeason':season,'sourceFile':manifest['upstreamPath'],'sourceRepository':manifest['name'],
                'sourceRevision':manifest['revision'],'matches':matches}
        data['competitions']=[c for c in data['competitions'] if c.get('id')!=league_id]+[league]
        data['source']=index['source']
        data['competitions'].sort(key=lambda c:(c.get('country',''),c.get('name','')))
        body=gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode('utf-8'),compresslevel=9,mtime=0)
        path.write_bytes(body);all_matches=[m for c in data['competitions'] for m in c['matches']]
        entry={'id':season,'path':'raw/openfootball/'+filename,'competitions':len(data['competitions']),
               'matches':len(all_matches),'results':sum(scored(m) for m in all_matches),
               'unplayed':sum(m.get('status')=='not_played' for m in all_matches),
               'unverifiedDates':sum(bool(m.get('dateNote')) for m in all_matches),'sha256':hashlib.sha256(body).hexdigest()}
        previous[season]=entry;changed.append({'season':season,'scottishResults':len(matches),'newSeason':season in new})
    index['seasons']=sorted(previous.values(),key=lambda x:x['id'],reverse=True)
    index_path.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return {'sourceRows':len(seen),'seasonsEnriched':len(changed),'newSeasons':new,'changed':changed}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=SOURCE);parser.add_argument('--output',type=Path,default=OUTPUT);args=parser.parse_args()
    report=build(args.source,args.output)
    print(json.dumps({k:v for k,v in report.items() if k!='changed'},ensure_ascii=False))
