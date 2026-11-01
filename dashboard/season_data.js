/** Load one season from independently compressed competition snapshots. */
export function mergeSeason(manifest, selected, parts) {
  const matches=[], appearances=[], fixtures=[], competitionMap=new Map(), teamMap=new Map(), ids=new Set();
  for(const part of parts){
    for(const match of part.matches||[]){if(ids.has(match.id))throw new Error(`Match dupliqué : ${match.id}`);ids.add(match.id);matches.push(match)}
    appearances.push(...(part.appearances||[]));fixtures.push(...(part.fixtures||[]));
    for(const competition of part.competitions||[]){
      const current=competitionMap.get(competition.id);
      if(!current)competitionMap.set(competition.id,{...competition,seasons:[...(competition.seasons||[])],sampleSeasons:[...(competition.sampleSeasons||[])]});
      else {current.sampleMatches+=competition.sampleMatches||0;current.seasons=[...new Set([...current.seasons,...(competition.seasons||[])])];current.sampleSeasons=[...new Set([...current.sampleSeasons,...(competition.sampleSeasons||[])])];}
    }
    for(const team of part.teams||[]){
      const current=teamMap.get(team.id);
      if(!current)teamMap.set(team.id,{...team,leagueIds:[...(team.leagueIds||[])],seasons:[...(team.seasons||[])]});
      else {current.sampleMatches+=team.sampleMatches||0;current.leagueIds=[...new Set([...current.leagueIds,...(team.leagueIds||[])])];current.seasons=[...new Set([...current.seasons,...(team.seasons||[])])];}
    }
  }
  matches.sort((a,b)=>(b.timeUtc||b.date||'').localeCompare(a.timeUtc||a.date||'')||b.id.localeCompare(a.id));
  const played=appearances.filter(p=>typeof p.minutes==='number'&&p.minutes>0), dates=matches.map(m=>m.date).filter(Boolean).sort();
  const sum=key=>parts.reduce((n,p)=>n+(p.meta?.[key]||0),0);
  const retrieved=parts.map(p=>p.meta?.retrievedAt).filter(Boolean).sort().at(-1)||null;
  const competitions=[...competitionMap.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||'','fr'));
  return {meta:{schemaVersion:2,source:'PitchAPI · archive européenne locale',retrievedAt:retrieved,currentSeason:selected,
      seasons:manifest.seasons.map(s=>s.id),matchCount:matches.length,collectedMatches:sum('collectedMatches'),
      expectedFinishedMatches:sum('expectedFinishedMatches'),playerCount:new Set(appearances.map(p=>p.playerId)).size,
      activePlayerCount:new Set(played.map(p=>p.playerId)).size,appearanceCount:played.length,listedAppearanceCount:appearances.length,
      teamCount:teamMap.size,catalogCount:competitions.length,sampleCompetitionCount:competitions.filter(c=>c.sampleMatches>0).length,
      shotCount:sum('shotCount'),knownShotXgCount:sum('knownShotXgCount'),ratedAppearanceCount:sum('ratedAppearanceCount'),
      xgAppearanceCount:sum('xgAppearanceCount'),xaAppearanceCount:sum('xaAppearanceCount'),
      startDate:dates[0]||null,endDate:dates.at(-1)||null,ratingSource:'PitchAPI',rankingAvailable:false},
    competitions,teams:[...teamMap.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||'','fr')),
    fixtures,matches,appearances,metrics:parts[0]?.metrics||[]};
}

export async function loadSeason(manifest, selected, fetcher=fetch) {
  const season=manifest.seasons.find(item=>item.id===selected);
  if(!season)throw new Error('Saison indisponible');
  const parts=new Array(season.chunks.length);let cursor=0;
  async function worker(){while(true){const index=cursor++;if(index>=season.chunks.length)return;
    const chunk=season.chunks[index],response=await fetcher(new URL(`./data/${chunk.path}`,import.meta.url));
    if(!response.ok)throw new Error(`Données de saison indisponibles (HTTP ${response.status})`);
    if(typeof DecompressionStream==='undefined')throw new Error('Ce navigateur ne peut pas décompresser les données de saison.');
    const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
    parts[index]=await new Response(stream).json();
  }}
  await Promise.all(Array.from({length:Math.min(6,season.chunks.length)},worker));
  return mergeSeason(manifest,selected,parts);
}
