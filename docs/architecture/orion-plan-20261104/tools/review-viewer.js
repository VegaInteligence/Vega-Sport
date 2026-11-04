async (page) => {
  const expected = __EXPECTED_REVIEW__;
  const errors = [], badResponses = [], externalRequests = [], checks = [], artifacts = [];
  let seenColumns=0, seenForeignKeys=0, seenTables=0, loadedDiagrams=0, fatalError=null;
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => { if (r.status() >= 400) badResponses.push({url:r.url(),status:r.status()}); });
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:8794/') && !r.url().startsWith('data:')) externalRequests.push(r.url()); });
  const check = (name, ok, details = null) => checks.push({name,passed:!!ok,details});
  const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
  const normalize = value => value.replace(/\s+/g,' ').trim();
  const shot = async (path,fullPage=false) => {await page.screenshot({path,fullPage});artifacts.push(path);};
  const select = async name => {
    await page.locator('#domain-select').selectOption('all');
    await page.locator('#table-search').fill(name);
    await page.locator('#table-list button[data-table="'+name+'"]').click();
  };
  try {
    await page.setViewportSize({width:1440,height:1000});
    await page.goto('http://127.0.0.1:8794/index.html?review=pro');
    const source=await page.evaluate(async()=>{
      const text=await (await fetch('target-schema.proposed.json')).text();
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
      return {model:JSON.parse(text),sha256:[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''),domains:await (await fetch('diagrams/index.json')).json()};
    });
    check('HTTP model matches independently recorded SHA-256',source.sha256===expected.modelSha256);
    expected.tables=source.model.schemas.flatMap(s=>s.tables).map(t=>({...t,name:t.qualified_name,columns:Object.entries(t.columns).map(([name,c])=>({name,...c}))}));
    expected.domains=source.domains;
    expected.baseline_dispositions=source.model.planning.baseline_dispositions;
    expected.version_classes=source.model.planning.version_classes;
    await page.getByRole('tab',{name:'Architecture',exact:true}).click();
    const headline=(await page.locator('#counts').textContent()).replace(/\s/g,'');
    check('headline counts from current model',headline.includes(expected.tables.length+'tablesproposées')&&headline.includes(expected.counts.columns+'colonnes')&&headline.includes(expected.counts.foreignKeys+'relationsFK')&&headline.includes(expected.domains.length+'planchesdedomaines'),headline);
    check('embedded model identities',await page.evaluate(e=>window.__orionPlan.tableCount===e.tables.length&&window.__orionPlan.columnCount===e.counts.columns&&window.__orionPlan.source===e.policy&&JSON.stringify([...window.__orionPlan.tableNames].sort())===JSON.stringify(e.tables.map(t=>t.name).sort()),expected));
    await shot('architecture-desktop.png',true);
    await page.getByRole('tab',{name:'Tables et relations',exact:true}).click();
    for (const table of expected.tables) {
      await select(table.name);
      const actual = await page.locator('#table-detail').evaluate(detail=>({
        columns:[...detail.querySelectorAll('#column-list tr')].map(row=>({name:row.dataset.column,type:row.cells[1].textContent.trim(),nullable:row.cells[2].textContent.trim(),description:row.cells[4].textContent.trim()})),
        pk:detail.querySelector('#primary-key').textContent,
        description:detail.querySelector('#table-description').textContent,
        grain:detail.querySelector('#physical-grain').textContent,
        kind:detail.querySelector('#version-class code')?.textContent??null,
        logical:detail.querySelector('#logical-key code')?.textContent??null,
        versionKey:detail.querySelector('#version-key code')?.textContent??null,
        historicalSelection:detail.querySelector('#historical-selection code')?.textContent??null,
        binding:detail.querySelector('#parent-version pre')?.textContent??null,
        fks:[...detail.querySelectorAll('[data-fk]')].map(n=>({name:n.dataset.fk,text:n.textContent,target:n.querySelector('button').dataset.table})),
        unique:[...detail.querySelectorAll('[data-unique]')].map(n=>({name:n.dataset.unique,text:n.textContent})),
        checks:[...detail.querySelectorAll('[data-check]')].map(n=>({name:n.dataset.check,text:n.textContent})),
        indexes:[...detail.querySelectorAll('[data-index]')].map(n=>({name:n.dataset.index,text:n.textContent}))
      }));
      check('all columns '+table.name,actual.columns.length===table.columns.length&&actual.columns.every((a,i)=>a.name===table.columns[i].name&&a.type===table.columns[i].type&&a.nullable===(table.columns[i].nullable?'oui':'non')&&a.description===table.columns[i].description),{expected:table.columns.length,actual:actual.columns.length});
      seenColumns+=actual.columns.length;seenTables++;
      check('physical key and grain '+table.name,actual.pk===table.primary_key.columns.join(', ')&&actual.grain===('Grain physique : '+table.grain)&&actual.description===table.description);
      check('version contract '+table.name,actual.kind===(table.versioning?.kind??null)&&actual.logical===(table.versioning?.logical_key?.join(', ')??null)&&actual.versionKey===(table.versioning?.version_key?.join(', ')??null)&&actual.historicalSelection===(table.versioning?.historical_selection??null)&&same(actual.binding?JSON.parse(actual.binding):null,table.versioning?.parent_version_binding??null));
      check('all FK declarations '+table.name,actual.fks.length===table.foreign_keys.length&&actual.fks.every((a,i)=>{const f=table.foreign_keys[i];return a.name===f.name&&a.target===f.references.table&&normalize(a.text).includes(f.columns.join(', '))&&normalize(a.text).includes('('+f.references.columns.join(', ')+')');}));
      check('all unique constraints '+table.name,same(actual.unique,table.unique_constraints.map(u=>({name:u.name,text:'UNIQUE ('+u.columns.join(', ')+')'+(u.nulls_not_distinct?' NULLS NOT DISTINCT':'')+(u.where_sql?' WHERE '+u.where_sql:'')}))));
      check('all CHECK declarations '+table.name,same(actual.checks,table.checks.map(c=>({name:c.name,text:c.sql}))));
      check('all indexes and predicates '+table.name,same(actual.indexes,table.indexes.map(i=>({name:i.name,text:(i.unique?'UNIQUE ':'')+i.method+' ('+i.keys.map(k=>(k.column??k.expression_sql)+(k.order?' '+k.order:'')).join(', ')+')'+(i.nulls_not_distinct?' NULLS NOT DISTINCT':'')+(i.where_sql?' WHERE '+i.where_sql:'')}))));
      for (const fk of table.foreign_keys) {
        await page.locator('[data-fk="'+fk.name+'"] button').click();
        check('FK navigation '+table.name+'.'+fk.name,(await page.locator('#table-detail h2').textContent())===fk.references.table);
        seenForeignKeys++;
        await select(table.name);
      }
    }
    check('complete rendered dictionary',seenTables===expected.tables.length&&seenColumns===expected.counts.columns&&seenForeignKeys===expected.counts.foreignKeys,{tables:seenTables,columns:seenColumns,foreignKeys:seenForeignKeys});
    await page.locator('#domain-select').selectOption('all');
    await page.locator('#table-search').fill('keeper_id');
    check('column search includes shots',await page.locator('#table-list button[data-table="football.shots"]').count()===1);
    await page.locator('#table-list button[data-table="football.shots"]').click();
    await shot('shots-desktop.png');
    await page.getByRole('tab',{name:'Diagrammes BDD',exact:true}).click();
    const domains=await page.locator('#diagram-domain option').evaluateAll(options=>options.map(o=>o.value));
    check('all current diagram choices',same(domains,['overview',...expected.domains.map(d=>d.id)]));
    for (const domain of domains) {
      await page.locator('#diagram-domain').selectOption(domain);
      await page.waitForFunction(()=>{const img=document.getElementById('er-image');return img.complete&&img.naturalWidth>0;});
      check('diagram loads '+domain,await page.locator('#er-image').evaluate(img=>img.complete&&img.naturalWidth>0));loadedDiagrams++;
    }
    await page.locator('#diagram-domain').selectOption('overview');
    await page.waitForFunction(()=>document.getElementById('er-image').complete);
    await page.locator('#graph-zoom').focus();await page.locator('#graph-zoom').press('End');
    check('diagram zoom responds',(await page.locator('#zoom-value').textContent()).includes('150'));
    await page.getByRole('button',{name:'Ajuster',exact:true}).click();await shot('database-overview-desktop.png');
    await page.getByRole('tab',{name:'Ajustements',exact:true}).click();
    check('all JSONB exceptions visible',await page.locator('#jsonb-list tr').count()===expected.counts.jsonb);
    check('all baseline responsibility dispositions',same(await page.locator('#baseline-dispositions tr').evaluateAll(rows=>rows.map(r=>r.dataset.baseline).sort()),Object.keys(expected.baseline_dispositions).sort()));
    check('selective version counts visible',await page.locator('#version-counts').evaluate((node,v)=>{const text=node.textContent;return text.includes(v.selected_relations+' tables à versions sélectives')&&text.includes(v.parent_version_children+' enfants atomiques')&&text.includes(v.existing_append_only+' observations append-only')&&text.includes(v.stable_identities+' identités stables');},expected.version_classes));
    await page.getByRole('tab',{name:'Existant → cible',exact:true}).click();
    check('all current relations visible',await page.locator('#mapping-list tr').count()===expected.counts.currentRelations);
    await page.locator('#mapping-search').fill('file_documents');
    const filtered=await page.locator('#mapping-list tr').count();
    check('mapping filter works',filtered>0&&filtered<expected.counts.currentRelations);
    await page.getByRole('tab',{name:'Plan d’exécution',exact:true}).click();
    const plan=await page.locator('#plan article').textContent();
    check('direct RDS collection visible',plan.includes('PitchAPI → réponse décodée en mémoire')&&plan.includes('aucun corps brut JSON, CSV ou archive en S3'));
    check('approved bounded pilot and open full acceptance visible',plan.includes('plan Pro a été explicitement approuvé')&&plan.includes('L’acceptation complète reste ouverte')&&(await page.locator('.status').textContent())==='Pilote autorisé');
    check('plan matches current model',normalize(plan).includes(expected.tables.length+' tables, '+expected.counts.columns.toLocaleString('fr-FR').replace(/\s/g,' ')+' colonnes et '+expected.counts.foreignKeys+' clés étrangères'));
    await page.goto('http://127.0.0.1:8794/index.html?deep=pro#table=ingest.source_documents');
    check('deep link resolves',(await page.locator('#table-detail h2').textContent())==='ingest.source_documents');
    check('direct HTTP receipt has no raw body',await page.locator('#column-list tr[data-column="origin_kind"]').count()===1&&await page.locator('#column-list tr[data-column="body"]').count()===0);
    await page.setViewportSize({width:390,height:844});
    check('mobile has no global horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await shot('receipt-mobile.png');
    await page.getByRole('tab',{name:'Architecture',exact:true}).click();await shot('architecture-mobile.png',true);
    check('mobile architecture no global overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.emulateMedia({colorScheme:'dark'});await page.getByRole('tab',{name:'Tables et relations',exact:true}).click();await shot('receipt-mobile-dark.png');
    check('mobile dark no global overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width:1440,height:1000});
  } catch (error) {
    fatalError=String(error);check('workflow completed without fatal error',false,fatalError);
    try {await shot('viewer-failure.png');} catch (_) {}
  }
  check('no JavaScript errors',errors.length===0,errors);
  check('no failed local HTTP resources',badResponses.length===0,badResponses);
  check('no external/service requests',externalRequests.length===0,externalRequests);
  return {passed:checks.every(c=>c.passed),modelSha256:expected.modelSha256,counts:{tables:seenTables,columns:seenColumns,foreignKeys:seenForeignKeys,loadedDiagrams,checks:checks.length},expected:expected.counts,checks,errors,badResponses,externalRequests,fatalError,artifacts,scope:'Review-document E2E only. No SQL execution, source reconciliation, application migration or remote deployment.'};
}
