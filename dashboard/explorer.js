/** Catalogue, complete provider payloads and progressive PitchAPI exploration. */
import {escapeHtml as esc, formatNumber as fmt, normalizeText, seasonLabel, isNumber, csvString} from './model.js';
import {shotMap, xgTimeline} from './charts.js';

export const MATCH_SECTIONS = [
  ['lineups','Compositions'], ['stats','Statistiques équipes'], ['players','Statistiques joueurs'],
  ['shots','Tirs & xG'], ['events','Événements'], ['momentum','Momentum'],
  ['players/halves','Par mi-temps'], ['advanced','Analyse avancée'],
  ['advanced/players','Joueurs · avancé'], ['advanced/network','Réseaux de passes'],
  ['heatmaps','Cartes d’activité'], ['h2h','Confrontations'], ['match','Fiche du match']
];
const countryNames = {FRA:'France',ENG:'Angleterre',ESP:'Espagne',GER:'Allemagne',ITA:'Italie',POR:'Portugal',BEL:'Belgique',NED:'Pays-Bas',SCO:'Écosse',DEN:'Danemark',SWE:'Suède',NOR:'Norvège',FIN:'Finlande',CRO:'Croatie',ROU:'Roumanie',TUR:'Turquie',GRE:'Grèce',SUI:'Suisse',AUT:'Autriche',POL:'Pologne',CZE:'Tchéquie',LVA:'Lettonie',USA:'États-Unis',BRA:'Brésil',ARG:'Argentine',JPN:'Japon',KOR:'Corée du Sud',SAU:'Arabie saoudite',AUS:'Australie',MEX:'Mexique',UKR:'Ukraine',SRB:'Serbie',SVK:'Slovaquie',SVN:'Slovénie',HUN:'Hongrie',IRL:'Irlande',IRE:'Irlande',WAL:'Pays de Galles',KAZ:'Kazakhstan',UEFA:'Europe',ISL:'Islande',LTU:'Lituanie',EST:'Estonie',BUL:'Bulgarie',CYP:'Chypre',ISR:'Israël',EU:'Europe',EUR:'Europe',INT:'International',WORLD:'International'};
const countries = code => countryNames[code] || code || 'International';
const initials = name => String(name || '?').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toLocaleUpperCase('fr');
const date = value => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',timeZone:'Europe/Paris'}).format(new Date(value)) : '—';
const arrow = '<span aria-hidden="true">↗</span>';
const pending = '<div class="chart-empty" role="status"><span class="loading-dot"></span><strong>Chargement des données…</strong></div>';

export function safeImageUrl(value) {
  try { const url=new URL(value); return url.protocol==='https:' && url.hostname==='cdn.pitchapi.dev' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function media(name,url,className='crest') {
  const src=safeImageUrl(url);
  return `<span class="${esc(className)}" aria-hidden="true">${src?`<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-provider-image>`:''}<span class="image-fallback" ${src?'hidden':''}>${esc(initials(name))}</span></span>`;
}
const title = value => String(value).replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const scalar = value => value==null ? '<span class="missing-value">—</span>' : typeof value==='boolean' ? (value?'Oui':'Non') : typeof value==='number' ? fmt(value,4) : esc(value);

/** Readable fallback preserves every field; full untruncated data is downloadable. */
export function structuredData(value,depth=0) {
  if(value==null || typeof value!=='object') return `<span>${scalar(value)}</span>`;
  if(depth>6) return `<pre class="json-view">${esc(JSON.stringify(value,null,2))}</pre>`;
  if(Array.isArray(value)) {
    if(!value.length) return '<p class="data-empty">Aucun élément renseigné.</p>';
    return `<div class="data-sequence">${value.slice(0,200).map((item,index)=>typeof item==='object'&&item!==null?`<details class="data-record" ${value.length<5?'open':''}><summary>${esc(item.player?.name||item.team?.name||item.name||item.title||item.period||`Élément ${index+1}`)}</summary>${structuredData(item,depth+1)}</details>`:`<div>${scalar(item)}</div>`).join('')}${value.length>200?`<p class="table-hint">${value.length-200} autres éléments sont disponibles dans le téléchargement JSON complet.</p>`:''}</div>`;
  }
  const simple=Object.entries(value).filter(([,v])=>v===null||typeof v!=='object');
  const nested=Object.entries(value).filter(([,v])=>v!==null&&typeof v==='object');
  return `${simple.length?`<dl class="data-fields">${simple.map(([key,v])=>`<div><dt>${esc(title(key))}</dt><dd>${key==='image_url'&&safeImageUrl(v)?media('Image',v,'crest profile-image'):scalar(v)}</dd></div>`).join('')}</dl>`:''}${nested.map(([key,v])=>`<details class="data-record" ${depth<1?'open':''}><summary>${esc(title(key))}${Array.isArray(v)?` <span class="muted">${v.length}</span>`:''}</summary>${structuredData(v,depth+1)}</details>`).join('')}`;
}

export function rawPlayerMetrics(row) {
  const result=new Map();
  for(const group of row?.stats||[]) for(const [label,item] of Object.entries(group.stats||{})) {
    const key=item.key||label;
    if(!result.has(key)) result.set(key,{key,label,...item.stat});
  }
  return result;
}
function rowStat(row,key) { return rawPlayerMetrics(row).get(key)?.value ?? null; }
function statValue(stat) {
  if(stat?.value==null) return '—';
  return stat.total!=null ? `${fmt(stat.value,2)} / ${fmt(stat.total,2)}` : typeof stat.value==='number'?fmt(stat.value,3):esc(stat.value);
}
function message(titleText,copy) { return `<div class="chart-empty"><strong>${esc(titleText)}</strong><p>${esc(copy)}</p></div>`; }

export class PitchExplorer {
  constructor({data,redraw,navigate,openLocalMatch}) {
    Object.assign(this,{data,redraw,navigate,openLocalMatch});
    this.configured=false;this.statusKnown=false;this.catalog=data.competitions;
    this.competitionQuery='';this.country='all';this.competitionId=null;this.season=null;this.fixtureStatus='all';
    this.clubQuery='';this.clubId=null;this.remoteMatch=null;this.page=1;
    this.sections=new Map();this.payloads=new Map();this.shards=new Map();this.fixtures=new Map();this.profiles=new Map();
    this.playerSelection=new Map();this.heatSelection=new Map();this.periodSelection=new Map();this.fixtureIndex=new Map();
    this.supplementalMode=false;this.supplementalData=null;this.supplementalError=null;this.supplementalLoading=false;this.supplementalCompetition=null;this.supplementalTab='results';
    this.playerIdsByTeam=new Map();
    for(const row of data.appearances){if(!this.playerIdsByTeam.has(row.teamId))this.playerIdsByTeam.set(row.teamId,new Set());this.playerIdsByTeam.get(row.teamId).add(row.playerId);}
    this.day=data.meta.endDate;this.browseMode='catalog';this.refreshing=false;
    this.statusPromise=Promise.resolve();
  }
  async init() {
    this.statusPromise=this.checkStatus();
    await this.statusPromise;
    if(this.configured) {
      try {const response=await this.request('leagues'); if(Array.isArray(response.data?.leagues)) this.catalog=response.data.leagues.map(l=>({...l,country:this.data.competitions.find(x=>x.id===l.id)?.country||l.country_code,imageUrl:l.image_url,sampleMatches:this.data.competitions.find(x=>x.id===l.id)?.sampleMatches||0}));} catch { /* Keep the traceable local catalogue. */ }
    }
    this.redraw();
  }
  async checkStatus() {
    try {const response=await fetch('/api/status',{cache:'no-store'});const body=await response.json();this.configured=response.ok&&body.configured===true;} catch {this.configured=false;}
    this.statusKnown=true;
    const status=document.querySelector('#connection-status');
    if(status) status.innerHTML=`<span class="status-dot"></span><span>${this.configured?'PitchAPI configuré':'Instantané du projet'}</span>`;
  }
  async request(path) {
    const response=await fetch(`/api/pitchapi/${path}`,{headers:{Accept:'application/json'}});
    let body;try{body=await response.json();}catch{throw new Error('La connexion aux données est momentanément indisponible.');}
    if(!response.ok||body.error) {const error=new Error(body.error?.message||'Les données ne sont pas disponibles.');error.code=body.error?.code;error.status=response.status;throw error;}
    return body;
  }
  renderConnection() {
    return `<div class="api-status ${this.configured?'is-connected':''}"><span class="api-status-dot"></span><div><strong>${this.configured?'Connexion PitchAPI configurée':'Connexion PitchAPI à configurer'}</strong><p>${this.configured?'Le catalogue, les saisons et les détails des matchs se chargent à la demande.':'Les données déjà collectées sont accessibles. La clé du projet doit être ajoutée côté serveur pour charger les autres saisons et les analyses avancées.'}</p></div><a href="https://pitchapi.dev/" target="_blank" rel="noopener noreferrer">PitchAPI ${arrow}</a></div>`;
  }
  localFixtures(leagueId,season) {
    if(Array.isArray(this.data.fixtures)) return this.data.fixtures.filter(m=>(!leagueId||m.league?.id===leagueId)&&(!season||m.season===season));
    return this.data.matches.filter(m=>(!leagueId||m.leagueId===leagueId)&&(!season||m.season===season)).map(m=>({id:m.id,date:m.date,time_utc:m.timeUtc,status:m.status,home_team:{...m.home,image_url:m.home.imageUrl},away_team:{...m.away,image_url:m.away.imageUrl},score_home:m.home.score,score_away:m.away.score,league:{id:m.leagueId,name:m.league},season:m.season}));
  }
  async loadFixtures() {
    const {browseMode,day,competitionId,season}=this;
    const league=this.catalog.find(x=>x.id===competitionId);
    const key=browseMode==='day'?`date:${day}`:`${competitionId}:${season}`;
    if(this.fixtures.has(key)) return;
    this.fixtures.set(key,{loading:true});
    await this.statusPromise;
    let result;
    try {
      if(!this.configured) throw new Error('La connexion API n’est pas encore activée.');
      const payload=await this.request(browseMode==='day'?`date/${day}?status=all`:`leagues/${league.id}/matches?season=${encodeURIComponent(season)}&status=all`);
      result={matches:payload.data?.matches||[],source:'api'};
    } catch(error) {
      const matches=browseMode==='day'?this.localFixtures().filter(m=>m.date===day):this.localFixtures(competitionId,season);
      result={matches,source:'snapshot',error:error.message};
    }
    for(const match of result.matches) this.fixtureIndex.set(match.id,match);
    this.fixtures.set(key,result);this.redraw();
  }
  renderCompetitions() {
    if(this.supplementalMode) return this.renderSupplemental();
    if(this.remoteMatch) return this.renderRemoteMatch();
    if(this.competitionId || this.browseMode==='day') return this.renderSeason();
    const query=normalizeText(this.competitionQuery);
    const leagues=this.catalog.filter(l=>(this.country==='all'||l.country===this.country)&&normalizeText(`${l.name} ${countries(l.country)} ${l.country}`).includes(query)).sort((a,b)=>(b.sampleMatches>0)-(a.sampleMatches>0)||a.name.localeCompare(b.name,'fr'));
    const visible=leagues.slice(0,this.page*24);
    return `${this.renderConnection()}<div class="section-toolbar"><div><span class="section-label">LE CATALOGUE COMPLET</span><h2>${this.catalog.length} compétitions. Toutes les saisons référencées.</h2><p class="muted">${this.catalog.reduce((n,l)=>n+(l.seasons?.length||0),0)} couples compétition–saison au catalogue · ${this.data.meta.sampleCompetitionCount} compétitions dans l’instantané actuel.</p></div><div><button class="button button-secondary" data-open-supplemental>Autres ligues et coupes ${arrow}</button> <button class="button button-secondary" data-browse-day>Calendrier par date ${arrow}</button></div></div>
      <div class="clubs-toolbar"><div class="search-field">⌕ <input id="competition-query" type="search" placeholder="Compétition ou pays…" value="${esc(this.competitionQuery)}" aria-label="Rechercher une compétition"></div><select id="competition-country" aria-label="Filtrer par pays"><option value="all">Tous les pays</option>${[...new Set(this.catalog.map(l=>l.country))].sort((a,b)=>countries(a).localeCompare(countries(b),'fr')).map(c=>`<option value="${esc(c)}" ${this.country===c?'selected':''}>${esc(countries(c))}</option>`).join('')}</select><span class="table-hint">${leagues.length} résultats</span></div>
      <div class="competition-grid">${visible.map(l=>`<button class="competition-card" data-open-competition="${esc(l.id)}"><div class="competition-card-header">${media(l.name,l.imageUrl,'crest competition-logo')}<span class="country-code">${esc(countries(l.country))}</span>${arrow}</div><h3>${esc(l.name)}</h3><div class="competition-card-meta"><span>${l.seasons?.length||0} saisons</span><span>${esc(seasonLabel([...(l.seasons||[])].sort().at(-1)||'—'))}</span></div><div class="competition-card-foot"><span class="badge ${l.sampleMatches?'badge-success':'badge-neutral'}">${l.sampleMatches?`${l.sampleMatches} match chargé`:'Catalogue PitchAPI'}</span><span>Explorer →</span></div></button>`).join('')||message('Aucune compétition','Essayez un autre nom ou un autre pays.')}</div>${visible.length<leagues.length?`<div class="load-more"><button class="button button-secondary" data-more-competitions>Afficher les ${Math.min(24,leagues.length-visible.length)} suivantes</button></div>`:''}`;
  }
  async loadSupplemental() {
    this.supplementalLoading=true;this.supplementalError=null;
    try {
      const response=await fetch(new URL('./data/open_matchday.json',import.meta.url));
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const value=await response.json();
      if(!Array.isArray(value.competitions)||!value.meta)throw new Error('Format de données invalide');
      this.supplementalData=value;
    }catch(error){this.supplementalError=error.message;}
    this.supplementalLoading=false;this.redraw();
  }
  renderSupplemental() {
    const back='<button class="inline-link back-link" data-back-supplemental>← Retour aux compétitions</button>';
    if(!this.supplementalData){
      if(!this.supplementalLoading&&!this.supplementalError)void this.loadSupplemental();
      return back+(this.supplementalError?`${message('Données complémentaires indisponibles',this.supplementalError)}<button class="button button-secondary" data-retry-supplemental>Réessayer</button>`:pending);
    }
    const data=this.supplementalData, selected=data.competitions.find(c=>c.folder===this.supplementalCompetition);
    const source=`<p class="table-hint">Saison 2026/2027 (ou saison civile 2026) · source : <a href="https://github.com/oladeeayo/open-matchday" target="_blank" rel="noopener noreferrer">open-matchday</a> · relevé ${esc(data.meta.source_generated_at_utc?.slice(0,10)||'—')} · usage informatif non commercial avec attribution. Certains matchs recoupent PitchAPI.</p>`;
    if(!selected){
      return `${back}<div class="section-toolbar"><div><h2>Autres ligues et coupes</h2><p class="muted">${data.competitions.length} compétitions · résultats et calendriers de la source complémentaire.</p>${source}</div></div><div class="competition-grid">${data.competitions.map(c=>`<button class="competition-card" data-supplemental-competition="${esc(c.folder)}"><div class="competition-card-header"><span class="country-code">${esc(countries(c.country_code))}</span>${arrow}</div><h3>${esc(c.name||c.folder)}</h3><div class="competition-card-meta"><span>${c.results.length} résultats</span><span>${c.fixtures.length} rencontres au calendrier</span></div></button>`).join('')}</div>`;
    }
    const kind=['results','fixtures','goals'].includes(this.supplementalTab)?this.supplementalTab:'results';
    const rows=selected[kind]||[], value=v=>v===null||v===undefined||v===''?'<span class="missing-value">—</span>':esc(v);
    const sorted=[...rows].sort((a,b)=>kind==='fixtures'?(a.date||'').localeCompare(b.date||''):(b.date||'').localeCompare(a.date||''));
    const headers=kind==='results'?'<th>Date</th><th>Match</th><th>Score</th><th>Tirs</th><th>Corners</th><th>Source</th>':kind==='goals'?'<th>Date</th><th>Match</th><th>Minute</th><th>Score</th><th>Buteur</th>':'<th>Date</th><th>Match</th><th>Heure source</th>';
    const body=sorted.map(row=>{
      const match=`${value(row.home)} – ${value(row.away)}`;
      if(kind==='results')return `<tr><td>${value(row.date)}</td><td>${match}</td><td>${value(row.ft_home)} – ${value(row.ft_away)}</td><td>${value(row.home_shots)} – ${value(row.away_shots)}</td><td>${value(row.home_corners)} – ${value(row.away_corners)}</td><td>${value(row.source)}</td></tr>`;
      if(kind==='goals')return `<tr><td>${value(row.date)}</td><td>${match}</td><td>${value(row.minute)}</td><td>${value(row.score_home)} – ${value(row.score_away)}</td><td>${value(row.scorer)}</td></tr>`;
      return `<tr><td>${value(row.date)}</td><td>${match}</td><td>${value(row.time)}</td></tr>`;
    }).join('');
    return `<button class="inline-link back-link" data-back-supplemental>← Autres ligues et coupes</button><section class="card"><div class="card-header"><div><h2 class="card-title">${esc(selected.name||selected.folder)}</h2><p class="card-subtitle">${esc(countries(selected.country_code))} · open-matchday</p>${source}</div></div><div class="table-toolbar"><div class="segmented-control" aria-label="Données de la compétition">${[['results','Résultats'],['fixtures','Calendrier'],['goals','Buts']].map(([key,label])=>`<button data-supplemental-tab="${key}" aria-pressed="${key===kind}">${label} · ${selected[key]?.length||0}</button>`).join('')}</div><button class="button button-secondary" data-supplemental-download="${kind}" ${rows.length?'':'disabled'}>Exporter le CSV complet</button></div>${rows.length?`<div class="table-scroll" tabindex="0" role="region" aria-label="Matchs open-matchday"><table class="data-table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`:message('Aucune donnée pour cette rubrique','La source ne publie aucune ligne pour cette sélection.')}</section>`;
  }
  downloadSupplemental(kind) {
    const competition=this.supplementalData?.competitions.find(c=>c.folder===this.supplementalCompetition);
    const rows=competition?.[kind];if(!Array.isArray(rows)||!rows.length)return;
    const headers=Object.keys(rows[0]), csv=csvString(headers,rows.map(row=>headers.map(key=>row[key])));
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a');a.href=url;a.download=`open-matchday-${competition.folder}-${kind}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  renderSeason() {
    const league=this.catalog.find(x=>x.id===this.competitionId);
    const byDay=this.browseMode==='day';
    if(!byDay&&!league) {this.competitionId=null;return this.renderCompetitions();}
    const key=byDay?`date:${this.day}`:`${this.competitionId}:${this.season}`;
    const result=this.fixtures.get(key); if(!result) void this.loadFixtures();
    const matches=(result?.matches||[]).filter(m=>this.fixtureStatus==='all'||(this.fixtureStatus==='played'?m.status==='finished':m.status!=='finished'));
    return `<button class="inline-link back-link" data-back-catalog>← Toutes les compétitions</button><section class="card season-card"><div class="season-heading">${byDay?'':media(league.name,league.imageUrl,'crest competition-logo')}<div><div class="eyebrow">${byDay?'CALENDRIER MONDIAL':esc(countries(league.country))}</div><h2>${byDay?'Les matchs du jour choisi':esc(league.name)}</h2></div><div class="season-controls">${byDay?`<label class="select-field">Date<input id="fixture-date" type="date" value="${esc(this.day)}" aria-label="Date des matchs"></label>`:`<label class="select-field">Saison<select id="fixture-season">${[...league.seasons].sort().reverse().map(s=>`<option value="${esc(s)}" ${s===this.season?'selected':''}>${esc(seasonLabel(s))}${/^\d{4}$/.test(s)?' (saison civile)':''}</option>`).join('')}</select></label>`}<label class="select-field">Matchs<select id="fixture-status"><option value="all" ${this.fixtureStatus==='all'?'selected':''}>Tous les matchs</option><option value="played" ${this.fixtureStatus==='played'?'selected':''}>Terminés</option><option value="upcoming" ${this.fixtureStatus==='upcoming'?'selected':''}>À venir</option></select></label></div></div>
      ${!result||result.loading?pending:`<div class="card-body">${result.source==='snapshot'?`<div class="api-status"><span class="api-status-dot"></span><p><strong>Instantané local uniquement.</strong> ${esc(result.error)} ${matches.length?'Les matchs ci-dessous sont ceux déjà collectés.':'Aucun match de cette saison n’est encore chargé dans le projet.'}</p><button class="button button-ghost" data-retry-fixtures>Réessayer</button></div>`:`<div class="data-kicker">PITCHAPI · ${matches.length} MATCHS · SAISON ${esc(this.season?seasonLabel(this.season):this.day)}</div>`}<div class="fixture-list">${matches.map(m=>this.fixtureRow(m)).join('')||message('Aucun match à afficher',result.source==='api'?'PitchAPI ne renvoie pas de match pour cette sélection.':'La saison est référencée au catalogue ; ses matchs attendent la connexion API.')}</div></div>`}</section>`;
  }
  fixtureRow(match) {
    const home=match.home_team||match.home||{},away=match.away_team||match.away||{};
    return `<button class="fixture-row" data-fixture="${esc(match.id||'')}" ${match.id?'':'disabled'}><span class="fixture-date">${date(match.time_utc||match.date)}<small>${esc(match.league?.name||'')}</small></span><span class="fixture-team home">${esc(home.name)}${media(home.name,home.image_url||home.imageUrl,'crest club-crest')}</span><strong class="score">${match.status==='finished'||match.finished===true?`${fmt(match.score_home)} <span>–</span> ${fmt(match.score_away)}`:'À venir'}</strong><span class="fixture-team">${media(away.name,away.image_url||away.imageUrl,'crest club-crest')}${esc(away.name)}</span>${arrow}</button>`;
  }
  renderClubs() {
    if(this.clubId) return this.renderClub();
    const clubs=(this.data.teams||[]).filter(t=>normalizeText(t.name).includes(normalizeText(this.clubQuery))).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
    return `<div class="section-toolbar"><div><span class="section-label">LES CLUBS DU PROJET</span><h2>Les couleurs derrière les chiffres.</h2><p class="muted">${this.data.teams?.length||0} clubs dans les matchs collectés. Les autres équipes se découvrent depuis leur compétition.</p></div><button class="button button-secondary" data-page="competitions">Explorer les compétitions ${arrow}</button></div><div class="clubs-toolbar"><div class="search-field">⌕ <input id="club-query" type="search" placeholder="Rechercher un club…" aria-label="Rechercher un club" value="${esc(this.clubQuery)}"></div><span class="table-hint">${clubs.length} clubs</span></div><div class="club-grid">${clubs.map(t=>{const league=this.catalog.find(l=>l.id===t.leagueIds[0]);const players=this.playerIdsByTeam.get(t.id)?.size||0;return `<button class="club-card" data-open-club="${esc(t.id)}"><div class="club-card-header">${media(t.name,t.imageUrl,'crest club-logo')}${arrow}</div><h3>${esc(t.name)}</h3><p class="club-card-meta">${esc(league?.name||'')} · ${esc(countries(league?.country))}</p><div class="card-stats"><span><strong>${t.sampleMatches}</strong> match${t.sampleMatches>1?'s':''}</span><span><strong>${players}</strong> joueurs référencés</span></div></button>`;}).join('')||message('Aucun club','Essayez une autre recherche.')}</div>`;
  }
  renderClub() {
    const club=this.data.teams.find(t=>t.id===this.clubId);if(!club){this.clubId=null;return this.renderClubs();}
    const matches=this.localFixtures().filter(m=>m.home_team.id===club.id||m.away_team.id===club.id);
    const players=this.data.appearances.filter(p=>p.teamId===club.id);
    return `<button class="inline-link back-link" data-back-clubs>← Tous les clubs</button><section class="card"><div class="club-detail-heading">${media(club.name,club.imageUrl,'crest club-logo')}<div><div class="eyebrow">CLUB · DONNÉES COLLECTÉES</div><h2>${esc(club.name)}</h2><p class="muted">${matches.length} match${matches.length>1?'s':''} · ${new Set(players.map(p=>p.playerId)).size} joueurs référencés</p></div><button class="button button-secondary" data-provider-profile="${esc(club.id)}" data-profile-type="teams">Fiche PitchAPI ${arrow}</button></div><div class="card-body"><h3 class="detail-section-title">Les matchs du club</h3><div class="fixture-list">${matches.map(m=>this.fixtureRow(m)).join('')}</div><h3 class="detail-section-title">Les joueurs référencés</h3><div class="club-roster">${players.sort((a,b)=>(b.minutes||0)-(a.minutes||0)).map(p=>`<button class="roster-player" data-open-player="${esc(p.id)}">${media(p.name,p.imageUrl,'player-avatar')}<span><strong>${esc(p.name)}</strong><small>${fmt(p.minutes)} min · ${p.starter?'Titulaire':'Remplaçant'}</small></span></button>`).join('')}</div></div></section>`;
  }
  async loadShard(id) {
    if(!this.shards.has(id)) this.shards.set(id,(async()=>{for(const url of [`/api/archive/matches/${encodeURIComponent(id)}`,`./data/matches/${encodeURIComponent(id)}.json`]){try{const response=await fetch(url);if(response.ok)return await response.json();}catch{}}return null;})());
    return await this.shards.get(id);
  }
  async ensureEndpoint(match,section,force=false) {
    const key=`${match.id}:${section}`;if(this.payloads.has(key)&&!force)return;
    this.payloads.set(key,{loading:true});
    if(force)this.shards.delete(match.id);
    await this.statusPromise;
    if(!force){const shard=await this.loadShard(match.id);if(shard?.[section]&&Object.hasOwn(shard[section],'data')){this.payloads.set(key,{data:shard[section].data,source:'snapshot'});this.redraw();return;}}
    let apiError;
    if(this.configured) {
      try {const payload=await this.request(`matches/${match.id}${section==='match'?'':`/${section}`}`);this.payloads.set(key,{data:payload.data,source:'api'});this.redraw();return;}catch(error){apiError=error;}
    }
    const shard=await this.loadShard(match.id);
    if(shard?.[section]&&Object.hasOwn(shard[section],'data'))this.payloads.set(key,{data:shard[section].data,source:'snapshot',warning:apiError?.message});
    else this.payloads.set(key,{error:apiError?.message||(this.configured?'Ces données ne sont pas disponibles pour ce match.':'Ces données ne figurent pas dans l’instantané. Elles se chargeront après activation de PitchAPI.'),code:apiError?.code||'NOT_COLLECTED'});
    this.redraw();
  }
  renderMatchData(match) {
    const section=this.sections.get(match.id)||'lineups';const result=this.payloads.get(`${match.id}:${section}`);
    if(!result)void this.ensureEndpoint(match,section);
    const loaded=MATCH_SECTIONS.filter(([s])=>this.payloads.get(`${match.id}:${s}`)?.data!=null).length;
    return `<section class="card api-explorer"><div class="card-header"><div><div class="section-label">L’EXPLORATEUR COMPLET</div><h2 class="card-title">Le match sous tous les angles.</h2><p class="card-subtitle">Compositions, statistiques intégrales et toutes les analyses proposées par PitchAPI.</p></div><span class="badge badge-neutral">${loaded} / ${MATCH_SECTIONS.length} rubriques ouvertes</span></div><div class="api-tabs" role="group" aria-label="Données détaillées du match">${MATCH_SECTIONS.map(([key,label])=>`<button data-api-section="${key}" data-api-match="${esc(match.id)}" aria-pressed="${key===section}">${label}</button>`).join('')}</div><div class="api-result">${!result||result.loading?pending:result.error?`<div class="data-unavailable"><span class="section-label">${result.code==='NOT_COLLECTED'?'NON COLLECTÉ':'INDISPONIBLE'}</span>${message('Cette rubrique attend ses données.',result.error)}<button class="button button-secondary" data-refresh-section="${esc(match.id)}">Réessayer</button></div>`:`<div class="api-result-meta"><span class="data-kicker">${result.source==='api'?'PITCHAPI · À LA DEMANDE':'INSTANTANÉ DU PROJET'}${section==='match'&&result.source==='snapshot'?' · RÉSUMÉ DU CALENDRIER':''}</span><div><button class="inline-link" data-refresh-section="${esc(match.id)}">Actualiser ↻</button><button class="inline-link" data-download-section="${esc(match.id)}">Télécharger le JSON ↓</button></div></div>${result.warning?`<p class="table-hint">Dernier relevé affiché : ${esc(result.warning)}</p>`:''}${this.renderPayload(match,section,result.data)}<details class="data-record source-payload"><summary>Tous les champs de la réponse</summary>${structuredData(result.data)}</details>`}</div></section>`;
  }
  renderPayload(match,section,payload) {
    if(payload==null)return message('Données non renseignées','PitchAPI renvoie une valeur absente pour cette rubrique.');
    if(section==='lineups')return this.lineups(payload);
    if(section==='stats')return this.teamStats(match,payload);
    if(section==='players'||section==='players/halves')return this.playerStats(match,payload,section);
    if(section==='shots')return this.shots(match,payload);
    if(section==='events')return this.events(payload);
    if(section==='momentum')return this.momentum(match,payload);
    if(section==='heatmaps')return this.heatmaps(match,payload);
    if(section==='advanced/network')return this.networks(payload);
    if(section==='h2h')return this.headToHead(payload);
    return structuredData(payload);
  }
  lineups(payload) {
    return `<div class="lineup-grid">${['home','away'].map(side=>{const lineup=payload[side],team=payload[`${side}_team`]||{};if(!lineup)return message('Composition absente',team.name||side);return `<section class="lineup-team"><div class="lineup-title">${media(team.name,team.image_url,'crest club-crest')}<h3>${esc(team.name)}</h3><strong>${esc(lineup.formation||'—')}</strong></div><p class="table-hint">${lineup.confirmed===true?'Composition confirmée':lineup.confirmed===false?((lineup.starters?.length||lineup.subs?.length)?'Composition prévisionnelle':'Composition non renseignée'):'Confirmation non renseignée'}${lineup.coach?.name?` · ${esc(lineup.coach.name)}`:''}</p><div class="formation-pitch" role="img" aria-label="Placement des titulaires de ${esc(team.name)}"><div class="formation-center"></div>${(lineup.starters||[]).filter(p=>isNumber(p.pitch_x)&&isNumber(p.pitch_y)&&p.pitch_x>=0&&p.pitch_x<=1&&p.pitch_y>=0&&p.pitch_y<=1).map(p=>`<span class="formation-player" style="left:${8+p.pitch_y*84}%;top:${8+(1-p.pitch_x)*78}%"><b>${esc(p.shirt_number||'•')}</b><small>${esc(p.name)}${p.is_captain?' ©':''}</small></span>`).join('')}</div><details class="data-record" open><summary>Titulaires · ${(lineup.starters||[]).length}</summary><div class="lineup-list">${(lineup.starters||[]).map(p=>`<div><span class="shirt-number">${esc(p.shirt_number||'—')}</span><span>${esc(p.name)}${p.is_captain?' · Capitaine':''}</span><button class="inline-link" data-provider-profile="${esc(p.player_id)}" data-profile-type="players" aria-label="Fiche de ${esc(p.name)}">${arrow}</button></div>`).join('')}</div></details><details class="data-record"><summary>Remplaçants · ${(lineup.subs||[]).length}</summary><div class="lineup-list">${(lineup.subs||[]).map(p=>`<div><span class="shirt-number">${esc(p.shirt_number||'—')}</span><span>${esc(p.name)}</span></div>`).join('')}</div></details></section>`;}).join('')}</div>`;
  }
  teamStats(match,payload) {
    const periods=payload.periods||[];if(!periods.length)return message('Statistiques absentes','Aucune période n’est renseignée.');
    const selected=this.periodSelection.get(match.id)||periods.find(p=>p.period==='All')?.period||periods[0].period;
    const period=periods.find(p=>p.period===selected)||periods[0];
    return `<div class="table-toolbar"><label class="select-field">Période<select data-stats-period="${esc(match.id)}">${periods.map(p=>`<option value="${esc(p.period)}" ${p===period?'selected':''}>${esc({All:'Match entier',FirstHalf:'Première mi-temps',SecondHalf:'Seconde mi-temps'}[p.period]||p.period)}</option>`).join('')}</select></label><span class="table-hint">Valeurs du fournisseur · les périodes ne sont pas additionnées.</span></div>${match.coverage?.teamStatsReliable===false?'<div class="notice notice-warning"><p>Les statistiques d’action de ce match présentent des incohérences dans la source. Les valeurs brutes ci-dessous ne constituent pas des mesures validées.</p></div>':''}<div class="stats-groups">${(period.groups||[]).map(g=>`<section><h3 class="detail-section-title">${esc(g.group_name)}</h3><div class="stat-table-head"><span>${esc(payload.home_team?.name||match.home?.name)}</span><span>Indicateur</span><span>${esc(payload.away_team?.name||match.away?.name)}</span></div>${(g.items||[]).map(s=>`<div class="stat-comparison-values full-stat-row"><strong>${scalar(s.home)}</strong><span>${esc(s.title)}</span><strong>${scalar(s.away)}</strong></div>`).join('')}</section>`).join('')}</div>`;
  }
  playerStats(match,payload,section) {
    const players=Array.isArray(payload)?payload:payload.players||[];if(!players.length)return message('Statistiques absentes','Aucun joueur renseigné dans cette réponse.');
    const selected=this.playerSelection.get(`${match.id}:${section}`)||players[0].player?.id;
    const row=players.find(p=>p.player?.id===selected)||players[0];
    const periods=section==='players/halves'?row.periods||[]:[{period:'Match entier',stats:row.stats||[]}];
    return `<div class="table-toolbar"><label class="select-field">Joueur<select data-full-player="${esc(match.id)}" data-section="${section}">${players.map(p=>`<option value="${esc(p.player?.id)}" ${p===row?'selected':''}>${esc(p.player?.name||p.player?.id)}</option>`).join('')}</select></label><span class="table-hint">${players.length} joueurs · toutes les métriques renseignées</span></div><div class="full-player-header">${media(row.player?.name,row.player?.image_url,'player-avatar')}<div><h3>${esc(row.player?.name)}</h3><p class="muted">${esc(row.team_id===match.home?.id?match.home.name:row.team_id===match.away?.id?match.away.name:'')}</p></div><button class="button button-secondary" data-provider-profile="${esc(row.player?.id)}" data-profile-type="players">Fiche du joueur ${arrow}</button></div>${match.coverage?.teamStatsReliable===false?'<div class="notice notice-warning"><p>Les statistiques d’action de ce match sont signalées comme incohérentes. Cette vue expose les valeurs brutes du fournisseur.</p></div>':''}${periods.map(p=>`<h3 class="detail-section-title">${esc({FirstHalf:'Première mi-temps',SecondHalf:'Seconde mi-temps'}[p.period]||p.period)}</h3><div class="player-stat-groups">${(p.stats||[]).map(g=>`<section class="player-stat-group"><h4>${esc(g.title||title(g.key))}</h4><dl>${Object.entries(g.stats||{}).map(([label,item])=>`<div><dt>${esc(label)}</dt><dd>${statValue(item.stat)}</dd></div>`).join('')}</dl></section>`).join('')}</div>`).join('')}`;
  }
  shots(match,payload) {
    const shots=(payload.periods||[]).flatMap(p=>p.shots||[]).map(s=>({id:s.id,playerId:s.player?.id,playerName:s.player?.name,teamId:s.team_id,x:s.x,y:s.y,xg:s.expected_goals,xgot:s.expected_goals_on_target,minute:s.minute,type:s.is_own_goal?'OwnGoal':s.event_type,isGoal:['Goal','OwnGoal'].includes(s.event_type),isOwnGoal:s.is_own_goal===true||s.event_type==='OwnGoal',isOnTarget:s.is_on_target}));
    const normalized={...match,shots};
    return `<div class="data-chart-grid"><div>${shotMap(normalized)}</div><div>${xgTimeline(normalized)}</div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Minute</th><th>Joueur</th><th>Événement</th><th class="numeric">xG</th><th class="numeric">xGOT</th></tr></thead><tbody>${shots.map(s=>`<tr><td>${fmt(s.minute)}′</td><td>${esc(s.playerName)}</td><td>${esc({Goal:'But',OwnGoal:'CSC',Miss:'Non cadré',Post:'Montant',AttemptSaved:'Arrêté / contré'}[s.type]||s.type)}</td><td class="numeric">${fmt(s.xg,3)}</td><td class="numeric">${fmt(s.xgot,3)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  events(payload) {
    const events=payload.events||[];if(!events.length)return message('Aucun événement renseigné','La réponse ne contient pas d’événement.');
    const names={Goal:'But',Substitution:'Remplacement',YellowCard:'Carton jaune',RedCard:'Carton rouge',Penalty:'Penalty',OwnGoal:'But contre son camp'};
    return `<ol class="event-timeline">${events.map(e=>`<li><strong class="event-minute">${fmt(e.minute)}${e.minute_added?`+${fmt(e.minute_added)}`:''}′</strong><span class="event-marker"></span><div><strong>${esc(names[e.event_type]||e.event_type)}</strong><p>${esc(e.player?.name||'')}${e.sub_in_player?` → ${esc(e.sub_in_player.name)}`:''}${e.is_penalty?' · Penalty':''}${e.is_own_goal?' · CSC':''}</p></div>${e.score_home!=null&&e.score_away!=null?`<span class="score">${fmt(e.score_home)}–${fmt(e.score_away)}</span>`:''}</li>`).join('')}</ol>`;
  }
  momentum(match,payload) {
    const points=(payload.points||[]).filter(p=>isNumber(p.minute)&&isNumber(p.value));if(!points.length)return message('Momentum indisponible','Aucun point n’est fourni pour ce match.');
    const limit=Math.max(...points.map(p=>Math.abs(p.value)),0.01),duration=Math.max(...points.map(p=>p.minute),90);
    return `<figure class="chart-figure"><svg viewBox="0 0 720 240" role="img" aria-label="Pression minute par minute"><line x1="30" y1="110" x2="700" y2="110" stroke="#596451"/>${points.map(p=>{const height=Math.abs(p.value)/limit*82;return `<rect x="${30+p.minute/duration*660}" y="${p.value>=0?110-height:110}" width="${Math.max(2,640/points.length)}" height="${height}" fill="${p.value>=0?'#c6f36b':'#b2a7df'}"><title>${fmt(p.minute)}′ : ${fmt(p.value,3)}</title></rect>`;}).join('')}<text x="30" y="20" fill="#c6f36b" font-size="12">${esc(match.home?.name)}</text><text x="30" y="220" fill="#b2a7df" font-size="12">${esc(match.away?.name)}</text><text x="700" y="220" text-anchor="end" fill="#9ea895" font-size="12">${duration}′</text></svg><figcaption>Indice de pression PitchAPI. Positif : domicile ; négatif : extérieur. Amplitude adaptée aux valeurs fournies.</figcaption></figure>`;
  }
  heatmaps(match,payload) {
    const entries=[...(payload.teams||[]).map(x=>({...x,key:`team:${x.team.id}`,label:x.team.name})),...(payload.players||[]).map(x=>({...x,key:x.player.id,label:x.player.name}))];
    if(!entries.length)return message('Carte d’activité indisponible','Aucune cellule renseignée pour ce match.');
    const selected=entries.find(x=>x.key===this.heatSelection.get(match.id))||entries[0];
    const length=Number(payload.grid?.length)||16,width=Number(payload.grid?.width)||12;
    const cells=(selected.cells||[]).filter(c=>Array.isArray(c)&&c.length>=3&&c.every(isNumber)&&c[0]>=0&&c[0]<length&&c[1]>=0&&c[1]<width&&c[2]>=0);
    const max=Math.max(1,...cells.map(c=>c[2]));
    return `<div class="table-toolbar"><label class="select-field">Équipe ou joueur<select data-heat-select="${esc(match.id)}">${entries.map(x=>`<option value="${esc(x.key)}" ${x===selected?'selected':''}>${esc(x.label)}</option>`).join('')}</select></label><span>${fmt(selected.actions)} actions · ${payload.grid?.frame==='home_ltr'?'Repère du domicile':'Repère de l’équipe'}</span></div><figure class="chart-figure"><svg viewBox="0 0 680 450" role="img" aria-label="Carte d’activité de ${esc(selected.label)}"><rect x="20" y="20" width="640" height="400" fill="#122014" stroke="#526447"/>${cells.map(([x,y,n])=>`<rect x="${20+x/length*640}" y="${20+y/width*400}" width="${640/length}" height="${400/width}" fill="#c6f36b" fill-opacity="${0.12+n/max*0.8}"><title>${n} actions · cellule ${x}, ${y}</title></rect>`).join('')}<path d="M340 20v400M20 140h100v160H20M660 140H560v160h100" fill="none" stroke="#91a883" stroke-opacity=".6"/><circle cx="340" cy="220" r="52" fill="none" stroke="#91a883" stroke-opacity=".6"/></svg><figcaption>Volumes bruts par cellule. Les coordonnées utilisent le repère indiqué par PitchAPI, sans retournement supplémentaire.</figcaption></figure>`;
  }
  networks(payload) {
    const networks=payload.networks||[];if(!networks.length)return message('Réseau indisponible','Aucun réseau fourni pour ce match.');
    return `<div class="lineup-grid">${networks.map((network,index)=>{const nodes=(network.nodes||[]).filter(n=>isNumber(n.avg_x)&&isNumber(n.avg_y)),byId=new Map(nodes.map(n=>[n.player.id,n])),color=index?'#b2a7df':'#c6f36b';return `<figure class="chart-figure"><h3>${esc(network.team?.name)}</h3><svg viewBox="0 0 400 310" role="img" aria-label="Réseau de passes de ${esc(network.team?.name)}"><rect x="15" y="15" width="370" height="250" fill="#132014" stroke="#4d5d44"/><path d="M200 15v250" stroke="#4d5d44"/>${(network.edges||[]).filter(e=>byId.has(e.from?.id)&&byId.has(e.to?.id)&&isNumber(e.passes)).map(e=>{const from=byId.get(e.from.id),to=byId.get(e.to.id);return `<line x1="${15+from.avg_x/105*370}" y1="${15+from.avg_y/68*250}" x2="${15+to.avg_x/105*370}" y2="${15+to.avg_y/68*250}" stroke="${color}" stroke-opacity=".3" stroke-width="${Math.min(8,Math.max(1,e.passes/3))}"><title>${esc(from.player.name)} → ${esc(to.player.name)} : ${e.passes} passes</title></line>`;}).join('')}${nodes.map(n=>`<g><circle cx="${15+n.avg_x/105*370}" cy="${15+n.avg_y/68*250}" r="${Math.min(13,6+(Number(n.passes)||0)/15)}" fill="${color}" stroke="#122014" stroke-width="2"><title>${esc(n.player.name)} · ${fmt(n.passes)} passes</title></circle><text x="${15+n.avg_x/105*370}" y="${35+n.avg_y/68*250}" text-anchor="middle" fill="#e2e7dc" font-size="8">${esc(n.player.name)}</text></g>`).join('')}</svg><figcaption>Jusqu’au premier remplacement${isNumber(network.window?.until_seconds)?` (${fmt(network.window.until_seconds/60,1)} min)`:''}. Les destinataires des passes sont inférés par le fournisseur.</figcaption></figure>`;}).join('')}</div>`;
  }
  headToHead(payload) {
    return `<div class="detail-grid">${[['home_wins',payload.home_team?.name||'Domicile'],['draws','Nuls'],['away_wins',payload.away_team?.name||'Extérieur'],['total_matches','Confrontations']].map(([key,label])=>`<div class="detail-stat"><span class="detail-label">${esc(label)}</span><strong class="detail-value">${fmt(payload[key])}</strong></div>`).join('')}</div><div class="fixture-list">${(payload.recent_matches||[]).map(m=>this.fixtureRow(m)).join('')}</div>`;
  }
  normalizedRemote(match) {
    return {id:match.id,home:{...match.home_team,imageUrl:match.home_team?.image_url,score:match.score_home},away:{...match.away_team,imageUrl:match.away_team?.image_url,score:match.score_away},date:match.date,timeUtc:match.time_utc,status:match.status,coverage:{},shots:[],stats:[],warnings:[]};
  }
  renderRemoteMatch() {
    const match=this.normalizedRemote(this.remoteMatch);
    return `<button class="inline-link back-link" data-back-season>← Retour aux matchs</button><section class="card"><div class="match-detail-meta"><span class="eyebrow">${esc(this.remoteMatch.league?.name||this.catalog.find(l=>l.id===this.competitionId)?.name||'MATCH PITCHAPI')}</span><span>${date(match.timeUtc)}</span></div><div class="scoreboard"><div class="scoreboard-team">${media(match.home.name,match.home.imageUrl,'team-initials crest')}<h2>${esc(match.home.name)}</h2></div><div class="scoreboard-score"><strong>${fmt(match.home.score)}<span>:</span>${fmt(match.away.score)}</strong><span class="badge badge-neutral">${match.status==='finished'?'Terminé':'À venir / en cours'}</span></div><div class="scoreboard-team">${media(match.away.name,match.away.imageUrl,'team-initials crest')}<h2>${esc(match.away.name)}</h2></div></div></section><div class="view-footnote">${this.renderMatchData(match)}</div>`;
  }
  currentMatch(id) {return this.data.matches.find(m=>m.id===id)||(this.fixtureIndex.has(id)?this.normalizedRemote(this.fixtureIndex.get(id)):null);}
  openFixture(id) {
    if(this.data.matches.some(m=>m.id===id)){this.openLocalMatch(id);return;}
    const match=this.fixtureIndex.get(id);if(match){this.remoteMatch=match;this.navigate('competitions');}
  }
  async openProfile(id,type) {
    if(!/^[pt]_[A-Za-z0-9]{6}$/.test(id)||!['teams','players'].includes(type))return;
    const dialog=document.querySelector('#detail-dialog');const content=document.querySelector('#dialog-content');
    content.innerHTML=`<div class="modal-header"><h2 id="dialog-title">Fiche PitchAPI</h2><button class="button button-ghost" data-close-dialog aria-label="Fermer la fiche">✕</button></div><div class="modal-body" id="profile-body">${pending}</div>`;if(!dialog.open)dialog.showModal();
    try {
      const key=`${type}/${id}`;
      if(!this.profiles.has(key)) {
        try {const response=await fetch(`/api/archive/profiles/${key}`);if(response.ok)this.profiles.set(key,(await response.json()).data);}catch{}
        if(!this.profiles.has(key)) {await this.statusPromise;if(!this.configured)throw new Error('Ce profil n’est pas dans l’archive et la connexion PitchAPI est indisponible.');this.profiles.set(key,(await this.request(key)).data);}
      }
      const body=document.querySelector('#profile-body');if(body)body.innerHTML=structuredData(this.profiles.get(key));
    }catch(error){const body=document.querySelector('#profile-body');if(body)body.innerHTML=message('Profil non chargé',error.message);}
  }
  download(matchId) {
    const section=this.sections.get(matchId)||'lineups',result=this.payloads.get(`${matchId}:${section}`);if(!result||!Object.hasOwn(result,'data'))return;
    const url=URL.createObjectURL(new Blob([JSON.stringify({source:'PitchAPI',delivery:result.source,matchId,section,data:result.data},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`orion-${matchId}-${section.replaceAll('/','-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  handleClick(target) {
    const d=target.dataset;
    if('openSupplemental'in d){this.supplementalMode=true;this.supplementalCompetition=null;this.redraw();}
    else if('backSupplemental'in d){if(this.supplementalCompetition)this.supplementalCompetition=null;else this.supplementalMode=false;this.redraw();}
    else if('retrySupplemental'in d){this.supplementalError=null;this.redraw();}
    else if(d.supplementalCompetition){this.supplementalCompetition=d.supplementalCompetition;this.supplementalTab='results';this.redraw();}
    else if(d.supplementalTab){this.supplementalTab=d.supplementalTab;this.redraw();}
    else if(d.supplementalDownload){this.downloadSupplemental(d.supplementalDownload);}
    else if(d.openCompetition){this.competitionId=d.openCompetition;this.season=[...(this.catalog.find(l=>l.id===d.openCompetition)?.seasons||[])].sort().at(-1);this.remoteMatch=null;this.browseMode='catalog';this.redraw();}
    else if('backCatalog'in d){this.competitionId=null;this.remoteMatch=null;this.browseMode='catalog';this.redraw();}
    else if('moreCompetitions'in d){this.page++;this.redraw();}
    else if('browseDay'in d){this.browseMode='day';this.redraw();}
    else if('backSeason'in d){this.remoteMatch=null;this.redraw();}
    else if('retryFixtures'in d){const key=this.browseMode==='day'?`date:${this.day}`:`${this.competitionId}:${this.season}`;this.fixtures.delete(key);this.statusPromise=this.checkStatus();this.redraw();}
    else if(d.fixture){this.openFixture(d.fixture);}
    else if(d.openPlayer&&!this.data.appearances.some(p=>p.id===d.openPlayer)){const parts=d.openPlayer.split(':');if(parts.length!==2||!this.currentMatch(parts[0]))return false;this.playerSelection.set(`${parts[0]}:players`,parts[1]);this.sections.set(parts[0],'players');this.redraw();}
    else if(d.openClub){this.clubId=d.openClub;this.redraw();}
    else if('backClubs'in d){this.clubId=null;this.redraw();}
    else if(d.apiSection){this.sections.set(d.apiMatch,d.apiSection);this.redraw();}
    else if(d.refreshSection){const match=this.currentMatch(d.refreshSection);if(match){this.statusPromise=this.checkStatus();void this.ensureEndpoint(match,this.sections.get(match.id)||'lineups',true);this.redraw();}}
    else if(d.downloadSection){this.download(d.downloadSection);}
    else if(d.providerProfile){void this.openProfile(d.providerProfile,d.profileType);}
    else if(d.playerFull){this.playerSelection.set(`${d.playerMatch}:players`,d.playerFull);this.sections.set(d.playerMatch,'players');this.openLocalMatch(d.playerMatch);setTimeout(()=>document.querySelector('.api-explorer')?.scrollIntoView({behavior:'smooth',block:'start'}),0);}
    else return false;
    return true;
  }
  handleChange(target) {
    if(target.id==='competition-country'){this.country=target.value;this.page=1;}
    else if(target.id==='fixture-season')this.season=target.value;
    else if(target.id==='fixture-status')this.fixtureStatus=target.value;
    else if(target.id==='fixture-date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(target.value))return true;this.day=target.value;}
    else if(target.dataset.statsPeriod)this.periodSelection.set(target.dataset.statsPeriod,target.value);
    else if(target.dataset.fullPlayer)this.playerSelection.set(`${target.dataset.fullPlayer}:${target.dataset.section}`,target.value);
    else if(target.dataset.heatSelect)this.heatSelection.set(target.dataset.heatSelect,target.value);
    else return false;
    this.redraw();return true;
  }
  handleInput(target) {
    const key={'competition-query':'competitionQuery','club-query':'clubQuery'}[target.id];if(!key)return false;
    const cursor=target.selectionStart;this[key]=target.value;this.page=1;this.redraw();const input=document.getElementById(target.id);input?.focus({preventScroll:true});input?.setSelectionRange(cursor,cursor);return true;
  }
}

if(typeof document!=='undefined') document.addEventListener('error',event=>{
  if(event.target.matches?.('img[data-provider-image]')){event.target.hidden=true;const fallback=event.target.parentElement.querySelector('.image-fallback');if(fallback)fallback.hidden=false;event.target.parentElement.classList.add('is-missing');}
},true);
