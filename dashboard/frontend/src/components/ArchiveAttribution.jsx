import React from "react";

/** Attribution and coverage for the independently sourced historical archives. */
export default function ArchiveAttribution() {
  return (
    <details className="historical-archive-note">
      <summary>Sources et limites de couverture</summary>
      <p>
        Résultats :{" "}
        <a
          href="https://github.com/openfootball/football.json"
          target="_blank"
          rel="noreferrer"
        >
          OpenFootball
        </a>{" "}
        et{" "}
        <a
          href="https://github.com/footballcsv"
          target="_blank"
          rel="noreferrer"
        >
          footballcsv
        </a>{" "}
        (CC0) ;{" "}
        <a
          href="https://github.com/jalapic/engsoccerdata"
          target="_blank"
          rel="noreferrer"
        >
          engsoccerdata
        </a>{" "}
        (usage gratuit non commercial, attribution demandée). Résultats écossais
        et buts :{" "}
        <a
          href="https://github.com/schochastics/football-data"
          target="_blank"
          rel="noreferrer"
        >
          World Club Ratings / schochastics
        </a>{" "}
        (
        <a
          href="https://opendatacommons.org/licenses/by/1-0/"
          target="_blank"
          rel="noreferrer"
        >
          ODC-BY 1.0
        </a>
        ).
      </p>
      <p>
        La couverture varie selon les compétitions et peut être partielle ; ces
        archives ne contiennent pas de xG. Les événements de buts sont
        rapprochés des résultats par noms, dates et scores : une correspondance
        peut être incorrecte. Le type de but, notamment contre son camp ou sur
        penalty, n’est pas garanti par la source.
      </p>
    </details>
  );
}
