#!/usr/bin/env python3
"""Restore locally accessible raw data from the checked GitHub bundles."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile

ROOT = Path(__file__).resolve().parents[2]
BUNDLES = ROOT / 'data' / 'sources' / 'pitchapi' / 'bundles'
ARCHIVES = ('europe_2026_2027', 'europe_2021_2026')


def destination(base, name):
    parts = PurePosixPath(name)
    if parts.is_absolute() or not parts.parts or any(p in ('', '.', '..') for p in parts.parts):
        raise ValueError('Invalid bundle path')
    target = base.joinpath(*parts.parts)
    if not target.resolve().is_relative_to(base.resolve()):
        raise ValueError('Bundle path leaves the archive')
    return target


def restore_archive(source, target, overwrite=False):
    source, target = Path(source), Path(target)
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    if manifest['archive'] != target.name or manifest['archive'] not in ARCHIVES:
        raise ValueError('Bundle archive name mismatch')
    written = skipped = 0
    for item in manifest['bundles']:
        file = destination(source, item['path'])
        if hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError(f'Bundle checksum mismatch: {item["path"]}')
        with tarfile.open(file, mode='r:gz') as tar:
            for member in tar:
                if not member.isfile():
                    raise ValueError('Unexpected non-file bundle member')
                output = destination(target, member.name)
                if output.exists() and not overwrite:
                    skipped += 1
                    continue
                output.parent.mkdir(parents=True, exist_ok=True)
                temporary = output.with_name(f'{output.name}.{os.getpid()}.tmp')
                with tar.extractfile(member) as stream, temporary.open('wb') as dst:
                    shutil.copyfileobj(stream, dst)
                temporary.replace(output)
                written += 1
    for item in manifest['metadata']:
        file = destination(source, item['path'])
        if hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError(f'Metadata checksum mismatch: {item["path"]}')
        output = destination(target, item['target'])
        if output.exists() and not overwrite:
            skipped += 1
            continue
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(f'{output.name}.{os.getpid()}.tmp')
        with gzip.open(file,'rb') as src, temporary.open('wb') as dst:
            shutil.copyfileobj(src,dst)
        temporary.replace(output)
        written += 1
    print(f'{target.name}: {written} files restored, {skipped} existing files kept')
    return written, skipped


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--overwrite',action='store_true',help='Replace existing local records with the bundled copies.')
    args=parser.parse_args()
    for name in ARCHIVES:
        source=BUNDLES/name
        if (source/'manifest.json').is_file():
            restore_archive(source,ROOT/'data'/'sources'/'pitchapi'/'archives'/name,args.overwrite)


if __name__ == '__main__':
    main()
