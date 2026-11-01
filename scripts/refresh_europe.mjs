import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundledPython=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python',process.platform==='win32'?'python.exe':'bin/python3');
const python=process.env.PITCH_PYTHON||(existsSync(bundledPython)?bundledPython:(process.platform==='win32'?'python':'python3'));
const args=process.argv.slice(2);
const flags=args.filter(arg=>arg.startsWith('--'));
if(flags.some(flag=>!['--refresh-details','--retry-unavailable'].includes(flag))) {
  console.error('Supported options: --refresh-details, --retry-unavailable.');process.exit(1);
}
const report=args.find(arg=>!arg.startsWith('--'));
const steps=[
  [process.execPath,['scripts/collect_europe.mjs',...flags]],
  [process.execPath,['scripts/collect_europe.mjs','--history',...flags]],
  [process.execPath,['scripts/index_europe.mjs']],
  [process.execPath,['scripts/index_europe.mjs','--history']],
  [python,['scripts/build_multiseason_dashboard.py']],
  [python,['scripts/collect_open_matchday.py']],
  [python,['scripts/build_open_matchday_dashboard.py']],
  [python,['scripts/audit_open_matchday.py']],
  [python,['scripts/bundle_europe.py']],
  [python,['scripts/build_json_database.py']],
  ...(report?[[process.execPath,['scripts/report_europe.mjs',report]]]:[]),
];
for(const [command,args] of steps){
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit',env:process.env});
  if(result.error){console.error(`Unable to start ${command}: ${result.error.message}`);process.exit(1)}
  if(result.status!==0)process.exit(result.status||1);
}
