import {spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function reactFixtures(){
 const dir=path.join(root,'dashboard/node_modules/.cache/orion-react-tests');await mkdir(dir,{recursive:true});
 const output=path.join(dir,`components-${process.pid}.mjs`);
 const built=spawnSync(process.env.BUN_BINARY||path.join(os.homedir(),'.bun/bin/bun'),['build','tests/react-fixtures.jsx','--target=node','--external','react','--external','react-dom/server','--outfile',output],{cwd:root,encoding:'utf8'});
 if(built.status!==0)throw new Error(built.stderr);return import(pathToFileURL(output).href);
}
