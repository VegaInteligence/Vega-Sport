"use client";
import React from "react";
import { Media } from "./UI.jsx";
import { number } from "../services/format.js";
import { projectionRows, share } from "../services/forecasts.js";
import { ZONES, leaguePhaseZones, leagueZones, tableZones } from "../services/standings-zones.js";
import { useEuropeanPlaces, ZoneLegend } from "./CompetitionStandings.jsx";
import { Term } from "./Hint.jsx";

// A UEFA cup's columns (122): the league phase's three outcomes, then each knockout round.
const PHASE = [
  ["top8", "Top 8", null, "Part des simulations où le club finit dans les huit premiers de la phase de ligue", "ko"],
  ["playoff", "Barrages", "9e–24e", "Part des simulations où le club finit entre la 9e et la 24e place", "po"],
  ["out", "Éliminé", "25e–36e", "Part des simulations où le club finit au-delà de la 24e place", "out"],
];
const ROUNDS = [
  ["r16", "8es", "Part des simulations où le club joue les huitièmes de finale"],
  ["qf", "Quarts", "Part des simulations où le club joue les quarts de finale"],
  ["sf", "Demies", "Part des simulations où le club joue les demi-finales"],
  ["final", "Finale", "Part des simulations où le club joue la finale"],
  ["win", "Vainqueur", "Part des simulations où le club gagne la compétition"],
];

/** A share as a cell shaded by its size. */
function Heat({ value, tone, first }) {
  return (
    <td className="projection-heat" data-tone={tone} data-first={first || undefined} style={{ "--p": value }}>
      {share(value)}
    </td>
  );
}

/**
 * A league replayed to its end: each club's points now and projected, and its chances. Each
 * row wears the zone of its projected place (Europe, promotion, relegation), as the table does.
 * A UEFA cup's league phase is replayed with its bracket: the chance of each stage.
 */
export default function SeasonProjection({ projection, competition, season }) {
  const rows = projectionRows(projection);
  const places = useEuropeanPlaces(competition, season);
  if (!rows.length) return null;
  const cup = rows.some((row) => row.stages);
  const zones = cup
    ? leaguePhaseZones(rows.length)
    : tableZones(rows.length, {
        european: places.places,
        league: leagueZones(competition?.id, rows.length),
      });
  const relegation = !cup && rows.some((row) => row.bottomThree !== null);
  const coming = !cup && rows.some((row) => row.next);
  const ordinal = (rank) => (rank === 1 ? "1er" : `${rank}e`);
  return (
    <>
      <div className="table-scroll standings-scroll" role="region" aria-label="Projection de fin de saison" tabIndex={0}>
        <table className="data-table standings-table season-projection">
          <caption className="sr-only">Projection de fin de saison de chaque club</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col"><Term>Équipe</Term></th>
              <th scope="col" title="Points actuels"><Term>Pts</Term></th>
              <th scope="col" title="Matchs joués"><Term>J</Term></th>
              <th scope="col" title="Points en fin de saison, en moyenne des simulations"><Term>Pts projetés</Term></th>
              {cup ? (
                <>
                  {PHASE.map(([key, label, range, title], i) => (
                    <th key={key} scope="col" title={title} className="projection-group" data-first={i === 0 || undefined}>
                      <Term>{label}</Term>
                      {range && <small>{range}</small>}
                    </th>
                  ))}
                  {ROUNDS.map(([key, label, title], i) => (
                    <th key={key} scope="col" title={title} className="projection-group" data-first={i === 0 || undefined}>
                      <Term>{label}</Term>
                    </th>
                  ))}
                </>
              ) : (
                <>
                  <th scope="col" title="Part des simulations où le club finit premier"><Term>Titre</Term></th>
                  <th scope="col" title="Part des simulations où le club finit dans les quatre premiers"><Term>4 premiers</Term></th>
                </>
              )}
              {relegation && (
                <th scope="col" title="Part des simulations où le club finit dans les trois derniers"><Term>3 derniers</Term></th>
              )}
              {coming && (
                <th
                  scope="col"
                >
                  <Term>Adv. à venir</Term>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.id}
                data-zone={zones[index] || undefined}
                title={zones[index] ? ZONES[zones[index]].label : undefined}
              >
                <td>{index + 1}</td>
                <th scope="row">
                  <span className="standings-team">
                    <Media name={row.name} url={row.imageUrl} /> <span>{row.name}</span>
                  </span>
                </th>
                <td className="standings-points">{row.points}</td>
                <td>{row.played}</td>
                <td>{number(Math.round(row.projectedPoints))}</td>
                {cup ? (
                  <>
                    {PHASE.map(([key, , , , tone], i) => (
                      <Heat key={key} value={row.stages[key]} tone={tone} first={i === 0} />
                    ))}
                    {ROUNDS.map(([key], i) => (
                      <Heat key={key} value={row.stages[key]} tone="round" first={i === 0} />
                    ))}
                  </>
                ) : (
                  <>
                    <td>{share(row.title)}</td>
                    <td>{share(row.topFour)}</td>
                  </>
                )}
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
      <ZoneLegend zones={zones} places={places} />
      <p className="standings-note">
        Les matchs restants sont rejoués {number(projection.model?.replays || 0)} fois d’après la force de chaque
        club (son Elo), laquelle peut encore bouger d’ici la fin de saison. Une estimation, pas un pronostic
        garanti ; elle ne connaît ni blessures ni mercato.
        {cup &&
          " Le tableau suit le tirage quand il est fait ; les matchs déjà joués restent tels quels, une prolongation vaut un tiers de match et les tirs au but sont à 50/50."}
        {coming &&
          " « Adv. à venir » : le niveau moyen des cinq prochains adversaires de championnat, et le rang de ce calendrier (1er pour le plus dur)."}
      </p>
    </>
  );
}
