"""Exercise packaging of the compressed multi-season dashboard assets."""
import gzip
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]


class DashboardBuildTests(unittest.TestCase):
    def test_build_includes_manifest_and_compressed_competition_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for folder in ('scripts','dashboard','data/staging/dashboard/seasons/2025-2026','worker','.openai'):
                (root/folder).mkdir(parents=True,exist_ok=True)
            shutil.copy2(ROOT/'scripts/build_dashboard.py',root/'scripts/build_dashboard.py')
            (root/'scripts/build_dashboard_data.py').write_text('print("fixture build")\n',encoding='utf-8')
            for name in ('index.html','styles.css','style.css','app.js','explorer.js','charts.js','model.js','season_data.js','rankings.js','favicon.svg'):
                (root/'dashboard'/name).write_text('fixture',encoding='utf-8')
            league='l_000001'
            relative=f'seasons/2025-2026/{league}--{league.encode().hex()}.json.gz'
            data=gzip.compress(b'{"matches":[]}')
            (root/'data/staging/dashboard'/relative).write_bytes(data)
            (root/'data/staging/dashboard/football-manifest.json').write_text(json.dumps({'seasons':[{'id':'2025/2026','chunks':[{'path':relative}]}]}),encoding='utf-8')
            shutil.copy2(ROOT/'worker/index.js',root/'worker/index.js')
            shutil.copy2(ROOT/'worker/pitchapi.js',root/'worker/pitchapi.js')
            (root/'.openai/hosting.json').write_text('{}',encoding='utf-8')
            subprocess.run([sys.executable,str(root/'scripts/build_dashboard.py')],cwd=root,check=True,capture_output=True,text=True)
            self.assertEqual((root/'dist/data'/relative).read_bytes(),data)
            worker=(root/'dist/server/index.js').read_text(encoding='utf-8')
            self.assertIn('"encoding":"base64"',worker)
            self.assertIn('/data/'+relative,worker)


if __name__ == '__main__':
    unittest.main()
