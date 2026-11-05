#!/usr/bin/env python3
"""Owned full archive HTTP workflows; authored before the archive reader."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
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

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'docs/verification/orion-pro-archives-20261105'
PRODUCT=ROOT/'dashboard/backend/services/orion-pro-archives.js'
COMP=ROOT/'tests/orion_pro_competitions_local.py'
COMP_SHA='65b0a91252c566a47dbdc15e39e6c537f9c143406e9947a8827902916ca30dde'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert sha(COMP)==COMP_SHA,'Previously qualified owned runtime differs'
spec=importlib.util.spec_from_file_location('archive_owned_runtime',COMP)
owned=importlib.util.module_from_spec(spec);spec.loader.exec_module(owned)
# Test-process context only. No on-disk change to the frozen competition runner.
owned.BASE=BASE;owned.PRODUCT=PRODUCT
Runtime,BOUNDS,NODE,PG,save=owned.Runtime,owned.BOUNDS,owned.NODE,owned.PG,owned.save
SEASON='2026/2027'
def url(path,**params):
    qs=urlencode({k:v for k,v in params.items() if v is not None});return '/api/'+path+('?' +qs if qs else '')
PATHS=[url('archives/index',kind='results'),url('archives/season',kind='results',season=SEASON),url('supplemental'),url('archive/matches/m_000001')]

def inputs():
    manifest=owned.inputs();paths=[Path(__file__).resolve(),ROOT/'docs/verification/orion-pro-competitions-20261105/fixture.py',ROOT/'docs/verification/orion-pro-competitions-20261105/http_server.mjs']
    roots=['archive.js','openfootball-history.js','format.js','remote-match.js','football-client.js']
    todo=[ROOT/'dashboard/frontend/src/services'/p for p in roots];seen=set()
    while todo:
        p=todo.pop().resolve()
        if p in seen:continue
        assert p.is_file() and p.is_relative_to(ROOT);seen.add(p)
        for ref in re.findall(r'''(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']''',p.read_text()):todo.append(p.parent/ref)
    manifest.update({str(p.relative_to(ROOT)):sha(p) for p in set(paths)|seen})
    return dict(sorted(manifest.items()))

def token_map(c):return {e['leagueId']:e['representationToken'] for e in c.ok(c.http('/api/dashboard/manifest'))['editions']}
def actual_consumers(c,mode):
    paths={'resultsIndex':PATHS[0],'results':PATHS[1],'goalsIndex':url('archives/index',kind='goals'),
           'goals':url('archives/season',kind='goals',season=SEASON),'supplemental':PATHS[2],'point':PATHS[3]}
    wire={name:next(r['body'] for r in c.report['requests'] if r['path']==paths[name] and r['method']=='GET' and r['status']==200)
          for name in c.values}
    p=c.run/('consumer-'+mode+'.json');save(p,wire)
    r=c.command([c.args.node24,BASE/'consumer_oracle.mjs',p,mode],'consumers-'+mode)
    return json.loads(r.stdout)

def A00(c):
    assert c.ready['node'].startswith('v24.') and len(c.ready['calibration'])==8
    assert c.ready['identity']=={'role':'statarena_runtime','readonly':'on','statement':'8s','locks':'1s','idle':'5s','ssl':True}
def A01(c):
    for p in PATHS:c.fail(c.http(p,headers={'If-None-Match':'*'}),503)
def A02(c):
    for p in ['/api/archives/index','/api/archives/index?kind=no','/api/archives/index?kind=goals&kind=results','/api/archives/season?kind=results&season=../x','/api/archives/season?kind=goals','/api/supplemental?season=2026','/api/archive/matches/m_bad','/api/archive/matches/m_000001?v=pro1.9223372036854775808.'+'a'*64]:
        r=c.http(p);c.fail(r,400);assert not r['sql']
    r=c.http(PATHS[0],method='POST');c.fail(r,405);assert not r['sql']
    r=c.http('/api/archives/other');assert r['status']==501 and not r['sql']
def A03(c):
    c.report['typedBase']=c.fixture.prepare_competitions()
    for p in PATHS:c.fail(c.http(p,headers={'If-None-Match':'*'}),503)
def A04(c):
    c.report['archiveFixture']=c.fixture.prepare_archive();c.tokens=token_map(c);c.old=c.tokens['l_000001']
    c.values['resultsIndex']=x=c.ok(c.http(PATHS[0]));assert x['seasons']==[{'id':SEASON,'competitions':1,'matches':3,'results':2,'unplayed':1,'unverifiedDates':1}]
    assert x['source']['license']=='fixture-archive-license' and 'path' not in json.dumps(x) and 'sha256' not in json.dumps(x)
    c.frozen_paths=[url('dashboard/manifest',v=c.old),url('matches/m_000001/summary',v=c.old),url('fixtures',league='l_000001',season=SEASON,limit=2,v=c.old),url('pitchapi/matches/m_000001/shots',v=c.old)]
    c.frozen=[c.http(p) for p in c.frozen_paths];assert all(r['status']==200 for r in c.frozen)
def A05(c):
    c.values['results']=x=c.ok(c.http(PATHS[1]));assert len(x['competitions'])==1
    raw=next(m for m in x['competitions'][0]['matches'] if m['id']=='m_000002');c.raw_match=raw
    fields=raw['sourceFields'];assert fields['Date']=='8 Nov 2026 (source)' and fields['Venue']=='Observed venue' and fields['attendance']=='0 (source)' and fields['Comments']=='Original observation note'
    assert 'FT' not in fields and 'neutral' not in fields and raw['dateNote']=='Approximate source date' and raw['date']=='2026-11-08'
    c.old_result=c.http(url('archives/season',kind='results',season=SEASON,v=c.old));c.ok(c.old_result)
def A06(c):
    assert c.raw_match['score']=={'ft':[1,0],'et':[1,0],'p':[3,4],'final':[1,0]}
    pending=next(m for m in c.values['results']['competitions'][0]['matches'] if m['id']=='m_000003')
    assert pending['status']=='not_played' and pending['date'] is None and 'ft' not in pending.get('score',{}) and pending['scoreState']=='absent'
def A07(c):
    c.values['goalsIndex']=x=c.ok(c.http(url('archives/index',kind='goals')))
    v=x['seasons'][0];assert len(x['seasons'])==1 and (v['id'],v['competitions'],v['matches'],v['events'],v['latestEvent'])==(SEASON,3,3,4,'2026-11-08')
def A08(c):
    c.values['goals']=x=c.ok(c.http(url('archives/season',kind='goals',season=SEASON)))
    a=next(p for p in x['competitions'] if p['id']=='l_000001')['events']
    assert [e['minute'] for e in a]==['12','45+1','13'] and [e['player'] for e in a]==['Observed striker','Observed striker',None]
    assert a[-1]['isOwnGoal'] is True and a[-1]['score']==[1,0] and sum(len(p['events']) for p in x['competitions'])==4
def A09(c):c.report['listConsumers']=actual_consumers(c,'lists')
def A10(c):
    c.values['supplemental']=x=c.ok(c.http(PATHS[2]));c.supp_before=c.http(PATHS[2]);assert 'meta' in x and len(x['competitions'])==1
    p=x['competitions'][0];assert p['folder']=='nations-league' and len(p['results'])==2 and p['fixtures']==[] and p['goals']==[]
    assert p['coverage']['goals']=='empty'
def A11(c):
    r=c.http(PATHS[3]);c.values['point']=x=c.ok(r)
    assert r['headers']['x-orion-representation']==c.old and x['fixture']['id']=='m_000001' and x['competition_id']=='l_000001'
    assert x['endpoints']['match']['status']==200 and x['endpoints']['shots']['status']==200
    assert x['endpoints']['events']['status']==503 and x['endpoints']['events']['state']=='unsupported_projection'
    assert x['endpoints']['events']['coverageState']=='present' and x['completeOriginalArchive'] is False
def A12(c):c.report['allConsumers']=actual_consumers(c,'full')
def A13(c):
    x=c.ok(c.http(url('archives/season',kind='goals',season=SEASON,v=c.tokens['l_000003'])))
    assert len(x['competitions'])==1 and x['competitions'][0]['events']==[] and x['competitions'][0]['coverageState']=='empty'
    i=c.ok(c.http(url('archives/index',kind='goals',v=c.tokens['l_000003'])));assert i['seasons'][0]['events']==0
def A14(c):
    c.report['unbound']=c.fixture.unbound();v=token_map(c)['l_000003']
    c.fail(c.http(url('archives/season',kind='results',season=SEASON,v=v),headers={'If-None-Match':'*'}),503)
    assert c.ok(c.http(PATHS[1]))==c.values['results']
def A15(c):
    c.fail(c.http('/api/archive/matches/m_999999'),404)
    c.fail(c.http(url('archive/matches/m_000001',v=c.tokens['l_000002'])),404)
    c.fail(c.http(url('archive/matches/m_000001',v=c.old[:-64]+'0'*64)),400)
    c.fail(c.http('/api/archive/matches/m_000002'),503)
    c.fail(c.http(url('archives/season',kind='results',season='1900')),404)
def A16(c):
    c.baselines={}
    for p in PATHS:
        r=c.http(p);c.ok(r);c.baselines[p]=r;tag=r['headers']['etag']
        for method,headers,status in [('HEAD',{},200),('GET',{'If-None-Match':tag},304)]:
            q=c.http(p,method=method,headers=headers);assert (q['status'],q['body'],q['headers']['etag'])==(status,'',tag)
            assert len(q['sql'])<=2 and all('orion:archive' in s['sql'] and 'body' not in s['sql'].split('*/',1)[0] for s in q['sql'])
def A17(c):
    c.report['correction']=c.fixture.correction_archive();r=c.http(PATHS[1]);x=c.ok(r)
    assert r['headers']['etag']!=c.baselines[PATHS[1]]['headers']['etag'] and any(m['sourceFields'].get('Comments')=='Corrected observed note' for m in x['competitions'][0]['matches'])
    c.corrected_tag=r['headers']['etag'];old=c.http(url('archives/season',kind='results',season=SEASON,v=c.old))
    assert (old['body'],old['headers']['etag'])==(c.old_result['body'],c.old_result['headers']['etag'])
    b=c.http(PATHS[2]);assert (b['body'],b['headers']['etag'])==(c.supp_before['body'],c.supp_before['headers']['etag'])
def A18(c):
    c.report['ambiguity']=c.fixture.correction_archive('ambiguous')
    c.fail(c.http(PATHS[1],headers={'If-None-Match':c.corrected_tag}),503)
    c.fail(c.http(PATHS[1],method='HEAD'),503)
def A19(c):
    before=c.native_state();save(c.run/'native-invalid-before.json',before)
    try:c.fixture.invalid_native_count()
    except c.psycopg.Error as exc:
        assert exc.sqlstate=='23514' and 'Collection child count differs' in exc.diag.message_primary,str(exc)
        c.report['nativeSealRejection']={'sqlstate':exc.sqlstate,'message':exc.diag.message_primary}
    else:raise AssertionError('Native count validation accepted a partial family')
    after=c.native_state();save(c.run/'native-invalid-after.json',after);assert before['tables']==after['tables']
    changed={n for n,v in before['sequences'].items() if v!=after['sequences'][n]};assert changed=={'ingest.commit_generation_seq','ingest.dataset_snapshots_id_seq'},changed
    for n in changed:assert after['sequences'][n]==(before['sequences'][n][0]+1,True)
def A20(c):
    c.report['oversize']=c.fixture.correction_archive('large');c.fail(c.http(PATHS[1]),413)
    c.report['rowStress']='Unverified: 10001 matches or 20001 goals exceed this physical fixture allocation; exercised exact count and oversize source field rejection.'
def A21(c):
    before=c.native_state();save(c.run/'native-read-before.json',before)
    for path,expected in zip(c.frozen_paths,c.frozen):
        r=c.http(path);assert (r['status'],r['body'],r['headers']['etag'])==(200,expected['body'],expected['headers']['etag'])
    path=url('archive/matches/m_000001',v=c.old);r=c.http(path);c.ok(r);assert c.http(path,headers={'If-None-Match':r['headers']['etag']})['status']==304
    with c.connect('statarena_runtime') as db:
        try:db.execute("INSERT INTO football.players(display_name) VALUES('forbidden')")
        except c.psycopg.Error as exc:assert exc.sqlstate in {'25006','42501'};c.report['readOnlySqlstate']=exc.sqlstate
        else:raise AssertionError('Ordinary runtime wrote')
    after=c.native_state();save(c.run/'native-read-after.json',after);assert before==after
def A22(c):
    endpoints=c.values['point']['endpoints'];assert endpoints['events']['coverageState']=='present' and endpoints['lineups']['state']=='not_collected'
    assert 'data' not in endpoints['events'] and 'data' not in endpoints['lineups']
    assert c.traces()['attempts']==[] and all('statarena_app.' not in q['sql'] for r in c.report['requests'] for q in r['sql'])
def A23(c):
    assert inputs()==c.report['inputHashes'] and len(c.traces()['calibration'])==8
    c.report['inputsUnchanged']=True

CASES=[A00,A01,A02,A03,A04,A05,A06,A07,A08,A09,A10,A11,A12,A13,A14,A15,A16,A17,A18,A19,A20,A21,A22,A23]

def main():
    p=argparse.ArgumentParser(description=__doc__);m=p.add_mutually_exclusive_group();m.add_argument('--precode-red',action='store_true');m.add_argument('--run-owned',action='store_true');m.add_argument('--manifest',action='store_true')
    p.add_argument('--release',type=Path);p.add_argument('--release-sha256');p.add_argument('--node24',type=Path,default=NODE);p.add_argument('--pg-bin',type=Path,default=PG);p.add_argument('--actual-app',action='store_true');p.add_argument('--label',default='archives');args=p.parse_args()
    assert [f.__name__ for f in CASES]==[f'A{i:02d}' for i in range(24)]
    if args.manifest:print(json.dumps(inputs(),indent=2));return 0
    if not args.run_owned and not args.precode_red:
        print(json.dumps({'kind':'archive_e2e_offline_inventory','caseFunctions':24,'productPresent':PRODUCT.exists(),'pgStarts':0,'sourceCalls':0,'bounds':BOUNDS}));return 0
    assert re.fullmatch('[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label)
    manifest=inputs();release=None
    if args.run_owned:
        assert PRODUCT.is_file() and args.release and args.release.is_absolute() and args.release.is_relative_to(BASE) and sha(args.release)==args.release_sha256
        release=json.loads(args.release.read_text());assert set(release)=={'kind','scope','allocationId','inputHashes','bounds','ownedBaseCommit','expiresAt','actualApp'}
        assert release['kind']=='archive_owned_e2e_release_v1' and release['scope']=='owned_source_free_only' and release['inputHashes']==manifest and release['bounds']==BOUNDS and release['actualApp'] is args.actual_app
        assert datetime.now(timezone.utc)<datetime.fromisoformat(release['expiresAt']) and re.fullmatch('[a-f0-9]{40}',release['ownedBaseCommit']) and re.fullmatch('[A-Za-z0-9-]{1,80}',release['allocationId'])
        assert not any(k.startswith('PG') for k in os.environ)
        consumed=BASE/(release['allocationId']+'.consumed.json');assert not consumed.exists()
    started=time.monotonic();stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');run=BASE/'runs'/(stamp+'-'+args.label);(run/'inputs').mkdir(parents=True)
    report={'kind':'typed_archives_e2e_v1','command':[sys.executable,*sys.argv],'expected':'FAILURE_MATRIX.json A00-A23 authored before product','inputHashes':manifest,'bounds':BOUNDS,'sourceCalls':0,'cloudCalls':0,'cases':[],'requests':[],'actualApp':args.actual_app}
    for name,digest in manifest.items():
        dst=run/'inputs'/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,dst);assert sha(dst)==digest
    if args.precode_red:
        assert not PRODUCT.exists()
        argv=[str(args.node24),'--input-type=module','-e','await import('+json.dumps(PRODUCT.as_uri())+')'];r=subprocess.run(argv,env={'PATH':'/usr/bin:/bin'},capture_output=True,text=True,timeout=10)
        (run/'node.stderr.log').write_text(r.stderr);(run/'node.stdout.log').write_text(r.stdout)
        assert r.returncode!=0 and 'ERR_MODULE_NOT_FOUND' in r.stderr and PRODUCT.name in r.stderr
        report.update(status='expected_precode_red',nodeCommand=argv,nodeExit=r.returncode,pgStarts=0,cleanup={'noOwnedServicesStarted':True},cases=[{'id':f.__name__,'status':'unverified'} for f in CASES]);save(run/'result.json',report)
        print(json.dumps({'status':report['status'],'receipt':str(run/'result.json'),'sha256':sha(run/'result.json')}));return 1
    save(consumed,{'releaseSha256':args.release_sha256,'run':str(run.relative_to(ROOT))});shutil.copyfile(args.release,run/'release.json')
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
        try:report['cleanup']=c.close()
        except Exception as exc:report['cleanup']={'failure':str(exc)};failure=failure or {'error':'Cleanup: '+str(exc)}
        report['commands']=c.commands
        if hasattr(c,'budget'):report['budget']=c.budget.read()
        report['cases'] += [{'id':f.__name__,'status':'unverified'} for f in CASES if f.__name__ not in {x['id'] for x in report['cases']}]
        report.update(status='fail' if failure else 'pass',failure=failure,elapsedSeconds=round(time.monotonic()-started,3))
        report['summary']={s:sum(x['status']==s for x in report['cases']) for s in ('pass','fail','unverified')};save(run/'result.json',report)
    print(json.dumps({'status':report['status'],'summary':report['summary'],'receipt':str(run/'result.json'),'sha256':sha(run/'result.json'),'cleanup':report['cleanup']}));return int(bool(failure))

if __name__=='__main__':raise SystemExit(main())
