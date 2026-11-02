import React, { useDeferredValue, useMemo, useState } from "react";
import { dataUrl } from "../data-url.js";
import { csvString } from "../model.js";
import {
  historicalGoalRows,
  HISTORICAL_GOAL_CSV_FIELDS,
  historicalGoalCsvRow,
} from "../services/historical-goals.js";
import { date, number } from "../services/format.js";
import { download, json, useResource } from "../services/resources.js";
import { competitionLabel, orderedCompetitions } from "../services/competition-selector.js";
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

export function GoalResults({ season, competition, query, page, onPage }) {
  const deferredQuery = useDeferredValue(query);
  const rows = useMemo(
    () => historicalGoalRows(season, competition, deferredQuery),
    [season, competition, deferredQuery],
  );
  const size = 50,
    pages = Math.max(1, Math.ceil(rows.length / size)),
    current = Math.min(page, pages);
  return (
    <>
      <div className="historical-archive-summary">
        <span>{number(rows.length)} événements dans cette sélection</span>
        <button
          className="button button-secondary"
          onClick={() =>
            download(
              `buts-historiques-${season.season.replace("/", "-")}.csv`,
              csvString(
                HISTORICAL_GOAL_CSV_FIELDS,
                rows.map(historicalGoalCsvRow),
              ),
              "text/csv;charset=utf-8",
            )
          }
        >
          Exporter CSV
        </button>
      </div>
      {rows.length ? (
        <div className="table-scroll">
          <table className="data-table historical-results historical-goal-results">
            <thead>
              <tr>
                <th>Date</th>
                <th>Compétition</th>
                <th>Joueur indiqué</th>
                <th>Équipe indiquée</th>
                <th>Minute</th>
                <th>Score après but</th>
                <th>Match</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice((current - 1) * size, current * size)
                .map(
                  ({
                    key,
                    competition: name,
                    country,
                    calendarYear,
                    event,
                  }) => (
                    <tr key={key}>
                      <td>{date(event.date)}</td>
                      <td>
                        {name} · {country}
                        {calendarYear && (
                          <small className="historical-score-note">
                            Année civile {calendarYear}
                          </small>
                        )}
                      </td>
                      <td>{event.player || "—"}</td>
                      <td>{event.team || "—"}</td>
                      <td>{event.minute ? `${event.minute}′` : "—"}</td>
                      <td>
                        {event.score?.join(" – ") || "—"}
                        {event.scoreDisagreement && (
                          <small className="historical-score-note">
                            Événements et score final divergents
                          </small>
                        )}
                      </td>
                      <td>{event.match}</td>
                    </tr>
                  ),
                )}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Aucun événement pour cette sélection.</Empty>
      )}
      <Pager page={current} total={pages} onChange={onPage} />
    </>
  );
}

function Browser({ index }) {
  const [season, setSeason] = useState(index.seasons[0]?.id || "");
  const [competition, setCompetition] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const selected = index.seasons.find((item) => item.id === season);
  const resource = useResource(
    `historical-goals:${selected?.path || "none"}`,
    () => loadSeason(selected.path),
    Boolean(selected),
  );
  if (!selected) return <Empty>Aucune archive de buts disponible.</Empty>;
  return (
    <>
      <p className="historical-archive-note">
        Source :{" "}
        <a href={index.source.url} target="_blank" rel="noreferrer">
          {index.source.name}
        </a>{" "}
        ·{" "}
        <a href={index.source.licenseUrl} target="_blank" rel="noreferrer">
          {index.source.license}
        </a>
        . Données gratuites, distinctes de PitchAPI. La couverture varie selon
        les compétitions et peut être partielle ; les matchs sans but ne
        figurent pas ici. Le type de but (contre son camp, penalty) n’est pas
        garanti et aucun xG n’est disponible.
      </p>
      <div className="historical-archive-filters">
        <label>
          Saison{" "}
          <select
            aria-label="Saison des buts historiques"
            value={season}
            onChange={(e) => {
              setSeason(e.target.value);
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
          Joueur ou équipe{" "}
          <input
            type="search"
            aria-label="Rechercher un joueur ou une équipe dans les buts historiques"
            placeholder="Nom de joueur ou d’équipe…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <p className="historical-archive-coverage">
        {number(selected.competitions)} compétitions · {number(selected.events)}{" "}
        événements · {number(selected.matches)} matchs avec but · dernier
        événement : {date(selected.latestEvent)}
        {selected.scoreDisagreements > 0
          ? ` · ${number(selected.scoreDisagreements)} événements avec score final divergent`
          : ""}
      </p>
      <AsyncState resource={resource}>
        {(value) => (
          <>
            <div className="historical-archive-filters">
              <label>
                Compétition{" "}
                <select
                  aria-label="Compétition des buts historiques"
                  value={competition}
                  onChange={(e) => {
                    setCompetition(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Toutes les compétitions</option>
                  {orderedCompetitions(value.competitions).map((league) => (
                    <option key={league.id} value={league.id}>
                      {competitionLabel(league)}
                      {league.calendarYear
                        ? ` · année civile ${league.calendarYear}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <GoalResults
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

export default function HistoricalGoalsArchive() {
  const index = useResource("historical-goals:index", () =>
    json(dataUrl("raw/historical-goals/index.json")),
  );
  return (
    <Card title="Archives historiques · buts">
      <AsyncState resource={index}>
        {(value) => <Browser index={value} />}
      </AsyncState>
    </Card>
  );
}
