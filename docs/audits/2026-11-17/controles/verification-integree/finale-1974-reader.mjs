import path from 'node:path';import {pathToFileURL} from 'node:url';
const [w,dsn,target,etag]=process.argv.slice(2);
const {createReader}=await import(pathToFileURL(path.join(w,'backend/api/src/db.mjs')));
const {createHandler}=await import(pathToFileURL(path.join(w,'backend/api/src/handler.mjs')));
const r=createReader(dsn,{role:'vega_read'});
try {
 const h=createHandler({read:r.read,mediaBase:"https://local.example/"}),u='https://local'+target;
 const res=await h(new Request(u)),b=await res.json(),t=res.headers.get('etag');
 const again=await h(new Request(u,{headers:{'If-None-Match':etag||t||''}}));
 console.log(JSON.stringify({status:res.status,etag:t,conditional:again.status,body:b}));
} finally {await r.end();}
