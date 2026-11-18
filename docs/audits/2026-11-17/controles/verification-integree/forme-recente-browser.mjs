import {createRequire} from 'node:module';
import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
const [root,id,season]=process.argv.slice(2);
const {chromium}=createRequire(import.meta.url)('/Users/lemonnierhugo/.npm/_npx/31e32ef8478fbf80/node_modules/playwright-core');
const browser=await chromium.launch({executablePath:'/Users/lemonnierhugo/Library/Caches/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-mac-arm64/chrome-headless-shell'});
const page=await browser.newPage({locale:'fr-FR',viewport:{width:1365,height:900}});
try{
 const url=new URL('https://vegasport.vercel.app/joueurs/');
 url.search=new URLSearchParams({id,season}).toString();
 await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:26000});
 const target=page.getByRole('heading',{name:/Forme récente/i});
 await target.waitFor({state:'attached',timeout:18000});
 const ctx=target.locator('..').locator('..');
 await ctx.scrollIntoViewIfNeeded();
 await ctx.screenshot({path:path.join(root,id+'-'+season.slice(0,4)+'.png')});
 const title=await page.title(), heading=await ctx.innerText();
 await writeFile(path.join(root,id+'-'+season.slice(0,4)+'.json'),JSON.stringify({url:page.url(),observed:new Date().toISOString(),title,heading,setup:'Chromium desktop, public site, default player tab, direct query and card read.'},null,2));
 console.log(id,season,heading.split('\n').slice(0,5));
} catch(err){const txt=await page.locator('body').innerText(); await writeFile(path.join(root,id+'-'+season.slice(0,4)+'-observed.txt'),txt); console.log(txt.slice(0,350), txt.includes('Forme récente'));throw err;} finally {await browser.close();}
