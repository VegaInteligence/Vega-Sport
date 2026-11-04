#!/usr/bin/env python3
"""Source-free complete local PG workflow; all inputs are explicit synthetic data."""
from __future__ import annotations
import argparse,copy,hashlib,json,os,shlex,shutil,subprocess,sys,types
from datetime import datetime,timezone
from decimal import Decimal
from pathlib import Path

sys.dont_write_bytecode=True
REPO=Path(__file__).resolve().parents[1]
DOC=REPO/'docs/verification/orion-pro-native-contracts-20261104'
PILOT=REPO/'docs/verification/orion-pro-pilot-20261104'
NORMALIZER=REPO/'dashboard/scripts/orion_pro_normalize.py'
MODEL=REPO/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
LEGACY=PILOT/'real-source-runs/20261104T204329068716Z-final-scoped-restart-and-explicit-checkpoint/inputs/orion_pro_normalize.py'
MATRIX=json.loads((DOC/'FIELD_MATRIX.json').read_text())
FIELDS={r['sourceField']:r['commonColumn'] for r in MATRIX['fields']}
FIELDS.update(xg='xg',xa='xa',xgot='xgot',minutes='minutes_played')
COUNT={r['sourceField'] for r in MATRIX['fields'] if r['commonSqlType']=='integer'}
SQL_TYPES={r['sourceField']:r['commonSqlType'] for r in MATRIX['fields']}
SQL_TYPES.update(xg='numeric',xa='double precision',xgot='double precision',minutes='double precision')
NUMBER_RULES={'integer':'exact nonnegative int32','numeric':'exact finite unconstrained numeric','double precision':'finite Decimal(str(float(native))) == native'}
VERSION='real_source_core_v2_native31'
ABSENT=object()

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()
def module(path=NORMALIZER):
    out=types.ModuleType('local_native_normalizer');out.__file__=str(path)
    exec(compile(path.read_text(),str(path),'exec'),out.__dict__)
    out.ROOT=REPO;out.MODEL=MODEL
    class NoRemote:
        def __init__(self,*a,**kw):raise AssertionError('Remote source access forbidden in source-free E2E')
    out.SourceReader=NoRemote
    return out

def fixture(kind='base'):
    forms=['number','zero','null','absent']
    if kind=='all':forms+=['empty','text','fraction_text','false','true','precision']
    players=[];performances=[]
    for form in forms:
        pid='p_synthetic_'+form;profile=pid+':profile'
        players.append({'playerId':pid,'id':profile,'name':'Explicit synthetic '+form})
        row={'id':'m_synthetic:'+pid,'matchId':'m_synthetic','playerId':pid,'playerRef':profile,'teamId':'t_home'}
        for field in FIELDS:
            if form=='absent':continue
            if form=='null':v=None
            elif form=='empty':v=''
            elif form=='text':v='09'
            elif form=='fraction_text':v='4/7'
            elif form=='false':v=False
            elif form=='true':v=True
            elif form=='precision' and field=='xg':v=Decimal('12345678901234567890123456789.125')
            elif form=='precision' and field=='rating':v=Decimal('1.2345678901234567')
            elif form=='precision':v=2147483647 if field in COUNT else Decimal('0.125')
            elif form=='zero':v=0
            else:v=2 if field in COUNT else Decimal('-0.125') if field in {'rating','goalsPrevented'} else Decimal('0.125')
            row[field]=v
        performances.append(row)
    return [{'path':'computed/explicit-synthetic-native31.json.gz','season':'synthetic-local',
        'tables':{'players':players,'teams':[{'id':'t_home','name':'Synthetic home'},{'id':'t_away','name':'Synthetic away'}],
        'fixtures':[{'id':'m_synthetic','date':'2020-01-01','status':'finished','home_team':{'id':'t_home'},'away_team':{'id':'t_away'}}],
        'matches':[{'id':'m_synthetic'}],'performances':performances,'shots':[],'competitions':[{'id':'l_3FJFUl'}]}}]

class SyntheticSource:
    profile_metadata=[];profile_gaps=[]
    def __init__(self,parts):
        self.meta={p['path']:{'physicalSha256':digest(p),'bytes':0,'updatedAt':datetime(2020,1,1,tzinfo=timezone.utc)} for p in parts}

def fingerprint(conn,include_sequences=True):
    tables=[r[0] for r in conn.execute("SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind='r' ORDER BY 1")]
    rows=[]
    for table in tables:
        count,h=conn.execute("SELECT count(*),encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to(t::text,'UTF8')),'hex') h FROM "+table+' t) s').fetchone()
        rows.append((table,count,h))
    sequences=list(conn.execute("SELECT schemaname,sequencename,last_value FROM pg_sequences WHERE schemaname IN ('ingest','football','analytics') ORDER BY 1,2")) if include_sequences else []
    return {'tableCount':len(tables),'tables':rows,'sequences':sequences,'sha256':digest([rows,sequences])}

def oracle(conn,parts,generation=None,overrides=None):
    """Independent SQL readback. No production mapping/normalization helper used."""
    wanted={r['id']:r for p in parts for r in p['tables']['performances']};wanted.update(overrides or {})
    if generation is None:generation=conn.execute("SELECT max(generation) FROM ingest.dataset_snapshots WHERE status='sealed'").fetchone()[0]
    columns=','.join('s.'+FIELDS[k] for k in FIELDS)
    sql="SELECT r.external_key,s.revision_id,s.source_record_id,s.match_id,s.player_id,s.team_id,s.match_player_revision_id,s.source_id,s.period_code,s.period_definition_version,s.variant_key,s.recorded_from_gen,"+columns+" FROM football.player_match_stats s JOIN ingest.source_records r ON r.id=s.source_record_id WHERE s.is_canonical AND ingest.selected_at(%s,s.recorded_from_gen,s.recorded_to_gen) AND r.external_key=ANY(%s)"
    wide=list(conn.execute(sql,(generation,list(wanted))))
    metric_sql="SELECT source_record_id,metric_code,value_kind,numeric_value,text_value,boolean_value,numerator,denominator,source_display,match_id,player_id,team_id,match_player_revision_id,source_id,period_code,period_definition_version,variant_key,recorded_from_gen,recorded_to_gen,metric_definition_version FROM football.player_match_metric_values WHERE is_canonical AND ingest.selected_at(%s,recorded_from_gen,recorded_to_gen)"
    metrics={(v[0],v[1]):v for v in conn.execute(metric_sql,(generation,))};errors=[];observations=[]
    for row in wide:
        source=wanted[row[0]]
        for index,(field,target) in enumerate(FIELDS.items()):
            v=source.get(field,ABSENT);kind='absent' if v is ABSENT else 'null' if v is None else 'boolean' if isinstance(v,bool) else 'string' if isinstance(v,str) else 'number'
            value=metrics.get((row[2],'legacy_normalized_'+field));actual_common=row[12+index]
            if value is None:errors.append('unknown_missing:'+field);continue
            expected=(None,None,None)
            if kind=='number':expected=(Decimal(str(v)),None,None)
            elif kind=='string':expected=(None,v,None)
            elif kind=='boolean':expected=(None,None,v)
            common_ok=actual_common is None if kind!='number' else actual_common is not None and Decimal(str(actual_common))==Decimal(str(v))
            bindings_ok=tuple(value[9:17])==tuple(row[3:11]) and value[17]<=row[11] and (value[18] is None or row[11]<value[18])
            ok=value[2]==kind and tuple(value[3:6])==expected and all(x is None for x in value[6:9]) and common_ok and bindings_ok and value[19]==VERSION
            if not ok:errors.append('native_common_binding:'+field)
            observations.append((row[0],field,kind,expected,actual_common,bindings_ok))
    if len(wide)!=len(wanted):errors.append('wide_membership')
    return {'expectedSlots':len(wanted)*31,'typedSlots':len(observations),'unknownMissingRows':sum(x.startswith('unknown_missing') for x in errors),'errors':sorted(set(errors)),
            'sha256':digest(observations),'wideSql':sql,'metricSql':metric_sql,'generation':generation},not errors and len(observations)==len(wanted)*31

def correction(conn,actor,parts):
    row=next(r for r in parts[0]['tables']['performances'] if r['id'].endswith('zero'));changed=copy.deepcopy(row)
    changed.pop('goals');changed.update(assists=None,npxg=Decimal('0.5'),rating='',goalsPrevented=False)
    prior=actor.stats[row['id']];old_g=prior['recorded_from_gen'];old_native=actor.common_native[row['id']]
    with conn.transaction():
        actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-native31-correction',VERSION,VERSION)).fetchone()[0]
        conn.execute('UPDATE football.player_match_stats SET recorded_to_gen=%s WHERE revision_id=%s',(actor.g,prior['revision_id']))
        values={k:v for k,v in prior.items() if not actor.tables['football.player_match_stats']['columns'][k].get('identity')}
        values.update(actor.stats_values(changed),recorded_from_gen=actor.g,recorded_to_gen=None)
        fresh=actor.insert('football.player_match_stats',**values);states=actor.insert_common_native_states(changed,fresh,prior=old_native)
        conn.execute('SELECT ingest.seal_generation(%s,%s)',(actor.g,digest({'synthetic':'correction'})))
    actor.stats[row['id']]=fresh
    old,ok_old=oracle(conn,parts,old_g);new,ok_new=oracle(conn,parts,overrides={row['id']:changed})
    def native_token(v):
        return ('absent',) if v is ABSENT else ('null',) if v is None else ('boolean',v) if isinstance(v,bool) else ('string',v) if isinstance(v,str) else ('number',Decimal(str(v)))
    unchanged=[k for k in FIELDS if native_token(changed.get(k,ABSENT))==native_token(row.get(k,ABSENT))]
    assert all(states[k]['revision_id']==old_native[k]['revision_id'] for k in unchanged)
    return {'oldOracle':old,'newOracle':new,'newGeneration':actor.g,'changedId':row['id'],'unchangedScalarRevisionsRetained':len(unchanged)},ok_old and ok_new

def worker():
    import psycopg
    normalizer=module();parts=fixture('all')
    with psycopg.connect(os.environ['ORION_PILOT_DATABASE_URL'],autocommit=True) as conn:
        conn.execute('SET ROLE orion_pro_ingest');actor=normalizer.TypedCore(conn,Path(os.environ['ORION_NATIVE_EVIDENCE']),SyntheticSource(parts));result=actor.import_core(parts)
        assert result['reused'] and len(actor.stats)==len(parts[0]['tables']['performances'])
        assert normalizer.VERSION==VERSION
    print(json.dumps({'status':'pass','pid':os.getpid(),'reused':True,'version':VERSION}));return 0

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--label',default='native31');parser.add_argument('--worker',action='store_true');parser.add_argument('--pg-bin',type=Path,default=Path('/tmp/statarena-cache-test-tools/node_modules/@embedded-postgres/darwin-arm64/native/bin'));args=parser.parse_args()
    if args.worker:return worker()
    run=DOC/'runs'/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+args.label);run.mkdir(parents=True);inputs=run/'inputs';inputs.mkdir()
    for path in [Path(__file__),NORMALIZER,MODEL,DOC/'PROTOCOL.md',DOC/'PLAN.md',DOC/'FIELD_MATRIX.json',PILOT/'harness.py',PILOT/'approval.json',PILOT/'model-amendments.json',LEGACY]:
        shutil.copy2(path,inputs/('legacy-normalizer.py' if path==LEGACY else path.name))
    sys.path.insert(0,str(PILOT));from harness import LocalPostgres
    import psycopg
    pg=LocalPostgres(args.pg_bin,run);conn=None;report={'environment':'owned disposable LOCAL PostgreSQL18.6; explicit synthetic fixtures only','command':'PYTHONPATH=/tmp/statarena-publication-test-python '+shlex.join([sys.executable,*sys.argv]),'modelSha256':sha(MODEL),'normalizerSha256':sha(NORMALIZER),'testSha256':sha(Path(__file__)),'expectedAdditionalFields':27,'newRealStatesVerified':0,'realStatesAwaitingFutureCapture':416799,'fullAcceptance':False,'awsQueries':0,'remoteWrites':[],'cases':[]}
    cases=['numeric31_registry_and_oracle','invalid_complete_imports_atomic','five_native_states_precision','canonical_incoherence_refused','variant_observation_retained','correction_old_snapshot','fresh_process_noop','legacy_receipt_rejected']
    normalizer=module();parts=fixture('base');actor=None;blocked=None
    def reset():
        nonlocal conn
        if conn is not None:conn.close()
        pg.migration(REPO,rollback_to='empty');pg.migration(REPO);conn=psycopg.connect(pg.dsn,autocommit=True);conn.execute('SET ROLE orion_pro_ingest')
    try:
        pg.start();pg.migration(REPO);conn=psycopg.connect(pg.dsn,autocommit=True);conn.execute('SET ROLE orion_pro_ingest')
        for case in cases:
            if blocked:report['cases'].append({'case':case,'status':'unverified','reason':blocked});continue
            try:
                if case=='numeric31_registry_and_oracle':
                    actor=normalizer.TypedCore(conn,run,SyntheticSource(parts));actor.import_core(parts);actual,ok=oracle(conn,parts)
                    assert ok,'Expected31native slots; actual SQL oracle '+json.dumps(actual)
                    assert normalizer.VERSION==VERSION
                    assert set(normalizer.COMMON_NATIVE)==set(FIELDS)
                    definitions=list(conn.execute("SELECT code,unit,scope,aggregation,allows_negative FROM football.metric_definitions WHERE definition_version=%s ORDER BY code",(VERSION,)))
                    assert definitions==sorted(('legacy_normalized_'+f,'source_native','player','none',f in {'rating','goalsPrevented'}) for f in FIELDS)
                    mappings=list(conn.execute("SELECT raw_key,metric_code,metric_definition_version,mapping_version,parse_rule->>'common_column',parse_rule->>'common_sql_type',parse_rule->>'number_projection' FROM football.source_metric_mappings WHERE source_id=%s AND family_code='normalized_performance' ORDER BY raw_key",(actor.ids['source'],)))
                    assert mappings==sorted((f,'legacy_normalized_'+f,VERSION,VERSION,FIELDS[f],SQL_TYPES[f],NUMBER_RULES[SQL_TYPES[f]]) for f in FIELDS),'Persisted parse rule does not distinguish exact numeric/int32/double contracts'
                    actual['registrySql']={'definitions':definitions,'mappings':mappings}
                elif case=='invalid_complete_imports_atomic':
                    reset();baseline=fingerprint(conn,False);outcomes=[]
                    probes=[(f,v) for f in sorted(COUNT) for v in [Decimal('0.5'),2147483648,-1]]+[(f,Decimal('0.123456789012345678901234567891')) for f in ['npxg','rating','goalsPrevented']]+[('rating',Decimal('NaN')),('rating',Decimal('Infinity')),('goals',{}),('goals',[])]+[(f,3) for f in ['passesAccurate','aerialsWon','dribbles']]
                    for field,value in probes:
                        bad=fixture('base');bad[0]['tables']['performances']=bad[0]['tables']['performances'][:1];bad[0]['tables']['performances'][0][field]=value
                        try:normalizer.TypedCore(conn,run,SyntheticSource(bad)).import_core(bad)
                        except normalizer.MappingError as error:accepted=False;reason=str(error)
                        else:accepted=True;reason=None
                        unchanged=fingerprint(conn,False)==baseline
                        outcomes.append({'field':field,'syntheticValue':str(value),'accepted':accepted,'reason':reason,'committedTablesUnchanged':unchanged})
                        assert not accepted and unchanged,(field,str(value),reason)
                    actual={'outcomes':outcomes,'sequenceGapsFromRollbackPermitted':True}
                elif case=='five_native_states_precision':
                    parts=fixture('all');actor=normalizer.TypedCore(conn,run,SyntheticSource(parts));actor.import_core(parts);actual,ok=oracle(conn,parts);assert ok,actual
                    current_report=normalizer.common_native_oracle(conn,parts)
                    assert current_report['sourceRows']==len(parts[0]['tables']['performances'])*31 and current_report['sourceSha256']==current_report['typedSha256'],'Current native report still uses a four-slot/numeric-only projection'
                    actual['productionReport']=current_report
                elif case=='canonical_incoherence_refused':
                    row=next(r for r in parts[0]['tables']['performances'] if r['id'].endswith('zero'));bad=dict(row,goals=1);before=fingerprint(conn)
                    stale=copy.deepcopy(actor.common_native[row['id']]);stale['goals']['metric_definition_version']='real_source_core_v1'
                    try:actor.insert_common_native_states(row,actor.stats[row['id']],prior=stale)
                    except normalizer.MappingError:stale_refused=True
                    else:stale_refused=False
                    assert stale_refused and fingerprint(conn)==before,'Same value/binding reused a synthetic stale v1 definition under a v2 target'
                    try:actor.insert_common_native_states(bad,actor.stats[row['id']],prior=actor.common_native[row['id']])
                    except normalizer.MappingError:refused=True
                    else:refused=False
                    assert refused and fingerprint(conn)==before
                    class Rollback(Exception):pass
                    detected=False
                    try:
                        with conn.transaction():
                            actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-mismatch-audit',VERSION,VERSION)).fetchone()[0]
                            old=actor.stats[row['id']];conn.execute('UPDATE football.player_match_stats SET recorded_to_gen=%s WHERE revision_id=%s',(actor.g,old['revision_id']))
                            values={k:v for k,v in old.items() if not actor.tables['football.player_match_stats']['columns'][k].get('identity')};values.update(goals=1,recorded_from_gen=actor.g,recorded_to_gen=None)
                            actor.insert('football.player_match_stats',**values)
                            audit,ok=oracle(conn,parts,actor.g);detected=not ok
                            raise Rollback()
                    except Rollback:pass
                    actual={'producerRefused':refused,'stalePriorDefinitionRefused':stale_refused,'independentSqlOracleDetected':detected};assert detected
                elif case=='variant_observation_retained':
                    row=parts[0]['tables']['performances'][0];prior=actor.stats[row['id']]
                    with conn.transaction():
                        actor.g=conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',('synthetic-native-alternative',VERSION,VERSION)).fetchone()[0]
                        record=actor.subrecord(prior['source_record_id'],'/synthetic_variant','synthetic_alternative',row['id']+':variant')
                        values={k:v for k,v in prior.items() if not actor.tables['football.player_match_stats']['columns'][k].get('identity')};values.update(source_record_id=record,variant_key='synthetic:alternative',is_canonical=False,recorded_from_gen=actor.g,recorded_to_gen=None)
                        alt=actor.insert('football.player_match_stats',**values);states=actor.insert_common_native_states(row,alt)
                        conn.execute('SELECT ingest.seal_generation(%s,%s)',(actor.g,digest({'synthetic':'alternative'})))
                    binding_sql="SELECT count(*),bool_and(NOT is_canonical AND variant_key='synthetic:alternative' AND match_id=%s AND player_id=%s AND team_id=%s AND match_player_revision_id=%s AND period_code='full_match' AND period_definition_version='bootstrap_v1') FROM football.player_match_metric_values WHERE source_record_id=%s"
                    native_count,bindings=conn.execute(binding_sql,(prior['match_id'],prior['player_id'],prior['team_id'],prior['match_player_revision_id'],record)).fetchone()
                    actual={'alternateScalarRows':len(states),'independentSqlRows':native_count,'bindingSql':binding_sql,'bindingMatches':bindings,'sameSourceRecord':all(r['source_record_id']==record for r in states.values()),'noncanonical':all(not r['is_canonical'] for r in states.values())};assert native_count==31 and bindings and actual['alternateScalarRows']==31 and actual['sameSourceRecord'] and actual['noncanonical']
                elif case=='correction_old_snapshot':
                    actual,ok=correction(conn,actor,parts);assert ok,actual
                elif case=='fresh_process_noop':
                    before=fingerprint(conn);env=os.environ.copy();env.update(ORION_PILOT_DATABASE_URL=pg.dsn,ORION_NATIVE_EVIDENCE=str(run),STATARENA_TEST_DATABASE='1')
                    command=[sys.executable,str(Path(__file__)),'--worker'];result=subprocess.run(command,env=env,text=True,capture_output=True,timeout=90)
                    (run/'fresh-worker.stdout.log').write_text(result.stdout);(run/'fresh-worker.stderr.log').write_text(result.stderr)
                    after=fingerprint(conn);assert result.returncode==0 and before==after
                    actual={'worker':json.loads(result.stdout),'before':before,'after':after,'unchanged':True}
                elif case=='legacy_receipt_rejected':
                    reset();legacy=module(LEGACY);oldparts=fixture('base');oldactor=legacy.TypedCore(conn,run,SyntheticSource(oldparts));oldactor.import_core(oldparts);before=fingerprint(conn)
                    try:normalizer.TypedCore(conn,run,SyntheticSource(oldparts)).import_core(oldparts)
                    except normalizer.MappingError as error:refused=True;reason=str(error)
                    else:refused=False;reason=None
                    assert refused and before==fingerprint(conn)
                    oldrow=oldparts[0]['tables']['performances'][0];current_actor=normalizer.TypedCore(conn,run,SyntheticSource(oldparts))
                    try:current_actor.insert_common_native_states(oldrow,oldactor.stats[oldrow['id']],prior=oldactor.common_native[oldrow['id']])
                    except normalizer.MappingError as error:writer_refused=True;writer_reason=str(error)
                    else:writer_refused=False;writer_reason=None
                    assert writer_refused and before==fingerprint(conn),'Old-transform target must fail cleanly before a scalar SQL statement'
                    actual={'legacyVersion':legacy.VERSION,'newVersion':normalizer.VERSION,'refused':refused,'reason':reason,'directWriterRefused':writer_refused,'directWriterReason':writer_reason,'allRowsSequencesUnchanged':True}
                report['cases'].append({'case':case,'status':'pass','actual':actual});print('PASS '+case,flush=True)
            except Exception as error:
                report['cases'].append({'case':case,'status':'fail','error':str(error) if isinstance(error,(AssertionError,normalizer.MappingError)) else type(error).__name__,'sqlstate':getattr(error,'sqlstate',None)});print('FAIL '+case+': '+type(error).__name__,flush=True)
                blocked='prerequisite '+case+' failed'
    finally:
        if conn is not None:conn.close()
        report['cleanup']=pg.cleanup();report['counts']={s:sum(c['status']==s for c in report['cases']) for s in ['pass','fail','unverified']};report['status']='pass' if report['counts']['pass']==len(cases) else 'fail'
        (run/'result.json').write_text(json.dumps(report,indent=2,default=str)+'\n');print(json.dumps({'status':report['status'],'counts':report['counts'],'evidence':str(run)}),flush=True)
    return 0 if report['status']=='pass' else 1

if __name__=='__main__':raise SystemExit(main())
