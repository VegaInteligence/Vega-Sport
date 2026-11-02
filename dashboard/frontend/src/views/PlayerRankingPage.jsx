"use client";
import React from "react";
import Link from "next/link";
import Layout from "../components/Layout.jsx";
import Icon from "../components/Icon.jsx";
import BallonDorIcon from "../components/BallonDorIcon.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";

const positions = Array.from({ length: 30 }, (_, index) => index + 1);

export default function PlayerRankingPage() {
  const f = useFootball();
  return (
    <Layout
      path="/classement-joueurs/"
      title="Classement joueurs"
      titleIcon={<BallonDorIcon />}
    >
      <div className="ranking-intro">
        <p>
          Le classement STATARENA est en cours de calibrage. Les 30 positions
          seront publiées une fois le modèle validé.
        </p>
        <Link className="inline-link" href={f.href("/methode/")}>
          Lire la méthode <Icon name="arrow" />
        </Link>
      </div>
      <ol
        className="player-ranking-list"
        role="list"
        aria-label="Classement des joueurs"
      >
        {positions.map((position) => (
          <li
            key={position}
            value={position}
            aria-label={`Rang ${position}, à venir`}
          >
            <span className="player-ranking-position" aria-hidden="true">
              {String(position).padStart(2, "0")}
            </span>
            <span className="player-ranking-avatar" aria-hidden="true">
              <Icon name="players" />
            </span>
            <span className="player-ranking-placeholder">À venir</span>
          </li>
        ))}
      </ol>
    </Layout>
  );
}
