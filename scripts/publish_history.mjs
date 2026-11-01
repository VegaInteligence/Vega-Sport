/** One-time resumable historical collection with bounded GitHub checkpoints. */
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {historyYears} from './history_scope.mjs';

const root=process.env.PITCH_PROJECT_ROOT?path.resolve(process.env.PITCH_PROJECT_ROOT):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundledPython=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python',process.platform==='win32'?'python.exe':'bin/python3');
const python=process.env.PITCH_PYTHON||(existsSync(bundledPython)?bundledPython:(process.platform==='win32'?'python':'python3'));
const options=process.argv.slice(2),years=historyYears(options);
const report=options.find(arg=>!arg.startsWith('--'));
const skipCurrent=options.includes('--skip-current');
const basePaths=['dashboard/data/football-manifest.json','dashboard/data/multiseason_issues.json','dashboard/data/seasons','data/pitchapi_bundles/europe_2021_2026'];
const env={...process.env,GIT_TERMINAL_PROMPT:'0'};
function run(command,args,{capture=false,allow=[0]}={}){
  const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',stdio:capture?'pipe':'inherit'});
  if(result.error)throw result.error;
  if(!allow.includes(result.status))throw new Error(`${command} failed (${result.status})${capture?`: ${(result.stderr||'').trim()}`:''}`);
  return result;
}
function git(args,options){return run('git',args,options)}
function checkpoint({includeCurrent=false}={}){
  console.log(`Checkpoint started: ${new Date().toISOString()}`);
  if(includeCurrent){
    let complete=false;
    for(let attempt=1;attempt<=5;attempt++){
      const result=run(process.execPath,['scripts/collect_europe.mjs'],{allow:[0,1]});
      if(result.status===0){complete=true;break;}
      console.error(`Current-season refresh stopped (${result.status}); retrying saved checkpoints (${attempt}/5).`);
    }
    if(!complete)throw new Error('Current-season refresh did not complete; saved checkpoints remain available.');
    run(process.execPath,['scripts/index_europe.mjs']);
  }
  run(process.execPath,['scripts/index_europe.mjs','--history']);
  run(python,['scripts/build_multiseason_dashboard.py']);
  run(python,includeCurrent?['scripts/bundle_europe.py']:['scripts/bundle_europe.py','--history-only']);
  if(report)run(process.execPath,['scripts/report_europe.mjs',report]);
  const branch=git(['branch','--show-current'],{capture:true}).stdout.trim();
  if(branch!=='main')throw new Error('Checkpoint stopped because the current branch is not main.');
  const head=git(['rev-parse','HEAD'],{capture:true}).stdout.trim();
  const remote=git(['ls-remote','--heads','origin','main'],{capture:true}).stdout.trim().split(/\s+/)[0];
  if(head!==remote)throw new Error('Checkpoint stopped because local and remote main differ.');
  if(git(['ls-files','--','.env'],{capture:true}).stdout.trim() || git(['check-ignore','-q','.env'],{allow:[0,1]}).status!==0)throw new Error('Credential file is not safely ignored.');
  const paths=includeCurrent?[...basePaths,'data/pitchapi_bundles/europe_2026_2027']:basePaths;
  const staged=git(['diff','--cached','--name-only','-z'],{capture:true}).stdout.split('\0').filter(Boolean);
  if(staged.length)throw new Error('Checkpoint stopped because the Git index already has staged changes.');
  git(['add','--',...paths]);
  const changed=git(['diff','--cached','--name-only','-z','--',...paths],{capture:true}).stdout.split('\0').filter(Boolean);
  for(const name of changed){
    if(name==='.env'||name.endsWith('.tmp'))throw new Error('Unexpected staged file.');
    const file=path.join(root,name);
    if(existsSync(file)&&statSync(file).size>=100*1024*1024)throw new Error(`GitHub file size limit exceeded: ${name}`);
  }
  if(!changed.length){console.log('Checkpoint unchanged.');return;}
  git(['diff','--cached','--check','--',...paths]);
  git(['commit','-m','[UPD] Refresh historical football data','--only','--',...paths]);
  git(['push','origin','main']);
  console.log(`Checkpoint pushed: ${git(['rev-parse','HEAD'],{capture:true}).stdout.trim()}`);
}
function startCollector(){
  return new Promise(resolve=>{
    const child=spawn(process.execPath,['scripts/collect_europe.mjs','--history',...(years?[`--years=${[...years].join(',')}`]:[])],{cwd:root,env,stdio:'inherit'});
    child.once('error',error=>resolve({code:1,error:error.message}));
    child.once('exit',(code,signal)=>resolve({code:code??1,signal}));
  });
}
async function waitOrFinish(done,ms){
  let timer;const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),ms)});
  const result=await Promise.race([done,timeout]);clearTimeout(timer);return result;
}
async function main(){
  const interval=Math.max(60_000,Number(process.env.PITCH_CHECKPOINT_MINUTES||30)*60_000);
  const retryDelay=Math.max(0,Number(process.env.PITCH_RETRY_DELAY_SECONDS||30)*1000);
  for(let attempt=1;attempt<=5;attempt++){
    const done=startCollector();let result;
    while(true){
      result=await waitOrFinish(done,interval);
      if(result)break;
      try{checkpoint()}catch(error){console.error(`Checkpoint deferred: ${error.message}`);}
    }
    if(result.code===0){checkpoint({includeCurrent:!skipCurrent});console.log('Historical collection and final GitHub push complete.');return;}
    if(attempt===5)throw new Error(`Historical collection stopped after ${attempt} attempts; existing checkpoints remain available.`);
    console.error(`Historical collection stopped (${result.code}); retrying saved checkpoints (${attempt}/5).`);
    await new Promise(resolve=>setTimeout(resolve,retryDelay));
  }
}
if(process.argv.includes('--checkpoint-only')){
  try{checkpoint()}catch(error){console.error(error.message);process.exitCode=1;}
}else{
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
