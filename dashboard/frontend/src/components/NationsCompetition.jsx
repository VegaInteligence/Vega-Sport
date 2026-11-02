"use client";
import React, { useMemo, useState } from "react";
import { AsyncState, Card, Segments } from "./UI.jsx";
import { CupMatchList } from "./CupCompetition.jsx";
import KnockoutBracket from "./KnockoutBracket.jsx";
import { useResource } from "../services/resources.js";
import { cupWorkerSnapshot } from "../services/cup-worker-client.js";
import { nationsStandings } from "../services/nations-standings.js";

function Groups({ matches }) {
  const groups = useMemo(() => nationsStandings(matches), [matches]);
  return <>
    <div className="nations-groups">
      {groups.map((group) => <section className="nations-group" key={group.group}>
        <h3>Groupe {group.group}</h3>
        <div className="table-scroll"><table className="data-table nations-table" aria-label={"Classement du groupe " + group.group}>
          <thead><tr><th scope="col">#</th><th scope="col">Équipe</th><th scope="col">J</th><th scope="col">G</th><th scope="col">N</th><th scope="col">D</th><th scope="col">BP</th><th scope="col">BC</th><th scope="col">Diff.</th><th scope="col">Pts</th></tr></thead>
          <tbody>{group.rows.map((team) => <tr key={team.id}><td>{team.position}</td><th scope="row">{team.name}</th><td>{team.played}</td><td>{team.wins}</td><td>{team.draws}</td><td>{team.losses}</td><td>{team.goals}</td><td>{team.against}</td><td>{team.difference > 0 ? "+" : ""}{team.difference}</td><td><strong>{team.points}</strong></td></tr>)}</tbody>
        </table></div>
      </section>)}
    </div>
    <p className="nations-note">Classements calculés à partir des résultats disponibles.{groups.some((group) => group.unresolved) ? " Les derniers critères de départage ne sont pas fournis par la source." : ""}</p>
  </>;
}
export default function NationsCompetition({ competition }) {
  const [league, setLeague] = useState("A"), [view, setView] = useState("standings"), [status, setStatus] = useState("finished"), [query, setQuery] = useState(""), [page, setPage] = useState(1);
  const leagueA = useResource("nations-league-a:2026/2027", () => cupWorkerSnapshot("openligadb", "nations-league", "2026/2027", "/api/openligadb?competition=nations-league&season=2026%2F2027"), league === "A");
  const otherLeagues = useResource("nations-league-other:2026/2027", () => cupWorkerSnapshot("nations-results", "nations-league", "2026/2027", "/api/nations-results?season=2026%2F2027"), league !== "A");
  const resource = league === "A" ? leagueA : otherLeagues;
  const chooseLeague = (next) => { setLeague(next); if (view === "bracket" && next !== "A") setView("standings"); setPage(1); };
  return <Card className="cup-detail nations-detail" title={<span className="competition-detail-title"><span><strong>{competition.name}</strong><small>2026/2027</small></span></span>}>
    <div className="nations-league-switch"><span>Ligue</span><Segments label="Ligue" value={league} onChange={chooseLeague} items={[["A", "A"], ["B", "B"], ["C", "C"], ["D", "D"]]} /></div>
    <div className="cup-controls"><Segments label="Vue de la compétition" value={view} onChange={setView} items={[["standings", "Classements"], ["matches", "Matchs"], ...(league === "A" ? [["bracket", "Tableau"]] : [])]} />
      {view === "matches" && <><Segments label="Vue des matchs" value={status} onChange={(next) => { setStatus(next); setPage(1); }} items={[["finished", "Résultats"], ["scheduled", "À venir"], ["all", "Tous"]]} /><input type="search" aria-label="Rechercher une sélection" placeholder="Rechercher une sélection…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></>}
    </div>
    {league !== "A" && <p className="cup-source">Résultats disponibles ; les rencontres à venir ne sont pas fournies pour cette ligue.</p>}
    <AsyncState resource={resource}>{(value) => { const matches = league === "A" ? value.matches : value.matches.filter((match) => match.league === league); return view === "standings" ? <Groups matches={matches} /> : view === "matches" ? <CupMatchList matches={matches} status={status} query={query} page={page} onPage={setPage} /> : <KnockoutBracket matches={matches} />; }}</AsyncState>
  </Card>;
}
