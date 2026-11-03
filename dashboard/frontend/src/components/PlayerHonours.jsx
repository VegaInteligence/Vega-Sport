"use client";
import React, { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useResource } from "../services/resources.js";
import {
  loadPlayerHonours,
  MESSI_HONOURS,
  MESSI_ID,
} from "../services/player-honours.js";
import { trophyArt } from "../services/trophy-art.js";

/** A compact shelf belongs to the player header, independent of the active tab. */
export default function PlayerHonours({ id, name }) {
  const rail = useRef(null);
  const [selected, setSelected] = useState(0);
  const result = useResource(
    `player-honours:${id}:${name}`,
    () => loadPlayerHonours(id, name),
    Boolean(id && name),
  );
  const groups = result.value?.groups || (id === MESSI_ID ? MESSI_HONOURS : []);
  const trophies = groups.flatMap((group) =>
    group.items.flatMap((item) => {
      const image = trophyArt(item);
      return image ? [{ ...item, image, group: group.group }] : [];
    }),
  );
  if (!trophies.length) {
    if (result.loading)
      return (
        <div className="player-trophy-loading">Chargement du palmarès…</div>
      );
    return null;
  }
  const current = trophies[Math.min(selected, trophies.length - 1)];
  const scroll = (direction) => {
    const width = rail.current?.clientWidth || 300;
    rail.current?.scrollBy({
      left: direction * Math.max(120, width * 0.75),
      behavior: "auto",
    });
  };
  return (
    <section className="player-trophy-shelf" aria-label={`Palmarès de ${name}`}>
      <div className="player-trophy-shelf-top">
        <span className="player-trophy-label">Palmarès</span>
        <div className="player-trophy-controls">
          <button
            type="button"
            aria-label="Trophées précédents"
            onClick={() => scroll(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Trophées suivants"
            onClick={() => scroll(1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div
        className="player-trophy-rail"
        ref={rail}
        tabIndex={0}
        aria-label="Faire défiler les trophées"
      >
        {trophies.map((item, index) => (
          <button
            type="button"
            className="player-trophy-item"
            key={`${item.group}:${item.title}`}
            onClick={() => setSelected(index)}
            aria-pressed={current === item}
            aria-label={`${item.title}${item.count > 1 ? `, ${item.count} titres` : ""}, ${item.group}`}
            title={`${item.title} · ${item.group}`}
          >
            <img src={item.image} alt="" loading="lazy" decoding="async" />
            {item.count > 1 && <span>×{item.count}</span>}
          </button>
        ))}
      </div>
      <div className="player-trophy-caption" aria-live="polite">
        <strong>{current.title}</strong>
        <span>
          {current.group}
          {current.years ? ` · ${current.years}` : ""}
        </span>
        {result.value?.sourceUrl && (
          <a href={result.value.sourceUrl} target="_blank" rel="noreferrer">
            Source
          </a>
        )}
      </div>
    </section>
  );
}
