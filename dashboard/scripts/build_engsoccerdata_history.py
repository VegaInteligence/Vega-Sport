#!/usr/bin/env python3
"""Add source-attributed European results without inventing dates or match scores."""
import argparse
import csv
import datetime
import gzip
import hashlib
import io
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
SOURCE='jalapic/engsoccerdata'
CONFIG={
 'facup':('FA Cup','Angleterre','cup',2018),
 'leaguecup':('Coupe de la Ligue anglaise','Angleterre','cup',2018),
 'spain':('Championnat d’Espagne · Division 1','Espagne','league',2020),
 'france':('Championnat de France · Division 1','France','league',2020),
 'italy':('Championnat d’Italie · Division 1','Italie','league',2020),
 'holland':('Eredivisie','Pays-Bas','league',2020),
 'germany2':('Allemagne · Division 2','Allemagne','division',2020),
 'portugal':('Championnat du Portugal · Division 1','Portugal','league',2020),
 'belgium':('Championnat de Belgique · Division 1','Belgique','league',2020),
 'turkey':('Championnat de Turquie · Division 1','Turquie','league',2020),
 'greece':('Championnat de Grèce · Division 1','Grèce','league',2020),
 'scotland':('Écosse','Écosse','division',2020),
}


def known(value):
    value=(value or '').strip()
    return None if value.lower() in ('','na','n/a') else value


def pair(value):
    value=known(value)
    if not value:return None
    parts=value.split('-')
    if len(parts)!=2 or not all(part.strip().isdigit() for part in parts):return None
    return [int(parts[0]),int(parts[1])]


def source_match(row, kind):
    value=known(row.get('Date'))
    try: date=datetime.date.fromisoformat(value).isoformat() if value else None
    except ValueError: date=None
    match={'date':date,'team1':known(row.get('home')),'team2':known(row.get('visitor')),
           'round':known(row.get('round')),'sourceFields':row}
    if not date:match['dateNote']='Date absente ou non reconnue dans la source.'
    nonmatch=known(row.get('nonmatch'))
    if nonmatch and nonmatch.lower() not in ('no','0'):
        match['status']='not_played'
        return match
    result=pair(row.get('FT'))
    if result is not None:
        if kind=='cup':
            score={'final':result}
            if (known(row.get('aet')) or '').lower()=='yes':score['et']=result
            home,away=known(row.get('hp')),known(row.get('vp'))
            if home and away and home.isdigit() and away.isdigit():score['p']=[int(home),int(away)]
        else:score={'ft':result}
        match['score']=score
    return match


def scored(match):
    if match.get('status')=='not_played':return False
    score=match.get('score',{})
    return any(isinstance(score.get(key),list) and len(score[key])==2 and all(isinstance(v,int) and not isinstance(v,bool) and v>=0 for v in score[key]) for key in ('final','et','ft'))


def build(source_dir, output):
    source_dir,output=Path(source_dir),Path(output)
    manifest=json.loads((source_dir/'manifest.json').read_text(encoding='utf-8'))
    index_path=output/'index.json';index=json.loads(index_path.read_text(encoding='utf-8'))
    source_info={key:manifest[key] for key in ('name','url','revision','license','usage')}
    source_info['sourceManifest']='sources/engsoccerdata/manifest.json'
    additional=[item for item in index['source'].get('additionalSources',[]) if item.get('name')!='engsoccerdata/data-raw']
    additional.append({**source_info,'name':'engsoccerdata/data-raw'})
    index['source']['additionalSources']=additional
    groups=defaultdict(list)
    old={entry['id']:entry for entry in index['seasons']}
    existing_codes={}
    def codes_for(label):
        if label not in existing_codes:
            entry=old.get(label)
            payload=json.loads(gzip.decompress((output/Path(entry['path']).name).read_bytes())) if entry else {'competitions':[]}
            existing_codes[label]={c.get('code') for c in payload['competitions'] if c.get('sourceRepository')!=SOURCE}
        return existing_codes[label]
    codes={'spain':'es.1','france':'fr.1','italy':'it.1','holland':'nl.1','germany2':'de.2','portugal':'pt.1','belgium':'be.1','turkey':'tr.1','greece':'gr.1'}
    for item in manifest['files']:
        name=item['name']
        if name not in CONFIG:continue
        title,country,kind,last_year=CONFIG[name]
        compressed=(source_dir/item['path']).read_bytes()
        if hashlib.sha256(compressed).hexdigest()!=item['sha256Compressed']:raise ValueError('Compressed source hash mismatch: '+name)
        raw=gzip.decompress(compressed)
        if hashlib.sha256(raw).hexdigest()!=item['sha256Raw']:raise ValueError('Raw source hash mismatch: '+name)
        reader=csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
        if not {'Date','Season','home','visitor','FT'}.issubset(set(reader.fieldnames or [])):raise ValueError('Unknown source schema: '+name)
        by_group=defaultdict(list)
        for row in reader:
            year=row.get('Season','').strip()
            if not year.isdigit() or int(year)>last_year:continue
            division=known(row.get('division')) if kind=='division' else None
            tier=known(row.get('tier')) if name=='scotland' else None
            group=tier or division or ''
            by_group[(int(year),group)].append(source_match(row,kind))
        for (year,group),matches in by_group.items():
            dates=Counter(m['date'] for m in matches if m.get('date'))
            if len(matches)>=20 and len(dates)==1 and sum(dates.values())==len(matches):
                for match in matches:
                    match['date']=None
                    match['dateNote']='Date source identique pour toute la compétition : précision non vérifiée.'
            label=f'{year}/{year+1}'
            existing_code=('sco.'+group if name=='scotland' else codes.get(name))
            if year>=2010 and existing_code and existing_code in codes_for(label):continue
            suffix=(f' · Division {group}' if name=='scotland' else f' · {group}') if group else ''
            groups[label].append({'id':f'engsoccerdata/{name}/{group or "all"}/{year}', 'code':name,
                'name':title+suffix,'country':country,'sourceSeason':str(year),'sourceFile':item['sourcePath'],
                'sourceRepository':SOURCE,'sourceRevision':manifest['revision'],'matches':matches})
    entries=[]
    for label,new_competitions in groups.items():
        entry=old.get(label)
        if entry:
            payload=json.loads(gzip.decompress((output/Path(entry['path']).name).read_bytes()))
            competitions=[c for c in payload['competitions'] if c.get('sourceRepository')!=SOURCE]
        else:competitions=[]
        competitions.extend(new_competitions);competitions.sort(key=lambda c:(c['country'],c['name'],c['id']))
        payload={'season':label,'source':index['source'],'competitions':competitions}
        body=gzip.compress(json.dumps(payload,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8'),compresslevel=6,mtime=0)
        filename=label.replace('/','-')+'.json.gz';(output/filename).write_bytes(body)
        matches=[m for c in competitions for m in c['matches']]
        entries.append({'id':label,'path':'raw/openfootball/'+filename,'competitions':len(competitions),'matches':len(matches),
                        'results':sum(scored(m) for m in matches),'unplayed':sum(m.get('status')=='not_played' for m in matches),
                        'unverifiedDates':sum(bool(m.get('dateNote')) for m in matches),'sha256':hashlib.sha256(body).hexdigest()})
    changed={entry['id'] for entry in entries}
    index['seasons']=sorted([entry for entry in index['seasons'] if entry['id'] not in changed]+entries,key=lambda x:x['id'],reverse=True)
    index_path.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return {'seasonsEnriched':len(entries),'newSeasons':sum(e['id'] not in old for e in entries),
            'newMatches':sum(len(c['matches']) for cs in groups.values() for c in cs),
            'unplayed':sum(m.get('status')=='not_played' for cs in groups.values() for c in cs for m in c['matches']),
            'unverifiedDates':sum(bool(m.get('dateNote')) for cs in groups.values() for c in cs for m in c['matches'])}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-dir',type=Path,default=ROOT/'data/sources/engsoccerdata');parser.add_argument('--output',type=Path,default=ROOT/'data/raw/openfootball');args=parser.parse_args()
    print(json.dumps(build(args.source_dir,args.output),ensure_ascii=False))
