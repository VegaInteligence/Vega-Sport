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
  const coming = rows.some((row) => row.next);
  const ordinal = (rank) => (rank === 1 ? "1er" : `${rank}e`);
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
              {coming && (
                <th
                  scope="col"
                  title="Niveau moyen (Elo) des cinq prochains adversaires en championnat ; entre parenthèses, le rang de ce calendrier, 1er pour le plus dur"
                >
                  Adv. à venir
                </th>
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
                {coming && (
                  <td
                    title={
                      row.next
                        ? `${row.next.matches} matchs dont ${row.next.home} à domicile · ${number(row.next.expectedPoints, 1)} points attendus`
                        : undefined
                    }
                  >
                    {row.next
                      ? `${number(row.next.opponentLevel)}${row.next.rank ? ` (${ordinal(row.next.rank)})` : ""}`
                      : "—"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="standings-note">
        Les matchs restants sont rejoués {number(projection.model?.replays || 0)} fois d’après la force de chaque
        club (son Elo), laquelle peut encore bouger d’ici la fin de saison. Une estimation, pas un pronostic
        garanti ; elle ne connaît ni blessures ni mercato.
        {coming &&
          " « Adv. à venir » : le niveau moyen des cinq prochains adversaires de championnat, et le rang de ce calendrier (1er pour le plus dur)."}
      </p>
    </>
  );
}
