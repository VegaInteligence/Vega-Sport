#!/usr/bin/env python3
"""Archive a pinned data tree and verify its complete transfer to Neon storage."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import time
import urllib.error
import urllib.request


def emit(**value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    temporary.replace(path)


def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for body in iter(lambda: stream.read(1024*1024), b''):
            digest.update(body)
    return digest.hexdigest()


def descriptor(path, output):
    return {'file':path.relative_to(output).as_posix(), 'size':path.stat().st_size,
            'sha256':file_hash(path),
            'contentType':'text/markdown' if path.suffix == '.md' else
                          'application/json' if path.suffix == '.json' else 'application/gzip'}


class HashingReader:
    def __init__(self, stream, size):
        self.stream, self.count = stream, 0
        self.sha256 = hashlib.sha256()
        self.git = hashlib.sha1(f'blob {size}\0'.encode())

    def read(self, size=-1):
        body = self.stream.read(size)
        self.count += len(body)
        self.sha256.update(body)
        self.git.update(body)
        return body


def verify_parts(output, manifest, parts):
    expected = {}
    with gzip.open(manifest, 'rt') as stream:
        for line in stream:
            row = json.loads(line)
            assert row['path'] not in expected, 'Duplicate manifest path'
            expected[row['path']] = row
    count = 0
    for part in parts:
        with tarfile.open(output/part['file'], 'r|gz') as archive:
            for member in archive:
                row = expected.pop(member.name)
                assert row['part'] == part['file'], 'Incorrect archive part'
                reader = HashingReader(archive.extractfile(member), member.size)
                while reader.read(1024*1024): pass
                assert reader.count == row['size'], 'Archive member size mismatch'
                assert reader.sha256.hexdigest() == row['sha256'], 'Archive member hash mismatch'
                assert reader.git.hexdigest() == row['gitBlob'], 'Archive Git blob mismatch'
                count += 1
        emit(stage='local-verification', part=part['file'], verifiedFiles=count)
    assert not expected, 'Manifest files missing from archives'
    return count


def pack(args):
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    assert not (output/'snapshot.json').exists(), 'Snapshot already exists; use transfer to resume'
    expected = {}
    for row in args.tree.read_bytes().split(b'\0'):
        if not row: continue
        metadata, path = row.split(b'\t', 1)
        mode, kind, sha = metadata.decode().split()
        assert mode == '100644' and kind == 'blob', 'Unsupported source file mode'
        expected[path.decode()] = sha
    source_count = len(expected)
    assert source_count, 'Empty source data tree'
    archive = None
    part_bytes, total_bytes, count = 0, 0, 0
    parts = []
    manifest = output/'manifest.jsonl.gz'
    try:
        with gzip.open(manifest, 'wt') as records:
            with urllib.request.urlopen(args.source_url, timeout=120) as response:
                with tarfile.open(fileobj=response, mode='r|gz') as source:
                    for member in source:
                        relative = '/'.join(Path(member.name).parts[1:])
                        if not relative.startswith('data/') or member.isdir(): continue
                        assert member.isfile() and relative in expected, 'Unexpected or duplicate data path'
                        assert '..' not in Path(relative).parts, 'Unsafe source path'
                        if not archive or part_bytes + member.size > args.part_mib*1024**2:
                            if archive:
                                archive.close()
                                parts.append(descriptor(part_path, output))
                                emit(stage='packed-part', **parts[-1])
                            part_path = output/f'part-{len(parts)+1:04d}.tar.gz'
                            archive = tarfile.open(part_path, 'w:gz', compresslevel=1)
                            part_bytes = 0
                        reader = HashingReader(source.extractfile(member), member.size)
                        target = tarfile.TarInfo(relative)
                        target.size, target.mode, target.mtime = member.size, 0o644, 0
                        archive.addfile(target, reader)
                        assert reader.count == member.size, 'Incomplete source member'
                        assert reader.git.hexdigest() == expected.pop(relative), 'Source content differs from pinned Git tree'
                        records.write(json.dumps({'path':relative, 'size':member.size,
                            'sha256':reader.sha256.hexdigest(), 'gitBlob':reader.git.hexdigest(),
                            'part':part_path.name}, ensure_ascii=False)+'\n')
                        count += 1
                        part_bytes += member.size
                        total_bytes += member.size
                        if count % 5000 == 0:
                            assert shutil.disk_usage(output).free >= 3*1024**3, 'Local free space below 3 GiB'
                            emit(stage='pack', files=count, expectedFiles=source_count, rawBytes=total_bytes)
        if archive:
            archive.close(); archive = None
            parts.append(descriptor(part_path, output))
        assert not expected and count == source_count, 'Incomplete source snapshot'
        verified = verify_parts(output, manifest, parts)
        assert verified == count
        readme = output/'README.md'
        readme.write_text(f'''# StatArena data snapshot

Source: https://github.com/OrionQuantPlatform/STATARENA/tree/{args.snapshot}/data

Snapshot: {args.snapshot}
Files: {count}
Original file bytes: {total_bytes}

All original data/ paths and bytes are preserved in part-*.tar.gz.
manifest.jsonl.gz maps every path to an archive part, byte length, SHA-256 and Git blob hash.
snapshot.json lists the archive objects and their SHA-256 values.
VERIFIED.json records successful upload and independent download verification.

To restore: download the parts, check their SHA-256 against snapshot.json,
then extract each part into the same empty directory using tar -xzf part-NNNN.tar.gz.
Keep the data/ prefix. To access one file, download its manifest-selected part
and extract that original path. Source GitHub/local copies were not deleted.
''')
        objects = parts+[descriptor(manifest, output), descriptor(readme, output)]
        assert sum(item['size'] for item in objects) < 5_000_000_000-1_000_000, 'Free object-storage allowance exceeded'
        summary = {'snapshot':args.snapshot, 'sourceUrl':args.source_url,
            'files':count, 'rawBytes':total_bytes, 'locallyVerifiedFiles':verified,
            'prefix':f'snapshots/{args.snapshot}/', 'objects':objects}
        write_json(output/'snapshot.json', summary)
        emit(stage='pack-complete', files=count, rawBytes=total_bytes,
            storedBytes=sum(item['size'] for item in objects), parts=len(parts))
    finally:
        if archive: archive.close()


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None


def transfer_one(path, signatures, expected):
    assert path.stat().st_size == expected['size'] and file_hash(path) == expected['sha256'], 'Local object changed'
    opener = urllib.request.build_opener(NoRedirects())
    for attempt in range(5):
        try:
            signed = signatures['upload']
            headers = {**signed.get('headers', {}), 'Content-Length':str(expected['size'])}
            with path.open('rb') as stream:
                request = urllib.request.Request(signed['url'], data=stream, headers=headers, method='PUT')
                with opener.open(request, timeout=180) as response:
                    assert 200 <= response.status < 300
            signed = signatures['download']
            request = urllib.request.Request(signed['url'], headers=signed.get('headers', {}))
            digest, size = hashlib.sha256(), 0
            with opener.open(request, timeout=180) as response:
                for body in iter(lambda: response.read(1024*1024), b''):
                    size += len(body); digest.update(body)
            assert size == expected['size'] and digest.hexdigest() == expected['sha256'], 'Remote object content mismatch'
            return {'file':expected['file'], 'size':size, 'sha256':digest.hexdigest(), 'verified':True}
        except urllib.error.HTTPError as error:
            if error.code not in (429,500,502,503,504) or attempt == 4: raise
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt == 4: raise
        time.sleep(2**attempt)


def object_list(output):
    summary = json.loads((output/'snapshot.json').read_text())
    return summary, summary['objects']+[descriptor(output/'snapshot.json', output)]


def transfer(args):
    summary, objects = object_list(args.output)
    assert summary['files'] == summary['locallyVerifiedFiles'], 'Local file verification incomplete'
    assert sum(item['size'] for item in objects) < 5_000_000_000, 'Storage allowance exceeded'
    signatures = json.loads(args.urls.read_text())
    verified = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(transfer_one, args.output/item['file'], signatures[item['file']], item) for item in objects]
        for future in as_completed(futures):
            row = future.result(); verified.append(row)
            write_json(args.output/'transfer-progress.json', {'verifiedObjects':verified})
            emit(stage='remote-verified', **row)
    receipt = {'snapshot':summary['snapshot'], 'files':summary['files'],
        'rawBytes':summary['rawBytes'], 'storedBytes':sum(row['size'] for row in verified),
        'bucket':'statarena-data', 'project':'sweet-queen-11955006',
        'branch':'br-mute-bonus-be23014e', 'prefix':summary['prefix'],
        'verifiedObjects':sorted(verified,key=lambda row:row['file']),
        'verifiedAt':datetime.now(timezone.utc).isoformat(), 'status':'verified'}
    write_json(args.output/'VERIFIED.json', receipt)
    transfer_one(args.output/'VERIFIED.json', signatures['VERIFIED.json'], descriptor(args.output/'VERIFIED.json', args.output))
    emit(stage='migration-verified', files=summary['files'], objects=len(verified)+1, storedBytes=receipt['storedBytes'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('pack','objects','transfer'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--snapshot')
    parser.add_argument('--source-url')
    parser.add_argument('--tree', type=Path)
    parser.add_argument('--part-mib', type=int, default=128)
    parser.add_argument('--urls', type=Path)
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args()
    if args.command == 'pack': pack(args)
    elif args.command == 'transfer': transfer(args)
    else:
        summary, objects = object_list(args.output)
        emit(prefix=summary['prefix'], objects=objects+[{'file':'VERIFIED.json','contentType':'application/json'}])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Presigned URL query strings must never reach persisted logs.
        emit(status='failed', errorType=type(error).__name__, httpStatus=getattr(error,'code',None),
             detail=str(error) if isinstance(error,AssertionError) else None)
        raise SystemExit(1)
