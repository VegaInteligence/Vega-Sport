#!/usr/bin/env python3
"""Pre-code whole-workflow tests for the eight competition routes.

No PG by default. Owned execution requires a fresh ROOT release with the exact
input manifest and bounds. Synthetic fixtures, actual SQL and Node24 HTTP only.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import traceback
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import build_opener, ProxyHandler, Request

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'docs/verification/orion-pro-competitions-20261105'
MODEL=ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
PRODUCT=ROOT/'dashboard/backend/services/orion-pro-competitions.js'
NODE=Path('/tmp/statarena-node24-runtime/v24.22.2/node-v24.22.2-darwin-arm64/bin/node')
PG=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin')
PILOT=ROOT/'docs/verification/orion-pro-pilot-20261104'
PUBLISHER=ROOT/'docs/verification/orion-pro-publisher-20261105/product-campaign'
BOUNDS={'seconds':600,'sql':15000,'http':200,'typedRows':20000,'ownedDiskBytes':1024**3,'evidenceBytes':96*1024**2,'connections':5,'workers':2}
MIGRATIONS=[('012','012_orion_pro_domain.sql'),('013','013_orion_pro_integrity.sql'),('014','014_orion_pro_membership_nonnull.sql'),('015','015_orion_pro_metric_membership_guard.sql')]
SEASON='2026/2027'

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path, value):Path(path).write_text(json.dumps(value,indent=2,ensure_ascii=False,default=str)+'\n')
def url(name,**params):
    query=urlencode({k:v for k,v in params.items() if v is not None})
    return '/api/'+name+('?' +query if query else '')
ROUTES=[url('standings',competition='l_000001'),url('open-cups',competition='ESP_CUP_fixture',season=SEASON),url('openligadb',competition='ESP_CUP_fixture',season=SEASON),url('nations-results',season=SEASON),url('cup-index',kind='worker'),url('cup-table',competition='ESP_CUP_fixture',season=SEASON,kind='results'),url('cup-snapshot',competition='l_000001',season=SEASON,kind='native'),url('matchdays',competition='l_000001',season=SEASON)]

def inputs():
    paths=[Path(__file__).resolve(),BASE/'PROTOCOL.md',BASE/'FAILURE_MATRIX.json',BASE/'DEPENDENCIES.json',BASE/'fixture.py',BASE/'http_server.mjs',BASE/'consumer_oracle.mjs',MODEL,
           PILOT/'harness.py',PILOT/'fixtures.py',ROOT/'docs/verification/orion-pro-readers-20261104/fixture.py',PUBLISHER/'workflow_budget.py',ROOT/'tests/orion_e2e_process.py',
           *[ROOT/'dashboard/scripts'/n for n in ('orion_pro_migrate.py','orion_pro_schema.py','orion_pro_integrity.py')],
           *[ROOT/'dashboard/backend/migrations'/n for _,n in MIGRATIONS],ROOT/'dashboard/shared/cup-logos.json']
    # Record the actual closed relative import graph, not all provider modules.
    todo=[ROOT/'dashboard/backend/aws-app.js',PRODUCT,*[ROOT/'dashboard/frontend/src/services'/n for n in ('cup-matches.js','knockout-bracket.js','competition-matchdays.js','nations-standings.js','cup-catalog.js')]]
    seen=set()
    while todo:
        p=todo.pop().resolve()
        if p in seen or not p.is_file():continue
        assert p.is_relative_to(ROOT);seen.add(p)
        for ref in re.findall(r'''(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']''',p.read_text()):
            target=(p.parent/ref).resolve();assert target.is_file(),str(target);todo.append(target)
    return {str(p.relative_to(ROOT)):sha(p) for p in sorted(set(paths)|seen)}

def C00(c):
    assert c.ready['node'].startswith('v24.') and c.ready['identity']=={'role':'statarena_runtime','readonly':'on','statement':'8s','locks':'1s','idle':'5s','ssl':True},c.ready
    assert len(c.ready['calibration'])==8
def C01(c):
    for path in ROUTES:c.fail(c.http(path,headers={'If-None-Match':'*'}),503)
def C02(c):
    for path in ['/api/standings','/api/standings?competition=bad','/api/standings?competition=l_000001&competition=l_000002','/api/cup-index?kind=other','/api/cup-snapshot?competition=l_000001&kind=no','/api/cup-table?competition=../../bad&season=2026&kind=results','/api/matchdays?competition=l_000001&season=bad','/api/open-cups?competition=euro&season=2026&upstream=x','/api/openligadb?competition=x&season=2026&v=pro1.9223372036854775808.'+'a'*64]:
        r=c.http(path);c.fail(r,400);assert not r['sql']
    r=c.http(ROUTES[0],method='POST');c.fail(r,405);assert not r['sql']
    r=c.http('/api/cup-not-a-route');assert r['status']==501 and not r['sql']
def C03(c):
    c.report['fixture']=c.fixture.prepare_competitions()
    m=c.ok(c.http('/api/dashboard/manifest'))
    c.tokens={e['leagueId']:e['representationToken'] for e in m['editions']}
    assert set(c.tokens)=={'l_000001','l_000002','l_000003'}
    c.token=c.tokens['l_000001']
    r=c.http(ROUTES[0]);c.ok(r);assert r['headers']['x-orion-representation']==c.token
    c.fail(c.http(url('standings',competition='l_999999')),404)
    c.fail(c.http(url('standings',competition='l_000001',season='1900')),404)
    c.fail(c.http(url('standings',competition='l_000001',v=c.token[:-64]+'0'*64)),400)
    c.fail(c.http(url('standings',competition='l_000002',v=c.token)),404)
    c.frozen_paths=[url('dashboard/manifest',v=c.token),url('matches/m_000001/summary',v=c.token),url('fixtures',league='l_000001',season=SEASON,limit=2,v=c.token),url('pitchapi/matches/m_000001/shots',v=c.token)]
    c.frozen=[c.http(p) for p in c.frozen_paths];assert all(r['status']==200 for r in c.frozen)
def C04(c):c.fail(c.http(url('standings',competition='l_000002'),headers={'If-None-Match':'*'}),503)
def C05(c):
    path=url('standings',competition='l_000001',v=c.token);c.old_standings=c.http(path);x=c.ok(c.old_standings)
    row,second=x['tables'][0]['rows'];assert [row['position'],second['position']]==[1,1]
    assert row['played']==0 and second['played'] is None and row['points']==Decimal('3.125') and row['pointsAdjustment']==Decimal('-0.125')
    assert row['difference']==1 and second['points'] is None and row['name']=='Observed 0 1'
    assert '3.125' in c.old_standings['body'] and 'null' in c.old_standings['body']
def C06(c):
    x=c.ok(c.old_standings);assert [t['name'] for t in x['tables']]==['Observed group 1','Observed group 2']
    assert x['source']=='Synthetic cup source ' and x['competition']=='Fixture Cup'
def C07(c):
    c.values['open']=x=c.ok(c.http(ROUTES[1]));assert x['season']==SEASON and x['source']['license']=='fixture-license'
    assert len(x['matches'])==3 and x['matches'][1]['score']=={'ft':[1,0],'et':[1,0],'p':[3,4]}
    assert x['matches'][0]['team1']=='Observed team 1'
def C08(c):
    c.values['liga']=x=c.ok(c.http(ROUTES[2]));assert len(x['matches'])==3
    r=x['matches'][1];assert (r['homeId'],r['awayId'],r['status'],r['score'],r['penalties'],r['roundName'])==('t_000002','t_000001','finished',[1,0],[3,4],'Semi-finals')
def C09(c):
    c.values['nations']=x=c.ok(c.http(ROUTES[3]));assert [(m['league'],m['group']) for m in x['matches']]==[('B',1)]
    a=c.ok(c.http(url('openligadb',competition='nations-league',season=SEASON)));assert [(m['league'],m['group']) for m in a['matches']]==[('A',1)]
    c.fail(c.http(url('cup-snapshot',kind='nations-results',competition='l_000001',season=SEASON)),503)
def C10(c):
    c.values['days']=x=c.ok(c.http(ROUTES[7]));assert x['matches']=={'m_000001':{'name':'Semi-finals','playoff':True},'m_000002':{'name':'Semi-finals','playoff':True},'m_000003':{'name':'Final','playoff':True}}
    c.values['unknownDays']=u=c.ok(c.http(url('matchdays',competition='l_000003',season=SEASON)));assert u['matches']=={} and u['unknownMatches']==1
def C11(c):
    c.values['native']=x=c.ok(c.http(ROUTES[6]));assert [m['id'] for m in x['matches']]==['m_000001','m_000002','m_000003']
    assert x['matches'][1]['home_team']['id']=='t_000002' and x['rounds']==c.values['days']['matches']
def C12(c):
    for k,comp,name in [('standings','l_000001','standing'),('open-cups','ESP_CUP_fixture','open'),('openligadb','ESP_CUP_fixture','liga'),('nations-results','nations-league','nations')]:
        x=c.ok(c.http(url('cup-snapshot',kind=k,competition=comp,season=SEASON)))
        assert x==(c.ok(c.old_standings) if name=='standing' else c.values[name]),k
def C13(c):
    c.values['index']=x=c.ok(c.http(ROUTES[4]));assert x==c.ok(c.http(url('cup-index',kind='supplemental')))
    assert {v['id'] for v in x['native']}=={'l_000001','l_000002'}
    a=next(e for e in x['competitions'] if e['folder']=='ESP_CUP_fixture');assert a['tables']=={'results':{'rows':2},'fixtures':{'rows':1}}
    assert 'path' not in json.dumps(x) and 'sha256' not in json.dumps(x)
def C14(c):
    c.values['results']=results=c.ok(c.http(ROUTES[5]));c.values['fixtures']=fixtures=c.ok(c.http(url('cup-table',competition='ESP_CUP_fixture',season=SEASON,kind='fixtures')))
    assert [(r['ft_home'],r['ft_away']) for r in results]==[(1,0),(1,0)] and len(fixtures)==1
    x=c.ok(c.http(url('cup-table',competition='fixture-league',season=SEASON,kind='results')));assert len(x)==1 and x[0]['ft_home'] is None and x[0]['ft_away'] is None
def C15(c):
    assert [(m.get('leg'),m.get('tieKey')) for m in c.values['open']['matches'][:2]]==[(1,'fixture-tie'),(2,'fixture-tie')]
def C16(c):
    last=c.values['native']['matches'][-1];assert last['date'] is None and last['time_utc'] is None and last['scoreState']=='absent'
    c.values['unknown']=x=c.ok(c.http(url('cup-snapshot',competition='l_000003',season=SEASON,kind='native')))
    assert x['matches'][0]['scoreState']=='null' and x['matches'][0]['score_home'] is None
    oracle_input=c.run/'consumer-input.json';save(oracle_input,c.values)
    r=c.command([c.args.node24,BASE/'consumer_oracle.mjs',oracle_input],'actual-consumers');c.report['consumers']=json.loads(r.stdout)
def C17(c):
    c.baselines={}
    for path in ROUTES:
        get=c.http(path);c.ok(get);c.baselines[path]=get;tag=get['headers']['etag']
        for method,headers,status in [('HEAD',{},200),('GET',{'If-None-Match':tag},304)]:
            r=c.http(path,method=method,headers=headers);assert (r['status'],r['body'],r['headers']['etag'])==(status,'',tag),r
            assert len(r['sql'])<=2 and all('orion:competition' in q['sql'] and 'body' not in q['sql'].split('*/',1)[0] for q in r['sql']),r['sql']
def C18(c):
    c.report['correction']=c.fixture.correction();r=c.http(ROUTES[0]);x=c.ok(r)
    assert r['headers']['etag']!=c.baselines[ROUTES[0]]['headers']['etag'] and x['tables'][0]['rows'][0]['points']==Decimal('7.875')
    c.corrected=r['headers']['x-orion-representation'];c.corrected_etag=r['headers']['etag']
    old=c.http(url('standings',competition='l_000001',v=c.token));assert old['body']==c.old_standings['body'] and old['headers']['etag']==c.old_standings['headers']['etag']
    b=c.http(ROUTES[3]);assert b['body']==c.baselines[ROUTES[3]]['body'] and b['headers']['etag']==c.baselines[ROUTES[3]]['headers']['etag']
def C19(c):
    c.report['ambiguous']=c.fixture.correction(ambiguous=True)
    c.fail(c.http(ROUTES[0],headers={'If-None-Match':c.corrected_etag}),503)
    c.fail(c.http(ROUTES[0],method='HEAD'),503)
def C20(c):
    x=c.ok(c.http(url('standings',competition='l_000001',v=c.corrected)));assert len(x['tables'])==2 and x['tables'][0]['rows'][0]['points']==Decimal('7.875')
    rows=c.db.execute("SELECT scope,data_revision FROM football.standing_snapshots ORDER BY id").fetchall();assert ('home',1) in rows and ('overall',2) in rows
def C21(c):
    c.report['missingAlias']=c.fixture.missing_match_alias();c.fail(c.http(url('matchdays',competition='l_000003',season=SEASON),headers={'If-None-Match':'*'}),503)
    r=c.http(url('matchdays',competition='l_000003',season=SEASON,v=c.tokens['l_000003']));assert c.ok(r)['unknownMatches']==1
def C22(c):
    c.report['oversize']=c.fixture.large_competition_label();r=c.http(url('cup-snapshot',kind='native',competition='l_000002',season=SEASON));c.fail(r,413)
    assert len(r['body'])<1024
    c.report['rowOverflowExecution']='Unverified: 10001-match stress fixture exceeds this allocation; ordinary responses prove exact no-truncation count and SQL sentinel is recorded.'
def C23(c):
    a=c.native_state();save(c.run/'native-before-read.json',a)
    for p in c.frozen_paths:
        r=c.http(p);c.ok(r);assert c.http(p,headers={'If-None-Match':r['headers']['etag']})['status']==304
    p=url('open-cups',competition='ESP_CUP_fixture',season=SEASON,v=c.token);r=c.http(p);c.ok(r);assert c.http(p,method='HEAD')['status']==200
    with c.connect('statarena_runtime') as db:
        try:db.execute("INSERT INTO football.players(display_name) VALUES('forbidden')")
        except c.psycopg.Error as exc:assert exc.sqlstate in {'42501','25006'};c.report['readOnlySqlstate']=exc.sqlstate
        else:raise AssertionError('Ordinary runtime wrote a typed fact')
    b=c.native_state();save(c.run/'native-after-read.json',b);assert a==b
def C24(c):
    for p,before in zip(c.frozen_paths,c.frozen):
        r=c.http(p);assert (r['status'],r['body'],r['headers']['etag'])==(200,before['body'],before['headers']['etag'])
def C25(c):
    assert c.traces()['attempts']==[] and len(c.traces()['calibration'])==8
    assert inputs()==c.report['inputHashes'];c.report['inputsUnchanged']=True
CASES=[C00,C01,C02,C03,C04,C05,C06,C07,C08,C09,C10,C11,C12,C13,C14,C15,C16,C17,C18,C19,C20,C21,C22,C23,C24,C25]

class Runtime:
    def __init__(self,args,run,report):
        self.args,self.run,self.report=args,run,report;self.values={};self.pg=self.db=self.server=self.err=None
        self.deadline=time.monotonic()+BOUNDS['seconds'];self.commands=[];self.opener=build_opener(ProxyHandler({}))
    def command(self,argv,name,cleanup=False):
        from orion_e2e_process import run_bounded
        end=time.monotonic()+20 if cleanup else min(self.deadline,time.monotonic()+30)
        r=run_bounded([str(v) for v in argv],deadline=end,cwd=ROOT,env=self.env,term_seconds=2,drain_seconds=1,output_limit=2*1024**2)
        n=len(self.commands);self.commands.append({'argv':[str(v) for v in argv],'exitCode':r.returncode,'name':name});(self.run/f'{n:03d}-{name}.stdout.log').write_text(r.stdout);(self.run/f'{n:03d}-{name}.stderr.log').write_text(r.stderr)
        assert r.returncode==0,(name,r.stderr[-2000:]);return r
    def connect(self,role):
        from workflow_budget import connection_factory
        factory=connection_factory(self.psycopg,self.budget,self.run/'python-sql.jsonl',phase=lambda:'operational',owned_port=self.pg.port,role=role)
        return factory.connect(host='127.0.0.1',hostaddr='127.0.0.1',port=self.pg.port,dbname='postgres',user=role,sslmode='verify-full',sslrootcert=str(self.cert),autocommit=True,application_name='competition-'+role,options='-c statement_timeout=8000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=5000'+(' -c default_transaction_read_only=on' if role=='statarena_runtime' else ''))
    def setup(self,release):
        sys.path[:0]=[str(ROOT/'tests'),str(PILOT),str(ROOT/'dashboard/scripts'),str(PUBLISHER),'/tmp/statarena-publication-test-python']
        import psycopg
        from harness import LocalPostgres
        from workflow_budget import SharedBudget
        from orion_pro_migrate import bootstrap
        from orion_pro_integrity import role_grants_sql
        self.psycopg=psycopg;tempfile.tempdir='/tmp'
        self.env={k:os.environ[k] for k in ('PATH','HOME','USER','LANG','LC_ALL') if k in os.environ}
        self.budget=SharedBudget(self.run/'budget.json',create=True);state=self.budget.read();state['limits'].update(BOUNDS);state['deadlineEpoch']=time.time()+max(0,self.deadline-time.monotonic());save(self.budget.path,state)
        self.pg=LocalPostgres(self.args.pg_bin,self.run)
        self.command([self.args.pg_bin/'initdb','-D',self.pg.data,'--auth=trust','--no-locale','--encoding=UTF8'],'initdb')
        self.cert=self.pg.data/'server.crt';key=self.pg.data/'server.key'
        self.command(['openssl','req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','2','-keyout',key,'-out',self.cert,'-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],'tls');key.chmod(0o600)
        with (self.pg.data/'postgresql.conf').open('a') as f:f.write("\nssl=on\nssl_cert_file='server.crt'\nssl_key_file='server.key'\nmax_connections=5\nsuperuser_reserved_connections=0\nmax_locks_per_transaction=1024\nlog_statement='all'\nlog_parameter_max_length=0\nlog_parameter_max_length_on_error=0\nlog_line_prefix='[%p] app=%a '\nstatement_timeout=8000\nlock_timeout=1000\nidle_in_transaction_session_timeout=5000\n")
        self.command([self.args.pg_bin/'pg_ctl','-D',self.pg.data,'-l',self.run/'postgres.log','-o',f'-h 127.0.0.1 -p {self.pg.port} -k {self.pg.socket_dir}','-w','start'],'postgres-start');self.pg.started=True
        with self.connect(os.environ.get('USER','postgres')) as db:
            for role in ('statarena_admin','statarena_ingest','statarena_runtime'):db.execute(f'CREATE ROLE {role} LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION NOBYPASSRLS')
            db.execute('ALTER DATABASE postgres OWNER TO statarena_admin')
        self.db=self.connect('statarena_admin');assert self.db.info.server_version==180006
        self.model=json.loads(MODEL.read_text());self.tables={t['qualified_name']:t for s in self.model['schemas'] for t in s['tables'] if t['phase']!='models'}
        with self.db.transaction():
            artifacts=[]
            for version,name in MIGRATIONS:
                p=ROOT/'dashboard/backend/migrations'/name;body=p.read_text();self.db.execute(body,prepare=False);artifacts.append((version,p,body))
                self.db.execute('INSERT INTO ingest.schema_migrations VALUES(%s,%s,CURRENT_TIMESTAMP,%s)',(version,sha(p),release['ownedBaseCommit']))
            bootstrap(self.db,self.model,artifacts[:2]);self.db.execute(role_grants_sql(self.model,'statarena_ingest','statarena_runtime'),prepare=False)
        f=importlib.util.spec_from_file_location('competition_fixture',BASE/'fixture.py');module=importlib.util.module_from_spec(f);f.loader.exec_module(module)
        self.fixture=module.CompetitionFixture(self.db,self.pg.dsn,self.run,psycopg)
        env={**self.env,'DATABASE_URL':f'postgresql://statarena_runtime@127.0.0.1:{self.pg.port}/postgres','DATABASE_CA_PEM':self.cert.read_text(),'DATABASE_POOL_MAX':'1','STATARENA_PRO_API':'1','STATARENA_TEST_DATABASE':'1','STATARENA_DATA_PROVIDER':'AWS','NEON_DATABASE_URL':'postgresql://blocked@neon.invalid/blocked','STATARENA_CLOUDFRONT_URL':'https://media.fixture.invalid','COMPETITION_OWNED_PG_PORT':str(self.pg.port),'COMPETITION_EVIDENCE_ROOT':str(self.run),'COMPETITION_ACTUAL_APP':'1' if self.args.actual_app else '0'}
        self.err=(self.run/'api.stderr.log').open('w');self.server=subprocess.Popen([str(self.args.node24),str(BASE/'http_server.mjs')],cwd=ROOT,env=env,start_new_session=True,stdout=subprocess.PIPE,stderr=self.err,text=True,bufsize=1)
        assert select.select([self.server.stdout],[],[],min(15,max(0,self.deadline-time.monotonic())))[0],'API startup timeout'
        line=self.server.stdout.readline();(self.run/'api.ready.log').write_text(line);self.ready=json.loads(line)
        assert self.ready['event']=='ready';self.origin=f"http://127.0.0.1:{self.ready['port']}";self.report['api']=self.ready
    def raw(self,path,method='GET',headers=None):
        timeout=min(12,self.deadline-time.monotonic());assert timeout>0
        try:r=self.opener.open(Request(self.origin+path,method=method,headers=headers or {}),timeout=timeout)
        except HTTPError as exc:r=exc
        with r:return r.status,{k.lower():v for k,v in r.headers.items()},r.read(2*1024**2+1).decode()
    def traces(self):return json.loads(self.raw('/__e2e__/traces')[2])
    def http(self,path,method='GET',headers=None):
        self.budget.reserve('http');request_id=str(self.budget.read()['counts']['http'])
        status,h,b=self.raw(path,method,{'X-E2E-Id':request_id,**(headers or {})});assert len(b.encode())<=2*1024**2
        trace=next(t for t in self.traces()['requests'] if t['id']==request_id)
        r={'path':path,'method':method,'status':status,'headers':h,'body':b,'sql':trace['sql']};self.report['requests'].append(r)
        assert all(not re.search(r'\b(INSERT|UPDATE|DELETE|COPY|CREATE|ALTER|DROP)\b',q['sql'],re.I) for q in r['sql']);return r
    def ok(self,r):assert r['status']==200,r;return json.loads(r['body'],parse_float=Decimal)
    def fail(self,r,status):assert r['status']==status and r['headers'].get('cache-control')=='no-store' and 'etag' not in r['headers'],r
    def native_state(self):
        tables={};total=0
        for name,t in self.tables.items():
            projection=','.join('"'+n+'"' for n in t['columns']);pk=','.join('"'+n+'"' for n in t['primary_key']['columns'])
            rows=self.db.execute(f'SELECT ROW({projection})::text FROM {name} ORDER BY {pk}').fetchall();total+=len(rows);assert total<=BOUNDS['typedRows']
            h=hashlib.sha256()
            for (value,) in rows:
                b=value.encode();h.update(str(len(b)).encode()+b':'+b+b'\n')
            tables[name]={'rows':len(rows),'sha256':h.hexdigest()}
        names=self.db.execute("SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ('ingest','football','analytics') ORDER BY 1,2").fetchall()
        sequences={f'{s}.{n}':self.db.execute(f'SELECT last_value,is_called FROM "{s}"."{n}"').fetchone() for s,n in names};assert len(tables)==94 and len(sequences)==67
        return {'tables':tables,'sequences':sequences,'physicalRows':total}
    def resource_check(self):
        self.budget.check();r=self.command(['du','-sk',self.pg.root],'disk');size=int(r.stdout.split()[0])*1024
        evidence=sum(p.stat().st_size for p in self.run.rglob('*') if p.is_file());assert size<=BOUNDS['ownedDiskBytes'] and evidence<=BOUNDS['evidenceBytes']
        self.report.setdefault('resources',[]).append({'diskBytes':size,'evidenceBytes':evidence})
    def close(self):
        result={}
        if self.server:
            if self.server.poll() is None:os.killpg(self.server.pid,signal.SIGTERM)
            try:self.server.wait(timeout=3)
            except subprocess.TimeoutExpired:os.killpg(self.server.pid,signal.SIGKILL);self.server.wait(timeout=2)
            if self.server.stdout:self.server.stdout.close()
        if self.err:self.err.close()
        result['apiStopped']=self.server is None or self.server.poll() is not None
        if self.db:self.db.close()
        result['ownerClosed']=self.db is None or self.db.closed
        if self.pg:
            # Also check postmaster.pid after a partial pg_ctl start failure.
            if self.pg.started or (self.pg.data/'postmaster.pid').exists():self.command([self.args.pg_bin/'pg_ctl','-D',self.pg.data,'-m','fast','-w','stop'],'postgres-stop',cleanup=True)
            result['postgresStopped']=not (self.pg.data/'postmaster.pid').exists();assert result['postgresStopped']
            shutil.rmtree(self.pg.root);result['ownedRootRemoved']=not self.pg.root.exists()
        return result

def main():
    p=argparse.ArgumentParser(description=__doc__);m=p.add_mutually_exclusive_group();m.add_argument('--precode-red',action='store_true');m.add_argument('--run-owned',action='store_true');m.add_argument('--manifest',action='store_true')
    p.add_argument('--release',type=Path);p.add_argument('--release-sha256');p.add_argument('--node24',type=Path,default=NODE);p.add_argument('--pg-bin',type=Path,default=PG);p.add_argument('--actual-app',action='store_true');p.add_argument('--label',default='competitions');args=p.parse_args()
    assert [f.__name__ for f in CASES]==[f'C{i:02d}' for i in range(26)]
    if args.manifest:print(json.dumps(inputs(),indent=2));return 0
    if not args.precode_red and not args.run_owned:
        print(json.dumps({'kind':'competition_e2e_offline_inventory','caseFunctions':26,'productPresent':PRODUCT.is_file(),'pgStarts':0,'externalCalls':0,'bounds':BOUNDS}));return 0
    assert re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,70}',args.label)
    manifest=inputs();release=None
    if args.run_owned:
        assert PRODUCT.is_file() and args.release and args.release.is_absolute() and args.release.is_relative_to(BASE)
        assert sha(args.release)==args.release_sha256
        release=json.loads(args.release.read_text());assert set(release)=={'kind','scope','allocationId','inputHashes','bounds','ownedBaseCommit','expiresAt','actualApp'}
        assert release['kind']=='competition_owned_e2e_release_v1' and release['scope']=='owned_source_free_only' and release['inputHashes']==manifest and release['bounds']==BOUNDS and release['actualApp'] is args.actual_app
        assert datetime.now(timezone.utc)<datetime.fromisoformat(release['expiresAt']) and re.fullmatch('[a-f0-9]{40}',release['ownedBaseCommit']) and re.fullmatch('[A-Za-z0-9-]{1,80}',release['allocationId'])
        assert not any(k.startswith('PG') for k in os.environ),'Reject ambient libpq settings'
        consumed=BASE/(release['allocationId']+'.consumed.json');assert not consumed.exists()
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');run=BASE/'runs'/(stamp+'-'+args.label);(run/'inputs').mkdir(parents=True)
    started=time.monotonic();report={'kind':'typed_competitions_e2e_v1','command':[sys.executable,*sys.argv],'expected':'FAILURE_MATRIX.json C00-C25 authored before product','inputHashes':manifest,'bounds':BOUNDS,'sourceCalls':0,'cloudCalls':0,'cases':[],'requests':[],'actualApp':args.actual_app}
    for name,digest in manifest.items():
        target=run/'inputs'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,target);assert sha(target)==digest
    if args.precode_red:
        assert not PRODUCT.exists(),'Pre-code RED cannot be regenerated after product'
        argv=[str(args.node24),'--input-type=module','-e','await import('+json.dumps(PRODUCT.as_uri())+')']
        out=subprocess.run(argv,env={'PATH':'/usr/bin:/bin'},capture_output=True,text=True,timeout=10)
        (run/'node.stderr.log').write_text(out.stderr);(run/'node.stdout.log').write_text(out.stdout)
        assert out.returncode!=0 and 'ERR_MODULE_NOT_FOUND' in out.stderr and 'orion-pro-competitions.js' in out.stderr
        report.update(status='expected_precode_red',nodeCommand=argv,nodeExit=out.returncode,pgStarts=0,cleanup={'noOwnedServicesStarted':True},cases=[{'id':f.__name__,'status':'unverified'} for f in CASES]);save(run/'result.json',report)
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
        report['status']='fail' if failure else 'pass';report['failure']=failure;report['elapsedSeconds']=round(time.monotonic()-started,3)
        report['summary']={s:sum(x['status']==s for x in report['cases']) for s in ('pass','fail','unverified')};save(run/'result.json',report)
    print(json.dumps({'status':report['status'],'summary':report['summary'],'receipt':str(run/'result.json'),'sha256':sha(run/'result.json'),'cleanup':report['cleanup']}));return int(bool(failure))

if __name__=='__main__':raise SystemExit(main())
