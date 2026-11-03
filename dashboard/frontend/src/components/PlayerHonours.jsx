import React from "react";
import { Empty } from "./UI.jsx";
import { useResource } from "../services/resources.js";
import {
  loadPlayerHonours,
  MESSI_HONOURS,
  MESSI_ID,
} from "../services/player-honours.js";
import Icon from "./Icon.jsx";
import { date } from "../services/format.js";

export default function PlayerHonours({ id, name }) {
  const result = useResource(`player-honours:${id}:${name}`, () =>
    loadPlayerHonours(id, name),
  );
  if (id !== MESSI_ID && result.loading)
    return (
      <div className="loading-state" role="status">
        Chargement du palmarès…
      </div>
    );
  if (id !== MESSI_ID && result.error)
    return <Empty>Le palmarès est momentanément indisponible.</Empty>;
  const groups = result.value?.groups || (id === MESSI_ID ? MESSI_HONOURS : []);
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
              {group.items.map((item) => (
                <li key={item.title}>
                  <span className="player-honours-icon">
                    <Icon name="trophy" />
                  </span>
                  <span className="player-honours-name">
                    <strong>{item.title}</strong>
                    {item.years && <small>{item.years}</small>}
                  </span>
                  {item.count > 1 && (
                    <span className="player-honours-count">×{item.count}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {result.value?.sourceUrl ? (
        <p className="club-note">
          Palmarès partiel :{" "}
          <a href={result.value.sourceUrl} target="_blank" rel="noreferrer">
            Wikipédia
          </a>
          , contributeurs,{" "}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-SA
          </a>
          {result.value.fetchedAt
            ? ` · mis à jour le ${date(result.value.fetchedAt)}`
            : ""}
          .
        </p>
      ) : (
        <p className="club-note">
          Palmarès partiel selon les informations disponibles.
        </p>
      )}
    </section>
  );
}
