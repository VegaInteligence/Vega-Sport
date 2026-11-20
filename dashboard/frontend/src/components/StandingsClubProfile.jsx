"use client";
import React from "react";
import BackLink from "./BackLink.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { cupWorkerSnapshot } from "../services/cup-worker-client.js";
import { json, useResource } from "../services/resources.js";
import { number } from "../services/format.js";
import { AsyncState, Card, Empty, Media } from "./UI.jsx";
import { Term } from "./Hint.jsx";

export default function StandingsClubProfile({
  leagueId,
  leagueName,
  season,
  name,
  cup,
}) {
  const f = useFootball();
  const result = useResource(
    `club-standing:${leagueId}:${season}:${cup}`,
    () => {
      const url = `/api/standings?competition=${encodeURIComponent(leagueId)}`;
      return cup
        ? cupWorkerSnapshot("standings", leagueId, season, url)
        : json(url);
    },
  );
  const display = (value) => (value == null ? "—" : number(value));
  return (
    <>
      <BackLink
        className="inline-link competition-back"
        href={f.href("/competitions/", { id: leagueId })}
        label="Retour à la compétition"
      />
      <AsyncState resource={result}>
        {(standing) => {
          const row = standing?.tables
            ?.flatMap((table) => table.rows || [])
            .find((item) => item.name === name);
          return (
            <Card className="player-season-card research-player-profile club-workspace">
              <div className="season-player-heading">
                <div className="season-player-identity">
                  <Media
                    name={name}
                    url={row?.imageUrl}
                    className="crest season-player-portrait club-portrait"
                  />
                  <div>
                    <h2>{name}</h2>
                    <p>
                      {[leagueName || "Compétition", season]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
              </div>
              <section className="club-section">
                <div className="season-section-heading">
                  <h3>Bilan au classement</h3>
                </div>
                {row ? (
                  <div
                    className="table-scroll"
                    role="region"
                    aria-label="Bilan de l’équipe"
                    tabIndex={0}
                  >
                    <table className="data-table club-record-table">
                      <thead>
                        <tr>
                          <th>
                            <Term>Position</Term>
                          </th>
                          <th>
                            <Term>Pts</Term>
                          </th>
                          <th>
                            <Term>J</Term>
                          </th>
                          <th>
                            <Term>V</Term>
                          </th>
                          <th>
                            <Term>N</Term>
                          </th>
                          <th>
                            <Term>D</Term>
                          </th>
                          <th>
                            <Term>BP</Term>
                          </th>
                          <th>
                            <Term>BC</Term>
                          </th>
                          <th>
                            <Term>Diff.</Term>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{display(row.position)}</td>
                          <td>{display(row.points)}</td>
                          <td>{display(row.played)}</td>
                          <td>{display(row.wins)}</td>
                          <td>{display(row.draws)}</td>
                          <td>{display(row.losses)}</td>
                          <td>{display(row.goalsFor)}</td>
                          <td>{display(row.goalsAgainst)}</td>
                          <td>{display(row.difference)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    Cette équipe ne figure plus dans le classement disponible.
                  </Empty>
                )}
                <p className="club-note">
                  Les statistiques détaillées de cette équipe ne sont pas
                  disponibles pour cette saison.
                </p>
              </section>
            </Card>
          );
        }}
      </AsyncState>
    </>
  );
}
