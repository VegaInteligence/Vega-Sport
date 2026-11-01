// E2E against the production Next App Router server, native Bun API and real data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('Next.js application proxies canonical seasons and archives through Bun',{timeout:120000},()=>{
 const result=spawnSync(process.env.BUN_BINARY||path.join(os.homedir(),'.bun/bin/bun'),['scripts/verify_application.mjs'],{cwd:path.join(root,'dashboard'),encoding:'utf8',timeout:115000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
test('competitions renders real compact and canonical manifests with source season selectors',{timeout:30000},()=>{
 const result=spawnSync(process.env.BUN_BINARY||path.join(os.homedir(),'.bun/bin/bun'),['scripts/verify_competitions_render.jsx'],{cwd:path.join(root,'dashboard'),encoding:'utf8',timeout:25000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
test('competition schedules retain their API envelope identity for filtering and links',{timeout:30000},()=>{
 const result=spawnSync(process.execPath,['scripts/verify_competition_fixtures.mjs'],{cwd:path.join(root,'dashboard'),encoding:'utf8',timeout:25000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
