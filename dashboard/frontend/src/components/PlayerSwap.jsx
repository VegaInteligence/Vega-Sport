"use client";
import React from "react";
import { useFootball } from "../hooks/FootballContext.jsx";
import { swapBlock, usePlayerSwaps } from "../services/player-swap.js";
import s from "./PlayerScout.module.css";

/** What the club's league results would become if a compared player played in the page's player's place. */
export default function PlayerSwap({ player, others }) {
  const f = useFootball();
  const block = swapBlock(usePlayerSwaps(f.season, player.id, others.map((other) => other.id)));
  if (!block) return null;
  return (
    <section className={s.block}>
      <div className={s.sectionHead}>
        <div>
          <h2>Et s’il jouait à sa place ?</h2>
          <p>Estimation · les résultats{block.club ? ` de ${block.club}` : ""} en championnat avec le joueur comparé à la place de {player.name}</p>
        </div>
      </div>
      <div className={s.slots}>
        {block.lines.map((line) => (
          <div className={s.slot} key={line.key}>
            <div>
              <strong>{line.title}</strong>
              <small>
                {line.text}
                {line.detail ? ` ${line.detail}` : ""}
              </small>
            </div>
          </div>
        ))}
      </div>
      {block.estimated && (
        <p className={s.note} style={{ marginTop: 8 }}>
          Estimation tirée de ce que les compositions de départ changent aux résultats, au-delà de la force du club. Elle ne dit rien de
          l’adaptation d’un joueur à un autre club, à un autre championnat ou à un autre système de jeu.
        </p>
      )}
    </section>
  );
}
