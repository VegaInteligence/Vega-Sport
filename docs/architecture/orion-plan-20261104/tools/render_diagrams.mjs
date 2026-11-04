// Review artifacts only. This script has no database or deployment capability.
import { instance } from '/tmp/statarena-plan-tools-20261104/node_modules/@viz-js/viz/dist/viz.js';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'diagrams');
const viz = await instance();
const rendered = [];
for (const file of (await readdir(directory)).filter(x => x.endsWith('.dot')).sort()) {
  const input = await readFile(resolve(directory, file), 'utf8');
  const result = viz.render(input, { format: 'svg', engine: 'dot' });
  if (result.status !== 'success') throw new Error(JSON.stringify({ file, result }));
  await writeFile(resolve(directory, file.replace(/\.dot$/, '.svg')), result.output);
  rendered.push({ file, status: result.status, warnings: result.errors });
}
await writeFile(resolve(root, 'evidence/diagram-rendering.json'), JSON.stringify({ atUtc: new Date().toISOString(), command: 'node docs/architecture/orion-plan-20261104/tools/render_diagrams.mjs', renderer: '@viz-js/viz@3.31.0', graphviz: viz.graphvizVersion, rendered }, null, 2) + '\n');
console.log(JSON.stringify({ rendered: rendered.length, errors: 0 }));
