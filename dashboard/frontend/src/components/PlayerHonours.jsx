"use client";
import { Skeleton } from "./UI.jsx";
import React, { useState } from "react";
import { useResource } from "../services/resources.js";
import { playerHonoursResource } from "../services/player-honours.js";
import { trophyArt } from "../services/trophy-art.js";
import Icon from "./Icon.jsx";
import scout from "./PlayerScout.module.css";
import st from "./PlayerHonours.module.css";

export function usePlayerHonours(id, name) {
  const enabled = /^p_[A-Za-z0-9]{6}$/.test(id || "");
  const result = useResource(...playerHonoursResource(id, name), enabled);
  return enabled ? result : { ...result, loading: false };
}

/** The palmarès in the identity rail: one row per trophy (art, title, club and
 * seasons, number of titles), the first six then the rest on demand, and the
 * individual awards without art folded underneath. */
export default function PlayerHonours({ name, result, limit = 6 }) {
  const [all, setAll] = useState(false);
  const groups = result.value?.groups || [];
  const otherAwards = groups
    .filter(({ group }) => group === "Distinctions individuelles")
    .flatMap(({ items }) => items.filter((item) => !trophyArt(item)));
  const trophies = groups.flatMap(({ group, items }) =>
    items.flatMap((item) => {
      const image = trophyArt(item);
      // Individual awards without art are listed under « Autres distinctions ».
      if (!image && group === "Distinctions individuelles") return [];
      return [{ ...item, image, group, key: `${group}:${item.title}` }];
    }),
  );
  if (!trophies.length && !otherAwards.length) {
    if (result.loading)
      return (
        <Skeleton data-page-loading="" className="player-trophy-loading" label="Chargement du palmarès…" />
      );
    return null;
  }
  const titles = trophies.reduce((sum, item) => sum + (item.count || 1), 0);
  const shown = all ? trophies : trophies.slice(0, limit);
  return (
    <section
      className="player-trophy-shelf"
      aria-label={name ? `Palmarès de ${name}` : "Palmarès"}
    >
      <p className={scout.railTitle}>
        <i className={scout.railName}>Palmarès</i>
        {titles > 0 && <span>{titles} titre{titles > 1 ? "s" : ""}</span>}
      </p>
      {shown.length > 0 && (
        <ul className={st.list}>
          {shown.map((item) => (
            <li key={item.key}>
              <span className={st.art} aria-hidden="true">
                {item.image ? (
                  <img src={item.image} alt="" loading="lazy" decoding="async" />
                ) : (
                  <Icon name="trophy" />
                )}
              </span>
              <span className={st.what}><b>{item.title}</b><small>{item.group}{item.years ? ` · ${item.years}` : ""}</small></span><em>{item.count > 1 ? `×${item.count}` : ""}</em>
            </li>
          ))}
        </ul>
      )}
      {trophies.length > limit && (
        <button
          type="button"
          className={st.more}
          aria-expanded={all}
          onClick={() => setAll((open) => !open)}
        >
          {all ? "Réduire le palmarès" : `Tout le palmarès (${trophies.length})`}
        </button>
      )}
      {otherAwards.length > 0 && (
        <details className={st.others} open={!trophies.length}>
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
