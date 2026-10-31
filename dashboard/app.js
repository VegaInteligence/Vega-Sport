import {normalizeText, isNumber, escapeHtml as esc, formatNumber as fmt, filterAppearances, filterMatches, sortRows, per90, sumKnown, csvString} from './model.js';
import {scatterPlot, shotMap, xgTimeline} from './charts.js';
import {PitchExplorer, media} from './explorer.js';

const $ = (selector) => document.querySelector(selector);
const REPO = 'https://github.com/OrionQuantPlatform/Football_Ranking';
const PAGE_SIZE = 20;
const defaults = {query:'',league:'all',season:'all',minutes:1,match:'all'};
const state = {page:'overview',filters:{...defaults},sort:'rating',direction:'desc',tablePage:1,mode:'total',scatter:'attack',leaders:'rating',selectedMatch:null,shotTeam:'all',matchChart:'map',compare:[],catalogAll:false,catalogQuery:''};
let data, byAppearance, byMatch, toastTimer, explorer;
const PAGES = ['overview','competitions','clubs','players','matches','method'];

function icon(name, size = 18) {
  const paths = {
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
    external:'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    players:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v2"/>',
    pitch:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M8 3v4h8V3m-8 18v-4h8v4"/><circle cx="12" cy="12" r="3"/>',
    globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    compare:'<path d="M4 5h16M4 19h16M8 2v20M16 2v20"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
    spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>'
  };
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}

const date = (value, options={day:'numeric',month:'short'}) => value ? new Intl.DateTimeFormat('fr-FR', {...options,timeZone:'Europe/Paris'}).format(new Date(value.includes('T') ? value : `${value}T12:00:00Z`)) : 'Date inconnue';
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0,2).map((word) => word[0]).join('').toLocaleUpperCase('fr');
const avatar = (name, className='player-avatar', imageUrl=null) => media(name,imageUrl,className);
const rating = (value) => isNumber(value) ? `<span class="rating-pill${value >= 8 ? ' rating-high' : value < 6 ? ' rating-low' : ''}" title="Note du fournisseur PitchAPI sur 10">${fmt(value,2)}</span>` : '<span class="missing-value" title="Note non renseignée">—</span>';
const numberCell = (value, digits=0) => `<span${isNumber(value) ? '' : ' class="missing-value" title="Donnée non renseignée"'}>${fmt(value,digits)}</span>`;

function currentRows() { return filterAppearances(data.appearances,state.filters); }
function currentMatches() { return filterMatches(data.matches,data.appearances,state.filters); }
function empty(message='Aucun résultat pour ces filtres.', detail='Essayez une autre compétition ou élargissez votre recherche.') {
  return `<div class="empty-state">${icon('search',28)}<h3 class="empty-title">${esc(message)}</h3><p>${esc(detail)}</p><button class="button button-secondary" data-reset>Réinitialiser les filtres</button></div>`;
}
function metric(label,value,detail,iconName) {
  return `<article class="metric-card"><div class="metric-label">${label}<span class="metric-icon">${icon(iconName)}</span></div><div class="metric-value">${value}</div><div class="metric-detail">${detail}</div></article>`;
}
function cardHeader(title,subtitle,action='') {
  return `<div class="card-header"><div><h2 class="card-title">${title}</h2>${subtitle ? `<p class="card-subtitle">${subtitle}</p>` : ''}</div>${action}</div>`;
}
function notice(title,copy,kind='') {
  return `<div class="notice ${kind}"><span class="notice-icon">${icon('info')}</span><div class="notice-copy"><div class="notice-title">${title}</div><p>${copy}</p></div></div>`;
}

function syncUrl() {
  const params = new URLSearchParams();
  if(state.filters.query) params.set('q',state.filters.query);
  if(state.filters.league !== 'all') params.set('league',state.filters.league);
  if(state.filters.season !== 'all') params.set('season',state.filters.season);
  if(Number(state.filters.minutes) !== 1) params.set('minutes',state.filters.minutes);
  if(state.page === 'matches' && state.selectedMatch) params.set('match',state.selectedMatch);
  else if(state.filters.match !== 'all') params.set('match',state.filters.match);
  const query = params.toString();
  history.replaceState(null,'',`${location.pathname}${query ? `?${query}` : ''}#${state.page}`);
}

function render() {
  const rows = currentRows(), matches = currentMatches();
  const headings = {
    overview:['LE FOOTBALL, SOUS UN AUTRE ANGLE','Le jeu derrière les chiffres.','Joueurs, clubs et compétitions. Explorez chaque dimension de la performance.'],
    competitions:['LE FOOTBALL SANS FRONTIÈRES','Un monde de compétitions.','Parcourez le catalogue PitchAPI, choisissez une saison et entrez dans le match.'],
    clubs:['LES COULEURS DU JEU','Chaque club, son histoire.','Retrouvez les équipes, leurs matchs et les joueurs présents dans les données.'],
    players:['EXPLORATEUR DE JOUEURS','Chaque performance compte.','Comparez les statistiques individuelles, une apparition à la fois.'],
    matches:['EXPLORATEUR DE MATCHS','Au plus près du match.','Résultats, occasions et contributions individuelles, dans leur contexte.'],
    method:['LE PROJET ORION','Une lecture plus juste.','La couverture des données et les fondations du futur classement.']
  };
  const heading = headings[state.page];
  $('#page-eyebrow').textContent=heading[0]; $('#page-title').textContent=heading[1]; $('#page-description').textContent=heading[2];
  document.title = `${{overview:'Vue d’ensemble',competitions:'Compétitions',clubs:'Clubs',players:'Joueurs',matches:'Matchs',method:'Données & méthode'}[state.page]} — Orion Football Ranking`;
  document.querySelectorAll('[data-page]').forEach((button)=>{ if(button.dataset.page === state.page) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
  $('#filters').hidden=['method','competitions','clubs'].includes(state.page);
  $('#filter-summary').hidden=['method','competitions','clubs'].includes(state.page);
  $('#export-button').hidden=['method','competitions','clubs'].includes(state.page);
  const focusedMatch=byMatch.get(state.filters.match);
  $('#filter-summary').innerHTML=`<span><strong>${fmt(rows.length)}</strong> apparition${rows.length>1?'s':''} affichée${rows.length>1?'s':''} <span class="summary-separator">/</span> ${matches.length} match${matches.length>1?'s':''} dans le périmètre${focusedMatch?` <button class="match-filter-chip" data-clear-match title="Retirer le filtre du match">${esc(focusedMatch.home.name)} – ${esc(focusedMatch.away.name)} ${icon('close',12)}</button>`:''}</span><span>${date(data.meta.startDate)} — ${date(data.meta.endDate,{day:'numeric',month:'short',year:'numeric'})}<span class="badge badge-neutral">Instantané</span></span>`;
  const active=Object.keys(defaults).some((key)=>String(state.filters[key])!==String(defaults[key]));
  $('#reset-filters').hidden=!active;
  $('#content').innerHTML=state.page==='overview' ? overview(rows,matches) : state.page==='players' ? playersView(rows) : state.page==='matches' ? matchesView(matches) : state.page==='competitions' ? explorer.renderCompetitions() : state.page==='clubs' ? explorer.renderClubs() : methodView();
  renderCompareTray();
  syncUrl();
}

function overview(rows,matches) {
  const leagues=new Set(matches.map((match)=>match.leagueId));
  const featured=matches.find(match=>match.league==='Ligue 1')||matches[0];
  const spotlight=featured?`<section class="hero-strip featured-match"><div class="hero-copy"><div class="hero-kicker">LE MATCH À EXPLORER <span>·</span> ${esc(featured.league)} <span>·</span> ${date(featured.date)}</div><div class="featured-score"><span>${avatar(featured.home.name,'crest featured-crest',featured.home.imageUrl)}<strong>${esc(featured.home.name)}</strong></span><b>${fmt(featured.home.score)}<i>:</i>${fmt(featured.away.score)}</b><span>${avatar(featured.away.name,'crest featured-crest',featured.away.imageUrl)}<strong>${esc(featured.away.name)}</strong></span></div></div><div class="featured-action"><p>Des compositions aux dernières occasions.<br>Entrez dans toutes les données du match.</p><button class="button button-primary" data-open-match="${esc(featured.id)}">Explorer le match ${icon('arrow',16)}</button></div></section>`:'';
  const shots=matches.flatMap((match)=>match.shots || []);
  const shotMatches=matches.filter((match)=>match.coverage.shots).length;
  const cards=`<section class="metric-grid" aria-label="Chiffres de l’échantillon">
    ${metric('Apparitions affichées',fmt(rows.length),`${data.meta.playerCount} joueurs référencés, banc compris`,'players')}
    ${metric('Matchs dans le périmètre',fmt(matches.length),'Un premier regard sur les données','pitch')}
    ${metric('Compétitions observées',fmt(leagues.size),`${data.meta.catalogCount} disponibles au catalogue`,'globe')}
    ${metric('Événements de tir',fmt(shots.length),`Données présentes sur ${shotMatches}/${matches.length} matchs`,'target')}
  </section>`;
  const attack=state.scatter==='attack';
  const scatterOptions=attack ? {xKey:'xg',yKey:'xa',xLabel:'Buts attendus · xG',yLabel:'Passes décisives attendues · xA'} : {xKey:'chancesCreated',yKey:'defensiveActions',xLabel:'Occasions créées',yLabel:'Actions défensives'};
  const chartControls=`<div class="segmented-control" aria-label="Dimensions du graphique"><button data-scatter="attack" aria-pressed="${attack}">Attaque</button><button data-scatter="balance" aria-pressed="${!attack}">Création & défense</button></div>`;
  return spotlight+cards+`<div class="dashboard-grid">
    <section class="card span-8">${cardHeader('La performance en deux dimensions','Chaque point représente une apparition. Cliquez pour l’explorer.',chartControls)}<div class="card-body chart-body"><div class="chart-container">${scatterPlot(rows,scatterOptions)}</div></div><div class="card-footer"><span class="legend-item"><span class="legend-dot"></span>Statistiques du match</span><span>Valeurs renseignées uniquement · sans ajustement par rôle</span></div></section>
    <section class="card span-4">${cardHeader('À la une dans l’échantillon','Un tri des valeurs observées, à explorer.')}<div class="leader-controls segmented-control" aria-label="Trier les performances"><button data-leaders="rating" aria-pressed="${state.leaders==='rating'}">Note PitchAPI</button><button data-leaders="xg" aria-pressed="${state.leaders==='xg'}">xG</button><button data-leaders="chancesCreated" aria-pressed="${state.leaders==='chancesCreated'}">Création</button></div>${leaderboard(rows)}<div class="card-footer"><button class="inline-link" data-page="players">Explorer tous les joueurs ${icon('arrow',16)}</button></div></section>
    <section class="card span-8">${cardHeader('Les matchs de l’échantillon','Des rencontres à parcourir, des performances à comprendre.',`<button class="inline-link" data-page="matches">Tous les matchs ${icon('arrow',16)}</button>`)}<div class="match-list">${matches.length ? matches.slice(0,5).map(matchRow).join('') : empty()}</div></section>
    <section class="card span-4">${cardHeader('Ce que les données couvrent','La disponibilité varie selon la compétition.')}<div class="card-body">${coverageRows(matches)}<div class="coverage-footnote">Une valeur absente apparaît sous la forme <strong>—</strong>.</div></div><div class="card-footer"><button class="inline-link" data-page="method">Comprendre la couverture ${icon('arrow',16)}</button></div></section>
    <div class="span-12">${notice('Un premier terrain d’exploration',`Cet échantillon contient ${data.meta.matchCount} matchs. Le futur classement Orion sera ajusté au rôle et au contexte ; les notes affichées ici proviennent de PitchAPI. <button class="inline-link" data-page="method">Découvrir la méthode ${icon('arrow',14)}</button>`)}</div>
  </div>`;
}

function leaderboard(rows) {
  const rated=sortRows(rows.filter((row)=>isNumber(row[state.leaders])),state.leaders,'desc').slice(0,5);
  const label=state.leaders==='rating'?'note PitchAPI':state.leaders==='xg'?'xG':'occasions créées';
  if(!rated.length) return `<div class="chart-empty">Aucune valeur de ${label} renseignée pour ces filtres.</div>`;
  return `<ol class="leaderboard">${rated.map((row,index)=>`<li><button class="leader-row" data-open-player="${esc(row.id)}"><span class="leader-rank">${String(index+1).padStart(2,'0')}</span>${avatar(row.name,'player-avatar',row.imageUrl)}<span class="player-copy"><span class="player-name">${esc(row.name)}</span><span class="player-meta">${esc(row.team)} · ${fmt(row.minutes)} min</span></span><span class="leader-value">${state.leaders==='rating'?rating(row.rating):fmt(row[state.leaders],state.leaders==='xg'?2:0)}</span></button></li>`).join('')}</ol><p class="leader-note">${state.leaders==='rating'?'Notes du fournisseur, sur 10.':'Volumes bruts par apparition.'} ${rows.filter((row)=>isNumber(row[state.leaders])).length}/${rows.length} valeurs disponibles.</p>`;
}

function matchRow(match) {
  return `<button class="match-row" data-open-match="${esc(match.id)}"><span class="match-date">${date(match.date)}</span><span class="match-teams"><span class="team-name home-team">${avatar(match.home.name,'crest club-crest',match.home.imageUrl)}${esc(match.home.name)}</span><span class="score">${fmt(match.home.score)} <span>–</span> ${fmt(match.away.score)}</span><span class="team-name">${avatar(match.away.name,'crest club-crest',match.away.imageUrl)}${esc(match.away.name)}</span></span><span class="match-league">${esc(match.league)}${!match.coverage.shots?'<span class="coverage-indicator" title="Données de tirs absentes">*</span>':''}</span>${icon('chevron',16)}</button>`;
}

function coverageRows(matches) {
  const total=matches.length;
  return `<div class="coverage-list">${[['players','Statistiques joueurs'],['shots','Événements de tir'],['xg','xG individuels'],['ratings','Notes individuelles']].map(([key,label])=>{
    const n=matches.filter((match)=>match.coverage[key]).length, percent=total?n/total*100:0;
    return `<div class="coverage-row"><span class="coverage-label">${label}</span><span class="coverage-value">${n}<span> / ${total}</span></span><div class="coverage-track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="${Math.max(1,total)}" aria-valuenow="${n}"><span class="coverage-fill" style="width:${percent}%"></span></div></div>`;
  }).join('')}</div>`;
}

function tableHeader(key,label,tip='') {
  const active=state.sort===key;
  return `<th scope="col"${key!=='name'?' class="numeric"':''} aria-sort="${active?(state.direction==='asc'?'ascending':'descending'):'none'}"><button data-sort="${key}"${tip?` title="${esc(tip)}"`:''}>${label}<span aria-hidden="true">${active?(state.direction==='asc'?'↑':'↓'):'↕'}</span></button></th>`;
}

function playersView(rows) {
  const sorted=sortRows(rows,state.sort,state.direction,state.mode);
  const pages=Math.max(1,Math.ceil(sorted.length/PAGE_SIZE)); state.tablePage=Math.min(state.tablePage,pages);
  const start=(state.tablePage-1)*PAGE_SIZE, visible=sorted.slice(start,start+PAGE_SIZE);
  const stat=(row,key,digits=0)=>numberCell(state.mode==='per90'?per90(row[key],row.minutes):row[key],state.mode==='per90'?2:digits);
  return `<section class="card player-card">${cardHeader('L’explorateur de performances','Une ligne par joueur et par match. Sélectionnez jusqu’à 3 joueurs pour les comparer.',`<span class="badge badge-neutral">${fmt(rows.length)} apparitions</span>`)}
    <div class="table-toolbar"><div class="segmented-control" aria-label="Mode des statistiques"><button data-mode="total" aria-pressed="${state.mode==='total'}">Par match</button><button data-mode="per90" aria-pressed="${state.mode==='per90'}">Par 90 minutes</button></div><span class="table-hint">${state.mode==='per90'?'Volumes ramenés à 90 min · notes inchangées':'Cliquez sur une colonne pour trier'} · <span title="Une valeur absente n’est pas un zéro">— donnée absente</span></span></div>
    ${rows.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Tableau des performances, défilement horizontal possible"><table class="data-table"><thead><tr><th scope="col"><span class="sr-only">Comparer</span></th>${tableHeader('name','Joueur')}${tableHeader('minutes','Min.','Temps de jeu réel')}${tableHeader('rating','Note','Note du fournisseur PitchAPI, sur 10')}${tableHeader('goals','Buts')}${tableHeader('assists','PD','Passes décisives')}${tableHeader('xg','xG','Buts attendus')}${tableHeader('xa','xA','Passes décisives attendues')}${tableHeader('chancesCreated','Occ. créées')}${tableHeader('defensiveActions','Défense','Actions défensives brutes, non ajustées au rôle')}</tr></thead><tbody>${visible.map((row)=>`<tr><td><input type="checkbox" data-compare="${esc(row.id)}" aria-label="Comparer ${esc(row.name)}" ${state.compare.includes(row.id)?'checked':''}></td><td><button class="table-player" data-open-player="${esc(row.id)}">${avatar(row.name,'player-avatar',row.imageUrl)}<span class="player-copy"><span class="player-name">${esc(row.name)}</span><span class="player-meta">${esc(row.team)} <span>· ${esc(row.league)}</span></span></span>${!row.statsReliable?'<span class="data-warning" title="Statistiques partielles">*</span>':''}</button></td><td class="numeric">${numberCell(row.minutes)}</td><td class="numeric">${rating(row.rating)}</td><td class="numeric">${stat(row,'goals')}</td><td class="numeric">${stat(row,'assists')}</td><td class="numeric">${stat(row,'xg',2)}</td><td class="numeric">${stat(row,'xa',2)}</td><td class="numeric">${stat(row,'chancesCreated')}</td><td class="numeric">${stat(row,'defensiveActions')}</td></tr>`).join('')}</tbody></table></div><div class="table-footer"><span>${start+1}–${Math.min(start+PAGE_SIZE,rows.length)} sur ${fmt(rows.length)} apparitions</span><div class="pagination"><button class="button button-icon button-secondary" data-table-page="${state.tablePage-1}" aria-label="Page précédente" ${state.tablePage===1?'disabled':''}><span class="rotate-180">${icon('chevron',16)}</span></button><span>Page ${state.tablePage} / ${pages}</span><button class="button button-icon button-secondary" data-table-page="${state.tablePage+1}" aria-label="Page suivante" ${state.tablePage===pages?'disabled':''}>${icon('chevron',16)}</button></div></div>` : empty()}
  </section><div class="view-footnote">${notice('Comparer dans le bon contexte',`Les statistiques proviennent d’un petit échantillon, avec une couverture inégale. ${state.mode==='per90'?'Les taux par 90 minutes peuvent être élevés sur de courtes apparitions. ':''}Le rôle et la force de l’adversaire ne sont pas encore pris en compte dans ces vues.`)}</div>`;
}

function matchesView(matches) {
  if(!matches.length) return `<section class="card">${empty('Aucun match pour cette recherche.')}</section>`;
  let match=matches.find((item)=>item.id===state.selectedMatch);
  if(!match) { match=matches.find((item)=>item.league==='Ligue 1') || matches[0]; state.selectedMatch=match.id; state.shotTeam='all'; }
  if(!['all',match.home.id,match.away.id].includes(state.shotTeam)) state.shotTeam='all';
  const appearances=data.appearances.filter((row)=>row.matchId===match.id && isNumber(row.minutes) && row.minutes>0);
  const matchLeaders=sortRows(appearances,'rating','desc').filter((row)=>isNumber(row.rating)).slice(0,5);
  return `<div class="match-explorer"><aside class="card match-selector" aria-label="Sélection du match"><div class="match-selector-heading">${matches.length} matchs à explorer</div>${matches.map((item)=>`<button class="match-option" data-select-match="${esc(item.id)}" aria-pressed="${item.id===match.id}"><span class="match-option-meta">${esc(item.league)}<span>${date(item.date)}</span></span><span class="match-option-team"><span>${avatar(item.home.name,'crest club-crest',item.home.imageUrl)}${esc(item.home.name)}</span><strong>${fmt(item.home.score)}</strong></span><span class="match-option-team"><span>${avatar(item.away.name,'crest club-crest',item.away.imageUrl)}${esc(item.away.name)}</span><strong>${fmt(item.away.score)}</strong></span>${!item.coverage.shots?'<span class="match-option-note">Statistiques partielles</span>':''}</button>`).join('')}</aside>
  <div class="match-detail"><section class="card"><div class="match-detail-meta"><span class="eyebrow">${esc(match.league)} · ${esc(match.season)}</span><span>${date(match.timeUtc,{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})} · Paris</span></div><div class="scoreboard"><div class="scoreboard-team">${avatar(match.home.name,'team-initials crest',match.home.imageUrl)}<h2>${esc(match.home.name)}</h2><span>Domicile${match.home.formation?` · ${esc(match.home.formation)}`:''}</span></div><div class="scoreboard-score"><strong>${fmt(match.home.score)}<span>:</span>${fmt(match.away.score)}</strong><span class="badge badge-neutral">Terminé</span></div><div class="scoreboard-team">${avatar(match.away.name,'team-initials crest',match.away.imageUrl)}<h2>${esc(match.away.name)}</h2><span>Extérieur${match.away.formation?` · ${esc(match.away.formation)}`:''}</span></div></div><div class="scoreboard-xg"><span>xG <strong>${fmt(match.home.xg,2)}</strong></span><span>Buts attendus · agrégats d’équipe</span><span><strong>${fmt(match.away.xg,2)}</strong> xG</span></div></section>
    ${match.warnings.length?notice('Couverture à prendre en compte',match.warnings.map(esc).join(' '),'notice-warning'):''}
    <section class="card">${cardHeader('Les occasions, en détail','Explorez la position des tirs et leur qualité estimée.',`<div class="segmented-control" aria-label="Visualisation des tirs"><button data-match-chart="map" aria-pressed="${state.matchChart==='map'}">Carte des tirs</button><button data-match-chart="timeline" aria-pressed="${state.matchChart==='timeline'}">Fil des xG</button></div>`)}<div class="shot-toolbar"><span class="table-hint">${match.coverage.shots ? `${match.shots.length} événements de tir renseignés` : "Données de tirs indisponibles"}</span><select id="shot-team" aria-label="Équipe sur le graphique des tirs"><option value="all" ${state.shotTeam==='all'?'selected':''}>Les deux équipes</option><option value="${esc(match.home.id)}" ${state.shotTeam===match.home.id?'selected':''}>${esc(match.home.name)}</option><option value="${esc(match.away.id)}" ${state.shotTeam===match.away.id?'selected':''}>${esc(match.away.name)}</option></select></div><div class="card-body"><div class="chart-container ${state.matchChart==='map'?'shotmap':''}">${state.matchChart==='map'?shotMap(match,{teamId:state.shotTeam}):xgTimeline(match,{teamId:state.shotTeam})}</div></div></section>
    <div class="dashboard-grid"><section class="card span-7">${cardHeader('Les chiffres du match','Valeurs des équipes, sur l’ensemble du match.')}<div class="card-body stat-comparison">${comparisonRows(match)}</div></section><section class="card span-5">${cardHeader('Les joueurs du match','Notes individuelles du fournisseur PitchAPI.')}<div class="leaderboard">${matchLeaders.length?matchLeaders.map((row)=>`<button class="leader-row" data-open-player="${esc(row.id)}">${avatar(row.name,'player-avatar',row.imageUrl)}<span class="player-copy"><span class="player-name">${esc(row.name)}</span><span class="player-meta">${esc(row.team)} · ${fmt(row.minutes)} min</span></span>${rating(row.rating)}</button>`).join(''):'<div class="chart-empty">Les notes individuelles ne sont pas renseignées pour ce match.</div>'}</div><div class="card-footer"><button class="inline-link" data-match-players="${esc(match.id)}">Voir les joueurs ${icon('arrow',16)}</button></div></section></div>
    ${explorer.renderMatchData(match)}
  </div></div>`;
}

function comparisonRows(match) {
  const additional=(key,side)=>match.stats.find((stat)=>stat.key===key)?.[side] ?? null;
  const metrics=[['Possession',match.home.possession,match.away.possession,0,'%'],['Tirs',match.home.shots,match.away.shots,0,''],['Tirs cadrés',match.home.shotsOnTarget,match.away.shotsOnTarget,0,''],['xG',match.home.xg,match.away.xg,2,''],['Interceptions',additional('interceptions','home'),additional('interceptions','away'),0,''],['Passes réussies',additional('accurate_passes','home'),additional('accurate_passes','away'),0,'']];
  return metrics.map(([label,home,away,digits,suffix])=>{
    const valid=isNumber(home)&&isNumber(away), sum=valid?home+away:0, share=sum>0?home/sum*100:50;
    return `<div class="stat-comparison-row"><div class="stat-comparison-values"><strong>${fmt(home,digits)}${isNumber(home)?suffix:''}</strong><span>${label}</span><strong>${fmt(away,digits)}${isNumber(away)?suffix:''}</strong></div><div class="comparison-track${!valid?' comparison-missing':''}">${valid&&sum>0?`<span class="comparison-fill" style="width:${share}%"></span>`:''}</div></div>`;
  }).join('');
}

function methodView() {
  const sampleLeagues=data.competitions.filter((league)=>league.sampleMatches>0);
  const catalogScope=state.catalogAll?data.competitions:sampleLeagues;
  const catalogQuery=normalizeText(state.catalogQuery).trim();
  const leagues=catalogScope.filter(league=>!catalogQuery||normalizeText(`${league.name} ${league.country}`).includes(catalogQuery));
  const availability=(value,label)=>`<span class="availability ${value?'availability-yes':'availability-no'}" title="${label}: ${value?'données présentes':'non renseigné'}">${value?icon('check',15):'—'}<span class="sr-only">${value?'Présent':'Absent'}</span></span>`;
  return `<section class="metric-grid">${metric('Matchs collectés',fmt(data.meta.matchCount),`${date(data.meta.startDate)} – ${date(data.meta.endDate)}`,'pitch')}${metric('Compétitions observées',fmt(data.meta.sampleCompetitionCount),`Sur ${data.meta.catalogCount} au catalogue`,'globe')}${metric('Notes individuelles',fmt(data.meta.ratedAppearanceCount),`Sur ${data.meta.appearanceCount} apparitions avec du temps de jeu`,'players')}${metric('xG des événements',`${data.meta.knownShotXgCount}<span class="metric-denominator"> / ${data.meta.shotCount}</span>`,'Un but contre son camp sans xG','target')}</section>
    ${explorer.renderConnection()}<div class="dashboard-grid"><section class="card span-12">${cardHeader('La couverture, compétition par compétition','Présence d’au moins une valeur dans le match collecté ; cela ne garantit pas sa disponibilité pour chaque joueur.',`<button class="button button-secondary" data-toggle-catalog>${state.catalogAll?'Les 9 compétitions observées':`Voir le catalogue (${data.meta.catalogCount})`}</button>`)}<div class="table-toolbar"><div class="search-field catalog-search"><span aria-hidden="true">${icon('search',16)}</span><input id="catalog-search" type="search" value="${esc(state.catalogQuery)}" placeholder="Pays ou compétition…" aria-label="Rechercher dans le catalogue" autocomplete="off"></div><span class="table-hint">${leagues.length} compétition${leagues.length>1?'s':''} affichée${leagues.length>1?'s':''}</span></div><div class="table-scroll" tabindex="0" role="region" aria-label="Couverture des compétitions"><table class="data-table coverage-table"><thead><tr><th scope="col">Compétition</th><th scope="col">Pays</th><th scope="col" class="numeric">Matchs</th><th scope="col">Fiches joueurs</th><th scope="col">Tirs</th><th scope="col">xG individuels</th><th scope="col">Notes</th><th scope="col">État</th></tr></thead><tbody>${leagues.map((league)=>{
      const matches=data.matches.filter((match)=>match.leagueId===league.id), found=matches.length>0, warned=matches.some((match)=>match.warnings.length);
      return `<tr><td><strong>${esc(league.name)}</strong></td><td><span class="country-code">${esc(league.country)}</span></td><td class="numeric">${league.sampleMatches}</td>${['players','shots','xg','ratings'].map((key)=>`<td>${availability(matches.some((match)=>match.coverage[key]),key)}</td>`).join('')}<td><span class="badge ${!found?'badge-neutral':warned?'badge-warning':'badge-success'}">${!found?'Non collecté':warned?'Partiel':'Collecté'}</span></td></tr>`;
    }).join('') || '<tr><td colspan="8">Aucune compétition ne correspond à cette recherche.</td></tr>'}</tbody></table></div><div class="card-footer"><span>77 compétitions au catalogue ne signifient pas 77 compétitions collectées.</span><a class="inline-link" href="${REPO}/blob/main/docs/PITCHAPI.md" target="_blank" rel="noopener noreferrer">Documentation des données ${icon('external',14)}</a></div></section>
    <div class="span-12">${notice('Des absences explicites',`Les données de tirs de 3. Liga sont absentes ; les zéros suspects des statistiques d’action sont masqués. Un <strong>—</strong> signifie « non renseigné », jamais zéro. Les rôles ne sont pas déduits des identifiants de poste non documentés.`)}</div>
    <section class="card span-12 method-intro">${cardHeader('Le futur classement Orion','Comparer l’excellence dans chaque rôle, puis l’agréger sur la saison.','<span class="badge badge-neutral">Méthode documentée · à valider</span>')}<div class="card-body"><div class="method-grid">${[
      ['01','Contextualiser','Tenir compte du temps de jeu, du rôle et de la force des équipes avant chaque match.','Le contexte précède la note.'],
      ['02','Mesurer l’écart','Comparer la statistique observée à une référence attendue, puis standardiser cet écart.','c = sens × (observé − attendu) / dispersion'],
      ['03','Pondérer par rôle','Combiner finition, création, progression, défense et conservation. Les gardiens ont leurs propres dimensions.','Contribution = Σ poids × écart standardisé'],
      ['04','Agréger la saison','Associer contribution cumulée et niveau par 90 minutes régularisé, dans un univers éligible.','Score proposé = 75 % volume + 25 % taux¹']
    ].map(([step,title,copy,formula])=>`<article class="method-step"><span class="step-number">${step}</span><h3>${title}</h3><p>${copy}</p><div class="formula">${formula}</div></article>`).join('')}</div><p class="method-footnote">¹ Les deux composantes sont des percentiles calculés par rôle. Le taux proposé est 90 × contribution cumulée / (minutes + λ). Les poids, λ et les seuils d’éligibilité sont des hypothèses à tester.</p></div><div class="card-footer"><span>Aucun score Orion n’est calculé dans cet explorateur.</span><a class="inline-link" href="${REPO}/blob/main/docs/METHODE_CLASSEMENT_BALLON_D_OR.md" target="_blank" rel="noopener noreferrer">Lire la méthode complète ${icon('external',14)}</a></div></section>
    <section class="card span-7">${cardHeader('Des données aux décisions','Trois repères pour interpréter les vues.')}<div class="card-body reading-guide"><div><span class="guide-marker">01</span><p><strong>Une apparition, une observation.</strong><br>Les vues décrivent les matchs collectés. Elles ne mesurent pas une saison complète.</p></div><div><span class="guide-marker">02</span><p><strong>La note a une source.</strong><br>La note sur 10 est fournie par PitchAPI. Elle ne correspond pas au futur score Orion.</p></div><div><span class="guide-marker">03</span><p><strong>Le volume a un contexte.</strong><br>Le mode par 90 facilite la lecture, mais les courtes apparitions restent très variables.</p></div></div></section>
    <section class="card span-5">${cardHeader('Provenance & actualisation','Un instantané traçable du projet.')}<div class="card-body source-list"><div><span>Fournisseur</span><strong>PitchAPI</strong></div><div><span>Extraction</span><strong>${date(data.meta.retrievedAt,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} · Paris</strong></div><div><span>Période observée</span><strong>${date(data.meta.startDate)} — ${date(data.meta.endDate)}</strong></div><div><span>Saisons présentes</span><strong>${data.meta.seasons.map(esc).join(' · ')}</strong></div><p>L’instantané du dépôt reste disponible. Une fois la connexion PitchAPI activée, les saisons et les données détaillées se chargent à la demande dans l’explorateur.</p><a class="inline-link" href="${REPO}/tree/main/data" target="_blank" rel="noopener noreferrer">Consulter les fichiers sources ${icon('external',14)}</a></div></section>
    </div>`;
}

function detailStats(row,items) {
  return `<div class="detail-grid">${items.map(([key,label,digits=0])=>`<div class="detail-stat"><span class="detail-label">${label}</span><strong class="detail-value">${fmt(row[key],digits)}</strong></div>`).join('')}</div>`;
}

function openPlayer(id) {
  const row=byAppearance.get(id); if(!row) return;
  const match=byMatch.get(row.matchId);
  $('#dialog-content').innerHTML=`<div class="modal-header"><div class="player-detail-heading">${avatar(row.name,'player-avatar',row.imageUrl)}<div><div class="eyebrow">FICHE DE PERFORMANCE</div><h2 id="dialog-title">${esc(row.name)}</h2><p>${esc(row.team)} · ${esc(row.league)}</p></div></div><button class="button button-icon button-ghost modal-close" data-close-dialog aria-label="Fermer la fiche">${icon('close')}</button></div><div class="modal-body"><div class="player-match-context"><span>${esc(match.home.name)} <strong>${match.home.score}–${match.away.score}</strong> ${esc(match.away.name)}</span><span>${date(match.date,{day:'numeric',month:'long',year:'numeric'})}</span></div><div class="player-detail-summary"><div><span>Temps de jeu</span><strong>${fmt(row.minutes)} <small>min</small></strong></div><div><span>Note PitchAPI</span>${rating(row.rating)}</div><div><span>Participation</span><strong class="participation-label">${row.starter===true?'Titulaire':isNumber(row.minutes)&&row.minutes>0?'Entré en jeu':row.starter===false?'Banc':'Non renseignée'}</strong></div></div>${!row.statsReliable?notice('Statistiques partielles','Les valeurs d’action suspectes de ce match sont masquées.','notice-warning'):''}<h3 class="detail-section-title">Attaque & création</h3>${detailStats(row,[['goals','Buts'],['assists','Passes décisives'],['xg','xG',2],['xa','xA',2],['shots','Tirs'],['chancesCreated','Occasions créées']])}<h3 class="detail-section-title">Avec et sans le ballon</h3>${detailStats(row,[['passesAccurate','Passes réussies'],['passesAttempted','Passes tentées'],['touches','Ballons touchés'],['defensiveActions','Actions défensives'],['interceptions','Interceptions'],['duelsWon','Duels gagnés']])}${isNumber(row.saves)||isNumber(row.goalsPrevented)?`<h3 class="detail-section-title">Arrêts & buts évités</h3>${detailStats(row,[['saves','Arrêts'],['goalsPrevented','Buts évités',2]])}<p class="detail-footnote">Indicateurs du fournisseur PitchAPI, sans recalcul Orion.</p>`:''}<p class="detail-footnote">Données du match · valeurs absentes : — · rôle non interprété sans correspondance validée.</p><div class="dialog-actions"><button class="button button-secondary" data-player-full="${esc(row.playerId)}" data-player-match="${esc(row.matchId)}">Toutes les statistiques ${icon('arrow',16)}</button><button class="button button-secondary" data-add-compare="${esc(row.id)}">${icon('compare',16)} ${state.compare.includes(row.id)?'Retirer de la comparaison':'Comparer ce joueur'}</button><button class="button button-primary" data-open-match="${esc(match.id)}">Explorer le match ${icon('arrow',16)}</button></div></div>`;
  if(!$('#detail-dialog').open) $('#detail-dialog').showModal();
}

function renderCompareTray() {
  const tray=$('#compare-tray'); tray.hidden=!state.compare.length;
  if(!state.compare.length) return;
  tray.innerHTML=`<span class="compare-tray-label">${icon('compare')} Comparer <strong>${state.compare.length}/3</strong></span><div class="compare-pills">${state.compare.map((id)=>{const row=byAppearance.get(id);return `<span class="compare-pill">${esc(row.name)}<button data-remove-compare="${esc(id)}" aria-label="Retirer ${esc(row.name)}">${icon('close',13)}</button></span>`;}).join('')}</div><button class="button button-primary" data-open-compare ${state.compare.length<2?'disabled':''}>Comparer ${icon('arrow',16)}</button><button class="button button-icon button-ghost" data-clear-compare aria-label="Vider la comparaison">${icon('close',16)}</button>`;
}

function toggleCompare(id,forceRemove=false) {
  if(!byAppearance.has(id)) return;
  if(state.compare.includes(id)) state.compare=state.compare.filter((item)=>item!==id);
  else if(!forceRemove) {
    if(state.compare.length>=3) { toast('Vous pouvez comparer jusqu’à 3 joueurs.'); document.querySelectorAll('[data-compare]').forEach((el)=>el.checked=state.compare.includes(el.dataset.compare)); return; }
    state.compare.push(id);
  }
  renderCompareTray();
  document.querySelectorAll('[data-compare]').forEach((el)=>el.checked=state.compare.includes(el.dataset.compare));
}

function openComparison() {
  if(state.compare.length<2) return;
  const rows=state.compare.map((id)=>byAppearance.get(id));
  const metrics=[['minutes','Minutes',0],['rating','Note PitchAPI',2],['goals','Buts',0],['assists','Passes décisives',0],['xg','xG',2],['xa','xA',2],['shots','Tirs',0],['chancesCreated','Occasions créées',0],['passesAccurate','Passes réussies',0],['touches','Ballons touchés',0],['defensiveActions','Actions défensives',0],['interceptions','Interceptions',0],['duelsWon','Duels gagnés',0],['saves','Arrêts',0],['goalsPrevented','Buts évités (PitchAPI)',2]];
  $('#dialog-content').innerHTML=`<div class="modal-header"><div><div class="eyebrow">COMPARAISON DE PERFORMANCES</div><h2 id="dialog-title">Côte à côte.</h2><p>Valeurs brutes par apparition, sur les matchs sélectionnés.</p></div><button class="button button-icon button-ghost modal-close" data-close-dialog aria-label="Fermer la comparaison">${icon('close')}</button></div><div class="modal-body"><div class="table-scroll" tabindex="0" role="region" aria-label="Comparaison des joueurs"><table class="data-table comparison-table"><thead><tr><th scope="col">Indicateur</th>${rows.map((row)=>`<th scope="col">${avatar(row.name,'player-avatar',row.imageUrl)}<strong>${esc(row.name)}</strong><span>${esc(row.team)}<br>${date(row.date)}</span></th>`).join('')}</tr></thead><tbody>${metrics.map(([key,label,digits])=>`<tr><th scope="row">${label}</th>${rows.map((row)=>`<td class="numeric">${key==='rating'?rating(row[key]):numberCell(row[key],digits)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="view-footnote">${notice('Les chiffres se lisent avec leur contexte','Le temps de jeu, le rôle et le niveau de l’adversaire diffèrent. Ces valeurs ne constituent pas un classement ajusté.')}</div></div>`;
  if(!$('#detail-dialog').open) $('#detail-dialog').showModal();
}

function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').hidden=false;
  toastTimer=setTimeout(()=>$('#toast').hidden=true,3500);
}

function exportRows() {
  const rows=sortRows(currentRows(),state.sort,state.direction,state.mode);
  const keys=['name','team','league','season','date','minutes','rating','goals','assists','xg','xa','shots','chancesCreated','defensiveActions','saves','goalsPrevented'];
  const headers=['Joueur','Club','Compétition','Saison','Date','Minutes','Note PitchAPI /10','Buts','Passes décisives','xG','xA','Tirs','Occasions créées','Actions défensives','Arrêts','Buts évités (PitchAPI)'];
  if(state.mode==='per90') for(let i=7;i<headers.length;i++) headers[i]+=' /90';
  const csv=csvString(headers,rows.map((row)=>keys.map((key,index)=>state.mode==='per90'&&index>=7?per90(row[key],row.minutes):row[key])));
  const href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  const link=document.createElement('a'); link.href=href; link.download=`orion-performances-${state.mode==='per90'?'par90-':''}${data.meta.endDate}.csv`; document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(href),1000);
  toast(`${rows.length} apparitions exportées. Les données manquantes restent vides.`);
}

function changePage(page) {
  if(!PAGES.includes(page)) return;
  state.page=page; if($('#detail-dialog').open) $('#detail-dialog').close(); render(); window.scrollTo({top:0,behavior:'instant'});
}
function resetFilters() {
  state.filters={...defaults}; state.tablePage=1;
  $('#search-input').value=''; $('#league-filter').value='all'; $('#season-filter').value='all'; $('#minutes-filter').value='1'; render();
}

function syncFilterInputs() {
  $('#search-input').value=state.filters.query;
  $('#league-filter').value=state.filters.league;
  $('#season-filter').value=state.filters.season;
  $('#minutes-filter').value=String(state.filters.minutes);
}

document.addEventListener('click',(event)=>{
  const target=event.target.closest('button, a, [data-open-player]'); if(!target || !data) return;
  const d=target.dataset;
  if(explorer?.handleClick(target)) return;
  if(d.page) changePage(d.page);
  else if(d.openPlayer) openPlayer(d.openPlayer);
  else if(d.openMatch) { const match=byMatch.get(d.openMatch); if(!match)return; state.filters={...defaults}; syncFilterInputs(); state.selectedMatch=d.openMatch; state.shotTeam='all'; changePage('matches'); }
  else if(d.selectMatch) { state.selectedMatch=d.selectMatch; state.shotTeam='all'; render(); }
  else if(d.matchPlayers) { const match=byMatch.get(d.matchPlayers); state.filters={...defaults,league:match.leagueId,season:match.season,match:match.id}; syncFilterInputs(); state.tablePage=1; changePage('players'); }
  else if('clearMatch' in d) { state.filters.match='all'; state.tablePage=1; render(); }
  else if(d.scatter) { state.scatter=d.scatter; render(); }
  else if(d.leaders) { state.leaders=d.leaders; render(); }
  else if(d.sort) { state.direction=state.sort===d.sort&&state.direction==='desc'?'asc':'desc'; if(d.sort==='name'&&state.sort!=='name') state.direction='asc'; state.sort=d.sort; state.tablePage=1; render(); }
  else if(d.mode) { state.mode=d.mode; state.tablePage=1; render(); }
  else if(d.tablePage) { state.tablePage=Number(d.tablePage); render(); }
  else if(d.matchChart) { state.matchChart=d.matchChart; render(); }
  else if('toggleCatalog' in d) { state.catalogAll=!state.catalogAll; render(); }
  else if('closeDialog' in d) $('#detail-dialog').close();
  else if(d.addCompare) { toggleCompare(d.addCompare); openPlayer(d.addCompare); }
  else if(d.removeCompare) toggleCompare(d.removeCompare,true);
  else if('openCompare' in d) openComparison();
  else if('clearCompare' in d) { state.compare=[]; renderCompareTray(); document.querySelectorAll('[data-compare]').forEach((el)=>el.checked=false); }
  else if('reset' in d) resetFilters();
});

document.addEventListener('change',(event)=>{
  if(!data) return;
  if(explorer?.handleChange(event.target)) return;
  if(event.target.matches('[data-compare]')) { toggleCompare(event.target.dataset.compare); return; }
  if(event.target.id==='shot-team') { state.shotTeam=event.target.value; render(); return; }
  const key={'league-filter':'league','season-filter':'season','minutes-filter':'minutes'}[event.target.id];
  if(key) { state.filters[key]=event.target.value; if(key==='league'||key==='season')state.filters.match='all'; state.tablePage=1; render(); }
});
document.addEventListener('input',(event)=>{
  if(explorer?.handleInput(event.target)) return;
  if(data && event.target.id==='catalog-search') {
    const cursor=event.target.selectionStart; state.catalogQuery=event.target.value; render();
    const field=$('#catalog-search'); field.focus({preventScroll:true}); field.setSelectionRange(cursor,cursor);
  }
});
$('#search-input').addEventListener('input',(event)=>{if(data){state.filters.query=event.target.value;state.tablePage=1;render();}});
$('#reset-filters').addEventListener('click',resetFilters);
$('#export-button').addEventListener('click',()=>{if(data) exportRows();});
$('#detail-dialog').addEventListener('click',(event)=>{if(event.target===$('#detail-dialog')) {const rect=event.target.getBoundingClientRect(); if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) event.target.close();}});
document.addEventListener('keydown',(event)=>{
  if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)&&!$('#detail-dialog').open&&!['method','competitions','clubs'].includes(state.page)){event.preventDefault();$('#search-input').focus();}
  if(['Enter',' '].includes(event.key)&&event.target.matches('svg [data-open-player]')) {event.preventDefault();if(!explorer?.handleClick(event.target))openPlayer(event.target.dataset.openPlayer);}
});
window.addEventListener('hashchange',()=>{const page=location.hash.slice(1);if(data&&PAGES.includes(page)&&page!==state.page) changePage(page);});

async function init() {
  $('#search-icon').innerHTML=icon('search'); $('#export-button').innerHTML=`${icon('download',16)} Exporter les données`;
  try {
    const response=await fetch(new URL('./data/football.json',import.meta.url));
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    data=await response.json();
    if(!Array.isArray(data.appearances)||!Array.isArray(data.matches)||!data.meta) throw new Error('Format de données invalide');
    byAppearance=new Map(data.appearances.map((row)=>[row.id,row])); byMatch=new Map(data.matches.map((match)=>[match.id,match]));
    const leagues=data.competitions.filter((league)=>league.sampleMatches>0).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
    $('#league-filter').innerHTML='<option value="all">Toutes les compétitions</option>'+leagues.map((league)=>`<option value="${esc(league.id)}">${esc(league.name)}</option>`).join('');
    $('#season-filter').innerHTML='<option value="all">Toutes les saisons</option>'+data.meta.seasons.map((season)=>`<option value="${esc(season)}">${esc(season)}</option>`).join('');
    const params=new URLSearchParams(location.search);
    state.filters.query=params.get('q')||'';
    if(leagues.some((league)=>league.id===params.get('league'))) state.filters.league=params.get('league');
    if(data.meta.seasons.includes(params.get('season'))) state.filters.season=params.get('season');
    if(['0','1','30','60','90'].includes(params.get('minutes'))) state.filters.minutes=Number(params.get('minutes'));
    if(byMatch.has(params.get('match'))) state.selectedMatch=params.get('match');
    const initialPage=location.hash.slice(1); if(PAGES.includes(initialPage)) state.page=initialPage;
    if(state.page!=='matches' && byMatch.has(params.get('match'))) state.filters.match=params.get('match');
    $('#search-input').value=state.filters.query; $('#league-filter').value=state.filters.league; $('#season-filter').value=state.filters.season; $('#minutes-filter').value=String(state.filters.minutes);
    $('#snapshot-label').innerHTML=`${icon('calendar',15)} ${date(data.meta.retrievedAt,{day:'numeric',month:'short',year:'numeric'})}`;
    $('#export-button').disabled=false;
    explorer=new PitchExplorer({data,redraw:()=>render(),navigate:changePage,openLocalMatch:(id)=>{state.filters={...defaults};syncFilterInputs();state.selectedMatch=id;state.shotTeam='all';changePage('matches');}});
    render();
    explorer.init();
  } catch(error) {
    console.error('Chargement du dashboard impossible',error);
    $('#content').innerHTML=`<section class="card"><div class="empty-state">${icon('info',30)}<h2>Données indisponibles</h2><p>Le fichier de l’échantillon n’a pas pu être chargé. Rechargez la page ou vérifiez la construction du dashboard.</p><button class="button button-primary" id="retry-load">Réessayer</button></div></section>`;
    $('#retry-load').addEventListener('click',init);
    $('#export-button').disabled=true;
  }
}
init();
