#!/usr/bin/env python3
"""Complete source-free PG E2E; every source object below is synthetic."""
import argparse,copy,hashlib,json,os,shlex,shutil,subprocess,sys,types
from datetime import datetime,timezone
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode=True
REPO=Path(__file__).resolve().parents[1];DOC=REPO/'docs/verification/orion-pro-heatmaps-20261104';PILOT=REPO/'docs/verification/orion-pro-pilot-20261104';NATIVE_TEST=REPO/'tests/orion_pro_native_contracts_local.py';NORMALIZER=REPO/'dashboard/scripts/orion_pro_normalize.py'
support=types.ModuleType('readonly_native31_support');support.__file__=str(NATIVE_TEST)
exec(compile(NATIVE_TEST.read_text(),str(NATIVE_TEST),'exec'),support.__dict__)
M='m_synthetic';HOME='t_home';AWAY='t_away';PH='p_synthetic_zero';PA='p_synthetic_number';RAW='raw/explicit-synthetic-sparse-heatmaps.json.gz'
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def payload(frame='home_ltr'):
    return {'match_id':M,'grid':{'length':16,'width':12,'frame':frame,'cell_length_m':Decimal('6.5625'),'cell_width_m':Decimal('5.666666666666667')},
        'teams':[{'team':{'id':HOME,'name':'Synthetic home observation'},'side':'home','actions':5,'cells':[[15,11,2],[0,0,0],[7,4,3]]}],
        'players':[{'team':{'id':AWAY,'name':'Synthetic away reference'},'player':{'id':PA,'name':'Synthetic away observation','shirt_number':'09'},'side':'away','actions':5,'cells':[[0,11,1],[15,0,4]]},
                   {'team':{'id':HOME,'name':'Synthetic home from player row'},'player':{'id':PH},'side':'home','actions':0,'cells':[[3,2,0]]}]}
def setup_inputs():
    parts=support.fixture('base')
    next(r for r in parts[0]['tables']['performances'] if r['playerId']==PA)['teamId']=AWAY
    body=[{'matchId':M,'documentId':'explicit-synthetic-heatmap','response':{'status':200,'data':payload()}}]
    return parts,body
class Source:
    profile_metadata=[];profile_gaps=[]
    def __init__(self):
        self.parts,body=setup_inputs();self.cache={RAW:body};self.meta={p['path']:{'physicalSha256':digest(p),'bytes':0,'updatedAt':datetime(2020,1,1,tzinfo=timezone.utc)} for p in self.parts}
        self.meta[RAW]={'physicalSha256':digest(body),'bytes':0,'updatedAt':datetime(2020,1,1,tzinfo=timezone.utc)}
    def documents(self,expected,batch_size=16):
        for p,h in expected.items():assert self.meta[p]['physicalSha256']==h
        return {p:self.cache[p] for p in expected}
    def scope(self):return {'archiveShapeChoices':[{'family':'heatmaps','matchId':M,'season':'synthetic-local','path':RAW}], 'queries':[{'name':'archive_relation_source_versions','rows':[{'path':RAW,'sha256':self.meta[RAW]['physicalSha256']}]}]}
def oracle(conn,data,generation=None,variant=None):
    generation=generation or conn.execute("SELECT max(generation) FROM ingest.dataset_snapshots WHERE status='sealed'").fetchone()[0]
    sql="""SELECT h.id,t.public_key,p.public_key,h.grid_columns,h.grid_rows,h.cell_length_m,h.cell_width_m,h.coordinate_frame,h.actions,h.cells_state,s.side,h.variant_key,h.source_record_id,r.locator
        FROM football.match_heatmaps h JOIN ingest.public_aliases_current t ON t.route_kind='team' AND t.team_id=h.team_id
        LEFT JOIN ingest.public_aliases_current p ON p.route_kind='player' AND p.player_id=h.player_id
        JOIN football.match_teams s ON s.revision_id=h.match_team_revision_id JOIN ingest.source_records r ON r.id=h.source_record_id
        WHERE ingest.selected_at(%s,h.recorded_from_gen,h.recorded_to_gen) AND (%s::text IS NULL AND h.is_canonical OR h.variant_key=%s) ORDER BY t.public_key,p.public_key NULLS FIRST"""
    rows=list(conn.execute(sql,(generation,variant,variant)));actual={};children=[]
    for r in rows:
        cells=list(conn.execute('SELECT cell_ordinal,column_index,row_index,action_count FROM football.match_heatmap_cells WHERE heatmap_id=%s ORDER BY cell_ordinal',(r[0],)))
        actual[(r[1],r[2])]=(r,cells);children.extend(cells)
    errors=[];expected_cells=0
    for kind in ['teams','players']:
        for index,item in enumerate(data.get(kind,[]) or []):
            key=(item['team']['id'],item['player']['id'] if kind=='players' else None)
            if key not in actual:errors.append('missing_parent');continue
            r,cells=actual[key];state='absent' if 'cells' not in item else 'null' if item['cells'] is None else 'empty' if not item['cells'] else 'available'
            expected=[(i,*c) for i,c in enumerate(item.get('cells') or [])];expected_cells+=len(expected)
            grid=data['grid'];ok=(r[3],r[4],r[7],r[8],r[9],r[10])==(grid['length'],grid['width'],grid['frame'],item.get('actions'),state,item['side'])
            ok=ok and Decimal(str(r[5]))==grid['cell_length_m'] and Decimal(str(r[6]))==grid['cell_width_m'] and cells==expected and r[13].endswith('/response/data/'+kind+'/'+str(index))
            if not ok:errors.append('grid_state_triplets_order_or_identity')
    expected_parents=sum(len(data.get(k,[]) or []) for k in ['teams','players'])
    if len(rows)!=expected_parents:errors.append('parent_membership')
    return {'parents':len(rows),'children':len(children),'expectedChildren':expected_cells,'errors':errors,'rowsSha256':digest(actual.__repr__()),'sql':sql,'generation':generation},not errors
def fp(conn):return support.fingerprint(conn)
def call(actor,data,variant,canonical=False,revision=1):
    # Each generated observation has its own declared synthetic source version.
    body=[{'matchId':M,'documentId':'synthetic:'+digest([variant,data]),'response':{'status':200,'data':data}}]
    path='raw/explicit-synthetic-heatmap-'+digest([variant,data])+'.json.gz'
    actor.source.cache[path]=body;actor.source.meta[path]={'physicalSha256':digest(body),'bytes':0,'updatedAt':datetime(2020,1,1,tzinfo=timezone.utc)}
    record=actor.record(path,'/0','explicit_synthetic_heatmap_observation',variant)
    return actor.import_sparse_heatmaps(M,data,record,variant,is_canonical=canonical,data_revision=revision)
def fresh_worker():
    import psycopg
    n=support.module();source=Source()
    with psycopg.connect(os.environ['ORION_PILOT_DATABASE_URL'],autocommit=True) as conn:
        conn.execute('SET ROLE orion_pro_ingest');actor=n.TypedCore(conn,Path(os.environ['HEATMAP_EVIDENCE']),source)
        core=actor.import_core(source.parts);family=actor.import_original_families(source.scope());assert core['reused'] and family['reused']
    print(json.dumps({'status':'pass','pid':os.getpid(),'coreReused':True,'familyReused':True}));return 0
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--label',default='sparse');ap.add_argument('--worker',action='store_true');ap.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'));args=ap.parse_args()
    if args.worker:return fresh_worker()
    run=DOC/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label);run.mkdir(parents=True);inputs=run/'inputs';inputs.mkdir()
    for p in [Path(__file__),NORMALIZER,DOC/'PLAN.md',DOC/'PROTOCOL.md',DOC/'run_native31_regression.py',PILOT/'harness.py',support.MODEL,PILOT/'approval.json',PILOT/'model-amendments.json']:
        shutil.copy2(p,inputs/p.name)
    sys.path.insert(0,str(PILOT));from harness import LocalPostgres
    import psycopg
    pg=LocalPostgres(args.pg_bin,run);conn=None;n=support.module();source=Source();actor=None;blocked=None
    report={'command':'PYTHONPATH=/tmp/statarena-publication-test-python '+shlex.join([sys.executable,*sys.argv]),'environment':'owned disposable LOCAL PG18.6; explicit synthetic observations only','normalizerSha256':sha(NORMALIZER),'testSha256':sha(Path(__file__)),'realTripletsCompared':0,'realTripletsAwaitingCapture':1344,'fullAcceptance':False,'sourceQueries':0,'cases':[]}
    cases=['sparse_zero_corners_order','source_record_roots','cells_and_outer_states','invalid_families_atomic','identity_side_cohort','variants_and_old_snapshot','fresh_process_replay','observed_profile_join_and_gap','native31_regression']
    class Rollback(Exception):pass
    try:
        pg.start();pg.migration(REPO);conn=psycopg.connect(pg.dsn,autocommit=True);conn.execute('SET ROLE orion_pro_ingest')
        actor=n.TypedCore(conn,run,source);actor.import_core(source.parts)
        for case in cases:
            if blocked:report['cases'].append({'case':case,'status':'unverified','reason':blocked});continue
            try:
                if case=='sparse_zero_corners_order':
                    imported=actor.import_original_families(source.scope());first_g=imported['generation'];actual,ok=oracle(conn,payload());assert ok,actual
                    actor.heatmap_root=actor.record(RAW,'/0','synthetic_heatmap_root','synthetic')
                    actual['sourceMembers']=imported['sourceMembers'];actual['realTripletsCompared']=0
                elif case=='source_record_roots':
                    def declare(label,shape,located=False):
                        observed=payload();body=[{'response':{'data':observed}}] if shape=='archive' else {'data':observed}
                        path='raw/explicit-provenance-'+label+'.json.gz';source.cache[path]=body
                        source.meta[path]={'physicalSha256':digest(body),'bytes':0,'updatedAt':datetime(2020,1,1,tzinfo=timezone.utc)}
                        locator='/0' if shape=='archive' else '/data' if located else ''
                        root=actor.record(path,locator,'explicit_synthetic_provenance_root',label)
                        return root,observed,path,locator,digest(body)
                    default_refused=False;false_locators=[];before=support.fingerprint(conn,False)
                    try:
                        with conn.transaction():
                            actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-direct-default',n.VERSION,n.VERSION)).fetchone()[0]
                            root,data,path,_,_=declare('default-probe','direct')
                            try:actor.import_sparse_heatmaps(M,data,root,'synthetic:direct-default',is_canonical=False)
                            except n.MappingError:default_refused=True
                            false_locators=[x[0] for x in conn.execute('SELECT locator FROM ingest.source_records WHERE document_id=%s AND id<>%s ORDER BY locator',(actor.documents[path],root))]
                            raise Rollback()
                    except Rollback:pass
                    assert default_refused and support.fingerprint(conn,False)==before,'Direct response default archive root was accepted with false SQL locators: '+json.dumps(false_locators)
                    outcomes=[]
                    for label,shape,relative,located in [('archive','archive','/response/data',False),('direct','direct','/data',False),('located','direct','',True)]:
                        variant='synthetic:provenance:'+label
                        with conn.transaction():
                            actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',(variant,n.VERSION,n.VERSION)).fetchone()[0]
                            root,data,path,locator,body_hash=declare(label,shape,located)
                            actor.import_sparse_heatmaps(M,data,root,variant,is_canonical=False,data_root=relative)
                            root_sql=conn.execute('SELECT source_id,document_id,locator_kind,locator FROM ingest.source_records WHERE id=%s',(root,)).fetchone()
                            sql="SELECT r.source_id,r.document_id,r.locator_kind,r.locator FROM ingest.source_records r WHERE r.id IN (SELECT source_record_id FROM football.match_heatmaps WHERE variant_key=%s UNION SELECT source_record_id FROM ingest.match_coverage WHERE variant_key=%s) ORDER BY r.locator"
                            derived=list(conn.execute(sql,(variant,variant)));prefix=locator+relative
                            expected=sorted([prefix+'/'+k for k in ['teams','players']]+[prefix+'/'+k+'/'+str(i) for k in ['teams','players'] for i in range(len(data[k]))])
                            assert [x[3] for x in derived]==expected
                            assert all(x[:3]==root_sql[:3] for x in derived) and root_sql[:2]==(actor.ids['source'],actor.documents[path])
                            assert digest(source.cache[path])==body_hash,'Source envelope was changed'
                            count=conn.execute('SELECT count(*) FROM football.match_heatmap_cells c JOIN football.match_heatmaps h ON h.id=c.heatmap_id WHERE h.variant_key=%s',(variant,)).fetchone()[0];assert count==6
                            conn.execute('SELECT ingest.seal_generation(%s,%s)',(actor.g,digest(label)))
                        outcomes.append({'shape':shape,'relativeRoot':relative,'rootRecord':root_sql,'sourceRecordLocators':derived,'expectedLocators':expected,'sourceDocumentUnchanged':True,'cellRows':count,'sql':sql})
                    invalid=[]
                    for label,relative,located,mutate in [('unknown','/other',False,False),('missing','/response/data',False,False),('bare-empty','',False,False),('wrong-data','/data',False,True)]:
                        refused=False
                        try:
                            with conn.transaction():
                                actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-root-invalid:'+label,n.VERSION,n.VERSION)).fetchone()[0]
                                root,data,path,_,_=declare('invalid-'+label,'direct',located)
                                if mutate:data=copy.deepcopy(data);data['teams'][0]['actions']=999
                                try:actor.import_sparse_heatmaps(M,data,root,'synthetic:invalid-root:'+label,is_canonical=False,data_root=relative)
                                except n.MappingError:refused=True
                                raise Rollback()
                        except Rollback:pass
                        assert refused,label;invalid.append({'case':label,'refused':refused})
                    actual={'directDefaultRefused':default_refused,'sourceRoots':outcomes,'invalidRoots':invalid}
                elif case=='cells_and_outer_states':
                    outcomes=[]
                    for label in ['absent','null','empty']:
                        data=payload();data['players']=[];row=data['teams'][0]
                        if label=='absent':row.pop('cells')
                        else:row['cells']=None if label=='null' else []
                        if label=='null':row['actions']=None
                        with conn.transaction():
                            actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-cell-'+label,n.VERSION,n.VERSION)).fetchone()[0]
                            call(actor,data,'synthetic:cells:'+label);conn.execute('SELECT ingest.seal_generation(%s,%s)',(actor.g,digest(label)))
                        result,ok=oracle(conn,data,variant='synthetic:cells:'+label);assert ok,result;outcomes.append({'cells':label,'actual':result})
                    for label,data in [('absent',{}),('null',{'teams':None,'players':None}),('empty',{'teams':[],'players':[]})]:
                        with conn.transaction():
                            actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-outer-'+label,n.VERSION,n.VERSION)).fetchone()[0]
                            call(actor,data,'synthetic:outer:'+label);conn.execute('SELECT ingest.seal_generation(%s,%s)',(actor.g,digest(label)))
                        rows=list(conn.execute('SELECT feature_code,collection_state,observed_row_count FROM ingest.match_coverage WHERE variant_key=%s ORDER BY feature_code',('synthetic:outer:'+label,)))
                        assert rows==[('heatmaps.players',label,0 if label=='empty' else None),('heatmaps.teams',label,0 if label=='empty' else None)];outcomes.append({'outer':label,'rows':rows})
                    actual={'outcomes':outcomes}
                elif case=='invalid_families_atomic':
                    probes=[]
                    for index in range(3):
                        for bad in [True,'0',Decimal('0.5'),-1,2147483648]:
                            d=payload();d['teams'][0]['cells'][0][index]=bad;probes.append(('triplet_'+str(index)+':'+str(bad),d))
                    for key in ['length','width','cell_length_m','cell_width_m']:
                        for bad in [True,'16',0,-1,None,Decimal('NaN'),Decimal('Infinity')]:
                            d=payload();d['grid'][key]=bad;probes.append(('grid_'+key+':'+str(bad),d))
                    for key in ['length','width']:
                        for bad in [Decimal('1.5'),32768]:d=payload();d['grid'][key]=bad;probes.append(('dimension_'+key+':'+str(bad),d))
                    for label,change in [('duplicate_coord',lambda d:d['teams'][0]['cells'].append([15,11,1])),('short_tuple',lambda d:d['teams'][0]['cells'].__setitem__(0,[0,0])),('long_tuple',lambda d:d['teams'][0]['cells'].__setitem__(0,[0,0,0,0])),('null_member',lambda d:d['teams'][0]['cells'].__setitem__(0,None)),('bad_cells',lambda d:d['teams'][0].__setitem__('cells',{})),('bad_frame',lambda d:d['grid'].__setitem__('frame','unknown')),('no_grid',lambda d:d.pop('grid')),('no_actions',lambda d:d['teams'][0].pop('actions')),('repeated_parent',lambda d:d['teams'].append(copy.deepcopy(d['teams'][0])))]:
                        d=payload();change(d);probes.append((label,d))
                    for bad in [True,'5',Decimal('0.5'),-1,2147483648]:d=payload();d['teams'][0]['actions']=bad;probes.append(('actions:'+str(bad),d))
                    for field,value in [('length',16),('width',12)]:
                        d=payload();d['teams'][0]['cells'][0][0 if field=='length' else 1]=value;probes.append(('upper_coordinate_'+field,d))
                    for bad in [False,{},0,'']:
                        d=payload();d['players']=bad;probes.append(('outer_type:'+str(bad),d))
                    for key in ['length','width','frame','cell_length_m','cell_width_m']:
                        d=payload();d['grid'].pop(key);probes.append(('missing_grid_'+key,d))
                    d=payload();d['match_id']='m_wrong';probes.append(('wrong_match_id',d))
                    d=payload();d['grid']['cell_length_m']=Decimal('0.123456789012345678901234567891');probes.append(('inexact_metres',d))
                    outcomes=[];before=support.fingerprint(conn,False)
                    for index,(label,data) in enumerate(probes):
                        refused=False
                        try:
                            with conn.transaction():
                                actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-invalid-'+str(index),n.VERSION,n.VERSION)).fetchone()[0]
                                try:call(actor,data,'synthetic:invalid:'+str(index))
                                except n.MappingError as error:refused=True;reason=str(error)
                                raise Rollback()
                        except Rollback:pass
                        unchanged=support.fingerprint(conn,False)==before;assert refused and unchanged,label
                        outcomes.append({'case':label,'refused':refused,'reason':reason,'committedTablesUnchanged':unchanged})
                    actual={'outcomes':outcomes,'rolledBackSequenceGapsPermitted':True}
                elif case=='identity_side_cohort':
                    outcomes=[]
                    for label in ['wrong_side','wrong_team','unknown_player','team_player_conflict','closed_player','closed_team']:
                        data=payload();refused=False
                        try:
                            with conn.transaction():
                                actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-identity-'+label,n.VERSION,n.VERSION)).fetchone()[0]
                                if label=='wrong_side':data['players'][0]['side']='home'
                                if label=='wrong_team':data['players'][0].update(team={'id':HOME},side='home')
                                if label=='unknown_player':data['players'][0]['player']['id']='p_unknown'
                                if label=='team_player_conflict':data['teams'][0]['player']={'id':PH}
                                if label=='closed_player':conn.execute('UPDATE football.match_players SET recorded_to_gen=%s WHERE player_id=%s AND recorded_to_gen IS NULL',(actor.g,actor.people[PA]['id']))
                                if label=='closed_team':conn.execute('UPDATE football.match_teams SET recorded_to_gen=%s WHERE revision_id=%s',(actor.g,actor.sides[(M,AWAY)]['revision_id']))
                                try:call(actor,data,'synthetic:identity:'+label)
                                except n.MappingError:refused=True
                                raise Rollback()
                        except Rollback:pass
                        assert refused,label;outcomes.append({'case':label,'refused':refused})
                    actual={'outcomes':outcomes}
                elif case=='variants_and_old_snapshot':
                    alt=payload('acting_ltr')
                    with conn.transaction():
                        actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-alt',n.VERSION,n.VERSION)).fetchone()[0];call(actor,alt,'synthetic:acting');conn.execute('SELECT ingest.seal_generation(%s,%s)',(actor.g,digest('alt')))
                    check,ok=oracle(conn,alt,variant='synthetic:acting');assert ok,check
                    changed=payload();changed['teams'][0]['cells']=[[0,0,0],[15,11,5],[7,4,1]];changed['teams'][0]['actions']=6
                    original_variant=conn.execute('SELECT variant_key FROM football.match_heatmaps WHERE is_canonical AND recorded_to_gen IS NULL LIMIT1'.replace('LIMIT1','LIMIT 1')).fetchone()[0]
                    with conn.transaction():
                        actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-correct',n.VERSION,n.VERSION)).fetchone()[0]
                        conn.execute('UPDATE football.match_heatmaps SET recorded_to_gen=%s WHERE is_canonical AND recorded_to_gen IS NULL',(actor.g,));conn.execute("UPDATE ingest.match_coverage SET recorded_to_gen=%s WHERE is_canonical AND feature_code LIKE 'heatmaps.%%' AND recorded_to_gen IS NULL",(actor.g,))
                        call(actor,changed,original_variant,True,2);conn.execute('SELECT ingest.seal_generation(%s,%s)',(actor.g,digest('correct')))
                    old,ok_old=oracle(conn,payload(),first_g);new,ok_new=oracle(conn,changed);assert ok_old and ok_new,(old,new);actual={'old':old,'new':new,'alternate':check,'differentParentVersions':True}
                elif case=='fresh_process_replay':
                    before=fp(conn);env=os.environ.copy();env.update(ORION_PILOT_DATABASE_URL=pg.dsn,HEATMAP_EVIDENCE=str(run),STATARENA_TEST_DATABASE='1')
                    command=[sys.executable,str(Path(__file__)),'--worker'];result=subprocess.run(command,env=env,text=True,capture_output=True,timeout=90)
                    (run/'fresh-worker.stdout.log').write_text(result.stdout);(run/'fresh-worker.stderr.log').write_text(result.stderr);assert result.returncode==0 and before==fp(conn)
                    actual={'worker':json.loads(result.stdout),'before':before,'after':fp(conn),'unchanged':True}
                elif case=='observed_profile_join_and_gap':
                    with conn.transaction():
                        actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-profile-candidate',n.VERSION,n.VERSION)).fetchone()[0];call(actor,payload(),'synthetic:profiles')
                        parents=actor.rows("SELECT * FROM football.match_heatmaps WHERE variant_key='synthetic:profiles'")
                        team_parent=next(h for h in parents if h['player_id'] is None);player_parent=next(h for h in parents if h['player_id']==actor.people[PA]['id'])
                        actor.insert('football.team_profile_versions',team_id=team_parent['team_id'],display_name=payload()['teams'][0]['team']['name'],profile_context='match_heatmap_observation',variant_key='synthetic:profiles',is_canonical=False,observed_at=datetime(2020,1,1,tzinfo=timezone.utc),source_record_id=team_parent['source_record_id'])
                        player_observation=payload()['players'][0]['player']
                        actor.insert('football.player_profile_versions',player_id=player_parent['player_id'],external_profile_version_id='explicit-synthetic-heatmap-profile',display_name=player_observation['name'],profile_content_sha256=digest(player_observation),profile_context='match_heatmap_observation',variant_key='synthetic:profiles',is_canonical=False,observed_at=datetime(2020,1,1,tzinfo=timezone.utc),source_record_id=player_parent['source_record_id'],raw_position_code_state='absent',**actor.native(player_observation,'shirt_number','shirt_number'))
                        join_sql="SELECT count(*) FROM football.match_heatmaps h JOIN football.player_profile_versions p ON p.player_id=h.player_id AND p.source_id=h.source_id AND p.source_record_id=h.source_record_id AND p.variant_key=h.variant_key AND p.profile_context='match_heatmap_observation' AND ingest.selected_at(h.recorded_from_gen,p.recorded_from_gen,p.recorded_to_gen) WHERE h.id=%s"
                        assert conn.execute(join_sql,(player_parent['id'],)).fetchone()[0]==1
                        observed=conn.execute("SELECT display_name,shirt_number_state,shirt_number,shirt_number_source_number FROM football.player_profile_versions WHERE source_record_id=%s AND profile_context='match_heatmap_observation'",(player_parent['source_record_id'],)).fetchone()
                        assert observed==(player_observation['name'],'string','09',None)
                        other=next(h for h in parents if h['player_id']==actor.people[PH]['id']);collision=False
                        try:
                            with conn.transaction():actor.insert('football.team_profile_versions',team_id=other['team_id'],display_name=payload()['players'][1]['team']['name'],profile_context='match_heatmap_observation',variant_key='synthetic:profiles',is_canonical=False,observed_at=datetime(2020,1,1,tzinfo=timezone.utc),source_record_id=other['source_record_id'])
                        except psycopg.errors.UniqueViolation:collision=True
                        assert collision;conn.execute('SELECT ingest.seal_generation(%s,%s)',(actor.g,digest('profile-candidate')))
                    actual={'sameRecordActorVariantCohortJoin':1,'sql':join_sql,'repeatedTeamObservationCollision':collision,'generalProfileMappingAccepted':False}
                elif case=='native31_regression':
                    command=[sys.executable,str(DOC/'run_native31_regression.py'),'--pg-bin',str(args.pg_bin),'--label','heatmap-regression'];result=subprocess.run(command,text=True,capture_output=True,timeout=180)
                    (run/'native31.stdout.log').write_text(result.stdout);(run/'native31.stderr.log').write_text(result.stderr);assert result.returncode==0,result.stdout[-1000:]
                    actual={'unchangedTestSha256':sha(NATIVE_TEST),'exitCode':result.returncode,'command':command,'evidenceOnlyRedirected':True}
                report['cases'].append({'case':case,'status':'pass','actual':actual});print('PASS '+case,flush=True)
            except Exception as error:
                report['cases'].append({'case':case,'status':'fail','error':str(error) if isinstance(error,(AssertionError,n.MappingError)) else type(error).__name__,'sqlstate':getattr(error,'sqlstate',None)});print('FAIL '+case+': '+type(error).__name__,flush=True);blocked='prerequisite '+case+' failed'
    finally:
        if conn:conn.close()
        report['cleanup']=pg.cleanup();report['counts']={s:sum(x['status']==s for x in report['cases']) for s in ['pass','fail','unverified']};report['status']='pass' if report['counts']['pass']==len(cases) else 'fail';(run/'result.json').write_text(json.dumps(report,indent=2,default=str)+'\n');print(json.dumps({'status':report['status'],'counts':report['counts'],'evidence':str(run)}),flush=True)
    return 0 if report['status']=='pass' else 1
if __name__=='__main__':raise SystemExit(main())
