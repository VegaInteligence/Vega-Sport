"use client";
import React, { useMemo, useState } from "react";
import { Card, Media, Pager, Segments, AsyncState, Empty } from "./UI.jsx";
import { date, seasonLabel } from "../services/format.js";
import { parisDay } from "../services/fixtures.js";
import KnockoutBracket from "./KnockoutBracket.jsx";
import { useResource } from "../services/resources.js";
import { cupTable } from "../services/catalog-client.js";
import { competitionCountryLabel } from "../services/competition-selector.js";
import { normalizeOpenCup, normalizeSupplementalCup, filterCupMatches, resultsAsOpenCup, leagueTable, numberedCupRounds } from "../services/cup-matches.js";
import { combineCupLegs, knockoutStage } from "../services/knockout-bracket.js";
import { cupWorkerSnapshot } from "../services/cup-worker-client.js";
import { NATIONAL_CUP_ARCHIVES, GERMAN_CUP_FOLDER, isGermanCupSeason } from "../services/cup-archives.js";
import NationalFlag from "./NationalFlag.jsx";
import SeasonProjection from "./SeasonProjection.jsx";
import { useCupProjection } from "../services/cup-projection.js";
import MatchForecastBar from "./MatchForecastBar.jsx";
import { Term } from "./Hint.jsx";

function editionLabel(competition, season) {
  return competition.sourceKey === "euro" && season === "2020" ? "2020 (joué en 2021)" : season;
}
/** A complementary league's standings, from the results its source gives (VI-19). */
function LeagueStandings({ name, matches }) {
  const rows = useMemo(() => leagueTable(matches), [matches]);
  if (!rows.length) return <Empty>Aucun résultat disponible pour cette édition.</Empty>;
  return <>
    <div className="table-scroll" role="region" aria-label={"Classement de la " + name} tabIndex={0}>
      <table className="data-table nations-table" aria-label={"Classement de la " + name}>
        <thead><tr><th scope="col">#</th><th scope="col"><Term>Équipe</Term></th><th scope="col"><Term>J</Term></th><th scope="col"><Term>G</Term></th><th scope="col"><Term>N</Term></th><th scope="col"><Term>D</Term></th><th scope="col"><Term>BP</Term></th><th scope="col"><Term>BC</Term></th><th scope="col"><Term>Diff.</Term></th><th scope="col"><Term>Pts</Term></th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.name}><td>{row.position}</td><th scope="row"><span className="cup-match-team">{row.name}</span></th><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.difference > 0 ? "+" : ""}{row.difference}</td><td><strong>{row.points}</strong></td></tr>)}</tbody>
      </table>
    </div>
    <p className="nations-note">Classement calculé à partir des résultats disponibles.</p>
  </>;
}
/** A cup's match, in the main lists' design (date, teams around the score, round), and its forecast before kick-off. */
function CupMatch({ match, nationalTeams, season }) {
  const badge = (name) => (nationalTeams ? <NationalFlag name={name} season={season || match.date} /> : <Media name={name} />);
  return (
    <div className="match-row cup-match">
      <span className="match-date">{match.date ? date(match.date) : "Date à préciser"}</span>
      <span className="match-teams">
        <span className="team-name home-team"><span>{match.home}</span>{badge(match.home)}</span>
        <strong className="score">{match.score ? match.score[0] + " – " + match.score[1] : "À venir"}</strong>
        <span className="team-name">{badge(match.away)}<span>{match.away}</span></span>
        {match.notes?.length > 0 && <span className="cup-match-notes">{match.notes.join(" · ")}</span>}
        {match.status === "scheduled" && <MatchForecastBar home={match.home} away={match.away} forecast={match.forecast} />}
      </span>
      <span className="match-league">{match.round || ""}</span>
    </div>
  );
}

export default function CupCompetition({ competition, initialSeason }) {
  const [season, setSeason] = useState(
    () =>
      (initialSeason &&
        competition.seasons?.find((value) => String(value) === initialSeason || seasonLabel(value) === initialSeason)) ||
      competition.defaultSeason,
  );
  // A complementary league (VI-19): its standings first, its matches, its projection; no bracket.
  const league = competition.kind === "league";
  const [view, setView] = useState(league ? "standings" : "matches");
  const supportsBracket = !league && (competition.source === "openfootball" || competition.source === "open-matchday");
  const nationalTeams = ["euro", "world-cup-history", "afcon", "copa-america", "asian-cup", "gold-cup"].includes(competition.sourceKey);
  const archive = NATIONAL_CUP_ARCHIVES[competition.folder];
  const germany = competition.folder === GERMAN_CUP_FOLDER;
  // A domestic cup whose next round is drawn: its rounds replayed (124); a complementary league replayed to its end (VI-19).
  const projection = useCupProjection(competition, typeof season === "string" ? season : String(season));
  const projected = projection?.format === "knockout" || (!projection?.format && projection?.teams?.length > 0);
  const showProjection = view === "projection" && projected;
  const [status, setStatus] = useState(competition.source === "open-matchday" && !Number(competition.tables?.results?.rows) ? "scheduled" : "finished");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const tables = competition.editions?.[season] || (season === competition.defaultSeason ? competition.tables : null);
  const version = competition.source === "open-matchday" ? [tables?.results?.sha256, tables?.fixtures?.sha256].join(":") : season;
  const mode = competition.source === "nations-results" ? "results"
    : competition.source !== "open-matchday" ? "openfootball"
    : view === "bracket" && germany && isGermanCupSeason(season) ? "openligadb"
    : view === "bracket" && archive && season === archive.season ? "archive"
    : tables ? "supplemental"
    : germany && isGermanCupSeason(season) ? "openligadb"
    : archive && season === archive.season ? "archive"
    : "unavailable";
  const resource = useResource("cup:" + competition.id + ":" + mode + ":" + view + ":" + season + ":" + version, async () => {
    if (mode === "supplemental") {
      const [results, fixtures] = await Promise.all(["results", "fixtures"].map(kind => tables?.[kind] && Number(tables[kind].rows) !== 0 ? cupTable(competition.folder,season,kind) : []));
      // A cup's numbered rounds named by their ties (its bracket, VI-19); a league's matches as they are.
      const normalized = normalizeSupplementalCup(results, fixtures);
      const matches = league ? normalized : numberedCupRounds(normalized);
      if (view !== "bracket") return { matches };
      return matches.some((match) => knockoutStage(match.roundName)) ? { matches: combineCupLegs(matches) } : { matches, unavailable: true };
    }
    if (mode === "unavailable") return { matches: [], unavailable: true };
    if (mode === "openligadb") return cupWorkerSnapshot("openligadb", "germany-cup", season, "/api/openligadb?competition=germany-cup&season=" + encodeURIComponent(season));
    if (mode === "results") {
      // International Results: played matches only, without rounds (results-v1).
      const payload = await cupWorkerSnapshot("nations-results", competition.sourceKey, season, null);
      return { matches: normalizeOpenCup(resultsAsOpenCup(payload.matches)), source: payload.source };
    }
    const key = mode === "archive" ? archive.key : competition.sourceKey;
    const payload = await cupWorkerSnapshot("open-cups", key, season, "/api/open-cups?competition=" + encodeURIComponent(key) + "&season=" + encodeURIComponent(season));
    const matches = normalizeOpenCup(payload.matches);
    return { matches: mode === "archive" && archive.twoLegged && view === "bracket" ? combineCupLegs(matches) : matches, source: payload.source };
  });
  return (
    <Card className="cup-detail" title={<span className="competition-detail-title"><Media name={competition.name} url={competition.imageUrl} /><span><strong>{competition.name}</strong><small>{competitionCountryLabel(competition)}</small></span></span>}>
      <div className="cup-controls">
        <label>Édition
          <select aria-label="Édition de la coupe" value={season} onChange={(event) => { const next = event.target.value; setSeason(next); setStatus(competition.sourceKey === "euro" && next === "2028" ? "scheduled" : "finished"); setPage(1); }}>
            {competition.seasons.map((value) => <option key={value} value={value}>{editionLabel(competition, value)}</option>)}
          </select>
        </label>
        {supportsBracket && <Segments label="Vue de la compétition" value={view} onChange={setView} items={[["matches", "Matchs"], ["bracket", "Tableau"], ...(projected ? [["projection", "Projection"]] : [])]} />}
        {league && <Segments label="Vue de la compétition" value={view} onChange={setView} items={[["standings", "Classement"], ["matches", "Matchs"], ...(projected ? [["projection", "Projection"]] : [])]} />}
        {view === "matches" && <>
          <Segments label="Vue des matchs" value={status} onChange={(next) => { setStatus(next); setPage(1); }} items={[["finished", "Résultats"], ["scheduled", "À venir"], ["all", "Tous"]]} />
          <input type="search" aria-label="Rechercher une équipe dans la coupe" placeholder="Rechercher une équipe…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </>}
      </div>
      {showProjection ? <SeasonProjection projection={projection} competition={competition} season={season} /> : <>
      {mode === "archive" ? <p className="cup-source">Archive {season}</p> : mode === "openligadb" ? <p className="cup-source">Résultats et calendrier</p> : competition.source === "open-matchday" ? (competition.sourceDate && <p className="cup-source">Données du {date(competition.sourceDate)}</p>) : <p className="cup-source">{competition.coverage || "Résultats et calendrier"}</p>}
      {competition.sourceKey === "euro" && season === "2028" && <p className="cup-source">Les équipes indiquées par des codes restent à déterminer.</p>}
      <AsyncState resource={resource}>
        {(value) => value.unavailable ? <div className="cup-bracket-unavailable"><Empty>Les tours de cette édition ne sont pas disponibles.</Empty>{archive && season !== archive.season && <button className="button button-secondary" onClick={() => setSeason(archive.season)}>Voir le tableau {archive.season}</button>}</div> : <>
          {value.matches.some((match) => match.status === "scheduled" && match.date && match.date < parisDay(Date.now())) && <p className="cup-source">Certains scores de cette édition ne sont pas encore renseignés.</p>}
          {view === "bracket" ? <KnockoutBracket matches={value.matches} nationalTeams={nationalTeams} season={season} /> : view === "standings" ? <LeagueStandings name={competition.name} matches={value.matches} /> : <CupMatchList matches={value.matches} status={status} query={query} page={page} onPage={setPage} nationalTeams={nationalTeams} season={season} />}
        </>}
      </AsyncState>
      </>}
    </Card>
  );
}
export function CupMatchList({ matches, status, query, page, onPage, nationalTeams = false, season }) {
  const rows = useMemo(() => filterCupMatches(matches, status, query), [matches, status, query]);
  const pages = Math.max(1, Math.ceil(rows.length / 30)), current = Math.min(page, pages);
  return <>
    <div className="cup-match-list">{rows.slice((current - 1) * 30, current * 30).map((match) => <CupMatch key={match.key} match={match} nationalTeams={nationalTeams} season={season} />)}</div>
    {!rows.length && <Empty>{status === "scheduled" ? "Aucune rencontre à venir disponible." : "Aucun résultat disponible pour cette sélection."}</Empty>}
    <Pager page={current} total={pages} onChange={onPage} />
  </>;
}
