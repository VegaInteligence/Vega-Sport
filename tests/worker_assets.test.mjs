import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import os from 'node:os';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('static worker serves compressed season bytes without converting them to text',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'orion-worker-'));
  try{
    await writeFile(path.join(dir,'package.json'),'{"type":"module"}');
    await copyFile(path.join(root,'worker/pitchapi.js'),path.join(dir,'pitchapi.js'));
    const bytes=gzipSync(Buffer.from('{"season":"2025/2026"}'));
    const assets={'/data/example.json.gz':{type:'application/gzip',encoding:'base64',body:bytes.toString('base64')}};
    const source=(await readFile(path.join(root,'worker/index.js'),'utf8')).replace('/* ORION_PUBLIC_ASSETS */ {}',JSON.stringify(assets));
    await writeFile(path.join(dir,'index.js'),source);
    const worker=(await import(pathToFileURL(path.join(dir,'index.js')).href)).default;
    const response=await worker.fetch(new Request('https://orion.example/data/example.json.gz'),{});
    assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    const head=await worker.fetch(new Request('https://orion.example/data/example.json.gz',{method:'HEAD'}),{});
    assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  }finally{
    const resolved=await realpath(dir),temp=await realpath(os.tmpdir()),relative=path.relative(temp,resolved);
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(resolved).startsWith('orion-worker-'))throw new Error('Unexpected test directory');
    await rm(resolved,{recursive:true,force:true});
  }
});
