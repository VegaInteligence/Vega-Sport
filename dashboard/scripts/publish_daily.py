#!/usr/bin/env python3
"""Normalize only the refreshed archive; preserve every other season verbatim."""
import argparse, hashlib, json, os, tempfile
from collections import defaultdict
from pathlib import Path
import build_json_database as db
from build_season_dashboard import build, season_label
from restore_europe import restore_archive
from bundle_europe import pack_archive

def encode_part(part, label, league):
    players, performances, matches, shots, stats = {}, [], [], [], []
    for row in part['appearances']:
        player={'playerId':row['playerId'],'name':row.get('name'),'imageUrl':row.get('imageUrl')}
        ref=row['playerId']+':'+db.digest(player)[:16]
        players[ref]=dict(id=ref,**player)
        performances.append(dict({k:v for k,v in row.items() if k not in ('name','imageUrl')},playerRef=ref))
    for row in part['matches']:
        matches.append({k:v for k,v in row.items() if k not in ('shots','stats')})
        shots.extend(dict(shot,matchId=row['id']) for shot in row.get('shots',[]))
        stats.append({'matchId':row['id'],'values':row.get('stats',[])})
    tables={'players':list(players.values()),'performances':performances,'matches':matches,'shots':shots,'team_statistics':stats,'teams':part['teams'],'competitions':part['competitions'],'fixtures':part['fixtures']}
    base=f"raw/seasons/{label.replace('/','-')}"; encoded=league+'--'+league.encode().hex()
    item={'leagueId':league,'meta':part['meta'],'metrics':part['metrics'],'tables':{name:db.write(f'{base}/{name}/{encoded}.json.gz',rows) for name,rows in tables.items()}}
    if db.restore_part(item) != part: raise ValueError('Canonical partition roundtrip failed')
    return item

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['restore','publish']);parser.add_argument('--data-root',required=True);parser.add_argument('--archive',required=True);args=parser.parse_args()
    data=Path(args.data_root).resolve();db.DATA=data
    archive=data/'sources/pitchapi/archives'/args.archive
    bundles=data/'sources/pitchapi/bundles'/args.archive
    if args.action=='restore':
        if (bundles/'manifest.json').is_file(): restore_archive(bundles,archive,allowed_archives=(args.archive,))
        archive.mkdir(parents=True,exist_ok=True);return
    inventory=db.read(archive/'inventory.json')
    index=db.read(data/'raw/index.json') if (data/'raw/index.json').exists() else {'schemaVersion':3,'storage':'json-relational','seasons':[]}
    seasons={s['id']:{**s,'chunks':list(s['chunks'])} for s in index['seasons']}
    count=0
    with tempfile.TemporaryDirectory(prefix='orion-normalize-') as temporary:
        for competition in inventory['competitions']:
            label=season_label(competition['season']);league=competition['id'];output=Path(temporary)/(league+'.json')
            issues=build(output,archive=archive,display_season=label,include_inventory_only=True,write_issues=False,competition_id=league)
            if issues: raise ValueError(f'{league}: {len(issues)} normalization failures')
            part=db.read(output)
            # No silent loss of already collected games if a provider inventory shrinks.
            previous=next((c for c in seasons.get(label,{}).get('chunks',[]) if c['leagueId']==league),None)
            if previous:
                old_ids={m['id'] for m in db.restore_part(previous)['matches']}
                listed={m['id'] for m in competition['matches']}
                if old_ids-listed: raise ValueError(f'{league}: inventory dropped collected matches')
            item=encode_part(part,label,league)
            target=seasons.setdefault(label,{'id':label,'chunks':[]})
            target['chunks']=[c for c in target['chunks'] if c['leagueId']!=league]+[item]
            count+=len(part['matches'])
    key=os.environ.get('PITCHAPI_API_KEY','').encode() or None
    pack_archive(archive,bundles,key)
    db.build_observations({args.archive});db.finalize_indexes()
    for season in seasons.values(): season['chunks'].sort(key=lambda c:c['leagueId'],reverse=True)
    receipt=db.read(archive/'daily-receipt.json')
    index.update(defaultSeason=receipt['season'] if receipt['season'] in seasons else max(seasons),seasons=sorted(seasons.values(),key=lambda s:s['id'],reverse=True))
    # Publish the manifest last, only after all source/roundtrip checks pass.
    db.write('raw/index.json',index)
    receipt.update(status='success',normalizedMatches=count)
    db.write('raw/sync.json',receipt)
    print(json.dumps(receipt),flush=True)

if __name__=='__main__':main()
