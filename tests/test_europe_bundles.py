"""Verify portable, lossless archives for the GitHub data snapshot."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


bundle=load('bundle_europe')
restore=load('restore_europe')


class BundleTests(unittest.TestCase):
    def test_round_trip_preserves_case_sensitive_ids_and_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);source=base/'original'/'europe_2021_2026';source.mkdir(parents=True)
            ids=['m_10VVHs','m_10vvHS'];league='l_000001'
            inventory={'retrieved_at_utc':'2026-11-01T00:00:00Z','competitions':[{'id':league,'season':'2025/2026','matches':[{'id':i,'status':'finished'} for i in ids]}]}
            (source/'inventory.json').write_text(json.dumps(inventory),encoding='utf-8')
            for identifier in ids:
                file=source/'matches'/league/f'{bundle.archive_name(identifier)}.json';file.parent.mkdir(parents=True,exist_ok=True)
                file.write_bytes(json.dumps({'id':identifier,'value':None}).encode())
            for identifier in ['p_10VVHs','p_10vvHS']:
                file=source/'profiles'/'players'/f'{bundle.archive_name(identifier)}.json';file.parent.mkdir(parents=True,exist_ok=True)
                file.write_bytes(json.dumps({'status':200,'data':{'id':identifier}}).encode())
            packed=base/'bundles';manifest=bundle.pack_archive(source,packed,b'not-present-secret')
            self.assertEqual(sum(item['files'] for item in manifest['bundles']),4)
            self.assertEqual(bundle.pack_archive(source,packed,b'not-present-secret'),manifest)
            target=base/'restored'/'europe_2021_2026'
            restore.restore_archive(packed,target)
            for original in source.rglob('*.json'):
                self.assertEqual((target/original.relative_to(source)).read_bytes(),original.read_bytes())
            self.assertEqual(restore.restore_archive(packed,target)[0],0)

    def test_credential_in_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);source=base/'europe_2021_2026';source.mkdir()
            (source/'inventory.json').write_text(json.dumps({'retrieved_at_utc':'2026-11-01','competitions':[],'error':'secret-value'}),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'Credential'):
                bundle.pack_archive(source,base/'bundles',b'secret-value')


if __name__ == '__main__':
    unittest.main()
