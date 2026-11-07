"use client";
import React, { useState } from "react";
import { useResource } from "../services/resources.js";
import { loadPlayerHonours } from "../services/player-honours.js";
import { trophyArt } from "../services/trophy-art.js";
import Icon from "./Icon.jsx";

export function usePlayerHonours(id, name) {
  return useResource(
    `player-honours:${id}`,
    () => loadPlayerHonours(id, name),
    /^p_[A-Za-z0-9]{6}$/.test(id || ""),
  );
}

/** A compact shelf belongs to the player header, independent of the active tab. */
export default function PlayerHonours({ name, result }) {
  const [selected, setSelected] = useState(null);
  const groups = result.value?.groups || [];
  const otherAwards = groups
    .filter(({ group }) => group === "Distinctions individuelles")
    .flatMap(({ items }) => items.filter((item) => !trophyArt(item)));
  const trophies = groups.flatMap(({ group, items }) =>
    items.flatMap((item) => {
      const image = trophyArt(item);
      // Keep the existing illustrated individual awards in the header.
      if (!image && group === "Distinctions individuelles") return [];
      return [{ ...item, image, group, key: `${group}:${item.title}` }];
    }),
  );
  if (!trophies.length && !otherAwards.length) {
    if (result.loading)
      return (
        <div className="player-trophy-loading" role="status">
          Chargement du palmarès…
        </div>
      );
    return null;
  }
  const current = trophies.find((item) => item.key === selected) || trophies[0];
  return (
    <section
      className="player-trophy-shelf"
      aria-label={name ? `Palmarès de ${name}` : "Palmarès"}
    >
      <span className="player-trophy-label">Palmarès</span>
      {trophies.length > 0 && (
        <>
          <div className="player-trophy-grid">
            {trophies.map((item) => (
              <button
                type="button"
                className="player-trophy-item"
                key={item.key}
                onClick={() => setSelected(item.key)}
                aria-pressed={current.key === item.key}
                aria-label={`${item.title}${item.count > 1 ? `, ${item.count} titres` : ""}, ${item.group}`}
              >
                <span className="player-trophy-visual" aria-hidden="true">
                  <span className="player-trophy-image">
                    {item.image ? (
                      <img
                        src={item.image}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <Icon name="trophy" />
                    )}
                  </span>
                  {item.count > 1 && (
                    <span className="player-trophy-count">×{item.count}</span>
                  )}
                </span>
                <span className="player-trophy-name">{item.title}</span>
              </button>
            ))}
          </div>
          <div className="player-trophy-caption">
            <div
              className="player-trophy-details"
              aria-live="polite"
              aria-atomic="true"
            >
              <strong>{current.title}</strong>
              <span>
                {current.group}
                {current.years ? ` · ${current.years}` : ""}
              </span>
            </div>
          </div>
        </>
      )}
      {otherAwards.length > 0 && (
        <details open={!trophies.length}>
          <summary>Autres distinctions ({otherAwards.length})</summary>
          <ul>
            {otherAwards.map((item, index) => (
              <li key={`${item.title}:${index}`}>
                {item.title}
                {item.count > 1 ? ` × ${item.count}` : ""}
                {item.years ? ` · ${item.years}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
