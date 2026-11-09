"""Black-box bootstrap, workflow and relational monitor checks. No AWS credentials inherited."""
import contextlib, http.server, json, os, pathlib, subprocess, sys, tempfile, threading, urllib.parse
import psycopg, yaml
root = pathlib.Path.cwd()
folder = pathlib.Path(__file__).resolve().parent
action = root/'.github/actions/aws-database'
wf = root/'.github/workflows'
phase = sys.argv[1]
out = folder/phase
if phase.startswith(("before", "baseline")):
    baseline = tempfile.TemporaryDirectory()
    wf = pathlib.Path(baseline.name)/'.github/workflows'
    wf.mkdir(parents=True)
    action = wf.parent/'actions/aws-database'
    receipt = '923bb0ff4a9ab4da8a528fdc7f138b31a5f6f68f'
    for original in subprocess.check_output(['git','ls-tree','--name-only','-r',receipt,'.github/workflows'],text=True).splitlines():
        (wf/pathlib.Path(original).name).write_bytes(subprocess.check_output(['git','show',receipt+':'+original]))
report = {'rerun': f'node docs/verification/aws-actions-20261104/run.mjs {phase}', 'phase':phase,'fixture':'signed AWS CLI SSM loopback; ephemeral PostgreSQL 18; local GitHub env/output files', 'checks':[]}
def case(name, fn):
    try:
        result=fn()
        report['checks'].append({'name':name,'pass':True,'actual':result})
    except Exception as e:
        report['checks'].append({'name':name,'pass':False,'error':str(e).replace(os.environ['TEST_DATABASE_URL'],'<local-db>')[:500]})
def check(value,msg):
    if not value: raise AssertionError(msg)
def environment(path):
    result={}; lines=iter(path.read_text().splitlines())
    for line in lines:
        if '<<' in line and ('=' not in line or line.index('<<')<line.index('=')):
            k,term=line.split('<<',1); value=[]
            for part in lines:
                if part==term: break
                value.append(part)
            result[k]='\n'.join(value)
        else:
            k,v=line.split('=',1); result[k]=v
    return result
def setup(mode, fault=''):
    calls=[]; password='p@ss:/%fixture'; storage='fixture-private-key'
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def do_POST(self):
            req=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            check(req['WithDecryption'] is True and 'AWS4-HMAC-SHA256' in self.headers['Authorization'],'CLI did not sign and request decryption')
            name=req['Name']; calls.append(name.rsplit('/',1)[1]); is_s3=name.endswith('/s3-ingest')
            data={'host':'fixture.abcdefgh.us-east-2.rds.amazonaws.com','database':'statarena_prod','username':'test-user','password':password}
            if fault=='host': data['host']='wrong.example.invalid'
            if fault=='database': data['database']='postgres'
            if is_s3: data={'access_key_id':'fixture-access','secret_access_key':storage,'user':'worker'}
            ok=not (fault=='denied' and is_s3)
            message={'Parameter':{'Name':name,'Value':json.dumps(data),'Type':'SecureString'}} if ok else {'__type':'AccessDeniedException','message':'Denied'}
            body=json.dumps(message).encode()
            self.send_response(200 if ok else 400);self.send_header('Content-Type','application/x-amz-json-1.1');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    with tempfile.TemporaryDirectory() as d, http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler) as server:
        t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
        path=pathlib.Path(d)/'env';path.touch()
        env={**os.environ,'AWS_EC2_METADATA_DISABLED':'true','AWS_ACCESS_KEY_ID':'fixture','AWS_SECRET_ACCESS_KEY':'fixture','AWS_REGION':'us-east-2','AWS_DEFAULT_REGION':'us-east-2','AWS_ENDPOINT_URL_SSM':f'http://127.0.0.1:{server.server_port}','AWS_MAX_ATTEMPTS':'1','GITHUB_ENV':str(path),'GITHUB_WORKSPACE':str(root)}
        p=subprocess.run([sys.executable,str(action/'bootstrap.py'),mode],env=env,capture_output=True,text=True)
        server.shutdown()
        visible='\n'.join(s for s in (p.stdout+p.stderr).splitlines() if not s.startswith('::add-mask::'))
        check(password not in visible and storage not in visible,'secret outside GitHub mask command')
        if fault:
            check(p.returncode!=0 and not path.read_bytes() and calls,'expected clean failure before any environment export')
        else:
            check(p.returncode==0,'bootstrap failed: '+visible[-190:])
            result=environment(path); url=urllib.parse.urlsplit(result['DATABASE_URL'])
            check(urllib.parse.unquote(url.password)==password and url.path=='/statarena_prod' and urllib.parse.parse_qs(url.query)['sslmode']==['verify-full'],'wrong DSN')
            check('BEGIN CERTIFICATE' in result['DATABASE_CA_PEM'] and pathlib.Path(result['PGSSLROOTCERT']).is_file(),'missing CA')
            check(result['DATABASE_POOL_MAX']=='1' and result['STATARENA_DATA_PROVIDER']=='aws','missing AWS defaults')
            check(not any(key.startswith('NEON_') for key in result),'legacy configuration exported')
            expected=['rds-runtime'] if mode=='runtime' else ['rds-ingest','s3-ingest']
            check(calls==expected,'unexpected parameter reads')
            check((result.get('STATARENA_S3_SECRET_ACCESS_KEY')==storage)==(mode=='ingest'),'wrong credential scope')
        return {'parameter_reads':calls,'exit':p.returncode,'env_written':bool(path.read_bytes()),'plain_log_secret_count':0}
for mode,fault in [('ingest',''),('runtime',''),('ingest','host'),('runtime','database'),('ingest','denied')]:
    case('bootstrap '+mode+' '+(fault or 'success'),lambda m=mode,f=fault:setup(m,f))
def workflow(name):
    text=(wf/(name+'.yml')).read_text(); obj=yaml.safe_load(text)
    check('secrets.NEON' not in text,'legacy repository secret references')
    if name=='verify-ingestion':
        check('postgres:18' in text and 'id-token: write' not in text and all(step.get('uses') != './.github/actions/aws-database' for job in obj['jobs'].values() for step in job.get('steps',[])),'test job must be isolated on PG18')
    elif name=='vega-v2-pilot':
        check(obj.get('permissions') == {'contents':'read'} and 'id-token: write' not in text,
              'v2 pilot must have repository read permission only')
        check('./.github/actions/aws-database' not in text and 'secrets.NEON' not in text,
              'v2 pilot must not bootstrap the production database')
        # pgvector's image is PostgreSQL 16 plus the extension the optional v2 vector
        # migration needs; both are throwaway runner services.
        check(obj['jobs']['pilot']['services']['postgres']['image'] in ('postgres:16','pgvector/pgvector:pg16'),
              'v2 pilot must use its disposable PostgreSQL service')
        target=urllib.parse.urlsplit(obj['jobs']['pilot']['env']['V2_DATABASE_URL'])
        check(target.hostname=='127.0.0.1' and target.path=='/vega_v2_pilot',
              'v2 pilot database must stay local to the runner')
        import re
        check(set(re.findall(r'secrets\.([A-Za-z0-9_]+)',text))=={'PITCHAPI_API_KEY'},
              'v2 pilot may receive only its provider key')
        check('schedule' not in obj.get('on',obj.get(True,{})),
              'v2 pilot must not activate a permanent schedule')
    elif name=='production-validation':
        check('id-token: write' not in text and 'secrets.' not in text,
              'public site validation must not receive cloud/provider credentials')
        check(all(step.get('uses') != './.github/actions/aws-database'
                  for job in obj['jobs'].values() for step in job.get('steps',[])),
              'public site validation must use HTTP, not database bootstrap')
        check('verify_aws_runtime.mjs' in text and 'https://vegasport.vercel.app' in text,
              'public site validation must exercise the production AWS API')
        check(obj['jobs']['validate_site'].get('permissions', obj.get('permissions')) == {'contents':'read'},
              'public site checks need only repository read access')
        check('actions: write' not in text and '/dispatches' not in text and '/enable' not in text,
              'public validation must not mutate other workflows')
    else:
        check('./.github/actions/aws-database' in text and 'id-token: write' in text,'missing OIDC bootstrap')
        if name=='database-schema':
            check('secrets.' not in text and 'actions: write' not in text and 'inventory.py' in text,
                  'schema inspection must not access provider secrets or mutate workflows')
            check('schedule' not in obj.get('on',obj.get(True,{})), 'schema inspection must not run periodically')
            for job in obj['jobs'].values():
                for step in job.get('steps',[]):
                    if step.get('uses')=='./.github/actions/aws-database':
                        check(step['with']['mode']=='runtime','schema inspection must use read-only runtime role')
        elif name.startswith('pitchapi-'):
            check('secrets.PITCHAPI' not in text and 'monitor.py' in text,'monitor must inspect published AWS rows')
        else:
            check('relational_materialize.py' in text,'no relational publication')
            if name in ('daily-sync','historical-backfill'): check('--skip-materialize' in text,'inline legacy publication not disabled')
        for job in obj['jobs'].values():
            if not any(s.get('uses')=='./.github/actions/aws-database' for s in job.get('steps',[])): continue
            bootstrap=next(s for s in job['steps'] if s.get('uses')=='./.github/actions/aws-database')
            if bootstrap.get('with',{}).get('mode')=='ingest':
                group=job.get('concurrency',obj.get('concurrency'))
                check(group=={'group':'statarena-aws-ingestion','cancel-in-progress':False,'queue':'max'},
                      'AWS writers must share the dedicated non-cancelling AWS queue: '+str(group))
            co=next(s for s in job['steps'] if s.get('uses','').startswith('actions/checkout'))
            sparse=co.get('with',{}).get('sparse-checkout','')
            check(not sparse or '.github/actions/aws-database' in sparse,'action missing in sparse checkout')
    return {'jobs':list(obj['jobs'])}
for f in sorted(wf.glob('*.yml')): case('workflow '+f.stem,lambda n=f.stem:workflow(n))
with psycopg.connect(os.environ['TEST_DATABASE_URL'],autocommit=True) as db:
    db.execute((root/'dashboard/backend/migrations/004_match_details.sql').read_text())
    db.execute((root/'dashboard/backend/migrations/007_match_source_fields.sql').read_text())
    db.execute((root/'dashboard/backend/migrations/008_match_player_position.sql').read_text())
    db.execute((root/'dashboard/backend/migrations/009_compact_player_metrics.sql').read_text())
    def monitor(expect, offline=False):
        with tempfile.TemporaryDirectory() as d:
            output=pathlib.Path(d)/'output';output.touch()
            p=subprocess.run([sys.executable,str(action/'monitor.py')],env={**os.environ,'DATABASE_URL':'postgresql://127.0.0.1:1/unavailable?connect_timeout=1' if offline else os.environ['TEST_DATABASE_URL'],'GITHUB_OUTPUT':str(output)},capture_output=True,text=True)
            if offline: check((action/'monitor.py').is_file() and p.returncode!=0 and output.read_text()=='','failed SQL reported completion or missing monitor')
            else: check(p.returncode==0 and f'complete={expect}' in output.read_text(),'monitor wrong completion: '+p.stderr[-180:])
            return {'exit':p.returncode,'github_output':output.read_text().strip()}
    case('monitor no match',lambda:monitor('false'))
    sys.path.insert(0,str(root/'dashboard/scripts'))
    from relational_match import publish_match_details
    end={'match':{'score_home':0,'score_away':1,'status':'finished'},'events':{'events':[{}]},'shots':{'periods':[{'shots':[{'expected_goals':0}]}]},'stats':{'periods':[{'groups':[{'items':[{}]}]}]},'players':[{'stats':[{}]}]}
    def full():
        publish_match_details(db,'m_0k4IES',{k:{'status':200,'data':v} for k,v in end.items()})
        return monitor('true')
    case('monitor published match with zero score',full)
    case('monitor SQL unavailable',lambda:monitor('',True))
report['pass']=sum(r['pass'] for r in report['checks']);report['total']=len(report['checks'])
(out/'results.json').write_text(json.dumps(report,indent=2)+'\n')
print(f"{report['pass']}/{report['total']} pass")
for r in report['checks']:
    if not r['pass']: print(r['name'],r.get('error'))
sys.exit(report['pass']!=report['total'])
