import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const archive=path.join(root,'data','europe_2026_2027');
const index=JSON.parse(await fs.readFile(path.join(archive,'index.json'),'utf8'));
let collection;try{collection=JSON.parse(await fs.readFile(path.join(archive,'collection.json'),'utf8'))}catch{}
let historical,historyCollection;
try{historical=JSON.parse(await fs.readFile(path.join(root,'data','europe_2021_2026','index.json'),'utf8'))}catch{}
try{historyCollection=JSON.parse(await fs.readFile(path.join(root,'data','europe_2021_2026','collection.json'),'utf8'))}catch{}
let supplemental;try{supplemental=JSON.parse(await fs.readFile(path.join(root,'data','open_matchday_2026_2027','manifest.json'),'utf8'))}catch{}
let audit;try{audit=JSON.parse(await fs.readFile(path.join(root,'data','open_matchday_2026_2027','cross_source_audit.json'),'utf8'))}catch{}
const mappedFolders=new Set((audit?.competitions||[]).map(item=>item.folder));
const unmapped=supplemental?.competitions.filter(item=>!mappedFolders.has(item.folder))||[];
const output=path.resolve(process.argv[2]||path.join(archive,'coverage.md'));
const esc=value=>String(value??'').replaceAll('|','\\|').replaceAll('\n',' ');
const otherTotal=index.fixtures-index.finished;
const currentComplete=index.finished===index.downloaded && !index.incomplete && index.other_fixtures_downloaded===otherTotal && !index.other_fixtures_incomplete && collection && !collection.profiles.failed;
const historyComplete=historical && historical.finished===historical.downloaded && !historical.incomplete && historical.other_fixtures_downloaded===historical.fixtures-historical.finished && !historical.other_fixtures_incomplete && historyCollection && !historyCollection.profiles.failed;
const complete=currentComplete&&historyComplete;
const scopeYears=historyCollection?.scope_years;
const scopedRows=Array.isArray(scopeYears)?(historical?.competition_summaries||[]).filter(c=>scopeYears.includes(String(c.season).slice(0,4))):[];
const scopedFinished=scopedRows.reduce((n,c)=>n+c.finished,0),scopedDownloaded=scopedRows.reduce((n,c)=>n+c.downloaded,0);
const scopedOther=scopedRows.reduce((n,c)=>n+c.fixtures-c.finished,0),scopedOtherDownloaded=scopedRows.reduce((n,c)=>n+c.other_downloaded,0);
const scopedComplete=Boolean(scopeYears?.length && currentComplete && historyCollection?.profiles_collected && !historyCollection.incomplete && !historyCollection.other_fixtures?.incomplete && !historyCollection.profiles?.failed && scopedFinished===scopedDownloaded && scopedOther===scopedOtherDownloaded);
const historySeasons=new Map();
for(const c of historical?.competition_summaries||[]){const label=/^\d{4}$/.test(c.season)?`${c.season}/${Number(c.season)+1}`:c.season;const row=historySeasons.get(label)||{pairs:0,finished:0,downloaded:0,players:0,shots:0};row.pairs++;row.finished+=c.finished;row.downloaded+=c.downloaded;row.players+=c.matches_with_players||0;row.shots+=c.shots||0;historySeasons.set(label,row)}
const lines=[
  '# European football data — 2021/22 through 2026/27', '',
  `Status: **${complete?'collection complete for this inventory':scopedComplete?`requested scope ${scopeYears.map(y=>`${y}/${Number(y)+1}`).join(', ')} complete; older seasons remain incomplete`:'collection in progress or incomplete'}**.`, '',
  `Inventory retrieved: ${index.inventory_at_utc}. Coverage calculated: ${index.generated_at_utc}.`, '',
  `- Competitions: ${index.competitions}; fixtures: ${index.fixtures}.`,
  `- Finished matches archived: ${index.downloaded}/${index.finished}; incomplete match records: ${index.incomplete}.`,
  `- Other fixture details archived: ${index.other_fixtures_downloaded}/${otherTotal}; incomplete: ${index.other_fixtures_incomplete}.`,
  `- Other fixtures with at least one listed lineup: ${index.other_fixtures_with_lineups??'not indexed'}; with at least one predicted lineup: ${index.other_fixtures_with_predicted_lineups??'not indexed'}; with at least one confirmed lineup: ${index.other_fixtures_with_confirmed_lineups??'not indexed'}.`,
  `- Player match rows: ${index.player_rows}; shot events: ${index.shots}.`,
  `- Finished matches with player rows: ${index.matches_with_players??'not indexed'}/${index.downloaded}.`,
  `- Shot events with xG: ${index.known_shot_xg??'not indexed'}/${index.shots}; with xG on target: ${index.known_shot_xgot??'not indexed'}/${index.shots}.`,
  `- Finished matches with no shot-period list: ${index.missing_shots}; missing or suspicious shot lists: ${index.suspect_zero_shots}.`,
  `- Profiles checked: ${collection?`${collection.profiles.leagues} competitions, ${collection.profiles.teams} teams, ${collection.profiles.players} players; ${collection.profiles.unavailable} unavailable, ${collection.profiles.restricted??0} restricted by the current key, and ${collection.profiles.failed} failed`:index.profiles?.provisional?`${index.profiles.leagues} competition, ${index.profiles.teams} team and ${index.profiles.players} player responses saved; status counts pending`:'not yet finalized'}.`,
  '',
  'The raw archive retains provider responses, including nulls and error statuses. A successful HTTP response does not guarantee that every statistic is present. Future lineups may be predictions.', '',
  ...(historical?[
    '## PitchAPI historical seasons', '',
    `Inventory retrieved: ${historical.inventory_at_utc}; ${historical.competitions} competition-season pairs.`,
    `Detailed finished matches: ${historical.downloaded}/${historical.finished}; incomplete records: ${historical.incomplete}.`,
    `Other fixture details: ${historical.other_fixtures_downloaded}/${historical.fixtures-historical.finished}.`, '',
    'Calendar-year competitions are grouped under the season beginning in the same year; their original source season is preserved in the raw records.', '',
    '| Season label | Competition-season pairs | Finished match details | Matches with player rows | Shot events |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...[...historySeasons.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([label,c])=>`| ${esc(label)} | ${c.pairs} | ${c.downloaded}/${c.finished} | ${c.players} | ${c.shots} |`), '',
    '| Country | Competition | Original source season | Detailed matches | Matches with player rows | Shots with xG |',
    '| --- | --- | --- | ---: | ---: | ---: |',
    ...historical.competition_summaries.map(c=>`| ${esc(c.country_code)} | ${esc(c.name)} | ${esc(c.season)} | ${c.downloaded}/${c.finished} | ${c.matches_with_players??0} | ${c.known_shot_xg??0}/${c.shots??0} |`), ''
  ]:[]),
  ...(supplemental?[
    '## Supplemental source: open-matchday', '',
    `Source snapshot generated: ${supplemental.source_generated_at_utc}; retrieved: ${supplemental.retrieved_at_utc}.`, '',
    `${supplemental.competitions.length} European competitions; ${supplemental.competitions.reduce((n,c)=>n+(c.files.results?.rows||0),0)} result rows, ${supplemental.competitions.reduce((n,c)=>n+(c.files.fixtures?.rows||0),0)} fixture rows and ${supplemental.competitions.reduce((n,c)=>n+(c.files.goals?.rows||0),0)} goal rows. These overlap PitchAPI and are not unique additional matches.`, '',
    ...(audit?[`${mappedFolders.size} competitions have an explicit PitchAPI mapping; ${unmapped.length} are not mapped (${unmapped.reduce((n,c)=>n+(c.files.results?.rows||0),0)} result rows and ${unmapped.reduce((n,c)=>n+(c.files.fixtures?.rows||0),0)} fixture rows).`, '']:[]),
    'This source supplies match-level data rather than player xG or goalkeeper statistics. Coverage can be partial, including for calendar-year seasons. It is for informational, non-commercial use with attribution; see [open-matchday terms](https://github.com/oladeeayo/open-matchday/blob/master/DISCLAIMER.md).', '',
    ...(audit?[`Score cross-check: ${audit.agreements}/${audit.compared} exact competition/date/team matches agree; ${audit.disagreements.length} disagree. Unmatched names are not inferred. This is not validation of other statistics.`, '',
      ...audit.disagreements.slice(0,10).map(x=>`- ${esc(x.date)} ${esc(x.competition)}: ${esc(x.home)} v ${esc(x.away)}, PitchAPI ${x.pitchapi_score.join('–')}, open-matchday ${x.open_matchday_score.join('–')}.`), ...(audit.disagreements.length?['']:[])]:[]),
    `Local source files: \`${path.join(root,'data','open_matchday_2026_2027')}\`.`, '',
    '| Country | Competition | Result rows | Fixture rows |', '| --- | --- | ---: | ---: |',
    ...supplemental.competitions.map(c=>`| ${esc(c.country_code)} | ${esc(c.name||c.folder)} | ${c.files.results?.rows||0} | ${c.files.fixtures?.rows||0} |`), ''
  ]:[]),
  '## Competitions', '',
  '| Country | Competition | Season | Fixtures | Finished archived | Matches with players | Shots with xG | Shots with xGOT | Shot list missing or suspect | Other details archived |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...index.competition_summaries.map(c=>`| ${esc(c.country_code)} | ${esc(c.name)} | ${esc(c.season)} | ${c.fixtures} | ${c.downloaded}/${c.finished} | ${c.matches_with_players??'—'}/${c.downloaded} | ${c.known_shot_xg??'—'}/${c.shots??'—'} | ${c.known_shot_xgot??'—'}/${c.shots??'—'} | ${c.suspect_zero_shots} | ${c.other_downloaded}/${c.fixtures-c.finished} |`),
  '', '## Match endpoint responses', '',
  '| Endpoint | HTTP status counts |', '| --- | --- |',
  ...Object.entries(index.endpoint_statuses).map(([name,counts])=>`| ${esc(name)} | ${Object.entries(counts).map(([status,n])=>`${esc(status)}: ${n}`).join('; ')} |`),
  '', '## Other fixture endpoint responses', '',
  '| Endpoint | HTTP status counts |', '| --- | --- |',
  ...Object.entries(index.other_endpoint_statuses||{}).map(([name,counts])=>`| ${esc(name)} | ${Object.entries(counts).map(([status,n])=>`${esc(status)}: ${n}`).join('; ')} |`),
  '', `Local archive: \`${archive}\`.`, '',
  'Source: [PitchAPI documentation](https://pitchapi.dev/). Its catalogue covers a subset of European competitions.', ''
];
await fs.mkdir(path.dirname(output),{recursive:true});
const temporary=`${output}.${process.pid}.tmp`;
await fs.writeFile(temporary,lines.join('\n'),'utf8');
await fs.rename(temporary,output);
console.log(`Coverage report written: ${output}`);
