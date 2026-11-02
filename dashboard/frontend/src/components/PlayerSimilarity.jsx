"use client";
import React, { useMemo } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { similarPlayers, SCOUT_METRICS } from "../services/scouting.js";
import { number } from "../services/format.js";
import { Empty, Media } from "./UI.jsx";
import { BookmarkButton, ComparePlayerButton } from "./ResearchUI.jsx";
export default function PlayerSimilarity({ profile, cohorts }) {
  const f = useFootball();
  const similar = useMemo(
    () => similarPlayers(profile, cohorts),
    [profile, cohorts],
  );
  return similar.length ? (
    <>
      <div className="research-context">
        <span>
          {profile.role?.label} · {cohorts.minMinutes} minutes minimum ·
          proximité des centiles
        </span>
      </div>
      <div className="research-similar-grid">
        {similar.map((item) => (
          <article className="research-similar" key={item.profile.id}>
            <div className="research-similar-heading">
              <Media
                name={item.profile.name}
                url={item.profile.imageUrl}
                className="player-avatar"
              />
              <Link
                href={f.href("/joueurs/", {
                  id: item.profile.id,
                  q: "",
                  rmin: "",
                  stats: "",
                  minutes: "1",
                  playerView: "overview",
                })}
              >
                <strong>{item.profile.name}</strong>
                <small>{item.profile.teams.join(" · ")}</small>
              </Link>
              <span
                className="research-index-score"
                title="100 moins l’écart moyen des centiles, sur les indicateurs communs. Ce n’est pas une probabilité."
              >
                {number(item.similarity, 1)}
                <small>proximité / 100</small>
              </span>
            </div>
            <div className="research-context">
              <span>
                {number(item.profile.minutes)} min · {item.parts.length}{" "}
                indicateurs communs
              </span>
            </div>
            <details>
              <summary>Indicateurs les plus proches</summary>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Indicateur / 90 ou %</th>
                    <th>{profile.name}</th>
                    <th>{item.profile.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {item.parts.slice(0, 4).map((part) => (
                    <tr key={part.key}>
                      <th>{SCOUT_METRICS[part.key].label}</th>
                      <td>{number(part.target, 2)}</td>
                      <td>{number(part.other, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <div className="research-toolbar">
              <ComparePlayerButton profile={item.profile} season={f.season} />
              <BookmarkButton
                kind="players"
                id={item.profile.id}
                name={item.profile.name}
                imageUrl={item.profile.imageUrl}
                season={f.season}
                compact
              />
            </div>
          </article>
        ))}
      </div>
    </>
  ) : (
    <Empty>
      Pas assez de pairs ou de mesures comparables. Élargissez les compétitions
      ou réduisez le minimum de minutes.
    </Empty>
  );
}
