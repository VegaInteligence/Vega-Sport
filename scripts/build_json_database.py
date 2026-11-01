#!/usr/bin/env python3
"""Build an entity-oriented JSON database from local source archives, offline."""
import argparse, gzip, hashlib, json, os, tarfile, subprocess, sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def write(relative, value):
    path=DATA/relative;path.parent.mkdir(parents=True,exist_ok=True)
    raw=json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
    if path.is_file():
        existing=path.read_bytes()
        decoded=gzip.decompress(existing) if path.suffix=='.gz' else existing.rstrip(b'\n')
        if decoded==raw:
            return {'path':relative,'sha256':hashlib.sha256(existing).hexdigest(),'rows':len(value) if isinstance(value,list) else None}
    body=gzip.compress(raw,compresslevel=6,mtime=0) if path.suffix=='.gz' else raw+b'\n'
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_bytes(body);tmp.replace(path)
    return {'path':relative,'sha256':hashlib.sha256(body).hexdigest(),'rows':len(value) if isinstance(value,list) else None}

def read(path):
    body=Path(path).read_bytes()
    return json.loads(gzip.decompress(body) if str(path).endswith('.gz') else body)

def restore_part(chunk):
    tables={k:read(DATA/v['path']) for k,v in chunk['tables'].items()}
    players={p['id']:p for p in tables.pop('players')}
    apps=[]
    for p in tables.pop('performances'):
        row=dict(p);ref=row.pop('playerRef');player=players[ref]
        apps.append(dict(row,name=player['name'],imageUrl=player['imageUrl']))
    shots=defaultdict(list);stats=defaultdict(list)
    for s in tables.pop('shots'):
        row=dict(s);match=row.pop('matchId');shots[match].append(row)
    for s in tables.pop('team_statistics'):stats[s['matchId']]=s['values']
    for m in tables['matches']:m.update(shots=shots[m['id']],stats=stats[m['id']])
    return dict(tables,appearances=apps,meta=chunk['meta'],metrics=chunk['metrics'])

def build_tables():
    source=DATA/'staging/dashboard'
    if not (source/'football-manifest.json').is_file():
        subprocess.run([sys.executable,str(ROOT/'scripts/restore_europe.py')],check=True)
        subprocess.run([sys.executable,str(ROOT/'scripts/build_multiseason_dashboard.py')],check=True)
    if not (source/'open_matchday.json').is_file():
        subprocess.run([sys.executable,str(ROOT/'scripts/build_open_matchday_dashboard.py')],check=True)
    old=read(source/'football-manifest.json')
    index={'schemaVersion':3,'storage':'json-relational','schema':'raw/schema.json','defaultSeason':old['defaultSeason'],'seasons':[]}
    counts=Counter(); comparisons=0
    for season in old['seasons']:
        out={'id':season['id'],'chunks':[]}
        for chunk in season['chunks']:
            part=read(source/chunk['path']); league=chunk['leagueId'];encoded=league+'--'+league.encode().hex()
            base=f"raw/seasons/{season['id'].replace('/','-')}"
            players={};apps=[]
            for row in part['appearances']:
                player={'playerId':row['playerId'],'name':row.get('name'),'imageUrl':row.get('imageUrl')}
                ref=row['playerId']+':'+digest(player)[:16];players[ref]=dict(id=ref,**player)
                apps.append(dict({k:v for k,v in row.items() if k not in ('name','imageUrl')},playerRef=ref))
            matches=[];shots=[];stats=[]
            for row in part['matches']:
                matches.append({k:v for k,v in row.items() if k not in ('shots','stats')})
                shots.extend(dict(s,matchId=row['id']) for s in row.get('shots',[]))
                stats.append({'matchId':row['id'],'values':row.get('stats',[])})
            values={'players':list(players.values()),'performances':apps,'matches':matches,'shots':shots,
                    'team_statistics':stats,'teams':part.get('teams',[]),'competitions':part['competitions'],'fixtures':part.get('fixtures',[])}
            item={'leagueId':league,'meta':part['meta'],'metrics':part['metrics'],'tables':{}}
            for table,rows in values.items():
                item['tables'][table]=write(f'{base}/{table}/{encoded}.json.gz',rows);counts[table]+=len(rows)
            assert restore_part(item)==part, f'Roundtrip mismatch: {chunk["path"]}'
            comparisons+=1;out['chunks'].append(item)
        index['seasons'].append(out)
    write('raw/index.json',index)
    supplemental=read(source/'open_matchday.json');refs=[]
    for c in supplemental['competitions']:
        prefix='raw/seasons/2026-2027';code=c['folder'];refs.append({'folder':code,'name':c['name'],'country_code':c['country_code'],'tables':{}})
        for kind in ('results','fixtures','goals'):
            rows=[dict(row) for row in c[kind]]
            refs[-1]['tables'][kind]=write(f'{prefix}/supplemental_{kind}/{code}.json.gz',rows)
            counts['supplemental_'+kind]+=len(rows)
    write('raw/supplemental-index.json',{'meta':supplemental['meta'],'competitions':refs})
    return {'table_rows':dict(counts),'roundtripped_partitions':comparisons,'seasons':len(index['seasons'])}

def build_observations():
    counts=Counter();lookup={};profiles=defaultdict(list);doc_count=0
    for archive in sorted((DATA/'sources/pitchapi/bundles').iterdir()):
        manifest=read(archive/'manifest.json')
        for bundle in manifest['bundles']:
            path=archive/bundle['path'];body=path.read_bytes()
            assert hashlib.sha256(body).hexdigest()==bundle['sha256'],path
            shard=hashlib.sha256(path.relative_to(DATA).as_posix().encode()).hexdigest()[:24]
            rows=defaultdict(list);documents=[]
            with tarfile.open(path,'r:gz') as tar:
                for member in tar:
                    if not member.isfile():raise ValueError('Unexpected archive member')
                    obj=json.load(tar.extractfile(member));source=path.relative_to(DATA).as_posix()+'!'+member.name
                    if 'endpoints' not in obj:
                        kind=member.name.split('/')[1] if member.name.startswith('profiles/') else 'other'
                        rows['profiles_'+kind].append({'source':source,'observation':obj});continue
                    mid=obj['fixture']['id'];docid=hashlib.sha256(source.encode()).hexdigest()
                    documents.append({'id':docid,'source':source,'metadata':{k:v for k,v in obj.items() if k!='endpoints'},'endpoints':list(obj['endpoints'])})
                    for endpoint,response in obj['endpoints'].items():
                        if not endpoint.replace('_','').isalnum():raise ValueError('Unsafe endpoint name')
                        rows[endpoint].append({'documentId':docid,'matchId':mid,'response':response})
                    doc_count+=1
            if documents:
                season=str(documents[0]['metadata']['season']);label=season if '/' in season else f'{season}/{int(season)+1}'
                base=f'raw/seasons/{label.replace("/","-")}/observations'
            else:base='raw/profiles'
            refs={}
            for table,entries in rows.items():
                refs[table]=write(f'{base}/{table}/{shard}.json.gz',entries);counts[table]+=len(entries)
            if documents:
                docref=write(f'{base}/documents/{shard}.json.gz',documents)
                for i,doc in enumerate(documents):
                    mid=doc['metadata']['fixture']['id'];entry={'documentId':doc['id'],'document':docref,'ordinal':i,'tables':refs,'retrievedAt':doc['metadata'].get('retrieved_at_utc')}
                    lookup.setdefault(mid,[]).append(entry)
            else:profiles[archive.name].append(refs)
        print('Imported observations:',archive.name,'documents',doc_count,flush=True)
    for versions in lookup.values():versions.sort(key=lambda x:x.get('retrievedAt') or '',reverse=True)
    write('raw/match-observations.json',lookup);write('raw/profile-index.json',dict(profiles))
    return {'documents':doc_count,'match_ids':len(lookup),'response_rows':dict(counts)}

def finalize_indexes():
    lookup={};shards={};profiles={};profile_files=[]
    for file in sorted((DATA/'raw/seasons').glob('*/observations/documents/*.gz')):
        docs=read(file);shard=file.name.removesuffix('.json.gz');base=file.parent.parent
        refs={}
        for endpoint in sorted({e for doc in docs for e in doc['endpoints']}):
            target=base/endpoint/file.name
            refs[endpoint]={'path':target.relative_to(DATA).as_posix()}
        shards[shard]={'document':{'path':file.relative_to(DATA).as_posix()},'tables':refs}
        for i,doc in enumerate(docs):
            mid=doc['metadata']['fixture']['id']
            lookup.setdefault(mid,[]).append({'shard':shard,'ordinal':i,'retrievedAt':doc['metadata'].get('retrieved_at_utc')})
    for file in sorted((DATA/'raw/profiles').glob('*/*.gz')):
        profile_files.append(file.relative_to(DATA).as_posix())
        for i,row in enumerate(read(file)):
            obj=row['observation'];value=obj.get('data');kind=file.parent.name.removeprefix('profiles_')
            if obj.get('status') == 200 and isinstance(value,dict) and value.get('id'):
                profiles.setdefault(kind+':'+value['id'],[]).append({'path':file.relative_to(DATA).as_posix(),'ordinal':i,'source':row['source'],'retrievedAt':obj.get('retrieved_at_utc')})
    for versions in lookup.values():versions.sort(key=lambda x:x.get('retrievedAt') or '',reverse=True)
    write('raw/match-observations.json',lookup);write('raw/observation-shards.json',shards)
    for versions in profiles.values():versions.sort(key=lambda x:x.get('retrievedAt') or '')
    write('raw/profile-index.json',{'entities':profiles,'tables':profile_files})

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--tables-only',action='store_true');parser.add_argument('--indexes-only',action='store_true');args=parser.parse_args()
    if args.indexes_only:finalize_indexes();return
    summary=build_tables()
    if not args.tables_only:
        summary['observations']=build_observations();finalize_indexes()
    write('raw/import-summary.json',summary)
    print(json.dumps(summary),flush=True)

if __name__=='__main__':main()
