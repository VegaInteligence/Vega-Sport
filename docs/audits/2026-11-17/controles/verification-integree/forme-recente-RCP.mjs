import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const [w, output] = process.argv.slice(2);
const req = createRequire(path.join(w, 'dashboard/package.json'));
const React = req('react');
const babel = req('next/dist/compiled/babel/core');
const preset = req('next/dist/compiled/babel/preset-react');
const {renderToStaticMarkup} = req('react-dom/server');
const file = 'dashboard/frontend/src/components/PlayerScoutOverview.jsx';
const gradeFile = 'dashboard/frontend/src/services/grades.js';
const model = await import(pathToFileURL(path.join(w, gradeFile)));
const read = (sha, name) => execFileSync('git', ['-C', w, 'show', sha + ':' + name], {encoding:'utf8'});
const records = [];
for (const sha of ['fc0deba100288117b0ea122e7199d1c9db9dcc37','0e6b2ab35301a9df5d94e86f10affcdf7d1997ad']) {
  assert.equal(read(sha, gradeFile), read('34ca3b5b382d7a6a06da9d051170096ba1d700e8', gradeFile));
  const src = read(sha, file);
  const start = src.indexOf('function RecentForm(');
  const end = src.indexOf('\n}', start)+2;
  assert.ok(start>0 && end>start);
  const code = babel.transformSync(src.slice(start,end),{ presets:[[preset,{runtime:'classic'}]],babelrc:false,configFile:false }).code;
  const Card = ({title,text}) => React.createElement('div',null,title,' ',text);
  const recent = new Function('React','useMemo','seasonGrade','Card','fmt','s','FormBars','formItem','useNarrow', code+'\nreturn RecentForm;')(React,React.useMemo,model.seasonGrade,Card,(n,d)=>n.toFixed(d),{},()=>null,x=>x,()=>false);
  for (const [name,rows] of Object.entries({empty:[],limited:[{date:'2026-11-01',minutes:9,gradeZ:3,grade:84}],measured:[{date:'2026-11-01',minutes:22,gradeZ:2,grade:76}]})) {
    const actual=renderToStaticMarkup(React.createElement(recent,{profile:{rows},matches:[]}));
    const aggregate=model.seasonGrade(rows);
    assert.equal(aggregate.grade===null,name!=='measured');
    assert.equal(/moy.\s*50/.test(actual),sha.startsWith('0e6b') && name!=='measured',actual);
    records.push({sha,name,rows,grade:aggregate.grade,header:actual});
  }
}
writeFileSync(output,JSON.stringify({setup:'Exact RecentForm source and seasonGrade with real React SSR; the receiving card shows its text prop; no production incidence count.',records},null,2)+'\n');
console.log(records.length,'rendered cases');
