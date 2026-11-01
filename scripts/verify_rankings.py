#!/usr/bin/env python3
"""Reconcile every ranking edition against the downloaded source records."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def read(p):return json.loads(p.read_text())

def main():
    index=read(ROOT/'data/raw/rankings/index.json');summary={'setup':'Completed collect_rankings.py run, downloaded source responses and normalized JSON tables. No network or credentials needed.','command':'python3 scripts/verify_rankings.py','expected':'All FIFA catalogue editions since 2022, both UEFA overall rankings for every season-end year, SportsAPI source rows and coefficients reconcile; no secret in public assets.','status':'failed'}
    try:
        assert not index['errors'];counts={};nulls=0
        for ref in index['editions']:
            p=ROOT/'data'/ref['path'];assert hashlib.sha256(p.read_bytes()).hexdigest()==ref['sha256']
            table=read(p);rows=table['rows'];assert len(rows)==ref['rows'] and rows
            if ref['provider']=='UEFA':
                typ='MEN_CLUB' if ref['kind']=='uefa-clubs' else 'MEN_ASSOCIATION'
                pages=sorted((ROOT/'data/sources/rankings/uefa'/ref['edition'][:4]).glob(typ+'-*.json'),key=lambda p:int(p.stem.rsplit('-',1)[1]))
                native=[r for page in pages for r in read(page)['data']['members']]
                assert [r['sourceRow'] for r in rows]==native
                assert len(native)==int(read(pages[0])['meta']['collection']['totalElements'])
            elif ref['provider']=='FIFA':
                date=ref['edition'][:10];native=read(ROOT/'data/sources/rankings/fifa'/(date+'.json'))
                if native.get('rankings'):assert [r['sourceRow'] for r in rows]==native['rankings']
                else:assert [r['sourceRow']['nativeRow'] for r in rows]==read(ROOT/'data/sources/rankings/fifa'/(date+'.schedule.json'))['Results']
            else:
                kind='uefa-countries' if ref['kind']=='uefa-associations' else ref['kind']
                native=read(ROOT/'data/sources/rankings/sportsapi'/ref['edition'][:10]/(kind+'.json'))
                assert [r['sourceRow'] for r in rows]==native['data']
            for row in rows:
                src=row['sourceRow'];assert row['entityName']
                if ref['provider']=='UEFA':
                    rank=src['overallRanking'];assert row['points']==rank.get('totalValue',rank.get('totalPoints')) and row['position']==rank['position'];assert row['entityId']=='uefa:'+str(src['member']['id'])
                elif ref['provider']=='FIFA':
                    r=src['rankingItem'];assert row['points']==r['totalPoints'] and row['position']==r['rank'];assert row['entityId']=='fifa:'+str(r['idTeam'])
                else:assert row['position']==src['position'] and row['points']==src['points']
                nulls+=row['position'] is None
            counts[ref['provider']+':'+ref['kind']]=counts.get(ref['provider']+':'+ref['kind'],0)+len(rows)
            if ref['provider']!='SportsAPI':assert len({r['entityId'] for r in rows})==len(rows)
        assert sum(e['provider']=='FIFA' for e in index['editions'])==index['fifaCatalogueDates']==32
        for kind in ('uefa-clubs','uefa-associations'):
            assert {e['edition'] for e in index['editions'] if e['kind']==kind and e['provider']=='UEFA'}=={str(y)+'.uefa' for y in range(2022,2028)}
        mappings=read(ROOT/'data/raw/rankings/club-links.json');assert not mappings['ambiguous']
        official=[read(ROOT/'data'/e['path']) for e in index['editions'] if e['kind']=='uefa-clubs' and e['provider']=='UEFA']
        for link in mappings['links'].values():
            candidates=[r for t in official for r in t['rows'] if r['entityId']==link['entityId']]
            assert candidates and all(r['countryCode']==link['countryCode'] for r in candidates)
        key=next(line.split('=',1)[1] for line in (ROOT/'.env').read_text().splitlines() if line.startswith('SPORTSAPI_API_KEY='))
        for base in ('dashboard','data/raw/rankings','dist'):
            for p in (ROOT/base).rglob('*'):
                if p.is_file() and p.suffix in ('.js','.json','.html','.css'):assert key.encode() not in p.read_bytes(),p
        summary.update(status='passed',actual={'editions':len(index['editions']),'source_rows':counts,'unranked_positions_preserved':nulls,'linked_clubs':len(mappings['links']),'unmatched_clubs':len(mappings['unmatched']),'ambiguous_clubs':len(mappings['ambiguous']),'secret_found_in_public_assets':False})
    except Exception as exc:summary['error']=repr(exc);raise
    finally:
        p=ROOT/'outputs/rankings/verification.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
