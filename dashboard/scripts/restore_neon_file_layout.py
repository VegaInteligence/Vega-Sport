#!/usr/bin/env python3
"""Replace our verified archive objects with the exact original data/ keys."""
import argparse
import base64
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, wait, FIRST_COMPLETED
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
import tarfile
import time
import boto3
from botocore.config import Config

BUCKET = 'statarena-data'


def storage_client(credential, workers):
    return boto3.client('s3', endpoint_url=credential['endpoint'],region_name=credential['region'],
        aws_access_key_id=credential['accessKeyId'],aws_secret_access_key=credential['secretAccessKey'],
        config=Config(signature_version='s3v4',s3={'addressing_style':'path'},
            retries={'mode':'adaptive','total_max_attempts':8},max_pool_connections=workers+8,
            connect_timeout=15,read_timeout=90,request_checksum_calculation='when_required',response_checksum_validation='when_required'))


def initialize_transfer_process(credential, workers):
    global PROCESS_CLIENT, PROCESS_THREADS
    PROCESS_CLIENT = storage_client(credential, workers)
    PROCESS_THREADS = ThreadPoolExecutor(max_workers=workers)


def put_batch(batch):
    return list(PROCESS_THREADS.map(lambda pair: put_file(PROCESS_CLIENT,*pair),batch))


def emit(**value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    temporary.replace(path)


def downloaded_hash(client, key):
    body = client.get_object(Bucket=BUCKET, Key=key)['Body']
    digest, size = hashlib.sha256(), 0
    try:
        for chunk in iter(lambda: body.read(1024*1024), b''):
            digest.update(chunk); size += len(chunk)
    finally:
        body.close()
    return size, digest.hexdigest()


def put_file(client, row, body):
    digest = hashlib.md5(body)
    md5 = digest.hexdigest()
    content_type = 'application/gzip' if row['path'].endswith('.gz') else 'application/json' if row['path'].endswith('.json') else 'application/octet-stream'
    response = client.put_object(Bucket=BUCKET, Key=row['path'], Body=body,
        ContentType=content_type, ContentMD5=base64.b64encode(digest.digest()).decode(),
        Metadata={'sha256':row['sha256']})
    etag = response['ETag'].strip('"')
    check = 'server-md5'
    if etag != md5:
        assert downloaded_hash(client,row['path']) == (row['size'],row['sha256']), 'Downloaded object content mismatch'
        check = 'download-sha256'
    return (row['path'],row['part'],row['size'],row['sha256'],md5,etag,check)


def verify_samples(client, rows):
    candidates = [row for row in rows if row['size'] <= 2*1024**2] or rows
    selected = {row['path']:row for row in [candidates[0],candidates[len(candidates)//2],candidates[-1]]}
    samples = []
    for row in selected.values():
        assert downloaded_hash(client,row['path']) == (row['size'],row['sha256']), 'Sample download mismatch'
        samples.append({'path':row['path'],'size':row['size'],'sha256':row['sha256']})
    return samples


def full_inventory(client, db, expected_count, expected_bytes, prefix='', allowed_metadata=()):
    seen, total = set(), 0
    pages = client.get_paginator('list_objects_v2').paginate(Bucket=BUCKET, Prefix=prefix)
    for page_number, page in enumerate(pages, 1):
        for obj in page.get('Contents',[]):
            if obj['Key'] in allowed_metadata:
                continue
            row = db.execute('select size,etag from files where path=?',(obj['Key'],)).fetchone()
            assert row is not None and obj['Key'] not in seen, 'Unexpected/duplicate remote key'
            assert (obj['Size'],obj['ETag'].strip('"')) == row, 'Independent remote size/ETag mismatch'
            seen.add(obj['Key']); total += obj['Size']
        if page_number % 20 == 0:
            emit(stage='inventory', pages=page_number, files=len(seen), bytes=total)
    assert len(seen) == expected_count == db.execute('select count(*) from files').fetchone()[0], 'Missing original files'
    assert total == expected_bytes, 'Remote source-byte total mismatch'
    return {'files':len(seen),'bytes':total,'everyKeySizeAndEtagVerified':True,
        'topLevelPrefixes':sorted({key.split('/',1)[0]+'/' for key in seen if '/' in key})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archives', type=Path, required=True)
    parser.add_argument('--credential-file', type=Path, required=True)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=96)
    parser.add_argument('--processes', type=int, default=1)
    parser.add_argument('--batch-size', type=int, default=128)
    parser.add_argument('--stop-after-parts', type=int)
    args = parser.parse_args()
    args.state.mkdir(parents=True, exist_ok=True)
    credential = json.loads(args.credential_file.read_text())
    assert args.workers>0 and args.processes>0 and args.batch_size>0
    client = storage_client(credential,args.workers)
    snapshot = json.loads((args.archives/'snapshot.json').read_text())
    groups, expected_bytes = {}, 0
    with gzip.open(args.archives/'manifest.jsonl.gz','rt') as stream:
        for line in stream:
            row = json.loads(line)
            assert row['path'].startswith('data/') and '..' not in Path(row['path']).parts
            groups.setdefault(row['part'],[]).append(row)
            expected_bytes += row['size']
    assert sum(map(len,groups.values())) == snapshot['files']
    assert expected_bytes == snapshot['rawBytes']
    db = sqlite3.connect(args.state/'progress.sqlite')
    db.execute('pragma journal_mode=WAL')
    db.execute('create table if not exists files(path text primary key, part text, size integer, sha256 text, md5 text, etag text, check_method text)')
    db.execute('create table if not exists parts(name text primary key, receipt text)')
    uploaded = db.execute('select count(*) from files').fetchone()[0]
    last_reported = uploaded
    samples = []
    started = time.monotonic()
    pool_context = ProcessPoolExecutor(max_workers=args.processes,initializer=initialize_transfer_process,
        initargs=(credential,args.workers)) if args.processes>1 else ThreadPoolExecutor(max_workers=args.workers)
    with pool_context as pool:
        for part_number,(part,rows) in enumerate(sorted(groups.items()),1):
            if db.execute('select 1 from parts where name=?',(part,)).fetchone():
                emit(stage='part-already-complete',part=part); continue
            emit(stage='start-part',part=part,files=len(rows),alreadyUploaded=uploaded)
            expected = {row['path']:row for row in rows}
            assert len(expected)==len(rows),'Duplicate source path'
            pending = set()
            batch = []
            def drain(all_pending=False):
                nonlocal pending, uploaded, last_reported
                done,pending = wait(pending,return_when='ALL_COMPLETED' if all_pending else FIRST_COMPLETED)
                for future in done:
                    result = future.result()
                    for row in result if args.processes>1 else [result]:
                        db.execute('insert or replace into files values(?,?,?,?,?,?,?)',row)
                        uploaded += 1
                db.commit()
                if uploaded-last_reported>=1000 or all_pending:
                    emit(stage='upload',files=uploaded,elapsedSeconds=round(time.monotonic()-started))
                    last_reported=uploaded
            with tarfile.open(args.archives/part,'r|gz') as archive:
                for member in archive:
                    row = expected.pop(member.name)
                    assert member.isfile() and member.size==row['size']
                    body = archive.extractfile(member).read()
                    assert hashlib.sha256(body).hexdigest()==row['sha256'],'Source SHA-256 mismatch'
                    previous=db.execute('select size,sha256 from files where path=?',(row['path'],)).fetchone()
                    if previous:
                        assert previous==(row['size'],row['sha256']),'Resume source mismatch'
                        continue
                    if args.processes>1:
                        batch.append((row,body))
                        if len(batch)>=args.batch_size:
                            pending.add(pool.submit(put_batch,batch));batch=[]
                        if len(pending)>=args.processes*2:drain()
                    else:
                        pending.add(pool.submit(put_file,client,row,body))
                        if len(pending)>=args.workers*2:drain()
            if batch:pending.add(pool.submit(put_batch,batch))
            if pending:drain(True)
            assert not expected,'Archive is missing manifest entries'
            assert db.execute('select count(*) from files where part=?',(part,)).fetchone()[0]==len(rows)
            part_samples=verify_samples(client,rows); samples.extend(part_samples)
            # Only our redundant archive object is removed, after its members verify.
            client.delete_object(Bucket=BUCKET,Key=snapshot['prefix']+part)
            receipt={'files':len(rows),'samples':part_samples,'archiveReplaced':True}
            db.execute('insert into parts values(?,?)',(part,json.dumps(receipt)));db.commit()
            atomic_json(args.state/'progress.json',{'files':uploaded,'partsComplete':part_number,'partsTotal':len(groups),'lastPart':part})
            emit(stage='part-complete',part=part,files=uploaded,partFiles=len(rows),downloadSamples=len(part_samples))
            if args.stop_after_parts and part_number>=args.stop_after_parts:
                emit(stage='preflight-complete',files=uploaded,parts=part_number)
                return
    allowed={snapshot['prefix']+name for name in ('README.md','manifest.jsonl.gz','snapshot.json','VERIFIED.json')}
    # Audit the whole bucket once, allowing only our four known archive metadata
    # objects until cleanup. This proves both data coverage and root structure.
    inventory=full_inventory(client,db,snapshot['files'],snapshot['rawBytes'],allowed_metadata=allowed)
    remaining=client.list_objects_v2(Bucket=BUCKET,Prefix=snapshot['prefix']).get('Contents',[])
    assert {obj['Key'] for obj in remaining}.issubset(allowed),'Unexpected archive-prefix objects; preserve them'
    if remaining:
        response=client.delete_objects(Bucket=BUCKET,Delete={'Objects':[{'Key':obj['Key']} for obj in remaining],'Quiet':True})
        assert not response.get('Errors'),'Archive metadata cleanup failed'
    assert not client.list_objects_v2(Bucket=BUCKET,Prefix=snapshot['prefix']).get('Contents'),'Archive objects remain'
    # A flat, paginated full-bucket scan also detects unexpected root objects.
    # Grouped root listing times out on this provider at this object count.
    assert inventory['topLevelPrefixes']==['data/'],'Unexpected root structure'
    all_samples=[sample for (text,) in db.execute('select receipt from parts') for sample in json.loads(text)['samples']]
    result={'status':'verified','sourceCommit':snapshot['snapshot'],'bucket':BUCKET,
        'layout':'one object per original repository-relative data/... path',**inventory,
        'rootPrefixes':['data/'],'archiveObjectsRemaining':0,'downloadSamples':all_samples,
        'verification':'Every source SHA-256; every PUT Content-MD5 and server ETag (or full SHA-256 GET if opaque); independent full paginated key/size/ETag comparison; download samples from every part',
        'verifiedAt':datetime.now(timezone.utc).isoformat()}
    atomic_json(args.state/'VERIFIED.json',result)
    emit(stage='layout-verified',files=inventory['files'],bytes=inventory['bytes'],rootPrefixes=['data/'])


if __name__=='__main__':
    try:main()
    except Exception as error:
        response=getattr(error,'response',{})
        emit(status='failed',errorType=type(error).__name__,errorCode=response.get('Error',{}).get('Code'),
            httpStatus=response.get('ResponseMetadata',{}).get('HTTPStatusCode'),detail=str(error) if isinstance(error,AssertionError) else None)
        raise SystemExit(1)
