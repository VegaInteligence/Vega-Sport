"use client";
import React from "react";
import Layout from "../components/Layout.jsx";
import Icon from "../components/Icon.jsx";
import BallonDorIcon from "../components/BallonDorIcon.jsx";
import { Media } from "../components/UI.jsx";
import SeasonSelect from "../components/SeasonSelect.jsx";
import { useFootball } from "../hooks/FootballContext.jsx";
import { number } from "../services/format.js";

// The ranking is not computed yet: every place renders as a placeholder.
// When a season ranking exists, pass its 30 entries here
// ({ rank, name, imageUrl, team, teamImageUrl, position, score }).
const ranking = null;

const PODIUM = [
  { rank: 2, medal: "silver" },
  { rank: 1, medal: "gold" },
  { rank: 3, medal: "bronze" },
];
const STEPS = [
  [
    "Chaque match",
    "La performance du joueur est comparée à ce qu’on attend d’un joueur au même poste, dans ce match.",
  ],
  [
    "Par blocs",
    "Finition, création, progression, défense et conservation, pondérées selon le poste.",
  ],
  [
    "Sur la saison",
    "Contribution cumulée et niveau par 90 minutes, corrigé pour les temps de jeu courts.",
  ],
  [
    "Au sein du poste",
    "Chaque joueur est situé en centiles de son poste, puis les 30 meilleurs sont réunis.",
  ],
];
// Varied placeholder widths, so empty rows read as names rather than bars.
const WIDTHS = [62, 48, 71, 55, 66, 44, 58, 69, 51, 63, 46, 60, 53, 67];
const width = (rank, offset = 0) =>
  `${WIDTHS[(rank * 3 + offset) % WIDTHS.length]}%`;

function Bar({ w }) {
  return <span className="rank-bar" style={{ width: w }} aria-hidden="true" />;
}
function Avatar({ entry, className }) {
  return entry ? (
    <Media name={entry.name} url={entry.imageUrl} className={className} />
  ) : (
    <span className={`${className} rank-avatar-empty`} aria-hidden="true">
      <Icon name="players" />
    </span>
  );
}

function PodiumPlace({ rank, medal, entry }) {
  return (
    <li
      className={`card podium-place podium-${medal}`}
      value={rank}
      aria-label={
        entry
          ? `Rang ${rank} : ${entry.name}, ${entry.team}`
          : `Rang ${rank}, à révéler`
      }
    >
      <span className="podium-rank" aria-hidden="true">
        {rank}
      </span>
      <Avatar entry={entry} className="podium-avatar" />
      <div className="podium-identity">
        {entry ? (
          <>
            <strong>{entry.name}</strong>
            <span>
              {entry.team} · {entry.position}
            </span>
          </>
        ) : (
          <>
            <strong>À révéler</strong>
            <span>Club · poste</span>
          </>
        )}
      </div>
      <div className="podium-score">
        <span>Score STATARENA</span>
        <b>{entry ? number(entry.score, 1) : "—"}</b>
      </div>
    </li>
  );
}

function RankRow({ rank, entry }) {
  return (
    <li
      className="rank-row"
      value={rank}
      aria-label={
        entry
          ? `Rang ${rank} : ${entry.name}, ${entry.team}`
          : `Rang ${rank}, à venir`
      }
    >
      <span className="rank-number" aria-hidden="true">
        {String(rank).padStart(2, "0")}
      </span>
      <span className="rank-player" aria-hidden={!entry}>
        <Avatar entry={entry} className="rank-avatar" />
        {entry ? <strong>{entry.name}</strong> : <Bar w={width(rank)} />}
      </span>
      <span className="rank-position" aria-hidden={!entry}>
        {entry ? entry.position : <Bar w={width(rank, 1)} />}
      </span>
      <span className="rank-club" aria-hidden={!entry}>
        {entry ? (
          <>
            <Media name={entry.team} url={entry.teamImageUrl} />
            {entry.team}
          </>
        ) : (
          <Bar w={width(rank, 2)} />
        )}
      </span>
      <span className="rank-score" aria-hidden={!entry}>
        {entry ? number(entry.score, 1) : <Bar w="70%" />}
      </span>
    </li>
  );
}

function RankColumn({ from, to }) {
  return (
    <div className="rank-column">
      <div className="rank-head" aria-hidden="true">
        <span>Rang</span>
        <span>Joueur</span>
        <span>Poste</span>
        <span>Club</span>
        <span>Score</span>
      </div>
      <ol className="rank-list" start={from} role="list">
        {Array.from({ length: to - from + 1 }, (_, i) => from + i).map(
          (rank) => (
            <RankRow
              key={rank}
              rank={rank}
              entry={ranking?.find((e) => e.rank === rank)}
            />
          ),
        )}
      </ol>
    </div>
  );
}

export default function PlayerRankingPage() {
  const f = useFootball(),
    seasons = f.manifest?.seasons || [];
  return (
    <Layout
      path="/classement-joueurs/"
      title="Classement Ballon d’Or"
      titleIcon={<BallonDorIcon />}
      className="ranking-page"
    >
      {seasons.length > 1 && (
        <div className="award-intro">
          <SeasonSelect
            label="Saison du classement"
            className="award-season"
            value={f.season}
            seasons={seasons.map((s) => s.id)}
            onChange={f.changeSeason}
          />
        </div>
      )}

      <ol className="podium" role="list" aria-label="Podium">
        {PODIUM.map((place) => (
          <PodiumPlace
            key={place.rank}
            {...place}
            entry={ranking?.find((e) => e.rank === place.rank)}
          />
        ))}
      </ol>

      <section className="rank-board" aria-label="Rangs 4 à 30">
        <h2>Rangs 4 à 30</h2>
        <div className="rank-columns">
          <RankColumn from={4} to={17} />
          <RankColumn from={18} to={30} />
        </div>
      </section>

      <section className="award-method" aria-labelledby="award-method-title">
        <h2 id="award-method-title">Comment le classement est construit</h2>
        <ol role="list">
          {STEPS.map(([title, text], index) => (
            <li key={title}>
              <span className="award-step" aria-hidden="true">
                {index + 1}
              </span>
              <strong>{title}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </Layout>
  );
}
