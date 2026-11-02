import React, { useMemo, useState } from "react";
import { dataUrl } from "../data-url.js";
import { csvString } from "../model.js";
import {
  historicalRows,
  historicalScore,
  historicalScoreNotes,
  HISTORICAL_CSV_FIELDS,
  historicalCsvRow,
} from "../services/openfootball-history.js";
import { date, number } from "../services/format.js";
import { download, json, useResource } from "../services/resources.js";
import { AsyncState, Card, Empty, Pager } from "./UI.jsx";

async function loadSeason(path) {
  const response = await fetch(dataUrl(path));
  if (!response.ok)
    throw new Error(`Données indisponibles (HTTP ${response.status})`);
  if (typeof DecompressionStream === "undefined")
    throw new Error("Ce navigateur ne peut pas décompresser les archives.");
  return new Response(
    response.body.pipeThrough(new DecompressionStream("gzip")),
  ).json();
}

export function HistoryResults({ season, competition, query, page, onPage }) {
  const rows = useMemo(
    () => historicalRows(season, competition, query),
    [season, competition, query],
  );
  const size = 50,
    pages = Math.max(1, Math.ceil(rows.length / size)),
    current = Math.min(page, pages);
  return (
    <>
      <div className="historical-archive-summary">
        <span>{number(rows.length)} matchs affichés dans cette sélection</span>
        <button
          className="button button-secondary"
          onClick={() => {
            const values = rows.map(historicalCsvRow);
            download(
              `openfootball-${season.season.replace("/", "-")}.csv`,
              csvString(HISTORICAL_CSV_FIELDS, values),
              "text/csv;charset=utf-8",
            );
          }}
        >
          Exporter CSV
        </button>
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="data-table historical-results">
            <thead>
              <tr>
                <th>Date</th>
                <th>Compétition</th>
                <th>Domicile</th>
                <th>Score</th>
                <th>Extérieur</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice((current - 1) * size, current * size)
                .map(({ key, competition: name, match }) => {
                  const [home, away] = historicalScore(match);
                  const notes = historicalScoreNotes(match);
                  return (
                    <tr key={key}>
                      <td>{date(match.date)}</td>
                      <td>{name}</td>
                      <td>{match.team1 || "—"}</td>
                      <td>
                        {home === null || away === null
                          ? "—"
                          : `${home} – ${away}`}
                        {notes.length > 0 && (
                          <small className="historical-score-note">
                            {notes.join(" · ")}
                          </small>
                        )}
                      </td>
                      <td>{match.team2 || "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Aucun match pour cette sélection.</Empty>
      )}
      <Pager page={current} total={pages} onChange={onPage} />
    </>
  );
}

function ArchiveBrowser({ index }) {
  const [season, setSeason] = useState(index.seasons[0]?.id || "");
  const [competition, setCompetition] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const selected = index.seasons.find((entry) => entry.id === season);
  const resource = useResource(
    `openfootball:${selected?.path || "none"}`,
    () => loadSeason(selected.path),
    Boolean(selected),
  );
  if (!selected) return <Empty>Aucune archive historique disponible.</Empty>;
  return (
    <>
      <p className="historical-archive-note">
        Sources :{" "}
        <a href={index.source.url} target="_blank" rel="noreferrer">
          OpenFootball
        </a>
        {(index.source.additionalSources || []).map((source) => (
          <React.Fragment key={source.name}>
            {" · "}
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.name}
            </a>{" "}
            ({source.license})
            {source.upstream && (
              <>
                {" · "}
                <a href={source.upstream.url} target="_blank" rel="noreferrer">
                  {source.upstream.name}
                </a>{" "}
                ({source.upstream.license}
                {source.upstream.usage ? ` ; ${source.upstream.usage}` : ""})
              </>
            )}
          </React.Fragment>
        ))}{" "}
        · données gratuites. Ces archives contiennent les résultats et
        calendriers uniquement : aucune statistique individuelle ni xG. Elles
        sont distinctes de PitchAPI.
      </p>
      <div className="historical-archive-filters">
        <label>
          Saison{" "}
          <select
            aria-label="Saison des archives historiques"
            value={season}
            onChange={(event) => {
              setSeason(event.target.value);
              setCompetition("all");
              setPage(1);
            }}
          >
            {index.seasons.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Équipe{" "}
          <input
            type="search"
            aria-label="Rechercher une équipe dans les archives"
            placeholder="Nom d’équipe…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <p className="historical-archive-coverage">
        {number(selected.competitions)} compétitions ·{" "}
        {number(selected.results)} résultats renseignés sur{" "}
        {number(selected.matches)} matchs
      </p>
      <AsyncState resource={resource}>
        {(value) => (
          <>
            <div className="historical-archive-filters">
              <label>
                Compétition{" "}
                <select
                  aria-label="Compétition des archives historiques"
                  value={competition}
                  onChange={(event) => {
                    setCompetition(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Toutes les compétitions</option>
                  {value.competitions.map((league) => (
                    <option key={league.id} value={league.id}>
                      {league.name} · {league.country}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <HistoryResults
              season={value}
              competition={competition}
              query={query}
              page={page}
              onPage={setPage}
            />
          </>
        )}
      </AsyncState>
    </>
  );
}

export default function OpenFootballArchive() {
  const index = useResource("openfootball:history-index", () =>
    json(dataUrl("raw/openfootball/index.json")),
  );
  return (
    <Card title="Archives historiques · résultats">
      <AsyncState resource={index}>
        {(value) => <ArchiveBrowser index={value} />}
      </AsyncState>
    </Card>
  );
}
