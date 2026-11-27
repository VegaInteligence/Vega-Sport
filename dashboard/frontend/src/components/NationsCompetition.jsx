"use client";
import React, { useMemo, useState } from "react";
import { AsyncState, Card, Segments } from "./UI.jsx";
import EditionHeader, { useEditionPage } from "./EditionHeader.jsx";
import { CupMatchList } from "./CupCompetition.jsx";
import KnockoutBracket from "./KnockoutBracket.jsx";
import { useResource } from "../services/resources.js";
import { cupWorkerSnapshot } from "../services/cup-worker-client.js";
import { nationsStandings } from "../services/nations-standings.js";
import NationalFlag from "./NationalFlag.jsx";
import { Term } from "./Hint.jsx";
import { Heat } from "./SeasonProjection.jsx";
import { nationsProjectionRows, useNationsProjection } from "../services/nations-projection.js";
import { nationName } from "../services/nations.js";
import { number } from "../services/format.js";

function Groups({ matches }) {
  const groups = useMemo(() => nationsStandings(matches), [matches]);
  return <>
    <div className="nations-groups">
      {groups.map((group) => <section className="nations-group" key={group.group}>
        <h3>Groupe {group.group}</h3>
        <div className="table-scroll"><table className="data-table nations-table" aria-label={"Classement du groupe " + group.group}>
          <thead><tr><th scope="col">#</th><th scope="col"><Term>Équipe</Term></th><th scope="col"><Term>J</Term></th><th scope="col"><Term>G</Term></th><th scope="col"><Term>N</Term></th><th scope="col"><Term>D</Term></th><th scope="col"><Term>BP</Term></th><th scope="col"><Term>BC</Term></th><th scope="col"><Term>Diff.</Term></th><th scope="col"><Term>Pts</Term></th></tr></thead>
          <tbody>{group.rows.map((team) => <tr key={team.id}><td>{team.position}</td><th scope="row"><span className="national-team"><NationalFlag name={team.name} season="2026/2027" />{team.name}</span></th><td>{team.played}</td><td>{team.wins}</td><td>{team.draws}</td><td>{team.losses}</td><td>{team.goals}</td><td>{team.against}</td><td>{team.difference > 0 ? "+" : ""}{team.difference}</td><td><strong>{team.points}</strong></td></tr>)}</tbody>
        </table></div>
      </section>)}
    </div>
    <p className="nations-note">Classements calculés à partir des résultats disponibles.{groups.some((group) => group.unresolved) ? " Les derniers critères de départage ne sont pas connus." : ""}</p>
  </>;
}
/** The league's groups replayed to their end (125): each nation's chance of each place, and League A's Final Four. */
function Projection({ projection, league }) {
  const { rows, columns } = nationsProjectionRows(projection, league);
  return <>
    <div className="table-scroll standings-scroll" role="region" aria-label="Projection de la Ligue des nations" tabIndex={0}>
      <table className="data-table standings-table season-projection nations-projection">
        <caption className="sr-only">Chances de chaque sélection</caption>
        <thead><tr><th scope="col">#</th><th scope="col"><Term>Sélection</Term></th><th scope="col" title="Groupe">Gr.</th><th scope="col" title="Points actuels"><Term>Pts</Term></th><th scope="col" title="Matchs joués"><Term>J</Term></th>
          {columns.map((column) => <th key={column.key} scope="col" title={column.title} className="projection-group" data-first={column.start || undefined}>{column.label}{column.range && <small>{column.range}</small>}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => {
          const start = league !== "A" && rows[index - 1]?.group !== row.group, rank = league === "A" ? index + 1 : index - rows.findIndex((r) => r.group === row.group) + 1;
          return <tr key={row.id} data-group-start={start || undefined}><td>{rank}</td><th scope="row"><span className="national-team"><NationalFlag name={row.name} season="2026/2027" />{nationName(row.name)}</span></th><td>{String(row.group).replace(/^[A-D]/, "")}</td><td className="standings-points">{row.points}</td><td>{row.played}</td>
            {columns.map((column) => <Heat key={column.key} value={row.stages[column.key]} tone={column.tone} first={column.start} />)}</tr>;
        })}</tbody>
      </table>
    </div>
    <p className="standings-note">Les matchs restants sont rejoués {number(projection.model?.replays || 0)} fois d’après la force de chaque sélection (son Elo), avec le départage UEFA (confrontations directes d’abord).{league === "A" ? " Saison de transition : les deux meilleurs 3es restent, les deux autres 3es et les deux meilleurs 4es jouent le barrage contre un 2e de Ligue B, les deux derniers 4es descendent. Quarts et barrages suivent le tirage une fois fait, sinon tirés au hasard, en aller-retour ; Final Four sur terrain neutre ; une prolongation vaut un tiers de match et les tirs au but sont à 50/50." : league === "D" ? " La Ligue D disparaît en 2028–29 : toutes ses sélections montent en Ligue C." : ""}</p>
  </>;
}
export default function NationsCompetition({ competition }) {
  const titled = useEditionPage();
  const [league, setLeague] = useState("A"), [view, setView] = useState("standings"), [status, setStatus] = useState("finished"), [query, setQuery] = useState(""), [page, setPage] = useState(1);
  const leagueA = useResource("nations-league-a:2026/2027", () => cupWorkerSnapshot("openligadb", "nations-league", "2026/2027", "/api/openligadb?competition=nations-league&season=2026%2F2027"), league === "A");
  const otherLeagues = useResource("nations-league-other:2026/2027", () => cupWorkerSnapshot("nations-results", "nations-league", "2026/2027", "/api/nations-results?season=2026%2F2027"), league !== "A");
  const resource = league === "A" ? leagueA : otherLeagues;
  const projection = useNationsProjection(league, "2026/2027"), projected = nationsProjectionRows(projection, league).rows.length > 0;
  const shown = view === "projection" && !projected ? "standings" : view;
  const chooseLeague = (next) => { setLeague(next); if (view === "bracket" && next !== "A") setView("standings"); setPage(1); };
  // On the competition page (§ 80) the head is the page's title, above the card.
  const head = (
    <EditionHeader imageUrl={competition.imageUrl} name={competition.name} season="2026/2027" onSeason={() => {}} label="Édition" editions={[{ season: "2026/2027", id: competition.id }]}>
      <Segments label="Vue de la compétition" value={shown} onChange={setView} items={[["standings", "Classements"], ["matches", "Matchs"], ...(league === "A" ? [["bracket", "Tableau"]] : []), ...(projected ? [["projection", "Projection"]] : [])]} />
    </EditionHeader>
  );
  return <>{titled && head}<Card className="cup-detail nations-detail edition-card">
    {!titled && head}
    <div className="nations-league-switch"><span>Ligue</span><Segments label="Ligue" value={league} onChange={chooseLeague} items={[["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"]]} /></div>
    {shown === "matches" && <div className="cup-controls">
      <><Segments label="Vue des matchs" value={status} onChange={(next) => { setStatus(next); setPage(1); }} items={[["finished", "Résultats"], ["scheduled", "À venir"], ["all", "Tous"]]} /><input type="search" aria-label="Rechercher une sélection" placeholder="Rechercher une sélection…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></>
    </div>}
    {league !== "A" && <p className="cup-source">Résultats disponibles ; les rencontres à venir ne sont pas fournies pour cette ligue.</p>}
    <AsyncState resource={resource}>{(value) => { const matches = league === "A" ? value.matches : value.matches.filter((match) => match.league === league); return shown === "projection" ? <Projection projection={projection} league={league} /> : shown === "standings" ? <Groups matches={matches} /> : shown === "matches" ? <CupMatchList matches={matches} status={status} query={query} page={page} onPage={setPage} nationalTeams season="2026/2027" /> : <KnockoutBracket matches={matches} nationalTeams season="2026/2027" />; }}</AsyncState>
  </Card></>;
}
