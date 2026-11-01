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
