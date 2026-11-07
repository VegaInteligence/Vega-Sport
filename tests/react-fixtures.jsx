// The existing rendering regression fixtures now exercise JSX via React SSR.
// There is no production HTML generator or compatibility renderer.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ScatterPlot,ShotMap,XgTimeline} from '../dashboard/frontend/src/components/Charts.jsx';
import {Media,StructuredData} from '../dashboard/frontend/src/components/UI.jsx';
import {SectionContent,PlayerStats,Shots,Events,Momentum,Heatmap,PassNetworks} from '../dashboard/frontend/src/components/MatchSections.jsx';
import {MatchLink} from '../dashboard/frontend/src/components/MatchLink.jsx';
import {SupplementalPanel} from '../dashboard/frontend/src/views/CompetitionsPage.jsx';
import {FootballContext} from '../dashboard/frontend/src/hooks/FootballContext.jsx';
import {FootballDataClient} from '../dashboard/frontend/src/services/football-client.js';
export {MATCH_SECTIONS,rawPlayerMetrics,safeImageUrl} from '../dashboard/frontend/src/services/format.js';
function serialize(element,client){return renderToStaticMarkup(<FootballContext.Provider value={{href:(path,params={})=>path+'?'+new URLSearchParams(params),client}}>{element}</FootballContext.Provider>);}
export const scatterPlot=(appearances,options={})=>serialize(<ScatterPlot appearances={appearances} {...options}/>);
export const shotMap=(match,options={})=>serialize(<ShotMap match={match} {...options}/>);
export const xgTimeline=(match,options={})=>serialize(<XgTimeline match={match} {...options}/>);
export const media=(name,url,className)=>serialize(<Media name={name} url={url} className={className}/>);
export const structuredData=value=>serialize(<StructuredData value={value}/>);
export class PitchExplorer extends FootballDataClient{
 constructor(options){super(options);this.playerSelection=new Map();this.heatSelection=new Map();this.periodSelection=new Map();}
 renderPayload(match,section,payload){return serialize(<SectionContent match={match} section={section} payload={payload} initialPlayer={this.playerSelection.get(match.id+':'+section)} initialPeriod={this.periodSelection.get(match.id+':'+section)} initialSelection={this.heatSelection.get(match.id)}/>,this);}
 playerStats(match,payload,section){return this.renderPayload(match,section,payload);}
 shots(match,payload){return serialize(<Shots match={match} payload={payload}/>);}
 events(payload){return serialize(<Events payload={payload}/>);}
 momentum(match,payload){return serialize(<Momentum match={match} payload={payload}/>);}
 heatmaps(match,payload){return serialize(<Heatmap match={match} payload={payload} initialSelection={this.heatSelection.get(match.id)}/>);}
 networks(payload){return serialize(<PassNetworks payload={payload}/>);}
 fixtureRow(match){return serialize(<MatchLink match={match}/>,this);}
 headToHead(payload){return this.renderPayload(this.data.matches[0],'h2h',payload);}
 renderSupplemental(){return serialize(<SupplementalPanel data={this.supplementalData} id={this.supplementalCompetition} kind={this.supplementalTab||'results'}/>);}
 handleClick({dataset}){if(dataset.supplementalCompetition)this.supplementalCompetition=dataset.supplementalCompetition;if(dataset.supplementalTab)this.supplementalTab=dataset.supplementalTab;}
}

import PlayerSearchResults from '../dashboard/frontend/src/components/PlayerSearchResults.jsx';
import PlayerSeasonProfile from '../dashboard/frontend/src/components/PlayerSeasonProfile.jsx';
import {loadPlayerHonours} from '../dashboard/frontend/src/services/player-honours.js';
import {primeResource} from '../dashboard/frontend/src/services/resources.js';
import {ResearchRadar} from '../dashboard/frontend/src/components/ResearchCharts.jsx';
export const renderResearchRadar=(axes,series)=>renderToStaticMarkup(<ResearchRadar axes={axes} series={series}/>);
export const renderSeasonSearch=(rows,query)=>renderToStaticMarkup(<FootballContext.Provider value={{rows,filters:{query},partial:false,href:(path,params={})=>path+'?'+new URLSearchParams(params)}}><PlayerSearchResults/></FootballContext.Provider>);
import {ResearchProvider} from '../dashboard/frontend/src/hooks/ResearchContext.jsx';
export const renderSeasonProfile=(rows,matches,id)=>renderToStaticMarkup(<FootballContext.Provider value={{season:'2026/2027',competitions:[],filters:{league:'all',minutes:1},focus:'all',data:{matches},setPlayer:()=>{}}}><ResearchProvider><PlayerSeasonProfile id={id} rows={rows} scopeRows={rows}/></ResearchProvider></FootballContext.Provider>);
export function seedPlayerHonours(id, name, projection) {
  return primeResource(`player-honours:${id}`, () =>
    loadPlayerHonours(id, name, async () => Response.json(projection)),
  );
}
import {historicalRows,historicalScore} from '../dashboard/frontend/src/services/openfootball-history.js';
import {ArchiveResults,ArchiveMatchDetail} from '../dashboard/frontend/src/components/Archive.jsx';
import {archiveRows,buildArchiveSeason} from '../dashboard/frontend/src/services/archive.js';
export const renderArchiveResults=(results,goals=null,competition='all',query='')=>serialize(<ArchiveResults rows={archiveRows(buildArchiveSeason(results,goals),competition,query)} page={1} onPage={()=>{}} matchHref={(match)=>'/archives/?m='+encodeURIComponent(match.key)}/>);
export const renderArchiveMatch=(match)=>serialize(<ArchiveMatchDetail match={match} backHref="/archives/"/>);
import ArchiveAttribution from '../dashboard/frontend/src/components/ArchiveAttribution.jsx';
export const renderArchiveAttribution=()=>serialize(<ArchiveAttribution/>);
