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

    def test_complete_requires_every_collected_file_to_be_present(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);source=base/'europe_2021_2026';source.mkdir()
            league='l_000001';identifier='m_000001'
            (source/'inventory.json').write_text(json.dumps({'retrieved_at_utc':'2026-11-01','competitions':[{'id':league,'season':'2025/2026','matches':[{'id':identifier,'status':'finished'}]}]}),encoding='utf-8')
            (source/'collection.json').write_text(json.dumps({'completed':1,'incomplete':0,'other_fixtures':{'completed':0,'incomplete':0},'profiles':{'leagues':0,'teams':0,'players':0,'failed':0}}),encoding='utf-8')
            self.assertFalse(bundle.pack_archive(source,base/'bundles')['complete'])
            file=source/'matches'/league/f'{bundle.archive_name(identifier)}.json';file.parent.mkdir(parents=True)
            file.write_text('{}',encoding='utf-8')
            self.assertTrue(bundle.pack_archive(source,base/'bundles')['complete'])

    def test_profile_identity_check_allows_extras_but_not_a_missing_expected_id(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);source=base/'europe_2021_2026';source.mkdir()
            (source/'inventory.json').write_text(json.dumps({'retrieved_at_utc':'2026-11-01','competitions':[]}),encoding='utf-8')
            collection={'completed':0,'incomplete':0,'other_fixtures':{'completed':0,'incomplete':0},
                        'profiles':{'leagues':0,'teams':0,'players':1,'failed':0},'profiles_collected':True,
                        'profile_ids':{'leagues':[],'teams':[],'players':['p_000001']}}
            metadata=source/'collection.json';metadata.write_text(json.dumps(collection),encoding='utf-8')
            for identifier in ('p_000001','p_000002'):
                file=source/'profiles'/'players'/f'{bundle.archive_name(identifier)}.json';file.parent.mkdir(parents=True,exist_ok=True)
                file.write_text(json.dumps({'status':200,'data':{'id':identifier}}),encoding='utf-8')
            self.assertTrue(bundle.pack_archive(source,base/'bundles')['complete'])
            collection['profile_ids']['players']=['p_000003'];metadata.write_text(json.dumps(collection),encoding='utf-8')
            self.assertFalse(bundle.pack_archive(source,base/'bundles')['complete'])

    def test_scoped_completion_does_not_claim_older_seasons_are_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);source=base/'europe_2021_2026';source.mkdir()
            league='l_000001';current='m_000001';older='m_000002'
            inventory={'retrieved_at_utc':'2026-11-01','competitions':[
                {'id':league,'season':'2024/2025','matches':[{'id':current,'status':'finished'}]},
                {'id':league,'season':'2023/2024','matches':[{'id':older,'status':'finished'}]}]}
            (source/'inventory.json').write_text(json.dumps(inventory),encoding='utf-8')
            (source/'collection.json').write_text(json.dumps({'completed':1,'incomplete':0,'scope_years':['2024'],
                'other_fixtures':{'completed':0,'incomplete':0},'profiles':{'leagues':0,'teams':0,'players':0,'failed':0}}),encoding='utf-8')
            file=source/'matches'/league/f'{bundle.archive_name(current)}.json';file.parent.mkdir(parents=True)
            file.write_text('{}',encoding='utf-8')
            manifest=bundle.pack_archive(source,base/'bundles')
            self.assertTrue(manifest['scope_complete'])
            self.assertFalse(manifest['complete'])


if __name__ == '__main__':
    unittest.main()
