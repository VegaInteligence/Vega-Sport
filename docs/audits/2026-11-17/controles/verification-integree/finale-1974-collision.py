"""Replay the normal OpenFootball and Fjelstul ingestion and the public reader on an exact commit."""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import uuid
from unittest.mock import patch

import psycopg
from psycopg import sql

p=argparse.ArgumentParser()
p.add_argument("repo",type=Path)
p.add_argument("revision")
p.add_argument("receipt",type=Path)
p.add_argument("--port",type=int,required=True)
p.add_argument("--expect-refusal",action="store_true")
p.add_argument("--double",choices=("simultane","apres-numero"))
p.add_argument("--sources-en-cours",action="store_true")
p.add_argument("--exiger-refus-ambiguite",action="store_true")
a=p.parse_args()
repo=a.repo.resolve()
git=["git","-C",str(repo)]
revision=subprocess.check_output([*git,"rev-parse",a.revision+"^{commit}"],text=True).strip()
reader=Path(__file__).resolve().with_name("finale-1974-reader.mjs")
base=f"postgresql://postgres@127.0.0.1:{a.port}/"
dbname="vega_v2_revue_finale_"+uuid.uuid4().hex[:14]
now=datetime(2026,11,9,8,tzinfo=timezone.utc)
scope="open-cups:world-cup-history:1974"
def archived(number):
    final={"round":"Final","date":"1974-07-07","team1":"West Germany","team2":"Netherlands","score":[2,1]}
    if number:final["num"]=38
    finals=[final]
    if number=="both": finals.append({k:v for k,v in final.items() if k!="num"})
    return {"name":"World Cup 1974","season":"1974","source":{"name":"OpenFootball","url":"https://github.com/openfootball/worldcup.json"},"matches":[*finals,
       {"round":"Matchday 1","group":"Group 1","date":"1974-06-14","team1":"USA","team2":"Sweden","score":{"ft":[1,1],"et":[1,1],"p":[4,5]}},
       {"round":"Matchday 1","group":"Group 2","date":"1974-06-13","team1":"Brazil","team2":"Yugoslavia","score":[0,0]}]}
def sha(data):return hashlib.sha256(data).hexdigest()
def call(db,day,number):
    with patch.object(cups,"scopes",return_value={scope:timedelta(seconds=1)}),patch.object(cups,"bridge",return_value={"status":200,"body":archived(number)}):
        results=sources.run_due(db,None,now+timedelta(days=day),names={"openfootball"})
        return results[("openfootball",scope)]
def observe(db,root,previous=""):
    names=[r[0] for r in db.execute("SELECT tablename FROM pg_tables WHERE schemaname='core' AND tablename LIKE 'worldcup_%' ORDER BY tablename")]
    assert len(names)==12
    tables={}
    for table in names:
        query=sql.SQL("SELECT to_jsonb(t)::text FROM core.{} AS t ORDER BY 1").format(sql.Identifier(table))
        rows=[r[0] for r in db.execute(query)]
        tables[table]=[len(rows),sha(json.dumps(rows).encode())]
    (mid,)=db.execute("SELECT match_id FROM core.worldcup_matches WHERE match_key='M-1974-38'").fetchone()
    parents=db.execute("SELECT id,home_score,away_score,match_number FROM core.matches WHERE match_date='1974-07-07'").fetchall()
    keys=db.execute("SELECT provider_key,is_current FROM core.provider_ids WHERE entity_type='match' AND entity_id=%s AND provider='openfootball' ORDER BY provider_key",(mid,)).fetchall()
    http=json.loads(subprocess.check_output(["node",str(reader),str(root),base+dbname,"/api/worldcup/matches/M-1974-38",previous],text=True))
    return {"source_tables":tables,"canonical_id":mid,"finals":parents,"provider_keys":keys,"http":{"status":http["status"],"conditional":http["conditional"],"etag":http["etag"],"body_sha256":sha(json.dumps(http["body"],sort_keys=True).encode())}}
with tempfile.TemporaryDirectory() as tmp, psycopg.connect(base+"postgres",autocommit=True) as admin:
    root=Path(tmp)
    data=subprocess.check_output([*git,"archive",revision,"backend/vega","backend/sql","backend/tests","backend/api/src","dashboard/shared"])
    with tarfile.open(fileobj=io.BytesIO(data)) as ar:ar.extractall(root,filter="data")
    if a.sources_en_cours:
        for name in ("cups.py","snapshot.py"):
            (root/"backend/vega/sources"/name).write_bytes((repo/"backend/vega/sources"/name).read_bytes())
    (root/"backend/api/node_modules").symlink_to(repo/"backend/api/node_modules")
    sys.path[:0]=[str(root/"backend"),str(root/"backend/tests")]
    from vega import sources,store
    from vega.sources import cups,worldcup
    import worldcup_samples
    admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(dbname)))
    try:
        with store.connect_local(base+dbname) as db:
            store.migrate(db)
            db.execute("SET ROLE vega_collect")
            assert call(db,0,False)=="ok"
            inputs=worldcup_samples.texts()
            worldcup.FILES,worldcup.COMMIT=worldcup_samples.digests(inputs),"a"*40
            def fetch(url,**kwargs):return inputs[url.rsplit("/",1)[-1].removesuffix(".csv")]
            assert sources.run_due(db,fetch,now,names={"fjelstul"})[("fjelstul","worldcup")]=="ok"
            before=observe(db,root);assert before["http"]["status"]==200
            if a.double:
                first=None
                if a.double=="apres-numero":
                    first=call(db,1,True)
                    assert first=="ok",first
                accepted=observe(db,root)
                mix=call(db,3,"both")
                witness=observe(db,root)
                if a.exiger_refus_ambiguite:
                    assert mix not in ("ok","not_due","unchanged") and not a.sources_en_cours, mix
                    assert witness==accepted
                    assert accepted["canonical_id"]==before["canonical_id"] and len(accepted["finals"])==1
                    assert call(db,5,a.double=="apres-numero")=="ok"
                    assert observe(db,root)==accepted
                print(json.dumps({"verified_rejection":a.exiger_refus_ambiguite,"revision":revision,"uncommitted_working_sources":a.sources_en_cours,"case":a.double,"first":first,"mixed":mix,"before":before["finals"],"after":witness["finals"],"source_pair":witness["canonical_id"]}))
                sys.exit()
            transition=call(db,1,True)
            after=observe(db,root,before["http"]["etag"])
            repeat=call(db,2,True)
            last=observe(db,root,after["http"]["etag"])
            assert before["source_tables"]==after["source_tables"]==last["source_tables"]
            assert after==last
            old=before["canonical_id"];assert old and after["canonical_id"]==old
            assert before["finals"]==[(old,2,1,None)]
            if a.expect_refusal:
                assert transition==repeat=="SNAPSHOT_DROPS_RESULT" and before["finals"]==after["finals"]
            else:
                assert transition==repeat=="ok" and after["finals"]==[(old,2,1,38)]
                assert sum(1 for key,current in after["provider_keys"] if current and key.endswith("|38"))==1
            for reading in (after,last):
                assert reading["http"]["status"]==200 and reading["http"]["conditional"]==304
                assert reading["http"]["body_sha256"]==before["http"]["body_sha256"]
            receipt={"revision":revision,"verified":not a.expect_refusal,"expected_refusal":a.expect_refusal,"transition":transition,"repeat":repeat,"before":before,"after":after,"replay":last,"setup":"PostgreSQL 18, tables initialisées depuis le SHA, exemples OpenFootball 1974 et Fjelstul du dépôt via run_due et vega_collect, API avec vega_read","rerun":"python -I -B verifier-finale-1974.py CHEMIN_DEPOT "+revision+" resultat.json --port PORT_PG18_LOCAL"+(" --expect-refusal" if a.expect_refusal else "")}
            a.receipt.write_text(json.dumps(receipt,indent=2,ensure_ascii=False)+"\n")
            print(revision,transition,repeat,len(after["source_tables"]),after["http"])
    finally:
        admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(dbname)))
