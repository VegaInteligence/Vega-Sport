import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundled=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python',process.platform==='win32'?'python.exe':'bin/python3');
const python=process.env.PITCH_PYTHON||(existsSync(bundled)?bundled:(process.platform==='win32'?'python':'python3'));
function command(cwd,cmd,args,env=process.env){const r=spawnSync(cmd,args,{cwd,env,encoding:'utf8'});if(r.status!==0)throw new Error(`${cmd}: ${r.stderr||r.stdout}`);return r.stdout.trim()}

test('historical checkpoints and final push preserve unrelated work',{timeout:60000},async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'orion-publish-'));
  try{
    const work=path.join(dir,'work'),remote=path.join(dir,'remote.git');await mkdir(work);
    command(dir,'git',['init','--bare',remote]);command(work,'git',['init','-b','main']);
    command(work,'git',['config','user.name','Test User']);command(work,'git',['config','user.email','test@example.invalid']);
    await mkdir(path.join(work,'scripts'));await writeFile(path.join(work,'.gitignore'),'.env\n');
    await writeFile(path.join(work,'.env'),'PITCHAPI_API_KEY=private-test-key\n');await writeFile(path.join(work,'user.txt'),'original\n');
    await writeFile(path.join(work,'scripts/index_europe.mjs'),'process.exit(0);\n');
    await writeFile(path.join(work,'scripts/collect_europe.mjs'),"import {existsSync,writeFileSync,appendFileSync} from 'node:fs';appendFileSync('collector-args.log',JSON.stringify(process.argv.slice(2))+'\\n');if(!existsSync('retry-marker')){writeFileSync('retry-marker','1');process.exit(1)}process.exit(0);\n");
    await writeFile(path.join(work,'scripts/build_multiseason_dashboard.py'),"from pathlib import Path\nimport os\np=Path('dashboard/data/seasons/2025-2026');p.mkdir(parents=True,exist_ok=True)\n(p/'sample.gz').write_bytes(os.environ.get('FIXTURE_PAYLOAD','data').encode())\nPath('dashboard/data/football-manifest.json').write_text('{}')\nPath('dashboard/data/multiseason_issues.json').write_text('[]')\n");
    await writeFile(path.join(work,'scripts/bundle_europe.py'),"from pathlib import Path\nfor name in ('europe_2021_2026','europe_2026_2027'):\n p=Path('data/pitchapi_bundles')/name;p.mkdir(parents=True,exist_ok=True)\n (p/'manifest.json').write_text('{}')\n");
    command(work,'git',['add','--all']);command(work,'git',['commit','-m','[ADD] Initial fixture']);
    command(work,'git',['remote','add','origin',remote]);command(work,'git',['push','origin','main']);
    const env={...process.env,PITCH_PROJECT_ROOT:work,PITCH_PYTHON:python,GIT_TERMINAL_PROMPT:'0'};
    await writeFile(path.join(work,'user.txt'),'user work\n');command(work,'git',['add','user.txt']);
    const rejected=spawnSync(process.execPath,[path.join(root,'scripts/publish_history.mjs'),'--checkpoint-only'],{cwd:work,env,encoding:'utf8'});
    assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/staged changes/);
    assert.equal(command(work,'git',['diff','--cached','--name-only']),'user.txt');
    command(work,'git',['restore','--staged','user.txt']);
    const result=spawnSync(process.execPath,[path.join(root,'scripts/publish_history.mjs'),'--checkpoint-only'],{cwd:work,env,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.equal(command(work,'git',['log','-1','--format=%s']),'[UPD] Refresh historical football data');
    assert.equal(command(work,'git',['rev-parse','HEAD']),command(work,'git',['ls-remote','--heads','origin','main']).split(/\s+/)[0]);
    assert.equal(command(work,'git',['ls-files','--','.env']),'');
    assert.equal(await readFile(path.join(work,'user.txt'),'utf8'),'user work\n');
    assert.match(command(work,'git',['status','--short']),/user\.txt/);
    const finalRun=spawnSync(process.execPath,[path.join(root,'scripts/publish_history.mjs'),'--years=2024','--skip-current'],{cwd:work,env:{...env,FIXTURE_PAYLOAD:'final',PITCH_RETRY_DELAY_SECONDS:'0'},encoding:'utf8'});
    assert.equal(finalRun.status,0,finalRun.stderr);assert.match(finalRun.stdout,/final GitHub push complete/);
    assert.match(finalRun.stderr,/retrying saved checkpoints/);
    const calls=(await readFile(path.join(work,'collector-args.log'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length,2);
    assert.ok(calls.every(args=>args.includes('--history')&&args.includes('--years=2024')));
    assert.equal(command(work,'git',['rev-parse','HEAD']),command(work,'git',['ls-remote','--heads','origin','main']).split(/\s+/)[0]);
    assert.equal(await readFile(path.join(work,'dashboard/data/seasons/2025-2026/sample.gz'),'utf8'),'final');
  }finally{
    const resolved=await realpath(dir),temp=await realpath(os.tmpdir()),relative=path.relative(temp,resolved);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(resolved).startsWith('orion-publish-'))throw new Error('Unexpected test directory');
    await rm(resolved,{recursive:true,force:true});
  }
});
