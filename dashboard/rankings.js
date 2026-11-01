import {escapeHtml as esc, formatNumber as fmt, normalizeText} from './model.js';

const label=e=>e.provider==='UEFA'?`${e.period}${e.edition.startsWith(String(new Date().getFullYear()+1))?' · en cours':''}`:e.provider==='SportsAPI'?`${e.edition.slice(0,10)} · instantané SportsAPI`:e.period;
const number=value=>value==null?'—':fmt(value,typeof value==='number'&&!Number.isInteger(value)?3:0);

export class RankingsView {
  constructor(redraw){this.redraw=redraw;this.kind='fifa-men';this.selected=null;this.query='';this.index=null;this.indexPromise=null;this.error=null;this.cache=new Map();this.clubHistories=new Map();this.links=null;}
  async init(){
    if(!this.indexPromise)this.indexPromise=(async()=>{
      const responses=await Promise.all([fetch(new URL('./data/raw/rankings/index.json',import.meta.url)),fetch(new URL('./data/raw/rankings/club-links.json',import.meta.url))]);
      if(responses.some(r=>!r.ok))throw new Error('Les fichiers de classement sont indisponibles.');
      [this.index,this.links]=await Promise.all(responses.map(r=>r.json()));
    })().catch(error=>{this.error=error.message;}).finally(()=>this.redraw());
    return this.indexPromise;
  }
  async edition(ref){
    if(!this.cache.has(ref.path))this.cache.set(ref.path,(async()=>{const r=await fetch(new URL('./data/'+ref.path,import.meta.url));if(!r.ok)throw new Error(`Classement indisponible (HTTP ${r.status})`);return r.json();})());
    return this.cache.get(ref.path);
  }
  render(){
    if(!this.index){void this.init();return `<section class="card"><div class="card-body">${this.error?esc(this.error)+' <button class="button button-secondary" data-ranking-retry>Réessayer</button>':'Chargement des classements…'}</div></section>`;}
    const editions=this.index.editions.filter(e=>e.kind===this.kind);
    const ref=editions.find(e=>e.edition===this.selected)||editions.find(e=>e.officialEdition)||editions[0];
    if(!ref)return '<section class="card"><div class="card-body">Aucune édition collectée.</div></section>';
    this.selected=ref.edition;
    if(!this.loaded||this.loaded.path!==ref.path){
      if(this.pending!==ref.path&&this.failedPath!==ref.path){this.pending=ref.path;this.loadingError=null;void this.edition(ref).then(value=>{this.loaded={path:ref.path,value};}).catch(error=>{this.loadingError=error.message;this.failedPath=ref.path;}).finally(()=>{if(this.pending===ref.path){this.pending=null;this.redraw();}});}
    }
    const ready=this.loaded?.path===ref.path, table=ready?this.loaded.value:null;
    const rows=(table?.rows||[]).filter(r=>normalizeText(r.entityName).includes(normalizeText(this.query))).sort((a,b)=>(a.position??Infinity)-(b.position??Infinity));
    return `<section class="card"><div class="rankings-toolbar"><div class="segmented-control" aria-label="Type de classement"><button data-ranking-kind="fifa-men" aria-pressed="${this.kind==='fifa-men'}">Sélections FIFA</button><button data-ranking-kind="uefa-associations" aria-pressed="${this.kind==='uefa-associations'}">Associations UEFA</button></div><label>Édition<select id="ranking-edition" aria-label="Édition du classement">${editions.map(e=>`<option value="${esc(e.edition)}" ${e.edition===ref.edition?'selected':''}>${esc(label(e))}</option>`).join('')}</select></label><input id="ranking-query" class="ranking-search" placeholder="Rechercher un pays" aria-label="Rechercher un pays dans le classement" value="${esc(this.query)}"></div><div class="card-body ranking-source"><strong>${this.kind==='fifa-men'?'Classement mondial FIFA masculin':'Coefficients UEFA des associations'}</strong><span>${esc(ref.provider)} · ${esc(label(ref))}${ready?` · ${rows.length} pays`:''}</span></div>${!ready?`<div class="card-body">${esc(this.loadingError||'Chargement…')}${this.loadingError?'<button class="button button-secondary" data-ranking-retry>Réessayer</button>':''}</div>`:`<div class="table-scroll"><table class="data-table ranking-table"><thead><tr><th scope="col">Rang</th><th scope="col">Pays</th><th scope="col">${this.kind==='fifa-men'?'Points':'Coefficient sur cinq saisons'}</th><th scope="col">Rang précédent</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${number(r.position)}</strong></td><td>${esc(r.entityName)}</td><td>${number(r.points)}</td><td>${number(r.previousPosition)}</td></tr>`).join('')||'<tr><td colspan="4">Aucun pays trouvé.</td></tr>'}</tbody></table></div>`}</section>`;
  }
  clubPanel(clubId){
    if(!this.index){void this.init();return `<section class="card club-ranking"><div class="card-body">${esc(this.error||'Chargement du classement UEFA…')}${this.error?' <button class="button button-secondary" data-ranking-retry>Réessayer</button>':''}</div></section>`;}
    const link=this.links.links[clubId];
    if(!link)return '<section class="card club-ranking"><div class="card-body"><h3>Classement UEFA</h3><p>Correspondance du club non établie.</p></div></section>';
    if(!this.clubHistories.has(link.entityId)){
      this.clubHistories.set(link.entityId,{loading:true});
      const editions=this.index.editions.filter(e=>e.kind==='uefa-clubs'&&e.provider==='UEFA');
      void Promise.all(editions.map(async e=>({edition:e,row:(await this.edition(e)).rows.find(r=>r.entityId===link.entityId)}))).then(rows=>this.clubHistories.set(link.entityId,{rows})).catch(error=>this.clubHistories.set(link.entityId,{error:error.message})).finally(()=>this.redraw());
    }
    const result=this.clubHistories.get(link.entityId);
    return `<section class="card club-ranking"><div class="card-body ranking-source"><h3>Classement UEFA</h3><span>Coefficient sur cinq saisons · UEFA</span></div>${result.loading||result.error?`<div class="card-body">${esc(result.error||'Chargement…')}${result.error?' <button class="button button-secondary" data-ranking-retry>Réessayer</button>':''}</div>`:`<div class="table-scroll"><table class="data-table ranking-table"><thead><tr><th scope="col">Saison</th><th scope="col">Rang européen</th><th scope="col">Coefficient</th></tr></thead><tbody>${result.rows.map(({edition,row})=>`<tr><td>${esc(label(edition))}</td><td>${row?number(row.position):'Non classé'}</td><td>${row?number(row.points):'—'}</td></tr>`).join('')}</tbody></table></div>`}</section>`;
  }
  handleClick(target){if('rankingRetry' in target.dataset){this.cache.clear();this.clubHistories.clear();this.failedPath=null;this.loadingError=null;this.error=null;if(!this.index)this.indexPromise=null;this.redraw();return true;}if(target.dataset.rankingKind){this.kind=target.dataset.rankingKind;this.selected=null;this.query='';this.redraw();return true;}return false;}
  handleChange(target){if(target.id!=='ranking-edition')return false;this.selected=target.value;this.redraw();return true;}
  handleInput(target){if(target.id!=='ranking-query')return false;const cursor=target.selectionStart;this.query=target.value;this.redraw();const input=document.getElementById('ranking-query');input?.focus({preventScroll:true});input?.setSelectionRange(cursor,cursor);return true;}
}
