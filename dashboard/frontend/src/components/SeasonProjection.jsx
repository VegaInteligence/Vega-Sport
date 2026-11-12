"use client";
import React from "react";
import { Media } from "./UI.jsx";
import { number } from "../services/format.js";
import { projectionRows, share } from "../services/forecasts.js";

/** A league replayed to its end: each club's points now and projected, and its chances. */
export default function SeasonProjection({ projection }) {
  const rows = projectionRows(projection);
  if (!rows.length) return null;
  const relegation = rows.some((row) => row.bottomThree !== null);
  return (
    <>
      <div className="table-scroll standings-scroll" role="region" aria-label="Projection de fin de saison" tabIndex={0}>
        <table className="data-table standings-table season-projection">
          <caption className="sr-only">Projection de fin de saison de chaque club</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Équipe</th>
              <th scope="col" title="Points actuels">Pts</th>
              <th scope="col" title="Matchs joués">J</th>
              <th scope="col" title="Points en fin de saison, en moyenne des simulations">Pts projetés</th>
              <th scope="col" title="Part des simulations où le club finit premier">Titre</th>
              <th scope="col" title="Part des simulations où le club finit dans les quatre premiers">4 premiers</th>
              {relegation && (
                <th scope="col" title="Part des simulations où le club finit dans les trois derniers">3 derniers</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <th scope="row">
                  <span className="standings-team">
                    <Media name={row.name} url={row.imageUrl} /> <span>{row.name}</span>
                  </span>
                </th>
                <td className="standings-points">{row.points}</td>
                <td>{row.played}</td>
                <td>{number(Math.round(row.projectedPoints))}</td>
                <td>{share(row.title)}</td>
                <td>{share(row.topFour)}</td>
                {relegation && <td>{share(row.bottomThree)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="standings-note">
        Les matchs restants sont rejoués {number(projection.model?.replays || 0)} fois d’après la force de chaque
        club (son Elo), laquelle peut encore bouger d’ici la fin de saison. Une estimation, pas un pronostic
        garanti ; elle ne connaît ni blessures ni mercato.
      </p>
    </>
  );
}
