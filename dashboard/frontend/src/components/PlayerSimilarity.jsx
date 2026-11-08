"use client";
import React, { useMemo } from "react";
import Link from "next/link";
import { useFootball } from "../hooks/FootballContext.jsx";
import { similarPlayers, SCOUT_METRICS } from "../services/scouting.js";
import { number } from "../services/format.js";
import { Empty, Media } from "./UI.jsx";
import { BookmarkButton, ComparePlayerButton } from "./ResearchUI.jsx";
import { PercentileBar } from "./PlayerScoutCharts.jsx";
import scout from "./PlayerScout.module.css";
export default function PlayerSimilarity({ profile, cohorts }) {
  const f = useFootball();
  const similar = useMemo(
    () => similarPlayers(profile, cohorts),
    [profile, cohorts],
  );
  return similar.length ? (
    <>
      <div className={scout.sectionHead}>
        <div>
          <h2 className={scout.similarTitle}>Profils similaires</h2>
          <p className={scout.similarIntro}>
            {profile.role?.label} · {cohorts.minMinutes} minutes minimum ·
            proximité des centiles sur les indicateurs communs
          </p>
        </div>
      </div>
      <div className={scout.similarGrid}>
        {similar.map((item) => {
          const score = Math.round(item.similarity);
          const gap = item.parts.at(-1);
          return (
            <article className={scout.similar} key={item.profile.id}>
              <div className={scout.similarHead}>
                <Media
                  name={item.profile.name}
                  url={item.profile.imageUrl}
                  className="player-avatar"
                />
                <Link
                  className={scout.similarName}
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
                  className={scout.similarScore}
                  title="100 moins l’écart moyen des centiles, sur les indicateurs communs. Ce n’est pas une probabilité."
                >
                  <b>{number(item.similarity, 1)}</b>
                  <small>proximité / 100</small>
                </span>
              </div>
              <PercentileBar value={score} />
              <div className={scout.similarMeta}>
                <span>
                  <b>{number(item.profile.minutes)}</b> min
                </span>
                <span>
                  <b>{item.parts.length}</b> indicateurs communs
                </span>
              </div>
              <div className={scout.tags}>
                {item.parts.slice(0, 3).map((part) => (
                  <span key={part.key}>{SCOUT_METRICS[part.key].label}</span>
                ))}
              </div>
              {gap && (
                <p className={scout.gap}>
                  Écart principal : {SCOUT_METRICS[gap.key].label} (
                  {number(gap.target, 2)} contre {number(gap.other, 2)})
                </p>
              )}
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
          );
        })}
      </div>
    </>
  ) : (
    <Empty>
      Pas assez de pairs ou de mesures comparables. Élargissez les compétitions
      ou réduisez le minimum de minutes.
    </Empty>
  );
}
