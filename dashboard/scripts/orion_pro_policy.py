"""Closed M0 validator policy artifacts and bounded native inspection. No connection on import."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'docs/verification/orion-validator-guard-review-20261105'
DIRECTORY=ROOT/'dashboard/backend/schema-policies/orion-pro/guard-review-v2'
ARCHIVE_COMMIT='85033e90631b82d1257298ce54c72071fd091a61'
HISTORICAL_BASE=ROOT/'docs/verification/orion-validator-adoption-20261105'
HISTORICAL_MANIFEST=HISTORICAL_BASE/'final-hashes.json'
HISTORICAL_MANIFEST_SHA='d4e98446837e3ee01c8b081e1883867e6b80241acda157dac69d1e72e95601a3'
HISTORICAL_RESULT=HISTORICAL_BASE/'runs/20261105T010443812152Z-exact-journal-clocks-final-root-green/result.json'
HISTORICAL_RESULT_SHA='2c0ee1e7b7d873cd619c9703ec79e60baaa5cc5bfc847b9f0804816c9b513a3b'
INSPECTION_CONTRACT='native_views_schema_acl_default_acl_actor_roles_memberships_v2'
MODEL=ROOT/'docs/architecture/orion-plan-20261104/target-schema.proposed.json'
DOMAIN=ROOT/'dashboard/backend/migrations/012_orion_pro_domain.sql'
INTEGRITY=ROOT/'dashboard/backend/migrations/013_orion_pro_integrity.sql'
UPGRADE=ROOT/'dashboard/backend/migrations/014_orion_pro_membership_nonnull.sql'
ORACLE=DIRECTORY/'m18da43-p014-local-oracle-v1.json'
P0='original-m18da43-v1'
P1='membership-nonnull-m18da43-v1'
P2='membership-original-restored-m18da43-local099-v1'
RESTORE=BASE/'local-compensation/099_restore_original_validator.sql'
PATHS={P0:DIRECTORY/'m18da43-p013-original-v1.json',P1:DIRECTORY/'m18da43-p014-membership-nonnull-v1.json',P2:BASE/'local-compensation/m18da43-p099-local-restore-v1.json'}
MODEL_SHA='18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08'
P1_SQL_SHA='e0810f8670b2cb627ade2c76e3c8eb527ab31fd595d5cf939fd63bfc5cf649d6'
P1_FUNCTION_SHA='30f86fa262fd4cf10307e78431350f25b9d7a5b353d0c76abc0594340edb5d20'
P0_FUNCTION_SHA='246af203d171f286b3760ccdc67b579dbce967b5f209e3fb0825bc00b9211eaa'
PROOF=ROOT/'docs/verification/orion-validator-membership-20261105/runs/20261104T235918721381Z-nullable-candidate-final-authorized-load/result.json'
PROOF_SHA='925cf8676d99e18617d711c1a56140eceed84450adc351f23f90af5aef23866f'
PINNED={MODEL:MODEL_SHA,DOMAIN:'f255868599c72d69f40f575a919045325ea1093a00fe4f5a6b96eae9f2c49f65',INTEGRITY:'85525221cad51b32aff79a777098211b4112f9f00ea7161ac93945654eeb6968',PROOF:PROOF_SHA,HISTORICAL_MANIFEST:HISTORICAL_MANIFEST_SHA,HISTORICAL_RESULT:HISTORICAL_RESULT_SHA,
        ROOT/'docs/verification/orion-pro-pilot-20261104/approval.json':'f9889e67bd2856ba9c64925a002c376c8fce4928c503a2a6229a066ec4f73db4',ROOT/'docs/verification/orion-pro-pilot-20261104/model-amendments.json':'26cd089172da08687f055497e37fbfa9fb5bf06a151d8affafc4b7290d956c66',
        ROOT/'dashboard/scripts/orion_pro_migrate.py':'d9bdf60ef48a527276499fedb82a435c26b42653432d3a1a3c94cc2db02ee2dd',ROOT/'dashboard/scripts/orion_pro_schema.py':'6f4578b10c2344885bbf79ab0853fe0f0fd7fffa0663ee74600f5c6ebbe544c3',ROOT/'dashboard/scripts/orion_pro_integrity.py':'32aa1c84cbf3900b28fe2c1e186e4ba56695f83aeea17d5d1336882fec9aae85'}
META_MAX=32*1024**2
BUFFER_MAX=16*1024**2
ROW_MAX=1024**2

class Refusal(Exception):
    def __init__(self,code,message):self.code=code;super().__init__(message)
def require(ok,code,message):
    if not ok:raise Refusal(code,message)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def hashed(x):return hashlib.sha256(canonical(x)).hexdigest()
def text(x):return json.dumps(x,indent=2,ensure_ascii=False)+'\n'
def relative(p):return str(p.relative_to(ROOT))
def q(x):
    require(bool(re.fullmatch('[a-z_][a-z0-9_]*',x)),'MODEL','Invalid fixed identifier');return '"'+x+'"'
def relation(x):return '.'.join(q(p) for p in x.split('.'))
def bounded_json(p,maximum=8*1024**2):
    require(p.is_file() and p.stat().st_size<=maximum,'ARTIFACT','Missing or oversized local artifact')
    try:return json.loads(p.read_text())
    except (ValueError,UnicodeError):raise Refusal('ARTIFACT','Malformed local artifact') from None
def memory_bytes(*objects):
    seen=set();pending=list(objects);total=0
    while pending:
        item=pending.pop()
        if id(item) in seen:continue
        seen.add(id(item));total+=sys.getsizeof(item)
        if isinstance(item,dict):pending.extend(item.keys());pending.extend(item.values())
        elif isinstance(item,(list,tuple,set)):pending.extend(item)
    total+=sys.getsizeof(seen)+sys.getsizeof(pending)
    require(total<=META_MAX,'BOUND','Retained metadata exceeds32MiB');return total

def fixed_inputs():
    require(all(p.is_file() and sha(p)==h for p,h in PINNED.items()),'MODEL','Sealed M0/compiler012013 bytes differ')
    require(UPGRADE.is_file() and sha(UPGRADE)==P1_SQL_SHA,'SQL','Exact014 function bytes differ')
    return json.loads(MODEL.read_text())
def function_sql(original=False):
    if not original:return UPGRADE.read_text()
    source=INTEGRITY.read_text();start=source.index('CREATE OR REPLACE FUNCTION "ingest"."validate_generation"(');end=source.index('$orion_pro$;',start)+len('$orion_pro$;')
    return source[start:end]+'\n'
def equivalence():
    model=fixed_inputs();tables={t['qualified_name']:t for s in model['schemas'] for t in s['tables'] if t['phase']!='models'}
    old=function_sql(True).removesuffix('\n');new=function_sql().removesuffix('\n')
    restored,changed=re.subn(r'(selected_parent\."(?P<c>[a-z_]+)") = (anchor\."(?P=c)")',lambda m:m[1]+' IS NOT DISTINCT FROM '+m[3],new)
    require(restored==old and changed==139,'EQUIVALENCE','Function delta is not the exact139 substitutions')
    clauses=[line for line in new.splitlines() if ' selected_parent ' in line];retained=0
    for line in clauses:
        match=re.search(r'FROM "([a-z_]+)"\."([a-z_]+)" selected_parent',line);require(match is not None,'EQUIVALENCE','Unrecognized membership clause')
        parent=tables[match[1]+'.'+match[2]]
        for m in re.finditer(r'selected_parent\."([a-z_]+)" (IS NOT DISTINCT FROM|=) anchor\."\1"',line):
            nullable=parent['columns'][m[1]]['nullable'];require(m[2]==('IS NOT DISTINCT FROM' if nullable else '='),'EQUIVALENCE','Wrong membership operator');retained+=nullable
    require(len(clauses)==81 and retained==46 and hashlib.sha256(old.encode()).hexdigest()==P0_FUNCTION_SHA and hashlib.sha256(new.encode()).hexdigest()==P1_FUNCTION_SHA,'EQUIVALENCE','Closed equivalence counts/hash differ')
    return {'clauses':81,'changed':139,'retained':46,'exactReversal':True,'modelSha256':MODEL_SHA}

CATALOGUE_SQL="""SELECT kind,key,definition FROM (
 SELECT 'table' kind,n.nspname||'.'||c.relname key,ROW(c.relkind,c.relrowsecurity,pg_get_userbyid(c.relowner),c.relacl::text,c.reloptions)::text definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind IN ('r','p')
 UNION ALL SELECT 'column',n.nspname||'.'||c.relname||'.'||a.attnum,ROW(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),a.attacl::text)::text
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'constraint',n.nspname||'.'||c.relname||'.'||k.conname,ROW(pg_get_constraintdef(k.oid),k.convalidated,k.condeferrable,k.condeferred)::text FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics')
 UNION ALL SELECT 'index',schemaname||'.'||indexname,indexdef FROM pg_indexes WHERE schemaname IN ('ingest','football','analytics')
 UNION ALL SELECT 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,ROW(t.tgenabled,pg_get_triggerdef(t.oid))::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND NOT t.tgisinternal
 UNION ALL SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',ROW(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl::text,to_jsonb(p)-ARRAY['oid','pronamespace','proowner','prolang','proargtypes','proallargtypes','prorettype'],l.lanname,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),obj_description(p.oid,'pg_proc'))::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN ('ingest','football','analytics')
 UNION ALL SELECT 'sequence',s.schemaname||'.'||s.sequencename,ROW(s.start_value,s.min_value,s.max_value,s.increment_by,s.cycle,s.cache_size,pg_get_userbyid(c.relowner),c.relacl::text)::text FROM pg_sequences s JOIN pg_namespace n ON n.nspname=s.schemaname JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=s.sequencename WHERE s.schemaname IN ('ingest','football','analytics')
 UNION ALL SELECT 'schema',n.nspname,ROW(pg_get_userbyid(n.nspowner),n.nspacl::text)::text FROM pg_namespace n WHERE n.nspname IN ('ingest','football','analytics')
 UNION ALL SELECT 'view',n.nspname||'.'||c.relname,ROW(c.relkind,pg_get_userbyid(c.relowner),c.relacl::text,c.reloptions,pg_get_viewdef(c.oid),ARRAY(SELECT ROW(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END)::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum))::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind IN ('v','m')
 UNION ALL SELECT 'role',r.rolname,ROW(r.rolsuper,r.rolinherit,r.rolcreaterole,r.rolcreatedb,r.rolcanlogin,r.rolreplication,r.rolconnlimit,r.rolvaliduntil,r.rolbypassrls,r.rolconfig)::text FROM pg_roles r WHERE r.rolname IN ('policy_owner','policy_ingest','policy_runtime')
 UNION ALL SELECT 'membership',r.rolname||'->'||m.rolname,ROW(g.rolname,a.admin_option,a.inherit_option,a.set_option)::text FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor WHERE r.rolname IN ('policy_owner','policy_ingest','policy_runtime') OR m.rolname IN ('policy_owner','policy_ingest','policy_runtime')
 UNION ALL SELECT 'default_acl',r.rolname||'.'||coalesce(n.nspname,'GLOBAL')||'.'||d.defaclobjtype::text,d.defaclacl::text FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE (d.defaclnamespace=0 OR n.nspname IN ('ingest','football','analytics')) AND (r.rolname IN ('policy_owner','policy_ingest','policy_runtime') OR d.defaclrole IN (SELECT nspowner FROM pg_namespace WHERE nspname IN ('ingest','football','analytics') UNION SELECT c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') UNION SELECT p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('ingest','football','analytics')))
) catalogue ORDER BY kind,key"""

def streamed(conn,sql):
    with conn.cursor() as cursor:
        for row in cursor.stream(sql,size=1):
            size=sum(len(str(v).encode()) if v is not None else 1 for v in row)
            require(size<=ROW_MAX and size*4+1024<=BUFFER_MAX,'BOUND','Native row exceeds transport bound')
            yield row
def catalogue(conn):
    rows=[];retained=0
    for row in streamed(conn,CATALOGUE_SQL):
        retained+=512+2*sum(sys.getsizeof(value) for value in row)
        require(len(rows)<20000 and retained<=8*1024**2,'BOUND','Catalogue retained budget exceeded')
        rows.append(list(row))
    memory_bytes(rows);return {'rows':rows,'sha256':hashed(rows)}
def nullability(conn):
    rows=list(conn.execute("SELECT n.nspname||'.'||c.relname,a.attname,a.attnotnull FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('ingest','football','analytics') AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2"))
    model=fixed_inputs();expected={(t['qualified_name'],c):not v['nullable'] for s in model['schemas'] for t in s['tables'] if t['phase']!='models' for c,v in t['columns'].items()}
    require({(r[0],r[1]):r[2] for r in rows}==expected and len(rows)==1709,'CATALOGUE','Actual nullability differs from M0');return rows
def function_properties(conn):
    row=conn.execute("SELECT p.oid::text,pg_get_userbyid(p.proowner),(to_jsonb(p)-ARRAY['prosrc','oid','pronamespace','proowner','prolang','proargtypes','proallargtypes','prorettype'])::text,l.lanname,pg_get_function_arguments(p.oid),pg_get_function_result(p.oid),obj_description(p.oid,'pg_proc') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='ingest' AND p.proname='validate_generation' AND p.proargtypes='20'::oidvector").fetchall()
    require(len(row)==1,'CATALOGUE','Expected one bigint validator');return list(row[0])
def native_state(conn):
    model=fixed_inputs();tables={t['qualified_name']:t for s in model['schemas'] for t in s['tables'] if t['phase']!='models' and t['qualified_name']!='ingest.schema_migrations'};results={};total=0;peak=0
    for name,t in sorted(tables.items()):
        h=hashlib.sha256();count=0
        sql='SELECT ROW(t.*)::text FROM '+relation(name)+' t ORDER BY '+','.join('t.'+q(c) for c in t['primary_key']['columns'])
        for (value,) in streamed(conn,sql):
            b=value.encode();peak=max(peak,len(b)*4+1024);h.update(len(b).to_bytes(8,'big'));h.update(b);count+=1;total+=1
            require(count<=500000 and total<=2000000,'BOUND','Native row count cap exceeded')
        results[name]={'rows':count,'sha256':h.hexdigest()}
    return {'tables':results,'sha256':hashed(results),'rows':total,'bufferPeakBytes':peak}

def bootstrap_contract():
    model=fixed_inputs();artifact={'model':MODEL_SHA,'migrator':PINNED[ROOT/'dashboard/scripts/orion_pro_migrate.py'],'migrations':{'012':PINNED[DOMAIN],'013':PINNED[INTEGRITY]}}
    return {'artifact':artifact,'artifactSha256':hashed(artifact),'manifestSha256':hashed({'bootstrap':model['seed_data'],'artifact':hashed(artifact)})}
def historical_checkpoint():
    return {'gitCommit':ARCHIVE_COMMIT,'manifestPath':relative(HISTORICAL_MANIFEST),'manifestSha256':HISTORICAL_MANIFEST_SHA,'functional14ClockResultPath':relative(HISTORICAL_RESULT),'functional14ClockResultSha256':HISTORICAL_RESULT_SHA,'meaning':'Historical functional14/14; expanded guards qualified by separate v2 review, not retroactively'}
def artifact_contracts(oracle):
    """Pure preparation: oracle precedes manifests, receipts never point back from manifests."""
    equivalence();oracle_body=text(oracle);oracle_sha=hashlib.sha256(oracle_body.encode()).hexdigest();base=bootstrap_contract()
    shared={'kind':'orion_pro_validator_policy_v2','inspectionContract':INSPECTION_CONTRACT,'historicalCheckpoint':historical_checkpoint(),'modelSha256':MODEL_SHA,'localOnly':True,'baseline':base,'equivalence':{**equivalence(),'proofPath':relative(PROOF),'proofSha256':PROOF_SHA},'oracle':{'path':relative(ORACLE),'sha256':oracle_sha},'implementationSources':{relative(Path(__file__)):sha(Path(__file__)),relative(ROOT/'dashboard/scripts/orion_pro_upgrade.py'):sha(ROOT/'dashboard/scripts/orion_pro_upgrade.py')},'qualifiedImportPairs':[]}
    chain=[{'version':'012','path':relative(DOMAIN),'sha256':PINNED[DOMAIN]},{'version':'013','path':relative(INTEGRITY),'sha256':PINNED[INTEGRITY]}]
    p0={**shared,'policyId':P0,'parent':None,'scope':'baseline_policy_local','chain':chain,'catalogueKey':'P0','functionSqlSha256':P0_FUNCTION_SHA}
    p1={**shared,'policyId':P1,'parent':{'policyId':P0,'sha256':hashlib.sha256(text(p0).encode()).hexdigest()},'scope':'validator_policy_local_adoption_014','chain':chain+[{'version':'014','path':relative(UPGRADE),'sha256':P1_SQL_SHA}],'catalogueKey':'P1','functionSqlSha256':P1_FUNCTION_SHA}
    restore=function_sql(True);p2={**shared,'policyId':P2,'parent':{'policyId':P1,'sha256':hashlib.sha256(text(p1).encode()).hexdigest()},'scope':'validator_policy_local_compensation_099','chain':p1['chain']+[{'version':'099','path':relative(RESTORE),'sha256':hashlib.sha256(restore.encode()).hexdigest()}],'catalogueKey':'P0','functionSqlSha256':P0_FUNCTION_SHA}
    return {ORACLE:oracle_body,PATHS[P0]:text(p0),PATHS[P1]:text(p1),RESTORE:restore,PATHS[P2]:text(p2)}
def build_artifacts(p0,p1):
    delta=[(left,right) for left,right in zip(p0['rows'],p1['rows']) if left!=right]
    require(len(p0['rows'])==len(p1['rows']) and len(delta)==1 and delta[0][0][:2]==delta[0][1][:2] and delta[0][0][0]=='function' and delta[0][0][1]=='ingest.validate_generation(g bigint)','CATALOGUE','Overlay changes more than the sole validator row')
    oracle={'kind':'owned_pg18_local_validator_policy_oracle_v2','inspectionContract':INSPECTION_CONTRACT,'historicalCheckpoint':historical_checkpoint(),'serverVersion':180006,'sourceSha256':{relative(p):h for p,h in PINNED.items()},'helperSha256':sha(Path(__file__)),'runnerSha256':sha(ROOT/'dashboard/scripts/orion_pro_upgrade.py'),'preparation':'Captured in owned local E2E; completed receipt/cleanup required for ROOT release acceptance','P0':p0,'P1':p1}
    return artifact_contracts(oracle)
def load_policy(policy_id=P1,expected_sha=None):
    require(policy_id in PATHS,'POLICY','Unknown policy; no path/latest input is accepted');fixed_inputs()
    oracle=bounded_json(ORACLE);require(set(oracle)=={'kind','inspectionContract','historicalCheckpoint','serverVersion','sourceSha256','helperSha256','runnerSha256','preparation','P0','P1'} and oracle.get('kind')=='owned_pg18_local_validator_policy_oracle_v2' and oracle.get('inspectionContract')==INSPECTION_CONTRACT and oracle.get('historicalCheckpoint')==historical_checkpoint() and oracle.get('serverVersion')==180006 and oracle['sourceSha256']=={relative(p):h for p,h in PINNED.items()} and oracle['helperSha256']==sha(Path(__file__)) and oracle['runnerSha256']==sha(ROOT/'dashboard/scripts/orion_pro_upgrade.py'),'MANIFEST','Unexpected local policy oracle/source binding')
    require(all(set(oracle[k])=={'rows','sha256'} and hashed(oracle[k]['rows'])==oracle[k]['sha256'] for k in ['P0','P1']),'MANIFEST','Oracle catalogue digest differs')
    expected=artifact_contracts(oracle);actual={p:p.read_text() if p.is_file() else None for p in expected}
    require(all(actual[p]==body for p,body in expected.items()),'MANIFEST','Closed manifests/oracle/compensation bytes differ')
    path=PATHS[policy_id];h=sha(path);require(expected_sha is None or expected_sha==h,'MANIFEST','Expected manifest hash differs')
    memory=memory_bytes(oracle,json.loads(actual[path]));return {'manifest':json.loads(actual[path]),'manifestSha256':h,'oracle':oracle,'metadataBytes':memory}
