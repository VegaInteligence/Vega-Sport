async (page) => {
 const errors=[],requests=[],checks=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:8794/')&&!r.url().startsWith('data:'))requests.push(r.url());});
 const check=(name,passed)=>checks.push({name,passed:!!passed});
 await page.setViewportSize({width:1440,height:1000});
 await page.goto('http://127.0.0.1:8794/index.html?status=restored');
 await page.getByRole('tab',{name:'Architecture',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.architecture')].every(img=>img.complete&&img.naturalWidth>0));
 check('restored production heading visible',await page.getByRole('heading',{name:'Production rétablie · 4 novembre, 18:41 Paris',exact:true}).isVisible());
 const svg=await page.evaluate(async()=>await (await fetch('diagrams/architecture-actuelle.svg')).text());
 check('current architecture labels real restored build, bridge and Neon',svg.includes('f65036cdb9')&&svg.includes('Pont legacy temporaire')&&svg.includes('Neon existant'));
 check('AWS preview remains partial',svg.includes('Preview CloudFront API AWS')&&svg.includes('Couverture encore partielle'));
 check('old503 not presented as current architecture',!svg.includes('API 503')&&!svg.includes('503 sans corps'));
 await page.screenshot({path:'architecture-status-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 check('mobile no global overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:'architecture-status-mobile.png',fullPage:true});
 check('no JavaScript errors',errors.length===0);
 check('no external requests',requests.length===0);
 return {passed:checks.every(c=>c.passed),checks,errors,requests,artifacts:['architecture-status-desktop.png','architecture-status-mobile.png'],scope:'Focused changed architecture only; no rerun of the unchanged model1208checks and no external service operations.'};
}
