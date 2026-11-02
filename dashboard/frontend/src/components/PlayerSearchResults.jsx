import Link from "next/link";
import React, { useMemo } from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { playerSearchResults } from "../services/season-player.js";
import { Media } from "./UI.jsx";
import Icon from "./Icon.jsx";

/** The existing search still filters performances; this is a player-level entry point. */
export default function PlayerSearchResults() {
  const f = useFootball();
  const players = useMemo(
    () => playerSearchResults(f.rows, f.filters.query),
    [f.rows, f.filters.query],
  );
  if (!players.length) return null;
  return (
    <section className="player-search-results" aria-label="Joueurs trouvés">
      <h2>Joueurs trouvés</h2>
      <div className="player-search-list">
        {players.map((player) => (
          <Link
            key={player.id}
            className="player-search-result"
            href={f.href("/joueurs/", { id: player.id, q: "" })}
          >
            <Media
              name={player.name}
              url={player.imageUrl}
              className="player-avatar"
            />
            <span className="player-copy">
              <strong>{player.name}</strong>
              <span className="player-meta">{player.team || "Joueur"}</span>
            </span>
            <span className="player-search-action">
              Voir la fiche <Icon name="arrow" />
            </span>
          </Link>
        ))}
      </div>
      {f.partial && (
        <p className="player-search-loading">
          Autres compétitions en cours de chargement…
        </p>
      )}
    </section>
  );
}
