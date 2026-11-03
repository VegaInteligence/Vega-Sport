import React from "react";

/** Coverage limits of the historical archives (licences: Données & méthode). */
export default function ArchiveAttribution() {
  return (
    <details className="historical-archive-note">
      <summary>Limites de couverture</summary>
      <p>
        La couverture varie selon les compétitions et peut être partielle ; ces
        archives ne contiennent pas de xG. Les événements de buts sont
        rapprochés des résultats par noms, dates et scores : une correspondance
        peut être incorrecte. Le type de but, notamment contre son camp ou sur
        penalty, n’est pas garanti.
      </p>
    </details>
  );
}
