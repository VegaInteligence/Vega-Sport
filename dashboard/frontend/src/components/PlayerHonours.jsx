import React from "react";
import { Empty } from "./UI.jsx";
import { useResource } from "../services/resources.js";
import {
  loadPlayerHonours,
  MESSI_HONOURS,
  MESSI_ID,
} from "../services/player-honours.js";
import { trophyArt } from "../services/trophy-art.js";

export default function PlayerHonours({ id, name }) {
  const result = useResource(
    `player-honours:${id}:${name}`,
    () => loadPlayerHonours(id, name),
    id !== MESSI_ID,
  );
  if (id !== MESSI_ID && result.loading)
    return (
      <div className="loading-state" role="status">
        Chargement du palmarès…
      </div>
    );
  if (id !== MESSI_ID && result.error)
    return <Empty>Le palmarès est momentanément indisponible.</Empty>;
  const groups = id === MESSI_ID ? MESSI_HONOURS : result.value?.groups || [];
  if (!groups.length)
    return (
      <Empty>
        Le palmarès de ce joueur n’est pas disponible pour le moment.
      </Empty>
    );
  return (
    <section className="player-honours" aria-label="Palmarès du joueur">
      <div className="season-section-heading">
        <h3>Palmarès</h3>
        <span>Principaux titres disponibles</span>
      </div>
      <div className="player-honours-grid">
        {groups.map((group) => (
          <section className="player-honours-group" key={group.group}>
            <h4>{group.group}</h4>
            <ul>
              {group.items.map((item) => {
                const image = trophyArt(item, id);
                return (
                  <li key={item.title}>
                    {image && (
                      <span className="player-honours-trophy">
                        <img
                          src={image}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                    )}
                    <span className="player-honours-name">
                      <strong>{item.title}</strong>
                      {item.years && <small>{item.years}</small>}
                    </span>
                    {item.count > 1 && (
                      <span className="player-honours-count">
                        ×{item.count}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {id !== MESSI_ID && (
        <p className="club-note">
          Palmarès partiel selon les informations disponibles.
        </p>
      )}
    </section>
  );
}
