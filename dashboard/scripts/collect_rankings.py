#!/usr/bin/env python3
"""Collect dated FIFA/UEFA rankings and SportsAPI snapshots into the JSON DB."""
import argparse, concurrent.futures, hashlib, json, math, re, time, unicodedata, urllib.error, urllib.parse, urllib.request
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
RAW=ROOT/'data/raw/rankings';SOURCES=ROOT/'data/sources/rankings'

def save(p,obj):
    p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n');tmp.replace(p)

def fetch(url,path,key=None,refresh=False):
    if path.exists() and not refresh:return json.loads(path.read_text())
    headers={'User-Agent':'Mozilla/5.0','Accept':'application/json'}
    if key:headers['Authorization']='Bearer '+key
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=25) as r:obj=json.load(r)
            save(path,obj);return obj
        except urllib.error.HTTPError as exc:
            if exc.code not in (429,500,502,503) or attempt==2:raise
            delay=min(30,int(exc.headers.get('Retry-After','2')));time.sleep(delay)
    raise RuntimeError('Collection failed')

def norm(s):return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',s or '').encode('ascii','ignore').decode().lower())

def club_links(editions):
    candidates={};clubs={};countries={}
    import gzip
    index=json.loads((ROOT/'data/raw/index.json').read_text())
    for season in index['seasons']:
        for chunk in season['chunks']:
            def table(name):return json.loads(gzip.decompress((ROOT/'data'/chunk['tables'][name]['path']).read_bytes()))
            country=table('competitions')[0].get('country')
            for t in table('teams'):clubs[t['id']]=t;countries.setdefault(t['id'],set()).add(country)
    for edition in editions:
        if edition['kind']!='uefa-clubs' or edition['provider']!='UEFA':continue
        for row in json.loads((ROOT/'data'/edition['path']).read_text())['rows']:
            original=row['sourceRow']['member'];names=[original.get(k) for k in ('displayName','displayOfficialName','internationalName','displayNameShort')]
            for n in names:
                if n:candidates.setdefault(norm(n),{})[row['entityId']]=row
    # Reviewed spelling variants, no fuzzy or substring identity joins.
    aliases={'Newcastle United':'Newcastle United FC','Nottingham Forest':'Nottingham Forest FC','Slovan Bratislava':'ŠK Slovan Bratislava','PSG':'Paris Saint-Germain','Inter':'Internazionale Milano','Inter Milan':'Internazionale Milano','Manchester City':'Manchester City FC','Manchester United':'Manchester United FC','Tottenham':'Tottenham Hotspur','Bayern München':'Bayern München','Bayern Munich':'Bayern München','Barcelona':'FC Barcelona','Atletico Madrid':'Atlético de Madrid','Atlético Madrid':'Atlético de Madrid','Sporting CP':'Sporting Clube de Portugal','FC Porto':'FC Porto','FC København':'FC København','FCSB':'FCSB','Bodø/Glimt':'Bodø/Glimt'}
    links={};unmatched=[];ambiguous=[]
    for tid,t in clubs.items():
        options=candidates.get(norm(t['name']),{}) or candidates.get(norm(aliases.get(t['name'],'')),{})
        valid={k:v for k,v in options.items() if v.get('countryCode') in countries[tid]}
        if len(valid)==1:
            eid,row=next(iter(valid.items()));links[tid]={'entityId':eid,'clubName':t['name'],'rankingName':row['entityName'],'countryCode':row['countryCode'],'method':'unambiguous-name-and-country' if norm(t['name']) in candidates else 'reviewed-alias-and-country'}
        elif len(valid)>1:ambiguous.append({'clubId':tid,'name':t['name'],'candidates':list(valid)})
        else:unmatched.append({'clubId':tid,'name':t['name']})
    result={'links':links,'unmatched':unmatched,'ambiguous':ambiguous};save(RAW/'club-links.json',result);return {'linked':len(links),'unmatched':len(unmatched),'ambiguous':len(ambiguous)}

def validate(rows, unique=True):
    assert rows,'Empty ranking'
    assert not unique or len({r['entityId'] for r in rows})==len(rows),'Duplicate ranking entity'
    assert all(r['position'] is None or isinstance(r['position'],int) and r['position']>=1 for r in rows),'Invalid rank'
    assert all(r['points'] is None or isinstance(r['points'],(int,float)) and math.isfinite(r['points']) for r in rows)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--from-year',type=int,default=2022);ap.add_argument('--refresh',action='store_true');args=ap.parse_args()
    now=datetime.now(timezone.utc);editions=[];errors=[]
    def emit(kind,edition,provider,source,rows,updated=None,period=None,official=True):
        validate(rows,unique=provider!='SportsAPI');path=RAW/kind/(edition+'.json');obj={'kind':kind,'edition':edition,'provider':provider,'sourceUrl':source,'retrievedAt':now.isoformat(),'sourceUpdatedAt':updated,'period':period,'officialEdition':official,'quality':{'duplicateEntityIds':sorted({r['entityId'] for r in rows if sum(v['entityId']==r['entityId'] for v in rows)>1})},'rows':rows};
        if path.is_file():
            previous=json.loads(path.read_text())
            if previous.get('rows')==rows and previous.get('sourceUpdatedAt')==updated:obj['retrievedAt']=previous['retrievedAt']
        save(path,obj)
        editions.append({k:obj[k] for k in ('kind','edition','provider','sourceUrl','retrievedAt','sourceUpdatedAt','period','officialEdition')}|{'path':path.relative_to(ROOT/'data').as_posix(),'rows':len(rows),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    key=next((l.split('=',1)[1].strip().strip('"\'') for l in (ROOT/'dashboard/.env').read_text().splitlines() if l.startswith('SPORTSAPI_API_KEY=')),None)
    for kind in ('fifa-men','uefa-countries','uefa-clubs'):
        url='https://api.sportsapi.app/v2/rankings/'+kind;p=SOURCES/'sportsapi'/now.date().isoformat()/(kind+'.json')
        prior=ROOT/'dashboard/outputs/rankings'/(kind+'.json')
        if prior.exists() and not p.exists() and not args.refresh:save(p,json.loads(prior.read_text()))
        try:
            body=fetch(url,p,key,args.refresh);rows=[]
            for row in body['data']:
                e=row.get('team') or row.get('country');eid=e.get('id') or e.get('code') or e.get('name');c=row.get('country') or {}
                rows.append({'entityId':'sportsapi:'+str(eid),'entityName':e['name'],'countryCode':c.get('code'),'position':row['position'],'points':row.get('points'),'previousPosition':row.get('previousPosition'),'imageUrl':e.get('image'),'sourceRow':row})
            emit('uefa-associations' if kind=='uefa-countries' else kind,now.date().isoformat()+'.sportsapi','SportsAPI',url,rows,body.get('meta',{}).get('updatedAt'),official=False)
        except Exception as exc:errors.append({'provider':'SportsAPI','kind':kind,'error':type(exc).__name__})
    # FIFA publishes the dated edition catalogue in its official page payload.
    page='https://inside.fifa.com/fifa-rankings/world-ranking/men';htmlpath=SOURCES/'fifa/catalogue.html'
    if not htmlpath.exists() or args.refresh:
        html=urllib.request.urlopen(urllib.request.Request(page,headers={'User-Agent':'Mozilla/5.0'}),timeout=25).read().decode();htmlpath.parent.mkdir(parents=True,exist_ok=True);htmlpath.write_text(html)
    html=htmlpath.read_text();m=re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',html)
    dates=json.loads(m.group(1))['props']['pageProps']['pageData']['ranking']['allAvailableDates'];dates=[d for d in dates if args.from_year<=int(d['date'][:4])<=now.year and d['date']<=now.date().isoformat()]
    for date in dates:
        url='https://inside.fifa.com/api/ranking-overview?'+urllib.parse.urlencode({'locale':'en','dateId':date['id'],'rankingType':'football'})
        try:
            body=fetch(url,SOURCES/'fifa'/(date['date']+'.json'),refresh=args.refresh);rows=[]
            if not body.get('rankings'):
                body=fetch(url,SOURCES/'fifa'/(date['date']+'.json'),refresh=True)
            if not body.get('rankings') and date['id'].startswith('FRS_'):
                url='https://api.fifa.com/api/v3/fifarankings/rankings/rankingsbyschedule?'+urllib.parse.urlencode({'rankingScheduleId':date['id'],'language':'en','count':300})
                native=fetch(url,SOURCES/'fifa'/(date['date']+'.schedule.json'),refresh=args.refresh)
                body={'rankings':[{'rankingItem':{'idTeam':r['IdTeam'],'name':r['TeamName'][0]['Description'],'countryCode':r['IdCountry'],'rank':r['Rank'],'totalPoints':r.get('TotalPoints'),'previousRank':r.get('PrevRank'),'flag':{'src':'https://api.fifa.com/api/v3/picture/flags-sq-2/'+r['IdCountry']}},'tag':{'id':r.get('ConfederationName')},'nativeRow':r} for r in native['Results']]}
            for entry in body['rankings']:
                r=entry['rankingItem'];rows.append({'entityId':'fifa:'+str(r['idTeam']),'entityName':r['name'],'countryCode':r['countryCode'],'position':r['rank'],'points':r.get('totalPoints'),'previousPosition':r.get('previousRank'),'imageUrl':r.get('flag',{}).get('src'),'confederation':entry.get('tag',{}).get('id'),'sourceRow':entry})
            emit('fifa-men',date['date']+'.fifa','FIFA',url,rows,date['date'],date['date']);print('FIFA',date['date'],len(rows),flush=True)
        except Exception as exc:errors.append({'provider':'FIFA','date':date['date'],'error':type(exc).__name__})
    for year in range(args.from_year,now.year+2):
        for kind,typ in [('uefa-clubs','MEN_CLUB'),('uefa-associations','MEN_ASSOCIATION')]:
            native=[];updated=None;urls=[];total=None
            try:
                page_no=1
                while True:
                    url='https://comp.uefa.com/v2/coefficients?'+urllib.parse.urlencode({'coefficientRange':'OVERALL','coefficientType':typ,'language':'EN','page':page_no,'pagesize':50,'seasonYear':year});urls.append(url)
                    body=fetch(url,SOURCES/'uefa'/str(year)/f'{typ}-{page_no}.json',refresh=args.refresh)
                    part=body['data']['members'];native.extend(part);updated=body['data'].get('lastUpdateDate');total=int(body['meta']['collection']['totalElements'])
                    if len(native)>=total:break
                    if not part:raise ValueError('Incomplete UEFA pagination')
                    page_no+=1
                assert len(native)==total
                rows=[]
                for entry in native:
                    e=entry['member'];rank=entry['overallRanking'];rows.append({'entityId':'uefa:'+str(e['id']),'entityName':e['displayName'],'countryCode':e.get('countryCode'),'position':rank['position'],'points':rank.get('totalValue',rank.get('totalPoints')),'earnedPoints':rank.get('totalPoints'),'previousPosition':None,'imageUrl':e.get('logoUrl'),'sourceRow':entry})
                emit(kind,str(year)+'.uefa','UEFA',urls[0],rows,updated,f'{year-1}/{year}');print('UEFA',year,kind,len(rows),flush=True)
            except Exception as exc:errors.append({'provider':'UEFA','year':year,'kind':kind,'error':type(exc).__name__})
    editions.sort(key=lambda x:(x['kind'],x['edition']),reverse=True)
    result={'schemaVersion':1,'requestedFromYear':args.from_year,'retrievedAt':now.isoformat(),'fifaCatalogueDates':len(dates),'editions':editions,'errors':errors,'notes':{'uefa-associations':'Association club coefficients, not national-team strength.','historicalDates':'UEFA period is a season ending year, not a known publication date. SportsAPI updatedAt is a source refresh timestamp, not an official edition date.'}}
    result['clubMapping']=club_links(editions);save(RAW/'index.json',result);save(ROOT/'dashboard/outputs/rankings/collection.json',result)
    print('Editions',len(editions),'errors',errors,'mapping',result['clubMapping'],flush=True)
    return bool(errors)
if __name__=='__main__':raise SystemExit(main())
