"use client";
import React, { useMemo, useState } from "react";
import { Card, Media, Pager, Segments, AsyncState, Empty } from "./UI.jsx";
import { date } from "../services/format.js";
import { useResource, json } from "../services/resources.js";
import { dataUrl } from "../data-url.js";
import { competitionCountryLabel } from "../services/competition-selector.js";
import { normalizeOpenCup, normalizeSupplementalCup, filterCupMatches } from "../services/cup-matches.js";

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
  const [status, setStatus] = useState(competition.source === "open-matchday" && !Number(competition.tables?.results?.rows) ? "scheduled" : "finished");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const version = competition.source === "open-matchday" ? [competition.tables?.results?.sha256, competition.tables?.fixtures?.sha256].join(":") : season;
  const resource = useResource("cup:" + competition.id + ":" + version, async () => {
    if (competition.source === "open-matchday") {
      const [results, fixtures] = await Promise.all([compressedRows(competition.tables?.results), compressedRows(competition.tables?.fixtures)]);
      return { matches: normalizeSupplementalCup(results, fixtures) };
    }
    const payload = await json("/api/open-cups?competition=" + encodeURIComponent(competition.sourceKey) + "&season=" + encodeURIComponent(season));
    return { matches: normalizeOpenCup(payload.matches), source: payload.source };
  });
  return (
    <Card className="cup-detail" title={<span className="competition-detail-title"><Media name={competition.name} url={competition.imageUrl} /><span><strong>{competition.name}</strong><small>{competitionCountryLabel(competition)}</small></span></span>}>
      <div className="cup-controls">
        <label>Édition
          <select aria-label="Édition de la coupe" value={season} onChange={(event) => { const next = event.target.value; setSeason(next); setStatus(competition.sourceKey === "euro" && next === "2028" ? "scheduled" : "finished"); setPage(1); }}>
            {competition.seasons.map((value) => <option key={value} value={value}>{editionLabel(competition, value)}</option>)}
          </select>
        </label>
        <Segments label="Vue des matchs" value={status} onChange={(next) => { setStatus(next); setPage(1); }} items={[["finished", "Résultats"], ["scheduled", "À venir"], ["all", "Tous"]]} />
        <input type="search" aria-label="Rechercher une équipe dans la coupe" placeholder="Rechercher une équipe…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
      </div>
      <p className="cup-source">
        {competition.source === "open-matchday" ? <><a href="https://github.com/oladeeayo/open-matchday">open-matchday</a>{competition.sourceDate ? " · données du " + date(competition.sourceDate) : ""} · couverture selon la source · usage non commercial</> : <><a href={"https://github.com/openfootball/" + (competition.sourceKey === "euro" ? "euro.json" : competition.sourceKey === "france-cup" ? "europe" : "worldcup.json")}>OpenFootball</a> · {competition.coverage || "résultats et calendrier"} · mise à jour selon la source</>}
      </p>
      {competition.sourceKey === "euro" && season === "2028" && <p className="cup-source">Les équipes indiquées par des codes restent à déterminer.</p>}
      <AsyncState resource={resource}>
        {(value) => <CupMatchList matches={value.matches} status={status} query={query} page={page} onPage={setPage} />}
      </AsyncState>
    </Card>
  );
}
function CupMatchList({ matches, status, query, page, onPage }) {
  const rows = useMemo(() => filterCupMatches(matches, status, query), [matches, status, query]);
  const pages = Math.max(1, Math.ceil(rows.length / 30)), current = Math.min(page, pages);
  return <>
    <div className="cup-match-list">{rows.slice((current - 1) * 30, current * 30).map((match) => <CupMatch key={match.key} match={match} />)}</div>
    {!rows.length && <Empty>{status === "scheduled" ? "Aucune rencontre à venir disponible dans cette source." : "Aucun résultat disponible pour cette sélection."}</Empty>}
    <Pager page={current} total={pages} onChange={onPage} />
  </>;
}
