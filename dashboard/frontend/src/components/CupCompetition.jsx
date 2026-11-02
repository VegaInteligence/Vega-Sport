"use client";
import React, { useMemo, useState } from "react";
import { Card, Media, Pager, Segments, AsyncState, Empty } from "./UI.jsx";
import { date } from "../services/format.js";
import { parisDay } from "../services/fixtures.js";
import KnockoutBracket from "./KnockoutBracket.jsx";
import { useResource, json } from "../services/resources.js";
import { dataUrl } from "../data-url.js";
import { competitionCountryLabel } from "../services/competition-selector.js";
import { normalizeOpenCup, normalizeSupplementalCup, filterCupMatches } from "../services/cup-matches.js";
import { combineCupLegs } from "../services/knockout-bracket.js";
import { NATIONAL_CUP_ARCHIVES, GERMAN_CUP_FOLDER, GERMAN_CUP_SEASONS } from "../services/cup-archives.js";

async function compressedRows(ref) {
  if (!ref || Number(ref.rows) === 0) return [];
  const response = await fetch(dataUrl(ref.path));
  if (!response.ok) throw new Error("Données de coupe indisponibles (HTTP " + response.status + ")");
  if (typeof DecompressionStream === "undefined") throw new Error("Ce navigateur ne peut pas lire ces données de coupe.");
  const rows = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json();
  if (!Array.isArray(rows)) throw new Error("Format de coupe invalide.");
  return rows;
}
function editionLabel(competition, season) {
  return competition.sourceKey === "euro" && season === "2020" ? "2020 (joué en 2021)" : season;
}
function CupMatch({ match }) {
  return (
    <div className="cup-match">
      <div className="cup-match-meta"><time dateTime={match.date || undefined}>{match.date ? date(match.date) : "Date à préciser"}</time>{match.round && <span>{match.round}</span>}</div>
      <div className="cup-match-teams">
        <span>{match.home}</span>
        <strong>{match.score ? match.score[0] + " – " + match.score[1] : "—"}</strong>
        <span>{match.away}</span>
      </div>
      {match.notes?.length > 0 && <p className="cup-match-notes">{match.notes.join(" · ")}</p>}
    </div>
  );
}

export default function CupCompetition({ competition }) {
  const [season, setSeason] = useState(competition.defaultSeason);
  const [view, setView] = useState("matches");
  const supportsBracket = competition.source === "openfootball" || competition.source === "open-matchday";
  const archive = NATIONAL_CUP_ARCHIVES[competition.folder];
  const germany = competition.folder === GERMAN_CUP_FOLDER;
  const [status, setStatus] = useState(competition.source === "open-matchday" && !Number(competition.tables?.results?.rows) ? "scheduled" : "finished");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const version = competition.source === "open-matchday" ? [competition.tables?.results?.sha256, competition.tables?.fixtures?.sha256].join(":") : season;
  const mode = competition.source !== "open-matchday" ? "openfootball"
    : season === competition.defaultSeason && view === "matches" ? "supplemental"
    : germany && GERMAN_CUP_SEASONS.includes(season) ? "openligadb"
    : archive && season === archive.season ? "archive"
    : "unavailable";
  const resource = useResource("cup:" + competition.id + ":" + mode + ":" + view + ":" + season + ":" + version, async () => {
    if (mode === "supplemental") {
      const [results, fixtures] = await Promise.all([compressedRows(competition.tables?.results), compressedRows(competition.tables?.fixtures)]);
      return { matches: normalizeSupplementalCup(results, fixtures) };
    }
    if (mode === "unavailable") return { matches: [], unavailable: true };
    if (mode === "openligadb") return json("/api/openligadb?competition=germany-cup&season=" + encodeURIComponent(season));
    const key = mode === "archive" ? archive.key : competition.sourceKey;
    const payload = await json("/api/open-cups?competition=" + encodeURIComponent(key) + "&season=" + encodeURIComponent(season));
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
        {supportsBracket && <Segments label="Vue de la compétition" value={view} onChange={setView} items={[["matches", "Matchs"], ["bracket", "Tableau"]]} />}
        {view === "matches" && <>
          <Segments label="Vue des matchs" value={status} onChange={(next) => { setStatus(next); setPage(1); }} items={[["finished", "Résultats"], ["scheduled", "À venir"], ["all", "Tous"]]} />
          <input type="search" aria-label="Rechercher une équipe dans la coupe" placeholder="Rechercher une équipe…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
        </>}
      </div>
      {mode === "archive" ? <p className="cup-source">Archive {season}</p> : mode === "openligadb" ? <p className="cup-source">Résultats et calendrier</p> : competition.source === "open-matchday" ? (competition.sourceDate && <p className="cup-source">Données du {date(competition.sourceDate)}</p>) : <p className="cup-source">{competition.coverage || "Résultats et calendrier"}</p>}
      {competition.sourceKey === "euro" && season === "2028" && <p className="cup-source">Les équipes indiquées par des codes restent à déterminer.</p>}
      <AsyncState resource={resource}>
        {(value) => value.unavailable ? <div className="cup-bracket-unavailable"><Empty>Les tours de cette édition ne sont pas disponibles dans la source.</Empty>{archive && season !== archive.season && <button className="button button-secondary" onClick={() => setSeason(archive.season)}>Voir le tableau {archive.season}</button>}</div> : <>
          {value.matches.some((match) => match.status === "scheduled" && match.date && match.date < parisDay(Date.now())) && <p className="cup-source">Certains scores de cette édition ne sont pas renseignés dans la source.</p>}
          {view === "bracket" ? <KnockoutBracket matches={value.matches} /> : <CupMatchList matches={value.matches} status={status} query={query} page={page} onPage={setPage} />}
        </>}
      </AsyncState>
    </Card>
  );
}
export function CupMatchList({ matches, status, query, page, onPage }) {
  const rows = useMemo(() => filterCupMatches(matches, status, query), [matches, status, query]);
  const pages = Math.max(1, Math.ceil(rows.length / 30)), current = Math.min(page, pages);
  return <>
    <div className="cup-match-list">{rows.slice((current - 1) * 30, current * 30).map((match) => <CupMatch key={match.key} match={match} />)}</div>
    {!rows.length && <Empty>{status === "scheduled" ? "Aucune rencontre à venir disponible dans cette source." : "Aucun résultat disponible pour cette sélection."}</Empty>}
    <Pager page={current} total={pages} onChange={onPage} />
  </>;
}
