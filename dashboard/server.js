const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
http.createServer((req,res)=>{let url;try{url=decodeURIComponent(new URL(req.url,'http://localhost').pathname)}catch{res.writeHead(400).end();return} if(url==='/')url='/dashboard/index.html';const file=path.resolve(root,'.'+url);if(!file.startsWith(root+path.sep)||(!file.startsWith(path.join(root,'dashboard')+path.sep)&&!file.startsWith(path.join(root,'data')+path.sep))){res.writeHead(403).end();return}fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end('Not found');return}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data)})}).listen(8765,'127.0.0.1',()=>console.log('Dashboard: http://127.0.0.1:8765'));
