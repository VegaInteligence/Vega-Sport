async (page) => {
  const checks=[],errors=[],externalRequests=[],failedRequests=[];
  const check=(name,passed)=>checks.push({name,passed:!!passed});
  const clean=s=>s.replace(/\s/g,' ');
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:8794/')&&!request.url().startsWith('data:'))externalRequests.push(request.url());});
  page.on('requestfailed',request=>failedRequests.push({url:request.url(),failure:request.failure()}));
  page.on('response',response=>{if(response.status()>=400)failedRequests.push({url:response.url(),status:response.status()});});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:8794/index.html?status=rds-bootstrap');
  check('current header is applied bootstrap',await page.locator('.status').textContent()==='Bootstrap RDS appliqué');
  check('status date uses actual Paris readback time',(await page.locator('header').textContent()).includes('4 novembre 2026 · 20:38 Paris'));
  check('unchanged full model counts remain distinct',await page.evaluate(()=>window.__orionPlan.tableCount===103&&window.__orionPlan.columnCount===1791));
  await page.getByRole('tab',{name:'Plan d’exécution',exact:true}).click();
  const plan=clean(await page.locator('#plan article').textContent());
  const footer=clean(await page.locator('.footer').textContent());
  check('plan names applied schema/bootstrap',plan.includes('schéma et bootstrap RDS appliqués'));
  check('active quantities and seeds match readback',plan.includes('94 tables, 1 709 colonnes, 431 FK et 10 graines'));
  check('readback workflow is scoped and counted',plan.includes('11/11 contrôles avec 14 SELECT en lecture seule'));
  check('sealed 012 and 013 are explicit',plan.includes('012/013 ont été appliquées sur RDS puis relues et sont désormais scellées'));
  check('no real business data imported',plan.includes('Aucune donnée métier réelle n’est importée dans ces nouveaux schémas'));
  check('backend data full acceptance cutover purge remain open',plan.includes('Les lecteurs backend, la reprise des données, l’acceptation complète, la bascule et la purge restent ouverts'));
  check('user pilot approval remains acquired',plan.includes('plan Pro a été explicitement approuvé')&&plan.includes('aucune nouvelle confirmation globale demandée'));
  check('applied receipt linked',await page.locator('#plan a[href="../../verification/orion-pro-pilot-20261104/rds-runs/20261104T193736115395Z-reviewed-schema-bootstrap/result.json"]').count()===1);
  check('independent readback linked',await page.locator('#plan a[href="../../verification/orion-pro-pilot-20261104/rds-readbacks/20261104T193830558195Z-rds-schema-bootstrap/result.json"]').count()===1);
  check('obsolete current no-RDS claims absent',!plan.includes('sans réorganisation du nouveau schéma sur RDS')&&!plan.includes('aucune application du nouveau schéma sur RDS n’est revendiquée')&&!footer.includes('non appliqué sur RDS'));
  check('footer distinguishes bootstrap from open acceptance',footer.includes('94 tables, 1 709 colonnes, 431 FK, 10 graines')&&footer.includes('012/013 scellées')&&footer.includes('Aucune donnée métier réelle importée')&&footer.includes('acceptation complète, bascule et purge restent ouverts'));
  const sourceHashes=await page.evaluate(async()=>{
    const result={};
    for(const name of ['index.html','PLAN.md','PRO_REVIEW_RESPONSE.md','PRO_VERSIONING_DESIGN.md','target-schema.proposed.json']){
      const response=await fetch(name,{cache:'no-store'});const body=await response.arrayBuffer();
      result[name]=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(n=>n.toString(16).padStart(2,'0')).join('');
    }
    return result;
  });
  check('served model remains exact canonical SHA',sourceHashes['target-schema.proposed.json']==='18da43f940870b7a3a3cb49323c847dd5e5174e5eea1f8ff0c8a159cf373cb08');
  check('desktop no global overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'rds-status-desktop.png'});
  await page.getByRole('tab',{name:'Architecture',exact:true}).click();
  check('restored Vercel production remains dated separately',await page.getByRole('heading',{name:'Production rétablie · 4 novembre, 18:41 Paris',exact:true}).isVisible());
  await page.getByRole('tab',{name:'Plan d’exécution',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  check('mobile current status is visible',await page.locator('.status').isVisible());
  check('mobile no global overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:'rds-status-mobile.png'});
  await page.emulateMedia({colorScheme:'dark'});
  check('dark status remains visible',await page.locator('.status').isVisible());
  await page.screenshot({path:'rds-status-mobile-dark.png'});
  await page.emulateMedia({colorScheme:'light'});
  check('no JavaScript errors',errors.length===0);
  check('no failed HTTP requests',failedRequests.length===0);
  check('no external requests',externalRequests.length===0);
  return {passed:checks.every(c=>c.passed),checks,errors,failedRequests,externalRequests,sourceHashes,artifacts:['rds-status-desktop.png','rds-status-mobile.png','rds-status-mobile-dark.png'],scope:'Focused current documentary status only; no rerun of the earlier 1208 unchanged-model checks, no SQL or external service operation.'};
}
