#!/usr/bin/env python3
"""Pre-code E2E for the five typed enrichment routes; no database by default."""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import traceback
from urllib.parse import urlencode
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'docs/verification/orion-pro-enrichment-20261105'
PRODUCT=ROOT/'dashboard/backend/services/orion-pro-enrichment.js'
COMP=ROOT/'tests/orion_pro_competitions_local.py'
COMP_SHA='65b0a91252c566a47dbdc15e39e6c537f9c143406e9947a8827902916ca30dde'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(COMP)==COMP_SHA,'Previously qualified owned runtime differs'
spec=importlib.util.spec_from_file_location('enrichment_owned_runtime',COMP)
owned=importlib.util.module_from_spec(spec);spec.loader.exec_module(owned)
# Test-process settings; the qualified competition runner stays byte exact.
owned.BASE=BASE;owned.PRODUCT=PRODUCT
BOUNDS,NODE,PG,save=owned.BOUNDS,owned.NODE,owned.PG,owned.save
SEASON='2026/2027'
ALIAS='https://upload.wikimedia.org/wikipedia/commons/a/ab/Fixture_portrait.jpg'
CREDIT='https://commons.wikimedia.org/wiki/File:Fixture_portrait.jpg'
HONOUR_URL='https://en.wikipedia.org/w/index.php?title=Fixture_player&oldid=1234567890#Honours'
FETCHED='2026-11-04T17:00:00.000000Z'
def url(path,**params):
    qs=urlencode({k:v for k,v in params.items() if v is not None});return '/api/'+path+('?' +qs if qs else '')
CLUB=url('club-wikidata',uefa='0000012345')
PORTRAIT=url('coach-portrait',name='Alex Fixture')
STADIUM=url('stadium',id='Q301')
PARTIAL_STADIUM=url('stadium',id='Q302')
HONOURS=url('player-honours',id='p_000001')
LINKS=url('club-links',club='t_000001')
ASSET=url('assets',url=ALIAS)
PATHS=[CLUB,PORTRAIT,STADIUM,HONOURS,LINKS]

class DoNotFollow(HTTPRedirectHandler):
    def redirect_request(self,*_args,**_kwargs):return None

class Runtime(owned.Runtime):
    def __init__(self,*args):
        super().__init__(*args)
        self.opener=build_opener(ProxyHandler({}),DoNotFollow())

def inputs():
    manifest=owned.inputs()
    todo=[ROOT/'dashboard/frontend/src/services'/p for p in ('club-facts.js','player-honours.js','format.js')]
    seen={Path(__file__).resolve(),COMP,ROOT/'docs/verification/orion-pro-competitions-20261105/fixture.py',
          ROOT/'docs/verification/orion-pro-archives-20261105/http_server.mjs',
          ROOT/'dashboard/scripts/player_honours.py',ROOT/'dashboard/backend/services/support-model.json'}
    while todo:
        p=todo.pop().resolve()
        if p in seen:continue
        assert p.is_file() and p.is_relative_to(ROOT);seen.add(p)
        for ref in re.findall(r'''(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']''',p.read_text()):todo.append(p.parent/ref)
    manifest.update({str(p.relative_to(ROOT)):sha(p) for p in seen})
    return dict(sorted(manifest.items()))

def token(c,league='l_000001'):
    return next(e['representationToken'] for e in c.ok(c.http('/api/dashboard/manifest'))['editions'] if e['leagueId']==league)

def same(a,b):
    assert (a['status'],a['body'],a['headers']['etag'])==(b['status'],b['body'],b['headers']['etag'])

def P00(c):
    assert c.ready['node'].startswith('v24.') and len(c.ready['calibration'])==8
    assert c.ready['identity']=={'role':'statarena_runtime','readonly':'on','statement':'8s','locks':'1s','idle':'5s','ssl':True}
def P01(c):
    for path in PATHS:c.fail(c.http(path,headers={'If-None-Match':'*'}),503)
def P02(c):
    for path in ('/api/club-wikidata','/api/club-wikidata?uefa=123&name=Club&country=FRA',
        '/api/club-wikidata?uefa=123&uefa=123','/api/club-wikidata?name=Club',
        '/api/club-wikidata?name=Club&country=','/api/club-wikidata?uefa=%2B123',
        '/api/coach-portrait?name=%20','/api/stadium?id=q301','/api/player-honours?id=p_bad',
        '/api/club-links?club=t_000001&extra=1','/api/stadium?id=Q301&v=pro1.9223372036854775808.'+'a'*64):
        r=c.http(path);c.fail(r,400);assert not r['sql']
    r=c.http(CLUB,method='POST');c.fail(r,405);assert not r['sql'] and r['headers']['allow']=='GET, HEAD'
    r=c.http('/api/enrichment/other');assert r['status']==501 and not r['sql']
def P03(c):
    c.report['sportingBase']=c.fixture.prepare_competitions()
    c.original=token(c);c.report['enrichmentFixture']=c.fixture.prepare_enrichment()
    for path in PATHS:c.fail(c.http(path),503)
    c.fail(c.http(url('stadium',id='Q301',v=c.original)),404)
    bad=c.original[:-1]+('1' if c.original[-1]=='0' else '0')
    c.fail(c.http(url('stadium',id='Q301',v=bad)),400)
    c.fail(c.http(url('stadium',id='Q301',v='pro1.9223372036854775807.'+'0'*64)),503)
    try:
        with c.db.transaction():
            draft=c.fixture._begin('draft_catalogue_attempt')
            c.db.execute("INSERT INTO analytics.catalog_publication SELECT true,id,'summary-v1-shots-v1',CURRENT_TIMESTAMP FROM ingest.dataset_snapshots WHERE generation=%s",(draft,))
    except c.psycopg.Error as exc:
        assert exc.sqlstate=='23514' and 'requires a sealed snapshot' in exc.diag.message_primary
        c.report['nativeDraftRejection']={'sqlstate':exc.sqlstate,'message':exc.diag.message_primary}
    else:raise AssertionError('Native catalogue guard accepted a draft')
    c.report['publishedCatalogue']=c.fixture.publish_catalogue(c.fixture.enrichment_gen)
    c.old=token(c)
    assert c.old!=c.original
    c.v1_paths=[url('dashboard/manifest',v=c.old),url('matches/m_000001/summary',v=c.old),
        url('fixtures',league='l_000001',season=SEASON,limit=2,v=c.old),url('pitchapi/matches/m_000001/shots',v=c.old)]
    c.v1_baseline=[c.http(p) for p in c.v1_paths];assert all(r['status']==200 for r in c.v1_baseline)
def P04(c):
    c.values['club']=x=c.ok(c.http(CLUB))
    assert x['available'] is True and (x['id'],x['name'],x['founded'],x['source'])==('Q101','Étoile Fixture','1899','wikidata')
    assert x['sourceUrl']=='https://www.wikidata.org/entity/Q101' and x['fetchedAt']==FETCHED
    assert x['stadium'] is x['stadiumAlias'] is x['stadiumId'] is None and x['coverage']['homeVenue']=='unrecorded'
    c.fail(c.http(url('club-wikidata',uefa='12345')),404)
def P05(c):
    for name,country in (('e\u0301toile fixture','fra'),('Club de l’Étoile','France'),('Étoile Fixture','FR')):
        x=c.ok(c.http(url('club-wikidata',name=name,country=country)));assert x['id']=='Q101' and x['founded']=='1899'
    for name,country in (('Étoile Fixture','DEU'),('Étoile','FRA'),('Etoile Fixture','FRA')):
        c.fail(c.http(url('club-wikidata',name=name,country=country)),404)
def P06(c):
    x=c.values['club'];assert (x['coach']['id'],x['coach']['name'],x['coverage']['coach'])==('Q201','Alex Fixture','known')
    assert x['coach']['validFrom']=='2026-10-01' and x['coach']['validTo']=='2026-11-05'
def P07(c):
    x=c.ok(c.http(url('club-wikidata',uefa='12346')))
    assert x['founded']=='1901' and x['coach'] is None and x['coverage']['coach']=='unverified_validity'
def P08(c):
    c.values['portrait']=x=c.ok(c.http(PORTRAIT))
    assert x['id']=='Q201' and x['name']=='Alex Fixture' and x['coverage']['photo']=='known'
    assert x['photo']=={'url':ALIAS,'author':'Fixture Photographer','license':'CC BY-SA 4.0','sourceUrl':CREDIT}
    assert x['photo']==c.values['club']['coach']['photo']
def P09(c):
    for method in ('GET','HEAD'):
        r=c.http(ASSET,method=method)
        assert r['status']==307 and r['body']=='' and r['headers']['location']=='https://media.fixture.invalid/data/raw/neon/assets/'+'a'*64+'.jpg'
        assert r['headers']['x-data-source']=='AWS' and len(r['sql'])==1 and '/*orion:assetmeta*/' in r['sql'][0]['sql']
    c.report['externalRedirectsFollowed']=0
def P10(c):
    c.fail(c.http(url('coach-portrait',name='Alex')),404)
    for name in ('Same Coach','Bad Media Coach'):
        c.fail(c.http(url('coach-portrait',name=name),headers={'If-None-Match':'*'}),503)
    x=c.ok(c.http(url('coach-portrait',name='Assistant Fixture')))
    assert x['id']=='Q202' and x['photo'] is None and x['coverage']['photo']=='unrecorded'
def P11(c):
    x=c.ok(c.http(STADIUM));c.values['stadium']=x
    assert (x['id'],x['name'],x['capacity'],x['capacityAsOf'],x['opened'])==('Q301','Fixture Stadium',0,'2024-02-29','1910')
    assert x['sourceUrl']=='https://www.wikidata.org/wiki/Q301' and x['fetchedAt']==FETCHED
    assert x['coordinates']=={'lat':0,'lon':0} and x['created'] is x['plans'] is None
    assert x['coverage']['coordinates']=='known' and x['coverage']['plans']==x['coverage']['created']=='unrecorded'
def P12(c):
    c.partial=c.http(PARTIAL_STADIUM);x=c.ok(c.partial)
    assert x['capacity'] is x['coordinates'] is None and x['coordinateObservation']=={'lat':Decimal('46.4'),'lon':None}
    assert x['coverage']['coordinates']=='partial'
    assert x['sourceUrl'] is None
    c.fail(c.http(url('stadium',id='Q999')),404)
def P13(c):
    c.values['links']=x=c.ok(c.http(LINKS))
    assert x['links']=={'t_000001':{'entityId':'uefa:0000012345','clubName':'UEFA Fixture Club','countryCode':'FRA','rankingName':None,'method':'typed-source-id'}}
    c.fail(c.http(url('club-links',club='t_999999')),404)
    c.fail(c.http(url('club-links',club='t_000003')),503)
def P14(c):
    c.values['honours']=x=c.ok(c.http(HONOURS))
    assert x['available'] is True and x['source']=='Wikipédia' and x['sourceUrl']==HONOUR_URL
    assert x['fetchedAt']==FETCHED and x['revision']==1234567890
    assert x['honours']==[
        {'category':'team','team':'Étoile Fixture','name':'UEFA Champions League','seasons':['2023/2024','2024/2025'],'unlabelledCount':1,'editionCount':3},
        {'category':'individual','team':None,'name':"Ballon d'Or",'seasons':['2025'],'unlabelledCount':0,'editionCount':1},
    ]
def P15(c):
    paths=[LINKS,CLUB,url('club-links',club='t_000003'),url('club-wikidata',name='Factual Fixture Club',country='France'),
           HONOURS,url('player-honours',id='p_000002')]
    wire={p:{k:r[k] for k in ('status','body')} for p in paths for r in [c.http(p)]}
    path=c.run/'consumer-wire.json';save(path,wire)
    c.report['consumers']=json.loads(c.command([c.args.node24,BASE/'consumer_oracle.mjs',path],'consumers').stdout)
def P16(c):
    for actor in ('p_000002','p_999999'):
        p=url('player-honours',id=actor)
        r=c.http(p,headers={'If-None-Match':'*'});c.fail(r,404)
        assert not any('orion:enrichmenthonoursbody' in q['sql'] for q in r['sql'])
    r=c.http(url('player-honours',id='p_000003'),headers={'If-None-Match':'*'})
    c.fail(r,503);assert not any('orion:enrichmenthonoursbody' in q['sql'] for q in r['sql'])
def P17(c):
    for path in PATHS:
        g=c.http(path);c.ok(g);tag=g['headers']['etag']
        assert tag.startswith('W/"orion-enrichment1-')
        for method,headers,status in (('HEAD',{},200),('GET',{'If-None-Match':tag},304)):
            r=c.http(path,method=method,headers=headers)
            assert r['status']==status and not r['body'] and r['headers']['etag']==tag
            assert not any('orion:enrichmenthonoursbody' in q['sql'] for q in r['sql'])
        if path==HONOURS:
            assert len(g['sql'])==len(r['sql'])+1 and any('orion:enrichmenthonoursbody' in q['sql'] for q in g['sql'])
    c.fail(c.http(url('coach-portrait',name='Same Coach'),method='HEAD',headers={'If-None-Match':'*'}),503)
def P18(c):
    p=url('stadium',id='Q301',v=c.old);before=c.http(p);assert c.ok(before)['capacity']==0
    c.report['typedCorrection']=c.fixture.correction('capacity');c.current=token(c)
    current=c.http(STADIUM);v=c.ok(current)
    assert (v['capacity'],v['name'])==(50000,'Corrected Fixture Stadium') and current['headers']['etag']!=before['headers']['etag']
    same(before,c.http(p));assert c.ok(c.http(PARTIAL_STADIUM))==c.ok(c.partial)
    assert c.ok(c.http(url('stadium',id='Q301',v=c.current)))==v
def P19(c):
    c.report['ambiguity']=c.fixture.correction('ambiguous')
    for p in (LINKS,url('club-wikidata',name='Étoile Fixture',country='FRA')):
        c.fail(c.http(p,headers={'If-None-Match':'*'}),503)
    x=c.ok(c.http(url('club-wikidata',uefa='12346')))
    assert x['founded']=='1901' and x['coach'] is None and x['coverage']['coach']=='ambiguous'
    assert c.ok(c.http(url('club-wikidata',uefa='0000012345')))['id']=='Q101'
    assert c.ok(c.http(url('club-links',club='t_000001',v=c.old)))==c.values['links']
def P20(c):
    p=url('coach-portrait',name='Alex Fixture',v=c.old)
    before=c.http(p);c.ok(before);c.report['correctedAssetId']=c.fixture.correct_photo_metadata()
    after=c.http(p,headers={'If-None-Match':before['headers']['etag']});assert c.ok(after)['photo']['author']=='Corrected Fixture Credit'
    assert before['headers']['etag']!=after['headers']['etag']
    r=c.http(ASSET);assert r['status']==307 and r['headers']['location']=='https://media.fixture.invalid/data/raw/neon/assets/'+'c'*64+'.jpg'
    c.report['ambiguousAssetId']=c.fixture.add_ambiguous_photo_alias()
    c.fail(c.http(p,headers={'If-None-Match':after['headers']['etag']}),503);c.fail(c.http(ASSET),503)
def P21(c):
    before=c.native_state();save(c.run/'native-read-before.json',before)
    for path,expected in zip(c.v1_paths,c.v1_baseline):same(c.http(path),expected)
    for p in (STADIUM,HONOURS):
        r=c.http(p);c.ok(r);assert c.http(p,headers={'If-None-Match':r['headers']['etag']})['status']==304
    with c.connect('statarena_runtime') as db:
        try:db.execute("INSERT INTO football.players(display_name) VALUES('forbidden')")
        except c.psycopg.Error as exc:
            assert exc.sqlstate in {'25006','42501'};c.report['readOnlySqlstate']=exc.sqlstate
        else:raise AssertionError('Ordinary runtime wrote')
    after=c.native_state();save(c.run/'native-read-after.json',after);assert before==after
def P22(c):
    assert c.traces()['attempts']==[]
    assert all('statarena_app.' not in q['sql'] for r in c.report['requests'] for q in r['sql'])
    assert all(s not in r['body'] for r in c.report['requests'] for s in ('raw/neon/assets','storage_bucket','source_record_id','fixture-source-license'))
    assert c.values['club']['coverage']['homeVenue']=='unrecorded'
    assert c.values['stadium']['opened']=='1910' and c.values['stadium']['coverage']['plans']=='unrecorded'
def P23(c):
    assert inputs()==c.report['inputHashes'] and len(c.traces()['calibration'])==8
    c.report['inputsUnchanged']=True
    actors=Counter(re.findall(r'^\[\d+\] app=([^ ]+) LOG:  (?:statement:|execute )',
        (c.run/'postgres.log').read_text(),re.MULTILINE))
    observed=c.budget.read()['counts']
    assert sum(actors.values())==observed['sql'],(actors,observed)
    assert len(c.report['requests'])==observed['http']
    c.report['serverSqlByActor']=dict(actors)

CASES=[P00,P01,P02,P03,P04,P05,P06,P07,P08,P09,P10,P11,P12,P13,P14,P15,P16,P17,P18,P19,P20,P21,P22,P23]

def main():
    p=argparse.ArgumentParser(description=__doc__);m=p.add_mutually_exclusive_group();m.add_argument('--precode-red',action='store_true');m.add_argument('--run-owned',action='store_true');m.add_argument('--manifest',action='store_true')
    p.add_argument('--release',type=Path);p.add_argument('--release-sha256');p.add_argument('--node24',type=Path,default=NODE);p.add_argument('--pg-bin',type=Path,default=PG);p.add_argument('--actual-app',action='store_true');p.add_argument('--label',default='enrichment');args=p.parse_args()
    assert [f.__name__ for f in CASES]==[x['id'] for x in json.loads((BASE/'FAILURE_MATRIX.json').read_text())['cases']]
    if args.manifest:print(json.dumps(inputs(),indent=2));return 0
    if not args.run_owned and not args.precode_red:
        print(json.dumps({'kind':'enrichment_e2e_offline_inventory','caseFunctions':24,'productPresent':PRODUCT.exists(),'pgStarts':0,'sourceCalls':0,'bounds':BOUNDS}));return 0
    assert re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label)
    manifest=inputs();release=None
    if args.run_owned:
        assert PRODUCT.is_file() and args.release and args.release.is_absolute() and args.release.is_relative_to(BASE) and sha(args.release)==args.release_sha256
        release=json.loads(args.release.read_text());assert set(release)=={'kind','scope','allocationId','inputHashes','bounds','ownedBaseCommit','expiresAt','actualApp'}
        assert release['kind']=='enrichment_owned_e2e_release_v1' and release['scope']=='owned_source_free_only' and release['inputHashes']==manifest and release['bounds']==BOUNDS and release['actualApp'] is args.actual_app
        assert datetime.now(timezone.utc)<datetime.fromisoformat(release['expiresAt']) and re.fullmatch('[a-f0-9]{40}',release['ownedBaseCommit']) and re.fullmatch('[A-Za-z0-9-]{1,80}',release['allocationId'])
        assert not any(k.startswith('PG') for k in os.environ)
        consumed=BASE/(release['allocationId']+'.consumed.json');assert not consumed.exists()
    started=time.monotonic();stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');run=BASE/'runs'/(stamp+'-'+args.label);(run/'inputs').mkdir(parents=True)
    report={'kind':'typed_enrichment_e2e_v1','command':[sys.executable,*sys.argv],'expected':'FAILURE_MATRIX.json P00-P23; initial cases pre-code, attribution extensions before attribution correction','inputHashes':manifest,'bounds':BOUNDS,'sourceCalls':0,'cloudCalls':0,'cases':[],'requests':[],'actualApp':args.actual_app}
    for name,digest in manifest.items():
        dst=run/'inputs'/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,dst);assert sha(dst)==digest
    if args.precode_red:
        assert not PRODUCT.exists()
        argv=[str(args.node24),'--input-type=module','-e','await import('+json.dumps(PRODUCT.as_uri())+')']
        r=subprocess.run(argv,env={'PATH':'/usr/bin:/bin'},capture_output=True,text=True,timeout=10)
        (run/'node.stderr.log').write_text(r.stderr);(run/'node.stdout.log').write_text(r.stdout)
        assert r.returncode!=0 and 'ERR_MODULE_NOT_FOUND' in r.stderr and PRODUCT.name in r.stderr
        report.update(status='expected_precode_red',nodeCommand=argv,nodeExit=r.returncode,pgStarts=0,cleanup={'noOwnedServicesStarted':True},cases=[{'id':f.__name__,'status':'unverified'} for f in CASES]);save(run/'result.json',report)
        print(json.dumps({'status':report['status'],'receipt':str(run/'result.json'),'sha256':sha(run/'result.json')}));return 1
    with consumed.open('x') as f:f.write(json.dumps({'releaseSha256':args.release_sha256,'run':str(run.relative_to(ROOT))})+'\n')
    shutil.copyfile(args.release,run/'release.json')
    c=Runtime(args,run,report);failure=None
    try:
        c.setup(release)
        for f in CASES:
            before=time.monotonic()
            try:f(c);c.resource_check()
            except Exception as exc:report['cases'].append({'id':f.__name__,'status':'fail','error':str(exc),'traceback':traceback.format_exc()});raise
            report['cases'].append({'id':f.__name__,'status':'pass','elapsedMs':round((time.monotonic()-before)*1000,3)})
    except Exception as exc:failure={'error':str(exc),'traceback':traceback.format_exc()}
    finally:
        try:
            report['cleanup']=c.close()
            assert all(report['cleanup'].values())
        except Exception as exc:report['cleanup']={'failure':str(exc)};failure=failure or {'error':'Cleanup: '+str(exc)}
        report['commands']=c.commands
        if hasattr(c,'budget'):report['budget']=c.budget.read()
        report['cases'] += [{'id':f.__name__,'status':'unverified'} for f in CASES if f.__name__ not in {x['id'] for x in report['cases']}]
        report.update(status='fail' if failure else 'pass',failure=failure,elapsedSeconds=round(time.monotonic()-started,3))
        report['summary']={s:sum(x['status']==s for x in report['cases']) for s in ('pass','fail','unverified')};save(run/'result.json',report)
    print(json.dumps({'status':report['status'],'summary':report['summary'],'receipt':str(run/'result.json'),'sha256':sha(run/'result.json'),'cleanup':report['cleanup']}));return int(bool(failure))

if __name__=='__main__':raise SystemExit(main())
