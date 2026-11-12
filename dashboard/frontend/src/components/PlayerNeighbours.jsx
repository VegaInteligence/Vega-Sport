"use client";
import React, { useId } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";
import { neighbourRows, usePlayerNeighbours } from "../services/player-neighbours.js";
import { Media } from "./UI.jsx";
import s from "./PlayerScout.module.css";

/** The players whose season reads the most like this one's, on every statistic at once. */
export default function PlayerNeighbours({ id }) {
  const f = useFootball();
  const heading = useId();
  const answer = usePlayerNeighbours(f.season, id);
  const rows = neighbourRows(answer);
  if (!rows.length) return null;
  return (
    <section className={s.card} aria-labelledby={heading}>
      <div className={s.cardHead}>
        <div>
          <h3 id={heading}>Profils les plus proches</h3>
          <p>
            D’après l’ensemble des statistiques de la saison, par 90 minutes, sans tenir compte du poste ni du
            niveau du championnat · {number(answer.compared)} joueurs comparés
          </p>
        </div>
      </div>
      <ol className={s.partners}>
        {rows.map((player) => (
          <li key={player.id}>
            <Link href={f.href("/joueurs/", { id: player.id, season: f.season, league: "", q: "" })}>
              <Media name={player.name} url={player.imageUrl} className="player-avatar" />
              <span className={s.partnerText}>
                <strong>{player.name}</strong>
                {player.context && <small>{player.context}</small>}
              </span>
              {player.similarity !== null && <b title="100 : le même profil ; 0 : aussi loin que la moitié des joueurs de la saison">{player.similarity}</b>}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
