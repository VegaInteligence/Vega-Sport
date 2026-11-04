"""Existing AWS source documents -> disposable LOCAL approved typed PostgreSQL.

No remote mutation, provider request, source-body file, or alternate source store.
Core import is an explicitly bounded projection. Native/family gaps prevent full
acceptance; the model is never patched by this importer.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
import pickle
import socket
import stat
import sys

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT / "docs/architecture/orion-plan-20261104/target-schema.proposed.json"
VERSION = "real_source_core_v2_native31"
SHA = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
MISSING = object()
CORE_METRICS = {
    "goals":"goals", "assists":"assists", "shots":"shots", "shotsOnTarget":"shots_on_target",
    "chancesCreated":"chances_created", "bigChancesCreated":"big_chances_created",
    "passesAccurate":"passes_completed", "passesAttempted":"passes_attempted", "passesFinalThird":"passes_final_third",
    "defensiveActions":"defensive_actions", "interceptions":"interceptions", "tackles":"tackles", "recoveries":"recoveries",
    "duelsWon":"duels_won", "duelsLost":"duels_lost", "aerialsWon":"aerial_duels_won", "aerialDuels":"aerial_duels_attempted",
    "touches":"touches", "touchesBox":"touches_box", "clearances":"clearances", "blocks":"blocks",
    "dribbles":"dribbles_completed", "dribblesAttempted":"dribbles_attempted", "saves":"saves",
    "xg":"xg", "npxg":"non_penalty_xg", "xa":"xa", "xgot":"xgot", "minutes":"minutes_played",
    "rating":"provider_rating", "goalsPrevented":"goals_prevented",
}
SHOT_MAP = {"xg":"xg", "xgot":"xgot", "minute":"minute", "minuteAdded":"minute_added",
            "isGoal":"is_goal", "isOwnGoal":"is_own_goal", "isOnTarget":"is_on_target",
            "isBlocked":"is_blocked", "insideBox":"is_inside_box", "shotType":"source_shot_type",
            "type":"source_event_type", "situation":"situation"}
HISTORICAL_NATIVE_FIELDS = ("xg","xa","xgot","minutes")
COMMON_NATIVE = dict(CORE_METRICS)
SIGNED_COMMON_NATIVE = {"rating","goalsPrevented"}
PERFORMANCE_STRUCTURAL = {"id","playerRef","playerId","teamId","team","matchId","leagueId","league","country","season","date","role","positionId","rawPitchX","rawPitchY","shirtNumber","starter","statsReliable","isCaptain"}
PERIODS = {"1":"first_half", "1st":"first_half", "first_half":"first_half", "2":"second_half", "2nd":"second_half", "second_half":"second_half",
           "ALL":"full_match", "all":"full_match", "All":"full_match", "full_match":"full_match", "1H":"first_half", "2H":"second_half",
           "FirstHalf":"first_half", "SecondHalf":"second_half"}


def canonical_decimal(value):
    """Semantic decimal spelling using its tuple only, never Decimal context."""
    if not value.is_finite():
        raise ValueError("Non-finite source number")
    sign,digits,exponent = value.as_tuple()
    if not any(digits):
        return "0"
    text = ''.join(str(digit) for digit in digits)
    if exponent >= 0:
        number = text + '0'*exponent
    else:
        point = len(text)+exponent
        if point > 0:
            integer,fraction = text[:point],text[point:]
        else:
            integer,fraction = '0','0'*(-point)+text
        fraction = fraction.rstrip('0')
        number = integer + ('.'+fraction if fraction else '')
    return ('-' if sign else '')+number


def normalized(value):
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("Non-finite source number")
        return {"number":canonical_decimal(value)}
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Non-finite typed number")
        return {"number":canonical_decimal(Decimal(str(value)))}
    if type(value) is int:
        return {"number":str(value)}
    if isinstance(value, dict):
        return {k:normalized(v) for k,v in sorted(value.items())}
    if isinstance(value, (list, tuple)):
        return [normalized(v) for v in value]
    if isinstance(value, (datetime,date)):
        return value.isoformat()
    return value


def hashed(value):
    return hashlib.sha256(json.dumps(normalized(value), sort_keys=True, separators=(",",":"), ensure_ascii=False).encode()).hexdigest()


class MappingError(ValueError):
    """Metadata-only, never includes a source body or PostgreSQL row detail."""


class SourceReader:
    def __init__(self, evidence, *, max_run_queries=None, max_run_decoded_bytes=None):
        self.evidence = Path(evidence)
        self.ledger = self.evidence.parents[1] / "real-source-budget.json"
        self.total = json.loads(self.ledger.read_text()) if self.ledger.exists() else {"queries":0,"decodedBytes":0,"runs":[]}
        self.start_queries, self.start_bytes = self.total["queries"], self.total["decodedBytes"]
        self.receipts, self.cache, self.meta = [], {}, {}
        self.max_run_queries,self.max_run_decoded_bytes=max_run_queries,max_run_decoded_bytes

    def __enter__(self):
        self.db = psycopg.connect(host="statarena-postgres.clcy2iqyajbl.us-east-2.rds.amazonaws.com", dbname="statarena_prod", user="statarena_ingest",
            sslmode="verify-full", sslrootcert=str(ROOT / "dashboard/backend/certs/rds-us-east-2.pem"), connect_timeout=7, autocommit=True,
            options="-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000 -c max_parallel_workers_per_gather=0",
            application_name="statarena-real-source-local-pilot")
        self.db.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        rows = self.query("source_identity", "SELECT current_database(),current_user,current_setting('transaction_read_only'),pg_current_snapshot()::text,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())")
        if rows[0][0:3] != ("statarena_prod","statarena_ingest","on") or rows[0][-1] is not True:
            raise MappingError("Unexpected AWS read-only source identity")
        return self

    def query(self, name, sql, params=(), *, body_column=None):
        if self.total["queries"] >= 100:
            raise MappingError("Cumulative100-query AWS source budget exhausted")
        if self.max_run_queries is not None and self.total['queries']-self.start_queries>=self.max_run_queries:
            raise MappingError('Per-capture11-query source budget exhausted')
        self.total["queries"] += 1
        self.ledger.write_text(json.dumps(self.total,indent=2)+"\n")
        started = time.monotonic()
        item = {"name":name,"sql":sql,"parameters":params,"globalQueryNumber":self.total["queries"]}
        try:
            rows = self.db.execute(sql,params).fetchall()
            safe = []
            for row in rows:
                if body_column is not None:
                    text = row[body_column]
                    amount = len(text.encode()) if text is not None else 0
                    self.total["decodedBytes"] += amount
                    if self.max_run_decoded_bytes is not None and self.total['decodedBytes']-self.start_bytes>self.max_run_decoded_bytes:
                        raise MappingError('Per-capture32MiB decoded source budget exhausted')
                    if self.total["decodedBytes"] > 256*1024*1024:
                        raise MappingError("Cumulative256MiB decoded AWS source budget exhausted")
                    safe.append(list(row[:body_column])+[{"decodedBytes":amount,"decodedSha256":hashlib.sha256(text.encode()).hexdigest() if text else None}]+list(row[body_column+1:]))
                else:
                    safe.append(row)
            item.update(rowCount=len(rows),metadata=safe)
            return rows
        except psycopg.Error as error:
            item.update(errorType=type(error).__name__,sqlstate=error.sqlstate)
            raise MappingError("AWS source query failed: " + name + ": " + str(error.sqlstate)) from None
        finally:
            item["elapsedMs"] = round((time.monotonic()-started)*1000,3)
            self.receipts.append(item)
            self.ledger.write_text(json.dumps(self.total,indent=2)+"\n")
            (self.evidence / "source-queries.json").write_text(json.dumps(self.receipts,indent=2,default=str)+"\n")

    def documents(self, expected, batch_size=16):
        if not 1 <= batch_size <= 64:
            raise MappingError("Source document batch must contain at most64indexed paths")
        missing = [p for p in expected if p not in self.cache]
        for offset in range(0,len(missing),batch_size):
            paths = missing[offset:offset+batch_size]
            rows = self.query("indexed_source_documents", """SELECT p.path,encode(o.sha256,'hex'),s.status,s.error_count,o.size,o.updated_at,
                d.document::text FROM unnest(%s::text[]) p(path)
                LEFT JOIN statarena.objects o ON o.path=p.path
                LEFT JOIN statarena.file_document_sources s ON s.source_path=p.path AND s.source_sha256=o.sha256
                LEFT JOIN statarena.file_documents d ON d.document_path=p.path AND d.source_path=p.path AND d.source_sha256=o.sha256 AND d.error IS NULL
                ORDER BY p.path""", (paths,), body_column=6)
            for path,sha,status,errors,size,updated,text in rows:
                if sha != expected[path] or status != "ready" or errors != 0 or text is None:
                    raise MappingError("Current source version mismatch/unavailable: " + path)
                self.cache[path] = json.loads(text,parse_float=Decimal,parse_int=Decimal)
                self.meta[path] = {"path":path,"physicalSha256":sha,"bytes":size,"updatedAt":updated}
        for path,digest in expected.items():
            if self.meta[path]['physicalSha256']!=digest:raise MappingError('Cached source version differs: '+path)
        return {p:self.cache[p] for p in expected}

    def export_snapshot(self):
        for path,value in self.cache.items():self.meta[path]['decodedCanonicalSha256']=hashed(value)
        return {'format':'orion_source_memory_v1','cache':self.cache,'meta':self.meta,'profile_metadata':self.profile_metadata,
                'profile_gaps':self.profile_gaps,'sourceBudget':self.budget(),'captureCodeSha256':SHA}

    def profile_versions(self, parts, scope):
        provider_ids = {r["playerId"] for p in parts for r in p["tables"]["players"]}
        team_ids = {r["id"] for p in parts for r in p["tables"]["teams"]}
        endpoints = ["/players/"+p for p in sorted(provider_ids)] + ["/teams/"+p for p in sorted(team_ids)]
        rows = self.query("exact_scoped_profile_resource_versions", """SELECT r.endpoint,r.status,r.ref->>'path',r.ref->>'ordinal',encode(o.sha256,'hex'),s.status,s.error_count
            FROM statarena.resources r LEFT JOIN statarena.objects o ON o.path=r.ref->>'path'
            LEFT JOIN statarena.file_document_sources s ON s.source_path=o.path AND s.source_sha256=o.sha256
            WHERE r.endpoint=ANY(%s) AND r.params='{}' ORDER BY r.endpoint""", (endpoints,))
        self.profile_metadata = [{"endpoint":r[0],"status":r[1],"path":r[2],"ordinal":int(r[3]) if r[3] is not None else None,"sha256":r[4],"ready":r[5]=="ready" and r[6]==0} for r in rows]
        available = {r[0].split('/')[-1] for r in rows if r[0].startswith('/players/') and r[1]==200 and r[4] and r[5]=="ready" and r[6]==0}
        gaps = sorted(provider_ids-available)
        if set(gaps) != set(scope["sourceSummary"]["missingPlayerResourceLookupIds"]):
            raise MappingError("Scoped player profile lookup keys changed from the pinned source audit")
        return gaps

    def budget(self):
        result={"queries":self.total["queries"],"decodedBytes":self.total["decodedBytes"],
                "runQueries":self.total["queries"]-self.start_queries,"runDecodedBytes":self.total["decodedBytes"]-self.start_bytes,
                "limits":{"queries":100,"decodedBytes":256*1024*1024},"sourceConnection":"one verified-TLS repeatable-read READ ONLY connection"}
        if self.max_run_queries is not None:
            result['captureLimits']={'queries':self.max_run_queries,'decodedBytes':self.max_run_decoded_bytes}
        return result

    def __exit__(self, typ, value, traceback):
        try:
            self.db.execute("ROLLBACK")
        finally:
            self.db.close()
            self.total["runs"].append({"evidence":self.evidence.name,"queries":self.total["queries"]-self.start_queries,"decodedBytes":self.total["decodedBytes"]-self.start_bytes})
            self.ledger.write_text(json.dumps(self.total,indent=2)+"\n")


class MemorySource:
    """Trusted same-user Unix IPC source snapshot; never an AWS fallback."""
    def __init__(self,snapshot):
        if snapshot.get('format')!='orion_source_memory_v1':raise MappingError('Unknown memory source snapshot format')
        self.cache=snapshot['cache'];self.meta=snapshot['meta'];self.profile_metadata=snapshot['profile_metadata'];self.profile_gaps=snapshot['profile_gaps']
        self.captured_budget=snapshot['sourceBudget'];self.validated=set()

    @classmethod
    def from_socket(cls,path):
        path=Path(path)
        info=path.stat(follow_symlinks=False);parent=path.parent.stat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid!=os.getuid() or parent.st_uid!=os.getuid() or parent.st_mode&0o077:
            raise MappingError('Source IPC endpoint is not an owned private Unix socket')
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
            client.connect(str(path));client.sendall(b'GET\n')
            with client.makefile('rb') as stream:snapshot=pickle.load(stream)
        return cls(snapshot)

    def __enter__(self):return self
    def __exit__(self,*args):return False

    def documents(self,expected,batch_size=16):
        for path,digest in expected.items():
            if path not in self.cache or path not in self.meta or self.meta[path]['physicalSha256']!=digest:
                raise MappingError('Required source version is absent from the memory snapshot: '+path)
            if path not in self.validated:
                if hashed(self.cache[path])!=self.meta[path].get('decodedCanonicalSha256'):
                    raise MappingError('Memory source content digest differs: '+path)
                self.validated.add(path)
        return {path:self.cache[path] for path in expected}

    def profile_versions(self,parts,scope):
        players={r['playerId'] for p in parts for r in p['tables']['players']}
        endpoints=[r['endpoint'] for r in self.profile_metadata]
        if len(endpoints)!=len(set(endpoints)):raise MappingError('Duplicate source profile selectors in memory snapshot')
        available={r['endpoint'].split('/')[-1] for r in self.profile_metadata if r['endpoint'].startswith('/players/') and r['status']==200 and r['ready']}
        if set(self.profile_gaps)!=players-available or set(self.profile_gaps)!=set(scope['sourceSummary']['missingPlayerResourceLookupIds']):
            raise MappingError('Memory snapshot profile lookup membership differs from the pinned scope')
        return self.profile_gaps

    def budget(self):
        return {**self.captured_budget,'runQueries':0,'runDecodedBytes':0,'sourceConnection':'memory-only Unix IPC snapshot; no AWS connection'}


def source_memory_server(scope_path,evidence,socket_path,*,expected_queries=None,expected_decoded_bytes=None,check_only=False):
    """One approved real capture survives local iterations solely in RAM."""
    evidence=Path(evidence);evidence.mkdir(parents=True,exist_ok=True)
    endpoint=Path(socket_path)
    if endpoint.exists() or endpoint.parent.stat().st_uid!=os.getuid() or endpoint.parent.stat().st_mode&0o077:
        raise MappingError('Memory capture requires a fresh owned private socket directory')
    if expected_queries is None or expected_decoded_bytes is None:
        raise MappingError('Explicit expected source checkpoint requires both queries and decoded bytes')
    if any(not isinstance(v,int) or isinstance(v,bool) or v<0 for v in (expected_queries,expected_decoded_bytes)):
        raise MappingError('Expected source checkpoint counters must be nonnegative integers')
    reader=SourceReader(evidence,max_run_queries=11,max_run_decoded_bytes=32*1024*1024)
    if not reader.ledger.is_file():
        raise MappingError('Source budget ledger is missing; refusing an invented/reset checkpoint')
    actual=(reader.total['queries'],reader.total['decodedBytes'])
    if actual!=(expected_queries,expected_decoded_bytes):
        raise MappingError('Source budget checkpoint mismatch; pass the exact current ledger counters')
    if expected_queries+11>100 or expected_decoded_bytes+32*1024*1024>256*1024*1024:
        raise MappingError('Insufficient remaining source budget for the bounded11-query/32MiB capture')
    checkpoint={'status':'capture_checkpoint_valid','expectedCheckpoint':{'queries':expected_queries,'decodedBytes':expected_decoded_bytes},
                'captureLimits':{'queries':11,'decodedBytes':32*1024*1024},'hardLimits':{'queries':100,'decodedBytes':256*1024*1024},
                'remainingBudget':{'queries':100-expected_queries,'decodedBytes':256*1024*1024-expected_decoded_bytes},
                'ledger':str(reader.ledger),'ledgerSha256':hashlib.sha256(reader.ledger.read_bytes()).hexdigest(),'sourceConnections':0}
    if check_only:
        print(json.dumps(checkpoint),flush=True)
        return 0
    (evidence/'capture-checkpoint.json').write_text(json.dumps(checkpoint,indent=2)+'\n')
    scope=json.loads(Path(scope_path).read_text())
    with reader as source:
        parts=load_parts(source,scope);source.profile_gaps=source.profile_versions(parts,scope)
        queries={q['name']:q for q in scope['queries']}
        family_hashes={r['path']:r['sha256'] for r in queries['archive_relation_source_versions']['rows']}
        source.documents({c['path']:family_hashes[c['path']] for c in scope['archiveShapeChoices']})
        source.documents({r['path']:r['sha256'] for r in source.profile_metadata},batch_size=64)
        snapshot=source.export_snapshot()
        if snapshot['sourceBudget']['runQueries']>11 or snapshot['sourceBudget']['runDecodedBytes']>32*1024*1024:
            raise MappingError('Single approved real-source capture exceeded its bounded pass')
    receipt={'kind':'memory_only_source_capture','pid':os.getpid(),'socket':str(endpoint),'sourceBudget':snapshot['sourceBudget'],
             'expectedCheckpoint':checkpoint['expectedCheckpoint'],'captureLimits':checkpoint['captureLimits'],
             'captureCodeSha256':SHA,'argv':[sys.executable,*sys.argv],
             'documentCount':len(snapshot['cache']),'cacheManifestSha256':hashed(sorted((p,m['physicalSha256'],m['decodedCanonicalSha256']) for p,m in snapshot['meta'].items())),
             'rawBodiesPersisted':False,'ready':True}
    (evidence/'capture.json').write_text(json.dumps(receipt,indent=2)+'\n')
    try:
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as server:
            server.bind(str(endpoint));os.chmod(endpoint,0o600);server.listen(4)
            print(json.dumps(receipt),flush=True)
            while True:
                client,_=server.accept()
                with client:
                    with client.makefile('rb') as request:command=request.readline(32)
                    if command==b'STOP\n':break
                    if command!=b'GET\n':continue
                    with client.makefile('wb') as output:pickle.dump(snapshot,output,protocol=5)
    finally:
        if endpoint.exists():endpoint.unlink()
        receipt.update(ready=False,stoppedAt=datetime.now(timezone.utc).isoformat(),socketRemoved=not endpoint.exists())
        (evidence/'capture.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return 0


def unpack(table):
    dictionaries = table.get("dictionaries",{})
    result = []
    for i,values in enumerate(table["rows"]):
        absent = set(int(v) for v in table.get("missing",{}).get(str(i),[]))
        result.append({key:(dictionaries[str(j)][int(values[j])] if str(j) in dictionaries and values[j] is not None else values[j])
                       for j,key in enumerate(table["keys"]) if j not in absent})
    return result


class TypedCore:
    def __init__(self, conn, evidence, source):
        self.conn, self.evidence, self.source = conn, Path(evidence), source
        self.model = json.loads(MODEL.read_text())
        self.tables = {t["qualified_name"]:t for s in self.model["schemas"] for t in s["tables"]}
        self.ids, self.documents, self.records, self.aliases = {}, {}, {}, set()
        self.matches, self.sides, self.people, self.teams, self.profiles, self.stats = {}, {}, {}, {}, {}, {}
        self.field_counts, self.numeric, self.unverified = Counter(), defaultdict(Counter), Counter()
        self.metric_contracts = set()
        self.common_native, self.record_locations = {}, {}
        self.active_run = None
        self.g = None

    def phase_binding(self, phase, paths, selectors):
        documents=sorted((path,self.source.meta[path]['physicalSha256']) for path in set(paths))
        binding={'kind':'orion_pro_phase_receipt_v2','phase':phase,'transform_sha256':SHA,'transform_version':VERSION,
                 'model_sha256':hashlib.sha256(MODEL.read_bytes()).hexdigest(),'source_document_count':len(documents),
                 'source_document_manifest_sha256':hashed(documents),'selector_manifest_sha256':hashed(selectors)}
        binding['input_manifest_sha256']=hashed(binding)
        return binding

    def phase_receipt(self,binding):
        key='real-source-v2:'+binding['phase']+':'+binding['input_manifest_sha256']
        snapshots=list(self.conn.execute('SELECT id,generation,status,manifest_sha256,transform_version,source_priority_version FROM ingest.dataset_snapshots WHERE snapshot_key=%s',(key,)))
        if not snapshots:
            prior=self.conn.execute("SELECT id FROM ingest.import_runs WHERE checkpoint->>'kind'='orion_pro_phase_receipt_v2' AND checkpoint->>'phase'=%s LIMIT 1",(binding['phase'],)).fetchone()
            if prior:raise MappingError('Different source/transform binding requires explicit reconciliation before phase '+binding['phase'])
            return None
        snapshot=snapshots[0]
        if snapshot[2]!='sealed' or snapshot[4:]!=(VERSION,VERSION):
            raise MappingError('Phase snapshot is not sealed with the exact source/transform binding: '+binding['phase'])
        runs=list(self.conn.execute("SELECT id,status,transform_version,code_commit,checkpoint FROM ingest.import_runs WHERE checkpoint->>'receipt_key'=%s",(key,)))
        if len(runs)!=1:raise MappingError('Phase has no unique persisted import receipt: '+binding['phase'])
        run=runs[0]; checkpoint=run[4]
        if run[1:4]!=('partial',VERSION,SHA) or checkpoint.get('binding')!=binding or checkpoint.get('generation')!=snapshot[1] or checkpoint.get('snapshot_id')!=snapshot[0]:
            raise MappingError('Phase receipt metadata differs from the exact binding: '+binding['phase'])
        report_digest=hashed(checkpoint['report'])
        if checkpoint.get('report_sha256')!=report_digest or snapshot[3]!=hashed({'input_manifest_sha256':binding['input_manifest_sha256'],'report_sha256':report_digest}):
            raise MappingError('Phase report metadata differs from its immutable sealed digest: '+binding['phase'])
        documents=list(self.conn.execute('SELECT d.legacy_object_path,d.content_sha256 FROM ingest.dataset_snapshot_documents l JOIN ingest.source_documents d ON d.id=l.document_id WHERE l.snapshot_id=%s ORDER BY d.legacy_object_path,d.content_sha256',(snapshot[0],)))
        if len(documents)!=binding['source_document_count'] or hashed(documents)!=binding['source_document_manifest_sha256']:
            raise MappingError('Phase receipt source-document membership differs: '+binding['phase'])
        return {'snapshotKey':key,'snapshotId':snapshot[0],'generation':snapshot[1],'runId':run[0],'binding':binding,'sealedManifestSha256':snapshot[3],
                'report':checkpoint['report'],'reused':True,'newFactRevisions':0,'duplicateRows':0}

    def begin_phase(self,binding):
        key='real-source-v2:'+binding['phase']+':'+binding['input_manifest_sha256']
        self.g=self.conn.execute('SELECT ingest.begin_generation(%s,%s,%s)',(key,VERSION,VERSION)).fetchone()[0]
        return key

    def finish_phase(self,binding,report,paths,run_id):
        snapshot=self.conn.execute('SELECT id,snapshot_key FROM ingest.dataset_snapshots WHERE generation=%s',(self.g,)).fetchone()
        compact={k:v for k,v in report.items() if k not in {'leafDispositions','selectors'}}
        if 'leafDispositions' in report:
            compact['leafDispositionCount']=len(report['leafDispositions']);compact['leafDispositionSha256']=hashed(report['leafDispositions'])
        if 'selectors' in report:
            compact['selectorCount']=len(report['selectors']);compact['selectorSha256']=hashed(report['selectors'])
        checkpoint={'kind':binding['kind'],'phase':binding['phase'],'receipt_key':snapshot[1],'binding':binding,
                    'generation':self.g,'snapshot_id':snapshot[0],'report':compact,'report_sha256':hashed(compact)}
        if len(json.dumps(checkpoint,separators=(',',':'),default=str).encode())>15000:
            raise MappingError('Phase metadata-only receipt exceeds its bounded checkpoint size')
        for path in sorted(set(paths)):
            document=self.documents.get(path)
            if document is None:raise MappingError('Phase source document was not represented as metadata: '+path)
            self.conn.execute('INSERT INTO ingest.dataset_snapshot_documents(snapshot_id,document_id) VALUES(%s,%s)',(snapshot[0],document))
        self.conn.execute("UPDATE ingest.import_runs SET status='partial',finished_at=CURRENT_TIMESTAMP,checkpoint=%s,counters=%s WHERE id=%s",
            (Jsonb(checkpoint),Jsonb({'full_acceptance':False,'local_only':True,'source_document_count':len(set(paths))}),run_id))
        sealed=hashed({'input_manifest_sha256':binding['input_manifest_sha256'],'report_sha256':checkpoint['report_sha256']})
        self.conn.execute('SELECT ingest.seal_generation(%s,%s)',(self.g,sealed))
        return {'snapshotKey':snapshot[1],'snapshotId':snapshot[0],'generation':self.g,'runId':run_id,'binding':binding,'sealedManifestSha256':sealed}

    def rows(self,sql,params=()):
        cursor=self.conn.execute(sql,params)
        names=[c.name for c in cursor.description]
        return [dict(zip(names,row)) for row in cursor.fetchall()]

    def hydrate_core(self,parts,receipt):
        expected={'people':{r['playerId'] for p in parts for r in p['tables']['players']},'teams':{r['id'] for p in parts for r in p['tables']['teams']},
                  'matches':{r['id'] for p in parts for r in p['tables']['fixtures']},'stats':{r['id'] for p in parts for r in p['tables']['performances']},
                  'profiles':{r['id'] for p in parts for r in p['tables']['players']}}
        alias_keys=sorted({(kind,r[key]) for p in parts for kind,table,key in [('player','players','playerId'),('team','teams','id'),
            ('match','fixtures','id'),('profile','players','id'),('competition','competitions','id')] for r in p['tables'][table]})
        source=self.conn.execute("SELECT id FROM ingest.sources WHERE code='pitchapi_saved'").fetchone()
        if source is None:raise MappingError('Sealed core receipt has no stable source identity')
        dataset=self.conn.execute("SELECT id FROM ingest.source_datasets WHERE source_id=%s AND dataset_key='ligue1-two-seasons-normalized-comparison' AND contract_version=%s",(source[0],VERSION)).fetchone()
        if dataset is None:raise MappingError('Sealed core receipt has no stable dataset identity')
        self.ids.update(source=source[0],dataset=dataset[0],run=receipt['runId'])
        self.active_run=receipt['runId'];self.g=receipt['generation']
        alias_rows=self.rows('SELECT a.route_kind,a.public_key FROM ingest.public_aliases_current a JOIN unnest(%s::text[],%s::text[]) w(kind,key) ON a.route_kind=w.kind AND a.public_key=w.key',
            ([k[0] for k in alias_keys],[k[1] for k in alias_keys]))
        self.aliases={(r['route_kind'],r['public_key']) for r in alias_rows}
        for table,kind,target,name in [('football.players','player',self.people,'people'),('football.teams','team',self.teams,'teams'),('football.matches_current','match',self.matches,'matches')]:
            extra=' AND r.source_id=%s' if kind=='match' else ''
            params=(kind,sorted(expected[name]),source[0]) if kind=='match' else (kind,sorted(expected[name]))
            for row in self.rows(f"SELECT a.public_key public_key,r.* FROM ingest.public_aliases_current a JOIN {table} r ON r.id=a.{kind}_id WHERE a.route_kind=%s AND a.public_key=ANY(%s)"+extra,params):
                key=row.pop('public_key');target[key]=row
        for row in self.rows("SELECT a.public_key public_key,p.* FROM ingest.public_aliases_current a JOIN football.player_profile_versions p ON p.id=a.profile_version_id JOIN ingest.source_records sr ON sr.id=p.source_record_id JOIN ingest.dataset_snapshot_documents sd ON sd.document_id=sr.document_id AND sd.snapshot_id=%s WHERE a.route_kind='profile' AND a.public_key=ANY(%s) AND p.source_id=%s",(receipt['snapshotId'],sorted(expected['profiles']),source[0])):
            key=row.pop('public_key');self.profiles[key]=row
        for row in self.rows("SELECT a.public_key match_key,b.public_key team_key,t.* FROM football.match_teams_current t JOIN ingest.public_aliases_current a ON a.route_kind='match' AND a.match_id=t.match_id JOIN ingest.public_aliases_current b ON b.route_kind='team' AND b.team_id=t.team_id JOIN ingest.source_records sr ON sr.id=t.source_record_id JOIN ingest.dataset_snapshot_documents sd ON sd.document_id=sr.document_id AND sd.snapshot_id=%s WHERE t.source_id=%s AND a.public_key=ANY(%s) AND b.public_key=ANY(%s)",(receipt['snapshotId'],source[0],sorted(expected['matches']),sorted(expected['teams']))):
            key=(row.pop('match_key'),row.pop('team_key'));self.sides[key]=row
        for row in self.rows('SELECT r.external_key performance_key,s.* FROM football.player_match_stats_current s JOIN ingest.source_records r ON r.id=s.source_record_id JOIN ingest.dataset_snapshot_documents sd ON sd.document_id=r.document_id AND sd.snapshot_id=%s WHERE s.source_id=%s AND r.external_key=ANY(%s)',(receipt['snapshotId'],source[0],sorted(expected['stats']))):
            key=row.pop('performance_key');self.stats[key]=row
        for row in self.rows("SELECT r.external_key performance_key,v.* FROM football.player_match_metric_values_current v JOIN ingest.source_records r ON r.id=v.source_record_id JOIN ingest.dataset_snapshot_documents sd ON sd.document_id=r.document_id AND sd.snapshot_id=%s WHERE v.source_id=%s AND r.external_key=ANY(%s) AND v.metric_code=ANY(%s)",(receipt['snapshotId'],source[0],sorted(expected['stats']),['legacy_normalized_'+f for f in COMMON_NATIVE])):
            key=row.pop('performance_key');self.common_native.setdefault(key,{})[row['metric_code'].removeprefix('legacy_normalized_')]=row
        for row in self.rows('SELECT r.id,r.locator,d.id document_id,d.legacy_object_path,d.content_sha256 FROM ingest.source_records r JOIN ingest.source_documents d ON d.id=r.document_id JOIN ingest.dataset_snapshot_documents sd ON sd.document_id=d.id AND sd.snapshot_id=%s WHERE r.source_id=%s',(receipt['snapshotId'],source[0])):
            path=row['legacy_object_path']
            if path in self.source.meta and self.source.meta[path]['physicalSha256']!=row['content_sha256']:
                raise MappingError('Persisted source metadata differs from captured input: '+path)
            self.documents[path]=row['document_id'];self.records[(path,row['locator'])]=row['id'];self.record_locations[row['id']]=(path,row['locator'])
        for name,keys in expected.items():
            if set(getattr(self,name))!=keys:raise MappingError('SQL rehydration identity membership differs: '+name)
        self.metric_contracts={r[0] for r in self.conn.execute('SELECT code FROM football.metric_definitions WHERE definition_version=%s',(VERSION,))}

    def number(self, value, sql_type, path):
        if value is None:
            return None
        if isinstance(value,bool) or not isinstance(value,(Decimal,int,float)):
            raise MappingError("Non-numeric native value for numeric target: " + path)
        dec = value if isinstance(value,Decimal) else Decimal(str(value))
        if not dec.is_finite():
            raise MappingError("Non-finite number: " + path)
        scale = max(0,-dec.as_tuple().exponent)
        self.numeric[path]["observations"] += 1
        self.numeric[path]["maximumDecimalPlaces"] = max(self.numeric[path]["maximumDecimalPlaces"],scale)
        self.numeric[path]["maximumIntegerDigits"] = max(self.numeric[path]["maximumIntegerDigits"],max(0,dec.adjusted()+1))
        if sql_type in {"integer","smallint","bigint"}:
            bound = {"smallint":2**15,"integer":2**31,"bigint":2**63}[sql_type]
            if dec != dec.to_integral_value() or not -bound <= dec < bound:
                raise MappingError("Non-integral or overflowing integer: " + path)
            return int(dec)
        if sql_type.startswith("numeric("):
            precision,scale_limit = map(int,re.findall(r"\d+",sql_type))
            if dec != dec.quantize(Decimal(1).scaleb(-scale_limit)) or abs(dec) >= Decimal(10)**(precision-scale_limit):
                raise MappingError("Unrepresentable fixed-scale numeric; rounding prohibited: " + path)
        if sql_type == "double precision":
            floating = float(dec)
            if not math.isfinite(floating) or Decimal(str(floating)) != dec:
                raise MappingError("Source decimal cannot round-trip through double precision: " + path)
            return floating
        return dec

    def native(self, row, key, target):
        value = row.get(key,MISSING)
        state = "absent" if value is MISSING else "null" if value is None else "number" if isinstance(value,(Decimal,int,float)) and not isinstance(value,bool) else "string" if isinstance(value,str) else "invalid"
        self.field_counts[(target,state)] += 1
        if state == "invalid":
            raise MappingError("Unapproved native scalar form: " + target)
        return {target+"_state":state,target:None if value is MISSING or value is None else str(value),
                target+"_source_number":self.number(value,"numeric",target) if state=="number" else None}

    def insert(self, table, **values):
        columns = self.tables[table]["columns"]
        defaults = {"recorded_from_gen":self.g,"variant_key":"legacy:primary","is_canonical":True,
                    "contract_version":VERSION,"transform_version":VERSION,"transform_code_sha256":SHA,
                    "canonical_policy_version":VERSION,"provenance_kind":"derived"}
        data = {k:v for k,v in defaults.items() if k in columns}
        data.update(values)
        if self.ids.get("source") and "source_id" in columns and "source_id" not in data and data.get("source_record_id") is not None:
            data["source_id"] = self.ids["source"]
        if set(data)-set(columns):
            raise MappingError("Unknown target columns: " + table + ": " + ",".join(sorted(set(data)-set(columns))))
        for key,value in list(data.items()):
            kind = columns[key]["type"]
            if kind.startswith(("numeric","double precision","integer","smallint","bigint")) and value is not None:
                data[key] = self.number(value,kind,table+"."+key)
        keys = list(data)
        params = tuple(Jsonb(data[k]) if columns[k]["type"]=="jsonb" and data[k] is not None else data[k] for k in keys)
        cursor = self.conn.execute(f"INSERT INTO {table} ({','.join(keys)}) VALUES ({','.join(['%s']*len(keys))}) RETURNING *",params)
        return dict(zip((c.name for c in cursor.description),cursor.fetchone()))

    def record(self, path, locator, kind, key):
        cache = path,locator
        if cache not in self.records:
            if path not in self.documents:
                meta = self.source.meta[path]
                dataset = self.ids.get("raw_dataset",self.ids["dataset"]) if path.startswith("raw/") else self.ids["dataset"]
                self.documents[path] = self.insert("ingest.source_documents",source_id=self.ids["source"],dataset_id=dataset,
                    content_sha256=meta["physicalSha256"],retrieved_at=meta["updatedAt"],source_updated_at=meta["updatedAt"],
                    storage_provider="aws_s3",origin_kind="legacy_file",retention_state="staged",legacy_object_path=path,
                    byte_length=meta["bytes"],import_run_id=self.active_run or self.ids["run"])["id"]
            self.records[cache] = self.insert("ingest.source_records",source_id=self.ids["source"],document_id=self.documents[path],
                locator_kind="json_pointer",locator=locator,record_kind=kind,external_key=key)["id"]
            self.record_locations[self.records[cache]] = cache
        return self.records[cache]

    def subrecord(self, parent, suffix, kind, key):
        path,locator = self.record_locations[parent]
        return self.record(path,locator+suffix,kind,key)

    def prepare_common_native_contract(self, path):
        record = self.record(path,"/tables/performances","accepted_normalized_metric_slot_contract",VERSION)
        for field in COMMON_NATIVE:
            code = "legacy_normalized_"+field
            common_type=self.tables['football.player_match_stats']['columns'][COMMON_NATIVE[field]]['type']
            number_rule={'integer':'exact nonnegative int32','numeric':'exact finite unconstrained numeric','double precision':'finite Decimal(str(float(native))) == native'}[common_type]
            self.insert("football.metric_definitions",code=code,label=field,
                definition="Native scalar property of an accepted complete packed normalized performance. Numeric projection only for exactly representable native numbers; other native kinds retain their exact scalar and NULL common value. A missing SQL metric row is unknown.",
                unit="source_native",scope="player",aggregation="none",allows_negative=field in SIGNED_COMMON_NATIVE,definition_version=VERSION,source_record_id=record)
            self.insert("football.source_metric_mappings",source_id=self.ids["source"],family_code="normalized_performance",raw_key=field,
                mapping_version=VERSION,metric_code=code,metric_definition_version=VERSION,source_record_id=record,
                parse_rule={"property":field,"accepted_record":"complete packed normalized performance","absent":"property missing from decoded row, not missing SQL row","null":"explicit source null",
                    "scalar":"number/string/boolean exact, without parsing or coercion","common_column":COMMON_NATIVE[field],'common_sql_type':common_type,
                    "number_projection":number_rule,
                    "nonnumeric_projection":"NULL; native text including empty or boolean retained in typed scalar"},
                period_rule={"period":"full_match","definition":"bootstrap_v1"})

    def common_native_value(self,row,field):
        value=row.get(field,MISSING)
        if value is MISSING:return 'absent',{},None
        if value is None:return 'null',{},None
        if isinstance(value,bool):return 'boolean',{'boolean_value':value},None
        if isinstance(value,str):return 'string',{'text_value':value},None
        if not isinstance(value,(Decimal,int,float)):
            raise MappingError('Unsupported registered common native scalar: '+field)
        exact=self.number(value,'numeric','normalized_performance.'+field)
        if field not in SIGNED_COMMON_NATIVE and exact<0:
            raise MappingError('Negative number violates common metric contract: '+field)
        target=COMMON_NATIVE[field]
        projection=self.number(exact,self.tables['football.player_match_stats']['columns'][target]['type'],'normalized_performance.'+field+' -> '+target)
        return 'number',{'numeric_value':exact},projection

    def insert_common_native_states(self, source_row, stats, prior=None):
        contract={'contract_version':VERSION,'transform_version':VERSION,'transform_code_sha256':SHA}
        mismatch=[key for key,expected in contract.items() if stats.get(key)!=expected]
        if mismatch:
            raise MappingError('Common target contract/transform mismatch; explicit reconciliation required: '+','.join(mismatch))
        for field in COMMON_NATIVE:
            old=prior.get(field) if prior else None
            if old is None:continue
            expected={**contract,'metric_definition_version':VERSION,'metric_code':'legacy_normalized_'+field,'family_code':'standard'}
            mismatch=[key for key,value in expected.items() if old.get(key)!=value]
            if mismatch:
                raise MappingError('Prior common scalar contract/transform mismatch: '+field+' ['+','.join(mismatch)+']')
        # Validate the whole observation before closing or inserting any scalar.
        plan={field:self.common_native_value(source_row,field) for field in COMMON_NATIVE}
        for field,(_,_,projection) in plan.items():
            actual=stats[COMMON_NATIVE[field]]
            equal=actual is None if projection is None else actual is not None and Decimal(str(actual))==Decimal(str(projection))
            if not equal:raise MappingError('Common projection/native scalar mismatch: '+field)
        result = {}
        for field in COMMON_NATIVE:
            kind,values,_=plan[field]
            old = prior.get(field) if prior else None
            bindings = ("match_id","player_id","team_id","match_player_revision_id","source_id","source_record_id","period_code","period_definition_version","variant_key","is_canonical")
            same_binding = old is not None and all(old[k]==stats[k] for k in bindings)
            same_scalar=old is not None and old['value_kind']==kind and all(old[k]==values.get(k) for k in ['numeric_value','text_value','boolean_value']) and all(old[k] is None for k in ['numerator','denominator','source_display'])
            if same_scalar and same_binding and old["recorded_from_gen"]<=stats["recorded_from_gen"] and old["recorded_to_gen"] is None:
                result[field] = old
                continue
            if old is not None:
                self.conn.execute("UPDATE football.player_match_metric_values SET recorded_to_gen=%s WHERE revision_id=%s",(self.g,old["revision_id"]))
            result[field] = self.insert("football.player_match_metric_values",match_id=stats["match_id"],player_id=stats["player_id"],team_id=stats["team_id"],
                match_player_revision_id=stats["match_player_revision_id"],source_id=stats["source_id"],source_record_id=stats["source_record_id"],
                period_code=stats["period_code"],period_definition_version=stats["period_definition_version"],variant_key=stats["variant_key"],
                metric_code="legacy_normalized_"+field,metric_definition_version=VERSION,family_code="standard",value_kind=kind,**values,
                is_canonical=stats['is_canonical'],provenance_kind=stats["provenance_kind"])
        if stats["is_canonical"]:self.common_native[source_row["id"]] = result
        return result

    def alias(self, kind, key, **binding):
        if (kind,key) not in self.aliases:
            self.insert("ingest.public_aliases",route_kind=kind,public_key=key,**binding)
            self.aliases.add((kind,key))

    def stats_values(self, row):
        result = {}
        for source,target in CORE_METRICS.items():
            self.field_counts[("performances."+source,"absent" if source not in row else "null" if row[source] is None else "present")] += 1
            result[target]=self.common_native_value(row,source)[2]
        for completed,attempted in [('passes_completed','passes_attempted'),('aerial_duels_won','aerial_duels_attempted'),('dribbles_completed','dribbles_attempted')]:
            if result[completed] is not None and result[attempted] is not None and result[completed]>result[attempted]:
                raise MappingError('Inconsistent common count projection: '+completed+' > '+attempted)
        for key in set(row)-set(CORE_METRICS)-PERFORMANCE_STRUCTURAL:
            self.unverified["performances."+key] += 1
        return result

    def import_core(self, parts):
        paths=[p['path'] for p in parts]
        binding=self.phase_binding('core',paths,{'editions':[(p['season'],p['path']) for p in parts],
            'profile_resources':self.source.profile_metadata,'profile_lookup_gaps':self.source.profile_gaps})
        self.core_binding=binding
        with self.conn.transaction():
            self.conn.execute('SELECT pg_advisory_xact_lock(20261104,1)')
            existing=self.phase_receipt(binding)
            if existing:
                self.hydrate_core(parts,existing)
                return {**existing['report'],'reused':True,'newFactRevisions':0,'duplicateRows':0,'phaseReceipt':{k:v for k,v in existing.items() if k!='report'}}
            if self.conn.execute("SELECT 1 FROM ingest.sources WHERE code='pitchapi_saved'").fetchone():
                raise MappingError('Existing typed source has no exact v2 phase receipt; explicit reconciliation is required')
            self.begin_phase(binding)
            for name,table in self.tables.items():
                if "relation_code" in table["columns"] and table["phase"] != "models":
                    self.conn.execute("INSERT INTO ingest.relation_contracts(relation_code,relation_name,contract_version,grain_definition) VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING",(name,name,VERSION,table["grain"]))
            self.ids["source"] = self.insert("ingest.sources",code="pitchapi_saved",name="PitchAPI existing legacy observations")["id"]
            self.ids["dataset"] = self.insert("ingest.source_datasets",source_id=self.ids["source"],dataset_key="ligue1-two-seasons-normalized-comparison",contract_version=VERSION)["id"]
            self.ids["run"] = self.insert("ingest.import_runs",mode="rebuild",transform_version=VERSION,code_commit=SHA)["id"]
            self.active_run=self.ids['run']
            self.prepare_common_native_contract(parts[0]["path"])
            league_record = self.record(parts[0]["path"],"/tables/competitions","competition","l_3FJFUl")
            competition = self.insert("football.competitions",name="Ligue 1",slug="l_3FJFUl",competition_type="league",gender="unknown",source_record_id=league_record)
            self.alias("competition","l_3FJFUl",competition_id=competition["id"],competition_revision_id=competition["revision_id"],source_record_id=league_record)
            # Stable identities are shared; profile observations retain their own variant IDs.
            all_players, all_teams = {}, {}
            for p in parts:
                for row in p["tables"]["players"]:
                    all_players[row["playerId"]] = row
                for row in p["tables"]["teams"]:
                    all_teams[row["id"]] = row
            for pid,row in sorted(all_players.items()):
                self.people[pid] = self.insert("football.players",display_name=row.get("name"))
                self.alias("player",pid,player_id=self.people[pid]["id"])
            for tid,row in sorted(all_teams.items()):
                self.teams[tid] = self.insert("football.teams",slug=tid,name=row.get("name"),team_type="unknown",gender="unknown")
                self.alias("team",tid,team_id=self.teams[tid]["id"])
            latest_profile = {}
            for p in parts:
                for row in p["tables"]["players"]:
                    latest_profile[row["playerId"]] = row["id"]
            editions = {}
            for p in parts:
                path, season = p["path"],p["season"]
                edition_record = self.record(path,"/meta/season","competition_season",season)
                editions[season] = self.insert("football.competition_seasons",competition_id=competition["id"],competition_revision_id=competition["revision_id"],
                    season_key=season,label=season,status="unknown",source_record_id=edition_record)
                for i,row in enumerate(p["tables"]["players"]):
                    if row["id"] in self.profiles:
                        continue
                    record = self.record(path,f"/tables/players/rows/{i}","normalized_player_profile",row["id"])
                    profile = self.insert("football.player_profile_versions",player_id=self.people[row["playerId"]]["id"],external_profile_version_id=row["id"],
                        display_name=row["name"],observed_at=self.source.meta[path]["updatedAt"],profile_context="legacy_normalized_global",
                        variant_key=row["id"],is_canonical=latest_profile[row["playerId"]]==row["id"],profile_content_sha256=hashed(row),
                        raw_position_code_state="absent",shirt_number_state="absent",source_record_id=record)
                    self.profiles[row["id"]] = profile
                    self.alias("profile",row["id"],player_id=profile["player_id"],profile_version_id=profile["id"],source_record_id=record)
                    if "imageUrl" in row:self.unverified["players.imageUrl.media_reference"] += 1
                for i,fixture in enumerate(p["tables"]["fixtures"]):
                    mid = fixture["id"]
                    record = self.record(path,f"/tables/fixtures/rows/{i}","fixture",mid)
                    day = date.fromisoformat(fixture["date"][:10]) if fixture.get("date") else None
                    match = self.insert("football.matches",competition_season_id=editions[season]["id"],competition_season_revision_id=editions[season]["revision_id"],
                        match_date=day,kickoff_precision="date" if day else "unknown",status=fixture.get("status") or "unknown",round_label=fixture.get("round_name"),
                        publication_state="draft",source_record_id=record)
                    self.matches[mid] = match
                    self.alias("match",mid,match_id=match["id"],match_revision_id=match["revision_id"],source_record_id=record)
                    for side in ("home","away"):
                        team = fixture.get(side+"_team") or {}
                        if not team.get("id") or team["id"] not in self.teams:
                            raise MappingError("Fixture team not in scoped typed team identities: " + mid + ":" + side)
                        member = self.insert("football.match_teams",match_id=match["id"],match_revision_id=match["revision_id"],side=side,team_id=self.teams[team["id"]]["id"],source_record_id=record)
                        self.sides[(mid,team["id"])] = member
                        if "score_"+side in fixture:
                            self.insert("football.match_scores",match_id=match["id"],side=side,score_scope="final_without_shootout",score_basis="unknown",
                                goals=fixture["score_"+side],match_team_revision_id=member["revision_id"],source_record_id=record)
                    for key in set(fixture)-{"id","date","status","round_name","home_team","away_team","score_home","score_away"}:
                        self.unverified["fixtures."+key] += 1
                for i,row in enumerate(p["tables"]["performances"]):
                    mid,pid,tid = row["matchId"],row["playerId"],row["teamId"]
                    record = self.record(path,f"/tables/performances/rows/{i}","performance",row["id"])
                    starter = row.get("starter")
                    participant = self.insert("football.match_players",match_id=self.matches[mid]["id"],player_id=self.people[pid]["id"],team_id=self.teams[tid]["id"],
                        profile_version_id=self.profiles[row["playerRef"]]["id"],match_team_revision_id=self.sides[(mid,tid)]["revision_id"],
                        squad_status="starter" if starter is True else "observed",is_starter=starter,played=None,source_record_id=record,
                        is_captain=row.get("isCaptain"),**self.native(row,"positionId","raw_position_code"),**self.native(row,"shirtNumber","shirt_number"))
                    self.stats[row["id"]] = self.insert("football.player_match_stats",match_id=participant["match_id"],player_id=participant["player_id"],team_id=participant["team_id"],
                        match_player_revision_id=participant["revision_id"],period_code="full_match",period_definition_version="bootstrap_v1",source_record_id=record,**self.stats_values(row))
                    self.insert_common_native_states(row,self.stats[row["id"]])
                for i,row in enumerate(p["tables"]["shots"]):
                    mid,tid = row["matchId"],row.get("teamId")
                    if tid not in self.teams or (mid,tid) not in self.sides:
                        raise MappingError("Shot team is not a scoped match side: " + mid)
                    record = self.record(path,f"/tables/shots/rows/{i}","shot",str(row["id"]))
                    values = {target:row[source] for source,target in SHOT_MAP.items() if source in row}
                    period = row.get("period")
                    if period is not None:
                        if str(period) not in PERIODS:
                            self.unverified["shots.period."+str(period)] += 1
                        else:
                            values.update(period_code=PERIODS[str(period)],period_definition_version="bootstrap_v1")
                    pid = row.get("playerId")
                    keeper = row.get("keeperId")
                    values.update(player_id=self.people[pid]["id"] if pid in self.people else None,
                                  keeper_id=self.people[keeper]["id"] if keeper in self.people else None)
                    self.insert("football.shots",match_id=self.matches[mid]["id"],team_id=self.teams[tid]["id"],external_shot_id=str(row["id"]),
                        match_team_revision_id=self.sides[(mid,tid)]["revision_id"],source_record_id=record,source_ordinal=i,**values)
                    for key in set(row)-set(SHOT_MAP)-{"id","matchId","teamId","playerId","keeperId","period"}:
                        self.unverified["shots."+key] += 1
                    if keeper and keeper not in self.people:self.unverified["shots.unresolved_keeper_id"] += 1
                shot_counts = Counter(r["matchId"] for r in p["tables"]["shots"])
                coverage_record = self.record(path,"/tables/shots","normalized_shots_collection",season)
                for item in p["tables"]["matches"]:
                    mid = item["id"]
                    count = shot_counts[mid]
                    self.insert("ingest.match_coverage",match_id=self.matches[mid]["id"],match_revision_id=self.matches[mid]["revision_id"],
                        source_id=self.ids["source"],source_record_id=coverage_record,feature_code="shots",coverage_state="available" if count else "empty_response",
                        collection_state="present" if count else "empty",observed_row_count=count,checked_at=self.source.meta[path]["updatedAt"])
            for pid in self.source.profile_gaps:
                self.insert("ingest.quality_issues",run_id=self.ids["run"],rule_code="missing_full_profile_resource_lookup",severity="warning",
                    context={"provider_id":pid,"source_lookup":"/players/{id},{}","scope":"Missing exact resource lookup; not global AWS absence"})
            report={"generation":self.g,"reused":False,"facts":{"fixtures":len(self.matches),"performances":len(self.stats)},'manifestSha256':binding['input_manifest_sha256']}
            receipt=self.finish_phase(binding,report,paths,self.ids['run'])
        return {**report,'phaseReceipt':receipt}

    def collection(self, mid, feature, count, record, variant):
        return self.insert("ingest.match_coverage",match_id=self.matches[mid]["id"],match_revision_id=self.matches[mid]["revision_id"],
            source_id=self.ids["source"],source_record_id=record,feature_code=feature,coverage_state="available" if count else "empty_response",
            collection_state="present" if count else "empty",observed_row_count=count,checked_at=datetime.now(timezone.utc),variant_key=variant)

    def metric(self, mid, provider_id, period, raw_key, stat, record, variant, *, team=False):
        from build_dashboard_data import PLAYER_METRICS, EXTRA_PLAYER_METRICS
        known = set(PLAYER_METRICS.values()) | set(EXTRA_PLAYER_METRICS.values())
        if raw_key not in known:
            self.unverified[("raw_team_metric." if team else "raw_player_metric.")+str(raw_key)] += 1
            return 0
        code = ("pitchapi_team_" if team else "pitchapi_player_")+re.sub(r"[^a-zA-Z0-9]+","_",raw_key).lower()
        if code not in self.metric_contracts:
            self.insert("football.metric_definitions",code=code,label=raw_key,definition="Observed registered PitchAPI scalar; native units require separate semantic reconciliation",
                unit="source_native",scope="team" if team else "player",aggregation="none",allows_negative=True,definition_version=VERSION,
                source_record_id=record)
            self.insert("football.source_metric_mappings",source_id=self.ids["source"],family_code="stats" if team else "players",raw_key=raw_key,
                mapping_version=VERSION,metric_code=code,metric_definition_version=VERSION,source_record_id=record,
                parse_rule={"value":"native_scalar_exact","contract":"registered stat.value member","missing_request":"unknown","rounding":"reject"},
                period_rule={"source":"explicit source period","target_definition":"bootstrap_v1"})
            self.metric_contracts.add(code)
        value = stat.get("value",MISSING)
        values = {}
        if value is MISSING:
            kind = "absent"
        elif value is None:
            kind = "null"
        elif isinstance(value,bool):
            kind,values = "boolean",{"boolean_value":value}
        elif isinstance(value,(Decimal,int,float)):
            kind,values = "number",{"numeric_value":value}
        elif isinstance(value,str):
            kind,values = "string",{"text_value":value}
        else:
            raise MappingError("Unapproved registered metric native type: "+raw_key)
        total = stat.get("total")
        if kind in {"null","absent"}:
            if total is not None:
                raise MappingError("Native null/absent metric has an unrepresentable auxiliary denominator: "+raw_key)
        elif total is not None:
            if kind != "number" or isinstance(total,bool) or not isinstance(total,(Decimal,int,float)):
                raise MappingError("Unrepresentable metric denominator type: "+raw_key)
            values.update(numerator=value,denominator=total)
        table = "football.team_match_metric_values" if team else "football.player_match_metric_values"
        if team:
            tid = provider_id
            binding = {"team_id":self.teams[tid]["id"],"match_team_revision_id":self.sides[(mid,tid)]["revision_id"]}
        else:
            # Exact accepted normalized participant, not a player-name inference.
            participant = self.conn.execute("SELECT player_id,team_id,revision_id FROM football.match_players_current WHERE match_id=%s AND player_id=%s",
                (self.matches[mid]["id"],self.people[provider_id]["id"])).fetchone()
            if participant is None:
                raise MappingError("Original metric player has no accepted match participant: "+mid+":"+provider_id)
            binding = {"player_id":participant[0],"team_id":participant[1],"match_player_revision_id":participant[2]}
        self.insert(table,match_id=self.matches[mid]["id"],period_code=period,period_definition_version="bootstrap_v1",family_code="standard",
            metric_code=code,metric_definition_version=VERSION,value_kind=kind,source_record_id=record,variant_key=variant,is_canonical=False,**binding,**values)
        return 1

    def import_original_families(self, scope):
        """Representative two-season original observations, with explicit gaps."""
        query_map = {q["name"]:q for q in scope["queries"]}
        hashes = {r["path"]:r["sha256"] for r in query_map["archive_relation_source_versions"]["rows"]}
        choices = scope["archiveShapeChoices"]
        for chosen in choices:
            if chosen['path'] in self.source.meta and self.source.meta[chosen['path']]['physicalSha256']!=hashes[chosen['path']]:
                raise MappingError('Original family captured source hash differs from required version: '+chosen['path'])
        docs = self.source.documents({c["path"]:hashes[c["path"]] for c in choices})
        paths=sorted({c['path'] for c in choices})
        binding=self.phase_binding('families',paths,{'members':choices,'core_input_manifest':self.core_binding['input_manifest_sha256']})
        report = {"scope":"two real archived matches, thirteen original families each; canonical normalized comparison remains separate",
            "sourceMembers":0,"uniqueMemberFailures":0,"opaqueSourceBodiesStored":0,"typedRows":0,"dispositions":[],"leafDispositions":[],
            "repeatedMetricPolicy":"retain_each_group_item_as_explicit_noncanonical_source_record_variant"}
        family_counts = defaultdict(Counter)

        def leaves(value, path="data"):
            if isinstance(value,dict):
                if not value:yield path,"empty_object"
                for key,item in value.items():yield from leaves(item,path+"."+key)
            elif isinstance(value,list):
                if not value:yield path,"empty_list"
                for item in value:yield from leaves(item,path+"[]")
            else:
                kind = "null" if value is None else "boolean" if isinstance(value,bool) else "number" if isinstance(value,(int,float,Decimal)) else "empty_string" if value=="" else "string"
                yield path,kind

        with self.conn.transaction():
            self.conn.execute('SELECT pg_advisory_xact_lock(20261104,1)')
            existing=self.phase_receipt(binding)
            if existing:return {**existing['report'],'reused':True,'newFactRevisions':0,'phaseReceipt':{k:v for k,v in existing.items() if k!='report'}}
            self.begin_phase(binding)
            self.active_run=self.insert('ingest.import_runs',mode='rebuild',transform_version=VERSION,code_commit=SHA)['id']
            self.ids["raw_dataset"] = self.insert("ingest.source_datasets",source_id=self.ids["source"],dataset_key="ligue1-two-seasons-original-archive",contract_version=VERSION)["id"]
            for chosen in choices:
                mid,family,path = chosen["matchId"],chosen["family"],chosen["path"]
                hits = [(i,r) for i,r in enumerate(docs[path]) if r.get("matchId")==mid]
                if len(hits)!=1:
                    report["uniqueMemberFailures"] += 1
                    raise MappingError("Original source member selection is not unique: "+path+":"+mid)
                ordinal,member = hits[0]
                response = member.get("response",{})
                if response.get("status") != 200 or response.get("data") is None:
                    raise MappingError("Selected original family response is unavailable: "+mid+":"+family)
                report["sourceMembers"] += 1
                data = response["data"]
                leaf_counts = Counter(leaves(data))
                report["leafDispositions"].extend({"season":chosen["season"],"matchId":mid,"family":family,"path":k[0],"nativeState":k[1],"observations":v,
                    "status":"unverified_full_leaf_reconciliation","reason":"Typed projection is recorded separately; complete source-leaf fidelity has not been accepted"} for k,v in sorted(leaf_counts.items()))
                record = self.record(path,"/"+str(ordinal),"original_"+family,member.get("documentId") or mid)
                variant = "archive:"+str(member.get("documentId") or mid)+":"+family
                try:
                    with self.conn.transaction():
                        count = self.transform_family(family,mid,data,record,variant)
                    family_counts[family]["typedRows"] += count
                    family_counts[family]["mappedMembers"] += 1
                except MappingError as error:
                    family_counts[family]["rejectedMembers"] += 1
                    report.setdefault("rejected",[]).append({"matchId":mid,"family":family,"reason":str(error)})
                    self.metric_contracts = {r[0] for r in self.conn.execute("SELECT code FROM football.metric_definitions WHERE definition_version=%s",(VERSION,))}
                except psycopg.Error as error:
                    family_counts[family]["rejectedMembers"] += 1
                    report.setdefault("rejected",[]).append({"matchId":mid,"family":family,"sqlstate":error.sqlstate,"constraint":error.diag.constraint_name,"reason":error.diag.message_primary})
                    self.metric_contracts = {r[0] for r in self.conn.execute("SELECT code FROM football.metric_definitions WHERE definition_version=%s",(VERSION,))}
            report["dispositions"] = [{"family":family,"status":"partial" if counts["mappedMembers"] else "rejected",**dict(counts)} for family,counts in sorted(family_counts.items())]
            report["typedRows"] = sum(c["typedRows"] for c in family_counts.values())
            report["generation"] = self.g
            receipt=self.finish_phase(binding,report,paths,self.active_run)
        return {**report,'phaseReceipt':receipt}

    def import_source_profiles(self, scope):
        expected_rows = next(q["rows"] for q in scope["queries"] if q["name"]=="all_scoped_player_team_profile_source_versions")
        pinned = {r["provider_id"]:r for r in expected_rows if r["status"]==200}
        metadata = self.source.profile_metadata
        expected = {}
        for row in metadata:
            pid = row["endpoint"].split('/')[-1]
            if row["status"]!=200 or not row["ready"] or row["ordinal"] is None or pid not in pinned:
                raise MappingError("Full profile resource/member is not available: "+pid)
            if row["sha256"]!=pinned[pid]["physical_sha256"] or row["path"]!=pinned[pid]["source_path"] or row["ordinal"]!=int(pinned[pid]["source_ordinal"]):
                raise MappingError("Full profile resource version differs from the pinned source audit: "+pid)
            expected[row["path"]] = row["sha256"]
        docs = self.source.documents(expected,batch_size=64)
        binding=self.phase_binding('profiles',sorted(expected),{'resources':metadata,'missing_resource_keys':self.source.profile_gaps,
            'core_input_manifest':self.core_binding['input_manifest_sha256']})
        report = {"candidatePlayerResourceRows":sum(m["endpoint"].startswith('/players/') for m in metadata),
                  "selectedPlayerObservations":0,"selectedTeamObservations":0,"mismatchedIds":0,"rejectedProviderIds":[],"conflicts":[],"missingPlayerResourceKeys":len(self.source.profile_gaps),
                  "opaqueSourceBodiesStored":0,"selectors":[],"unverifiedUsefulFields":Counter()}
        with self.conn.transaction():
            self.conn.execute('SELECT pg_advisory_xact_lock(20261104,1)')
            existing=self.phase_receipt(binding)
            if existing:return {**existing['report'],'reused':True,'newFactRevisions':0,'phaseReceipt':{k:v for k,v in existing.items() if k!='report'}}
            self.begin_phase(binding)
            self.active_run=self.insert('ingest.import_runs',mode='rebuild',transform_version=VERSION,code_commit=SHA)['id']
            self.ids["raw_dataset"] = self.insert("ingest.source_datasets",source_id=self.ids["source"],dataset_key="exact-legacy-global-profile-observations",contract_version=VERSION)["id"]
            for meta in metadata:
                pid,path,ordinal = meta["endpoint"].split('/')[-1],meta["path"],meta["ordinal"]
                source_list = docs[path]
                if not isinstance(source_list,list) or not 0<=ordinal<len(source_list):
                    raise MappingError("Profile source ordinal does not resolve: "+pid)
                selected = source_list[ordinal]
                observation = selected
                for _ in range(4):
                    nested = next((k for k in ("observation","response") if isinstance(observation,dict) and isinstance(observation.get(k),dict)),None)
                    if nested is None:break
                    observation = observation[nested]
                data = observation.get("data")
                if observation.get("status")!=200 or not isinstance(data,dict) or data.get("id")!=pid:
                    report["mismatchedIds"] += 1
                    report["rejectedProviderIds"].append(pid)
                    actual = data.get("id") if isinstance(data,dict) else None
                    conflict = {"expectedProviderId":pid,"actualProviderId":actual,"selectedStatus":int(observation["status"]) if observation.get("status") is not None else None,
                        "path":path,"ordinal":ordinal,"physicalSha256":meta["sha256"]}
                    report["conflicts"].append(conflict)
                    bad_record = self.record(path,"/"+str(ordinal),"profile_identity_conflict",actual or pid)
                    self.insert("ingest.quality_issues",run_id=self.ids["run"],source_record_id=bad_record,rule_code="profile_resource_member_identity_conflict",severity="blocking",context=conflict)
                    continue
                record = self.record(path,"/"+str(ordinal),"provider_profile",pid)
                observed = observation.get("retrieved_at_utc") or self.source.meta[path]["updatedAt"]
                if pid.startswith("p_"):
                    self.insert("football.player_profile_versions",player_id=self.people[pid]["id"],external_profile_version_id=path+"#"+str(ordinal),
                        display_name=data["name"],short_name=data.get("short_name"),country_code_source=data.get("country_code"),observed_at=observed,
                        profile_context="provider_global",variant_key="provider:exact",profile_content_sha256=hashed(data),source_record_id=record,
                        **self.native(data,"position_id","raw_position_code"),**self.native(data,"shirt_number","shirt_number"))
                    report["selectedPlayerObservations"] += 1
                    handled = {"id","name","short_name","country_code","position_id","shirt_number"}
                else:
                    self.insert("football.team_profile_versions",team_id=self.teams[pid]["id"],display_name=data.get("name"),short_name=data.get("short_name"),
                        country_code_source=data.get("country_code"),observed_at=observed,profile_context="provider_global",variant_key="provider:exact",source_record_id=record)
                    report["selectedTeamObservations"] += 1
                    handled = {"id","name","short_name","country_code"}
                for field in set(data)-handled:report["unverifiedUsefulFields"][field] += 1
                report["selectors"].append({"providerId":pid,"path":path,"ordinal":ordinal,"physicalSha256":meta["sha256"],"selectedIdMatches":True,
                    "sourceRecordId":record,"decodedProfileSha256":hashed(data)})
            report["unverifiedUsefulFields"] = dict(report["unverifiedUsefulFields"])
            report["generation"] = self.g
            receipt=self.finish_phase(binding,report,sorted(expected),self.active_run)
        return {**report,'phaseReceipt':receipt}

    def transform_family(self, family, mid, data, record, variant):
        match = self.matches[mid]
        count = 0
        period = lambda value:PERIODS.get(str(value))
        if family == "match":
            self.insert("football.match_observation_details",source_record_id=record,match_id=match["id"],match_revision_id=match["revision_id"],
                source_match_key=data.get("id"),source_date_text=data.get("date"),source_time_text=data.get("time_utc"),
                source_home_label=(data.get("home_team") or {}).get("name"),source_away_label=(data.get("away_team") or {}).get("name"),resolution_state="resolved")
            return 1
        if family in {"events","momentum","h2h"}:
            key = {"events":"events","momentum":"points","h2h":"recent_matches"}[family]
            if not isinstance(data,dict) or key not in data:
                raise MappingError("Required source collection property is absent: "+family+"."+key)
            items = data[key]
            if not isinstance(items,list) or any(not isinstance(item,dict) for item in items):
                raise MappingError("Source collection must be an explicit list of objects: "+family+"."+key)
            self.collection(mid,family,len(items),record,variant)
            for i,row in enumerate(items):
                common = {"match_id":match["id"],"match_revision_id":match["revision_id"],"feature_code":family,"variant_key":variant,"source_id":self.ids["source"],"source_record_id":record}
                if family=="events":
                    tid = (row.get("team") or {}).get("id")
                    pid = (row.get("player") or {}).get("id")
                    related = (row.get("related_player") or {}).get("id")
                    extra = {k:row[k] for k in ("minute","minute_added","second","is_penalty","is_own_goal","score_home","score_away") if k in row}
                    if period(row.get("period")):extra.update(period_code=period(row["period"]),period_definition_version="bootstrap_v1")
                    if tid in self.teams and (mid,tid) in self.sides:extra.update(team_id=self.teams[tid]["id"],match_team_revision_id=self.sides[(mid,tid)]["revision_id"])
                    if pid in self.people:extra["player_id"] = self.people[pid]["id"]
                    if related in self.people:extra["related_player_id"] = self.people[related]["id"]
                    self.insert("football.match_events",event_seq=i,source_ordinal=i,event_type=row.get("event_type") or "unknown",source_event_id=row.get("id"),**common,**extra)
                elif family=="momentum":
                    self.insert("football.match_momentum",series_code="provider_native",sample_index=i,minute=row.get("minute"),value=row["value"],**common)
                else:
                    home,away = row.get("home") or {},row.get("away") or {}
                    self.insert("football.match_h2h_entries",entry_ordinal=i,external_match_id=row.get("id"),time_utc_source=row.get("time_utc"),
                        home_team_id=self.teams[home["id"]]["id"] if home.get("id") in self.teams else None,
                        away_team_id=self.teams[away["id"]]["id"] if away.get("id") in self.teams else None,
                        home_label=home.get("name"),away_label=away.get("name"),home_score=row.get("score_home"),away_score=row.get("score_away"),**common)
                count += 1
            return count
        if family=="lineups":
            for side in ("home","away"):
                tid = (data.get(side+"_team") or {}).get("id")
                if (mid,tid) not in self.sides:raise MappingError("Lineup side does not resolve: "+mid+":"+side)
                row = data.get(side) or {}
                self.insert("football.match_lineups",match_id=match["id"],team_id=self.teams[tid]["id"],match_team_revision_id=self.sides[(mid,tid)]["revision_id"],
                    lineup_type="observed",confirmed=row.get("confirmed"),formation=row.get("formation"),source_record_id=record,variant_key=variant)
                count += 1
                for status,key in (("starter","starters"),("substitute","subs")):
                    for player in row.get(key,[]):
                        pid = player.get("player_id")
                        if pid not in self.people:raise MappingError("Original lineup player not in scoped identity set: "+str(pid))
                        self.insert("football.match_players",match_id=match["id"],player_id=self.people[pid]["id"],team_id=self.teams[tid]["id"],
                            match_team_revision_id=self.sides[(mid,tid)]["revision_id"],squad_status=status,is_starter=status=="starter",is_captain=player.get("is_captain"),
                            source_record_id=record,variant_key=variant,is_canonical=False,**self.native(player,"position_id","raw_position_code"),**self.native(player,"shirt_number","shirt_number"))
                        count += 1
            return count
        if family in {"players","player_halves","stats"}:
            if family=="stats":
                from build_dashboard_data import KNOWN_STATS
                for pi,p in enumerate(data.get("periods",[])):
                    pc = period(p.get("period"))
                    if not pc:raise MappingError("Unmapped source team-stat period label")
                    for gi,group in enumerate(p.get("groups",[])):
                        for ii,item in enumerate(group.get("items",[])):
                            for side in ("home","away"):
                                tid = (data.get(side+"_team") or {}).get("id")
                                if item.get("key") not in KNOWN_STATS:
                                    count += self.metric(mid,tid,pc,item.get("key"),{"value":item.get(side,MISSING)},record,variant,team=True)
                                    continue
                                source_record = self.subrecord(record,f"/response/data/periods/{pi}/groups/{gi}/items/{ii}/{side}","team_metric_group_item",f"{mid}:{tid}:{pc}:{gi}:{ii}")
                                item_variant = variant+f":period:{pi}:group:{gi}:item:{ii}"
                                count += self.metric(mid,tid,pc,item.get("key"),{"value":item.get(side,MISSING)},source_record,item_variant,team=True)
            else:
                from build_dashboard_data import KNOWN_STATS
                players = data if isinstance(data,list) else data.get("players",[])
                for ri,row in enumerate(players):
                    pid = (row.get("player") or {}).get("id")
                    if pid not in self.people:raise MappingError("Original metric player not in scoped identity set: "+str(pid))
                    periods = [{"period":"full_match","stats":row.get("stats",[])}] if family=="players" else row.get("periods",[])
                    for pi,p in enumerate(periods):
                        pc = period(p.get("period"))
                        if not pc:raise MappingError("Unmapped source player-stat period label")
                        for gi,group in enumerate(p.get("stats",[])):
                            for ii,(label,metric) in enumerate((group.get("stats") or {}).items()):
                                raw_key,stat = metric.get("key"),metric.get("stat") or {}
                                if raw_key not in KNOWN_STATS:
                                    count += self.metric(mid,pid,pc,raw_key,stat,record,variant)
                                    continue
                                escaped = label.replace('~','~0').replace('/','~1')
                                prefix = f"/response/data/{ri}" if family=="players" else f"/response/data/players/{ri}/periods/{pi}"
                                source_record = self.subrecord(record,prefix+f"/stats/{gi}/stats/{escaped}/stat","player_metric_group_item",f"{mid}:{pid}:{pc}:{gi}:{ii}")
                                item_variant = variant+f":period:{pi}:group:{gi}:item:{ii}"
                                count += self.metric(mid,pid,pc,raw_key,stat,source_record,item_variant)
            return count
        if family in {"advanced_players","advanced_teams"}:
            team = family=="advanced_teams"
            table = "football.team_match_advanced" if team else "football.player_match_advanced"
            for row in data.get("teams" if team else "players",[]):
                tid = (row.get("team") or {}).get("id") if team else row.get("team_id")
                if (mid,tid) not in self.sides:raise MappingError("Advanced source team does not resolve")
                values = {}
                for subgroup in ("passing","carrying","creation","defending","possession_value","tempo","territory"):
                    for key,value in (row.get(subgroup) or {}).items():
                        if key in self.tables[table]["columns"] and not isinstance(value,(dict,list)):
                            values[key] = value
                        elif key=="sca_breakdown":
                            for subkey,subvalue in value.items():
                                target="sca_"+subkey
                                if target in self.tables[table]["columns"]:values[target] = subvalue
                if not values:raise MappingError("No representable advanced scalar fields")
                binding = {"team_id":self.teams[tid]["id"],"match_team_revision_id":self.sides[(mid,tid)]["revision_id"]}
                if not team:
                    pid = (row.get("player") or {}).get("id")
                    if pid not in self.people:raise MappingError("Advanced player identity does not resolve")
                    member = self.conn.execute("SELECT revision_id FROM football.match_players_current WHERE match_id=%s AND player_id=%s",(match["id"],self.people[pid]["id"])).fetchone()
                    if member is None:raise MappingError("Advanced player participant does not resolve")
                    binding = {"player_id":self.people[pid]["id"],"team_id":self.teams[tid]["id"],"match_player_revision_id":member[0]}
                self.insert(table,match_id=match["id"],period_code="full_match",period_definition_version="bootstrap_v1",source_record_id=record,variant_key=variant,is_canonical=False,**binding,**values)
                count += 1
            return count
        if family=="pass_networks":
            for row in data.get("networks",[]):
                tid = (row.get("team") or {}).get("id")
                if (mid,tid) not in self.sides:raise MappingError("Network team does not resolve")
                window = row.get("window") or {}
                parent = self.insert("football.pass_networks",match_id=match["id"],team_id=self.teams[tid]["id"],match_team_revision_id=self.sides[(mid,tid)]["revision_id"],
                    window_kind=window.get("kind") or "provider_unspecified",from_seconds=window.get("from_seconds"),until_seconds=window.get("until_seconds"),
                    centralization=row.get("centralization"),coordinate_frame="pitchapi_native_unverified",source_record_id=record,variant_key=variant)
                count += 1
                for node in row.get("nodes",[]):
                    pid = (node.get("player") or {}).get("id")
                    if pid not in self.people:raise MappingError("Network node identity does not resolve")
                    values = {key:node[key] for key in ("avg_x","avg_y","passes","passes_received","degree","strength","betweenness","clustering") if key in node}
                    self.insert("football.pass_network_nodes",network_id=parent["id"],player_id=self.people[pid]["id"],**values)
                    count += 1
                for edge in row.get("edges",[]):
                    left,right = (edge.get("from") or {}).get("id"),(edge.get("to") or {}).get("id")
                    if left not in self.people or right not in self.people:raise MappingError("Network edge identity does not resolve")
                    self.insert("football.pass_network_edges",network_id=parent["id"],from_player_id=self.people[left]["id"],to_player_id=self.people[right]["id"],passes=edge["passes"])
                    count += 1
            return count
        if family=="heatmaps":
            grid = data.get("grid") or {}
            for kind in ("teams","players"):
                for row in data.get(kind,[]):
                    tid = (row.get("team") or {}).get("id")
                    pid = (row.get("player") or {}).get("id") if kind=="players" else None
                    cells = row.get("cells")
                    if not isinstance(cells,list) or not cells or not isinstance(cells[0],list) or not cells[0]:
                        raise MappingError("Unrepresented empty/null heatmap grid in selected source")
                    rows,columns = len(cells),len(cells[0])
                    if any(len(r)!=columns for r in cells):raise MappingError("Ragged heatmap grid")
                    if (mid,tid) not in self.sides or (pid and pid not in self.people):raise MappingError("Heatmap identity does not resolve")
                    parent = self.insert("football.match_heatmaps",match_id=match["id"],team_id=self.teams[tid]["id"],player_id=self.people[pid]["id"] if pid else None,
                        match_team_revision_id=self.sides[(mid,tid)]["revision_id"],period_code="full_match",period_definition_version="bootstrap_v1",map_kind="source_actions",
                        grid_columns=columns,grid_rows=rows,cell_length_m=grid["cell_length_m"],cell_width_m=grid["cell_width_m"],coordinate_frame=grid["frame"],actions=row.get("actions"),
                        cells_state="available",source_record_id=record,variant_key=variant)
                    count += 1
                    for y,values in enumerate(cells):
                        for x,value in enumerate(values):
                            self.insert("football.match_heatmap_cells",heatmap_id=parent["id"],cell_ordinal=y*columns+x,column_index=x,row_index=y,action_count=value)
                            count += 1
            return count
        if family=="shots":
            count = 0
            for p in data.get("periods",[]):
                pc = period(p.get("period"))
                if not pc:raise MappingError("Unmapped original shot period")
                for row in p.get("shots",[]):
                    tid = (row.get("team") or {}).get("id") or row.get("team_id")
                    if (mid,tid) not in self.sides:raise MappingError("Original shot team does not resolve")
                    pid,keeper = (row.get("player") or {}).get("id"),(row.get("keeper") or {}).get("id")
                    mapping = {"expected_goals":"xg","expected_goals_on_target":"xgot","minute":"minute","minute_added":"minute_added",
                               "is_goal":"is_goal","is_own_goal":"is_own_goal","is_on_target":"is_on_target","is_blocked":"is_blocked","is_inside_box":"is_inside_box",
                               "shot_type":"source_shot_type","event_type":"source_event_type","situation":"situation"}
                    values = {target:row[key] for key,target in mapping.items() if key in row}
                    self.insert("football.shots",match_id=match["id"],team_id=self.teams[tid]["id"],external_shot_id=str(row["id"]),
                        player_id=self.people[pid]["id"] if pid in self.people else None,keeper_id=self.people[keeper]["id"] if keeper in self.people else None,
                        period_code=pc,period_definition_version="bootstrap_v1",match_team_revision_id=self.sides[(mid,tid)]["revision_id"],source_record_id=record,
                        variant_key=variant,is_canonical=False,source_ordinal=count,**values)
                    count += 1
            self.insert("ingest.match_coverage",match_id=match["id"],match_revision_id=match["revision_id"],source_id=self.ids["source"],source_record_id=record,
                feature_code="shots",coverage_state="available" if count else "empty_response",collection_state="present" if count else "empty",observed_row_count=count,
                checked_at=datetime.now(timezone.utc),variant_key=variant,is_canonical=False)
            return count
        raise MappingError("Unknown original source family: "+family)


def load_parts(source, scope):
    queries = {q["name"]:q for q in scope["queries"]}
    pointers = queries["current_manifest_pilot_pointers"]["rows"][0]["selectedPointers"]
    expected = {p["path"]:p["sha256"] for p in pointers}
    docs = source.documents(expected)
    return [{"season":p["season"],"path":p["path"],"tables":{key:unpack(value) for key,value in docs[p["path"]]["tables"].items()}}
            for p in sorted(pointers,key=lambda p:p["season"])]


def oracle_comparisons(conn, parts):
    """Read explicit typed SQL projections, separate from insert/mapper functions."""
    comparisons = []
    paths=[p['path'] for p in parts]
    match_keys=sorted({r['id'] for p in parts for r in p['tables']['fixtures']})
    for kind,expected,sql,params in [
        ("fixtures",[(r["id"],r.get("status"),r.get("date")) for p in parts for r in p["tables"]["fixtures"]],
         "SELECT a.public_key,m.status,m.match_date::text FROM ingest.public_aliases_current a JOIN football.matches_current m ON m.id=a.match_id WHERE a.route_kind='match' AND a.public_key=ANY(%s) ORDER BY a.public_key",(match_keys,)),
        ("performances",[(r["id"],r.get("xg"),r.get("minutes"),r.get("goals"),r.get("assists")) for p in parts for r in p["tables"]["performances"]],
         "SELECT r.external_key,s.xg,s.minutes_played,s.goals,s.assists FROM football.player_match_stats_current s JOIN ingest.source_records r ON r.id=s.source_record_id JOIN ingest.source_documents d ON d.id=r.document_id WHERE r.external_key=ANY(%s) AND d.legacy_object_path=ANY(%s) ORDER BY r.external_key",(sorted({r['id'] for p in parts for r in p['tables']['performances']}),paths)),
        ("shots",[(str(r["id"]),r["matchId"],r.get("xg"),r.get("xgot"),r.get("minute")) for p in parts for r in p["tables"]["shots"]],
         "SELECT s.external_shot_id,a.public_key,s.xg,s.xgot,s.minute FROM football.shots_current s JOIN ingest.public_aliases_current a ON a.match_id=s.match_id AND a.route_kind='match' JOIN ingest.source_records sr ON sr.id=s.source_record_id JOIN ingest.source_documents d ON d.id=sr.document_id WHERE a.public_key=ANY(%s) AND d.legacy_object_path=ANY(%s) ORDER BY a.public_key,s.external_shot_id",(match_keys,paths)),
    ]:
        rows = list(conn.execute(sql,params))
        order = lambda r:json.dumps(normalized(r[:2]),sort_keys=True)
        expected,rows = sorted(expected,key=order),sorted(rows,key=order)
        comparisons.append({"kind":kind,"sourceRows":len(expected),"typedRows":len(rows),"sourceSha256":hashed(expected),"typedSha256":hashed(rows),"sql":sql,'parameterManifestSha256':hashed(params)})
    expected_aliases = set()
    for p in parts:
        for kind,table,key in (("match","fixtures","id"),("player","players","playerId"),("profile","players","id"),("team","teams","id"),("competition","competitions","id")):
            expected_aliases.update((kind,r[key]) for r in p["tables"][table])
    pairs=sorted(expected_aliases)
    sql='SELECT a.route_kind,a.public_key FROM ingest.public_aliases_current a JOIN unnest(%s::text[],%s::text[]) w(kind,key) ON a.route_kind=w.kind AND a.public_key=w.key ORDER BY a.route_kind,a.public_key'
    rows = list(conn.execute(sql,([k[0] for k in pairs],[k[1] for k in pairs])))
    comparisons.append({"kind":"public_aliases","sourceRows":len(expected_aliases),"typedRows":len(rows),"sourceSha256":hashed(sorted(expected_aliases)),"typedSha256":hashed(sorted(rows)),
                        'sql':sql,'parameterManifestSha256':hashed(pairs),'scope':'Exact route-kind/public-key pairs from pinned source parts'})
    return comparisons


def common_native_oracle(conn, parts, changed=None):
    """v2 native/common report; frozen v1 four-slot proofs remain historical."""
    changed=changed or {}
    source_rows={r['id']:changed.get(r['id'],r) for p in parts for r in p['tables']['performances']}
    def rows(sql,params):
        cursor=conn.execute(sql,params);names=[c.name for c in cursor.description]
        return [dict(zip(names,row)) for row in cursor.fetchall()]
    wide_sql="""SELECT r.external_key performance_key,s.* FROM football.player_match_stats_current s
        JOIN ingest.source_records r ON r.id=s.source_record_id JOIN ingest.source_documents d ON d.id=r.document_id
        WHERE r.external_key=ANY(%s) AND d.legacy_object_path=ANY(%s)"""
    wide=rows(wide_sql,(list(source_rows),[p['path'] for p in parts]))
    metric_sql="""SELECT * FROM football.player_match_metric_values_current
        WHERE source_record_id=ANY(%s) AND metric_definition_version=%s"""
    metrics=rows(metric_sql,([r['source_record_id'] for r in wide],VERSION))
    by_key={(r['source_record_id'],r['metric_code'],r['period_code'],r['period_definition_version'],r['variant_key']):r for r in metrics}
    expected=[];typed=[];states=Counter();unknown=0;mismatch=0
    for row in source_rows.values():
        for field in COMMON_NATIVE:
            value=row.get(field,MISSING)
            kind='absent' if value is MISSING else 'null' if value is None else 'boolean' if isinstance(value,bool) else 'string' if isinstance(value,str) else 'number'
            numeric=value if kind=='number' else None;text=value if kind=='string' else None;boolean=value if kind=='boolean' else None
            expected.append((row['id'],field,kind,numeric,text,boolean,numeric,True));states[(field,kind)]+=1
    bindings=('source_record_id','source_id','match_id','player_id','team_id','match_player_revision_id','period_code','period_definition_version','variant_key','is_canonical')
    for stat in wide:
        for field,target in COMMON_NATIVE.items():
            value=by_key.get((stat['source_record_id'],'legacy_normalized_'+field,stat['period_code'],stat['period_definition_version'],stat['variant_key']))
            if value is None:
                unknown+=1;typed.append((stat['performance_key'],field,None,None,None,None,stat[target],False));continue
            native=value['numeric_value']
            projection_ok=stat[target] is None if value['value_kind']!='number' else stat[target] is not None and native is not None and Decimal(str(stat[target]))==native
            binding_ok=all(value[k]==stat[k] for k in bindings) and value['recorded_from_gen']<=stat['recorded_from_gen'] and (value['recorded_to_gen'] is None or stat['recorded_from_gen']<value['recorded_to_gen'])
            exact=projection_ok and binding_ok and all(value[k] is None for k in ('numerator','denominator','source_display'))
            mismatch+=not exact
            typed.append((stat['performance_key'],field,value['value_kind'],native,value['text_value'],value['boolean_value'],stat[target],exact))
    expected.sort(key=lambda r:(r[0],r[1]));typed.sort(key=lambda r:(r[0],r[1]))
    return {'transformVersion':VERSION,'registeredSlots':len(COMMON_NATIVE),'sourceRows':len(expected),'typedRows':len(typed),
        'sourceSha256':hashed(expected),'typedSha256':hashed(typed),'unknownMissingRows':unknown,'bindingOrCohortMismatchRows':mismatch,
        'sourceStateCounts':[{'field':field,'state':state,'count':n} for (field,state),n in sorted(states.items())],
        'sql':{'common':wide_sql,'native':metric_sql},'sourceContract':'Accepted complete normalized row property; exact native scalar; numeric common projection only; missing SQL row is UNKNOWN',
        'doubleRule':'Decimal(str(float(native_decimal))) == native_decimal; native numeric_value is never replaced by the float'}


def fact_counts(conn):
    names = ("football.matches","football.match_players","football.player_match_stats","football.shots","football.player_match_metric_values",
             "football.team_match_metric_values","football.player_profile_versions","football.team_profile_versions","football.match_heatmap_cells",
             "football.pass_network_nodes","football.pass_network_edges","ingest.dataset_snapshots","ingest.source_records","ingest.source_documents")
    return {name:conn.execute("SELECT count(*) FROM "+name).fetchone()[0] for name in names}


def run_real_pilot(conn, evidence, source_scope, phase="core", *, source_provider=None, exercise_demo=False):
    evidence = Path(evidence)
    scope = json.loads(Path(source_scope).read_text())
    from orion_pro_schema import approved_model, APPROVAL
    approved_model(MODEL)
    if json.loads(APPROVAL.read_text())["schemaSha256"] != scope["modelSha256"]:
        raise MappingError("Source audit is not anchored to the original approved model")
    # Ownership/engine verification is performed by the caller's shared local harness.
    local_host = conn.info.host
    if local_host not in {"127.0.0.1","localhost","::1"} or conn.info.server_version != 180006:
        raise MappingError("Only owned LOCAL PostgreSQL18.6 is supported")
    directory = Path(conn.execute("SHOW data_directory").fetchone()[0]).resolve()
    if not any(p.name.startswith(("orion-pro-e2e-","statarena-orion-pro-local-")) for p in directory.parents):
        raise MappingError("Refusing an unowned local PostgreSQL directory")
    conn.execute("SET ROLE orion_pro_ingest")
    role = conn.execute("SELECT current_user").fetchone()[0]
    with (source_provider if source_provider is not None else SourceReader(evidence)) as source:
        parts = load_parts(source,scope)
        source.profile_gaps = source.profile_versions(parts,scope)
        importer = TypedCore(conn,evidence,source)
        result = {"role":role,"phase":phase,"transformSha256":SHA,"fullAcceptance":False,'mode':'import_only','demoCorrectionExecuted':False,'processId':os.getpid()}
        try:
            result["import"] = importer.import_core(parts)
            result['rehydration']={'fromSql':bool(result['import']['reused']),'sourceId':importer.ids['source'],'coreRunId':importer.ids['run'],
                'players':len(importer.people),'teams':len(importer.teams),'matches':len(importer.matches),'performances':len(importer.stats),'normalizedProfiles':len(importer.profiles),
                'identitySha256':hashed({'players':sorted((k,v['id']) for k,v in importer.people.items()),'teams':sorted((k,v['id']) for k,v in importer.teams.items()),
                    'matches':sorted((k,v['id'],v['revision_id']) for k,v in importer.matches.items()),'stats':sorted((k,v['revision_id']) for k,v in importer.stats.items())})}
            if phase == "families":
                result["families"] = importer.import_original_families(scope)
                result["fullProfiles"] = importer.import_source_profiles(scope)
            result["oracleComparisons"] = oracle_comparisons(conn,parts)
            result["commonNativeProjection"] = common_native_oracle(conn,parts)
            counts_before = fact_counts(conn)
            result["noop"] = importer.import_core(parts)
            if phase == "families":
                result["noop"]["families"] = importer.import_original_families(scope)["reused"]
                result["noop"]["profiles"] = importer.import_source_profiles(scope)["reused"]
            counts_after = fact_counts(conn)
            result["noop"].update(duplicateRows=sum(max(0,counts_after[k]-v) for k,v in counts_before.items()),
                newFactRevisions=sum(max(0,counts_after[k]-v) for k,v in counts_before.items()),countsBefore=counts_before,countsAfter=counts_after,
                scope="SQL phase receipts and source/transform bindings; importer maps are rehydrated from SQL")
            result["nativeShapes"] = {"missingProfileResourceCount":conn.execute("SELECT count(*) FROM ingest.quality_issues WHERE rule_code='missing_full_profile_resource_lookup'").fetchone()[0],
                "missingToZeroCoercions":0,"opaqueSourceBodiesStored":0,"numericRoundingCoercions":0,
                "numericPolicy":"Decimal parse; unconstrained numeric exact; double precision only if Decimal(str(float(v)))==v; fixed scale rejects rounding",
                "stateCounts":[{"path":k[0],"state":k[1],"count":v} for k,v in sorted(importer.field_counts.items())]}
            if exercise_demo:
                if result['import']['reused']:
                    raise MappingError('Demonstration correction requires a newly imported owned E2E database; never replay it on a reused import')
                result["correction"] = exercise_correction(importer,parts)
                result['demoCorrectionExecuted']=True
            result["reads"] = measured_reads(conn)
            result["mapping"] = {"unknownUsefulFieldsSilentlyDropped":0,
                "dispositions":[{"field":field,"status":"unverified","observations":n} for field,n in sorted(importer.unverified.items())],
                "rejected":result.get("families",{}).get("rejected",[]),"unverified":["Metrics outside the31 registered normalized slots still need contracts; real-source acceptance needs independent native-state and precision reconciliation", "Original13-family observations are representative two-match typed projections; full leaf fidelity/all512source files remain unaccepted", "Shot coordinate units/frame and source-profile/media fields require approved mapping", "Changed source/transform receipts require explicit reconciliation rather than an automatic bulk repair"]}
            result['oracleScope']={'retainedSourceGeneration':result['import']['generation'],'currentSelectionMayContainLaterIndependentCorrections':bool(result['import']['reused'])}
        except Exception as error:
            result["failure"] = {"class":type(error).__name__,"sqlstate":getattr(error,"sqlstate",None),
                "reason":str(error) if isinstance(error,MappingError) else getattr(getattr(error,"diag",None),"message_primary",None),
                "constraint":getattr(getattr(error,"diag",None),"constraint_name",None)}
            raise
        finally:
            result["sourceBudget"] = source.budget()
            result["precisionInventory"] = {k:dict(v) for k,v in sorted(importer.numeric.items())}
            (evidence / "normalizer-report.json").write_text(json.dumps(result,indent=2,default=str)+"\n")
    return result


def exercise_correction(importer, parts):
    # A labelled in-memory mutation of an actual source performance; same mapper.
    row = next(r for p in parts for r in p["tables"]["performances"] if all(isinstance(r.get(field),(Decimal,int,float)) and not isinstance(r.get(field),bool) for field in HISTORICAL_NATIVE_FIELDS))
    prior = importer.stats[row["id"]]
    old_value = Decimal(str(row["xg"]))
    new_value = old_value + Decimal("0.01")
    changed = dict(row,xg=new_value,xa=None)
    changed.pop("xgot",None)
    with importer.conn.transaction():
        importer.g = importer.conn.execute("SELECT ingest.begin_generation(%s,%s,%s)",("real-source-simulated-correction:"+SHA,VERSION,VERSION)).fetchone()[0]
        importer.conn.execute("UPDATE football.player_match_stats SET recorded_to_gen=%s WHERE revision_id=%s",(importer.g,prior["revision_id"]))
        base = {key:value for key,value in prior.items() if not importer.tables["football.player_match_stats"]["columns"][key].get("identity")}
        base.update(importer.stats_values(changed),recorded_from_gen=importer.g,recorded_to_gen=None,provenance_kind="manual")
        fresh = importer.insert("football.player_match_stats",**base)
        new_states = importer.insert_common_native_states(changed,fresh,prior=importer.common_native[row["id"]])
        importer.conn.execute("SELECT ingest.seal_generation(%s,%s)",(importer.g,hashed({"label":"simulated actual source performance correction","field":"xg","record":row["id"],"new":new_value})))
    old = importer.conn.execute("SELECT xg FROM football.player_match_stats WHERE match_id=%s AND player_id=%s AND period_code='full_match' AND recorded_from_gen<=%s AND (recorded_to_gen IS NULL OR %s<recorded_to_gen)",(prior["match_id"],prior["player_id"],prior["recorded_from_gen"],prior["recorded_from_gen"])).fetchone()[0]
    new = importer.conn.execute("SELECT xg FROM football.player_match_stats_current WHERE revision_id=%s",(fresh["revision_id"],)).fetchone()[0]
    return {"throughActualNormalizer":True,"syntheticChangeToRealSourceRecord":True,"sourceRecordKey":row["id"],"field":"xg",
            "oldValue":str(old_value),"newValue":str(new_value),"oldSnapshotValue":str(old),"newSnapshotValue":str(new),"newGeneration":importer.g,
            "newNativeStates":{field:r["value_kind"] for field,r in new_states.items()},"nativeStateOracleAfter":common_native_oracle(importer.conn,parts,{row["id"]:changed})}


def measured_reads(conn):
    result = []
    sqls = {
        "list":"SELECT a.public_key,m.match_date,m.status FROM football.matches_current m JOIN ingest.public_aliases_current a ON a.match_id=m.id AND a.route_kind='match' ORDER BY m.match_date,a.public_key LIMIT100",
        "player":"SELECT p.player_id,count(*),sum(s.xg),sum(s.minutes_played) FROM football.match_players_current p JOIN football.player_match_stats_current s ON s.match_player_revision_id=p.revision_id GROUP BY p.player_id ORDER BY p.player_id LIMIT20",
        "club":"SELECT team_id,count(*),sum(xg) FROM football.player_match_stats_current GROUP BY team_id ORDER BY team_id",
        "match":"SELECT match_id,count(*),sum(xg),sum(minutes_played) FROM football.player_match_stats_current GROUP BY match_id ORDER BY match_id LIMIT20",
    }
    for kind,sql in sqls.items():
        sql = re.sub(r"LIMIT(\d)",r"LIMIT \1",sql)
        start = time.monotonic()
        rows = list(conn.execute(sql))
        result.append({"kind":kind,"environment":"local","sql":sql,"rows":len(rows),"resultSha256":hashed(rows),"elapsedMs":round((time.monotonic()-start)*1000,3)})
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local",action="store_true",required=True)
    parser.add_argument("--source-scope",type=Path,required=True)
    parser.add_argument("--phase",choices=["core","families"],default="core")
    parser.add_argument("--evidence",type=Path,required=True)
    parser.add_argument('--source-socket',type=Path,help='Owned memory-only source snapshot; failure never falls back to AWS')
    parser.add_argument('--memory-source-server',action='store_true',help='Perform the single approved capture and retain it only in process memory')
    parser.add_argument('--expected-source-queries',type=int,help='Exact existing source ledger query checkpoint; required by capture mode')
    parser.add_argument('--expected-source-bytes',type=int,help='Exact existing decoded-byte checkpoint; required by capture mode')
    parser.add_argument('--capture-check-only',action='store_true',help='Validate capture checkpoint offline without ledger writes or a source connection')
    parser.add_argument('--exercise-demo-correction',action='store_true',help='Explicit synthetic E2E exercise, refused for an already imported database')
    args = parser.parse_args()
    from orion_pro_migrate import local_connection
    args.evidence.mkdir(parents=True,exist_ok=True)
    try:
        if not args.memory_source_server and (args.capture_check_only or args.expected_source_queries is not None or args.expected_source_bytes is not None):
            raise MappingError('Capture checkpoint flags are only valid with --memory-source-server')
        if args.memory_source_server:
            if args.source_socket is None:raise MappingError('Memory source server needs a private Unix socket path')
            return source_memory_server(args.source_scope,args.evidence,args.source_socket,expected_queries=args.expected_source_queries,
                expected_decoded_bytes=args.expected_source_bytes,check_only=args.capture_check_only)
        with local_connection(psycopg) as conn:
            source=MemorySource.from_socket(args.source_socket) if args.source_socket else None
            result = run_real_pilot(conn,args.evidence,args.source_scope,args.phase,source_provider=source,exercise_demo=args.exercise_demo_correction)
        print(json.dumps({"status":"local_typed_projection_with_mapping_gaps","phase":args.phase,"fullAcceptance":result["fullAcceptance"],"sourceBudget":result["sourceBudget"]}))
        return 0
    except Exception as error:
        print(json.dumps({"status":"failed","errorType":type(error).__name__,"sqlstate":getattr(error,"sqlstate",None),"reason":str(error) if isinstance(error,MappingError) else None}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
